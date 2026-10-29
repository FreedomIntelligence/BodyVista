import * as THREE from 'three';

export interface FrameViewport {
  width: number;
  height: number;
  right: number;
  bottom: number;
  top?: number;
  left?: number;
}

/** The assembled skull fits above the toolbar, centred on the skull itself. */
export function skullOverviewFrame(bounds: THREE.Box3, fov: number, viewport: FrameViewport) {
  const target = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const aspect = viewport.width / Math.max(1, viewport.height);
  const heightFraction = Math.max(0.15, (viewport.height - viewport.bottom - (viewport.top ?? 0) - 80) / viewport.height);
  const widthFraction = Math.max(0.15, (viewport.width - viewport.right - (viewport.left ?? 0) - 32) / viewport.width);
  const distance = Math.max(size.y / (2 * tanV * heightFraction), size.x / (2 * tanV * aspect * widthFraction)) * 1.04 + size.z / 2;
  return { target, radius: size.length() / 2, distance };
}

/** Close frontal dental view used before arch separation, with the teeth central. */
export function dentitionFrame(bounds: THREE.Box3, target: THREE.Vector3, fov: number, aspect: number) {
  const size = bounds.getSize(new THREE.Vector3());
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const distance = Math.max(size.y / (2 * tanV * 1.2), size.x / (2 * tanV * aspect) * 1.06) + bounds.max.z - target.z;
  return { target: target.clone(), radius: size.y / 2, distance };
}
