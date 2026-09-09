import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CircuitData, LesionMode, VisualInput } from '../shared/types';
import { Brain, MODEL_PARAMETERS } from './Brain';

const circuit: CircuitData = JSON.parse(
  readFileSync(new URL('../../public/data/circuit.json', import.meta.url), 'utf8'),
);
const quiet: VisualInput = {
  leftLoom: 0,
  rightLoom: 0,
  frontLoom: 0,
  leftMotion: 0,
  rightMotion: 0,
};
const bilateral: VisualInput = { ...quiet, leftLoom: 0.8, rightLoom: 0.8, frontLoom: 0.8 };
const left: VisualInput = { ...quiet, leftLoom: 0.8, rightLoom: 0.05, frontLoom: 0.4 };
const right: VisualInput = { ...quiet, leftLoom: 0.05, rightLoom: 0.8, frontLoom: 0.4 };

function probe(input: VisualInput, lesion: LesionMode = 'intact', graph = circuit) {
  const brain = new Brain(graph, 709);
  brain.setLesion(lesion);
  brain.step(200, quiet);
  let retreat = 0,
    turn = 0,
    spikes = 0,
    maxRetreat = 0;
  for (let t = 0; t < 600; t++) {
    const output = brain.step(1, input);
    if (t >= 200) {
      retreat += output.retreat / 400;
      turn += output.turn / 400;
    }
    spikes += output.spikeCount;
    maxRetreat = Math.max(maxRetreat, output.retreat);
  }
  const output = brain.step(0, quiet);
  const mdn = graph.neurons.flatMap((n, i) =>
    n.type === 'MDN' ? [{ id: n.id, side: n.side, activity: output.activity[i] }] : [],
  );
  return { retreat, turn, spikes, maxRetreat, mdn };
}

describe('real MaleCNS retreat circuit', () => {
  it('keeps four verified MDNs and real contact counts with consistent manifest', () => {
    expect(
      circuit.neurons
        .filter((n) => n.type === 'MDN')
        .map((n) => n.id)
        .sort(),
    ).toEqual(['10763', '11288', '11332', '12348']);
    expect(circuit.neurons.filter((n) => n.type === 'LC16')).toHaveLength(182);
    expect(circuit.manifest.neuronCount).toBe(circuit.neurons.length);
    expect(circuit.manifest.edgeCount).toBe(circuit.edges.length);
    expect(circuit.manifest.contactCount).toBe(circuit.edges.reduce((sum, e) => sum + e[2], 0));
    expect(circuit.edges.every((e) => Number.isInteger(e[2]) && e[2] > 0)).toBe(true);
  });

  it('reports calibration under intact, asymmetric and silenced inputs', () => {
    const measurements = {
      quiet: probe(quiet),
      bilateral: probe(bilateral),
      left: probe(left),
      right: probe(right),
      vision: probe(bilateral, 'vision'),
      motor: probe(bilateral, 'motor'),
    };
    console.info('NEURAL_CALIBRATION', JSON.stringify(measurements));
    expect(measurements.quiet.retreat).toBe(0);
    expect(measurements.bilateral.retreat).toBeGreaterThan(0.15);
    expect(measurements.vision.retreat).toBe(0);
    expect(measurements.motor.retreat).toBe(0);
    expect(Math.abs(measurements.left.turn - measurements.right.turn)).toBeGreaterThan(0.1);
  });

  it('cannot retreat when every anatomical edge is removed', () => {
    const disconnected = { ...circuit, edges: [] };
    const response = probe(bilateral, 'intact', disconnected);
    expect(response.spikes).toBeGreaterThan(0);
    expect(response.retreat).toBe(0);
    expect(response.turn).toBe(0);
  });

  it('owns sparse weights without pinning the large source graph after initialization', () => {
    const source = { ...circuit, edges: circuit.edges.slice() };
    const brain = new Brain(source, 709);
    expect(Object.values(brain)).not.toContain(source);
    expect(Object.values(brain)).not.toContain(source.edges);
    // Dropping the import array must not remove already compiled connections.
    source.edges = [];
    expect(brain.step(600, bilateral).retreat).toBeGreaterThan(0.15);
  });

  it('matches the isolated LIF constant-current firing interval', () => {
    const brain = new Brain({ ...circuit, edges: [] }, 709);
    brain.step(1000, quiet);
    const current = MODEL_PARAMETERS.sensoryCurrentMv * bilateral.leftLoom;
    const thresholdDelta = MODEL_PARAMETERS.thresholdMv - MODEL_PARAMETERS.restingMv;
    const thresholdTime =
      MODEL_PARAMETERS.membraneTauMs * Math.log(current / (current - thresholdDelta));
    const periodTicks = Math.ceil(thresholdTime) + MODEL_PARAMETERS.refractoryMs;
    const perNeuronSpikes = 1 + Math.floor((1000 - Math.ceil(thresholdTime)) / periodTicks);
    expect(brain.step(1000, bilateral).spikeCount).toBe(perNeuronSpikes * 182);
  });

  it('replays identically across public step batching and resets', () => {
    const a = new Brain(circuit, 81);
    const b = new Brain(circuit, 81);
    for (let t = 0; t < 200; t++) a.step(1, bilateral);
    b.step(200, bilateral);
    expect([...a.step(0, quiet).activity]).toEqual([...b.step(0, quiet).activity]);
    const first = [...a.step(0, quiet).activity];
    a.setLesion('random');
    a.setLesion('intact');
    a.step(200, bilateral);
    expect([...a.step(0, quiet).activity]).toEqual(first);
  });

  it('clears all queued/filtered output immediately on MDN silencing', () => {
    const brain = new Brain(circuit, 81);
    brain.step(400, bilateral);
    brain.setLesion('motor');
    const output = brain.step(1, bilateral);
    expect(output.retreat).toBe(0);
    expect(output.turn).toBe(0);
    for (let i = 0; i < circuit.neurons.length; i++) {
      if (circuit.neurons[i].type === 'MDN') {
        expect(output.disabled[i]).toBe(1);
        expect(output.activity[i]).toBe(0);
      }
    }
  });

  it('retains the retreat response when the numerical step is halved', () => {
    const halfStep = {
      ...circuit,
      manifest: {
        ...circuit.manifest,
        modelParameters: { ...(circuit.manifest.modelParameters as object), timestepMs: 0.5 },
      },
    };
    const a = probe(bilateral);
    const b = probe(bilateral, 'intact', halfStep);
    console.info('TIMESTEP_AUDIT', JSON.stringify({ oneMs: a, halfMs: b }));
    expect(b.retreat).toBeGreaterThan(0.15);
    expect(Math.abs(a.retreat - b.retreat)).toBeLessThan(0.25);
  });

  it('lets stimulus-induced activity decay after the threat is removed', () => {
    const brain = new Brain(circuit, 709);
    brain.step(600, bilateral);
    expect(brain.step(0, quiet).retreat).toBeGreaterThan(0.15);
    brain.step(1000, quiet);
    const after = brain.step(0, quiet);
    expect(after.retreat).toBeLessThan(0.01);
    expect(after.meanHz).toBeLessThan(0.05);
  });
});
