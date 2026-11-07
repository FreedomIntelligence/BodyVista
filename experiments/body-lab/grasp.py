"""Source-capsule grasp geometry and bounded muscle/contact equilibrium helpers.

No weld or ideal wrist actuator supports equipment. Contact forces are unknowns
of the whole-body LP. Geometry closure does not certify that a hand can bear load.
Native coordinates are metres with Z up; output matrices use the viewer frame.
"""

import math
import re

import mujoco
import numpy as np
from scipy.optimize import least_squares

from .fullbody_engine import WORLD, ScenarioError, context, finite, transform

VERSION = "source-capsule-grasp-v1"
GAP_TOL = 0.0006
PENETRATION_TOL = 0.0005
# A transparent engineering contact tolerance, not measured skin compliance.
HANDLE_RADIUS = 0.014
# Tangent to the pinned source metacarpal skin capsules at local Y=-.07.
# The radius/center pair was solved from capsule geometry, not eyeballed on mesh.
PALM_CENTER = np.array([0.016, -0.07, -0.015280474547371277])
FINGER_PATTERN = re.compile(r"^\d?(cmc|mcp|mp|ip|pm|md)_")


def equipment(scene):
    """One normalized description shared by editing, rendering and dynamics."""
    if not isinstance(scene, dict):
        raise ScenarioError("握持输入必须是对象。")
    raw = scene.get("equipment", {})
    if not isinstance(raw, dict):
        raise ScenarioError("器械参数必须是对象。")
    mass = finite(scene.get("loadKg", raw.get("massKg", 0)), "器械总质量")
    kind = raw.get("type", "dumbbell" if mass else "none")
    if kind == "barbell":
        raise ScenarioError("杠铃功能已移除；请卸下器械或改用哑铃后再计算。")
    hand = scene.get("hand", raw.get("hand", "right"))
    mu = finite(raw.get("friction", 1.0), "握持摩擦系数")
    if kind not in ("none", "dumbbell") or hand not in ("right", "left", "both"):
        raise ScenarioError("器械或持握手无效。")
    if not 0 <= mass <= 50 or not 0 <= mu <= 2:
        raise ScenarioError("器械质量须为0至50 kg，摩擦系数须为0至2。")
    if mass and kind == "none":
        raise ScenarioError("空手不能具有器械质量。")
    if "massKg" in raw and abs(finite(raw["massKg"], "器械质量") - mass) > 1e-9:
        raise ScenarioError("器械质量与负重质量不一致。")
    return {"type": kind if mass else "none", "massKg": mass, "hand": hand,
            "friction": mu}


def geometry(kind):
    if kind != "dumbbell":
        raise ScenarioError("只支持哑铃器械几何。")
    return {"handleRadiusM": HANDLE_RADIUS, "shaftLengthM": .22,
            "plateRadiusM": .06, "plateThicknessM": .035, "plateOffsetM": .085}


def inertia(mass, shape):
    """Uniform-density shaft + annular plates, symmetric COM at the centre.

    The annular hole avoids counting shaft volume twice. This ideal equipment
    specification is not a measurement of any manufacturer's real product.
    """
    r, length = shape["handleRadiusM"], shape["shaftLengthM"]
    radius, width, offset = shape["plateRadiusM"], shape["plateThicknessM"], shape["plateOffsetM"]
    vshaft = math.pi * r * r * length
    vplate = math.pi * (radius * radius - r * r) * width
    shaft = mass * vshaft / (vshaft + 2 * vplate)
    plate = (mass - shaft) / 2
    axial = .5 * shaft * r * r + plate * (radius * radius + r * r)
    radial = shaft * (3 * r * r + length * length) / 12 + 2 * plate * (
        (3 * (radius * radius + r * r) + width * width) / 12 + offset * offset)
    return np.diag([radial, radial, axial])


def _side_names(side):
    return "capitate" if side == "r" else "capitate_l"


def finger_names(ctx, side):
    return [n for n in ctx.names if FINGER_PATTERN.match(n)
            and n.endswith("_l") == (side == "l")]


