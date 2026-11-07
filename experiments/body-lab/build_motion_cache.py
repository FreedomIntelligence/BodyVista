"""Publish complete, version-bound solved cases as immutable compressed assets."""

import argparse
import gzip
import hashlib
import importlib
import json
import math
import os
import sys
import tempfile
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

LAB = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def load_json(raw):
    def read_float(value):
        number = float(value)
        require(math.isfinite(number), "JSON 含非有限数值。")
        return number

    def reject_constant(value):
        raise ValueError(f"JSON 含非法常量：{value}")

    return json.loads(raw, parse_float=read_float, parse_constant=reject_constant)


def runtime():
    sys.path.insert(0, str(LAB.parent))
    engine = importlib.import_module("body-lab.fullbody_engine")
    solver = importlib.import_module("body-lab.fullbody_solver")
    ctx = engine.context()
    identity = {
        "model": engine.MODEL_ID,
        "modelSha256": ctx.sha,
        "computationSha256": engine.COMPUTATION_SHA256,
        "muscles": set(ctx.muscle_names),
        "coordinates": set(ctx.names),
        "internal": {name for name in ctx.names if not name.startswith("pelvis_")},
        "branches": getattr(ctx, "tendon_branches", {}),
        "handReferenceCoordinates": set(ctx.hand_elasticity.names) if getattr(ctx, "hand_elasticity", None) else set(),
    }
    return engine, solver.normalize, identity


def trajectory(scene):
    """Use the production sampling contract without running any dynamics."""
    sys.path.insert(0, str(LAB.parent))
    solver = importlib.import_module("body-lab.fullbody_solver")
    return [(time, solver.sample(scene, time)[0]) for time in solver.frame_times(scene)]


