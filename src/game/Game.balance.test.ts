import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Game, SWAT_COOLDOWN_MS, SWAT_WINDUP_MS } from './Game';
import type { CircuitData } from '../shared/types';

const circuit = JSON.parse(
  readFileSync(new URL('../../public/data/circuit.json', import.meta.url), 'utf8'),
) as CircuitData;
const advance = (game: Game, ms: number) => {
  for (let left = ms; left > 0; left -= 100) game.advance(Math.min(left, 100));
};

// Synthetic aim policies are regression probes, NOT measured human win rates.
// Each trial sees the same initial route and gets exactly one swat.
it('rewards leading a fast fly, prevents centre-start cheese, and keeps some skilled catches possible', () => {
  const results: Record<string, number> = { centre: 0, stale: 0, lead: 0, overlead: 0 };
  const trials = 18;
  for (let seed = 1; seed <= trials; seed++) {
    for (const policy of Object.keys(results)) {
      const game = new Game(circuit, seed * 613);
      game.start();
      if (policy !== 'centre') advance(game, 350 + (seed % 5) * 137);
      const seen = game.snapshot().fly;
      // 90 ms reaction/input delay. Leading offsets both that delay and windup.
      const lead = policy === 'lead' ? 0.33 : policy === 'overlead' ? 0.45 : 0;
      const x = policy === 'centre' ? 500 : seen.x + seen.vx! * lead;
      const y = policy === 'centre' ? 325 : seen.y + seen.vy! * lead;
      if (policy !== 'centre') advance(game, 90);
      game.setPointer(x, y, true);
      expect(game.swat()).toBe(true);
      advance(game, SWAT_WINDUP_MS);
      if (game.snapshot().mode === 'caught') results[policy]++;
    }
  }
  console.info(
    'FLIGHT_BALANCE_PROBE',
    JSON.stringify({
      trialsPerPolicy: trials,
      results,
      interpretation: 'Seeded synthetic single-shot policies, not human playtest percentages',
    }),
  );
  expect(results.centre).toBe(0);
  expect(results.lead + results.overlead).toBeGreaterThan(results.stale * 2);
  expect(results.lead).toBeGreaterThanOrEqual(3);
  expect(results.stale).toBeLessThan(trials / 2);
}, 60_000);

it('does not reward blind spam or camping the centre as much as tracking flight', () => {
  const results = { random: 0, centreCamp: 0 };
  const rounds = 8;
  const shotsPerRound = 8;
  for (let seed = 1; seed <= rounds; seed++) {
    for (const policy of ['random', 'centreCamp'] as const) {
      const game = new Game(circuit, seed * 1723);
      game.start();
      let randomState = seed * 9619;
      const random = () => {
        randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
        return randomState / 4294967296;
      };
      for (let shot = 0; shot < shotsPerRound; shot++) {
        game.setPointer(
          policy === 'centreCamp' ? 500 : 72 + random() * 856,
          policy === 'centreCamp' ? 325 : 72 + random() * 506,
          true,
        );
        game.swat();
        advance(game, SWAT_COOLDOWN_MS);
        if (game.snapshot().mode === 'caught') {
          results[policy]++;
          break;
        }
      }
    }
  }
  console.info(
    'FLIGHT_SPAM_PROBE',
    JSON.stringify({
      roundsPerPolicy: rounds,
      shotsPerRound,
      results,
      interpretation: 'Synthetic eight-shot sessions, not human playtest percentages',
    }),
  );
  expect(results.random).toBeLessThan(rounds / 2);
  expect(results.centreCamp).toBeLessThan(rounds / 2);
}, 60_000);
