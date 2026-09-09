import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { brainExportCrop, fitBrainCamera } from './brainFraming';

const circuit = JSON.parse(
  readFileSync(new URL('../../public/data/circuit.json', import.meta.url), 'utf8'),
) as {
  neurons: { x: number; y: number; z: number }[];
};
const bounds = new THREE.Box3();
circuit.neurons.forEach((cell) => {
  bounds.expandByPoint(new THREE.Vector3(cell.x, cell.y, cell.z));
});
const center = bounds.getCenter(new THREE.Vector3());
const size = bounds.getSize(new THREE.Vector3());
const scale = 2.15 / Math.max(size.x, size.y, size.z, 1);
const positions = new Float32Array(
  circuit.neurons.flatMap((cell) => [
    (cell.x - center.x) * scale,
    -(cell.y - center.y) * scale,
    (cell.z - center.z) * scale,
  ]),
);

describe('responsive framing of actual brain anatomy', () => {
  for (const [width, height] of [
    [288, 250],
    [288, 500],
    [360, 750],
    [366, 320],
    [640, 220],
  ]) {
    it(`keeps all cells within a useful, overlay-safe frame at ${width}×${height}`, () => {
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
      camera.position.set(0, 0, 10);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      const topReserve = Math.min(48, height * 0.2);
      const bottomReserve = Math.min(36, height * 0.15);
      for (const [x, y] of [
        [1.05, -0.12],
        [0, 0],
        [Math.PI / 2, 1],
        [-Math.PI / 2, -2],
        [0.5, Math.PI],
      ]) {
        const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, 0));
        fitBrainCamera(camera, positions, matrix, width, height);
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        const point = new THREE.Vector3();
        for (let i = 0; i < positions.length; i += 3) {
          point.fromArray(positions, i).applyMatrix4(matrix).project(camera);
          const px = ((point.x + 1) * width) / 2,
            py = ((1 - point.y) * height) / 2;
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, py);
          maxY = Math.max(maxY, py);
        }
        expect(minX).toBeGreaterThanOrEqual(width * 0.1 - 0.00001);
        expect(maxX).toBeLessThanOrEqual(width * 0.9 + 0.00001);
        expect(minY).toBeGreaterThanOrEqual(topReserve - 0.00001);
        expect(maxY).toBeLessThanOrEqual(height - bottomReserve + 0.00001);
        const widthFill = (maxX - minX) / (width * 0.8);
        const heightFill =
          (maxY - minY) / Math.min(height * 0.8, height - topReserve - bottomReserve);
        expect(Math.max(widthFill, heightFill)).toBeCloseTo(1, 5);
      }
    });
  }

  it('uses the tall sidebar rather than fitting a hypothetical bounding cube', () => {
    const camera = new THREE.OrthographicCamera();
    const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(1.05, -0.12, 0));
    fitBrainCamera(camera, positions, matrix, 288, 500);
    const projectedHeight = (2.181097 * 500) / (camera.top - camera.bottom);
    expect(projectedHeight).toBeGreaterThan(350); // Previously ~255 px.
    expect(projectedHeight).toBeLessThan(353);
  });

  it('retains a finite safe camera for an empty or degenerate circuit', () => {
    const camera = new THREE.OrthographicCamera();
    for (const cells of [new Float32Array(), new Float32Array([0, 0, 0])]) {
      fitBrainCamera(camera, cells, new THREE.Matrix4(), 288, 250);
      expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
      expect(camera.right).toBeGreaterThan(camera.left);
      expect(camera.top).toBeGreaterThan(camera.bottom);
    }
  });

  it('crops the actual cloud in bitmap pixels across rotations and device pixel ratios', () => {
    const camera = new THREE.OrthographicCamera();
    for (const [width, height] of [
      [288, 500],
      [360, 750],
      [640, 220],
    ]) {
      for (const [x, y] of [
        [1.05, -0.12],
        [Math.PI / 2, 1],
        [-Math.PI / 2, -2],
      ]) {
        const matrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, 0));
        const bounds = fitBrainCamera(camera, positions, matrix, width, height)!;
        for (const dpr of [1, 1.5, 2]) {
          const bitmapWidth = Math.floor(width * dpr),
            bitmapHeight = Math.floor(height * dpr);
          const crop = brainExportCrop(bounds, width, height, bitmapWidth, bitmapHeight);
          expect(crop.x).toBeGreaterThanOrEqual(0);
          expect(crop.y).toBeGreaterThanOrEqual(0);
          expect(crop.x + crop.width).toBeLessThanOrEqual(bitmapWidth);
          expect(crop.y + crop.height).toBeLessThanOrEqual(bitmapHeight);
          expect(crop.x).toBeLessThanOrEqual((bounds.x - 11) * dpr);
          expect(crop.y).toBeLessThanOrEqual((bounds.y - 11) * dpr);
          expect(crop.x + crop.width).toBeGreaterThanOrEqual((bounds.x + bounds.width + 11) * dpr);
          expect(crop.y + crop.height).toBeGreaterThanOrEqual(
            (bounds.y + bounds.height + 11) * dpr,
          );
          expect(Object.values(crop).every(Number.isInteger)).toBe(true);
        }
      }
    }
  });

  it('uses the whole current bitmap before a circuit has been painted', () => {
    expect(brainExportCrop(null, 288, 500, 432, 750)).toEqual({
      x: 0,
      y: 0,
      width: 432,
      height: 750,
    });
  });
});
