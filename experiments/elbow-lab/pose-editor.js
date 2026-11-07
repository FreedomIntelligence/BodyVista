import { createArmView } from "./arm-view.js";

const rad = Math.PI / 180;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round = (n, precision = 5) => Number(n.toFixed(precision));
const number = (v, otherwise = 0) => (Number.isFinite(v) ? v : otherwise);
const basePose = { angle: 18, shoulderDeg: 0, rootX: 0, rootY: 0, wristDeg: 0 };
const normalize = (p) =>
  Object.fromEntries(Object.keys(basePose).map((k) => [k, number(p?.[k])]));
const neutralGear = () => ({ type: "none", massKg: 0 });
const equipment = (g) =>
  ["dumbbell", "barbell"].includes(g?.type) && g.massKg > 0 && g.massKg <= 20
    ? { type: g.type, massKg: g.massKg }
    : neutralGear();
const keyNames = ["shoulder", "elbow", "wrist", "hand"];
const joints = {
  shoulder: ["肩", "拖肩：移动整条手臂"],
  elbow: ["肘", "拖肘：绕肩转动上臂"],
  wrist: ["腕", "拖腕：上臂、前臂一起追随"],
  hand: ["掌", "拖掌：绕手腕转动；也是握持点"],
};
const gearName = { none: "空手", dumbbell: "哑铃", barbell: "杠铃" };
const icons = {
  dumbbell: '<path d="M13 16h24M7 11v10m5-14v18m26-18v18m5-14v10"/>',
  barbell: '<path d="M2 16h46M8 7v18m5-22v26m24-26v26m5-22v18"/>',
};
const icon = (type) =>
  '<svg viewBox="0 0 50 32" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" aria-hidden="true">' +
  icons[type] +
  "</svg>";
const length = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angleTo = (a, b) => Math.atan2(b.x - a.x, b.y - a.y) / rad;
const nearer = (v, ref) => ref + ((v - ref + 540) % 360) - 180;
const end = (p, l, degrees) => ({
  x: p.x + l * Math.sin(degrees * rad),
  y: p.y + l * Math.cos(degrees * rad),
});
const samePose = (a, b) =>
  a && b && Object.keys(basePose).every((k) => Math.abs(a[k] - b[k]) < 0.00001);
const shortTime = (t) => Number(t.toFixed(3)).toString();
function markPose(start, kind, goal, points) {
  const pose = { ...start },
    s = points.shoulder,
    e = points.elbow,
    w = points.wrist;
  if (kind === "shoulder") {
    pose.rootX = clamp(start.rootX + goal.x - s.x, -0.22, 0.22);
    pose.rootY = clamp(start.rootY + goal.y - s.y, -0.22, 0.22);
  } else if (kind === "elbow") {
    if (length(goal, s) > 0.01)
      pose.shoulderDeg = clamp(
        nearer(angleTo(s, goal), start.shoulderDeg),
        -70,
        150,
      );
  } else if (kind === "hand") {
    if (length(goal, w) > 0.008)
      pose.wristDeg = clamp(
        nearer(
          angleTo(w, goal) - pose.shoulderDeg - pose.angle,
          start.wristDeg,
        ),
        -65,
        70,
      );
  } else if (kind === "wrist") {
    const u = length(s, e),
      v = length(e, w);
    if (!(u > 0.01 && v > 0.01)) return pose;
    const d = clamp(length(goal, s), Math.abs(u - v) + 1e-6, u + v);
    const bend = clamp(
      Math.acos(clamp((d * d - u * u - v * v) / (2 * u * v), -1, 1)) / rad,
      0,
      130,
    );
    const offset =
      Math.atan2(v * Math.sin(bend * rad), u + v * Math.cos(bend * rad)) / rad;
    const direction = d < 0.01 ? pose.shoulderDeg + offset : angleTo(s, goal);
    const targetShoulder = nearer(direction - offset, start.shoulderDeg);
    pose.shoulderDeg = clamp(targetShoulder, -70, 150);
    pose.angle = bend;
    if (Math.abs(targetShoulder - pose.shoulderDeg) > 1e-7) {
      const pivot = end(s, u, pose.shoulderDeg);
      pose.angle = clamp(
        nearer(angleTo(pivot, goal) - pose.shoulderDeg, start.angle),
        0,
        130,
      );
    }
  }
  return Object.fromEntries(
    Object.entries(pose).map(([k, v]) => [k, round(v)]),
  );
}

