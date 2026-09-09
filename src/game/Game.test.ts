import { describe, expect, it } from 'vitest';
import {
  CATCH_RADIUS,
  Game,
  IMPACT_DISPLAY_MS,
  SWAT_COOLDOWN_MS,
  SWAT_WINDUP_MS,
  type NeuralEngine,
} from './Game';
import type { CircuitData, LesionMode, NeuralOutput, VisualInput } from '../shared/types';

const circuit: CircuitData = {
  version: 'test',
  name: 'Test circuit',
  source: 'test',
  neurons: [{ id: '1', type: 'test', side: 'M', nt: 'test', role: 'sensory', x: 0, y: 0, z: 0 }],
  edges: [],
  manifest: {
    dataset: 'test',
    neuronCount: 1,
    edgeCount: 0,
    contactCount: 0,
    description: 'test',
    assumptions: [],
    sourceUrls: [],
  },
};

class TestBrain implements NeuralEngine {
  inputs: VisualInput[] = [];
  steps: number[] = [];
  lesions: LesionMode[] = [];
  output: NeuralOutput = {
    retreat: 0,
    turn: 0,
    activity: new Float32Array([0.25]),
    disabled: new Uint8Array(1),
    spikeCount: 0,
    meanHz: 0,
    aliveNeurons: 1,
  };
  reset(): void {
    this.inputs = [];
    this.steps = [];
  }
  setLesion(mode: LesionMode): void {
    this.lesions.push(mode);
  }
  step(dt: number, input: VisualInput): NeuralOutput {
    if (dt > 0) {
      this.steps.push(dt);
      this.inputs.push({ ...input });
    }
    return this.output;
  }
}

function advance(game: Game, milliseconds: number): void {
  for (let remaining = milliseconds; remaining > 0; remaining -= 100)
    game.advance(Math.min(100, remaining));
}

