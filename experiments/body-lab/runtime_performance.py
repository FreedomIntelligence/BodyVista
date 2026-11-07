"""Keep the local interactive processes responsive on Windows hybrid CPUs."""

import os
import sys
import time
import uuid
import warnings

WORKER_JOB_ENV = "BODYVISTA_NATIVE_JOB_NAME"


def _job_api():
    import ctypes
    from ctypes import wintypes as W

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    specs = {
        "CreateJobObjectW": ([ctypes.c_void_p, W.LPCWSTR], W.HANDLE),
        "OpenJobObjectW": ([W.DWORD, W.BOOL, W.LPCWSTR], W.HANDLE),
        "GetCurrentProcess": ([], W.HANDLE),
        "IsProcessInJob": ([W.HANDLE, W.HANDLE, ctypes.POINTER(W.BOOL)], W.BOOL),
        "AssignProcessToJobObject": ([W.HANDLE, W.HANDLE], W.BOOL),
        "SetInformationJobObject": ([W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD], W.BOOL),
        "QueryInformationJobObject": ([W.HANDLE, ctypes.c_int, ctypes.c_void_p, W.DWORD, ctypes.c_void_p], W.BOOL),
        "TerminateJobObject": ([W.HANDLE, W.UINT], W.BOOL),
        "CloseHandle": ([W.HANDLE], W.BOOL),
    }
    for name, (args, result) in specs.items():
        fn = getattr(kernel, name)
        fn.argtypes, fn.restype = args, result
    return kernel


def _checked(value):
    import ctypes
    if not value:
        raise ctypes.WinError(ctypes.get_last_error())
    return value


def _join_job(kernel, job, process):
    import ctypes
    from ctypes import wintypes as W
    already_member = W.BOOL()
    _checked(kernel.IsProcessInJob(process, job, ctypes.byref(already_member)))
    if not already_member.value:
        _checked(kernel.AssignProcessToJobObject(job, process))


