import type { CircuitData, LesionMode, NeuralOutput, VisualInput } from '../shared/types';

/** Point-neuron parameters are model assumptions, not measurements of MaleCNS cells. */
export const MODEL_PARAMETERS = {
  timestepMs: 1,
  membraneTauMs: 20,
  synapseTauMs: 5,
  refractoryMs: 2,
  delayMs: 2,
  restingMv: -52,
  thresholdMv: -45,
  synapseMvPerContact: 0.275,
  sensoryCurrentMv: 36,
  tonicCurrentMv: 0,
  activityTauMs: 60,
  decoderTauMs: 80,
  decoderHz: 40,
  turnHz: 35,
} as const;

const clamp = (x: number, lo = 0, hi = 1): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : 0));

/**
 * Real count-weighted sparse graph, with no sensory-to-motor bypass. External
 * drive enters LC16 only; the decoder reads only the four annotated MDNs.
 * Spikes schedule synaptic current after a fixed delay. Integration and random
 * state are independent of rendering cadence.
 */
export class Brain {
  // Once the sparse buffers are built, retain only cell metadata. Keeping the
  // source graph here would pin a second million-element nested edge array in
  // the worker (the UI also holds its own graph for the anatomical viewer).
  private readonly neurons: CircuitData['neurons'];
  private readonly n: number;
  private readonly voltage: Float32Array;
  private readonly current: Float32Array;
  private readonly refractory: Uint8Array;
  private readonly rates: Float32Array;
  private readonly outputRates: Float32Array;
  private readonly disabled: Uint8Array;
  private readonly activity: Float32Array;
  private readonly offsets: Uint32Array;
  private readonly targets: Uint32Array;
  private readonly weights: Float32Array;
  private readonly pending: Float32Array[];
  private readonly sensory: number[] = [];
  private readonly leftMdn: number[] = [];
  private readonly rightMdn: number[] = [];
  private readonly result: NeuralOutput;
  private readonly p: Record<keyof typeof MODEL_PARAMETERS, number>;
  private randomState = 1;
  private seed: number;
  private lesion: LesionMode = 'intact';
  private tick = 0;
  private remainderMs = 0;

  constructor(circuit: CircuitData, seed: number) {
    this.neurons = circuit.neurons;
    this.n = circuit.neurons.length;
    if (!this.n) throw new Error('The circuit contains no neurons.');
    this.seed = seed >>> 0;
    this.p = { ...MODEL_PARAMETERS };
    const overrides = circuit.manifest.modelParameters as Partial<typeof this.p> | undefined;
    for (const key of Object.keys(this.p) as (keyof typeof MODEL_PARAMETERS)[]) {
      const value = overrides?.[key];
      if (typeof value === 'number' && Number.isFinite(value)) this.p[key] = value;
    }
    // Halving the fixed step is supported for the offline numerical audit.
    this.p.timestepMs = this.p.timestepMs === 0.5 ? 0.5 : 1;
    this.p.delayMs = 2;
    this.p.refractoryMs = 2;
    this.voltage = new Float32Array(this.n);
    this.current = new Float32Array(this.n);
    this.refractory = new Uint8Array(this.n);
    this.rates = new Float32Array(this.n);
    this.outputRates = new Float32Array(this.n);
    this.disabled = new Uint8Array(this.n);
    this.activity = new Float32Array(this.n);
    this.pending = Array.from(
      { length: Math.round(this.p.delayMs / this.p.timestepMs) + 1 },
      () => new Float32Array(this.n),
    );
    this.offsets = new Uint32Array(this.n + 1);
    this.targets = new Uint32Array(circuit.edges.length);
    this.weights = new Float32Array(circuit.edges.length);
    for (const [source, target, contacts, sign] of circuit.edges) {
      if (
        !Number.isInteger(source) ||
        source < 0 ||
        source >= this.n ||
        !Number.isInteger(target) ||
        target < 0 ||
        target >= this.n ||
        !Number.isFinite(contacts) ||
        contacts <= 0 ||
        ![-1, 0, 1].includes(sign)
      ) {
        throw new Error('Invalid connectome edge.');
      }
      this.offsets[source + 1]++;
    }
    for (let i = 1; i <= this.n; i++) this.offsets[i] += this.offsets[i - 1];
    const cursor = this.offsets.slice();
    for (const [source, target, contacts, sign] of circuit.edges) {
      const index = cursor[source]++;
      this.targets[index] = target;
      this.weights[index] = contacts * sign * this.p.synapseMvPerContact;
    }
    circuit.neurons.forEach((neuron, i) => {
      if (neuron.type === 'LC16') this.sensory.push(i);
      if (neuron.type === 'MDN' && neuron.side === 'L') this.leftMdn.push(i);
      if (neuron.type === 'MDN' && neuron.side === 'R') this.rightMdn.push(i);
    });
    if (!this.sensory.length || !this.leftMdn.length || !this.rightMdn.length)
      throw new Error('The circuit must contain LC16 and bilateral MDN populations.');
    this.result = {
      retreat: 0,
      turn: 0,
      activity: this.activity,
      disabled: this.disabled,
      spikeCount: 0,
      meanHz: 0,
      aliveNeurons: this.n,
    };
    this.reset();
  }

