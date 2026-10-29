/** Illustrative joint kinematics. The asset manifest fits the axis to this skull. */
import * as THREE from 'three';
import type { Manifest } from '../anatomy/types';

export function jawMatrix(manifest: Manifest, opening: number, disc = false): THREE.Matrix4 {
  const plan = manifest.jawMotion;
  if (!plan || opening <= 0) return new THREE.Matrix4();
  const t = Math.max(0, Math.min(1, opening));
  // Rotation and translation overlap: translation increases progressively.
  const slide = t * t;
  const [x, y, z] = plan.pivot;
  const [dx, dy, dz] = plan.translation;
  const angle = plan.rotation * t * (disc ? 0.15 : 1);
  return new THREE.Matrix4().makeTranslation(x + dx * slide, y + dy * slide, z + dz * slide)
    .multiply(new THREE.Matrix4().makeRotationX(angle))
    .multiply(new THREE.Matrix4().makeTranslation(-x, -y, -z));
}

export function rigidJawPart(key: string, fdi?: number): 'mandible' | 'disc' | undefined {
  if (fdi !== undefined && fdi >= 30 || key === 'gingiva-lower' || key === 'mandible-body' || key === 'mandibular-alveolar-process' || key.startsWith('mandibular-condyle-') || key.startsWith('mandibular-canal-')) return 'mandible';
  if (key.startsWith('articular-disc')) return 'disc';
  return undefined;
}

/** Static target for compliant tissue; source attachments stay fixed at one end. */
export function jawDeformation(geo: THREE.BufferGeometry, key: string, manifest: Manifest, nerve: boolean): Float32Array {
  const pos = geo.getAttribute('position');
  const jaw = geo.getAttribute('jaw');
  const bounds = geo.boundingBox!;
  const full = jawMatrix(manifest, 1, key.startsWith('lateral-pterygoid-upper'));
  const output = new Float32Array(pos.count * 3);
  const rest = new THREE.Vector3(), moved = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    rest.fromBufferAttribute(pos, i);
    let weight: number;
    if (nerve) weight = jaw ? 1 - jaw.getX(i) : 0;
    else if (key.startsWith('lateral-pterygoid')) {
      const near = Math.min(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
      const far = Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x));
      weight = (Math.abs(rest.x) - near) / Math.max(1e-6, far - near);
    } else weight = (bounds.max.y - rest.y) / Math.max(1e-6, bounds.max.y - bounds.min.y);
    weight = Math.max(0, Math.min(1, weight));
    weight = weight * weight * (3 - 2 * weight);
    moved.copy(rest).applyMatrix4(full).sub(rest).multiplyScalar(weight);
    moved.toArray(output, i * 3);
  }
  return output;
}
