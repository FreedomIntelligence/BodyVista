import * as THREE from "../../src/vendor/three.js";

const FIELD_WIDTH = 4096;
const MAX_BONES = 128;
const ITERATIONS = 48;
const CLEARANCE = 0.00025;

/** Discrete, body-local bone occupancy fields. These are display contact
 * volumes, not cortical material models or additional muscle-force actuators.
 * CPU picking and the vertex shader use the same Float32 fields and matrices.
 */
export function makeBoneVolumes(manifest, buffer, partCount) {
  return buildBoneVolumes(manifest, buffer, partCount, false);
}

function buildBoneVolumes(manifest, buffer, partCount, distancesChecked) {
  if (manifest.version !== 1 || manifest.coordinateSystem !== "body-local native"
    || !Array.isArray(manifest.bones) || !manifest.bones.length
    || manifest.bones.length > MAX_BONES || buffer.byteLength !== manifest.byteLength
    || buffer.byteLength % 4) throw Error("骨碰撞体积合同无效。");
  const fieldLength = buffer.byteLength / 4;
  const sparse = manifest.storage === "sparse-bricks";
  const brickSize = manifest.brickSize || 8;
  const outsideDistance = manifest.outsideDistanceM || .01;
  const brickDataOffset = manifest.brickDataOffset || 0;
  if (sparse && (brickSize !== 8 || !Number.isInteger(brickDataOffset)
    || brickDataOffset < 0 || brickDataOffset > fieldLength
    || !Number.isFinite(outsideDistance) || outsideDistance <= CLEARANCE))
    throw Error("骨体积稀疏存储合同无效。");
  const height = Math.ceil(fieldLength / FIELD_WIDTH);
  if (height > 16384) throw Error("骨碰撞体积超过纹理容量。");
  // CPU queries and the GPU upload share this one padded array. Do not retain
  // a second complete 150 MB field solely for the CPU sampler.
  const field = new Float32Array(FIELD_WIDTH * height);
  field.set(new Float32Array(buffer));
  const info = new Float32Array(manifest.bones.length * 32);
  const candidates = new Float32Array((MAX_BONES + 1) * partCount);
  const inverse = new THREE.Matrix4();
  const volumes = manifest.bones.map((record, index) => {
    const { origin, spacing, dimensions } = record;
    const floatOffset = sparse ? record.lookupOffset : record.floatOffset;
    const storedDimensions = sparse ? record.brickDimensions : dimensions;
    if (!origin?.every(Number.isFinite) || origin.length !== 3
      || !spacing?.every(x => Number.isFinite(x) && x > 0) || spacing.length !== 3
      || !dimensions?.every(n => Number.isInteger(n) && n >= 2) || dimensions.length !== 3
      || !Number.isInteger(floatOffset) || floatOffset < 0
      || !storedDimensions?.every((n, a) => Number.isInteger(n) && n >= 1
        && (!sparse || n === Math.ceil(dimensions[a] / brickSize)))
      || storedDimensions.length !== 3
      || storedDimensions.reduce((a, b) => a * b, 1) >= 16777216
      || floatOffset + storedDimensions.reduce((a, b) => a * b, 1) > (sparse ? brickDataOffset : fieldLength))
      throw Error(`骨体积网格无效：${record.name}`);
    const lookupLength = storedDimensions.reduce((a, b) => a * b, 1);
    if (sparse) for (let i = 0; i < lookupLength; i++) {
      const id = field[floatOffset + i];
      if (!Number.isInteger(id) || id < -1 || (id >= 0 && brickDataOffset + (id + 1) * brickSize ** 3 > fieldLength))
        throw Error(`骨体积稀疏索引无效：${record.name}`);
    }
    const at = index * 32;
    // Keep the global offset as two exact small integers. A single Float32
    // address loses odd indices once a full-body field exceeds 2^24 voxels.
    info.set(origin, at + 16); info[at + 19] = floatOffset % FIELD_WIDTH;
    info.set(spacing, at + 20); info[at + 23] = dimensions[0];
    info[at + 24] = dimensions[1]; info[at + 25] = dimensions[2];
    info[at + 26] = Math.floor(floatOffset / FIELD_WIDTH);
    info[at + 27] = Math.min(.002, Math.max(...spacing));
    info.set(storedDimensions, at + 28);
    const localBounds = new THREE.Box3(new THREE.Vector3(...origin),
      new THREE.Vector3(...origin.map((x, axis) => x + spacing[axis] * (dimensions[axis] - 1))));
    return { ...record, index, localBounds, bounds: new THREE.Box3(), matrix: new THREE.Matrix4() };
  });
  const names = new Set(volumes.map(v => v.name));
  const byName = new Map(volumes.map(v => [v.name, v.index]));
  if (names.size !== volumes.length || (!distancesChecked && !field.every(Number.isFinite)))
    throw Error("骨体积含有重复骨名或无效距离。");
  const texture = new THREE.DataTexture(field, FIELD_WIDTH, height, THREE.RedFormat, THREE.FloatType);
  const infoTexture = new THREE.DataTexture(info, 8, manifest.bones.length, THREE.RGBAFormat, THREE.FloatType);
  const candidateTexture = new THREE.DataTexture(candidates, MAX_BONES + 1, partCount, THREE.RedFormat, THREE.FloatType);
  for (const item of [texture, infoTexture, candidateTexture]) item.minFilter = item.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  const previous = new THREE.Vector3(), trial = new THREE.Vector3();
  const result = { distance: Infinity, normal: new THREE.Vector3(), gradientLength: 1, bone: -1 };
  const reachable = new THREE.Box3();
  let ready = false;
  let lastProjection = { checked: false, unresolved: 0, minimumDistanceM: null, maxPenetrationM: 0 };

  function update(bodyRecords, parts) {
    const bodies = new Map(bodyRecords.map(b => [b.name, b]));
    for (const volume of volumes) {
      const record = bodies.get(volume.name);
      if (!record?.matrix || record.matrix.length !== 16 || !record.matrix.every(Number.isFinite))
        throw Error(`缺少骨碰撞变换：${volume.name}`);
      volume.matrix.fromArray(record.matrix);
      if (Math.abs(volume.matrix.determinant() - 1) > 1e-3) throw Error(`骨碰撞只支持刚体变换：${volume.name}`);
      inverse.copy(volume.matrix).invert().toArray(info, volume.index * 32);
      volume.bounds.copy(volume.localBounds).applyMatrix4(volume.matrix);
    }
    candidates.fill(0);
    for (const part of parts) {
      const ids = [];
      if (part.contactEnabled === false) { part.collisionBones = ids; continue; }
      // A correction out of one bone can enter a neighbour. Include every
      // volume reachable within this solver's bounded total displacement.
      reachable.copy(part.posedBounds).expandByScalar(ITERATIONS * .002);
      for (const volume of volumes) if (volume.bounds.intersectsBox(reachable)) ids.push(volume.index);
      const offset = part.slot * (MAX_BONES + 1);
      candidates[offset] = ids.length;
      candidates.set(ids, offset + 1);
      part.collisionBones = ids;
    }
    infoTexture.needsUpdate = candidateTexture.needsUpdate = true;
    ready = true;
  }

  function sample(index, worldPoint, output = result) {
    const at = index * 32;
    inverse.fromArray(info, at);
    point.copy(worldPoint).applyMatrix4(inverse);
    const x = (point.x - info[at + 16]) / info[at + 20];
    const y = (point.y - info[at + 17]) / info[at + 21];
    const z = (point.z - info[at + 18]) / info[at + 22];
    const nx = info[at + 23], ny = info[at + 24], nz = info[at + 25];
    output.distance = Infinity; output.normal.set(0, 0, 0); output.gradientLength = 1; output.bone = index;
    if (x < 0 || y < 0 || z < 0 || x > nx - 1 || y > ny - 1 || z > nz - 1) return output;
    const ix = Math.min(nx - 2, Math.floor(x)), iy = Math.min(ny - 2, Math.floor(y)), iz = Math.min(nz - 2, Math.floor(z));
    const tx = x - ix, ty = y - iy, tz = z - iz;
    const value = (dx, dy, dz) => {
      const px = ix + dx, py = iy + dy, pz = iz + dz;
      if (!sparse) return field[volumes[index].floatOffset + px + nx * (py + ny * pz)];
      const bx = info[at + 28], by = info[at + 29];
      const id = field[volumes[index].lookupOffset + Math.floor(px/brickSize)
        + bx * (Math.floor(py/brickSize) + by * Math.floor(pz/brickSize))];
      if (id < 0) return outsideDistance;
      return field[brickDataOffset + id * brickSize**3 + px%brickSize
        + brickSize * (py%brickSize + brickSize * (pz%brickSize))];
    };
    const a = value(0,0,0), b = value(1,0,0), c = value(0,1,0), d = value(1,1,0);
    const e = value(0,0,1), f = value(1,0,1), g = value(0,1,1), h = value(1,1,1);
    const mix = (p, q, t) => p + (q - p) * t;
    const lo = mix(mix(a, b, tx), mix(c, d, tx), ty), hi = mix(mix(e, f, tx), mix(g, h, tx), ty);
    output.distance = mix(lo, hi, tz);
    const gx = mix(mix(b - a, d - c, ty), mix(f - e, h - g, ty), tz) / info[at + 20];
    const gy = mix(mix(c - a, d - b, tx), mix(g - e, h - f, tx), tz) / info[at + 21];
    const gz = (hi - lo) / info[at + 22];
    output.normal.set(
      info[at] * gx + info[at + 1] * gy + info[at + 2] * gz,
      info[at + 4] * gx + info[at + 5] * gy + info[at + 6] * gz,
      info[at + 8] * gx + info[at + 9] * gy + info[at + 10] * gz,
    );
    if (output.normal.lengthSq() < 1e-12) {
      // At a distance-field medial axis no unique surface normal exists.
      // Use a deterministic local grid-axis gradient direction and iterate.
      output.normal.set(info[at], info[at + 4], info[at + 8]);
    }
    output.gradientLength = output.normal.length();
    output.normal.normalize();
    return output;
  }

  function project(target, ids, clearance = CLEARANCE) {
    lastProjection = { checked: false, unresolved: 0, minimumDistanceM: null, maxPenetrationM: 0 };
    if (!ready || !ids?.length) return target;
    for (let pass = 0; pass < ITERATIONS; pass++) {
      let deepest = clearance;
      let stepLimit = 0;
      let activeBone = -1;
      normal.set(0, 0, 0);
      for (const id of ids) {
        const hit = sample(id, target);
        if (hit.distance < deepest) {
          deepest = hit.distance;
          normal.copy(hit.normal).multiplyScalar(1 / Math.max(hit.gradientLength, 0.25));
          stepLimit = info[id * 32 + 27];
          activeBone = id;
        }
      }
      if (deepest >= clearance) break;
      normal.multiplyScalar(clearance - deepest + 1e-7);
      normal.multiplyScalar(Math.min(1, stepLimit / Math.max(normal.length(), 1e-12)));
      previous.copy(target);
      target.add(normal);
      let lo = 0, hi = 0;
      for (let j = 1; j <= 4; j++) {
        trial.copy(previous).addScaledVector(normal, j / 4);
        if (sample(activeBone, trial).distance >= clearance) { hi = j / 4; lo = (j-1) / 4; break; }
      }
      if (hi > 0) {
        for (let j = 0; j < 8; j++) {
          const mid = (lo + hi) * .5;
          trial.copy(previous).addScaledVector(normal, mid);
          if (sample(activeBone, trial).distance >= clearance) hi = mid;
          else lo = mid;
        }
        target.copy(previous).addScaledVector(normal, hi);
      }
    }
    let minimum = Infinity, unresolved = 0;
    for (const id of ids) {
      const distance = sample(id, target).distance;
      minimum = Math.min(minimum, distance);
      if (distance < clearance - 1e-6) unresolved++;
    }
    lastProjection = { checked: true, unresolved, minimumDistanceM: Number.isFinite(minimum) ? minimum : null,
      maxPenetrationM: Math.max(0, clearance - minimum) };
    return target;
  }

  function extendBounds(parts, aggregate) {
    for (const part of parts) {
      // Each step moves <=2 mm, including the last step out of a field. This
      // bound also covers transitions between overlapping volumes.
      if (part.collisionBones?.length) part.posedBounds.expandByScalar(ITERATIONS * .002 + 1e-5);
      if (part.visible) aggregate.union(part.posedBounds);
    }
  }

  function attachShader(shader) {
    shader.uniforms.boneVolumeField = { value: texture };
    shader.uniforms.boneVolumeInfo = { value: infoTexture };
    shader.uniforms.boneVolumeCandidates = { value: candidateTexture };
    shader.uniforms.boneVolumeFieldSize = { value: new THREE.Vector2(FIELD_WIDTH, height) };
    shader.uniforms.boneVolumeCount = { value: volumes.length };
    shader.uniforms.boneVolumeSparse = { value: sparse ? 1 : 0 };
    shader.uniforms.boneVolumeBrickOffset = { value: new THREE.Vector2(brickDataOffset % FIELD_WIDTH, Math.floor(brickDataOffset / FIELD_WIDTH)) };
    shader.uniforms.boneVolumeOutside = { value: outsideDistance };
    // Runtime loop bounds prevent ANGLE/driver compilers from expanding all
    // nested projection and line-search iterations at first draw. Values are
    // fixed by this module and match the CPU solver; they are not UI controls.
    shader.uniforms.boneVolumeIterations = { value: ITERATIONS };
    shader.uniforms.boneVolumeExitSamples = { value: 4 };
    shader.uniforms.boneVolumeBisections = { value: 8 };
    shader.uniforms.boneVolumeCorners = { value: 8 };
    shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>\n${BONE_VOLUME_GLSL}`);
  }

  return {
    update, sample, project, extendBounds, attachShader, volumes,
    exportSubset(names) { return compactBoneVolumeData(manifest, field, names); },
    query(name, worldPoint, output = result) {
      const index = byName.get(name);
      if (index === undefined) throw Error(`没有该骨的碰撞体积：${name}`);
      return sample(index, worldPoint, output);
    },
    clearanceM: CLEARANCE,
    get lastProjectionReport() { return {...lastProjection}; },
    get status() { return { ready, boneCount: volumes.length, mode: "voxel-bone-contact", iterations: ITERATIONS, clearanceM: CLEARANCE }; },
    dispose() { texture.dispose(); infoTexture.dispose(); candidateTexture.dispose(); },
  };
}

/** A worker needs only its muscles' contact bones. Rebase sparse brick IDs
 * without resampling distances, preserving the exact main-renderer field.
 */
export function compactBoneVolumeData(manifest, field, names) {
  const wanted = new Set(names);
  const bones = manifest.bones.filter(bone => wanted.has(bone.name));
  if (!bones.length || bones.length !== wanted.size) throw Error("骨碰撞子集包含未知骨名。");
  const output = { ...manifest, bones: bones.map(bone => ({ ...bone })) };
  delete output.binaryFile;
  delete output.binarySha256;
  output.parentBinarySha256 = manifest.binarySha256;
  let buffer;
  if (manifest.storage === "sparse-bricks") {
    const brickSize = manifest.brickSize || 8, brickVolume = brickSize ** 3;
    const ids = new Map();
    let lookupCount = 0;
    for (const bone of bones) {
      const count = bone.brickDimensions.reduce((a, b) => a * b, 1);
      lookupCount += count;
      for (let i = 0; i < count; i++) {
        const id = field[bone.lookupOffset + i];
        if (id >= 0 && !ids.has(id)) ids.set(id, ids.size);
      }
    }
    const data = new Float32Array(lookupCount + ids.size * brickVolume);
    let offset = 0;
    bones.forEach((bone, index) => {
      const count = bone.brickDimensions.reduce((a, b) => a * b, 1);
      output.bones[index].lookupOffset = offset;
      for (let i = 0; i < count; i++) {
        const id = field[bone.lookupOffset + i];
        data[offset + i] = id < 0 ? -1 : ids.get(id);
      }
      offset += count;
    });
    for (const [oldId, newId] of ids) {
      const start = manifest.brickDataOffset + oldId * brickVolume;
      data.set(field.subarray(start, start + brickVolume), lookupCount + newId * brickVolume);
    }
    output.brickDataOffset = lookupCount;
    output.brickCount = ids.size;
    buffer = data.buffer;
  } else {
    const length = bones.reduce((sum, bone) => sum + bone.dimensions.reduce((a, b) => a * b, 1), 0);
    const data = new Float32Array(length);
    let offset = 0;
    bones.forEach((bone, index) => {
      const count = bone.dimensions.reduce((a, b) => a * b, 1);
      output.bones[index].floatOffset = offset;
      data.set(field.subarray(bone.floatOffset, bone.floatOffset + count), offset);
      offset += count;
    });
    buffer = data.buffer;
  }
  output.byteLength = buffer.byteLength;
  return { manifest: output, buffer };
}

// Stream directly into one sized buffer. Cancelling also wakes a pending read.
export async function readSurfaceBinary(response, byteLength, signal, onBytes) {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) throw Error("表面资源字节数无效。");
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    signal?.throwIfAborted();
    if (buffer.byteLength !== byteLength) throw Error("表面资源长度与清单不符。");
    return buffer;
  }
  const bytes = new Uint8Array(byteLength), reader = response.body.getReader();
  const cancel = () => { reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener("abort", cancel, {once: true});
  let offset = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (offset + value.byteLength > byteLength) throw Error("表面资源超过清单长度。");
      bytes.set(value, offset);
      offset += value.byteLength;
      onBytes?.(offset);
    }
    if (offset !== byteLength) throw Error("表面资源长度与清单不符。");
    return bytes.buffer;
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function loadBoneVolumes(url, partCount, expectedSha256 = null, signal) {
  signal?.throwIfAborted();
  const reply = await fetch(url, {signal});
  if (!reply.ok) throw Error("骨碰撞体积清单未找到。");
  const manifest = await reply.json();
  signal?.throwIfAborted();
  if (expectedSha256 !== null && manifest.binarySha256 !== expectedSha256)
    throw Error("骨碰撞体积与肌肉静止配准版本不一致。");
  const binaryReply = await fetch(new URL(manifest.binaryFile, url), {signal});
  if (!binaryReply.ok) throw Error("骨碰撞体积数据未找到。");
  const buffer = await readSurfaceBinary(binaryReply, manifest.byteLength, signal);
  signal?.throwIfAborted();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  signal?.throwIfAborted();
  const hash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
  if (hash !== manifest.binarySha256) throw Error("骨碰撞体积与清单版本不一致。");
  if (!signal) return makeBoneVolumes(manifest, buffer, partCount);
  const field = new Float32Array(buffer);
  let nextYield = performance.now() + 12;
  for (let start = 0; start < field.length; start += 131072) {
    if (!field.subarray(start, start + 131072).every(Number.isFinite)) throw Error("骨体积含有无效距离。");
    if (performance.now() >= nextYield) {
      await new Promise(resolve => setTimeout(resolve, 0));
      signal.throwIfAborted();
      nextYield = performance.now() + 12;
    }
  }
  signal.throwIfAborted();
  return buildBoneVolumes(manifest, buffer, partCount, true);
}

const BONE_VOLUME_GLSL = `
uniform sampler2D boneVolumeField;
uniform sampler2D boneVolumeInfo;
uniform sampler2D boneVolumeCandidates;
uniform vec2 boneVolumeFieldSize;
uniform float boneVolumeCount;
uniform float boneVolumeSparse;
uniform vec2 boneVolumeBrickOffset;
uniform float boneVolumeOutside;
uniform int boneVolumeIterations;
uniform int boneVolumeExitSamples;
uniform int boneVolumeBisections;
uniform int boneVolumeCorners;
vec4 bvInfo(float col,float id){return texture2D(boneVolumeInfo,vec2((col+.5)/8.,(id+.5)/boneVolumeCount));}
float bvValue(float index,vec2 offset){
  float x=mod(index,boneVolumeFieldSize.x)+offset.x;
  vec2 pixel=vec2(mod(x,boneVolumeFieldSize.x),offset.y+floor(index/boneVolumeFieldSize.x)+floor(x/boneVolumeFieldSize.x));
  return texture2D(boneVolumeField,(pixel+.5)/boneVolumeFieldSize).r;
}
float bvVoxel(vec3 p,vec3 dim,vec3 bricks,vec2 offset){
  if(boneVolumeSparse<.5)return bvValue(p.x+dim.x*(p.y+dim.y*p.z),offset);
  vec3 cell=floor(p/8.);float id=bvValue(cell.x+bricks.x*(cell.y+bricks.y*cell.z),offset);
  if(id<0.)return boneVolumeOutside;
  vec3 local=mod(p,8.);
  // Split a brick ID into row/column before multiplying, so even large full
  // body fields never use an inexact single Float32 global address.
  float perRow=boneVolumeFieldSize.x/512.;
  vec2 base=boneVolumeBrickOffset+vec2(mod(id,perRow)*512.,floor(id/perRow));
  base=vec2(mod(base.x,boneVolumeFieldSize.x),base.y+floor(base.x/boneVolumeFieldSize.x));
  return bvValue(local.x+8.*(local.y+8.*local.z),base);
}
float bvSample(float id,vec3 world,out vec3 gradient){
  mat4 inv=mat4(bvInfo(0.,id),bvInfo(1.,id),bvInfo(2.,id),bvInfo(3.,id));
  vec4 origin=bvInfo(4.,id),spacing=bvInfo(5.,id),sizes=bvInfo(6.,id);
  vec3 dim=vec3(spacing.w,sizes.xy),q=((inv*vec4(world,1.)).xyz-origin.xyz)/spacing.xyz;
  gradient=vec3(0.);
  if(any(lessThan(q,vec3(0.)))||any(greaterThan(q,dim-1.)))return 1e9;
  vec3 cell=min(floor(q),dim-2.),u=q-cell;
  vec2 offset=vec2(origin.w,sizes.z);vec3 bricks=bvInfo(7.,id).xyz;
  // One voxel lookup expression also keeps the compiled shader compact.
  // These are the eight ordinary trilinear weights and their derivatives.
  float distance=0.;vec3 localGradient=vec3(0.);
  for(int k=0;k<boneVolumeCorners;k++){
    vec3 corner=vec3(mod(float(k),2.),mod(floor(float(k)/2.),2.),floor(float(k)/4.));
    vec3 weight=mix(1.-u,u,corner),sign=2.*corner-1.;
    float value=bvVoxel(cell+corner,dim,bricks,offset);
    distance+=value*weight.x*weight.y*weight.z;
    localGradient+=value*vec3(sign.x*weight.y*weight.z,weight.x*sign.y*weight.z,weight.x*weight.y*sign.z);
  }
  localGradient/=spacing.xyz;
  gradient=transpose(mat3(inv))*localGradient;
  if(dot(gradient,gradient)<1e-12)gradient=vec3(inv[0][0],inv[1][0],inv[2][0]);
  gradient=normalize(gradient)/max(length(gradient),.25);
  return distance;
}
vec3 bvProject(vec3 p,float row){
  float count=texture2D(boneVolumeCandidates,vec2(.5/${MAX_BONES + 1}.0,row)).r;
  for(int pass=0;pass<boneVolumeIterations;pass++){
    float deepest=${CLEARANCE},stepLimit=0.,activeBone=-1.;vec3 normal=vec3(0.);
    for(int j=0;j<int(count);j++){
      float id=texture2D(boneVolumeCandidates,vec2((float(j)+1.5)/${MAX_BONES + 1}.0,row)).r;
      vec3 gradient;float distance=bvSample(id,p,gradient);
      if(distance<deepest){deepest=distance;normal=gradient;stepLimit=bvInfo(6.,id).w;activeBone=id;}
    }
    if(deepest>=${CLEARANCE})break;
    vec3 step=normal*(${CLEARANCE}-deepest+1e-7);
    step*=min(1.,stepLimit/max(length(step),1e-12));
    vec3 previous=p;p+=step;vec3 ignored;float lo=0.,hi=0.;
    for(int j=1;j<=boneVolumeExitSamples;j++){
      if(bvSample(activeBone,previous+step*float(j)/float(boneVolumeExitSamples),ignored)>=${CLEARANCE}){hi=float(j)/float(boneVolumeExitSamples);lo=float(j-1)/float(boneVolumeExitSamples);break;}
    }
    if(hi>0.){
      for(int j=0;j<boneVolumeBisections;j++){
        float mid=(lo+hi)*.5;
        if(bvSample(activeBone,previous+step*mid,ignored)>=${CLEARANCE})hi=mid;else lo=mid;
      }
      p=previous+step*hi;
    }
  }
  return p;
}
`;
