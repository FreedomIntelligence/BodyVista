import { Vector3, MathUtils } from "../../src/vendor/three.js";

// Display-only rounded paths. Keep this math aligned with muscle_path_shape.py.
const GRID_COUNT = 4097;
const SQRT_TWO = Math.sqrt(2);
const INV_SQRT_TAU = 1 / Math.sqrt(2 * Math.PI);

function triples(values) {
  if (!values || typeof values.length !== 'number') throw new TypeError('Expected 3D points');
  if (!values.length) return [];
  const points = typeof values[0] === 'number'
    ? Array.from({ length: values.length / 3 }, (_, i) => [values[3*i], values[3*i+1], values[3*i+2]])
    : Array.from(values, p => [p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]]);
  if ((typeof values[0] === 'number' && values.length % 3) || points.some(p => p.some(x => !Number.isFinite(x)))) {
    throw new TypeError('Expected finite 3D points');
  }
  return points;
}

function normalCdf(value) {
  const x = Math.abs(value) / SQRT_TWO;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429*t - 1.453152027)*t) + 1.421413741)*t - 0.284496736)*t + 0.254829592)*t*Math.exp(-x*x);
  return .5 * (1 + Math.sign(value) * erf);
}

/** Return flat Float64Array centers/tangents sampled at equal actual arc lengths. */
export function sampleRoundedArcPath(input, count = 513, rounding = .006) {
  if (!Number.isInteger(count) || count < 2 || !Number.isFinite(rounding) || rounding <= 0) {
    throw new RangeError('Expected count >= 2 and positive rounding distance');
  }
  const source = triples(input);
  if (source.length < 2) throw new RangeError('Expected at least two path points');
  const points = [source[0]];
  for (let i = 1; i < source.length; i++) {
    // Match Python's adjacent-source duplicate removal, including threshold ties.
    if (Math.hypot(...source[i].map((v, k) => v-source[i-1][k])) > 1e-9) points.push(source[i]);
  }
  if (points.length < 2) throw new RangeError('Collapsed path');
  const knots = [0], directions = [];
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].map((v, k) => v-points[i-1][k]);
    const length = Math.hypot(...delta);
    directions.push(delta.map(v => v/length)); knots.push(knots.at(-1)+length);
  }
  const total = knots.at(-1);
  if (points.length === 2) {
    const centers = new Float64Array(count*3), tangents = new Float64Array(count*3);
    for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) {
      centers[3*i+k] = points[0][k]+i/(count-1)*(points[1][k]-points[0][k]);
      tangents[3*i+k] = directions[0][k];
    }
    return { centers, tangents, length: total, count };
  }
  function evaluate(s, center, tangent) {
    for (let k = 0; k < 3; k++) { center[k] = points[0][k]+s*directions[0][k]; tangent[k] = directions[0][k]; }
    for (let i = 1; i < points.length-1; i++) {
      const x = s-knots[i], cdf = normalCdf(x/rounding);
      const hinge = x*cdf+rounding*INV_SQRT_TAU*Math.exp(-.5*(x/rounding)**2);
      for (let k = 0; k < 3; k++) {
        const jump = directions[i][k]-directions[i-1][k];
        center[k] += hinge*jump; tangent[k] += cdf*jump;
      }
    }
  }
  const start = [0, 0, 0], end = [0, 0, 0], temp = [0, 0, 0];
  evaluate(0, start, temp); evaluate(total, end, temp);
  const c0 = start.map((v, k) => points[0][k]-v);
  const c1 = end.map((v, k) => points.at(-1)[k]-v);
  const arc = new Float64Array(GRID_COUNT), previous = [0, 0, 0], current = [0, 0, 0];
  for (let i = 0; i < GRID_COUNT; i++) {
    const u = i/(GRID_COUNT-1);
    evaluate(u*total, current, temp);
    for (let k = 0; k < 3; k++) current[k] += (1-u)*c0[k]+u*c1[k];
    if (i) arc[i] = arc[i-1]+Math.hypot(...current.map((v, k) => v-previous[k]));
    for (let k = 0; k < 3; k++) previous[k] = current[k];
  }
  const length = arc.at(-1);
  if (length < 1e-9) throw new RangeError('Rounded path collapsed');
  const centers = new Float64Array(count*3), tangents = new Float64Array(count*3);
  let segment = 0;
  for (let i = 0; i < count; i++) {
    const target = i*length/(count-1);
    while (segment < GRID_COUNT-2 && arc[segment+1] < target) segment++;
    const blend = (target-arc[segment])/(arc[segment+1]-arc[segment]);
    const u = (segment+blend)/(GRID_COUNT-1);
    evaluate(u*total, current, temp);
    for (let k = 0; k < 3; k++) { current[k] += (1-u)*c0[k]+u*c1[k]; temp[k] += (c1[k]-c0[k])/total; }
    const norm = Math.hypot(...temp);
    if (norm < 1e-10) throw new RangeError('Path contains an undefined tangent');
    for (let k = 0; k < 3; k++) { centers[3*i+k] = current[k]; tangents[3*i+k] = temp[k]/norm; }
  }
  return { centers, tangents, length, count };
}

/** Continuous closest-segment binding; all results are flat typed arrays. */
export function bindContinuousPath(inputVertices, inputCenters, inputTangents = null) {
  const vertices = triples(inputVertices), centers = triples(inputCenters);
  const tangents = inputTangents === null ? null : triples(inputTangents);
  if (centers.length < 2 || (tangents && tangents.length !== centers.length)) throw new RangeError('Invalid sampled path');
  const segments = centers.slice(1).map((p, i) => p.map((v, k) => v-centers[i][k]));
  const lengths2 = segments.map(s => s.reduce((sum, value) => sum+value*value, 0));
  if (lengths2.some(length => length < 1e-20)) throw new RangeError('Repeated path samples cannot be bound');
  const t = new Float64Array(vertices.length), indices = new Uint32Array(vertices.length);
  const fraction = new Float64Array(vertices.length), restOffsets = new Float64Array(vertices.length*3);
  const restTangents = tangents ? new Float64Array(vertices.length*3) : null;
  for (let i = 0; i < vertices.length; i++) {
    let best = Infinity, bestIndex = 0, bestBlend = 0;
    for (let j = 0; j < segments.length; j++) {
      const delta = vertices[i].map((v, k) => v-centers[j][k]);
      const blend = Math.max(0, Math.min(1, delta.reduce((sum, value, k) => sum+value*segments[j][k], 0)/lengths2[j]));
      const distance = delta.reduce((sum, value, k) => sum+(value-blend*segments[j][k])**2, 0);
      if (distance < best) { best = distance; bestIndex = j; bestBlend = blend; }
    }
    indices[i] = bestIndex; fraction[i] = bestBlend; t[i] = (bestIndex+bestBlend)/(centers.length-1);
    for (let k = 0; k < 3; k++) {
      restOffsets[3*i+k] = vertices[i][k]-centers[bestIndex][k]-bestBlend*segments[bestIndex][k];
      if (restTangents) restTangents[3*i+k] = tangents[bestIndex][k]*(1-bestBlend)+tangents[bestIndex+1][k]*bestBlend;
    }
    if (restTangents) {
      const norm = Math.hypot(...restTangents.subarray(3*i, 3*i+3));
      if (norm < 1e-10) throw new RangeError('Interpolated tangent is undefined');
      for (let k = 0; k < 3; k++) restTangents[3*i+k] /= norm;
    }
  }
  return { t, indices, fraction, restOffsets, ...(restTangents ? { restTangents } : {}) };
}