def validate_force_frame(frame, identity, load_kg):
    """Audit one complete physical ledger against the model, without running any solver."""
    require(isinstance(frame, dict) and finite(load_kg) and load_kg >= 0, "帧或场景负重无效。")
    require(all(frame.get(key) is True for key in
                ("quantitativeValid", "frameFeasible", "muscleValid")), "存在失效动作帧。")
    require(frame.get("anatomy", {}).get("valid") is True and
            frame.get("support", {}).get("feasible") is True and
            frame.get("groundCheck", {}).get("feasible") is True, "姿势或支撑未通过。")
    require(not frame.get("idealActuatorTorques") and not frame.get("errors"),
            "结果含理想执行器或错误记录。")
    muscles = frame.get("muscles", [])
    require(isinstance(muscles, list) and all(isinstance(m, dict) for m in muscles) and
            len(muscles) == len(identity["muscles"]) and
            {m.get("name") for m in muscles} == identity["muscles"], "肌腱单元缺失或重复。")
    for muscle in muscles:
        require(all(finite(muscle.get(key)) and muscle[key] >= 0 for key in
                    ("force", "activeCapacity", "passiveForce")), "肌腱张力或容量无效。")
        require(finite(muscle.get("activation")) and 0 <= muscle["activation"] <= 1,
                "肌肉激活越界。")
        branches = muscle.get("branches", [])
        expected = identity.get("branches", {}).get(muscle["name"], [])
        require(isinstance(branches, list) and len(branches) == len(expected), "肌腱分支缺失。")
        for branch, definition in zip(branches, expected):
            require(isinstance(branch, dict) and branch.get("id") == definition["id"] and
                    finite(branch.get("coefficient")) and branch["coefficient"] > 0 and
                    abs(branch["coefficient"] - definition["coefficient"]) < 1e-10,
                    "肌腱分支传力比例不符。")
            require(finite(branch.get("force")) and branch["force"] >= 0 and
                    abs(branch["force"] - muscle["force"] * branch["coefficient"]) <=
                    1e-7 * max(1, muscle["force"]), "肌腱分支张力不完整或与主干不符。")
            path = branch.get("path")
            require(isinstance(path, list) and len(path) >= 2 and
                    all(isinstance(point, list) and len(point) == 3 and all(map(finite, point))
                        for point in path), "肌腱分支路径不完整。")
        require(not branches or branches[0]["path"] == muscle.get("path"), "肌腱主干路径不符。")
    for field in ("torques", "rawTorques", "muscleTorques", "passiveTorques",
                  "jointPassiveTorques", "reserveTorques"):
        values = frame.get(field, {})
        require(isinstance(values, dict) and set(values) == identity["coordinates"] and
                all(finite(value) for value in values.values()), f"{field} 缺失或无效。")
    hand_coordinates = identity.get("handReferenceCoordinates", set())
    if hand_coordinates:
        hand_values = frame.get("handReferenceTorques")
        require(isinstance(hand_values, dict) and set(hand_values) == hand_coordinates and
                all(finite(value) for value in hand_values.values()), "手指参考被动修正矩缺失或无效。")
        for field in ("otherJointPassiveTorques", "externalTorques"):
            values = frame.get(field)
            require(isinstance(values, dict) and set(values) == identity["coordinates"] and
                    all(finite(value) for value in values.values()), f"{field} 缺失或无效。")
        for name in identity["coordinates"]:
            require(abs(frame["jointPassiveTorques"][name] - frame["otherJointPassiveTorques"][name]
                        - hand_values.get(name, 0)) <= 1e-7, "手指与其他被动作用未正确计入合计。")
            require(abs(frame["rawTorques"][name] - frame["jointPassiveTorques"][name]
                        - frame["externalTorques"][name] - frame["torques"][name]) <= 1e-7,
                    "被动作用、显式外力与净需求的账目不一致。")
    require(frame.get("recruitment", {}).get("internalCoordinatesIncluded") == len(identity["internal"]),
            "内部坐标数量不完整。")
    require(finite(frame.get("balanceErrorNm")) and 0 <= frame["balanceErrorNm"] <= 1e-7,
            "内部力矩未精确配平。")
    require(finite(frame.get("nativeForceErrorN")) and 0 <= frame["nativeForceErrorN"] < 1e-6,
            "原生肌力复核未通过。")
    stops = frame.get("jointLimitTorques", {})
    require(isinstance(stops, dict) and all(finite(value) for value in stops.values()),
            "关节止挡数据无效。")
    for name in identity["internal"]:
        balance = frame["torques"][name] - frame["muscleTorques"][name] - stops.get(name, 0)
        require(abs(frame["reserveTorques"][name]) <= 1e-7 and abs(balance - frame["reserveTorques"][name]) <= 1e-7, "关节受力账目不一致。")
    base = frame["support"].get("baseResidual", {})
    require(all(finite(base.get(name)) for name in identity["coordinates"] - identity["internal"]),
            "支撑六分量缺失。")
    if load_kg > 0:
        grasp = frame.get("grasp", {})
        require(grasp.get("geometryValid") is True and grasp.get("feasible") is True,
                "负重动作的握持未通过。")
        require(all(finite(grasp.get(key)) and 0 <= grasp[key] < 1e-6 for key in
                    ("objectResidualForceN", "objectResidualMomentNm")), "器械未配平。")
        contacts = grasp.get("contacts", [])
        require(isinstance(contacts, list) and contacts and all(isinstance(c, dict) for c in contacts),
                "负重动作没有完整手部接触结果。")
        for contact in contacts:
            require(finite(contact.get("normalN")) and contact["normalN"] >= 0 and
                    finite(contact.get("frictionMarginN")) and contact["frictionMarginN"] >= -1e-7,
                    "接触法向力或摩擦不合法。")
            force = contact.get("forceOnObject", [])
            require(isinstance(force, list) and len(force) == 3 and all(finite(value) for value in force), "接触力不完整。")


def validate_result(catalog, motion, scene, result, identity, normalize):
    """Check saved outputs against their input and current model, without solving."""
    for key in ("model", "modelSha256", "computationSha256"):
        require(catalog.get(key) == identity[key], f"动作目录的 {key} 与当前模型不匹配。")
    require(catalog.get("status") == "passed" and catalog.get("sourceStable") is True,
            "动作目录缺少稳定完成的验证记录。")
    for key in ("modelSha256", "computationSha256"):
        require(catalog.get(key + "After") == identity[key], f"验证结束时 {key} 不匹配。")
    require(motion.get("verification", {}).get("verified") is True, "动作未通过验证。")
    require(scene.get("model") == identity["model"], "动作文件属于其他模型。")
    require(result.get("model") == identity["model"] and
            result.get("computationSha256") == identity["computationSha256"],
            "保存结果的模型或计算代码不匹配。")
    require(result.get("status") == "solved" and result.get("quantitativeValid") is True and
            result.get("kinematicOnly") is False and result.get("failures") == [],
            "预览或失效结果不能发布为缓存。")
    normalized = normalize(scene)
    require(not normalized.get("preview"), "预览动作不能发布为缓存。")
    require(normalized == normalize(motion["scene"]) == normalize(result["scene"]),
            "目录、动作文件与计算结果的输入条件不同。")
    frames, metrics = result.get("frames"), result.get("metrics", {})
    require(isinstance(frames, list) and len(frames) >= 2, "缺少完整动作帧。")
    samples = trajectory(normalized)
    require(len(frames) == len(samples) == motion["verification"].get("frames") and
            all(frame.get("t") == time for frame, (time, _) in zip(frames, samples)),
            "动作采样帧缺失或时间与原动作不符。")
    require(metrics.get("frames") == len(frames) and metrics.get("failedFrames") == 0 and
            metrics.get("allMusclesFeasible") is True and
            metrics.get("musclesIncluded") == len(identity["muscles"]), "计算摘要与帧不一致。")
    previous_time = -1
    for frame, (_, expected_q) in zip(frames, samples):
        pose = frame.get("q", {})
        require(isinstance(pose, dict) and set(pose) == set(expected_q) and
                all(finite(pose[name]) and abs(pose[name] - value) <= 1e-8
                    for name, value in expected_q.items()), "动作帧姿势与声明的关键帧插值不符。")
        time = frame.get("t")
        require(finite(time) and time > previous_time, "动作时间缺失或未递增。")
        previous_time = time
        validate_force_frame(frame, identity, normalized["loadKg"])
    require(frames[0]["t"] == 0 and frames[-1]["t"] == normalized["keyframes"][-1]["t"] ==
            metrics.get("durationSeconds"), "动作起止时间与输入不一致。")


