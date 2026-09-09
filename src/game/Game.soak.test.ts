import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Game } from './Game';
import type { CircuitData, LesionMode } from '../shared/types';

// Explicit stress check: RUN_GAME_SOAK=1 npm test -- src/game/Game.soak.test.ts
// This measures simulated time in Node, not wall-clock browser performance.
it.runIf(process.env.RUN_GAME_SOAK === '1')(
  'remains finite across ten simulated minutes and repeated trial resets',
  () => {
    const circuit = JSON.parse(
      readFileSync(new URL('../../public/data/circuit.json', import.meta.url), 'utf8'),
    ) as CircuitData;
    const game = new Game(circuit, 42);
    const modes: LesionMode[] = ['intact', 'vision', 'motor', 'random'];
    const started = performance.now();
    let maxHz = 0;
    let maxRetreat = 0;
    let observedSnapshots = 0;
    for (let round = 0; round < 20; round++) {
      game.reset(42 + round);
      game.setLesion(modes[round % modes.length]);
      game.start();
      for (let milliseconds = 0; milliseconds < 30_000; milliseconds += 250) {
        const time = milliseconds / 1000;
        game.setPointer(
          500 + 310 * Math.cos(time * 1.1),
          325 + 180 * Math.sin(time * 2),
          milliseconds % 3000 < 2200,
        );
        expect(game.advance(250)).toBe(250);
        const state = game.snapshot();
        for (const value of [
          state.fly.x,
          state.fly.y,
          state.fly.heading,
          state.fly.speed,
          state.fly.vx,
          state.fly.vy,
          state.fly.altitude,
          state.fly.bank,
          state.fly.pitch,
          state.neural.retreat,
          state.neural.turn,
          state.neural.meanHz,
        ]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(state.fly.x).toBeGreaterThanOrEqual(28);
        expect(state.fly.x).toBeLessThanOrEqual(972);
        expect(state.fly.y).toBeGreaterThanOrEqual(28);
        expect(state.fly.y).toBeLessThanOrEqual(622);
        expect(
          state.neural.activity.every(
            (value) => Number.isFinite(value) && value >= 0 && value <= 1,
          ),
        ).toBe(true);
        maxHz = Math.max(maxHz, state.neural.meanHz);
        maxRetreat = Math.max(maxRetreat, state.neural.retreat);
        observedSnapshots++;
      }
      expect(game.snapshot()).toMatchObject({
        mode: 'escaped',
        elapsed: 30,
        lesion: modes[round % modes.length],
      });
    }
    console.info(
      'GAME_SOAK_RESULT',
      JSON.stringify({
        simulatedSeconds: 600,
        rounds: 20,
        observedSnapshots,
        elapsedWallSeconds: (performance.now() - started) / 1000,
        maxHz,
        maxRetreat,
        finite: true,
      }),
    );
  },
  120_000,
);