// Actual display-triangle self contact. The fixed-topology tree is refitted in world
// space; touching edges and coplanar faces are outside this strict crossing test.
export function makeDisplayContact(c, displayRest) {
  const fail = () => {
    throw Error("肌肉细表面接触合同无效。");
  };
  const finite = (a) =>
    a && a.length > 0 && Array.from(a).every(Number.isFinite);
  if (
    c?.version !== 1 ||
    c.kind !== "material-side-triangle-contact" ||
    !finite(displayRest) ||
    displayRest.length % 3
  )
    fail();
  const n = displayRest.length / 3;
  if (
    !c.faces?.length ||
    c.faces.length % 3 ||
    !Array.from(c.faces).every((i) => Number.isInteger(i) && i >= 0 && i < n) ||
    c.fixed?.length !== n ||
    !Array.from(c.fixed).every((v) => v === 0 || v === 1)
  )
    fail();
  const rest = Float64Array.from(displayRest),
    faces = Uint32Array.from(c.faces),
    fixed = Uint8Array.from(c.fixed),
    m = faces.length / 3;
  for (let i = 0; i < m; i++)
    if (
      faces[3 * i] === faces[3 * i + 1] ||
      faces[3 * i] === faces[3 * i + 2] ||
      faces[3 * i + 1] === faces[3 * i + 2]
    )
      fail();
  const fac = c.smoothing,
    freeCount = fixed.reduce((s, v) => s + 1 - v, 0);
  if (!fac || !freeCount || freeCount === n || fac.free?.length !== freeCount)
    fail();
  const validFree = new Set();
  for (const i of fac.free) {
    if (!Number.isInteger(i) || i < 0 || i >= n || fixed[i] || validFree.has(i))
      fail();
    validFree.add(i);
  }
  for (const p of [fac.rowPermutation, fac.columnPermutation]) {
    if (
      p?.length !== freeCount ||
      new Set(p).size !== freeCount ||
      !Array.from(p).every(
        (i) => Number.isInteger(i) && i >= 0 && i < freeCount,
      )
    )
      fail();
  }
  for (const [factor, lower] of [
    [fac.lower, true],
    [fac.upper, false],
  ]) {
    if (
      factor?.rows?.length !== freeCount + 1 ||
      !finite(factor.values) ||
      factor.columns?.length !== factor.values.length ||
      factor.rows[0] !== 0 ||
      factor.rows[freeCount] !== factor.values.length
    )
      fail();
    for (let i = 0; i < freeCount; i++) {
      const start = factor.rows[i],
        end = factor.rows[i + 1];
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        end <= start ||
        end > factor.values.length
      )
        fail();
      let diagonal = 0;
      for (let j = start; j < end; j++) {
        const col = factor.columns[j];
        if (
          !Number.isInteger(col) ||
          col < 0 ||
          col >= freeCount ||
          (lower ? col > i : col < i)
        )
          fail();
        if (col === i) {
          if (diagonal || factor.values[j] === 0) fail();
          diagonal++;
        }
      }
      if (diagonal !== 1) fail();
    }
  }

  const incident = Array.from({ length: n }, () => []);
  for (let t = 0; t < m; t++)
    for (let k = 0; k < 3; k++) incident[faces[t * 3 + k]].push(t);
  const nodes = [],
    order = Array.from({ length: m }, (_, i) => i),
    center = new Float64Array(m * 3),
    triMin = new Float64Array(m * 3),
    triMax = new Float64Array(m * 3);
  for (let t = 0; t < m; t++)
    for (let k = 0; k < 3; k++)
      center[t * 3 + k] =
        (rest[faces[t * 3] * 3 + k] +
          rest[faces[t * 3 + 1] * 3 + k] +
          rest[faces[t * 3 + 2] * 3 + k]) /
        3;
  function build(start, end, parent = -1) {
    const node = {
        start,
        end,
        parent,
        left: -1,
        right: -1,
        min: [0, 0, 0],
        max: [0, 0, 0],
      },
      id = nodes.length;
    nodes.push(node);
    if (end - start > 8) {
      const lo = [Infinity, Infinity, Infinity],
        hi = [-Infinity, -Infinity, -Infinity];
      for (let i = start; i < end; i++)
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], center[order[i] * 3 + k]);
          hi[k] = Math.max(hi[k], center[order[i] * 3 + k]);
        }
      let axis = 0;
      for (let k = 1; k < 3; k++)
        if (hi[k] - lo[k] > hi[axis] - lo[axis]) axis = k;
      const part = order
        .slice(start, end)
        .sort((a, b) => center[a * 3 + axis] - center[b * 3 + axis] || a - b);
      for (let i = start; i < end; i++) order[i] = part[i - start];
      const mid = (start + end) >> 1;
      node.left = build(start, mid, id);
      node.right = build(mid, end, id);
    }
    return id;
  }
  build(0, m);
  const leaf = new Uint32Array(m);
  nodes.forEach((o, id) => {
    if (o.left < 0) for (let i = o.start; i < o.end; i++) leaf[order[i]] = id;
  });
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ],
    dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const triangle = (y, t) =>
    [0, 1, 2].map((k) =>
      Array.from(y.subarray(faces[t * 3 + k] * 3, faces[t * 3 + k] * 3 + 3)),
    );
  function intersects(y, ai, bi) {
    const a0 = faces[ai * 3],
      a1 = faces[ai * 3 + 1],
      a2 = faces[ai * 3 + 2],
      b0 = faces[bi * 3],
      b1 = faces[bi * 3 + 1],
      b2 = faces[bi * 3 + 2];
    if (
      a0 === b0 ||
      a0 === b1 ||
      a0 === b2 ||
      a1 === b0 ||
      a1 === b1 ||
      a1 === b2 ||
      a2 === b0 ||
      a2 === b1 ||
      a2 === b2
    )
      return false;
    for (let direction = 0; direction < 2; direction++) {
      const source = direction ? bi : ai,
        target = direction ? ai : bi,
        p0 = faces[target * 3] * 3,
        p1 = faces[target * 3 + 1] * 3,
        p2 = faces[target * 3 + 2] * 3;
      const e1x = y[p1] - y[p0],
        e1y = y[p1 + 1] - y[p0 + 1],
        e1z = y[p1 + 2] - y[p0 + 2],
        e2x = y[p2] - y[p0],
        e2y = y[p2 + 1] - y[p0 + 1],
        e2z = y[p2 + 2] - y[p0 + 2];
      for (let k = 0; k < 3; k++) {
        const p = faces[source * 3 + k] * 3,
          q = faces[source * 3 + ((k + 1) % 3)] * 3,
          dx = y[q] - y[p],
          dy = y[q + 1] - y[p + 1],
          dz = y[q + 2] - y[p + 2];
        const hx = dy * e2z - dz * e2y,
          hy = dz * e2x - dx * e2z,
          hz = dx * e2y - dy * e2x,
          det = e1x * hx + e1y * hy + e1z * hz;
        if (Math.abs(det) <= 1e-15) continue;
        const inv = 1 / det,
          sx = y[p] - y[p0],
          sy = y[p + 1] - y[p0 + 1],
          sz = y[p + 2] - y[p0 + 2],
          u = inv * (sx * hx + sy * hy + sz * hz);
        if (u <= 1e-6 || u >= 1 - 1e-6) continue;
        const qx = sy * e1z - sz * e1y,
          qy = sz * e1x - sx * e1z,
          qz = sx * e1y - sy * e1x,
          v = inv * (dx * qx + dy * qy + dz * qz);
        if (v <= 1e-6 || u + v >= 1 - 1e-6) continue;
        const t = inv * (e2x * qx + e2y * qy + e2z * qz);
        if (t > 1e-6 && t < 1 - 1e-6) return true;
      }
    }
    return false;
  }
  function refit(y, subset = null) {
    const active = subset || order;
    for (const t of active)
      for (let k = 0; k < 3; k++) {
        const a = y[faces[t * 3] * 3 + k],
          b = y[faces[t * 3 + 1] * 3 + k],
          c = y[faces[t * 3 + 2] * 3 + k];
        triMin[t * 3 + k] = Math.min(a, b, c);
        triMax[t * 3 + k] = Math.max(a, b, c);
      }
    function update(id) {
      const o = nodes[id];
      if (o.left < 0) {
        o.min.fill(Infinity);
        o.max.fill(-Infinity);
        for (let j = o.start; j < o.end; j++) {
          const p = order[j] * 3;
          for (let k = 0; k < 3; k++) {
            o.min[k] = Math.min(o.min[k], triMin[p + k]);
            o.max[k] = Math.max(o.max[k], triMax[p + k]);
          }
        }
      } else {
        const a = nodes[o.left],
          b = nodes[o.right];
        for (let k = 0; k < 3; k++) {
          o.min[k] = Math.min(a.min[k], b.min[k]);
          o.max[k] = Math.max(a.max[k], b.max[k]);
        }
      }
    }
    if (subset) {
      const affected = new Set();
      for (const t of subset) {
        let id = leaf[t];
        while (id >= 0 && !affected.has(id)) {
          affected.add(id);
          id = nodes[id].parent;
        }
      }
      for (const id of [...affected].sort((a, b) => b - a)) update(id);
    } else for (let id = nodes.length - 1; id >= 0; id--) update(id);
  }
  function pairs(y, subset = null) {
    refit(y, subset);
    const found = [];
    function test(a, b) {
      for (let k = 0; k < 3; k++)
        if (
          triMax[a * 3 + k] < triMin[b * 3 + k] ||
          triMax[b * 3 + k] < triMin[a * 3 + k]
        )
          return false;
      return intersects(y, a, b);
    }
    function visit(ia, ib) {
      const a = nodes[ia],
        b = nodes[ib];
      for (let k = 0; k < 3; k++)
        if (a.max[k] < b.min[k] || b.max[k] < a.min[k]) return;
      if (ia === ib) {
        if (a.left < 0) {
          for (let i = a.start; i < a.end; i++)
            for (let j = i + 1; j < a.end; j++) {
              const x = Math.min(order[i], order[j]),
                z = Math.max(order[i], order[j]);
              if (test(x, z)) found.push([x, z]);
            }
        } else {
          visit(a.left, a.left);
          visit(a.left, a.right);
          visit(a.right, a.right);
        }
        return;
      }
      if (a.left < 0 && b.left < 0) {
        for (let i = a.start; i < a.end; i++)
          for (let j = b.start; j < b.end; j++) {
            const x = Math.min(order[i], order[j]),
              z = Math.max(order[i], order[j]);
            if (test(x, z)) found.push([x, z]);
          }
      } else if (
        b.left < 0 ||
        (a.left >= 0 && a.end - a.start >= b.end - b.start)
      ) {
        visit(a.left, ib);
        visit(a.right, ib);
      } else {
        visit(ia, b.left);
        visit(ia, b.right);
      }
    }
    if (subset) {
      const visited = new Set();
      function triangleVisit(t, id) {
        const o = nodes[id];
        for (let k = 0; k < 3; k++)
          if (triMax[t * 3 + k] < o.min[k] || o.max[k] < triMin[t * 3 + k])
            return;
        if (o.left < 0) {
          for (let j = o.start; j < o.end; j++) {
            const a = Math.min(t, order[j]),
              b = Math.max(t, order[j]),
              key = a * m + b;
            if (a === b || visited.has(key)) continue;
            visited.add(key);
            if (test(a, b)) found.push([a, b]);
          }
        } else {
          triangleVisit(t, o.left);
          triangleVisit(t, o.right);
        }
      }
      for (const t of subset) triangleVisit(t, 0);
    } else visit(0, 0);
    found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return found;
  }
  const greenCache = new Map(),
    factor = c.smoothing,
    free = factor ? Uint32Array.from(factor.free) : null,
    freeIndex = new Int32Array(n).fill(-1);
  if (free) free.forEach((v, i) => (freeIndex[v] = i));
  function green(vertex) {
    if (greenCache.has(vertex)) return greenCache.get(vertex);
    const work = new Float64Array(free.length);
    work[factor.rowPermutation[freeIndex[vertex]]] = 1;
    for (const [fac, reverse] of [
      [factor.lower, false],
      [factor.upper, true],
    ])
      for (let step = 0; step < free.length; step++) {
        const row = reverse ? free.length - 1 - step : step;
        let value = work[row],
          diag = 0;
        for (let j = fac.rows[row]; j < fac.rows[row + 1]; j++) {
          const col = fac.columns[j],
            w = fac.values[j];
          if (col === row) diag = w;
          else value -= w * work[col];
        }
        work[row] = value / diag;
      }
    const out = new Float64Array(free.length);
    for (let i = 0; i < free.length; i++)
      out[i] = work[factor.columnPermutation[i]];
    greenCache.set(vertex, out);
    if (greenCache.size > 256)
      greenCache.delete(greenCache.keys().next().value);
    return out;
  }
  function smoothSchur(points, source, anchored) {
    const handles = [];
    for (let i = 0; i < n; i++) if (anchored[i] && !fixed[i]) handles.push(i);
    const size = handles.length;
    if (!size) return { iterations: 0, residual: 0 };
    const columns = handles.map(green),
      lower = new Float64Array(size * size),
      rhs = new Float64Array(size * 3);
    for (let i = 0; i < size; i++) {
      for (let k = 0; k < 3; k++)
        rhs[i * 3 + k] =
          points[handles[i] * 3 + k] - source[handles[i] * 3 + k];
      for (let j = 0; j <= i; j++) {
        let sum =
          (columns[j][freeIndex[handles[i]]] +
            columns[i][freeIndex[handles[j]]]) *
          0.5;
        for (let k = 0; k < j; k++)
          sum -= lower[i * size + k] * lower[j * size + k];
        if (i === j) {
          if (!(sum > 0))
            throw Error("Contact Schur complement lost positive definiteness");
          lower[i * size + j] = Math.sqrt(sum);
        } else lower[i * size + j] = sum / lower[j * size + j];
      }
    }
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < size; i++) {
        let value = rhs[i * 3 + k];
        for (let j = 0; j < i; j++)
          value -= lower[i * size + j] * rhs[j * 3 + k];
        rhs[i * 3 + k] = value / lower[i * size + i];
      }
      for (let i = size - 1; i >= 0; i--) {
        let value = rhs[i * 3 + k];
        for (let j = i + 1; j < size; j++)
          value -= lower[j * size + i] * rhs[j * 3 + k];
        rhs[i * 3 + k] = value / lower[i * size + i];
      }
    }
    for (let i = 0; i < free.length; i++) {
      const vertex = free[i];
      if (anchored[vertex]) continue;
      let x = 0,
        y = 0,
        z = 0;
      for (let j = 0; j < size; j++) {
        const w = columns[j][i];
        x += w * rhs[j * 3];
        y += w * rhs[j * 3 + 1];
        z += w * rhs[j * 3 + 2];
      }
      points[vertex * 3] = source[vertex * 3] + x;
      points[vertex * 3 + 1] = source[vertex * 3 + 1] + y;
      points[vertex * 3 + 2] = source[vertex * 3 + 2] + z;
    }
    return { iterations: 1, residual: 0 };
  }
  function correct(source) {
    if (
      source?.length !== rest.length ||
      !Array.from(source).every(Number.isFinite)
    )
      throw Error("肌肉细表面坐标无效。");
    const points = Float64Array.from(source),
      anchored = Uint8Array.from(fixed);
    let initial = null,
      remaining = [],
      steps = 0,
      smoothing = 0,
      queryMs = 0,
      smoothMs = 0,
      cgIterations = 0;
    const start = performance.now();
    function query(subset = null) {
      const t = performance.now(),
        result = pairs(points, subset);
      queryMs += performance.now() - t;
      return result;
    }
    for (smoothing = 0; smoothing < 4; smoothing++) {
      let dirty = null;
      for (let it = 0; it < 20; it++) {
        remaining = query(dirty);
        dirty = new Set();
        if (initial === null) initial = remaining.length;
        if (!remaining.length) break;
        for (const [ai, bi] of remaining) {
          if (!intersects(points, ai, bi)) continue;
          for (const f of [ai, bi])
            for (let j = 0; j < 3; j++) anchored[faces[f * 3 + j]] = 1;
          const a = triangle(points, ai),
            b = triangle(points, bi),
            ar = triangle(rest, ai),
            br = triangle(rest, bi),
            edges = (t) => t.map((v, i) => sub(t[(i + 1) % 3], v)),
            ea = edges(a),
            eb = edges(b),
            ear = edges(ar),
            ebr = edges(br),
            axes = [
              cross(ea[0], ea[1]),
              cross(eb[0], eb[1]),
              ...ea.flatMap((x) => eb.map((y) => cross(x, y))),
            ],
            raxis = [cross(ear[0], ear[1]), cross(ebr[0], ebr[1])];
          let best = null,
            fallback = null;
          for (let index = 0; index < axes.length; index++) {
            let axis = axes[index],
              length = Math.hypot(...axis);
            if (length < 1e-12) continue;
            axis = axis.map((v) => v / length);
            const va = a.map((v) => dot(v, axis)),
              vb = b.map((v) => dot(v, axis)),
              options = [
                [Math.max(...va) - Math.min(...vb) + 0.000005, axis],
                [
                  Math.max(...vb) - Math.min(...va) + 0.000005,
                  axis.map((v) => -v),
                ],
              ];
            for (const op of options)
              if (op[0] > 0 && (!fallback || op[0] < fallback[0]))
                fallback = op;
            if (index >= 2) continue;
            let ra = raxis[index],
              rl = Math.hypot(...ra);
            if (rl < 1e-12) continue;
            ra = ra.map((v) => v / rl);
            const pa = ar.map((v) => dot(v, ra)),
              pb = br.map((v) => dot(v, ra));
            let option = null;
            if (Math.max(...pa) < Math.min(...pb) - 1e-10) option = options[0];
            else if (Math.max(...pb) < Math.min(...pa) - 1e-10)
              option = options[1];
            if (option && option[0] > 0 && (!best || option[0] < best[0]))
              best = option;
          }
          best ??= fallback;
          if (!best) throw Error("No display contact separation axis");
          const [amount, axis] = best;
          if (amount > 0.001)
            throw Error(
              `Display contact exceeds 1 mm: ${ai}, ${bi}: ${amount}`,
            );
          let movable = bi,
            direction = 1;
          if ([0, 1, 2].some((j) => fixed[faces[bi * 3 + j]])) {
            movable = ai;
            direction = -1;
            if ([0, 1, 2].some((j) => fixed[faces[ai * 3 + j]]))
              throw Error("Display contact conflicts with fixed attachment");
          }
          for (let j = 0; j < 3; j++)
            for (let k = 0; k < 3; k++)
              points[faces[movable * 3 + j] * 3 + k] +=
                direction * amount * axis[k];
          for (let j = 0; j < 3; j++)
            for (const t of incident[faces[movable * 3 + j]]) dirty.add(t);
          steps++;
        }
      }
      if (!steps) break;
      const t = performance.now(),
        cg = smoothSchur(points, source, anchored);
      cgIterations = Math.max(cgIterations, cg.iterations);
      smoothMs += performance.now() - t;
      remaining = query();
      if (!remaining.length) break;
    }
    let max = 0,
      drift = 0;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(
        points[i * 3] - source[i * 3],
        points[i * 3 + 1] - source[i * 3 + 1],
        points[i * 3 + 2] - source[i * 3 + 2],
      );
      max = Math.max(max, d);
      if (fixed[i]) drift = Math.max(drift, d);
    }
    return {
      positions: points,
      stats: {
        initialPairs: initial,
        remainingPairs: remaining.length,
        separationSteps: steps,
        smoothingPasses: smoothing + 1,
        maxRepairMm: max * 1000,
        fixedDriftMm: drift * 1000,
        milliseconds: performance.now() - start,
        queryMs,
        smoothMs,
        cgIterations,
      },
    };
  }
  return { correct };
}

