// Content-addressed, versioned results. A cached case is never used for an edited scene.
// The active scene owns its frames. Revisiting a discarded scene reads the
// content-addressed file again instead of keeping several complete movies alive.
let ready = null;
let reading = null;
const summaries = new WeakMap();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_CASE_BYTES = 64 * 1024 * 1024;

function stable(value) {
  if (typeof value === "number" && !Number.isFinite(value))
    throw Error("动作包含无效数字。");
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

export function sceneSignature(scene) {
  const loadKg = scene.loadKg ?? 0;
  const hand = scene.hand ?? "right";
  const gear = scene.equipment || {};
  return JSON.stringify(stable({
    keyframes: scene.keyframes,
    support: scene.support ?? "seated",
    groundEnabled: scene.groundEnabled ?? scene.support === "feet",
    supportFeet: scene.supportFeet ?? "both",
    loadKg, hand,
    strengthScale: scene.strengthScale ?? 1,
    muscleScale: scene.muscleScale ?? {},
    preview: scene.preview ?? false,
    equipment: {
      type: gear.type ?? (loadKg > 0 ? "dumbbell" : "none"),
      massKg: gear.massKg ?? loadKg,
      hand: gear.hand ?? hand,
      friction: gear.friction ?? 1,
    },
  }));
}

function frameValidator(value, info) {
  const names = new Set(info.muscles.map((m) => m.name));
  const branchDefinitions = new Map(info.muscles.map((m) => [m.name, m.branches || []]));
  const coordinates = info.coordinates.map((c) => c.name);
  const finite = Number.isFinite;
  const vectors = ["torques", "rawTorques", "muscleTorques", "passiveTorques", "jointPassiveTorques", "reserveTorques"];
  const pelvis = coordinates.filter((name) => name.startsWith("pelvis_"));
  const handCoordinates = info.handReferenceCoordinates || [];
  const completeHandReference = (frame) => {
    if (!handCoordinates.length) return true;
    const hand = frame.handReferenceTorques;
    if (!hand || typeof hand !== "object" || Array.isArray(hand) ||
        Object.keys(hand).length !== handCoordinates.length ||
        !handCoordinates.every((name) => finite(hand[name]))) return false;
    return ["otherJointPassiveTorques", "externalTorques"].every((key) =>
      coordinates.every((name) => finite(frame[key]?.[name]))) &&
      coordinates.every((name) =>
        Math.abs(frame.jointPassiveTorques[name] - frame.otherJointPassiveTorques[name] - (hand[name] ?? 0)) <= 1e-7 &&
        Math.abs(frame.rawTorques[name] - frame.jointPassiveTorques[name] - frame.externalTorques[name] - frame.torques[name]) <= 1e-7);
  };
  const completeBranches = (muscle) => {
    const expected = branchDefinitions.get(muscle.name) || [];
    const branches = muscle.branches || [];
    return Array.isArray(branches) && branches.length === expected.length &&
      branches.every((branch, index) => branch.id === expected[index].id &&
        finite(branch.coefficient) && branch.coefficient > 0 &&
        Math.abs(branch.coefficient - expected[index].coefficient) < 1e-10 &&
        finite(branch.force) && branch.force >= 0 &&
        Math.abs(branch.force - muscle.force * branch.coefficient) <= 1e-7 * Math.max(1, muscle.force) &&
        Array.isArray(branch.path) && branch.path.length >= 2 &&
        branch.path.every((point) => Array.isArray(point) && point.length === 3 && point.every(finite))) &&
      (!branches.length || (Array.isArray(muscle.path) && branches[0].path.length === muscle.path.length &&
        branches[0].path.every((point, index) => point.every((coordinate, axis) => coordinate === muscle.path[index]?.[axis]))));
  };
  return (f) =>
      f.quantitativeValid === true && f.frameFeasible === true && f.muscleValid === true &&
      f.anatomy?.valid === true && f.support?.feasible === true && f.groundCheck?.feasible === true &&
      finite(f.t) && finite(f.balanceErrorNm) && finite(f.nativeForceErrorN) &&
      vectors.every((key) => coordinates.every((name) => finite(f[key]?.[name]))) &&
      completeHandReference(f) &&
      Object.values(f.jointLimitTorques || {}).every(finite) &&
      pelvis.every((name) => finite(f.support.baseResidual?.[name])) &&
      f.muscles?.length === names.size && new Set(f.muscles.map((m) => m.name)).size === names.size &&
      f.muscles.every((m) => names.has(m.name) && finite(m.force) && m.force >= 0 &&
        finite(m.activation) && m.activation >= 0 && m.activation <= 1 &&
        finite(m.passiveForce) && finite(m.activeCapacity) && completeBranches(m)) &&
      (!(value.scene?.loadKg > 0) || (f.grasp?.geometryValid === true && f.grasp.feasible === true &&
        finite(f.grasp.objectResidualForceN) && f.grasp.objectResidualForceN < 1e-6 &&
        finite(f.grasp.objectResidualMomentNm) && f.grasp.objectResidualMomentNm < 1e-6 &&
        f.grasp.contacts?.length > 0 && f.grasp.contacts.every((c) => finite(c.normalN) &&
          finite(c.frictionMarginN) && c.forceOnObject?.length === 3 && c.forceOnObject.every(finite))));
}

function incompleteResult() {
  return Error("结果缺少完整有效的逐帧肌力、力矩或接触支撑，未启用受力回放。");
}

function assertHeader(value, info) {
  if (value?.model !== info.id || value.computationSha256 !== info.computationSha256 ||
      value.status !== "solved" || value.quantitativeValid !== true ||
      value.kinematicOnly !== false || value.failures?.length !== 0) throw incompleteResult();
}

export function assertCompleteResult(value, info) {
  assertHeader(value, info);
  if (!value.frames?.length || !value.frames.every(frameValidator(value, info))) throw incompleteResult();
}

function assertEnvelope(payload, motion, info) {
  if (payload?.schema !== 1 || payload.model !== info.id ||
      payload.modelSha256 !== info.sourceSha256 || payload.computationSha256 !== info.computationSha256)
    throw Error("缓存与当前模型或计算版本不一致，请重新计算。");
  if (sceneSignature(payload.scene) !== sceneSignature(motion.scene) ||
      sceneSignature(payload.result?.scene || {}) !== sceneSignature(motion.scene))
    throw Error("缓存的动作、负重或支撑条件与案例不一致，已拒绝使用。");
}

function assertTimeline(times, motion, value) {
  if (!times.length || times.length !== motion.verification?.frames || times.length !== value.metrics?.frames ||
      motion.scene.keyframes.some((key) => !times.includes(key.t)) ||
      times[0] !== 0 || times.at(-1) !== motion.scene.keyframes.at(-1).t ||
      times.some((t, i) => i > 0 && t <= times[i - 1]))
    throw Error("缓存时间轴不完整，已拒绝使用。");
}

export function validateCachedMotion(payload, motion, info) {
  assertEnvelope(payload, motion, info);
  assertCompleteResult(payload.result, info);
  assertTimeline(payload.result.frames.map((f) => f.t), motion, payload.result);
  return payload.result;
}

async function verifiedBytes(response, cache) {
  if (!Number.isSafeInteger(cache.bytes) || cache.bytes <= 0 || cache.bytes > MAX_CASE_BYTES)
    throw Error("案例缓存大小无效或超出单个案例读取上限。");
  const bytes = new Uint8Array(cache.bytes);
  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.length > bytes.length - received) {
        await reader.cancel();
        throw Error("案例缓存长度不完整，已拒绝使用。");
      }
      bytes.set(value, received);
      received += value.length;
    }
  } finally {
    reader.releaseLock();
  }
  if (received !== bytes.length) throw Error("案例缓存长度不完整，已拒绝使用。");
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  if (digest !== cache.sha256) throw Error("案例缓存内容校验失败，已拒绝使用。");
  return bytes;
}

