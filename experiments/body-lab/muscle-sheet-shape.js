import * as THREE from "../../src/vendor/three.js";
import { makeDisplayContact, makeGracilisVolumeShape } from "./muscle-path-shape.js";

// Atlas display deformation only. The muscle paths/actuators/force solver are
// intentionally outside this module. Matrices are current * inverse(rest).
function matrixElements(value) {
  const elements = value?.elements || value;
  if (!elements || elements.length !== 16) throw Error("缺少肌肉形变骨矩阵。");
  return elements;
}

function transform(m, x, y, z, out, offset = 0) {
  out[offset] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[offset + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[offset + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

function rotation(q, out, offset) {
  const scale = 1 / Math.hypot(q[0], q[1], q[2], q[3]);
  const x = q[0] * scale,
    y = q[1] * scale,
    z = q[2] * scale,
    w = q[3] * scale;
  out[offset] = 1 - 2 * (y * y + z * z);
  out[offset + 1] = 2 * (x * y - z * w);
  out[offset + 2] = 2 * (x * z + y * w);
  out[offset + 3] = 2 * (x * y + z * w);
  out[offset + 4] = 1 - 2 * (x * x + z * z);
  out[offset + 5] = 2 * (y * z - x * w);
  out[offset + 6] = 2 * (x * z - y * w);
  out[offset + 7] = 2 * (y * z + x * w);
  out[offset + 8] = 1 - 2 * (x * x + y * y);
}

/** Prepare one broad muscle once. update(relativeMatrices) returns a reused
 * Float32Array of world-space display vertices. A Map or name-keyed object is
 * accepted; each value is a column-major 4x4 array or THREE.Matrix4.
 * `correctControls`, when supplied, receives the solved low-frequency control
 * positions before their displacement is spread smoothly over the surface.
 * The contact layer must preserve corrected rest attachment registrations.
 */
export function makeMuscleSheetShape(contract, environment = {}) {
  if (contract?.kind === "gracilis-guided-volume-cage")
    return makeGracilisVolumeShape(contract, { ...environment, makeSegmentShape: makeMuscleSheetShape, makeVolumeGuard });
  if (contract?.continuation)
    return makeContinuationSheet(contract, environment);
  if (contract?.kind === "arap-embedded-sheet")
    return makeArapEmbeddedSheet(contract, environment);
  if (contract?.kind === "reduced-poisson-sheet")
    return makeReducedPoissonSheet(contract);
  if (contract?.kind === "fiber-sheet") return makeFiberSheetShape(contract);
  if (contract?.version !== 1 || contract.kind !== "poisson-sheet") {
    throw Error("不支持的宽肌连续形变合同。");
  }
  const rest = Float64Array.from(contract.controlRest);
  const display = Float64Array.from(contract.displayRest);
  const count = rest.length / 3,
    displayCount = display.length / 3;
  const free = Uint32Array.from(contract.free),
    fixed = Uint32Array.from(contract.fixed);
  const fixedBone = Uint8Array.from(contract.fixedBone);
  const operator = contract.operator;
  if (operator?.kind !== "sparse-lu") throw Error("宽肌缺少固定稀疏分解。");
  const readFactor = (record) => ({
    rows: Uint32Array.from(record.rowPointers),
    columns: Uint32Array.from(record.columns),
    values: Float64Array.from(record.values),
  });
  const lower = readFactor(operator.lower),
    upper = readFactor(operator.upper);
  const permR = Uint32Array.from(operator.rowPermutation),
    permC = Uint32Array.from(operator.columnPermutation);
  const edges = Uint32Array.from(contract.edges),
    edgeWeight = Float64Array.from(contract.edgeWeight);
  const parameter = Float64Array.from(contract.parameter);
  const attachment = Float64Array.from(contract.displayAttachment || []);
  const proximalCount = contract.bones.length - 1;
  const startWeights = contract.startWeights
    ? Float64Array.from(contract.startWeights)
    : new Float64Array(count).fill(1);
  const displayStartWeights = contract.displayStartWeights
    ? Float64Array.from(contract.displayStartWeights)
    : new Float64Array(displayCount).fill(1);
  const transferIndices = Uint32Array.from(contract.transferIndices);
  const transferWeights = Float64Array.from(contract.transferWeights),
    width = contract.transferWidth;
  if (
    rest.length % 3 ||
    display.length % 3 ||
    parameter.length !== count ||
    fixedBone.length !== fixed.length ||
    lower.rows.length !== free.length + 1 ||
    upper.rows.length !== free.length + 1 ||
    permR.length !== free.length ||
    permC.length !== free.length ||
    edges.length !== edgeWeight.length * 2 ||
    transferIndices.length !== displayCount * width ||
    transferWeights.length !== transferIndices.length ||
    attachment.length !== displayCount * 2 ||
    startWeights.length !== count * proximalCount ||
    displayStartWeights.length !== displayCount * proximalCount ||
    !Number.isFinite(contract.restLength) ||
    contract.restLength <= 0 ||
    ![
      ...rest,
      ...display,
      ...lower.values,
      ...upper.values,
      ...edgeWeight,
      ...transferWeights,
      ...parameter,
      ...attachment,
    ].every(Number.isFinite) ||
    [...free, ...fixed, ...edges, ...transferIndices].some((i) => i >= count)
  ) {
    throw Error("宽肌连续形变数组无效。");
  }
  const isFixed = new Uint8Array(count);
  for (const i of fixed) isFixed[i] = 1;
  const current = new Float64Array(rest.length),
    rhs = new Float64Array(rest.length);
  const solution = new Float64Array(free.length * 3);
  const reference = new Float64Array(rest.length),
    rotations = new Float64Array(count * 9);
  const positions = new Float32Array(display.length);
  const c0 = contract.centerStart,
    c1 = contract.centerEnd;
  const axis = c1.map((value, i) => (value - c0[i]) / contract.restLength);
  const moved0 = new Float64Array(3),
    moved1 = new Float64Array(3);
  const matrix = new THREE.Matrix4(),
    quaternion = new THREE.Quaternion();
  const q0 = new Float64Array(4),
    q1 = new Float64Array(4),
    q = new Float64Array(4);
  const boneQuaternions = contract.bones.map(() => new Float64Array(4));
  const transformed = new Float64Array(3);
  function update(relativeMatrices, correctControls) {
    const matrices = contract.bones.map((name) =>
      matrixElements(
        relativeMatrices instanceof Map
          ? relativeMatrices.get(name)
          : relativeMatrices[name],
      ),
    );
    moved0.fill(0);
    moved1.fill(0);
    let startCount = 0,
      endCount = 0;
    for (let n = 0; n < fixed.length; n++) {
      const index = fixed[n],
        p = index * 3;
      current[p] = current[p + 1] = current[p + 2] = 0;
      if (fixedBone[n]) {
        transform(
          matrices[proximalCount],
          rest[p],
          rest[p + 1],
          rest[p + 2],
          current,
          p,
        );
        for (let k = 0; k < 3; k++) moved1[k] += current[p + k];
        endCount++;
      } else {
        for (let b = 0; b < proximalCount; b++) {
          transform(
            matrices[b],
            rest[p],
            rest[p + 1],
            rest[p + 2],
            transformed,
          );
          const w = startWeights[index * proximalCount + b];
          for (let k = 0; k < 3; k++) current[p + k] += w * transformed[k];
        }
        for (let k = 0; k < 3; k++) moved0[k] += current[p + k];
        startCount++;
      }
    }
    for (let k = 0; k < 3; k++) {
      moved0[k] /= startCount;
      moved1[k] /= endCount;
    }
    const ratio = Math.min(
      2,
      Math.max(
        0.35,
        Math.hypot(...moved0.map((v, i) => moved1[i] - v)) /
          contract.restLength,
      ),
    );
    const transverse = 1 / Math.sqrt(ratio);
    matrices.forEach((m, b) => {
      quaternion
        .setFromRotationMatrix(matrix.fromArray(m))
        .toArray(boneQuaternions[b]);
      if (
        boneQuaternions[b].reduce(
          (sum, v, k) => sum + v * boneQuaternions[0][k],
          0,
        ) < 0
      ) {
        for (let k = 0; k < 4; k++) boneQuaternions[b][k] *= -1;
      }
    });
    rhs.fill(0);
    for (let i = 0; i < count; i++) {
      const p = i * 3,
        x = rest[p] - c0[0],
        y = rest[p + 1] - c0[1],
        z = rest[p + 2] - c0[2];
      const axial = x * axis[0] + y * axis[1] + z * axis[2];
      reference[p] = x * transverse + axis[0] * axial * (ratio - transverse);
      reference[p + 1] =
        y * transverse + axis[1] * axial * (ratio - transverse);
      reference[p + 2] =
        z * transverse + axis[2] * axial * (ratio - transverse);
      q0.fill(0);
      q1.set(boneQuaternions[proximalCount]);
      for (let b = 0; b < proximalCount; b++) {
        const weight = startWeights[i * proximalCount + b];
        for (let k = 0; k < 4; k++) q0[k] += weight * boneQuaternions[b][k];
      }
      const magnitude = Math.hypot(q0[0], q0[1], q0[2], q0[3]);
      for (let k = 0; k < 4; k++) q0[k] /= magnitude;
      if (q0[0] * q1[0] + q0[1] * q1[1] + q0[2] * q1[2] + q0[3] * q1[3] < 0) {
        for (let k = 0; k < 4; k++) q1[k] *= -1;
      }
      for (let k = 0; k < 4; k++)
        q[k] = q0[k] * (1 - parameter[i]) + q1[k] * parameter[i];
      rotation(q, rotations, i * 9);
    }
    for (let n = 0; n < edgeWeight.length; n++) {
      const a = edges[n * 2],
        b = edges[n * 2 + 1],
        ai = a * 3,
        bi = b * 3;
      const x = reference[ai] - reference[bi],
        y = reference[ai + 1] - reference[bi + 1];
      const z = reference[ai + 2] - reference[bi + 2],
        w = edgeWeight[n];
      for (let k = 0; k < 3; k++) {
        const ra = a * 9 + k * 3,
          rb = b * 9 + k * 3;
        const value =
          0.5 *
          w *
          ((rotations[ra] + rotations[rb]) * x +
            (rotations[ra + 1] + rotations[rb + 1]) * y +
            (rotations[ra + 2] + rotations[rb + 2]) * z);
        rhs[ai + k] += value;
        rhs[bi + k] -= value;
        if (!isFixed[a] && isFixed[b]) rhs[ai + k] += w * current[bi + k];
        if (!isFixed[b] && isFixed[a]) rhs[bi + k] += w * current[ai + k];
      }
    }
    for (let i = 0; i < free.length; i++) {
      const source = free[i] * 3,
        target = permR[i] * 3;
      solution[target] = rhs[source];
      solution[target + 1] = rhs[source + 1];
      solution[target + 2] = rhs[source + 2];
    }
    for (const [factor, forward] of [
      [lower, true],
      [upper, false],
    ]) {
      for (let step = 0; step < free.length; step++) {
        const row = forward ? step : free.length - step - 1,
          target = row * 3;
        let diagonal = 0,
          x = solution[target],
          y = solution[target + 1],
          z = solution[target + 2];
        for (let j = factor.rows[row]; j < factor.rows[row + 1]; j++) {
          const column = factor.columns[j],
            value = factor.values[j];
          if (column === row) diagonal = value;
          else {
            x -= value * solution[column * 3];
            y -= value * solution[column * 3 + 1];
            z -= value * solution[column * 3 + 2];
          }
        }
        solution[target] = x / diagonal;
        solution[target + 1] = y / diagonal;
        solution[target + 2] = z / diagonal;
      }
    }
    for (let i = 0; i < free.length; i++) {
      const target = free[i] * 3,
        source = permC[i] * 3;
      current[target] = solution[source];
      current[target + 1] = solution[source + 1];
      current[target + 2] = solution[source + 2];
    }
    if (correctControls)
      correctControls(current, { isFixed, fixedBone, fixed, contract });
    if (contract.displayIdentity) {
      positions.set(current);
      return positions;
    }
    for (let i = 0; i < displayCount; i++) {
      const p = i * 3;
      let x = display[p],
        y = display[p + 1],
        z = display[p + 2];
      for (let k = 0; k < width; k++) {
        const n = i * width + k,
          ci = transferIndices[n] * 3,
          w = transferWeights[n];
        x += w * (current[ci] - rest[ci]);
        y += w * (current[ci + 1] - rest[ci + 1]);
        z += w * (current[ci + 2] - rest[ci + 2]);
      }
      const a0 = attachment[i * 2],
        a1 = attachment[i * 2 + 1],
        middle = 1 - a0 - a1;
      positions[p] = middle * x;
      positions[p + 1] = middle * y;
      positions[p + 2] = middle * z;
      for (let b = 0; b <= proximalCount; b++) {
        const a =
          b === proximalCount
            ? a1
            : a0 * displayStartWeights[i * proximalCount + b];
        if (!a) continue;
        const m = matrices[b],
          rx = display[p],
          ry = display[p + 1],
          rz = display[p + 2];
        positions[p] += a * (m[0] * rx + m[4] * ry + m[8] * rz + m[12]);
        positions[p + 1] += a * (m[1] * rx + m[5] * ry + m[9] * rz + m[13]);
        positions[p + 2] += a * (m[2] * rx + m[6] * ry + m[10] * rz + m[14]);
      }
    }
    return positions;
  }
  return { update, positions, controlPositions: current, contract };
}

/** Deterministic numerical loading, rebuilt from rest for every requested pose.
 * Intermediate screw transforms select a bending branch. They are solver steps,
 * not additional anatomical keyframes or a claim about the native joint path.
 */
export function makeContinuationSheet(contract, environment = {}) {
  const options = contract.continuation;
  if (
    contract.kind !== "arap-embedded-sheet" ||
    contract.embeddingMethod !== "barycentric" ||
    !contract.bending ||
    !contract.volumeGuard ||
    contract.edgeSeparation ||
    contract.controlContact ||
    options?.version !== 1 ||
    options.kind !== "screw-boundary-loading" ||
    !Number.isInteger(options.steps) ||
    options.steps < 1 ||
    options.steps > 16 ||
    !Number.isInteger(options.bendingIterations) ||
    options.bendingIterations < 1 ||
    options.bendingIterations > 32 ||
    !Number.isInteger(options.guardIterations) ||
    options.guardIterations < 1 ||
    options.guardIterations > 64
  )
    throw Error("宽肌分步加载合同无效。");
  const inner = {
    ...contract,
    continuation: undefined,
    bending: { ...contract.bending, iterations: options.bendingIterations },
    volumeGuard: {
      ...contract.volumeGuard,
      iterations: options.guardIterations,
    },
  };
  const engine = makeArapEmbeddedSheet(inner, environment);
  const guard = makeVolumeGuard(contract.volumeGuard);
  const groups = new Int8Array(contract.controlRest.length / 3).fill(-1);
  contract.fixed.forEach((index, i) => (groups[index] = contract.fixedBone[i]));
  const transforms = contract.bones.map(() => ({
    matrix: new THREE.Matrix4(),
    rotation: new THREE.Quaternion(),
    translation: new THREE.Vector3(),
    pivot: new THREE.Vector3(),
    parallel: new THREE.Vector3(),
    hasPivot: false,
  }));
  const scale = new THREE.Vector3(),
    axis = new THREE.Vector3(),
    perpendicular = new THREE.Vector3();
  const q = new THREE.Quaternion(),
    translation = new THREE.Vector3(),
    unit = new THREE.Vector3(1, 1, 1);
  const relativeSteps = new Map(
    contract.bones.map((name) => [name, new THREE.Matrix4()]),
  );
  const positions = new Float32Array(contract.displayRest.length);
  function update(relative, correctControls) {
    contract.bones.forEach((name, i) => {
      const record = transforms[i];
      const elements = matrixElements(
        relative instanceof Map ? relative.get(name) : relative[name],
      );
      if (!Array.from(elements).every(Number.isFinite))
        throw Error("分步加载收到非有限骨矩阵。");
      record.matrix.fromArray(elements);
      record.matrix.decompose(record.translation, record.rotation, scale);
      if (
        Math.max(
          Math.abs(scale.x - 1),
          Math.abs(scale.y - 1),
          Math.abs(scale.z - 1),
        ) > 1e-5
      )
        throw Error("分步加载只接受刚性骨变换。");
      const rotation = record.rotation;
      if (rotation.w < 0)
        rotation.set(-rotation.x, -rotation.y, -rotation.z, -rotation.w);
      const sine = Math.hypot(rotation.x, rotation.y, rotation.z);
      record.parallel.copy(record.translation);
      record.hasPivot = sine > 1e-8;
      if (record.hasPivot) {
        axis.set(rotation.x, rotation.y, rotation.z).divideScalar(sine);
        record.parallel.copy(axis).multiplyScalar(record.translation.dot(axis));
        perpendicular.copy(record.translation).sub(record.parallel);
        record.pivot
          .copy(perpendicular)
          .addScaledVector(axis.cross(perpendicular), rotation.w / sine)
          .multiplyScalar(0.5);
      }
    });
    for (let step = 0; step <= options.steps; step++) {
      const fraction = step / options.steps;
      contract.bones.forEach((name, i) => {
        const record = transforms[i],
          matrix = relativeSteps.get(name);
        if (step === options.steps) {
          matrix.copy(record.matrix);
          return;
        }
        q.identity().slerp(record.rotation, fraction);
        if (record.hasPivot)
          translation
            .copy(record.pivot)
            .applyQuaternion(q)
            .negate()
            .add(record.pivot)
            .addScaledVector(record.parallel, fraction);
        else translation.copy(record.translation).multiplyScalar(fraction);
        matrix.compose(translation, q, unit);
      });
      engine.update(relativeSteps, undefined, step > 0);
    }
    if (correctControls)
      correctControls(engine.controlPositions, { groups, contract });
    guard.guard(engine.controlPositions, { groups });
    return embedBarycentric(engine.controlPositions, contract, positions);
  }
  return {
    update,
    positions,
    controlPositions: engine.controlPositions,
    get volumeStats() {
      return guard.stats;
    },
    get lastUpdateMaxM() {
      return engine.lastUpdateMaxM;
    },
  };
}

/** Fine-grid Poisson response evaluated with 13 smooth rotation samples.
 * The large spatial solve was performed offline; every attachment stays exact
 * and every other display vertex retains its fine-grid response. This avoids
 * both a coarse MLS end blend and per-frame sparse triangular substitution.
 */
export function makeReducedPoissonSheet(contract) {
  const rest = Float64Array.from(contract.controlRest);
  const free = Uint32Array.from(contract.free),
    fixed = Uint32Array.from(contract.fixed);
  const fixedBone = Uint8Array.from(contract.fixedBone);
  const response = Float32Array.from(contract.response),
    columns = contract.responseColumns;
  const knots = Float64Array.from(contract.knots),
    count = rest.length / 3;
  if (
    contract.version !== 1 ||
    contract.bones.length !== 2 ||
    rest.length % 3 ||
    columns !== knots.length * 6 + 8 ||
    response.length !== free.length * columns ||
    fixed.length !== fixedBone.length ||
    free.length + fixed.length !== count ||
    ![...rest, ...response, ...knots].every(Number.isFinite) ||
    [...free, ...fixed].some((i) => i >= count) ||
    fixedBone.some((b) => b > 1) ||
    !Number.isFinite(contract.restLength) ||
    contract.restLength <= 0
  ) {
    throw Error("细网格肌肉响应合同无效。");
  }
  const coefficients = new Float64Array(columns * 3),
    positions = new Float32Array(rest.length);
  const isFixed = new Uint8Array(count);
  for (const index of fixed) isFixed[index] = 1;
  const matrix = new THREE.Matrix4(),
    q0 = new THREE.Quaternion(),
    q1 = new THREE.Quaternion();
  const q = new THREE.Quaternion(),
    rotated = new THREE.Matrix4();
  const moved0 = new Float64Array(3),
    moved1 = new Float64Array(3);
  const width = knots.length * 9;
  function update(relativeMatrices, correctControls) {
    const matrices = contract.bones.map((name) =>
      matrixElements(
        relativeMatrices instanceof Map
          ? relativeMatrices.get(name)
          : relativeMatrices[name],
      ),
    );
    q0.setFromRotationMatrix(matrix.fromArray(matrices[0]));
    q1.setFromRotationMatrix(matrix.fromArray(matrices[1]));
    if (q0.dot(q1) < 0) q1.set(-q1.x, -q1.y, -q1.z, -q1.w);
    transform(matrices[0], ...contract.centerStart, moved0);
    transform(matrices[1], ...contract.centerEnd, moved1);
    const ratio = Math.min(
      2,
      Math.max(
        0.35,
        Math.hypot(
          moved1[0] - moved0[0],
          moved1[1] - moved0[1],
          moved1[2] - moved0[2],
        ) / contract.restLength,
      ),
    );
    const transverse = 1 / Math.sqrt(ratio);
    for (let n = 0; n < fixed.length; n++) {
      const p = fixed[n] * 3;
      transform(
        matrices[fixedBone[n]],
        rest[p],
        rest[p + 1],
        rest[p + 2],
        positions,
        p,
      );
    }
    for (let i = 0; i < knots.length; i++) {
      const u = knots[i];
      q.set(
        (1 - u) * q0.x + u * q1.x,
        (1 - u) * q0.y + u * q1.y,
        (1 - u) * q0.z + u * q1.z,
        (1 - u) * q0.w + u * q1.w,
      ).normalize();
      const r = rotated.makeRotationFromQuaternion(q).elements;
      for (let j = 0; j < 3; j++)
        for (let a = 0; a < 3; a++) {
          const value = r[j * 4 + a],
            index = i * 9 + j * 3 + a;
          coefficients[index] = ratio * value;
          coefficients[width + index] = transverse * value;
        }
    }
    for (let b = 0; b < 2; b++)
      for (let j = 0; j < 4; j++)
        for (let a = 0; a < 3; a++) {
          coefficients[width * 2 + b * 12 + j * 3 + a] = matrices[b][j * 4 + a];
        }
    for (let i = 0; i < free.length; i++) {
      const row = i * columns;
      let x = 0,
        y = 0,
        z = 0;
      for (let j = 0; j < columns; j++) {
        const value = response[row + j],
          p = j * 3;
        x += value * coefficients[p];
        y += value * coefficients[p + 1];
        z += value * coefficients[p + 2];
      }
      const p = free[i] * 3;
      positions[p] = x;
      positions[p + 1] = y;
      positions[p + 2] = z;
    }
    if (correctControls)
      correctControls(positions, {
        isFixed,
        fixedBone,
        fixed,
        contract,
        denseSheet: true,
      });
    return positions;
  }
  return { update, positions, controlPositions: positions, contract };
}

/** Continuous broad trapezius: several spinal origins blend across width,
 * while the scapular end remains a distributed attachment. Rest and posed
 * centerlines are linear, so their parameter is normalized arc length.
 */
export function makeFiberSheetShape(contract) {
  if (contract?.version !== 1 || contract.kind !== "fiber-sheet") {
    throw Error("不支持的多起点宽肌合同。");
  }
  const rest = Float64Array.from(contract.displayRest),
    count = rest.length / 3;
  const parameter = Float64Array.from(contract.parameter);
  const weights = Float64Array.from(contract.proximalWeights);
  const proximalCount = contract.bones.length - 1;
  const c0 = new THREE.Vector3().fromArray(contract.centerStart);
  const c1 = new THREE.Vector3().fromArray(contract.centerEnd);
  const delta = c1.clone().sub(c0),
    axis = delta.clone().normalize();
  if (
    rest.length % 3 ||
    count !== parameter.length ||
    proximalCount < 1 ||
    weights.length !== count * proximalCount ||
    delta.length() < 1e-6 ||
    ![...rest, ...parameter, ...weights].every(Number.isFinite)
  ) {
    throw Error("多起点宽肌数组无效。");
  }
  const matrices = contract.bones.map(() => new THREE.Matrix4());
  const quaternions = contract.bones.map(() => new THREE.Quaternion());
  const starts = Array.from(
    { length: proximalCount },
    () => new THREE.Vector3(),
  );
  const end = new THREE.Vector3(),
    start = new THREE.Vector3(),
    tangent = new THREE.Vector3();
  const rotatedAxis = new THREE.Vector3(),
    offset = new THREE.Vector3();
  const q = new THREE.Quaternion(),
    proximal = new THREE.Quaternion(),
    distal = new THREE.Quaternion();
  const correction = new THREE.Quaternion(),
    identity = new THREE.Quaternion();
  const positions = new Float32Array(rest.length);
  const smooth = (value) => {
    const x = Math.min(1, Math.max(0, value));
    return x * x * x * (10 + x * (-15 + 6 * x));
  };
  function update(relativeMatrices, correctControls) {
    contract.bones.forEach((name, i) => {
      matrices[i].fromArray(
        matrixElements(
          relativeMatrices instanceof Map
            ? relativeMatrices.get(name)
            : relativeMatrices[name],
        ),
      );
      quaternions[i].setFromRotationMatrix(matrices[i]);
      if (quaternions[i].dot(quaternions[0]) < 0) {
        const a = quaternions[i];
        a.set(-a.x, -a.y, -a.z, -a.w);
      }
      if (i < proximalCount) starts[i].copy(c0).applyMatrix4(matrices[i]);
    });
    end.copy(c1).applyMatrix4(matrices[proximalCount]);
    for (let i = 0; i < count; i++) {
      const t = parameter[i];
      start.set(0, 0, 0);
      proximal.set(0, 0, 0, 0);
      for (let j = 0; j < proximalCount; j++) {
        const w = weights[i * proximalCount + j],
          a = quaternions[j];
        start.addScaledVector(starts[j], w);
        proximal.x += w * a.x;
        proximal.y += w * a.y;
        proximal.z += w * a.z;
        proximal.w += w * a.w;
      }
      proximal.normalize();
      distal.copy(quaternions[proximalCount]);
      if (distal.dot(proximal) < 0)
        distal.set(-distal.x, -distal.y, -distal.z, -distal.w);
      q.set(
        (1 - t) * proximal.x + t * distal.x,
        (1 - t) * proximal.y + t * distal.y,
        (1 - t) * proximal.z + t * distal.z,
        (1 - t) * proximal.w + t * distal.w,
      ).normalize();
      tangent.copy(end).sub(start).normalize();
      rotatedAxis.copy(axis).applyQuaternion(q);
      correction.setFromUnitVectors(rotatedAxis, tangent);
      const gain =
        smooth(t / contract.endBlend) * smooth((1 - t) / contract.endBlend);
      correction.slerpQuaternions(identity, correction, gain);
      q.premultiply(correction);
      offset
        .fromArray(rest, i * 3)
        .sub(c0)
        .addScaledVector(delta, -t)
        .applyQuaternion(q);
      offset
        .addScaledVector(start, 1 - t)
        .addScaledVector(end, t)
        .toArray(positions, i * 3);
    }
    if (correctControls)
      correctControls(positions, { contract, denseSheet: true });
    return positions;
  }
  return { update, positions, contract };
}

/** Keep internal cells oriented without moving fixed attachment controls.
 * This display guard is not a tissue solver or a proof of surface separation.
 * Callers must inspect the final residual statistics and the actual surface.
 */
export function makeVolumeGuard(
  data,
  minimumRatio = data?.minimumRatio ?? 0.2,
  iterations = data?.iterations ?? 32,
) {
  const fail = () => {
    throw Error("肌肉内部体积约束无效。");
  };
  const maximumStepM = data?.maxStepM ?? data?.maximumStepM ?? 0.0005;
  if (
    !data?.tetrahedra?.length ||
    !data?.volumes?.length ||
    data.tetrahedra.length !== data.volumes.length * 4 ||
    !Number.isFinite(minimumRatio) ||
    minimumRatio <= 0 ||
    minimumRatio > 1 ||
    !Number.isInteger(iterations) ||
    iterations < 1 ||
    iterations > 256 ||
    !Number.isFinite(maximumStepM) ||
    maximumStepM <= 0 ||
    maximumStepM > 0.01 ||
    (data.version !== undefined && data.version !== 1) ||
    (data.kind !== undefined &&
      !["source-muscle-positive-volume", "noninversion-tetrahedra"].includes(
        data.kind,
      ))
  )
    fail();
  let largestIndex = -1;
  for (const index of data.tetrahedra) {
    if (!Number.isInteger(index) || index < 0 || index > 0xffffffff) fail();
    largestIndex = Math.max(largestIndex, index);
  }
  const controlCount = data.controlCount ?? largestIndex + 1;
  if (!Number.isInteger(controlCount) || controlCount <= largestIndex) fail();
  for (let i = 0; i < data.volumes.length; i++) {
    if (!Number.isFinite(data.volumes[i]) || Math.abs(data.volumes[i]) <= 1e-24)
      fail();
    const cell = data.tetrahedra.slice(i * 4, i * 4 + 4);
    if (new Set(cell).size !== 4) fail();
  }
  const tetrahedra = Uint32Array.from(data.tetrahedra);
  const volumeRest = Float64Array.from(data.volumes, Math.abs);
  // Avoid a full repeated sweep for roundoff near an already satisfied cell.
  const ratioTolerance = 1e-6;
  const sign = Float64Array.from(data.volumes, Math.sign);
  const gradient = new Float64Array(12),
    ids = new Uint32Array(4);
  // Recheck a cell only after one of its vertices has actually changed.
  // Float64 counters avoid wraparound for unusually large valid contracts.
  const seen = new Float64Array(volumeRest.length), vertexVersion = new Float64Array(controlCount);
  let before,
    stats = null;

  function cellVolume(y, cell, withGradient) {
    for (let j = 0; j < 4; j++) ids[j] = tetrahedra[cell * 4 + j];
    const p0 = ids[0] * 3,
      p1 = ids[1] * 3,
      p2 = ids[2] * 3,
      p3 = ids[3] * 3;
    const ax = y[p1] - y[p0],
      ay = y[p1 + 1] - y[p0 + 1],
      az = y[p1 + 2] - y[p0 + 2];
    const bx = y[p2] - y[p0],
      by = y[p2 + 1] - y[p0 + 1],
      bz = y[p2 + 2] - y[p0 + 2];
    const cx = y[p3] - y[p0],
      cy = y[p3 + 1] - y[p0 + 1],
      cz = y[p3 + 2] - y[p0 + 2];
    const s = sign[cell] / 6;
    gradient[3] = (by * cz - bz * cy) * s;
    gradient[4] = (bz * cx - bx * cz) * s;
    gradient[5] = (bx * cy - by * cx) * s;
    const volume = ax * gradient[3] + ay * gradient[4] + az * gradient[5];
    if (
      withGradient &&
      volume <
        volumeRest[cell] * minimumRatio -
          Math.max(1e-24, volumeRest[cell] * ratioTolerance)
    ) {
      gradient[6] = (cy * az - cz * ay) * s;
      gradient[7] = (cz * ax - cx * az) * s;
      gradient[8] = (cx * ay - cy * ax) * s;
      gradient[9] = (ay * bz - az * by) * s;
      gradient[10] = (az * bx - ax * bz) * s;
      gradient[11] = (ax * by - ay * bx) * s;
      for (let k = 0; k < 3; k++)
        gradient[k] = -gradient[3 + k] - gradient[6 + k] - gradient[9 + k];
    }
    if (!Number.isFinite(volume)) fail();
    return volume;
  }

  function guard(y, { groups } = {}) {
    const count = y?.length / 3;
    if (
      !Number.isInteger(count) ||
      count < controlCount ||
      groups?.length !== count
    )
      fail();
    for (const value of y) if (!Number.isFinite(value)) fail();
    for (const group of groups)
      if (!Number.isInteger(group) || group < -1) fail();
    if (!before || before.length !== y.length)
      before = new Float64Array(y.length);
    before.set(y);
    seen.fill(0);
    vertexVersion.fill(1);
    let version = 1, skippedChecks = 0;
    let touched = 0,
      iterationsPerformed = 0;
    for (let iteration = 0; iteration < iterations; iteration++) {
      let active = 0;
      iterationsPerformed++;
      for (let cell = 0; cell < volumeRest.length; cell++) {
        const at = cell * 4;
        const newest = Math.max(
          vertexVersion[tetrahedra[at]], vertexVersion[tetrahedra[at + 1]],
          vertexVersion[tetrahedra[at + 2]], vertexVersion[tetrahedra[at + 3]],
        );
        if (seen[cell] === newest) {
          skippedChecks++;
          continue;
        }
        seen[cell] = newest;
        const volume = cellVolume(y, cell, true),
          target = volumeRest[cell] * minimumRatio;
        if (
          volume >=
          target - Math.max(1e-24, volumeRest[cell] * ratioTolerance)
        )
          continue;
        active++;
        let denominator = 0;
        for (let j = 0; j < 4; j++) {
          if (groups[ids[j]] >= 0) continue;
          for (let k = 0; k < 3; k++) denominator += gradient[j * 3 + k] ** 2;
        }
        if (denominator < 1e-30) continue;
        const lambda = (target - volume) / denominator;
        for (let j = 0; j < 4; j++) {
          if (groups[ids[j]] >= 0) continue;
          const g = j * 3,
            p = ids[j] * 3;
          const length =
            Math.hypot(gradient[g], gradient[g + 1], gradient[g + 2]) * lambda;
          const scale =
            lambda * Math.min(1, maximumStepM / Math.max(length, 1e-300));
          let moved = false;
          for (let k = 0; k < 3; k++) {
            const previous = y[p + k];
            y[p + k] += gradient[g + k] * scale;
            moved ||= y[p + k] !== previous;
          }
          if (moved) vertexVersion[ids[j]] = ++version;
        }
      }
      touched += active;
      if (!active) break;
    }
    let invertedCount = 0,
      belowMinimumCount = 0,
      fixedOnlyViolationCount = 0;
    let minimumObservedRatio = Infinity,
      maxCorrectionM = 0;
    for (let cell = 0; cell < volumeRest.length; cell++) {
      const volume = cellVolume(y, cell, false),
        ratio = volume / volumeRest[cell];
      minimumObservedRatio = Math.min(minimumObservedRatio, ratio);
      if (volume <= 0) invertedCount++;
      if (
        volume <
        volumeRest[cell] * minimumRatio -
          Math.max(1e-24, volumeRest[cell] * ratioTolerance)
      ) {
        belowMinimumCount++;
        if (ids.every((index) => groups[index] >= 0)) fixedOnlyViolationCount++;
      }
    }
    for (let p = 0; p < y.length; p += 3) {
      const distance = Math.hypot(
        y[p] - before[p],
        y[p + 1] - before[p + 1],
        y[p + 2] - before[p + 2],
      );
      if (!Number.isFinite(distance)) fail();
      maxCorrectionM = Math.max(maxCorrectionM, distance);
    }
    stats = {
      touched, skippedChecks,
      iterationsPerformed,
      maxCorrectionM,
      invertedCount,
      belowMinimumCount,
      fixedOnlyViolationCount,
      minimumObservedRatio,
      ratioTolerance,
      constraintsSatisfied: invertedCount === 0 && belowMinimumCount === 0,
    };
    return stats;
  }
  function inspect(y, { groups } = {}) {
    if (y?.length !== controlCount * 3 || groups?.length !== controlCount)
      fail();
    for (const value of y) if (!Number.isFinite(value)) fail();
    let invertedCount = 0,
      belowMinimumCount = 0,
      fixedOnlyViolationCount = 0,
      minimumObservedRatio = Infinity;
    for (let cell = 0; cell < volumeRest.length; cell++) {
      const volume = cellVolume(y, cell, false);
      minimumObservedRatio = Math.min(
        minimumObservedRatio,
        volume / volumeRest[cell],
      );
      if (volume <= 0) invertedCount++;
      if (
        volume <
        volumeRest[cell] * minimumRatio -
          Math.max(1e-24, volumeRest[cell] * ratioTolerance)
      ) {
        belowMinimumCount++;
        if (ids.every((index) => groups[index] >= 0)) fixedOnlyViolationCount++;
      }
    }
    stats = {
      ...stats,
      invertedCount,
      belowMinimumCount,
      fixedOnlyViolationCount,
      minimumObservedRatio,
      ratioTolerance,
      inspectedAfterExternalCorrection: true,
      constraintsSatisfied: invertedCount === 0 && belowMinimumCount === 0,
    };
    return stats;
  }
  return {
    guard,
    inspect,
    get stats() {
      return stats;
    },
  };
}

/** Exact linear source subdivision. Independent rest offsets require rigid embedding. */
export function embedBarycentric(
  control,
  contract,
  out = new Float32Array(contract.displayRest.length),
) {
  const indices = contract.embeddingIndices,
    weights = contract.embeddingWeights;
  const count = out.length / 3;
  if (
    !Number.isInteger(count) ||
    out.length !== contract.displayRest.length ||
    indices?.length !== count * 3 ||
    weights?.length !== count * 3 ||
    control.length % 3
  )
    throw Error("肌肉重心插值尺寸无效。");
  for (let i = 0; i < count; i++) {
    let sum = 0;
    for (let j = 0; j < 3; j++) {
      const index = indices[i * 3 + j],
        weight = weights[i * 3 + j];
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index * 3 + 2 >= control.length ||
        !Number.isFinite(weight) ||
        weight < 0
      )
        throw Error("肌肉重心插值无效。");
      sum += weight;
    }
    if (Math.abs(sum - 1) > 2e-6) throw Error("肌肉重心插值权重无效。");
    for (let k = 0; k < 3; k++) {
      let value = 0;
      for (let j = 0; j < 3; j++)
        value += weights[i * 3 + j] * control[indices[i * 3 + j] * 3 + k];
      if (!Number.isFinite(value)) throw Error("肌肉重心插值出现非有限值。");
      out[i * 3 + k] = value;
    }
  }
  return out;
}

function validateArapContract(c) {
  const fail = () => {
    throw Error("肌肉局部形变合同无效。");
  };
  const vector = (a, length) => {
    if (!a || a.length !== length) fail();
    for (const value of a) if (!Number.isFinite(value)) fail();
  };
  const indices = (a, length, maximum) => {
    vector(a, length);
    for (const value of a)
      if (!Number.isInteger(value) || value < 0 || value >= maximum) fail();
  };
  if (
    c?.version !== 1 ||
    c.kind !== "arap-embedded-sheet" ||
    !Array.isArray(c.bones) ||
    c.bones.length < 2 ||
    c.bones.some((name) => typeof name !== "string" || !name) ||
    new Set(c.bones).size !== c.bones.length ||
    !Number.isInteger(c.iterations) ||
    c.iterations < (c.initialization === "bone-blend" ? 0 : 1) ||
    c.iterations > 32 ||
    !Number.isInteger(c.polarIterations) ||
    c.polarIterations < 1 ||
    c.polarIterations > 32
  )
    fail();
  const n = c.controlRest?.length / 3,
    displayCount = c.displayRest?.length / 3;
  if (
    !Number.isInteger(n) ||
    n < 3 ||
    !Number.isInteger(displayCount) ||
    displayCount < 1
  )
    fail();
  vector(c.controlRest, n * 3);
  vector(c.displayRest, displayCount * 3);
  if (c.initialization && !["chord", "bone-blend"].includes(c.initialization))
    fail();
  if (c.initialization === "bone-blend") {
    vector(c.parameter, n);
    for (const value of c.parameter)
      if (value < -1e-8 || value > 1 + 1e-8) fail();
  }
  vector(c.centerStart, 3);
  vector(c.centerEnd, 3);
  if (
    !Number.isFinite(c.restLength) ||
    c.restLength <= 1e-8 ||
    Math.abs(
      Math.hypot(...c.centerEnd.map((v, i) => v - c.centerStart[i])) -
        c.restLength,
    ) > 1e-6
  )
    fail();
  if (
    !c.free ||
    !c.fixed ||
    c.free.length < 1 ||
    c.fixed.length < 2 ||
    c.free.length + c.fixed.length !== n
  )
    fail();
  indices(c.free, c.free.length, n);
  indices(c.fixed, c.fixed.length, n);
  const partition = new Uint8Array(n);
  for (const group of [c.free, c.fixed])
    for (const index of group) {
      if (partition[index]) fail();
      partition[index] = 1;
    }
  indices(c.fixedBone, c.fixed.length, 2);
  if (!c.fixedBone.includes(0) || !c.fixedBone.includes(1)) fail();
  if (c.initialization === "bone-blend") {
    for (let i = 0; i < c.fixed.length; i++) {
      if (c.parameter[c.fixed[i]] !== c.fixedBone[i]) fail();
    }
  }
  const origins = c.bones.length - 1;
  if (c.startWeights) {
    vector(c.startWeights, n * origins);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let b = 0; b < origins; b++) {
        const value = c.startWeights[i * origins + b];
        if (value < 0) fail();
        sum += value;
      }
      if (Math.abs(sum - 1) > 2e-6) fail();
    }
  } else if (origins !== 1) fail();
  if (!c.edgeWeight || !c.edgeWeight.length) fail();
  vector(c.edgeWeight, c.edgeWeight.length);
  indices(c.edges, c.edgeWeight.length * 2, n);
  for (let i = 0; i < c.edgeWeight.length; i++) {
    if (c.edgeWeight[i] <= 0 || c.edges[i * 2] === c.edges[i * 2 + 1]) fail();
  }
  if (c.embeddingWidth !== 3) fail();
  if (
    c.embeddingMethod &&
    !["rigid", "barycentric"].includes(c.embeddingMethod)
  )
    fail();
  indices(c.embeddingIndices, displayCount * 3, n);
  vector(c.embeddingWeights, displayCount * 3);
  for (let i = 0; i < displayCount; i++) {
    let sum = 0;
    for (let k = 0; k < 3; k++) {
      const value = c.embeddingWeights[i * 3 + k];
      if (value < 0) fail();
      sum += value;
    }
    if (Math.abs(sum - 1) > 2e-6) fail();
  }
  if (c.embeddingMethod === "barycentric") {
    const reconstructed = embedBarycentric(
      c.controlRest,
      c,
      new Float64Array(c.displayRest.length),
    );
    for (let i = 0; i < reconstructed.length; i++)
      if (Math.abs(reconstructed[i] - c.displayRest[i]) > 1e-7) fail();
  }
  const rows = c.free.length;
  if (c.operator?.kind !== "sparse-lu") fail();
  if (c.bending) {
    const b = c.bending,
      boundary = b.fixedOperator;
    if (
      !Number.isFinite(b.beta) ||
      b.beta <= 0 ||
      typeof b.finalLocalStep !== "boolean" ||
      !Number.isInteger(b.iterations) ||
      b.iterations < 1 ||
      b.iterations > 64 ||
      !Number.isInteger(b.polarIterations) ||
      b.polarIterations < 1 ||
      b.polarIterations > 64 ||
      !b.operator ||
      (b.operator.kind && b.operator.kind !== "sparse-lu") ||
      !boundary?.values
    )
      fail();
    vector(b.inverseDegree, n);
    for (const value of b.inverseDegree) if (value <= 0) fail();
    vector(boundary.values, boundary.values.length);
    indices(boundary.columns, boundary.values.length, c.fixed.length);
    indices(boundary.rowPointers, rows + 1, boundary.values.length + 1);
    if (
      boundary.rowPointers[0] !== 0 ||
      boundary.rowPointers[rows] !== boundary.values.length
    )
      fail();
    for (let row = 0; row < rows; row++) {
      const start = boundary.rowPointers[row],
        end = boundary.rowPointers[row + 1];
      if (start > end) fail();
      let previous = -1;
      for (let i = start; i < end; i++) {
        if (boundary.columns[i] <= previous) fail();
        previous = boundary.columns[i];
      }
    }
  }
  for (const op of c.bending
    ? [c.operator, c.bending.operator]
    : [c.operator]) {
    for (const permutation of [op.rowPermutation, op.columnPermutation]) {
      indices(permutation, rows, rows);
      if (new Set(permutation).size !== rows) fail();
    }
    for (const [factor, lower] of [
      [op.lower, true],
      [op.upper, false],
    ]) {
      if (!factor?.values?.length) fail();
      vector(factor.values, factor.values.length);
      indices(factor.columns, factor.values.length, rows);
      indices(factor.rowPointers, rows + 1, factor.values.length + 1);
      if (
        factor.rowPointers[0] !== 0 ||
        factor.rowPointers[rows] !== factor.values.length
      )
        fail();
      for (let row = 0; row < rows; row++) {
        const start = factor.rowPointers[row],
          end = factor.rowPointers[row + 1];
        if (end <= start) fail();
        let diagonal = 0,
          previous = -1;
        for (let i = start; i < end; i++) {
          const column = factor.columns[i];
          if (column <= previous || (lower ? column > row : column < row))
            fail();
          previous = column;
          if (column === row) {
            if (Math.abs(factor.values[i]) < 1e-14) fail();
            diagonal++;
          }
        }
        if (diagonal !== 1) fail();
      }
    }
  }
}