/** Return the rest-world to posed-world transform of the gracilis belly guide.
 * The path contains the native unit's current world-space sites. A wrapping
 * site may enter or leave as the knee bends, so the guide follows a fraction
 * of the entire polyline length. The femur supplies twist around its tangent.
 */
export function makeGracilisGuideMatrix(spec, path, femurRelative) {
  const finiteVector = value => value?.length === 3 && Array.from(value).every(Number.isFinite);
  const matrix = femurRelative?.elements ?? femurRelative;
  if (!Number.isFinite(spec?.arcFraction) || spec.arcFraction <= 0 || spec.arcFraction >= 1 ||
      !finiteVector(spec.restAnchor) || !finiteVector(spec.restTangent) ||
      !Array.isArray(path) || path.length < 2 || !path.every(finiteVector) ||
      matrix?.length !== 16 || !Array.from(matrix).every(Number.isFinite)) {
    throw Error('股薄肌导向缺少有效的原生路径或股骨变换。');
  }
  const segments = [];
  let totalLength = 0;
  for (let i = 1; i < path.length; ++i) {
    const delta = path[i].map((value, axis) => value - path[i - 1][axis]);
    const length = Math.hypot(...delta);
    if (length <= 1e-10) continue;
    segments.push({ start: path[i - 1], delta, length });
    totalLength += length;
  }
  if (!segments.length) throw Error('股薄肌原生路径没有可用长度。');
  let along = totalLength * spec.arcFraction;
  let segment = segments[segments.length - 1];
  for (const current of segments) {
    if (along <= current.length) { segment = current; break; }
    along -= current.length;
  }
  const targetTangent = segment.delta.map(value => value / segment.length);
  const targetAnchor = segment.start.map((value, axis) => value + along * targetTangent[axis]);
  const rotateFemur = vector => [0, 1, 2].map(row =>
    matrix[row] * vector[0] + matrix[row + 4] * vector[1] + matrix[row + 8] * vector[2]);
  const source = rotateFemur(spec.restTangent);
  const sourceLength = Math.hypot(...source);
  if (sourceLength < 1e-8) throw Error('股薄肌静止导向切线无效。');
  for (let k = 0; k < 3; ++k) source[k] /= sourceLength;
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const dot = source.reduce((sum, value, k) => sum + value * targetTangent[k], 0);
  let vector = cross(source, targetTangent), scalar = 1 + Math.max(-1, Math.min(1, dot));
  if (scalar < 1e-10) {
    vector = Math.abs(source[0]) > Math.abs(source[2]) ? [-source[1], source[0], 0] : [0, -source[2], source[1]];
    scalar = 0;
  }
  const magnitude = Math.hypot(...vector, scalar);
  vector = vector.map(value => value / magnitude);
  scalar /= magnitude;
  const align = value => {
    const first = cross(vector, value), second = cross(vector, first);
    return value.map((component, axis) => component + 2 * (scalar * first[axis] + second[axis]));
  };
  const result = new Float64Array(16);
  for (let column = 0; column < 3; ++column) {
    result.set(align([matrix[column * 4], matrix[column * 4 + 1], matrix[column * 4 + 2]]), column * 4);
  }
  const rotatedAnchor = align(rotateFemur(spec.restAnchor));
  for (let k = 0; k < 3; ++k) result[12 + k] = targetAnchor[k] - rotatedAnchor[k];
  result[15] = 1;
  return result;
}
/** Rebuild the complete gracilis display skin from its two elastic segments.
 * The native muscle supplies force separately. The shared sheet factory builds
 * each small segment. All contact corrections act on the enclosing volume.
 */
