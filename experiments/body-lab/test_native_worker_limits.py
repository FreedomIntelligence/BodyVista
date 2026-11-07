"""Exercise native worker admission and shutdown with idle Python test processes."""
import ctypes
import importlib
import importlib.util
import io
import os
import sys
import tempfile
import time
import unittest
from contextlib import contextmanager
from email.message import Message
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
if str(HERE.parent) not in sys.path:
    sys.path.insert(0, str(HERE.parent))
BRIDGE = importlib.import_module("body-lab.native_bridge")


def _server():
    spec = importlib.util.spec_from_file_location("bodyvista_test_server", HERE.parent/"elbow-lab/server.py")
    mod = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"engine": SimpleNamespace(model_info=dict),
                                  "solver": SimpleNamespace(ScenarioError=ValueError, solve=lambda scene: {})}):
        spec.loader.exec_module(mod)
    return mod


@contextmanager
def _worker_directory():
    directory = tempfile.TemporaryDirectory()
    try:
        yield Path(directory.name)
    finally:
        # Process handles are checked for termination in the test itself.
        # Windows can briefly retain the log file after every process exited.
        deadline = time.monotonic()+2.
        while True:
            try:
                directory.cleanup()
                break
            except PermissionError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.025)


class WorkerLimitsTests(unittest.TestCase):
    def test_loading_model_and_posting_solve_are_mutually_exclusive(self):
        server = _server()
        statuses = []
        response = lambda status, value, **kwargs: statuses.append(status)
        get = SimpleNamespace(path="/api/fullbody/model", json_response=response)
        def post():
            headers = Message()
            headers["Host"], headers["Content-Length"], headers["Content-Type"] = "localhost:4192", "2", "application/json"
            req = SimpleNamespace(path="/api/fullbody/solve", headers=headers,
                rfile=io.BytesIO(b"{}"), server=SimpleNamespace(server_port=4192), _connection_started=time.perf_counter(),
                json_response=response)
            server.LabHandler.do_POST(req)
        def solve(*args, **kwargs):
            server.LabHandler.serve_get(get, head=False)
            return {}
        with patch.object(server, "body_module", return_value=SimpleNamespace(call=solve)) as loader:
            post()
        self.assertEqual(statuses, [429, 200])
        self.assertEqual(loader.call_count, 1)
        statuses.clear()
        def model(*args, **kwargs):
            post()
            return {}
        with patch.object(server, "body_module", return_value=SimpleNamespace(call=model)) as loader:
            server.LabHandler.serve_get(get, head=True)
        self.assertEqual(statuses, [429, 200])
        self.assertEqual(loader.call_count, 1)
        self.assertFalse(server.FULLBODY_LOCK.locked())

    @unittest.skipUnless(os.name == "nt", "Windows launcher and Job Object integration")
    def test_low_memory_stops_real_interpreter_and_descendants_and_allows_restart(self):
        from ctypes import wintypes as W
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.OpenProcess.argtypes, k.OpenProcess.restype = [W.DWORD, W.BOOL, W.DWORD], W.HANDLE
        k.WaitForSingleObject.argtypes, k.WaitForSingleObject.restype = [W.HANDLE, W.DWORD], W.DWORD
        k.CloseHandle.argtypes = [W.HANDLE]
        k.TerminateProcess.argtypes = [W.HANDLE, W.UINT]
        # One verified interpreter and one real descendant stay idle while the
        # bridge's memory monitor aborts their long request.
        fixture = (
            "import json,os,subprocess,sys,time\n"
            f"sys.path.insert(0,{str(HERE)!r})\n"
            "from runtime_performance import limit_worker_cpu\n"
            "limit_worker_cpu()\n"
            "child=subprocess.Popen([sys.executable,'-u','-c','import os,time;print(os.getpid(),flush=True);time.sleep(40)'],"
            "stdout=subprocess.PIPE,text=True,creationflags=subprocess.CREATE_NO_WINDOW)\n"
            "ids=[os.getpid(),int(child.stdout.readline())]\n"
            "for line in sys.stdin:\n"
            " msg=json.loads(line)\n"
            " if msg['method']=='solve' and not msg['payload'].get('quick'): time.sleep(40)\n"
            " print('BODYVISTA_REPLY '+json.dumps({'id':msg['id'],'result':ids}),flush=True)\n"
        )
        def handles(pids):
            result = [k.OpenProcess(0x00100001, False, pid) for pid in pids]
            self.assertTrue(all(result))
            return result
        worker = BRIDGE.NativeWorker("limits-test")
        opened = []
        with _worker_directory() as root:
            (root/"native_worker.py").write_text(fixture, encoding="utf-8")
            with (patch.object(BRIDGE, "REPO", root), patch.object(BRIDGE, "HERE", root),
                  patch.object(BRIDGE, "WORKER", worker),
                  patch.dict(os.environ, {"BODYVISTA_NATIVE_PYTHON": sys.executable})):
                try:
                    initial = BRIDGE.call("model")
                    opened.extend(handles(initial))
                    self.assertTrue(all(k.WaitForSingleObject(h, 0) == 258 for h in opened))
                    self.assertEqual(BRIDGE.call("pose"), initial)
                    with patch.object(BRIDGE, "available_memory_bytes", return_value=8*1024**3):
                        self.assertEqual(BRIDGE.call("solve", {"quick": True}), initial)
                    with (patch.object(BRIDGE, "available_memory_bytes", side_effect=[8*1024**3, 3*1024**3]),
                          self.assertRaisesRegex(RuntimeError, "4 GiB")):
                        BRIDGE.call("solve")
                    self.assertIsNone(worker.process)
                    self.assertTrue(all(k.WaitForSingleObject(h, 0) == 0 for h in opened))
                    fresh = worker.call("pose")
                    self.assertNotEqual(fresh[0], initial[0])
                    opened.extend(handles(fresh))
                    worker.stop()
                    self.assertTrue(all(k.WaitForSingleObject(h, 0) == 0 for h in opened))
                finally:
                    for handle in opened:
                        if k.WaitForSingleObject(handle, 0) == 258:
                            k.TerminateProcess(handle, 1)
                            k.WaitForSingleObject(handle, 2000)
                        k.CloseHandle(handle)
                    worker.stop()


if __name__ == "__main__":
    unittest.main()

