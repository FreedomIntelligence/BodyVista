"""All-muscle inverse recruitment with explicit supports and failure residuals.

No non-muscle internal actuator is admitted. Scalar equality coordinates are
eliminated by the exact source polynomial Jacobian before muscle recruitment.
"""

import math
import time
from collections import Counter
from copy import deepcopy
import warnings

import mujoco
import numpy as np
from scipy.optimize import OptimizeWarning, linprog as _linprog, lsq_linear

from . import grasp
from .fullbody_engine import (
    MODEL_ID,
    WORLD,
    ScenarioError,
    context,
    dense_moments,
    finite,
)

FPS = 12
FRICTION = 0.7
CONTACT_TOLERANCE = 0.025
PENETRATION_TOLERANCE = 0.005
FOOT_STATIONS = [
    (-0.025, -0.0151348, -0.035),
    (-0.025, -0.0151348, 0.035),
    (0.19, -0.0151348, -0.035),
    (0.19, -0.0151348, 0.035),
]


def linprog(*args, options=None, **kwargs):
    """HiGHS has its own scheduler, separate from the BLAS thread limits."""
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message=r"Unrecognized options detected:.*'threads': 1.*",
                                category=OptimizeWarning)
        return _linprog(*args, options={**(options or {}), "threads": 1}, **kwargs)


def normalize(scene):
    if not isinstance(scene, dict):
        raise ScenarioError("动作方案必须是对象。")
    # Reject removed equipment before loading the model or evaluating poses.
    grasp.equipment(scene)
    ctx = context()
    raw = scene.get("keyframes")
    if not isinstance(raw, list) or not 2 <= len(raw) <= 10:
        raise ScenarioError("需要 2 至 10 个已确认姿势。")
    keys = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ScenarioError("关键帧必须是对象。")
        t = finite(item.get("t"), "关键帧时间")
        if (
            (i == 0 and abs(t) > 1e-9)
            or t < 0
            or t > 30
            or (i and t - keys[-1]["t"] < 0.2 - 1e-9)
        ):
            raise ScenarioError("首帧须为 0 秒，相邻至少 0.2 秒，总时长不超过 30 秒。")
        keys.append({"t": t, "q": ctx.normalize_q(item.get("q"))})
    load = finite(scene.get("loadKg", 0), "手持质量")
    if not 0 <= load <= 50:
        raise ScenarioError("手持总质量范围为 0 至 50 kg。")
    support, hand = scene.get("support", "seated"), scene.get("hand", "right")
    if support not in ("seated", "assisted", "feet", "free") or hand not in (
        "right",
        "left",
        "both",
    ):
        raise ScenarioError("支撑或持物方式无效。")
    ground_enabled = scene.get("groundEnabled", support == "feet")
    if not isinstance(ground_enabled, bool):
        raise ScenarioError("groundEnabled 必须是布尔值。")
    if support == "feet" and not ground_enabled:
        raise ScenarioError(
            "没有地面时不能选择足底支撑；请选择无外部支撑或显式骨盆支架。"
        )
    equipment = scene.get("equipment", {"type": "dumbbell"})
    if not isinstance(equipment, dict) or equipment.get("type") not in (
        "dumbbell",
        "none",
    ):
        raise ScenarioError("配重器械无效。")
    equipment = grasp.equipment(dict(scene, loadKg=load, hand=hand))
    feet = scene.get("supportFeet", "both")
    if feet not in ("right", "left", "both"):
        raise ScenarioError("承重脚无效。")
    strength = finite(scene.get("strengthScale", 1), "肌力倍率")
    if not 0.5 <= strength <= 1.5:
        raise ScenarioError("肌力倍率范围为 0.5 至 1.5。")
    scales = scene.get("muscleScale", {})
    if not isinstance(scales, dict):
        raise ScenarioError("逐肌倍率必须是对象。")
    for name, value in scales.items():
        if name not in ctx.muscle_names or not 0.5 <= finite(value, name) <= 1.5:
            raise ScenarioError("逐肌倍率必须使用模型肌肉名称，范围为 0.5 至 1.5。")
    preview = scene.get("preview", False)
    if not isinstance(preview, bool):
        raise ScenarioError("preview 必须是布尔值。")
    return {
        "keyframes": keys,
        "loadKg": load,
        "hand": hand,
        "support": support,
        "groundEnabled": ground_enabled,
        "supportFeet": feet,
        "strengthScale": strength,
        "muscleScale": scales,
        "preview": preview,
        "equipment": equipment,
    }


