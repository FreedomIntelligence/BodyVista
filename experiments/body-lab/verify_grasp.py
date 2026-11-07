"""Numerical regressions for capsule grasp, contact transmission and rejection.

Run with the existing D-drive .venv-fullbody; no third-party additions.
These are model consistency checks, not human grip-strength validation.
"""

import argparse
import importlib
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
G = importlib.import_module("body-lab.grasp")
S = importlib.import_module("body-lab.fullbody_solver")
E = importlib.import_module("body-lab.fullbody_engine")


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def scenario(q, mass=2, hand="right", kind="dumbbell", **options):
    return S.normalize({"keyframes": [{"t": 0, "q": q}, {"t": .2, "q": q}],
                        "loadKg": mass, "hand": hand, "equipment": {"type": kind, **options}})


def frame(q, mass=2, hand="right", kind="dumbbell", **options):
    scene = scenario(q, mass, hand, kind, **options)
    return S.solve_frame(scene["keyframes"][0]["q"], {}, {}, scene)[0]


def balanced(value):
    require(value["quantitativeValid"], "未配平：" + str(value["errors"]))
    require(value["balanceErrorNm"] < 1e-7, "内部力矩残差")
    if "grasp" in value:
        grip = value["grasp"]
        require(grip["geometryValid"] and grip["feasible"], "接触状态与力学结果不一致")
        require(grip["objectResidualForceN"] < 1e-7 and grip["objectResidualMomentNm"] < 1e-7, "物体六维平衡残差")
        require(all(c["normalN"] >= -1e-9 and c["frictionMarginN"] >= -1e-8 for c in grip["contacts"]), "摩擦锥或单向接触越界")


