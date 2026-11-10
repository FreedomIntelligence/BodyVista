import { translateAnatomy } from "./motion-locale-data.js";

const reviewStrings = {
  "BodyVista · 肌肉运动对照": ["BodyVista · Muscle motion comparisons", "BodyVista · 筋の動きの比較"],
  "肌肉运动对照": ["Muscle motion comparisons", "筋の動きの比較"],
  "返回全身实验台": ["Back to the full-body lab", "全身実験台に戻る"],
  "选择肌肉和视角，可以播放、暂停或拖动录像进度。每段录像标明采用的模型和仍能看到的问题。": ["Choose a muscle and a view, then play, pause or scrub through the recording. Each recording identifies the model used and the issues that remain visible.", "筋と視点を選び、録画を再生・一時停止したり、再生位置を移動したりできます。各録画には、使用したモデルと、まだ見られる問題を記しています。"],
  "选择肌肉": ["Select a muscle", "筋を選択"],
  "录像": ["Recording", "録画"],
  "所选肌肉的实际运动录像": ["Motion recording of the selected muscle", "選択した筋の動きの録画"],
  "近看轮廓时，可以比较附着点是否留在骨上，以及肌腹是否在某个位置突然收窄或鼓起。": ["In close-up, check whether the attachment points stay on the bone and whether the muscle belly suddenly narrows or bulges at any point.", "輪郭を拡大して、付着点が骨から離れていないか、筋腹が途中で急に細くなったり膨らんだりしていないかを見比べてください。"],
  "录像清单无法读取": ["The recording list could not be loaded.", "録画の一覧を読み込めませんでした。"],
  "该段录像未能载入，请刷新页面重试。": ["This recording could not be loaded. Refresh the page to try again.", "この録画を読み込めませんでした。ページを再読み込みしてお試しください。"],
  "正式版": ["Released model", "正式版"],
  "研究候选": ["Research candidate", "研究用の候補モデル"],
  "右侧": ["Right side", "右側"],
  "左侧": ["Left side", "左側"],
  "观察肩胛冈附近的肌腹。左右各检查了 98 个姿态记录，各自包含 38 种实际表面形状。所测动作中未发现旧版的翻边。": ["Watch the muscle belly near the spine of the scapula. On each side, 98 recorded poses were checked, including 38 distinct surface shapes. The edge that folded over in the previous version did not do so in the tested movements.", "肩甲棘付近の筋腹に注目してください。左右それぞれ98件の姿勢記録を調べ、各側で38種類の表面形状を確認しました。検証した動作では、旧版で見られた縁のめくれは認められませんでした。"],
  "上下是两种视角。四列依次为旧版单肌、修订后单肌、旧版同显邻肌和修订后同显邻肌。": ["The rows show two viewing angles. From left to right, the columns show the muscle alone in the previous and revised models, then the muscle with its neighbors in the previous and revised models.", "上下の段は異なる2つの視点です。左から順に、旧版の単独表示、修正版の単独表示、旧版で周囲の筋も表示したもの、修正版で周囲の筋も表示したものです。"],
  "观察胸骨旁的肌腹和肩前的交界。右肩前举至 165° 时，早先的三角空洞已闭合，前侧三角肌与胸大肌仍有毫米级穿入。": ["Watch the muscle belly beside the sternum and its junction at the front of the shoulder. At 165° of forward elevation of the right shoulder, the previous triangular gap has closed. The anterior deltoid and pectoralis major surfaces still intersect on a millimeter scale.", "胸骨の横にある筋腹と肩前面の境界に注目してください。右肩を前方に165°挙げたとき、以前の三角形の隙間は閉じています。三角筋前部と大胸筋の表面には、なおミリメートル単位の食い込みがあります。"],
  "完整人体的右肩前举到 165°，同时显示其余肌肉。": ["The full-body model raises the right arm forward to 165° at the shoulder, with the other muscles visible.", "全身モデルでほかの筋も表示しながら、右肩を前方に165°挙げます。"],
  "左侧单肌修订的对照，同时观察两种视角及周围肌肉。": ["Compare the revision of the left muscle in isolation, alongside two views and the surrounding muscles.", "左側の筋単独の修正前後を見比べ、2つの視点と周囲の筋もあわせて確認します。"],
  "观察小收肌两端和股骨之间的距离。十块髋部肌肉一起变形后，旧的折返明显减轻。完整人体中仍需处理与周围肌肉的交叉。": ["Watch the distance from each end of the adductor minimus to the femur. Deforming all ten hip muscles together substantially reduced the earlier foldback. Intersections with neighboring muscles in the full-body model still need correction.", "小内転筋の両端と大腿骨との距離に注目してください。股関節周囲の10筋を一緒に変形させた結果、以前の折り返しは明らかに小さくなりました。全身モデルで周囲の筋と交差する部分は、修正が必要です。"],
  "屈髋 0° 至 110°。左列同显九块邻肌，右列显示目标肌肉和骨骼，上下是两个视角。": ["Hip flexion ranges from 0° to 110°. The left column includes nine neighboring muscles. The right column shows the selected muscle and bones. The two rows show different viewing angles.", "股関節を0°から110°まで曲げます。左列には周囲の9筋も、右列には対象の筋と骨を表示しています。上下の段は異なる2つの視点です。"],
  "观察髂窝宽端如何贴在骨盆上，以及窄端如何随股骨转动。深屈髋时髋前的短折痕和股骨侧附着仍需修正。": ["Watch how the broad end in the iliac fossa lies against the pelvis and how the narrow end turns with the femur. At deep hip flexion, a short crease at the front of the hip and the femoral attachment still need correction.", "腸骨窩にある幅広い端が骨盤にどう沿うか、細い端が大腿骨とともにどう回るかに注目してください。股関節を深く曲げたときの前面の短い折れ目と、大腿骨側の付着は引き続き修正が必要です。"],
  "屈髋 0° 至 100°。按股骨局部凸起重新定位 54 个附着点后，止端下方的突瓣缩小，肌腹至肌腱处仍有横折。左列同显邻肌，右列为单肌近景。": ["Hip flexion ranges from 0° to 100°. Repositioning 54 attachment points to match the local prominence of the femur reduced the protruding flap below the insertion. A transverse fold remains where the muscle belly meets the tendon. The left column includes neighboring muscles. The right column shows the isolated muscle in close-up.", "股関節を0°から100°まで曲げます。大腿骨の局所的な隆起に合わせて54個の付着点を再配置したところ、停止部の下の突起は小さくなりました。筋腹から腱への移行部には横方向の折れ目が残っています。左列には周囲の筋も表示し、右列は対象の筋のみの拡大像です。"],
  "沿大腿内侧从骨盆看到膝旁。分段约束体积和转角后，先前膝旁的大鼓包已经减小，靠骨盆的一段仍可见回弯。": ["Follow the inner thigh from the pelvis to the knee. Constraining the volume and rotation of each segment reduced the large bulge previously seen near the knee. The segment near the pelvis still bends back on itself.", "大腿の内側を骨盤から膝の横まで追ってください。各区間の体積と回転角を制限した結果、以前は膝の横に見られた大きな膨らみが小さくなりました。骨盤に近い部分にはまだ折り返しが見られます。"],
};