def sample(scene, t):
    keys = scene["keyframes"]
    index = next(
        (i for i in range(len(keys) - 1) if t <= keys[i + 1]["t"] + 1e-12),
        len(keys) - 2,
    )
    a, b = keys[index : index + 2]
    dt = b["t"] - a["t"]
    u = float(np.clip((t - a["t"]) / dt, 0, 1))
    h, dh, ddh = (
        u**3 * (10 - 15 * u + 6 * u * u),
        30 * u * u * (1 - u) ** 2 / dt,
        60 * u * (1 - 3 * u + 2 * u * u) / dt**2,
    )
    q, v, acc = {}, {}, {}
    for name in a["q"]:
        delta = b["q"][name] - a["q"][name]
        q[name], v[name], acc[name] = a["q"][name] + h * delta, dh * delta, ddh * delta
    return q, v, acc


def point_jacobian(ctx, data, body_id, local):
    point = data.xpos[body_id] + data.xmat[body_id].reshape(3, 3) @ np.asarray(local)
    jac, jacdot = np.zeros((3, ctx.model.nv)), np.zeros((3, ctx.model.nv))
    mujoco.mj_jac(ctx.model, data, jac, None, point, body_id)
    mujoco.mj_jacDot(ctx.model, data, jacdot, None, point, body_id)
    return point, jac, jacdot


def muscle_laws(ctx, data, scale):
    m = ctx.model
    if ctx.hand_elasticity:
        ctx.hand_elasticity.assert_installed()
    gain, bias = np.empty(m.nu), np.empty(m.nu)
    for i in range(m.nu):
        gain[i] = mujoco.mju_muscleGain(
            data.actuator_length[i],
            data.actuator_velocity[i],
            m.actuator_lengthrange[i],
            m.actuator_acc0[i],
            m.actuator_gainprm[i, :9],
        )
        bias[i] = ctx.hand_elasticity.bias(m, data, i) if ctx.hand_elasticity else mujoco.mju_muscleBias(
            data.actuator_length[i],
            m.actuator_lengthrange[i],
            m.actuator_acc0[i],
            m.actuator_biasprm[i, :9],
        )
    return gain * scale, bias * scale


def gravity_metadata(ctx, scene):
    """Describe gravity already included by mj_rne; never add its force again."""
    acceleration = WORLD @ ctx.model.opt.gravity
    magnitude = float(np.linalg.norm(acceleration))
    return {
        "enabled": True,
        "accelerationMps2": acceleration.tolist(),
        "bodyMassKg": ctx.mass,
        "loadMassKg": scene["loadKg"],
        "bodyWeightN": ctx.mass * magnitude,
        "totalWeightN": (ctx.mass + scene["loadKg"]) * magnitude,
        "explanation": "人体重力始终包含在原生逆动力学中；持物重力单独加入一次。地面开关只改变接触条件。",
    }


def ground_check(ctx, data, scene):
    """Check the actual bone meshes and sole stations against world height zero.

    MuJoCo's processed mesh vertices are in the corresponding geom frame.
    These are collision diagnostics only: no unmodelled soft-tissue contact or
    ground reaction is inferred for a supported pelvis, hand, knee or torso.
    """
    result = {
        "enabled": scene["groundEnabled"],
        "heightM": 0.0,
        "feasible": True,
        "penetrationMaxM": 0.0,
        "checkedBoneMeshes": 0,
        "penetratingBodies": [],
        "scope": "全部骨骼网格及双足底站点；未包含软组织碰撞，也未求解手、膝或躯干地面支撑。",
    }
    if not scene["groundEnabled"]:
        return result
    model = ctx.model
    minimums = {}
    for geom in range(model.ngeom):
        if model.geom_type[geom] != mujoco.mjtGeom.mjGEOM_MESH:
            continue
        mesh = int(model.geom_dataid[geom])
        start, count = int(model.mesh_vertadr[mesh]), int(model.mesh_vertnum[mesh])
        vertices = model.mesh_vert[start : start + count]
        if not count:
            continue
        # Native Z is world Y. Only its projected coordinate is required.
        heights = vertices @ data.geom_xmat[geom].reshape(3, 3)[2]
        minimum = float(np.min(heights) + data.geom_xpos[geom, 2])
        body = model.body(int(model.geom_bodyid[geom])).name
        minimums[body] = min(minimums.get(body, math.inf), minimum)
        result["checkedBoneMeshes"] += 1
    for side in "rl":
        body = "calcn_" + side
        body_id = ctx.body_ids[body]
        rotation = data.xmat[body_id].reshape(3, 3)
        lowest = min(
            float((rotation @ np.asarray(local) + data.xpos[body_id])[2])
            for local in FOOT_STATIONS
        )
        minimums[body] = min(minimums.get(body, math.inf), lowest)
    minimum = min(minimums.values())
    result["minimumHeightM"] = minimum
    result["penetrationMaxM"] = max(0.0, -minimum)
    result["feasible"] = result["penetrationMaxM"] < PENETRATION_TOLERANCE
    result["penetratingBodies"] = [
        {"body": body, "penetrationM": -height}
        for body, height in sorted(minimums.items(), key=lambda item: item[1])
        if height <= -PENETRATION_TOLERANCE
    ]
    return result


