import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyPalette, neuralColors, palette } from './palette';

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const first = luminance(a),
    second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe('one consistent, readable game palette', () => {
  it('provides all stylesheet tokens from the shared palette or local semantic overrides', () => {
    const values = new Map<string, string>();
    applyPalette({
      setProperty: (key, value) => {
        values.set(key, value ?? '');
      },
    });
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    const local = new Set(['--population-color']);
    for (const match of css.matchAll(/var\((--[\w-]+)/g))
      expect(values.has(match[1]) || local.has(match[1]), match[1]).toBe(true);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(values.size).toBe(Object.keys(palette).length);
    expect(values.get('--on-brain-muted')).toBe(palette.onBrainMuted);
  });

  it('uses identical base hues for neuronal roles, art, legend and favicon', () => {
    expect(neuralColors).toEqual({
      vision: palette.coral,
      network: palette.lilac,
      escape: palette.lime,
    });
    for (const path of ['../App.tsx', '../render/BrainRenderer.ts']) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      for (const role of ['vision', 'network', 'escape'])
        expect(source).toContain(`neuralColors.${role}`);
      expect(source).not.toMatch(/#[0-9a-f]{6}\b|0x[0-9a-f]{6}\b/i);
    }
    const favicon = readFileSync(new URL('../../public/favicon.svg', import.meta.url), 'utf8');
    const brandColors = new Set<string>([palette.ink, palette.lime, palette.lilac, palette.coral]);
    for (const match of favicon.matchAll(/(?:fill|stroke)="(#[0-9A-F]+)"/g))
      expect(brandColors.has(match[1])).toBe(true);
  });

  for (const [label, foreground, background] of [
    ['body', palette.ink, palette.paper],
    ['small labels / dialog body', palette.muted, palette.paper],
    ['details / keyboard wash', palette.ink, palette.wash],
    ['text hover', palette.textHover, palette.paper],
    ['primary action', palette.ink, palette.lime],
    ['primary hover', palette.ink, palette.limeHover],
    ['utility action', palette.paper, palette.ink],
    ['utility hover', palette.paper, palette.forestHover],
    ['brain heading', palette.onBrain, palette.brain],
    ['brain metadata', palette.onBrainMuted, palette.brain],
    ['neuron tag', palette.onBrainMuted, palette.brainRaised],
    ['recording / warning', palette.coralInk, palette.coralWash],
    ['low time', palette.coralInk, palette.paper],
    ...Object.entries(neuralColors).map(([role, color]) => [
      `${role} legend`,
      color,
      palette.brain,
    ]),
  ]) {
    it(`${label} keeps at least 4.5:1 text contrast`, () => {
      expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('keeps opaque aiming/contact/focus markers readable across the whole flight backdrop', () => {
    for (const background of [
      palette.scene,
      palette.sky,
      palette.skyLow,
      palette.stageFrame,
      palette.floor,
    ]) {
      for (const marker of [palette.coralInk, palette.success, palette.focus])
        expect(contrast(marker, background)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(palette.lilac, palette.brain)).toBeGreaterThanOrEqual(3);
  });
});
