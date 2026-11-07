const byId = (id) => document.getElementById(id);
const muscles = [
  "肱二头肌长头",
  "肱二头肌短头",
  "肱肌",
  "肱三头肌长头",
  "肱三头肌外侧头",
  "肱三头肌内侧头",
];
const freshScene = () => ({
  mode: "prescribed",
  objective: "effort",
  keyframes: [],
  equipment: { type: "none", massKg: 0 },
  loadKg: 0,
  radiusM: 0.3,
  extensorMin: 0,
});
const copy = (value) => JSON.parse(JSON.stringify(value));
const experiments = [
  {
    scene: freshScene(),
    result: null,
    status: "待摆姿势",
    note: "先在图上摆好起始姿势，确认第一帧。",
  },
];
let slot = 0,
  generation = 0,
  aborter = null,
  savedModel = null,
  offline = false;
let selected = -1,
  metric = "force",
  frameIndex = 0,
  anim = 0,
  cycleStart = 0,
  startT = 0;
let referenceView = null,
  loadedView = null,
  editor = null,
  editIntent = 0,
  followPlayback = false,
  plot = null;
let selectableMuscles = new Set();
const FORCE_CHANGE_MIN_N = 0.01;

const STORE_KEY = "bodyvista.elbow-lab.studio.v2";
const OLD_STORE_KEY = "bodyvista.elbow-lab.scenes.v1";
const POSE_KEYS = ["angle", "shoulderDeg", "rootX", "rootY", "wristDeg"];
const gearOf = (scene) =>
  scene.equipment ||
  (scene.loadKg > 0
    ? { type: "dumbbell", massKg: scene.loadKg }
    : { type: "none", massKg: 0 });
const legacyPoint = (sc) =>
  !sc.equipment && sc.loadKg > 0 && Math.abs(sc.radiusM - 0.3) > 1e-8;
const exceedsSingleJoint = (keys) =>
  keys.some(
    (f) =>
      f.shoulderDeg ||
      f.wristDeg ||
      ["rootX", "rootY"].some((k) => (f[k] || 0) !== (keys[0]?.[k] || 0)),
  );