export function makeGracilisVolumeShape(contract, environment = {}) {
  const { boneVolumes, makeSegmentShape, makeVolumeGuard } = environment;
  const CLEARANCE = 0.00025;
  const fail = () => {
    throw Error("股薄肌体积形变合同无效。");
  };
  if (
    contract?.version !== 1 ||
    contract.kind !== "gracilis-guided-volume-cage" ||
    !boneVolumes?.volumes?.length ||
    typeof makeSegmentShape !== "function" ||
    typeof makeVolumeGuard !== "function"
  )
    fail();
  const data = contract.cage,
    count = contract.controlCount,
    fields = contract.controlContact?.fields;
  if (
    !Number.isInteger(count) ||
    count < 4 ||
    !data ||
    !Array.isArray(fields) ||
    fields.length !== 3 ||
    !Array.isArray(contract.segments) ||
    contract.segments.length !== 2
  )
    fail();
  const vector = (a, n) => {
    if (!a || a.length !== n) fail();
    for (const v of a) if (!Number.isFinite(v)) fail();
  };
  const indices = (a, n, minimum, maximum) => {
    vector(a, n);
    for (const v of a)
      if (!Number.isInteger(v) || v < minimum || v >= maximum) fail();
  };
  const t = data.volume?.length,
    subgroups = data.groupTets?.length,
    freeCount = data.free?.length,
    displayCount = data.skinRefs?.length / 4;
  if (
    !Number.isInteger(t) ||
    t < 1 ||
    !Number.isInteger(subgroups) ||
    subgroups < 1 ||
    !Number.isInteger(freeCount) ||
    freeCount < 1 ||
    !Number.isInteger(displayCount) ||
    displayCount < 3
  )
    fail();
  indices(data.tets, 4 * t, 0, count);
  vector(data.volume, t);
  if (data.volume.some((v) => v <= 0)) fail();
  indices(data.groups, count, -1, 1);
  indices(data.free, freeCount, 0, count);
  indices(data.freeIndex, count, -1, freeCount);
  vector(data.response, freeCount * freeCount);
  for (let i = 0; i < freeCount; i++)
    if (data.freeIndex[data.free[i]] !== i || data.groups[data.free[i]] !== -1)
      fail();
  indices(data.groupTets, subgroups, 0, t);
  vector(data.offsets, subgroups + 1);
  if (data.offsets[0] !== 0) fail();
  for (let i = 1; i < data.offsets.length; i++)
    if (
      !Number.isSafeInteger(data.offsets[i]) ||
      data.offsets[i] <= data.offsets[i - 1]
    )
      fail();
  vector(data.probeWeights, data.offsets[subgroups] * 4);
  vector(data.bounds, subgroups * 6);
  indices(data.static, t, -1, 3);
  indices(data.skinRefs, displayCount * 4, 0, count);
  vector(data.skinWeights, displayCount * 4);
  for (let cell = 0; cell < t; cell++) {
    if (data.static[cell] === -1) continue;
    if (data.static[cell] !== 0 && data.static[cell] !== 2) fail();
    for (let k = 0; k < 4; k++)
      if (data.groups[data.tets[cell * 4 + k]] < 0) fail();
  }
  for (let group = 0; group < subgroups; group++) {
    for (let p = data.offsets[group]; p < data.offsets[group + 1]; p++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        const weight = data.probeWeights[p * 4 + k];
        if (weight < -1e-6 || weight > 1 + 1e-6) fail();
        if (k && (weight < data.bounds[group * 6 + k - 1] ||
                  weight > data.bounds[group * 6 + k + 2])) fail();
        sum += weight;
      }
      if (Math.abs(sum - 1) > 1e-6) fail();
    }
  }
  for (let i = 0; i < displayCount; i++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const weight = data.skinWeights[i * 4 + k];
      if (weight < -1e-6 || weight > 1 + 1e-6) fail();
      sum += weight;
    }
    if (Math.abs(sum - 1) > 1e-6) fail();
  }
  for (const [i, field] of fields.entries()) {
    if (
      !field ||
      field.name !== contract.controlContact.bones[i] ||
      field.block !== 2 ||
      !boneVolumes.volumes.some((v) => v.name === field.name)
    )
      fail();
    vector(field.origin, 3);
    vector(field.spacing, 3);
    indices(field.dims, 3, 2, 16384);
    indices(field.blocks, 3, 1, 8193);
    if (
      field.spacing.some((x) => x <= 0) ||
      field.blocks.some((n, k) => n !== Math.ceil(field.dims[k] / 2))
    )
      fail();
    indices(
      data[field.key],
      Math.ceil(field.blocks.reduce((a, b) => a * b, 1) / 8),
      0,
      256,
    );
  }
  // B R^-1 Bᵀ is formed only for active constraints. B has at most four nonzero
  // entries per row because every contact sample belongs to one volume element.
  function elasticStep(data, rows, controls) {
    const n = data.free.length,
      m = rows.length;
    const response = new Float64Array(n * m),
      gram = new Float64Array(m * m),
      rhs = new Float64Array(m * 3);
    for (let j = 0; j < m; ++j) {
      const row = rows[j];
      for (let k = 0; k < 4; ++k) {
        const column = data.freeIndex[data.tets[row.tet * 4 + k]];
        if (column < 0) continue;
        const weight = data.probeWeights[row.probe * 4 + k];
        for (let i = 0; i < n; ++i)
          response[j * n + i] += weight * data.response[column * n + i];
      }
      rhs.set(row.delta, j * 3);
    }
    for (let i = 0; i < m; ++i) {
      for (let j = 0; j <= i; ++j) {
        let value = i === j ? 1 : 0;
        for (let k = 0; k < 4; ++k) {
          const index = data.freeIndex[data.tets[rows[i].tet * 4 + k]];
          if (index >= 0)
            value +=
              data.probeWeights[rows[i].probe * 4 + k] *
              response[j * n + index];
        }
        for (let k = 0; k < j; ++k) value -= gram[i * m + k] * gram[j * m + k];
        gram[i * m + j] = i === j ? Math.sqrt(value) : value / gram[j * m + j];
        if (!Number.isFinite(gram[i * m + j]))
          throw Error("股薄肌接触方程无有限解");
      }
    }
    for (let i = 0; i < m; ++i)
      for (let a = 0; a < 3; ++a) {
        let x = rhs[i * 3 + a];
        for (let k = 0; k < i; ++k) x -= gram[i * m + k] * rhs[k * 3 + a];
        rhs[i * 3 + a] = x / gram[i * m + i];
      }
    for (let i = m - 1; i >= 0; --i)
      for (let a = 0; a < 3; ++a) {
        let x = rhs[i * 3 + a];
        for (let k = i + 1; k < m; ++k) x -= gram[k * m + i] * rhs[k * 3 + a];
        rhs[i * 3 + a] = x / gram[i * m + i];
      }
    const movement = new Float64Array(n * 3);
    let maximum = 0;
    for (let i = 0; i < n; ++i) {
      for (let j = 0; j < m; ++j) {
        const w = response[j * n + i];
        for (let a = 0; a < 3; ++a) movement[i * 3 + a] += w * rhs[j * 3 + a];
      }
      maximum = Math.max(
        maximum,
        Math.hypot(movement[i * 3], movement[i * 3 + 1], movement[i * 3 + 2]),
      );
    }
    const scale = Math.min(1, 0.002 / Math.max(maximum, 1e-12));
    for (let i = 0; i < n; ++i)
      for (let a = 0; a < 3; ++a)
        controls[data.free[i] * 3 + a] += scale * movement[i * 3 + a];
  }

  function denseField(compact, name) {
    const m = compact.manifest,
      src = new Float32Array(compact.buffer),
      b = m.bones.find((x) => x.name === name);
    const [nx, ny, nz] = b.dimensions,
      values = new Float32Array(nx * ny * nz),
      bs = m.brickSize;
    for (let z = 0; z < nz; z++)
      for (let y = 0; y < ny; y++)
        for (let x = 0; x < nx; x++) {
          const n = x + nx * (y + ny * z);
          if (m.storage !== "sparse-bricks") {
            values[n] = src[b.floatOffset + n];
            continue;
          }
          const i =
            src[
              b.lookupOffset +
                Math.floor(x / bs) +
                b.brickDimensions[0] *
                  (Math.floor(y / bs) +
                    b.brickDimensions[1] * Math.floor(z / bs))
            ];
          values[n] =
            i < 0
              ? m.outsideDistanceM
              : src[
                  m.brickDataOffset +
                    i * bs ** 3 +
                    (x % bs) +
                    bs * ((y % bs) + bs * (z % bs))
                ];
        }
    return values;
  }
  function sampleDistance(field, x, y, z) {
    const [nx, ny, nz] = field.dims;
    if (x < 0 || y < 0 || z < 0 || x > nx - 1 || y > ny - 1 || z > nz - 1)
      return Infinity;
    const i = Math.min(nx - 2, Math.floor(x)),
      j = Math.min(ny - 2, Math.floor(y)),
      k = Math.min(nz - 2, Math.floor(z));
    const u = x - i,
      v = y - j,
      w = z - k,
      n = i + nx * (j + ny * k),
      plane = nx * ny,
      f = field.grid;
    const a = f[n] + u * (f[n + 1] - f[n]),
      b = f[n + nx] + u * (f[n + nx + 1] - f[n + nx]);
    const c = f[n + plane] + u * (f[n + plane + 1] - f[n + plane]),
      d = f[n + plane + nx] + u * (f[n + plane + nx + 1] - f[n + plane + nx]);
    const lo = a + v * (b - a),
      hi = c + v * (d - c);
    return lo + w * (hi - lo);
  }
  function containsOccupiedBlock(field, mask, lower, upper) {
    const nx = field.dims[0],
      ny = field.dims[1],
      nz = field.dims[2];
    if (
      upper[0] < 0 ||
      upper[1] < 0 ||
      upper[2] < 0 ||
      lower[0] > nx - 1 ||
      lower[1] > ny - 1 ||
      lower[2] > nz - 1
    )
      return false;
    const x0 = Math.max(0, Math.floor(lower[0]) >> 1),
      y0 = Math.max(0, Math.floor(lower[1]) >> 1),
      z0 = Math.max(0, Math.floor(lower[2]) >> 1);
    const x1 = Math.min(field.blocks[0] - 1, Math.ceil(upper[0]) >> 1),
      y1 = Math.min(field.blocks[1] - 1, Math.ceil(upper[1]) >> 1),
      z1 = Math.min(field.blocks[2] - 1, Math.ceil(upper[2]) >> 1);
    for (let x = x0; x <= x1; ++x)
      for (let y = y0; y <= y1; ++y) {
        const start = (x * field.blocks[1] + y) * field.blocks[2];
        for (let z = z0; z <= z1; ++z) {
          const bit = start + z;
          if (mask[bit >> 3] & (1 << (bit & 7))) return true;
        }
      }
    return false;
  }
  function createCageBoneContact(meta, data, boneVolumes) {
    const controlCount = data.groups.length,
      local = new Float64Array(controlCount * 3),
      worldPoint = boneVolumes.volumes[0].bounds.min.clone(),
      transformed = worldPoint.clone(),
      inverse = boneVolumes.volumes[0].matrix.clone();
    const guard = makeVolumeGuard({
      version: 1,
      kind: "source-muscle-positive-volume",
      controlCount,
      tetrahedra: data.tets,
      volumes: data.volume,
      minimumRatio: 0.2,
      iterations: 64,
      maxStepM: 0.0005,
    });
    const compact = boneVolumes.exportSubset(meta.fields.map((x) => x.name));
    const fields = meta.fields.map((field) => ({
      ...field,
      grid: denseField(compact, field.name),
      volume: boneVolumes.volumes.find((v) => v.name === field.name),
      mask: data[field.key],
    }));
    const lower = new Float64Array(3),
      upper = new Float64Array(3),
      vertex = new Int32Array(4);
    function constraints(controls, masks = null) {
      const rows = [];
      for (let b = 0; b < fields.length; ++b) {
        if (masks && !masks[b]?.size) continue;
        const field = fields[b];
        inverse.copy(field.volume.matrix).invert();
        for (let i = 0; i < controlCount; ++i) {
          transformed.fromArray(controls, i * 3).applyMatrix4(inverse);
          local[i * 3] = (transformed.x - field.origin[0]) / field.spacing[0];
          local[i * 3 + 1] =
            (transformed.y - field.origin[1]) / field.spacing[1];
          local[i * 3 + 2] =
            (transformed.z - field.origin[2]) / field.spacing[2];
        }
        const deepest = new Float64Array(data.volume.length);
        deepest.fill(CLEARANCE - 1e-7);
        const selected = new Int32Array(data.volume.length);
        selected.fill(-1);
        for (let g = 0; g < data.groupTets.length; ++g) {
          const tet = data.groupTets[g];
          if (data.static[tet] === b || (masks && !masks[b].has(tet))) continue;
          for (let k = 0; k < 4; ++k) vertex[k] = data.tets[tet * 4 + k] * 3;
          for (let a = 0; a < 3; ++a) {
            let lo = local[vertex[0] + a] - 1e-4,
              hi = local[vertex[0] + a] + 1e-4;
            for (let k = 1; k < 4; ++k) {
              const delta = local[vertex[k] + a] - local[vertex[0] + a],
                x = delta * data.bounds[g * 6 + k - 1],
                y = delta * data.bounds[g * 6 + k + 2];
              lo += Math.min(x, y);
              hi += Math.max(x, y);
            }
            lower[a] = lo;
            upper[a] = hi;
          }
          if (!containsOccupiedBlock(field, field.mask, lower, upper)) continue;
          for (let p = data.offsets[g]; p < data.offsets[g + 1]; ++p) {
            const at = p * 4;
            let x = 0,
              y = 0,
              z = 0;
            for (let k = 0; k < 4; ++k) {
              const weight = data.probeWeights[at + k],
                v = vertex[k];
              x += weight * local[v];
              y += weight * local[v + 1];
              z += weight * local[v + 2];
            }
            const distance = sampleDistance(field, x, y, z);
            if (distance >= deepest[tet]) continue;
            deepest[tet] = distance;
            selected[tet] = p;
          }
        }
        for (let t = 0; t < selected.length; ++t)
          if (selected[t] >= 0) {
            const p = selected[t];
            let x = 0,
              y = 0,
              z = 0;
            for (let k = 0; k < 4; k++) {
              const i = data.tets[t * 4 + k] * 3,
                w = data.probeWeights[p * 4 + k];
              x += w * controls[i];
              y += w * controls[i + 1];
              z += w * controls[i + 2];
            }
            const hit = boneVolumes.sample(
                field.volume.index,
                worldPoint.set(x, y, z),
              ),
              scale = Math.min(
                0.001,
                (CLEARANCE - hit.distance + 1e-5) /
                  Math.max(hit.gradientLength, 0.25),
              );
            rows.push({
              bone: b,
              tet: t,
              probe: p,
              delta: [
                hit.normal.x * scale,
                hit.normal.y * scale,
                hit.normal.z * scale,
              ],
            });
          }
      }
      return rows;
    }
    return {
      correct(controls) {
        let active = null;
        for (let iteration = 0; iteration < 128; ++iteration) {
          const rows = constraints(controls, active);
          if (!rows.length) {
            if (!active) {
              if (guard.inspect(controls, {groups: data.groups}).invertedCount)
                throw Error("股薄肌体积单元倒置，无法显示当前姿势。");
              return;
            }
            active = null;
            continue;
          }
          if (!active) active = fields.map(() => new Set());
          for (const r of rows) active[r.bone].add(r.tet);
          elasticStep(data, rows, controls);
          guard.guard(controls, { groups: data.groups });
        }
        throw Error("股薄肌骨接触 128 轮仍未收敛");
      },
      embed(controls, out = new Float32Array((data.skinRefs.length / 4) * 3)) {
        for (let i = 0; i < out.length / 3; i++)
          for (let a = 0; a < 3; a++) {
            let x = 0;
            for (let k = 0; k < 4; k++)
              x +=
                data.skinWeights[i * 4 + k] *
                controls[data.skinRefs[i * 4 + k] * 3 + a];
            out[i * 3 + a] = x;
          }
        return out;
      },
    };
  }

  const core = createCageBoneContact({ fields }, data, boneVolumes);
  const controls = new Float64Array(count * 3),
    covered = new Uint8Array(count),
    positions = new Float32Array(displayCount * 3);
  const segments = contract.segments.map((segment) => {
    const engine = makeSegmentShape(segment.contract);
    indices(segment.ids, segment.contract.controlRest.length / 3, 0, count);
    if (new Set(segment.ids).size !== segment.ids.length) fail();
    for (let i = 0; i < segment.ids.length; i++) {
      const id = segment.ids[i];
      covered[id] = 1;
      for (let k = 0; k < 3; k++)
        controls[3 * id + k] = segment.contract.controlRest[3 * i + k];
    }
    return { ids: segment.ids, engine };
  });
  if (covered.includes(0)) fail();
  core.embed(controls, positions);
  function update(relative) {
    for (const { ids, engine } of segments) {
      engine.update(relative);
      for (let i = 0; i < ids.length; i++)
        for (let k = 0; k < 3; k++)
          controls[3 * ids[i] + k] = engine.controlPositions[3 * i + k];
    }
    core.correct(controls);
    return core.embed(controls, positions);
  }
  return { positions, update, controlPositions: controls };
}

