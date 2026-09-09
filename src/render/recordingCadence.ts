const FRAME_INTERVAL = 1000 / 30;

/** One composite at most per display tick; keep phase without catch-up draws. */
export function recordingFrameTime(previous: number | null, now: number): number | null {
  if (previous === null) return now;
  const elapsed = now - previous;
  // rAF timestamps have fractional rounding around exact 30/60 Hz boundaries.
  if (elapsed + 0.1 < FRAME_INTERVAL) return null;
  return previous + Math.max(1, Math.floor((elapsed + 0.1) / FRAME_INTERVAL)) * FRAME_INTERVAL;
}