function updateModes() {
  const sc = current().scene,
    guided = exceedsSingleJoint(sc.keyframes);
  byId("mode").value = guided ? "prescribed" : sc.mode;
  byId("mode").disabled = guided;
  byId("modeNote").hidden = !guided;
  byId("objectiveRow").hidden = guided || sc.mode !== "predict";
  byId("legacyLoad").hidden = !legacyPoint(sc);
  byId("legacyLoad").textContent = legacyPoint(sc)
    ? "此旧实验的负载作用点距肘 " +
      sc.radiusM +
      " m。编辑器械或重新确认姿势后，负载改为握在掌心。"
    : "";
}
let frozenResult = null;
function modelStamp(model) {
  if (
    typeof model?.id !== "string" ||
    !model.id ||
    ![model.sourceSHA256, model.tableSHA256].every(
      (s) => typeof s === "string" && /^[a-f0-9]{64}$/i.test(s),
    )
  )
    return null;
  return [model.id, model.sourceSHA256, model.tableSHA256].join(":");
}
function canUseFrozen(card, result) {
  const stamp = modelStamp(result?.model);
  return Boolean(
    stamp &&
      card.stamp === stamp &&
      JSON.stringify(cleanScene(card.scene)) ===
        JSON.stringify(cleanScene(result.scene)),
  );
}
function pendingOffline() {
  current().status = "待计算";
  current().note =
    "当前为静态回放。已保留实验输入；自定义条件或不同模型版本需连接本地求解服务。";
  refresh();
}
const STORED_LIMIT = 250;
const blankCard = (scene) => ({
  scene,
  result: null,
  status: "待计算",
  note: "已恢复实验输入。重新计算后显示定量曲线。",
});
function cleanScene(value) {
  if (
    !value ||
    !["prescribed", "predict"].includes(value.mode) ||
    !["effort", "smooth"].includes(value.objective ?? "effort") ||
    !Array.isArray(value.keyframes) ||
    value.keyframes.length > 10
  )
    throw Error("实验输入的格式或版本不受支持。");
  const draftNumber = (x) => {
    if (x === null || Number.isFinite(x)) return x;
    throw Error("实验条件含有无效的数值。");
  };
  const clean = {
    mode: value.mode,
    objective: value.objective ?? "effort",
    keyframes: value.keyframes.map((f) =>
      Object.fromEntries(
        ["t", ...POSE_KEYS]
          .filter((k) => k === "t" || k === "angle" || f?.[k] !== undefined)
          .map((k) => [k, draftNumber(f?.[k])]),
      ),
    ),
    loadKg: draftNumber(value.loadKg),
    radiusM: draftNumber(value.radiusM),
    extensorMin: draftNumber(value.extensorMin),
  };
  if (value.equipment !== undefined) {
    const g = value.equipment;
    if (
      !["none", "dumbbell", "barbell"].includes(g?.type) ||
      !Number.isFinite(g.massKg) ||
      g.massKg < 0 ||
      g.massKg > 20 ||
      (g.type === "none") !== (g.massKg === 0) ||
      g.massKg !== clean.loadKg
    )
      throw Error("器械类型与重量不符。");
    clean.equipment = { type: g.type, massKg: g.massKg };
  }
  return clean;
}
// Store only editable cards. Curves belong to the version of the running solver.
function saveCards() {
  const note = byId("storageStatus");
  try {
    const contents = {
      version: 1,
      slot,
      cards: experiments.map((ex) => ({
        scene: cleanScene(ex.scene),
        solved: Boolean(ex.result),
        stamp: modelStamp(ex.result?.model) || ex.stamp || null,
      })),
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(contents));
    note.textContent = "";
  } catch {
    note.textContent = "浏览器未能保存实验输入。请在离开前导出已求解的实验。";
  }
}
function restoreCards() {
  try {
    const migrated = localStorage.getItem(STORE_KEY) === null;
    const raw = localStorage.getItem(migrated ? OLD_STORE_KEY : STORE_KEY);
    if (!raw) return null;
    if (raw.length > 2_000_000) throw Error();
    const saved = JSON.parse(raw);
    if (
      saved.version !== 1 ||
      !Array.isArray(saved.cards) ||
      saved.cards.length < 1 ||
      saved.cards.length > STORED_LIMIT ||
      !Number.isInteger(saved.slot) ||
      saved.slot < 0 ||
      saved.slot >= saved.cards.length
    )
      throw Error();
    const cards = saved.cards.map((c) => ({
      ...blankCard(cleanScene(c?.scene)),
      stamp:
        typeof c?.stamp === "string" && c.stamp.length < 240 ? c.stamp : null,
    }));
    experiments.splice(0, experiments.length, ...cards);
    slot = saved.slot;
    if (migrated && cards.length < STORED_LIMIT) {
      experiments.push(blankCard(freshScene()));
      slot = experiments.length - 1;
      saveCards();
      return { solve: false };
    }
    return { solve: saved.cards[slot].solved === true };
  } catch {
    byId("storageStatus").textContent =
      "本机旧实验无法读取。本页将使用初始样例。";
    return null;
  }
}
const current = () => experiments[slot];
const frames = () => current().result?.frames || [];
const nice = (x, places = 2) => (Number.isFinite(x) ? x.toFixed(places) : "—");
const option = (label, value) => new Option(label, String(value));
const create = (tag, text) => {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  return el;
};
const fieldValue = (el) => (el.value.trim() === "" ? null : el.valueAsNumber);
const viewForces = (values) =>
  Array.isArray(values) && values.length === 6 && values.every(Number.isFinite)
    ? values
    : null;