  private random(): number {
    let x = this.randomState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.randomState = x >>> 0;
    return this.randomState / 4294967296;
  }

  reset(seed?: number): void {
    if (seed !== undefined) this.seed = seed >>> 0;
    this.randomState = this.seed || 0x1a2b3c4d;
    this.tick = 0;
    this.remainderMs = 0;
    this.current.fill(0);
    this.refractory.fill(0);
    this.rates.fill(0);
    this.outputRates.fill(0);
    this.activity.fill(0);
    this.pending.forEach((queue) => {
      queue.fill(0);
    });
    // Small seeded resting offsets break synchronous initial firing; no ongoing
    // threat-dependent noise, fabricated neurons, or autonomous escape drive.
    for (let i = 0; i < this.n; i++) this.voltage[i] = this.p.restingMv + this.random() * 1.5;
    this.applyLesion();
    this.result.retreat = this.result.turn = this.result.spikeCount = this.result.meanHz = 0;
  }

  setLesion(mode: LesionMode): void {
    this.lesion = mode;
    // Restart to avoid surviving queued spikes or decoder activity masquerading
    // as a response by a disabled population. The trial seed is retained.
    this.reset();
  }

  private applyLesion(): void {
    this.disabled.fill(0);
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      const neuron = this.neurons[i];
      const randomCut = this.random() < 0.3;
      const cut =
        (this.lesion === 'vision' && neuron.type === 'LC16') ||
        (this.lesion === 'motor' && neuron.type === 'MDN') ||
        (this.lesion === 'random' && randomCut);
      this.disabled[i] = Number(cut);
      if (cut) this.voltage[i] = this.p.restingMv;
      else alive++;
    }
    this.result.aliveNeurons = alive;
  }

  step(dtMs: number, input: VisualInput): NeuralOutput {
    if (!Number.isFinite(dtMs) || dtMs < 0 || dtMs > 1000)
      throw new Error('Brain step must be between 0 and 1000 ms.');
    this.remainderMs += dtMs;
    let count = 0;
    while (this.remainderMs >= this.p.timestepMs) {
      count += this.integrate(input);
      this.remainderMs -= this.p.timestepMs;
    }
    this.result.spikeCount = count;
    const mean = (indices: number[]) =>
      indices.reduce((sum, i) => sum + this.outputRates[i], 0) / indices.length;
    const left = mean(this.leftMdn);
    const right = mean(this.rightMdn);
    this.result.retreat = clamp((left + right) / (2 * this.p.decoderHz));
    // Unilateral MDN activation produces a backward turn away from that side.
    // Canvas positive heading is clockwise, hence left minus right.
    this.result.turn = clamp((left - right) / this.p.turnHz, -1, 1);
    return this.result;
  }

  private integrate(input: VisualInput): number {
    const p = this.p;
    const h = p.timestepMs;
    const queue = this.pending[this.tick % this.pending.length];
    const later = this.pending[(this.tick + Math.round(p.delayMs / h)) % this.pending.length];
    const synDecay = Math.exp(-h / p.synapseTauMs);
    const membraneUpdate = 1 - Math.exp(-h / p.membraneTauMs);
    const rateDecay = Math.exp(-h / p.activityTauMs);
    const outputDecay = Math.exp(-h / p.decoderTauMs);
    const sensoryDriveL = clamp(input.leftLoom);
    const sensoryDriveR = clamp(input.rightLoom);
    let spikes = 0;
    let totalHz = 0;
    for (let i = 0; i < this.n; i++) {
      const arriving = queue[i];
      queue[i] = 0;
      if (this.disabled[i]) continue;
      this.current[i] = this.current[i] * synDecay + arriving;
      this.rates[i] *= rateDecay;
      this.outputRates[i] *= outputDecay;
      let spiked = false;
      if (this.refractory[i] > 0) {
        this.refractory[i]--;
      } else {
        const neuron = this.neurons[i];
        const drive =
          neuron.type === 'LC16'
            ? (neuron.side === 'L' ? sensoryDriveL : sensoryDriveR) * p.sensoryCurrentMv
            : 0;
        const equilibrium = p.restingMv + this.current[i] + drive + p.tonicCurrentMv;
        this.voltage[i] += (equilibrium - this.voltage[i]) * membraneUpdate;
        if (this.voltage[i] >= p.thresholdMv) {
          spiked = true;
          this.voltage[i] = p.restingMv;
          this.refractory[i] = Math.round(p.refractoryMs / h);
        }
      }
      if (spiked) {
        spikes++;
        this.rates[i] += (1000 / h) * (1 - rateDecay);
        this.outputRates[i] += (1000 / h) * (1 - outputDecay);
        for (let edge = this.offsets[i]; edge < this.offsets[i + 1]; edge++) {
          const target = this.targets[edge];
          if (!this.disabled[target]) later[target] += this.weights[edge];
        }
      }
      this.activity[i] = clamp(this.rates[i] / 100);
      totalHz += this.rates[i];
    }
    this.result.meanHz = totalHz / Math.max(1, this.result.aliveNeurons);
    this.tick++;
    return spikes;
  }
}
