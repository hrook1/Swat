// Reproducible synthetic-stimulus audit; run with Node 24 native type stripping.
// Host timings are not claims about browser speed or biological reaction times.
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { Brain } from '../src/neural/Brain.ts';

const definitions = [
  {
    id: 'compact',
    label: 'Compact',
    path: '/data/circuit-compact.json',
    description: 'Path core only. Lightest workload; the most surrounding anatomy is omitted.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    path: '/data/circuit-balanced.json',
    description: 'Path core plus 700 strongly connected neighboring neurons.',
  },
  {
    id: 'standard',
    label: 'Standard',
    path: '/data/circuit.json',
    description: 'Path core plus 1,800 neighbors. The original calibrated circuit.',
  },
  {
    id: 'expanded',
    label: 'Expanded',
    path: '/data/circuit-expanded.json',
    description:
      'Path core plus 4,912 neighbors. More anatomy and a heavier workload, not guaranteed better play.',
  },
];
const quiet = { leftLoom: 0, rightLoom: 0, frontLoom: 0, leftMotion: 0, rightMotion: 0 };
const tiers = [],
  runs = [];
let allValid = true;
for (const definition of definitions) {
  const file = new URL(`../public${definition.path}`, import.meta.url);
  const raw = readFileSync(file);
  const circuit = JSON.parse(raw);
  const row = {
    ...definition,
    neuronCount: circuit.neurons.length,
    edgeCount: circuit.edges.length,
    contactCount: circuit.edges.reduce((total, edge) => total + edge[2], 0),
    downloadBytes: statSync(file).size,
    gzipBytes: gzipSync(raw).length,
  };
  tiers.push(row);
  const measurements = [];
  for (const [name, leftLoom, rightLoom, lesion] of [
    ['quiet', 0, 0, 'intact'],
    ['gentle', 0.25, 0.25, 'intact'],
    ['bilateral', 0.8, 0.8, 'intact'],
    ['left', 0.8, 0.05, 'intact'],
    ['right', 0.05, 0.8, 'intact'],
    ['vision-cut', 0.8, 0.8, 'vision'],
    ['motor-cut', 0.8, 0.8, 'motor'],
  ]) {
    const brain = new Brain(circuit, 709);
    brain.setLesion(lesion);
    const input = { ...quiet, leftLoom, rightLoom };
    const started = performance.now();
    let onset = null,
      maxRetreat = 0,
      maxMeanHz = 0,
      finite = true;
    for (let t = 0; t < 600; t++) {
      const output = brain.step(1, input);
      if (output.retreat > 0.1 && onset === null) onset = t + 1;
      maxRetreat = Math.max(maxRetreat, output.retreat);
      maxMeanHz = Math.max(maxMeanHz, output.meanHz);
      finite &&= [output.retreat, output.turn, output.meanHz, ...output.activity].every(
        Number.isFinite,
      );
    }
    const stimulated = brain.step(0, quiet);
    const response = {
      retreat: stimulated.retreat,
      turn: stimulated.turn,
      meanHz: stimulated.meanHz,
    };
    brain.step(1000, quiet);
    const after = brain.step(0, quiet);
    const afterOneSecondQuiet = { retreat: after.retreat, turn: after.turn, meanHz: after.meanHz };
    brain.step(1000, quiet);
    const afterTwo = brain.step(0, quiet);
    const afterQuiet = { retreat: afterTwo.retreat, turn: afterTwo.turn, meanHz: afterTwo.meanHz };
    const valid =
      finite &&
      afterTwo.meanHz < 0.05 &&
      afterTwo.retreat < 0.01 &&
      (name !== 'bilateral' || maxRetreat > 0.15) &&
      (!['quiet', 'vision-cut', 'motor-cut'].includes(name) || maxRetreat === 0);
    allValid &&= valid;
    measurements.push({
      name,
      onsetMs: onset,
      maxRetreat,
      maxMeanHz,
      response,
      afterOneSecondQuiet,
      afterTwoSecondsQuiet: afterQuiet,
      finite,
      valid,
      wallMs: performance.now() - started,
    });
  }
  const record = { tier: definition.id, measurements };
  runs.push(record);
  console.log(JSON.stringify({ ...row, ...record }, null, 2));
}
console.log(`Every tier passed: ${allValid}`);
if (process.argv.includes('--save')) {
  writeFileSync(
    new URL('../public/data/tier-calibration.json', import.meta.url),
    JSON.stringify(
      {
        description:
          'Synthetic model checks, not biological measurements. Node host timing includes audit overhead and is not browser performance. Decay acceptance is after 2 seconds; the Standard left stimulus had a small 1-second residual (0.17Hz mean, retreat 0.013), then no further spikes in the second quiet second. No dynamics or weights were changed.',
        modelGainMvPerContact: 0.275,
        allValid,
        runs,
      },
      null,
      2,
    ),
  );
  if (!allValid) throw new Error('A candidate tier failed: catalog was not published.');
  writeFileSync(
    new URL('../public/data/circuits.json', import.meta.url),
    JSON.stringify(
      {
        defaultId: 'standard',
        description:
          'Nested real-connectome selections. Circuit size changes anatomical coverage and compute cost; it is not an intelligence score.',
        tiers,
      },
      null,
      2,
    ),
  );
}