const SVG = "http://www.w3.org/2000/svg";
function svgNode(tag, attrs, content) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs))
    el.setAttribute(key, String(value));
  if (content !== undefined) el.textContent = content;
  return el;
}
function changingMuscleIndices(result) {
  const data = result?.frames || [];
  if (result?.kinematicOnly || data.length < 2) return [];
  return muscles.flatMap((_, index) => {
    const changes = ["forces", "referenceForces"].some((key) => {
      let min = Infinity,
        max = -Infinity;
      for (const f of data) {
        const value = f[key]?.[index];
        if (!Number.isFinite(value) || value < 0) return false;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      // Ignore round-off at the boundary without rounding the original forces.
      return max - min > FORCE_CHANGE_MIN_N + Number.EPSILON * Math.max(1, max) * 8;
    });
    return changes ? [index] : [];
  });
}
function muscleFilterSummary() {
  return selectableMuscles.size
    ? `仅列出整段张力变化超过 ${FORCE_CHANGE_MIN_N} N 的肌肉：${selectableMuscles.size}/${muscles.length} 个。空手或实验任一曲线有变化即可；全部肌肉仍参与计算。`
    : current().result && !current().result.kinematicOnly
      ? `当前动作没有整段张力变化超过 ${FORCE_CHANGE_MIN_N} N 的肌肉。`
      : "取得有效的肌力结果后，只列出整段张力有变化的肌肉。";
}
function updateMuscleChoices() {
  selectableMuscles = new Set(changingMuscleIndices(current().result));
  const select = byId("muscle");
  select.replaceChildren(
    ...[...selectableMuscles].map((index) => option(muscles[index], index)),
  );
  if (!selectableMuscles.has(selected)) selected = [...selectableMuscles][0] ?? -1;
  if (selected < 0) {
    const empty = option(current().result?.kinematicOnly || !current().result
      ? "等待有效计算结果" : "没有符合条件的肌肉", "");
    empty.disabled = true;
    select.append(empty);
  }
  select.value = selected < 0 ? "" : String(selected);
  select.disabled = selectableMuscles.size === 0;
  byId("muscleFilterNote").textContent = muscleFilterSummary();
  tableRows.forEach(({ button }, index) => {
    button.disabled = !selectableMuscles.has(index);
  });
}
function pickMuscle(index) {
  if (!Number.isInteger(index) || index < 0 || index >= muscles.length) return;
  selected = selectableMuscles.has(index) ? index : -1;
  byId("muscle").value = selected < 0 ? "" : String(selected);
  byId("muscleFilterNote").textContent = selected < 0
    ? `${muscles[index]}未满足整段张力变化筛选条件，请选择列表中的肌肉。`
    : muscleFilterSummary();
  drawPlot();
  renderFrame();
}
async function startViews() {
  try {
    const { createArmView } = await import("./arm-view.js");
    referenceView = createArmView(byId("armReference"), pickMuscle);
    loadedView = createArmView(byId("armExperiment"), pickMuscle);
    renderFrame();
  } catch (error) {
    for (const id of ["armReference", "armExperiment"]) {
      const message = create(
        "div",
        "三维视图暂不可用，仍可查看角度、力矩和肌肉曲线。",
      );
      message.className = "arm-error";
      byId(id).replaceChildren(message);
    }
    console.warn("三维视图加载失败", error);
  }
}
function cancelWork() {
  generation++;
  aborter?.abort();
  aborter = null;
  pause();
}
function pause() {
  cancelAnimationFrame(anim);
  anim = 0;
  byId("studioPlay").textContent = "播放";
  byId("play").textContent = "▶ 播放";
  byId("play").setAttribute("aria-label", "播放动作");
}
function findFrame(data, t) {
  let low = 0,
    high = data.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (data[mid].t < t) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && t - data[low - 1].t < data[low].t - t) return low - 1;
  return low;
}
function play() {
  const data = frames();
  if (!data.length) return;
  if (anim) {
    pause();
    return;
  }
  if (frameIndex === data.length - 1) frameIndex = 0;
  followPlayback = true;
  byId("studioPlay").textContent = "暂停";
  startT = data[frameIndex].t;
  cycleStart = performance.now();
  byId("play").textContent = "Ⅱ 暂停";
  byId("play").setAttribute("aria-label", "暂停动作");
  const tick = (now) => {
    const t = startT + (now - cycleStart) / 1000;
    frameIndex = findFrame(data, Math.min(t, data.at(-1).t));
    renderFrame();
    if (t >= data.at(-1).t) {
      pause();
      return;
    }
    anim = requestAnimationFrame(tick);
  };
  anim = requestAnimationFrame(tick);
}
function playFromStart() {
  frameIndex = 0;
  followPlayback = true;
  renderFrame();
  play();
}
function switchSlot(index) {
  const previousTime = frames()[frameIndex]?.t;
  cancelWork();
  if (current().status === "计算中") {
    current().status = "待计算";
    current().note = "计算已取消；该实验的输入仍保留。";
  }
  slot = index;
  if (
    offline &&
    frozenResult &&
    !current().result &&
    canUseFrozen(current(), frozenResult)
  ) {
    acceptResult(
      frozenResult,
      "本次输入和模型版本与冻结样例一致，已恢复静态回放。",
    );
  }
  saveCards();
  followPlayback = false;
  syncStudio();
  frameIndex =
    Number.isFinite(previousTime) && frames().length
      ? findFrame(frames(), previousTime)
      : 0;
  syncForm();
  refresh();
}
function syncForm() {
  byId("slot").replaceChildren(
    ...experiments.map((_, i) =>
      option("实验 " + String(i + 1).padStart(2, "0"), i),
    ),
  );
  byId("slot").value = String(slot);
  const sc = current().scene;
  byId("mode").value = sc.mode;
  byId("objective").value = sc.objective || "effort";
  byId("objectiveRow").hidden = sc.mode !== "predict";
  byId("extensor").value = sc.extensorMin ?? "";
  updateModes();
}
function syncStudio() {
  const sc = current().scene;
  editor?.setScene({
    keyframes: copy(sc.keyframes),
    equipment: copy(gearOf(sc)),
  });
}
async function startStudio() {
  try {
    const { createPoseEditor } = await import("./pose-editor.js");
    editor = createPoseEditor(byId("poseStudio"), {
      onDraft() {
        pause();
        editIntent++;
        followPlayback = false;
      },
      onPreview() {
        pause();
        editIntent++;
        followPlayback = false;
      },
      onChange({ keyframes, equipment }) {
        followPlayback = false;
        const sc = current().scene;
        sc.keyframes = copy(keyframes);
        // Every newly confirmed pose uses the grasp shown by the editor.
        sc.equipment = copy(equipment);
        sc.radiusM = 0.3;
        sc.loadKg = equipment.massKg;
        updateModes();
        markDirty();
      },
    });
    syncStudio();
    if (followPlayback) renderFrame();
  } catch (error) {
    byId("poseStudio").textContent = "动作编辑器没有载入：" + error.message;
  }
}
function markDirty() {
  cancelWork();
  current().result = null;
  current().status = "待计算";
  current().note =
    current().scene.keyframes.length < 2
      ? "确认至少两个姿势后就能播放。"
      : "姿势已保存。点击“生成并播放”查看这段动作。";
  saveCards();
  frameIndex = 0;
  refresh();
}
function refresh() {
  const ex = current(),
    data = frames(),
    available = Boolean(data.length);
  byId("status").textContent = ex.status;
  byId("status").className =
    "badge " +
    (available ? "" : ex.status === "求解失败" ? "error" : "pending");
  byId("message").textContent = ex.note;
  byId("message").className = ex.status === "求解失败" ? "error" : "";
  byId("solve").disabled =
    ex.status === "计算中" || ex.scene.keyframes.length < 2;
  byId("solve").textContent =
    ex.status === "计算中" ? "正在生成…" : "生成并播放";
  byId("play").disabled = !available;
  byId("timeline").disabled = !available;
  byId("studioTransport").hidden = !available;
  byId("studioTimeline").max = Math.max(0, data.length - 1);
  byId("download").disabled = !available;
  byId("timeline").max = Math.max(0, data.length - 1);
  byId("veil").hidden = available;
  byId("veil").textContent =
    ex.status === "求解失败"
      ? "本次求解失败，当前没有有效的数值。"
      : ex.status === "计算中"
        ? "正在计算两组的运动与张力…"
        : "等待有效的实验结果";
  byId("loadBadge").textContent = Number.isFinite(ex.scene.loadKg)
    ? ex.scene.loadKg + " kg"
    : "—";
  updateMuscleChoices();
  drawPlot();
  renderFrame();
  drawDiagnostics();
}
function renderFrame() {
  const data = frames(),
    f = data[frameIndex];
  byId("timeline").value = frameIndex;
  byId("studioTimeline").value = frameIndex;
  byId("timeRead").textContent = f
    ? nice(f.t) + " / " + nice(data.at(-1).t) + " s"
    : "— / — s";
  byId("studioTime").textContent = byId("timeRead").textContent;
  byId("angleRead").textContent = nice(f?.angle, 1);
  byId("torqueRead").textContent = nice(f?.torque);
  byId("deltaRead").textContent =
    Number.isFinite(f?.torque) && Number.isFinite(f?.referenceTorque)
      ? nice(f.torque - f.referenceTorque, 3)
      : "—";
  const forceKey = metric === "force" ? "forces" : "activations";
  const refKey =
    metric === "force" ? "referenceForces" : "referenceActivations";
  const format = (value) =>
    metric === "force" ? nice(value, 1) + " N" : nice(value, 3);
  byId("refRead").textContent = f ? format(f[refKey]?.[selected]) : "—";
  byId("forceRead").textContent = f ? format(f[forceKey]?.[selected]) : "—";
  if (f && plot) {
    const x = plot.x(f.t);
    plot.guide.setAttribute("x1", x);
    plot.guide.setAttribute("x2", x);
    const value = f[forceKey]?.[selected];
    plot.dot.setAttribute("cx", x);
    plot.dot.setAttribute("cy", plot.y(value));
  }
  if (!f || byId("allMuscles").open) updateMuscleTable(f);
  const gear = gearOf(current().scene);
  referenceView?.update(
    f?.angle ?? 0,
    viewForces(f?.referenceForces),
    selected,
    {
      ...f,
      frameGear: gear,
      gear: { type: "none", massKg: 0 },
      activations: f?.referenceActivations,
    },
  );
  loadedView?.update(f?.angle ?? 0, viewForces(f?.forces), selected, {
    ...f,
    gear,
    pointRadius: legacyPoint(current().scene)
      ? current().scene.radiusM
      : undefined,
  });
  if (editor && f && followPlayback)
    editor.showPlayback(f, gear, {
      activations: f.activations,
      forces: f.forces,
      selection: selected,
      pointRadius: legacyPoint(current().scene)
        ? current().scene.radiusM
        : undefined,
    });
}
const tableRows = muscles.map((muscle, index) => {
  const row = create("tr"),
    head = create("th"),
    button = create("button", muscle);
  head.scope = "row";
  button.type = "button";
  button.onclick = () => pickMuscle(index);
  head.append(button);
  row.append(head);
  const cells = [create("td"), create("td"), create("td")];
  row.append(...cells);
  byId("muscleRows").append(row);
  return { row, button, cells };
});
function updateMuscleTable(f) {
  tableRows.forEach(({ row, button, cells }, index) => {
    row.classList.toggle("selected", index === selected);
    button.setAttribute("aria-pressed", String(index === selected));
    cells[0].textContent = nice(f?.referenceForces?.[index], 1);
    cells[1].textContent = nice(f?.forces?.[index], 1);
    cells[2].textContent = nice(f?.activations?.[index], 3);
  });
}
byId("allMuscles").ontoggle = () => {
  if (byId("allMuscles").open) updateMuscleTable(frames()[frameIndex]);
};
function drawPlot() {
  const chart = byId("chart");
  chart.replaceChildren();
  plot = null;
  const data = frames();
  byId("forceTab").setAttribute("aria-pressed", String(metric === "force"));
  byId("activationTab").setAttribute(
    "aria-pressed",
    String(metric === "activation"),
  );
  if (!data.length || current().result?.kinematicOnly || selected < 0) {
    chart.append(
      svgNode(
        "text",
        { x: 320, y: 84, "text-anchor": "middle" },
        !data.length ? "完成动作后显示曲线"
          : current().result?.kinematicOnly ? "此动作没有逐肌张力估计"
            : selectableMuscles.size ? "请选择张力有变化的肌肉"
              : "此动作没有张力变化超过 0.01 N 的肌肉",
      ),
    );
    return;
  }
  const forceKey = metric === "force" ? "forces" : "activations",
    refKey = metric === "force" ? "referenceForces" : "referenceActivations";
  let peak = 0;
  for (const f of data)
    peak = Math.max(peak, f[forceKey][selected], f[refKey][selected]);
  const maxY =
    metric === "activation"
      ? 1
      : Math.max(
          1,
          Math.ceil(
            peak / Math.pow(10, Math.floor(Math.log10(peak || 1)) - 1),
          ) * Math.pow(10, Math.floor(Math.log10(peak || 1)) - 1),
        );
  const left = 48,
    right = 625,
    top = 12,
    bottom = 140,
    start = data[0].t,
    end = data.at(-1).t;
  const x = (t) => left + ((right - left) * (t - start)) / (end - start || 1),
    y = (v) => bottom - ((bottom - top) * v) / maxY;
  for (const fraction of [0, 0.5, 1]) {
    const v = maxY * fraction,
      height = y(v);
    chart.append(
      svgNode("line", {
        x1: left,
        x2: right,
        y1: height,
        y2: height,
        stroke: "#d8e1da",
        "stroke-width": 1,
      }),
    );
    chart.append(
      svgNode(
        "text",
        { x: left - 6, y: height + 3, "text-anchor": "end" },
        String(Number(v.toFixed(2))),
      ),
    );
    const t = start + (end - start) * fraction;
    chart.append(
      svgNode(
        "text",
        {
          x: x(t),
          y: 160,
          "text-anchor":
            fraction === 0 ? "start" : fraction === 1 ? "end" : "middle",
        },
        Number(t.toFixed(2)) + " s",
      ),
    );
  }
  for (const [key, stroke, dash] of [
    [refKey, "#647875", "5 4"],
    [forceKey, "#a94e2e", "none"],
  ]) {
    const points = data
      .map((f) => x(f.t).toFixed(2) + "," + y(f[key][selected]).toFixed(2))
      .join(" ");
    chart.append(
      svgNode("polyline", {
        points,
        fill: "none",
        stroke,
        "stroke-dasharray": dash,
        "stroke-width": 2.4,
        "stroke-linejoin": "round",
      }),
    );
  }
  const guide = svgNode("line", {
    x1: left,
    x2: left,
    y1: top,
    y2: bottom,
    stroke: "#36534e",
    "stroke-dasharray": "2 3",
  });
  const dot = svgNode("circle", {
    cx: left,
    cy: bottom,
    r: 4,
    fill: "#a94e2e",
    stroke: "white",
    "stroke-width": 1.5,
  });
  chart.append(guide, dot);
  plot = { guide, dot, x, y, left, right, start, end };
}
function drawDiagnostics() {
  const box = byId("diagnostics");
  box.replaceChildren();
  const r = current().result;
  if (!r) {
    box.append(create("p", "当前没有可查看的求解结果。"));
    return;
  }
  const info = r.model || savedModel || {},
    d = r.diagnostics || {};
  if (r.kinematicOnly) {
    box.append(
      create("p", r.diagnostics?.scopeNote || "此回放没有逐肌张力估计。"),
    );
    return;
  }
  const notes = [
    "模型：" +
      (typeof info === "string"
        ? info
        : info.name || info.id || "OpenSim Arm26") +
      "。张力是本模型在所设条件下的估计。",
    "计算：" +
      (d.solver || "见实验包中的完整求解记录") +
      "。空手参照沿用当前轨迹和伸肌最低激活要求。",
  ];
  if (Number.isFinite(d.maxResidualNm))
    notes.push(
      "最大力矩平衡残差：" + d.maxResidualNm.toPrecision(3) + " N·m。",
    );
  if (Number.isFinite(d.forwardMaxErrorDeg))
    notes.push(
      "前向回放最大角度误差：" + d.forwardMaxErrorDeg.toPrecision(3) + "°。",
    );
  for (const assumptions of [info?.assumptions, r.assumptions])
    if (Array.isArray(assumptions))
      notes.push(...assumptions.filter((n) => typeof n === "string"));
  notes.push(
    "肌腹长度依据模型纤维长度驱动，外形和握持为显示近似。颜色表示整条肌肉单元的总张力，不能据此读取局部组织应力。",
  );
  if (d.scopeNote) notes.push(d.scopeNote);
  for (const note of new Set(notes)) box.append(create("p", note));
}
function verifyResult(result) {
  if (
    !result ||
    !Array.isArray(result.frames) ||
    result.frames.length < 2 ||
    !Array.isArray(result.scene?.keyframes)
  )
    throw Error("求解结果缺少时间序列或输入条件。");
  let last = -Infinity;
  for (const f of result.frames) {
    if (
      ![f.t, f.angle].every(Number.isFinite) ||
      !POSE_KEYS.every((k) => f[k] === undefined || Number.isFinite(f[k])) ||
      f.t <= last ||
      (!result.kinematicOnly &&
        (![f.torque, f.referenceTorque].every(Number.isFinite) ||
          ![
            "forces",
            "referenceForces",
            "activations",
            "referenceActivations",
          ].every((k) => viewForces(f[k]))))
    )
      throw Error("求解结果包含不完整的肌肉数据或无效时间。");
    last = f.t;
  }
  return result;
}
function acceptResult(result, note) {
  verifyResult(result);
  Object.assign(current(), {
    result,
    scene: copy(result.scene),
    stamp: modelStamp(result.model),
    status: result.kinematicOnly ? "动作回放 · 无逐肌解" : "可回放 · 肌肉张力",
    note: result.kinematicOnly ? result.diagnostics?.scopeNote || note : note,
  });
  frameIndex = findFrame(
    result.frames,
    Math.min(
      result.frames.at(-1).t,
      (result.frames[0].t + result.frames.at(-1).t) / 2,
    ),
  );
  syncForm();
  refresh();
}
function inputError(scene) {
  if (
    !scene.keyframes.every(
      (f) => Number.isFinite(f.t) && Number.isFinite(f.angle),
    )
  )
    return "请填写所有关键帧的时间和角度。";
  if (scene.keyframes.length < 2 || scene.keyframes.length > 10)
    return "每次实验需要 2–10 个关键帧。";
  if (scene.keyframes.some((f) => f.angle < 0 || f.angle > 130))
    return "屈肘角应介于 0° 和 130°。";
  if (
    scene.keyframes[0].t !== 0 ||
    scene.keyframes.some((f, i, a) => i > 0 && f.t <= a[i - 1].t)
  )
    return "起始时间须为 0 秒，后续关键帧时间须严格递增。";
  if (
    scene.keyframes.at(-1).t > 10 ||
    scene.keyframes.some((f, i, a) => i > 0 && f.t - a[i - 1].t < 0.2 - 1e-8)
  )
    return "动作最长 10 秒；相邻姿势之间至少留出 0.2 秒。";
  const limits = {
    shoulderDeg: [-70, 150],
    wristDeg: [-65, 70],
    rootX: [-0.22, 0.22],
    rootY: [-0.22, 0.22],
  };
  if (
    scene.keyframes.some((f) =>
      Object.entries(limits).some(
        ([k, [lo, hi]]) =>
          f[k] !== undefined &&
          (!Number.isFinite(f[k]) || f[k] < lo || f[k] > hi),
      ),
    )
  )
    return "姿势超出了编辑器可用范围。";
  if (!Number.isFinite(scene.loadKg) || scene.loadKg < 0 || scene.loadKg > 20)
    return "持物质量应介于 0 和 20 kg。";
  if (
    !Number.isFinite(scene.radiusM) ||
    scene.radiusM < 0.05 ||
    scene.radiusM > 0.45
  )
    return "负重距离应介于 0.05 m 和 0.45 m。";
  if (
    !Number.isFinite(scene.extensorMin) ||
    scene.extensorMin < 0 ||
    scene.extensorMin > 0.8
  )
    return "这个模型允许设置的伸肌最低激活度为 0–0.8。";
  return "";
}
// These are only positions between confirmed poses. Never attach old forces or imply
// an optimized motion when a server solution is unavailable.
function positionPreview(scene, reason) {
  const frames = [];
  for (let j = 1; j < scene.keyframes.length; j++) {
    const a = scene.keyframes[j - 1],
      b = scene.keyframes[j],
      span = b.t - a.t;
    const count = Math.max(1, Math.ceil(span * 50));
    for (let i = j === 1 ? 0 : 1; i <= count; i++) {
      const u = i / count,
        w = u * u * u * (10 + u * (-15 + 6 * u));
      const f = { t: a.t + u * span };
      for (const k of POSE_KEYS)
        f[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * w;
      frames.push(f);
    }
  }
  return {
    scene,
    frames,
    kinematicOnly: true,
    diagnostics: {
      scopeNote:
        reason + " 当前仅播放关键帧之间的平滑插值，没有逐肌张力或净力矩。",
    },
  };
}
async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  let body;
  try {
    body = await res.json();
  } catch {
    throw Error("未连接本地求解服务。请从实验服务页面打开，或回放预计算样例。");
  }
  if (!res.ok) {
    const msg = body.error;
    throw Error(
      typeof msg === "string"
        ? msg
        : msg?.message || "求解失败（HTTP " + res.status + "）。",
    );
  }
  return body;
}
async function solve({ autoplay = false } = {}) {
  cancelWork();
  const ticket = generation;
  const intent = editIntent;
  const ex = current(),
    input = copy(ex.scene);
  if (exceedsSingleJoint(input.keyframes)) input.mode = "prescribed";
  ex.result = null;
  followPlayback = false;
  frameIndex = 0;
  const wrong = inputError(input);
  if (wrong) {
    Object.assign(ex, { status: "求解失败", note: wrong });
    refresh();
    return;
  }
  if (offline && frozenResult && canUseFrozen(ex, frozenResult)) {
    acceptResult(
      frozenResult,
      "本次输入和模型版本与冻结样例一致，已恢复静态回放。",
    );
    if (autoplay && intent === editIntent) playFromStart();
    saveCards();
    return;
  }
  if (offline) {
    acceptResult(positionPreview(input, "当前为离线预览。"));
    if (autoplay && intent === editIntent) playFromStart();
    saveCards();
    return;
  }
  Object.assign(ex, {
    status: "计算中",
    note:
      input.mode === "predict"
        ? "正在优化中间轨迹，请稍候。"
        : "正在计算相同轨迹的空手与持物曲线。",
  });
  refresh();
  aborter = new AbortController();
  try {
    const result = await fetchJson("/api/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: aborter.signal,
    });
    if (ticket === generation) {
      acceptResult(
        result,
        result.diagnostics?.scopeNote || "可拖动时间轴，或选取一块肌肉观察。",
      );
      if (autoplay && intent === editIntent) playFromStart();
      saveCards();
      offline = false;
    }
  } catch (e) {
    if (ticket === generation) {
      acceptResult(
        positionPreview(
          input,
          "未取得有效的力学解：" + (e.message || "求解失败。"),
        ),
      );
      if (autoplay && intent === editIntent) playFromStart();
      saveCards();
    }
  } finally {
    if (ticket === generation) aborter = null;
  }
}
async function bootstrap() {
  const restored = restoreCards();
  syncForm();
  refresh();
  startStudio();
  startViews();
  const ticket = generation;
  try {
    savedModel = await fetchJson("/api/model");
    if (!modelStamp(savedModel)) throw Error("模型版本缺失");
  } catch {
    offline = true;
  }
  if (ticket !== generation) return;
  if (offline) {
    try {
      frozenResult = verifyResult(await fetchJson("./demo.json"));
    } catch {
      /* Custom poses still have local motion preview. */
    }
  }
  if (ticket !== generation) return;
  if (new URLSearchParams(location.search).get("demo") === "1")
    await openExample();
  else if (restored?.solve && !inputError(current().scene)) await solve();
  else if (offline && !restored && frozenResult) await openExample();
}
async function openExample() {
  if (experiments.length >= STORED_LIMIT) return;
  cancelWork();
  const ticket = generation;
  try {
    const demo = frozenResult || verifyResult(await fetchJson("./demo.json"));
    if (ticket !== generation) return;
    if (
      !offline &&
      savedModel &&
      modelStamp(demo.model) !== modelStamp(savedModel)
    )
      throw Error("示范与当前模型版本不符。");
    frozenResult = demo;
    const clean = cleanScene(demo.scene);
    const previous = experiments.findIndex(
      (c) => JSON.stringify(cleanScene(c.scene)) === JSON.stringify(clean),
    );
    if (previous < 0) experiments.push(blankCard(clean));
    switchSlot(previous < 0 ? experiments.length - 1 : previous);
    acceptResult(
      demo,
      "示范：5 kg 屈肘，在 1.50 秒处水平保持。你可以拖时间轴观察肌腹。",
    );
    followPlayback = true;
    renderFrame();
    saveCards();
  } catch (e) {
    if (ticket === generation)
      byId("message").textContent = "示范未能载入：" + e.message;
  }
}
byId("example").onclick = openExample;
byId("play").onclick = play;
byId("timeline").oninput = (e) => {
  pause();
  followPlayback = true;
  frameIndex = Number(e.target.value);
  renderFrame();
};
byId("chart").onclick = (e) => {
  const data = frames(),
    svg = byId("chart");
  if (!plot || !data.length) return;
  const matrix = svg.getScreenCTM();
  if (!matrix) return;
  const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(
    matrix.inverse(),
  );
  const fraction = Math.min(
    1,
    Math.max(0, (point.x - plot.left) / (plot.right - plot.left)),
  );
  pause();
  followPlayback = true;
  frameIndex = findFrame(data, plot.start + fraction * (plot.end - plot.start));
  renderFrame();
};
byId("muscle").onchange = (e) => pickMuscle(Number(e.target.value));
for (const [id, key] of [
  ["forceTab", "force"],
  ["activationTab", "activation"],
])
  byId(id).onclick = () => {
    metric = key;
    drawPlot();
    renderFrame();
  };