class WindowsWorkerJob:
    """Own the launcher, native Python interpreter and their descendants."""

    def __init__(self):
        import ctypes
        from ctypes import wintypes as W

        class BasicLimit(ctypes.Structure):
            _fields_ = [("processTime", ctypes.c_int64), ("jobTime", ctypes.c_int64), ("flags", W.DWORD),
                        ("minWorkingSet", ctypes.c_size_t), ("maxWorkingSet", ctypes.c_size_t),
                        ("activeProcessLimit", W.DWORD), ("affinity", ctypes.c_size_t),
                        ("priority", W.DWORD), ("scheduling", W.DWORD)]

        class ExtendedLimit(ctypes.Structure):
            _fields_ = [("basic", BasicLimit), ("ioCounters", ctypes.c_uint64*6),
                        ("memoryLimitsAndPeaks", ctypes.c_size_t*4)]

        self.name = "Local\\BodyVista-native-"+uuid.uuid4().hex
        self.kernel = _job_api()
        self.handle = _checked(self.kernel.CreateJobObjectW(None, self.name))
        try:
            limits = ExtendedLimit()
            limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            _checked(self.kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
        except OSError:
            self.kernel.CloseHandle(self.handle)
            raise

    def assign_launcher(self, process):
        _join_job(self.kernel, self.handle, int(process._handle))

    def stop(self, timeout=4.):
        if not self.handle:
            return
        import ctypes
        from ctypes import wintypes as W

        class Accounting(ctypes.Structure):
            _fields_ = [("times", ctypes.c_int64*4), ("pageFaults", W.DWORD), ("total", W.DWORD),
                        ("active", W.DWORD), ("terminated", W.DWORD)]
        try:
            _checked(self.kernel.TerminateJobObject(self.handle, 1))
            end = time.monotonic()+timeout
            stats = Accounting()
            while True:
                _checked(self.kernel.QueryInformationJobObject(self.handle, 1, ctypes.byref(stats), ctypes.sizeof(stats), None))
                if stats.active == 0:
                    break
                if time.monotonic() >= end:
                    raise TimeoutError("Native Windows worker job did not finish termination")
                time.sleep(.02)
        finally:
            self.kernel.CloseHandle(self.handle)
            self.handle = None


def _join_native_worker_job():
    """A Windows venv launcher can spawn Python before the parent assigns it."""
    name = os.environ.get(WORKER_JOB_ENV)
    if sys.platform != "win32" or not name:
        return
    kernel = _job_api()
    # JOB_OBJECT_ASSIGN_PROCESS | JOB_OBJECT_QUERY
    handle = _checked(kernel.OpenJobObjectW(0x0001 | 0x0004, False, name))
    try:
        _join_job(kernel, handle, kernel.GetCurrentProcess())
    finally:
        kernel.CloseHandle(handle)


def configure_process_qos(*, interactive):
    """Set only this process's execution-speed policy; keep priority unchanged.

    Hidden HTTP/edit workers still serve foreground interaction. Windows may
    otherwise infer a low-power QoS for them. The independent batch solve worker
    explicitly returns this one policy to system management. Other power flags,
    the system power plan, timer resolution, and CPU affinity stay unchanged.
    """
    if sys.platform != "win32":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        class PowerThrottlingState(ctypes.Structure):
            _fields_ = [
                ("Version", wintypes.DWORD),
                ("ControlMask", wintypes.DWORD),
                ("StateMask", wintypes.DWORD),
            ]

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.GetCurrentProcess.argtypes = []
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        for name in ("GetProcessInformation", "SetProcessInformation"):
            function = getattr(kernel32, name)
            function.argtypes = [
                wintypes.HANDLE,
                ctypes.c_int,
                ctypes.c_void_p,
                wintypes.DWORD,
            ]
            function.restype = wintypes.BOOL

        # WinSDK: ProcessPowerThrottling=4, CURRENT_VERSION=1,
        # PROCESS_POWER_THROTTLING_EXECUTION_SPEED=0x1.
        # https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation
        state = PowerThrottlingState(1, 0, 0)
        process = kernel32.GetCurrentProcess()  # Pseudo handle; never close it.
        if not kernel32.GetProcessInformation(
            process, 4, ctypes.byref(state), ctypes.sizeof(state)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        if interactive:
            state.ControlMask |= 1
        else:
            state.ControlMask &= ~1
        state.StateMask &= ~1
        if not kernel32.SetProcessInformation(
            process, 4, ctypes.byref(state), ctypes.sizeof(state)
        ):
            raise ctypes.WinError(ctypes.get_last_error())
        return True
    except (AttributeError, OSError) as exc:
        warnings.warn(
            f"无法设置本进程的交互性能策略，继续使用系统调度：{exc}",
            RuntimeWarning,
            stacklevel=2,
        )
        return False


def available_memory_bytes():
    """Available physical RAM for a new solve; skip the Windows guard on other hosts."""
    if sys.platform != "win32":
        import os
        if "SC_AVPHYS_PAGES" in os.sysconf_names:
            return os.sysconf("SC_AVPHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
        return float("inf")
    import ctypes
    class Memory(ctypes.Structure):
        _fields_ = [("length",ctypes.c_uint32),("load",ctypes.c_uint32)] + [
            (n,ctypes.c_uint64) for n in ("total","available","page","availpage","virtual","availvirtual","extra")]
    value=Memory()
    value.length=ctypes.sizeof(value)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(value)):
        raise ctypes.WinError()
    return value.available


def limit_worker_cpu():
    """Bind this long-lived worker to one allowed logical processor, without changing its parent."""
    if sys.platform == "win32":
        _join_native_worker_job()
        import ctypes
        from ctypes import wintypes
        k = ctypes.WinDLL("kernel32",use_last_error=True)
        k.GetCurrentProcess.restype = wintypes.HANDLE
        k.GetProcessAffinityMask.argtypes = [wintypes.HANDLE, ctypes.POINTER(ctypes.c_size_t),ctypes.POINTER(ctypes.c_size_t)]
        k.SetProcessAffinityMask.argtypes = [wintypes.HANDLE, ctypes.c_size_t]
        proc = k.GetCurrentProcess()
        allowed,system = ctypes.c_size_t(),ctypes.c_size_t()
        if not k.GetProcessAffinityMask(proc,ctypes.byref(allowed),ctypes.byref(system)) or not allowed.value:
            raise ctypes.WinError()
        if not k.SetProcessAffinityMask(proc, 1 << (allowed.value.bit_length()-1)):
            raise ctypes.WinError()
    else:
        if hasattr(os,"sched_getaffinity"):
            os.sched_setaffinity(0,{max(os.sched_getaffinity(0))})
        if hasattr(os,"nice"):
            os.nice(5)