export function createCrossSections(fiber) {
  const restOrigin = new Vector3().fromArray(fiber.proximal);
  const restDistal = new Vector3().fromArray(fiber.distal);
  const restAxis = restDistal.clone().sub(restOrigin).normalize();
  const restNormal = new Vector3(Math.abs(restAxis.x) < .8 ? 1 : 0, Math.abs(restAxis.x) < .8 ? 0 : 1, 0);
  restNormal.addScaledVector(restAxis, -restNormal.dot(restAxis)).normalize();
  return {
    restOrigin, restDistal, restAxis, restNormal, restLength: fiber.restLength,
    restBinormal: new Vector3().crossVectors(restAxis, restNormal),
    p0: restOrigin.clone(), p1: restDistal.clone(),
    t0: restAxis.clone().multiplyScalar(fiber.restLength), t1: restAxis.clone().multiplyScalar(fiber.restLength),
    n0: restNormal.clone(), n1: restNormal.clone(),
  };
}

export function poseCrossSections(c, proximalBone, distalBone) {
  c.p0.copy(c.restOrigin).applyMatrix4(proximalBone);
  c.p1.copy(c.restDistal).applyMatrix4(distalBone);
  const length = c.p0.distanceTo(c.p1);
  c.t0.copy(c.restAxis).transformDirection(proximalBone).multiplyScalar(length);
  c.t1.copy(c.restAxis).transformDirection(distalBone).multiplyScalar(length);
  c.n0.copy(c.restNormal).transformDirection(proximalBone);
  c.n1.copy(c.restNormal).transformDirection(distalBone);
  return 1 / Math.sqrt(MathUtils.clamp(length / c.restLength, .6, 1.65));
}

