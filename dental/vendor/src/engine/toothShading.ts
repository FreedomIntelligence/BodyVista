/**
 * Per-vertex colour for tooth surfaces, baked once when a tooth mesh is added:
 * a crown-to-root colour change at the modeled CEJ. Relief is geometry, not pigment.
 */
import * as THREE from 'three';
import type { Registry } from '../anatomy/registry';
import type { TissueMaterial } from './materials';

/** Give the intact tooth a subtle crown-to-root colour change at its modeled CEJ. */
export function colorToothShell(geo: THREE.BufferGeometry, mat: TissueMaterial, registry: Registry, fdi: number) {
  const tooth = registry.manifest.teeth[String(fdi)];
  const cervical = tooth?.landmarks?.['cervical-line'];
  const axis = tooth?.frame.axis;
  if (!cervical || !axis) return;
  mat.userData.fx.uCervical.value.set(...cervical);
  mat.userData.fx.uToothAxis.value.set(...axis);
  const positions = geo.getAttribute('position');
  const crevices = meshCrevices(geo, 0.0004, 0.004);
  const colors = new Float32Array(positions.count * 3);
  // height of each vertex along the tooth axis, measured from the cervical line
  const heights = new Float64Array(positions.count);
  let crownTop = 0;
  for (let i = 0; i < positions.count; i++) {
    heights[i] = (positions.getX(i) - cervical[0]) * axis[0]
      + (positions.getY(i) - cervical[1]) * axis[1]
      + (positions.getZ(i) - cervical[2]) * axis[2];
    crownTop = Math.max(crownTop, heights[i]);
  }
  const shade = 1 + (((fdi * 17) % 7) - 3) * 0.006;
  for (let i = 0; i < positions.count; i++) {
    const height = heights[i];
    const crown = THREE.MathUtils.smoothstep(height, -0.11, 0.07);
    const tip = THREE.MathUtils.smoothstep(height, crownTop * 0.65, crownTop * 0.92);
    const fissure = 1 - 0.035 * crevices[i] * crown;
    colors[i * 3] = THREE.MathUtils.lerp(0.84, 1, crown) * (1 - 0.08 * tip) * shade * fissure;
    colors[i * 3 + 1] = THREE.MathUtils.lerp(0.76, 0.985, crown) * (1 - 0.015 * tip) * shade * fissure;
    colors[i * 3 + 2] = THREE.MathUtils.lerp(0.66, 0.96, crown) * (1 + 0.035 * tip) * shade * fissure;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** Accentuate concave regions already present in the tooth surface, especially occlusal fissures. */
export function shadeEnamelCrevices(geo: THREE.BufferGeometry, registry?: Registry, fdi?: number) {
  const crevices = meshCrevices(geo, 0.0015, 0.008);
  const colors = new Float32Array(crevices.length * 3);
  const tooth = fdi === undefined ? undefined : registry?.manifest.teeth[String(fdi)];
  const cervical = tooth?.landmarks?.['cervical-line'];
  const axis = tooth?.frame.axis;
  const positions = geo.getAttribute('position');
  const heights = new Float32Array(crevices.length);
  let top = 0;
  if (cervical && axis) {
    for (let i = 0; i < heights.length; i++) {
      heights[i] = (positions.getX(i) - cervical[0]) * axis[0]
        + (positions.getY(i) - cervical[1]) * axis[1]
        + (positions.getZ(i) - cervical[2]) * axis[2];
      top = Math.max(top, heights[i]);
    }
  }
  for (let i = 0; i < crevices.length; i++) {
    const shade = 1 - 0.025 * crevices[i];
    // Broad cervical warmth fading toward the incisal/occlusal enamel.
    // An illustrative optical cue, independent of the groove pattern.
    const cervicalWarmth = top > 0 ? 1 - THREE.MathUtils.smoothstep(heights[i], top * .10, top * .85) : 0;
    colors[i * 3] = shade;
    colors[i * 3 + 1] = shade * (1 - .035 * cervicalWarmth);
    colors[i * 3 + 2] = shade * (1 - .10 * cervicalWarmth);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function meshCrevices(geo: THREE.BufferGeometry, start: number, end: number): Float32Array {
  const pos = geo.getAttribute('position');
  const normal = geo.getAttribute('normal');
  const index = geo.getIndex();
  const out = new Float32Array(pos.count);
  if (!index || !normal) return out;
  const sum = new Float32Array(pos.count * 3);
  const degree = new Uint16Array(pos.count);
  const add = (from: number, to: number) => {
    sum[from * 3] += pos.getX(to);
    sum[from * 3 + 1] += pos.getY(to);
    sum[from * 3 + 2] += pos.getZ(to);
    degree[from]++;
  };
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
    add(a, b); add(a, c); add(b, a); add(b, c); add(c, a); add(c, b);
  }
  for (let i = 0; i < pos.count; i++) {
    if (!degree[i]) continue;
    const x = sum[i * 3] / degree[i] - pos.getX(i);
    const y = sum[i * 3 + 1] / degree[i] - pos.getY(i);
    const z = sum[i * 3 + 2] / degree[i] - pos.getZ(i);
    const depth = x * normal.getX(i) + y * normal.getY(i) + z * normal.getZ(i);
    out[i] = THREE.MathUtils.smoothstep(depth, start, end);
  }
  return out;
}
