// GitHub Pages serves each verified result as a gzip file. The local
// Python endpoint performs this transport step itself. The same result loader
// validates the decompressed byte count, SHA-256, scene and every force frame.
export async function fetchPublicMotion(url) {
  const response = await fetch(url + ".gz");
  if (!response.ok) return response;
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
  document.querySelectorAll(".app-header a[href='http://127.0.0.1:4186/']").forEach(link => {
    link.href = "../../";
  });
  document.querySelector(".file-menu:not(#publicDesign)").hidden = true;
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
    "单位为 N·m。净需求已扣除关节被动作用与外部支撑。肌肉合计包含被动张力，止挡反力和未平衡量单列。";
  byId("workspaceStatus").textContent = "动作回放";
  byId("viewLoading").textContent = "正在载入骨骼和动作库…";
  byId("muscleDisplay").value = "paths";
  byId("muscleDisplay").disabled = true;
  byId("renderNote").textContent = "当前显示计算用肌腱路径。张力从灰绿渐变为橙色、红色。";
}
