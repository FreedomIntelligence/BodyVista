import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cachedForceSeries, cachedMuscleRanges, loadCachedMotion, sceneSignature, validateCachedMotion } from "../experiments/body-lab/motion-cache.js";

function fixture(tag = "base") {
  const info = { id: tag, sourceSha256: "model", computationSha256: "code", muscles: [{ name: "m" }], coordinates: [{ name: "pelvis_ty" }, { name: "elbow" }] };
  const scene = { keyframes: [{ t: 0, q: { elbow: 0 } }, { t: 1, q: { elbow: 10 } }], support: "assisted", loadKg: 0 };
  const frame = {
    quantitativeValid: true, frameFeasible: true, muscleValid: true,
    anatomy: { valid: true }, support: { feasible: true, baseResidual: { pelvis_ty: 585 } }, groundCheck: { feasible: true },
    balanceErrorNm: 0, nativeForceErrorN: 0, jointLimitTorques: {},
    muscles: [{ name: "m", force: 0, activation: 0, passiveForce: 0, activeCapacity: 1 }],
  };
  for (const key of ["torques", "rawTorques", "muscleTorques", "passiveTorques", "jointPassiveTorques", "reserveTorques"])
    frame[key] = { pelvis_ty: 585, elbow: 0 };
  const result = { model: info.id, computationSha256: "code", scene, status: "solved", quantitativeValid: true, kinematicOnly: false, failures: [], metrics: { frames: 3 }, frames: [{ ...frame, t: 0 }, { ...structuredClone(frame), t: 0.5 }, { ...structuredClone(frame), t: 1 }] };
  const payload = { schema: 1, model: info.id, modelSha256: "model", computationSha256: "code", scene, result };
  const motion = { scene, verification: { frames: 3 } };
  return { info, motion, payload };
}

test("cache accepts legitimate zero tension and equivalent explicit scene defaults", () => {
  const { info, motion, payload } = fixture();
  payload.result.scene = { ...motion.scene, groundEnabled: false, supportFeet: "both", hand: "right", strengthScale: 1, muscleScale: {}, preview: false, equipment: { type: "none", massKg: 0, hand: "right", friction: 1 } };
  assert.equal(sceneSignature(payload.result.scene), sceneSignature(motion.scene));
  assert.equal(validateCachedMotion(payload, motion, info).frames[0].muscles[0].force, 0);
});

test("declared hand passive terms are complete and counted exactly once", () => {
  const { info, motion, payload } = fixture();
  info.handReferenceCoordinates = ["elbow"];
  for (const frame of payload.result.frames) {
    frame.handReferenceTorques = { elbow: 0.2 };
    frame.otherJointPassiveTorques = { pelvis_ty: 585, elbow: 0.3 };
    frame.externalTorques = { pelvis_ty: -585, elbow: 0.1 };
    frame.rawTorques.elbow = 1;
    frame.jointPassiveTorques.elbow = 0.5;
    frame.torques.elbow = 0.4;
    frame.muscleTorques.elbow = 0.4;
  }
  validateCachedMotion(payload, motion, info);
  for (const mutate of [
    (f) => { delete f.handReferenceTorques; },
    (f) => { f.handReferenceTorques.elbow = null; },
    (f) => { f.handReferenceTorques.extra = 0; },
    (f) => { f.handReferenceTorques.elbow = 0.4; },
    (f) => { f.otherJointPassiveTorques.elbow = 0.5; },
    (f) => { f.externalTorques.elbow = 0.2; },
  ]) {
    const bad = structuredClone(payload);
    mutate(bad.result.frames[1]);
    assert.throws(() => validateCachedMotion(bad, motion, info), /完整有效/);
  }
  for (const frame of payload.result.frames) {
    frame.handReferenceTorques.elbow = 0;
    frame.otherJointPassiveTorques.elbow = 0.5;
  }
  validateCachedMotion(payload, motion, info);
});

