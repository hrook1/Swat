import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  configureAimCamera,
  flyDisplayScale,
  FLY_THORAX_CENTER,
  sideFlightOrientation,
} from './ArenaRenderer';
import { paddleTransform } from './SwatVisualState';

describe('side-on airborne aiming projection', () => {
  for (const [width, height] of [
    [900, 600],
    [350, 350],
    [1600, 620],
    [320, 640],
  ]) {
    it(`keeps decorative depth on its exact hit-test position at ${width}×${height}`, () => {
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
      configureAimCamera(camera, width, height);
      const raycaster = new THREE.Raycaster();
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      for (const x of [-450, 0, 450])
        for (const y of [-275, 0, 275]) {
          const aim = new THREE.Vector3(x, y, 0).project(camera);
          for (const depth of [-200, 0, 120, 380]) {
            const visible = new THREE.Vector3(x, y, depth).project(camera);
            expect(visible.x).toBeCloseTo(aim.x, 10);
            expect(visible.y).toBeCloseTo(aim.y, 10);
            expect(Math.abs(visible.x)).toBeLessThan(1);
            expect(Math.abs(visible.y)).toBeLessThan(1);
            raycaster.setFromCamera(new THREE.Vector2(visible.x, visible.y), camera);
            const result = raycaster.ray.intersectPlane(plane, new THREE.Vector3())!;
            expect(result.x).toBeCloseTo(x, 7);
            expect(result.y).toBeCloseTo(y, 7);
            expect(result.z).toBeCloseTo(0, 7);
          }
        }
    });
  }

  it('keeps the actual thorax centre on the physics point during flips, pitch and bank', () => {
    for (const facing of [1, -1] as const)
      for (const pitch of [-0.55, 0, 0.55])
        for (const bank of [-0.23, 0.23]) {
          const fly = new THREE.Group();
          fly.position.set(210, -180, 40);
          fly.rotation.y = facing === -1 ? Math.PI : 0;
          fly.scale.setScalar(1.35);
          const pivot = new THREE.Group();
          pivot.rotation.set(bank, 0, pitch);
          const anatomy = new THREE.Group();
          anatomy.position.copy(FLY_THORAX_CENTER).multiplyScalar(-1);
          pivot.add(anatomy);
          fly.add(pivot);
          fly.updateMatrixWorld(true);
          const thorax = FLY_THORAX_CENTER.clone().applyMatrix4(anatomy.matrixWorld);
          expect(thorax.distanceTo(fly.position)).toBeLessThan(1e-10);
          const up = new THREE.Vector3(0, 1, 0).transformDirection(pivot.matrixWorld);
          expect(up.y).toBeGreaterThan(0.8);
        }
  });

  it('faces movement horizontally but remains upright during vertical flight', () => {
    expect(sideFlightOrientation({ heading: 0, speed: 300, vx: -250, vy: -250 }, 1)).toMatchObject({
      facing: -1,
      pitch: 0.55,
    });
    expect(sideFlightOrientation({ heading: 0, speed: 300, vx: 250, vy: 250 }, -1)).toMatchObject({
      facing: 1,
      pitch: -0.55,
    });
    expect(
      sideFlightOrientation({ heading: Math.PI / 2, speed: 400, vx: 5, vy: 400 }, -1).facing,
    ).toBe(-1);
  });

  it('reduces fly size by 12% at every viewport without changing the thorax aim centre', () => {
    for (const width of [320, 390, 560, 900, 1600]) {
      const previousScale = 0.8 + 0.55 * THREE.MathUtils.clamp((560 - width) / 210, 0, 1);
      expect(flyDisplayScale(width) / previousScale).toBeCloseTo(0.88);
    }
  });

  it('projects the flattened paddle centre onto the real strike point at all aspect ratios', () => {
    const contact = paddleTransform(0, 0);
    for (const [width, height] of [
      [900, 600],
      [350, 350],
      [1600, 620],
      [320, 640],
    ]) {
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
      configureAimCamera(camera, width, height);
      const click = new THREE.Vector3(310, -175, 0).project(camera);
      const paddle = new THREE.Vector3(
        310 + contact.offsetX,
        -175 + contact.offsetY,
        contact.depth,
      ).project(camera);
      expect(paddle.x).toBeCloseTo(click.x, 10);
      expect(paddle.y).toBeCloseTo(click.y, 10);
    }
  });
});
