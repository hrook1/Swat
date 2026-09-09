import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CATCH_RADIUS,
  FLIGHT_MARGIN,
  Game,
  IMPACT_DISPLAY_MS,
  SWAT_COOLDOWN_MS,
  SWAT_WINDUP_MS,
  type NeuralEngine,
} from './Game';
import type { CircuitData, LesionMode, NeuralOutput, VisualInput } from '../shared/types';

// These tests deliberately separate collision/timing policy from neural skill.
// A zero-output engine makes both runs follow exactly the same seeded route.
const fixture: CircuitData = {
  version: 'audit',
  name: 'mechanics fixture',
  source: 'test only',
  neurons: [
    { id: 'fixture', type: 'fixture', side: 'M', nt: '', role: 'sensory', x: 0, y: 0, z: 0 },
  ],
  edges: [],
  manifest: {
    dataset: 'test only',
    neuronCount: 1,
    edgeCount: 0,
    contactCount: 0,
    description: 'test only',
    assumptions: [],
    sourceUrls: [],
  },
};

class QuietBrain implements NeuralEngine {
  inputs: VisualInput[] = [];
  output: NeuralOutput = {
    retreat: 0,
    turn: 0,
    activity: new Float32Array(1),
    disabled: new Uint8Array(1),
    spikeCount: 0,
    meanHz: 0,
    aliveNeurons: 1,
  };
  reset(): void {
    this.inputs = [];
  }
  setLesion(_mode: LesionMode): void {}
  step(dt: number, input: VisualInput): NeuralOutput {
    if (dt > 0) this.inputs.push({ ...input });
    return this.output;
  }
}

function travel(game: Game, milliseconds: number): void {
  for (let remaining = milliseconds; remaining > 0; remaining -= 100)
    game.advance(Math.min(remaining, 100));
}

function neutralGame(seed = 8): Game {
  const game = new Game(fixture, seed, new QuietBrain());
  game.start();
  return game;
}

