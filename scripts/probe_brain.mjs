// Offline diagnostic; node24's native type stripping loads the production kernel.
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Brain } from '../src/neural/Brain.ts';

const circuit = JSON.parse(
  readFileSync(new URL('../public/data/circuit.json', import.meta.url), 'utf8'),
);
const quiet = { leftLoom: 0, rightLoom: 0, frontLoom: 0, leftMotion: 0, rightMotion: 0 };
const runs = [];
for (const gain of [0.19, 0.23, 0.275, 0.32]) {
  for (const stimulus of [0.1, 0.25, 0.5, 0.8]) {
    const copy = {
      ...circuit,
      manifest: {
        ...circuit.manifest,
        modelParameters: { ...circuit.manifest.modelParameters, synapseMvPerContact: gain },
      },
    };
    const brain = new Brain(copy, 709);
    const start = performance.now();
    brain.step(200, quiet);
    const values = [];
    let onset = null;
    for (let t = 0; t < 600; t++) {
      const o = brain.step(1, { ...quiet, leftLoom: stimulus, rightLoom: stimulus });
      if (o.retreat > 0.1 && onset === null) onset = t + 1;
      if (t % 50 === 49)
        values.push({ t: t + 1, retreat: o.retreat, turn: o.turn, meanHz: o.meanHz });
    }
    brain.step(1000, quiet);
    const end = brain.step(0, quiet);
    runs.push({
      gain,
      stimulus,
      onset,
      sustained: values.at(-1),
      after1sQuiet: { retreat: end.retreat, turn: end.turn, meanHz: end.meanHz },
      wallMs: performance.now() - start,
    });
  }
}
console.log(JSON.stringify(runs, null, 2));
if (process.argv.includes('--save')) {
  writeFileSync(
    new URL('../public/data/calibration.json', import.meta.url),
    JSON.stringify(
      {
        model: circuit.version,
        generated: new Date().toISOString(),
        description:
          'Model responses to synthetic stimuli, not biological measurements. Node host timing is not a mobile browser benchmark.',
        runs,
      },
      null,
      2,
    ),
  );
}
