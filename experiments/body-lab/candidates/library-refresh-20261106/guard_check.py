"""Run one verification script under the same limits as a library case (on Windows)."""
import argparse
import json
from pathlib import Path
import runpy
import sys
from resource_guard import run_guarded, worker_gate

HERE = Path(__file__).resolve().parent
LAB = HERE.parents[1]
TMP = LAB.parents[1] / ".runtime-cache" / "verification"


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--worker", action="store_true")
    p.add_argument("--seconds", type=int, default=180)
    p.add_argument("script", type=Path)
    p.add_argument("args", nargs=argparse.REMAINDER)
    a = p.parse_args()
    path = a.script.resolve(strict=True)
    if not path.is_relative_to(LAB) or path.suffix != ".py" or not 1 <= a.seconds <= 900:
        p.error("Choose a verification script inside the lab and a 1–900 second deadline")
    if a.worker:
        worker_gate()
        sys.path.insert(0,str(path.parent))
        sys.argv = [str(path),*a.args]
        runpy.run_path(str(path),run_name="__main__")
    else:
        stats = run_guarded([sys.executable,"-B","-X","utf8",str(Path(__file__).resolve()),
            "--worker","--seconds",str(a.seconds),str(path),*a.args],TMP,timeout=a.seconds)
        print(json.dumps(stats),flush=True)


if __name__ == "__main__":
    main()
