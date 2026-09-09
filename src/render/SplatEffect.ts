import * as THREE from 'three';
import { palette } from '../theme/palette';
import { splatPose } from './CatchVisualState';

// Alternating round lobes and deep, uneven notches: deliberately not a burst
// of pointed triangles. This is a cosmetic decal, never a collision shape.
const BLOT_OUTLINE = [
  [53, 9],
  [25, 14],
  [33, 36],
  [11, 24],
  [-2, 41],
  [-11, 20],
  [-40, 31],
  [-27, 8],
  [-57, -4],
  [-28, -13],
  [-36, -34],
  [-11, -23],
  [5, -42],
  [13, -21],
  [44, -31],
  [31, -9],
] as const;

function blotShape(): THREE.Shape {
  const shape = new THREE.Shape();
  const last = BLOT_OUTLINE[BLOT_OUTLINE.length - 1],
    first = BLOT_OUTLINE[0];
  shape.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
  BLOT_OUTLINE.forEach(([x, y], i) => {
    const next = BLOT_OUTLINE[(i + 1) % BLOT_OUTLINE.length];
    shape.quadraticCurveTo(x, y, (x + next[0]) / 2, (y + next[1]) / 2);
  });
  shape.closePath();
  return shape;
}

/** Camera-facing toy-ink splat. All resources belong to the arena scene. */
export class SplatEffect {
  readonly group = new THREE.Group();
  private readonly imprint = new THREE.Group();
  private readonly droplets: { mesh: THREE.Mesh; x: number; y: number; size: number }[] = [];

  constructor() {
    const material = (color: string) => new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const ink = material(palette.ink),
      body = material(palette.body);
    const lilac = material(palette.lilac),
      vein = material(palette.lilacInk);
    const coral = material(palette.coral),
      highlight = material(palette.bodyHighlight);
    const disc = new THREE.CircleGeometry(1, 32);
    const oval = (
      parent: THREE.Group,
      fill: THREE.Material,
      x: number,
      y: number,
      z: number,
      rx: number,
      ry: number,
      angle = 0,
    ) => {
      const mesh = new THREE.Mesh(disc, fill);
      mesh.position.set(x, y, z);
      mesh.scale.set(rx, ry, 1);
      mesh.rotation.z = angle;
      parent.add(mesh);
      return mesh;
    };

    // Flat, askew wings keep this recognisably a fly even at thumbnail size.
    for (const [x, y, angle] of [
      [-28, 28, 0.68],
      [22, 30, -0.46],
    ]) {
      oval(this.imprint, ink, x, y, 0, 16, 31, angle).name =
        x < 0 ? 'splat-wing-left' : 'splat-wing-right';
      oval(this.imprint, lilac, x, y, 0.3, 13.5, 28.5, angle);
      oval(
        this.imprint,
        vein,
        x + Math.sin(angle) * 4,
        y - Math.cos(angle) * 4,
        0.6,
        0.8,
        18,
        angle,
      );
    }

    const geometry = new THREE.ShapeGeometry(blotShape(), 10);
    const rim = new THREE.Mesh(geometry, ink);
    rim.position.z = 1;
    rim.scale.set(1.06, 1.08, 1);
    this.imprint.add(rim);
    const blot = new THREE.Mesh(geometry, body);
    blot.position.z = 1.2;
    this.imprint.add(blot);
    oval(this.imprint, highlight, -10, 10, 1.4, 13, 4, -0.4);

    // Two coral eye marks sit in the blot, rather than leaving a floating head.
    for (const [x, y, angle] of [
      [8, 5, -0.3],
      [24, -1, 0.25],
    ]) {
      oval(this.imprint, ink, x, y, 1.5, 7.3, 8.3, angle);
      oval(this.imprint, coral, x, y, 1.6, 5.5, 6.5, angle);
    }
    this.group.add(this.imprint);

    for (const [x, y, size] of [
      [-60, 22, 5.5],
      [53, 36, 4],
      [65, -14, 5],
      [-18, -48, 4],
      [-50, -40, 3],
    ]) {
      const mesh = oval(this.group, ink, x, y, 1, size, size * 0.72, Math.atan2(y, x));
      this.droplets.push({ mesh, x, y, size });
    }
    this.group.visible = false;
  }

  update(age: number | null, x: number, y: number, displayScale: number): void {
    const pose = splatPose(age);
    this.group.visible = pose.visible;
    // World-space sibling of the fly: never inherits its bank or left-facing
    // Y rotation, and stays on the fly XY rather than snapping to the click XY.
    this.group.position.set(x, y, 95);
    this.group.scale.setScalar(displayScale);
    this.imprint.scale.set(pose.scale, pose.scale, 1);
    for (const { mesh, x: endX, y: endY, size } of this.droplets) {
      const travel = 0.56 + 0.44 * pose.spread;
      mesh.position.set(endX * travel, endY * travel, 1);
      const pop = 0.4 + 0.6 * pose.spread;
      mesh.scale.set(size * pop, size * 0.72 * pop, 1);
    }
  }
}