const languages = ["zh-CN", "en", "ja"];

export function reviewText(source, language) {
  if (language !== "en" && language !== "ja") return source;
  return reviewStrings[source]?.[language === "en" ? 0 : 1]
    ?? translateAnatomy(source, language) ?? source;
}

export async function startReview() {
  let language = new URL(location.href).searchParams.get("lang");
  if (!languages.includes(language)) {
    try { language = localStorage.getItem("atlas-language"); } catch { /* Storage can be disabled. */ }
    if (!languages.includes(language)) language = "zh-CN";
  }
  const nav = document.querySelector("nav");
  const selector = document.getElementById("recording");
  const player = document.querySelector("video");
  const back = document.querySelector("header a");
  const description = document.getElementById("desc");
  const caption = document.getElementById("caption");
  const staticText = Array.from(document.querySelectorAll("[data-review-text]"),
    node => [node, node.textContent]);
  const ariaLabels = Array.from(document.querySelectorAll("[aria-label]"),
    node => [node, node.getAttribute("aria-label")]);
  let muscles = [], current = 0, recording = 0, manifestFailed = false;
  const t = source => reviewText(source, language);

  function paint() {
    document.documentElement.lang = language;
    for (const [node, source] of staticText) node.textContent = t(source);
    for (const [node, source] of ariaLabels) node.setAttribute("aria-label", t(source));
    const workspace = new URL(back.href);
    workspace.searchParams.set("lang", language);
    back.href = workspace.href;
    if (manifestFailed) description.textContent = t("录像清单无法读取");
    const muscle = muscles[current];
    if (!muscle) return;
    for (const [i, button] of Array.from(nav.children).entries()) {
      button.textContent = t(muscles[i].name);
      button.setAttribute("aria-pressed", String(i === current));
    }
    document.getElementById("name").textContent = t(muscle.name) + " · " + t(muscle.state);
    description.textContent = t(muscle.observation);
    for (const [i, option] of Array.from(selector.options).entries()) option.text = t(muscle.films[i].label);
    caption.textContent = t(player.error ? "该段录像未能载入，请刷新页面重试。" : muscle.films[recording].caption);
  }

  function loadRecording() {
    recording = selector.selectedIndex;
    const film = muscles[current].films[recording];
    player.pause();
    player.src = "./review-media/" + film.file;
    caption.textContent = t(film.caption);
  }

  function selectMuscle(index) {
    current = index;
    recording = 0;
    selector.replaceChildren(...muscles[current].films.map(film => new Option(t(film.label), film.file)));
    paint();
    loadRecording();
  }

  paint();
  window.addEventListener("storage", event => {
    if (event.key !== "atlas-language" || !languages.includes(event.newValue)) return;
    language = event.newValue;
    const url = new URL(location.href);
    url.searchParams.set("lang", language);
    history.replaceState(history.state, "", url);
    paint();
  });
  try {
    const response = await fetch("./review-media/manifest.json");
    if (!response.ok) throw new Error("Recording manifest HTTP " + response.status);
    const manifest = await response.json();
    if (!Array.isArray(manifest.muscles) || !manifest.muscles.length)
      throw new Error("Recording manifest contains no muscles");
    muscles = manifest.muscles;
    muscles.forEach((muscle, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t(muscle.name);
      button.onclick = () => selectMuscle(i);
      nav.append(button);
    });
    selector.onchange = loadRecording;
    player.onerror = () => { caption.textContent = t("该段录像未能载入，请刷新页面重试。"); };
    selectMuscle(0);
  } catch (error) {
    manifestFailed = true;
    description.textContent = t("录像清单无法读取");
    console.error("Could not load the muscle recording list", error);
  }
}