const tangent = new Vector3(), guide = new Vector3(), binormal = new Vector3(), offset = new Vector3();
const plus = new Vector3(), minus = new Vector3(), cross = new Vector3();

function section(c, u, x, y, result) {
  const u2 = u * u, u3 = u2 * u;
  tangent.copy(c.p0).multiplyScalar(6*u2 - 6*u).addScaledVector(c.t0, 3*u2 - 4*u + 1)
    .addScaledVector(c.p1, 6*u - 6*u2).addScaledVector(c.t1, 3*u2 - 2*u).normalize();
  guide.copy(c.n0).lerp(c.n1, u);
  guide.addScaledVector(tangent, -guide.dot(tangent));
  if (guide.lengthSq() < 1e-10) {
    guide.set(Math.abs(tangent.x) < .8 ? 1 : 0, Math.abs(tangent.x) < .8 ? 0 : 1, 0);
    guide.addScaledVector(tangent, -guide.dot(tangent));
  }
  guide.normalize();
  binormal.crossVectors(tangent, guide).normalize();
  return result.copy(c.p0).multiplyScalar(2*u3 - 3*u2 + 1).addScaledVector(c.t0, u3 - 2*u2 + u)
    .addScaledVector(c.p1, 3*u2 - 2*u3).addScaledVector(c.t1, u3 - u2)
    .addScaledVector(guide, x).addScaledVector(binormal, y);
}

