import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SplatEffect } from './SplatEffect';
import { CatchVisualState } from './CatchVisualState';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../shared/types';
import type { GameSnapshot } from '../shared/types';
import { palette } from '../theme/palette';

const meshes = (effect: SplatEffect) => {
  const result: THREE.Mesh[] = [];
  effect.group.traverse((object) => {
    if (object instanceof THREE.Mesh) result.push(object);
  });
  return result;
};

describe('screen-plane splat artwork', () => {
  it('starts hidden and restores visibility correctly across replay/reset', () => {
    const effect = new SplatEffect();
    expect(effect.group.visible).toBe(false);
    effect.update(0, 20, 30, 0.704);
    expect(effect.group.visible).toBe(true);
    effect.update(0.8, 20, 30, 0.704);
    expect(effect.group.visible).toBe(true);
    effect.update(null, -20, 10, 0.704);
    expect(effect.group.visible).toBe(false);
    effect.update(0, -20, 10, 0.704);
    expect(effect.group.visible).toBe(true);
  });

  it('stays camera-facing and anchored to the body regardless of fly facing/scale', () => {
    const effect = new SplatEffect(),
      scene = new THREE.Scene(),
      fly = new THREE.Group();
    scene.add(fly, effect.group);
    for (const facing of [0, Math.PI])
      for (const scale of [0.704, 1.1]) {
        fly.position.set(210, -180, 40);
        fly.rotation.set(0.3, facing, -0.5);
        effect.update(0.8, fly.position.x, fly.position.y, scale);
        scene.updateMatrixWorld(true);
        const position = effect.group.getWorldPosition(new THREE.Vector3());
        const normal = new THREE.Vector3(0, 0, 1).transformDirection(effect.group.matrixWorld);
        expect(position.x).toBe(fly.position.x);
        expect(position.y).toBe(fly.position.y);
        expect(normal.toArray()).toEqual([0, 0, 1]);
        expect(effect.group.scale.x).toBe(scale);
      }
  });

  it('gates a real offset catch without teleporting the splat to the strike centre', () => {
    const clock = new CatchVisualState(),
      effect = new SplatEffect();
    const snapshot = {
      mode: 'caught',
      time: 2,
      impact: { x: 535, y: 300, time: 2, outcome: 'caught' },
    } as Pick<GameSnapshot, 'mode' | 'time' | 'impact'>;
    clock.update(snapshot);
    const fly = { x: 500, y: 325 };
    effect.update(clock.advance(0.05), fly.x - WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - fly.y, 0.704);
    expect(effect.group.position.x).toBe(0);
    expect(effect.group.position.y).toBe(0);
    expect(snapshot.time).toBe(2);
    expect(snapshot.impact?.x).toBe(535);
    clock.update({ mode: 'playing', time: 1 });
    effect.update(clock.advance(0.05), 0, 0, 0.704);
    expect(effect.group.visible).toBe(false);
  });

  it('reuses deterministic geometry/materials and holds a stable settled imprint', () => {
    const effect = new SplatEffect(),
      other = new SplatEffect();
    const before = meshes(effect).map((mesh) => [mesh.geometry, mesh.material]);
    const artwork = (item: SplatEffect) => {
      item.group.updateMatrixWorld(true);
      return meshes(item).map((mesh) => [...mesh.matrixWorld.elements]);
    };
    effect.update(0.8, 0, 0, 0.704);
    const settled = artwork(effect);
    effect.update(99, 0, 0, 0.704);
    expect(artwork(effect)).toEqual(settled);
    other.update(0.8, 0, 0, 0.704);
    expect(artwork(other)).toEqual(settled);
    expect(meshes(effect).map((mesh) => [mesh.geometry, mesh.material])).toEqual(before);
    const bounds = new THREE.Box3().setFromObject(effect.group).getSize(new THREE.Vector3());
    expect(bounds.x).toBeGreaterThan(80);
    expect(bounds.y).toBeGreaterThan(60);
    expect(bounds.z).toBeLessThan(2); // A splat, not the old flattened 3D rig.
  });

  it('uses only shared brand colours, unaffected by scene tone mapping', () => {
    const colors = new Set<string>(Object.values(palette).map((color) => color.toLowerCase()));
    for (const mesh of meshes(new SplatEffect())) {
      const material = mesh.material as THREE.MeshBasicMaterial;
      expect(colors.has(`#${material.color.getHexString()}`)).toBe(true);
      expect(material.toneMapped).toBe(false);
      expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0);
    }
  });

  it('splays both wing tips outwards rather than converging above the blot', () => {
    const effect = new SplatEffect();
    effect.update(0.8, 0, 0, 1);
    effect.group.updateMatrixWorld(true);
    for (const side of ['left', 'right']) {
      const wing = effect.group.getObjectByName(`splat-wing-${side}`)!;
      const tip = wing.localToWorld(new THREE.Vector3(0, 1, 0));
      const centre = wing.getWorldPosition(new THREE.Vector3());
      expect(tip.y).toBeGreaterThan(centre.y);
      expect(Math.abs(tip.x)).toBeGreaterThan(Math.abs(centre.x) + 10);
    }
  });
});