def recruit(matrix, target, limit_matrix, tolerance):
    """Minimum activation-sum LP, followed by explicit diagnostic residuals.

    Bound-active joint stops are unidirectional external constraints, never
    hidden ideal actuators. If exact equilibrium is infeasible, weighted L1
    residual fitting identifies the failure; it does not convert it to success.
    """
    n = matrix.shape[1]
    count = limit_matrix.shape[1]
    a = np.column_stack([matrix, limit_matrix])
    cost = np.r_[np.ones(n), np.full(count, 1e-4)]
    bounds = [(0.0, 1.0)] * n + [(0.0, None)] * count
    options = {"primal_feasibility_tolerance": 1e-9, "dual_feasibility_tolerance": 1e-9}
    exact = linprog(
        cost, A_eq=a, b_eq=target, bounds=bounds, method="highs", options=options
    )
    result = exact
    if not exact.success:
        eye = np.eye(len(target))
        result = linprog(
            np.r_[cost * 1e-7, 1 / tolerance, 1 / tolerance],
            A_eq=np.column_stack([a, eye, -eye]),
            b_eq=target,
            bounds=bounds + [(0.0, None)] * (2 * len(target)),
            method="highs",
            options=options,
        )
    if not result.success or result.x is None:
        raise RuntimeError("全身配力数值求解失败：" + str(result.message))
    return (
        result.x[:n],
        result.x[n : n + count],
        {
            "success": bool(exact.success),
            "iterations": int(result.nit),
            "message": str(exact.message),
            "objective": "minimum-activation-sum",
            "diagnosticResidualFit": not exact.success,
        },
    )