// Input and output positions may be the same vector. Optional normals follow
// the fine atlas shader's central-difference Jacobian (0.001 of rest length).
export function deformCrossSection(c, position, result, sourceNormal, normalOut) {
  offset.copy(position).sub(c.restOrigin);
  const u = offset.dot(c.restAxis) / c.restLength;
  const x = offset.dot(c.restNormal), y = offset.dot(c.restBinormal);
  if (normalOut) {
    section(c, u + .001, x, y, plus);
    section(c, u - .001, x, y, minus);
    plus.sub(minus).multiplyScalar(1 / (.002 * c.restLength));
  }
  section(c, u, x, y, result);
  if (normalOut) {
    const a = sourceNormal.dot(c.restAxis), n = sourceNormal.dot(c.restNormal), b = sourceNormal.dot(c.restBinormal);
    cross.crossVectors(guide, binormal);
    const determinant = plus.dot(cross);
    if (Math.abs(determinant) > 1e-7) {
      normalOut.copy(cross).multiplyScalar(a)
        .addScaledVector(cross.crossVectors(binormal, plus), n)
        .addScaledVector(cross.crossVectors(plus, guide), b).multiplyScalar(1 / determinant).normalize();
    } else {
      normalOut.copy(tangent).multiplyScalar(a).addScaledVector(guide, n).addScaledVector(binormal, b).normalize();
    }
  }
  return result;
}