// Locate the schema-1 result.frames array without decoding the entire UTF-8
// document. JSON.parse still verifies each complete frame and the envelope.
function skipSpace(bytes, i) {
  while ([32, 9, 10, 13].includes(bytes[i])) i++;
  return i;
}

function valueEnd(bytes, i) {
  let depth = 0, quoted = false;
  for (; i < bytes.length; i++) {
    const ch = bytes[i];
    if (quoted) {
      if (ch === 92) i++; // escape inside a string
      else if (ch === 34) {
        quoted = false;
        if (!depth) return i + 1;
      }
    } else if (ch === 34) quoted = true;
    else if (ch === 123 || ch === 91) depth++;
    else if (ch === 125 || ch === 93) {
      if (!depth) return i;
      if (!--depth) return i + 1;
    } else if (ch === 44 && !depth) return i;
  }
  throw Error("案例缓存 JSON 结构不完整。");
}

function memberStart(bytes, start, name) {
  if (bytes[start] !== 123) throw Error("案例缓存缺少动作数据。");
  let i = skipSpace(bytes, start + 1);
  while (bytes[i] === 34) {
    const end = valueEnd(bytes, i);
    const key = JSON.parse(decoder.decode(bytes.subarray(i, end)));
    i = skipSpace(bytes, end);
    if (bytes[i] !== 58) break;
    i = skipSpace(bytes, i + 1);
    if (key === name) return i;
    i = skipSpace(bytes, valueEnd(bytes, i));
    if (bytes[i] !== 44) break;
    i = skipSpace(bytes, i + 1);
  }
  throw Error("案例缓存缺少动作数据。");
}

