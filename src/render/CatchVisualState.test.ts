import { describe, expect, it } from 'vitest';
import { CatchVisualState, CATCH_PRESENTATION_SECONDS, splatPose } from './CatchVisualState';
import type { GameSnapshot } from '../shared/types';

const caught = (
  overrides: Partial<GameSnapshot> = {},
): Pick<GameSnapshot, 'mode' | 'time' | 'impact'> => ({
  mode: 'caught',
  time: 1.24,
  impact: { x: 200, y: 150, time: 1.24, outcome: 'caught' },
  ...overrides,
});

describe('confirmed-hit cartoon splat', () => {
  it('never splats misses, pending swings, timeout, ready or future impacts', () => {
    for (const snapshot of [
      caught({ mode: 'playing' }),
      caught({ mode: 'escaped' }),
      caught({ mode: 'ready' }),
      caught({ impact: undefined }),
      caught({ time: 1 }),
      caught({ impact: { x: 200, y: 150, time: 1.24, outcome: 'miss' } }),
    ]) {
      const visual = new CatchVisualState();
      visual.update(snapshot);
      expect(visual.advance(0.05)).toBeNull();
      expect(splatPose(visual.advance(0)).visible).toBe(false);
    }
  });

  it('starts only on confirmed contact and progresses despite frozen game time', () => {
    const visual = new CatchVisualState();
    const snapshot = caught();
    visual.update(snapshot);
    expect(visual.advance(0)).toBe(0);
    for (let i = 0; i < 10; i++) {
      visual.update({ ...snapshot });
      visual.advance(0.05);
    }
    expect(visual.advance(0)).toBeCloseTo(0.5);
    expect(snapshot.time).toBe(1.24);
  });

  it('appears immediately, pops once and settles without endless motion', () => {
    expect(splatPose(null).visible).toBe(false);
    expect(splatPose(0)).toEqual({ visible: true, scale: 0.65, spread: 0 });
    expect(splatPose(0.07).scale).toBeCloseTo(1.12);
    expect(splatPose(0.17).scale).toBeCloseTo(1);
    expect(splatPose(0.17)).toEqual(splatPose(99));
    expect(splatPose(0.17).spread).toBe(1);
    for (const boundary of [0.07, 0.17]) {
      const before = splatPose(boundary - 1e-8),
        after = splatPose(boundary + 1e-8);
      for (const key of ['scale', 'spread'] as const)
        expect(before[key]).toBeCloseTo(after[key], 5);
    }
  });

  it('caps the terminal clock and freezes it while held', () => {
    const visual = new CatchVisualState();
    visual.update(caught());
    expect(visual.advance(10)).toBe(0.05);
    expect(visual.advance(0.05, 1, true)).toBe(0.05);
    for (let i = 0; i < 100; i++) visual.advance(0.05);
    expect(visual.advance(0)).toBe(CATCH_PRESENTATION_SECONDS);
  });

  it('runs the cosmetic replay tail at 0.4×, not live speed', () => {
    const visual = new CatchVisualState();
    visual.update(caught());
    for (let i = 0; i < 10; i++) visual.advance(0.05, 0.4);
    expect(visual.advance(0)).toBeCloseTo(0.2);
  });

  it('reduced motion shows the settled result without a bounce', () => {
    const visual = new CatchVisualState();
    visual.update(caught());
    const age = visual.advance(0, 1, false, true);
    expect(age).toBe(CATCH_PRESENTATION_SECONDS);
    expect(splatPose(age)).toEqual(splatPose(99));
  });

  it('restores the fly on reset, rematch and replay rewind, even without ready', () => {
    for (const mode of ['ready', 'playing', 'escaped'] as const) {
      const visual = new CatchVisualState();
      visual.update(caught());
      visual.advance(0.05);
      visual.update(caught({ mode, time: 0.5, impact: undefined }));
      expect(visual.advance(0.05)).toBeNull();
      visual.update(caught());
      expect(visual.advance(0)).toBe(0);
    }
  });

  it('allows the same catch in a fresh replay and new catches without retriggering old frames', () => {
    const visual = new CatchVisualState();
    visual.update(caught());
    visual.advance(0.05);
    visual.update(caught());
    expect(visual.advance(0)).toBe(0.05);
    visual.update(caught({ mode: 'playing', time: 1, impact: undefined }));
    visual.update(caught());
    expect(visual.advance(0)).toBe(0);
    visual.advance(0.05);
    visual.update(caught({ time: 2, impact: { x: 300, y: 150, time: 2, outcome: 'caught' } }));
    expect(visual.advance(0)).toBe(0);
  });

  it('keeps bounded nonzero scales and travel for all valid presentation ages', () => {
    for (let age = -0.1; age <= 2; age += 0.001) {
      const pose = splatPose(age);
      expect(pose.scale).toBeGreaterThanOrEqual(0.65);
      expect(pose.scale).toBeLessThanOrEqual(1.12);
      expect(pose.spread).toBeGreaterThanOrEqual(0);
      expect(pose.spread).toBeLessThanOrEqual(1);
    }
  });
});
