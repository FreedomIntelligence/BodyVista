import * as THREE from "../../src/vendor/three.js";

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const BANDS = 48;
const PROXIMAL_ON_GIRDLE = new Set([0, 1, 3]);
export const ARM = Object.freeze({ upper: 0.2904, forearm: 0.24, palm: 0.06 });

export function fiberLength(table, unit, shoulder, elbow) {
  const rows = table.fiberLengthMm;
  const s = clamp(
    (shoulder - table.shoulderMin) / table.stepDeg,
    0,
    rows.length - 1,
  );
  const e = clamp(elbow / table.stepDeg, 0, rows[0].length - 1);
  const si = Math.floor(s),
    ei = Math.floor(e);
  const nextE = Math.min(ei + 1, rows[0].length - 1);
  const interp = (row) => lerp(row[ei][unit], row[nextE][unit], e - ei);
  return lerp(
    interp(rows[si]),
    interp(rows[Math.min(si + 1, rows.length - 1)]),
    s - si,
  );
}

function spinePoint(spine, u, output) {
  const position = clamp(u * BANDS, 0, BANDS);
  const i = Math.min(BANDS - 1, Math.floor(position));
  const t = position - i;
  const a = spine[i],
    b = spine[i + 1];
  // Extrapolated end controls preserve end tangents. Catmull-Rom has continuous
  // derivatives across the sampled sections, unlike the previous polyline.
  for (const axis of ["x", "y", "z"]) {
    const previous = i ? spine[i - 1][axis] : 2 * a[axis] - b[axis];
    const next = i + 2 <= BANDS ? spine[i + 2][axis] : 2 * b[axis] - a[axis];
    output[axis] =
      0.5 *
      (2 * a[axis] +
        (-previous + b[axis]) * t +
        (2 * previous - 5 * a[axis] + 4 * b[axis] - next) * t * t +
        (-previous + 3 * a[axis] - 3 * b[axis] + next) * t * t * t);
  }
  return output;
}

// Register longitudinal coordinates and original cross-section offsets.
// Smooth displacement fields preserve section ordering during deep flexion.
export function bindMuscle(geometry) {
  geometry.computeBoundingBox();
  const { min, max } = geometry.boundingBox,
    dz = max.z - min.z;
  const vertices = geometry.attributes.position;
  const rest = new Float32Array(vertices.count * 3),
    uv = new Float32Array(vertices.count);
  const spine = Array.from({ length: BANDS + 1 }, () => new THREE.Vector3());
  const weights = new Float64Array(BANDS + 1);
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i),
      y = vertices.getY(i),
      z = vertices.getZ(i);
    rest.set([x, y, z], 3 * i);
    const t = (uv[i] = clamp((max.z - z) / dz, 0, 1)),
      band = t * BANDS;
    for (
      let j = Math.max(0, Math.floor(band) - 5);
      j <= Math.min(BANDS, Math.ceil(band) + 5);
      j++
    ) {
      const weight = Math.exp(-0.18 * (j - band) ** 2);
      spine[j].x += x * weight;
      spine[j].y += y * weight;
      weights[j] += weight;
    }
  }
  for (let j = 0; j <= BANDS; j++) {
    if (!weights[j]) throw Error("肌肉横截面采样不足");
    spine[j].set(
      spine[j].x / weights[j],
      spine[j].y / weights[j],
      max.z - (dz * j) / BANDS,
    );
  }

  const offsets = new Float32Array(vertices.count * 3),
    guide = new Float32Array(vertices.count * 3);
  const center = new THREE.Vector3(),
    delta = new THREE.Vector3();
  const rawWidths = Array(BANDS + 1).fill(0);
  for (let i = 0; i < vertices.count; i++) {
    const t = uv[i];
    spinePoint(spine, t, center);
    delta
      .fromArray(rest, 3 * i)
      .sub(center)
      .toArray(offsets, 3 * i);
    const band = Math.round(t * BANDS);
    rawWidths[band] = Math.max(rawWidths[band], Math.hypot(delta.x, delta.y));
    const striation =
      0.5 +
      0.5 * Math.cos(8 * Math.atan2(delta.y, delta.x) + 2.1 * Math.sin(3 * t));
    const shade = 1 - 0.19 * striation ** 3 * Math.sin(Math.PI * t) ** 2;
    guide.set([shade, shade, shade], 3 * i);
  }
  const widths = rawWidths.map((value, i) => {
    let total = 0,
      weight = 0;
    for (let j = Math.max(0, i - 4); j <= Math.min(BANDS, i + 4); j++) {
      const w = Math.exp(-0.25 * (i - j) ** 2);
      total += rawWidths[j] * w;
      weight += w;
    }
    return total / weight;
  });
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(guide, 3));
  return { rest, uv, spine, offsets, widths };
}

