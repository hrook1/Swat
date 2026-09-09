import type * as THREE from 'three';

export type BrainViewBounds = { x: number; y: number; width: number; height: number };

/** Fit real, rotated cell positions; presentation only, never an anatomical transform. */
export function fitBrainCamera(
  camera: THREE.OrthographicCamera,
  positions: Float32Array,
  transform: THREE.Matrix4,
  width: number,
  height: number,
): BrainViewBounds | null {
  if (width <= 0 || height <= 0) return null;
  const matrix = transform.elements;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    const screenX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
    const screenY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) continue;
    minX = Math.min(minX, screenX);
    maxX = Math.max(maxX, screenX);
    minY = Math.min(minY, screenY);
    maxY = Math.max(maxY, screenY);
  }
  if (!Number.isFinite(minX)) {
    minX = minY = -1;
    maxX = maxY = 1;
  }

  // The count sits at the top and the rotation hint at the bottom. These pixel
  // reserves include a bright neuron's halo, without double-padding tall views.
  const topReserve = Math.min(48, height * 0.2);
  const bottomReserve = Math.min(36, height * 0.15);
  const targetWidth = width * 0.8;
  const targetHeight = Math.min(height * 0.8, height - topReserve - bottomReserve);
  const unitsPerPixel = Math.max(
    Math.max(maxX - minX, 0.05) / targetWidth,
    Math.max(maxY - minY, 0.05) / targetHeight,
  );
  const halfWidth = (width * unitsPerPixel) / 2;
  const halfHeight = (height * unitsPerPixel) / 2;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2 + ((topReserve - bottomReserve) * unitsPerPixel) / 2;
  camera.left = centerX - halfWidth;
  camera.right = centerX + halfWidth;
  camera.top = centerY + halfHeight;
  camera.bottom = centerY - halfHeight;
  camera.updateProjectionMatrix();
  return {
    x: (minX - camera.left) / unitsPerPixel,
    y: (camera.top - maxY) / unitsPerPixel,
    width: (maxX - minX) / unitsPerPixel,
    height: (maxY - minY) / unitsPerPixel,
  };
}

/** Crop the existing rendered bitmap, including cell halos; no readback or rerender. */
export function brainExportCrop(
  bounds: BrainViewBounds | null,
  viewWidth: number,
  viewHeight: number,
  bitmapWidth: number,
  bitmapHeight: number,
): BrainViewBounds {
  if (!bounds || viewWidth <= 0 || viewHeight <= 0)
    return { x: 0, y: 0, width: bitmapWidth, height: bitmapHeight };
  const scaleX = bitmapWidth / viewWidth,
    scaleY = bitmapHeight / viewHeight;
  const padX = Math.max(12, bounds.width * 0.1),
    padY = Math.max(12, bounds.height * 0.1);
  const x = Math.max(0, Math.floor((bounds.x - padX) * scaleX));
  const y = Math.max(0, Math.floor((bounds.y - padY) * scaleY));
  const right = Math.min(bitmapWidth, Math.ceil((bounds.x + bounds.width + padX) * scaleX));
  const bottom = Math.min(bitmapHeight, Math.ceil((bounds.y + bounds.height + padY) * scaleY));
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}