byId("slot").onchange = (e) => switchSlot(Number(e.target.value));
byId("copy").onclick = () => {
  if (experiments.length >= STORED_LIMIT) {
    byId("fileStatus").textContent =
      "当前浏览器实验已达上限。请先导出重要实验。";
    return;
  }
  const old = current();
  experiments.push({
    scene: copy(old.scene),
    result: old.result,
    stamp: old.stamp || modelStamp(old.result?.model),
    status: old.result ? "可回放" : "待计算",
    note: "已复制实验。修改负重或伸肌激活要求，即可与原实验分别回放。",
  });
  switchSlot(experiments.length - 1);
};
byId("mode").onchange = (e) => {
  current().scene.mode = e.target.value;
  byId("objectiveRow").hidden = e.target.value !== "predict";
  markDirty();
};
byId("objective").onchange = (e) => {
  current().scene.objective = e.target.value;
  markDirty();
};
byId("extensor").oninput = (e) => {
  current().scene.extensorMin = fieldValue(e.target);
  markDirty();
};
byId("solve").onclick = () => solve({ autoplay: true });
byId("studioPlay").onclick = play;
byId("studioTimeline").oninput = byId("timeline").oninput;
byId("download").onclick = () => {
  const r = current().result;
  if (!r) return;
  const a = create("a"),
    url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              schema: "bodyvista.elbow-lab.export.v1",
              model: r.model || savedModel,
              scene: r.scene,
              result: r,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
  a.href = url;
  a.download =
    "BodyVista-屈肘实验-" + String(slot + 1).padStart(2, "0") + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

byId("openPackage").onclick = () => byId("packageFile").click();
byId("packageFile").onchange = async (event) => {
  const input = event.target,
    file = input.files[0];
  if (!file) return;
  input.value = "";
  const note = byId("fileStatus");
  const importGeneration = generation;
  // Only take the small input record; uploaded histories, values and links are never executed or displayed.
  try {
    if (file.size > 12 * 1024 * 1024) throw Error("实验包超过 12 MB。");
    if (experiments.length >= STORED_LIMIT)
      throw Error("当前浏览器实验已达上限。");
    const pkg = JSON.parse(await file.text());
    if (importGeneration !== generation) {
      note.textContent = "读取文件期间实验已更改，保留当前编辑内容。";
      return;
    }
    if (pkg?.schema !== "bodyvista.elbow-lab.export.v1")
      throw Error("请选择本实验台导出的 JSON 实验包。");
    const scene = cleanScene(pkg.scene);
    const problem = inputError(scene);
    if (problem) throw Error(problem);
    experiments.push(blankCard(scene));
    switchSlot(experiments.length - 1);
    note.textContent =
      "已另存为新实验，仅使用包内的输入。正按当前模型重新计算。";
    const imported = current();
    await solve();
    if (current() === imported)
      note.textContent = imported.result
        ? imported.result.kinematicOnly
          ? "已打开动作。可用结果见上方回放说明。"
          : "已按当前模型恢复导入实验的运动与张力。"
        : "已导入实验条件；请检查求解信息。";
  } catch (err) {
    note.textContent =
      "无法打开实验包。" +
      (err instanceof SyntaxError ? "文件不是有效的 JSON。" : err.message);
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
bootstrap();
