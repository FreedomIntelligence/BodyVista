import * as THREE from "../../src/vendor/three.js";
import { loadBoneVolumes, readAtlasAsset } from "./bone-volumes.js";
import { createCrossSections, poseCrossSections, deformCrossSection } from "./muscle-path-shape.js";

const clamp = THREE.MathUtils.clamp;
const WARM = new THREE.Color("#d8834e"),
  HOT = new THREE.Color("#a5222d");
const COLD = new THREE.Color("#a2b7b3"),
  SELECTED = new THREE.Color("#5e9987");

const NATIVE_PATH_SAMPLES = 513;

/** Natural cubic spline with chord-length knots, matching the source builder.
 * Adjacent coincident sites are collapsed before solving the tridiagonal system.
 * A collapsed path retains a finite center and a zero tangent; the caller then
 * retains the endpoint-bone orientation instead of inventing a bending axis.
 */
export function sampleNativePath(path, count = NATIVE_PATH_SAMPLES) {
  if (!Array.isArray(path) || !path.length || !Number.isInteger(count) || count < 2)
    throw Error("原生肌腱路径采样参数无效。");
  const points = [], knots = [0];
  for (const point of path) {
    if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite))
      throw Error("原生肌腱路径包含无效坐标。");
    const previous = points[points.length - 1];
    const distance = previous ? Math.hypot(...point.map((v, i) => v - previous[i])) : 0;
    if (previous && distance <= 1e-9) continue;
    if (previous) knots.push(knots[knots.length - 1] + distance);
    points.push(point);
  }
  const centers = new Float64Array(count * 3), tangents = new Float64Array(count * 3);
  if (points.length === 1) {
    for (let i = 0; i < count; i++) centers.set(points[0], i * 3);
    return { centers, tangents };
  }
  const total = knots[knots.length - 1];
  for (let i = 1; i < knots.length; i++) knots[i] /= total;
  const n = points.length, second = new Float64Array(n * 3);
  const upper = new Float64Array(n), rhs = new Float64Array(n * 3);
  // Natural endpoint conditions: the second derivative is zero at both ends.
  for (let i = 1; i < n - 1; i++) {
    const left = knots[i] - knots[i - 1], right = knots[i + 1] - knots[i];
    const denominator = 2 * (left + right) - left * upper[i - 1];
    upper[i] = right / denominator;
    for (let axis = 0; axis < 3; axis++) {
      const slope = (points[i + 1][axis] - points[i][axis]) / right
        - (points[i][axis] - points[i - 1][axis]) / left;
      rhs[i * 3 + axis] = (6 * slope - left * rhs[(i - 1) * 3 + axis]) / denominator;
    }
  }
  for (let i = n - 2; i > 0; i--)
    for (let axis = 0; axis < 3; axis++)
      second[i * 3 + axis] = rhs[i * 3 + axis] - upper[i] * second[(i + 1) * 3 + axis];
  let segment = 0;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    while (segment < n - 2 && t > knots[segment + 1]) segment++;
    const h = knots[segment + 1] - knots[segment];
    const a = (knots[segment + 1] - t) / h, b = (t - knots[segment]) / h;
    for (let axis = 0; axis < 3; axis++) {
      const y0 = points[segment][axis], y1 = points[segment + 1][axis];
      const m0 = second[segment * 3 + axis], m1 = second[(segment + 1) * 3 + axis];
      centers[i * 3 + axis] = a * y0 + b * y1 + ((a * a * a - a) * m0 + (b * b * b - b) * m1) * h * h / 6;
      tangents[i * 3 + axis] = (y1 - y0) / h + ((1 - 3 * a * a) * m0 + (3 * b * b - 1) * m1) * h / 6;
    }
  }
  return { centers, tangents };
}

function smoothEndGain(t, band) {
  if (band === 0) return 1;
  const smooth = (value) => {
    const x = clamp(value, 0, 1);
    return x * x * x * (x * (x * 6 - 15) + 10);
  };
  return smooth(t / band) * smooth((1 - t) / band);
}

const curveOffset = new THREE.Vector3(), curveTangent = new THREE.Vector3();

function curveCenterAndTangent(c, u, center, tangent) {
  const u2 = u * u, u3 = u2 * u;
  center.copy(c.p0).multiplyScalar(2 * u3 - 3 * u2 + 1)
    .addScaledVector(c.t0, u3 - 2 * u2 + u)
    .addScaledVector(c.p1, -2 * u3 + 3 * u2)
    .addScaledVector(c.t1, u3 - u2);
  tangent.copy(c.p0).multiplyScalar(6 * u2 - 6 * u)
    .addScaledVector(c.t0, 3 * u2 - 4 * u + 1)
    .addScaledVector(c.p1, -6 * u2 + 6 * u)
    .addScaledVector(c.t1, 3 * u2 - 2 * u);
}

function regionMatches(region, part) {
  if (region === "all" || region === part.region) return true;
  if (region.startsWith("arm_"))
    return part.region === region.replace("arm_", "hand_");
  if (region.startsWith("leg_"))
    return part.region === region.replace("leg_", "foot_");
  if (["trunk", "torso"].includes(region))
    return ["trunk", "pelvis"].includes(part.region);
  if (["head", "neck"].includes(region)) return part.region === "neck";
  if (region === "ribs")
    return (
      part.region === "trunk" &&
      /intercostal|serratus|transversus thoracis/.test(part.english)
    );
  return false;
}

/** Original atlas surfaces with declared source-derived refinement, registered
 * to the simulation skeleton. These display deformations and optional bone
 * contacts do not create individual muscle mechanics or a soft-tissue solver.
 */
export async function createAnatomicalMuscles({ onProgress = () => {}, signal } = {}) {
  signal?.throwIfAborted();
  const resources = [];
  let stopWorkers, closed = false;
  function own(resource) {
    // An awaited child loader may resolve just after the caller cancelled.
    if (closed) {
      resource.dispose();
      signal.throwIfAborted();
    }
    resources.push(resource);
    return resource;
  }
  function dispose() {
    signal?.removeEventListener("abort", dispose);
    if (closed) return;
    closed = true;
    stopWorkers?.();
    for (const resource of resources.reverse()) resource.dispose();
    resources.length = 0;
  }
  signal?.addEventListener("abort", dispose, {once: true});
  try {
    const layer = await buildAnatomicalMuscles(onProgress, signal, own);
    stopWorkers = layer.dispose;
    if (closed) stopWorkers();
    signal?.throwIfAborted();
    // The view now owns the layer, including its lifetime during compileAsync.
    // Disposing a compiling material invalidates Three's pending program poll.
    signal?.removeEventListener("abort", dispose);
    layer.dispose = dispose;
    return layer;
  } catch (error) {
    dispose();
    throw error;
  }
}