def artifact_path(directory, name):
    require(isinstance(name, str) and name and Path(name).name == name and
            "/" not in name and "\\" not in name, "证据必须是目录内的单个文件名。")
    path = directory / name
    require(path.resolve().parent == directory.resolve(), "证据不能通过链接离开来源目录。")
    return path


def atomic_write(path, raw):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".motion-cache-", delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(raw)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def build(catalog_paths, output=LAB / "motion-cache"):
    engine, normalize, identity = runtime()
    require(engine.computation_fingerprint() == identity["computationSha256"], "计算源码正在变化。")
    merged = {key: identity[key] for key in ("model", "modelSha256", "computationSha256")}
    merged.update(schema=1, generatedAt=datetime.now(timezone.utc).isoformat(), motions=[])
    identifiers = set()
    for source in catalog_paths:
        source = Path(source).resolve()
        catalog_bytes = source.read_bytes()
        catalog = load_json(catalog_bytes)
        for motion in catalog.get("motions", []):
            require(engine.computation_fingerprint() == identity["computationSha256"], "打包期间代码变化。")
            require(motion["id"] not in identifiers, "动作 ID 重复，拒绝覆盖。")
            evidence = motion["verification"]
            scene_raw = artifact_path(source.parent, evidence["sceneFile"]).read_bytes()
            result_raw = artifact_path(source.parent, evidence["resultFile"]).read_bytes()
            for name, raw in (("scene", scene_raw), ("result", result_raw)):
                require(hashlib.sha256(raw).hexdigest() == evidence.get(name + "Sha256"),
                        f"{motion['id']} 的 {name} 与原验证哈希不一致。")
            scene, result = load_json(scene_raw), load_json(result_raw)
            validate_result(catalog, motion, scene, result, identity, normalize)
            envelope = {"schema": 1, **{key: identity[key] for key in
                        ("model", "modelSha256", "computationSha256")},
                        "verifiedAt": catalog.get("completedAt", catalog["generatedAt"]),
                        "scene": scene, "result": result}
            raw = json.dumps(envelope, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
            digest = hashlib.sha256(raw).hexdigest()
            compressed = gzip.compress(raw, compresslevel=6, mtime=0)
            atomic_write(output / (digest + ".json.gz"), compressed)
            entry = deepcopy(motion)
            entry["cachedResult"] = {"url": f"./motion-cache/{digest}.json", "sha256": digest,
                                     "bytes": len(raw), "compressedBytes": len(compressed)}
            merged["motions"].append(entry)
            identifiers.add(motion["id"])
            print(json.dumps({"id": motion["id"], "bytes": len(raw), "compressedBytes": len(compressed)}), flush=True)
        require(source.read_bytes() == catalog_bytes, "打包期间来源目录变化，未发布清单。")
    require(merged["motions"], "没有可发布的动作。")
    require(engine.computation_fingerprint() == identity["computationSha256"] and
            hashlib.sha256(engine.MODEL_PATH.read_bytes()).hexdigest() == identity["modelSha256"],
            "打包期间模型或代码变化，未发布清单。")
    atomic_write(output / "catalog.json", (json.dumps(merged, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode("utf-8"))
    return merged


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("catalogs", nargs="+", type=Path)
    arguments = parser.parse_args()
    manifest = build(arguments.catalogs)
    print(json.dumps({"motions": len(manifest["motions"]), "compressedBytes": sum(
        motion["cachedResult"]["compressedBytes"] for motion in manifest["motions"])}))