def skin_geoms(ctx, side):
    right = [i for i in range(ctx.model.ngeom)
            if "skin" in ctx.model.geom(i).name
            and ctx.model.geom(i).name.endswith("_r")
            and ctx.region(int(ctx.model.geom_bodyid[i])) == "hand_r"]
    # The source left-hand visual tree has no skin capsules. Mirror the source
    # right capsules in each homologous bone frame; negative IDs mark this
    # explicit derived geometry, not a native left collision mesh.
    return right if side == "r" else [-i - 1 for i in right]


def capsule_name(ctx, gid):
    name = ctx.model.geom(gid if gid >= 0 else -gid - 1).name
    return name if gid >= 0 else name.removesuffix("_r") + "_l"


def capsule_body(ctx, gid):
    bid = int(ctx.model.geom_bodyid[gid if gid >= 0 else -gid - 1])
    return bid if gid >= 0 else ctx.body_ids[ctx.model.body(bid).name + "_l"]


def palm_frame(ctx, data, side):
    bid = ctx.body_ids[_side_names(side)]
    r = data.xmat[bid].reshape(3, 3)
    local = PALM_CENTER.copy()
    if side == "l":
        local[2] *= -1
    center = data.xpos[bid] + r @ local
    # Mesh shaft is local Z; the palm's transverse axis is native local X.
    axis = r[:, 0]
    normal = r[:, 2] * (-1 if side == "l" else 1)
    rotation = np.column_stack([normal, np.cross(axis, normal), axis])
    return bid, center, rotation


def _capsule(ctx, data, gid):
    source = gid if gid >= 0 else -gid - 1
    radius, half = ctx.model.geom_size[source, :2]
    if gid >= 0:
        axis = data.geom_xmat[gid].reshape(3, 3)[:, 2]
        center = data.geom_xpos[gid]
    else:
        bid = capsule_body(ctx, gid)
        reflect = np.array([1., 1., -1.])
        rot = np.empty(9)
        mujoco.mju_quat2Mat(rot, ctx.model.geom_quat[source])
        body_rotation = data.xmat[bid].reshape(3, 3)
        axis = body_rotation @ (rot.reshape(3, 3)[:, 2] * reflect)
        center = data.xpos[bid] + body_rotation @ (ctx.model.geom_pos[source] * reflect)
    return center - axis * half, center + axis * half, radius


def capsule_contact(ctx, data, gid, center, axis):
    """Closest source-capsule point to the interior of a cylindrical shaft."""
    p0, p1, radius = _capsule(ctx, data, gid)
    d = p1 - p0
    projected = d - axis * np.dot(d, axis)
    offset = p0 - center
    radial = offset - axis * np.dot(offset, axis)
    denom = np.dot(projected, projected)
    u = np.clip(-np.dot(radial, projected) / denom, 0, 1) if denom > 1e-16 else .5
    core = p0 + u * d
    axial = np.dot(core - center, axis)
    shaft = center + axial * axis
    delta = shaft - core
    distance = float(np.linalg.norm(delta))
    normal = delta / max(distance, 1e-12)  # Hand pushes the equipment in this direction.
    point = shaft - HANDLE_RADIUS * normal
    return {"geom": gid, "body": capsule_body(ctx, gid), "point": point,
            "normal": normal, "gap": distance - radius - HANDLE_RADIUS,
            "axial": float(axial)}


