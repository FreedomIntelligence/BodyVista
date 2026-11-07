"""Small regression checks; these never import or run the production model."""

import _thread
import ctypes as C
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

import refresh_library as refresh
from resource_guard import run_guarded, windows_api


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=refresh.HERE)
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_unready_never_starts_a_solve(self):
        marker = self.root / "ready.json"
        refresh.write(marker, {"ready": False})
        with self.assertRaisesRegex(RuntimeError, "尚未冻结"):
            refresh.ready_identity(marker)

    def test_ready_marker_change_is_rejected(self):
        marker = self.root / "ready.json"
        value = {"ready": True, "MODEL_ID": "test", "modelSha256": "m", "computationSha256": "c"}
        refresh.write(marker, value)
        digest = refresh.sha(marker)
        self.assertEqual(refresh.ready_identity(marker, digest)["model"], "test")
        refresh.write(marker, {**value, "computationSha256": "changed"})
        with self.assertRaisesRegex(RuntimeError, "就绪记录发生变化"):
            refresh.ready_identity(marker, digest)

    def test_source_and_result_tampering_is_rejected(self):
        artifact = self.root / "result.json"
        artifact.write_text("original", encoding="utf-8")
        expected = refresh.snapshot([artifact])
        refresh.check_snapshot(expected)
        artifact.write_text("different", encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "拒绝继续或发布"):
            refresh.check_snapshot(expected)

    def test_original_library_is_complete(self):
        cases = refresh.original_cases()
        self.assertEqual(set(cases), set(refresh.CASE_IDS))
        self.assertEqual(sum(row[1]["verification"]["frames"] for row in cases.values()), 803)


@unittest.skipUnless(os.name == "nt", "Windows resource isolation")
class WindowsGuardTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=refresh.HERE)
        self.root = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def worker(self, body):
        script = self.root / "dummy.py"
        script.write_text("import sys\nsys.path.insert(0, " + repr(str(refresh.HERE)) + ")\n"
                          "from resource_guard import worker_gate\nworker_gate()\n" + body,
                          encoding="utf-8")
        return [str(refresh.PYTHON), "-B", "-X", "utf8", str(script)]

    def assert_process_exited(self, pid):
        kernel = windows_api()
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:  # The process object was already reclaimed.
            return
        try:
            code = W.DWORD()
            self.assertTrue(kernel.GetExitCodeProcess(handle, C.byref(code)))
            self.assertNotEqual(code.value, 259)  # STILL_ACTIVE
        finally:
            kernel.CloseHandle(handle)

    def test_actual_venv_worker_gets_single_core_and_memory_cap(self):
        output = self.root / "proof.json"
        command = self.worker(
            "import ctypes as C, json, os\n"
            "from resource_guard import windows_api\n"
            "k=windows_api(); h=k.OpenProcess(0x400, False, os.getpid())\n"
            "a=C.c_size_t(); b=C.c_size_t(); k.GetProcessAffinityMask(h,C.byref(a),C.byref(b))\n"
            "limited=False\n"
            "try:\n blob=bytearray(192*1024*1024)\n"
            "except MemoryError:\n limited=True\n"
            f"open({str(output)!r},'w').write(json.dumps({{'mask':a.value,'limited':limited,'priority':k.GetPriorityClass(h)}}))\n"
        )
        stats = run_guarded(command, self.root / "tmp", timeout=15, memory_mib=64)
        proof = json.loads(output.read_text())
        self.assertEqual(proof["mask"].bit_count(), 1)
        self.assertTrue(proof["limited"])
        self.assertEqual(proof["priority"], 0x4000)
        self.assertEqual(stats["cpuMask"], proof["mask"])
        self.assertEqual(stats["priorityClass"], proof["priority"])
        self.assertGreater(stats["peakJobCommittedMiB"], 0)
        self.assertLessEqual(stats["peakJobCommittedMiB"], 64)
        self.assertGreaterEqual(stats["minAvailableMiB"], 4096)
        self.assert_process_exited(stats["pid"])

    def test_timeout_kills_only_owned_worker(self):
        pid_file = self.root / "actual-worker.pid"
        command = self.worker(f"import time,os\nopen({str(pid_file)!r},'w').write(str(os.getpid()))\ntime.sleep(30)\n")
        with self.assertRaisesRegex(RuntimeError, "超过 1 秒"):
            run_guarded(command, self.root / "tmp", timeout=1, memory_mib=64)
        self.assert_process_exited(int(pid_file.read_text()))
        self.assertFalse(list((self.root / "tmp").glob(".worker-*.pid")))

    def test_keyboard_interrupt_does_not_kill_unrelated_process(self):
        pid_file = self.root / "actual-worker.pid"
        command = self.worker(f"import time,os\nopen({str(pid_file)!r},'w').write(str(os.getpid()))\ntime.sleep(30)\n")
        # The base executable avoids a second venv launcher in this control process.
        control = subprocess.Popen([sys._base_executable, "-c", "import time; time.sleep(30)"],
                                   creationflags=subprocess.CREATE_NO_WINDOW)
        timer = threading.Timer(1.0, _thread.interrupt_main)
        try:
            timer.start()
            with self.assertRaises(KeyboardInterrupt):
                run_guarded(command, self.root / "tmp", timeout=10, memory_mib=64)
            self.assert_process_exited(int(pid_file.read_text()))
            self.assertIsNone(control.poll())
        finally:
            timer.cancel()
            timer.join()
            control.kill()
            control.wait(timeout=10)

    def test_low_memory_guard_refuses_start(self):
        command = self.worker("raise AssertionError('must never run')\n")
        with self.assertRaisesRegex(RuntimeError, "可用内存不足"):
            run_guarded(command, self.root / "tmp", free_mib=10 ** 9)


if __name__ == "__main__":
    unittest.main()