describe('fixed-step closed-loop game', () => {
  it('does no neural work while ready, then uses exactly 1 ms active steps', () => {
    const brain = new TestBrain();
    const game = new Game(circuit, 7, brain);
    game.setPointer(500, 325, true);
    expect(game.advance(250)).toBe(0);
    expect(brain.steps).toEqual([]);
    expect(game.isRunning()).toBe(false);
    expect(game.snapshot().time).toBe(0);
    expect(game.snapshot().elapsed).toBe(0);
    expect(game.snapshot().fly).toMatchObject({ x: 500, y: 325, speed: 0 });
    game.setPointer(500, 325, false);
    game.start();
    expect(game.isRunning()).toBe(true);
    expect(game.advance(2.4)).toBe(2);
    expect(game.advance(0.6)).toBe(1);
    expect(brain.steps).toEqual([1, 1, 1]);
    expect(brain.inputs.every((input) => Object.values(input).every((value) => value === 0))).toBe(
      true,
    );
    expect(game.snapshot().elapsed).toBe(0.003);
  });

  it('cannot steer directly from the threat when neural outputs are held fixed', () => {
    const first = new Game(circuit, 12, new TestBrain());
    const secondBrain = new TestBrain();
    const second = new Game(circuit, 12, secondBrain);
    first.start();
    second.start();
    first.setPointer(30, 30, true);
    second.setPointer(500, 290, true);
    advance(first, 1500);
    advance(second, 1500);
    expect(first.snapshot().fly).toEqual(second.snapshot().fly);
    expect(secondBrain.inputs.some((input) => input.leftLoom > 0)).toBe(true);
    expect(Object.keys(secondBrain.inputs[0]).sort()).toEqual(
      ['frontLoom', 'leftLoom', 'leftMotion', 'rightLoom', 'rightMotion'].sort(),
    );
  });

  it('locks the swat location and resolves a catch only after its windup', () => {
    const game = new Game(circuit, 8, new TestBrain());
    const prediction = new Game(circuit, 8, new TestBrain());
    prediction.start();
    advance(prediction, SWAT_WINDUP_MS);
    const target = prediction.snapshot().fly;
    game.start();
    game.setPointer(target.x, target.y, true);
    expect(game.swat()).toBe(true);
    game.setPointer(1, 1, true);
    expect(game.snapshot().threat.x).toBe(target.x);
    expect(game.snapshot().threat.y).toBe(target.y);
    advance(game, SWAT_WINDUP_MS - 1);
    expect(game.snapshot().mode).toBe('playing');
    game.advance(1);
    expect(game.snapshot().mode).toBe('caught');
    expect(game.snapshot().swats).toBe(1);
    expect(game.snapshot().dodges).toBe(0);
    expect(
      Math.hypot(game.snapshot().fly.x - target.x, game.snapshot().fly.y - target.y),
    ).toBeLessThan(CATCH_RADIUS);
  });

  it('scores misses at contact and enforces the independent cooldown', () => {
    const game = new Game(circuit, 8, new TestBrain());
    game.start();
    game.setPointer(0, 0, true);
    game.swat();
    advance(game, SWAT_WINDUP_MS - 1);
    expect(game.snapshot().dodges).toBe(0);
    game.advance(1);
    expect(game.snapshot().dodges).toBe(1);
    expect(game.swat()).toBe(false);
    advance(game, SWAT_COOLDOWN_MS - SWAT_WINDUP_MS);
    expect(game.swat()).toBe(true);
    expect(game.snapshot().swats).toBe(2);
  });

  it('keeps actual hit feedback at strike A when the player moves the aim to B', () => {
    const game = new Game(circuit, 8, new TestBrain());
    const prediction = new Game(circuit, 8, new TestBrain());
    prediction.start();
    advance(prediction, SWAT_WINDUP_MS);
    const strikeA = prediction.snapshot().fly;
    game.start();
    game.setPointer(strikeA.x, strikeA.y, true);
    game.swat();
    game.setPointer(3, 4, true);
    advance(game, SWAT_WINDUP_MS - 1);
    expect(game.snapshot().impact).toBeUndefined();
    expect(game.snapshot().threat).toMatchObject({ x: strikeA.x, y: strikeA.y });
    game.advance(1);
    const resolved = game.snapshot();
    expect(resolved.mode).toBe('caught');
    expect(resolved.threat).toMatchObject({ x: 3, y: 4, swatting: 0 });
    expect(resolved.impact).toEqual({
      x: strikeA.x,
      y: strikeA.y,
      time: SWAT_WINDUP_MS / 1000,
      outcome: 'caught',
    });
    // The replay/renderer receives an owned value, not mutable Game state.
    resolved.impact!.x = -123;
    expect(game.snapshot().impact!.x).toBe(strikeA.x);
  });

  it('reports a real miss at A without moving live aim B, then expires the impact', () => {
    const game = new Game(circuit, 19, new TestBrain());
    game.start();
    game.setPointer(0, 0, true);
    game.swat();
    game.setPointer(800, 600, true);
    advance(game, SWAT_WINDUP_MS);
    expect(game.snapshot()).toMatchObject({
      mode: 'playing',
      dodges: 1,
      threat: { x: 800, y: 600, swatting: 0 },
      impact: { x: 0, y: 0, time: SWAT_WINDUP_MS / 1000, outcome: 'miss' },
    });
    advance(game, IMPACT_DISPLAY_MS + 1);
    expect(game.snapshot().impact).toBeUndefined();
    game.reset();
    expect(game.snapshot().impact).toBeUndefined();
  });

  it('pauses without moving the round clock, the body, or the swat', () => {
    const game = new Game(circuit, 8, new TestBrain());
    game.start();
    game.setPointer(0, 0, true);
    game.swat();
    advance(game, 100);
    game.setPaused(true);
    const before = game.snapshot();
    advance(game, 5000);
    expect(game.snapshot()).toEqual(before);
    expect(game.swat()).toBe(false);
    game.setPaused(false);
    advance(game, 140);
    expect(game.snapshot().dodges).toBe(1);
  });

  it('resets trial state and lesions, while respecting an existing pause', () => {
    const brain = new TestBrain();
    const game = new Game(circuit, 77, brain);
    const initial = game.snapshot().fly;
    game.start();
    game.setPointer(0, 0, true);
    game.swat();
    game.setLesion('vision');
    advance(game, 500);
    expect(brain.lesions.at(-1)).toBe('vision');
    game.setPaused(true);
    game.reset();
    expect(game.snapshot()).toMatchObject({
      mode: 'ready',
      elapsed: 0,
      swats: 0,
      dodges: 0,
      lesion: 'intact',
      swatCooldown: 0,
      seed: 77,
    });
    expect(game.snapshot().fly).toEqual(initial);
    expect(brain.lesions.at(-1)).toBe('intact');
    expect(game.advance(10)).toBe(0);
  });

  it('starts a fresh trial with the selected lesion and reset restores intact', () => {
    const brain = new TestBrain();
    const game = new Game(circuit, 77, brain);
    game.setLesion('motor');
    game.start();
    expect(game.snapshot()).toMatchObject({ mode: 'playing', lesion: 'motor', elapsed: 0 });
    expect(brain.lesions.at(-1)).toBe('motor');
    game.reset();
    expect(game.snapshot()).toMatchObject({ mode: 'ready', lesion: 'intact', elapsed: 0 });
    expect(brain.lesions.at(-1)).toBe('intact');
  });

  it('keeps body bounds, rejects invalid deltas, and ends the round at 30 simulated seconds', () => {
    const brain = new TestBrain();
    brain.output.retreat = 1;
    const game = new Game(circuit, 999, brain);
    game.start();
    for (const value of [NaN, Infinity, -1, 0]) expect(game.advance(value)).toBe(0);
    for (let i = 0; i < 300; i++) {
      game.advance(100);
      const { x, y } = game.snapshot().fly;
      expect(x).toBeGreaterThanOrEqual(28);
      expect(x).toBeLessThanOrEqual(972);
      expect(y).toBeGreaterThanOrEqual(28);
      expect(y).toBeLessThanOrEqual(622);
    }
    expect(game.snapshot()).toMatchObject({ mode: 'escaped', elapsed: 30 });
    expect(game.advance(100)).toBe(0);
  });

  it('publishes activity copies that cannot mutate the neural state', () => {
    const brain = new TestBrain();
    const game = new Game(circuit, 8, brain);
    game.advance(1);
    const snapshot = game.snapshot();
    snapshot.neural.activity[0] = 1;
    snapshot.neural.disabled[0] = 1;
    expect(brain.output.activity[0]).toBe(0.25);
    expect(brain.output.disabled[0]).toBe(0);
  });

  it('starts airborne away from the centre with continuous velocity, height and banking', () => {
    const game = new Game(circuit, 82, new TestBrain());
    game.start();
    const first = game.snapshot().fly;
    expect(Math.hypot(first.x - 500, first.y - 325)).toBeGreaterThan(180);
    expect(first.speed).toBeGreaterThan(300);
    advance(game, 500);
    const second = game.snapshot().fly;
    expect(Math.hypot(second.x - first.x, second.y - first.y)).toBeGreaterThan(120);
    expect(second.altitude).toBeGreaterThan(50);
    expect(Math.hypot(second.vx!, second.vy!)).toBeCloseTo(second.speed, 7);
    expect(second.bank).not.toBe(0);
  });

  it('generates a different rematch route while explicit reset reproduces the first route', () => {
    const game = new Game(circuit, 17, new TestBrain());
    game.start();
    const first = game.snapshot().fly;
    game.start();
    const rematch = game.snapshot().fly;
    expect(rematch).not.toEqual(first);
    game.reset(17);
    game.start();
    expect(game.snapshot().fly).toEqual(first);
  });

  it('keeps an identical seeded flight trajectory across frame chunk sizes', () => {
    const first = new Game(circuit, 36, new TestBrain());
    const second = new Game(circuit, 36, new TestBrain());
    first.start();
    second.start();
    advance(first, 2300);
    for (let elapsed = 0; elapsed < 2300; elapsed++) second.advance(1);
    expect(first.snapshot()).toEqual(second.snapshot());
  });

  it('changes flight from the neural decoder, never from an unprocessed swat shortcut', () => {
    const neutral = new Game(circuit, 34, new TestBrain());
    const swatted = new Game(circuit, 34, new TestBrain());
    const activeBrain = new TestBrain();
    activeBrain.output.retreat = 0.5;
    activeBrain.output.turn = 0.3;
    const neural = new Game(circuit, 34, activeBrain);
    neutral.start();
    swatted.start();
    neural.start();
    swatted.setPointer(0, 0, true);
    swatted.swat();
    advance(neutral, 800);
    advance(swatted, 800);
    advance(neural, 800);
    expect(swatted.snapshot().fly).toEqual(neutral.snapshot().fly);
    expect(neural.snapshot().fly.flightState).toBe('evading');
    expect(
      Math.hypot(
        neural.snapshot().fly.x - neutral.snapshot().fly.x,
        neural.snapshot().fly.y - neutral.snapshot().fly.y,
      ),
    ).toBeGreaterThan(25);
  });
});
