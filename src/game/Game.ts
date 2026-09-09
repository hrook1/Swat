import { Brain } from '../neural/Brain';
import {
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type CircuitData,
  type FlyPose,
  type GameMode,
  type GameSnapshot,
  type LesionMode,
  type NeuralOutput,
  type SwatImpact,
  type VisualInput,
} from '../shared/types';

export const ROUND_SECONDS = 30;
export const NEURAL_STEP_MS = 1;
export const SWAT_WINDUP_MS = 240;
export const SWAT_COOLDOWN_MS = 560;
export const CATCH_RADIUS = 57;
export const FLIGHT_MARGIN = 72;
export const IMPACT_DISPLAY_MS = 280;
const NEUTRAL_VISION: VisualInput = {
  leftLoom: 0,
  rightLoom: 0,
  frontLoom: 0,
  leftMotion: 0,
  rightMotion: 0,
};

export interface NeuralEngine {
  reset(seed?: number): void;
  setLesion(mode: LesionMode): void;
  step(dtMs: number, input: VisualInput): NeuralOutput;
}

type PendingSwat = { x: number; y: number; startedAt: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const wrapAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Fixed-step body and game rules. World dimensions are presentation units;
 * Flight speed, saccades, height and swat timing are arcade design, not measured
 * fly biology. The MDN retreat decoder modulates an engineered flight controller;
 * this is NOT a validated biological flight motor circuit. Threat information
 * reaches that controller only through the injected neural engine.
 */
export class Game {
  private readonly brain: NeuralEngine;
  private seed: number;
  private randomState = 0;
  private nextRoundIndex = 0;
  private mode: GameMode = 'ready';
  private lesion: LesionMode = 'intact';
  private paused = false;
  private timeMs = 0;
  private elapsedMs = 0;
  private remainderMs = 0;
  private fly: FlyPose = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, heading: 0, speed: 0 };
  private pointer = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, active: false };
  private pendingSwat: PendingSwat | null = null;
  private lastImpact: SwatImpact | null = null;
  private cooldownUntil = 0;
  private swats = 0;
  private dodges = 0;
  private courseHeading = 0;
  private cruiseSpeed = 380;
  private nextSaccadeAt = 0;
  private dartUntil = 0;
  private altitudePhase = 0;
  private angularVelocity = 0;
  private previousVisual: { diameter: number; bearing: number } | null = null;
  private output: NeuralOutput;

  constructor(circuit: CircuitData, seed: number, brain?: NeuralEngine) {
    this.seed = seed >>> 0;
    this.brain = brain ?? new Brain(circuit, this.seed);
    this.output = {
      retreat: 0,
      turn: 0,
      activity: new Float32Array(circuit.neurons.length),
      disabled: new Uint8Array(circuit.neurons.length),
      spikeCount: 0,
      meanHz: 0,
      aliveNeurons: circuit.neurons.length,
    };
    this.reset(this.seed);
  }

  /** Reset restores the intact circuit; start preserves the selected trial mode. */
  reset(seed = this.seed): void {
    this.seed = seed >>> 0;
    this.randomState = this.seed || 0x6d2b79f5;
    this.nextRoundIndex = 0;
    this.mode = 'ready';
    this.lesion = 'intact';
    this.timeMs = 0;
    this.elapsedMs = 0;
    this.remainderMs = 0;
    this.swats = 0;
    this.dodges = 0;
    this.pendingSwat = null;
    this.lastImpact = null;
    this.cooldownUntil = 0;
    this.previousVisual = null;
    this.pointer.active = false;
    this.courseHeading = 0;
    this.cruiseSpeed = 380;
    this.nextSaccadeAt = 0;
    this.dartUntil = 0;
    this.altitudePhase = this.random() * Math.PI * 2;
    this.angularVelocity = 0;
    this.fly = {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
      heading: this.random() * Math.PI * 2,
      speed: 0,
      vx: 0,
      vy: 0,
      altitude: 78,
      bank: 0,
      pitch: 0,
      flightState: 'cruising',
      escapeStrength: 0,
    };
    this.brain.reset(this.seed);
    this.brain.setLesion('intact');
    // A zero-duration read publishes the reset state without advancing neurons.
    this.output = this.brain.step(0, NEUTRAL_VISION);
  }

  start(): void {
    const pointer = { ...this.pointer };
    const lesion = this.lesion;
    const roundIndex = this.nextRoundIndex;
    this.reset();
    this.nextRoundIndex = roundIndex + 1;
    // New round, new route; reset(seed) still reproduces the first experiment.
    this.randomState = (this.randomState ^ Math.imul(roundIndex, 0x9e3779b9)) >>> 0 || 0x6d2b79f5;
    this.setLesion(lesion);
    this.pointer = pointer;
    this.mode = 'playing';
    // An already-airborne seeded entry, well away from the start button/centre.
    // This is not invulnerability: a correctly led shot can catch it immediately.
    const edge = Math.floor(this.random() * 4);
    this.fly.x = edge === 0 ? 150 : edge === 1 ? WORLD_WIDTH - 150 : 220 + this.random() * 560;
    this.fly.y = edge === 2 ? 125 : edge === 3 ? WORLD_HEIGHT - 125 : 140 + this.random() * 370;
    this.courseHeading =
      Math.atan2(WORLD_HEIGHT / 2 - this.fly.y, WORLD_WIDTH / 2 - this.fly.x) +
      (this.random() - 0.5) * 0.65;
    this.fly.heading = this.courseHeading;
    this.cruiseSpeed = 345 + this.random() * 90;
    this.fly.speed = this.cruiseSpeed;
    this.fly.vx = Math.cos(this.fly.heading) * this.fly.speed;
    this.fly.vy = Math.sin(this.fly.heading) * this.fly.speed;
    this.nextSaccadeAt = this.timeMs + 420 + this.random() * 220;
  }

  setPointer(x: number, y: number, active: boolean): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.pointer = { x: clamp(x, 0, WORLD_WIDTH), y: clamp(y, 0, WORLD_HEIGHT), active };
  }

  setLesion(mode: LesionMode): void {
    if (!['intact', 'vision', 'motor', 'random'].includes(mode)) return;
    this.lesion = mode;
    this.brain.setLesion(mode);
    this.output = this.brain.step(0, NEUTRAL_VISION);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    // Do not retain a fraction of a pre-pause input interval.
    this.remainderMs = 0;
  }

  swat(): boolean {
    if (
      this.paused ||
      this.mode !== 'playing' ||
      !this.pointer.active ||
      this.pendingSwat ||
      this.timeMs < this.cooldownUntil
    )
      return false;
    this.pendingSwat = { x: this.pointer.x, y: this.pointer.y, startedAt: this.timeMs };
    this.cooldownUntil = this.timeMs + SWAT_COOLDOWN_MS;
    this.swats += 1;
    return true;
  }

  isRunning(): boolean {
    // Waiting for Start is not a neural experiment. In particular, do not run
    // thousands of quiet neurons at 1 kHz just to animate decorative idle wings.
    // The worker can still publish the existing ready snapshot at its UI cadence.
    return !this.paused && this.mode === 'playing';
  }

  /** Returns actual simulated milliseconds, never a frame-dependent neural dt. */
  advance(deltaMs: number): number {
    if (!this.isRunning() || !Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
    // Protect callers from an accidental multi-second blocking catch-up.
    this.remainderMs += Math.min(deltaMs, 250);
    let advanced = 0;
    while (this.remainderMs + 1e-9 >= NEURAL_STEP_MS) {
      this.remainderMs = Math.max(0, this.remainderMs - NEURAL_STEP_MS);
      this.tick();
      advanced += NEURAL_STEP_MS;
      if (!this.isRunning()) {
        this.remainderMs = 0;
        break;
      }
    }
    return advanced;
  }

  snapshot(simSpeed = 1): GameSnapshot {
    const swat = this.pendingSwat;
    const impact =
      this.lastImpact && this.timeMs - this.lastImpact.time * 1000 <= IMPACT_DISPLAY_MS
        ? this.lastImpact
        : null;
    return {
      mode: this.mode,
      time: this.timeMs / 1000,
      elapsed: this.elapsedMs / 1000,
      duration: ROUND_SECONDS,
      fly: { ...this.fly },
      threat: {
        x: swat?.x ?? this.pointer.x,
        y: swat?.y ?? this.pointer.y,
        active: Boolean(swat) || this.pointer.active,
        swatting: swat
          ? Math.max(0.001, clamp((this.timeMs - swat.startedAt) / SWAT_WINDUP_MS, 0, 1))
          : 0,
      },
      impact: impact ? { ...impact } : undefined,
      // Owned copies: publishing/transferring a snapshot cannot detach Brain's state.
      neural: {
        ...this.output,
        activity: this.output.activity.slice(),
        disabled: this.output.disabled.slice(),
      },
      lesion: this.lesion,
      swats: this.swats,
      dodges: this.dodges,
      swatCooldown: Math.max(0, this.cooldownUntil - this.timeMs) / 1000,
      simSpeed: Number.isFinite(simSpeed) ? Math.max(0, simSpeed) : 1,
      seed: this.seed,
    };
  }

  private tick(): void {
    const dt = NEURAL_STEP_MS / 1000;
    const visual = this.mode === 'playing' ? this.visualInput(dt) : NEUTRAL_VISION;
    this.output = this.brain.step(NEURAL_STEP_MS, visual);
    if (this.mode === 'playing') this.moveBody(dt);
    this.timeMs += NEURAL_STEP_MS;
    if (this.mode !== 'playing') return;
    this.elapsedMs += NEURAL_STEP_MS;

    if (this.pendingSwat && this.timeMs - this.pendingSwat.startedAt >= SWAT_WINDUP_MS) {
      const strike = this.pendingSwat;
      const distance = Math.hypot(this.fly.x - strike.x, this.fly.y - strike.y);
      this.pendingSwat = null;
      this.lastImpact = {
        x: strike.x,
        y: strike.y,
        time: this.timeMs / 1000,
        outcome: distance <= CATCH_RADIUS ? 'caught' : 'miss',
      };
      if (distance <= CATCH_RADIUS) {
        this.mode = 'caught';
        this.fly.speed = 0;
        this.fly.vx = this.fly.vy = 0;
        this.cooldownUntil = this.timeMs;
      } else {
        this.dodges += 1;
      }
    }
    if (this.mode === 'playing' && this.elapsedMs >= ROUND_SECONDS * 1000) {
      this.mode = 'escaped';
      this.pendingSwat = null;
      this.cooldownUntil = this.timeMs;
      this.fly.speed = 0;
      this.fly.vx = this.fly.vy = 0;
    }
  }

  private visualInput(dt: number): VisualInput {
    const swat = this.pendingSwat;
    if (!this.pointer.active && !swat) {
      this.previousVisual = null;
      return NEUTRAL_VISION;
    }
    const threat = swat ?? this.pointer;
    const swatProgress = swat ? clamp((this.timeMs - swat.startedAt) / SWAT_WINDUP_MS, 0, 1) : 0;
    const dx = threat.x - this.fly.x;
    const dy = threat.y - this.fly.y;
    const distance = Math.max(4, Math.hypot(dx, dy));
    // Engineered early-vision approximation: the approaching swatter subtends
    // a growing angle. These features are retinal cues, not a desired escape.
    const apparentRadius = 24 + 82 * swatProgress;
    const diameter = 2 * Math.atan2(apparentRadius, distance);
    const bearing = wrapAngle(Math.atan2(dy, dx) - this.fly.heading);
    const previous = this.previousVisual;
    const expansion = previous ? Math.max(0, (diameter - previous.diameter) / dt) : 0;
    const angularMotion = previous ? wrapAngle(bearing - previous.bearing) / dt : 0;
    this.previousVisual = { diameter, bearing };
    const salience = clamp(diameter / 1.25, 0, 1);
    const loom = clamp(0.25 * salience + 0.75 * clamp(expansion / 4, 0, 1), 0, 1);
    const leftWeight = 0.5 - 0.5 * Math.sin(bearing);
    const rightWeight = 1 - leftWeight;
    return {
      leftLoom: loom * (0.2 + 0.8 * leftWeight),
      rightLoom: loom * (0.2 + 0.8 * rightWeight),
      frontLoom: loom * Math.max(0, Math.cos(bearing)),
      leftMotion: salience * clamp(-angularMotion / 8, 0, 1),
      rightMotion: salience * clamp(angularMotion / 8, 0, 1),
    };
  }

  private moveBody(dt: number): void {
    const retreat = Number.isFinite(this.output.retreat) ? clamp(this.output.retreat, 0, 1) : 0;
    const turn = Number.isFinite(this.output.turn) ? clamp(this.output.turn, -1, 1) : 0;
    if (this.timeMs >= this.nextSaccadeAt) {
      // A mix of sharp saccades, readable straight coasts and short darts. The
      // random stream never reads cursor position or whether a swat is pending.
      const direction = this.random() < 0.5 ? -1 : 1;
      this.courseHeading = wrapAngle(this.fly.heading + direction * (0.48 + this.random() * 1.4));
      const coast = this.random() < 0.24;
      this.cruiseSpeed = coast ? 205 + this.random() * 70 : 330 + this.random() * 125;
      this.dartUntil = coast ? 0 : this.timeMs + 110 + this.random() * 130;
      this.nextSaccadeAt = this.timeMs + 420 + this.random() * 480;
    }

    // Smooth wall avoidance is stage physics, not a hidden cursor escape rule.
    // Reflection below is a final safety net; most approaches bank before contact.
    let targetHeading = this.courseHeading;
    const edgeDistance = Math.min(
      this.fly.x - FLIGHT_MARGIN,
      WORLD_WIDTH - FLIGHT_MARGIN - this.fly.x,
      this.fly.y - FLIGHT_MARGIN,
      WORLD_HEIGHT - FLIGHT_MARGIN - this.fly.y,
    );
    if (edgeDistance < 110) {
      const inward = Math.atan2(WORLD_HEIGHT / 2 - this.fly.y, WORLD_WIDTH / 2 - this.fly.x);
      const blend = clamp((110 - edgeDistance) / 85, 0, 1);
      targetHeading = wrapAngle(targetHeading + wrapAngle(inward - targetHeading) * blend);
    }
    const courseTurn = clamp(wrapAngle(targetHeading - this.fly.heading) * 7.5, -8.5, 8.5);
    const desiredTurn = courseTurn + turn * 6.2;
    this.angularVelocity += (desiredTurn - this.angularVelocity) * (1 - Math.exp(-dt / 0.055));
    this.fly.heading = wrapAngle(this.fly.heading + this.angularVelocity * dt);

    // Real circuit output is translated to an arcade burst and bank, not copied
    // as anatomical MDN flight control. Cutting its input/output removes this.
    const dart = this.timeMs < this.dartUntil;
    const targetSpeed = clamp(this.cruiseSpeed + (dart ? 75 : 0) + retreat * 340, 190, 690);
    this.fly.speed += (targetSpeed - this.fly.speed) * (1 - Math.exp(-dt / 0.075));
    this.fly.vx = Math.cos(this.fly.heading) * this.fly.speed;
    this.fly.vy = Math.sin(this.fly.heading) * this.fly.speed;
    this.fly.x += this.fly.vx * dt;
    this.fly.y += this.fly.vy * dt;
    let reflected = false;
    if (this.fly.x < FLIGHT_MARGIN || this.fly.x > WORLD_WIDTH - FLIGHT_MARGIN) {
      this.fly.x = clamp(this.fly.x, FLIGHT_MARGIN, WORLD_WIDTH - FLIGHT_MARGIN);
      this.fly.heading = wrapAngle(Math.PI - this.fly.heading);
      reflected = true;
    }
    if (this.fly.y < FLIGHT_MARGIN || this.fly.y > WORLD_HEIGHT - FLIGHT_MARGIN) {
      this.fly.y = clamp(this.fly.y, FLIGHT_MARGIN, WORLD_HEIGHT - FLIGHT_MARGIN);
      this.fly.heading = wrapAngle(-this.fly.heading);
      reflected = true;
    }
    if (reflected) {
      this.courseHeading = this.fly.heading;
      this.angularVelocity = 0;
      this.nextSaccadeAt = this.timeMs + 220;
      this.fly.vx = Math.cos(this.fly.heading) * this.fly.speed;
      this.fly.vy = Math.sin(this.fly.heading) * this.fly.speed;
    }
    this.fly.altitude =
      80 +
      Math.sin(this.timeMs / 470 + this.altitudePhase) * 14 +
      Math.sin(this.timeMs / 190 + this.altitudePhase) * 5 +
      retreat * 25;
    this.fly.bank = clamp(-this.angularVelocity * 0.075, -0.65, 0.65);
    this.fly.pitch = clamp((targetSpeed - this.fly.speed) / 350, -0.25, 0.25);
    this.fly.escapeStrength = retreat;
    this.fly.flightState = retreat > 0.06 ? 'evading' : dart ? 'darting' : 'cruising';
  }

  private random(): number {
    let state = this.randomState;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.randomState = state >>> 0;
    return this.randomState / 0x100000000;
  }
}
