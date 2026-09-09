import { describe, expect, it } from 'vitest';
import { FixedStepScheduler, type FixedStepper } from './scheduler';

class ProbeGame implements FixedStepper {
  steps: number[] = [];
  running = true;
  advance(ms: number): number {
    if (!this.running) return 0;
    this.steps.push(ms);
    return ms;
  }
  isRunning(): boolean {
    return this.running;
  }
}

describe('worker timer / visible-frame scheduling', () => {
  it('progresses from visible-frame wakeups even when no worker timer fires', () => {
    let now = 0;
    const scheduler = new FixedStepScheduler(() => now);
    const game = new ProbeGame();
    // Deliberately no timer callbacks: only sixteen-millisecond frame messages.
    for (let frame = 1; frame <= 100; frame++) {
      now = frame * 16;
      scheduler.pump(game, false);
    }
    expect(game.steps.length).toBe(1600);
    expect(game.steps.every((ms) => ms === 1)).toBe(true);
    expect(scheduler.simSpeed).toBe(1);
  });

  it('does not double simulated time when timer and frame wakeups overlap', () => {
    let now = 0;
    const scheduler = new FixedStepScheduler(() => now);
    const game = new ProbeGame();
    for (let tick = 1; tick <= 250; tick++) {
      now = tick * 4;
      scheduler.pump(game, false);
      if (tick % 4 === 0) scheduler.pump(game, false);
    }
    expect(game.steps.length).toBe(1000);
    expect(scheduler.simSpeed).toBe(1);
  });

  it('makes bounded progress if coarse clocks or preemption consume the first budget', () => {
    let now = 0;
    let jumpOnRead = false;
    const scheduler = new FixedStepScheduler(() => {
      if (jumpOnRead) now += 20;
      return now;
    });
    const game = new ProbeGame();
    now = 16;
    jumpOnRead = true;
    scheduler.pump(game, false);
    // The old before-work deadline check did zero work for this clock sequence.
    expect(game.steps).toEqual([1]);
  });

  it('bounds overdue work and reports lost wall time instead of pretending full speed', () => {
    let now = 0;
    const scheduler = new FixedStepScheduler(() => now);
    const game = new ProbeGame();
    now = 1000;
    scheduler.pump(game, false);
    expect(game.steps.length).toBe(100);
    expect(scheduler.simSpeed).toBe(0.1);
  });

  it('does no work while paused/ready and reset discards pause debt', () => {
    let now = 0;
    const scheduler = new FixedStepScheduler(() => now);
    const game = new ProbeGame();
    game.running = false;
    now = 1000;
    scheduler.pump(game, false);
    expect(game.steps).toEqual([]);
    game.running = true;
    now = 2000;
    scheduler.pump(game, true);
    scheduler.reset();
    now = 2016;
    scheduler.pump(game, false);
    expect(game.steps.length).toBe(16);
  });
});
