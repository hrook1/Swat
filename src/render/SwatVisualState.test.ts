import { describe, expect, it } from 'vitest';
import type { GameSnapshot } from '../shared/types';
import { IMPACT_ANIMATION_SECONDS, paddleTransform, SwatVisualState } from './SwatVisualState';

const frame = (
  overrides: Partial<GameSnapshot> = {},
): Pick<GameSnapshot, 'mode' | 'time' | 'threat' | 'impact'> => ({
  mode: 'playing',
  time: 1.24,
  threat: { x: 800, y: 450, active: true, swatting: 0 },
  impact: { x: 200, y: 150, time: 1.24, outcome: 'miss' },
  ...overrides,
});

describe('resolved swat visual feedback', () => {
  it('keeps the paddle at resolved A while the reticle follows new aim B', () => {
    const visual = new SwatVisualState();
    const snapshot = frame();
    visual.update(snapshot);
    expect(visual.pose(snapshot)).toMatchObject({
      visible: true,
      x: 200,
      y: 150,
      impactAge: 0,
      targetVisible: true,
      targetX: 800,
      targetY: 450,
    });
    expect(visual.pose(frame({ time: 1.44 }))).toMatchObject({ x: 200, y: 150 });
    expect(visual.pose(frame({ time: 1.55 }))).toMatchObject({ x: 800, y: 450, impactAge: null });
  });

  it('finishes impact feedback even when the pointer leaves the arena', () => {
    const visual = new SwatVisualState();
    const snapshot = frame({ threat: { x: 800, y: 450, active: false, swatting: 0 } });
    visual.update(snapshot);
    expect(visual.pose(snapshot)).toMatchObject({ visible: true, targetVisible: false, x: 200 });
    expect(visual.pose({ ...snapshot, time: 1.55 }).visible).toBe(false);
  });

  it('holds the actual final caught contact rather than inventing later replay frames', () => {
    const visual = new SwatVisualState();
    const snapshot = frame({
      mode: 'caught',
      impact: { x: 200, y: 150, time: 1.24, outcome: 'caught' },
    });
    visual.update(snapshot);
    const pose = visual.pose(snapshot);
    for (let i = 0; i < 40; i++) {
      visual.update({ ...snapshot, impact: { ...snapshot.impact! } });
      expect(visual.pose(snapshot)).toEqual(pose);
    }
    expect(pose).toMatchObject({
      impactAge: 0,
      x: 200,
      targetVisible: false,
      impactOutcome: 'caught',
    });
  });

  it('clears the impact on rewind or ready and permits that shot in a new replay', () => {
    const visual = new SwatVisualState();
    const snapshot = frame();
    visual.update(snapshot);
    visual.update(frame({ time: 1.74, impact: undefined }));
    visual.update(frame({ time: 0.1, impact: undefined }));
    expect(visual.pose(snapshot).x).toBe(800);
    visual.update(snapshot);
    expect(visual.pose(snapshot)).toMatchObject({ x: 200, impactAge: 0 });
    const ready = frame({ mode: 'ready', time: 0, impact: undefined });
    visual.update(ready);
    expect(visual.pose(ready)).toMatchObject({ visible: false, targetVisible: false, x: 800 });
  });

  it('never invents an impact merely because a wind-up disappeared', () => {
    const visual = new SwatVisualState();
    visual.update(
      frame({ impact: undefined, threat: { x: 200, y: 150, active: true, swatting: 0.9 } }),
    );
    const snapshot = frame({ impact: undefined });
    visual.update(snapshot);
    expect(visual.pose(snapshot)).toMatchObject({
      x: 800,
      y: 450,
      impactAge: null,
      strikeVisible: false,
    });
  });

  it('pauses and slow-motion replay use simulation time, not the number of rendered frames', () => {
    const visual = new SwatVisualState();
    visual.update(frame());
    const paused = frame({ time: 1.32 });
    for (let i = 0; i < 300; i++) {
      visual.update(paused);
      expect(visual.pose(paused).impactAge).toBeCloseTo(0.08);
    }
    // 200 ms of wall playback at 0.4× is only 80 ms of recorded simulation.
    const replay = frame({ time: 1.4 });
    visual.update(replay);
    expect(visual.pose(replay).impactAge).toBeCloseTo(0.16);
    expect(visual.pose(replay).strikeVisible).toBe(true);
  });

  it('gives an accepted second swing priority over a previous impact', () => {
    const visual = new SwatVisualState();
    visual.update(frame());
    const next = frame({ time: 1.5, threat: { x: 900, y: 500, active: true, swatting: 0.01 } });
    visual.update(next);
    expect(visual.pose(next)).toMatchObject({
      x: 900,
      y: 500,
      progress: 0.01,
      impactAge: null,
      strikeVisible: true,
    });
    expect(IMPACT_ANIMATION_SECONDS).toBeLessThan(0.32);
  });

  it('does not show a stale contact when the first received snapshot is already too late', () => {
    const visual = new SwatVisualState();
    const late = frame({ time: 1.7 });
    visual.update(late);
    expect(visual.pose(late)).toMatchObject({ x: 800, impactAge: null, strikeVisible: false });
  });

  it('ignores an impact from the future rather than making an early flash', () => {
    const visual = new SwatVisualState();
    const future = frame({ time: 1.1 });
    visual.update(future);
    expect(visual.pose(future)).toMatchObject({ impactAge: null, strikeVisible: false });
  });
});

describe('legible, simulation-driven paddle motion', () => {
  it('rests off the aiming centre, visibly cocks back, then accelerates into contact', () => {
    const rest = paddleTransform(0, null);
    const cocked = paddleTransform(0.3, null);
    expect(rest.offsetX).toBeGreaterThan(0);
    expect(rest.offsetY).toBeGreaterThan(0);
    expect(cocked.offsetY).toBeGreaterThan(rest.offsetY);
    expect(cocked.scaleX).toBeGreaterThan(rest.scaleX);
    const earlyTravel = paddleTransform(0.5, null).offsetY - paddleTransform(0.6, null).offsetY;
    const lateTravel = paddleTransform(0.9, null).offsetY - paddleTransform(1, null).offsetY;
    expect(lateTravel).toBeGreaterThan(earlyTravel * 2);
  });

  it('lands exactly on the locked click point only at the full 240 ms and actual impact', () => {
    expect(paddleTransform(239 / 240, null).offsetY).toBeGreaterThan(0);
    expect(paddleTransform(1, null)).toMatchObject({
      offsetX: 0,
      offsetY: 0,
      tiltX: 0,
      tiltY: 0,
      scaleX: 1,
      scaleY: 1,
    });
    expect(paddleTransform(1, null)).toEqual(paddleTransform(0, 0));
  });

  it('holds contact briefly then recoils and settles without a transform jump', () => {
    expect(paddleTransform(0, 0.02)).toMatchObject({ offsetX: 0, offsetY: 0 });
    expect(paddleTransform(0, 0.09).offsetY).toBeGreaterThan(0);
    for (const age of [0.045, 0.145]) {
      const before = paddleTransform(0, age - 1e-8);
      const after = paddleTransform(0, age + 1e-8);
      for (const key of Object.keys(before) as (keyof typeof before)[])
        expect(before[key]).toBeCloseTo(after[key], 4);
    }
    expect(paddleTransform(0, 0.3)).toEqual(paddleTransform(0, null));
  });
});