test("edited load, timing, support and friction cannot reuse a different scene's forces", () => {
  for (const change of [{ loadKg: 1 }, { support: "free" }, { keyframes: [{ t: 0, q: {} }, { t: 2, q: {} }] }, { equipment: { type: "none", friction: 0 } }]) {
    const { info, motion, payload } = fixture();
    motion.scene = { ...motion.scene, ...change };
    assert.throws(() => validateCachedMotion(payload, motion, info), /条件与案例不一致/);
  }
});

test("wrong model/code, missing force, incomplete torque and preview are rejected", () => {
  const changes = [
    (p) => { p.modelSha256 = "old"; },
    (p) => { p.computationSha256 = "old"; },
    (p) => { p.result.computationSha256 = "old"; },
    (p) => { p.result.frames[0].muscles[0].force = null; },
    (p) => { delete p.result.frames[0].muscleTorques.elbow; },
    (p) => { p.result.kinematicOnly = true; },
    (p) => { p.result.frames[0].support.feasible = false; },
  ];
  for (const change of changes) {
    const { info, motion, payload } = fixture();
    change(payload);
    assert.throws(() => validateCachedMotion(payload, motion, info));
  }
});

test("a loaded dumbbell needs valid contact forces and object balance", () => {
  const { info, motion, payload } = fixture();
  motion.scene.loadKg = 1;
  assert.throws(() => validateCachedMotion(payload, motion, info), /完整有效/);
});

test("all declared tendon branches retain physical force ratios and separate paths", () => {
  const { info, motion, payload } = fixture();
  const definitions = [{ id: "main", coefficient: 1 }, { id: "CS", coefficient: 0.495 }];
  info.muscles[0].branches = definitions;
  for (const frame of payload.result.frames) {
    const muscle = frame.muscles[0];
    muscle.force = 10;
    muscle.path = [[0, 0, 0], [0, 1, 0]];
    muscle.branches = definitions.map((definition, index) => ({ ...definition,
      force: 10 * definition.coefficient,
      path: index ? [[1, 0, 0], [1, 1, 0]] : muscle.path }));
  }
  assert.equal(validateCachedMotion(payload, motion, info).frames[0].muscles[0].branches[1].force, 4.95);
  for (const mutate of [
    (m) => { delete m.branches; },
    (m) => { m.branches[1].force = null; },
    (m) => { m.branches[1].force = 10; },
    (m) => { m.branches[1].coefficient = 0.4; },
    (m) => { m.branches[1].path = [[1, 0, 0]]; },
    (m) => { m.branches[0].path = [[2, 0, 0], [2, 1, 0]]; },
  ]) {
    const bad = structuredClone(payload);
    mutate(bad.result.frames[0].muscles[0]);
    assert.throws(() => validateCachedMotion(bad, motion, info), /完整有效/);
  }
});

test("a missing middle sample or key time is not a complete cached motion", () => {
  const { info, motion, payload } = fixture();
  payload.result.frames.splice(1, 1);
  assert.throws(() => validateCachedMotion(payload, motion, info), /时间轴不完整/);
  payload.result.metrics.frames = motion.verification.frames = 2;
  motion.scene.keyframes.splice(1, 0, { t: 0.5, q: { elbow: 5 } });
  assert.throws(() => validateCachedMotion(payload, motion, info), /时间轴不完整/);
});

test("verified bytes are fetched once and subsequent clicks use memory; wrong checksum is rejected", async () => {
  const { info, motion, payload } = fixture("fetch");
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  motion.cachedResult = { sha256, url: `./motion-cache/${sha256}.json`, bytes: bytes.length };
  let reads = 0;
  const mockFetch = async () => { reads++; return new Response(bytes); };
  assert.equal((await loadCachedMotion(motion, info, mockFetch)).source, "disk");
  assert.equal((await loadCachedMotion(motion, info, mockFetch)).source, "memory");
  assert.equal(reads, 1);
  const wrong = "a".repeat(64);
  motion.cachedResult = { sha256: wrong, url: `./motion-cache/${wrong}.json`, bytes: bytes.length };
  await assert.rejects(loadCachedMotion(motion, info, mockFetch), /内容校验失败/);
});

