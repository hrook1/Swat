import { describe, expect, it } from 'vitest';
import { recordingFrameTime } from './recordingCadence';

describe('30 fps recording cadence', () => {
  for (const refreshRate of [30, 60, 120, 144]) {
    it(`keeps about 30 composites/second on a ${refreshRate} Hz display`, () => {
      let previous: number | null = null;
      let frames = 0;
      for (let frame = 0; frame < refreshRate * 10; frame++) {
        const next = recordingFrameTime(previous, (frame * 1000) / refreshRate);
        if (next !== null) {
          frames++;
          previous = next;
        }
      }
      expect(frames).toBeGreaterThanOrEqual(299);
      expect(frames).toBeLessThanOrEqual(301);
    });
  }
  it('skips obsolete frames after a pause without duplicate catch-up draws', () => {
    const next = recordingFrameTime(0, 10_012)!;
    expect(next).toBeCloseTo(10_000, 6);
    expect(recordingFrameTime(next, 10_012)).toBeNull();
    expect(recordingFrameTime(next, 10_016)).toBeNull();
    expect(recordingFrameTime(next, 10_034)).not.toBeNull();
  });
});