export function createPoseEditor(
  container,
  { onChange, onDraft, onPreview } = {},
) {
  container.classList.add("pose-editor");
  container.innerHTML = `
    <div class="pe-heading"><div><div class="kicker">01　动作编排</div><h2>在手臂上摆姿势</h2></div><span class="pe-projection">右臂 · 侧面</span></div>
    <div class="pe-workspace">
      <div class="pe-stage" data-pe="stage">
        <div class="pe-atlas" data-pe="atlas"></div>
        <svg class="pe-fallback" data-pe="fallback" aria-hidden="true" hidden><path fill="none" stroke="#a6b8ae" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <div class="pe-handles" data-pe="handles"></div>
        <div class="pe-stage-label" data-pe="stageLabel">姿势草稿</div>
        <div class="pe-stage-angles" data-pe="angles"></div>
        <div class="pe-lengths" data-pe="lengths" hidden aria-label="模型纤维长度"></div>
      </div>
      <div class="pe-tools">
        <div class="pe-tool-title"><span class="pe-index">01</span><h3>拖动关节</h3></div>
        <p class="pe-guide"><b>肩</b> 移动整臂　<b>肘</b> 转上臂<br><b>腕</b> 带动两段骨骼　<b>掌</b> 转手腕</p>
        <div class="pe-tool-title"><span class="pe-index">02</span><h3>选择器械</h3></div>
        <p class="pe-guide">把器械拖到掌心，松手后自动握住。</p>
        <div class="pe-rack">
          <button type="button" class="pe-gear" data-gear="dumbbell" aria-pressed="false">${icon("dumbbell")}<span>哑铃</span></button>
          <button type="button" class="pe-gear" data-gear="barbell" aria-pressed="false">${icon("barbell")}<span>杠铃</span></button>
        </div>
        <label class="pe-mass" data-pe="massLabel">器械总重（kg）<input type="number" data-pe="mass" value="5" min=".1" max="20" step="any" inputmode="decimal"></label>
        <div class="pe-grip" data-pe="grip"></div>
        <button type="button" class="pe-link" data-pe="release">卸下器械</button>
        <p class="pe-guide pe-gear-hint" data-pe="gearHint">也可先点选器械，再点击图中的「掌」。</p>
      </div>
    </div>
    <div class="pe-timeline">
      <div class="pe-seq-head"><div><span class="pe-index">03</span><h3>记录关键帧</h3></div><button type="button" class="pe-link" data-pe="new">从头编排</button></div>
      <div class="pe-frames" data-pe="frames" aria-label="动作关键帧"></div>
      <div class="pe-actions"><button type="button" class="pe-record" data-pe="record">确认第 1 帧</button><button type="button" class="quiet" data-pe="preview">预览动作</button>
        <button type="button" class="pe-link" data-pe="replace" hidden>替换选中帧</button>
        <button type="button" class="pe-link" data-pe="manage" hidden aria-expanded="false">调整选中帧</button></div>
      <div class="pe-manage" data-pe="managePanel" hidden>
        <button type="button" class="quiet" data-pe="earlier">前移</button><button type="button" class="quiet" data-pe="later">后移</button>
        <button type="button" class="quiet" data-pe="retime">修改前段时长</button><button type="button" class="quiet" data-pe="remove">删除此帧</button>
      </div>
      <form data-pe="durationForm" class="pe-duration" hidden>
        <label><span data-pe="durationLabel"></span><input data-pe="duration" aria-label="两个关键帧之间的秒数" type="number" min=".2" max="10" step="any" inputmode="decimal" value="1" required> 秒</label>
        <button type="submit" class="pe-record">确定时长</button><button type="button" class="pe-link" data-pe="cancelDuration">取消</button>
      </form>
      <div class="pe-status" data-pe="note" role="status" aria-live="polite"></div>
    </div>`;
  const ui = Object.fromEntries(
    [...container.querySelectorAll("[data-pe]")].map((el) => [
      el.dataset.pe,
      el,
    ]),
  );
  const buttons = {};
  let pose = { ...basePose },
    gear = neutralGear(),
    rackType = null,
    frames = [],
    index = -1;
  let drag = null,
    item = null,
    durationTask = null,
    previewId = 0,
    dead = false,
    extra = null;
  const ctrl = new AbortController(),
    opt = { signal: ctrl.signal };
  const view = createArmView(ui.atlas, null, { editor: true });
  let observer, fallbackProjection;
  const note = (text) => {
    ui.note.textContent = text;
  };
  function scene() {
    return { keyframes: frames.map((f) => ({ ...f })), equipment: { ...gear } };
  }
  function notify() {
    onChange?.(scene());
  }
  function fallbackGeom(pose) {
    const rect = ui.stage.getBoundingClientRect();
    const s = { x: pose.rootX, y: pose.rootY },
      e = end(s, 0.2904, pose.shoulderDeg),
      w = end(e, 0.24, pose.shoulderDeg + pose.angle);
    const h = end(w, 0.06, pose.shoulderDeg + pose.angle + pose.wristDeg);
    if (!drag || !fallbackProjection) {
      const points = [s, e, w, h];
      const left = Math.min(-0.5, ...points.map((p) => p.x - 0.09));
      const right = Math.max(0.75, ...points.map((p) => p.x + 0.09));
      const top = Math.min(-0.28, ...points.map((p) => p.y - 0.09));
      const bottom = Math.max(0.8, ...points.map((p) => p.y + 0.09));
      const scale = Math.min(
        rect.width / (right - left),
        rect.height / (bottom - top),
      );
      fallbackProjection = {
        scale,
        origin: {
          x: rect.width / 2 - ((left + right) * scale) / 2,
          y: rect.height / 2 - ((top + bottom) * scale) / 2,
        },
      };
    }
    const { scale, origin } = fallbackProjection;
    return {
      scale,
      origin,
      screen: Object.fromEntries(
        Object.entries({ shoulder: s, elbow: e, wrist: w, hand: h }).map(
          ([k, p]) => [
            k,
            { x: origin.x + p.x * scale, y: origin.y + p.y * scale },
          ],
        ),
      ),
    };
  }
  function positions() {
    const pts = view.projectJoints?.();
    if (
      pts &&
      keyNames.every(
        (k) => Number.isFinite(pts[k]?.x) && Number.isFinite(pts[k]?.y),
      )
    )
      return pts;
    if (ui.atlas.dataset.atlasStatus === "error")
      return fallbackGeom(pose).screen;
    return null;
  }
  function plane(cx, cy) {
    if (ui.atlas.dataset.atlasStatus === "error") {
      const { origin, scale } = fallbackGeom(pose),
        r = ui.atlas.getBoundingClientRect();
      return {
        x: (cx - r.left - origin.x) / scale,
        y: (cy - r.top - origin.y) / scale,
      };
    }
    const p = view.planePoint?.(cx, cy);
    return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? p : null;
  }
  function syncHandles() {
    if (dead) return;
    const pts = positions(),
      fallback = ui.atlas.dataset.atlasStatus === "error";
    ui.handles.hidden = !pts;
    ui.fallback.hidden = !fallback;
    ui.atlas.classList.toggle("pe-unavailable", fallback);
    if (!pts) return;
    if (fallback)
      ui.fallback.firstElementChild.setAttribute(
        "d",
        keyNames
          .map((k, i) => (i ? "L" : "M") + pts[k].x + "," + pts[k].y)
          .join(""),
      );
    for (const k of keyNames) {
      const p = pts[k],
        b = buttons[k];
      b.style.left = p.x + "px";
      b.style.top = p.y + "px";
      b.classList.toggle(
        "pe-flip",
        k === "hand" ? p.x > ui.stage.clientWidth - 70 : p.x < 66,
      );
    }
    if (fallback) ui.stageLabel.textContent = "关节示意 · 三维图谱不可用";
  }
  function paint() {
    view.update(pose.angle, extra?.forces ?? null, extra?.selection ?? -1, {
      ...pose,
      gear,
      pointRadius: extra?.pointRadius,
      freezeCamera: Boolean(drag),
      gripKg: gear.massKg,
      activations: extra?.activations ?? null,
    });
    ui.angles.textContent =
      "肩 " +
      Math.round(pose.shoulderDeg) +
      "°　肘 " +
      Math.round(pose.angle) +
      "°　腕 " +
      Math.round(pose.wristDeg) +
      "°";
    const lengths = view.lengths?.();
    ui.lengths.hidden = !lengths;
    if (lengths)
      ui.lengths.textContent =
        "模型纤维长度\n肱二头肌长头　" +
        lengths[0].toFixed(0) +
        " mm\n肱三头肌长头　" +
        lengths[1].toFixed(0) +
        " mm";
    ui.stageLabel.textContent = extra
      ? "动作回放"
      : previewId
        ? "姿势预览"
        : index >= 0 && samePose(pose, frames[index])
          ? "第 " + (index + 1) + " 帧"
          : "姿势草稿";
    syncHandles();
  }
  function toolbar() {
    const chosen = frames[index],
      active = Boolean(chosen);
    ui.record.textContent = frames.length
      ? "确认第 " + (frames.length + 1) + " 帧"
      : "确认第 1 帧";
    ui.record.disabled = Boolean(durationTask) || frames.length >= 10;
    ui.replace.hidden = !active || samePose(pose, chosen);
    if (active) ui.replace.textContent = "替换第 " + (index + 1) + " 帧";
    ui.manage.hidden = !active;
    ui.earlier.disabled = index <= 0;
    ui.later.disabled = index < 0 || index >= frames.length - 1;
    ui.retime.disabled = index <= 0;
    ui.new.disabled = !frames.length;
    ui.preview.disabled = frames.length < 2;
    ui.preview.textContent = previewId ? "停止预览" : "预览动作";
    if (!active) {
      ui.managePanel.hidden = true;
      ui.manage.setAttribute("aria-expanded", "false");
    }
    ui.frames
      .querySelectorAll("button")
      .forEach((el, i) => el.setAttribute("aria-pressed", String(i === index)));
  }
  function frameList() {
    ui.frames.replaceChildren();
    if (!frames.length) {
      const hint = document.createElement("span");
      hint.className = "pe-empty";
      hint.textContent = "还没有关键帧。摆好起始姿势后，确认第 1 帧。";
      ui.frames.append(hint);
    }
    frames.forEach((frame, i) => {
      if (i) {
        const arrow = document.createElement("span");
        arrow.className = "pe-interval";
        arrow.textContent =
          "+" + shortTime(round(frame.t - frames[i - 1].t)) + " s";
        ui.frames.append(arrow);
      }
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.frame = String(i);
      b.setAttribute("aria-label", "第 " + (i + 1) + " 帧，" + frame.t + " 秒");
      const strong = document.createElement("strong"),
        small = document.createElement("small");
      strong.textContent = "第 " + (i + 1) + " 帧";
      small.textContent = shortTime(frame.t) + " s";
      b.append(strong, small);
      ui.frames.append(b);
    });
    toolbar();
  }
  function rack() {
    for (const b of container.querySelectorAll("[data-gear]"))
      b.setAttribute("aria-pressed", String(b.dataset.gear === rackType));
    ui.grip.textContent =
      gear.type === "none"
        ? "手中：空手"
        : "已握住：" + gearName[gear.type] + " · " + gear.massKg + " kg";
    ui.release.disabled = gear.type === "none";
    ui.gearHint.textContent =
      rackType === "barbell" || gear.type === "barbell"
        ? "本实验只模拟右手握住杆中央，整杆重量由右手承担。"
        : "也可先点选器械，再点击图中的「掌」。";
  }
  function stopPreview() {
    if (!previewId) return;
    cancelAnimationFrame(previewId);
    previewId = 0;
    extra = null;
    toolbar();
  }
  function closeDuration() {
    durationTask = null;
    ui.durationForm.hidden = true;
    toolbar();
  }
  function choose(i) {
    stopPreview();
    closeDuration();
    index = i;
    pose = normalize(frames[i]);
    extra = null;
    paint();
    toolbar();
    onPreview?.({ ...pose }, i);
    note("已选第 " + (i + 1) + " 帧。可修改并替换，也可摆好下一帧后追加。");
  }
  for (const k of keyNames) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pe-handle pe-" + k;
    b.dataset.joint = k;
    b.setAttribute("aria-label", joints[k][1] + "；可用方向键微调");
    b.title = joints[k][1] + "；可用方向键微调";
    const label = document.createElement("span");
    label.className = "pe-joint-name";
    label.textContent = joints[k][0];
    b.append(label);
    ui.handles.append(b);
    buttons[k] = b;
    b.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0 || drag || item) return;
        const pts = positions(),
          cursor = plane(e.clientX, e.clientY),
          rect = ui.atlas.getBoundingClientRect();
        if (!pts || !cursor) return;
        stopPreview();
        const world = Object.fromEntries(
          keyNames.map((k) => [
            k,
            plane(pts[k].x + rect.left, pts[k].y + rect.top),
          ]),
        );
        if (keyNames.some((k) => !world[k])) return;
        drag = {
          id: e.pointerId,
          k,
          x: e.clientX,
          y: e.clientY,
          start: { ...pose },
          cursor,
          world,
          moved: false,
        };
        b.setPointerCapture(e.pointerId);
        b.classList.add("pe-moving");
        e.preventDefault();
      },
      opt,
    );
    b.addEventListener(
      "pointermove",
      (e) => {
        if (!drag || drag.id !== e.pointerId || drag.k !== k) return;
        if (
          !drag.moved &&
          Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3
        )
          return;
        const cursor = plane(e.clientX, e.clientY);
        if (!cursor) return;
        if (!drag.moved) closeDuration();
        drag.moved = true;
        const p = drag.world[k];
        pose = markPose(
          drag.start,
          k,
          {
            x: p.x + cursor.x - drag.cursor.x,
            y: p.y + cursor.y - drag.cursor.y,
          },
          drag.world,
        );
        extra = null;
        paint();
        toolbar();
        onDraft?.({ ...pose });
      },
      opt,
    );
    const endDrag = (e, cancel) => {
      if (!drag || e.pointerId !== drag.id || drag.k !== k) return;
      const moved = drag.moved;
      drag = null;
      b.classList.remove("pe-moving");
      if (moved) paint();
      if (!cancel && !moved && k === "hand" && rackType) attach(rackType);
      else if (!cancel && moved) note("姿势已摆好。确认后才会写入关键帧。");
    };
    b.addEventListener("pointerup", (e) => endDrag(e, false), opt);
    b.addEventListener("pointercancel", (e) => endDrag(e, true), opt);
    b.addEventListener("lostpointercapture", (e) => endDrag(e, true), opt);
    b.addEventListener(
      "click",
      (e) => {
        if (e.detail === 0 && k === "hand" && rackType) attach(rackType);
      },
      opt,
    );
    b.addEventListener(
      "keydown",
      (e) => {
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
        )
          return;
        e.preventDefault();
        const magnitude = e.shiftKey ? 5 : 1,
          sign = ["ArrowRight", "ArrowUp"].includes(e.key) ? 1 : -1;
        stopPreview();
        closeDuration();
        extra = null;
        if (k === "shoulder") {
          const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight",
            axis = horizontal ? "rootX" : "rootY";
          pose = {
            ...pose,
            [axis]: round(
              clamp(
                pose[axis] + sign * magnitude * 0.005 * (horizontal ? 1 : -1),
                -0.22,
                0.22,
              ),
            ),
          };
        } else {
          const [key, lo, hi] =
            k === "elbow"
              ? ["shoulderDeg", -70, 150]
              : k === "wrist"
                ? ["angle", 0, 130]
                : ["wristDeg", -65, 70];
          pose = {
            ...pose,
            [key]: round(clamp(pose[key] + sign * magnitude, lo, hi)),
          };
        }
        paint();
        toolbar();
        onDraft?.({ ...pose });
        note("已微调姿势。确认后才会写入关键帧。");
      },
      opt,
    );
  }
  function mass() {
    const v = ui.mass.valueAsNumber;
    if (!Number.isFinite(v) || v < 0.1 || v > 20) {
      note("请输入 0.1–20 kg 的器械总重。");
      ui.mass.focus();
      return null;
    }
    return round(v, 3);
  }
  function attach(type) {
    const val = mass();
    if (val === null) return;
    gear = { type, massKg: val };
    rackType = null;
    rack();
    paint();
    notify();
    note(
      "掌心已握住" +
        gearName[type] +
        "（" +
        val +
        " kg），所有关键帧共用此器械。",
    );
  }
  function nearHand(x, y) {
    const pts = positions();
    if (!pts) return false;
    const r = ui.atlas.getBoundingClientRect(),
      p = pts.hand,
      hit = buttons.hand.getBoundingClientRect();
    return (
      x >= r.left &&
      x <= r.right &&
      y >= r.top &&
      y <= r.bottom &&
      (Math.hypot(x - r.left - p.x, y - r.top - p.y) < 37 ||
        (x >= hit.left && x <= hit.right && y >= hit.top && y <= hit.bottom))
    );
  }
  for (const b of container.querySelectorAll("[data-gear]")) {
    const type = b.dataset.gear;
    let suppressClick = false;
    b.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 0 || item || drag) return;
        suppressClick = false;
        stopPreview();
        item = {
          id: e.pointerId,
          type,
          x: e.clientX,
          y: e.clientY,
          ghost: null,
        };
        b.setPointerCapture(e.pointerId);
      },
      opt,
    );
    b.addEventListener(
      "pointermove",
      (e) => {
        if (!item || e.pointerId !== item.id || item.type !== type) return;
        if (
          !item.ghost &&
          Math.hypot(e.clientX - item.x, e.clientY - item.y) < 5
        )
          return;
        if (!item.ghost) {
          const ghost = document.createElement("div");
          ghost.className = "pe-ghost";
          ghost.innerHTML = icon(type);
          document.body.append(ghost);
          item.ghost = ghost;
        }
        item.ghost.style.left = e.clientX + "px";
        item.ghost.style.top = e.clientY + "px";
        ui.stage.classList.toggle("pe-snap", nearHand(e.clientX, e.clientY));
      },
      opt,
    );
    function drop(e, cancel) {
      if (!item || e.pointerId !== item.id || type !== item.type) return;
      const moved = Boolean(item.ghost);
      item.ghost?.remove();
      item = null;
      ui.stage.classList.remove("pe-snap");
      if (moved) {
        suppressClick = true;
        if (!cancel && nearHand(e.clientX, e.clientY)) attach(type);
        else if (!cancel)
          note(
            "器械没有放到手边，当前握持状态未改变。请拖到「掌」的圆点再松手。",
          );
      }
    }
    b.addEventListener("pointerup", (e) => drop(e, false), opt);
    b.addEventListener("pointercancel", (e) => drop(e, true), opt);
    b.addEventListener("lostpointercapture", (e) => drop(e, true), opt);
    b.addEventListener(
      "click",
      (e) => {
        if (suppressClick && e.detail !== 0) {
          suppressClick = false;
          return;
        }
        const selected = rackType === type;
        rackType = selected ? null : type;
        rack();
        note(
          selected
            ? "已取消选择器械。"
            : "已选" + gearName[type] + "，请点击图中的「掌」握住。",
        );
      },
      opt,
    );
  }
  ui.release.onclick = () => {
    gear = neutralGear();
    rackType = null;
    rack();
    paint();
    notify();
    note("器械已卸下，动作改为空手。");
  };
  ui.mass.addEventListener(
    "change",
    () => {
      const val = mass();
      if (val === null) return;
      if (gear.type !== "none" && (!rackType || rackType === gear.type)) {
        gear = { ...gear, massKg: val };
        rack();
        paint();
        notify();
        note("右手负载已更新为 " + val + " kg。");
      }
    },
    opt,
  );
  function duration(kind) {
    stopPreview();
    durationTask = kind;
    const i = kind === "add" ? frames.length : index;
    ui.durationLabel.textContent =
      "第 " + i + " 帧 → 第 " + (i + 1) + " 帧，间隔 ";
    ui.duration.value = String(
      kind === "add"
        ? Math.min(1, round(10 - frames.at(-1).t))
        : round(frames[i].t - frames[i - 1].t),
    );
    ui.durationForm.hidden = false;
    toolbar();
    ui.duration.focus();
    ui.duration.select();
    note("时长指从前一个姿势到这个姿势经过的时间。");
  }
  ui.record.onclick = () => {
    stopPreview();
    if (frames.length >= 10) return;
    if (!frames.length) {
      frames = [{ t: 0, ...pose }];
      index = 0;
      frameList();
      paint();
      notify();
      note("第 1 帧已记录。拖动关节，摆好下一个姿势。");
    } else if (frames.at(-1).t > 9.800001)
      note("动作最长 10 秒，请先缩短已有帧间隔。");
    else duration("add");
  };
  ui.durationForm.onsubmit = (e) => {
    e.preventDefault();
    if (!durationTask) return;
    const dt = ui.duration.valueAsNumber;
    if (!Number.isFinite(dt) || dt < 0.2 || dt > 10) {
      note("相邻关键帧的间隔需在 0.2 至 10 秒之间。");
      return;
    }
    if (durationTask === "add") {
      const t = round(frames.at(-1).t + dt, 6);
      if (t > 10) {
        note("动作总长不能超过 10 秒，请缩短这段间隔。");
        return;
      }
      frames.push({ t, ...pose });
      index = frames.length - 1;
    } else {
      const delta = dt - (frames[index].t - frames[index - 1].t);
      if (round(frames.at(-1).t + delta, 6) > 10) {
        note("动作总长不能超过 10 秒，请缩短这段间隔。");
        return;
      }
      frames = frames.map((f, i) =>
        i < index ? f : { ...f, t: round(f.t + delta, 6) },
      );
    }
    closeDuration();
    frameList();
    paint();
    notify();
    note(
      "第 " + (index + 1) + " 帧已记录，距前一帧 " + shortTime(dt) + " 秒。",
    );
  };
  ui.cancelDuration.onclick = () => {
    closeDuration();
    note("已取消时长输入，姿势草稿仍保留。");
  };
  ui.replace.onclick = () => {
    if (index < 0) return;
    stopPreview();
    closeDuration();
    frames[index] = { t: frames[index].t, ...pose };
    frameList();
    paint();
    notify();
    note("第 " + (index + 1) + " 帧的姿势已替换，时间未改变。");
  };
  ui.frames.onclick = (e) => {
    const b = e.target.closest("[data-frame]");
    if (b) choose(Number(b.dataset.frame));
  };
  ui.manage.onclick = () => {
    ui.managePanel.hidden = !ui.managePanel.hidden;
    ui.manage.setAttribute("aria-expanded", String(!ui.managePanel.hidden));
  };
  function swap(step) {
    const j = index + step;
    if (index < 0 || j < 0 || j >= frames.length) return;
    stopPreview();
    closeDuration();
    const a = frames[index],
      b = frames[j];
    frames[index] = { ...b, t: a.t };
    frames[j] = { ...a, t: b.t };
    index = j;
    pose = normalize(frames[j]);
    frameList();
    paint();
    notify();
    note("姿势已移到第 " + (j + 1) + " 帧；各时间点不变。");
  }
  ui.earlier.onclick = () => swap(-1);
  ui.later.onclick = () => swap(1);
  ui.retime.onclick = () => {
    if (index > 0) duration("edit");
  };
  ui.remove.onclick = () => {
    if (index < 0) return;
    stopPreview();
    closeDuration();
    frames.splice(index, 1);
    if (frames.length) {
      const first = frames[0].t;
      frames = frames.map((f) => ({ ...f, t: round(f.t - first, 6) }));
      index = Math.min(index, frames.length - 1);
      pose = normalize(frames[index]);
    } else index = -1;
    frameList();
    paint();
    notify();
    note("已删除所选帧。");
  };
  ui.new.onclick = () => {
    stopPreview();
    closeDuration();
    frames = [];
    index = -1;
    frameList();
    paint();
    notify();
    note("已开始空白序列；当前姿势和手持器械保留。");
  };
  ui.preview.onclick = () => {
    if (previewId) {
      stopPreview();
      paint();
      note("预览已停止。");
      return;
    }
    if (frames.length < 2) return;
    closeDuration();
    extra = null;
    onDraft?.({ ...pose });
    const start = performance.now(),
      last = frames.at(-1).t;
    const tick = (now) => {
      const t = Math.min(last, (now - start) / 1000);
      let j = 1;
      while (j < frames.length - 1 && t > frames[j].t) j++;
      const a = frames[j - 1],
        b = frames[j],
        u = clamp((t - a.t) / (b.t - a.t), 0, 1),
        s = u * u * u * (10 + u * (-15 + 6 * u));
      pose = Object.fromEntries(
        Object.keys(basePose).map((k) => [k, a[k] + (b[k] - a[k]) * s]),
      );
      paint();
      if (t < last) previewId = requestAnimationFrame(tick);
      else {
        previewId = 0;
        index = frames.length - 1;
        paint();
        toolbar();
        note("姿势预览结束。");
      }
    };
    previewId = requestAnimationFrame(tick);
    toolbar();
    note("正在预览已记录的姿势；预计张力请查看求解结果。");
  };
  ui.atlas.addEventListener(
    "atlasready",
    () => {
      paint();
    },
    opt,
  );
  const resizer = new ResizeObserver(() => {
    requestAnimationFrame(syncHandles);
  });
  resizer.observe(ui.stage);
  observer = new MutationObserver(() => requestAnimationFrame(syncHandles));
  observer.observe(ui.atlas, {
    attributes: true,
    attributeFilter: ["data-atlas-status"],
  });
  frameList();
  rack();
  paint();
  return {
    setScene(value, { selectIndex, keepDraft = false } = {}) {
      stopPreview();
      closeDuration();
      const previous = pose;
      frames = (value?.keyframes ?? [])
        .filter((f) => Number.isFinite(f.t))
        .map((f) => ({ t: f.t, ...normalize(f) }));
      gear = equipment(value?.equipment);
      rackType = null;
      index = frames.length
        ? clamp(
            Number.isInteger(selectIndex) ? selectIndex : 0,
            0,
            frames.length - 1,
          )
        : -1;
      pose = keepDraft
        ? previous
        : index >= 0
          ? normalize(frames[index])
          : { ...basePose };
      extra = null;
      if (gear.type !== "none") ui.mass.value = String(gear.massKg);
      frameList();
      rack();
      paint();
      note("");
    },
    getScene: scene,
    getDraft() {
      return { ...pose };
    },
    showPlayback(p, nextGear, extras = {}) {
      if (!p || drag || durationTask) return;
      stopPreview();
      pose = normalize(p);
      if (nextGear) gear = equipment(nextGear);
      extra = extras;
      paint();
      toolbar();
    },
    dispose() {
      dead = true;
      stopPreview();
      item?.ghost?.remove();
      ctrl.abort();
      resizer.disconnect();
      observer.disconnect();
      view.dispose();
      container.replaceChildren();
    },
  };
}
