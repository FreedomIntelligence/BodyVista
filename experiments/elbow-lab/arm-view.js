import * as THREE from "../../src/vendor/three.js";
import { GLTFLoader } from "../../src/vendor/GLTFLoader.js";

import { ARM, bindMuscle, deformMuscle, fiberLength } from "./muscle-shape.js";

const AXIS = new THREE.Vector3(-1, 0, 0);
const DOWN = new THREE.Vector3(0, 0, -1);
const stops = [0, 80, 180, 400];
const palette = ["#c6d6d6", "#73afa7", "#e8a358", "#b63434"].map(
  (c) => new THREE.Color(c),
);
const loader = new GLTFLoader();
const viewers = new Set();
const initialOrbit = { yaw: -2.64, pitch: 0.12 };
const orbit = { ...initialOrbit };
let atlasPromise;

async function readModel(part) {
  // Source checkouts store GLB bytes inside inert, ID-labelled JSON wrappers.
  // Production builds supply the exact same bytes as .glb files.
  const source = new URL("../../" + part.file, import.meta.url);
  const reply = await fetch(source);
  let bytes;
  if (reply.ok) {
    const script = (await reply.text()).trim();
    const wrapper = "window.Bio2MeshDetailReady(";
    if (script.startsWith(wrapper) && script.endsWith(");")) {
      const data = JSON.parse(script.slice(wrapper.length, -2));
      if (data.id !== part.id) throw Error("图谱结构编号不匹配");
      bytes = Uint8Array.from(atob(data.glb), (c) => c.charCodeAt(0)).buffer;
    }
  }
  if (!bytes) {
    const binary = await fetch(source.href.replace(/\.js$/, ".glb"));
    if (!binary.ok) throw Error("缺少图谱文件 " + part.id);
    bytes = await binary.arrayBuffer();
  }
  const gltf = await loader.parseAsync(bytes, "");
  const mesh = gltf.scene.children[0];
  if (!mesh?.isMesh || mesh.userData.partId !== part.id)
    throw Error("网格编号不匹配");
  mesh.material.dispose();
  return mesh.geometry;
}

async function getJSON(path) {
  const resp = await fetch(new URL(path, import.meta.url));
  if (!resp.ok) throw Error("找不到 " + path);
  return resp.json();
}

export async function loadAtlas() {
  const [manifest, fibers] = await Promise.all([
    getJSON("./atlas/bindings.json"),
    getJSON("./model/fiber-lengths.json"),
  ]);
  if (String(manifest.units) !== String(fibers.units))
    throw Error("纤维与图谱的单元顺序不一致");
  const elbow = new THREE.Vector3(...manifest.elbow),
    shoulder = new THREE.Vector3(...manifest.shoulder);
  const wrist = new THREE.Vector3(...manifest.wrist);
  const upper = elbow.clone().sub(shoulder),
    lower = wrist.clone().sub(elbow);
  const upperScale = ARM.upper / upper.length(),
    foreScale = ARM.forearm / lower.length();
  const neutralUpper = new THREE.Quaternion().setFromUnitVectors(
    upper.normalize(),
    DOWN,
  );
  const neutralFore = new THREE.Quaternion().setFromUnitVectors(
    lower.normalize().applyQuaternion(neutralUpper),
    DOWN,
  );
  const point = new THREE.Vector3(),
    guide = new THREE.Vector3();
  const parts = await Promise.all(
    manifest.parts.map(async (part) => {
      const geometry = await readModel(part);
      geometry
        .translate(-elbow.x, -elbow.y, -elbow.z)
        .applyQuaternion(neutralUpper);
      let role = part.role;
      const unit = manifest.units.indexOf(part.unit);
      if (role === "forearm") {
        geometry.applyQuaternion(neutralFore);
        if (/^(ulna|radius) right$/.test(part.english))
          geometry.scale(foreScale, foreScale, foreScale);
        else {
          role = "hand";
          // The hand is registered independently at the wrist and the distal metacarpal row.
          geometry
            .translate(0, 0, wrist.distanceTo(elbow))
            .scale(0.48, 0.48, 0.48);
          const pos = geometry.attributes.position;
          for (let j = 0; j < pos.count; j++) {
            const shift =
              THREE.MathUtils.smoothstep(-pos.getZ(j), 0, 0.064) * 0.011;
            pos.setY(j, pos.getY(j) + shift);
          }
        }
      } else if (role === "muscle") {
        const pos = geometry.attributes.position;
        for (let j = 0; j < pos.count; j++) {
          point.fromBufferAttribute(pos, j);
          const w = 1 - THREE.MathUtils.smoothstep(point.z, -0.03, 0.09);
          guide
            .copy(point)
            .applyQuaternion(neutralFore)
            .multiplyScalar(foreScale);
          point.multiplyScalar(upperScale).lerp(guide, w);
          pos.setXYZ(j, point.x, point.y, point.z);
        }
        geometry.computeVertexNormals();
      } else {
        geometry.scale(upperScale, upperScale, upperScale);
        if (part.english !== "humerus right") role = "girdle";
      }
      geometry.computeBoundingBox();
      const binding = role === "muscle" ? bindMuscle(geometry) : null;
      return { ...part, geometry, role, unit, binding };
    }),
  );
  return { parts, fibers };
}

