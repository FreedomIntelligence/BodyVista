/**
 * Where a mesh's label is anchored: a point on its outer surface, chosen per tissue so that
 * tooth layers are labelled on the side that faces the viewer in the usual views.
 */
import * as THREE from 'three';
import type { Registry } from '../anatomy/registry';

/** A point on the outer surface of a mesh to anchor its label. */
export function computeLabelPoint(geo: THREE.BufferGeometry, meshKey: string, ownerId: string, registry: Registry): THREE.Vector3 {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const center = geo.boundingBox!.getCenter(new THREE.Vector3());
  const owner = registry.get(ownerId);
  const fdi = owner?.toothFdi;
  let dir = center.clone().sub(new THREE.Vector3(0, 0, -0.6));
  if (fdi !== undefined) {
    const f = registry.get(`tooth-${fdi}`)?.tooth?.frame;
    if (f) {
      const axis = new THREE.Vector3(...f.axis);
      const buccal = new THREE.Vector3(...f.buccal);
      const kind = meshKey.replace(/-\d{2}$/, '');
      const mix: Record<string, [number, number]> = {
        shell: [1, 0.35],
        enamel: [1, 0.3],
        'dentin-coronal': [0.25, 1],
        'dentin-radicular': [-0.45, 1],
        cementum: [-0.8, 1],
        pdl: [-1, 0.4],
        'pulp-chamber': [1, 0.2],
      };
      const [a, b] = mix[meshKey === `tooth-${fdi}` ? 'shell' : kind] ?? [0, 0];
      if (a || b) dir = axis.multiplyScalar(a).addScaledVector(buccal, b);
      else {
        // canals: centroid of the mesh
        return center;
      }
    }
  }
  dir.normalize();
  let best = -Infinity;
  const v = new THREE.Vector3();
  const out = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = v.clone().sub(center).dot(dir);
    if (d > best) {
      best = d;
      out.copy(v);
    }
  }
  return out;
}
