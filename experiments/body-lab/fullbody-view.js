import * as THREE from "../../src/vendor/three.js";
import { OrbitControls } from "../../src/vendor/OrbitControls.js";
import { createLatestFrameQueue, createSerialPreparationQueue } from "./muscle-shape-pool.js";

const Y = new THREE.Vector3(0, 1, 0);
const AXIS_COLORS = ["#ba4d49", "#2a8173", "#476cb4"];
const GIZMO_CENTER = 110;
const COLD = new THREE.Color("#a2b7b3"),
  WARM = new THREE.Color("#d8834e"),
  HOT = new THREE.Color("#a5222d");
const UNKNOWN = new THREE.Color("#a3837c"),
  SELECTED = new THREE.Color("#5e9987");
const SEGMENTS = 22,
  RADIAL = 6,
  VERTICES = (SEGMENTS + 1) * (RADIAL + 1);
const TRIANGLES = SEGMENTS * RADIAL * 2;
const REGION_LABELS = {
  all: "全身",
  head: "头颈",
  neck: "头颈",
  trunk: "躯干",
  torso: "躯干",
  arm_r: "右上肢",
  arm_l: "左上肢",
  hand_r: "右手",
  hand_l: "左手",
  leg_r: "右下肢",
  leg_l: "左下肢",
  foot_r: "右足",
  foot_l: "左足",
  upper: "上肢",
  lower: "下肢",
  pelvis: "骨盆",
  ribs: "胸廓与肋骨",
  other: "其他",
};
const HANDLE_LABELS = {
  pelvis: "骨盆",
  head: "头颈",
  lumbar: "躯干",
  shoulder_r: "右肩",
  shoulder_l: "左肩",
  elbow_r: "右肘",
  elbow_l: "左肘",
  wrist_r: "右腕",
  wrist_l: "左腕",
  hand_r: "右掌",
  hand_l: "左掌",
  hip_r: "右髋",
  hip_l: "左髋",
  knee_r: "右膝",
  knee_l: "左膝",
  ankle_r: "右踝",
  ankle_l: "左踝",
  toe_r: "右足尖",
  toe_l: "左足尖",
};
const isWristControl = (name) => /^(?:flexion|deviation|wrist_flex|wrist_dev)_[rl]$/.test(name);
const WRIST_CONTROL_NOTE = "腕部数值是两级腕骨联动的控制角，不是手掌总转角或临床屈伸角；前臂保持固定。";
// Arm labels reuse Arm26; lower-limb model abbreviations are documented in
// https://pmc.ncbi.nlm.nih.gov/articles/PMC9204520/ (muscle-group table).
// Keep the original unit name beside every translation; bundles are not
// independent anatomical muscles, and unverified abbreviations stay unchanged.
const MUSCLE_LABELS = {
  BIClong: "肱二头肌长头",
  BICshort: "肱二头肌短头",
  BRA: "肱肌",
  TRIlong: "肱三头肌长头",
  TRIlat: "肱三头肌外侧头",
  TRImed: "肱三头肌内侧头",
  addbrev: "短收肌",
  addlong: "长收肌",
  addmagDist: "大收肌远端肌束",
  addmagIsch: "大收肌坐骨部肌束",
  addmagMid: "大收肌中部肌束",
  addmagProx: "大收肌近端肌束",
  bflh: "股二头肌长头",
  bfsh: "股二头肌短头",
  edl: "趾长伸肌",
  ehl: "拇长伸肌（足）",
  fdl: "趾长屈肌",
  fhl: "拇长屈肌（足）",
  gaslat: "腓肠肌外侧头",
  gasmed: "腓肠肌内侧头",
  grac: "股薄肌",
  iliacus: "髂肌",
  perbrev: "腓骨短肌",
  perlong: "腓骨长肌",
  piri: "梨状肌",
  recfem: "股直肌",
  sart: "缝匠肌",
  semimem: "半膜肌",
  semiten: "半腱肌",
  soleus: "比目鱼肌",
  tfl: "阔筋膜张肌",
  tibant: "胫骨前肌",
  tibpost: "胫骨后肌",
  vasint: "股中间肌",
  vaslat: "股外侧肌",
  vasmed: "股内侧肌",
};

function sideOf(name, record = {}) {
  if (["r", "right"].includes(record.side)) return "r";
  if (["l", "left"].includes(record.side)) return "l";
  return /(?:^r_|_r$|right)/i.test(name)
    ? "r"
    : /(?:^l_|_l$|left)/i.test(name)
      ? "l"
      : "";
}
function regionOf(name, record = {}) {
  if (record.region) return record.region;
  const side = sideOf(name, record),
    suffix = side ? `_${side}` : "";
  if (/finger|thumb|index|middle|ring|little|pinky|mcp|pip|dip/i.test(name))
    return `hand${suffix}`;
  if (/toe|mtp|foot|tarsal/i.test(name)) return `foot${suffix}`;
  if (/hand|wrist|elbow|shoulder|humer|ulna|radius|clavic|scap/i.test(name))
    return `arm${suffix}`;
  if (/hip|knee|ankle|femur|tibia|fibula/i.test(name)) return `leg${suffix}`;
  if (/head|neck|cervic|skull/i.test(name)) return "neck";
  if (/pelvis/i.test(name)) return "pelvis";
  if (
    /lumbar|spine|thorax|thoracic|sternum|sacrum|abdomen|torso|trunk/i.test(
      name,
    )
  )
    return "trunk";
  return "other";
}
function groupMatches(region, name, record) {
  if (region === "all") return true;
  const actual = regionOf(name, record);
  if (actual === region) return true;
  if (/^arm_[rl]$/.test(region))
    return actual === region.replace("arm_", "hand_");
  if (/^leg_[rl]$/.test(region))
    return actual === region.replace("leg_", "foot_");
  if (region === "upper") return /^(arm|hand)/.test(actual);
  if (region === "lower") return /^(leg|foot)/.test(actual);
  if (region === "neck" || region === "head")
    return actual === "head" || actual === "neck";
  if (region === "trunk" || region === "torso")
    return ["trunk", "torso", "pelvis"].includes(actual);
  return false;
}
function positionOf(value) {
  const position = Array.isArray(value) ? value : value?.position;
  return Array.isArray(position) &&
    position.length === 3 &&
    position.every(Number.isFinite)
    ? position
    : null;
}
function colorForce(force, result) {
  if (!Number.isFinite(force)) return result.copy(UNKNOWN);
  if (force < 300)
    return result.copy(COLD).lerp(WARM, Math.max(0, force) / 300);
  return result.copy(WARM).lerp(HOT, Math.min(1, (force - 300) / 900));
}
function disposeObject(object) {
  const geometries = new Set(),
    materials = new Set();
  object.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    for (const material of Array.isArray(node.material)
      ? node.material
      : [node.material])
      if (material) materials.add(material);
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}
function equipmentMesh(geometry = {}) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({
    color: "#697573",
    metalness: 0.55,
    roughness: 0.4,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: "#293e3e",
    roughness: 0.8,
  });
  const length = geometry.shaftLengthM ?? 0.22;
  const handleRadius = geometry.handleRadiusM ?? 0.011;
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(handleRadius, handleRadius, length, 16),
    metal,
  );
  shaft.rotation.x = Math.PI / 2;
  group.add(shaft);
  for (const direction of [-1, 1]) {
    const radius = geometry.plateRadiusM ?? 0.06;
    const thickness = geometry.plateThicknessM ?? 0.035;
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, thickness, 18),
      rubber,
    );
    plate.rotation.x = Math.PI / 2;
    plate.position.z =
      direction * (geometry.plateOffsetM ?? length / 2 - 0.025);
    group.add(plate);
  }
  return group;
}

/**
 * Native geometry is exported in the shared X-forward, Y-up, Z-right frame.
 * All muscle paths and body matrices come from the solver; this module does not
 * synthesize attachment sites, activations, forces or unmodelled anatomy.
 * Paths are displayed as teaching surfaces, not measured muscle volumes.
 */