def support_forces(ctx, data, projection, required, scene):
    base = [i for i, n in enumerate(ctx.names) if n.startswith("pelvis_")]
    if scene["support"] in ("seated", "assisted"):
        return np.zeros_like(required), {
            "mode": scene["support"],
            "feasible": True,
            "forces": [],
            "baseResidual": {ctx.names[i]: float(required[i]) for i in base},
            "explanation": "骨盆外部支架承担根部合力与力矩；所有内部关节仍由740肌肉共同求解。",
        }
    if scene["support"] == "free":
        residual = {ctx.names[i]: float(required[i]) for i in base}
        return np.zeros_like(required), {
            "mode": "free",
            "feasible": bool(np.max(np.abs(required[base])) < 0.1),
            "forces": [],
            "baseResidual": residual,
            "explanation": "无外部支撑，不产生地面或骨盆辅助力；输入动作必须自行满足重力下的整体运动方程。",
        }
    sides = (
        ["r", "l"]
        if scene["supportFeet"] == "both"
        else ["r" if scene["supportFeet"] == "right" else "l"]
    )
    points, matrices, columns = [], [], []
    # Explicit rectangular foot support approximation, not automatic collision.
    stations = FOOT_STATIONS
    rays = np.array(
        [
            [0, 0, 1],
            [FRICTION, 0, 1],
            [-FRICTION, 0, 1],
            [0, FRICTION, 1],
            [0, -FRICTION, 1],
        ],
        dtype=float,
    ).T
    for side in sides:
        body_id = ctx.body_ids["calcn_" + side]
        for local in stations:
            point, jac, _ = point_jacobian(ctx, data, body_id, local)
            projected = projection.T @ jac.T
            points.append((side, point))
            matrices.append(projected)
            columns.append(projected @ rays)
    contact = np.column_stack(columns)
    fit = lsq_linear(
        contact[base],
        required[base],
        bounds=(0.0, np.inf),
        method="trf",
        tol=1e-9,
        max_iter=100,
    )
    total = contact @ fit.x
    root_error = required[base] - total[base]
    height_error = max(abs(float(p[2])) for _, p in points)
    all_heights = []
    for side in "rl":
        for local in stations:
            point, _, _ = point_jacobian(
                ctx, data, ctx.body_ids["calcn_" + side], local
            )
            all_heights.append(float(point[2]))
    penetration = max(0.0, -min(all_heights))
    valid = bool(
        np.max(np.abs(root_error)) < 0.1
        and height_error < CONTACT_TOLERANCE
        and penetration < PENETRATION_TOLERANCE
    )
    forces = [
        {
            "side": "right" if side == "r" else "left",
            "point": (WORLD @ point).tolist(),
            "force": (WORLD @ (rays @ fit.x[5 * i : 5 * i + 5])).tolist(),
        }
        for i, (side, point) in enumerate(points)
    ]
    return total, {
        "mode": "feet",
        "feasible": valid,
        "forces": forces,
        "heightErrorM": height_error,
        "contactHeightMaxM": height_error,
        "penetrationMaxM": penetration,
        "baseResidual": {
            ctx.names[i]: float(root_error[k]) for k, i in enumerate(base)
        },
        "explanation": "显式足底矩形接触、单向法向力及摩擦锥；两脚均检查穿地，未通过时不输出有效肌力。",
    }


def recruit_grasp(matrix, target, limit_matrix, tolerance, system, internal):
    """Jointly solve muscle activation and unilateral hand-object contact.

    A contact applies equal/opposite forces to its actual phalanx and to the
    equipment. Six object equations retain both force and moment equilibrium.
    """
    n, stops, contacts = matrix.shape[1], limit_matrix.shape[1], system["jointMatrix"].shape[1]
    upper = np.column_stack([matrix, limit_matrix, system["jointMatrix"][internal]])
    lower = np.column_stack([np.zeros((len(system["target"]), n + stops)), system["objectMatrix"]])
    a = np.vstack([upper, lower])
    target = np.r_[target, system["target"]]
    cost = np.r_[np.ones(n), np.full(stops, 1e-4), np.full(contacts, 1e-6)]
    bounds = [(0., 1.)] * n + [(0., None)] * (stops + contacts)
    options = {"primal_feasibility_tolerance": 1e-9, "dual_feasibility_tolerance": 1e-9}
    exact = linprog(cost, A_eq=a, b_eq=target, bounds=bounds, method="highs", options=options)
    result = exact
    if not exact.success:
        residual_weights = 1 / np.r_[tolerance, np.full(len(system["target"]), 1e-5)]
        eye = np.eye(len(target))
        result = linprog(np.r_[cost * 1e-7, residual_weights, residual_weights],
                         A_eq=np.column_stack([a, eye, -eye]), b_eq=target,
                         bounds=bounds + [(0., None)] * (2 * len(target)), method="highs", options=options)
    if not result.success or result.x is None:
        raise RuntimeError("握持与全身肌肉联合配力失败：" + str(result.message))
    return result.x[:n], result.x[n:n + stops], result.x[n + stops:n + stops + contacts], {
        "success": bool(exact.success), "iterations": int(result.nit), "message": str(exact.message),
        "objective": "minimum-activation-sum-with-grasp", "diagnosticResidualFit": not exact.success}


