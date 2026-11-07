import * as THREE from "../../src/vendor/three.js";
import { createCrossSections, poseCrossSections, deformCrossSection } from "./muscle-path-shape.js";

const TYPES = {float32: Float32Array, uint16: Uint16Array, uint32: Uint32Array};
const ITEMS = {position: 3, normal: 3, skinIndex: 4, skinWeight: 4, atlasPart: 1, radialOffset: 3, index: 1};
const COLD = new THREE.Color("#a2b7b3"), WARM = new THREE.Color("#d8834e");
const HOT = new THREE.Color("#a5222d"), SELECTED = new THREE.Color("#5e9987");

function matchesRegion(region, part) {
  if (region === "all" || region === part.region) return true;
  if (region.startsWith("arm_")) return part.region === region.replace("arm_", "hand_");
  if (region.startsWith("leg_")) return part.region === region.replace("leg_", "foot_");
  if (region === "trunk" || region === "torso") return part.region === "trunk" || part.region === "pelvis";
  if (region === "head" || region === "neck") return part.region === "neck";
  return region === "ribs" && part.region === "trunk" && /intercostal|serratus|transversus thoracis/.test(part.english);
}

async function loadPreview(signal, onProgress) {
  const manifestReply = await fetch(new URL("./preview-muscles.json", import.meta.url), {signal});
  if (!manifestReply.ok) throw Error("无法读取轻量肌肉清单。");
  const manifest = await manifestReply.json();
  onProgress({loaded: 0, total: manifest.byteLength, message: "正在载入轻量解剖肌肉表面"});
  const reply = await fetch(new URL("./preview-muscles.bin", import.meta.url), {signal});
  if (!reply.ok) throw Error("无法读取轻量肌肉网格。");
  const bytes = await reply.arrayBuffer();
  if (bytes.byteLength !== manifest.byteLength) throw Error("轻量肌肉网格不完整。");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  if (Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("") !== manifest.binarySha256)
    throw Error("轻量肌肉网格版本与清单不一致，请刷新页面。");
  signal?.throwIfAborted();
  const attrs = {};
  for (const [name, itemSize] of Object.entries(ITEMS)) {
    const rec = manifest.attributes?.[name], Type = TYPES[rec?.type];
    if (!Type || rec.itemSize !== itemSize || !Number.isSafeInteger(rec.length) || rec.length < 1 ||
        rec.length % itemSize || !Number.isSafeInteger(rec.byteOffset) || rec.byteOffset < 0 ||
        rec.byteOffset % Type.BYTES_PER_ELEMENT || rec.byteOffset + rec.length * Type.BYTES_PER_ELEMENT > bytes.byteLength)
      throw Error(`轻量肌肉属性无效：${name}`);
    attrs[name] = new THREE.BufferAttribute(new Type(bytes, rec.byteOffset, rec.length), itemSize);
    if (name !== "index" && attrs[name].count !== attrs.position.count)
      throw Error("轻量肌肉顶点属性数量不匹配。");
  }
  return {manifest, attrs};
}