async function buildAnatomicalMuscles(onProgress, signal, own) {
  let nextYield = performance.now() + 12;
  async function checkBuild() {
    signal?.throwIfAborted();
    if (signal && performance.now() >= nextYield) {
      await new Promise(resolve => setTimeout(resolve, 0));
      signal.throwIfAborted();
      nextYield = performance.now() + 12;
    }
  }
  const manifestUrl = new URL("./atlas-muscles.json", import.meta.url);
  const reply = await fetch(manifestUrl, {signal});
  if (!reply.ok) throw Error("原图谱肌肉绑定清单未找到。");
  const manifest = await reply.json();
  signal?.throwIfAborted();
  const buffer = await readAtlasAsset(manifest, manifestUrl, "./atlas-muscles.bin", signal, loaded =>
    onProgress({loaded, total: manifest.byteLength, message: "正在载入原图谱肌肉表面"}));
  if (buffer.byteLength !== manifest.byteLength)
    throw Error("原图谱肌肉资源不完整。");
  const atlasDigest = await crypto.subtle.digest("SHA-256", buffer);
  signal?.throwIfAborted();
  const atlasHash = Array.from(new Uint8Array(atlasDigest), value => value.toString(16).padStart(2, "0")).join("");
  if (atlasHash !== manifest.binarySha256)
    throw Error("肌肉表面与形变算子的资源版本不一致，请刷新页面。");
  function unpackSheet(value) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.some(item => item && typeof item === "object")
      ? value.map(unpackSheet) : value;
    if (value.atlasArray === true) {
      const Type = {uint32: Uint32Array, int32: Int32Array, float32: Float32Array, float64: Float64Array}[value.type];
      if (!Type || !Number.isInteger(value.byteOffset) || value.byteOffset < 0
        || value.byteOffset % Type.BYTES_PER_ELEMENT || !Number.isInteger(value.length) || value.length < 0
        || value.byteOffset + value.length * Type.BYTES_PER_ELEMENT > buffer.byteLength)
        throw Error("肌肉形变算子超出资源范围。");
      return new Type(buffer, value.byteOffset, value.length);
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpackSheet(item)]));
  }
  for (const part of manifest.parts) if (part.sheetDeformation)
    part.sheetDeformation = unpackSheet(part.sheetDeformation);
  const geometry = own(new THREE.BufferGeometry());
  for (const [name, record] of Object.entries(manifest.attributes)) {
    const Constructor = {
      float32: Float32Array,
      uint16: Uint16Array,
      uint32: Uint32Array,
    }[record.type];
    const array = new Constructor(buffer, record.byteOffset, record.length);
    const attribute = new THREE.BufferAttribute(array, record.itemSize);
    if (name === "index") geometry.setIndex(attribute);
    else geometry.setAttribute(name, attribute);
  }
  if (!geometry.hasAttribute("anchorBlend")) {
    geometry.setAttribute("anchorBlend", new THREE.BufferAttribute(
      new Float32Array(geometry.attributes.position.count), 1,
    ));
  }
  const hasNativePathT = geometry.hasAttribute("nativePathT");
  if (!hasNativePathT) {
    geometry.setAttribute("nativePathT", new THREE.BufferAttribute(
      new Float32Array(geometry.attributes.position.count), 1,
    ));
  }
  const fullIndex = geometry.index.array;
  const parts = manifest.parts.map((part, slot) => ({
    ...part,
    slot,
    visible: true,
    contactEnabled: Boolean(part.boneContact),
    restBounds: new THREE.Box3(
      new THREE.Vector3(...part.bounds[0]),
      new THREE.Vector3(...part.bounds[1]),
    ),
    posedBounds: new THREE.Box3(),
    radialScale: 1,
    force: null,
    activation: null,
  }));
  if (manifest.boneVolumes && !/^[a-f0-9]{64}$/.test(manifest.boneVolumeBinarySha256 || ""))
    throw Error("肌肉清单缺少所用骨体积的版本标识。");
  const boneVolumes = manifest.boneVolumes
    ? own(await loadBoneVolumes(new URL(manifest.boneVolumes, import.meta.url), parts.length, manifest.boneVolumeBinarySha256, signal, onProgress))
    : null;
  let currentBoneRecords = manifest.bones.map(bone => ({name: bone.name, matrix: bone.restMatrix}));
  const sheetParts = parts.filter(part => part.sheetDeformation);
  const guides = sheetParts.map(part => part.sheetDeformation.nativeGuide).filter(Boolean);
  const guideMatrix = guides.length ? (await import("./muscle-path-shape.js")).makeGracilisGuideMatrix : null;
  await checkBuild();
  const restGuide = new Float64Array(new THREE.Matrix4().elements);
  for (const part of sheetParts) {
    const c = part.sheetDeformation;
    part.sheetDriverNames = [...new Set([...c.bones, ...(c.nativeGuide ? [c.nativeGuide.femur, c.nativeGuide.name] : [])])];
  }
  let sheetPositionTexture = null, sheetNormalTexture = null;
  let sheetPositions = null, sheetNormals = null, sheetTextureHeight = 1;
  const SHEET_WIDTH = 1024;
  if (sheetParts.length) {
    const { makeMuscleSheetShape } = await import("./muscle-sheet-shape.js");
    await checkBuild();
    const count = sheetParts.reduce((sum, part) => sum + part.vertexCount, 0);
    sheetTextureHeight = Math.ceil(count / SHEET_WIDTH);
    sheetPositions = new Float32Array(SHEET_WIDTH * sheetTextureHeight * 4);
    sheetNormals = new Float32Array(sheetPositions.length);
    const ids = new Float32Array(geometry.attributes.position.count).fill(-1);
    let offset = 0;
    for (const part of sheetParts) {
      await checkBuild();
      part.sheetState = makeMuscleSheetShape(part.sheetDeformation, { boneVolumes });
      if (part.sheetState.positions.length !== part.vertexCount * 3)
        throw Error(`宽肌表面顶点数不匹配：${part.label}`);
      part.sheetOffset = offset;
      part.sheetNormal = new Float32Array(part.vertexCount * 3);
      for (let i = 0; i < part.vertexCount; i++) ids[part.vertexStart + i] = offset + i;
      offset += part.vertexCount;
    }
    geometry.setAttribute("atlasSheetVertex", new THREE.BufferAttribute(ids, 1));
    sheetPositionTexture = own(new THREE.DataTexture(sheetPositions, SHEET_WIDTH, sheetTextureHeight, THREE.RGBAFormat, THREE.FloatType));
    sheetNormalTexture = own(new THREE.DataTexture(sheetNormals, SHEET_WIDTH, sheetTextureHeight, THREE.RGBAFormat, THREE.FloatType));
    for (const texture of [sheetPositionTexture, sheetNormalTexture])
      texture.minFilter = texture.magFilter = THREE.NearestFilter;
  }
  const tendonCount = parts.filter(
    (part) => part.tissueType === "tendon",
  ).length;
  const muscleCount = parts.length - tendonCount;
  const textureData = new Float32Array(parts.length * 4);
  const partTexture = own(new THREE.DataTexture(
    textureData,
    parts.length,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  ));
  partTexture.needsUpdate = true;
  const fiberData = new Float32Array(parts.length * 32);
  const fiberTexture = own(new THREE.DataTexture(
    fiberData,
    8,
    parts.length,
    THREE.RGBAFormat,
    THREE.FloatType,
  ));
  fiberTexture.needsUpdate = true;
  const curveData = new Float32Array(parts.length * 40);
  const curveTexture = own(new THREE.DataTexture(curveData, 10, parts.length, THREE.RGBAFormat, THREE.FloatType));
  curveTexture.needsUpdate = true;
  // Kavan et al. 2008, DLB: quaternion components use Three's xyzw order.
  const dualData = new Float32Array(manifest.bones.length * 8);
  const dualTexture = own(new THREE.DataTexture(dualData, 2, manifest.bones.length, THREE.RGBAFormat, THREE.FloatType));
  const dualRotation = new THREE.Quaternion(), dualTranslation = new THREE.Quaternion();
  const nativeParts = parts.filter((part) => part.skinning === "native-path");
  const roundedSampler = nativeParts.some(part => part.nativePath?.sampler === "rounded-arc")
    ? (await import("./muscle-path-shape.js")).sampleRoundedArcPath : null;
  await checkBuild();
  const sampleBoundPath = (spec, path) => spec.sampler === "rounded-arc"
    ? roundedSampler(path, NATIVE_PATH_SAMPLES, spec.roundingM) : sampleNativePath(path);
  const nativeRows = Math.max(1, nativeParts.length * 3);
  // Three rows per surface: posed center, section quaternion, rest center.
  // Adjacent Float32 centers and quaternions are interpolated explicitly, so
  // source vertices retain continuous along-path coordinates on both CPU/GPU.
  const nativeData = new Float32Array(NATIVE_PATH_SAMPLES * nativeRows * 4);
  const nativeTexture = own(new THREE.DataTexture(nativeData, NATIVE_PATH_SAMPLES,
    nativeRows, THREE.RGBAFormat, THREE.FloatType));
  nativeTexture.minFilter = nativeTexture.magFilter = THREE.NearestFilter;
  for (const [index, part] of nativeParts.entries()) {
    await checkBuild();
    const spec = part.nativePath;
    if (!hasNativePathT || !spec || spec.sampleCount !== NATIVE_PATH_SAMPLES
      || !Number.isInteger(spec.startBone) || !Number.isInteger(spec.endBone)
      || !manifest.bones[spec.startBone] || !manifest.bones[spec.endBone]
      || (spec.driver === "bone-endpoints" ? spec.unit !== null || part.units.length !== 0
        : typeof spec.unit !== "string" || !part.units.includes(spec.unit))
      || !Number.isFinite(spec.endBlend) || spec.endBlend < 0 || spec.endBlend > .5
      || part.fiber)
      throw Error(`原生肌腱路径绑定无效：${part.label || part.id}`);
    const rest = sampleBoundPath(spec, spec.restPath);
    const row = index * 3;
    part.nativeState = { row, rest, radius: 0, endpointFrameError: [0, 0] };
    for (let i = 0; i < NATIVE_PATH_SAMPLES; i++) {
      const at = (row * NATIVE_PATH_SAMPLES + i) * 4;
      nativeData.set(rest.centers.subarray(i * 3, i * 3 + 3), at);
      nativeData[at + NATIVE_PATH_SAMPLES * 4 + 3] = 1;
      nativeData.set(rest.centers.subarray(i * 3, i * 3 + 3), at + NATIVE_PATH_SAMPLES * 8);
    }
    for (let i = part.vertexStart; i < part.vertexStart + part.vertexCount; i++) {
      const t = geometry.attributes.nativePathT.getX(i), sample = Math.round(t * (NATIVE_PATH_SAMPLES - 1));
      if (!Number.isFinite(t) || t < 0 || t > 1)
        throw Error(`原生肌腱路径顶点参数无效：${part.label || part.id}`);
      // Adjacent centers form a convex segment; include one grid segment in
      // the radius bound while accepting continuous along-path coordinates.
      curveOffset.fromBufferAttribute(geometry.attributes.position, i)
        .sub(curveTangent.fromArray(nativeData, ((row + 2) * NATIVE_PATH_SAMPLES + sample) * 4));
      part.nativeState.radius = Math.max(part.nativeState.radius, curveOffset.length());
    }
    let maxSegment = 0;
    for (let i = 1; i < NATIVE_PATH_SAMPLES; i++)
      maxSegment = Math.max(maxSegment, curveOffset.fromArray(rest.centers, i * 3)
        .distanceTo(curveTangent.fromArray(rest.centers, (i - 1) * 3)));
    part.nativeState.radius += maxSegment;
    fiberData[part.slot * 32 + 31] = row + 1;
  }
  nativeTexture.needsUpdate = true;
  for (const part of parts) {
    await checkBuild();
    part.fiberMatrix = new THREE.Matrix4();
    part.fiberMatrix.toArray(fiberData, part.slot * 32);
    fiberData[part.slot * 32 + 28] = part.fiber ? 1 : 0;
    fiberData[part.slot * 32 + 30] = part.skinning === "dual-quaternion" ? 1 : 0;
    for (let i = 0; i < 3; i++) fiberData[part.slot * 32 + 16 + i * 5] = 1;
    if (part.fiber?.mode === "hermite-source-cross-sections") {
      const f = part.fiber;
      part.curve = createCrossSections(f);
      const {restOrigin, restAxis} = part.curve;
      part.curve.minU = Infinity; part.curve.maxU = -Infinity; part.curve.radius = 0;
      for (let i = part.vertexStart; i < part.vertexStart + part.vertexCount; i++) {
        curveOffset.fromBufferAttribute(geometry.attributes.position, i).sub(restOrigin);
        const axial = curveOffset.dot(restAxis), u = axial / f.restLength;
        part.curve.minU = Math.min(part.curve.minU, u); part.curve.maxU = Math.max(part.curve.maxU, u);
        part.curve.radius = Math.max(part.curve.radius, curveOffset.addScaledVector(restAxis, -axial).length());
      }
      fiberData[part.slot * 32 + 29] = 1;
    }
  }
  const material = own(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.76,
    side: THREE.DoubleSide,
  }));
  material.onBeforeCompile = (shader) => {
    boneVolumes?.attachShader(shader);
    if (sheetParts.length) {
      shader.uniforms.atlasSheetPosition = {value: sheetPositionTexture};
      shader.uniforms.atlasSheetNormal = {value: sheetNormalTexture};
      shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
        attribute float atlasSheetVertex;
        uniform sampler2D atlasSheetPosition;
        uniform sampler2D atlasSheetNormal;
        vec2 atlasSheetUV(){return (vec2(mod(atlasSheetVertex,${SHEET_WIDTH}.),floor(atlasSheetVertex/${SHEET_WIDTH}.))+.5)/vec2(${SHEET_WIDTH}.,${sheetTextureHeight}.);}`);
    }
    shader.uniforms.atlasParameters = { value: partTexture };
    shader.uniforms.atlasPartCount = { value: parts.length };
    shader.uniforms.atlasFibers = { value: fiberTexture };
    shader.uniforms.atlasCurves = { value: curveTexture };
    shader.uniforms.atlasDualBones = { value: dualTexture };
    shader.uniforms.atlasBoneCount = { value: manifest.bones.length };
    shader.uniforms.atlasNativePaths = { value: nativeTexture };
    shader.uniforms.atlasNativeRows = { value: nativeRows };
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
      attribute float atlasPart;
      attribute vec3 radialOffset;
      attribute float anchorBlend;
      attribute float nativePathT;
      uniform sampler2D atlasParameters;
      uniform float atlasPartCount;
      uniform sampler2D atlasFibers;
      uniform sampler2D atlasCurves;
      uniform sampler2D atlasDualBones;
      uniform float atlasBoneCount;
      uniform sampler2D atlasNativePaths;
      uniform float atlasNativeRows;
      varying vec3 atlasColor;
      vec3 atlasRotate(vec4 q, vec3 v) { return v+2.*cross(q.xyz,cross(q.xyz,v)+q.w*v); }
      void atlasDualBlend(vec4 ids,vec4 weights,out vec4 real,out vec4 dual) {
        vec4 reference=texture2D(atlasDualBones,vec2(.25,(ids.x+.5)/atlasBoneCount));
        real=vec4(0.);dual=vec4(0.);
        for(int i=0;i<4;i++) {
          float row=(ids[i]+.5)/atlasBoneCount;
          vec4 qr=texture2D(atlasDualBones,vec2(.25,row)),qd=texture2D(atlasDualBones,vec2(.75,row));
          float weight=weights[i]*(dot(qr,reference)<0.?-1.:1.);
          real+=weight*qr;dual+=weight*qd;
        }
        float len=max(length(real),1e-8);real/=len;dual/=len;dual-=real*dot(real,dual);
      }
      vec3 curveField(float col, float row) { return texture2D(atlasCurves, vec2((col + .5) / 10.0, row)).xyz; }
      void atlasCurve(vec3 p, float row, out vec3 result, out mat3 orientation) {
        vec3 p0=curveField(0.,row), p1=curveField(1.,row), t0=curveField(2.,row), t1=curveField(3.,row);
        vec3 a=curveField(7.,row), n=curveField(8.,row), b=curveField(9.,row), d=p-curveField(6.,row);
        float len=texture2D(atlasCurves,vec2(6.5/10.,row)).w, u=dot(d,a)/len, u2=u*u, u3=u2*u;
        vec3 tangent=normalize((6.*u2-6.*u)*p0+(3.*u2-4.*u+1.)*t0+(-6.*u2+6.*u)*p1+(3.*u2-2.*u)*t1);
        vec3 guide=mix(curveField(4.,row),curveField(5.,row),u);
        guide-=tangent*dot(guide,tangent);
        if(dot(guide,guide)<1e-10) { guide=abs(tangent.x)<.8?vec3(1.,0.,0.):vec3(0.,1.,0.); guide-=tangent*dot(guide,tangent); }
        guide=normalize(guide); vec3 binormal=normalize(cross(tangent,guide));
        result=(2.*u3-3.*u2+1.)*p0+(u3-2.*u2+u)*t0+(-2.*u3+3.*u2)*p1+(u3-u2)*t1+guide*dot(d,n)+binormal*dot(d,b);
        orientation=mat3(tangent,guide,binormal)*transpose(mat3(a,n,b));
      }`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <skinbase_vertex>",
      `#include <skinbase_vertex>
      float atlasRow = (atlasPart + 0.5) / atlasPartCount;
      bool atlasIsFiber = texture2D(atlasFibers, vec2(7.5 / 8.0, atlasRow)).x > 0.5;
      bool atlasIsCurve = texture2D(atlasFibers, vec2(7.5 / 8.0, atlasRow)).y > 0.5;
      bool atlasIsDual = texture2D(atlasFibers, vec2(7.5 / 8.0, atlasRow)).z > 0.5;
      float atlasNativeRow = texture2D(atlasFibers, vec2(7.5 / 8.0, atlasRow)).w - 1.;
      bool atlasIsNative = atlasNativeRow > -.5;
      vec3 atlasNativeCenter=vec3(0.),atlasNativeRest=vec3(0.);
      vec4 atlasNativeRotation=vec4(0.,0.,0.,1.);
      if(atlasIsNative) {
        float along=clamp(nativePathT,0.,1.)*512., lower=floor(along), blend=along-lower;
        float col=(lower+.5)/513., nextCol=(min(lower+1.,512.)+.5)/513.;
        atlasNativeCenter=mix(texture2D(atlasNativePaths,vec2(col,(atlasNativeRow+.5)/atlasNativeRows)).xyz,
          texture2D(atlasNativePaths,vec2(nextCol,(atlasNativeRow+.5)/atlasNativeRows)).xyz,blend);
        vec4 qa=texture2D(atlasNativePaths,vec2(col,(atlasNativeRow+1.5)/atlasNativeRows));
        vec4 qb=texture2D(atlasNativePaths,vec2(nextCol,(atlasNativeRow+1.5)/atlasNativeRows));
        atlasNativeRotation=normalize(mix(qa,qb*(dot(qa,qb)<0.?-1.:1.),blend));
        atlasNativeRest=mix(texture2D(atlasNativePaths,vec2(col,(atlasNativeRow+2.5)/atlasNativeRows)).xyz,
          texture2D(atlasNativePaths,vec2(nextCol,(atlasNativeRow+2.5)/atlasNativeRows)).xyz,blend);
      }
      vec4 atlasReal=vec4(0.,0.,0.,1.),atlasDual=vec4(0.);
      if(atlasIsDual) atlasDualBlend(skinIndex,skinWeight,atlasReal,atlasDual);
      mat4 atlasFiberMatrix = mat4(1.0);
      mat3 atlasFiberNormal = mat3(1.0);
      if (atlasIsFiber) {
        atlasFiberMatrix = mat4(texture2D(atlasFibers, vec2(0.5 / 8.0, atlasRow)), texture2D(atlasFibers, vec2(1.5 / 8.0, atlasRow)), texture2D(atlasFibers, vec2(2.5 / 8.0, atlasRow)), texture2D(atlasFibers, vec2(3.5 / 8.0, atlasRow)));
        atlasFiberNormal = mat3(texture2D(atlasFibers, vec2(4.5 / 8.0, atlasRow)).xyz, texture2D(atlasFibers, vec2(5.5 / 8.0, atlasRow)).xyz, texture2D(atlasFibers, vec2(6.5 / 8.0, atlasRow)).xyz);
      }`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <skinnormal_vertex>",
      `vec3 atlasRestNormal = objectNormal;
      #include <skinnormal_vertex>
      // Section rotation transports normals for display. It deliberately omits
      // the along-path deformation gradient; this is not a soft-tissue solver.
      if(atlasIsNative) objectNormal=atlasRotate(atlasNativeRotation,atlasRestNormal);
      else if (atlasIsCurve) {
        vec3 unusedPoint, plusPoint, minusPoint; mat3 curveOrientation, unusedOrientation;
        vec3 restCurveAxis=curveField(7.,atlasRow), restCurveNormal=curveField(8.,atlasRow), restCurveBinormal=curveField(9.,atlasRow);
        float curveRadialScale=texture2D(atlasParameters,vec2(atlasRow,.5)).a;
        vec3 curveInput=position+radialOffset*(curveRadialScale-1.);
        float epsilon=texture2D(atlasCurves,vec2(6.5/10.,atlasRow)).w*.001;
        atlasCurve(curveInput,atlasRow,unusedPoint,curveOrientation);
        atlasCurve(curveInput+restCurveAxis*epsilon,atlasRow,plusPoint,unusedOrientation);
        atlasCurve(curveInput-restCurveAxis*epsilon,atlasRow,minusPoint,unusedOrientation);
        vec3 j0=(plusPoint-minusPoint)/(2.*epsilon), j1=curveOrientation*restCurveNormal, j2=curveOrientation*restCurveBinormal;
        float det=dot(j0,cross(j1,j2));
        vec3 cofactorNormal=dot(atlasRestNormal,restCurveAxis)*cross(j1,j2)+dot(atlasRestNormal,restCurveNormal)*cross(j2,j0)+dot(atlasRestNormal,restCurveBinormal)*cross(j0,j1);
        objectNormal=abs(det)>1e-7?cofactorNormal/det:curveOrientation*atlasRestNormal;
      }
      else if (atlasIsFiber) objectNormal = mix(atlasFiberNormal * atlasRestNormal, objectNormal, anchorBlend);
      else if(atlasIsDual) objectNormal=atlasRotate(atlasReal,atlasRestNormal);`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      vec4 atlasValues = texture2D(atlasParameters, vec2((atlasPart + 0.5) / atlasPartCount, 0.5));
      atlasColor = atlasValues.rgb;
      vec3 transformed = position + radialOffset * (atlasValues.a - 1.0);
      vec3 atlasRestVertex = transformed;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <skinning_vertex>",
      `#include <skinning_vertex>
      if(atlasIsNative) transformed=atlasNativeCenter+atlasRotate(atlasNativeRotation,atlasRestVertex-atlasNativeRest);
      else if(atlasIsDual) transformed=atlasRotate(atlasReal,atlasRestVertex)+2.*(atlasReal.w*atlasDual.xyz-atlasDual.w*atlasReal.xyz+cross(atlasReal.xyz,atlasDual.xyz));
      else if (atlasIsCurve) { mat3 unusedOrientation; atlasCurve(atlasRestVertex, atlasRow, transformed, unusedOrientation); }
      else if (atlasIsFiber) transformed = mix((atlasFiberMatrix * vec4(atlasRestVertex, 1.0)).xyz, transformed, anchorBlend);`,
    );
    if (sheetParts.length) {
      shader.vertexShader = shader.vertexShader.replace("#include <defaultnormal_vertex>",
        `if(atlasSheetVertex>=0.)objectNormal=texture2D(atlasSheetNormal,atlasSheetUV()).xyz;\n#include <defaultnormal_vertex>`);
      shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>",
        `if(atlasSheetVertex>=0.)transformed=texture2D(atlasSheetPosition,atlasSheetUV()).xyz;\n#include <project_vertex>`);
    }
    if (boneVolumes) {
      shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", `
        vec3 contactInput=transformed;
        transformed=bvProject(contactInput,atlasRow);
        if(dot(transformed-contactInput,transformed-contactInput)>1e-14){
          vec3 n=normalize(objectNormal);
          vec3 guide=abs(n.x)<.8?vec3(1.,0.,0.):vec3(0.,1.,0.);
          vec3 a=normalize(cross(n,guide)),b=cross(n,a);
          vec3 da=bvProject(contactInput+a*.0005,atlasRow)-transformed;
          vec3 db=bvProject(contactInput+b*.0005,atlasRow)-transformed;
          vec3 projectedNormal=cross(da,db);
          if(dot(projectedNormal,projectedNormal)>1e-20){
            objectNormal=normalize(projectedNormal);
            if(dot(objectNormal,n)<0.)objectNormal=-objectNormal;
            #ifndef FLAT_SHADED
              vNormal=normalize(normalMatrix*objectNormal);
            #endif
          }
        }
        #include <project_vertex>`);
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nvarying vec3 atlasColor;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      "diffuseColor.rgb *= atlasColor;",
    );
  };
  material.customProgramCacheKey = () =>
    `bodyvista-atlas-continuous-v8-s${sheetParts.length}-b${boneVolumes ? 1 : 0}`;
  const object = new THREE.SkinnedMesh(geometry, material);
  object.name = "BodyVista 原图谱解剖肌肉";
  object.userData.anatomicalMuscles = true;
  object.frustumCulled = false;
  const bones = manifest.bones.map((record) => {
    const bone = new THREE.Bone();
    bone.name = record.name;
    bone.matrixAutoUpdate = false;
    bone.matrix.fromArray(record.restMatrix);
    object.add(bone);
    return bone;
  });
  object.updateMatrixWorld(true);
  const skeleton = own(new THREE.Skeleton(bones));
  object.bind(skeleton);
  skeleton.update();
  const boneByName = new Map(bones.map((bone) => [bone.name, bone]));
  const boneTransforms = bones.map(() => new THREE.Matrix4());
  let sheetPool = null, sheetPoolReady = null;
  const sheetAbort = new AbortController();
  const movieSurfaces = new WeakMap();
  function guideMatrices(relative, muscles, initializing) {
    return guides.map(spec => [spec.name, initializing ? restGuide :
      guideMatrix(spec, muscles.get(spec.unit)?.path, relative.get(spec.femur))]);
  }
  // Collision fields follow the exact world transforms, including ribs that do
  // not drive either attachment and rounding lost in the GPU skeleton palette.
  function sheetInputMatrices(part, relative, world) {
    return [...part.sheetDriverNames.map(name => relative.get(name)),
      ...(part.sheetDeformation.controlContact?.bones || []).map(name => {
        const matrix = world.get(name);
        if (!matrix) throw Error(`缺少骨碰撞变换：${name}`);
        return matrix;
      })];
  }
  function sameSheetInput(snapshot, matrices) {
    return snapshot && matrices.every((values, i) => values.every((v, k) => v === snapshot[i * 16 + k]));
  }
  async function prepareFrame(frame, sequence = null) {
    if (disposed || !sheetParts.length) return null;
    const records = frame.bodies?.length ? frame.bodies : currentBoneRecords;
    const current = new Map(records.map(body => [body.name, body.matrix]));
    const relative = manifest.bones.map((bone, i) => {
      const matrix = new THREE.Matrix4().fromArray(current.get(bone.name) || bones[i].matrix.elements)
        .multiply(skeleton.boneInverses[i]);
      // Match Skeleton.boneMatrices, including its Float32 rounding, so GPU,
      // CPU picking and the worker solve receive exactly the same transform.
      return [bone.name, new Float32Array(matrix.elements)];
    });
    const byName = new Map(relative);
    const guidesForFrame = guides.length ? guideMatrices(byName,
      new Map((frame.muscles || []).map(m => [m.name, m])), !frame.bodies?.length && !frame.muscles?.length) : [];
    for (const [name, elements] of guidesForFrame) { byName.set(name, elements); relative.push([name, elements]); }
    // A prepared movie frame can be shown after any other frame (seek/loop).
    // Retain every sheet, sharing immutable buffers for unchanged inputs.
    const points = new Map(), changed = [];
    for (const part of sheetParts) {
      const matrices = sheetInputMatrices(part, byName, current);
      const last = sequence?.get(part.id);
      if (sameSheetInput(sequence ? last?.snapshot : part.sheetBoneSnapshot, matrices)) {
        if (sequence) points.set(part.id, last.points);
        continue;
      }
      const snapshot = sequence && new Float64Array(matrices.length * 16);
      if (snapshot) matrices.forEach((values, i) => snapshot.set(values, i * 16));
      changed.push({part, snapshot});
    }
    if (!changed.length) return { frame, points, guidesForFrame };
    if (!sheetPoolReady) {
      sheetPoolReady = import("./muscle-shape-pool.js").then(({ createMuscleShapePool }) => {
        sheetAbort.signal.throwIfAborted();
        return createMuscleShapePool(sheetParts.map(part => ({ id: part.id, contract: part.sheetDeformation })), {
          signal: sheetAbort.signal,
          contactForParts(assigned) {
            const names = [...new Set(assigned.flatMap(part => part.contract.controlContact?.bones || []))];
            if (!names.length) return null;
            if (!boneVolumes) throw Error("肌肉形变缺少骨碰撞数据。");
            return boneVolumes.exportSubset(names);
          },
        });
      })
        .then(pool => {
          if (disposed) { pool.dispose(); throw Error("肌肉动画已关闭。"); }
          sheetPool = pool;
          return pool;
        });
    }
    const pool = await sheetPoolReady;
    const results = await pool.update(changed.map(({part}) => part.id), relative, records);
    if (disposed) throw Error("肌肉动画已关闭。");
    // Reject malformed results before fullbody-view commits any bone matrix.
    for (const {part, snapshot} of changed) {
      const values = results.get(part.id);
      if (!values || values.length !== part.vertexCount * 3 || !values.every(Number.isFinite))
        throw Error(`肌肉动画结果无效：${part.label}`);
      points.set(part.id, values);
      sequence?.set(part.id, {snapshot, points: values});
      if (sequence) {
        const normals = new Float32Array(values.length), bounds = new THREE.Box3();
        measureSheet(part, values, normals, bounds);
        movieSurfaces.set(values, {normals, bounds});
      }
    }
    return { frame, points, guidesForFrame };
  }
  const positions = geometry.attributes.position.array,
    radial = geometry.attributes.radialOffset.array;
  const vertexParts = geometry.attributes.atlasPart.array;
  const vertexCache = new Float32Array(positions.length),
    vertexVersions = new Uint32Array(positions.length / 3);
  let version = 1,
    selected = null,
    currentRegion = "all",
    disposed = false;
  const color = new THREE.Color(),
    bounds = new THREE.Box3(),
    corner = new THREE.Vector3();
  const inverse = new THREE.Matrix4(),
    localRay = new THREE.Ray();
  const proximal = new THREE.Vector3(),
    distal = new THREE.Vector3(),
    axis = new THREE.Vector3(),
    restAxis = new THREE.Vector3();
  const fiberRotation = new THREE.Quaternion(),
    fiberStretch = new THREE.Matrix4(),
    fiberNormal = new THREE.Matrix3();
  const nativeStart = new THREE.Quaternion(), nativeEnd = new THREE.Quaternion(),
    nativeRotation = new THREE.Quaternion(), nativeCorrection = new THREE.Quaternion(),
    nativeIdentity = new THREE.Quaternion();
  const nativeRestTangent = new THREE.Vector3(), nativeCurrentTangent = new THREE.Vector3(),
    nativeAlignmentAxis = new THREE.Vector3();
  let visibleParts = parts;

  function updateNativePath(part, muscle, initializing) {
    const spec = part.nativePath, state = part.nativeState;
    if (!initializing && spec.driver !== "bone-endpoints" && !muscle?.path)
      throw Error(`当前姿势缺少原生肌腱路径：${spec.unit}`);
    const path = spec.driver === "bone-endpoints"
      ? [new THREE.Vector3(...spec.restPath[0]).applyMatrix4(boneTransforms[spec.startBone]).toArray(),
        new THREE.Vector3(...spec.restPath.at(-1)).applyMatrix4(boneTransforms[spec.endBone]).toArray()]
      : muscle?.path;
    const currentPath = initializing ? spec.restPath : path;
    const signature = currentPath.flat().concat(boneTransforms[spec.startBone].elements,
      boneTransforms[spec.endBone].elements);
    if (state.signature?.length === signature.length && signature.every((v,i) => v === state.signature[i])) {
      if (spec.sampler === "rounded-arc") part.radialScale = state.radialScale;
      return;
    }
    state.signature = signature;
    const current = initializing ? state.rest : sampleBoundPath(spec, path);
    if (spec.sampler === "rounded-arc")
      part.radialScale = 1 / Math.sqrt(clamp(current.length / state.rest.length, .35, 2));
    state.radialScale = part.radialScale;
    nativeStart.fromArray(dualData, spec.startBone * 8).normalize();
    nativeEnd.fromArray(dualData, spec.endBone * 8).normalize();
    const sign = nativeStart.dot(nativeEnd) < 0 ? -1 : 1;
    for (let i = 0; i < NATIVE_PATH_SAMPLES; i++) {
      const t = i / (NATIVE_PATH_SAMPLES - 1), at = (state.row * NATIVE_PATH_SAMPLES + i) * 4;
      nativeRotation.set(
        nativeStart.x * (1 - t) + nativeEnd.x * sign * t,
        nativeStart.y * (1 - t) + nativeEnd.y * sign * t,
        nativeStart.z * (1 - t) + nativeEnd.z * sign * t,
        nativeStart.w * (1 - t) + nativeEnd.w * sign * t,
      ).normalize();
      nativeRestTangent.fromArray(state.rest.tangents, i * 3).applyQuaternion(nativeRotation);
      nativeCurrentTangent.fromArray(current.tangents, i * 3);
      nativeCorrection.identity();
      if (nativeRestTangent.lengthSq() > 1e-20 && nativeCurrentTangent.lengthSq() > 1e-20) {
        nativeRestTangent.normalize(); nativeCurrentTangent.normalize();
        const dot = clamp(nativeRestTangent.dot(nativeCurrentTangent), -1, 1);
        if (dot < -1 + 1e-8) {
          nativeAlignmentAxis.set(Math.abs(nativeRestTangent.x) < .8 ? 1 : 0,
            Math.abs(nativeRestTangent.x) < .8 ? 0 : 1, 0);
          nativeAlignmentAxis.crossVectors(nativeRestTangent, nativeAlignmentAxis).normalize();
          nativeCorrection.setFromAxisAngle(nativeAlignmentAxis, Math.PI);
        } else if (dot < 1 - 1e-10) {
          nativeAlignmentAxis.crossVectors(nativeRestTangent, nativeCurrentTangent);
          nativeCorrection.set(nativeAlignmentAxis.x, nativeAlignmentAxis.y,
            nativeAlignmentAxis.z, 1 + dot).normalize();
        }
        // Keep each attachment cross-section in its own endpoint bone frame;
        // turn toward the native tendon tangent only inside the 12% end bands.
        nativeCorrection.slerp(nativeIdentity, 1 - smoothEndGain(t, spec.endBlend));
      }
      nativeRotation.premultiply(nativeCorrection).normalize();
      nativeData.set(current.centers.subarray(i * 3, i * 3 + 3), at);
      nativeRotation.toArray(nativeData, at + NATIVE_PATH_SAMPLES * 4);
      if (i === 0 || i === NATIVE_PATH_SAMPLES - 1) {
        nativeCorrection.fromArray(nativeData, at + NATIVE_PATH_SAMPLES * 4).normalize();
        state.endpointFrameError[i === 0 ? 0 : 1] = nativeCorrection.angleTo(i === 0 ? nativeStart : nativeEnd);
      }
    }
  }

  function updateBounds() {
    object.boundingBox ??= new THREE.Box3();
    object.boundingBox.makeEmpty();
    for (const part of parts) {
      part.posedBounds.makeEmpty();
      // Linear skinning is a convex blend of rigid transforms. The union of
      // each influencing transform of this expanded box bounds every vertex,
      // including the shader's length-dependent radial compensation.
      const expand = part.maxRadial * Math.abs(part.radialScale - 1);
      bounds.copy(part.restBounds).expandByScalar(expand);
      if (part.sheetState) {
        if (part.sheetBounds) part.posedBounds.copy(part.sheetBounds);
        else for (let i = 0; i < part.vertexCount; i++)
          part.posedBounds.expandByPoint(corner.fromArray(part.sheetState.positions, i * 3));
        part.posedBounds.expandByScalar(1e-6);
        if (part.visible) object.boundingBox.union(part.posedBounds);
        continue;
      }
      if (part.nativeState) {
        // Every source vertex uses an interpolation of adjacent centers. Section
        // rotations preserve offset length; radial correction adds at most
        // maxRadial*|scale-1|. Include Float32 rounding at the final boundary.
        const state = part.nativeState;
        for (let i = 0; i < NATIVE_PATH_SAMPLES; i++)
          part.posedBounds.expandByPoint(corner.fromArray(nativeData, (state.row * NATIVE_PATH_SAMPLES + i) * 4));
        part.posedBounds.expandByScalar(state.radius + expand + 1e-6);
        if (part.visible) object.boundingBox.union(part.posedBounds);
        continue;
      }
      if (part.skinning === "dual-quaternion") {
        // The audited DQ sheets have two bone drivers. Hemisphere alignment
        // bounds the blended real norm below by 1/sqrt(2). Re-centering a
        // rigid transform at this source center bounds its DQ translation by
        // 2*max(center displacement); this conservative sphere includes all
        // interpolated rotations without evaluating every vertex per drag.
        let displacement = 0;
        const center = new THREE.Vector3(...part.center);
        for (const bone of part.bones) displacement = Math.max(displacement,
          corner.copy(center).applyMatrix4(boneTransforms[bone]).distanceTo(center));
        const radius = part.radius + expand + 2 * displacement;
        part.posedBounds.set(center.clone().addScalar(-radius), center.clone().addScalar(radius));
        if (part.visible) object.boundingBox.union(part.posedBounds);
        continue;
      }
      if (part.curve) {
        // A cubic lies inside its Bezier control hull. Expand by the largest
        // source cross-section radius, including radial length compensation.
        const c = part.curve, lo = c.minU - expand / part.fiber.restLength,
          hi = c.maxU + expand / part.fiber.restLength;
        curveCenterAndTangent(c, lo, corner, curveTangent);
        part.posedBounds.expandByPoint(corner);
        part.posedBounds.expandByPoint(corner.addScaledVector(curveTangent, (hi - lo) / 3));
        curveCenterAndTangent(c, hi, corner, curveTangent);
        part.posedBounds.expandByPoint(corner);
        part.posedBounds.expandByPoint(corner.addScaledVector(curveTangent, -(hi - lo) / 3));
        part.posedBounds.expandByScalar(c.radius + expand);
        if (part.visible) object.boundingBox.union(part.posedBounds);
        continue;
      }
      if (part.fiber) {
        part.posedBounds.copy(bounds).applyMatrix4(part.fiberMatrix);
        if (!part.fiber.anchorBlend) {
          if (part.visible) object.boundingBox.union(part.posedBounds);
          continue;
        }
      }
      for (const bone of part.bones) {
        const matrix = boneTransforms[bone];
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z])
              part.posedBounds.expandByPoint(
                corner.set(x, y, z).applyMatrix4(matrix),
              );
      }
      if (part.visible) object.boundingBox.union(part.posedBounds);
    }
    if (boneVolumes) {
      boneVolumes.update(currentBoneRecords, parts);
      boneVolumes.extendBounds(parts, object.boundingBox);
    }
    object.boundingSphere ??= new THREE.Sphere();
    object.boundingBox.getBoundingSphere(object.boundingSphere);
    geometry.boundingBox = object.boundingBox;
    geometry.boundingSphere = object.boundingSphere;
  }

  function updateColor(part) {
    if (Number.isFinite(part.force)) {
      if (part.force < 300)
        color.copy(COLD).lerp(WARM, Math.max(0, part.force) / 300);
      else color.copy(WARM).lerp(HOT, Math.min(1, (part.force - 300) / 900));
    } else color.fromArray(part.color);
    if (selected === part.id || part.units.includes(selected))
      color.lerp(SELECTED, 0.6);
    const at = part.slot * 4;
    textureData[at] = color.r;
    textureData[at + 1] = color.g;
    textureData[at + 2] = color.b;
    textureData[at + 3] = part.radialScale;
  }

  const sheetEdge1 = new THREE.Vector3(), sheetEdge2 = new THREE.Vector3(), sheetCross = new THREE.Vector3();
  function measureSheet(part, points, normals, bounds) {
    normals.fill(0);
    bounds.makeEmpty();
    for (let i = part.indexStart; i < part.indexStart + part.indexCount; i += 3) {
      const a = fullIndex[i] - part.vertexStart, b = fullIndex[i+1] - part.vertexStart, c = fullIndex[i+2] - part.vertexStart;
      corner.fromArray(points, a * 3);
      sheetEdge1.fromArray(points, b * 3).sub(corner);
      sheetEdge2.fromArray(points, c * 3).sub(corner);
      sheetCross.crossVectors(sheetEdge1, sheetEdge2);
      for (let j = 0; j < 3; j++) {
        const k = (fullIndex[i+j] - part.vertexStart)*3;
        normals[k] += sheetCross.x; normals[k+1] += sheetCross.y; normals[k+2] += sheetCross.z;
      }
    }
    for (let i = 0; i < part.vertexCount; i++) {
      bounds.expandByPoint(corner.fromArray(points, i*3));
      sheetCross.fromArray(normals, i*3);
      if (sheetCross.lengthSq() < 1e-24) sheetCross.fromBufferAttribute(geometry.attributes.normal, part.vertexStart + i);
      sheetCross.normalize().toArray(normals, i*3);
    }
  }
  function updateSheets(prepared, muscles, initializing) {
    if (!sheetParts.length) return;
    const relative = new Map(manifest.bones.map((bone, i) => [bone.name, boneTransforms[i]]));
    const relativeArrays = new Map(manifest.bones.map((bone, i) => [bone.name, boneTransforms[i].elements]));
    for (const [name, elements] of prepared?.guidesForFrame ?? guideMatrices(relativeArrays, muscles, initializing)) {
      relativeArrays.set(name, elements);
      relative.set(name, { elements });
    }
    const world = new Map(currentBoneRecords.map(body => [body.name, body.matrix]));
    let changed = false;
    for (const part of sheetParts) {
      const matrices = sheetInputMatrices(part, relativeArrays, world);
      if (sameSheetInput(part.sheetBoneSnapshot, matrices))
        continue;
      part.sheetBoneSnapshot ??= new Float64Array(matrices.length*16);
      matrices.forEach((values, i) => part.sheetBoneSnapshot.set(values,i*16));
      changed = true;
      const computed = prepared?.points.get(part.id);
      if (prepared && !computed) throw Error(`肌肉动画结果缺失：${part.label}`);
      if (computed) {
        if (computed.length !== part.sheetState.positions.length || !computed.every(Number.isFinite))
          throw Error(`肌肉动画结果无效：${part.label}`);
        part.sheetState.positions.set(computed);
      }
      const points = computed ? part.sheetState.positions : part.sheetState.update(relative);
      const saved = computed && movieSurfaces.get(computed);
      const normals = saved?.normals || part.sheetNormal;
      part.sheetBounds ??= new THREE.Box3();
      if (saved) part.sheetBounds.copy(saved.bounds);
      else measureSheet(part, points, normals, part.sheetBounds);
      for (let i = 0; i < part.vertexCount; i++) {
        const at = (part.sheetOffset + i) * 4;
        sheetPositions[at] = points[i*3];
        sheetPositions[at+1] = points[i*3+1];
        sheetPositions[at+2] = points[i*3+2];
        sheetNormals[at] = normals[i*3];
        sheetNormals[at+1] = normals[i*3+1];
        sheetNormals[at+2] = normals[i*3+2];
      }
    }
    if (changed) sheetPositionTexture.needsUpdate = sheetNormalTexture.needsUpdate = true;
  }

  function update(frame, prepared = null) {
    if (disposed || !frame) return;
    if (prepared && prepared.frame !== frame) throw Error("肌肉动画与骨骼帧不匹配。");
    if (frame.bodies?.length) currentBoneRecords = frame.bodies;
    for (const body of frame.bodies || []) {
      const bone = boneByName.get(body.name);
      if (!bone || body.matrix?.length !== 16) continue;
      bone.matrix.fromArray(body.matrix);
      bone.matrixWorldNeedsUpdate = true;
    }
    object.updateMatrixWorld(true);
    skeleton.update();
    boneTransforms.forEach((matrix, i) =>
      matrix.fromArray(skeleton.boneMatrices, i * 16),
    );
    boneTransforms.forEach((matrix, i) => {
      dualRotation.setFromRotationMatrix(matrix).normalize();
      const e = matrix.elements;
      dualTranslation.set(e[12], e[13], e[14], 0).multiply(dualRotation);
      dualRotation.toArray(dualData, i * 8);
      dualData[i*8+4]=dualTranslation.x*.5;dualData[i*8+5]=dualTranslation.y*.5;
      dualData[i*8+6]=dualTranslation.z*.5;dualData[i*8+7]=dualTranslation.w*.5;
    });
    dualTexture.needsUpdate = true;
    if (boneVolumes && sheetParts.some(part => part.sheetDeformation.controlContact))
      boneVolumes.update(currentBoneRecords, []);
    const muscles = new Map(
      (frame.muscles || []).map((muscle) => [muscle.name, muscle]),
    );
    for (const part of parts) {
      const associated = part.units
        .map((name) => muscles.get(name))
        .filter(Boolean);
      const forces = associated.map((m) => m.force).filter(Number.isFinite);
      part.force =
        forces.length === part.units.length && forces.length
          ? Math.max(...forces)
          : null;
      const activations = associated
        .map((m) => m.activation)
        .filter(Number.isFinite);
      part.activation =
        activations.length === part.units.length && activations.length
          ? Math.max(...activations)
          : null;
      let weighted = 0,
        weight = 0;
      for (const muscle of associated) {
        const rest = part.restLengths[muscle.name];
        if (!(rest > 0) || !(muscle.length > 0)) continue;
        const capacity = Math.max(1, muscle.maxForce || 1);
        weighted += (muscle.length / rest) * capacity;
        weight += capacity;
      }
      // Transverse 1/sqrt(length ratio) preserves a cylinder's volume. Applying
      // it smoothly inside the original mesh is an illustrative correction;
      // it does not claim exact volume conservation for irregular muscles.
      part.radialScale = weight
        ? 1 / Math.sqrt(clamp(weighted / weight, 0.6, 1.65))
        : 1;
      if (part.sheetState) part.radialScale = 1;
      if (part.nativeState) updateNativePath(part, muscles.get(part.nativePath.unit),
        !(frame.bodies?.length || frame.muscles?.length));
      if (part.fiber) {
        const f = part.fiber;
        proximal
          .fromArray(f.proximal)
          .applyMatrix4(boneTransforms[f.proximalBone]);
        distal.fromArray(f.distal).applyMatrix4(boneTransforms[f.distalBone]);
        axis.subVectors(distal, proximal);
        const ratio = Math.max(1e-6, axis.length() / f.restLength);
        restAxis
          .fromArray(f.distal)
          .sub(corner.fromArray(f.proximal))
          .normalize();
        fiberRotation.setFromUnitVectors(restAxis, axis.normalize());
        const { x, y, z } = restAxis,
          k = ratio - 1;
        fiberStretch.set(
          1 + k * x * x,
          k * x * y,
          k * x * z,
          0,
          k * y * x,
          1 + k * y * y,
          k * y * z,
          0,
          k * z * x,
          k * z * y,
          1 + k * z * z,
          0,
          0,
          0,
          0,
          1,
        );
        part.fiberMatrix
          .makeRotationFromQuaternion(fiberRotation)
          .multiply(fiberStretch);
        corner.fromArray(f.proximal).applyMatrix4(part.fiberMatrix);
        part.fiberMatrix.setPosition(corner.subVectors(proximal, corner));
        const offset = part.slot * 32;
        part.fiberMatrix.toArray(fiberData, offset);
        const normal = fiberNormal.getNormalMatrix(part.fiberMatrix).elements;
        for (let col = 0; col < 3; col++)
          for (let row = 0; row < 3; row++)
            fiberData[offset + 16 + col * 4 + row] = normal[col * 3 + row];
        part.radialScale = 1 / Math.sqrt(clamp(ratio, 0.6, 1.65));
        if (part.curve) {
          const c = part.curve;
          poseCrossSections(c, boneTransforms[f.proximalBone], boneTransforms[f.distalBone]);
          const fields = [c.p0,c.p1,c.t0,c.t1,c.n0,c.n1,c.restOrigin,c.restAxis,c.restNormal,c.restBinormal];
          fields.forEach((value, i) => value.toArray(curveData, part.slot * 40 + i * 4));
          curveData[part.slot * 40 + 27] = f.restLength;
        }
      }
      updateColor(part);
    }
    updateSheets(prepared, muscles, !frame.bodies?.length && !frame.muscles?.length);
    partTexture.needsUpdate = true;
    fiberTexture.needsUpdate = true;
    curveTexture.needsUpdate = true;
    if (nativeParts.length) nativeTexture.needsUpdate = true;
    version = (version + 1) >>> 0;
    if (!version) {
      vertexVersions.fill(0);
      version = 1;
    }
    updateBounds();
  }

  const anchoredVertex = new THREE.Vector3();
  function dualVertex(index, target) {
    const ids=geometry.attributes.skinIndex.array,weights=geometry.attributes.skinWeight.array;
    const ref=ids[index*4]*8;let rx=0,ry=0,rz=0,rw=0,dx=0,dy=0,dz=0,dw=0;
    for(let j=0;j<4;j++) {
      const at=ids[index*4+j]*8;
      const dot=dualData[at]*dualData[ref]+dualData[at+1]*dualData[ref+1]+dualData[at+2]*dualData[ref+2]+dualData[at+3]*dualData[ref+3];
      const w=weights[index*4+j]*(dot<0?-1:1);
      rx+=w*dualData[at];ry+=w*dualData[at+1];rz+=w*dualData[at+2];rw+=w*dualData[at+3];
      dx+=w*dualData[at+4];dy+=w*dualData[at+5];dz+=w*dualData[at+6];dw+=w*dualData[at+7];
    }
    const length=Math.max(Math.hypot(rx,ry,rz,rw),1e-8);rx/=length;ry/=length;rz/=length;rw/=length;dx/=length;dy/=length;dz/=length;dw/=length;
    const dot=rx*dx+ry*dy+rz*dz+rw*dw;dx-=rx*dot;dy-=ry*dot;dz-=rz*dot;dw-=rw*dot;
    dualRotation.set(rx,ry,rz,rw);target.applyQuaternion(dualRotation);
    return target.add(anchoredVertex.set(2*(rw*dx-dw*rx+ry*dz-rz*dy),2*(rw*dy-dw*ry+rz*dx-rx*dz),2*(rw*dz-dw*rz+rx*dy-ry*dx)));
  }
  object.getVertexPosition = function (index, target) {
    const at = index * 3;
    if (vertexVersions[index] !== version) {
      const scale = parts[vertexParts[index]].radialScale - 1;
      target.set(
        positions[at] + radial[at] * scale,
        positions[at + 1] + radial[at + 1] * scale,
        positions[at + 2] + radial[at + 2] * scale,
      );
      const part = parts[vertexParts[index]];
      if (part.sheetState) target.fromArray(part.sheetState.positions, (index-part.vertexStart)*3);
      else if (part.nativeState) {
        const along = geometry.attributes.nativePathT.getX(index) * (NATIVE_PATH_SAMPLES - 1);
        const sample = Math.floor(along), blend = along - sample;
        const start = (part.nativeState.row * NATIVE_PATH_SAMPLES + sample) * 4;
        const next = (part.nativeState.row * NATIVE_PATH_SAMPLES + Math.min(sample + 1, NATIVE_PATH_SAMPLES - 1)) * 4;
        const plane = NATIVE_PATH_SAMPLES * 4;
        anchoredVertex.fromArray(nativeData, start + plane * 2)
          .lerp(curveOffset.fromArray(nativeData, next + plane * 2), blend);
        target.sub(anchoredVertex);
        nativeRotation.fromArray(nativeData, start + plane);
        nativeCorrection.fromArray(nativeData, next + plane);
        const sign = nativeRotation.dot(nativeCorrection) < 0 ? -1 : 1;
        nativeRotation.set(nativeRotation.x * (1 - blend) + nativeCorrection.x * sign * blend,
          nativeRotation.y * (1 - blend) + nativeCorrection.y * sign * blend,
          nativeRotation.z * (1 - blend) + nativeCorrection.z * sign * blend,
          nativeRotation.w * (1 - blend) + nativeCorrection.w * sign * blend).normalize();
        anchoredVertex.fromArray(nativeData, start).lerp(curveOffset.fromArray(nativeData, next), blend);
        target.applyQuaternion(nativeRotation).add(anchoredVertex);
      }
      else if (part.skinning === "dual-quaternion") dualVertex(index,target);
      else if (part.curve) deformCrossSection(part.curve, target, target);
      else if (part.fiber) {
        const blend = geometry.attributes.anchorBlend.getX(index);
        if (blend > 0) this.applyBoneTransform(index, anchoredVertex.copy(target));
        target.applyMatrix4(part.fiberMatrix);
        if (blend > 0) target.lerp(anchoredVertex, blend);
      }
      else this.applyBoneTransform(index, target);
      if (boneVolumes && part.contactEnabled) boneVolumes.project(target, part.collisionBones);
      target.toArray(vertexCache, at);
      vertexVersions[index] = version;
    }
    return target.fromArray(vertexCache, at);
  };
  object.raycast = function (raycaster, intersections) {
    if (!this.visible) return;
    inverse.copy(this.matrixWorld).invert();
    localRay.copy(raycaster.ray).applyMatrix4(inverse);
    const { start, count } = geometry.drawRange;
    try {
      for (const part of visibleParts) {
        if (!localRay.intersectsBox(part.posedBounds)) continue;
        geometry.setDrawRange(part.visibleIndexStart, part.indexCount);
        const before = intersections.length;
        // Mesh.raycast delegates triangle vertices to the exact same skinning
        // and radial correction as the GPU shader, cached for this pose.
        THREE.Mesh.prototype.raycast.call(this, raycaster, intersections);
        for (let i = before; i < intersections.length; i++)
          intersections[i].atlasPart = part.slot;
      }
    } finally {
      geometry.setDrawRange(start, count);
    }
  };

  function setRegion(region = "all") {
    currentRegion = region;
    visibleParts = parts.filter(
      (part) => (part.visible = regionMatches(region, part)),
    );
    let offset = 0;
    const index = new Uint32Array(
      visibleParts.reduce((sum, part) => sum + part.indexCount, 0),
    );
    for (const part of visibleParts) {
      part.visibleIndexStart = offset;
      index.set(
        fullIndex.subarray(part.indexStart, part.indexStart + part.indexCount),
        offset,
      );
      offset += part.indexCount;
    }
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    updateBounds();
  }

  function resolveHit(hit) {
    if (hit?.object !== object) return null;
    const part = parts[hit.atlasPart];
    if (!part) return null;
    return {
      type: part.tissueType === "tendon" ? "tendon" : "muscle",
      tissueType: part.tissueType || "muscle",
      name: part.units[0] || part.id,
      label: part.label,
      atlasId: part.id,
      english: part.english,
      units: [...part.units],
      mapping: part.mapping,
      region: part.region,
      force: part.force,
      activation: part.activation,
      forceSummary:
        part.tissueType === "tendon"
          ? "跟腱连接表面，不提供独立肌力"
          : part.units.length > 1
            ? "关联肌束的最大张力"
            : part.units.length
              ? "关联模型肌束张力"
              : "未建立定量映射",
      source: part.sourceFile,
    };
  }

  for (const part of parts) updateColor(part);
  boneTransforms.forEach((matrix, i) =>
    matrix.fromArray(skeleton.boneMatrices, i * 16),
  );
  setRegion("all");
  await checkBuild();
  update({bodies: [], muscles: []});
  await checkBuild();
  onProgress({
    loaded: buffer.byteLength,
    total: buffer.byteLength,
    message: tendonCount
      ? `已载入 ${parts.length} 个原图谱表面（${muscleCount} 个肌肉、${tendonCount} 条跟腱）`
      : `已载入 ${muscleCount} 个原图谱肌肉表面`,
  });
  return {
    object,
    update,
    prepareFrame,
    setRegion,
    resolveHit,
    setVisible(value) {
      object.visible = Boolean(value);
    },
    setSelected(value) {
      selected = value;
      parts.forEach(updateColor);
      partTexture.needsUpdate = true;
    },
    get status() {
      return {
        ready: true,
        region: currentRegion,
        muscleCount,
        tendonCount,
        surfaceCount: parts.length,
        nativePathSurfaceCount: nativeParts.length,
        sheetSurfaceCount: sheetParts.length,
        shapeWorkers: sheetPool?.workerCount || 0,
        boneContact: boneVolumes ? {...boneVolumes.status, surfaces: parts.filter(part => part.contactEnabled).length} : null,
        nativePathEndpointFrameError: nativeParts.length
          ? Math.max(0, ...nativeParts.filter(part => part.nativePath.endBlend > 0)
            .flatMap((part) => part.nativeState.endpointFrameError)) : 0,
        nativePathFreeSectionSurfaces: nativeParts.filter(part => part.nativePath.endBlend === 0).length,
        mappedParts: manifest.mappedParts,
        mappedUnits: manifest.mappedUnits,
        triangles: manifest.triangles,
        source: manifest.source,
        limitations: manifest.limitations,
        deformation: manifest.deformation,
      };
    },
    dispose() {
      disposed = true;
      sheetAbort.abort();
      sheetPool?.dispose();
    },
  };
}