/** Fit the local opposing-wall correction to a continuous rest-space field.
 * The field has a constant and a signed-depth term across each broad patch,
 * allowing the two walls to separate without independent vertex-sized folds.
 */
export function makeSmoothThickness(data, count, fixed) {
  const fail = () => {
    throw Error("肌肉连续厚度合同无效。");
  };
  const width = data?.basisCount;
  if (
    data?.version !== 1 ||
    data.kind !== "smooth-opposing-wall-thickness" ||
    !Number.isInteger(width) ||
    width < 1 ||
    width > 512 ||
    data.design?.length !== count * width ||
    data.normalInverse?.length !== width * width ||
    data.wallGuard?.controlCount !== count
  )
    fail();
  const design = Float64Array.from(data.design),
    inverse = Float64Array.from(data.normalInverse);
  for (const value of design) if (!Number.isFinite(value)) fail();
  for (const value of inverse) if (!Number.isFinite(value)) fail();
  for (const index of fixed)
    for (let j = 0; j < width; j++) if (design[index * width + j] !== 0) fail();
  for (let i = 0; i < width; i++) {
    if (inverse[i * width + i] <= 0) fail();
    for (let j = 0; j < i; j++)
      if (Math.abs(inverse[i * width + j] - inverse[j * width + i]) > 1e-8)
        fail();
  }
  const guard = makeVolumeGuard(data.wallGuard);
  const proposal = new Float64Array(count * 3),
    rhs = new Float64Array(width * 3);
  const coefficient = new Float64Array(width * 3);
  let proposalStats = null,
    maximumSmoothCorrectionM = 0;
  function prepare(control, { groups }) {
    if (control.length !== proposal.length) fail();
    proposal.set(control);
    proposalStats = { ...guard.guard(proposal, { groups }) };
    rhs.fill(0);
    for (let i = 0; i < count; i++)
      for (let j = 0; j < width; j++) {
        const gain = design[i * width + j];
        for (let axis = 0; axis < 3; axis++)
          rhs[j * 3 + axis] +=
            gain * (proposal[i * 3 + axis] - control[i * 3 + axis]);
      }
    coefficient.fill(0);
    for (let i = 0; i < width; i++)
      for (let j = 0; j < width; j++)
        for (let axis = 0; axis < 3; axis++)
          coefficient[i * 3 + axis] +=
            inverse[i * width + j] * rhs[j * 3 + axis];
  }
  function apply(control) {
    maximumSmoothCorrectionM = 0;
    for (let i = 0; i < count; i++) {
      let dx = 0,
        dy = 0,
        dz = 0;
      for (let j = 0; j < width; j++) {
        const gain = design[i * width + j];
        dx += gain * coefficient[j * 3];
        dy += gain * coefficient[j * 3 + 1];
        dz += gain * coefficient[j * 3 + 2];
      }
      if (![dx, dy, dz].every(Number.isFinite)) fail();
      control[i * 3] += dx;
      control[i * 3 + 1] += dy;
      control[i * 3 + 2] += dz;
      maximumSmoothCorrectionM = Math.max(
        maximumSmoothCorrectionM,
        Math.hypot(dx, dy, dz),
      );
    }
  }
  function inspect(control, context) {
    return {
      proposal: proposalStats,
      final: guard.inspect(control, context),
      maximumSmoothCorrectionM,
      scope:
        "Geometric preservation of source opposing-wall thickness; not measured tissue stiffness.",
    };
  }
  return { prepare, apply, inspect };
}