def objects(ctx, data, scene):
    gear = equipment(scene)
    if not gear["massKg"]:
        return [], []
    sides = ["r", "l"] if gear["hand"] == "both" else ["l" if gear["hand"] == "left" else "r"]
    frames = {s: palm_frame(ctx, data, s) for s in sides}
    errors = []
    out = [{"sides": [s], "center": frames[s][1], "rotation": frames[s][2],
            "body": frames[s][0], "massKg": gear["massKg"] / len(sides),
            "closureM": 0., "alignment": 1.} for s in sides]
    shape = geometry(gear["type"])
    for index, obj in enumerate(out):
        obj.update(type=gear["type"], friction=gear["friction"], geometry=shape, index=index)
        obj["inertia"] = inertia(obj["massKg"], shape)
        obj["contacts"] = []
        max_penetration = 0.
        for side in obj["sides"]:
            contacts = [capsule_contact(ctx, data, gid, obj["center"], obj["rotation"][:, 2])
                        for gid in skin_geoms(ctx, side)]
            for contact in contacts:
                max_penetration = max(max_penetration, -contact["gap"])
                if contact["gap"] <= GAP_TOL and abs(contact["axial"]) < shape["plateOffsetM"] - shape["plateThicknessM"] / 2:
                    contact.update(side=side, object=index)
                    obj["contacts"].append(contact)
            # The usable grip lies between the plates. Conservatively check
            # the whole capsule axial extent against both plate inner faces.
            plate_inner = shape["plateOffsetM"] - shape["plateThicknessM"] / 2
            for gid in skin_geoms(ctx, side):
                a, b, radius = _capsule(ctx, data, gid)
                span = [float(np.dot(p - obj["center"], obj["rotation"][:, 2])) for p in (a, b)]
                if max(abs(v) for v in span) + radius > plate_inner + PENETRATION_TOL:
                    errors.append("手指接触代理越过配重片内侧，握把长度不足；不能把穿片姿势当成有效握持。")
            touching = [c for c in obj["contacts"] if c["side"] == side]
            digits = set()
            for c in touching:
                name = ctx.model.body(c["body"]).name
                if "thumb" in name: digits.add("thumb")
                elif name[:1] in "2345" and "ph" in name: digits.add(name[0])
            if "thumb" not in digits or len(digits - {"thumb"}) < 2:
                errors.append(("右" if side == "r" else "左") + "手未形成拇指与至少两指的握把接触，不能承重。")
        obj["penetrationM"] = max_penetration
        if max_penetration > PENETRATION_TOL:
            errors.append("手部接触代理穿入握把超过0.5 mm；当前几何不能用作有效握持。")
    return out, list(dict.fromkeys(errors))


def describe(ctx, data, scene):
    objs, errors = objects(ctx, data, scene)
    return {"equipmentInstances": [
        {"type": o["type"], "side": "both" if len(o["sides"]) == 2 else o["sides"][0],
         "massKg": o["massKg"], "geometry": o["geometry"],
         "matrix": transform(WORLD @ o["rotation"], WORLD @ o["center"]),
         "inertiaKgM2": o["inertia"].tolist()}
        for o in objs],
        "grasp": {"model": VERSION, "geometryValid": not errors, "feasible": None,
                  "status": "geometry-ready" if not errors else "open-or-incompatible",
                  "reason": "；".join(errors) if errors else "手指已贴合握把，承重尚待肌肉与接触联合求解。",
                  "errors": errors, "closureErrorM": max([o["closureM"] for o in objs], default=0.),
                  "penetrationMaxM": max([o["penetrationM"] for o in objs], default=0.),
                  "friction": equipment(scene)["friction"],
                  "contacts": [{"body": ctx.model.body(c["body"]).name,
                                "point": (WORLD @ c["point"]).tolist(),
                                "normal": (WORLD @ c["normal"]).tolist(), "gapM": c["gap"]}
                               for o in objs for c in o["contacts"]],
                  "scopeNote": "源右手皮肤胶囊（左手按对应骨段镜像）与28 mm理想圆柱握把接触。几何闭合只证明贴合；承重须通过肌肉与接触联合平衡。摩擦与器械均为声明的模型参数，未做个体握力验证。"}}


