"""Serve the built BodyVista site and its editable muscle lab on one local origin."""

import argparse
import gzip
import hashlib
import importlib
import io
import json
import math
import os
import re
import sys
import threading
import zlib
from collections import OrderedDict
from functools import lru_cache
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from time import perf_counter
from urllib.parse import parse_qsl, urlencode, urlsplit

from engine import model_info
from solver import ScenarioError, solve

LAB = Path(__file__).resolve().parent
REPO = LAB.parents[1]
PREFIX = "/experiments/elbow-lab/"
BODY = REPO / "experiments" / "body-lab"
BODY_PREFIX = "/experiments/body-lab/"
SITE = REPO / "dist"
WORKSPACE_URL = "/?workspace=muscle-motion"
# Vite's public entry points and generated assets. The build also contains
# vendor sources and research exports that are outside the offline site.
SITE_FILES = {
    "/index.html", "/dental/index.html", "/dental/models/manifest.json",
    "/dental/vendor/CREDITS.md", "/dental/vendor/LICENSE",
    *(f"/assets/{system}.glb" for system in (
        "cardiovascular", "digestive", "endocrine", "lymphatic", "muscular", "nervous",
        "reproductive", "respiratory", "sensory", "skeletal", "skin", "urinary",
    )),
}
SITE_ASSET = re.compile(
    r"/(?:app/(?:(?:main|dental|three|chatgpt-link|catalog)-[A-Za-z0-9_-]{8}\.(?:js|css)"
    r"|bodyvista-[A-Za-z0-9_-]{8}\.png|favicon-[A-Za-z0-9_-]{8}\.svg)"
    r"|thumbs/[a-z0-9-]+\.png|assets/detail/z_[a-f0-9]{16}\.glb"
    r"|dental/models/(?:core|context|neurovascular|teeth/tooth-[1-8][1-8])\.glb)"
)
BODY_STATIC = {
    "examples/custom_right_rotate_bend_make_fist.json",
    "examples/custom_left_open_while_rotating.json",
    "muscle-review.html",
    "review-media/manifest.json",
    *(f"review-media/{muscle}-{side}.{extension}"
      for muscle, extension in (("trapezius", "webm"), ("pectoralis", "webm"),
                               ("minimus", "mp4"), ("iliacus", "mp4"), ("gracilis", "mp4"))
      for side in ("left", "right")),
    "app.js",
    "motion-cache.js",
    "muscle-picker.js",
    "motion-locale.js", "motion-locale-static.js", "motion-locale-data.js",
    "motion-locale-runtime.js", "motion-locale-evidence.js", "motion-locale-review.js",
    "motion-cache/catalog.json",
    "style.css",
    "body-view.js",
    "fullbody-view.js",
    "anatomical-muscles.js",
    "preview-muscles.js",
    "preview-muscles.json",
    "preview-muscles.bin",
    "muscle-sheet-shape.js",
    "muscle-shape-pool.js",
    "muscle-shape-worker.js",
    "muscle-path-shape.js",
    "bone-volumes.js",
    "surface-binary.js",
    "atlas-muscles.json",
    "atlas-muscles.bin",
    "geometry/fullbody-bones.json",
    "geometry/bone-volumes.json",
    "geometry/bone-volumes.bin",
    "fullbody-model-data.json",
    "fullbody-coverage.json",
    "fullbody-validation.json",
    "fullbody-ui-validation.json",
    "FULLBODY.md",
    "ANATOMY_CONSTRAINTS.md",
    "geometry/bones.json",
    "model-data.json",
    "coverage.json",
    "validation.json",
    "README.md",
    "validation.md",
    "geometry/sources.json",
}
ASSETS = re.compile(r"/assets/detail/(z_[a-f0-9]+)\.(js|glb)")
MOTION_CACHE = re.compile(r"/experiments/body-lab/motion-cache/([a-f0-9]{64})\.json")
VENDOR = {"GLTFLoader.js", "three.js", "buffer-utils.js", "OrbitControls.js"}
STATIC = {
    "index.html",
    "app.js",
    "style.css",
    "arm-view.js",
    "muscle-shape.js",
    "model/fiber-lengths.json",
    "pose-editor.js",
    "pose-editor.css",
    "demo.json",
    "atlas/bindings.json",
}
MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    "": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".glb": "model/gltf-binary",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".bin": "application/octet-stream",
    ".md": "text/plain; charset=utf-8",
}
LOCK = threading.BoundedSemaphore(2)
BODY_LOCK = threading.Lock()
FULLBODY_LOCK = threading.Lock()
MOTION_CACHE_CHECKS = OrderedDict()
MOTION_CACHE_CHECK_LOCK = threading.Lock()


