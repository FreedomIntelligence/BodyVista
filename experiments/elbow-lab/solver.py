"""CPU solver for the shoulder-locked elbow teaching experiment, in SI units."""

import copy
import math
from itertools import pairwise

import numpy as np
from scipy import sparse
from scipy.optimize import linprog

import engine
import pose_dynamics

DEFAULT_SCENE = {
    "mode": "prescribed",
    "objective": "effort",
    "loadKg": 5.0,
    "radiusM": 0.30,
    "extensorMin": 0.0,
    "keyframes": [
        {"t": 0, "angle": 0},
        {"t": 1, "angle": 90},
        {"t": 2, "angle": 90},
        {"t": 3, "angle": 0},
    ],
}
FPS = 50
# Arm26 uses the same time constants across these six actuators.
RISE_TIME = engine.model_info()["muscles"][0]["activationTime"]
FALL_TIME = engine.model_info()["muscles"][0]["deactivationTime"]


class ScenarioError(ValueError):
    """A scenario cannot be interpreted or cannot be solved within its constraints."""


def numeric(value, label, low, high):
    if (
        type(value) not in (int, float)
        or not low <= value <= high
        or not math.isfinite(value)
    ):
        raise ScenarioError(f"{label}须在 {low:g} 至 {high:g} 之间。")
    return float(value)


def normalize(scene):
    if not isinstance(scene, dict):
        raise ScenarioError("实验输入必须是 JSON 对象。")
    if scene.keys() - {
        "mode",
        "objective",
        "keyframes",
        "loadKg",
        "radiusM",
        "extensorMin",
        "equipment",
    }:
        raise ScenarioError("实验卡含有未支持的字段。")
    mode, objective = scene.get("mode", "prescribed"), scene.get("objective", "effort")
    if mode not in ("prescribed", "predict") or objective not in ("effort", "smooth"):
        raise ScenarioError("未知的动作模式或优化目标。")
    keys = scene.get("keyframes")
    if not isinstance(keys, list) or not 2 <= len(keys) <= 10:
        raise ScenarioError("请设置 2 至 10 个带时间的关键帧。")
    frames = []
    marker_radius = None
    for i, key in enumerate(keys):
        if not isinstance(key, dict):
            raise ScenarioError(f"第 {i + 1} 帧格式无效。")
        if key.keys() - {"t", "angle", "handTarget", *pose_dynamics.LIMITS}:
            raise ScenarioError(f"第 {i + 1} 帧含有未支持的字段。")
        t = numeric(key.get("t"), "帧时间（秒）", 0, 10)
        # For a fixed upper arm a target can also be expressed in the sagittal plane.
        if "angle" in key and "handTarget" in key:
            raise ScenarioError(f"第 {i + 1} 帧同时指定了角度和手部目标，请保留一种。")
        if "handTarget" in key:
            target = key["handTarget"]
            if not isinstance(target, dict) or target.keys() != {
                "xM",
                "downM",
                "reachM",
            }:
                raise ScenarioError("手部目标须给出 xM、downM、reachM。")
            x = numeric(target.get("xM"), "手部前向坐标", -1, 1)
            down = numeric(target.get("downM"), "手部向下坐标", -1, 1)
            reach = numeric(target.get("reachM"), "肘至指定标记的距离", 0.05, 1)
            if marker_radius is not None and abs(reach - marker_radius) > 1e-9:
                raise ScenarioError(
                    "同一段实验中，肘轴至同一手部标记的距离须保持固定。"
                )
            marker_radius = reach
            if abs(math.hypot(x, down) - reach) > 0.001:
                raise ScenarioError(f"第 {i + 1} 帧手部目标不在固定肘轴的可达圆弧上。")
            angle = math.degrees(math.atan2(x, down))
        else:
            angle = key.get("angle")
        angle = numeric(angle, "肘屈曲角（度）", 0, 130)
        if (i == 0 and t != 0) or (i > 0 and t - frames[-1]["t"] < 0.2 - 1e-9):
            raise ScenarioError(
                f"第 {i + 1} 帧时间冲突。首帧为 0 秒，相邻关键帧至少间隔 0.2 秒。"
            )
        extra = {
            name: numeric(key[name], label, low, high)
            for name, (label, low, high) in pose_dynamics.LIMITS.items() if name in key
        }
        if "handTarget" in key and any(extra.get(name) for name in ("shoulderDeg", "wristDeg")):
            raise ScenarioError("坐标反解要求肩、腕处于零位；多关节姿势请直接摆放。")
        frames.append({"t": t, "angle": angle, **extra})
    gear = scene.get("equipment")
    if "equipment" in scene:
        if not isinstance(gear, dict) or gear.keys() != {"type", "massKg"} or gear["type"] not in ("none", "dumbbell", "barbell"):
            raise ScenarioError("器械应包含类型和质量。")
        mass = numeric(gear["massKg"], "器械质量（kg）", 0, 20)
        if (gear["type"] == "none") != (mass == 0):
            raise ScenarioError("空手质量应为零，持械质量应大于零。")
        if "loadKg" in scene and numeric(scene["loadKg"], "负重（kg）", 0, 20) != mass:
            raise ScenarioError("右手持物质量与器械质量不一致。")
        if "radiusM" in scene and abs(numeric(scene["radiusM"], "负重距离（m）", .05, .45) - .30) > 1e-8:
            raise ScenarioError("器械吸附在掌心，中立腕的握持距离为 0.30 m。")
        equipment = {"equipment": {"type": gear["type"], "massKg": mass}}
    else:
        mass = numeric(scene.get("loadKg"), "负重（kg）", 0, 20)
        equipment = {}
    return {
        "mode": mode,
        "objective": objective,
        "keyframes": frames,
        "loadKg": mass,
        "radiusM": numeric(scene.get("radiusM", .30), "负重距离（m）", 0.05, 0.45),
        "extensorMin": numeric(scene.get("extensorMin", 0), "伸肌最低激活", 0, 0.8),
        **equipment,
    }