export function createBodyView(
  container,
  {
    onSelect = () => {},
    onJointRotate = () => {},
    onCameraChange = () => {},
    onRegionChange = () => {},
    onViewChange = () => {},
    onAnatomyStatus = () => {},
    onFrameDisplayed = () => {},
    onRenderTiming = () => {},
    jointInspectorMount = null,
    coordinateLabel = (name) => name,
    geometryUrl = new URL("./geometry/fullbody-bones.json", import.meta.url),
    geometryData,
    metadata = {},
    showRegionSelector = true,
    initialSurfaceQuality = "detail",
    readOnly = false,
    progressiveSurface = false,
    maxPixelRatio = 2,
    maxRenderPixels = Infinity,
    maxSurfaceCacheBytes = 128 * 1024 * 1024,
  } = {},
) {
  const priorPosition = container.style.position;
  if (getComputedStyle(container).position === "static")
    container.style.position = "relative";
  const lightViewport = initialSurfaceQuality === "preview";
  const renderer = new THREE.WebGLRenderer({ antialias: !lightViewport, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, maxPixelRatio, lightViewport ? 1 : 2));
  renderer.setClearColor("#eef3f5");
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.style.cssText =
    "display:block;width:100%;height:100%;touch-action:none";
  renderer.domElement.setAttribute(
    "aria-label",
    "全身肌骨模型；选择关节，拖动圆环旋转本级关节",
  );
  container.append(renderer.domElement);
  const scene = new THREE.Scene(),
    camera = new THREE.OrthographicCamera(-1, 1, 1.1, -1.1, 0.01, 30);
  camera.position.set(3.2, 1.8, 4.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.9, 0);
  controls.enableDamping = false;
  controls.minZoom = 0.3;
  controls.maxZoom = 30;
  controls.minPolarAngle = 0.08;
  controls.maxPolarAngle = Math.PI - 0.08;
  controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x68746e, 2.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.7);
  key.position.set(2, 5, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xe5eef2, 1.4);
  fill.position.set(-3, 3, -3);
  scene.add(fill);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 5),
    new THREE.MeshStandardMaterial({ color: "#f1f4ef", roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.visible = false;
  scene.add(floor);
  const grid = new THREE.GridHelper(3, 15, "#d0dcd3", "#e2e9e2");
  grid.position.y = 0.001;
  grid.visible = false;
  scene.add(grid);
  const boneRoot = new THREE.Group(),
    accessoryRoot = new THREE.Group();
  scene.add(boneRoot, accessoryRoot);
  const bodyGroups = new Map(),
    handleMeta = new Map(),
    muscleMeta = new Map(),
    labels = new Map();
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:2";
  container.append(overlay);
  const dragTarget = document.createElement("div");
  dragTarget.setAttribute("aria-hidden", "true");
  dragTarget.style.cssText =
    "position:absolute;transform:translate(-50%,-50%);width:24px;height:24px;border:2px dashed #297fbc;border-radius:50%;background:#e9f5ff66;pointer-events:none;z-index:4";
  dragTarget.hidden = true;
  overlay.append(dragTarget);
  const jointCard = document.createElement("div");
  jointCard.dataset.testid = "joint-rotation-card";
  jointCard.style.cssText =
    "position:absolute;left:10px;top:50px;width:280px;max-width:calc(100% - 20px);box-sizing:border-box;padding:9px 28px 9px 11px;background:#fffffff5;border:1px solid #bdd4c9;border-radius:8px;color:#274c40;pointer-events:auto;font:12px/1.5 system-ui;box-shadow:0 2px 8px #243a2612";
  jointCard.hidden = true;
  const jointTitle = document.createElement("strong"),
    jointDetail = document.createElement("div"),
    jointHelp = document.createElement("button"),
    jointWarning = document.createElement("div"),
    alignJoint = document.createElement("button"),
    closeJoint = document.createElement("button");
  jointTitle.style.cssText = "display:block;font-size:13px";
  const jointHeading = document.createElement("div");
  jointHeading.style.cssText = "display:flex;align-items:center;gap:8px";
  const helpPrefix = container.id || "body-view";
  jointDetail.id = `${helpPrefix}-joint-detail`;
  jointDetail.hidden = true;
  jointWarning.dataset.testid = "joint-rotation-warning";
  jointWarning.style.cssText = "color:#97612e;margin-top:5px";
  jointWarning.setAttribute("role", "status");
  jointWarning.hidden = true;
  jointHelp.type = "button";
  jointHelp.className = "help-button";
  jointHelp.textContent = "?";
  jointHelp.setAttribute("aria-label", "关节旋转说明");
  jointHelp.dataset.helpSource = `${jointDetail.id} ${helpPrefix}-joint-axis-help`;
  jointHeading.append(jointTitle, jointHelp);
  alignJoint.type = "button";
  alignJoint.textContent = "对准旋转面";
  alignJoint.style.cssText =
    "margin-top:5px;border:1px solid #c4d7cc;border-radius:4px;background:#f5faf6;padding:3px 7px;color:#285b48;font:12px system-ui;cursor:pointer";
  closeJoint.type = "button";
  closeJoint.textContent = "×";
  closeJoint.setAttribute("aria-label", "取消关节选择");
  closeJoint.style.cssText =
    "position:absolute;right:4px;top:4px;border:0;background:transparent;padding:2px 6px;color:#526d60;cursor:pointer";
  const jointAxis = document.createElement("div");
  jointAxis.setAttribute("role", "group");
  jointAxis.setAttribute("aria-label", "本级可用旋转轴");
  jointAxis.dataset.testid = "joint-axis-list";
  jointAxis.style.cssText =
    "display:grid;gap:5px;width:100%;margin:8px 0;font:11px system-ui";
  const axisNotice = document.createElement("div");
  axisNotice.dataset.testid = "joint-axis-notice";
  axisNotice.style.cssText =
    "color:#66786f;font:11px/1.5 system-ui;margin:5px 0";
  axisNotice.hidden = true;
  const axisHelp = document.createElement("div");
  axisHelp.id = `${helpPrefix}-joint-axis-help`;
  axisHelp.hidden = true;
  const relatedControls = document.createElement("div");
  relatedControls.dataset.testid = "related-joint-controls";
  relatedControls.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;margin-top:5px";
  const couplingLabel = document.createElement("label");
  couplingLabel.style.cssText =
    "display:flex;align-items:center;gap:5px;margin-top:6px;font:11px/1.5 system-ui";
  const couplingToggle = document.createElement("input");
  couplingToggle.type = "checkbox";
  couplingToggle.checked = true;
  couplingToggle.dataset.testid = "source-joint-coupling";
  couplingToggle.title =
    "按所选三维轴旋转，画面前后位移由该轴与固定联动决定；上级独立关节仍锁定。";
  couplingLabel.append(
    couplingToggle,
    document.createTextNode("保留关节联动"),
  );
  jointCard.append(
    jointHeading,
    jointDetail,
    jointWarning,
    jointAxis,
    axisNotice,
    axisHelp,
    relatedControls,
    alignJoint,
    couplingLabel,
    closeJoint,
  );
  if (jointInspectorMount) {
    jointCard.style.cssText = "position:relative;width:100%;box-sizing:border-box;color:inherit;pointer-events:auto;font:12px/1.5 system-ui";
    jointInspectorMount.append(jointCard);
  } else overlay.append(jointCard);
  const rotationGizmo = document.createElement("div");
  rotationGizmo.dataset.testid = "joint-rotation-gizmo";
  rotationGizmo.style.cssText =
    "position:absolute;width:220px;height:220px;transform:translate(-50%,-50%);pointer-events:none;z-index:3";
  rotationGizmo.hidden = true;
  const svgNS = "http://www.w3.org/2000/svg";
  const rotationSvg = document.createElementNS(svgNS, "svg");
  rotationSvg.setAttribute("viewBox", "0 0 220 220");
  rotationSvg.style.cssText = "width:100%;height:100%;overflow:visible";
  const rotationRing = document.createElementNS(svgNS, "circle"),
    rotationHit = document.createElementNS(svgNS, "circle");
  for (const circle of [rotationRing, rotationHit]) {
    circle.setAttribute("cx", String(GIZMO_CENTER));
    circle.setAttribute("cy", String(GIZMO_CENTER));
    circle.setAttribute("r", "68");
    circle.setAttribute("fill", "none");
  }
  rotationRing.setAttribute("stroke", "#237e65");
  rotationRing.setAttribute("stroke-width", "2");
  rotationRing.setAttribute("stroke-dasharray", "4 3");
  rotationHit.setAttribute("stroke", "transparent");
  rotationHit.setAttribute("stroke-width", "18");
  rotationHit.style.cssText =
    "pointer-events:stroke;cursor:grab;touch-action:none";
  rotationHit.dataset.testid = "joint-rotation-ring";
  rotationSvg.append(rotationRing, rotationHit);
  const rotationKnob = document.createElement("button");
  rotationKnob.type = "button";
  rotationKnob.setAttribute("aria-label", "旋转所选关节；方向键每次1度");
  rotationKnob.dataset.testid = "joint-rotation-handle";
  rotationKnob.textContent = "↻";
  rotationKnob.style.cssText =
    "position:absolute;left:178px;top:110px;width:30px;height:30px;padding:0;transform:translate(-50%,-50%);border:2px solid #237e65;border-radius:50%;background:#fffef4;color:#23634e;pointer-events:auto;cursor:grab;touch-action:none;font:21px/1 system-ui;box-shadow:0 1px 5px #203a3526";
  const rotationAngle = document.createElement("span");
  rotationAngle.style.cssText =
    "position:absolute;left:50%;top:212px;transform:translateX(-50%);background:#fffffff0;border-radius:4px;padding:2px 6px;white-space:nowrap;color:#285b48;font:11px/1.4 system-ui";
  rotationAngle.textContent = "";
  rotationGizmo.append(rotationSvg, rotationKnob, rotationAngle);
  overlay.append(rotationGizmo);
  const regionSelect = document.createElement("select");
  regionSelect.setAttribute("aria-label", "放大编辑身体区域");
  regionSelect.style.cssText =
    "position:absolute;top:10px;left:10px;pointer-events:auto;padding:6px 9px;border:1px solid #cad9cf;border-radius:6px;background:#fffffff2;color:#365b4d;font:12px system-ui;max-width:48%";
  regionSelect.hidden = !showRegionSelector;
  overlay.append(regionSelect);
  const muscleCard = document.createElement("div");
  muscleCard.dataset.testid = "muscle-name-card";
  muscleCard.setAttribute("role", "status");
  muscleCard.setAttribute("aria-live", "polite");
  muscleCard.style.cssText =
    "position:absolute;right:10px;top:10px;max-width:48%;padding:10px 34px 10px 12px;background:#fffffff5;border:1px solid #c9d8cf;border-radius:8px;box-shadow:0 2px 10px #243a2614;color:#284a43;pointer-events:auto;overflow-wrap:anywhere";
  muscleCard.hidden = true;
  const muscleTitle = document.createElement("strong");
  muscleTitle.style.cssText = "display:block;font:600 13px/1.5 system-ui";
  const muscleDetail = document.createElement("div");
  muscleDetail.style.cssText =
    "margin-top:3px;font:11px/1.5 system-ui;color:#617469";
  const closeMuscle = document.createElement("button");
  closeMuscle.type = "button";
  closeMuscle.textContent = "×";
  closeMuscle.setAttribute("aria-label", "关闭肌肉名称");
  closeMuscle.style.cssText =
    "position:absolute;right:4px;top:4px;border:0;background:transparent;padding:3px 7px;color:#526d60;cursor:pointer";
  muscleCard.append(muscleTitle, muscleDetail, closeMuscle);
  overlay.append(muscleCard);
  const groundLabel = document.createElement("div");
  groundLabel.textContent = "地面 · 高度 0 m";
  groundLabel.style.cssText =
    "position:absolute;right:10px;bottom:8px;padding:5px 8px;background:#f7faf4e8;color:#5d7167;font:11px/1.5 system-ui;border-radius:6px";
  groundLabel.hidden = true;
  overlay.append(groundLabel);

  let latest = null,
    disposed = false,
    pendingCompilation = null,
    readyGeometry = false,
    editing = !readOnly,
    handlesVisible = !readOnly;
  let renderFrame = 0, lastRenderedFrame = null, lastRenderedRefined = false;
  let gpuFence = null, fenceTimer = 0, renderRequested = false;
  let lastRenderTiming = { cpuMs: 0, elapsedMs: 0, busy: false, stalled: false };
  let previewing = false, onlyPaths = false, frameEpoch = 0;
  let surfaceQuality = initialSurfaceQuality, requestedQuality = initialSurfaceQuality, surfaceGeneration = 0;
  let surfaceRequest = null, surfaceLoadError = null, playbackActive = false;
  const renderWaiters = [];
  const preparationQueue = createSerialPreparationQueue();
  const frameQueue = createLatestFrameQueue(
    frame => preparationQueue.run(() => anatomicalMuscles?.prepareFrame(frame)),
    (frame, prepared) => applyFrame(frame, prepared),
    error => onAnatomyStatus({ error: true, message: `肌肉动画计算失败：${error.message}；保留上一完整画面。` }),
  );
  let musclesVisible = true,
    muscleDisplay = "anatomy",
    anatomicalMuscles = null,
    transitionPreview = null,
    hasAnatomicalFrame = false,
    bonesVisible = true,
    view = "perspective",
    region = "all",
    selectedMuscle = null;
  let drag = null,
    selectedJoint = null,
    selectedAxis = null,
    rotationPending = false,
    gearKey = "",
    canvasPress = null,
    fitted = false;
  let axisControls = [],
    axisProjections = [],
    pendingStep = null;
  let muscleNames = [],
    muscleGeometry = null,
    muscleMesh = null,
    restLengths = new Map();
  let lastPathFrame = null;
  let branchGeometry = null, branchLines = null, branchRanges = [];
  let muscleBounds = [],
    muscleShapes = [],
    projectedJoints = null;
  const labelStates = new WeakMap();
  let pointer = null,
    focusedHandle = null,
    hoverFrame = 0;
  const occlusionCache = new Map();
  let lastHandleMetadata = null;
  let lastHandleSignature = "";
  let explicitHandles = null;
  let allMuscleIndices = null,
    displayedMuscleSlots = [];
  const raycaster = new THREE.Raycaster(),
    mouse = new THREE.Vector2(),
    plane = new THREE.Plane();
  const point = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    binormal = new THREE.Vector3(),
    tangent = new THREE.Vector3();
  const previous = new THREE.Vector3(),
    next = new THREE.Vector3(),
    radial = new THREE.Vector3(),
    color = new THREE.Color();
  const projected = new THREE.Vector3(),
    hitPoint = new THREE.Vector3();
  const ringCos = Array.from({ length: RADIAL + 1 }, (_, j) =>
    Math.cos((j / RADIAL) * Math.PI * 2),
  );
  const ringSin = Array.from({ length: RADIAL + 1 }, (_, j) =>
    Math.sin((j / RADIAL) * Math.PI * 2),
  );
  const sampled = Array.from(
    { length: SEGMENTS + 1 },
    () => new THREE.Vector3(),
  );

  function metaFor(name) {
    return (
      handleMeta.get(name) || {
        name,
        label: HANDLE_LABELS[name] || name,
        region: regionOf(name),
        side: sideOf(name),
        overview:
          !/finger|thumb|index|middle|ring|little|pinky|mcp|pip|dip/i.test(
            name,
          ),
      }
    );
  }
  function jointPosition(name) {
    return positionOf(latest?.joints?.[name]);
  }
  function availableRegions() {
    const result = new Map([["all", "全身"]]);
    for (const [name, record] of [...handleMeta, ...muscleMeta]) {
      const key = regionOf(name, record);
      if (key === "other") continue;
      result.set(key, record.regionLabel || REGION_LABELS[key] || key);
    }
    return [...result].map(([id, label]) => ({ id, label }));
  }
  function updateRegionOptions() {
    regionSelect.replaceChildren();
    for (const item of availableRegions()) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.label;
      regionSelect.append(option);
    }
    if (![...regionSelect.options].some((o) => o.value === region))
      region = "all";
    regionSelect.value = region;
  }
  function setMetadata(data = {}) {
    invalidatePicking();
    for (const body of data.bodyMetadata || [])
      if (body?.name) handleMeta.set(body.name, { ...metaFor(body.name), ...body });
    if (Array.isArray(data.handles) && data.handles.length) {
      explicitHandles = new Set(data.handles.map((handle) => handle.name));
      for (const [name, button] of labels) {
        if (explicitHandles.has(name)) continue;
        button.remove();
        labels.delete(name);
      }
    }
    for (const handle of data.handles || [])
      if (handle?.name) {
        handleMeta.set(handle.name, { ...metaFor(handle.name), ...handle });
        const button = labels.get(handle.name);
        if (button) {
          const label =
            handle.label || HANDLE_LABELS[handle.name] || handle.name;
          button.lastElementChild.textContent = label;
          button.setAttribute("aria-label", `选择${label}，旋转本级关节`);
          button.title = `${label} · 点击选择，再拖圆环旋转`;
          if (handle.editable === false) {
            button.remove();
            labels.delete(handle.name);
          }
        }
      }
    for (const muscle of data.muscles || [])
      if (muscle?.name) {
        muscleMeta.set(muscle.name, { ...muscle });
        if (Number.isFinite(muscle.restLength) && muscle.restLength > 0)
          restLengths.set(muscle.name, muscle.restLength);
      }
    updateRegionOptions();
    updateRegionVisibility();
    if (latest) {
      for (const name of Object.keys(latest.joints || {})) addHandle(name);
      labelPosition();
    }
  }
  function projectJoints() {
    if (projectedJoints) return projectedJoints;
    const rect = container.getBoundingClientRect(),
      result = {};
    camera.updateMatrixWorld();
    for (const [name, value] of Object.entries(latest?.joints || {})) {
      const world = positionOf(value);
      if (!world) continue;
      projected.fromArray(world).project(camera);
      const meta = metaFor(name),
        side = sideOf(name, meta);
      const far =
        (view === "right" && side === "l") || (view === "left" && side === "r");
      const inView =
        Math.abs(projected.x) < 1 &&
        Math.abs(projected.y) < 1 &&
        Math.abs(projected.z) < 1;
      const inRegion = groupMatches(region, name, meta);
      const overview = region !== "all" || meta.overview !== false;
      result[name] = {
        x: ((projected.x + 1) * rect.width) / 2,
        y: ((1 - projected.y) * rect.height) / 2,
        world: [...world],
        depth: projected.z,
        visible: inView && !far && inRegion,
        interactiveVisible:
          inView &&
          !far &&
          inRegion &&
          overview &&
          (!explicitHandles || explicitHandles.has(name)),
      };
    }
    projectedJoints = result;
    return result;
  }
  function invalidatePicking() {
    projectedJoints = null;
    occlusionCache.clear();
  }
  function labelPosition() {
    if (playbackActive) return;
    const positions = projectJoints();
    const nearby = new Set();
    const labelOffsets = new Map();
    if (pointer && !canvasPress) {
      const candidates = Object.entries(positions)
        .filter(([name, value]) => {
          if (!value.interactiveVisible || !labels.has(name)) return false;
          return (
            name === pointer.overHandle ||
            Math.hypot(value.x - pointer.x, value.y - pointer.y) <= 52
          );
        })
        .sort(([aName, a], [bName, b]) => {
          if (Math.hypot(a.x - b.x, a.y - b.y) < 24) {
            const priority =
              Number(metaFor(aName).overview === false) -
              Number(metaFor(bName).overview === false);
            if (priority) return priority;
          }
          if (aName === pointer.overHandle) return -1;
          if (bName === pointer.overHandle) return 1;
          return (
            Math.hypot(a.x - pointer.x, a.y - pointer.y) -
            Math.hypot(b.x - pointer.x, b.y - pointer.y)
          );
        });
      for (const [name, value] of candidates) {
        if (nearby.size >= 3) break;
        if (handleIsExposed(name, value)) nearby.add(name);
      }
    }
    const positionedLabels = [];
    for (const name of new Set([selectedJoint, focusedHandle, ...nearby])) {
      const value = positions[name];
      if (!value) continue;
      const side = sideOf(name, metaFor(name));
      let y = value.y;
      while (
        positionedLabels.some(
          (p) =>
            p.side === side &&
            Math.abs(p.x - value.x) < 90 &&
            Math.abs(p.y - y) < 21,
        )
      )
        y += 22;
      labelOffsets.set(name, 5 + y - value.y);
      positionedLabels.push({ x: value.x, y, side });
    }
    for (const [name, button] of labels) {
      const value = positions[name];
      const state = labelStates.get(button) || {};
      const hidden = !handlesVisible || !value?.interactiveVisible;
      if (state.hidden !== hidden) button.hidden = hidden;
      state.hidden = hidden;
      if (!value) continue;
      const shown =
        nearby.has(name) || selectedJoint === name || focusedHandle === name;
      if (state.x !== value.x) button.style.left = `${value.x}px`;
      if (state.y !== value.y) button.style.top = `${value.y}px`;
      const opacity = shown ? (editing ? "1" : ".5") : "0";
      const events = shown && editing ? "auto" : "none";
      const zIndex =
        selectedJoint === name ? 4 : metaFor(name).overview === false ? 1 : 2;
      const captionTop = labelOffsets.get(name) ?? 5;
      if (state.zIndex !== zIndex) button.style.zIndex = String(zIndex);
      if (state.captionTop !== captionTop)
        button.lastElementChild.style.top = `${captionTop}px`;
      if (state.opacity !== opacity) button.style.opacity = opacity;
      if (state.events !== events) {
        button.style.pointerEvents = events;
        button.lastElementChild.style.pointerEvents = events;
      }
      if (state.editing !== editing) button.disabled = !editing;
      Object.assign(state, {
        x: value.x,
        y: value.y,
        opacity,
        events,
        editing,
        zIndex,
        captionTop,
      });
      labelStates.set(button, state);
    }
    positionRotationGizmo(positions);
  }
  function visibleBoneMeshes() {
    if (!boneRoot.visible) return [];
    return [...bodyGroups.values()]
      .filter((group) => group.visible)
      .flatMap((group) => group.children);
  }
  function surfaceHits() {
    const objects = visibleBoneMeshes();
    if (muscleMesh?.visible)
      objects.push(muscleMesh);
    if (musclesVisible && muscleDisplay === "anatomy" && anatomicalMuscles?.object.visible)
      objects.push(anatomicalMuscles.object);
    return raycaster.intersectObjects(objects, false);
  }
  function handleIsExposed(name, position) {
    if (occlusionCache.has(name)) return occlusionCache.get(name);
    const rect = container.getBoundingClientRect();
    rayAt(rect.left + position.x, rect.top + position.y);
    scene.updateMatrixWorld(true);
    const distance = new THREE.Vector3()
      .fromArray(position.world)
      .sub(raycaster.ray.origin)
      .dot(raycaster.ray.direction);
    const hit = surfaceHits()[0];
    const anatomicalHit =
      hit?.object === anatomicalMuscles?.object
        ? anatomicalMuscles.resolveHit(hit)
        : null;
    const handle = metaFor(name);
    const ownBone = hit?.object.userData.body === (handle.body || name);
    const targetRegion = regionOf(name, handle);
    const hitName =
      hit?.object === muscleMesh
        ? muscleNames[
            displayedMuscleSlots[Math.floor(hit.faceIndex / TRIANGLES)]
          ]
        : anatomicalHit?.name || hit?.object.userData.body;
    const hitRecord =
      hit?.object === muscleMesh
        ? muscleMeta.get(hitName) || {}
        : anatomicalHit || metaFor(hitName || "");
    const hitRegion = hitName ? regionOf(hitName, hitRecord) : "";
    const sameLimb =
      /^(arm|hand|leg|foot)_[rl]$/.test(targetRegion) &&
      hitRegion.replace("hand_", "arm_").replace("foot_", "leg_") ===
        targetRegion.replace("hand_", "arm_").replace("foot_", "leg_");
    const hipInPelvis =
      /^(hip|femur)_[rl]$/.test(name) && hit?.object.userData.body === "pelvis";
    // A joint point lies inside its own bone; thin overlying teaching muscle
    // surfaces should not hide it. Another limb or the torso in front does.
    const allowance = hipInPelvis
      ? 0.12
      : sameLimb
        ? 0.075
        : /^(hand|foot)/.test(targetRegion)
          ? 0.012
          : 0.045;
    const exposed = !hit || ownBone || distance - hit.distance <= allowance;
    occlusionCache.set(name, exposed);
    return exposed;
  }
  function render() {
    if (disposed) return;
    renderRequested = true;
    // WebGL submission is asynchronous. Keeping just one submitted frame in
    // flight prevents a slow GPU from accumulating a long, unpausable queue.
    if (renderFrame || gpuFence) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      if (disposed) return;
      renderRequested = false;
      const started = performance.now();
      const gl = renderer.getContext();
      const renderedFrame = latest;
      const renderedRefined = hasAnatomicalFrame && !previewing && !onlyPaths;
      let cpuMs = 0, stalledReported = false;
      const finish = (completed) => {
        if (gpuFence) gl.deleteSync(gpuFence);
        gpuFence = null;
        fenceTimer = 0;
        lastRenderTiming = { cpuMs, elapsedMs: performance.now() - started, busy: false, stalled: !completed };
        try {
          onRenderTiming(lastRenderTiming);
          // Use the submitted frame, not latest: editing can request another
          // pose while this GPU frame is still completing.
          if (completed && renderedFrame &&
              (renderedFrame !== lastRenderedFrame || renderedRefined !== lastRenderedRefined)) {
            lastRenderedFrame = renderedFrame;
            lastRenderedRefined = renderedRefined;
            onFrameDisplayed(renderedFrame, { refined: renderedRefined });
          }
          if (!completed)
            onAnatomyStatus({ error: true, message: "模型画面未能完成绘制，播放已暂停；请重新加载页面。" });
        } finally {
          if (renderRequested) render();
          if (!renderFrame && !gpuFence && !renderRequested)
            for (const resolve of renderWaiters.splice(0)) resolve();
        }
      };
      const poll = () => {
        if (disposed || !gpuFence) return;
        // A zero timeout is essential: never block the UI waiting for the GPU.
        const state = gl.clientWaitSync(gpuFence, 0, 0);
        if (state !== gl.TIMEOUT_EXPIRED) {
          finish(state === gl.ALREADY_SIGNALED || state === gl.CONDITION_SATISFIED);
          return;
        }
        const elapsedMs = performance.now() - started;
        if (elapsedMs >= 1000 && !stalledReported) {
          stalledReported = true;
          lastRenderTiming = { cpuMs, elapsedMs, busy: true, stalled: true };
          onRenderTiming(lastRenderTiming);
        }
        fenceTimer = setTimeout(poll, 12);
      };
      try {
        labelPosition();
        renderer.render(scene, camera);
        cpuMs = performance.now() - started;
        gpuFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (gpuFence) {
          gl.flush();
          lastRenderTiming = { cpuMs, elapsedMs: cpuMs, busy: true, stalled: false };
          fenceTimer = setTimeout(poll, 12);
        }
      } finally {
        if (!gpuFence) finish(false);
      }
    });
  }
  function resize() {
    invalidatePicking();
    const width = Math.max(1, container.clientWidth),
      height = Math.max(1, container.clientHeight);
    const ratio = Math.min(devicePixelRatio || 1, maxPixelRatio,
      lightViewport ? 1 : 2, Math.sqrt(maxRenderPixels / (width * height)));
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    const half = 1.06;
    camera.left = (-half * width) / height;
    camera.right = (half * width) / height;
    camera.top = half;
    camera.bottom = -half;
    camera.updateProjectionMatrix();
    if (fitted && !drag) fit();
    else render();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  controls.addEventListener("change", () => {
    invalidatePicking();
    render();
    onCameraChange(projectJoints());
  });
  function rayAt(x, y) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.set(
      ((x - rect.left) * 2) / rect.width - 1,
      1 - ((y - rect.top) * 2) / rect.height,
    );
    raycaster.setFromCamera(mouse, camera);
  }
  function getWorldPoint(x, y, joint = "pelvis") {
    const origin = Array.isArray(joint)
      ? joint
      : jointPosition(joint) || [0, 0.9, 0];
    rayAt(x, y);
    plane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()),
      new THREE.Vector3().fromArray(origin),
    );
    const hit = raycaster.ray.intersectPlane(plane, hitPoint);
    return hit ? hit.toArray() : null;
  }
  function positionRotationGizmo(positions) {
    const position = selectedJoint && positions[selectedJoint];
    const visible = editing && handlesVisible && position?.visible;
    jointCard.hidden = !selectedJoint || !editing;
    rotationGizmo.hidden = !visible;
    if (!visible) return;
    rotationGizmo.style.left = `${drag?.pivotX ?? position.x}px`;
    rotationGizmo.style.top = `${drag?.pivotY ?? position.y}px`;
    const supported = metaFor(selectedJoint).rotationSupported !== false;
    const sourceMode = couplingToggle.checked;
    rotationRing.style.display = sourceMode ? "none" : "";
    rotationHit.style.display = sourceMode ? "none" : "";
    rotationKnob.style.display = !sourceMode && supported ? "block" : "none";
    rotationKnob.disabled =
      !supported ||
      (rotationPending &&
        drag?.element !== rotationKnob &&
        !canStep(selectedAxis ?? 0));
    rotationHit.style.pointerEvents =
      !sourceMode &&
      supported &&
      (!rotationPending || drag?.element === rotationHit)
        ? "stroke"
        : "none";
    const axes = latest?.jointRotations?.[selectedJoint]?.axes || [];
    alignJoint.disabled =
      !supported || !axes.length || rotationPending || Boolean(drag);
    couplingToggle.disabled = rotationPending || Boolean(drag);
    axisProjections =
      drag?.projections || axes.map((axis, index) => projectAxis(axis, index));
    axisControls.forEach((control, index) => {
      const active = index === selectedAxis;
      const limit =
        latest?.jointRotations?.[selectedJoint]?.limits?.[control.coordinate];
      const locked = sourceMode && limit && limit.max - limit.min < 1e-6;
      const angle = latest?.q?.[control.coordinate];
      control.choose.setAttribute("aria-pressed", String(active));
      control.choose.style.background = active ? `${control.color}16` : "#fff";
      control.choose.style.borderColor = active ? control.color : "#d6e1db";
      control.choose.disabled =
        (rotationPending || Boolean(drag)) && !canStep(index);
      control.minus.disabled =
        !canStep(index) || (sourceMode && limit && angle <= limit.min + 1e-6);
      control.plus.disabled =
        !canStep(index) || (sourceMode && limit && angle >= limit.max - 1e-6);
      control.value.textContent = Number.isFinite(angle)
        ? `${angle.toFixed(1)}°${locked ? " · 锁定" : ""}`
        : "—";
      control.group.style.display = sourceMode ? "" : "none";
      control.knob.style.display = sourceMode ? "block" : "none";
      control.knob.disabled =
        locked ||
        (rotationPending && drag?.element !== control.knob && !canStep(index));
      const projection = axisProjections[index];
      if (!projection) return;
      const paths = ringPaths(projection);
      for (const [element, d] of [
        [control.front, paths.front],
        [control.back, paths.back],
        [control.hit, paths.all],
      ])
        if (element.getAttribute("d") !== d) element.setAttribute("d", d);
      control.front.setAttribute("stroke-width", active ? "3" : "1.8");
      control.back.setAttribute("stroke-width", active ? "2" : "1.5");
      control.group.style.opacity = active ? "1" : ".75";
      control.hit.style.pointerEvents =
        !locked &&
        !projection.edgeOn &&
        (!rotationPending || drag?.element === control.hit)
          ? "stroke"
          : "none";
      const theta =
        drag?.axisIndex === index && drag.mode === "source-joint"
          ? drag.knobAngle + THREE.MathUtils.degToRad(drag.angleDelta)
          : projection.knobAngle;
      const point = ringPoint(projection, theta);
      control.knob.style.left = `${GIZMO_CENTER + point[0]}px`;
      control.knob.style.top = `${GIZMO_CENTER + point[1]}px`;
      control.knob.textContent = projection.edgeOn ? "↔" : String(index + 1);
      const tangent = ringTangent(projection, projection.knobAngle);
      control.knob.style.transform = `translate(-50%,-50%)${projection.edgeOn ? ` rotate(${Math.atan2(tangent[1], tangent[0])}rad)` : ""}`;
      control.knob.title = locked
        ? "伸直时额外内外旋锁定；先屈膝，再调旋转。"
        : projection.edgeOn
          ? `${coordinateLabel(control.coordinate)}：沿箭头方向直线拖动，或用 ±1°`
          : `${coordinateLabel(control.coordinate)}：沿本色圆环拖动`;
    });
    updateAxisNotice(axes);
  }
  function canStep(index) {
    const coordinate =
      latest?.jointRotations?.[selectedJoint]?.coordinates?.[index];
    return (
      editing &&
      !drag &&
      Boolean(coordinate) &&
      (!rotationPending ||
        (pendingStep?.joint === selectedJoint &&
          pendingStep?.coordinate === coordinate))
    );
  }
  function projectAxis(value, index) {
    const axis = new THREE.Vector3().fromArray(value).normalize();
    const reference =
      Math.abs(axis.dot(Y)) > 0.92 ? new THREE.Vector3(1, 0, 0) : Y;
    const u = new THREE.Vector3().crossVectors(reference, axis).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u).normalize();
    const right = new THREE.Vector3().setFromMatrixColumn(
      camera.matrixWorld,
      0,
    );
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const radius = 56 + index * 18;
    const projection = {
      axis: axis.toArray(),
      u: [u.dot(right) * radius, -u.dot(up) * radius],
      v: [v.dot(right) * radius, -v.dot(up) * radius],
      depthU: u.dot(forward),
      depthV: v.dot(forward),
      edgeOn: Math.abs(axis.dot(forward)) < 0.18,
    };
    projection.knobAngle = [
      Math.PI / 4,
      -Math.PI / 4,
      Math.PI / 8,
      (3 * Math.PI) / 8,
    ].reduce((best, angle) => {
      const quality = (theta) => {
        const point = ringPoint(projection, theta),
          tangent = ringTangent(projection, theta);
        return Math.hypot(...point) * Math.hypot(...tangent);
      };
      return quality(angle) > quality(best) ? angle : best;
    });
    return projection;
  }
  function ringPoint(projection, angle) {
    const cosine = Math.cos(angle),
      sine = Math.sin(angle);
    return [
      projection.u[0] * cosine + projection.v[0] * sine,
      projection.u[1] * cosine + projection.v[1] * sine,
    ];
  }
  function ringTangent(projection, angle) {
    return [
      -projection.u[0] * Math.sin(angle) + projection.v[0] * Math.cos(angle),
      -projection.u[1] * Math.sin(angle) + projection.v[1] * Math.cos(angle),
    ];
  }
  function ringPaths(projection) {
    const paths = { front: "", back: "", all: "" };
    let previousPart;
    const pointText = (point) =>
      `${(GIZMO_CENTER + point[0]).toFixed(2)},${(GIZMO_CENTER + point[1]).toFixed(2)}`;
    for (let n = 0; n < 96; n++) {
      const from = (n * Math.PI) / 48,
        to = ((n + 1) * Math.PI) / 48,
        middle = (from + to) / 2;
      const a = pointText(ringPoint(projection, from)),
        b = pointText(ringPoint(projection, to));
      const part =
        projection.depthU * Math.cos(middle) +
          projection.depthV * Math.sin(middle) >
        0
          ? "back"
          : "front";
      paths[part] += `${previousPart === part ? "" : `M${a}`}L${b}`;
      paths.all += `${n === 0 ? `M${a}` : ""}L${b}`;
      previousPart = part;
    }
    return paths;
  }
  function projectionAngle(projection, x, y) {
    const [ux, uy] = projection.u,
      [vx, vy] = projection.v;
    const determinant = ux * vy - uy * vx;
    return Math.atan2(
      (ux * y - uy * x) / determinant,
      (x * vy - y * vx) / determinant,
    );
  }
  function updateAxisNotice(axes) {
    if (!axes.length) {
      axisNotice.textContent = "无可用旋转轴，请选择相邻关节。";
      axisNotice.hidden = false;
      axisHelp.textContent = "该骨段没有独立旋转轴，请选择相邻可动关节。";
      return;
    }
    const shoulderDown =
      /humerus/.test(selectedJoint || "") &&
      Math.abs(
        latest?.q?.[
          `shoulder_elv_${selectedJoint.endsWith("_l") ? "l" : "r"}`
        ] || 0,
      ) < 2;
    const overlap = axes.some((axis, i) =>
      axes
        .slice(i + 1)
        .some(
          (other) =>
            Math.abs(
              new THREE.Vector3()
                .fromArray(axis)
                .normalize()
                .dot(new THREE.Vector3().fromArray(other).normalize()),
            ) > 0.995,
        ),
    );
    const messages = [];
    if (metaFor(selectedJoint || "").controlNote)
      messages.push(metaFor(selectedJoint).controlNote);
    if (!couplingToggle.checked)
      messages.push("当前按视角平面操作。勾选下方选项可直接拖不同关节轴的环。");
    else {
      messages.push(
        axes.length > 1
          ? `本关节有 ${axes.length} 个可调方向，颜色与编号对应旋转环。`
          : "当前关节提供一个独立旋转方向，其余运动遵循固定联动。",
      );
      if (axisProjections[selectedAxis]?.edgeOn)
        messages.push("所选环接近侧向：沿 ↔ 把手直线拖动，或使用 ±1°。");
      if (shoulderDown)
        messages.push(
          "抬举方向决定接下来向哪里抬臂；手臂下垂时方向轴可能与内外旋重合。",
        );
      else if (overlap)
        messages.push("当前姿势有轴重合，不同半径的环仍对应各自方向。");
    }
    const kneeCoordinate = selectedJoint?.startsWith("tibia_")
      ? `knee_rotation_${selectedJoint.endsWith("_l") ? "l" : "r"}`
      : null;
    const kneeLimit =
      latest?.jointRotations?.[selectedJoint]?.limits?.[kneeCoordinate];
    if (kneeLimit) {
      messages.push(
        `屈膝 ${kneeLimit.flexion.toFixed(1)}°：当前可额外内旋 ${kneeLimit.max.toFixed(1)}°、外旋 ${Math.abs(kneeLimit.min).toFixed(1)}°。正值内旋，负值外旋；伸膝时范围收紧，需先减小旋转。这是教学保护范围。`,
      );
    }
    axisHelp.textContent = messages.join(" ");
    const notices = [];
    if (kneeLimit) {
      notices.push(kneeLimit.max - kneeLimit.min < 1e-6
        ? "内外旋已锁定，需先屈膝。"
        : `内旋 ≤${kneeLimit.max.toFixed(1)}° · 外旋 ≤${Math.abs(kneeLimit.min).toFixed(1)}°`);
    }
    if (couplingToggle.checked && axisProjections[selectedAxis]?.edgeOn)
      notices.push("旋转环近侧向，可用 ↔ 或 ±。");
    if (couplingToggle.checked && shoulderDown)
      notices.push("垂臂时旋转轴重合，可先抬臂。");
    else if (couplingToggle.checked && overlap)
      notices.push("当前旋转轴重合。");
    axisNotice.textContent = notices.join(" ");
    axisNotice.hidden = !notices.length;
  }
  function chooseAxis(index) {
    if (rotationPending || drag || !axisControls[index]) return;
    selectedAxis = index;
    rotationAngle.textContent = coordinateLabel(axisControls[index].coordinate);
    labelPosition();
  }
  function buildAxisControls(coordinates) {
    for (const control of axisControls) {
      control.group.remove();
      control.knob.remove();
    }
    axisControls = [];
    jointAxis.replaceChildren();
    coordinates.forEach((coordinate, index) => {
      const color = AXIS_COLORS[index % AXIS_COLORS.length];
      const row = document.createElement("div");
      row.style.cssText =
        "display:grid;grid-template-columns:minmax(0,1fr) 27px 27px;gap:4px;align-items:center";
      const choose = document.createElement("button"),
        minus = document.createElement("button"),
        plus = document.createElement("button");
      const name = document.createElement("span"),
        value = document.createElement("span");
      name.textContent = `${index + 1} · ${coordinateLabel(coordinate)}`;
      value.style.cssText = `color:${color};font-variant-numeric:tabular-nums;white-space:nowrap`;
      choose.type = minus.type = plus.type = "button";
      choose.dataset.axisIndex = String(index);
      choose.dataset.coordinate = coordinate;
      choose.dataset.testid = "joint-axis-choice";
      choose.setAttribute(
        "aria-label",
        `选择${coordinateLabel(coordinate)}旋转轴`,
      );
      choose.style.cssText = `display:flex;justify-content:space-between;gap:5px;align-items:center;text-align:left;padding:6px 5px;border:1px solid #d6e1db;border-left:3px solid ${color};border-radius:4px;background:#fff;color:#304d43;font:11px/1.4 system-ui;cursor:pointer`;
      choose.append(name, value);
      choose.onclick = () => chooseAxis(index);
      choose.addEventListener("keydown", (event) =>
        rotationKey(event, selectedJoint, index),
      );
      for (const [button, sign] of [
        [minus, -1],
        [plus, 1],
      ]) {
        button.textContent = sign < 0 ? "−" : "+";
        button.setAttribute(
          "aria-label",
          `${coordinateLabel(coordinate)}${sign < 0 ? "减少" : "增加"}1度`,
        );
        button.style.cssText = `height:28px;padding:0;border:1px solid ${color}66;border-radius:4px;background:#fff;color:${color};font:17px system-ui;cursor:pointer`;
        button.onclick = () => stepRotation(index, sign);
      }
      row.append(choose, minus, plus);
      jointAxis.append(row);
      const group = document.createElementNS(svgNS, "g");
      const front = document.createElementNS(svgNS, "path"),
        back = document.createElementNS(svgNS, "path"),
        hit = document.createElementNS(svgNS, "path");
      for (const element of [front, back, hit]) {
        element.setAttribute("fill", "none");
        element.setAttribute("stroke", color);
      }
      back.setAttribute("stroke-dasharray", "4 4");
      back.setAttribute("opacity", ".5");
      hit.setAttribute("stroke", "transparent");
      hit.setAttribute("stroke-width", "13");
      hit.dataset.axisIndex = String(index);
      hit.dataset.testid = "joint-axis-ring";
      hit.style.cssText = "pointer-events:stroke;cursor:grab;touch-action:none";
      group.append(back, front, hit);
      rotationSvg.append(group);
      const knob = document.createElement("button");
      knob.type = "button";
      knob.dataset.axisIndex = String(index);
      knob.dataset.testid = "joint-axis-handle";
      knob.setAttribute(
        "aria-label",
        `拖动${coordinateLabel(coordinate)}旋转环`,
      );
      knob.style.cssText = `position:absolute;width:25px;height:25px;padding:0;transform:translate(-50%,-50%);border:2px solid ${color};border-radius:50%;background:#fffef8;color:${color};pointer-events:auto;cursor:grab;touch-action:none;font:600 12px/1 system-ui;box-shadow:0 1px 5px #203a3526`;
      knob.addEventListener("keydown", (event) =>
        rotationKey(event, selectedJoint, index),
      );
      for (const element of [hit, knob]) bindRotationEvents(element);
      rotationGizmo.append(knob);
      axisControls.push({
        coordinate,
        color,
        choose,
        minus,
        plus,
        value,
        group,
        front,
        back,
        hit,
        knob,
      });
    });
  }
  function selectJoint(name) {
    if (drag) endDrag({ pointerId: drag.pointerId }, true);
    selectedJoint = name;
    selectedAxis = null;
    relatedControls.replaceChildren();
    jointWarning.hidden = true;
    jointWarning.textContent = "";
    if (name) {
      const meta = metaFor(name),
        label = meta.label || HANDLE_LABELS[name] || name;
      jointTitle.textContent = label;
      for (const related of meta.relatedControls || []) {
        if (explicitHandles && !explicitHandles.has(related.name)) continue;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = related.label;
        button.setAttribute("aria-label", `切换到${related.label}`);
        button.style.cssText = "padding:3px 6px;border:1px solid #c4d7cc;border-radius:4px;background:#fff;color:#285b48;font:11px system-ui";
        button.onclick = () => selectJoint(related.name);
        relatedControls.append(button);
      }
      jointDetail.textContent =
        meta.rotationSupported === false
          ? "该骨段没有独立旋转自由度，请选择相邻的可动关节。"
          : /humerus/.test(name)
            ? "肩复合联动肩胛、锁骨和上臂，胸廓固定。可分别调整抬举方向、抬举角度与内外旋。"
            : /tibia/.test(name)
              ? "可分别调节屈伸与内外旋；屈膝越接近伸直，额外旋转范围越小。小腿及足随动，大腿固定。"
              : /capitate|proximal_row/.test(name)
                ? WRIST_CONTROL_NOTE
                : "拖不同颜色的环旋转本级，下级随动、上级固定；方向键微调所选轴。";
      rotationAngle.textContent = "";
      rotationRing.setAttribute("stroke", "#237e65");
      rotationKnob.style.left = "178px";
      rotationKnob.style.top = "110px";
      const axes = latest?.jointRotations?.[name]?.axes || [];
      const coordinates = latest?.jointRotations?.[name]?.coordinates || [];
      const limits = latest?.jointRotations?.[name]?.limits || {};
      const forward = camera.getWorldDirection(new THREE.Vector3());
      let best = 0,
        bestDot = -1,
        bestMovable = null,
        bestMovableDot = -1;
      axes.forEach((axis, index) => {
        const dot = Math.abs(
          new THREE.Vector3().fromArray(axis).normalize().dot(forward),
        );
        if (dot > bestDot) {
          best = index;
          bestDot = dot;
        }
        const limit = limits[coordinates[index]];
        const locked = limit && limit.max - limit.min < 1e-6;
        if (!locked && dot > bestMovableDot) {
          bestMovable = index;
          bestMovableDot = dot;
        }
      });
      // A straight knee can expose its locked axial-rotation ring most clearly.
      // Start with a usable direction; keep every axis available for inspection.
      selectedAxis = bestMovable ?? best;
      buildAxisControls(coordinates);
      rotationAngle.textContent = coordinates[selectedAxis]
        ? coordinateLabel(coordinates[selectedAxis]) : "";
      muscleCard.hidden = true;
      onSelect({ type: "joint", name, label, coordinate: coordinates[selectedAxis] });
    }
    labelPosition();
  }
  function setRotationResult(result, request) {
    const coordinate =
      latest?.jointRotations?.[selectedJoint]?.coordinates?.[selectedAxis ?? 0];
    if (
      !result ||
      !selectedJoint ||
      request?.joint !== selectedJoint ||
      (request.coordinate && request.coordinate !== coordinate) ||
      request.mode !==
        (couplingToggle.checked ? "source-joint" : "strict-plane")
    )
      return false;
    const accepted = result.accepted !== false;
    jointWarning.hidden = accepted;
    jointWarning.textContent = accepted ? "" :
      result.reason || "旋转未通过约束，保留原姿势。";
    const wristControl = request.mode === "source-joint" && isWristControl(coordinate);
    jointDetail.textContent = [
      result.reason ||
        (accepted
          ? wristControl
            ? "腕部控制角已改变。"
            : result.coupling?.enabled && result.coupling?.coordinates?.length
              ? "已旋转本级关节，保留源模型联动。"
              : request.mode === "strict-plane"
                ? "已旋转本级关节；上级固定，当前视平面保持不变。"
                : "已沿所选关节轴旋转；上级固定，下级随动。"
          : "当前旋转未通过约束，保留最后接受的姿势。"),
      isWristControl(coordinate) ? WRIST_CONTROL_NOTE : "",
      accepted && result.coupling?.enabled
        ? [
            result.coupling.scope,
            result.coupling.maxDepthM > 0.001
              ? `固定联动沿所选旋转轴的最大偏移 ${(result.coupling.maxDepthM * 100).toFixed(1)} 厘米。`
              : "",
          ]
            .filter(Boolean)
            .join(" ")
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    rotationRing.setAttribute("stroke", accepted ? "#237e65" : "#aa7338");
    if (!drag)
      rotationAngle.textContent = accepted
        ? `${wristControl ? "控制角改变" : "已旋转"} ${Number(result.appliedAngle || 0).toFixed(1)}°`
        : "未改变姿势";
    return true;
  }
  function alignSelectedJoint() {
    if (!selectedJoint || drag || rotationPending) return;
    const axes = latest?.jointRotations?.[selectedJoint]?.axes || [];
    if (!axes.length) return;
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const axis = new THREE.Vector3()
      .fromArray(axes[selectedAxis ?? 0] || axes[0])
      .normalize();
    if (axis.dot(forward) < 0) axis.negate();
    const distance = camera.position.distanceTo(controls.target);
    camera.position.copy(controls.target).addScaledVector(axis, -distance);
    camera.up.copy(
      Math.abs(axis.dot(Y)) > 0.96 ? new THREE.Vector3(0, 0, 1) : Y,
    );
    controls.update();
    view = "perspective";
    onViewChange(view);
    jointDetail.textContent = "已对准当前关节轴；拖圆环旋转，或按方向键微调。";
    jointWarning.hidden = true;
    invalidatePicking();
    render();
  }
  function startRotation(event) {
    if (
      !editing ||
      drag ||
      rotationPending ||
      !selectedJoint ||
      event.button !== 0 ||
      metaFor(selectedJoint).rotationSupported === false
    )
      return;
    const position = projectJoints()[selectedJoint];
    if (!position?.visible) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + position.x,
      centerY = rect.top + position.y;
    const sourceMode = couplingToggle.checked;
    const axisIndex = sourceMode
      ? Number(event.currentTarget.dataset.axisIndex)
      : selectedAxis;
    if (sourceMode && !Number.isInteger(axisIndex)) return;
    selectedAxis = axisIndex;
    const projection = sourceMode ? axisProjections[axisIndex] : null;
    if (sourceMode && !projection) return;
    const coordinate =
      latest?.jointRotations?.[selectedJoint]?.coordinates?.[axisIndex ?? 0];
    const limit = latest?.jointRotations?.[selectedJoint]?.limits?.[coordinate];
    if (sourceMode && limit && limit.max - limit.min < 1e-6) return;
    const knobAngle = projection?.knobAngle ?? 0;
    const startAngle = sourceMode
      ? projection.edgeOn
        ? knobAngle
        : projectionAngle(
            projection,
            event.clientX - centerX,
            event.clientY - centerY,
          )
      : Math.atan2(event.clientY - centerY, event.clientX - centerX);
    drag = {
      name: selectedJoint,
      element: event.currentTarget,
      pointerId: event.pointerId,
      centerX,
      centerY,
      pivotX: position.x,
      pivotY: position.y,
      startX: event.clientX,
      startY: event.clientY,
      previousAngle: startAngle,
      axisIndex,
      knobAngle: startAngle,
      projections: sourceMode ? axisProjections : null,
      projection,
      tangent: projection?.edgeOn ? ringTangent(projection, knobAngle) : null,
      angleDelta: 0,
      axis: sourceMode
        ? [...projection.axis]
        : camera.getWorldDirection(new THREE.Vector3()).toArray(),
      mode: sourceMode ? "source-joint" : "strict-plane",
      coordinate:
        latest?.jointRotations?.[selectedJoint]?.coordinates?.[axisIndex ?? 0],
    };
    controls.enabled = false;
    // Pointer capture does not preserve keyboard focus when other controls disable.
    // Listen only during this gesture so Escape always reaches its cancellation.
    window.addEventListener("keydown", onEscape, true);
    drag.element.setPointerCapture(event.pointerId);
    drag.element.style.cursor = "grabbing";
    onJointRotate({
      name: drag.name,
      phase: "start",
      angleDelta: 0,
      axis: [...drag.axis],
      mode: drag.mode,
      coordinate: drag.coordinate,
    });
    labelPosition();
  }
  function moveRotation(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - drag.centerX,
      dy = event.clientY - drag.centerY;
    if (drag.tangent) {
      const [tx, ty] = drag.tangent;
      drag.angleDelta = THREE.MathUtils.radToDeg(
        ((event.clientX - drag.startX) * tx +
          (event.clientY - drag.startY) * ty) /
          (tx * tx + ty * ty),
      );
    } else {
      if (Math.hypot(dx, dy) < 12) return;
      const angle = drag.projection
        ? projectionAngle(drag.projection, dx, dy)
        : Math.atan2(dy, dx);
      const difference = angle - drag.previousAngle;
      drag.angleDelta += THREE.MathUtils.radToDeg(
        Math.atan2(Math.sin(difference), Math.cos(difference)),
      );
      drag.previousAngle = angle;
      if (!drag.projection) {
        rotationKnob.style.left = `${GIZMO_CENTER + 68 * Math.cos(angle)}px`;
        rotationKnob.style.top = `${GIZMO_CENTER + 68 * Math.sin(angle)}px`;
      }
    }
    const angleLabel = isWristControl(drag.coordinate)
      ? drag.mode === "source-joint" ? `${coordinateLabel(drag.coordinate)}改变` : "视平面旋转"
      : coordinateLabel(drag.coordinate);
    rotationAngle.textContent = `${angleLabel} ${drag.angleDelta > 0 ? "+" : ""}${drag.angleDelta.toFixed(1)}°`;
    labelPosition();
    onJointRotate({
      name: drag.name,
      phase: "move",
      angleDelta: drag.angleDelta,
      axis: [...drag.axis],
    });
  }
  function endDrag(event, cancelled = false) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const active = drag;
    drag = null;
    window.removeEventListener("keydown", onEscape, true);
    controls.enabled = true;
    active.element.style.cursor = "grab";
    if (active.element.hasPointerCapture(active.pointerId))
      active.element.releasePointerCapture(active.pointerId);
    onJointRotate({
      name: active.name,
      phase: cancelled ? "cancel" : "end",
      angleDelta: active.angleDelta,
      axis: [...active.axis],
    });
    labelPosition();
  }
  function rotationKey(
    event,
    name = selectedJoint,
    axisIndex = selectedAxis ?? 0,
  ) {
    if (
      !editing ||
      drag ||
      !name ||
      ![
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "+",
        "-",
        "=",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    if (selectedJoint !== name) selectJoint(name);
    if (metaFor(name).rotationSupported === false) return;
    const angleDelta =
      (event.shiftKey ? 5 : 1) *
      (/Down|Left/.test(event.key) || event.key === "-" ? -1 : 1);
    stepRotation(axisIndex, angleDelta);
  }
  function stepRotation(axisIndex, angleDelta) {
    if (!canStep(axisIndex)) return;
    const coordinate =
      latest?.jointRotations?.[selectedJoint]?.coordinates?.[axisIndex];
    const limit = latest?.jointRotations?.[selectedJoint]?.limits?.[coordinate];
    const value = latest?.q?.[coordinate];
    if (
      couplingToggle.checked &&
      limit &&
      ((angleDelta > 0 && value >= limit.max - 1e-6) ||
        (angleDelta < 0 && value <= limit.min + 1e-6))
    )
      return;
    selectedAxis = axisIndex;
    const axis = couplingToggle.checked
      ? latest?.jointRotations?.[selectedJoint]?.axes?.[axisIndex]
      : camera.getWorldDirection(new THREE.Vector3()).toArray();
    if (!axis) return;
    onJointRotate({
      name: selectedJoint,
      phase: "step",
      angleDelta,
      axis: [...axis],
      mode: couplingToggle.checked ? "source-joint" : "strict-plane",
      coordinate:
        latest?.jointRotations?.[selectedJoint]?.coordinates?.[axisIndex],
    });
    labelPosition();
  }
  function onEscape(event) {
    if (event.key !== "Escape" || (!selectedJoint && !drag)) return;
    if (drag) {
      event.preventDefault();
      endDrag({ pointerId: drag.pointerId }, true);
    }
    selectJoint(null);
  }
  function bindRotationEvents(element) {
    element.addEventListener("pointerdown", startRotation);
    element.addEventListener("pointermove", moveRotation);
    element.addEventListener("pointerup", (event) => endDrag(event));
    element.addEventListener("pointercancel", (event) => endDrag(event, true));
    element.addEventListener("lostpointercapture", (event) =>
      endDrag(event, true),
    );
  }
  for (const element of [rotationHit, rotationKnob])
    bindRotationEvents(element);
  rotationKnob.addEventListener("keydown", (event) => rotationKey(event));
  closeJoint.onclick = () => selectJoint(null);
  alignJoint.onclick = alignSelectedJoint;
  couplingToggle.onchange = () => {
    if (drag) endDrag({ pointerId: drag.pointerId }, true);
    jointWarning.hidden = true;
    jointDetail.textContent = couplingToggle.checked
      ? "按所选彩色关节轴旋转，保留固定联动；上级独立关节仍固定。"
      : "改为严格视角平面；只在本级关节允许该平面旋转时接受。";
    labelPosition();
  };
  container.addEventListener("keydown", onEscape);
  function addHandle(name) {
    if (explicitHandles && !explicitHandles.has(name)) return;
    if (labels.has(name)) return;
    const meta = metaFor(name);
    if (meta.editable === false) return;
    if (Array.isArray(meta.localCoordinates) && !meta.localCoordinates.length) return;
    if (!handleMeta.has(name) && name.startsWith("heel_")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.joint = name;
    const label = meta.label || HANDLE_LABELS[name] || name,
      isLeft = sideOf(name, meta) === "l";
    button.setAttribute("aria-label", `选择${label}，旋转本级关节`);
    button.title = `${label} · 点击选择，再拖圆环旋转`;
    button.style.cssText =
      "position:absolute;transform:translate(-50%,-50%);width:32px;height:32px;padding:0;border:0;border-radius:50%;background:transparent;box-shadow:none;pointer-events:auto;cursor:grab;touch-action:none;user-select:none;overflow:visible;z-index:2";
    const dot = document.createElement("span");
    dot.style.cssText = `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:17px;height:17px;box-sizing:border-box;border:2px solid ${isLeft ? "#a17845" : "#398a82"};border-radius:50%;background:#fbfdf9e8;box-shadow:0 1px 5px #203a3526;pointer-events:none`;
    const caption = document.createElement("span");
    caption.textContent = label;
    caption.style.cssText = `position:absolute;top:5px;${isLeft ? "left:30px" : "right:30px"};white-space:nowrap;background:#fffffff0;border:1px solid #d7e1d9;border-radius:4px;padding:1px 4px;color:#284a43;font:600 10px/1.5 system-ui;pointer-events:auto;cursor:grab;touch-action:none;user-select:none`;
    button.append(dot, caption);
    overlay.append(button);
    labels.set(name, button);
    button.addEventListener("focus", () => {
      focusedHandle = name;
      labelPosition();
    });
    button.addEventListener("blur", () => {
      if (focusedHandle === name) focusedHandle = null;
      labelPosition();
    });
    button.addEventListener("pointerdown", (event) => {
      if (!editing || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      button.focus({ preventScroll: true });
      selectJoint(name);
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectJoint(name);
      } else rotationKey(event, name);
    });
  }
  function allocateMuscles(records) {
    const names = records.map((m) => m.name);
    if (
      names.length === muscleNames.length &&
      names.every((name, i) => name === muscleNames[i])
    )
      return;
    if (muscleMesh) {
      scene.remove(muscleMesh);
      muscleGeometry.dispose();
      muscleMesh.material.dispose();
    }
    muscleNames = names;
    muscleBounds = names.map(() => new THREE.Box3());
    muscleShapes = [];
    muscleGeometry = new THREE.BufferGeometry();
    const total = names.length * VERTICES;
    for (const key of ["position", "normal", "color"])
      muscleGeometry.setAttribute(
        key,
        new THREE.BufferAttribute(new Float32Array(total * 3), 3).setUsage(
          THREE.DynamicDrawUsage,
        ),
      );
    const indices = new Uint32Array(names.length * TRIANGLES * 3);
    let at = 0;
    names.forEach((_, slot) => {
      for (let i = 0; i < SEGMENTS; i++)
        for (let j = 0; j < RADIAL; j++) {
          const a = slot * VERTICES + i * (RADIAL + 1) + j,
            b = a + RADIAL + 1;
          indices.set([a, b, a + 1, b, b + 1, a + 1], at);
          at += 6;
        }
    });
    allMuscleIndices = indices;
    muscleGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
    muscleMesh = new THREE.Mesh(
      muscleGeometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.74,
        side: THREE.DoubleSide,
      }),
    );
    muscleMesh.frustumCulled = false;
    muscleMesh.visible = musclesVisible && muscleDisplay === "paths";
    const exactRaycast = muscleMesh.raycast;
    const localRay = new THREE.Ray(),
      inverseMatrix = new THREE.Matrix4();
    muscleMesh.raycast = function (activeRaycaster, intersections) {
      inverseMatrix.copy(this.matrixWorld).invert();
      localRay.copy(activeRaycaster.ray).applyMatrix4(inverseMatrix);
      const { start, count } = muscleGeometry.drawRange;
      try {
        // The surface stays one draw call. Picking rejects whole muscle bounds
        // before running Three's unchanged triangle test on candidate bundles.
        // Index offsets remain those of the visible index buffer, preserving
        // faceIndex -> displayedMuscleSlots for names and occlusion decisions.
        displayedMuscleSlots.forEach((slot, visibleSlot) => {
          if (
            muscleBounds[slot].isEmpty() ||
            !localRay.intersectsBox(muscleBounds[slot])
          )
            return;
          muscleGeometry.setDrawRange(
            visibleSlot * TRIANGLES * 3,
            TRIANGLES * 3,
          );
          exactRaycast.call(this, activeRaycaster, intersections);
        });
      } finally {
        muscleGeometry.setDrawRange(start, count);
      }
    };
    scene.add(muscleMesh);
    updateRegionVisibility();
    lastPathFrame = null;
  }
  function updateRegionVisibility() {
    invalidatePicking();
    updateBranchVisibility();
    const bodyMetadata = new Map(
      [...handleMeta.values()].map((handle) => [
        handle.body || handle.name,
        handle,
      ]),
    );
    for (const [name, group] of bodyGroups)
      group.visible = groupMatches(region, name, bodyMetadata.get(name) || {});
    if (!muscleGeometry || !allMuscleIndices) return;
    displayedMuscleSlots = [];
    const records = latest?.muscles || [];
    const recordsByName = new Map(
      records.map((record) => [record.name, record]),
    );
    muscleNames.forEach((name, slot) => {
      if (
        groupMatches(
          region,
          name,
          muscleMeta.get(name) || recordsByName.get(name) || {},
        )
      )
        displayedMuscleSlots.push(slot);
    });
    if (displayedMuscleSlots.length === muscleNames.length) {
      muscleGeometry.setIndex(new THREE.BufferAttribute(allMuscleIndices, 1));
      return;
    }
    const indices = new Uint32Array(
      displayedMuscleSlots.length * TRIANGLES * 3,
    );
    displayedMuscleSlots.forEach((slot, i) =>
      indices.set(
        allMuscleIndices.subarray(
          slot * TRIANGLES * 3,
          (slot + 1) * TRIANGLES * 3,
        ),
        i * TRIANGLES * 3,
      ),
    );
    muscleGeometry.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  function updateMuscleColors(records) {
    updateBranchColors();
    if (!muscleGeometry) return;
    const colors = muscleGeometry.attributes.color.array;
    records.forEach((record, slot) => {
      colorForce(record.force, color);
      if (record.name === selectedMuscle) color.lerp(SELECTED, 0.6);
      const meta = muscleMeta.get(record.name) || record;
      if (!groupMatches(region, record.name, meta)) color.lerp(COLD, 0.7);
      for (
        let vertex = slot * VERTICES * 3, end = (slot + 1) * VERTICES * 3;
        vertex < end;
        vertex += 3
      ) {
        colors[vertex] = color.r;
        colors[vertex + 1] = color.g;
        colors[vertex + 2] = color.b;
      }
    });
    muscleGeometry.attributes.color.needsUpdate = true;
  }
  function updateBranchVisibility() {
    if (!branchGeometry) return;
    const indices = branchGeometry.index.array;
    let count = 0;
    for (const { record, first, count: length } of branchRanges) {
      if (!groupMatches(region, record.name, muscleMeta.get(record.name) || record)) continue;
      for (let vertex = first; vertex < first + length; vertex++) indices[count++] = vertex;
    }
    branchGeometry.index.needsUpdate = true;
    branchGeometry.setDrawRange(0, count);
    branchLines.visible = count > 0 && !previewing && musclesVisible && muscleDisplay === "paths";
  }
  function updateBranchColors() {
    if (!branchGeometry) return;
    const colors = branchGeometry.attributes.color.array;
    for (const { record, branch, first, count } of branchRanges) {
      colorForce(Number.isFinite(record.force) ? branch.force : NaN, color);
      if (record.name === selectedMuscle) color.lerp(SELECTED, 0.6);
      for (let vertex = first * 3; vertex < (first + count) * 3; vertex += 3) {
        colors[vertex] = color.r;
        colors[vertex + 1] = color.g;
        colors[vertex + 2] = color.b;
      }
    }
    branchGeometry.attributes.color.needsUpdate = true;
  }
  function updateBranchPaths(records) {
    branchRanges = [];
    let vertexCount = 0;
    for (const record of records) {
      if (!Array.isArray(record.branches)) continue;
      // Index 0 is already drawn as the muscle's primary path. Each remaining
      // branch uses independent segment pairs, including at disconnected ends.
      for (const branch of record.branches.slice(1)) {
        if (!Array.isArray(branch.path) || branch.path.length < 2 || !branch.path.every(positionOf)) continue;
        const count = (branch.path.length - 1) * 2;
        branchRanges.push({ record, branch, first: vertexCount, count });
        vertexCount += count;
      }
    }
    if (vertexCount > (branchGeometry?.attributes.position.count || 0)) {
      const capacity = 2 ** Math.ceil(Math.log2(vertexCount));
      const geometry = new THREE.BufferGeometry();
      for (const name of ["position", "color"])
        geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
      if (branchLines) {
        branchGeometry.dispose();
        branchLines.geometry = geometry;
      } else {
        branchLines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true }));
        branchLines.frustumCulled = false;
        scene.add(branchLines);
      }
      branchGeometry = geometry;
    }
    if (!branchGeometry) return;
    const positions = branchGeometry.attributes.position.array;
    for (const { branch, first } of branchRanges) {
      let offset = first * 3;
      for (let point = 1; point < branch.path.length; point++) {
        positions.set(positionOf(branch.path[point - 1]), offset);
        positions.set(positionOf(branch.path[point]), offset + 3);
        offset += 6;
      }
    }
    branchGeometry.attributes.position.needsUpdate = true;
    updateBranchVisibility();
  }
  function updateMusclePaths(records) {
    const positions = muscleGeometry.attributes.position.array,
      normals = muscleGeometry.attributes.normal.array;
    let changed = false;
    records.forEach((record, slot) => {
      const meta = muscleMeta.get(record.name) || record;
      const shape = [
        record.length,
        record.restLength,
        record.maxForce,
        record.fmax,
        restLengths.get(record.name),
        meta.maxForce,
        meta.maxIsometricForce,
        /^hand/.test(regionOf(record.name, meta)),
      ];
      const cached = muscleShapes[slot],
        path = record.path || [];
      if (
        cached &&
        shape.every((value, i) => value === cached.shape[i]) &&
        path.length === cached.path.length &&
        path.every((value, i) => {
          const p = positionOf(value),
            old = cached.path[i];
          return p
            ? old && p.every((coordinate, axis) => coordinate === old[axis])
            : old === null;
        })
      )
        return;
      changed = true;
      const bounds = muscleBounds[slot];
      bounds.makeEmpty();
      muscleGeometry.attributes.position.addUpdateRange(
        slot * VERTICES * 3,
        VERTICES * 3,
      );
      muscleGeometry.attributes.normal.addUpdateRange(
        slot * VERTICES * 3,
        VERTICES * 3,
      );
      const points = [];
      for (const value of record.path || []) {
        const position = positionOf(value);
        if (!position) continue;
        const current = new THREE.Vector3(...position);
        if (!points.length || current.distanceToSquared(points.at(-1)) > 1e-12)
          points.push(current);
      }
      const offset = slot * VERTICES * 3;
      if (points.length < 2) {
        positions.fill(0, offset, offset + VERTICES * 3);
        normals.fill(0, offset, offset + VERTICES * 3);
        muscleShapes[slot] = {
          shape,
          path: path.map((value) => positionOf(value)?.slice() || null),
        };
        return;
      }
      const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
      curve.arcLengthDivisions = 40;
      for (let i = 0; i <= SEGMENTS; i++)
        curve.getPointAt(i / SEGMENTS, sampled[i]);
      const length = Number(record.length) || curve.getLength();
      if (!restLengths.has(record.name))
        restLengths.set(record.name, Number(record.restLength) || length);
      const ratio = THREE.MathUtils.clamp(
        length / Math.max(1e-6, restLengths.get(record.name)),
        0.5,
        1.6,
      );
      const inHand = shape[7];
      const capacity = Math.max(
        1,
        Number(
          record.maxForce ??
            record.fmax ??
            meta.maxForce ??
            meta.maxIsometricForce,
        ) || 1000,
      );
      const belly =
        THREE.MathUtils.clamp(
          Math.sqrt(capacity / 1000) * 0.009,
          inHand ? 0.001 : 0.0015,
          inHand ? 0.0045 : 0.017,
        ) / Math.sqrt(ratio);
      const tip = inHand ? 0.00035 : 0.0006;
      normal.set(0, 0, 0);
      for (let i = 0; i <= SEGMENTS; i++) {
        point.copy(sampled[i]);
        previous.copy(sampled[Math.max(0, i - 1)]);
        next.copy(sampled[Math.min(SEGMENTS, i + 1)]);
        tangent.subVectors(next, previous).normalize();
        if (i === 0 || normal.lengthSq() < 1e-10)
          normal.set(
            Math.abs(tangent.x) < 0.8 ? 1 : 0,
            Math.abs(tangent.x) < 0.8 ? 0 : 1,
            0,
          );
        normal.addScaledVector(tangent, -normal.dot(tangent));
        if (normal.lengthSq() < 1e-10)
          normal.set(0, 0, 1).addScaledVector(tangent, -tangent.z);
        normal.normalize();
        binormal.crossVectors(tangent, normal).normalize();
        const t = i / SEGMENTS,
          profile = Math.sin(Math.PI * t),
          radius = tip + belly * profile ** 1.4;
        const slope =
          (1.4 *
            belly *
            Math.PI *
            Math.cos(Math.PI * t) *
            Math.max(0, profile) ** 0.4) /
          Math.max(length, 0.001);
        for (let j = 0; j <= RADIAL; j++) {
          radial
            .copy(normal)
            .multiplyScalar(ringCos[j])
            .addScaledVector(binormal, ringSin[j]);
          const at = offset + (i * (RADIAL + 1) + j) * 3;
          positions[at] = point.x + radial.x * radius;
          positions[at + 1] = point.y + radial.y * radius;
          positions[at + 2] = point.z + radial.z * radius;
          bounds.min.x = Math.min(bounds.min.x, positions[at]);
          bounds.min.y = Math.min(bounds.min.y, positions[at + 1]);
          bounds.min.z = Math.min(bounds.min.z, positions[at + 2]);
          bounds.max.x = Math.max(bounds.max.x, positions[at]);
          bounds.max.y = Math.max(bounds.max.y, positions[at + 1]);
          bounds.max.z = Math.max(bounds.max.z, positions[at + 2]);
          radial.addScaledVector(tangent, -slope).normalize();
          normals[at] = radial.x;
          normals[at + 1] = radial.y;
          normals[at + 2] = radial.z;
        }
      }
      shape[4] = restLengths.get(record.name);
      muscleShapes[slot] = {
        shape,
        path: path.map((value) => positionOf(value)?.slice() || null),
      };
    });
    if (!changed) return;
    muscleGeometry.attributes.position.needsUpdate = true;
    muscleGeometry.attributes.normal.needsUpdate = true;
    muscleGeometry.boundingBox ??= new THREE.Box3();
    muscleGeometry.boundingBox.makeEmpty();
    for (const bounds of muscleBounds) muscleGeometry.boundingBox.union(bounds);
    muscleGeometry.boundingSphere ??= new THREE.Sphere();
    muscleGeometry.boundingBox.getBoundingSphere(muscleGeometry.boundingSphere);
  }
  function updateGear(frame) {
    const gear = frame.equipment;
    const instances =
      gear && gear.type !== "none" && Number(gear.massKg) > 0
        ? (frame.equipmentInstances || []).filter(
            (item) => item.type === gear.type && item.matrix?.length === 16,
          )
        : [];
    const nextKey = JSON.stringify(
      instances.map(({ type, side, geometry }) => ({ type, side, geometry })),
    );
    if (nextKey !== gearKey) {
      disposeObject(accessoryRoot);
      accessoryRoot.clear();
      gearKey = nextKey;
      for (const instance of instances) {
        const mesh = equipmentMesh(instance.geometry);
        mesh.matrixAutoUpdate = false;
        accessoryRoot.add(mesh);
      }
    }
    for (let i = 0; i < accessoryRoot.children.length; i++) {
      const object = accessoryRoot.children[i];
      object.matrix.fromArray(instances[i].matrix);
      object.matrixWorldNeedsUpdate = true;
    }
  }
  function update(frame) {
    if (disposed || !frame) return;
    frameEpoch++;
    if (anatomicalMuscles && surfaceQuality === "detail" && muscleDisplay === "anatomy") frameQueue.request(frame);
    else applyFrame(frame);
  }
  function applyFrame(frame, prepared = null, fast = false, pathsOnly = false) {
    if (disposed || !frame) return;
    invalidatePicking();
    latest = frame;
    previewing = fast;
    onlyPaths = pathsOnly;
    boneRoot.visible = bonesVisible || fast;
    if (fast || pathsOnly) {
      transitionPreview?.setVisible(false);
      anatomicalMuscles?.setVisible(false);
      muscleCard.hidden = true;
    }
    if (frame.handles && frame.handles !== lastHandleMetadata) {
      lastHandleMetadata = frame.handles;
      const signature = JSON.stringify(frame.handles);
      if (signature !== lastHandleSignature) {
        lastHandleSignature = signature;
        setMetadata({ handles: frame.handles });
      }
    }
    for (const body of frame.bodies || []) {
      const group = bodyGroups.get(body.name);
      if (group && body.matrix?.length === 16) {
        group.matrix.fromArray(body.matrix);
        group.matrixWorldNeedsUpdate = true;
      }
    }
    if (muscleMesh) muscleMesh.visible = !fast && musclesVisible && muscleDisplay === "paths";
    if (branchLines) branchLines.visible = branchGeometry.drawRange.count > 0 && !fast && musclesVisible && muscleDisplay === "paths";
    if (!fast && muscleDisplay === "paths") {
      const records = (frame.muscles || []).filter(
        (record) => record.name && Array.isArray(record.path),
      );
      allocateMuscles(records);
      if (lastPathFrame !== frame.muscles) {
        updateMusclePaths(records);
        updateBranchPaths(records);
        lastPathFrame = frame.muscles;
      }
      updateMuscleColors(records);
    }
    if (!fast && !pathsOnly && muscleDisplay === "anatomy") {
      anatomicalMuscles?.update(frame, prepared);
      disposeTransitionPreview();
    }
    if (!fast && !pathsOnly && anatomicalMuscles) anatomicalMuscles.setVisible(musclesVisible && muscleDisplay === "anatomy");
    if (!fast && !pathsOnly && anatomicalMuscles && !hasAnatomicalFrame) {
      hasAnatomicalFrame = true;
      anatomicalMuscles.setVisible(musclesVisible && muscleDisplay === "anatomy");
      onAnatomyStatus({
        ready: true,
        ...anatomicalMuscles.status,
        message: surfaceQuality === "preview" ? "轻量解剖表面已就绪，可播放或点击肌肉查看名称。" : "已载入精细解剖表面，可点击肌肉查看名称。",
      });
    }
    let addedMetadata = false;
    for (const [name, value] of Object.entries(frame.joints || {})) {
      if (
        !handleMeta.has(name) &&
        (!explicitHandles || explicitHandles.has(name))
      ) {
        handleMeta.set(name, {
          ...metaFor(name),
          ...(value && !Array.isArray(value) ? value : {}),
        });
        addedMetadata = true;
      }
      addHandle(name);
    }
    if (addedMetadata) updateRegionOptions();
    updateGear(frame);
    invalidatePicking();
    if (readOnly && !fitted) fit();
    render();
  }
  function setView(name) {
    if (!["front", "right", "left", "side", "perspective"].includes(name))
      return;
    view = name === "side" ? "right" : name;
    invalidatePicking();
    const direction =
      view === "front"
        ? [6, 0, 0]
        : view === "right"
          ? [0, 0, 6]
          : view === "left"
            ? [0, 0, -6]
            : [3.2, 0.9, 4.5];
    camera.position.copy(controls.target).add(new THREE.Vector3(...direction));
    camera.up.copy(Y);
    controls.update();
    if (fitted) fit();
    else render();
    onViewChange(view);
  }
  function fit() {
    if (!latest || drag) return;
    invalidatePicking();
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    if (region === "all" && readyGeometry) bounds.setFromObject(boneRoot);
    for (const [name, value] of Object.entries(latest.joints || {})) {
      const p = positionOf(value);
      if (p && groupMatches(region, name, metaFor(name)))
        bounds.expandByPoint(new THREE.Vector3(...p));
    }
    // Extrinsic finger muscles begin in the forearm. Hand editing must frame
    // the joint targets instead of zooming out to include their full tendons.
    const fineRegion = /^(hand|foot)/.test(region);
    if (region !== "all" && (!fineRegion || bounds.isEmpty()))
      for (const record of latest.muscles || []) {
        if (
          !groupMatches(
            region,
            record.name,
            muscleMeta.get(record.name) || record,
          )
        )
          continue;
        for (const p of record.path || [])
          if (positionOf(p))
            bounds.expandByPoint(new THREE.Vector3(...positionOf(p)));
      }
    if (bounds.isEmpty()) return;
    bounds.expandByScalar(
      region.startsWith("hand") || region.startsWith("foot") ? 0.025 : 0.04,
    );
    const center = bounds.getCenter(new THREE.Vector3()),
      delta = center.clone().sub(controls.target);
    controls.target.copy(center);
    camera.position.add(delta);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    let xExtent = 0,
      yExtent = 0;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          projected.set(x, y, z).project(camera);
          xExtent = Math.max(xExtent, Math.abs(projected.x));
          yExtent = Math.max(yExtent, Math.abs(projected.y));
        }
    camera.zoom = THREE.MathUtils.clamp(
      0.82 / Math.max(xExtent, yExtent, 0.04),
      0.3,
      20,
    );
    camera.updateProjectionMatrix();
    controls.update();
    fitted = true;
    render();
  }
  function setRegion(name, { fit: shouldFit = true, orient = true } = {}) {
    selectJoint(null);
    muscleCard.hidden = true;
    selectedMuscle = null;
    anatomicalMuscles?.setSelected(null);
    region = name || "all";
    regionSelect.value = region;
    anatomicalMuscles?.setRegion(region);
    transitionPreview?.setRegion(region);
    updateRegionVisibility();
    if (latest)
      updateMuscleColors(
        (latest.muscles || []).filter(
          (record) => record.name && Array.isArray(record.path),
        ),
      );
    if (orient && /^hand_[rl]$/.test(region))
      setView(region === "hand_r" ? "right" : "left");
    if (shouldFit) fit();
    else render();
    onRegionChange(region);
  }
  function showMuscleName(name) {
    const record =
      muscleMeta.get(name) ||
      latest?.muscles?.find((item) => item.name === name) ||
      {};
    const baseName = name.replace(/_[rl]$/, "");
    const gluteal = /^(glmax|glmed|glmin)([123])$/.exec(baseName);
    const label =
      record.label ||
      MUSCLE_LABELS[baseName] ||
      (gluteal
        ? `${{ glmax: "臀大肌", glmed: "臀中肌", glmin: "臀小肌" }[gluteal[1]]} · 肌束 ${gluteal[2]}`
        : null);
    const side = sideOf(name, record) || sideOf(record.region || "");
    muscleTitle.textContent = label
      ? `${side === "l" ? "左" : side === "r" ? "右" : ""}${label}`
      : name;
    const regionName = REGION_LABELS[regionOf(name, record)] || "肌束";
    muscleDetail.textContent = label
      ? `${regionName} · 模型名称 ${name}`
      : `${regionName} · 原模型肌束名称`;
    muscleCard.hidden = false;
  }
  function clearMuscleSelection() {
    muscleCard.hidden = true;
    selectedMuscle = null;
    anatomicalMuscles?.setSelected(null);
    if (latest)
      updateMuscleColors(
        latest.muscles.filter((item) => item.name && Array.isArray(item.path)),
      );
    render();
    onSelect(null);
  }
  closeMuscle.onclick = clearMuscleSelection;
  function rememberPointer(event) {
    const rect = container.getBoundingClientRect();
    pointer = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      overHandle: event.target.closest?.("button[data-joint]")?.dataset.joint,
    };
  }
  function onPointerMove(event) {
    rememberPointer(event);
    if (
      canvasPress &&
      Math.hypot(event.clientX - canvasPress.x, event.clientY - canvasPress.y) >
        5
    )
      canvasPress.moved = true;
    if (!hoverFrame)
      hoverFrame = requestAnimationFrame(() => {
        hoverFrame = 0;
        if (!disposed) labelPosition();
      });
  }
  function onPointerLeave() {
    pointer = null;
    labelPosition();
  }
  function onTouchNear(event) {
    if (event.pointerType !== "touch" || event.target !== renderer.domElement)
      return;
    rememberPointer(event);
    labelPosition();
    const exposed = [...labels.values()].some(
      (button) => !button.hidden && button.style.opacity === "1",
    );
    if (exposed) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerleave", onPointerLeave);
  container.addEventListener("pointerdown", onTouchNear, true);
  regionSelect.onchange = () => setRegion(regionSelect.value);
  renderer.domElement.addEventListener("pointerdown", (event) => {
    canvasPress = { x: event.clientX, y: event.clientY, moved: false };
  });
  renderer.domElement.addEventListener("pointerup", (event) => {
    if (!canvasPress) return;
    const distance = Math.hypot(
      event.clientX - canvasPress.x,
      event.clientY - canvasPress.y,
    );
    const moved = canvasPress.moved;
    canvasPress = null;
    if (moved || distance > 5) return;
    rayAt(event.clientX, event.clientY);
    scene.updateMatrixWorld(true);
    const hit = surfaceHits()[0];
    if (hit?.object === anatomicalMuscles?.object) {
      const selected = anatomicalMuscles.resolveHit(hit);
      if (!selected) return;
      selectJoint(null);
      selectedMuscle = selected.atlasId;
      anatomicalMuscles.setSelected(selected.atlasId);
      muscleTitle.textContent = selected.label;
      const mapping =
        selected.tissueType === "tendon"
          ? "跟腱连接表面，不作为独立肌肉计算"
          : selected.mapping === "single"
            ? `计算单元 ${selected.units[0]}`
            : selected.mapping === "group"
              ? `对应 ${selected.units.length} 个计算单元；表面颜色表示关联肌束的最大张力，曲线显示所选单元，不代表整块肌肉合力`
              : "解剖表面已显示，尚无计算单元映射";
      muscleDetail.textContent = `${selected.english || selected.atlasId} · ${mapping}`;
      muscleCard.hidden = false;
      render();
      onSelect(selected);
      return;
    }
    if (!hit || hit.object !== muscleMesh) {
      clearMuscleSelection();
      return;
    }
    const slot = displayedMuscleSlots[Math.floor(hit.faceIndex / TRIANGLES)],
      name = muscleNames[slot];
    if (!name) return;
    selectedMuscle = name;
    showMuscleName(name);
    const record = latest?.muscles?.find((muscle) => muscle.name === name);
    if (latest)
      updateMuscleColors(
        latest.muscles.filter(
          (muscle) => muscle.name && Array.isArray(muscle.path),
        ),
      );
    render();
    onSelect({ type: "muscle", ...record, name });
  });
  renderer.domElement.addEventListener("pointercancel", () => {
    canvasPress = null;
  });
  const ready = (
    geometryData
      ? Promise.resolve(geometryData)
      : fetch(geometryUrl).then(async (reply) => {
          if (!reply.ok) throw Error("全身模型骨网格尚未准备好。");
          return reply.json();
        })
  ).then((data) => {
    if (disposed) return;
    const geometries = new Map();
    for (const [name, record] of Object.entries(data.meshes || {})) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(record.positions, 3),
      );
      geometry.setIndex(record.indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      geometry.computeBoundingBox();
      geometries.set(name, geometry);
    }
    const material = new THREE.MeshStandardMaterial({
      color: "#dbd3bf",
      roughness: 0.88,
      side: THREE.DoubleSide,
    });
    const materials = new Map();
    function meshMaterial(record) {
      const rgba = record.rgba || record.material?.rgba;
      if (!Array.isArray(rgba) || rgba.length < 3) return material;
      const key = rgba.join(",");
      if (!materials.has(key)) {
        const alpha = Number.isFinite(rgba[3]) ? rgba[3] : 1;
        materials.set(
          key,
          new THREE.MeshStandardMaterial({
            color: new THREE.Color().setRGB(rgba[0], rgba[1], rgba[2]),
            opacity: alpha,
            transparent: alpha < 1,
            depthWrite: alpha >= 1,
            roughness: record.material?.roughness ?? 0.88,
            side: THREE.DoubleSide,
          }),
        );
      }
      return materials.get(key);
    }
    for (const body of data.bodies || []) {
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      for (const record of body.meshes || []) {
        const geometry = geometries.get(record.file ?? record.mesh);
        if (!geometry) continue;
        const mesh = new THREE.Mesh(geometry, meshMaterial(record));
        mesh.userData.body = body.name;
        if (record.matrix?.length === 16) {
          mesh.matrixAutoUpdate = false;
          mesh.matrix.fromArray(record.matrix);
        } else {
          if (record.position) mesh.position.fromArray(record.position);
          if (record.quaternion) mesh.quaternion.fromArray(record.quaternion);
          if (record.scale) mesh.scale.fromArray(record.scale);
        }
        group.add(mesh);
      }
      if (body.matrix?.length === 16) group.matrix.fromArray(body.matrix);
      bodyGroups.set(body.name, group);
      boneRoot.add(group);
    }
    readyGeometry = true;
    setMetadata(data);
    if (latest && (!anatomicalMuscles || hasAnatomicalFrame)) {
      if (!previewing && !onlyPaths && muscleDisplay === "anatomy") update(latest);
      else applyFrame(latest, null, previewing, onlyPaths);
    }
    else if (latest) {
      // Geometry may finish after muscle resources. Display the committed
      // skeleton without triggering a synchronous first muscle solve.
      for (const body of latest.bodies || []) {
        const group = bodyGroups.get(body.name);
        if (group && body.matrix?.length === 16) {
          group.matrix.fromArray(body.matrix);
          group.matrixWorldNeedsUpdate = true;
        }
      }
    }
    return { bodyCount: bodyGroups.size, meshCount: geometries.size };
  });
  setMetadata(metadata);
  resize();
  let anatomyReady = Promise.resolve();
  function disposeTransitionPreview() {
    if (!transitionPreview) return;
    scene.remove(transitionPreview.object);
    transitionPreview.dispose();
    transitionPreview = null;
  }
  function loadSurface(quality, previewFirst = false) {
    const generation = ++surfaceGeneration;
    surfaceRequest?.abort();
    const controller = new AbortController();
    surfaceRequest = controller;
    surfaceLoadError = null;
    ++frameEpoch;
    frameQueue.invalidate();
    requestedQuality = quality;
    async function install(kind) {
      if (disposed || generation !== surfaceGeneration) return;
      const factory = kind === "preview"
        ? (await import("./preview-muscles.js")).createPreviewMuscles
        : (await import("./anatomical-muscles.js")).createAnatomicalMuscles;
      if (disposed || generation !== surfaceGeneration) return;
      const muscles = await factory({
        signal: controller.signal,
        onProgress: (progress) => {
          if (!disposed && generation === surfaceGeneration) onAnatomyStatus(progress);
        },
      });
      if (disposed || generation !== surfaceGeneration) {
        muscles.dispose();
        return;
      }
      // Keep the editable skeleton responsive while the driver compiles the
      // muscle/contact shader. This scene is never rendered or user-visible.
      onAnatomyStatus({ message: kind === "detail" ? "正在准备精细肌肉动画。" : "正在准备肌肉表面预览。" });
      const staging = new THREE.Scene();
      staging.add(muscles.object);
      try {
        pendingCompilation = renderer.compileAsync(staging, camera, scene);
        await pendingCompilation;
      } catch (error) {
        muscles.dispose();
        throw error;
      } finally {
        pendingCompilation = null;
        staging.remove(muscles.object);
      }
      if (disposed || generation !== surfaceGeneration) {
        muscles.dispose();
        return;
      }
      // Keep the current mesh available while its replacement is downloading and compiling.
      const previous = anatomicalMuscles;
      disposeTransitionPreview();
      if (previous && surfaceQuality === "preview" && kind === "detail" && hasAnatomicalFrame &&
          !previewing && !onlyPaths && musclesVisible && muscleDisplay === "anatomy") {
        // Keep the preview on screen until the first detailed pose is ready.
        transitionPreview = previous;
      } else if (previous) {
        scene.remove(previous.object);
        previous.dispose();
      }
      frameEpoch++;
      frameQueue.invalidate();
      surfaceQuality = kind;
      hasAnatomicalFrame = false;
      anatomicalMuscles = muscles;
      scene.add(muscles.object);
      muscles.setRegion(region);
      // Resources start in atlas rest pose. Keep them hidden until the worker
      // has prepared the current pose, including during display-mode toggles.
      muscles.setVisible(false);
      if (latest && !previewing && !onlyPaths) update(latest);
      if (selectedMuscle) muscles.setSelected(selectedMuscle);
      invalidatePicking();
      render();
      onAnatomyStatus({
        ...muscles.status,
        ready: hasAnatomicalFrame,
        message: hasAnatomicalFrame
          ? (kind === "preview" ? "轻量解剖表面已就绪，可点击肌肉查看名称。" : "精细解剖表面已就绪，可点击肌肉查看名称。")
          : "肌肉资源已载入，正在准备当前姿势；骨骼和关节可以先操作。",
      });
      return muscles.status;
    }
    // Serialize loads so rapid switches cannot stage two full atlases at once.
    anatomyReady = anatomyReady.then(async () => {
      if (previewFirst) {
        try { await install("preview"); } catch (error) {
          if (controller.signal.aborted) return;
          onAnatomyStatus({message: `预览未能载入，正在读取精细表面：${error.message}`});
        }
      }
      return install(quality);
    })
    .catch((error) => {
      if (!disposed && generation === surfaceGeneration) {
        surfaceLoadError = error.message;
        onAnatomyStatus({
          error: true,
          message: `解剖肌肉载入失败：${error.message}`,
        });
      }
    }).finally(() => {
      if (surfaceRequest === controller) surfaceRequest = null;
    });
    return anatomyReady;
  }
  loadSurface(initialSurfaceQuality, progressiveSurface && initialSurfaceQuality === "detail");
  return {
    ready,
    get anatomyReady() { return anatomyReady; },
    setSurfaceQuality(quality) {
      if (quality !== "detail" && quality !== "preview") throw Error("未知的肌肉显示精度。");
      return quality === requestedQuality && (surfaceRequest || (anatomicalMuscles && quality === surfaceQuality))
        ? anatomyReady : loadSurface(quality);
    },
    update,
    previewPose(frame) {
      frameEpoch++;
      frameQueue.invalidate();
      applyFrame(frame, null, true);
    },
    async refinePose(frame) {
      const epoch = ++frameEpoch;
      frameQueue.invalidate();
      await anatomyReady;
      if (disposed || epoch !== frameEpoch) return false;
      if (!anatomicalMuscles) throw Error("肌肉表面尚未载入，请重新加载页面。");
      const prepared = surfaceQuality === "preview" ? null : await preparationQueue.run(() => anatomicalMuscles.prepareFrame(frame));
      if (disposed || epoch !== frameEpoch) return false;
      applyFrame(frame, prepared);
      return true;
    },
    async preparePlayback(movie, signal, progress, mode, units) {
      const pathsOnly = mode === "paths";
      frameQueue.invalidate();
      if (!pathsOnly) await preparationQueue.run(() => anatomyReady, signal);
      signal.throwIfAborted();
      if (!pathsOnly && !anatomicalMuscles) throw Error("无法准备回放：肌肉表面尚未载入。");
      const records = [], sequence = new Map(), buffers = new WeakSet();
      let bytes = 0;
      for (const frame of movie) {
        signal.throwIfAborted();
        if (pathsOnly) {
          const seen = new Set();
          for (const {name,path} of frame.muscles || []) {
            if (!units.has(name) || seen.has(name) || !Array.isArray(path) || path.length < 2 ||
                path.some(point => !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)))
              throw Error(`第 ${records.length + 1} 帧的肌腱路径无效：${name}`);
            seen.add(name);
          }
          if (seen.size !== units.size) throw Error(`第 ${records.length + 1} 帧缺少原生肌腱路径。`);
        }
        const prepared = pathsOnly || surfaceQuality === "preview" ? null : await preparationQueue.run(() => anatomicalMuscles.prepareFrame(frame, sequence), signal);
        signal.throwIfAborted();
        for (const values of prepared?.points.values() || []) {
          if (buffers.has(values)) continue;
          buffers.add(values);
          bytes += 2 * values.byteLength; // positions and their cached normals
        }
        if (bytes > maxSurfaceCacheBytes) throw Error(`肌肉帧缓存超过 ${Math.floor(maxSurfaceCacheBytes / (1024 * 1024))} MB，请缩短动作后重新准备。`);
        records.push({frame, prepared, pathsOnly});
        progress(records.length, movie.length);
        // Static frames can resolve immediately. Yield for paint and cancel.
        if (records.length % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      return records;
    },
    showPrepared({frame, prepared, pathsOnly}) {
      frameEpoch++;
      frameQueue.invalidate();
      applyFrame(frame, prepared, false, pathsOnly);
    },
    freezeDisplayedPose() {
      frameEpoch++;
      frameQueue.invalidate();
      return latest;
    },
    async whenFrameReady() {
      await frameQueue.whenIdle();
      if (renderFrame || gpuFence || renderRequested) await new Promise(resolve => renderWaiters.push(resolve));
    },
    selectJoint(name) {
      if (name && (!latest?.joints?.[name] || (explicitHandles && !explicitHandles.has(name)))) return false;
      selectJoint(name);
      return true;
    },
    projectJoints,
    getWorldPoint,
    setView,
    setMetadata,
    setRegion,
    fit,
    setRotationResult,
    setRotationPending(pending, context = {}) {
      rotationPending = Boolean(pending);
      pendingStep = context?.joint && context?.coordinate ? context : null;
      labelPosition();
    },
    setInteractionMessage(_message, pending = false) {
      // The application status and joint warning show failures; no canvas prose.
      if (!pending && !drag) dragTarget.hidden = true;
    },
    setPlaybackActive(active) {
      if (playbackActive === active) return;
      playbackActive = active;
      container.classList.toggle("motion-playing", active);
      if (!active) labelPosition();
    },
    regions: availableRegions,
    setEditing(value) {
      editing = !readOnly && Boolean(value);
      labelPosition();
    },
    setHandlesVisible(value) {
      handlesVisible = !readOnly && Boolean(value);
      labelPosition();
    },
    setMusclesVisible(value) {
      invalidatePicking();
      musclesVisible = Boolean(value);
      transitionPreview?.setVisible(musclesVisible && muscleDisplay === "anatomy");
      if (muscleMesh)
        muscleMesh.visible = !previewing && musclesVisible && muscleDisplay === "paths";
      updateBranchVisibility();
      anatomicalMuscles?.setVisible(
        !previewing && !onlyPaths && hasAnatomicalFrame && musclesVisible && muscleDisplay === "anatomy",
      );
      render();
    },
    setMuscleDisplay(value) {
      if (!["anatomy", "paths"].includes(value)) return;
      muscleCard.hidden = true;
      muscleDisplay = value;
      transitionPreview?.setVisible(musclesVisible && value === "anatomy");
      if (muscleMesh) muscleMesh.visible = !previewing && musclesVisible && value === "paths";
      updateBranchVisibility();
      anatomicalMuscles?.setVisible(!previewing && !onlyPaths && hasAnatomicalFrame && musclesVisible && value === "anatomy");
      if (latest && value === "anatomy" && !previewing) update(latest);
      else if (latest && (!anatomicalMuscles || hasAnatomicalFrame)) applyFrame(latest, null, previewing, onlyPaths);
      else render();
    },
    setBonesVisible(value) {
      invalidatePicking();
      bonesVisible = Boolean(value);
      boneRoot.visible = bonesVisible || previewing;
      render();
    },
    setGroundEnabled(value) {
      floor.visible = Boolean(value);
      grid.visible = Boolean(value);
      groundLabel.hidden = !value;
      render();
    },
    setSelected(name, { preserveSurfaceCard = false } = {}) {
      selectedMuscle = name;
      anatomicalMuscles?.setSelected(name);
      if (!name || (muscleDisplay === "anatomy" && !preserveSurfaceCard))
        muscleCard.hidden = true;
      else if (!muscleCard.hidden && muscleDisplay === "paths")
        showMuscleName(name);
      if (latest)
        updateMuscleColors(
          latest.muscles.filter(
            (record) => record.name && Array.isArray(record.path),
          ),
        );
      render();
    },
    get state() {
      return {
        view,
        region,
        ready: readyGeometry,
        jointCount: labels.size,
        muscleCount: latest?.muscles?.length || muscleNames.length,
        muscleDisplay,
        surfaceQuality,
        surfaceLoadError,
        showPreview: Boolean(transitionPreview || (surfaceQuality === "preview" && hasAnatomicalFrame)),
        anatomicalMuscles: anatomicalMuscles?.status || null,
        selectedJoint,
        drawCalls: renderer.info.render.calls,
        renderBusy: Boolean(renderFrame || gpuFence),
        renderTiming: { ...lastRenderTiming },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeTransitionPreview();
      surfaceRequest?.abort();
      frameQueue.dispose();
      preparationQueue.dispose();
      cancelAnimationFrame(renderFrame);
      renderFrame = 0;
      clearTimeout(fenceTimer);
      if (gpuFence) renderer.getContext().deleteSync(gpuFence);
      gpuFence = null;
      for (const resolve of renderWaiters.splice(0)) resolve();
      cancelAnimationFrame(hoverFrame);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("pointerdown", onTouchNear, true);
      container.removeEventListener("keydown", onEscape);
      window.removeEventListener("keydown", onEscape, true);
      resizeObserver.disconnect();
      controls.dispose();
      if (anatomicalMuscles) {
        scene.remove(anatomicalMuscles.object);
        anatomicalMuscles.dispose();
      }
      disposeObject(scene);
      // Three's async compiler polls renderer.properties until linking ends.
      // Clearing those properties early leaves its promise permanently pending.
      if (pendingCompilation)
        pendingCompilation.then(() => renderer.dispose(), () => renderer.dispose());
      else renderer.dispose();
      renderer.domElement.remove();
      overlay.remove();
      jointCard.remove();
      container.style.position = priorPosition;
    },
  };
}