def attach(payload, *, finger_seed=(70., 70., 20.)):
    """Close only selected fingers around an unchanged palm/upper-limb pose."""
    gear = equipment(payload)
    ctx = context()
    q = ctx.normalize_q(payload.get("q", {}))
    original = dict(q)
    baseline_anatomy = ctx.anatomy_report(q)
    if not gear["massKg"]:
        data, _ = ctx.state(q)
        return {"q": q, **describe(ctx, data, payload)}
    sides = ["r", "l"] if gear["hand"] == "both" else ["l" if gear["hand"] == "left" else "r"]
    for side in sides:
        names = finger_names(ctx, side)
        ids = skin_geoms(ctx, side)
        # Target contact on phalanges; metacarpals are non-penetration obstacles.
        target = [i for i in ids if "distal_thumb" in capsule_name(ctx, i) or "distph" in capsule_name(ctx, i)]
        lo, hi = np.array([ctx.bounds(n) for n in names]).T
        start = np.array([q[n] for n in names])
        for i, name in enumerate(names):
            plain = name.removesuffix("_l")
            if "mcp_flexion" in plain: start[i] = finger_seed[0]
            elif "pm_flexion" in plain: start[i] = finger_seed[1]
            elif "md_flexion" in plain: start[i] = finger_seed[2]
            elif plain == "mp_flexion": start[i] = 35
            elif plain == "ip_flexion": start[i] = 45
            elif plain == "cmc_flexion": start[i] = -25
            elif plain == "cmc_abduction": start[i] = 15
            if plain.startswith("5"):
                if "mcp_flexion" in plain: start[i] = finger_seed[0] - 45
                elif "pm_flexion" in plain: start[i] = finger_seed[1] - 40

        # Each digit has its own chain. Solving these small independent blocks
        # prevents one unreachable intermediate pad from stalling all fingers.
        for digit in ("thumb", "2", "3", "4", "5"):
            indices = [i for i, n in enumerate(names)
                       if (not n[0].isdigit()) == (digit == "thumb")
                       and (digit == "thumb" or n.startswith(digit))]
            local_names = [names[i] for i in indices]
            if digit == "thumb":
                local_ids = [g for g in ids if "thumb" in capsule_name(ctx, g) or "firstmc" in capsule_name(ctx, g)]
            else:
                metacarpal = {"2": "second", "3": "third", "4": "fourth", "5": "fifth"}[digit]
                local_ids = [g for g in ids if capsule_name(ctx, g).startswith((digit, metacarpal))]
            local_target = [g for g in target if g in local_ids]

            def residual(x, local_names=local_names, side=side, local_ids=local_ids, local_target=local_target):
                trial = dict(q, **dict(zip(local_names, x)))
                data, _ = ctx.state(trial)
                _, centre, rotation = palm_frame(ctx, data, side)
                values = {g: capsule_contact(ctx, data, g, centre, rotation[:, 2])["gap"] for g in local_ids}
                gaps = np.array(list(values.values()))
                return np.r_[[values[g] for g in local_target], 8 * np.minimum(gaps, 0)]

            answer = least_squares(residual, np.clip(start[indices], lo[indices] + 1e-5, hi[indices] - 1e-5),
                                   bounds=(lo[indices] + 1e-6, hi[indices] - 1e-6), max_nfev=100,
                                   ftol=1e-10, xtol=1e-10, gtol=1e-10)
            q.update(dict(zip(local_names, answer.x.tolist())))
    data, _ = ctx.state(q)
    report = describe(ctx, data, payload)
    anatomy = ctx.anatomy_report(q, data)
    old_violations = {str(v) for v in baseline_anatomy.get("violations", [])}
    new_violations = [v for v in anatomy.get("violations", []) if str(v) not in old_violations]
    if new_violations:
        report["grasp"]["geometryValid"] = False
        report["grasp"]["errors"].append("闭合手指触发解剖保护：" + "；".join(v["label"] for v in new_violations))
        report["grasp"]["reason"] = "；".join(report["grasp"]["errors"])
    changed = [n for n in q if abs(q[n] - original[n]) > 1e-8]
    if not report["grasp"]["geometryValid"]:
        q = original
    return {"q": q, "changedCoordinates": changed if report["grasp"]["geometryValid"] else [], **report}