def trajectory(keys, bias):
    """Warp a minimum-jerk segment while preserving endpoint angle, speed and acceleration."""
    chunks = []
    for i, (start, end) in enumerate(pairwise(keys)):
        delta = math.radians(end["angle"] - start["angle"])
        dt = end["t"] - start["t"]
        count = max(3, math.ceil(FPS * dt))
        u = np.linspace(0, 1, count + 1)
        c = bias[i]
        w = u + c * u * (1 - u)
        wp = 1 + c * (1 - 2 * u)
        wpp = -2 * c
        s = w**3 * (10 + w * (-15 + 6 * w))
        d1 = 30 * w**2 * (1 - w) ** 2
        d2 = 60 * w * (1 - w) * (1 - 2 * w)
        d3 = 60 * (1 - 6 * w + 6 * w * w)
        values = np.column_stack(
            (
                start["t"] + dt * u,
                math.radians(start["angle"]) + delta * s,
                delta * d1 * wp / dt,
                delta * (d2 * wp**2 + d1 * wpp) / dt**2,
                delta * (d3 * wp**3 + 3 * d2 * wp * wpp) / dt**3,
            )
        )
        chunks.append(values if i == 0 else values[1:])
    return np.vstack(chunks)


def mechanical_data(path, mass, radius):
    values = [
        engine.mechanics(float(q), float(dq), float(ddq), mass, radius)
        for _, q, dq, ddq, _ in path
    ]
    return tuple(
        np.array([v[key] for v in values], dtype=float)
        for key in ("torque", "arms", "passive", "capacity")
    )


