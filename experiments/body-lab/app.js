import { createBodyView } from "./fullbody-view.js";
import { assertCompleteResult, cachedForceSeries, cachedMuscleRanges, loadCachedMotion, sceneSignature } from "./motion-cache.js";

const $ = (id) => document.getElementById(id);
const replay = document.querySelector('meta[name="bodyvista-mode"][content="replay"]')
  ? await import("./public-replay.js") : null;
replay?.preparePublicReplay();
let store = null;
const regionLabels = {
  all: "全身",
  neck: "头颈",
  trunk: "脊柱与腹部",
  ribs: "胸廓",
  arm_r: "右臂",
  arm_l: "左臂",
  hand_r: "右手与手指",
  hand_l: "左手与手指",
  leg_r: "右腿",
  leg_l: "左腿",
  foot_r: "右足",
  foot_l: "左足",
};
const clone = (value) => structuredClone(value);
const removedBarbellNotice = "杠铃已移除；原动作已备份，姿势和时间已保留，负重已清零。需要负重时请重新选择哑铃。";
const fmt = (value, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";
const norm = (v) => (Array.isArray(v) ? Math.hypot(...v) : Number.NaN);
const coordinateLabels = {
  pelvis_tx: "骨盆前后",
  pelvis_ty: "骨盆高度",
  pelvis_tz: "骨盆左右",
  pelvis_tilt: "骨盆前倾",
  pelvis_list: "骨盆侧倾",
  pelvis_rotation: "骨盆转向",
  hip_flexion: "髋屈伸",
  hip_adduction: "髋内收",
  hip_rotation: "髋旋转",
  knee_angle: "膝屈曲",
  knee_rotation: "膝内外旋",
  ankle_angle: "踝屈伸",
  lumbar_extension: "躯干伸展",
  lumbar_bending: "躯干侧屈",
  lumbar_rotation: "躯干旋转",
  arm_flex: "肩屈伸",
  arm_add: "肩内收",
  arm_rot: "肩旋转",
  elbow_flex: "肘屈曲",
  pro_sup: "前臂旋转",
  wrist_flex: "腕屈伸控制角",
  wrist_dev: "腕偏转控制角",
  elbow_flexion: "肘屈曲",
  shoulder_elv: "肩抬举",
  elv_angle: "肩抬举方向",
  shoulder_rot: "肩旋转",
  flexion: "腕屈伸控制角",
  deviation: "腕偏转控制角",
  subtalar_angle: "距下关节",
  mtp_angle: "跖趾屈伸",
};
const isWristControl = (name) => /^(?:flexion|deviation|wrist_flex|wrist_dev)_[rl]$/.test(name);
function coordLabel(name) {
  const spine = /^(.*?)_(FE|LB|AR)$/.exec(name);
  if (spine)
    return `${spine[1].replace("T1_head_neck", "头颈").replace("Abs", "腹部").replaceAll("_", "–")} · ${{ FE: "屈伸", LB: "侧屈", AR: "旋转" }[spine[2]]}`;
  const rib = /^T\d+_r(\d+)(R|L)_([XYZ])$/.exec(name);
  if (rib)
    return `${rib[2] === "R" ? "右" : "左"}第 ${rib[1]} 肋 · ${rib[3]} 轴`;
  const finger = /^(\d?)(cmc|mcp|mp|ip|pm|md)_(flexion|abduction)(_l)?$/.exec(
    name,
  );
  if (finger)
    return `${finger[4] ? "左" : "右"}${{ 2: "食", 3: "中", 4: "环", 5: "小" }[finger[1]] || "拇"}指${{ cmc: "腕掌", mcp: "掌指", mp: "掌指", ip: "指间", pm: "近端指间", md: "远端指间" }[finger[2]]} · ${finger[3] === "flexion" ? "屈伸" : "外展"}`;
  const match = /^(.*)_([rl])$/.exec(name);
  return match
    ? `${match[2] === "r" ? "右" : "左"}${coordinateLabels[match[1]] || match[1]}`
    : coordinateLabels[name] || name;
}
let info,
  coordinates = [],
  defaults = {},
  draft = {},
  keys = [],
  selected = -1;
let frame,
  result = null,
  frames = [],
  index = 0,
  playing = false,
  playStart = 0;
let viewMode = "front",
  pendingGear = null,
  gearType = "none",
  gearMassKg = 0,
  gearFriction = 1,
  revision = 0;
let solving = false,
  gripBusy = false,
  poseBusy = false,
  queuedPose = null,
  dragQueue = null,
  dragBusy = false,
  rotationGesture = null,
  keyboardRotation = null;
let coverage = null,
  lastError = "";
let pendingKey = null;
let selectedAnatomicalMuscle = null;
let torqueRows = null,
  chartCache = null;
let gripUndo = null;
const gripDisabledControls = new Map();
let appliedHand = "right";
let lastNonFootSupport = "free";
let verifiedLoading = false;
let beforeVerified = null;
let editorMotionId = null;
const MUSCLE_CHANGE_EPSILON_N = 0.01;
let muscleVariations = new Map();
let displayedFrame = null;
const displayedSources = new WeakMap();
let movieCache = null, moviePreparation = null;
let playbackTick = 0, lastPlaybackDraw = -Infinity;
let playbackInterval = 50, slowRenderCount = 0, lastPlaybackTick = 0;
let selectedJointName = null;
let seekTick = 0;
let surfaceStage = "", surfaceTicket = 0;
let requestedVisual = null, paintedSurface = null;
function setSurfaceStage(stage) {
  surfaceStage = stage;
  $("surfaceStage").textContent = stage;
  $("surfaceStage").hidden = !stage;
}
function wrapFrame(value, lazy = false) {
  const visual = Object.assign(lazy ? Object.create(value) : { ...value }, { equipment: equipment() });
  displayedSources.set(visual, value);
  return visual;
}

const view = createBodyView($("bodyView"), {
  readOnly: Boolean(replay),
  progressiveSurface: Boolean(replay),
  initialSurfaceQuality: "detail",
  maxPixelRatio: 1,
  maxRenderPixels: 1_000_000,
  jointInspectorMount: $("jointInspectorMount"),
  showRegionSelector: false,
  onRenderTiming({ elapsedMs, stalled }) {
    if (!playing) return;
    slowRenderCount = elapsedMs > 250 ? slowRenderCount + 1 : 0;
    if (stalled || slowRenderCount >= 3) {
      pause();
      setPlaybackHealth("绘制负荷较高，已自动暂停。当前姿势已保留，可逐帧查看。");
      status("绘制负荷较高，已自动暂停。当前姿势已保留，可逐帧查看。", true);
      return;
    }
    // Leave time between full-resolution draws instead of filling the GPU queue.
    playbackInterval = Math.min(250, Math.max(50, elapsedMs * 2, playbackInterval * 0.98));
    if (playbackInterval > 85)
      setPlaybackHealth(`播放中 · ${Math.max(1, Math.floor(1000 / playbackInterval))} 帧/秒`);
  },
  onFrameDisplayed(value, {refined}) {
    paintedSurface = refined ? value : null;
    updateCaptureButtons();
    displayedFrame = displayedSources.get(value) || null;
    if (!displayedFrame) return;
    $("poseLabel").textContent = playing || frames.length
      ? `动作 ${fmt(displayedFrame.t || 0, 2)} s`
      : "";
    if (frames.includes(displayedFrame)) {
      $("clock").textContent = `${fmt(displayedFrame.t, 2)} / ${fmt(frames.at(-1).t, 2)} s`;
      if (result) drawResults();
    }
  },
  coordinateLabel: (name) => coordLabel(name),
  onJointRotate: (data) => handleJointRotate(data),
  onAnatomyStatus: (value) => {
    if (replay) replay.showSurfaceStatus(value, view.state);
    if (value.ready && view.state.surfaceQuality === "preview") {
      $("surfaceContactScope").textContent = "轻量表面沿骨骼运动。受力来自原动作的肌腱计算，播放时不重新求肌肉接触。";
    } else if (value.ready && value.boneContact) {
      const c = value.boneContact;
      $("surfaceContactScope").textContent = `本模型提供 ${c.boneCount} 个骨碰撞体积。当前图谱有 ${c.surfaces} 个表面启用肌肉与骨的接触修正；肌肉之间没有全身通用的接触求解。画面上两块肌肉挤在一起，不会产生对应的接触力读数。`;
    }
    if ($("muscleDisplay")?.value !== "paths")
      $("renderNote").textContent = value.message;
  },
  onRegionChange: (region) => {
    if (!info) return;
    selectedAnatomicalMuscle = null;
    $("coordinateRegion").value = region;
    if ($("jointRegion")) $("jointRegion").value = region;
    renderJointList();
    $("muscleRegion").value = region;
    populateCoordinates();
    populateMuscles();
    drawResults();
  },
  onViewChange: (name) => {
    viewMode = name;
    document
      .querySelectorAll("[data-view]")
      .forEach((button) =>
        button.classList.toggle("selected", button.dataset.view === name),
      );
  },
  onSelect: (name) => {
    selectedAnatomicalMuscle = name?.atlasId ? name : null;
    const key = typeof name === "string" ? name : name?.name;
    if (!key) {
      $("selectionLabel").textContent = "选择关节或肌肉";
      return;
    }
    if (pendingGear && /hand|wrist|capitate|proximal_row/.test(key)) {
      attachGear(pendingGear, /_l|left/.test(key) ? "left" : "right");
      return;
    }
    if (name?.type === "joint") {
      selectedJointName = name.name;
      showInspector("selection");
      syncJointSelection(name.coordinate);
      $("selectionLabel").textContent =
        name.label;
      return;
    }
    if (name?.atlasId) {
      showInspector("forces");
      $("selectionLabel").textContent =
        `${name.label}${name.tissueType === "tendon" ? " · 跟腱连接表面" : name.mapping === "group" ? ` · 对应 ${name.units.length} 个计算单元` : name.mapping === "unmapped" ? " · 尚无计算单元映射" : ""}`;
      if (!info?.muscles.some((m) => m.name === key)) {
        $("muscleSelect").value = "";
        $("muscleValue").textContent = "— N";
        $("muscleNote").textContent =
          name.tissueType === "tendon"
            ? "此跟腱用于显示肌腹与跟骨的连续连接，不作为独立肌肉，也不提供单独的肌力数值。"
            : "此解剖肌肉尚未映射到计算单元，不显示推断张力。";
        drawResults();
        return;
      }
    }
    if (info?.muscles.some((m) => m.name === key)) {
      $("muscleRegion").value = "all";
      $("muscleSearch").value = "";
      const changingKey = [key, ...(name?.units || [])].find((unit) =>
        muscleVariations.has(unit),
      );
      populateMuscles(changingKey);
      $("muscleSelect").value = changingKey || "";
      view.setSelected(name?.atlasId || changingKey || null, {
        preserveSurfaceCard: Boolean(name?.atlasId),
      });
      if (!name?.atlasId)
        $("selectionLabel").textContent =
          $("muscleSelect").selectedOptions[0]?.textContent || key;
      drawResults();
    }
  },
});

async function api(path, body, signal) {
  if (replay) {
    if (path !== "model" || body !== undefined)
      throw Error("自定义动作请使用“设计动作”中的本机实验台。");
    const response = await fetch("./fullbody-model-data.json", { signal });
    if (!response.ok) throw Error(`无法载入动作模型（${response.status}）。`);
    return response.json();
  }
  if (body && info?.computationSha256)
    body = { ...body, computationSha256: info.computationSha256 };
  if (body && ["pose", "rotate"].includes(path))
    body = {
      equipment: equipment(),
      loadKg: equipment().massKg,
      hand: equipment().hand,
      ...body,
    };
  const reply = await fetch(
    `/api/fullbody/${path}`,
    body === undefined
      ? { signal }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
  );
  let value;
  try {
    value = await reply.json();
  } catch {
    throw Error("本地服务未返回可读取的结果。");
  }
  if (!reply.ok) {
    const error = Error(value.error || `请求失败（${reply.status}）`);
    error.status = reply.status;
    throw error;
  }
  if (
    path !== "model" &&
    info?.computationSha256 &&
    value.computationSha256 !== info.computationSha256
  )
    throw Error("计算服务版本与页面不一致，请刷新页面后重新计算。");
  return value;
}
function status(text, error = false) {
  $("status").textContent = text;
  $("status").title = `${text}（点击查看完整消息）`;
  $("status").classList.toggle("error", error);
  if ($("statusDetail")) $("statusDetail").textContent = text;
  if ($("statusNotice")) $("statusNotice").hidden = !error;
  if (error) lastError = text;
}
function setPlaybackHealth(text) {
  if ($("playbackHealth")) $("playbackHealth").textContent = text;
}
function updatePanelButtons() {
  for (const [id, name, label, openText] of [["toggleWorkspace", "workspaceCollapsed", replay ? "动作" : "工具", "‹"], ["toggleInspector", "inspectorCollapsed", replay ? "受力" : "详情", "›"]]) {
    const button = $(id);
    if (!button) continue;
    const collapsed = document.body.dataset[name] === "true";
    button.textContent = collapsed ? label : openText;
    button.setAttribute("aria-label", `${collapsed ? "展开" : "收起"}${label}`);
    button.setAttribute("aria-expanded", String(!collapsed));
  }
}
function showWorkspace(name) {
  for (const button of document.querySelectorAll("[data-workspace-tab]")) {
    const active = button.dataset.workspaceTab === name;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    button.classList.toggle("selected", active);
  }
  for (const panel of document.querySelectorAll("[data-workspace-panel]"))
    panel.hidden = panel.dataset.workspacePanel !== name;
  document.body.dataset.workspaceCollapsed = "false";
  $("toggleWorkspace")?.setAttribute("aria-expanded", "true");
  if (matchMedia("(max-width: 760px)").matches) {
    document.body.dataset.inspectorCollapsed = "true";
    $("toggleInspector")?.setAttribute("aria-expanded", "false");
  }
  updatePanelButtons();
}
function showInspector(name) {
  for (const button of document.querySelectorAll("[data-inspector-tab]")) {
    const active = button.dataset.inspectorTab === name;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const panel of document.querySelectorAll("[data-inspector-panel]"))
    panel.hidden = panel.dataset.inspectorPanel !== name;
  document.body.dataset.inspectorCollapsed = "false";
  $("toggleInspector")?.setAttribute("aria-expanded", "true");
  if (matchMedia("(max-width: 760px)").matches) {
    document.body.dataset.workspaceCollapsed = "true";
    $("toggleWorkspace")?.setAttribute("aria-expanded", "false");
  }
  if (name === "forces") drawResults();
  updatePanelButtons();
}
function syncJointSelection(activeCoordinate) {
  for (const button of document.querySelectorAll("#jointList [data-joint-name]"))
    button.setAttribute("aria-pressed", String(button.dataset.jointName === selectedJointName));
  const joint = info?.handles.find(handle => handle.name === selectedJointName);
  if (!joint) return;
  $("coordinateRegion").value = joint.region;
  populateCoordinates();
  const coordinate = activeCoordinate || joint.localCoordinates?.[0];
  if (coordinate) $("coordinate").value = coordinate;
  updateCoordinate();
}
function renderJointList() {
  const list = $("jointList");
  if (!list || !info) return;
  const query = ($("jointSearch")?.value || "").trim().toLocaleLowerCase();
  const region = $("jointRegion")?.value || "all";
  const matches = info.handles.filter(handle => handle.editable !== false &&
    handle.localCoordinates?.length && (region === "all" || handle.region === region) &&
    (query ? `${handle.label} ${handle.name} ${regionLabels[handle.region]}`.toLocaleLowerCase().includes(query)
      : region !== "all" || handle.overview));
  const order = ["humerus_r", "humerus_l", "ulna_r", "ulna_l", "radius_r", "radius_l", "capitate", "capitate_l", "femur_r", "femur_l", "tibia_r", "tibia_l", "talus_r", "talus_l", "calcn_r", "calcn_l", "toes_r", "toes_l", "head_neck", "thoracic1", "lumbar5", "pelvis"];
  const rank = name => { const i = order.indexOf(name); return i < 0 ? order.length : i; };
  matches.sort((a, b) => rank(a.name) - rank(b.name));
  list.replaceChildren();
  for (const handle of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.jointName = handle.name;
    button.textContent = handle.label;
    button.setAttribute("aria-pressed", String(handle.name === selectedJointName));
    button.disabled = !frame || solving || gripBusy || poseBusy || dragBusy || verifiedLoading || playing || Boolean(moviePreparation);
    button.onclick = () => {
      if (button.disabled) return;
      if (view.state.region !== handle.region && view.state.region !== "all") view.setRegion(handle.region, { fit: true });
      view.selectJoint(handle.name);
    };
    list.append(button);
  }
  if ($("jointListHint")) $("jointListHint").textContent = matches.length
    ? `${matches.length} 个${!query && region === "all" ? "常用" : "可编辑"}关节`
    : "没有匹配的关节";
}
function playbackSpeed() { return Number($("playbackSpeed")?.value || 1); }
function equipment() {
  return {
    type: gearMassKg > 0 ? gearType : "none",
    massKg: gearType === "none" ? 0 : gearMassKg,
    hand: appliedHand,
    friction: gearFriction,
  };
}
function inputScene() {
  return {
    keyframes: keys.map(({ t, q }) => ({ t, q })),
    support: $("support").value,
    groundEnabled: $("groundToggle").getAttribute("aria-pressed") === "true",
    supportFeet: $("supportFeet").value,
    loadKg: equipment().massKg,
    hand: equipment().hand,
    strengthScale: Number($("strengthScale").value),
    equipment: equipment(),
  };
}
function save() {
  if (replay) return;
  try {
    localStorage.setItem(
      store,
      JSON.stringify({ schema: 1, model: info.id, ...inputScene(), draft }),
    );
    if ($("workspaceStatus")) $("workspaceStatus").textContent = "已保存到本机";
  } catch {
    if ($("workspaceStatus")) $("workspaceStatus").textContent = "未能自动保存 · 请导出动作";
    status("浏览器存储不可用；请导出实验以保存。", true);
  }
}
function pause() {
  if (moviePreparation) {
    moviePreparation.abort();
    moviePreparation = null;
    setSurfaceStage("");
    setPlaybackHealth("已取消准备");
  } else if (playing) {
    setPlaybackHealth("已暂停");
  }
  playing = false;
  view.setPlaybackActive(false);
  cancelAnimationFrame(playbackTick);
  playbackTick = 0;
  $("play").textContent = "播放";
  $("play").title = "播放或暂停（空格）";
  $("play").setAttribute("aria-pressed", "false");
  view.setEditing(!solving && !gripBusy && !verifiedLoading);
  updateButtons();
}
function invalidate(message = "姿势或条件已改变，请重新计算。", fast = false) {
  if (editorMotionId) {
    editorMotionId = null;
    for (const button of $("verifiedMotionList").querySelectorAll('[aria-pressed="true"]'))
      button.setAttribute("aria-pressed", "false");
    if (window.parent !== window) window.parent.postMessage({type: "bodyvista:muscle-case", id: null}, location.origin);
  }
  revision += 1;
  if (/本次实际计算|已打开固定案例/.test($("verifiedSelection").textContent))
    $("verifiedSelection").textContent =
      "动作或计算状态已更新；通过状态以接下来的实际计算结果为准。";
  pause();
  movieCache = null;
  ++surfaceTicket;
  setSurfaceStage("");
  result = null;
  frames = [];
  $("solveDiagnosis").hidden = true;
  $("failureActions").replaceChildren();
  muscleVariations.clear();
  populateMuscles();
  index = 0;
  $("play").disabled = true;
  $("timeline").disabled = true;
  $("resultKind").textContent = "待重新计算";
  $("clock").textContent = "0.00 / 0.00 s";
  if (frame) {
    frame = {
      ...frame,
      grasp: frame.grasp ? { ...frame.grasp, feasible: null } : undefined,
      muscles: (frame.muscles || []).some(
        (muscle) =>
          Number.isFinite(muscle.force) || Number.isFinite(muscle.activation) ||
          muscle.branches?.some((branch) => Number.isFinite(branch.force)),
      )
        ? frame.muscles.map(({ force, activation, ...muscle }) => ({
            ...muscle,
            ...(muscle.branches ? { branches: muscle.branches.map((branch) => ({ ...branch, force: null })) } : {}),
          }))
        : frame.muscles,
    };
    showFrame(frame, { fast });
  }
  clearResults();
  status(message);
  updateButtons();
}
function captureGripProblem() {
  if (pendingGear || Number($("loadKg").value) !== equipment().massKg)
    return "器械设置尚未应用。请点“握住选定器械”，或卸下器械后再记录和计算。";
  return Number($("loadKg").value) > 0 && (gearType === "none" || frame?.grasp?.geometryValid !== true)
    ? "当前负重尚未形成有效握持。请在“器械与地面”点击“握住选定器械”，再记录或替换关键帧。"
    : "";
}
function canCapturePose() {
  return Boolean(info && frame && requestedVisual && paintedSurface === requestedVisual &&
    !playing && !moviePreparation && !solving && !poseBusy && !dragBusy && !gripBusy && !verifiedLoading &&
    !rotationGesture && frame.anatomy?.valid !== false && !captureGripProblem());
}
function canCheckPose() {
  return Boolean(info && frame && requestedVisual && paintedSurface === requestedVisual &&
    !playing && !moviePreparation && !solving && !poseBusy && !dragBusy && !gripBusy && !verifiedLoading &&
    !rotationGesture && !captureGripProblem() && $("loadKg").checkValidity());
}
function updateCaptureButtons() {
  const ready = canCapturePose(),
    gripProblem = captureGripProblem();
  $("confirm").disabled = !ready || keys.length >= 10;
  $("replace").disabled = !ready || selected < 0;
  $("confirm").textContent = gripProblem
    ? "请先握住器械"
    : keys.length ? "+ 添加关键帧" : "记录第一个姿势";
  $("replace").textContent = gripProblem ? "握持未就绪，不能替换" : "替换选中帧";
  $("confirm").title = gripProblem;
  $("replace").title = gripProblem;
  $("checkPose").disabled = !canCheckPose();
}
function updateButtons() {
  const updating =
    solving || poseBusy || dragBusy || gripBusy || verifiedLoading || playing || Boolean(moviePreparation);
  for (const button of document.querySelectorAll(
    "#verifiedMotionList button, [id^='example'], #failureActions button",
  ))
    button.disabled = !info || updating;
  $("restoreBeforeVerified").hidden = !beforeVerified;
  $("restoreBeforeVerified").disabled = updating;
  view.setRotationPending?.(
    updating,
    dragBusy && !poseBusy && keyboardRotation
      ? {
          joint: keyboardRotation.joint,
          coordinate: keyboardRotation.coordinate,
        }
      : {},
  );
  for (const button of $("keyframes").querySelectorAll(".keyframe-main"))
    button.disabled = updating;
  for (const control of document.querySelectorAll("#keyframes input, #keyframes .keyframe-tools button, #jointList button, #newSequence, #import, #support, #supportFeet, #strengthScale, #coordinateValue, #coordinate, #coordinateRegion, #jointRegion, #jointSearch"))
    control.disabled = !info || updating;
  for (const id of ["previousFrame", "nextFrame"])
    if ($(id)) $(id).disabled = !frames.length || solving || gripBusy || verifiedLoading || Boolean(moviePreparation);
  if ($("keyframeCount")) $("keyframeCount").textContent = replay ? `${keys.length} 个关键帧` : `${keys.length} / 10`;
  updateCaptureButtons();
  $("resetPose").disabled = !info || updating || Boolean(rotationGesture);
  $("groundToggle").disabled = !info || updating || Boolean(rotationGesture);
  $("applyCoordinate").disabled = !info || updating;
  for (const id of ["loadKg", "hand", "regrip", "unload"])
    $(id).disabled = !info || updating;
  for (const button of document.querySelectorAll(".equipment"))
    button.disabled = !info || updating;
  $("undoGrip").hidden = !gripUndo || gripUndo.revision !== revision;
  $("undoGrip").disabled = updating;
  $("solve").disabled =
    !info || updating || keys.length < 2 || !$("loadKg").checkValidity() || Boolean(captureGripProblem());
  $("preview").disabled = !info || updating || keys.length < 2 || Boolean(captureGripProblem());
  $("solve").title = $("preview").title = captureGripProblem();
  if (gripBusy) {
    for (const control of document.querySelectorAll("button, input, select")) {
      if (!gripDisabledControls.has(control))
        gripDisabledControls.set(control, control.disabled);
      control.disabled = true;
    }
  }
}
function finishGripOperation() {
  gripBusy = false;
  for (const [control, disabled] of gripDisabledControls)
    if (control.isConnected) control.disabled = disabled;
  gripDisabledControls.clear();
  $("play").disabled = !frames.length;
  $("timeline").disabled = !frames.length;
  updateButtons();
}
let poseCheckRevision = 0;
function clearPoseCheck() {
  poseCheckRevision += 1;
  const report = $("poseCheckReport");
  if (report.textContent) report.textContent = "";
  report.classList.remove("error");
}
function showFrame(value, { fast = false, record = null } = {}) {
  clearPoseCheck();
  frame = value;
  if (value.q) draft = clone(value.q);
  ++surfaceTicket;
  requestedVisual = record?.frame || wrapFrame(value);
  if (fast) {
    setSurfaceStage(view.state.surfaceQuality === "detail"
      ? "关节预览 · 松手后更新精细肌肉表面和已启用的接触。"
      : "关节预览 · 松手后更新轻量肌肉表面。");
    view.previewPose(requestedVisual);
  } else {
    if (!moviePreparation) setSurfaceStage("");
    if (record) view.showPrepared(record);
    else view.update(requestedVisual);
  }
  updateGripNote();
  const invalidPose = value.anatomy?.valid === false;
  $("anatomyNote").textContent = invalidPose
    ? `姿势超出约束：${anatomyReason(value)}。请调整后再确认关键帧。`
    : "关节范围与身体防穿插检查生效；拖到边界时会停止。";
  $("anatomyNote").classList.toggle("error", invalidPose);
  if (invalidPose) {
    const explanation = $("anatomyNote").closest("details");
    if (explanation) explanation.open = true;
  }
  if (!playing) updateButtons();
}
async function finishSurfacePreview() {
  if (!surfaceStage.startsWith("关节预览") || !frame) return;
  const ticket = ++surfaceTicket;
  requestedVisual = wrapFrame(frame);
  setSurfaceStage(view.state.surfaceQuality === "detail"
    ? "正在计算松手姿势的精细表面和已启用的接触…"
    : "正在显示松手姿势的轻量肌肉表面…");
  updateButtons();
  try {
    if (!await view.refinePose(requestedVisual) || ticket !== surfaceTicket) return;
    setSurfaceStage("");
  } catch (error) {
    if (ticket !== surfaceTicket) return;
    setSurfaceStage(`肌肉表面未完成：${error.message} 请重试旋转。`);
  } finally {
    if (ticket === surfaceTicket) updateButtons();
  }
}
function anatomyReason(value) {
  return (
    (value.anatomy?.issues || [])
      .map((issue) => {
        if (typeof issue === "string") return issue;
        if (issue.kind === "joint-combination" && issue.coordinates?.length) {
          const joint = coordLabel(issue.coordinates[0])
            .split(" · ")[0]
            .replace(/(?:屈伸|屈曲|内收|偏转|外展|旋转)(?:控制角)?$/, "");
          return `${joint}的多方向组合超出当前保守限制`;
        }
        return issue.message || issue.label || issue.reason || issue.code;
      })
      .filter(Boolean)
      .slice(0, 3)
      .join("；") || "不满足当前关节联合范围或身体防穿插检查"
  );
}
async function setDraft(
  q,
  { invalidateResult = true, allowInvalid = false } = {},
) {
  if (solving || gripBusy) return status("当前操作完成后再调整姿势。", true);
  if (invalidateResult) invalidate();
  draft = clone(q);
  queuedPose = { q: clone(q), revision, allowInvalid };
  updateCoordinate();
  if (poseBusy) return;
  poseBusy = true;
  let accepted = false;
  updateButtons();
  try {
    while (queuedPose) {
      const request = queuedPose;
      queuedPose = null;
      try {
        const next = await api("pose", { q: request.q });
        if (request.revision === revision && !queuedPose) {
          if (next.anatomy?.valid === false && !request.allowInvalid)
            throw Error(anatomyReason(next));
          draft = clone(next.q || request.q);
          showFrame(next);
          updateCoordinate();
          save();
          accepted = true;
        }
      } catch (error) {
        if (request.revision === revision && !queuedPose) {
          draft = clone(frame?.q || defaults);
          updateCoordinate();
          status(`姿势未更新，保留当前画面：${error.message}`, true);
        }
      }
    }
  } finally {
    poseBusy = false;
    updateButtons();
  }
  return accepted;
}
async function handleJointRotate(data) {
  if (!info || solving || gripBusy) return;
  const { name, phase, angleDelta } = data;
  if (phase === "cancel") {
    revision += 1;
    rotationGesture = null;
    keyboardRotation = null;
    dragQueue = null;
    void finishSurfacePreview();
    save();
    view.setInteractionMessage("已结束旋转，保留最后接受的姿势。");
    return;
  }
  if (pendingGear) return;
  if (poseBusy || (phase === "start" && dragBusy)) return;
  if (
    phase === "step" &&
    dragBusy &&
    (!keyboardRotation ||
      keyboardRotation.revision !== revision ||
      keyboardRotation.joint !== name ||
      keyboardRotation.coordinate !== data.coordinate ||
      keyboardRotation.mode !== (data.mode || "source-joint"))
  )
    return;
  if (phase === "start") {
    const visible = view.freezeDisplayedPose();
    if (visible) {
      frame = displayedSources.get(visible) || visible;
      draft = clone(frame.q || draft);
    }
    const q = clone(draft);
    invalidate("旋转关节后，确认此姿势为关键帧。", true);
    rotationGesture = {
      joint: name,
      q,
      axis: [...data.axis],
      mode: data.mode || "source-joint",
      coordinate: data.coordinate,
      revision,
    };
    const wristControl = (data.mode || "source-joint") === "source-joint" && isWristControl(data.coordinate);
    view.setInteractionMessage(wristControl
      ? "拖动圆环调整腕部控制角；两级腕骨联动，前臂保持固定。"
      : "拖动圆环旋转本级关节，上级保持固定。", true);
    $("draftState").textContent =
      `${wristControl ? "正在调整腕部控制角" : "正在旋转本级关节"}；已确认的关键帧不会自动改变。`;
    return;
  }
  if (!Number.isFinite(angleDelta)) return;
  if (phase === "step") {
    // Repeated keys can arrive before the first response. Accumulate against
    // one frozen start pose, just as a pointer gesture accumulates ring angle.
    const mode = data.mode || "source-joint";
    if (
      !keyboardRotation ||
      keyboardRotation.revision !== revision ||
      keyboardRotation.joint !== name ||
      keyboardRotation.coordinate !== data.coordinate ||
      keyboardRotation.mode !== mode ||
      (mode === "strict-plane" &&
        keyboardRotation.axis.some(
          (value, i) => Math.abs(value - data.axis[i]) > 1e-8,
        ))
    ) {
      const visible = view.freezeDisplayedPose();
      if (visible) {
        frame = displayedSources.get(visible) || visible;
        draft = clone(frame.q || draft);
      }
      const q = clone(draft);
      invalidate("旋转关节后，确认此姿势为关键帧。");
      rotationGesture = null;
      keyboardRotation = {
        joint: name,
        q,
        axis: [...data.axis],
        mode,
        coordinate: data.coordinate,
        revision,
        angleDelta: 0,
        lastAcceptedAngleDelta: 0,
      };
    }
    keyboardRotation.angleDelta += angleDelta;
    dragQueue = { ...keyboardRotation };
  } else {
    if (!rotationGesture || rotationGesture.joint !== name) return;
    dragQueue = { ...rotationGesture, angleDelta };
    if (phase === "end") rotationGesture = null;
  }
  if (dragBusy) return;
  dragBusy = true;
  updateButtons();
  let previousRequest = null;
  const deadline = performance.now() + 15000;
  try {
    while (dragQueue) {
      const request = dragQueue;
      dragQueue = null;
      if (request.revision !== revision) continue;
      if (
        previousRequest?.revision === request.revision &&
        previousRequest.joint === request.joint &&
        Math.abs(request.angleDelta - previousRequest.angleDelta) < 1e-8
      )
        continue;
      let next;
      try {
        next = await api("rotate", {
          q: request.q,
          joint: request.joint,
          axis: request.axis,
          angleDelta: request.angleDelta,
          mode: request.mode,
          coordinate: request.coordinate,
        });
      } catch (error) {
        if (request.revision !== revision) continue;
        if (error.status === 429 && performance.now() < deadline) {
          dragQueue ||= request;
          view.setInteractionMessage(
            "正在更新关节，将使用最后的旋转角度。",
            true,
          );
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }
        throw error;
      }
      if (request.revision !== revision) continue;
      const value = next.pose || next;
      const rotation = value.rotation || next.rotation;
      previousRequest = rotation?.accepted === false ? null : request;
      if (keyboardRotation?.q === request.q && keyboardRotation.revision === request.revision) {
        if (rotation?.accepted === false) {
          const rejectedDelta = request.angleDelta - keyboardRotation.lastAcceptedAngleDelta;
          keyboardRotation.angleDelta -= rejectedDelta;
          if (dragQueue?.q === request.q) dragQueue.angleDelta -= rejectedDelta;
        } else keyboardRotation.lastAcceptedAngleDelta = request.angleDelta;
      }
      // A rejected solve contains the gesture's start pose. Keep the last
      // accepted picture instead of snapping back to that frozen snapshot.
      if (rotation?.accepted !== false) {
        draft = clone(value.q || next.q);
        showFrame(value, { fast: request.q !== keyboardRotation?.q });
        updateCoordinate();
      }
      const currentSelection = view.setRotationResult(rotation, request);
      const message =
        (rotation?.accepted !== false && rotationGesture
          ? "拖动中：骨骼和器械先随动，松手后更新肌肉。"
          : rotation?.reason) ||
        (rotation?.accepted === false
          ? request.mode === "strict-plane"
            ? "当前关节不能在此视平面旋转；请对准旋转面后重试。"
            : "当前关节不能继续沿所选轴旋转，请查看活动范围提示。"
          : request.mode === "source-joint" && isWristControl(request.coordinate)
            ? "腕部控制角已改变，两级腕骨联动、前臂固定；可以确认关键帧。"
            : "本级关节已旋转，上级保持固定；可以确认关键帧。");
      status(message, rotation?.accepted === false);
      if (currentSelection)
        view.setInteractionMessage(message, Boolean(dragQueue));
    }
    save();
    if (!rotationGesture)
      $("draftState").textContent =
        "当前草稿已保留；确认关键帧后，再调整下一姿势。";
  } catch (error) {
    dragQueue = null;
    if (keyboardRotation) keyboardRotation.angleDelta = keyboardRotation.lastAcceptedAngleDelta;
    status(`关节旋转未完成：${error.message}`, true);
    view.setInteractionMessage(`关节旋转未完成：${error.message}`);
  } finally {
    // Keep a keyboard sequence's frozen origin across response gaps. The next
    // key can arrive before its previous pose is drawn; resetting here would
    // restart from the old visible pose and lose that accepted increment.
    // A new joint/axis/mode or scene revision starts a new sequence above.
    dragBusy = false;
    if (!rotationGesture) void finishSurfacePreview();
    updateButtons();
  }
}
function renderKeys() {
  const target = $("keyframes");
  target.replaceChildren();
  if (!keys.length) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "暂无关键帧";
    target.append(empty);
  }
  keys.forEach((key, i) => {
    const item = document.createElement("li");
    item.className = `keyframe${selected === i ? " active" : ""}`;
    const main = document.createElement("button");
    main.className = "keyframe-main";
    main.setAttribute("aria-pressed", String(selected === i));
    main.disabled = solving || poseBusy || dragBusy;
    const title = document.createElement("b");
    title.textContent = `姿势 ${i + 1} · ${fmt(key.t, 2)} s`;
    const changed = coordinates.filter(
      (c) =>
        Math.abs((key.q[c.name] ?? c.default) - c.default) >
        (c.unit === "m" ? 0.001 : 0.1),
    );
    main.title = changed.length
      ? `${changed.length} 个坐标改变 · ${changed
          .slice(0, 2)
          .map(
            (c) =>
              `${coordLabel(c.name)} ${fmt(key.q[c.name], 1)}${c.unit === "m" ? "m" : "°"}`,
          )
          .join(" · ")}`
      : "模型默认姿势";
    main.append(title);
    main.onclick = async () => {
      if (solving || poseBusy || dragBusy) return;
      pause();
      selected = i;
      renderKeys();
      if (frames.length) {
        draft = clone(key.q);
        selectFrame(
          frames.reduce(
            (best, f, n) =>
              Math.abs(f.t - key.t) < Math.abs(frames[best].t - key.t)
                ? n
                : best,
            0,
          ),
        );
        updateCoordinate();
      } else
        await setDraft(key.q, { invalidateResult: false, allowInvalid: true });
      if (replay) return;
      $("draftState").textContent =
        `编辑姿势 ${i + 1}；调整后点“替换选中帧”，或添加下一帧。`;
      showWorkspace("pose");
    };
    if (replay) {
      item.append(main);
      target.append(item);
      return;
    }
    const tools = document.createElement("div");
    tools.className = "keyframe-tools";
    if (i > 0) {
      const label = document.createElement("label");
      label.textContent = "间隔 ";
      const time = document.createElement("input");
      time.type = "number";
      time.min = ".25";
      time.max = "10";
      time.step = ".25";
      time.value = fmt(key.t - keys[i - 1].t, 2);
      time.setAttribute("aria-label", `姿势${i + 1}与前一帧间隔秒数`);
      time.onchange = () => {
        if (solving || gripBusy || verifiedLoading || playing || moviePreparation) return;
        const dt = Number(time.value);
        if (!Number.isFinite(dt) || dt < 0.25 || dt > 10) {
          time.value = fmt(key.t - keys[i - 1].t, 2);
          return status("每段时间应在 0.25–10 秒之间。", true);
        }
        const delta = keys[i - 1].t + dt - key.t;
        if (keys.at(-1).t + delta > 30) {
          renderKeys();
          return status("整段动作最长 30 秒。", true);
        }
        for (let j = i; j < keys.length; j++) keys[j].t += delta;
        invalidate();
        renderKeys();
        save();
      };
      label.append(time, " s");
      tools.append(label);
    } else {
      const label = document.createElement("small");
      label.textContent = "起始姿势";
      tools.append(label);
    }
    const remove = document.createElement("button");
    remove.textContent = "删除";
    remove.setAttribute("aria-label", `删除姿势${i + 1}`);
    remove.onclick = () => {
      if (solving || gripBusy || verifiedLoading || playing || moviePreparation) return;
      keys.splice(i, 1);
      if (keys.length) {
        const start = keys[0].t;
        keys.forEach((k) => (k.t -= start));
      }
      selected = Math.min(selected, keys.length - 1);
      invalidate();
      renderKeys();
      save();
    };
    tools.append(remove);
    item.append(main, tools);
    target.append(item);
  });
  updateButtons();
}
function addKey(dt) {
  if (gripBusy || verifiedLoading || solving) return;
  if (frame?.anatomy?.valid === false)
    return status(`当前姿势不能确认为关键帧：${anatomyReason(frame)}`, true);
  const gripProblem = captureGripProblem();
  if (gripProblem) return status(gripProblem, true);
  if (!canCapturePose())
    return status("请先暂停回放，并等待当前姿势和肌肉表面更新完成，再确认关键帧。", true);
  if (keys.length >= 10) return;
  if (keys.length && keys.at(-1).t + dt > 30)
    return status("整段动作最长 30 秒。", true);
  keys.push({
    t: keys.length ? keys.at(-1).t + dt : 0,
    q: clone(pendingKey || draft),
  });
  pendingKey = null;
  selected = keys.length - 1;
  invalidate("关键帧已添加");
  renderKeys();
  $("keyframes").lastElementChild?.scrollIntoView({ block: "nearest", inline: "nearest" });
  save();
  $("timingBox").hidden = true;
  $("draftState").textContent = `已确认 ${keys.length} 个姿势。`;
}
function updateCoordinate() {
  const c = coordinates.find((c) => c.name === $("coordinate").value);
  if (!c) return;
  $("coordinateValue").value = fmt(
    draft[c.name] ?? c.default ?? 0,
    c.unit === "m" ? 3 : 1,
  );
  $("coordinateValue").min = c.min;
  $("coordinateValue").max = c.max;
  $("coordinateValue").step = c.unit === "m" ? ".01" : "1";
  $("coordinateValue").setAttribute("aria-label", isWristControl(c.name) ? coordLabel(c.name) : "关节角度");
  $("coordinateRange").textContent =
    `${fmt(c.min)} 至 ${fmt(c.max)} ${c.unit === "m" ? "m" : "°"}（源模型范围）；还需通过联合活动范围与身体防穿插检查。${isWristControl(c.name) ? "腕部数值控制两级腕骨联动，不是手掌总转角或临床屈伸角。" : ""}`;
}
function populateCoordinates() {
  const previous = $("coordinate").value,
    region = $("coordinateRegion").value;
  $("coordinate").replaceChildren();
  for (const c of coordinates.filter(
    (c) =>
      !c.locked && !c.dependent && (region === "all" || c.region === region),
  )) {
    const o = document.createElement("option");
    o.value = c.name;
    o.textContent = coordLabel(c.name);
    $("coordinate").append(o);
  }
  if ([...$("coordinate").options].some((o) => o.value === previous))
    $("coordinate").value = previous;
  updateCoordinate();
}
function updateSettings() {
  const groundEnabled =
    $("groundToggle").getAttribute("aria-pressed") === "true";
  $("groundToggle").textContent = groundEnabled
    ? "地面：有"
    : "地面：无";
  $("support").querySelector('option[value="feet"]').disabled = !groundEnabled;
  view.setGroundEnabled(groundEnabled);
  const weight = info ? `人体重力约 ${fmt(info.massKg * 9.81, 0)} N。` : "";
  $("gravityNote").textContent = groundEnabled
    ? `重力始终生效。${weight}地面检查接触与穿透；选择足底支撑后计算地面反力。`
    : `重力始终生效。${weight}无地面时没有足底反力；无外部支撑不能静止悬空。`;
  $("feetSettings").hidden = $("support").value !== "feet";
  $("supportNote").textContent =
    $("support").value === "feet"
      ? "只把选中的脚作为接触候选。足滑、穿透或辅助力过大时，不宣称动作可自由完成。"
      : $("support").value === "seated"
        ? "适合坐姿伸膝和抬臂。骨盆由外部支撑，双脚不承重。"
        : $("support").value === "free"
          ? "不添加外部支撑力。会核对重力和整体运动；仅摆出悬空姿势不代表能维持。"
          : "允许外部装置引导骨盆；所需辅助力与力矩将完整显示。";
  const eq = equipment();
  appliedHand = eq.hand;
  $("gearState").textContent =
    eq.massKg > 0 && eq.type !== "none"
      ? `哑铃 · 总质量 ${fmt(eq.massKg)} kg · ${eq.hand === "both" ? "双手各一只哑铃" : eq.hand === "right" ? "右手" : "左手"}`
      : Number($("loadKg").value) > 0 ? "待握持" : "空手";
  updateGripNote();
}
function updateGripNote() {
  const note = $("gripNote");
  if (!note) return;
  const grasp = frame?.grasp;
  note.classList.toggle(
    "error",
    Number($("loadKg").value) > 0 &&
      (grasp?.geometryValid === false || grasp?.feasible === false),
  );
  note.textContent =
    Number($("loadKg").value) <= 0
      ? "握持会调整当前姿势及各关键帧的手指；手腕和手臂保持原位。"
      : grasp?.geometryValid === false
        ? grasp.reason ||
          "手指与握把尚未形成有效接触。请重新握持；此姿势不能获得有效握持力。"
        : grasp?.feasible === false
          ? grasp.reason || "当前模型未找到同时满足接触与肌肉配力约束的解。"
          : grasp?.feasible === true
            ? "本帧的手部接触、摩擦及肌肉配力检查通过。"
            : grasp?.geometryValid === true
              ? "手指已接触握把；是否能承重仍需计算。手动张开手指会重新检查接触。"
              : "器械尚未核验握持。点击“重新握住器械”调整手指后，再计算负重。";
}
async function attachGear(type, hand) {
  if (!info || solving || poseBusy || dragBusy || gripBusy || verifiedLoading)
    return;
  if (!["none", "dumbbell"].includes(type))
    return status("当前仅支持哑铃，请重新选择器械。", true);
  type = "dumbbell";
  const massKg = Number($("loadKg").value) > 0 ? Number($("loadKg").value) : 5;
  if (!Number.isFinite(massKg) || massKg > 30)
    return status("手持质量应在 0–30 kg 内。", true);
  const previous = {
    schema: 1,
    model: info.id,
    ...clone(inputScene()),
    draft: clone(draft),
  };
  const previousPendingKey = pendingKey ? clone(pendingKey) : null;
  const previousSelected = selected;
  const timingHidden = $("timingBox").hidden;
  const requestRevision = revision;
  pause();
  gripBusy = true;
  updateButtons();
  status("正在握持器械…");
  try {
    const value = await api("grasp", {
      q: clone(draft),
      hand,
      equipment: { type, massKg, hand, friction: gearFriction },
    });
    if (revision !== requestRevision)
      throw Error("等待期间场景已改变，已丢弃这次握持结果。");
    if (!value.grasp?.geometryValid)
      throw Error(
        value.grasp?.reason ||
          "当前手部位置无法形成有效握持，请调整姿势后重试。",
      );
    const changed =
      value.changedCoordinates ||
      Object.keys(value.q).filter((name) => value.q[name] !== draft[name]);
    if (
      changed.some(
        (name) =>
          !/^\d?(?:cmc|mcp|mp|ip|pm|md)_(?:flexion|abduction)(?:_l)?$/.test(
            name,
          ),
      )
    )
      throw Error("握持返回了手指以外的姿势修改，本次未应用。");
    const fingers = coordinates
      .map((c) => c.name)
      .filter(
        (name) =>
          /^\d?(?:cmc|mcp|mp|ip|pm|md)_(?:flexion|abduction)(?:_l)?$/.test(
            name,
          ) &&
          (hand === "both" || name.endsWith("_l") === (hand === "left")),
      );
    gearType = type;
    gearMassKg = massKg;
    appliedHand = hand;
    $("hand").value = hand;
    $("loadKg").value = String(massKg);
    for (const key of keys)
      for (const name of fingers) key.q[name] = value.q[name];
    if (pendingKey)
      for (const name of fingers) pendingKey[name] = value.q[name];
    pendingGear = null;
    document
      .querySelectorAll(".equipment")
      .forEach((b) => b.classList.remove("pending"));
    invalidate(
      `已调整当前姿势${keys.length ? `及 ${keys.length} 个关键帧` : ""}的手指；计算后核验是否能承重。`,
    );
    showFrame(value);
    updateCoordinate();
    renderKeys();
    updateSettings();
    gripUndo = {
      scene: previous,
      revision,
      pendingKey: previousPendingKey,
      selected: previousSelected,
      timingHidden,
    };
    save();
  } catch (error) {
    status(`握持未应用，原姿势保留：${error.message}`, true);
  } finally {
    finishGripOperation();
  }
}
function setupGear() {
  for (const button of document.querySelectorAll(".equipment")) {
    button.addEventListener("pointerdown", (event) => {
      if (!info || solving || gripBusy) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      const type = button.dataset.gear,
        origin = [event.clientX, event.clientY];
      let moved = false;
      const ghost = document.createElement("div");
      ghost.className = "gear-ghost";
      ghost.textContent = button.textContent;
      const move = (e) => {
        moved ||= Math.hypot(e.clientX - origin[0], e.clientY - origin[1]) > 5;
        if (moved && !ghost.isConnected) document.body.append(ghost);
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
      };
      const end = (e) => {
        button.removeEventListener("pointermove", move);
        button.removeEventListener("pointerup", end);
        button.removeEventListener("pointercancel", cancel);
        ghost.remove();
        if (!moved) {
          pendingGear = type;
          updateButtons();
          document
            .querySelectorAll(".equipment")
            .forEach((b) => b.classList.toggle("pending", b === button));
          status("已选择哑铃 · 待握持");
          return;
        }
        const rect = $("bodyView").getBoundingClientRect(),
          joints = view.projectJoints();
        const near = Object.entries(joints)
          .filter(
            ([name, p]) =>
              /hand|wrist/.test(name) &&
              p.visible &&
              !(viewMode === "right" && name.endsWith("_l")) &&
              !(viewMode === "left" && name.endsWith("_r")),
          )
          .map(([name, p]) => ({
            name,
            d: Math.hypot(
              rect.left + p.x - e.clientX,
              rect.top + p.y - e.clientY,
            ),
          }))
          .sort((a, b) => a.d - b.d)[0];
        if (near && near.d < 65)
          attachGear(type, /_l|left/.test(near.name) ? "left" : "right");
        else status("器械未靠近手，原有握持保持不变。");
      };
      const cancel = () => {
        button.removeEventListener("pointermove", move);
        button.removeEventListener("pointerup", end);
        button.removeEventListener("pointercancel", cancel);
        ghost.remove();
      };
      button.addEventListener("pointermove", move);
      button.addEventListener("pointerup", end);
      button.addEventListener("pointercancel", cancel);
    });
    button.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pendingGear = button.dataset.gear;
        updateButtons();
        button.classList.add("pending");
        status("已选择哑铃 · 待握持");
      }
    });
  }
}
let tendonBranchRows = null;
let handPassiveRows = null;
function showHandPassiveTorques(frame, region = "all") {
  const correction = frame?.handReferenceTorques;
  const visible = result?.quantitativeValid === true && frame?.quantitativeValid === true &&
    correction && typeof correction === "object" && !Array.isArray(correction);
  const selected = visible ? coordinates.filter((coordinate) =>
    /^[2-5](?:mcp|pm|md)_flexion(?:_l)?$/.test(coordinate.name) &&
    (region === "all" || coordinate.region === region) &&
    Number.isFinite(correction[coordinate.name]) &&
    Number.isFinite(frame.jointPassiveTorques?.[coordinate.name])) : [];
  $("handPassiveDetails").hidden = selected.length === 0;
  if (!selected.length) {
    $("handPassiveRows").replaceChildren();
    handPassiveRows = null;
    return;
  }
  const signature = JSON.stringify([region, selected.map(({ name }) => name)]);
  if (handPassiveRows?.signature !== signature) {
    const rows = selected.map(({ name }) => {
      const row = document.createElement("tr"), label = document.createElement("td"),
        native = document.createElement("td"), reference = document.createElement("td");
      label.textContent = coordLabel(name);
      row.append(label, native, reference);
      return { name, row, native, reference };
    });
    $("handPassiveRows").replaceChildren(...rows.map(({ row }) => row));
    handPassiveRows = { signature, rows };
  }
  for (const { name, native, reference } of handPassiveRows.rows) {
    const originalValue = fmt(frame.jointPassiveTorques[name] - correction[name], 4);
    const correctionValue = fmt(correction[name], 4);
    if (native.textContent !== originalValue) native.textContent = originalValue;
    if (reference.textContent !== correctionValue) reference.textContent = correctionValue;
  }
}
function showTendonBranches(muscle, valid) {
  const branches = valid && Number.isFinite(muscle?.force) && Array.isArray(muscle.branches)
    ? muscle.branches : [];
  const visible = branches.length > 1 && branches.every((branch) =>
    Number.isFinite(branch.coefficient) && branch.coefficient >= 0 && Number.isFinite(branch.force));
  $("tendonBranchDetails").hidden = !visible;
  if (!visible) {
    if (tendonBranchRows) $("tendonBranchRows").replaceChildren();
    tendonBranchRows = null;
    return;
  }
  const signature = JSON.stringify([muscle.name, branches.map(({ id, label, coefficient }) => [id, label, coefficient])]);
  if (tendonBranchRows?.signature !== signature) {
    const rows = branches.map((branch, index) => {
      const row = document.createElement("tr"),
        label = document.createElement("td"),
        fraction = document.createElement("td"),
        force = document.createElement("td");
      label.textContent = branch.label || (index === 0 ? "主干" : branch.id);
      fraction.textContent = `${fmt(branch.coefficient * 100, 1)}%`;
      row.append(label, fraction, force);
      return { row, force };
    });
    $("tendonBranchRows").replaceChildren(...rows.map(({ row }) => row));
    tendonBranchRows = { signature, rows };
  }
  branches.forEach((branch, index) => {
    const value = fmt(branch.force, 4), cell = tendonBranchRows.rows[index].force;
    if (cell.textContent !== value) cell.textContent = value;
  });
}
function clearResults() {
  showTendonBranches(null, false);
  showHandPassiveTorques(null);
  torqueRows = null;
  chartCache = null;
  for (const id of ["muscleCount", "peakTorque", "baseForce", "balanceError"])
    $(id).textContent = "—";
  $("torqueTable").textContent = "计算后显示。";
  $("contactReport").replaceChildren();
  $("scope").textContent = "计算后显示。";
  $("muscleValue").textContent = "— N";
  $("muscleNote").textContent =
    "头颈、躯干、双臂、双手与双腿共同配力。选择区域和肌束查看计算张力。";
  drawChart();
}
function drawChart() {
  const canvas = $("forceChart"),
    name = $("muscleSelect").value;
  if (!canvas.clientWidth) return;
  const width = Math.round(canvas.clientWidth), height = Math.round(canvas.clientHeight);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  if (
    !chartCache ||
    chartCache.frames !== frames ||
    chartCache.result !== result ||
    chartCache.name !== name ||
    chartCache.canvas.width !== canvas.width ||
    chartCache.canvas.height !== canvas.height
  ) {
    const background = document.createElement("canvas");
    background.width = canvas.width;
    background.height = canvas.height;
    chartCache = {
      frames,
      result,
      name,
      canvas: background,
      duration: drawChartBackground(background, name),
    };
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(chartCache.canvas, 0, 0);
  if (chartCache.duration !== null) {
    const left = 48,
      right = canvas.width - 14,
      x =
        left + ((displayedFrame?.t || 0) / chartCache.duration) * (right - left);
    ctx.strokeStyle = "#bd7b42";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 22);
    ctx.lineTo(x, canvas.height - 30);
    ctx.stroke();
  }
}
function drawChartBackground(canvas, name) {
  const ctx = canvas.getContext("2d"),
    w = canvas.width,
    h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px "Microsoft YaHei",sans-serif';
  const left = 48,
    bottom = h - 30,
    top = 22,
    right = w - 14;
  ctx.strokeStyle = "#d8e3dc";
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();
  const values = result
    ? cachedForceSeries(result, name) ?? frames.map((f) => ({
        t: f.t,
        force: f.muscles?.find((m) => m.name === name)?.force,
      }))
    : [];
  const valid = values.filter((v) => Number.isFinite(v.force));
  if (!valid.length) {
    ctx.fillStyle = "#7c8c80";
    ctx.fillText(
      result?.quantitativeValid === true && !name
        ? "请选择有张力变化的肌束"
        : result ? "暂无有效张力数据" : "完成计算后显示张力曲线",
      left + 4,
      top + 40,
    );
    return null;
  }
  const max = Math.max(10, ...valid.map((v) => v.force)) * 1.15,
    duration = Math.max(0.001, values.at(-1).t);
  ctx.fillStyle = "#6c7e71";
  for (let n = 0; n <= 4; n++) {
    const y = bottom - (n / 4) * (bottom - top);
    ctx.fillText(`${Math.round((max * n) / 4)}`, 3, y + 4);
    ctx.strokeStyle = "#edf1ec";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
  }
  ctx.fillText("N", 8, 14);
  ctx.fillText("0 s", left, h - 7);
  ctx.fillText(`${fmt(duration, 2)} s`, right - 48, h - 7);
  ctx.strokeStyle = "#197c61";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  let pen = false;
  for (const point of values) {
    if (!Number.isFinite(point.force)) {
      pen = false;
      continue;
    }
    const x = left + (point.t / duration) * (right - left),
      y = bottom - (point.force / max) * (bottom - top);
    if (pen) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    pen = true;
  }
  ctx.stroke();
  return duration;
}
function drawResults() {
  if (document.querySelector('[data-inspector-panel="forces"]')?.hidden ||
      document.body.dataset.inspectorCollapsed === "true") return;
  if (!result || !frames.length) { drawChart(); return; }
  const f = frames.includes(displayedFrame) ? displayedFrame : null;
  if (!f) return;
  const muscles = f.muscles || [],
    valid = muscles.filter((m) => Number.isFinite(m.force));
  $("muscleCount").textContent = String(valid.length);
  const torques = f.torques || {},
    rotational = Object.entries(torques).filter(
      ([k, v]) => !/^pelvis_t[xyz]$/.test(k) && Number.isFinite(v),
    );
  $("peakTorque").textContent = fmt(
    rotational.length
      ? Math.max(...rotational.map(([, v]) => Math.abs(v)))
      : NaN,
  );
  const base = f.support?.baseResidual;
  $("baseForceLabel").textContent =
    f.support?.mode === "free" ? "整体未平衡力" : "辅助基座力";
  $("baseForce").textContent = fmt(
    base ? norm([base.pelvis_tx, base.pelvis_ty, base.pelvis_tz]) : NaN,
  );
  $("balanceError").textContent = fmt(f.balanceErrorNm, 5);
  const selectedRegion = $(replay ? "muscleRegion" : "coordinateRegion").value;
  if (!torqueRows || torqueRows.region !== selectedRegion) {
    const table = document.createElement("table"),
      head = document.createElement("tr");
    for (const label of ["关节", "净需求", "肌肉合计", "关节止挡", "未平衡"]) {
      const th = document.createElement("th");
      th.textContent = label;
      head.append(th);
    }
    table.append(head);
    const rows = coordinates
      .filter(
        (c) =>
          !/^pelvis_/.test(c.name) &&
          (selectedRegion === "all" || c.region === selectedRegion),
      )
      .map((c) => {
        const tr = document.createElement("tr"),
          label = document.createElement("td"),
          cells = Array.from({ length: 4 }, () => document.createElement("td"));
        label.textContent = coordLabel(c.name).replace(/控制角$/, "控制坐标");
        tr.append(label, ...cells);
        table.append(tr);
        return {
          name: c.name,
          digits: c.region.startsWith("hand") ? 4 : 2,
          cells,
        };
      });
    $("torqueTable").replaceChildren(table);
    torqueRows = { region: selectedRegion, rows };
  }
  for (const { name, digits, cells } of torqueRows.rows) {
    [
      fmt(torques[name], digits),
      fmt(f.muscleTorques?.[name], digits),
      fmt(f.jointLimitTorques?.[name], digits),
      fmt(f.reserveTorques?.[name], digits),
    ].forEach((value, i) => {
      if (cells[i].textContent !== value) cells[i].textContent = value;
    });
  }
  showHandPassiveTorques(f, selectedRegion);
  const muscle = muscles.find((m) => m.name === $("muscleSelect").value);
  $("muscleValue").textContent = `${fmt(muscle?.force)} N`;
  showTendonBranches(muscle, result.quantitativeValid === true && f.quantitativeValid === true &&
    selectedAnatomicalMuscle?.mapping !== "unmapped" && selectedAnatomicalMuscle?.tissueType !== "tendon");
  const sensitivity = result.sensitivity?.muscles?.find(
    (m) => m.name === $("muscleSelect").value,
  );
  $("muscleNote").textContent =
    sensitivity && Number.isFinite(sensitivity.minN)
      ? `参数扫描：在 ${fmt(result.sensitivity.time, 2)} s，将肌肉最大力设为原模型的 ${result.sensitivity.scales.map((s) => `${Math.round(s * 100)}%`).join(" / ")}，可行方案中的此肌束张力为 ${fmt(sensitivity.minN)}–${fmt(sensitivity.maxN)} N。${result.sensitivity.invalidCases.length ? `${result.sensitivity.invalidCases.length} 个扰动方案不可行，未纳入区间：${result.sensitivity.invalidCases.map((c) => `${Math.round(c.strengthScale * 100)}%（${c.reasons.join("；")}）`).join("；")}。` : ""}这是参数扫描范围，不是人体误差或置信区间。`
      : !muscle && result.quantitativeValid === true
        ? selectedAnatomicalMuscle?.mapping !== "unmapped" && selectedAnatomicalMuscle
          ? "此表面关联的肌束在整段动作中张力变化均不超过 0.01 N，未列入观察列表。"
          : "当前筛选下没有可观察的变化肌束，可调整区域或搜索条件。"
      : Number.isFinite(muscle?.force)
        ? `当前 ${regionLabels[muscle.region] || "模型"}肌束张力 ${fmt(muscle.force)} N，激活水平 ${fmt((muscle.activation || 0) * 100)}%。逐帧求最小激活总和，尚未约束激活变化；分配切换时曲线可能跳变。`
        : "此动作没有有效张力；失败结果不参与肌力比较。";
  if (selectedAnatomicalMuscle?.tissueType === "tendon")
    $("muscleNote").textContent =
      "此跟腱用于显示肌腹与跟骨的连续连接，不作为独立肌肉，也不提供单独的肌力数值。";
  else if (selectedAnatomicalMuscle?.mapping === "unmapped")
    $("muscleNote").textContent =
      "此解剖肌肉尚未映射到计算单元，不显示推断张力。";
  else if (selectedAnatomicalMuscle?.mapping === "group" && muscle)
    $("muscleNote").textContent +=
      ` 当前曲线是 ${muscle?.name || $("muscleSelect").value} 单元，不代表整块 ${selectedAnatomicalMuscle.label} 的合力。`;
  $("selectionLabel").textContent = selectedAnatomicalMuscle
    ? `${selectedAnatomicalMuscle.label} · ${selectedAnatomicalMuscle.tissueType === "tendon" ? "跟腱连接表面" : selectedAnatomicalMuscle.mapping === "unmapped" ? "尚无计算映射" : "对应计算单元见右侧"}`
    : $("muscleSelect").selectedOptions[0]?.textContent || "点肌肉可查看名称";
  drawChart();
  const contactLines = [];
  if (f.grasp && Number($("loadKg").value) > 0) {
    contactLines.push({
      text: `手部握持：${f.grasp.geometryValid ? "手指与握把形成接触" : f.grasp.reason || "接触不成立"}；${f.grasp.feasible === true ? "接触与肌肉配力通过" : f.grasp.feasible === false ? "当前模型未找到满足握持与配力约束的解" : "未作承重计算"}。`,
      error: f.grasp.geometryValid === false || f.grasp.feasible === false,
    });
    if (Number.isFinite(f.grasp.objectResidualForceN))
      contactLines.push({
        text: `器械受力残差 ${fmt(f.grasp.objectResidualForceN, 4)} N；力矩残差 ${fmt(f.grasp.objectResidualMomentNm, 4)} N·m。`,
      });
  }
  if (f.gravity || f.groundCheck) {
    contactLines.push({
      text: `${f.groundCheck?.enabled ? "有地面" : "无地面"}；重力已计入逆动力学。${f.groundCheck?.enabled ? `身体最大穿地 ${fmt(f.groundCheck.penetrationMaxM * 1000)} mm，检查${f.groundCheck.feasible ? "通过" : "未通过"}。` : "不产生地面反力。"}`,
    });
  }
  const support = f.support;
  if (support) {
    const facts =
      support.mode === "feet"
        ? [
            `足底支撑：${support.feasible ? "满足本帧接触门槛" : "未满足接触或平衡门槛"}`,
            `接触高度偏差 ${fmt(support.contactHeightMaxM * 1000)} mm；足滑 ${fmt((support.slipM || 0) * 1000)} mm`,
            `双足最大穿地 ${fmt((support.penetrationMaxM || 0) * 1000)} mm`,
            `辅助基座力矩 ${fmt(base ? norm([base.pelvis_tilt, base.pelvis_list, base.pelvis_rotation]) : NaN)} N·m`,
            ...["right", "left"].map(
              (side) =>
                `${side === "right" ? "右" : "左"}足垂直力 ${fmt((support.forces || []).filter((r) => r.side === side || r.side === side[0]).reduce((sum, r) => sum + (r.force?.[1] || 0), 0))} N`,
            ),
          ]
        : support.mode === "free"
          ? [
              support.explanation,
              `尚未平衡的整体力 ${$("baseForce").textContent} N；未添加外部支撑力。`,
            ]
          : [
              support.explanation,
              `骨盆由外部支撑，当前反力 ${$("baseForce").textContent} N。`,
              `支撑力分量（前后 / 竖直 / 左右）：${fmt(base?.pelvis_tx)} / ${fmt(base?.pelvis_ty)} / ${fmt(base?.pelvis_tz)} N。`,
              `骨盆支撑力矩（前倾 / 侧倾 / 转向坐标）：${fmt(base?.pelvis_tilt, 3)} / ${fmt(base?.pelvis_list, 3)} / ${fmt(base?.pelvis_rotation, 3)} N·m。`,
            ];
    for (const text of facts.filter(Boolean)) {
      contactLines.push({ text });
    }
  }
  for (const error of f.errors || []) {
    contactLines.push({ text: error, error: true });
  }
  const contactReport = $("contactReport");
  contactLines.forEach(({ text, error }, i) => {
    const p = contactReport.children[i] || document.createElement("p");
    if (p.textContent !== text) p.textContent = text;
    p.classList.toggle("error", Boolean(error));
    if (!p.parentNode) contactReport.append(p);
  });
  while (contactReport.children.length > contactLines.length)
    contactReport.lastElementChild.remove();
}
function selectFrame(n) {
  if (!frames.length) return;
  index = Math.max(0, Math.min(frames.length - 1, n));
  $("timeline").value = index;
  const saved = movieCache?.source === frames ? movieCache.records?.[index] : null;
  const value = frames[index];
  showFrame(value, { record: saved });
}
async function startPlayback() {
  if (!frames.length || moviePreparation || playing || document.hidden || solving || gripBusy || verifiedLoading || poseBusy || dragBusy) return;
  cancelAnimationFrame(seekTick);
  seekTick = 0;
  const source = frames;
  if (movieCache?.source !== source) {
    const job = new AbortController();
    moviePreparation = job;
    view.setEditing(false);
    updateButtons();
    setPlaybackHealth("正在准备动画…");
    $("play").textContent = "取消准备";
    const mode = $("muscleDisplay").value;
    const progress = (n, total) => {
      if (moviePreparation !== job) return;
      $("play").textContent = "取消准备";
      $("play").title = `取消动画准备（${n}/${total}）`;
      setSurfaceStage(`正在准备${mode === "paths" ? "原生肌腱路径" : "整段肌肉动画"}：${n} / ${total} 帧。完成后开始播放。`);
    };
    progress(0, source.length);
    try {
      // Prepare surfaces sequentially without decoding every motion frame at once.
      const movie = { length: source.length, *[Symbol.iterator]() {
        for (const value of source) yield wrapFrame(value, true);
      }};
      const records = await view.preparePlayback(movie, job.signal, progress, mode,
        new Set(info.muscles.map(muscle => muscle.name)));
      if (moviePreparation !== job || frames !== source) return;
      movieCache = { source, records };
    } catch (error) {
      if (moviePreparation === job && !job.signal.aborted) status(`未开始播放：${error.message}`, true);
      return;
    } finally {
      if (moviePreparation === job) {
        moviePreparation = null;
        $("play").textContent = "播放";
        setSurfaceStage("");
        updateButtons();
        view.setEditing(!solving && !gripBusy && !verifiedLoading);
      }
    }
  }
  if (index >= frames.length - 1) index = 0;
  selectFrame(index);
  playStart = performance.now() - frames[index].t * 1000 / playbackSpeed();
  playing = true;
  view.setPlaybackActive(true);
  view.setEditing(false);
  updateButtons();
  playbackInterval = 50;
  slowRenderCount = 0;
  lastPlaybackTick = performance.now();
  setPlaybackHealth("播放中");
  lastPlaybackDraw = -Infinity;
  playbackTick = requestAnimationFrame(tick);
  $("play").textContent = "暂停";
  $("play").setAttribute("aria-pressed", "true");
}
function tick(now) {
  playbackTick = 0;
  if (playing && now - lastPlaybackTick > 1500) {
    pause();
    setPlaybackHealth("页面响应变慢，已自动暂停。可逐帧查看或稍后继续。");
    status("页面响应变慢，已自动暂停。可逐帧查看或稍后继续。", true);
    return;
  }
  lastPlaybackTick = now;
  if (playing && frames.length && !view.state.renderBusy && now - lastPlaybackDraw >= playbackInterval) {
    lastPlaybackDraw = now;
    let t = (now - playStart) / 1000 * playbackSpeed(),
      duration = frames.at(-1).t;
    if (t > duration) {
      if ($("loop").checked && duration > 0) {
        t %= duration;
        playStart = now - t * 1000 / playbackSpeed();
      } else {
        t = duration;
        pause();
      }
    }
    let lo = 0,
      hi = frames.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (frames[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    const next = lo;
    if (next !== index) selectFrame(next);
  }
  if (playing) playbackTick = requestAnimationFrame(tick);
}
function readableFailure(text) {
  return String(text).replace(/\b[A-Za-z][A-Za-z0-9_]*\b/g, (name) =>
    coordinates.some((c) => c.name === name) ? coordLabel(name) : name,
  );
}
function showFailureDiagnosis(value) {
  const failed = value.failures || [];
  $("solveDiagnosis").hidden = !failed.length;
  $("failureActions").replaceChildren();
  if (!failed.length) return;
  const first = failed[0];
  const sourceFrames = frames, sourceRevision = revision;
  const frameIndex = frames.findIndex((f) => Math.abs(f.t - first.t) < 1e-7);
  const failedFrame = frames[frameIndex];
  const timeline = value.scene.keyframes;
  const atKey = timeline.findIndex((key) => Math.abs(key.t - first.t) < 1e-7);
  const before = Math.max(0, timeline.findLastIndex((key) => key.t < first.t));
  const after = Math.min(before + 1, timeline.length - 1);
  const location = atKey >= 0 ? `姿势 ${atKey + 1}` : `姿势 ${before + 1} → ${after + 1} 的过渡`;
  $("failureSummary").textContent =
    `${failed.length}/${frames.length} 帧未通过。第一处在 ${fmt(first.t, 3)} 秒，位于${location}。整段力值尚未启用，动作仍保留。`;
  $("failureReasons").replaceChildren(...[...new Set(first.reasons || first.errors || [])].map((reason) => {
    const item = document.createElement("li");
    item.textContent = readableFailure(reason);
    return item;
  }));
  const advice = [];
  if (failedFrame?.support?.feasible === false)
    advice.push(value.scene.support === "free"
      ? "当前没有外部支撑；内部肌肉无法托住静止悬空的整个人体。若要研究骨盆固定下的肢体动作，可明确改用骨盆支撑。"
      : "当前采用足底支撑，承重脚需保持接触、摩擦和位置条件。移动承重脚或抬腿时，请重新安排支撑方式。");
  if (failedFrame?.groundCheck?.feasible === false)
    advice.push("身体穿入地面。请调整对应关键帧的身体高度或姿势。");
  if (failedFrame?.grasp?.geometryValid === false)
    advice.push("持物手指没有保持有效接触。请重新握住器械，这会更新动作中各关键帧的手指。");
  if (failedFrame?.anatomy?.valid === false)
    advice.push("当前姿势或过渡超出关节组合与防穿插约束，请调整相邻关键帧。");
  if ((first.reasons || first.errors || []).some((reason) => reason.includes("内部关节")))
    advice.push("这是当前肌骨模型无法同时配平的姿势或运动，并不等于操作失效。可先检查相邻姿势能否保持，再调整关节组合；仅放慢不一定能解决。");
  if (atKey < 0 && [before, after].every((keyIndex) =>
    frames.find((f) => Math.abs(f.t - timeline[keyIndex].t) < 1e-7)?.frameFeasible === true))
    advice.push("本段起止姿势都通过了配力，但中间过渡未通过；只检查首尾姿势不能保证整段可行。");
  $("failureAdvice").textContent = advice.join(" ");
  const addAction = (label, action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.onclick = () => {
      if (solving || poseBusy || dragBusy || gripBusy || verifiedLoading ||
          frames !== sourceFrames || revision !== sourceRevision) return;
      pause();
      action();
    };
    $("failureActions").append(button);
  };
  if (frameIndex >= 0) addAction("查看首个未通过姿势", () => selectFrame(frameIndex));
  for (const keyIndex of atKey >= 0 ? [atKey] : [before, after])
    addAction(`编辑姿势 ${keyIndex + 1}`, () =>
      $("keyframes").children[keyIndex]?.querySelector(".keyframe-main")?.click());
  if (failedFrame?.support?.feasible === false)
    addAction("改用骨盆支撑", () => {
      $("support").value = "assisted";
      $("support").onchange();
    });
  if (failedFrame?.grasp?.geometryValid === false)
    addAction("重新握住器械", () => attachGear(gearType, $("hand").value));
}
async function checkCurrentPose() {
  if (!canCheckPose()) return;
  pause();
  const version = revision, poseVersion = poseCheckRevision;
  const q = clone(draft);
  const scene = { ...inputScene(), keyframes: [{ t: 0, q }, { t: 0.25, q: clone(q) }] };
  solving = true;
  updateButtons();
  view.setEditing(false);
  $("poseCheckReport").classList.remove("error");
  $("poseCheckReport").textContent = "正在按当前负重和支撑，检查这一姿势能否静止保持…";
  try {
    const checked = await api("solve", scene);
    if (revision !== version || poseCheckRevision !== poseVersion) return;
    if (checked.status === "solved") {
      assertCompleteResult(checked, info);
      $("poseCheckReport").textContent =
        `这一姿势可保持：${info.muscles.length}/${info.muscles.length} 个肌腱完成配力，支撑及适用的握持检查通过。该结果只验证当前姿势，相邻姿势之间的运动仍需整段计算。`;
    } else {
      const reasons = checked.failures?.[0]?.reasons || checked.frames?.[0]?.errors || ["当前条件下未通过配力。"];
      $("poseCheckReport").textContent = `这一姿势无法保持：${reasons.map(readableFailure).join(" ")}`;
      $("poseCheckReport").classList.add("error");
    }
  } catch (error) {
    if (revision === version && poseCheckRevision === poseVersion) {
      $("poseCheckReport").textContent = `姿势检查未完成：${error.message}`;
      $("poseCheckReport").classList.add("error");
    }
  } finally {
    solving = false;
    updateButtons();
    view.setEditing(true);
  }
}
function presentResult(value, { preview = false, cached = false, preferredMuscle } = {}) {
  if (!preview && !cached && value.status === "solved") assertCompleteResult(value, info);
  pause();
  movieCache = null;
  frames = value.frames || [];
  result = preview ? null : value;
  if (!frames.length) throw Error("求解器没有返回可回放的姿势。");
  muscleVariations = changingMuscleRanges(result);
  populateMuscles(preferredMuscle);
  $("timeline").max = frames.length - 1;
  $("timeline").disabled = false;
  $("play").disabled = false;
  $("resultKind").textContent = preview
    ? "仅运动学"
    : value.status === "infeasible" || value.kinematicOnly
      ? "含失效结果"
      : cached ? "固定缓存 · 模型估计" : "模型估计";
  $("scope").textContent = [
    ...(Array.isArray(value.scope)
      ? value.scope
      : value.scope
        ? [
            typeof value.scope === "string"
              ? value.scope
              : JSON.stringify(value.scope, null, 2),
          ]
        : []),
    ...(value.warnings || []),
    ...(value.failures || [])
      .slice(0, 8)
      .map(
        (failure) => `${fmt(failure.t, 2)} s：${failure.reasons.join("；")}`,
      ),
    value.metrics
      ? `计算摘要\n${JSON.stringify(value.metrics, null, 2)}`
      : "",
  ].join("\n\n");
  status(
    preview
      ? "已生成姿势预览；此回放不提供力学结果。"
      : value.status === "infeasible"
        ? `${value.metrics.failedFrames}/${frames.length} 帧未通过，第一处在 ${fmt(value.failures?.[0]?.t, 3)} 秒。\n${(value.failures?.[0]?.reasons || value.failures?.[0]?.errors || ["求解器未返回具体原因。"]).map(readableFailure).join("\n")}\n动作已保留，肌力结果不可用。`
        : `${cached ? "已读取固定缓存。" : ""}整段 ${frames.length}/${frames.length} 帧通过；每帧 ${info.muscles.length}/${info.muscles.length} 个肌腱张力完整。支撑与关节止挡单独列出。`,
    value.status === "infeasible",
  );
  showFailureDiagnosis(value);
  if (value.status === "infeasible") {
    showInspector("forces");
    $("panel-forces").scrollTop = 0;
  }
  selectFrame(0);
  save();
}
async function calculate(preview = false) {
  if (solving || keys.length < 2 || dragBusy || poseBusy) return;
  if (!$("loadKg").checkValidity())
    return status("手持质量应在 0–30 kg 内。", true);
  if (captureGripProblem()) return status(captureGripProblem(), true);
  invalidate(
    preview ? "正在生成姿势回放…" : "正在计算全身动力学和逐帧肌肉分担…",
  );
  const version = revision,
    scene = inputScene();
  solving = true;
  updateButtons();
  view.setEditing(false);
  const began = performance.now();
  const waiting = setInterval(() => {
    if (version === revision)
      status(
        `${preview ? "正在生成姿势回放" : "正在逐帧计算肌肉与支撑"}，已等待 ${Math.floor((performance.now() - began) / 1000)} 秒…`,
      );
  }, 1000);
  try {
    const value = await api("solve", { ...scene, preview });
    if (version !== revision) return;
    presentResult(value, { preview });
  } catch (error) {
    status(error.message, true);
    $("resultKind").textContent = "计算未完成";
  } finally {
    clearInterval(waiting);
    solving = false;
    updateButtons();
    view.setEditing(true);
  }
}
function applySettings(scene) {
  pendingKey = null;
  pendingGear = null;
  document.querySelectorAll(".equipment.pending").forEach(button => button.classList.remove("pending"));
  $("timingBox").hidden = true;
  $("groundToggle").setAttribute(
    "aria-pressed",
    String(scene.groundEnabled ?? scene.support === "feet"),
  );
  for (const id of [
    "support",
    "supportFeet",
    "loadKg",
    "hand",
    "strengthScale",
  ])
    if (scene[id] !== undefined) $(id).value = scene[id];
  // A loaded foot-supported scene has no declared earlier external support.
  // Do not inherit another scene's pelvis support when its ground is removed.
  lastNonFootSupport = $("support").value === "feet" ? "free" : $("support").value;
  gearType =
    scene.equipment?.type || (Number(scene.loadKg) > 0 ? "dumbbell" : "none");
  gearMassKg = gearType === "none" ? 0 : Number(scene.loadKg ?? scene.equipment?.massKg ?? 0);
  appliedHand = scene.hand || scene.equipment?.hand || "right";
  gearFriction = scene.equipment?.friction ?? 1;
  updateSettings();
}
async function example(kind) {
  if (!info || solving) return;
  invalidate();
  selected = 0;
  const base = clone(defaults);
  if (kind === "knee") {
    Object.assign(base, {
      hip_flexion_r: 70,
      hip_flexion_l: 70,
      knee_angle_r: 90,
      knee_angle_l: 90,
      pelvis_ty: 0.85,
    });
    keys = [
      { t: 0, q: base },
      { t: 2.5, q: { ...base, knee_angle_r: 50 } },
      { t: 3.5, q: { ...base, knee_angle_r: 50 } },
      { t: 6, q: clone(base) },
    ];
    applySettings({
      support: "seated",
      loadKg: 0,
      hand: "right",
      strengthScale: 1,
      equipment: { type: "none" },
    });
  } else if (kind === "lift") {
    const raised = { ...base, shoulder_elv_r: 35, elbow_flexion_r: 90 };
    keys = [
      { t: 0, q: base },
      { t: 2.5, q: raised },
      { t: 3.5, q: clone(raised) },
      { t: 6, q: clone(base) },
    ];
    applySettings({
      support: "assisted",
      supportFeet: "both",
      loadKg: 5,
      hand: "right",
      strengthScale: 1,
      equipment: { type: "dumbbell" },
    });
  } else if (["hand", "spread", "grip", "neck", "trunk"].includes(kind)) {
    const change =
      kind === "hand"
        ? { cmc_flexion: 10, mp_flexion: 25, ip_flexion: 20 }
        : kind === "spread"
          ? {
              "2mcp_abduction": 10,
              "3mcp_abduction": 10,
              "4mcp_abduction": 10,
              "5mcp_abduction": 10,
            }
          : kind === "grip"
            ? {
                "2mcp_flexion": 35,
                "2pm_flexion": 45,
                "2md_flexion": 25,
                "3mcp_flexion": 35,
                "3pm_flexion": 45,
                "3md_flexion": 25,
                "4mcp_flexion": 35,
                "4pm_flexion": 45,
                "4md_flexion": 25,
                "5mcp_flexion": 35,
                "5pm_flexion": 45,
                "5md_flexion": 25,
                mp_flexion: 25,
                ip_flexion: 30,
              }
            : kind === "neck"
              ? { T1_head_neck_AR: 10, T1_head_neck_FE: 5 }
              : {
                  L5_S1_FE: 5,
                  L4_L5_FE: 1,
                  L3_L4_FE: 1,
                  L2_L3_FE: 1,
                  L1_L2_FE: 1,
                  T12_L1_FE: 3,
                };
    const travel = ["hand", "spread"].includes(kind) ? 4 : 2;
    keys = [
      { t: 0, q: base },
      { t: travel, q: { ...base, ...change } },
      { t: travel + 1, q: { ...base, ...change } },
      { t: travel * 2 + 1, q: clone(base) },
    ];
    applySettings({
      support: "assisted",
      loadKg: 0,
      strengthScale: 1,
      equipment: { type: "none" },
    });
  } else {
    const squat = {
      ...base,
      pelvis_ty: base.pelvis_ty - 0.2,
      hip_flexion_r: 48,
      hip_flexion_l: 48,
      knee_angle_r: 70,
      knee_angle_l: 70,
      ankle_angle_r: 22,
      ankle_angle_l: 22,
      L5_S1_FE: -15,
      shoulder_elv_r: 65,
      shoulder_elv_l: 65,
    };
    keys = [
      { t: 0, q: base },
      { t: 3, q: squat },
      { t: 4, q: clone(squat) },
      { t: 7, q: clone(base) },
    ];
    applySettings({
      support: "feet",
      supportFeet: "both",
      loadKg: 0,
      strengthScale: 1,
      equipment: { type: "none" },
    });
  }
  renderKeys();
  await setDraft(base, { invalidateResult: false });
  save();
  view.setRegion("all", { fit: true });
  view.setView(kind === "knee" ? "right" : "front");
  if (["hand", "spread", "grip", "neck", "trunk"].includes(kind)) {
    const region = ["hand", "spread", "grip"].includes(kind) ? "hand_r" : kind;
    $("coordinateRegion").value = region;
    populateCoordinates();
    view.setRegion(region, { fit: true });
    $("muscleRegion").value = region;
    populateMuscles();
  }
  const resultRegion =
    {
      knee: "leg_r",
      lift: "arm_r",
      hand: "hand_r",
      spread: "hand_r",
      grip: "hand_r",
      neck: "neck",
      trunk: "trunk",
    }[kind] || "all";
  $("coordinateRegion").value = resultRegion;
  $("muscleRegion").value = resultRegion;
  $("muscleSearch").value = "";
  populateCoordinates();
  populateMuscles();
  const preferred =
    kind === "lift" ? "BIClong_r" : kind === "knee" ? "vaslat_r" : "";
  if (
    preferred &&
    [...$("muscleSelect").options].some((o) => o.value === preferred)
  ) {
    $("muscleSelect").value = preferred;
    view.setSelected(preferred);
  }
  status(
    kind === "squat"
      ? "蹲起反例已载入：这些姿势未保持足底位置。计算后会报告接触冲突并停用肌力曲线。"
      : kind === "grip" && !info.handReferenceCoordinates?.length
        ? "握拳反例：源手模型缺少完整伸肌腱膜，部分指间关节无法配平。可回放姿势并检查失衡，不能当有效握力。"
        : "示范关键帧已载入，可直接计算或拖动修改。",
  );
}
async function loadEvidence() {
  const results = await Promise.allSettled([
    fetch("./fullbody-coverage.json").then((r) =>
      r.ok ? r.json() : Promise.reject(Error("尚无清单")),
    ),
    fetch("./fullbody-validation.json").then((r) =>
      r.ok ? r.json() : Promise.reject(Error("验证正在生成")),
    ),
  ]);
  const matchesModel = (data) =>
    data?.modelSha256 === info?.sourceSha256 &&
    data?.computationSha256 === info?.computationSha256 &&
    (!data.modelId || data.modelId === info.id);
  if (results[0].status === "fulfilled" && matchesModel(results[0].value)) {
    coverage = results[0].value;
    $("coverage").replaceChildren();
    for (const region of coverage.regions) {
      const row = document.createElement("div");
      row.className = "coverage-row";
      const label = document.createElement("b");
      label.textContent = region.label;
      const value = document.createElement("div");
      value.textContent = `${region.status}${region.muscleUnits ? ` · ${region.muscleUnits} 个单元` : ""}`;
      const small = document.createElement("small");
      small.textContent = region.limitation;
      value.append(small);
      row.append(label, value);
      $("coverage").append(row);
    }
    populateMuscles();
  } else {
    coverage = null;
    $("coverage").textContent =
      "当前模型的覆盖清单尚未就绪；旧版结果不用于本版。";
  }
  if (results[1].status === "fulfilled" && matchesModel(results[1].value)) {
    const data = results[1].value;
    $("validation").replaceChildren();
    for (const check of data.checks || []) {
      const row = document.createElement("div");
      row.className = "validation-row";
      const label = document.createElement("div");
      label.textContent = check.label;
      const value = document.createElement("div"),
        badge = document.createElement("span");
      badge.className = `badge ${check.status === "passed" ? "" : check.status === "failed" ? "fail" : "pending"}`;
      badge.textContent =
        check.status === "passed"
          ? "检查通过"
          : check.status === "failed"
            ? "未通过"
            : "尚未完成";
      const small = document.createElement("small");
      small.textContent = check.detail || check.criterion || "";
      value.append(badge, small);
      row.append(label, value);
      $("validation").append(row);
    }
  } else
    $("validation").textContent =
      "当前模型的验证报告尚未就绪；旧版通过状态不用于本版。";
}
// Older installed libraries predate category labels.
function motionCategory(motion) {
  if (motion.category) return motion.category;
  if (motion.scene?.equipment?.type === "dumbbell") return "哑铃";
  if (motion.region?.startsWith("hand")) return "手指";
  if (motion.region?.startsWith("leg")) return "髋膝踝";
  if (motion.region?.startsWith("arm")) return "肩肘";
  return "颈与躯干";
}

function renderMotionLibrary(motions) {
  const list = $("verifiedMotionList"), filter = $("motionCategory");
  const groups = new Map();
  for (const motion of motions) {
    const category = motionCategory(motion);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(motion);
  }
  const order = ["肩肘", "前臂与腕", "手指", "颈与躯干", "髋膝踝", "协调动作", "哑铃"];
  const categories = [...new Set([...order, ...groups.keys()])].filter(name => groups.has(name));
  list.replaceChildren();
  filter.replaceChildren(new Option("全部分类", ""));
  for (const category of categories) {
    const items = groups.get(category);
    filter.add(new Option(`${category}（${items.length}）`, category));
    const section = document.createElement("section"), heading = document.createElement("h3");
    section.className = "motion-category-group";
    section.dataset.category = category;
    heading.textContent = category;
    section.append(heading);
    for (const motion of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.motion = motion.id;
      const name = document.createElement("b"), detail = document.createElement("span"), evidence = document.createElement("small");
      name.textContent = motion.label;
      detail.textContent = motion.description;
      evidence.textContent = `${motion.verification.durationSeconds} 秒 · ${motion.verification.frames} 帧均已验证`;
      button.append(name, detail, evidence);
      button.onclick = () => useVerifiedMotion(motion);
      section.append(button);
    }
    list.append(section);
  }
  const updateFilter = () => {
    for (const section of list.children) {
      section.hidden = Boolean(filter.value && section.dataset.category !== filter.value);
      section.querySelector("h3").hidden = Boolean(filter.value);
    }
    $("verifiedNote").textContent = `${motions.length} 个动作 · ${categories.length} 个分类`;
    $("verifiedNote").hidden = Boolean(filter.value);
  };
  $("motionCategoryField").hidden = !motions.length;
  filter.onchange = updateFilter;
  updateFilter();
}

async function loadVerifiedMotions() {
  try {
    if (!replay) {
      const saved = localStorage.getItem(`${store}.before-verified`);
      if (saved) beforeVerified = JSON.parse(saved);
    }
  } catch {
    /* The presets still work when no backup has been stored. */
  }
  updateButtons();
  try {
    const response = await fetch("./motion-cache/catalog.json", {
      cache: "no-store",
    });
    if (!response.ok) throw Error("动作验证记录暂时不可用。");
    const catalog = await response.json();
    if (
      catalog?.model !== info.id ||
      catalog.modelSha256 !== info.sourceSha256 ||
      catalog.computationSha256 !== info.computationSha256
    )
      throw Error("当前模型与动作验证版本不匹配，未提供旧版通过动作。");
    const motions = catalog.motions.filter(
      (m) => m.verification?.verified === true,
    );
    renderMotionLibrary(motions);
    updateButtons();
    const requested = new URLSearchParams(location.search).get("case");
    const initial = motions.find(motion => motion.id === requested) ?? (replay ? motions[0] : null);
    if (initial) await useVerifiedMotion(initial);
  } catch (error) {
    $("verifiedNote").textContent = error.message;
  }
}
async function useVerifiedMotion(motion) {
  if (!info || solving || poseBusy || dragBusy || gripBusy || verifiedLoading)
    return;
  verifiedLoading = true;
  updateButtons();
  pause();
  const backup = replay || beforeVerified ? null : {
    schema: 1, model: info.id, ...inputScene(), draft: clone(draft),
  };
  invalidate("正在读取固定案例缓存…");
  if (replay) {
    for (const button of $("verifiedMotionList").querySelectorAll("button"))
      button.setAttribute("aria-pressed", "false");
    $("verifiedSelection").textContent = `正在读取并校验：${motion.label}`;
    $("viewLoading").hidden = false;
    $("viewLoading").textContent = `正在载入${motion.label}…`;
  }
  const version = revision;
  try {
    const currentModel = replay ? info : await api("model");
    if (currentModel.id !== info.id || currentModel.sourceSha256 !== info.sourceSha256 ||
        currentModel.computationSha256 !== info.computationSha256)
      throw Error("模型或计算版本已经改变，请刷新页面；旧缓存未启用。");
    const { value } = await loadCachedMotion(motion, info, replay?.fetchPublicMotion);
    if (version !== revision) throw Error("读取期间动作已改变，未应用缓存。");
    if (backup) {
      localStorage.setItem(`${store}.before-verified`, JSON.stringify(backup));
      beforeVerified = backup;
    }
    restoreScene(clone(motion.scene));
    if (sceneSignature(inputScene()) !== sceneSignature(motion.scene))
      throw Error("页面参数与缓存案例不一致，未启用缓存受力结果。");
    selectedAnatomicalMuscle = null;
    pendingGear = null;
    gripUndo = null;
    $("coordinateRegion").value = motion.region;
    $("muscleRegion").value = motion.region;
    $("muscleSearch").value = "";
    populateCoordinates();
    view.setRegion(motion.region, { fit: true });
    view.setView(motion.view);
    presentResult(value, { cached: true, preferredMuscle: motion.muscle });
    $("draftState").textContent =
      `已载入：${motion.label}。当前停在首帧，按播放查看完整受力结果。`;
    $("verifiedSelection").textContent = `已载入：${motion.label}`;
    if (!replay) editorMotionId = motion.id;
    if (window.parent !== window)
      window.parent.postMessage({type: "bodyvista:muscle-case", id: motion.id}, location.origin);
    for (const button of $("verifiedMotionList").querySelectorAll("button"))
      button.setAttribute("aria-pressed", String(button.dataset.motion === motion.id));
    if (replay) {
      if (matchMedia("(max-width: 760px)").matches) {
        document.body.dataset.workspaceCollapsed = "true";
        document.body.dataset.inspectorCollapsed = "true";
        updatePanelButtons();
      }
    }
    save();
  } catch (error) {
    if (replay) $("verifiedSelection").textContent = `${motion.label}未载入，可以再次选择。`;
    status(`动作未载入：${error.message}`, true);
    return;
  } finally {
    if (replay) $("viewLoading").hidden = true;
    verifiedLoading = false;
    updateButtons();
  }
}
$("restoreBeforeVerified").onclick = async () => {
  if (
    !beforeVerified ||
    solving ||
    poseBusy ||
    dragBusy ||
    gripBusy ||
    verifiedLoading
  )
    return;
  verifiedLoading = true;
  updateButtons();
  try {
    invalidate("正在恢复选择前的动作…");
    const removedBarbell = restoreScene(clone(beforeVerified));
    const version = revision;
    const accepted = await setDraft(
      beforeVerified.draft || keys[0]?.q || defaults,
      { invalidateResult: false, allowInvalid: true },
    );
    if (!accepted || version !== revision)
      throw Error("姿势请求失败或恢复期间动作已改变，请重试。");
    localStorage.setItem(
      store,
      JSON.stringify({ schema: 1, model: info.id, ...inputScene(), draft }),
    );
    localStorage.removeItem(`${store}.before-verified`);
    beforeVerified = null;
    $("verifiedSelection").textContent =
      "已恢复选择前的关键帧、草稿与支撑条件；定量结果需要重新计算。";
    $("draftState").textContent = removedBarbell ? removedBarbellNotice : "已恢复选择前的动作与草稿。";
    status(removedBarbell ? removedBarbellNotice : "已恢复选择前的动作与草稿；请重新计算。");
  } catch (error) {
    status(`恢复失败，备份仍保留：${error.message}`, true);
  } finally {
    verifiedLoading = false;
    updateButtons();
  }
};
function changingMuscleRanges(value) {
  const stored = cachedMuscleRanges(value);
  if (stored) return new Map([...stored].filter(([, range]) => range.change > MUSCLE_CHANGE_EPSILON_N + 1e-12));
  const ranges = new Map();
  const samples = value?.frames;
  if (value?.status !== "solved" || value.quantitativeValid !== true ||
      value.kinematicOnly || !samples || samples.length < 2 ||
      samples.some((sample) => sample.quantitativeValid !== true || sample.muscleValid !== true))
    return ranges;
  for (const sample of samples) {
    for (const muscle of sample.muscles || []) {
      if (!Number.isFinite(muscle.force) || muscle.force < 0) continue;
      const range = ranges.get(muscle.name) || { min: Infinity, max: -Infinity, count: 0 };
      range.min = Math.min(range.min, muscle.force);
      range.max = Math.max(range.max, muscle.force);
      range.count += 1;
      ranges.set(muscle.name, range);
    }
  }
  for (const [name, range] of ranges) {
    range.change = range.max - range.min;
    if (range.count !== samples.length || range.change <= MUSCLE_CHANGE_EPSILON_N + 1e-12)
      ranges.delete(name);
  }
  return ranges;
}
function populateMuscles(preferredMuscle) {
  const previous = preferredMuscle || $("muscleSelect").value;
  $("muscleSelect").replaceChildren();
  const region = $("muscleRegion").value,
    search = $("muscleSearch").value.trim().toLowerCase();
  const available = (info?.muscles || []).filter(
    (m) =>
      muscleVariations.has(m.name) &&
      (region === "all" || m.region === region) &&
      (!search || (m.label || m.name).toLowerCase().includes(search)),
  ).sort((a, b) => muscleVariations.get(b.name).change - muscleVariations.get(a.name).change);
  for (const muscle of available) {
    const record = coverage?.units?.find(
      (unit) => unit.name === muscle.name || unit.modelName === muscle.name,
    );
    const option = document.createElement("option");
    option.value = muscle.name;
    const range = muscleVariations.get(muscle.name);
    option.title = `整段张力 ${fmt(range.min, 2)}–${fmt(range.max, 2)} N，变化 ${fmt(range.change, 2)} N`;
    option.textContent =
      record?.label ||
      record?.atlasName ||
      record?.nameZh ||
      muscle.label ||
      `${regionLabels[muscle.region] || ""} · ${muscle.name}`;
    $("muscleSelect").append(option);
  }
  if ([...$("muscleSelect").options].some((o) => o.value === previous))
    $("muscleSelect").value = previous;
  $("muscleSelect").disabled = !available.length;
  if (!available.length) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = !result ? "计算后显示有变化的肌束" : "当前筛选下没有变化肌束";
    $("muscleSelect").append(placeholder);
  }
  $("muscleFilterNote").textContent = !result
    ? "暂无受力结果"
    : result.quantitativeValid !== true
      ? "受力结果未通过"
      : `${available.length} 个肌束 · 全身 ${muscleVariations.size} 个有变化`;
  view.setSelected($("muscleSelect").value || null, {
    preserveSurfaceCard: Boolean(selectedAnatomicalMuscle),
  });
}
function restoreScene(scene) {
  const legacyBarbell = scene.equipment?.type === "barbell" ? scene : null;
  if (legacyBarbell) {
    // Keep the motion, but never silently substitute a different loaded object.
    scene = { ...scene, loadKg: 0,
      equipment: { ...scene.equipment, type: "none", massKg: 0 } };
  }
  if (
    scene.model &&
    scene.model !== info.id &&
    !(info.compatiblePoseModels || []).includes(scene.model)
  )
    throw Error("实验属于其他模型，不能直接套用不同模型的关节与肌肉。");
  if (!Array.isArray(scene.keyframes) || scene.keyframes.length > 10)
    throw Error("实验应包含最多 10 个关键帧。");
  let last = -1;
  const restored = scene.keyframes.map((key, i) => {
    if (
      !Number.isFinite(key.t) ||
      key.t < 0 ||
      key.t > 30 ||
      (i === 0 && key.t !== 0) ||
      (i > 0 && (key.t - last < 0.25 || key.t - last > 10))
    )
      throw Error("关键帧时间不合法，整段最长 30 秒。");
    if (!key.q || typeof key.q !== "object" || Array.isArray(key.q))
      throw Error("缺少关键帧关节姿势。");
    const q = clone(defaults);
    for (const [name, value] of Object.entries(key.q)) {
      const c = coordinates.find((c) => c.name === name);
      if (
        !c ||
        !Number.isFinite(value) ||
        value < c.min - 1e-6 ||
        value > c.max + 1e-6
      )
        throw Error(`关节 ${name} 超出模型范围。`);
      q[name] = value;
    }
    last = key.t;
    return { t: key.t, q };
  });
  for (const [name, allowed] of Object.entries({
    support: ["feet", "seated", "assisted", "free"],
    hand: ["left", "right", "both"],
    supportFeet: ["left", "right", "both"],
  }))
    if (scene[name] !== undefined && !allowed.includes(scene[name]))
      throw Error(`未知 ${name} 条件。`);
  if (
    scene.groundEnabled !== undefined &&
    typeof scene.groundEnabled !== "boolean"
  )
    throw Error("地面开关必须为布尔值。");
  if (scene.groundEnabled === false && scene.support === "feet")
    throw Error("没有地面时不能使用足底支撑。");
  if (
    !Number.isFinite(scene.loadKg ?? 0) ||
    scene.loadKg < 0 ||
    scene.loadKg > 30
  )
    throw Error("手持质量应在 0–30 kg 内。");
  if (
    scene.rightShare !== undefined &&
    (!Number.isFinite(scene.rightShare) ||
      scene.rightShare < 0 ||
      scene.rightShare > 1)
  )
    throw Error("右足分担比例应在 0–1 之间。");
  if (
    scene.strengthScale !== undefined &&
    ![0.8, 1, 1.2].includes(scene.strengthScale)
  )
    throw Error("本页面支持的肌力比例为 80%、100% 或 120%。");
  if (
    scene.equipment?.type !== undefined &&
    !["none", "dumbbell"].includes(scene.equipment.type)
  )
    throw Error("未知器械类型。");
  if (
    scene.equipment?.friction !== undefined &&
    (!Number.isFinite(scene.equipment.friction) ||
      scene.equipment.friction < 0 ||
      scene.equipment.friction > 2)
  )
    throw Error("握把摩擦系数应在 0–2 之间。");
  if (legacyBarbell) {
    // Preserve each distinct legacy motion before committing the unloaded copy.
    const backup = `${store}.removed-barbell`;
    const raw = JSON.stringify(legacyBarbell);
    const saved = JSON.parse(localStorage.getItem(backup) || "[]");
    if (!Array.isArray(saved)) throw Error("旧杠铃动作备份无法读取，原动作未更改。");
    if (!saved.includes(raw)) localStorage.setItem(backup, JSON.stringify([...saved, raw]));
  }
  keys = restored;
  selected = keys.length ? 0 : -1;
  applySettings(scene);
  renderKeys();
  return Boolean(legacyBarbell);
}

$("confirm").onclick = () => {
  const gripProblem = captureGripProblem();
  if (gripProblem) return status(gripProblem, true);
  if (!canCapturePose() || keys.length >= 10) return;
  pause();
  pendingKey = clone(draft);
  if (keys.length) {
    $("timingBox").hidden = false;
    $("segmentTime").focus();
  } else addKey(0);
};
$("addTimed").onclick = () => {
  const dt = Number($("segmentTime").value);
  if (!Number.isFinite(dt) || dt < 0.25 || dt > 10)
    return status("每段时间应在 0.25–10 秒之间。", true);
  addKey(dt);
};
$("cancelTimed").onclick = () => {
  $("timingBox").hidden = true;
  pendingKey = null;
};
$("replace").onclick = () => {
  const gripProblem = captureGripProblem();
  if (gripProblem) return status(gripProblem, true);
  if (selected < 0 || !canCapturePose())
    return;
  keys[selected].q = clone(draft);
  invalidate("已替换选中关键帧。");
  renderKeys();
  save();
};
$("muscleDisplay").onchange = () => {
  pause();
  movieCache = null;
  const mode = $("muscleDisplay").value;
  if (mode === "anatomy") view.setSurfaceQuality("detail");
  view.setMuscleDisplay(mode === "paths" ? "paths" : "anatomy");
  if (replay) replay.showSurfaceStatus({ready: view.state.anatomicalMuscles?.ready}, view.state);
  $("renderNote").textContent =
    $("muscleDisplay").value === "paths"
      ? "计算肌腱路径示意，非真实肌肉体积。张力：灰绿 0 → 橙 300 → 红 ≥1200 N。"
      : "原始精细解剖表面随骨架运动；可点击查看肌肉名称和已计算的力值。";
};
if (replay) $("retryPublicSurface").onclick = () => {
  pause();
  movieCache = null;
  view.setSurfaceQuality("detail");
  replay.showSurfaceStatus({}, view.state);
};
$("resetPose").onclick = async () => {
  if (!info || solving || poseBusy || dragBusy || gripBusy || verifiedLoading || rotationGesture)
    return;
  const q = clone(defaults),
    loaded = Number($("loadKg").value) > 0,
    hand = $("hand").value;
  if (loaded) {
    // Same finger coordinate prefix and side convention as grasp.py finger_names.
    for (const name of Object.keys(q))
      if (/^\d?(?:cmc|mcp|mp|ip|pm|md)_/.test(name) &&
          (hand === "both" || name.endsWith("_l") === (hand === "left")))
        q[name] = draft[name] ?? q[name];
  }
  const accepted = await setDraft(q);
  if (accepted && loaded) {
    const message = `已回到站姿，保留${hand === "both" ? "双手" : hand === "left" ? "左手" : "右手"}持物时的手指姿势。${captureGripProblem() || "可继续编排动作。"}`;
    $("draftState").textContent = message;
    status(message, Boolean(captureGripProblem()));
  }
};
$("coordinate").onchange = updateCoordinate;
$("coordinateRegion").onchange = () => {
  populateCoordinates();
  view.setRegion($("coordinateRegion").value, { fit: true });
  drawResults();
};
$("muscleRegion").onchange = () => {
  selectedAnatomicalMuscle = null;
  populateMuscles();
  drawResults();
};
$("muscleSearch").oninput = () => {
  selectedAnatomicalMuscle = null;
  populateMuscles();
  drawResults();
};
$("applyCoordinate").onclick = () => {
  if (solving) return;
  const c = coordinates.find((c) => c.name === $("coordinate").value),
    value = Number($("coordinateValue").value);
  if (!c || !Number.isFinite(value) || value < c.min || value > c.max)
    return status("请输入关节活动范围内的值。", true);
  setDraft({ ...draft, [c.name]: value });
};
for (const id of ["support", "supportFeet", "strengthScale"])
  $(id).onchange = () => {
    if (id === "support" && $("support").value !== "feet")
      lastNonFootSupport = $("support").value;
    invalidate();
    updateSettings();
    save();
  };
$("hand").onchange = () => {
  if (Number($("loadKg").value) > 0 && gearType !== "none" && !pendingGear) {
    const requestedHand = $("hand").value;
    $("hand").value = appliedHand;
    attachGear(gearType, requestedHand);
  } else {
    invalidate();
    updateSettings();
    save();
  }
};
$("regrip").onclick = () => attachGear(pendingGear || gearType, $("hand").value);
$("undoGrip").onclick = async () => {
  if (
    !gripUndo ||
    gripUndo.revision !== revision ||
    gripBusy ||
    solving ||
    poseBusy ||
    dragBusy ||
    verifiedLoading
  )
    return;
  const backup = gripUndo;
  const previous = backup.scene;
  const requestRevision = revision;
  pause();
  gripBusy = true;
  updateButtons();
  try {
    const value = await api("pose", {
      q: previous.draft,
      equipment: previous.equipment,
      loadKg: previous.loadKg,
      hand: previous.hand,
    });
    if (revision !== requestRevision)
      throw Error("等待期间场景已改变，未应用旧姿势。");
    restoreScene(previous);
    selected = backup.selected ?? selected;
    pendingKey = backup.pendingKey ? clone(backup.pendingKey) : null;
    $("timingBox").hidden = backup.timingHidden ?? !pendingKey;
    gripUndo = null;
    invalidate("已撤销本次握持，恢复调整前的手指、关键帧及器械。");
    showFrame(value);
    updateCoordinate();
    renderKeys();
    updateSettings();
    save();
  } catch (error) {
    status(`撤销未应用，当前场景和撤销备份保留：${error.message}`, true);
  } finally {
    finishGripOperation();
  }
};
$("groundToggle").onclick = () => {
  if (!info || solving || poseBusy || dragBusy || gripBusy || verifiedLoading || rotationGesture)
    return;
  const enabled = $("groundToggle").getAttribute("aria-pressed") !== "true",
    support = $("support").value;
  if (support !== "feet") lastNonFootSupport = support;
  $("groundToggle").setAttribute("aria-pressed", String(enabled));
  $("support").value = enabled ? "feet" : support === "feet" ? lastNonFootSupport : support;
  const restoredSupport = $("support").selectedOptions[0]?.textContent || $("support").value;
  invalidate(
    enabled
      ? "已添加地面并启用足底支撑。重新计算后检查承重、接触与穿地。"
      : `已移除地面，${support === "feet" ? "恢复" : "保留"}“${restoredSupport}”；重力仍然生效。`,
  );
  updateSettings();
  save();
};
$("loadKg").oninput = () => {
  invalidate();
  if (!$("loadKg").checkValidity())
    return status("手持质量应在 0–30 kg 内。", true);
  updateSettings();
  save();
};
$("loadKg").onchange = () => {
  if (!$("loadKg").checkValidity()) return;
  if (Number($("loadKg").value) > 0) {
    if (pendingGear || gearType === "none")
      status("重量已设定 · 待握持");
    else if (!frame?.grasp?.geometryValid)
      attachGear(gearType, $("hand").value);
    else {
      gearMassKg = Number($("loadKg").value);
      updateSettings();
      save();
      setDraft(clone(draft), { invalidateResult: false, allowInvalid: true });
    }
  } else $("unload").click();
  updateButtons();
};
$("unload").onclick = () => {
  $("loadKg").value = "0";
  gearType = "none";
  gearMassKg = 0;
  pendingGear = null;
  document.querySelectorAll(".equipment.pending").forEach(button => button.classList.remove("pending"));
  invalidate("已卸下器械。");
  updateSettings();
  save();
};
for (const b of document.querySelectorAll("[data-view]"))
  b.onclick = () => {
    viewMode = b.dataset.view;
    view.setView(viewMode);
    document
      .querySelectorAll("[data-view]")
      .forEach((other) => other.classList.toggle("selected", other === b));
  };
$("solve").onclick = () => calculate();
$("checkPose").onclick = checkCurrentPose;
$("preview").onclick = () => calculate(true);
$("play").onclick = () => (playing || moviePreparation ? pause() : startPlayback());
$("timeline").oninput = () => {
  pause();
  cancelAnimationFrame(seekTick);
  seekTick = requestAnimationFrame(() => {
    seekTick = 0;
    selectFrame(Number($("timeline").value));
  });
};
$("muscleSelect").onchange = () => {
  selectedAnatomicalMuscle = null;
  view.setSelected($("muscleSelect").value);
  $("selectionLabel").textContent =
    $("muscleSelect").selectedOptions[0]?.textContent || "";
  drawResults();
};
$("exampleKnee").onclick = () => example("knee");
$("exampleLift").onclick = () => example("lift");
$("exampleSquat").onclick = () => example("squat");
$("exampleHand").onclick = () => example("hand");
$("exampleSpread").onclick = () => example("spread");
$("exampleGrip").onclick = () => example("grip");
$("exampleNeck").onclick = () => example("neck");
$("exampleTrunk").onclick = () => example("trunk");
$("newSequence").onclick = () => {
  if (solving || gripBusy || verifiedLoading) return;
  pendingKey = null;
  $("timingBox").hidden = true;
  keys = [];
  selected = -1;
  invalidate(`新动作已准备，沿用当前支撑与负重。${captureGripProblem() || "请确认第一个关键帧。"}`);
  renderKeys();
  save();
};
$("export").onclick = () => {
  const blob = new Blob(
    [JSON.stringify({ schema: 1, model: info?.id, ...inputScene() }, null, 2)],
    { type: "application/json" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "bodyvista-full-body-scene.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$("import").onchange = async () => {
  const file = $("import").files[0];
  if (!file || !info || solving || gripBusy || verifiedLoading) return;
  try {
    if (file.size > 262144) throw Error("实验文件超过 256 KB。");
    const importRevision = revision;
    const value = JSON.parse(await file.text());
    if (gripBusy || verifiedLoading || revision !== importRevision)
      throw Error("读取文件期间场景已改变，请重新导入。");
    const removedBarbell = restoreScene(value);
    invalidate("实验已导入；定量结果需要重新计算。");
    await setDraft(keys[0]?.q || defaults, {
      invalidateResult: false,
      allowInvalid: true,
    });
    save();
    if (removedBarbell) {
      $("draftState").textContent = removedBarbellNotice;
      status(removedBarbellNotice);
    }
  } catch (error) {
    status(`导入失败：${error.message}`, true);
  } finally {
    $("import").value = "";
  }
};
setupGear();
setupWorkspace();
setupHelp();
document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
window.addEventListener("pagehide", event => {
  pause();
  if (replay && !event.persisted) view.dispose();
});
clearResults();

function setupHelp() {
  const bubble = document.createElement("div");
  bubble.id = "context-help";
  bubble.className = "help-tooltip";
  bubble.setAttribute("role", "tooltip");
  bubble.hidden = true;
  document.body.append(bubble);
  let active = null, pinned = false, suppressed = null, hideTimer = 0;
  const triggerFor = target => target instanceof Element ? target.closest(".help-button") : null;
  const hide = () => {
    clearTimeout(hideTimer);
    active?.removeAttribute("aria-describedby");
    active = null;
    pinned = false;
    bubble.hidden = true;
  };
  const show = trigger => {
    if (!trigger || trigger.disabled || trigger === suppressed) return;
    clearTimeout(hideTimer);
    const sources = (trigger.dataset.helpSource || "").split(/\s+/).filter(Boolean);
    const content = [trigger.dataset.help, ...sources.map(id => $(id)?.textContent?.trim())].filter(Boolean).join("\n\n");
    if (!content) return;
    if (active !== trigger) { hide(); active = trigger; }
    bubble.textContent = content;
    bubble.hidden = false;
    trigger.setAttribute("aria-describedby", bubble.id);
    bubble.style.maxHeight = `${Math.max(60, window.innerHeight - 16)}px`;
    const anchor = trigger.getBoundingClientRect(), bounds = bubble.getBoundingClientRect();
    bubble.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8))}px`;
    const top = anchor.bottom + 8 + bounds.height <= window.innerHeight - 8
      ? anchor.bottom + 8 : Math.max(8, anchor.top - bounds.height - 8);
    bubble.style.top = `${top}px`;
  };
  const hideSoon = () => {
    clearTimeout(hideTimer);
    if (!pinned) hideTimer = setTimeout(() => {
      if (document.activeElement !== active) hide();
    }, 150);
  };
  document.addEventListener("pointerover", event => {
    const trigger = triggerFor(event.target);
    if (trigger && !trigger.contains(event.relatedTarget)) show(trigger);
    if (bubble.contains(event.target)) clearTimeout(hideTimer);
  });
  document.addEventListener("pointerout", event => {
    const trigger = triggerFor(event.target);
    if (trigger && !trigger.contains(event.relatedTarget)) {
      if (suppressed === trigger) suppressed = null;
      if (!bubble.contains(event.relatedTarget)) hideSoon();
    }
    if (bubble.contains(event.target) && !bubble.contains(event.relatedTarget) && !active?.contains(event.relatedTarget)) hideSoon();
  });
  document.addEventListener("focusin", event => show(triggerFor(event.target)));
  document.addEventListener("focusout", event => {
    if (triggerFor(event.target)) { suppressed = null; if (!pinned) hide(); }
  });
  document.addEventListener("click", event => {
    const trigger = triggerFor(event.target);
    if (trigger) {
      if (pinned && active === trigger) { suppressed = trigger; hide(); }
      else { suppressed = null; show(trigger); pinned = active === trigger; }
    } else if (!bubble.contains(event.target)) hide();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && active) {
      suppressed = active;
      hide();
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener("scroll", event => { if (!bubble.contains(event.target)) hide(); }, true);
  window.addEventListener("resize", hide);
}

function setupWorkspace() {
  $("status").onclick = () => { if ($("statusNotice")) $("statusNotice").hidden = false; };
  $("status").onkeydown = event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); $("status").click(); }
  };
  if ($("closeStatus")) $("closeStatus").onclick = () => { $("statusNotice").hidden = true; $("status").focus(); };
  const wireTabs = (attribute, activate) => {
    const buttons = [...document.querySelectorAll(`[${attribute}]`)];
    buttons.forEach((button, index) => {
      button.onclick = () => activate(button.getAttribute(attribute));
      button.onkeydown = event => {
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % buttons.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + buttons.length) % buttons.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = buttons.length - 1;
        else return;
        event.preventDefault();
        buttons[next].click();
        buttons[next].focus();
      };
    });
  };
  wireTabs("data-workspace-tab", showWorkspace);
  wireTabs("data-inspector-tab", showInspector);
  for (const [id, name, other] of [["toggleWorkspace", "workspaceCollapsed", "inspectorCollapsed"], ["toggleInspector", "inspectorCollapsed", "workspaceCollapsed"]]) {
    const button = $(id);
    if (!button) continue;
    button.onclick = () => {
      const collapsed = document.body.dataset[name] !== "true";
      document.body.dataset[name] = String(collapsed);
      button.setAttribute("aria-expanded", String(!collapsed));
      if (!collapsed && matchMedia("(max-width: 760px)").matches) {
        document.body.dataset[other] = "true";
        $(other === "workspaceCollapsed" ? "toggleWorkspace" : "toggleInspector")?.setAttribute("aria-expanded", "false");
      }
      if (!collapsed) drawResults();
      updatePanelButtons();
    };
  }
  const narrow = matchMedia("(max-width: 760px)");
  const setInitialPanels = () => {
    for (const [id, name] of [["toggleWorkspace", "workspaceCollapsed"], ["toggleInspector", "inspectorCollapsed"]]) {
      document.body.dataset[name] = String(narrow.matches);
      $(id)?.setAttribute("aria-expanded", String(!narrow.matches));
    }
    updatePanelButtons();
  };
  setInitialPanels();
  narrow.addEventListener("change", setInitialPanels);
  const chartObserver = new ResizeObserver(() => drawChart());
  chartObserver.observe($("forceChart"));
  window.addEventListener("pagehide", () => chartObserver.disconnect(), { once: true });
  if ($("jointSearch")) $("jointSearch").oninput = renderJointList;
  if ($("jointRegion")) $("jointRegion").onchange = () => {
    $("coordinateRegion").value = $("jointRegion").value;
    populateCoordinates();
    view.setRegion($("jointRegion").value, { fit: true });
    renderJointList();
  };
  for (const [id, direction] of [["previousFrame", -1], ["nextFrame", 1]]) {
    if (!$(id)) continue;
    $(id).onclick = () => {
      if (!frames.length) return;
      pause();
      const t = frames[index].t;
      const target = direction > 0 ? keys.find(key => key.t > t + 1e-5)
        : [...keys].reverse().find(key => key.t < t - 1e-5);
      const targetTime = target?.t ?? (direction > 0 ? frames.at(-1).t : 0);
      const closest = frames.reduce((best, candidate, n) =>
        Math.abs(candidate.t - targetTime) < Math.abs(frames[best].t - targetTime) ? n : best, 0);
      selectFrame(closest);
    };
  }
  if ($("playbackSpeed")) $("playbackSpeed").onchange = () => {
    if (playing) playStart = performance.now() - frames[index].t * 1000 / playbackSpeed();
  };
  $("segmentTime").onkeydown = event => {
    if (event.key === "Enter") { event.preventDefault(); $("addTimed").click(); }
  };
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      if ($("statusNotice")) $("statusNotice").hidden = true;
      if (playing || moviePreparation) pause();
      if (!$("timingBox").hidden) $("cancelTimed").click();
      pendingGear = null;
      document.querySelectorAll(".equipment.pending").forEach(button => button.classList.remove("pending"));
      $("loadKg").value = equipment().massKg;
      $("hand").value = appliedHand;
      updateSettings();
      updateButtons();
    }
    if (event.code === "Space" && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey &&
        !event.target.closest("input, select, textarea, button, a, [contenteditable=true]")) {
      event.preventDefault();
      if (!$("play").disabled) $("play").click();
    }
  });
}

async function boot() {
  try {
    [info] = await Promise.all([api("model"), view.ready]);
    $("exampleGrip").textContent = info.handReferenceCoordinates?.length ? "握拳" : "握拳反例";
    coordinates = info.coordinates;
    defaults = clone(info.defaults);
    store = `bodyvista.body-lab.${info.id}.scene.v1`;
    view.setMetadata(info);
    void loadEvidence();
    for (const id of ["coordinateRegion", "muscleRegion", "jointRegion"]) {
      if (!$(id)) continue;
      for (const [value, label] of Object.entries(regionLabels)) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        $(id).append(option);
      }
    }
    $("muscleTotal").textContent = `肌腱单元 / ${info.muscles.length}`;
    populateCoordinates();
    populateMuscles();
    view.setView(viewMode);
    if (replay) {
      draft = clone(defaults);
      showInspector("forces");
      showWorkspace("motions");
      $("connection").textContent = `${info.muscles.length} 个肌腱单元`;
      $("resultKind").textContent = "等待回放";
      $("viewLoading").hidden = true;
      await loadVerifiedMotions();
      return;
    }
    let restored = false,
      restoredDraft = null,
      migrated = false,
      removedBarbell = false;
    try {
      let saved = localStorage.getItem(store);
      if (saved === null) {
        for (const previousModel of info.compatiblePoseModels || []) {
          const previous = localStorage.getItem(
            `bodyvista.body-lab.${previousModel}.scene.v1`,
          );
          if (previous === null) continue;
          const candidate = JSON.parse(previous);
          if (candidate?.model !== previousModel) continue;
          saved = previous;
          migrated = true;
          break;
        }
      }
      const value = JSON.parse(saved || "null");
      if (value) {
        removedBarbell = restoreScene(value);
        restored = true;
        if (
          value.draft &&
          typeof value.draft === "object" &&
          !Array.isArray(value.draft) &&
          Object.entries(value.draft).every(([name, v]) =>
            coordinates.some(
              (c) =>
                c.name === name &&
                Number.isFinite(v) &&
                v >= c.min - 1e-6 &&
                v <= c.max + 1e-6,
            ),
          )
        )
          restoredDraft = { ...defaults, ...value.draft };
      }
    } catch (error) {
      status(`保存的实验未恢复：${error.message}`, true);
    }
    const poseRestored = await setDraft(restoredDraft || keys[0]?.q || defaults, {
      invalidateResult: false,
      allowInvalid: true,
    });
    if (removedBarbell && poseRestored) save();
    if (restored)
      $("draftState").textContent = removedBarbell ? removedBarbellNotice : keys.length
        ? `已${migrated ? "兼容升级并" : ""}恢复 ${keys.length} 个关键帧及当前草稿。${migrated ? "已有坐标保留，新增坐标使用默认值；旧版副本保留，力值需重新计算。" : "调整后可替换选中帧，或添加下一帧。"}`
        : `已${migrated ? "兼容升级并" : ""}恢复当前草稿；摆好后确认第一个关键帧。`;
    view.fit();
    $("connection").textContent =
      `模型已连接 · ${info.muscles.length} 个肌腱单元`;
    $("viewLoading").hidden = true;
    $("resultKind").textContent = "尚无计算";
    updateButtons();
    renderKeys();
    renderJointList();
    updateSettings();
    void loadVerifiedMotions();
    if (!lastError)
      status(
        removedBarbell ? removedBarbellNotice : frame?.anatomy?.valid === false
          ? "已保留原动作；当前草稿超出新增约束。可逐步调回，或点“回到站姿”重新摆姿势。"
          : "就绪",
        frame?.anatomy?.valid === false,
      );
    const demo = new URLSearchParams(location.search).get("demo");
    if (!restored && demo === "1") await example("knee");
    else if (
      !restored &&
      [
        "knee",
        "lift",
        "hand",
        "spread",
        "neck",
        "trunk",
        "grip",
        "squat",
      ].includes(demo)
    )
      await example(demo);
  } catch (error) {
    $("connection").textContent = "模型未连接";
    $("viewLoading").textContent = error.message;
    status(error.message, true);
  }
}
boot();