function makePreviewCurves(parts, attrs, skeleton) {
  const {position, normal, radialOffset, skinWeight, skinIndex} = attrs;
  const drivers = new Map(), curves = [];
  const identity = skeleton.bones.findIndex(b => b.name === "__preview_fiber_world__");
  function driver(id) {
    if (!skeleton.bones[id]) throw Error("轻量肌肉的截面驱动骨缺失。");
    if (!drivers.has(id)) drivers.set(id, {matrix: new THREE.Matrix4(), changed: false});
    return drivers.get(id);
  }
  for (const part of parts) {
    const f = part.fiber;
    if (f?.mode !== "hermite-source-cross-sections") continue;
    const start = part.vertexStart, end = start + part.vertexCount;
    if (!(f.restLength > 0) || identity < 0) throw Error("轻量肌肉截面参数不完整。");
    for (let i = start; i < end; i++) {
      if (skinWeight.array[4*i] !== 1 || skinIndex.array[4*i] !== identity)
        throw Error("轻量肌肉截面存在重复蒙皮。");
    }
    part.curveBounds = new THREE.Box3();
    curves.push({part, start, end, c: createCrossSections(f),
      near: driver(f.proximalBone), far: driver(f.distalBone),
      restPositions: position.array.slice(start*3, end*3), restNormals: normal.array.slice(start*3, end*3)});
  }
  const matrix = new THREE.Matrix4(), point = new THREE.Vector3(), radial = new THREE.Vector3();
  const originalNormal = new THREE.Vector3(), posedNormal = new THREE.Vector3();
  position.setUsage(THREE.DynamicDrawUsage);
  normal.setUsage(THREE.DynamicDrawUsage);
  let first = true;
  return function updateCurves() {
    skeleton.update();
    let dirty = false;
    for (const [id, ref] of drivers) {
      matrix.fromArray(skeleton.boneMatrices, id * 16);
      ref.changed = first || !matrix.equals(ref.matrix);
      if (ref.changed) { ref.matrix.copy(matrix); dirty = true; }
    }
    first = false;
    if (!dirty) return;
    position.clearUpdateRanges();
    normal.clearUpdateRanges();
    for (const item of curves) {
      const {part, start, end, c, near, far, restPositions, restNormals} = item;
      // Keep all small curve ranges eligible for upload even if two poses were
      // applied before the renderer flushed the previous one.
      position.addUpdateRange(start*3, (end-start)*3);
      normal.addUpdateRange(start*3, (end-start)*3);
      if (!near.changed && !far.changed) continue;
      const radialChange = poseCrossSections(c, near.matrix, far.matrix) - 1;
      part.curveBounds.makeEmpty();
      for (let i = start; i < end; i++) {
        const at = 3*(i-start);
        point.fromArray(restPositions, at).addScaledVector(radial.fromBufferAttribute(radialOffset, i), radialChange);
        originalNormal.fromArray(restNormals, at);
        deformCrossSection(c, point, point, originalNormal, posedNormal);
        position.setXYZ(i, point.x, point.y, point.z);
        normal.setXYZ(i, posedNormal.x, posedNormal.y, posedNormal.z);
        part.curveBounds.expandByPoint(point);
      }
    }
    position.needsUpdate = normal.needsUpdate = true;
  };
}

// Each muscle stores its rest bounds separately for each influencing bone.
// Their transformed union also contains convex combinations of the skinned points.
// Evaluate those small boxes only on picking, never for animation playback.
function addPicking(object, parts, bones) {
  const geometry = object.geometry;
  const {position, skinIndex, skinWeight, atlasPart} = geometry.attributes;
  const point = new THREE.Vector3(), box = new THREE.Box3(), inverse = new THREE.Matrix4();
  const matrices = bones.map(() => new THREE.Matrix4()), ray = new THREE.Ray();
  for (const part of parts) {
    const byBone = new Map();
    for (let i = part.vertexStart; i < part.vertexStart + part.vertexCount; i++) {
      if (atlasPart.array[i] !== part.slot) throw Error("轻量肌肉顶点所属部位不匹配。");
      point.fromBufferAttribute(position, i);
      for (let j = i * 4; j < i * 4 + 4; j++) {
        if (skinWeight.array[j] <= 0) continue;
        const id = skinIndex.array[j];
        if (!bones[id]) throw Error("轻量肌肉的绑定骨骼不存在。");
        if (!byBone.has(id)) byBone.set(id, new THREE.Box3());
        byBone.get(id).expandByPoint(point);
      }
    }
    part.boneBoxes = [...byBone];
    part.posedBox = new THREE.Box3();
  }
  let dirty = true;
  object.raycast = function (raycaster, hits) {
    if (!this.visible || !geometry.drawRange.count) return;
    inverse.copy(this.matrixWorld).invert();
    ray.copy(raycaster.ray).applyMatrix4(inverse);
    if (dirty) {
      for (let i = 0; i < bones.length; i++) {
        matrices[i].multiplyMatrices(inverse, bones[i].matrixWorld).multiply(this.skeleton.boneInverses[i]);
      }
      for (const part of parts) {
        if (part.curveBounds) {
          part.posedBox.copy(part.curveBounds).expandByScalar(1e-5);
          continue;
        }
        part.posedBox.makeEmpty();
        for (const [id, bounds] of part.boneBoxes) {
          part.posedBox.union(box.copy(bounds).applyMatrix4(matrices[id]));
        }
        part.posedBox.expandByScalar(1e-5);
      }
      dirty = false;
    }
    const count = geometry.drawRange.count;
    try {
      for (const part of parts) {
        if (!part.visible || !ray.intersectsBox(part.posedBox)) continue;
        geometry.setDrawRange(part.drawStart, part.indexCount);
        // Use the same GPU skinning weights with Three's ray-triangle implementation.
        const before = hits.length;
        this._computeIntersections(raycaster, hits, ray);
        for (let i = before; i < hits.length; i++) hits[i].atlasPart = part.slot;
      }
    } finally {
      geometry.setDrawRange(0, count);
    }
  };
  return () => { dirty = true; };
}