function forceColor(newtons, out) {
  if (!Number.isFinite(newtons)) return out.set("#a3aaa9");
  const value = THREE.MathUtils.clamp(newtons, 0, 400);
  const end = value <= stops[1] ? 1 : value <= stops[2] ? 2 : 3;
  return out.lerpColors(
    palette[end - 1],
    palette[end],
    (value - stops[end - 1]) / (stops[end] - stops[end - 1]),
  );
}

function group(parent, z = 0) {
  const out = new THREE.Group();
  out.position.z = z;
  parent.add(out);
  return out;
}

function makeGear(wrist) {
  const dark = new THREE.MeshStandardMaterial({
    color: "#344855",
    roughness: 0.43,
    metalness: 0.4,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: "#b4c3c2",
    roughness: 0.38,
    metalness: 0.56,
  });
  const rim = new THREE.MeshStandardMaterial({
    color: "#63837d",
    roughness: 0.55,
    metalness: 0.25,
  });
  const holder = group(wrist, -ARM.palm),
    models = {},
    geometries = [];
  for (const type of ["dumbbell", "barbell"]) {
    const item = (models[type] = group(holder));
    const bar = type === "barbell";
    function cylinder(x, radius, width, material, sides = 32) {
      const geom = new THREE.CylinderGeometry(radius, radius, width, sides);
      geometries.push(geom);
      const mesh = new THREE.Mesh(geom, material);
      mesh.rotation.z = Math.PI / 2;
      mesh.position.x = x;
      item.add(mesh);
    }
    cylinder(0, 0.006, bar ? 0.57 : 0.155, steel);
    cylinder(0, 0.008, 0.061, dark);
    for (const sign of [-1, 1]) {
      const center = bar ? 0.214 : 0.054;
      cylinder(
        sign * center,
        bar ? 0.057 : 0.032,
        bar ? 0.014 : 0.02,
        dark,
        bar ? 40 : 12,
      );
      cylinder(
        sign * (center + 0.01),
        bar ? 0.053 : 0.03,
        0.005,
        rim,
        bar ? 40 : 12,
      );
      cylinder(
        sign * (center + 0.018),
        bar ? 0.049 : 0.026,
        0.01,
        dark,
        bar ? 40 : 12,
      );
      cylinder(sign * (center + 0.027), 0.011, 0.007, steel);
    }
    item.visible = false;
  }
  return {
    holder,
    models,
    dispose() {
      geometries.forEach((g) => g.dispose());
      [dark, steel, rim].forEach((m) => m.dispose());
    },
  };
}

const digits = ["first", "second", "third", "fourth", "fifth"];
function mountFingers(wrist, pieces) {
  const joints = [];
  for (const digit of digits) {
    let parent = wrist,
      previous = new THREE.Vector3();
    for (const [level, segment] of ["proximal", "middle", "distal"].entries()) {
      const part = pieces.get(
        segment + " phalanx of " + digit + " finger of hand right",
      );
      if (!part) continue;
      const geom = part.geometry,
        pos = geom.attributes.position,
        box = geom.boundingBox;
      const threshold = box.max.z - (box.max.z - box.min.z) * 0.14;
      const pivot = new THREE.Vector3();
      let count = 0;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) >= threshold) {
          pivot.x += pos.getX(i);
          pivot.y += pos.getY(i);
          pivot.z += pos.getZ(i);
          count++;
        }
      }
      pivot.divideScalar(Math.max(1, count));
      const joint = group(parent);
      joint.position.copy(pivot).sub(previous);
      joint.add(part);
      part.position.copy(pivot).multiplyScalar(-1);
      const thumb = digit === "first";
      const axis = thumb
        ? new THREE.Vector3(-0.55, -0.82, 0.13).normalize()
        : AXIS;
      const angle = thumb ? (level === 0 ? 56 : 43) : [71, 77, 49][level];
      joints.push({ joint, axis, radians: THREE.MathUtils.degToRad(angle) });
      previous = pivot;
      parent = joint;
    }
  }
  return joints;
}

