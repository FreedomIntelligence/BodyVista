import { makeMuscleSheetShape } from "./muscle-sheet-shape.js";
import { makeBoneVolumes } from "./bone-volumes.js";

const shapes = new Map();
let boneVolumes = null;
self.onmessage = ({ data }) => {
  try {
    if (data.type === "init") {
      if (data.contact) boneVolumes = makeBoneVolumes(data.contact.manifest, data.contact.buffer, 1);
      for (const part of data.parts)
        shapes.set(part.id, makeMuscleSheetShape(part.contract, { boneVolumes }));
      self.postMessage({ id: data.id, ready: true });
      return;
    }
    if (data.type !== "update") throw Error("未知肌肉动画任务。");
    if (boneVolumes) boneVolumes.update(data.bodies, []);
    const relative = new Map(data.matrices.map(([name, elements]) => [name, { elements }]));
    const results = data.parts.map(id => {
      const shape = shapes.get(id);
      if (!shape) throw Error(`肌肉动画未初始化：${id}`);
      // The solver owns its working array; transferring it would detach the
      // next frame's state. Only this compact result copy changes ownership.
      return { id, positions: shape.update(relative).slice() };
    });
    self.postMessage({ id: data.id, results }, results.map(result => result.positions.buffer));
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message || String(error) });
  }
};