def solve_frame(q, velocity, acceleration, scene, initial=None):
    ctx = context()
    m = ctx.model
    data, projection = ctx.state(q, velocity, acceleration)
    ground_status = ground_check(ctx, data, scene)
    gravity = gravity_metadata(ctx, scene)
    anatomy = ctx.anatomy_report(q, data)
    rne = np.zeros(m.nv)
    mujoco.mj_rne(m, data, 1, rne)
    # mj_rne includes rigid body inertia but excludes model rotor/armature
    # inertia. The source defines it on 243 DOFs, including restored spine axes.
    rne += m.dof_armature * data.qacc
    raw = projection.T @ rne
    joint_passive = projection.T @ data.qfrc_passive
    hand_reference = np.zeros(len(ctx.names))
    if ctx.hand_elasticity:
        hand_reference[ctx.hand_elasticity.indices] = ctx.hand_elasticity.correction(
            q, lambda reference: ctx.state(reference, _skip_hand_correction=True), dense_moments)
    other_joint_passive = joint_passive - hand_reference
    required = raw - joint_passive
    loads = []
    contact_system = grasp.contact_system(ctx, data, projection, scene) if scene["loadKg"] else None
    # The equivalent COM wrench determines external root/foot support only.
    # Internal joints receive the actual contact reactions in the joint LP.
    equivalent = contact_system["equivalent"] if contact_system else np.zeros_like(required)
    if contact_system:
        loads = [{"side": "both" if len(o["sides"]) == 2 else "right" if o["sides"][0] == "r" else "left",
                  "massKg": o["massKg"], "point": (WORLD @ o["center"]).tolist(),
                  "force": (WORLD @ -o["wrench"][:3]).tolist(),
                  "moment": (WORLD @ -o["wrench"][3:]).tolist(),
                  "acceleration": (WORLD @ (o["wrench"][:3] / o["massKg"] + m.opt.gravity)).tolist()}
                 for o in contact_system["objects"]]
    ground, support = support_forces(ctx, data, projection, required + equivalent, scene)
    # Only external terms actually subtracted from net joint demand belong in
    # this ledger. Assisted pelvis support is reported separately by support.
    external_torque = ground.copy()
    required -= ground
    scale = np.array(
        [
            scene["strengthScale"] * scene["muscleScale"].get(n, 1.0)
            for n in ctx.muscle_names
        ]
    )
    gain, bias = muscle_laws(ctx, data, scale)
    moments = dense_moments(m, data) @ projection
    active_matrix = moments.T * gain[None, :]
    passive_torque = moments.T @ bias
    internal = np.array(
        [i for i, n in enumerate(ctx.names) if not n.startswith("pelvis_")]
    )
    tolerance = np.array(
        [
            1e-4
            if ctx.region(int(m.jnt_bodyid[ctx.joint_ids[ctx.names[i]]])).startswith(
                "hand_"
            )
            else 0.001
            for i in internal
        ]
    ) + 0.001 * np.abs(required[internal])
    limit_columns, limit_names = [], []
    for row, index in enumerate(internal):
        name = ctx.names[int(index)]
        loaded_side = scene["hand"] == "both" or name.endswith("_l") == (scene["hand"] == "left")
        if contact_system and loaded_side and grasp.FINGER_PATTERN.match(name):
            # Source coordinate bounds are not a calibrated passive clamp.
            # Letting stops hold a grasp would allow unlimited fictitious squeeze.
            continue
        # This flexion-conditioned envelope is an editing guard, not a
        # validated ligament/contact model. Do not invent an axial stop force.
        if name.startswith("knee_rotation_"):
            continue
        lo, hi = ctx.bounds(name)
        sign = (
            1.0
            if abs(q[name] - lo) < 1e-6
            else -1.0
            if abs(q[name] - hi) < 1e-6
            else 0.0
        )
        # A stop cannot support a joint that is leaving its boundary. The
        # prescribed quintic keys have zero speed/acceleration when held there.
        if (
            sign
            and abs(velocity.get(name, 0.0)) < 1e-7
            and abs(acceleration.get(name, 0.0)) < 1e-7
        ):
            column = np.zeros(len(internal))
            column[row] = sign
            limit_columns.append(column)
            limit_names.append(name)
    limit_matrix = (
        np.column_stack(limit_columns)
        if limit_columns
        else np.zeros((len(internal), 0))
    )
    grasp_output = None
    if contact_system:
        activation, limit_force, contact_coefficients, optimizer = recruit_grasp(
            active_matrix[internal], (required - passive_torque)[internal],
            limit_matrix, tolerance, contact_system, internal)
        grasp_output = grasp.force_report(ctx, data, scene, contact_system, contact_coefficients)
        # Expose each joint's net demand after its own physical hand reaction.
        contact_torque = contact_system["jointMatrix"] @ contact_coefficients
        required -= contact_torque
        external_torque += contact_torque
    else:
        activation, limit_force, optimizer = recruit(
            active_matrix[internal], (required - passive_torque)[internal], limit_matrix, tolerance)
    signed_force = gain * activation + bias
    muscle_torque = moments.T @ signed_force
    stop_torque = np.zeros(len(ctx.names))
    stop_torque[internal] = limit_matrix @ limit_force
    residual = required - muscle_torque - stop_torque
    # At redundant shoulder coordinates, cancellation can leave ~1e-9 Nm in a
    # structurally zero row and HiGHS may label exact equality infeasible. This
    # numerical roundoff allowance is far below the 1e-4 Nm finger threshold.
    numerical_balance = bool(np.max(np.abs(residual[internal])) <= 1e-7)
    balance_ok = bool(
        (optimizer["success"] or numerical_balance)
        and np.all(np.abs(residual[internal]) <= tolerance)
    )
    optimizer["numericalBalanceAccepted"] = bool(
        not optimizer["success"] and numerical_balance
    )
    # Independent native actuation evaluation validates force-law/sign handling.
    for i in range(m.nu):
        adr = int(m.actuator_actadr[i])
        if adr >= 0:
            data.act[adr] = activation[i]
        else:
            data.ctrl[i] = activation[i]
    if ctx.hand_elasticity:
        ctx.hand_elasticity.assert_installed()
    mujoco.mj_fwdActuation(m, data)
    native_error = float(np.max(np.abs(data.actuator_force * scale - signed_force)))
    finite_result = bool(
        np.all(np.isfinite(signed_force)) and np.all(np.isfinite(residual))
    )
    valid = bool(
        balance_ok
        and support["feasible"]
        and ground_status["feasible"]
        and anatomy["valid"]
        and native_error < 1e-6
        and finite_result
        and (grasp_output is None or grasp_output["grasp"]["feasible"])
    )
    frame = ctx.snapshot(data, q)
    for i, muscle in enumerate(frame["muscles"]):
        muscle.update(
            {
                "force": float(-signed_force[i]) if valid else None,
                "activation": float(activation[i]) if valid else None,
                "activeCapacity": float(-gain[i]) if valid else None,
                "passiveForce": float(-bias[i]) if valid else None,
            }
        )
        for branch in muscle.get("branches", []):
            branch["force"] = muscle["force"] * branch["coefficient"] if valid else None
    worst = sorted(internal, key=lambda i: abs(residual[i]), reverse=True)[:10]
    errors = []
    if not balance_ok:
        errors.append(
            "740肌肉共同配力未满足全部内部关节；最大未平衡量位于 "
            + ctx.names[int(worst[0])]
            + f"（{abs(residual[worst[0]]):.3f} Nm）。"
        )
    if not support["feasible"]:
        errors.append(
            "没有外部支撑，输入动作不满足重力下的整体受力与运动平衡；静止悬空不能由内部肌肉维持。"
            if scene["support"] == "free"
            else "足底支撑不满足接触高度、单向承重、摩擦或根部平衡条件。"
        )
    if not ground_status["feasible"]:
        errors.append(
            f"身体穿入地面，最大深度 {ground_status['penetrationMaxM'] * 100:.1f} cm；当前姿势保留，肌力停用。"
        )
    if not anatomy["valid"]:
        errors.append(
            "姿势超出当前解剖约束："
            + "；".join(item["label"] for item in anatomy["violations"][:3])
            + "。保留动作，停用肌力。"
        )
    if grasp_output:
        if not grasp_output["grasp"]["feasible"]:
            errors.append(grasp_output["grasp"]["reason"])
        grasp_output["grasp"]["feasible"] = valid
        if not valid:
            grasp_output["grasp"]["status"] = "grasp-infeasible"
            if grasp_output["grasp"]["geometryValid"] and not balance_ok:
                grasp_output["grasp"]["reason"] = "手指虽已接触，当前模型仍未找到同时满足肌肉、摩擦与器械平衡约束的解。"
            grasp.hide_forces(grasp_output["grasp"])
        else:
            grasp_output["grasp"]["reason"] = "在声明的皮肤胶囊、摩擦与肌肉参数下，接触和全身力矩共同配平。"
        frame.update(grasp_output)
    frame.update(
        {
            "torques": dict(zip(ctx.names, required.tolist())),
            "rawTorques": dict(zip(ctx.names, raw.tolist())),
            "muscleTorques": dict(zip(ctx.names, muscle_torque.tolist()))
            if valid
            else None,
            "passiveTorques": dict(zip(ctx.names, passive_torque.tolist())),
            "jointPassiveTorques": dict(zip(ctx.names, joint_passive.tolist())),
            "reserveTorques": dict(zip(ctx.names, residual.tolist())),
            "idealActuatorTorques": {},
            "fixedJointReactions": {},
            "jointLimitTorques": {
                n: float(stop_torque[ctx.index[n]]) for n in limit_names
            },
            "support": support,
            "groundCheck": ground_status,
            "gravity": gravity,
            "anatomy": anatomy,
            "loads": loads,
            "muscleValid": valid,
            "frameFeasible": valid,
            "quantitativeValid": valid,
            "balanceErrorNm": float(np.max(np.abs(residual[internal]))),
            "nativeForceErrorN": native_error,
            "errors": errors,
            "velocity": velocity,
            "acceleration": acceleration,
            "recruitment": {
                "musclesIncluded": m.nu,
                "internalCoordinatesIncluded": len(internal),
                "optimizer": optimizer,
                "worstResiduals": [
                    {
                        "name": ctx.names[int(i)],
                        "residualNm": float(residual[i]),
                        "requiredNm": float(required[i]),
                    }
                    for i in worst
                ],
            },
        }
    )
    if ctx.hand_elasticity:
        frame.update(
            handReferenceTorques={name: float(hand_reference[ctx.index[name]])
                                  for name in ctx.hand_elasticity.names} if valid else None,
            otherJointPassiveTorques=dict(zip(ctx.names, other_joint_passive.tolist())) if valid else None,
            externalTorques=dict(zip(ctx.names, external_torque.tolist())) if valid else None,
        )
    return frame, activation


