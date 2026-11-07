"""Line-oriented worker; only this process imports the D-drive MuJoCo engine."""

import importlib
import json
import sys
import traceback
from pathlib import Path
from time import perf_counter

from runtime_performance import configure_process_qos, limit_worker_cpu

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
PREFIX = "BODYVISTA_REPLY "


def describe_equipment(engine, frame, payload):
    equipment = payload.get("equipment")
    if not isinstance(equipment, dict) or equipment.get("type", "none") == "none":
        return frame
    scene = {
        "equipment": equipment,
        "loadKg": payload.get("loadKg", equipment.get("massKg", 0)),
        "hand": payload.get("hand", equipment.get("hand", "right")),
    }
    ctx = engine.context()
    data, _ = ctx.state(frame["q"])
    frame.update(importlib.import_module("body-lab.grasp").describe(ctx, data, scene))
    return frame


def dispatch(method, payload):
    engine = importlib.import_module("body-lab.fullbody_engine")
    expected = payload.get("computationSha256")
    if (engine.computation_fingerprint() != engine.COMPUTATION_SHA256 or
            expected is not None and expected != engine.COMPUTATION_SHA256):
        raise ValueError("计算代码版本已改变，请重启本地服务并刷新页面后重新计算。")
    result = dispatch_current(engine, method, payload)
    if engine.computation_fingerprint() != engine.COMPUTATION_SHA256:
        raise ValueError("计算期间代码版本已改变，本次结果已丢弃；请重启服务后重试。")
    result["computationSha256"] = engine.COMPUTATION_SHA256
    return result


def dispatch_current(engine, method, payload):
    if method == "model":
        return engine.model_info()
    if method == "pose":
        return describe_equipment(engine, engine.pose(payload.get("q", {})), payload)
    if method == "ik":
        return engine.ik(payload)
    if method == "rotate":
        return describe_equipment(engine, engine.rotate(payload), payload)
    if method == "grasp":
        result = importlib.import_module("body-lab.grasp").attach(payload)
        frame = engine.pose(result["q"])
        frame.update(result)
        return frame
    if method == "solve":
        return importlib.import_module("body-lab.fullbody_solver").solve(payload)
    raise ValueError("未知全身计算方法。")


def main():
    limit_worker_cpu()
    configure_process_qos(interactive=sys.argv[1:] == ["edit"])
    for line in sys.stdin:
        request_id = None
        try:
            message = json.loads(line)
            request_id = message["id"]
            started = perf_counter()
            result = dispatch(message["method"], message.get("payload", {}))
            computed = perf_counter()
            encoded = json.dumps(
                result, ensure_ascii=False, allow_nan=False, separators=(",", ":")
            )
            timing = {
                "compute": (computed - started) * 1000,
                "worker_encode": (perf_counter() - computed) * 1000,
            }
            envelope = json.dumps({"id": request_id, "timing": timing})
            raw = envelope[:-1] + ',"result":' + encoded + "}"
        except (ValueError, TypeError, KeyError) as exc:
            raw = json.dumps(
                {"id": request_id, "kind": "input-error", "error": str(exc)},
                ensure_ascii=False,
            )
        except Exception:  # noqa: BLE001 -- report a native failure without losing the protocol.
            traceback.print_exc(file=sys.stderr)
            raw = json.dumps(
                {
                    "id": request_id,
                    "kind": "runtime-error",
                    "error": "全身原生计算失败，未生成有效肌力；详情已保留在本地日志。",
                },
                ensure_ascii=False,
            )
        print(PREFIX + raw, flush=True)


if __name__ == "__main__":
    main()
