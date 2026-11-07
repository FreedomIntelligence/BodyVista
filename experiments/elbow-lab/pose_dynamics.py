"""Guided planar motion. x is forward, y is down, positive angles flex forward."""

import hashlib
import json
import math
from functools import lru_cache
from itertools import pairwise

import numpy as np

import engine

LIMITS = {
    "shoulderDeg": ("上臂角", -70, 150),
    "rootX": ("肩前后位置（m）", -0.22, 0.22),
    "rootY": ("肩上下位置（m）", -0.22, 0.22),
    "wristDeg": ("腕角", -65, 70),
}
FIELDS = ["angle", *LIMITS]
UPPER, FORE, PALM = 0.2904, 0.24, 0.06
TABLE_HASH = "79f3575b29482a80e4ae5b6a056d4849ed839fae052fa20bd086c43a982194a9"


def needs_pose_model(frames):
    return any(
        f.get("shoulderDeg", 0)
        or f.get("wristDeg", 0)
        or any(f.get(k, 0) != frames[0].get(k, 0) for k in ("rootX", "rootY"))
        for f in frames
    )


@lru_cache(maxsize=1)
def muscle_table():
    raw = (engine.MODEL_DIR / "pose-forces.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != TABLE_HASH:
        raise ValueError("姿势力学表与已核对版本不符")
    data = json.loads(raw)
    if data["units"] != engine.MUSCLES or data["sourceSHA256"] != engine.SRC_SHA:
        raise ValueError("肌肉力学表与图谱单元不匹配")
    grid = np.asarray(data["rows"])
    if grid.shape != (111, 66, 30):
        raise ValueError("姿势力学表不完整")
    return (
        grid,
        {"stepDeg": data["stepDeg"], "shoulderMin": data["shoulderMin"]},
        TABLE_HASH,
    )


def muscle_terms(s, q, sd, qd):
    grid, meta, _ = muscle_table()
    i, j = (s - meta["shoulderMin"]) / meta["stepDeg"], q / meta["stepDeg"]
    i, j = np.clip(i, 0, grid.shape[0] - 1), np.clip(j, 0, grid.shape[1] - 1)
    l, m = min(int(i), grid.shape[0] - 2), min(int(j), grid.shape[1] - 2)
    wi, wj = i - l, j - m
    both = (1 - wi) * grid[l, m : m + 2] + wi * grid[l + 1, m : m + 2]
    row = (1 - wj) * both[0] + wj * both[1]
    speed = sd * row[24:30] + qd * row[18:24]
    capacity = row[12:18] * [
        engine._force_velocity(v, p) for v, p in zip(speed, engine._PARAMS)
    ]
    return row[:6], row[6:12], capacity


def path_samples(frames, fps):
    for j, (a, b) in enumerate(pairwise(frames)):
        span = b["t"] - a["t"]
        count = math.ceil(span * fps)
        start = np.array([a.get(k, 0.0) for k in FIELDS])
        delta = np.array([b.get(k, 0.0) for k in FIELDS]) - start
        for i in range(0 if j == 0 else 1, count + 1):
            u = i / count
            yield (
                a["t"] + span * u,
                start + delta * u**3 * (10 + u * (-15 + 6 * u)),
                delta * (30 * u * u * (1 - u) ** 2 / span),
                delta * (60 * u * (1 - u) * (1 - 2 * u) / span**2),
            )


def torque_at(p, vel, acc, mass, radius, held, info):
    # Moment about a moving elbow. For x=l*sin(a), y=l*cos(a),
    # dx/da=y and dy/da=-x, so the load's generalized force is y*Fx-x*Fy.
    q, s, w = np.radians(p[[0, 1, 4]])
    qd, sd, wd = np.radians(vel[[0, 1, 4]])
    qdd, sdd, wdd = np.radians(acc[[0, 1, 4]])
    a, ad, add = s + q, sd + qd, sdd + qdd

    def segment(length, angle, speed, accel):
        x, y = length * math.sin(angle), length * math.cos(angle)
        return x, y, y * accel - x * speed**2, -x * accel - y * speed**2

    _, _, ux, uy = segment(UPPER, s, sd, sdd)
    ax, ay = acc[2] + ux, acc[3] + uy
    g = info["gravityMS2"]
    first_moment = info["forearmHandGravity90Nm"] / g
    bare = info["forearmHandInertiaKgM2"] * add + first_moment * (
        math.cos(a) * ax + math.sin(a) * (g - ay)
    )
    # The atlas hand is articulated. Bare limb inertia stays lumped with the
    # forearm as in Arm26; only a grasped object's center follows the wrist.
    x, y, rx, ry = segment(FORE if held else radius, a, ad, add)
    if held:
        wx, wy, dx, dy = segment(PALM, a + w, ad + wd, add + wdd)
        x, y, rx, ry = x + wx, y + wy, rx + dx, ry + dy
    external = mass * (y * (ax + rx) - x * (ay + ry - g))
    return bare, external


def solve_pose(raw_scene, scene, fps):
    from solver import ScenarioError, recruit

    info = engine.model_info()
    rows, terms = [], []
    for t, p, v, acc in path_samples(scene["keyframes"], fps):
        bare, additional = torque_at(
            p, v, acc, scene["loadKg"], scene["radiusM"], "equipment" in scene, info
        )
        rows.append(
            dict(
                t=t,
                **dict(zip(FIELDS, p)),
                torque=bare + additional,
                referenceTorque=bare,
                loadTorque=additional,
            )
        )
        terms.append(muscle_terms(p[1], p[0], math.radians(v[1]), math.radians(v[0])))
    arms, passive, capacity = (np.stack(a) for a in zip(*terms))
    path = np.array([[r["t"]] for r in rows])
    note = "按确认的姿势和时长回放。肩、腕由外部引导，六肌估计只满足肘部力矩，不含肩腕的肌肉分担。"
    diagnostics = {
        "modeUsed": "prescribed",
        "scopeNote": note,
        "fps": fps,
        "solver": "引导姿势的平面逆动力学与肘部逐帧配力",
    }
    # This model has different assumptions and a distinct table fingerprint.
    model = {
        **info,
        "id": "arm26-guided-elbow-v1",
        "tableSHA256": muscle_table()[2],
        "tableStepDeg": 2,
        "shoulderRangeDeg": [-70, 150],
        "shoulderDeg": None,
        "assumptions": [
            "裸手与前臂按 Arm26 合并质量及惯量计算；器械视作集中在握把中心的点质量。"
        ],
    }
    results = {}
    try:
        for key in ("torque", "referenceTorque"):
            target = np.array([r[key] for r in rows])
            activation, _, _, _ = recruit(
                path, (target, arms, passive, capacity), scene["extensorMin"]
            )
            forces = passive + capacity * activation
            error = np.max(abs((forces * arms).sum(axis=1) - target))
            if not np.isfinite(error) or error > 0.01:
                raise ScenarioError("肘部力矩平衡超出容差。")
            results[key] = activation, forces
            diagnostics["maxResidualNm"] = max(
                diagnostics.get("maxResidualNm", 0), float(error)
            )
    except ScenarioError as exc:
        diagnostics["scopeNote"] = (
            str(exc) + " 当前可回放姿势与所需肘净力矩，没有逐肌解。"
        )
        results.clear()
    for i, r in enumerate(rows):
        if results:
            a, f = results["torque"]
            ar, fr = results["referenceTorque"]
            r.update(
                activations=a[i].tolist(),
                forces=f[i].tolist(),
                referenceActivations=ar[i].tolist(),
                referenceForces=fr[i].tolist(),
            )
    applied_scene = {**scene, "mode": "prescribed"}
    return {
        "schema": 1,
        "input": raw_scene,
        "scene": applied_scene,
        "model": model,
        "frames": rows,
        "diagnostics": diagnostics,
        "kinematicOnly": not bool(results),
    }
