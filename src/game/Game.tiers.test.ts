import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATCH_RADIUS, FLIGHT_MARGIN, Game, SWAT_WINDUP_MS } from './Game';
import type { CircuitData, LesionMode } from '../shared/types';

const catalog = JSON.parse(
  readFileSync(new URL('../../public/data/circuits.json', import.meta.url), 'utf8'),
) as {
  tiers: { id: string; path: string }[];
};
const advance = (game: Game, ms: number) => {
  for (let left = ms; left > 0; left -= 100) game.advance(Math.min(left, 100));
};

describe('short real-circuit flight balance checks across actual sizes', () => {
  it.each(catalog.tiers)(
    '$id remains catchable by leading and has a real neural contribution',
    (tier) => {
      const circuit = JSON.parse(
        readFileSync(new URL(`../../public${tier.path}`, import.meta.url), 'utf8'),
      ) as CircuitData;
      const catches = { stale: 0, lead: 0 };
      const byStartTime: Record<number, { stale: number; lead: number }> = {};
      let maxRetreat = 0;
      let maxFiring = 0;
      // Include an initial coast, the first saccade window and later flight.
      // Sampling only 487 ms made every straight-line prediction miss: an honest
      // illustration of why a four-shot transition-window probe is not a win rate.
      for (const shotAt of [200, 487, 1100]) {
        byStartTime[shotAt] = { stale: 0, lead: 0 };
        for (const seed of [613, 1226, 1839, 2452]) {
          for (const policy of ['stale', 'lead'] as const) {
            const game = new Game(circuit, seed);
            game.start();
            advance(game, shotAt);
            const seen = game.snapshot().fly;
            const ahead = policy === 'lead' ? 0.33 : 0;
            advance(game, 90);
            game.setPointer(seen.x + seen.vx! * ahead, seen.y + seen.vy! * ahead, true);
            expect(game.swat()).toBe(true);
            for (let elapsed = 0; elapsed < SWAT_WINDUP_MS; elapsed += 10) {
              game.advance(10);
              const state = game.snapshot();
              maxRetreat = Math.max(maxRetreat, state.neural.retreat);
              maxFiring = Math.max(maxFiring, state.neural.meanHz);
              expect(state.fly.x).toBeGreaterThanOrEqual(FLIGHT_MARGIN);
              expect(state.fly.y).toBeGreaterThanOrEqual(FLIGHT_MARGIN);
              expect(state.fly.x).toBeLessThanOrEqual(1000 - FLIGHT_MARGIN);
              expect(state.fly.y).toBeLessThanOrEqual(650 - FLIGHT_MARGIN);
              expect(state.neural.activity.every((value) => Number.isFinite(value))).toBe(true);
            }
            if (game.snapshot().mode === 'caught') {
              catches[policy]++;
              byStartTime[shotAt][policy]++;
            }
          }
        }
      }
      const paired: Record<string, { distance: number; retreat: number; caught: boolean }> = {};
      for (const lesion of ['intact', 'vision'] satisfies LesionMode[]) {
        const game = new Game(circuit, 42);
        game.setLesion(lesion);
        game.start();
        advance(game, 200);
        const seen = game.snapshot().fly;
        const target = {
          x: seen.x + Math.cos(seen.heading) * 55,
          y: seen.y + Math.sin(seen.heading) * 55,
        };
        game.setPointer(target.x, target.y, true);
        game.swat();
        let retreat = 0;
        for (let elapsed = 0; elapsed < SWAT_WINDUP_MS; elapsed += 10) {
          game.advance(10);
          retreat = Math.max(retreat, game.snapshot().neural.retreat);
        }
        const state = game.snapshot();
        const distance = Math.hypot(state.fly.x - target.x, state.fly.y - target.y);
        expect(state.mode === 'caught').toBe(distance <= CATCH_RADIUS);
        paired[lesion] = { distance, retreat, caught: state.mode === 'caught' };
      }
      console.info(
        'TIER_FLIGHT_CHECK',
        JSON.stringify({
          tier: tier.id,
          syntheticTrialsPerPolicy: 12,
          catches,
          byStartTime,
          maxRetreat,
          maxFiring,
          paired,
        }),
      );
      expect(catches.lead).toBeGreaterThan(0);
      expect(catches.lead).toBeGreaterThan(catches.stale);
      expect(maxRetreat).toBeGreaterThan(0.03);
      expect(paired.vision.retreat).toBe(0);
      expect(Math.abs(paired.intact.distance - paired.vision.distance)).toBeGreaterThan(5);
    },
    60_000,
  );
});