export function createArmView(
  container,
  onSelectMuscle,
  { editor = false } = {},
) {
  container.dataset.atlasStatus = "loading";
  const message = document.createElement("span");
  message.textContent = "正在载入右臂图谱…";
  message.style.cssText =
    "position:absolute;inset:0;display:grid;place-content:center;text-align:center;padding:12px;z-index:1;color:#476268;font:13px system-ui;pointer-events:none";
  if (getComputedStyle(container).position === "static")
    container.style.position = "relative";
  container.append(message);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
  } catch {
    container.dataset.atlasStatus = "error";
    message.textContent = "当前浏览器无法启用三维绘图。";
    return {
      update() {},
      projectJoints() {
        return null;
      },
      planePoint() {
        return null;
      },
      dispose() {
        message.remove();
      },
    };
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.setAttribute(
    "aria-label",
    editor
      ? "右臂姿势编辑图"
      : "右臂解剖图谱。拖动旋转，双击复位，点击肌肉选中曲线。",
  );
  canvas.setAttribute("role", "img");
  canvas.style.cssText =
    "display:block;width:100%;height:100%;touch-action:none;cursor:" +
    (editor ? "default" : "grab");
  container.append(canvas);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#fff9eb", "#9ca7ac", 1.85));
  const keyLight = new THREE.DirectionalLight("#fff6e6", 2.05);
  keyLight.position.set(-2, -3, 5);
  scene.add(keyLight);
  const rim = new THREE.DirectionalLight("#f0f8ff", 0.9);
  rim.position.set(2, 1, 1);
  scene.add(rim);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 12);
  camera.up.set(0, 0, 1);
  const target = new THREE.Vector3(),
    direction = new THREE.Vector3(),
    p = new THREE.Vector3();
  const screenRight = new THREE.Vector3(),
    screenUp = new THREE.Vector3();
  const shoulder = group(scene),
    girdle = group(shoulder, -ARM.upper);
  const upper = group(shoulder),
    elbow = group(upper, -ARM.upper),
    forearm = group(elbow);
  const wrist = group(forearm, -ARM.forearm),
    gear = makeGear(wrist);
  const pointMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.015, 16, 12),
    new THREE.MeshStandardMaterial({ color: "#5b746b" }),
  );
  forearm.add(pointMarker);
  pointMarker.visible = false;
  const muscles = [],
    surfaces = [],
    materials = [];
  const ray = new THREE.Raycaster(),
    cursor = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  let fingers = [],
    atlas,
    aspect = 1,
    dead = false,
    lastShape = "";
  let latest = { angle: 0, forces: null, selected: -1, pose: {} };
  function draw() {
    if (!dead) renderer.render(scene, camera);
  }

  function setCamera() {
    const yaw = editor ? -2.78 : orbit.yaw,
      pitch = editor ? 0.035 : orbit.pitch;
    direction.set(
      Math.cos(pitch) * Math.cos(yaw),
      Math.cos(pitch) * Math.sin(yaw),
      Math.sin(pitch),
    );
    screenRight.crossVectors(camera.up, direction).normalize();
    screenUp.crossVectors(direction, screenRight);
    target.set(0, -0.075, -0.274);
    let half = Math.max(0.405, 0.338 / aspect);
    if (editor && atlas) {
      scene.updateMatrixWorld(true);
      // Keep the neutral camera at ordinary angles. Extend it only as far as needed
      // to keep grasp and joint handles reachable after a high or translated pose.
      let minX = -half * aspect,
        maxX = -minX,
        minY = -half,
        maxY = half;
      for (const node of [shoulder, elbow, wrist, gear.holder]) {
        node.getWorldPosition(p).sub(target);
        const x = p.dot(screenRight),
          y = p.dot(screenUp);
        minX = Math.min(minX, x - 0.09);
        maxX = Math.max(maxX, x + 0.09);
        minY = Math.min(minY, y - 0.09);
        maxY = Math.max(maxY, y + 0.09);
      }
      target
        .addScaledVector(screenRight, (minX + maxX) / 2)
        .addScaledVector(screenUp, (minY + maxY) / 2);
      half = Math.max((maxX - minX) / (2 * aspect), (maxY - minY) / 2);
    }
    if (!editor && atlas) {
      const rect = {
        left: Infinity,
        right: -Infinity,
        top: -Infinity,
        bottom: Infinity,
      };
      function include(point) {
        const x = point.dot(screenRight),
          y = point.dot(screenUp);
        rect.left = Math.min(rect.left, x);
        rect.right = Math.max(rect.right, x);
        rect.bottom = Math.min(rect.bottom, y);
        rect.top = Math.max(rect.top, y);
      }
      scene.updateMatrixWorld(true);
      for (const mesh of surfaces) {
        if (mesh.userData.index !== undefined) continue;
        const box = mesh.geometry.boundingBox;
        for (let k = 0; k < 8; k++)
          include(
            p
              .set(
                k & 1 ? box.max.x : box.min.x,
                k & 2 ? box.max.y : box.min.y,
                k & 4 ? box.max.z : box.min.z,
              )
              .applyMatrix4(mesh.matrixWorld),
          );
      }
      // Both playback panels use the same camera even when only one hand holds an implement.
      if (
        latest.pose.frameGear?.type === "barbell" ||
        latest.pose.gear?.type === "barbell"
      ) {
        for (const x of [-0.29, 0.29])
          for (const z of [-0.058, 0.058]) {
            include(p.set(x, 0, z).applyMatrix4(gear.holder.matrixWorld));
          }
      }
      target
        .copy(screenRight)
        .multiplyScalar((rect.left + rect.right) / 2)
        .addScaledVector(screenUp, (rect.bottom + rect.top) / 2);
      half =
        Math.max(
          (rect.top - rect.bottom) / 2,
          (rect.right - rect.left) / (2 * aspect),
          0.19,
        ) * 1.12;
    }
    camera.left = -half * aspect;
    camera.right = half * aspect;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    camera.position.copy(target).addScaledVector(direction, 2);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    draw();
  }
  if (!editor) viewers.add(setCamera);
  const observer = new ResizeObserver(() => {
    const width = Math.max(1, container.clientWidth),
      height = Math.max(1, container.clientHeight);
    aspect = width / height;
    renderer.setSize(width, height, false);
    setCamera();
    container.dispatchEvent(new Event("atlasresize"));
  });
  observer.observe(container);

  const events = new AbortController();
  const options = { signal: events.signal };
  let drag;
  function hitRay(x, y) {
    const rect = canvas.getBoundingClientRect();
    cursor.set(
      ((x - rect.left) / rect.width) * 2 - 1,
      1 - ((y - rect.top) / rect.height) * 2,
    );
    ray.setFromCamera(cursor, camera);
  }
  if (!editor) {
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0) return;
        drag = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          yaw: orbit.yaw,
          pitch: orbit.pitch,
          moved: false,
        };
        canvas.setPointerCapture(e.pointerId);
      },
      options,
    );
    canvas.addEventListener(
      "pointermove",
      (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x,
          dy = e.clientY - drag.y;
        if (Math.hypot(dx, dy) > 4) drag.moved = true;
        if (drag.moved) {
          orbit.yaw = drag.yaw - dx * 0.011;
          orbit.pitch = THREE.MathUtils.clamp(
            drag.pitch + dy * 0.011,
            -1.2,
            1.2,
          );
          viewers.forEach((f) => f());
        }
      },
      options,
    );
    canvas.addEventListener(
      "pointerup",
      (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const clicked = !drag.moved;
        drag = null;
        if (clicked) {
          hitRay(e.clientX, e.clientY);
          const index = ray.intersectObjects(surfaces, false)[0]?.object
            .userData.index;
          if (Number.isInteger(index)) onSelectMuscle?.(index);
        }
      },
      options,
    );
    canvas.addEventListener(
      "pointercancel",
      () => {
        drag = null;
      },
      options,
    );
    canvas.addEventListener(
      "dblclick",
      () => {
        Object.assign(orbit, initialOrbit);
        viewers.forEach((f) => f());
      },
      options,
    );
  }

  function projectJoints() {
    if (!atlas || dead) return null;
    scene.updateMatrixWorld(true);
    const coords = {};
    for (const [name, node] of Object.entries({
      shoulder,
      elbow,
      wrist,
      hand: gear.holder,
    })) {
      node.getWorldPosition(p).project(camera);
      coords[name] = {
        x: ((p.x + 1) * container.clientWidth) / 2,
        y: ((1 - p.y) * container.clientHeight) / 2,
      };
    }
    return coords;
  }
  function planePoint(clientX, clientY) {
    if (!atlas || dead) return null;
    hitRay(clientX, clientY);
    if (!ray.ray.intersectPlane(plane, p)) return null;
    return { x: -p.y, y: -p.z };
  }
  function update(angle, forces, selected, pose = {}) {
    angle = Number.isFinite(angle) ? angle : 0;
    latest = { angle, forces, selected, pose };
    const s = pose.shoulderDeg || 0,
      w = pose.wristDeg || 0;
    shoulder.position.set(0, -(pose.rootX || 0), -(pose.rootY || 0));
    upper.rotation.x = -THREE.MathUtils.degToRad(s);
    forearm.rotation.x = -THREE.MathUtils.degToRad(angle);
    wrist.rotation.x = -THREE.MathUtils.degToRad(w);
    pointMarker.visible = Number.isFinite(pose.pointRadius);
    if (pointMarker.visible) pointMarker.position.z = -pose.pointRadius;
    const gearType = pointMarker.visible ? "none" : pose.gear?.type || "none";
    for (const [type, item] of Object.entries(gear.models))
      item.visible = type === gearType;
    const gripping = Object.hasOwn(gear.models, gearType);
    for (const finger of fingers)
      finger.joint.quaternion.setFromAxisAngle(
        finger.axis,
        gripping ? finger.radians : 0,
      );
    if (!atlas || dead) return;
    const shapeKey =
      s +
      "/" +
      angle +
      "/" +
      (pose.activations || []).map((a) => Math.round(a * 200)).join(",");
    for (const mesh of muscles) {
      const i = mesh.userData.index;
      if (shapeKey !== lastShape) {
        const length = fiberLength(atlas.fibers, i, s, angle);
        deformMuscle(
          mesh.geometry,
          mesh.userData.binding,
          i,
          length / mesh.userData.restLength,
          angle,
          s,
          pose.activations?.[i] || 0,
        );
      }
      if (editor && !Number.isFinite(forces?.[i]))
        mesh.material.color.set(i < 3 ? "#ad4e47" : "#a97165");
      else forceColor(forces?.[i], mesh.material.color);
      mesh.material.emissive.set(
        !editor && i === selected ? "#20180c" : "#000000",
      );
    }
    lastShape = shapeKey;
    if (editor && pose.freezeCamera) {
      scene.updateMatrixWorld(true);
      draw();
    } else setCamera();
  }
  atlasPromise ??= loadAtlas().catch((error) => {
    atlasPromise = undefined;
    throw error;
  });
  atlasPromise
    .then((data) => {
      if (dead) return;
      atlas = data;
      const bone = new THREE.MeshStandardMaterial({
        color: "#d3cec0",
        roughness: 0.84,
      });
      materials.push(bone);
      const handMeshes = new Map();
      for (const part of atlas.parts) {
        let mesh;
        if (part.role === "muscle") {
          const material = new THREE.MeshStandardMaterial({
            roughness: 0.72,
            vertexColors: true,
          });
          materials.push(material);
          // Per-view positions and normals are writable. The source binding is read-only and shared.
          mesh = new THREE.Mesh(part.geometry.clone(), material);
          mesh.userData = {
            index: part.unit,
            binding: part.binding,
            restLength: fiberLength(atlas.fibers, part.unit, 0, 0),
          };
          elbow.add(mesh);
          muscles.push(mesh);
        } else {
          mesh = new THREE.Mesh(part.geometry, bone);
          const parent = { girdle, upper: elbow, forearm, hand: wrist }[
            part.role
          ];
          parent.add(mesh);
          if (part.role === "hand") handMeshes.set(part.english, mesh);
        }
        mesh.name = part.name;
        mesh.userData.partId = part.id;
        surfaces.push(mesh);
      }
      fingers = mountFingers(wrist, handMeshes);
      update(latest.angle, latest.forces, latest.selected, latest.pose);
      setCamera();
      container.dataset.atlasStatus = "ready";
      message.remove();
      container.dispatchEvent(new Event("atlasready"));
    })
    .catch((error) => {
      if (dead) return;
      container.dataset.atlasStatus = "error";
      message.textContent = "右臂图谱未载入：" + error.message;
    });
  function lengths() {
    if (!atlas) return null;
    return [0, 3].map((i) =>
      fiberLength(atlas.fibers, i, latest.pose.shoulderDeg || 0, latest.angle),
    );
  }
  return {
    update,
    projectJoints,
    planePoint,
    lengths,
    dispose() {
      dead = true;
      events.abort();
      observer.disconnect();
      viewers.delete(setCamera);
      muscles.forEach((m) => m.geometry.dispose());
      gear.dispose();
      materials.forEach((m) => m.dispose());
      renderer.dispose();
      pointMarker.geometry.dispose();
      pointMarker.material.dispose();
      canvas.remove();
      message.remove();
    },
  };
}