def recruit(path, data, extensor_min):
    torque, arms, passive, capacity = data
    weights = arms * capacity
    demand = torque - (arms * passive).sum(axis=1)
    lower = np.array([0.0, 0.0, 0.0, extensor_min, extensor_min, extensor_min])
    min_moment = np.minimum(weights, weights * lower).sum(axis=1)
    max_moment = np.maximum(weights, weights * lower).sum(axis=1)
    bad = np.flatnonzero((demand < min_moment - 1e-7) | (demand > max_moment + 1e-7))
    if len(bad):
        i = bad[0]
        raise ScenarioError(
            f"{path[i, 0]:.2f} 秒的所需主动力矩 {demand[i]:.2f} N·m 超过此姿势的"
            f"可用范围 [{min_moment[i]:.2f}, {max_moment[i]:.2f}]。"
            "可延长抬放时间、降低负重或放松伸肌约束。"
        )
    # KKT solution for minimum sum of squared activations under scalar moment balance.
    nonzero = np.where(np.abs(weights) > 1e-12, np.abs(weights), np.inf)
    bound = (1 / np.min(nonzero, axis=1) + 1)[:, None]
    lo, hi = -bound, bound
    for _ in range(56):
        mid = (lo + hi) * 0.5
        below = ((np.clip(mid * weights, lower, 1) * weights).sum(axis=1) < demand)[
            :, None
        ]
        lo = np.where(below, mid, lo)
        hi = np.where(below, hi, mid)
    return np.clip((lo + hi) * 0.5 * weights, lower, 1), weights, demand, lower


def bounded_controls(path, activations, weights, demand, lower):
    """Find a nearby feasible activation sequence with bounded excitation throughout each interval."""
    n, m = activations.shape
    dt = np.diff(path[:, 0])[:, None]
    change = np.diff(activations, axis=0) / dt
    if np.all(activations[1:] + RISE_TIME * change <= 1 + 1e-10) and np.all(
        activations[1:] + FALL_TIME * change >= -1e-10
    ):
        return activations
    count = n * m
    identity = sparse.eye(count, format="csr")
    next_node = identity[m:]
    diff = next_node - identity[:-m]
    rate = sparse.diags(np.repeat(1 / dt.ravel(), m)) @ diff
    upper = next_node + RISE_TIME * rate
    negative_lower = -next_node - FALL_TIME * rate
    rates = sparse.vstack([upper, negative_lower])
    # Second block bounds the absolute deviation from the static optimal reference.
    inequalities = sparse.vstack(
        [
            sparse.hstack([rates, sparse.csr_matrix((rates.shape[0], count))]),
            sparse.hstack([identity, -identity]),
            sparse.hstack([-identity, -identity]),
        ],
        format="csr",
    )
    limit = np.r_[
        np.ones((n - 1) * m),
        np.zeros((n - 1) * m),
        activations.ravel(),
        -activations.ravel(),
    ]
    equilibrium = sparse.coo_matrix(
        (weights.ravel(), (np.repeat(np.arange(n), m), np.arange(count))),
        shape=(n, count),
    ).tocsr()
    answer = linprog(
        np.r_[np.zeros(count), np.ones(count)],
        A_ub=inequalities,
        b_ub=limit,
        A_eq=sparse.hstack([equilibrium, sparse.csr_matrix((n, count))]),
        b_eq=demand,
        bounds=[(float(x), 1.0) for x in np.tile(lower, n)] + [(0, None)] * count,
        method="highs",
    )
    if not answer.success:
        raise ScenarioError(
            "肌肉无法在给定时间内建立或释放足够张力；请延长相邻关键帧的间隔。"
        )
    return np.clip(answer.x[:count].reshape(n, m), lower, 1.0)


def evaluate(path, scene, mass):
    data = mechanical_data(path, mass, scene["radiusM"])
    active, weights, demand, lower = recruit(path, data, scene["extensorMin"])
    if scene["mode"] == "predict":
        active = bounded_controls(path, active, weights, demand, lower)
    torque, arms, passive, capacity = data
    forces = passive + capacity * active
    residual = np.max(abs((arms * forces).sum(axis=1) - torque))
    if not np.isfinite(forces).all() or residual > 0.10:
        raise ScenarioError("该实验未达到力矩平衡容差。")
    return {
        "torque": torque,
        "forces": forces,
        "active": active,
        "residual": float(residual),
    }


def excitation_interval(a, a_next, dt):
    slope = (a_next - a) / dt
    tau = np.where(slope >= 0, RISE_TIME, FALL_TIME)
    return a + tau * slope, a_next + tau * slope, tau


