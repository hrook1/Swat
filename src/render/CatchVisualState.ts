import type { GameSnapshot } from '../shared/types';

export const CATCH_PRESENTATION_SECONDS = 0.8;
type CatchSnapshot = Pick<GameSnapshot, 'mode' | 'time' | 'impact'>;
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

/** Cosmetic inkblot only: visible immediately, one pop, then completely still. */
export function splatPose(age: number | null) {
  if (age === null) return { visible: false, scale: 1, spread: 0 };
  const t = Math.max(0, age);
  const scale = t < 0.07 ? 0.65 + 0.47 * smooth(t / 0.07) : 1.12 - 0.12 * smooth((t - 0.07) / 0.1);
  return { visible: true, scale, spread: smooth(t / 0.17) };
}

/**
 * A catch stops the simulation. A separate, bounded presentation clock lets
 * the confirmed hit settle without advancing physics, neurons or score.
 */
export class CatchVisualState {
  private key = '';
  private age: number | null = null;
  private previousTime = -Infinity;

  update(snapshot: CatchSnapshot): void {
    const impact = snapshot.impact;
    const confirmed =
      snapshot.mode === 'caught' && impact?.outcome === 'caught' && impact.time <= snapshot.time;
    if (!confirmed || snapshot.time < this.previousTime) {
      this.key = '';
      this.age = null;
    }
    this.previousTime = snapshot.time;
    if (!confirmed) return;
    const key = `${impact.time}:${impact.x}:${impact.y}`;
    if (key !== this.key) {
      this.key = key;
      this.age = 0;
    }
  }

  advance(dt: number, rate = 1, held = false, reducedMotion = false): number | null {
    if (this.age === null) return null;
    if (reducedMotion) this.age = CATCH_PRESENTATION_SECONDS;
    else if (!held)
      this.age = Math.min(
        CATCH_PRESENTATION_SECONDS,
        this.age + Math.min(0.05, Math.max(0, dt)) * Math.max(0, rate),
      );
    return this.age;
  }
}
