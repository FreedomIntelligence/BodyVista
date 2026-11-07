// Copy only the typed-array views used by a contract, never the entire packed
// atlas buffer behind each view. The atlas remains owned by the main renderer.
export function copyShapeContract(value, transfers = []) {
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) throw Error("肌肉动画合同不支持 DataView。");
    const copy = value.slice();
    transfers.push(copy.buffer);
    return copy;
  }
  if (Array.isArray(value)) return value.map(item => copyShapeContract(item, transfers));
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyShapeContract(item, transfers)]));
  return value;
}

export async function createMuscleShapePool(parts, {
  workerFactory = () => new Worker(new URL("./muscle-shape-worker.js", import.meta.url), { type: "module" }),
  // Keep a core available to the browser and avoid duplicating contact volumes
  // across several workers on machines with little spare memory.
  concurrency = 1,
  contactForParts = () => null,
  signal,
} = {}) {
  if (signal?.aborted) throw Error("肌肉动画已关闭。");
  if (!Number.isFinite(concurrency) || concurrency < 1) throw Error("肌肉动画并行数无效。");
  if (new Set(parts.map(part => part.id)).size !== parts.length) throw Error("肌肉动画包含重复编号。");
  const count = Math.min(parts.length, Math.max(1, Math.floor(concurrency)));
  const workers = [], owners = new Map();
  let disposed = false, nextId = 0;
  function dispose() {
    if (disposed) return;
    disposed = true;
    signal?.removeEventListener("abort", dispose);
    for (const record of workers) {
      record.worker.terminate();
      for (const request of record.pending.values()) request.reject(Error("肌肉动画已关闭。"));
      record.pending.clear();
    }
  }
  signal?.addEventListener("abort", dispose, { once: true });
  function request(record, payload, transfers = []) {
    if (disposed) return Promise.reject(Error("肌肉动画已关闭。"));
    if (record.failure) return Promise.reject(record.failure);
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      record.pending.set(id, { resolve, reject });
      try { record.worker.postMessage({ ...payload, id }, transfers); }
      catch (error) { record.pending.delete(id); reject(error); }
    });
  }
  try {
    for (let i = 0; i < count; i++) {
      const record = { worker: workerFactory(), pending: new Map(), parts: [], failure: null };
      const fail = event => {
        record.failure = Error(event.message || "肌肉动画后台计算失败。");
        for (const item of record.pending.values()) item.reject(record.failure);
        record.pending.clear();
      };
      record.worker.onerror = fail;
      record.worker.onmessageerror = fail;
      record.worker.onmessage = ({ data }) => {
        const item = record.pending.get(data.id);
        if (!item) return;
        record.pending.delete(data.id);
        if (data.error) item.reject(Error(data.error));
        else item.resolve(data);
      };
      workers.push(record);
    }
    parts.forEach((part, i) => {
      const record = workers[i % count];
      record.parts.push(part);
      owners.set(part.id, record);
    });
    await Promise.all(workers.map(record => {
      const transfers = [];
      const copies = record.parts.map(part => ({ id: part.id, contract: copyShapeContract(part.contract, transfers) }));
      const contact = contactForParts(record.parts);
      if (contact) transfers.push(contact.buffer);
      return request(record, { type: "init", parts: copies, contact }, transfers);
    }));
  } catch (error) { dispose(); throw error; }
  return {
    async update(ids, matrices, bodies = []) {
      const jobs = new Map();
      for (const id of ids) {
        const owner = owners.get(id);
        if (!owner) throw Error(`肌肉动画未初始化：${id}`);
        if (!jobs.has(owner)) jobs.set(owner, []);
        jobs.get(owner).push(id);
      }
      const responses = await Promise.all([...jobs].map(([record, selected]) =>
        request(record, { type: "update", parts: selected, matrices, bodies })));
      return new Map(responses.flatMap(response => response.results.map(result => [result.id, result.positions])));
    },
    dispose,
    workerCount: workers.length,
  };
}

/** Cancel the caller immediately, while allowing an already running operation
 * to finish before the next one starts. Worker calculations cannot be stopped
 * mid-iteration without discarding their initialized state. */
export function createSerialPreparationQueue() {
  let tail = Promise.resolve(), disposed = false;
  return {
    run(task, signal) {
      if (disposed) return Promise.reject(Error("肌肉动画已关闭。"));
      if (signal?.aborted) return Promise.reject(signal.reason);
      const completed = tail.then(() => {
        signal?.throwIfAborted();
        if (disposed) throw Error("肌肉动画已关闭。");
        return task();
      });
      tail = completed.catch(() => {});
      if (!signal) return completed;
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        completed.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
    },
    whenIdle() { return tail; },
    dispose() { disposed = true; },
  };
}

/** Coalesce requests while preserving completed frames. Dropping a completed
 * frame whenever a newer request exists would starve continuous playback.
 * `apply` commits skeleton, muscles and picking together, after preparation.
 */
export function createLatestFrameQueue(prepare, apply, onError) {
  let pending = null, running = false, disposed = false, generation = 0;
  const waiters = [];
  function settle() { for (const resolve of waiters.splice(0)) resolve(); }
  async function drain() {
    if (running || disposed) return;
    running = true;
    try {
      while (pending && !disposed) {
        const frame = pending;
        const startedGeneration = generation;
        pending = null;
        try {
          const prepared = await prepare(frame);
          if (!disposed && generation === startedGeneration) apply(frame, prepared);
        } catch (error) { if (!disposed && generation === startedGeneration) onError(error); }
      }
    } finally { running = false; settle(); }
  }
  return {
    request(frame) { if (!disposed) { pending = frame; void drain(); } },
    // A new editing gesture starts at the visible pose. Results from an older
    // gesture must not arrive later and replace that frozen starting picture.
    invalidate() { generation += 1; pending = null; },
    whenIdle() { return running || pending ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve(); },
    dispose() { disposed = true; pending = null; settle(); },
  };
}
