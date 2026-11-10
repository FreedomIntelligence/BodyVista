import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { readSurfaceChunks } from "../experiments/body-lab/surface-binary.js";

const hash = data => createHash("sha256").update(data).digest("hex");
const root = new URL("https://bodyvista.example/experiments/body-lab/atlas-muscles.json");
const raw = [Buffer.from([0, 255, 3, 12]), Buffer.from([12, 12, 4, 8, 5])];
const stored = raw.map(data => gzipSync(data));
const manifest = {
  byteLength: raw.reduce((total, block) => total + block.length, 0),
  binaryChunks: raw.map((block, i) => ({
    file: `surface-chunks/${hash(stored[i])}.gz`, bytes: block.length,
    compressedBytes: stored[i].length, sha256: hash(block),
  })),
};

test("split surfaces use both transport encodings and fill the supplied GPU bytes in order", async t => {
  const requested = [];
  t.mock.method(globalThis, "fetch", async url => {
    requested.push(url.href);
    const index = requested.length - 1;
    return new Response(index === 0 ? stored[index] : raw[index]);
  });
  const target = new Uint8Array(16).fill(99);
  const slice = target.subarray(2, 2 + manifest.byteLength);
  assert.equal(await readSurfaceChunks(manifest, root, undefined, undefined, slice), slice);
  assert.deepEqual([...slice], [...Buffer.concat(raw)]);
  assert.equal(target[1], 99);
  assert.equal(target.at(-1), 99);
  assert.deepEqual(requested, manifest.binaryChunks.map(chunk => new URL(chunk.file, root).href));
});

test("a same-length altered chunk is rejected before fetching the next chunk", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(new Uint8Array(raw[0].length)));
  await assert.rejects(readSurfaceChunks(manifest, root), /版本不匹配/);
  assert.equal(fetch.mock.callCount(), 1);
});

test("incomplete chunk tables and cancelled loads never start a fetch", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("unexpected fetch"));
  await assert.rejects(readSurfaceChunks({...manifest, byteLength: 1}, root), /清单/);
  await assert.rejects(readSurfaceChunks(manifest, root, AbortSignal.abort()), {name: "AbortError"});
  assert.equal(fetch.mock.callCount(), 0);
});
