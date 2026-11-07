"""Windows-only resource limits for this batch's own gated Python worker."""

import ctypes as C
from ctypes import wintypes as W
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

MIB = 1024 ** 2


class MemoryStatus(C.Structure):
    _fields_ = [("length", W.DWORD), ("load", W.DWORD)] + [
        (name, C.c_ulonglong) for name in
        ("total", "available", "page_total", "page_available", "virtual_total",
         "virtual_available", "extended")]


class BasicLimit(C.Structure):
    _fields_ = [("process_time", C.c_longlong), ("job_time", C.c_longlong),
                ("flags", W.DWORD), ("min_working", C.c_size_t),
                ("max_working", C.c_size_t), ("active_processes", W.DWORD),
                ("affinity", C.c_size_t), ("priority", W.DWORD),
                ("scheduling", W.DWORD)]


class IOCount(C.Structure):
    _fields_ = [(name, C.c_ulonglong) for name in
                ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]


class ExtendedLimit(C.Structure):
    _fields_ = [("basic", BasicLimit), ("io", IOCount)] + [
        (name, C.c_size_t) for name in
        ("process_memory", "job_memory", "peak_process_memory", "peak_job_memory")]


class ProcessMemory(C.Structure):
    _fields_ = [("size", W.DWORD), ("page_faults", W.DWORD)] + [
        (name, C.c_size_t) for name in
        ("peak_working", "working", "peak_paged", "paged", "peak_nonpaged", "nonpaged",
         "pagefile", "peak_pagefile", "private")]


def windows_api():
    if os.name != "nt":
        raise RuntimeError("This batch requires its Windows resource guard; no unrestricted fallback.")
    kernel = C.WinDLL("kernel32", use_last_error=True)
    signatures = {
        "CreateJobObjectW": ([C.c_void_p, W.LPCWSTR], W.HANDLE),
        "SetInformationJobObject": ([W.HANDLE, C.c_int, C.c_void_p, W.DWORD], W.BOOL),
        "QueryInformationJobObject": ([W.HANDLE, C.c_int, C.c_void_p, W.DWORD, C.POINTER(W.DWORD)], W.BOOL),
        "AssignProcessToJobObject": ([W.HANDLE, W.HANDLE], W.BOOL),
        "OpenProcess": ([W.DWORD, W.BOOL, W.DWORD], W.HANDLE),
        "GetProcessAffinityMask": ([W.HANDLE, C.POINTER(C.c_size_t), C.POINTER(C.c_size_t)], W.BOOL),
        "SetProcessAffinityMask": ([W.HANDLE, C.c_size_t], W.BOOL),
        "SetPriorityClass": ([W.HANDLE, W.DWORD], W.BOOL),
        "GetPriorityClass": ([W.HANDLE], W.DWORD),
        "GetExitCodeProcess": ([W.HANDLE, C.POINTER(W.DWORD)], W.BOOL),
        "GlobalMemoryStatusEx": ([C.POINTER(MemoryStatus)], W.BOOL),
        "CloseHandle": ([W.HANDLE], W.BOOL),
        "TerminateProcess": ([W.HANDLE, W.UINT], W.BOOL),
        "K32GetProcessMemoryInfo": ([W.HANDLE, C.POINTER(ProcessMemory), W.DWORD], W.BOOL),
    }
    for name, (arguments, result) in signatures.items():
        function = getattr(kernel, name)
        function.argtypes, function.restype = arguments, result
    return kernel


def checked(value):
    if not value:
        raise C.WinError(C.get_last_error())
    return value


def available_memory(kernel):
    status = MemoryStatus(length=C.sizeof(MemoryStatus))
    checked(kernel.GlobalMemoryStatusEx(C.byref(status)))
    return status.available


def worker_gate():
    """Block before NumPy/MuJoCo imports until the parent installs limits.

    The venv Python executable can launch a second interpreter on Windows, so
    report the actual interpreter PID instead of assuming Popen.pid is it.
    """
    path = os.environ.get("BODYVISTA_BATCH_GATE")
    if not path:
        raise RuntimeError("Workers must be launched through the guarded parent.")
    Path(path).write_text(str(os.getpid()), encoding="ascii")
    if sys.stdin.readline().strip() != "GO":
        raise RuntimeError("Parent did not grant the bounded worker a start token.")


