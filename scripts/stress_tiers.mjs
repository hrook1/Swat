// A deterministic 30-second changing-stimulus soak per circuit, then five quiet
// seconds. Run `node scripts/stress_tiers.mjs`. Timings measure this Node host,
// not a browser, and include periodic finite-state checks.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Brain } from '../src/neural/Brain.ts';

const catalog = JSON.parse(readFileSync(new URL('../public/data/circuits.json', import.meta.url)));
const quiet = { leftLoom: 0, rightLoom: 0, frontLoom: 0, leftMotion: 0, rightMotion: 0 };
for (const tier of catalog.tiers) {
  const circuit = JSON.parse(readFileSync(new URL(`../public${tier.path}`, import.meta.url)));
  const brain = new Brain(circuit, 709);
  const started = performance.now();
  let peakHz = 0,
    spikes = 0,
    finite = true;
  for (let k = 0; k < 300; k++) {
    const output = brain.step(100, {
      ...quiet,
      leftLoom: (k % 50) / 49,
      rightLoom: ((k * 13) % 50) / 49,
    });
    peakHz = Math.max(peakHz, output.meanHz);
    spikes += output.spikeCount;
    finite &&=
      Number.isFinite(output.retreat) &&
      Number.isFinite(output.meanHz) &&
      [...output.activity].every(Number.isFinite);
  }
  const wallMs = performance.now() - started;
  const residual = [];
  for (let k = 0; k < 5; k++) {
    const output = brain.step(1000, quiet);
    residual.push({
      second: k + 1,
      meanHz: output.meanHz,
      retreat: output.retreat,
      spikes: output.spikeCount,
    });
  }
  console.log(
    JSON.stringify({
      tier: tier.id,
      simulatedSeconds: 30,
      wallMs,
      speed: 30000 / wallMs,
      peakHz,
      spikes,
      finite,
      residual,
    }),
  );
  if (!finite || residual.at(-1).meanHz > 0.05 || residual.at(-1).retreat > 0.01)
    throw new Error(`${tier.id} failed the changing-stimulus soak.`);
}