export function makeArapEmbeddedSheet(c, environment = {}) {
  validateArapContract(c);
  let guardData = c.volumeGuard;
  let volumeReporter = null,
    separationReporter = null;
  if (c.edgeSeparation) {
    const separation = c.edgeSeparation;
    if (
      !guardData ||
      separation.version !== 1 ||
      separation.kind !== "source-edge-separation" ||
      separation.controlCount !== c.controlRest.length / 3 ||
      separation.minimumRatio !== guardData.minimumRatio ||
      separation.iterations !== guardData.iterations ||
      separation.maxStepM !== guardData.maxStepM
    )
      throw Error("肌肉近边分离约束与内部体积约束的参数不一致。");
    const separationData = {
      ...separation,
      kind: "source-muscle-positive-volume",
      tetrahedra: separation.edgePairs,
      volumes: separation.referenceDeterminants,
    };
    // Both constraints use oriented determinants but have different meanings.
    // Combine only the numerical sweep, preserving the tested constraint order.
    volumeReporter = makeVolumeGuard(guardData);
    separationReporter = makeVolumeGuard(separationData);
    guardData = {
      ...guardData,
      tetrahedra: [...guardData.tetrahedra, ...separationData.tetrahedra],
      volumes: [...guardData.volumes, ...separationData.volumes],
    };
  }
  const volumeGuard = guardData ? makeVolumeGuard(guardData) : null;
  if (
    c.volumeGuard?.controlCount !== undefined &&
    c.volumeGuard.controlCount !== c.controlRest.length / 3
  )
    throw Error("肌肉内部体积控制点数量不一致。");
  const rest = Float64Array.from(c.controlRest),
    display = Float64Array.from(c.displayRest),
    n = rest.length / 3;
  const free = Uint32Array.from(c.free),
    fixed = Uint32Array.from(c.fixed),
    fixedBone = Uint8Array.from(c.fixedBone),
    edges = Uint32Array.from(c.edges),
    weight = Float64Array.from(c.edgeWeight);
  const op = c.operator,
    lower = {
      p: op.lower.rowPointers,
      j: op.lower.columns,
      v: op.lower.values,
    },
    upper = {
      p: op.upper.rowPointers,
      j: op.upper.columns,
      v: op.upper.values,
    };
  const embedIndex = Uint32Array.from(c.embeddingIndices),
    embedWeight = Float64Array.from(c.embeddingWeights),
    width = c.embeddingWidth;
  const groups = new Int8Array(n).fill(-1);
  fixed.forEach((index, i) => (groups[index] = fixedBone[i]));
  const jointContact = c.controlContact?.kind === "iterated-vertex-bone-contact"
    ? c.controlContact : null;
  const controlContact = c.controlContact && !jointContact
    ? makeControlContact(c.controlContact, environment, n, fixed)
    : null;
  let staticRegistration = null;
  if (environment.staticRegistration !== undefined) {
    const source = environment.staticRegistration;
    if (!source || typeof source !== "object")
      throw Error("静止肌肉配准参数无效。");
    staticRegistration = {};
    for (const key of ["referencePositions", "initialPositions", "fixedTargets"]) {
      const values = source[key];
      if (!values || values.length !== rest.length ||
          !Array.from(values).every(Number.isFinite))
        throw Error(`静止肌肉配准的 ${key} 长度或坐标无效。`);
      staticRegistration[key] = Float64Array.from(values);
    }
  }
  const jointField = jointContact ? environment.boneVolumes : null;
  const displayContact = c.displayContact ? makeDisplayContact(c.displayContact, display) : null;
  let displayContactStats = null;
  let jointBoneIds = null, jointContactStats = null;
  const jointPoint = jointContact ? new THREE.Vector3() : null;
  if (jointContact) {
    if (jointContact.version !== 1 || !volumeGuard ||
        !Array.isArray(jointContact.bones) || !jointContact.bones.length ||
        jointContact.bones.some(name => typeof name !== "string" || !name) ||
        new Set(jointContact.bones).size !== jointContact.bones.length ||
        !Number.isFinite(jointContact.clearanceM) || jointContact.clearanceM < 0 ||
        jointContact.clearanceM > 0.01 ||
        !Number.isInteger(jointContact.finalIterations) ||
        jointContact.finalIterations < 1 || jointContact.finalIterations > 64 ||
        typeof jointField?.project !== "function" ||
        typeof jointField?.sample !== "function" ||
        !Array.isArray(jointField?.volumes) || c.smoothThickness)
      throw Error("逐轮肌肉骨接触合同或骨场无效。");
    jointBoneIds = jointContact.bones.map(name => {
      const bone = jointField.volumes.find(item => item.name === name);
      if (!bone || !Number.isInteger(bone.index))
        throw Error(`逐轮肌肉接触缺少骨体积：${name}`);
      return bone.index;
    });
  }
  const smoothThickness = c.smoothThickness
    ? makeSmoothThickness(c.smoothThickness, n, fixed)
    : null;
  const y = new Float64Array(rest.length),
    reference = new Float64Array(rest.length),
    rhs = new Float64Array(rest.length),
    solution = new Float64Array(free.length * 3),
    rotation = new Float64Array(n * 9),
    covariance = new Float64Array(n * 9),
    positions = new Float32Array(display.length);
  const origin = c.centerStart,
    axis = c.centerEnd.map((v, i) => (v - origin[i]) / c.restLength),
    proximalCount = c.bones.length - 1;
  const startWeights = c.startWeights || new Float64Array(n).fill(1),
    matrices = c.bones.map(() => new THREE.Matrix4()),
    quaternions = c.bones.map(() => new THREE.Quaternion());
  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    q0 = new THREE.Quaternion(),
    correction = new THREE.Quaternion(),
    a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    v = new THREE.Vector3(),
    start = new THREE.Vector3(),
    end = new THREE.Vector3();
  let ratio = 1,
    transverse = 1,
    lastUpdateMaxM = 0;
  function applyJointContact() {
    if (!jointContact) return;
    if (jointField.status?.ready !== true)
      throw Error("逐轮肌肉接触的骨场尚未更新。");
    for (const index of free) {
      jointPoint.fromArray(y, index * 3);
      jointField.project(jointPoint, jointBoneIds, jointContact.clearanceM);
      if (![jointPoint.x, jointPoint.y, jointPoint.z].every(Number.isFinite))
        throw Error("逐轮肌肉接触产生非有限坐标。");
      jointPoint.toArray(y, index * 3);
    }
    volumeGuard.guard(y, { groups });
  }
  function inspectJointContact() {
    let minimum = Infinity, penetrating = 0, belowClearance = 0;
    for (let index = 0; index < n; index++) {
      jointPoint.fromArray(y, index * 3);
      let distance = Infinity;
      for (const id of jointBoneIds)
        distance = Math.min(distance, jointField.sample(id, jointPoint).distance);
      // The field uses +Infinity for points outside all selected bone bounds.
      if (Number.isNaN(distance) || distance === -Infinity)
        throw Error("逐轮肌肉接触返回无效骨距。");
      minimum = Math.min(minimum, distance);
      if (distance < -1e-6) penetrating++;
      if (groups[index] < 0 && distance < jointContact.clearanceM - 1e-6)
        belowClearance++;
    }
    jointContactStats = { minimumDistanceM: Number.isFinite(minimum) ? minimum : null, penetratingCount: penetrating,
      belowClearanceCount: belowClearance, clearanceM: jointContact.clearanceM };
    if (penetrating) throw Error("逐轮肌肉接触仍有控制点穿骨。");
  }
  function finishDisplay(value) {
    if (!displayContact) return value;
    const correction = displayContact.correct(value);
    displayContactStats = correction.stats;
    if (correction.stats.remainingPairs || correction.stats.fixedDriftMm !== 0)
      throw Error("肌肉细表面接触未收敛，无法显示本帧。");
    value.set(correction.positions);
    return value;
  }
  function transform(matrix, x, z, w, out, p) {
    const e = matrix.elements;
    out[p] = e[0] * x + e[4] * z + e[8] * w + e[12];
    out[p + 1] = e[1] * x + e[5] * z + e[9] * w + e[13];
    out[p + 2] = e[2] * x + e[6] * z + e[10] * w + e[14];
  }
  function solve() {
    for (let i = 0; i < free.length; i++)
      for (let k = 0; k < 3; k++)
        solution[op.rowPermutation[i] * 3 + k] = rhs[free[i] * 3 + k];
    for (const [factor, forward] of [
      [lower, true],
      [upper, false],
    ])
      for (let step = 0; step < free.length; step++) {
        const row = forward ? step : free.length - step - 1,
          p = row * 3;
        let x = solution[p],
          z = solution[p + 1],
          w = solution[p + 2],
          diagonal = 0;
        for (let i = factor.p[row]; i < factor.p[row + 1]; i++) {
          const j = factor.j[i],
            value = factor.v[i];
          if (j === row) diagonal = value;
          else {
            x -= value * solution[j * 3];
            z -= value * solution[j * 3 + 1];
            w -= value * solution[j * 3 + 2];
          }
        }
        solution[p] = x / diagonal;
        solution[p + 1] = z / diagonal;
        solution[p + 2] = w / diagonal;
      }
    lastUpdateMaxM = 0;
    for (let i = 0; i < free.length; i++) {
      const p = free[i] * 3,
        j = op.columnPermutation[i] * 3;
      lastUpdateMaxM = Math.max(
        lastUpdateMaxM,
        Math.hypot(
          y[p] - solution[j],
          y[p + 1] - solution[j + 1],
          y[p + 2] - solution[j + 2],
        ),
      );
      y[p] = solution[j];
      y[p + 1] = solution[j + 1];
      y[p + 2] = solution[j + 2];
    }
  }
  function globalStep() {
    rhs.fill(0);
    for (let e = 0; e < weight.length; e++) {
      const i = edges[e * 2],
        j = edges[e * 2 + 1],
        pi = i * 3,
        pj = j * 3,
        ri = i * 9,
        rj = j * 9,
        w = weight[e],
        x = reference[pi] - reference[pj],
        z = reference[pi + 1] - reference[pj + 1],
        v = reference[pi + 2] - reference[pj + 2];
      for (let k = 0; k < 3; k++) {
        const ai = ri + k * 3,
          aj = rj + k * 3,
          value =
            0.5 *
            w *
            ((rotation[ai] + rotation[aj]) * x +
              (rotation[ai + 1] + rotation[aj + 1]) * z +
              (rotation[ai + 2] + rotation[aj + 2]) * v);
        rhs[pi + k] += value;
        rhs[pj + k] -= value;
        if (groups[i] < 0 && groups[j] >= 0) rhs[pi + k] += w * y[pj + k];
        if (groups[j] < 0 && groups[i] >= 0) rhs[pj + k] += w * y[pi + k];
      }
    }
    solve();
  }
  function localStep() {
    covariance.fill(0);
    for (let e = 0; e < weight.length; e++) {
      const i = edges[e * 2],
        j = edges[e * 2 + 1],
        pi = i * 3,
        pj = j * 3,
        ri = i * 9,
        rj = j * 9,
        w = weight[e];
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++) {
          const value =
            w *
            (y[pi + row] - y[pj + row]) *
            (reference[pi + col] - reference[pj + col]);
          covariance[ri + row * 3 + col] += value;
          covariance[rj + row * 3 + col] += value;
        }
    }
    for (let index = 0; index < n; index++) {
      // Bending fixes attachment rotations to their bones immediately after
      // this step, so solving their unconstrained polar rotations is redundant.
      if (inBending && groups[index] >= 0) continue;
      const p = index * 9;
      for (
        let iteration = 0;
        iteration < (inBending ? c.bending.polarIterations : c.polarIterations);
        iteration++
      ) {
        let x = 0,
          z = 0,
          w = 0,
          denominator = 0;
        for (let col = 0; col < 3; col++) {
          x +=
            rotation[p + 3 + col] * covariance[p + 6 + col] -
            rotation[p + 6 + col] * covariance[p + 3 + col];
          z +=
            rotation[p + 6 + col] * covariance[p + col] -
            rotation[p + col] * covariance[p + 6 + col];
          w +=
            rotation[p + col] * covariance[p + 3 + col] -
            rotation[p + 3 + col] * covariance[p + col];
          for (let row = 0; row < 3; row++)
            denominator +=
              rotation[p + row * 3 + col] * covariance[p + row * 3 + col];
        }
        denominator = Math.abs(denominator) + 1e-14;
        x /= denominator;
        z /= denominator;
        w /= denominator;
        const magnitude = Math.hypot(x, z, w);
        if (magnitude < 1e-8) break;
        const angle = Math.min(0.4, magnitude),
          sin = Math.sin(angle),
          cos = Math.cos(angle),
          one = 1 - cos;
        x /= magnitude;
        z /= magnitude;
        w /= magnitude;
        const e00 = cos + x * x * one,
          e01 = x * z * one - w * sin,
          e02 = x * w * one + z * sin,
          e10 = z * x * one + w * sin,
          e11 = cos + z * z * one,
          e12 = z * w * one - x * sin,
          e20 = w * x * one - z * sin,
          e21 = w * z * one + x * sin,
          e22 = cos + w * w * one;
        for (let col = 0; col < 3; col++) {
          const a = rotation[p + col],
            b = rotation[p + 3 + col],
            d = rotation[p + 6 + col];
          rotation[p + col] = e00 * a + e01 * b + e02 * d;
          rotation[p + 3 + col] = e10 * a + e11 * b + e12 * d;
          rotation[p + 6 + col] = e20 * a + e21 * b + e22 * d;
        }
      }
    }
  }

  let inBending = false;
  const bendingReference = new Float64Array(rest.length),
    bendingTarget = new Float64Array(rest.length),
    bendingRhs = new Float64Array(rest.length);
  function applyL(input, output) {
    output.fill(0);
    for (let e = 0; e < weight.length; e++) {
      const i = edges[e * 2] * 3,
        j = edges[e * 2 + 1] * 3,
        w = weight[e];
      for (let k = 0; k < 3; k++) {
        const value = w * (input[i + k] - input[j + k]);
        output[i + k] += value;
        output[j + k] -= value;
      }
    }
  }
  function pinFixedRotations() {
    for (let k = 0; k < fixed.length; k++) {
      const index = fixed[k],
        p = index * 9;
      if (fixedBone[k]) q.copy(quaternions[proximalCount]);
      else {
        q.set(0, 0, 0, 0);
        for (let bone = 0; bone < proximalCount; bone++) {
          const gain = startWeights[index * proximalCount + bone],
            value = quaternions[bone];
          q.x += gain * value.x;
          q.y += gain * value.y;
          q.z += gain * value.z;
          q.w += gain * value.w;
        }
        q.normalize();
      }
      const e = m.makeRotationFromQuaternion(q).elements;
      for (let row = 0; row < 3; row++)
        for (let col = 0; col < 3; col++)
          rotation[p + row * 3 + col] = e[col * 4 + row];
    }
  }
  function solveBending() {
    const bending = c.bending,
      operator = bending.operator,
      boundary = bending.fixedOperator;
    for (let i = 0; i < free.length; i++)
      for (let k = 0; k < 3; k++) {
        let value = rhs[free[i] * 3 + k];
        for (
          let j = boundary.rowPointers[i];
          j < boundary.rowPointers[i + 1];
          j++
        )
          value -= boundary.values[j] * y[fixed[boundary.columns[j]] * 3 + k];
        solution[operator.rowPermutation[i] * 3 + k] = value;
      }
    for (const [factor, forward] of [
      [operator.lower, true],
      [operator.upper, false],
    ])
      for (let step = 0; step < free.length; step++) {
        const row = forward ? step : free.length - step - 1,
          p = row * 3;
        let x = solution[p],
          z = solution[p + 1],
          w = solution[p + 2],
          diagonal = 0;
        for (
          let i = factor.rowPointers[row];
          i < factor.rowPointers[row + 1];
          i++
        ) {
          const j = factor.columns[i],
            value = factor.values[i];
          if (j === row) diagonal = value;
          else {
            x -= value * solution[j * 3];
            z -= value * solution[j * 3 + 1];
            w -= value * solution[j * 3 + 2];
          }
        }
        solution[p] = x / diagonal;
        solution[p + 1] = z / diagonal;
        solution[p + 2] = w / diagonal;
      }
    lastUpdateMaxM = 0;
    for (let i = 0; i < free.length; i++) {
      const p = free[i] * 3,
        j = operator.columnPermutation[i] * 3;
      lastUpdateMaxM = Math.max(
        lastUpdateMaxM,
        Math.hypot(
          y[p] - solution[j],
          y[p + 1] - solution[j + 1],
          y[p + 2] - solution[j + 2],
        ),
      );
      y[p] = solution[j];
      y[p + 1] = solution[j + 1];
      y[p + 2] = solution[j + 2];
    }
  }
  function bendingPhase() {
    if (!c.bending) return;
    inBending = true;
    applyL(reference, bendingReference);
    for (let step = 0; step < c.bending.iterations; step++) {
      localStep();
      pinFixedRotations();
      rhs.fill(0);
      for (let e = 0; e < weight.length; e++) {
        const i = edges[e * 2],
          j = edges[e * 2 + 1],
          pi = i * 3,
          pj = j * 3,
          ri = i * 9,
          rj = j * 9,
          w = weight[e],
          x = reference[pi] - reference[pj],
          z = reference[pi + 1] - reference[pj + 1],
          v = reference[pi + 2] - reference[pj + 2];
        for (let k = 0; k < 3; k++) {
          const ai = ri + k * 3,
            aj = rj + k * 3,
            value =
              0.5 *
              w *
              ((rotation[ai] + rotation[aj]) * x +
                (rotation[ai + 1] + rotation[aj + 1]) * z +
                (rotation[ai + 2] + rotation[aj + 2]) * v);
          rhs[pi + k] += value;
          rhs[pj + k] -= value;
        }
      }
      for (let i = 0; i < n; i++) {
        const p = i * 3,
          r = i * 9,
          x = bendingReference[p],
          z = bendingReference[p + 1],
          w = bendingReference[p + 2],
          scale = c.bending.inverseDegree[i];
        for (let k = 0; k < 3; k++)
          bendingTarget[p + k] =
            scale *
            (rotation[r + k * 3] * x +
              rotation[r + k * 3 + 1] * z +
              rotation[r + k * 3 + 2] * w);
      }
      applyL(bendingTarget, bendingRhs);
      for (let i = 0; i < rhs.length; i++)
        rhs[i] += c.bending.beta * bendingRhs[i];
      solveBending();
      applyJointContact();
    }
  }

  function update(relative, correctControls, warm = false) {
    if (warm && staticRegistration)
      throw Error("静止肌肉配准不支持连续状态初始化。");
    const previousInverse = warm
      ? matrices.map((value) => value.clone().invert())
      : null;
    inBending = false;
    c.bones.forEach((name, i) => {
      const source =
        relative instanceof Map ? relative.get(name) : relative[name];
      const elements = matrixElements(source);
      if (!Array.from(elements).every(Number.isFinite))
        throw Error("肌肉形变收到非有限骨矩阵。");
      matrices[i].fromArray(elements);
      quaternions[i].setFromRotationMatrix(matrices[i]);
      if (quaternions[i].dot(quaternions[0]) < 0) {
        const v = quaternions[i];
        v.set(-v.x, -v.y, -v.z, -v.w);
      }
    });
    if (warm) {
      const increments = matrices.map((value, i) =>
        value.clone().multiply(previousInverse[i]),
      );
      const dq = increments.map((value) =>
        new THREE.Quaternion().setFromRotationMatrix(value),
      );
      for (let i = 1; i < dq.length; i++)
        if (dq[0].dot(dq[i]) < 0)
          dq[i].set(-dq[i].x, -dq[i].y, -dq[i].z, -dq[i].w);
      const point = new THREE.Vector3(),
        next = new THREE.Vector3(),
        mix = new THREE.Quaternion(),
        local = new THREE.Matrix4(),
        rotated = new THREE.Matrix4();
      for (let index = 0; index < n; index++) {
        if (groups[index] >= 0) continue;
        const p = index * 3,
          u = c.parameter[index];
        next.set(0, 0, 0);
        mix.set(0, 0, 0, 0);
        for (let bone = 0; bone < proximalCount + 1; bone++) {
          const gain =
            bone === proximalCount
              ? u
              : (1 - u) * startWeights[index * proximalCount + bone];
          next.addScaledVector(
            point.fromArray(y, p).applyMatrix4(increments[bone]),
            gain,
          );
          mix.x += gain * dq[bone].x;
          mix.y += gain * dq[bone].y;
          mix.z += gain * dq[bone].z;
          mix.w += gain * dq[bone].w;
        }
        next.toArray(y, p);
        mix.normalize();
        const ri = index * 9;
        local.set(
          rotation[ri],
          rotation[ri + 1],
          rotation[ri + 2],
          0,
          rotation[ri + 3],
          rotation[ri + 4],
          rotation[ri + 5],
          0,
          rotation[ri + 6],
          rotation[ri + 7],
          rotation[ri + 8],
          0,
          0,
          0,
          0,
          1,
        );
        const elements = rotated
          .makeRotationFromQuaternion(mix)
          .multiply(local).elements;
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 3; col++)
            rotation[ri + row * 3 + col] = elements[col * 4 + row];
      }
    }
    start.set(0, 0, 0);
    end.set(0, 0, 0);
    q0.set(0, 0, 0, 0);
    let n0 = 0,
      n1 = 0;
    for (let k = 0; k < fixed.length; k++) {
      const index = fixed[k],
        p = index * 3,
        group = fixedBone[k];
      if (group) {
        transform(
          matrices[proximalCount],
          rest[p],
          rest[p + 1],
          rest[p + 2],
          y,
          p,
        );
        end.add(v.fromArray(y, p));
        n1++;
      } else {
        y[p] = y[p + 1] = y[p + 2] = 0;
        for (let b = 0; b < proximalCount; b++) {
          const weight = startWeights[index * proximalCount + b],
            quat = quaternions[b];
          v.fromArray(rest, p).applyMatrix4(matrices[b]);
          y[p] += weight * v.x;
          y[p + 1] += weight * v.y;
          y[p + 2] += weight * v.z;
          q0.x += weight * quat.x;
          q0.y += weight * quat.y;
          q0.z += weight * quat.z;
          q0.w += weight * quat.w;
        }
        start.add(v.fromArray(y, p));
        n0++;
      }
    }
    start.multiplyScalar(1 / n0);
    end.multiplyScalar(1 / n1);
    q0.normalize();
    b.copy(end).sub(start);
    ratio = Math.min(2, Math.max(0.35, b.length() / c.restLength));
    transverse = 1 / Math.sqrt(ratio);
    b.normalize();
    a.fromArray(axis).applyQuaternion(q0);
    correction.setFromUnitVectors(a, b);
    q.copy(correction).multiply(q0);
    const initial = m.makeRotationFromQuaternion(q).elements;
    for (let index = 0; index < n; index++) {
      const p = index * 3,
        x = rest[p],
        z = rest[p + 1],
        w = rest[p + 2],
        dot = x * axis[0] + z * axis[1] + w * axis[2];
      reference[p] = transverse * x + (ratio - transverse) * dot * axis[0];
      reference[p + 1] = transverse * z + (ratio - transverse) * dot * axis[1];
      reference[p + 2] = transverse * w + (ratio - transverse) * dot * axis[2];
      if (!warm)
        for (let row = 0; row < 3; row++)
          for (let col = 0; col < 3; col++)
            rotation[index * 9 + row * 3 + col] = initial[col * 4 + row];
    }
    if (!warm) {
      if (c.initialization === "bone-blend") {
        // The full endpoint transforms select the bending side for a broad sheet.
        // A single chord rotation loses that information in strongly flexed poses.
        // This state is rebuilt from rest for every call, including random jumps.
        for (let index = 0; index < n; index++) {
          const p = index * 3,
            u = c.parameter[index];
          let x = 0,
            y0 = 0,
            z = 0;
          q.set(0, 0, 0, 0);
          for (let bone = 0; bone < proximalCount; bone++) {
            const gain = startWeights[index * proximalCount + bone];
            v.fromArray(rest, p).applyMatrix4(matrices[bone]);
            x += gain * v.x;
            y0 += gain * v.y;
            z += gain * v.z;
            const value = quaternions[bone];
            q.x += gain * value.x;
            q.y += gain * value.y;
            q.z += gain * value.z;
            q.w += gain * value.w;
          }
          q.normalize();
          v.fromArray(rest, p).applyMatrix4(matrices[proximalCount]);
          if (groups[index] < 0) {
            y[p] = (1 - u) * x + u * v.x;
            y[p + 1] = (1 - u) * y0 + u * v.y;
            y[p + 2] = (1 - u) * z + u * v.z;
          }
          const endQuaternion = quaternions[proximalCount];
          const sign = q.dot(endQuaternion) < 0 ? -1 : 1;
          q.set(
            (1 - u) * q.x + u * sign * endQuaternion.x,
            (1 - u) * q.y + u * sign * endQuaternion.y,
            (1 - u) * q.z + u * sign * endQuaternion.z,
            (1 - u) * q.w + u * sign * endQuaternion.w,
          ).normalize();
          const e = m.makeRotationFromQuaternion(q).elements;
          for (let row = 0; row < 3; row++)
            for (let col = 0; col < 3; col++)
              rotation[index * 9 + row * 3 + col] = e[col * 4 + row];
        }
      } else {
        globalStep();
        localStep();
      }
    }
    if (staticRegistration) {
      reference.set(staticRegistration.referencePositions);
      for (const index of free)
        for (let k = 0; k < 3; k++)
          y[index * 3 + k] = staticRegistration.initialPositions[index * 3 + k];
      localStep();
      for (const index of fixed)
        for (let k = 0; k < 3; k++)
          y[index * 3 + k] = staticRegistration.fixedTargets[index * 3 + k];
    }
    for (let iteration = 0; iteration < c.iterations; iteration++) {
      localStep();
      globalStep();
      applyJointContact();
    }
    bendingPhase();
    if (smoothThickness) smoothThickness.prepare(y, { groups });
    if (correctControls)
      correctControls(y, { groups, fixed, fixedBone, contract: c });
    if (jointContact) {
      for (let iteration = 0; iteration < jointContact.finalIterations; iteration++)
        applyJointContact();
      inspectJointContact();
    } else if (volumeGuard) volumeGuard.guard(y, { groups });
    if (smoothThickness) smoothThickness.apply(y);
    if (controlContact) {
      controlContact.update(y, relative);
      if (volumeGuard) volumeGuard.inspect(y, { groups });
    }
    if (c.embeddingMethod === "barycentric")
      return finishDisplay(embedBarycentric(y, c, positions));
    if (!c.bending || c.bending.finalLocalStep) {
      localStep();
      if (c.bending) pinFixedRotations();
    }
    for (let i = 0; i < display.length / 3; i++) {
      const p = i * 3;
      let x = 0,
        z = 0,
        w = 0;
      for (let k = 0; k < width; k++) {
        const index = embedIndex[i * width + k],
          value = embedWeight[i * width + k],
          group = groups[index],
          ci = index * 3,
          ri = index * 9;
        if (!value) continue;
        if (group >= 0) {
          if (group) {
            v.fromArray(display, p).applyMatrix4(matrices[proximalCount]);
            x += value * v.x;
            z += value * v.y;
            w += value * v.z;
          } else {
            for (let bone = 0; bone < proximalCount; bone++) {
              v.fromArray(display, p).applyMatrix4(matrices[bone]);
              const gain = value * startWeights[index * proximalCount + bone];
              x += gain * v.x;
              z += gain * v.y;
              w += gain * v.z;
            }
          }
        } else {
          const dx = display[p] - rest[ci],
            dy = display[p + 1] - rest[ci + 1],
            dz = display[p + 2] - rest[ci + 2],
            axial = dx * axis[0] + dy * axis[1] + dz * axis[2],
            rx = transverse * dx + (ratio - transverse) * axial * axis[0],
            ry = transverse * dy + (ratio - transverse) * axial * axis[1],
            rz = transverse * dz + (ratio - transverse) * axial * axis[2];
          x +=
            value *
            (y[ci] +
              rotation[ri] * rx +
              rotation[ri + 1] * ry +
              rotation[ri + 2] * rz);
          z +=
            value *
            (y[ci + 1] +
              rotation[ri + 3] * rx +
              rotation[ri + 4] * ry +
              rotation[ri + 5] * rz);
          w +=
            value *
            (y[ci + 2] +
              rotation[ri + 6] * rx +
              rotation[ri + 7] * ry +
              rotation[ri + 8] * rz);
        }
      }
      positions[p] = x;
      positions[p + 1] = z;
      positions[p + 2] = w;
    }
    return finishDisplay(positions);
  }
  return {
    update,
    positions,
    controlPositions: y,
    get displayContactStats() { return displayContactStats; },
    get volumeStats() {
      if (volumeReporter) return volumeReporter.inspect(y, { groups });
      return volumeGuard?.stats ?? null;
    },
    get separationStats() {
      if (!separationReporter) return null;
      const report = separationReporter.inspect(y, { groups });
      return {
        kind: "source-edge-separation",
        reversedSigns: report.invertedCount,
        belowMinimumCount: report.belowMinimumCount,
        minimumObservedRatio: report.minimumObservedRatio,
        constraintsSatisfied: report.constraintsSatisfied,
        scope:
          "Oriented signs of nearby nonadjacent edge pairs; not tissue volume.",
      };
    },
    get contactStats() {
      return jointContactStats ?? controlContact?.stats ?? null;
    },
    get thicknessStats() {
      return smoothThickness?.inspect(y, { groups }) ?? null;
    },
    get lastUpdateMaxM() {
      return lastUpdateMaxM;
    },
  };
}