async function frameArray(bytes) {
  const result = memberStart(bytes, skipSpace(bytes, 0), "result");
  const start = memberStart(bytes, result, "frames");
  if (bytes[start] !== 91) throw incompleteResult();
  const spans = [];
  let i = skipSpace(bytes, start + 1);
  let yielded = performance.now();
  if (bytes[i] !== 93) {
    while (true) {
      if (bytes[i] !== 123) throw incompleteResult();
      const end = valueEnd(bytes, i);
      spans.push([i, end]);
      i = skipSpace(bytes, end);
      if (bytes[i] === 93) break;
      if (bytes[i] !== 44) throw incompleteResult();
      i = skipSpace(bytes, i + 1);
      if (performance.now() - yielded > 12) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        yielded = performance.now();
      }
    }
  }
  const metadata = decoder.decode(bytes.subarray(0, start)) + "null" + decoder.decode(bytes.subarray(i + 1));
  const payload = JSON.parse(metadata);
  if (payload.result?.frames !== null) throw incompleteResult();
  return { payload, spans };
}

function compactFrame(encoded, frame, keys, recent) {
  // Keep object identity for indexOf/includes and cheap time comparisons.
  // Each facade owns its small independent byte slice so a displayed frame
  // cannot retain an obsolete movie's entire byte buffer after a scene change.
  for (const key of keys) {
    if (Object.hasOwn(frame, key)) continue;
    Object.defineProperty(frame, key, { enumerable: true, get() {
      if (recent.frame !== frame) {
        recent.data = JSON.parse(decoder.decode(encoded));
        recent.frame = frame;
      }
      return recent.data[key];
    } });
  }
  return frame;
}

export function cachedMuscleRanges(result) {
  const summary = summaries.get(result);
  return summary ? new Map([...summary.ranges].map(([k, v]) => [k, { ...v }])) : null;
}

export function cachedForceSeries(result, name) {
  const summary = summaries.get(result);
  if (!summary) return null;
  const forces = summary.forces.get(name);
  return forces ? summary.times.map((t, i) => ({ t, force: forces[i] })) : [];
}

async function unpack(bytes, motion, info) {
  const { payload, spans } = await frameArray(bytes);
  assertEnvelope(payload, motion, info);
  const result = payload.result;
  assertHeader(result, info);
  if (!spans.length || spans.length !== motion.verification?.frames || spans.length !== result.metrics?.frames)
    throw Error("缓存时间轴不完整，已拒绝使用。");
  const valid = frameValidator(result, info), recent = {};
  const times = [], ranges = new Map(), forces = new Map();
  result.frames = [];
  let lastYield = performance.now();
  for (let i = 0; i < spans.length; i++) {
    const [start, end] = spans[i];
    const encoded = bytes.slice(start, end);
    const frame = JSON.parse(decoder.decode(encoded));
    if (!valid(frame)) throw incompleteResult();
    times.push(frame.t);
    for (const muscle of frame.muscles) {
      if (i === 0) {
        ranges.set(muscle.name, { min: muscle.force, max: muscle.force, count: spans.length });
        forces.set(muscle.name, new Float64Array(spans.length));
      }
      const range = ranges.get(muscle.name);
      range.min = Math.min(range.min, muscle.force);
      range.max = Math.max(range.max, muscle.force);
      forces.get(muscle.name)[i] = muscle.force;
    }
    const indexFields = { t: frame.t, quantitativeValid: frame.quantitativeValid, muscleValid: frame.muscleValid };
    result.frames.push(compactFrame(encoded, indexFields, Object.keys(frame), recent));
    if (performance.now() - lastYield > 12) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      lastYield = performance.now();
    }
  }
  assertTimeline(times, motion, result);
  for (const range of ranges.values()) range.change = range.max - range.min;
  summaries.set(result, { times, ranges, forces });
  return payload;
}

async function readCase(motion, info, cache, key, fetchImpl) {
  const value = ready?.key === key && ready.result.deref();
  if (value) {
    assertEnvelope({ ...ready.envelope, result: value }, motion, info);
    assertHeader(value, info);
    const valid = frameValidator(value, info);
    let yielded = performance.now();
    for (const frame of value.frames) {
      if (!valid(frame)) throw incompleteResult();
      if (performance.now() - yielded > 12) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        yielded = performance.now();
      }
    }
    assertTimeline(value.frames.map((frame) => frame.t), motion, value);
    return { value, source: "memory" };
  }
  ready = null;
  const response = await fetchImpl(cache.url);
  if (!response.ok) throw Error(`案例缓存读取失败（${response.status}），可点击“重新计算动作”。`);
  const payload = await unpack(await verifiedBytes(response, cache), motion, info);
  const { result, ...envelope } = payload;
  ready = { key, envelope, result: new WeakRef(result) };
  return { value: result, source: "disk" };
}

export async function loadCachedMotion(motion, info, fetchImpl = fetch) {
  const cache = motion.cachedResult;
  if (!cache || !/^[a-f0-9]{64}$/.test(cache.sha256) ||
      cache.url !== `./motion-cache/${cache.sha256}.json`)
    throw Error("此案例尚无可核验的固定缓存，请点击“重新计算动作”。");
  const key = `${cache.sha256}:${info.id}:${info.sourceSha256}:${info.computationSha256}`;
  // Only one case can allocate its receive buffer or decode frames at a time.
  while (reading) await reading.catch(() => {});
  reading = readCase(motion, info, cache, key, fetchImpl);
  try {
    return await reading;
  } finally {
    reading = null;
  }
}