@lru_cache(maxsize=3)
def body_module(name):
    # Keep the existing elbow modules separate from the native full-body package.
    sys.path.insert(0, str(REPO / "experiments"))
    return importlib.import_module(f"body-lab.{name}")


@lru_cache(maxsize=1)
def allowed_atlas_ids():
    # Asset IDs can occur in bone or muscle records of the local binding manifest.
    return set(
        re.findall(r"\bz_[a-f0-9]+\b", (LAB / "atlas/bindings.json").read_text("utf-8"))
    )


def finite_float(token):
    value = float(token)
    if not math.isfinite(value):
        raise ValueError("Input must be finite")
    return value


def cache_encoding(header):
    """Choose an available representation; explicit exclusions beat wildcards."""
    qualities = {}
    for item in header.lower().split(","):
        encoding, *parameters = item.strip().split(";")
        quality = 1.0
        for parameter in parameters:
            if parameter.strip().startswith("q="):
                try:
                    quality = float(parameter.strip()[2:])
                except ValueError:
                    quality = 0.0
        if not math.isfinite(quality) or not 0 <= quality <= 1:
            quality = 0.0
        qualities[encoding] = quality
    gzip_quality = qualities.get("gzip", qualities.get("*", 0))
    identity_quality = qualities.get("identity", 0 if qualities.get("*") == 0 else 1)
    if gzip_quality > 0:
        return "gzip"
    if identity_quality > 0:
        return "identity"
    return None


def checked_motion_cache(target, digest, *, use_gzip):
    """Memoize successful checks by file identity, without retaining large results."""
    def identity(stat):
        return stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns

    with target.open("rb") as source:
        before = identity(os.fstat(source.fileno()))
        compressed = source.read()
        if identity(os.fstat(source.fileno())) != before:
            raise ValueError("Cache changed while being read")
    key = (str(target), digest, before)
    with MOTION_CACHE_CHECK_LOCK:
        checked = key in MOTION_CACHE_CHECKS
        if checked:
            MOTION_CACHE_CHECKS.move_to_end(key)
    if use_gzip and checked:
        return compressed
    raw = None if use_gzip else gzip.decompress(compressed)
    if not checked:
        if raw is None:
            hasher = hashlib.sha256()
            with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as stream:
                for chunk in iter(lambda: stream.read(256 * 1024), b""):
                    hasher.update(chunk)
            actual = hasher.hexdigest()
        else:
            actual = hashlib.sha256(raw).hexdigest()
        if actual != digest:
            raise ValueError("Cache content does not match its address")
        with MOTION_CACHE_CHECK_LOCK:
            MOTION_CACHE_CHECKS[key] = True
            MOTION_CACHE_CHECKS.move_to_end(key)
            while len(MOTION_CACHE_CHECKS) > 32:
                MOTION_CACHE_CHECKS.popitem(last=False)
    return compressed if use_gzip else raw