/** Solve min sum(x), A x >= b, x >= 0 via the feasible dual tableau.
 * A is nonnegative; rows are contact probes and columns are smooth basis fields.
 * The dual has only basisCount constraints, independent of probe count.
 */
export function solveContactCover(rows, demands, basisCount) {
  const probeCount = demands.length;
  if (!probeCount)
    return { coefficients: new Float64Array(basisCount), pivots: 0 };
  const width = probeCount + basisCount + 1;
  const rhs = width - 1;
  const table = new Float64Array((basisCount + 1) * width);
  const basic = new Int32Array(basisCount);
  for (let i = 0; i < basisCount; i++) {
    const offset = i * width;
    for (let j = 0; j < probeCount; j++)
      table[offset + j] = rows[j * basisCount + i];
    table[offset + probeCount + i] = 1;
    table[offset + rhs] = 1;
    basic[i] = probeCount + i;
  }
  const objective = basisCount * width;
  for (let j = 0; j < probeCount; j++) table[objective + j] = -demands[j];
  let pivots = 0;
  for (; pivots < 4096; pivots++) {
    let entering = -1;
    let bestCost = -1e-12;
    for (let j = 0; j < rhs; j++) {
      if (table[objective + j] < bestCost) {
        entering = j;
        bestCost = table[objective + j];
      }
    }
    if (entering < 0) break;
    let leaving = -1;
    let bestRatio = Infinity;
    for (let i = 0; i < basisCount; i++) {
      const coefficient = table[i * width + entering];
      if (coefficient <= 1e-12) continue;
      const ratio = table[i * width + rhs] / coefficient;
      if (
        ratio < bestRatio - 1e-10 ||
        (Math.abs(ratio - bestRatio) <= 1e-10 &&
          (leaving < 0 || basic[i] < basic[leaving]))
      ) {
        leaving = i;
        bestRatio = ratio;
      }
    }
    if (leaving < 0)
      throw new Error(
        "Contact cover is infeasible: an immobile probe needs correction",
      );
    const row = leaving * width;
    const pivot = table[row + entering];
    for (let j = 0; j < width; j++) table[row + j] /= pivot;
    table[row + entering] = 1;
    for (let i = 0; i <= basisCount; i++) {
      if (i === leaving) continue;
      const offset = i * width;
      const factor = table[offset + entering];
      if (Math.abs(factor) < 1e-18) continue;
      for (let j = 0; j < width; j++)
        table[offset + j] -= factor * table[row + j];
      table[offset + entering] = 0;
    }
    basic[leaving] = entering;
  }
  if (pivots === 4096) throw new Error("Contact cover did not converge");
  const coefficients = new Float64Array(basisCount);
  for (let i = 0; i < basisCount; i++)
    coefficients[i] = Math.max(0, table[objective + probeCount + i]);
  let worstResidual = 0;
  for (let j = 0; j < probeCount; j++) {
    let value = 0;
    for (let i = 0; i < basisCount; i++)
      value += rows[j * basisCount + i] * coefficients[i];
    worstResidual = Math.max(worstResidual, demands[j] - value);
  }
  if (worstResidual > 1e-8)
    throw new Error(`Contact cover residual ${worstResidual}`);
  return { coefficients, pivots, worstResidual };
}

