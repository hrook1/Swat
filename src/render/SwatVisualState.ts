import type { GameSnapshot, SwatImpact } from '../shared/types';

type SwatSnapshot = Pick<GameSnapshot, 'mode' | 'time' | 'threat' | 'impact'>;
export const IMPACT_ANIMATION_SECONDS = 0.3;
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

export interface PaddleTransform {
  offsetX: number;
  offsetY: number;
  depth: number;
  tiltX: number;
  tiltY: number;
  roll: number;
  scaleX: number;
  scaleY: number;
}

const REST: PaddleTransform = {
  offsetX: 48,
  offsetY: 56,
  depth: 280,
  tiltX: -0.55,
  tiltY: 0.15,
  roll: -0.24,
  scaleX: 1.04,
  scaleY: 1.04,
};
const COCKED: PaddleTransform = {
  offsetX: 66,
  offsetY: 90,
  depth: 420,
  tiltX: -1.05,
  tiltY: 0.32,
  roll: -0.43,
  scaleX: 1.2,
  scaleY: 1.2,
};
const CONTACT: PaddleTransform = {
  offsetX: 0,
  offsetY: 0,
  depth: 125,
  tiltX: 0,
  tiltY: 0,
  roll: -0.08,
  scaleX: 1,
  scaleY: 1,
};

function blendPose(from: PaddleTransform, to: PaddleTransform, amount: number): PaddleTransform {
  if (amount <= 0) return { ...from };
  if (amount >= 1) return { ...to };
  const result = { ...from };
  for (const key of Object.keys(result) as (keyof PaddleTransform)[])
    result[key] = mix(from[key], to[key], amount);
  return result;
}

/** The simulation supplies progress: rendering must never predict an impact. */
export function paddleTransform(progress: number, impactAge: number | null): PaddleTransform {
  if (impactAge !== null) {
    // A short compression reads as contact. Its centre never leaves the actual
    // hit point until recoil begins, whether the resolved result is hit or miss.
    if (impactAge <= 0.045) {
      const compression = Math.sin(clamp(impactAge / 0.045) * Math.PI);
      return { ...CONTACT, scaleX: 1 + compression * 0.055, scaleY: 1 - compression * 0.045 };
    }
    const recoil = { ...REST, offsetX: 56, offsetY: 73, tiltX: -0.75, scaleX: 1.12, scaleY: 1.12 };
    if (impactAge <= 0.145)
      return blendPose(CONTACT, recoil, 1 - (1 - clamp((impactAge - 0.045) / 0.1)) ** 3);
    return blendPose(recoil, REST, smooth((impactAge - 0.145) / 0.155));
  }
  if (progress <= 0) return { ...REST };
  const phase = clamp(progress);
  // ~72 ms to visibly lift the wrist, then an accelerating 168 ms slap. With
  // orthographic projection this offset/tilt/scale is essential: depth alone
  // would look stationary. At progress 1 the screen-space offset is exactly 0.
  return phase <= 0.3
    ? blendPose(REST, COCKED, smooth(phase / 0.3))
    : blendPose(COCKED, CONTACT, ((phase - 0.3) / 0.7) ** 2.4);
}

/** Separates an already resolved shot from the player's next aiming position. */
export class SwatVisualState {
  private impact: SwatImpact | null = null;
  private previousTime = -Infinity;

  update(snapshot: SwatSnapshot): void {
    if (snapshot.mode === 'ready' || snapshot.time < this.previousTime) this.impact = null;
    this.previousTime = snapshot.time;
    if (snapshot.mode !== 'ready' && snapshot.impact && snapshot.impact.time <= snapshot.time) {
      this.impact = { ...snapshot.impact };
    }
  }

  pose(snapshot: SwatSnapshot): {
    visible: boolean;
    x: number;
    y: number;
    progress: number;
    targetVisible: boolean;
    targetX: number;
    targetY: number;
    strikeVisible: boolean;
    impactAge: number | null;
    impactOutcome: SwatImpact['outcome'] | null;
    transform: PaddleTransform;
  } {
    const progress = clamp(snapshot.threat.swatting);
    const impact = this.impact;
    const age = impact ? snapshot.time - impact.time : Infinity;
    const resolving =
      impact !== null && age >= 0 && age < IMPACT_ANIMATION_SECONDS && progress === 0;
    const point = resolving ? impact : snapshot.threat;
    const impactAge = resolving ? age : null;
    return {
      visible: snapshot.mode !== 'ready' && (snapshot.threat.active || resolving),
      x: point.x,
      y: point.y,
      progress,
      targetVisible: snapshot.mode === 'playing' && snapshot.threat.active,
      targetX: snapshot.threat.x,
      targetY: snapshot.threat.y,
      strikeVisible: snapshot.mode !== 'ready' && (progress > 0 || resolving),
      impactAge,
      impactOutcome: resolving ? impact.outcome : null,
      transform: paddleTransform(progress, impactAge),
    };
  }
}