class LabHandler(BaseHTTPRequestHandler):
    server_version = "BodyVistaElbow/1"

    def setup(self):
        self._connection_started = perf_counter()
        self._server_timing = {}
        super().setup()

    def payload(
        self, status, raw, media="application/json; charset=utf-8", *, head=False,
        cache_control="no-cache", content_encoding=None, etag=None
    ):
        self.send_response(status)
        self.send_header("Content-Type", media)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", cache_control)
        if content_encoding:
            self.send_header("Content-Encoding", content_encoding)
        if etag:
            self.send_header("ETag", etag)
            self.send_header("Vary", "Accept-Encoding")
        if self._server_timing:
            self.send_header(
                "Server-Timing",
                ", ".join(
                    f"{name};dur={duration:.3f}"
                    for name, duration in self._server_timing.items()
                ),
            )
        self.end_headers()
        if not head:
            self.wfile.write(raw)

    def file_response(self, target, *, head=False):
        size = target.stat().st_size
        start, end = 0, size - 1
        requested = self.headers.get("Range")
        if requested is not None:
            match = re.fullmatch(r"bytes=([0-9]{0,19})-([0-9]{0,19})", requested.strip())
            if match and any(match.groups()):
                first, last = match.groups()
                start = int(first) if first else max(0, size - int(last))
                end = min(end, int(last)) if first and last else end
            else:
                start = size
            if start > end:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        self.send_response(HTTPStatus.PARTIAL_CONTENT if requested is not None else HTTPStatus.OK)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Content-Type", MIME[target.suffix])
        self.send_header("X-Content-Type-Options", "nosniff")
        remaining = end - start + 1
        self.send_header("Content-Length", str(remaining))
        if requested is not None:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if not head:
            with target.open("rb") as stream:
                stream.seek(start)
                try:
                    while remaining:
                        chunk = stream.read(min(remaining, 64 * 1024))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    # Browsers cancel an earlier range when the user seeks.
                    return

    def json_response(self, status, value, *, head=False):
        started = perf_counter()
        raw = json.dumps(
            value, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
        if self._server_timing:
            self._server_timing["encode"] = (perf_counter() - started) * 1000
        self.payload(status, raw, head=head)

    def do_HEAD(self):
        self.serve_get(head=True)

    def do_GET(self):
        self.serve_get(head=False)

    def redirect(self, location):
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def serve_get(self, *, head):
        url = urlsplit(self.path)
        path = url.path
        player = BODY_PREFIX + "player.html"
        if path in {BODY_PREFIX[:-1], BODY_PREFIX, BODY_PREFIX + "index.html"} or (
            path == player and self.headers.get("Sec-Fetch-Dest") == "document"
        ):
            options = [(k, v) for k, v in parse_qsl(url.query) if k in {"case", "demo", "lang"}]
            return self.redirect(WORKSPACE_URL + ("&" + urlencode(options) if options else ""))
        if path == PREFIX[:-1]:
            return self.redirect(PREFIX)
        if path == "/":
            path = "/index.html"
        if match := MOTION_CACHE.fullmatch(path):
            target = BODY / "motion-cache" / (match.group(1) + ".json.gz")
            if not target.is_file():
                return self.json_response(404, {"error": "此案例缓存尚未生成。"}, head=head)
            encoding = cache_encoding(self.headers.get("Accept-Encoding", ""))
            if encoding is None:
                return self.json_response(406, {"error": "客户端不接受此缓存可用的传输格式。"}, head=head)
            use_gzip = encoding == "gzip"
            try:
                raw = checked_motion_cache(target, match.group(1), use_gzip=use_gzip)
            except (OSError, EOFError, ValueError, zlib.error):
                return self.json_response(503, {"error": "案例缓存损坏，请重新生成。"}, head=head)
            return self.payload(
                200, raw, head=head,
                cache_control="private, max-age=31536000, immutable",
                content_encoding="gzip" if use_gzip else None,
                etag=f'W/"{match.group(1)}"',
            )
        if path == "/api/model":
            return self.json_response(200, model_info(), head=head)
        if path == "/api/fullbody/model":
            if not FULLBODY_LOCK.acquire(timeout=0.1):
                return self.json_response(429, {"error": "全身模型正在计算，请稍后重试。"}, head=head)
            try:
                result = body_module("native_bridge").call("model")
                return self.json_response(200, result, head=head)
            except Exception as exc:  # noqa: BLE001 -- isolate and report native loader failures.
                import traceback

                traceback.print_exc()
                version_changed = isinstance(exc, ValueError) and "代码版本已改变" in str(exc)
                return self.json_response(
                    409 if version_changed else 503,
                    {"error": str(exc) if version_changed else "D 盘全身模型未能加载，请查看本机服务日志。"},
                    head=head,
                )
            finally:
                FULLBODY_LOCK.release()
        if path == "/api/body/model":
            try:
                with BODY_LOCK:
                    result = body_module("engine").model_info()
                return self.json_response(200, result, head=head)
            except Exception:  # noqa: BLE001 -- report native loader failures to the UI.
                import traceback

                traceback.print_exc()
                return self.json_response(
                    503,
                    {"error": "全身模型尚不可用，请使用已有 OpenSim 环境启动服务。"},
                    head=head,
                )
        if path in SITE_FILES or SITE_ASSET.fullmatch(path):
            # Resolve the trusted parent separately so junctions inside the
            # build (including dist itself) cannot serve other project files.
            target = SITE.parent.resolve() / SITE.name / path.lstrip("/")
            if target.resolve() != target:
                return self.json_response(404, {"error": "此路径不属于本机网站。"}, head=head)
            if path == "/index.html" and not target.is_file():
                return self.payload(
                    503, "主站尚未构建。请在 BodyVista 目录运行 npm ci 和 npm run build，然后刷新。".encode(),
                    "text/plain; charset=utf-8", head=head,
                )
        elif path == player:
            # The public host puts the replay here; on this origin the very
            # same atlas iframe opens the editor backed by the local APIs.
            target = BODY / "index.html"
        elif (
            path.startswith(BODY_PREFIX)
            and (name := path[len(BODY_PREFIX) :]) in BODY_STATIC
        ):
            target = BODY / name
        elif path == "/api/demo":
            target = LAB / "demo.json"
        elif (
            path.startswith(PREFIX)
            and (name := path[len(PREFIX) :] or "index.html") in STATIC
        ):
            target = LAB / name
        elif (
            path.startswith("/src/vendor/")
            and (name := path[len("/src/vendor/") :]) in VENDOR
        ):
            target = REPO / "src" / "vendor" / name
        elif (match := ASSETS.fullmatch(path)) and match.group(
            1
        ) in allowed_atlas_ids():
            target = REPO / path.lstrip("/")
        else:
            return self.json_response(
                404, {"error": "此路径不属于本机网站。"}, head=head
            )
        if not target.is_file():
            return self.json_response(404, {"error": "该资源尚未生成。"}, head=head)
        if target.suffix in {".webm", ".mp4", ".bin", ".glb"}:
            return self.file_response(target, head=head)
        self.payload(
            200,
            target.read_bytes(),
            MIME.get(target.suffix, "application/octet-stream"),
            head=head,
        )

    def do_POST(self):
        self._server_timing = {
            "headers": (perf_counter() - self._connection_started) * 1000
        }
        path = urlsplit(self.path).path
        is_body = path in {"/api/body/pose", "/api/body/ik", "/api/body/solve"}
        is_fullbody = path in {
            "/api/fullbody/pose",
            "/api/fullbody/ik",
            "/api/fullbody/rotate",
            "/api/fullbody/grasp",
            "/api/fullbody/solve",
        }
        if path != "/api/solve" and not is_body and not is_fullbody:
            return self.json_response(404, {"error": "未知求解接口。"})
        # Browsers on other websites must not be able to enqueue local solver work.
        host = self.headers.get("Host", "")
        allowed = {
            f"127.0.0.1:{self.server.server_port}",
            f"localhost:{self.server.server_port}",
        }
        origin = self.headers.get("Origin")
        if host not in allowed or (origin and origin != f"http://{host}"):
            return self.json_response(403, {"error": "仅接受本机实验页面的请求。"})
        if self.headers.get_content_type() != "application/json":
            return self.json_response(415, {"error": "请输入 JSON 格式的实验卡。"})
        try:
            read_started = perf_counter()
            size = int(self.headers.get("Content-Length", "-1"))
            if not 1 <= size <= (262144 if is_fullbody else 65536 if is_body else 8192):
                return self.json_response(413, {"error": "实验卡为空或超过大小限制。"})
            scene = json.loads(
                self.rfile.read(size),
                parse_float=finite_float,
                parse_constant=finite_float,
            )
            self._server_timing["body"] = (perf_counter() - read_started) * 1000
        except (ValueError, UnicodeDecodeError, RecursionError):
            return self.json_response(400, {"error": "实验卡 JSON 无法读取。"})
        if not isinstance(scene, dict):
            return self.json_response(422, {"error": "实验卡必须是 JSON 对象。"})
        if is_fullbody:
            native_lock = FULLBODY_LOCK
            lock_started = perf_counter()
            if not native_lock.acquire(timeout=0.1):
                return self.json_response(
                    429, {"error": "全身模型正在计算，请稍后重试。"}
                )
            self._server_timing["lock"] = (perf_counter() - lock_started) * 1000
            try:
                native_started = perf_counter()
                result = body_module("native_bridge").call(
                    path.rsplit("/", 1)[-1], scene, timing=self._server_timing
                )
                self._server_timing["native"] = (perf_counter() - native_started) * 1000
                return self.json_response(200, result)
            except (ValueError, TypeError, KeyError) as exc:
                return self.json_response(422, {"error": str(exc)})
            except Exception:  # noqa: BLE001 -- one native failure must not lose the HTTP reply.
                import traceback

                traceback.print_exc()
                return self.json_response(
                    500, {"error": "全身求解失败，本次不显示定量肌力。"}
                )
            finally:
                native_lock.release()
        if is_body:
            if not BODY_LOCK.acquire(timeout=0.1):
                return self.json_response(
                    429, {"error": "全身模型正在计算，请稍后重试。"}
                )
            try:
                engine = body_module("engine")
                if path == "/api/body/pose":
                    result = engine.pose(scene.get("q", {}))
                elif path == "/api/body/ik":
                    result = engine.ik(scene)
                else:
                    result = body_module("solver").solve(scene)
                return self.json_response(200, result)
            except (ValueError, TypeError, KeyError) as exc:
                return self.json_response(422, {"error": str(exc)})
            except Exception:  # noqa: BLE001 -- isolate native solver failures per request.
                import traceback

                traceback.print_exc()
                return self.json_response(
                    500, {"error": "全身求解失败，本次不显示定量肌力。"}
                )
            finally:
                BODY_LOCK.release()
        if not LOCK.acquire(blocking=False):
            return self.json_response(
                429, {"error": "已有两次实验正在计算，请稍后重试。"}
            )
        try:
            result = solve(scene)
        except ScenarioError as exc:
            return self.json_response(422, {"error": str(exc)})
        except Exception:  # noqa: BLE001 -- one failed request must not drop the HTTP response.
            import traceback

            traceback.print_exc()
            return self.json_response(
                500, {"error": "求解器异常，本次没有生成定量曲线。"}
            )
        finally:
            LOCK.release()
        self.json_response(200, result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=4192)
    port = parser.parse_args().port
    body_module("runtime_performance").configure_process_qos(interactive=True)
    with ThreadingHTTPServer(("127.0.0.1", port), LabHandler) as server:
        print(f"BodyVista · http://127.0.0.1:{port}{WORKSPACE_URL}", flush=True)
        server.serve_forever()