/** A smooth nonnegative displacement field moves both walls of a muscle together.
 * Bone fields must already contain this frame's transforms. Only the declared
 * contact bones and probes are checked here; full-surface acceptance is offline.
 */
export function makeControlContact(data, environment, count, fixed) {
  const fail = (message) => {
    throw Error(`肌肉整片接触合同无效：${message}`);
  };
  const field = environment?.boneVolumes;
  if (!field?.query) fail("缺少当前骨体积");
  if (data?.version !== 1 || data.kind !== "coherent-muscle-bone-contact")
    fail("版本");
  const width = data.basisCount;
  if (!Number.isInteger(width) || width < 1 || width > 256) fail("基函数数量");
  if (
    !Array.isArray(data.bones) ||
    !data.bones.length ||
    data.bones.some((n) => typeof n !== "string") ||
    new Set(data.bones).size !== data.bones.length
  )
    fail("骨名称");
  if (
    data.basis?.length !== count * width ||
    !data.probeIndices?.length ||
    data.probeIndices.length % 3 ||
    data.probeWeights?.length !== data.probeIndices.length ||
    data.restNormals?.length !== data.bones.length * count * 3
  )
    fail("数组尺寸");
  const basis = Float64Array.from(data.basis);
  const indices = data.probeIndices;
  const weights = Float64Array.from(data.probeWeights);
  const normals = Float64Array.from(data.restNormals);
  for (const value of basis)
    if (!Number.isFinite(value) || value < 0) fail("非负基函数");
  for (const index of indices)
    if (!Number.isInteger(index) || index < 0 || index >= count)
      fail("探针索引");
  for (const value of normals)
    if (!Number.isFinite(value)) fail("静止外向方向");
  for (const index of fixed) {
    for (let j = 0; j < width; j++)
      if (basis[index * width + j] !== 0) fail("固定附着端必须零位移");
  }
  const probeCount = indices.length / 3;
  for (let i = 0; i < probeCount; i++) {
    let sum = 0;
    for (let j = 0; j < 3; j++) {
      const value = weights[i * 3 + j];
      if (!Number.isFinite(value) || value < 0) fail("探针权重");
      sum += value;
    }
    if (Math.abs(sum - 1) > 1e-9) fail("探针权重和");
  }
  const cycles = data.cycles ?? 3;
  const trigger = data.triggerM ?? 0.0005;
  const clearance = data.clearanceM ?? 0.0006;
  const rayStep = data.rayStepM ?? 0.0005;
  const raySteps = data.raySteps ?? 40;
  const bisections = data.bisections ?? 12;
  if (
    ![cycles, raySteps, bisections].every(Number.isInteger) ||
    cycles < 1 ||
    cycles > 16 ||
    raySteps < 1 ||
    raySteps > 128 ||
    bisections < 1 ||
    bisections > 24 ||
    ![trigger, clearance, rayStep].every(Number.isFinite) ||
    trigger < 0 ||
    clearance <= trigger ||
    clearance > 0.01 ||
    rayStep <= 0 ||
    rayStep > 0.005
  )
    fail("接触参数");
  const triggers = data.boneTriggers ?? data.bones.map(() => trigger);
  const clearances = data.boneClearances ?? data.bones.map(() => clearance);
  if (
    triggers.length !== data.bones.length ||
    clearances.length !== data.bones.length ||
    triggers.some(
      (value, i) =>
        !Number.isFinite(value) ||
        value < 0 ||
        !Number.isFinite(clearances[i]) ||
        clearances[i] <= value ||
        clearances[i] > 0.01,
    )
  )
    fail("逐骨接触参数");
  const probeBasis = new Float64Array(probeCount * width);
  const probeNormals = new Float64Array(data.bones.length * probeCount * 3);
  for (let i = 0; i < probeCount; i++)
    for (let k = 0; k < 3; k++) {
      const vertex = indices[i * 3 + k],
        gain = weights[i * 3 + k];
      for (let j = 0; j < width; j++)
        probeBasis[i * width + j] += gain * basis[vertex * width + j];
      for (let bone = 0; bone < data.bones.length; bone++)
        for (let axis = 0; axis < 3; axis++)
          probeNormals[(bone * probeCount + i) * 3 + axis] +=
            gain * normals[(bone * count + vertex) * 3 + axis];
    }
  const point = new THREE.Vector3();
  const points = new Float64Array(probeCount * 3);
  const active = new Uint32Array(probeCount);
  const demands = new Float64Array(probeCount);
  const rows = new Float64Array(probeCount * width);
  const before = new Float64Array(count * 3);
  let stats = null;
  function updatePoints(control) {
    points.fill(0);
    for (let i = 0; i < probeCount; i++)
      for (let j = 0; j < 3; j++) {
        const vertex = indices[i * 3 + j] * 3,
          gain = weights[i * 3 + j];
        for (let axis = 0; axis < 3; axis++)
          points[i * 3 + axis] += gain * control[vertex + axis];
      }
  }
  function distanceAt(bone, offset, shift, direction) {
    point.set(
      points[offset] + shift * direction[0],
      points[offset + 1] + shift * direction[1],
      points[offset + 2] + shift * direction[2],
    );
    const value = field.query(bone, point).distance;
    if (Number.isNaN(value) || value === -Infinity) fail("骨距离非有限");
    return value;
  }
  function update(control, relative) {
    if (control.length !== before.length) fail("控制点尺寸");
    for (const value of control)
      if (!Number.isFinite(value)) fail("控制点非有限");
    before.set(control);
    const updates = [];
    for (let cycle = 0; cycle < cycles; cycle++) {
      const updateCount = updates.length;
      for (let boneIndex = 0; boneIndex < data.bones.length; boneIndex++) {
        const bone = data.bones[boneIndex];
        const trigger = triggers[boneIndex],
          clearance = clearances[boneIndex];
        const matrix = matrixElements(
          relative instanceof Map ? relative.get(bone) : relative[bone],
        );
        if (!Array.from(matrix).every(Number.isFinite)) fail("接触骨矩阵");
        updatePoints(control);
        let activeCount = 0;
        const direction = [0, 0, 0];
        for (let i = 0; i < probeCount; i++) {
          const d = distanceAt(bone, i * 3, 0, direction);
          if (d >= trigger) continue;
          active[activeCount++] = i;
          const p = (boneIndex * probeCount + i) * 3;
          const x = probeNormals[p],
            y = probeNormals[p + 1],
            z = probeNormals[p + 2];
          direction[0] +=
            (clearance - d) * (matrix[0] * x + matrix[4] * y + matrix[8] * z);
          direction[1] +=
            (clearance - d) * (matrix[1] * x + matrix[5] * y + matrix[9] * z);
          direction[2] +=
            (clearance - d) * (matrix[2] * x + matrix[6] * y + matrix[10] * z);
        }
        if (!activeCount) continue;
        const length = Math.hypot(...direction);
        if (length < 1e-12) fail("无法确定共同避让方向");
        for (let axis = 0; axis < 3; axis++) direction[axis] /= length;
        for (let j = 0; j < activeCount; j++) {
          const index = active[j],
            offset = index * 3;
          let lo = 0,
            hi = rayStep,
            escaped = false;
          for (let step = 0; step < raySteps; step++) {
            if (distanceAt(bone, offset, hi, direction) >= clearance) {
              escaped = true;
              break;
            }
            lo = hi;
            hi += rayStep;
          }
          if (!escaped) fail(`共同避让未离开 ${bone}，保留失败状态`);
          for (let step = 0; step < bisections; step++) {
            const middle = (lo + hi) * 0.5;
            if (distanceAt(bone, offset, middle, direction) < clearance)
              lo = middle;
            else hi = middle;
          }
          demands[j] = hi;
          rows.set(
            probeBasis.subarray(index * width, (index + 1) * width),
            j * width,
          );
        }
        const result = solveContactCover(
          rows.subarray(0, activeCount * width),
          demands.subarray(0, activeCount),
          width,
        );
        let maximumShiftM = 0;
        for (let i = 0; i < count; i++) {
          let shift = 0;
          for (let j = 0; j < width; j++)
            shift += basis[i * width + j] * result.coefficients[j];
          for (let axis = 0; axis < 3; axis++)
            control[i * 3 + axis] += shift * direction[axis];
          maximumShiftM = Math.max(maximumShiftM, shift);
        }
        updates.push({
          bone,
          cycle,
          probes: activeCount,
          maximumShiftM,
          pivots: result.pivots,
        });
      }
      if (updates.length === updateCount) break;
    }
    updatePoints(control);
    let minimumProbedDistanceM = Infinity,
      negativeProbes = 0,
      maximumCorrectionM = 0;
    const zeroDirection = [0, 0, 0];
    for (const bone of data.bones)
      for (let i = 0; i < probeCount; i++) {
        const value = distanceAt(bone, i * 3, 0, zeroDirection);
        minimumProbedDistanceM = Math.min(minimumProbedDistanceM, value);
        if (value < 0) negativeProbes++;
      }
    for (let i = 0; i < count; i++)
      maximumCorrectionM = Math.max(
        maximumCorrectionM,
        Math.hypot(
          control[i * 3] - before[i * 3],
          control[i * 3 + 1] - before[i * 3 + 1],
          control[i * 3 + 2] - before[i * 3 + 2],
        ),
      );
    stats = {
      updates,
      minimumProbedDistanceM,
      negativeProbes,
      maximumCorrectionM,
      scope:
        "Declared control probes and contact bones only; not a full-surface proof.",
    };
    return stats;
  }
  return {
    update,
    get stats() {
      return stats;
    },
  };
}