def replay(path, active, mass, radius, dynamic=False):
    """Feed controls to a free elbow; do not impose target poses after initialization."""

    def derivative(state, activation):
        q = float(np.clip(state[0], 0, engine.MAX_ANGLE))
        v = engine.mechanics(q, float(state[1]), 0.0, mass, radius)
        forces = np.asarray(v["passive"]) + np.asarray(v["capacity"]) * activation
        return np.array(
            [state[1], (np.dot(v["arms"], forces) - v["torque"]) / v["inertia"]]
        )

    state = np.array([path[0, 1], path[0, 2]])
    angle_errors = [0.0]
    max_excursion = 0.0
    activation_state = active[0].copy()
    for i, dt in enumerate(np.diff(path[:, 0])):
        start = activation_state
        if dynamic:
            # Exact solution of da/dt=(u-a)/tau for a linear excitation on this interval.
            u0, u1, tau = excitation_interval(active[i], active[i + 1], dt)
            slope = (u1 - u0) / dt
            transient = start - u0 + tau * slope
            middle = u0 + (dt / 2 - tau) * slope + transient * np.exp(-dt / (2 * tau))
            end = u1 - tau * slope + transient * np.exp(-dt / tau)
        else:
            end = active[i + 1]
            middle = (start + end) / 2
        k1 = derivative(state, start)
        k2 = derivative(state + dt * k1 / 2, middle)
        k3 = derivative(state + dt * k2 / 2, middle)
        k4 = derivative(state + dt * k3, end)
        state += dt * (k1 + 2 * k2 + 2 * k3 + k4) / 6
        activation_state = end
        actual_angle = math.degrees(state[0])
        max_excursion = max(max_excursion, -actual_angle, actual_angle - 130)
        angle_errors.append(abs(actual_angle - math.degrees(path[i + 1, 1])))
    return max(angle_errors), max_excursion


def choose_motion(scene):
    """Search the timing of each moving segment; both muscle capacity and rate limits affect feasibility."""
    keys = scene["keyframes"]
    directions = np.sign(np.diff([key["angle"] for key in keys]))
    predicting = scene["mode"] == "predict"
    options = {}
    feasible = []

    def test(warp):
        warp = tuple(round(float(x), 5) for x in warp)
        if warp in options:
            return
        path = trajectory(keys, warp)
        try:
            result = evaluate(path, scene, scene["loadKg"])
        except ScenarioError as exc:
            options[warp] = {
                "warp": list(warp),
                "forceFeasible": False,
                "replayStatus": "not-tested",
                "reason": str(exc),
            }
            return
        duration = path[-1, 0]
        effort = float(
            np.trapezoid((result["active"] ** 2).sum(axis=1), path[:, 0]) / duration
        )
        jerk = float(np.trapezoid((path[:, 4] / 100) ** 2, path[:, 0]) / duration)
        cost = effort + (0.002 if scene["objective"] == "effort" else 2.0) * jerk
        options[warp] = {
            "warp": list(warp),
            "forceFeasible": True,
            "replayStatus": "not-tested",
            "cost": cost,
            "effort": effort,
            "jerk": jerk,
        }
        feasible.append((cost, warp, path, result))

    zero = np.zeros(len(directions))
    test(zero)
    if predicting:
        for seed in (
            0.33 * directions,
            -0.33 * directions,
            0.33 * abs(directions),
            -0.33 * abs(directions),
        ):
            test(seed)
        for step in (0.16, 0.08):
            if not feasible:
                break
            for segment in np.flatnonzero(directions):
                best = np.array(min(feasible, key=lambda item: item[0])[1])
                for sign in (-1, 1):
                    candidate = best.copy()
                    candidate[segment] += sign * step
                    test(candidate)
    for _, warp, path, result in sorted(feasible, key=lambda item: item[0]):
        try:
            reference = evaluate(path, scene, 0.0) if scene["loadKg"] else result
        except ScenarioError as exc:
            options[warp]["replayStatus"] = "rejected"
            options[warp]["replayRejected"] = "空手对照不可行。" + str(exc)
            continue
        forward_error, loaded_excursion = replay(
            path, result["active"], scene["loadKg"], scene["radiusM"], predicting
        )
        ref_error, ref_excursion = (
            replay(path, reference["active"], 0.0, scene["radiusM"], predicting)
            if scene["loadKg"]
            else (forward_error, loaded_excursion)
        )
        if (
            math.isfinite(max(forward_error, ref_error))
            and max(forward_error, ref_error) <= 1
        ):
            options[warp]["replayStatus"] = "passed"
            return (
                path,
                result,
                reference,
                warp,
                list(options.values()),
                forward_error,
                ref_error,
                max(loaded_excursion, ref_excursion),
            )
        options[warp]["replayStatus"] = "rejected"
        options[warp]["replayRejected"] = (
            f"前向回放最大偏差 {max(forward_error, ref_error):.2f}°，超过 1° 验收线。"
        )
    first = next(iter(options.values()))
    raise ScenarioError(
        first.get("replayRejected")
        or first.get("reason")
        or "这些目标下没有找到通过验证的方案。"
    )


