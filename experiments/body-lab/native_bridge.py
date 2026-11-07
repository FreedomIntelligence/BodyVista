"""Run the expanded model in its D-drive environment, separate from OpenSim."""

import atexit
import json
import os
import queue
import subprocess
import threading
from pathlib import Path
from time import monotonic, perf_counter

from .runtime_performance import (
    WORKER_JOB_ENV,
    WindowsWorkerJob,
    available_memory_bytes,
)

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
PREFIX = "BODYVISTA_REPLY "


class NativeWorker:
    def __init__(self, name="edit"):
        self.name = name
        self.process = None
        self.responses = queue.Queue()
        self.lock = threading.Lock()
        self.sequence = 0
        self.log = None
        self.job = None

    def stop(self):
        process, self.process = self.process, None
        job, self.job = self.job, None
        try:
            if job is not None:
                job.stop()
        finally:
            if process is not None:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=4)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=4)
                for stream in (process.stdin, process.stdout):
                    if stream:
                        stream.close()
            if self.log:
                self.log.close()
                self.log = None

    def start(self):
        if self.process is not None and self.process.poll() is None:
            return
        self.stop()
        default_python = REPO / (".venv-fullbody/Scripts/python.exe" if os.name == "nt" else ".venv-fullbody/bin/python")
        executable = Path(os.environ.get("BODYVISTA_NATIVE_PYTHON", default_python))
        if not executable.is_file():
            raise RuntimeError("未找到全身模型的 Python 环境；请按安装说明准备 .venv-fullbody 或设置 BODYVISTA_NATIVE_PYTHON。")
        logs = REPO / ".runtime-cache/logs"
        logs.mkdir(parents=True, exist_ok=True)
        self.log = (logs / f"fullbody-{self.name}-worker.log").open(
            "a", encoding="utf-8"
        )
        self.responses = queue.Queue()
        temporary = REPO / ".runtime-cache/tmp"
        temporary.mkdir(parents=True, exist_ok=True)
        environment = {
            **os.environ,
            "TEMP": str(temporary),
            "TMP": str(temporary),
            "PIP_CACHE_DIR": str(REPO / ".runtime-cache/pip"),
        }
        environment.update(OPENBLAS_NUM_THREADS="1", OMP_NUM_THREADS="1", MKL_NUM_THREADS="1",
                           BLIS_NUM_THREADS="1", NUMEXPR_NUM_THREADS="1", VECLIB_MAXIMUM_THREADS="1")
        try:
            if os.name == "nt":
                self.job = WindowsWorkerJob()
                environment[WORKER_JOB_ENV] = self.job.name
            self.process = subprocess.Popen(
                [str(executable), "-X", "utf8", "-u", str(HERE / "native_worker.py"), self.name],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.log, text=True,
                encoding="utf-8", cwd=REPO, env=environment,
                creationflags=(getattr(subprocess, "CREATE_NO_WINDOW", 0) |
                               getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)),
            )
            if self.job is not None:
                self.job.assign_launcher(self.process)
        except OSError:
            self.stop()
            raise
        process, replies = self.process, self.responses

        def read_responses():
            try:
                for line in process.stdout:
                    if line.startswith(PREFIX):
                        try:
                            replies.put(json.loads(line[len(PREFIX) :]))
                        except ValueError:
                            replies.put({"error": "原生工作进程返回了无效响应。"})
                replies.put({"error": "原生工作进程已退出。"})
            except (OSError, ValueError):
                replies.put({"error": "原生工作进程连接已关闭。"})

        threading.Thread(target=read_responses, daemon=True).start()

    def call(self, method, payload=None, *, timing=None):
        started = perf_counter()
        with self.lock:
            if timing is not None:
                timing["worker_lock"] = (perf_counter() - started) * 1000
            if method == "solve" and available_memory_bytes() < 4 * 1024**3:
                raise RuntimeError("可用内存不足 4 GiB，本次计算没有启动。请稍后重试。")
            self.start()
            self.sequence += 1
            request_id = self.sequence
            try:
                self.process.stdin.write(
                    json.dumps(
                        {"id": request_id, "method": method, "payload": payload or {}},
                        ensure_ascii=False,
                        allow_nan=False,
                    )
                    + "\n"
                )
                self.process.stdin.flush()
                deadline = monotonic() + 300
                while True:
                    try:
                        response = self.responses.get(timeout=min(1.,max(0.,deadline-monotonic())))
                        break
                    except queue.Empty:
                        if monotonic() >= deadline:
                            raise
                        if method == "solve" and available_memory_bytes() < 4*1024**3:
                            raise RuntimeError("计算已停止以保留 4 GiB 可用内存；本次没有返回力值。")
                if timing is not None:
                    timing.update(response.get("timing", {}))
                if response.get("id") != request_id:
                    raise RuntimeError(
                        response.get("error", "原生工作进程响应顺序不符。")
                    )
                if response.get("kind") == "input-error":
                    raise ValueError(response["error"])
                if "error" in response:
                    raise RuntimeError(response["error"])
                return response["result"]
            except queue.Empty as exc:
                self.stop()
                raise RuntimeError(
                    "全身计算超过 5 分钟，本次结果未生成。请缩短动作后重试。"
                ) from exc
            except (OSError, RuntimeError):
                self.stop()
                raise


WORKER = NativeWorker("shared")
atexit.register(WORKER.stop)


def call(method, payload=None, *, timing=None):
    return WORKER.call(method, payload, timing=timing)
