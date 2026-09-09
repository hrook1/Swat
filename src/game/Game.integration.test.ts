import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Game } from './Game';
import type { CircuitData, LesionMode } from '../shared/types';

const circuit = JSON.parse(
  readFileSync(new URL('../../public/data/circuit.json', import.meta.url), 'utf8'),
) as CircuitData;

function loomingTrial(lesion: LesionMode) {
  const game = new Game(circuit, 42);
  game.setLesion(lesion);
  game.start();
  const origin = game.snapshot().fly;
  let maxRetreat = 0;
  let maxTurn = 0;
  let maxHz = 0;
  let firstRetreatMs: number | null = null;
  const trace: { time: number; retreat: number; turn: number; x: number; y: number }[] = [];
  // Identical prescribed world stimulus for each lesion. No pointer position
  // is generated from a desired fly escape direction or fed to the decoder.
  for (let elapsed = 0; elapsed < 1600; elapsed += 10) {
    const distance = 300 - 270 * Math.min(elapsed / 800, 1);
    game.setPointer(
      origin.x + Math.cos(origin.heading) * distance,
      origin.y + Math.sin(origin.heading) * distance,
      elapsed >= 200 && elapsed < 1200,
    );
    game.advance(10);
    const state = game.snapshot();
    maxRetreat = Math.max(maxRetreat, state.neural.retreat);
    maxTurn = Math.max(maxTurn, Math.abs(state.neural.turn));
    maxHz = Math.max(maxHz, state.neural.meanHz);
    if (firstRetreatMs === null && state.neural.retreat > 0.03) firstRetreatMs = elapsed + 10;
    if ((elapsed + 10) % 100 === 0)
      trace.push({
        time: state.time,
        retreat: state.neural.retreat,
        turn: state.neural.turn,
        x: state.fly.x,
        y: state.fly.y,
      });
  }
  return { maxRetreat, maxTurn, maxHz, firstRetreatMs, final: game.snapshot().fly, trace };
}

describe('packaged MaleCNS circuit in the game loop', () => {
  it('responds to world-space looming through the real circuit and loses retreat under input/output lesions', () => {
    const intact = loomingTrial('intact');
    const vision = loomingTrial('vision');
    const motor = loomingTrial('motor');
    console.info('GAME_CIRCUIT_TRACE', JSON.stringify({ intact, vision, motor }));
    expect(intact.maxRetreat).toBeGreaterThan(0.03);
    expect(intact.firstRetreatMs).not.toBeNull();
    expect(vision.maxRetreat).toBe(0);
    expect(motor.maxRetreat).toBe(0);
    expect(vision.final).toEqual(motor.final);
    expect(
      Math.hypot(intact.final.x - vision.final.x, intact.final.y - vision.final.y),
    ).toBeGreaterThan(3);
  });

  it('resolves real-circuit swat trials using the physical contact rule', () => {
    const trials = [];
    for (const offset of [0, 30, 45, 55, 70]) {
      for (const lesion of ['intact', 'vision'] as const) {
        const game = new Game(circuit, 42);
        game.setLesion(lesion);
        game.start();
        game.advance(200);
        const initial = game.snapshot().fly;
        const target = {
          x: initial.x + Math.cos(initial.heading) * offset,
          y: initial.y + Math.sin(initial.heading) * offset,
        };
        game.setPointer(target.x, target.y, true);
        expect(game.swat()).toBe(true);
        let maxRetreat = 0;
        for (let elapsed = 0; elapsed < 240; elapsed += 10) {
          game.advance(10);
          maxRetreat = Math.max(maxRetreat, game.snapshot().neural.retreat);
        }
        const state = game.snapshot();
        const distance = Math.hypot(state.fly.x - target.x, state.fly.y - target.y);
        expect(state.mode === 'caught').toBe(distance <= 57);
        trials.push({
          offset,
          lesion,
          maxRetreat,
          distance,
          mode: state.mode,
          dodges: state.dodges,
        });
      }
    }
    console.info('GAME_SWAT_TRACE', JSON.stringify(trials));
    // Clicking where a fast fly used to be misses; a sufficiently led shot catches.
    expect(trials.find((trial) => trial.offset === 0 && trial.lesion === 'intact')?.dodges).toBe(1);
    expect(trials.find((trial) => trial.offset === 70 && trial.lesion === 'intact')?.mode).toBe(
      'caught',
    );
    expect(trials.some((trial) => trial.lesion === 'intact' && trial.maxRetreat > 0.03)).toBe(true);
    expect(trials.find((trial) => trial.offset === 55 && trial.lesion === 'intact')?.dodges).toBe(
      1,
    );
    expect(trials.find((trial) => trial.offset === 55 && trial.lesion === 'vision')?.mode).toBe(
      'caught',
    );
  });
});