def solve(raw_scene):
    scene = normalize(raw_scene)
    if pose_dynamics.needs_pose_model(scene["keyframes"]):
        return pose_dynamics.solve_pose(raw_scene, scene, FPS)
    predicting = scene["mode"] == "predict"
    path, result, reference, bias, options, forward_error, ref_error, excursion = (
        choose_motion(scene)
    )
    replay_error = max(forward_error, ref_error)
    frames = []
    for i, (t, q, dq, ddq, _) in enumerate(path):
        frame = {
            "t": float(t),
            "angle": math.degrees(q),
            "speedRadS": float(dq),
            "accelRadS2": float(ddq),
            "torque": float(result["torque"][i]),
            "referenceTorque": float(reference["torque"][i]),
            "loadTorque": float(result["torque"][i] - reference["torque"][i]),
            "forces": result["forces"][i].tolist(),
            "activations": result["active"][i].tolist(),
            "referenceForces": reference["forces"][i].tolist(),
            "referenceActivations": reference["active"][i].tolist(),
        }
        for name in pose_dynamics.LIMITS:
            frame[name] = scene["keyframes"][0].get(name, 0.0)
        if predicting and i < len(path) - 1:
            a, a_next = result["active"][i : i + 2]
            u0, u1, _ = excitation_interval(a, a_next, path[i + 1, 0] - t)
            frame["excitationInterval"] = {"start": u0.tolist(), "end": u1.tolist()}
        frames.append(frame)
    return {
        "schema": 1,
        "kinematicOnly": False,
        "input": copy.deepcopy(raw_scene),
        "scene": copy.deepcopy(scene),
        "model": engine.model_info(),
        "frames": frames,
        "diagnostics": {
            "solver": "分段时间优化与整段配力约束"
            if predicting
            else "给定轨迹的逐帧最小平方激活",
            "maxResidualNm": max(result["residual"], reference["residual"]),
            "forwardMaxErrorDeg": replay_error,
            "loadedForwardErrorDeg": forward_error,
            "emptyForwardErrorDeg": ref_error,
            "selectedWarp": list(bias),
            "candidates": options,
            "forwardRangeExcursionDeg": excursion,
            "fps": FPS,
            "reserveTorqueNm": 0,
            "activationTimeS": [RISE_TIME, FALL_TIME] if predicting else None,
        },
        "assumptions": [
            "右侧肩锁定，屈肘单自由度；前臂旋转方向固定。",
            "点载荷随前臂转动。输入距离是水平保持时的力臂，动态段还计入点质量惯量。",
            "参照为空手、同轨迹、同一拮抗设置。颜色与曲线表示模型估计，未做真人逐肌力验证。",
            "前向回放仅在插值查表时限制角度；未实现硬关节止挡，微小数值越界量另行记录。",
            (
                "预测在受限的平滑轨迹族内逐段搜索中间姿势；关键帧处停稳。用有界兴奋控制激活的建立与释放。"
                if predicting
                else "规定轨迹每段用五次曲线起停；逐帧配力，未约束神经兴奋变化率。"
            ),
        ],
    }
