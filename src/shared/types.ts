// Shared integration contract. Internal renderer/physics units are 1000 x 650.
export type Side = 'L' | 'R' | 'M';
export type NeuronRole = 'sensory' | 'interneuron' | 'descending' | 'motor';
export type LesionMode = 'intact' | 'vision' | 'motor' | 'random';
export type GameMode = 'ready' | 'playing' | 'caught' | 'escaped';

export interface Neuron {
  id: string;
  type: string;
  side: Side;
  nt: string;
  role: NeuronRole;
  x: number;
  y: number;
  z: number;
}

export interface CircuitData {
  version: string;
  name: string;
  source: string;
  neurons: Neuron[];
  // [source index, target index, original synapse contacts, model transmitter sign]
  edges: [number, number, number, number][];
  manifest: {
    dataset: string;
    neuronCount: number;
    edgeCount: number;
    contactCount: number;
    description: string;
    assumptions: string[];
    sourceUrls: string[];
    [key: string]: unknown;
  };
}

export interface VisualInput {
  leftLoom: number;
  rightLoom: number;
  frontLoom: number;
  leftMotion: number;
  rightMotion: number;
}

export interface NeuralOutput {
  retreat: number; // 0..1 decoder output
  turn: number; // -1..1 clockwise-positive
  activity: Float32Array; // 0..1 recent activity per real neuron
  disabled: Uint8Array;
  spikeCount: number;
  meanHz: number;
  aliveNeurons: number;
}

export interface FlyPose {
  // x/y are the projected airborne body's centre: the player aims here, not at its shadow.
  x: number;
  y: number;
  heading: number;
  speed: number;
  // Optional for old replay frames; the flight simulation supplies every field.
  vx?: number;
  vy?: number;
  altitude?: number;
  bank?: number;
  pitch?: number;
  flightState?: 'cruising' | 'darting' | 'evading';
  escapeStrength?: number;
}
export interface Threat {
  x: number;
  y: number;
  active: boolean;
  swatting: number;
}
export interface SwatImpact {
  x: number;
  y: number;
  time: number; // Simulated seconds of the actual resolved collision, not a predicted hit.
  outcome: 'caught' | 'miss';
}
export interface GameSnapshot {
  mode: GameMode;
  time: number;
  elapsed: number;
  duration: number;
  fly: FlyPose;
  threat: Threat;
  // Keep resolved-shot feedback distinct from the player's current aim.
  impact?: SwatImpact;
  neural: NeuralOutput;
  lesion: LesionMode;
  swats: number;
  dodges: number;
  swatCooldown: number;
  simSpeed: number;
  seed: number;
}

export type WorkerCommand =
  | { type: 'init'; circuit: CircuitData; seed: number }
  | { type: 'start' }
  | { type: 'reset'; seed?: number }
  | { type: 'pointer'; x: number; y: number; active: boolean }
  | { type: 'swat' }
  | { type: 'lesion'; mode: LesionMode }
  | { type: 'pause'; paused: boolean }
  // The UI keeps only one wakeup in flight until its acknowledgement arrives.
  | { type: 'frame' };

export type WorkerEvent =
  | { type: 'ready' }
  | { type: 'snapshot'; snapshot: GameSnapshot }
  | { type: 'frame-done' }
  | { type: 'error'; message: string };

export const WORLD_WIDTH = 1000;
export const WORLD_HEIGHT = 650;