describe('independent swat fairness audit', () => {
  it('accepts once, locks aim despite pointer departure, and uses an exact simulated-time deadline', () => {
    const brain = new QuietBrain();
    const game = new Game(fixture, 8, brain);
    expect(game.swat()).toBe(false);
    game.start();
    expect(game.swat()).toBe(false);
    game.setPointer(0, 0, true);
    expect(game.swat()).toBe(true);
    game.setPointer(900, 600, false);
    expect(game.swat()).toBe(false);
    expect(game.snapshot()).toMatchObject({ swats: 1, threat: { x: 0, y: 0, active: true } });
    travel(game, SWAT_WINDUP_MS - 1);
    expect(game.snapshot()).toMatchObject({ mode: 'playing', dodges: 0 });
    expect(game.snapshot().impact).toBeUndefined();
    game.advance(1);
    expect(brain.inputs).toHaveLength(SWAT_WINDUP_MS);
    expect(game.snapshot()).toMatchObject({
      dodges: 1,
      impact: { x: 0, y: 0, time: SWAT_WINDUP_MS / 1000, outcome: 'miss' },
    });
    game.setPointer(0, 0, true);
    travel(game, SWAT_COOLDOWN_MS - SWAT_WINDUP_MS - 1);
    expect(game.swat()).toBe(false);
    game.advance(1);
    expect(game.swat()).toBe(true);
    expect(game.snapshot().swats).toBe(2);
  });

  it('uses an inclusive circle around the impact-time body centre, not pointer-down overlap', () => {
    const predicted = neutralGame();
    travel(predicted, SWAT_WINDUP_MS);
    const future = predicted.snapshot().fly;
    for (const offset of [CATCH_RADIUS - 1e-6, CATCH_RADIUS, CATCH_RADIUS + 1e-6]) {
      const game = neutralGame();
      game.setPointer(future.x + offset, future.y, true);
      game.swat();
      travel(game, SWAT_WINDUP_MS);
      expect(game.snapshot().impact?.outcome).toBe(offset <= CATCH_RADIUS ? 'caught' : 'miss');
    }
  });

  it('can miss a click directly on the visible starting body without any neural escape', () => {
    const distances: number[] = [];
    for (let seed = 1; seed <= 32; seed++) {
      const game = neutralGame(seed);
      const start = game.snapshot().fly;
      game.setPointer(start.x, start.y, true);
      game.swat();
      travel(game, SWAT_WINDUP_MS);
      const end = game.snapshot();
      distances.push(Math.hypot(end.fly.x - start.x, end.fly.y - start.y));
      expect(end.neural.retreat).toBe(0);
      expect(end.impact?.outcome).toBe('miss');
    }
    console.info(
      'SWAT_ZERO_REFLEX_DIRECT_CLICK',
      JSON.stringify({
        seeds: 32,
        misses: 32,
        displacementMin: Math.min(...distances),
        displacementMax: Math.max(...distances),
        catchRadius: CATCH_RADIUS,
      }),
    );
  });

  it('allows perfectly led catches on all the same routes with no neural output', () => {
    for (let seed = 1; seed <= 32; seed++) {
      const prediction = neutralGame(seed);
      travel(prediction, SWAT_WINDUP_MS);
      const target = prediction.snapshot().fly;
      const game = neutralGame(seed);
      game.setPointer(target.x, target.y, true);
      game.swat();
      travel(game, SWAT_WINDUP_MS);
      expect(game.snapshot()).toMatchObject({ mode: 'caught', swats: 1, dodges: 0 });
    }
  });

  it('supplies a visual cue while hovering and a stronger loom during the locked swing', () => {
    const brains = [new QuietBrain(), new QuietBrain()];
    const games = brains.map((brain) => new Game(fixture, 8, brain));
    games.forEach((game) => {
      game.start();
      game.setPointer(500, 325, true);
    });
    games[1].swat();
    games.forEach((game) => {
      travel(game, SWAT_WINDUP_MS);
    });
    const cue = (input: VisualInput) => input.leftLoom + input.rightLoom;
    expect(cue(brains[0].inputs[0])).toBeGreaterThan(0);
    // Acceptance itself adds no instant bypass; growth begins in subsequent ticks.
    expect(brains[1].inputs[0]).toEqual(brains[0].inputs[0]);
    expect(Math.max(...brains[1].inputs.map(cue))).toBeGreaterThan(
      Math.max(...brains[0].inputs.map(cue)),
    );
    expect(games[1].snapshot().fly).toEqual(games[0].snapshot().fly);
  });

  it('keeps a resolved miss available across normal publish/replay sampling gaps', () => {
    const game = neutralGame();
    game.setPointer(0, 0, true);
    game.swat();
    travel(game, SWAT_WINDUP_MS);
    const impact = game.snapshot().impact;
    // Worker publishes at about33ms; recorded frames have a minimum64ms gap.
    travel(game, 100);
    expect(game.snapshot().impact).toEqual(impact);
    travel(game, IMPACT_DISPLAY_MS - 100);
    expect(game.snapshot().impact).toEqual(impact);
    game.advance(1);
    expect(game.snapshot().impact).toBeUndefined();
  });

  it('clamps aim to the world without moving an accepted strike or allowing offstage body escape', () => {
    const game = neutralGame(77);
    game.setPointer(-500, 9999, true);
    game.swat();
    expect(game.snapshot().threat).toMatchObject({ x: 0, y: 650 });
    game.setPointer(NaN, Infinity, true);
    expect(game.snapshot().threat).toMatchObject({ x: 0, y: 650 });
    for (let t = 0; t < 3000; t += 20) {
      game.advance(20);
      const fly = game.snapshot().fly;
      expect(fly.x).toBeGreaterThanOrEqual(FLIGHT_MARGIN);
      expect(fly.x).toBeLessThanOrEqual(1000 - FLIGHT_MARGIN);
      expect(fly.y).toBeGreaterThanOrEqual(FLIGHT_MARGIN);
      expect(fly.y).toBeLessThanOrEqual(650 - FLIGHT_MARGIN);
    }
  });

  it('measures a real Expanded-graph causal contribution separately from a dodge claim', () => {
    const graph: CircuitData = JSON.parse(
      readFileSync(new URL('../../public/data/circuit-expanded.json', import.meta.url), 'utf8'),
    );
    const games = [new Game(graph, 34), new Game(graph, 34)];
    games[1].setLesion('motor');
    games.forEach((game) => {
      game.start();
    });
    expect(games[0].snapshot().fly).toEqual(games[1].snapshot().fly);
    const prediction = neutralGame(34);
    travel(prediction, SWAT_WINDUP_MS);
    const target = prediction.snapshot().fly;
    games.forEach((game) => {
      game.setPointer(target.x, target.y, true);
      game.swat();
    });
    let maxRetreat = 0;
    for (let t = 0; t < SWAT_WINDUP_MS; t++) {
      games.forEach((game) => {
        game.advance(1);
      });
      maxRetreat = Math.max(maxRetreat, games[0].snapshot().neural.retreat);
    }
    const [intact, cut] = games.map((game) => game.snapshot());
    const displacement = Math.hypot(intact.fly.x - cut.fly.x, intact.fly.y - cut.fly.y);
    console.info(
      'SWAT_EXPANDED_CAUSAL_PROBE',
      JSON.stringify({
        seed: 34,
        maxRetreat,
        displacement,
        intact: intact.impact?.outcome,
        motorSilenced: cut.impact?.outcome,
      }),
    );
    expect(maxRetreat).toBeGreaterThan(0);
    expect(cut.neural.retreat).toBe(0);
    expect(cut.neural.turn).toBe(0);
    expect(displacement).toBeGreaterThan(1);
    // One paired shot establishes causal movement, NOT validated improved skill.
  }, 20000);
});
