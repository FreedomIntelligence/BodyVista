import test from "node:test";
import assert from "node:assert/strict";
import { copyShapeContract, createLatestFrameQueue, createMuscleShapePool, createSerialPreparationQueue } from "../experiments/body-lab/muscle-shape-pool.js";

test("worker contracts copy the view without transferring the packed atlas", () => {
  const source = new Float32Array(1024);
  source.set([1, 2, 3], 100);
  const transfers = [];
  const copy = copyShapeContract({ rest: source.subarray(100, 103) }, transfers);
  assert.equal(copy.rest.buffer.byteLength, 12);
  const received = structuredClone(copy, { transfer: transfers });
  assert.deepEqual([...received.rest], [1, 2, 3]);
  assert.equal(source.buffer.byteLength, 4096);
  assert.equal(source[101], 2);
});

test("busy animation coalesces intermediate requests and commits completed frames", async () => {
  const releases = [], applied = [], errors = [];
  const queue = createLatestFrameQueue(
    frame => new Promise(resolve => releases.push(() => resolve(frame * 10))),
    (frame, shape) => applied.push([frame, shape]), error => errors.push(error),
  );
  queue.request(1); queue.request(2); queue.request(3);
  releases.shift()();
  await Promise.resolve();
  assert.deepEqual(applied, [[1, 10]]);
  queue.request(4);
  releases.shift()();
  await Promise.resolve();
  assert.deepEqual(applied, [[1, 10], [3, 30]]);
  const done = queue.whenIdle();
  releases.shift()();
  await done;
  assert.deepEqual(applied, [[1, 10], [3, 30], [4, 40]]);
  assert.deepEqual(errors, []);
});

test("disposing an in-flight frame prevents late display and settles waiters", async () => {
  let release;
  const applied = [];
  const queue = createLatestFrameQueue(() => new Promise(resolve => { release = resolve; }),
    frame => applied.push(frame), error => { throw error; });
  queue.request(1);
  const done = queue.whenIdle();
  queue.dispose();
  await done;
  release();
  await Promise.resolve();
  assert.deepEqual(applied, []);
});

test("a new gesture invalidates old work and keeps its own latest pose", async () => {
  const releases = [], applied = [], errors = [];
  const queue = createLatestFrameQueue(
    frame => new Promise((resolve, reject) => releases.push({ frame, resolve, reject })),
    frame => applied.push(frame), error => errors.push(error.message),
  );
  queue.request("old running"); queue.request("old waiting");
  queue.invalidate(); queue.request("new gesture");
  releases.shift().resolve();
  await Promise.resolve();
  assert.deepEqual(applied, []);
  assert.equal(releases[0].frame, "new gesture");
  const done = queue.whenIdle(); releases.shift().resolve(); await done;
  assert.deepEqual(applied, ["new gesture"]);
  queue.request("old failing"); queue.invalidate();
  const settled = queue.whenIdle(); releases.shift().reject(Error("superseded")); await settled;
  assert.deepEqual(errors, []);
});

test("failed frame is reported and the latest pending frame still displays", async () => {
  let reject;
  const applied = [], errors = [];
  const queue = createLatestFrameQueue(frame => frame === 1 ? new Promise((_, fail) => { reject = fail; }) : Promise.resolve(frame),
    frame => applied.push(frame), error => errors.push(error.message));
  queue.request(1); queue.request(2);
  const done = queue.whenIdle();
  reject(Error("invalid geometry"));
  await done;
  assert.deepEqual(applied, [2]);
  assert.deepEqual(errors, ["invalid geometry"]);
});

test("worker failure rejects its active job; disposal rejects the others", async () => {
  const workers = [];
  const pool = await createMuscleShapePool([{ id: "a", contract: {} }, { id: "b", contract: {} }], {
    concurrency: 2,
    workerFactory() {
      const worker = {
        postMessage(message) {
          if (message.type === "init") queueMicrotask(() => this.onmessage({ data: { id: message.id, ready: true } }));
        },
        terminate() { this.terminated = true; },
      };
      workers.push(worker);
      return worker;
    },
  });
  const failed = assert.rejects(pool.update(["a"], []), /crashed/);
  const cancelled = assert.rejects(pool.update(["b"], []), /已关闭/);
  workers[0].onerror({ message: "crashed" });
  pool.dispose();
  await Promise.all([failed, cancelled]);
  assert.ok(workers.every(worker => worker.terminated));
});

test("aborting during initialization terminates workers immediately", async () => {
  const abort = new AbortController(), workers = [];
  const pending = createMuscleShapePool([{ id: "a", contract: {} }], {
    signal: abort.signal,
    workerFactory() {
      const worker = { postMessage() {}, terminate() { this.terminated = true; } };
      workers.push(worker);
      return worker;
    },
  });
  const check = assert.rejects(pending, /已关闭/);
  abort.abort();
  await check;
  assert.ok(workers.every(worker => worker.terminated));
});

test("cancelling a running preparation returns immediately without overlapping its replacement", async () => {
  const queue = createSerialPreparationQueue(), abort = new AbortController();
  const starts = [];
  let release;
  const old = queue.run(() => { starts.push("old"); return new Promise(resolve => { release = resolve; }); }, abort.signal);
  await Promise.resolve();
  const cancelled = assert.rejects(old, { name: "AbortError" });
  abort.abort();
  await cancelled;
  const next = queue.run(() => { starts.push("next"); return 2; });
  await Promise.resolve();
  assert.deepEqual(starts, ["old"]);
  release(1);
  assert.equal(await next, 2);
  assert.deepEqual(starts, ["old", "next"]);
});

test("cancelled waiting preparation is skipped and a failed one does not block the queue", async () => {
  const queue = createSerialPreparationQueue(), abort = new AbortController();
  let release, skipped = false;
  const first = queue.run(() => new Promise(resolve => { release = resolve; }));
  const waiting = queue.run(() => { skipped = true; }, abort.signal);
  await Promise.resolve();
  const cancelled = assert.rejects(waiting, { name: "AbortError" });
  abort.abort();
  await cancelled;
  release();
  await first;
  await assert.rejects(queue.run(() => { throw Error("bad surface"); }), /bad surface/);
  assert.equal(await queue.run(() => 3), 3);
  assert.equal(skipped, false);
  queue.dispose();
  await assert.rejects(queue.run(() => 4), /已关闭/);
});

test("default preparation uses one worker for all muscle contracts", async () => {
  const assigned = [];
  const pool = await createMuscleShapePool([{ id: "a", contract: {} }, { id: "b", contract: {} }], {
    workerFactory() {
      return {
        postMessage(message) {
          assigned.push(message.parts.map(part => part.id));
          queueMicrotask(() => this.onmessage({ data: { id: message.id, ready: true } }));
        },
        terminate() {},
      };
    },
  });
  assert.equal(pool.workerCount, 1);
  assert.deepEqual(assigned, [["a", "b"]]);
  pool.dispose();
});
