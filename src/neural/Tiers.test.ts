import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CircuitData, VisualInput } from '../shared/types';
import { Brain } from './Brain';

interface Tier {
  id: string;
  path: string;
  neuronCount: number;
  edgeCount: number;
  contactCount: number;
  downloadBytes: number;
}
const catalog = JSON.parse(
  readFileSync(new URL('../../public/data/circuits.json', import.meta.url), 'utf8'),
) as { defaultId: string; tiers: Tier[] };
const graphs = catalog.tiers.map(
  (tier) =>
    JSON.parse(
      readFileSync(new URL(`../../public${tier.path}`, import.meta.url), 'utf8'),
    ) as CircuitData,
);
const quiet: VisualInput = {
  leftLoom: 0,
  rightLoom: 0,
  frontLoom: 0,
  leftMotion: 0,
  rightMotion: 0,
};
const looming = { ...quiet, leftLoom: 0.8, rightLoom: 0.8 };

describe('selectable real-connectome circuit tiers', () => {
  it('publishes exact file sizes, neuron counts, connections and synapse contacts', () => {
    expect(catalog.defaultId).toBe('standard');
    expect(catalog.tiers.map((t) => t.neuronCount)).toEqual([1088, 1788, 2888, 6000]);
    for (const [i, graph] of graphs.entries()) {
      const tier = catalog.tiers[i];
      expect(tier.downloadBytes).toBe(
        statSync(new URL(`../../public${tier.path}`, import.meta.url)).size,
      );
      expect(tier.neuronCount).toBe(graph.neurons.length);
      expect(tier.edgeCount).toBe(graph.edges.length);
      expect(tier.contactCount).toBe(graph.edges.reduce((sum, e) => sum + e[2], 0));
      expect(graph.manifest.neuronCount).toBe(tier.neuronCount);
      expect(graph.manifest.edgeCount).toBe(tier.edgeCount);
      expect(graph.manifest.contactCount).toBe(tier.contactCount);
      expect(graph.neurons.filter((n) => n.type === 'LC16')).toHaveLength(182);
      expect(
        graph.neurons
          .filter((n) => n.type === 'MDN')
          .map((n) => n.id)
          .sort(),
      ).toEqual(['10763', '11288', '11332', '12348']);
      expect(
        (graph.manifest.modelParameters as { synapseMvPerContact: number }).synapseMvPerContact,
      ).toBe(0.275);
    }
  });

  it('nests real identities and retains every original edge between selected cells', () => {
    for (let tier = 1; tier < graphs.length; tier++) {
      const small = graphs[tier - 1],
        large = graphs[tier];
      const largeIndices = new Map(large.neurons.map((n, i) => [n.id, i]));
      const translation = small.neurons.map((n) => largeIndices.get(n.id));
      expect(translation.every((i) => i !== undefined)).toBe(true);
      const selected = new Set(translation);
      const smallEdges = new Map(
        small.edges.map(([s, t, w, sign]) => [
          translation[s]! * large.neurons.length + translation[t]!,
          w * 3 + sign + 1,
        ]),
      );
      let matched = 0,
        mismatch = false;
      for (const [s, t, w, sign] of large.edges) {
        if (selected.has(s) && selected.has(t)) {
          matched++;
          if (smallEdges.get(s * large.neurons.length + t) !== w * 3 + sign + 1) mismatch = true;
        }
      }
      expect(mismatch).toBe(false);
      expect(matched).toBe(small.edges.length);
    }
  });

  it.each(catalog.tiers.map((t, i) => [t.id, i] as const))(
    '%s actually executes its selected neurons and responds through the graph',
    (_, i) => {
      const graph = graphs[i];
      const brain = new Brain(graph, 709);
      const initial = brain.step(100, quiet);
      expect(initial.activity).toHaveLength(graph.neurons.length);
      expect(initial.aliveNeurons).toBe(graph.neurons.length);
      expect(initial.meanHz).toBe(0);
      let peak = 0;
      for (let t = 0; t < 600; t += 10) {
        const output = brain.step(10, looming);
        peak = Math.max(peak, output.retreat);
        expect(Number.isFinite(output.meanHz)).toBe(true);
        expect([...output.activity].every((x) => Number.isFinite(x) && x >= 0 && x <= 1)).toBe(
          true,
        );
      }
      expect(peak).toBeGreaterThan(0.15);
      brain.step(1000, quiet);
      const decayed = brain.step(1000, quiet);
      expect(decayed.meanHz).toBeLessThan(0.05);
      expect(decayed.retreat).toBeLessThan(0.01);
      brain.setLesion('vision');
      expect(brain.step(600, looming).retreat).toBe(0);
      brain.setLesion('motor');
      expect(brain.step(600, looming).retreat).toBe(0);
    },
  );
});