def frame_times(scene):
    """Return every required sample time, including exact keyframe times."""
    duration = scene["keyframes"][-1]["t"]
    return sorted(
        set(
            [
                round(float(t), 8)
                for t in np.linspace(
                    0, duration, min(121, math.ceil(duration * FPS) + 1)
                )
            ]
            + [k["t"] for k in scene["keyframes"]]
        )
    )


def solve(scene):
    started = time.perf_counter()
    scene = normalize(scene)
    duration = scene["keyframes"][-1]["t"]
    times = frame_times(scene)
    frames, initial, cache, initial_contacts = [], None, {}, None
    max_slip = 0.0
    # A moving pose normally appears only once. Keep complete native output
    # solely for frames that will be reused (e.g. a hold), releasing it on its last use.
    def frame_key(values):
        return tuple(round(n,10) for item in values for n in item.values())
    samples = [sample(scene,t) for t in times]
    keys = [frame_key(state) for state in samples]
    remaining = Counter(keys)
    for t,(q,v,acc),key in zip(times,samples,keys,strict=True):
        remaining[key] -= 1
        if key in cache:
            frame = deepcopy(cache[key]) if remaining[key] else cache.pop(key)
        elif scene["preview"]:
            ctx = context()
            data, _ = ctx.state(q)
            frame = ctx.snapshot(data, q)
            frame.update(
                {
                    "torques": {},
                    "rawTorques": {},
                    "muscleTorques": None,
                    "passiveTorques": None,
                    "reserveTorques": {},
                    "muscleValid": False,
                    "frameFeasible": None,
                    "quantitativeValid": False,
                    "support": {
                        "mode": scene["support"],
                        "forces": [],
                        "baseResidual": {},
                    },
                    "groundCheck": ground_check(ctx, data, scene),
                    "gravity": gravity_metadata(ctx, scene),
                    "anatomy": ctx.anatomy_report(q, data),
                    "loads": [],
                    "errors": [],
                }
            )
            if scene["loadKg"]:
                frame.update(grasp.describe(ctx, data, scene))
        else:
            frame, initial = solve_frame(q, v, acc, scene, initial)
        if remaining[key] and key not in cache:
            cache[key] = deepcopy(frame)
        frame["t"] = t
        contacts = frame["support"]["forces"]
        if contacts:
            positions = np.array([c["point"] for c in contacts])
            if initial_contacts is None:
                initial_contacts = positions
            slip = float(
                np.max(
                    np.linalg.norm((positions - initial_contacts)[:, [0, 2]], axis=1)
                )
            )
            max_slip = max(max_slip, slip)
            frame["support"]["slipM"] = slip
            if slip > CONTACT_TOLERANCE:
                frame["quantitativeValid"] = frame["muscleValid"] = frame[
                    "frameFeasible"
                ] = False
                frame["support"]["feasible"] = False
                frame["errors"].append(
                    "足底站点滑移超过2.5 cm；本段不满足固定承重脚约束。"
                )
                frame["muscleTorques"] = None
                for field in ("handReferenceTorques", "otherJointPassiveTorques", "externalTorques"):
                    if field in frame:
                        frame[field] = None
                for mu in frame["muscles"]:
                    mu["force"] = mu["activation"] = mu["activeCapacity"] = mu[
                        "passiveForce"
                    ] = None
                    for branch in mu.get("branches", []):
                        branch["force"] = None
        frames.append(frame)
    failures = [
        {
            "t": f["t"],
            "errors": f["errors"],
            "reasons": f["errors"],
            "balanceErrorNm": f.get("balanceErrorNm"),
        }
        for f in frames
        if not scene["preview"] and not f["quantitativeValid"]
    ]
    if failures:
        for frame in frames:
            frame["quantitativeValid"] = frame["muscleValid"] = False
            frame["muscleTorques"] = None
            for field in ("handReferenceTorques", "otherJointPassiveTorques", "externalTorques"):
                if field in frame:
                    frame[field] = None
            if "grasp" in frame:
                grasp.hide_forces(frame["grasp"], "本段动作存在未通过帧；保留接触几何与残差，停用握持力和肌力。")
            for muscle in frame["muscles"]:
                muscle["force"] = muscle["activation"] = muscle[
                    "activeCapacity"
                ] = muscle["passiveForce"] = None
                for branch in muscle.get("branches", []):
                    branch["force"] = None
    valid = bool(not scene["preview"] and not failures)
    return {
        "model": MODEL_ID,
        "scene": scene,
        "frames": frames,
        "status": "motion-preview"
        if scene["preview"]
        else "solved"
        if valid
        else "infeasible",
        "kinematicOnly": scene["preview"],
        "quantitativeValid": valid,
        "failures": failures,
        "gravity": gravity_metadata(context(), scene),
        "ground": {
            "enabled": scene["groundEnabled"],
            "heightM": 0.0,
            "supportMode": scene["support"],
        },
        "metrics": {
            "frames": len(frames),
            "durationSeconds": duration,
            "solveSeconds": time.perf_counter() - started,
            "allMusclesFeasible": valid,
            "failedFrames": len(failures),
            "musclesIncluded": context().model.nu,
            "balanceMaxNm": max(
                (f.get("balanceErrorNm", 0) for f in frames), default=0
            ),
            "footSlipMaxM": max_slip,
            "contactHeightMaxM": max(
                f["support"].get("heightErrorM", 0) for f in frames
            ),
            "penetrationMaxM": max(
                max(
                    f["support"].get("penetrationMaxM", 0),
                    f["groundCheck"]["penetrationMaxM"],
                )
                for f in frames
            ),
        },
        "scope": [
            f"全740肌肉统一配力；最小激活总和线性规划满足全部{sum(not n.startswith('pelvis_') for n in context().names)}个内部独立坐标，精确配力失败时仅保留诊断残差和动作。",
            "到达源关节界限时，仅允许阻止越界的单向止挡反力，并单独列出。",
            "骨盆支架或足底接触是显式外力；没有上身理想执行器补齐。",
            "人体与持物重力始终生效；无地面不提供足底反力，有地面还检查全身骨骼与足底站点穿地。",
            "肩部相对角速度工程阻尼和其余源关节被动作用，与肌肉被动张力分别列出；不是人体实测张力。"
            if context().shoulder_mechanics else
            "源被动关节弹簧/阻尼与肌肉被动张力分别列出；不是人体实测张力。",
            *(["指伸肌腱膜各段张力按声明比例计算；串联段不能相加作为肌肉总力，输出仅覆盖当前模型内的力。"]
              if context().tendon_branches else []),
        ],
    }
