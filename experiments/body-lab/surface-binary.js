// Pages publishes independent gzip blocks of the original surface binaries.
// Inflate one block at a time directly into the final atlas/volume buffer.
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

async function copyStream(stream, target, signal, onBytes) {
  const reader = stream.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, {once: true});
  let size = 0;
  try {
    signal?.throwIfAborted();
    while (true) {
      const {value, done} = await reader.read();
      signal?.throwIfAborted();
      if (done) return size;
      if (size + value.length > target.length) throw Error("肌肉表面数据块超出声明长度。");
      target.set(value, size);
      size += value.length;
      onBytes?.(size);
    }
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

export async function readSurfaceChunks(manifest, manifestUrl, signal, onBytes, destination) {
  const {byteLength, binaryChunks} = manifest;
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 512 * 1024 * 1024 ||
      !Array.isArray(binaryChunks) || !binaryChunks.length ||
      binaryChunks.some(c => !/^surface-chunks\/[0-9a-f]{64}\.gz$/.test(c.file) ||
        !/^[0-9a-f]{64}$/.test(c.sha256) || !Number.isSafeInteger(c.bytes) || c.bytes < 1 ||
        c.bytes > MAX_CHUNK_BYTES || !Number.isSafeInteger(c.compressedBytes) ||
        c.compressedBytes < 1 || c.compressedBytes > MAX_CHUNK_BYTES + 65536) ||
      binaryChunks.reduce((n, c) => n + c.bytes, 0) !== byteLength)
    throw Error("解剖表面分块清单的长度或版本无效。");

  signal?.throwIfAborted();
  const out = destination || new Uint8Array(byteLength);
  if (out.byteLength !== byteLength) throw Error("解剖表面接收缓冲区长度错误。");
  let offset = 0;
  for (const chunk of binaryChunks) {
    const response = await fetch(new URL(chunk.file, manifestUrl), {signal, cache: "force-cache"});
    if (!response.ok || !response.body) throw Error("无法下载解剖表面数据块。");
    // Some hosts send .gz as a Content-Encoding and the browser has already
    // decoded the response. Verify the same raw block hash in either case.
    const packed = new Uint8Array(Math.max(chunk.compressedBytes, chunk.bytes));
    const size = await copyStream(response.body, packed, signal);
    const dest = out.subarray(offset, offset + chunk.bytes);
    if (size === chunk.compressedBytes && packed[0] === 0x1f && packed[1] === 0x8b) {
      if (typeof DecompressionStream !== "function") throw Error("浏览器不支持解压肌肉表面。");
      const stream = new Blob([packed.subarray(0, size)]).stream().pipeThrough(new DecompressionStream("gzip"));
      if (await copyStream(stream, dest, signal, n => onBytes?.(offset + n)) !== chunk.bytes)
        throw Error("解剖表面解压长度不匹配。");
    } else if (size === chunk.bytes) {
      dest.set(packed.subarray(0, size));
      onBytes?.(offset + size);
    } else throw Error("解剖表面压缩块不完整。");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", dest));
    signal?.throwIfAborted();
    if (Array.from(digest, b => b.toString(16).padStart(2, "0")).join("") !== chunk.sha256)
      throw Error("解剖表面数据块版本不匹配。");
    offset += chunk.bytes;
  }
  return destination || out.buffer;
}