function packed(tag, prepare) {
  const example = fixture(tag);
  prepare?.(example.payload);
  const bytes = new TextEncoder().encode(JSON.stringify(example.payload));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  example.motion.cachedResult = { sha256, url: `./motion-cache/${sha256}.json`, bytes: bytes.length };
  return { ...example, fetch: async () => new Response(bytes) };
}

test("compact frames preserve nested JSON, stable identities, exact force curves and independent range maps", async () => {
  const original = packed("compact", (payload) => {
    payload.scene.note = '影像中 "frames": [ 与括号 } ] 只是一段文字';
    payload.result.frames.forEach((frame, i) => {
      frame.muscles[0].force = 0.25 * i;
      frame.muscles[0].path = [[0, i, 2], [i, 1, 0]];
      frame.note = '右侧 "{ \\ ] }肌"';
    });
  });
  const { value } = await loadCachedMotion(original.motion, original.info, original.fetch);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), original.payload.result);
  assert.equal(value.frames.includes(value.frames.at(-1)), true);
  assert.deepEqual(cachedForceSeries(value, "m"), [{ t: 0, force: 0 }, { t: 0.5, force: 0.25 }, { t: 1, force: 0.5 }]);
  assert.deepEqual(cachedForceSeries(value, "missing"), []);
  assert.deepEqual(cachedMuscleRanges(value).get("m"), { min: 0, max: 0.5, count: 3, change: 0.5 });
  cachedMuscleRanges(value).clear();
  assert.equal(cachedMuscleRanges(value).size, 1);
  assert.equal(cachedMuscleRanges(original.payload.result), null);
  assert.equal(cachedForceSeries(original.payload.result, "m"), null);
});

test("switching cases drops the old cache entry even if a view still holds its result", async () => {
  const a = packed("small-a"), b = packed("small-b");
  const first = await loadCachedMotion(a.motion, a.info, a.fetch);
  await loadCachedMotion(b.motion, b.info, b.fetch);
  assert.equal((await loadCachedMotion(a.motion, a.info, a.fetch)).source, "disk");
  assert.equal(first.value.frames[1].muscles[0].force, 0);
});

test("frame validation and bounded transfer reject corrupt middle frames and excess bytes", async () => {
  const bad = packed("corrupt", (payload) => { payload.result.frames[1].muscles[0].force = -1; });
  await assert.rejects(loadCachedMotion(bad.motion, bad.info, bad.fetch), /完整有效/);
  const short = packed("length");
  short.motion.cachedResult.bytes--;
  await assert.rejects(loadCachedMotion(short.motion, short.info, short.fetch), /长度不完整/);
});

test("decoding stays frame-sized and reading force charts or timestamps does not hydrate geometry", async (t) => {
  const sample = packed("decode-budget", (payload) => {
    for (const frame of payload.result.frames) frame.label = "肌肉表面".repeat(240);
  });
  const sizes = [];
  const decode = TextDecoder.prototype.decode;
  t.mock.method(TextDecoder.prototype, "decode", function (input, options) {
    sizes.push(input?.byteLength || 0);
    return decode.call(this, input, options);
  });
  const { value } = await loadCachedMotion(sample.motion, sample.info, sample.fetch);
  assert.ok(Math.max(...sizes) < sample.motion.cachedResult.bytes / 2);
  const reads = sizes.length;
  assert.equal(value.frames[1].t, 0.5);
  cachedForceSeries(value, "m");
  cachedMuscleRanges(value);
  assert.equal(sizes.length, reads);
  assert.equal(value.frames[1].label, sample.payload.result.frames[1].label);
  assert.equal(value.frames[1].muscles[0].name, "m");
  assert.equal(sizes.length, reads + 1);
});