def run_guarded(command, directory, *, timeout=900, memory_mib=1536, free_mib=4096):
    """Run one child; abort only this job on low memory, timeout, or cancellation."""
    kernel = windows_api()
    if available_memory(kernel) < free_mib * MIB:
        raise RuntimeError(f"可用内存不足 {free_mib} MiB，本批次未启动；稍后重试可续算。")
    directory = Path(directory).resolve()
    if directory.drive.lower() != "d:":
        raise RuntimeError("Batch logs and temporary files must be on D:.")
    directory.mkdir(parents=True, exist_ok=True)
    gate = directory / (".worker-" + uuid.uuid4().hex + ".pid")
    environment = dict(os.environ, BODYVISTA_BATCH_GATE=str(gate),
                       TEMP=str(directory), TMP=str(directory), PYTHONDONTWRITEBYTECODE="1")
    for name in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS",
                 "NUMEXPR_NUM_THREADS", "BLIS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
        environment[name] = "1"
    job = checked(kernel.CreateJobObjectW(None, None))
    process_handle = None
    child = None
    began = time.monotonic()
    stats = {"peakWorkingMiB": 0, "peakPrivateMiB": 0,
             "minAvailableMiB": available_memory(kernel) / MIB}
    try:
        limit = ExtendedLimit()
        # Per-process and total job commitment limits; kill descendants on close.
        limit.basic.flags = 0x100 | 0x200 | 0x2000
        limit.process_memory = limit.job_memory = int(memory_mib * MIB)
        checked(kernel.SetInformationJobObject(job, 9, C.byref(limit), C.sizeof(limit)))
        child = subprocess.Popen(command, stdin=subprocess.PIPE, env=environment,
                                 creationflags=subprocess.CREATE_NO_WINDOW,
                                 text=True, encoding="utf-8")
        while not gate.exists():
            if child.poll() is not None or time.monotonic() - began > 20:
                raise RuntimeError("Bounded worker did not reach its startup gate.")
            time.sleep(0.05)
        # The file is created before write_text completes; tolerate that brief gap.
        pid_text = gate.read_text("ascii").strip()
        while not pid_text:
            if child.poll() is not None or time.monotonic() - began > 20:
                raise RuntimeError("Worker startup PID was not written.")
            time.sleep(0.01)
            pid_text = gate.read_text("ascii").strip()
        process_handle = checked(kernel.OpenProcess(0x0100 | 0x0200 | 0x0400 | 0x0010 | 0x0001,
                                                     False, int(pid_text)))
        checked(kernel.AssignProcessToJobObject(job, process_handle))
        allowed, system = C.c_size_t(), C.c_size_t()
        checked(kernel.GetProcessAffinityMask(process_handle, C.byref(allowed), C.byref(system)))
        cpu_mask = allowed.value & -allowed.value  # one allowed CPU; avoid pinning to the last efficiency core
        checked(kernel.SetProcessAffinityMask(process_handle, cpu_mask))
        checked(kernel.SetPriorityClass(process_handle, 0x4000))  # BELOW_NORMAL_PRIORITY_CLASS
        stats.update(pid=int(pid_text), cpuMask=cpu_mask, memoryLimitMiB=memory_mib,
                     priority="below-normal", priorityClass=kernel.GetPriorityClass(process_handle),
                     numericThreadLimit=1, freeMemoryStopMiB=free_mib, wallCapSeconds=timeout)
        child.stdin.write("GO\n")
        child.stdin.close()
        while child.poll() is None:
            available = available_memory(kernel) / MIB
            stats["minAvailableMiB"] = min(stats["minAvailableMiB"], available)
            memory = ProcessMemory(size=C.sizeof(ProcessMemory))
            if kernel.K32GetProcessMemoryInfo(process_handle, C.byref(memory), C.sizeof(memory)):
                stats["peakWorkingMiB"] = max(stats["peakWorkingMiB"], memory.peak_working / MIB)
                stats["peakPrivateMiB"] = max(stats["peakPrivateMiB"], memory.private / MIB)
            if available < free_mib:
                raise RuntimeError("可用内存触及保护阈值，本案例已中止；已完成案例保留。")
            if time.monotonic() - began > timeout:
                raise RuntimeError(f"本案例超过 {timeout} 秒限制，已中止；已完成案例保留。")
            time.sleep(0.5)
        stats["seconds"] = time.monotonic() - began
        final_limits = ExtendedLimit()
        checked(kernel.QueryInformationJobObject(job, 9, C.byref(final_limits),
                                                 C.sizeof(final_limits), None))
        stats["peakJobCommittedMiB"] = final_limits.peak_job_memory / MIB
        stats["peakProcessCommittedMiB"] = final_limits.peak_process_memory / MIB
        if child.returncode:
            raise RuntimeError(f"Bounded worker exited with code {child.returncode}; no case accepted.")
        return stats
    finally:
        # EOF releases even a worker whose assignment failed before the job
        # acquired it; the venv launcher PID is not necessarily that worker.
        if child is not None and child.stdin is not None and not child.stdin.closed:
            child.stdin.close()
        if process_handle:
            kernel.TerminateProcess(process_handle, 1)
        # Closing this unshared job only terminates this worker and its descendants.
        kernel.CloseHandle(job)
        if process_handle:
            kernel.CloseHandle(process_handle)
        if child is not None and child.poll() is None:
            child.kill()
            child.wait(timeout=10)
        gate.unlink(missing_ok=True)
