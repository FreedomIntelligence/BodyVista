import { sourceAttribute, sourceText } from "./motion-locale.js";

// GitHub Pages serves each verified result as a gzip file. The local
// Python endpoint performs this transport step itself. The same result loader
// validates the decompressed byte count, SHA-256, scene and every force frame.
export async function fetchPublicMotion(url) {
  const response = await fetch(url + ".gz");
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  if (signature[0] !== 0x1f || signature[1] !== 0x8b) return new Response(bytes);
  if (typeof DecompressionStream === "undefined")
    throw Error("当前浏览器无法解压动作数据，请使用较新版本的浏览器。");
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream);
}

export function preparePublicReplay() {
  document.body.classList.add("public-replay");
  const byId = id => document.getElementById(id);
  if (window.parent === window) {
    const workspace = new URL("../../?workspace=muscle-motion", location.href);
    const params = new URLSearchParams(location.search);
    const chosen = params.get("case");
    if (chosen) workspace.searchParams.set("case", chosen);
    if (["zh-CN", "en", "ja"].includes(params.get("lang"))) workspace.searchParams.set("lang", params.get("lang"));
    location.replace(workspace.href);
  }
  byId("publicDesign").hidden = false;
  document.querySelector(".sidebar-head h1").textContent = "动作库";
  document.querySelector(".drawer-head h2").textContent = "受力结果";
  document.querySelector(".motion-workspace").setAttribute("aria-label", "动作回放与受力");
  byId("verifiedHeading").textContent = "选择回放动作";
  byId("verifiedHeading").nextElementSibling.dataset.help =
    "选择动作后可以拖动底部时间轴或按播放。每一帧的肌腱张力、支撑和关节力矩来自对应动作的完整计算。";
  document.querySelector(".scene-title .help-button").dataset.help =
    "拖动空白处旋转视角，滚轮或双指缩放。点击一条肌腱可以观察它的张力。";
  document.querySelector(".sequence-title .help-button").dataset.help =
    "点选关键帧或拖动时间轴查看该姿势的力值。按空格或播放按钮开始回放。";
  document.querySelector("#panel-motions a[href='./muscle-review.html']").hidden = true;
  document.querySelector("#panel-forces .torque-panel > .hint").textContent =
    "力矩单位为 N·m。净需求已扣除关节被动作用与外部支撑。肌肉合计包含被动张力，止挡反力和未平衡量单列。";
  byId("workspaceStatus").textContent = "动作回放";
  byId("viewLoading").textContent = "正在载入骨骼和动作库…";
  byId("publicSurfaceStatus").hidden = false;
  byId("renderNote").textContent = "正在载入真实解剖表面。";
}

export function showSurfaceStatus(update, state) {
  const note = document.getElementById("publicSurfaceStatus");
  const retry = document.getElementById("retryPublicSurface");
  const preview = state.showPreview;
  note.hidden = state.muscleDisplay !== "anatomy";
  retry.hidden = note.hidden || !state.surfaceLoadError;
  if (note.hidden) return;
  const phase = state.surfaceLoadError || update.error ? "error" : update.ready && !preview ? "ready" : preview ? "preview" : "loading";
  note.dataset.phase = phase;
  const labels = {
    loading: "正在载入肌肉表面…",
    preview: "预览 · 正在载入精细表面…",
    ready: "精细解剖表面",
    error: preview ? "精细表面未载入，当前为预览" : "肌肉表面未载入",
  };
  if (sourceText(note) !== labels[phase]) note.textContent = labels[phase];
  if (update.message && sourceAttribute(note, "title") !== update.message) note.title = update.message;
}
