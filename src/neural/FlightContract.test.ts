import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Game } from '../game/Game';
import type { CircuitData } from '../shared/types';

const catalog = JSON.parse(
  readFileSync(new URL('../../public/data/circuits.json', import.meta.url), 'utf8'),
) as { tiers: { id: string; path: string }[] };

describe('independent real-neuron to arcade-flight contract audit', () => {
  it.each(catalog.tiers)(
    '$id: different visible threats cannot steer the fly when actual neural output cells are silenced',
    (tier) => {
      const graph = JSON.parse(
        readFileSync(new URL(`../../public${tier.path}`, import.meta.url), 'utf8'),
      ) as CircuitData;
      const visionCut = new Game(graph, 17);
      const outputCut = new Game(graph, 17);
      visionCut.setLesion('vision');
      outputCut.setLesion('motor');
      visionCut.start();
      outputCut.start();
      let networkSpikes = 0;
      for (let elapsed = 0; elapsed < 1000; elapsed += 10) {
        const pose = outputCut.snapshot().fly;
        // Distinct world-space threats. Only the second circuit can see its cue.
        visionCut.setPointer(20, 20, true);
        outputCut.setPointer(
          pose.x + Math.cos(pose.heading) * 25,
          pose.y + Math.sin(pose.heading) * 25,
          true,
        );
        visionCut.advance(10);
        outputCut.advance(10);
        const blind = visionCut.snapshot(),
          blocked = outputCut.snapshot();
        expect(blocked.neural.retreat).toBe(0);
        expect(blocked.neural.turn).toBe(0);
        expect(blind.neural.retreat).toBe(0);
        expect(blocked.fly).toEqual(blind.fly);
        networkSpikes += blocked.neural.spikeCount;
      }
      // The no-escape result is not achieved by skipping the real graph entirely.
      expect(networkSpikes).toBeGreaterThan(0);
    },
  );
});