def contact_system(ctx, data, projection, scene):
    """Build reaction columns and independent six-dimensional object balances."""
    objs, errors = objects(ctx, data, scene)
    columns, object_columns, records = [], [], []
    equivalent = np.zeros(len(ctx.names))
    target = np.zeros(6 * len(objs))
    for obj in objs:
        center, rotation, bid = obj["center"], obj["rotation"], obj["body"]
        jac, angular = np.zeros((3, ctx.model.nv)), np.zeros((3, ctx.model.nv))
        jdot, adot = np.zeros_like(jac), np.zeros_like(angular)
        mujoco.mj_jac(ctx.model, data, jac, angular, center, bid)
        mujoco.mj_jacDot(ctx.model, data, jdot, adot, center, bid)
        acc = jac @ data.qacc + jdot @ data.qvel
        omega = angular @ data.qvel
        alpha = angular @ data.qacc + adot @ data.qvel
        tensor = rotation @ obj["inertia"] @ rotation.T
        wrench = np.r_[obj["massKg"] * (acc - ctx.model.opt.gravity),
                       tensor @ alpha + np.cross(omega, tensor @ omega)]
        obj["wrench"] = wrench
        target[obj["index"] * 6:obj["index"] * 6 + 6] = wrench
        equivalent += projection.T @ (jac.T @ wrench[:3] + angular.T @ wrench[3:])
        for contact in obj["contacts"]:
            normal = contact["normal"]
            tangent = rotation[:, 2]
            other = np.cross(normal, tangent)
            angles = np.arange(8) * math.pi / 4
            rays = normal[:, None] + obj["friction"] * (
                tangent[:, None] * np.cos(angles) + other[:, None] * np.sin(angles))
            cjac = np.zeros_like(jac)
            cdot = np.zeros_like(jac)
            mujoco.mj_jac(ctx.model, data, cjac, None, contact["point"], contact["body"])
            mujoco.mj_jacDot(ctx.model, data, cdot, None, contact["point"], contact["body"])
            offset = contact["point"] - center
            relative_v = cjac @ data.qvel - (jac @ data.qvel + np.cross(omega, offset))
            relative_a = cjac @ data.qacc + cdot @ data.qvel - (
                acc + np.cross(alpha, offset) + np.cross(omega, np.cross(omega, offset)))
            if np.linalg.norm(relative_v) > 1e-4 or np.linalg.norm(relative_a) > .01:
                errors.append("手指与握把的运动不满足无滑动接触；当前版本只验证持续握紧动作，不模拟抓取、松手或滑落过程。")
            columns.append(-projection.T @ cjac.T @ rays)
            block = np.zeros((len(target), 8))
            start = obj["index"] * 6
            block[start:start + 3] = rays
            block[start + 3:start + 6] = np.cross((contact["point"] - center)[None, :], rays.T).T
            object_columns.append(block)
            records.append(dict(contact, rays=rays, friction=obj["friction"], slipSpeedMps=float(np.linalg.norm(relative_v))))
    errors = list(dict.fromkeys(errors))
    return {"objects": objs, "errors": errors, "records": records,
            "jointMatrix": np.column_stack(columns) if columns else np.zeros((len(ctx.names), 0)),
            "objectMatrix": np.column_stack(object_columns) if columns else np.zeros((len(target), 0)),
            "target": target, "equivalent": equivalent}


def force_report(ctx, data, scene, system, coefficients):
    result = describe(ctx, data, scene)
    report = result["grasp"]
    report["contacts"] = []
    for i, c in enumerate(system["records"]):
        force = c["rays"] @ coefficients[i * 8:i * 8 + 8]
        normal = float(np.dot(force, c["normal"]))
        tangential = float(np.linalg.norm(force - normal * c["normal"]))
        report["contacts"].append({"body": ctx.model.body(c["body"]).name,
                                   "side": c["side"], "point": (WORLD @ c["point"]).tolist(),
                                   "forceOnObject": (WORLD @ force).tolist(),
                                   "normalN": normal, "frictionMarginN": c["friction"] * normal - tangential,
                                   "gapM": c["gap"]})
    residual = system["objectMatrix"] @ coefficients - system["target"]
    by_object = residual.reshape(-1, 6)
    report["objectResidualForceN"] = float(np.max(np.abs(by_object[:, :3]))) if len(by_object) else 0.
    report["objectResidualMomentNm"] = float(np.max(np.abs(by_object[:, 3:]))) if len(by_object) else 0.
    report["slipSpeedMaxMps"] = max([c["slipSpeedMps"] for c in system["records"]], default=0.)
    report["errors"] = system["errors"]
    report["feasible"] = bool(report["geometryValid"] and not system["errors"] and max(report["objectResidualForceN"], report["objectResidualMomentNm"]) < 1e-6)
    report["status"] = "contact-balanced" if report["feasible"] else "grasp-infeasible"
    report["reason"] = ("握持接触已满足器械合力和力矩平衡；仍须同时核对全身肌肉平衡。" if report["feasible"]
                        else "；".join(system["errors"]) or "当前肌肉能力与接触摩擦不能共同维持器械。")
    return result


def hide_forces(report, reason=None):
    """Preserve geometry/residual diagnostics without presenting failed forces."""
    report["feasible"] = False
    report["status"] = "grasp-infeasible"
    if reason:
        report["reason"] = reason
    for contact in report.get("contacts", []):
        for key in ("forceOnObject", "normalN", "frictionMarginN"):
            contact[key] = None