export async function createPreviewMuscles({onProgress = () => {}, signal} = {}) {
  const {manifest, attrs} = await loadPreview(signal, onProgress);
  const geometry = new THREE.BufferGeometry();
  const fullIndex = attrs.index.array;
  const drawIndex = new THREE.BufferAttribute(new fullIndex.constructor(fullIndex.length), 1);
  drawIndex.setUsage(THREE.DynamicDrawUsage);
  geometry.setIndex(drawIndex);
  for (const [name, attr] of Object.entries(attrs))
    if (name !== "index" && name !== "radialOffset") geometry.setAttribute(name, attr);
  const parts = manifest.parts.map((part, slot) => ({
    ...part, slot, force: null, activation: null, selected: false,
  }));
  const palette = new Uint8Array(parts.length * 4);
  const texture = new THREE.DataTexture(palette, parts.length, 1);
  const material = new THREE.MeshLambertMaterial({color: 0xffffff, side: THREE.DoubleSide});
  material.onBeforeCompile = shader => {
    shader.uniforms.previewPalette = {value: texture};
    shader.uniforms.previewPartCount = {value: parts.length};
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
      attribute float atlasPart;
      uniform sampler2D previewPalette;
      uniform float previewPartCount;
      varying vec3 previewColor;`).replace("#include <begin_vertex>", `#include <begin_vertex>
      previewColor = texture2D(previewPalette, vec2((atlasPart + 0.5) / previewPartCount, 0.5)).rgb;`);
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>",
      "#include <common>\nvarying vec3 previewColor;").replace("#include <color_fragment>",
      "#include <color_fragment>\ndiffuseColor.rgb *= previewColor;");
  };
  material.customProgramCacheKey = () => "bodyvista-preview-skin-palette-v1";
  const object = new THREE.SkinnedMesh(geometry, material);
  object.name = "轻量解剖肌肉";
  object.userData.anatomicalMuscles = true;
  object.frustumCulled = false;
  const bones = manifest.bones.map(record => {
    const bone = new THREE.Bone();
    bone.name = record.name;
    bone.matrixAutoUpdate = false;
    bone.matrix.fromArray(record.restMatrix);
    object.add(bone);
    return bone;
  });
  object.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  object.bind(skeleton);
  const updateCurves = makePreviewCurves(parts, attrs, skeleton);
  updateCurves();
  const invalidatePicking = addPicking(object, parts, bones);
  const boneByName = new Map(bones.map(bone => [bone.name, bone]));
  const unitIndex = new Map();
  for (const part of parts) {
    part.unitIds = part.units.map(name => {
      if (!unitIndex.has(name)) unitIndex.set(name, unitIndex.size);
      return unitIndex.get(name);
    });
  }
  const forces = new Float64Array(unitIndex.size), activations = new Float64Array(unitIndex.size);
  const color = new THREE.Color();
  let currentRegion, disposed = false;
  function paint(part) {
    if (part.force === null) color.fromArray(part.color);
    else if (part.force < 300) color.copy(COLD).lerp(WARM, Math.max(0, part.force) / 300);
    else color.copy(WARM).lerp(HOT, Math.min(1, (part.force - 300) / 900));
    if (part.selected) color.lerp(SELECTED, 0.6);
    const i = part.slot * 4;
    palette[i] = Math.round(color.r * 255);
    palette[i + 1] = Math.round(color.g * 255);
    palette[i + 2] = Math.round(color.b * 255);
    palette[i + 3] = 255;
  }
  function update(frame) {
    if (!frame || disposed) return;
    for (const record of frame.bodies || []) {
      const bone = boneByName.get(record.name);
      if (bone && record.matrix?.length === 16) {
        bone.matrix.fromArray(record.matrix);
        bone.matrixWorldNeedsUpdate = true;
      }
    }
    if (frame.bodies?.length) {
      object.updateMatrixWorld(true);
      updateCurves();
      invalidatePicking();
    }
    forces.fill(NaN);
    activations.fill(NaN);
    for (const row of frame.muscles || []) {
      const i = unitIndex.get(row.name);
      if (i === undefined) continue;
      if (Number.isFinite(row.force)) forces[i] = row.force;
      if (Number.isFinite(row.activation)) activations[i] = row.activation;
    }
    let changed = false;
    for (const part of parts) {
      let force = -Infinity, activation = -Infinity;
      for (const id of part.unitIds) {
        force = Math.max(force, forces[id]);
        activation = Math.max(activation, activations[id]);
      }
      const next = Number.isFinite(force) ? force : null;
      part.activation = Number.isFinite(activation) ? activation : null;
      if (part.force !== next) {
        part.force = next;
        paint(part);
        changed = true;
      }
    }
    if (changed) texture.needsUpdate = true;
  }
  function setRegion(region = "all") {
    if (region === currentRegion) return;
    currentRegion = region;
    let offset = 0;
    for (const part of parts) {
      part.visible = matchesRegion(region, part);
      if (!part.visible) continue;
      part.drawStart = offset;
      drawIndex.array.set(fullIndex.subarray(part.indexStart, part.indexStart + part.indexCount), offset);
      offset += part.indexCount;
    }
    geometry.setDrawRange(0, offset);
    drawIndex.needsUpdate = true;
  }
  function resolveHit(hit) {
    if (hit?.object !== object) return null;
    const part = parts[hit.atlasPart ?? attrs.atlasPart.array[hit.face?.a]];
    if (!part?.visible) return null;
    const tendon = part.tissueType === "tendon";
    return {
      type: tendon ? "tendon" : "muscle", tissueType: part.tissueType || "muscle",
      name: part.units[0] || part.id, label: part.label, atlasId: part.id,
      english: part.english, units: [...part.units], mapping: part.mapping, region: part.region,
      force: part.force, activation: part.activation, source: part.sourceFile,
      forceSummary: tendon ? "跟腱连接表面，不提供独立肌力"
        : part.units.length > 1 ? "关联肌束的最大张力"
        : part.units.length ? "关联模型肌束张力" : "未建立定量映射",
    };
  }
  for (const part of parts) paint(part);
  texture.needsUpdate = true;
  setRegion();
  const tendonCount = parts.filter(p => p.tissueType === "tendon").length;
  const stats = {
    ready: true, preview: true, muscleCount: parts.length - tendonCount, tendonCount,
    surfaceCount: parts.length, triangles: fullIndex.length / 3, shapeWorkers: 0,
    sheetSurfaceCount: 0, nativePathSurfaceCount: 0, boneContact: null,
    mappedParts: parts.filter(p => p.units.length).length, mappedUnits: unitIndex.size,
    source: manifest.source, deformation: "骨骼蒙皮与原图谱连续截面预览",
    curveSurfaceCount: parts.filter(p => p.curveBounds).length,
    limitations: "轻量表面随骨骼及已绑定的肌肉截面运动。肌肉之间与肌肉和骨之间的接触未在预览中求解。",
  };
  onProgress({loaded: manifest.byteLength, total: manifest.byteLength, message: `已载入 ${parts.length} 个轻量解剖表面`});
  return {
    object, update, setRegion, resolveHit,
    prepareFrame() { return null; },
    setVisible(value) { object.visible = Boolean(value); },
    setSelected(value) {
      let changed = false;
      for (const part of parts) {
        const selected = part.id === value || part.units.includes(value);
        if (selected !== part.selected) {
          part.selected = selected;
          paint(part);
          changed = true;
        }
      }
      if (changed) texture.needsUpdate = true;
    },
    get status() { return {...stats, region: currentRegion}; },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
      texture.dispose();
      skeleton.dispose();
    },
  };
}