function radiusAt(t, lambda, activation) {
  return lerp(
    1,
    (1 + 0.1 * clamp(activation, 0, 1)) / Math.sqrt(lambda),
    Math.sin(Math.PI * t) ** 2,
  );
}

export function deformMuscle(
  geometry,
  binding,
  unit,
  ratio,
  elbowDeg,
  shoulderDeg,
  activation = 0,
) {
  const { uv, spine, offsets, widths } = binding,
    positions = geometry.attributes.position;
  const lambda = clamp(ratio, 0.48, 1.66);
  const elbow = THREE.MathUtils.degToRad(-elbowDeg),
    undoShoulder = THREE.MathUtils.degToRad(shoulderDeg);
  const axis = new THREE.Vector3(1, 0, 0);
  const tendon =
    unit === 1 ? new THREE.Vector3(0, -0.012, -0.055) : spine[BANDS].clone();
  const distalShift = tendon.clone().applyAxisAngle(axis, elbow).sub(tendon);
  const anchor = spine[0].clone();
  anchor.z -= ARM.upper;
  const proximalShift = anchor
    .clone()
    .applyAxisAngle(axis, undoShoulder)
    .sub(anchor);
  function rawGuide(u, out) {
    spinePoint(spine, u, out);
    const z = out.z;
    if (unit < 3) {
      const weight = 1 - THREE.MathUtils.smootherstep(z, tendon.z, 0.2);
      out.addScaledVector(distalShift, weight);
    } else {
      const bend = elbow * (1 - THREE.MathUtils.smoothstep(z, -0.016, 0.06));
      out.applyAxisAngle(axis, bend);
    }
    if (PROXIMAL_ON_GIRDLE.has(unit))
      out.addScaledVector(
        proximalShift,
        1 - THREE.MathUtils.smootherstep(u, 0, 0.36),
      );
    return out;
  }
  const routeStart = rawGuide(0, new THREE.Vector3()),
    routeEnd = rawGuide(1, new THREE.Vector3());
  const straighten = unit < 3 ? 0.9 * Math.sin(Math.abs(elbow) / 2) : 0;
  const chord = new THREE.Vector3();
  function guide(u, out) {
    rawGuide(u, out);
    // Shortening makes the flexor route approach the line between its moving
    // attachments. Retain its original course at extension and all endpoint positions.
    chord.lerpVectors(routeStart, routeEnd, u);
    return out.lerp(chord, straighten);
  }
  const start = new THREE.Vector3(),
    end = new THREE.Vector3(),
    center = new THREE.Vector3();
  const originalSpan = spinePoint(spine, 0.35, start).distanceTo(
    spinePoint(spine, 0.65, end),
  );
  const posedSpan = guide(0.35, start).distanceTo(guide(0.65, end));
  // Bone motion already shortens the route. Apply only the remaining axial change,
  // otherwise shortening the path and again multiplying by fiber ratio folds the belly.
  const axial =
    unit < 3
      ? clamp((lambda * originalSpan) / Math.max(0.001, posedSpan), 0.65, 1.35)
      : lambda;
  const path = [];
  for (let j = 0; j <= BANDS; j++) {
    const t = j / BANDS,
      mapped = t + ((1 - axial) * Math.sin(2 * Math.PI * t)) / (2 * Math.PI);
    guide(mapped, center);
    const radius = radiusAt(t, lambda, activation),
      distance = Math.hypot(center.x, center.y);
    const outward = Math.max(0, radius - 1) * widths[j] * 0.66;
    if (distance > 0.002) {
      center.x += (center.x / distance) * outward;
      center.y += (center.y / distance) * outward;
    }
    path.push(center.clone());
  }
  const offset = new THREE.Vector3(), sourcePoint = new THREE.Vector3();
  for (let i = 0; i < uv.length; i++) {
    const t = uv[i],
      radius = radiusAt(t, lambda, activation);
    spinePoint(path, t, center);
    offset.fromArray(offsets, 3 * i);
    offset.x *= radius;
    offset.y *= radius;
    if (unit >= 3) {
      const mapped =
        t + ((1 - axial) * Math.sin(2 * Math.PI * t)) / (2 * Math.PI);
      const source = spinePoint(spine, mapped, sourcePoint);
      offset.applyAxisAngle(
        axis,
        elbow * (1 - THREE.MathUtils.smoothstep(source.z, -0.016, 0.06)),
      );
    }
    offset.add(center);
    positions.setXYZ(i, offset.x, offset.y, offset.z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.boundingBox = null;
  geometry.computeBoundingSphere();
}