def run():
    ctx = G.context()
    checks, poses = [], {}
    for bad in ("dumbbell", 1, True, None, [], [1]):
        try:
            G.attach({"q": {}, "loadKg": 2, "equipment": bad})
        except E.ScenarioError:
            pass
        else:
            raise AssertionError("非对象器械参数被接受：" + repr(bad))
    for bad in (None, [], "scene"):
        try:
            G.attach(bad)
        except E.ScenarioError:
            pass
        else:
            raise AssertionError("非对象握持请求被接受：" + repr(bad))
    try:
        G.attach({"equipment": {"type": "dumbbell", "massKg": 10**1000}})
    except E.ScenarioError:
        pass
    else:
        raise AssertionError("超出浮点表示的质量未作为输入错误拒绝")
    checks.append({"case": "malformed-grasp-inputs", "status": "passed"})
    for side in ("right", "left", "both"):
        attached = G.attach({"q": {}, "loadKg": 2, "hand": side})
        require(attached["grasp"]["geometryValid"], "闭合失败：" + str(attached["grasp"]["errors"]))
        require(all(G.FINGER_PATTERN.match(n) for n in attached["changedCoordinates"]), "闭指改变了上肢")
        if side != "both":
            require(all(n.endswith("_l") == (side == "left") for n in attached["changedCoordinates"]), "闭指误改另一只手")
        poses[side] = attached["q"]
        loaded = frame(attached["q"], hand=side)
        balanced(loaded)
        require(len(loaded["equipmentInstances"]) == (2 if side == "both" else 1), "器械实例数量错误")
        checks.append({"case": side + "-closed-2kg", "status": "passed", "contactCount": len(loaded["grasp"]["contacts"]),
                       "residualNm": loaded["balanceErrorNm"], "objectMomentErrorNm": loaded["grasp"]["objectResidualMomentNm"]})

    q = poses["right"]
    empty, loaded = frame(q, 0), frame(q, 2)
    balanced(empty)
    balanced(loaded)
    for name, value in (("open-5kg", frame(ctx.defaults, 5)), ("closed-overload-50kg", frame(q, 50)),
                        ("zero-friction-axial-load", frame(q, 2, friction=0))):
        require(not value["quantitativeValid"], name + "不应被判为可行")
        require(all(m["force"] is None and m["activation"] is None for m in value["muscles"]), "失败时泄漏有效肌力")
        require(all(c["forceOnObject"] is None for c in value["grasp"]["contacts"]), "失败时显示未经通过的接触力")
        checks.append({"case": name, "status": "passed", "reasons": value["errors"]})
    data, _ = ctx.state(q)
    axial_gravity = float(np.dot(G.palm_frame(ctx, data, "r")[2][:, 2], ctx.model.opt.gravity))
    require(abs(axial_gravity) > .01, "零摩擦反例必须具有沿杆轴负荷")

    # Finite-difference virtual work on the actual contact-bearing phalanges.
    local_contacts = []
    for c in loaded["grasp"]["contacts"]:
        bid = ctx.body_ids[c["body"]]
        point = E.WORLD.T @ np.array(c["point"])
        local = data.xmat[bid].reshape(3, 3).T @ (point - data.xpos[bid])
        local_contacts.append((bid, local, E.WORLD.T @ np.array(c["forceOnObject"])))
    max_work_error, max_finger_load = 0., 0.
    for name in ("2mcp_flexion", "2pm_flexion", "2md_flexion", "3mcp_abduction", "ip_flexion"):
        step = 1e-4
        a, b = dict(q), dict(q)
        a[name] += step
        b[name] -= step
        da, _ = ctx.state(a)
        db, _ = ctx.state(b)
        expected = 0.
        for bid, local, force in local_contacts:
            pa = da.xpos[bid] + da.xmat[bid].reshape(3, 3) @ local
            pb = db.xpos[bid] + db.xmat[bid].reshape(3, 3) @ local
            expected += float((pa - pb) @ force) / (2 * step / ctx.factor[name])
        measured = loaded["torques"][name] - empty["torques"][name]
        max_work_error = max(max_work_error, abs(measured - expected))
        max_finger_load = max(max_finger_load, abs(measured))
    require(max_work_error < 2e-6 and max_finger_load > .001, "手指未真实接收到接触负荷或虚功不符")
    checks.append({"case": "finger-contact-virtual-work", "status": "passed", "maxErrorNm": max_work_error, "maxFingerLoadNm": max_finger_load})

    total_weight = (ctx.mass + 2) * 9.81
    support_results = {}
    for support in ("seated", "feet", "free"):
        configured = S.normalize({"keyframes": [{"t": 0, "q": q}, {"t": .2, "q": q}],
                                  "loadKg": 2, "support": support, "groundEnabled": support == "feet"})
        held, _ = S.solve_frame(q, {}, {}, configured)
        if support == "free":
            require(not held["quantitativeValid"] and not held["support"]["feasible"], "无支撑静止持重被判可行")
            force = held["support"]["baseResidual"]["pelvis_ty"]
        elif support == "seated":
            balanced(held)
            force = held["support"]["baseResidual"]["pelvis_ty"]
        else:
            balanced(held)
            force = sum(c["force"][1] for c in held["support"]["forces"])
        require(abs(force - total_weight) < 1e-7, "支撑根部负重遗漏或重复计算")
        support_results[support] = {"valid": held["quantitativeValid"], "verticalN": force}
    checks.append({"case": "grasp-root-support-no-double-count", "status": "passed", "supports": support_results})

    rotated = dict(q, flexion_r=20, pro_sup_r=25)
    moved, _ = ctx.state(rotated)
    before, after = G.describe(ctx, data, {"loadKg": 2}), G.describe(ctx, moved, {"loadKg": 2})
    require(after["grasp"]["geometryValid"], "转腕后固定握持几何失效")
    r0 = np.array(before["equipmentInstances"][0]["matrix"]).reshape(4, 4).T
    r1 = np.array(after["equipmentInstances"][0]["matrix"]).reshape(4, 4).T
    require(np.linalg.norm(r0[:3, :3] - r1[:3, :3]) > .1, "器械没有随腕改变朝向")
    expected = E.WORLD @ G.palm_frame(ctx, moved, "r")[2]
    require(np.max(abs(r1[:3, :3] - expected)) < 6e-7, "显示矩阵与握持物理朝向不一致")
    checks.append({"case": "dumbbell-wrist-orientation", "status": "passed"})
    for mass in (0, 2):
        for hand in ("right", "left", "both"):
            payload = {"q": q, "loadKg": mass, "hand": hand, "equipment": {"type": "barbell"}}
            for operation in (G.attach, lambda value: scenario(q, value["loadKg"], value["hand"], "barbell")):
                try:
                    operation(payload)
                except E.ScenarioError as error:
                    require("杠铃功能已移除" in str(error), "杠铃未给出明确移除提示")
                else:
                    raise AssertionError("已移除的杠铃仍被接受")
    checks.append({"case": "removed-barbell-rejected", "status": "passed"})

    end = dict(q, elbow_flexion_r=90)
    motion = S.solve({"keyframes": [{"t": 0, "q": q}, {"t": 3, "q": end}, {"t": 4, "q": end}, {"t": 7, "q": q}], "loadKg": 2})
    require(motion["quantitativeValid"], "整段持物屈肘未通过：" + str(motion["failures"][:2]))
    require(max(f["grasp"]["slipSpeedMaxMps"] for f in motion["frames"]) < 1e-8, "持续握持发生运动学滑动")
    checks.append({"case": "2kg-curl-0-90-0", "status": "passed", "frames": len(motion["frames"]), "maxResidualNm": max(f["balanceErrorNm"] for f in motion["frames"])})
    opened = dict(q, **{n: ctx.defaults[n] for n in G.finger_names(ctx, "r")})
    opening = S.solve({"keyframes": [{"t": 0, "q": q}, {"t": 1, "q": opened}], "loadKg": 2})
    require(not opening["quantitativeValid"] and all(not f["muscleValid"] for f in opening["frames"]), "松手仍显示有效承重")
    checks.append({"case": "opening-disables-load-forces", "status": "passed", "failedFrames": len(opening["failures"])})
    return {"status": "passed", "modelSha256": ctx.sha, "computationSha256": E.COMPUTATION_SHA256,
            "scope": "源肌骨模型与声明接触参数的数值验证；不是实测握力。", "checks": checks,
            "axialGravityMps2ForZeroFrictionCase": axial_gravity}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    result = run()
    if args.out:
        args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))
