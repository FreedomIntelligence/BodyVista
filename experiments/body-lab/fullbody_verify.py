"""Independent native checks for the restored MS-Human model.

Run in .venv-fullbody. These checks establish numerical/model coverage, not
human validation. Failed cases retain their pose and measured errors.
"""

import argparse
import gc
import hashlib
import importlib
import importlib.util
import json
import math
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from functools import lru_cache
from itertools import pairwise
from pathlib import Path

import mujoco
import numpy as np
from scipy.integrate import quad
from scipy.optimize import brentq, linprog
from scipy.spatial.transform import Rotation

HERE = Path(__file__).resolve().parent
RUNTIME_PACKAGE = "bodyvista_fullbody_independent_audit"


def runtime_module(name):
    """Read runtime identity without borrowing its independent audit equations."""
    if RUNTIME_PACKAGE not in sys.modules:
        spec = importlib.util.spec_from_file_location(
            RUNTIME_PACKAGE, HERE / "__init__.py", submodule_search_locations=[str(HERE)])
        package = importlib.util.module_from_spec(spec)
        sys.modules[RUNTIME_PACKAGE] = package
        spec.loader.exec_module(package)
    return importlib.import_module(RUNTIME_PACKAGE + "." + name)


ENGINE = runtime_module("fullbody_engine")
MODEL_PATH = Path(ENGINE.MODEL_PATH)
MODEL_ID = ENGINE.MODEL_ID
MODEL_MANIFEST_PATH = Path(getattr(
    ENGINE, "MODEL_MANIFEST_PATH", MODEL_PATH.with_name(MODEL_PATH.stem + "-manifest.json")))
MODEL_MANIFEST = json.loads(MODEL_MANIFEST_PATH.read_text("utf-8"))


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def historical_xml(path):
    """Relocate only the historical XML's original manifest-listed asset references."""
    if file_hash(path) != MODEL_MANIFEST["uncalibratedSha256"]:
        raise ValueError("The pre-calibration XML differs from its frozen source")
    manifest_path = (MODEL_MANIFEST_PATH.parent / MODEL_MANIFEST["sourceManifest"]).resolve()
    if file_hash(manifest_path) != MODEL_MANIFEST["sourceManifestSha256"]:
        raise ValueError("The original mesh and texture manifest changed")
    source = manifest_path.parent
    entries = {item["path"]: item["sha256"] for item in json.loads(manifest_path.read_bytes())["files"]}
    elements = ET.parse(path)
    relocated = {}
    for element in elements.iter():
        original = element.get("file")
        if original is None:
            continue
        prefix, marker, relative = original.replace("\\", "/").rpartition("/ms-human-700/")
        if not prefix or not marker or relative not in entries or element.tag not in ("mesh", "texture", "hfield"):
            raise ValueError("Unrecognized historical asset reference: "+str(original))
        local = (source / relative).resolve()
        if not local.is_relative_to(source) or file_hash(local) != entries[relative]:
            raise ValueError("Historical asset differs from the source manifest: "+relative)
        element.set("file", local.as_posix())
        relocated[original] = (local, relative)
    return ET.tostring(elements.getroot(), encoding="unicode"), relocated


def audit_model(path):
    if path.name == "expanded-before-range-calibration.xml":
        xml, _ = historical_xml(path)
        return mujoco.MjModel.from_xml_string(xml)
    return mujoco.MjModel.from_xml_path(str(path))


def lineage_contains(target_hash):
    """Check each current-to-parent link; do not relabel an ancestor as current."""
    path, manifest_path = MODEL_PATH, MODEL_MANIFEST_PATH
    visited = set()
    while path.resolve() not in visited:
        visited.add(path.resolve())
        manifest = json.loads(manifest_path.read_text("utf-8"))
        digest = file_hash(path)
        if digest != manifest["derivedSha256"]:
            return False
        if digest == target_hash:
            return True
        if "derivedFrom" not in manifest or "derivedFromManifest" not in manifest:
            return False
        parent = path.parent / manifest["derivedFrom"]
        parent_manifest = path.parent / manifest["derivedFromManifest"]
        if (file_hash(parent) != manifest["derivedFromSha256"] or
                file_hash(parent_manifest) != manifest["derivedFromManifestSha256"]):
            return False
        path, manifest_path = parent, parent_manifest
    return False


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n", "utf-8")


def region(name):
    if name.startswith("pelvis_"):
        return "root"
    if name.startswith("T1_head_neck"):
        return "neck"
    if re.match(r"T\d+_r\d+[RL]_", name):
        return "ribs"
    if re.match(r"[LT]\d+_[LTS]\d+_", name):
        return "spine"
    if name.startswith("Abs_"):
        return "abdomen"
    side = "left" if name.endswith("_l") else "right"
    if name.startswith(("hip_", "knee_", "ankle_", "subtalar_", "mtp_")):
        if name.startswith("hip_"):
            part = "hip"
        elif name.startswith("knee_"):
            part = "knee"
        elif name.startswith("mtp_"):
            part = "toes"
        else:
            part = "ankle"
    elif name.startswith(("elv_angle", "shoulder_")):
        part = "shoulder"
    elif name.startswith("elbow_"):
        part = "elbow"
    elif name.startswith("pro_sup"):
        part = "forearm"
    elif name.startswith(("deviation_", "flexion_")):
        part = "wrist"
    else:
        part = "fingers"
    return side + "_" + part


REGION_LABELS = {
    "root": "整体骨盆位置和朝向", "neck": "颈部", "spine": "分节腰胸椎",
    "ribs": "双侧肋骨及肋间肌", "abdomen": "腹部附着体",
    **{f"{side}_{part}": label + term
       for side, label in (("right", "右"), ("left", "左"))
       for part, term in (("shoulder", "肩与肩胛耦合"), ("elbow", "肘"),
                          ("forearm", "前臂旋转"), ("wrist", "腕"),
                          ("fingers", "五指"), ("hip", "髋"), ("knee", "膝"),
                          ("ankle", "踝与距下关节"), ("toes", "整体跖趾关节"))},
}


class Audit:
    def __init__(self, path=None, manifest_path=None):
        path = MODEL_PATH if path is None else Path(path)
        self.path = path
        self.model = audit_model(path)
        self._data = None
        self.joint_names = [mujoco.mj_id2name(self.model, mujoco.mjtObj.mjOBJ_JOINT, i)
                            for i in range(self.model.njnt)]
        self.muscle_names = [mujoco.mj_id2name(self.model, mujoco.mjtObj.mjOBJ_ACTUATOR, i)
                             for i in range(self.model.nu)]
        if any(t not in (mujoco.mjtJoint.mjJNT_HINGE, mujoco.mjtJoint.mjJNT_SLIDE)
               for t in self.model.jnt_type):
            raise ValueError("Audit currently requires scalar joints")
        if any(t != mujoco.mjtEq.mjEQ_JOINT for t in self.model.eq_type):
            raise ValueError("Audit requires explicit scalar-joint equality constraints")
        self.dependent = {int(i) for i in self.model.eq_obj1id}
        self.independent = [i for i in range(self.model.njnt) if i not in self.dependent]
        self.names = [self.joint_names[i] for i in self.independent]
        self.axial_relations = []
        if "knee_rotation_r" in self.joint_names:
            manifest_path = (MODEL_MANIFEST_PATH if path.resolve() == MODEL_PATH.resolve()
                             else path.with_name(path.stem + "-manifest.json")) if manifest_path is None else Path(manifest_path)
            manifest = json.loads(manifest_path.read_text("utf-8"))
            if file_hash(path) != manifest["derivedSha256"]:
                raise ValueError("Audit XML does not match its declared manifest")
            self.axial_relations = manifest["kneeAxialRelations"]
        self.regions = {name: [i for i, n in enumerate(self.names) if region(n) == name]
                        for name in dict.fromkeys(region(n) for n in self.names)}

    @property
    def data(self):
        if self._data is None:
            self._data = mujoco.MjData(self.model)
        return self._data

    def release_data(self):
        """Release the native arena between XML and production audit phases."""
        self._data = None

    def project(self, q):
        """Evaluate source polynomial equalities and their exact chain rule."""
        m = self.model
        q = q.copy()
        projection = np.eye(m.nv)[:, [int(m.jnt_dofadr[j]) for j in self.independent]]
        for _ in range(m.neq + 1):
            prior = q.copy()
            prior_projection = projection.copy()
            for e in range(m.neq):
                j1, j2 = int(m.eq_obj1id[e]), int(m.eq_obj2id[e])
                a, da = int(m.jnt_qposadr[j1]), int(m.jnt_dofadr[j1])
                coefficients = m.eq_data[e, :5]
                if j2 < 0:
                    q[a] = m.qpos0[a] + coefficients[0]
                    projection[da] = 0
                    continue
                b, db = int(m.jnt_qposadr[j2]), int(m.jnt_dofadr[j2])
                x = q[b] - m.qpos0[b]
                q[a] = m.qpos0[a] + np.polynomial.polynomial.polyval(x, coefficients)
                projection[da] = sum(k * coefficients[k] * x ** (k - 1)
                                     for k in range(1, 5)) * projection[db]
            if np.max(np.abs(q - prior)) < 1e-14 and np.max(np.abs(projection - prior_projection)) < 1e-14:
                for relation in self.axial_relations:
                    joint, source = m.joint(relation["joint"]).id, m.joint(relation["flexionCoordinate"]).id
                    a, b = int(m.jnt_qposadr[joint]), int(m.jnt_qposadr[source])
                    da, db = int(m.jnt_dofadr[joint]), int(m.jnt_dofadr[source])
                    coefficients, sign = relation["baselinePolynomial"], relation["offsetSign"]
                    x = q[b] - m.qpos0[b]
                    q[a] = m.qpos0[a] + np.polynomial.polynomial.polyval(x, coefficients) + sign * q[a]
                    slope = sum(k * coefficients[k] * x ** (k - 1) for k in range(1, 5))
                    projection[da] = slope * projection[db] + sign * projection[da]
                return q, projection
        raise ValueError("Source equality graph did not settle")

    def state(self, q, activation=0.0):
        q, projection = self.project(q)
        d = self.data
        mujoco.mj_resetData(self.model, d)
        d.qpos[:] = q
        d.act[:] = activation
        d.ctrl[:] = activation
        mujoco.mj_forward(self.model, d)
        return d, projection

    def moment(self, data):
        dense = np.zeros((self.model.nu, self.model.nv))
        for a in range(self.model.nu):
            start, count = int(data.moment_rowadr[a]), int(data.moment_rownnz[a])
            dense[a, data.moment_colind[start:start + count]] = data.actuator_moment[start:start + count]
        return dense

    def sample(self, seed=None):
        q = self.model.qpos0.copy()
        rng = np.random.default_rng(seed)
        for j in self.independent:
            if self.joint_names[j].startswith("pelvis_"):
                continue
            low, high = self.model.jnt_range[j]
            q[self.model.jnt_qposadr[j]] = np.clip(0.0, low, high) if seed is None else rng.uniform(low * 0.6, high * 0.6)
        for relation in self.axial_relations:
            joint = self.model.joint(relation["joint"]).id
            source = self.model.joint(relation["flexionCoordinate"]).id
            opening = np.clip(q[self.model.jnt_qposadr[source]] / np.deg2rad(30), 0, 1)
            opening = opening ** 2 * (3 - 2 * opening)
            low, high = np.deg2rad(relation["offsetRangeDeg"]) * opening * 0.6
            q[self.model.jnt_qposadr[joint]] = 0 if seed is None else rng.uniform(low, high)
        return q

    def pose_record(self, q):
        return {self.joint_names[j]: float(q[self.model.jnt_qposadr[j]]) for j in self.independent}

    def coverage(self):
        maximum = np.zeros((self.model.nu, len(self.independent)))
        residual = 0.0
        for seed in (None, 3719, 3720, 3721, 3722, 3723):
            d, p = self.state(self.sample(seed))
            maximum = np.maximum(maximum, np.abs(self.moment(d) @ p))
            equality = d.efc_pos[d.efc_type == mujoco.mjtConstraint.mjCNSTR_EQUALITY]
            residual = max(residual, float(np.max(np.abs(equality), initial=0)))
        muscles = [{"id": n, "maxMomentArm": float(maximum[i].max()),
                    "independentCoordinates": [self.names[j] for j in np.flatnonzero(maximum[i] > 1e-8)]}
                   for i, n in enumerate(self.muscle_names)]
        regions = []
        for name, indices in self.regions.items():
            active = np.flatnonzero(np.any(maximum[:, indices] > 1e-8, axis=1))
            regions.append({"id": name, "label": REGION_LABELS[name],
                            "status": "passed" if len(active) else "external-support",
                            "muscleUnits": len(active),
                            "limitation": ("整体位置与方向依靠外力和支撑；内部肌肉不改变总动量。" if name == "root" else
                                           "整体跖趾运动，尚无逐根足趾。" if name.endswith("_toes") else
                                           "三轴头颈整体，未分离七节颈椎。" if name == "neck" else
                                           "没有膈肌、肺气压和胸肋软骨约束。" if name == "ribs" else
                                           "左手新增关节轴及肌肉参数采用对称假设。" if name == "left_fingers" else
                                           "原生数值覆盖已验证，尚无人体验证。"),
                            "independentCoordinates": [self.names[j] for j in indices],
                            "muscleCount": len(active), "muscles": [self.muscle_names[i] for i in active],
                            "coordinateCoverage": [float(maximum[:, j].max()) for j in indices]})
        internal = [i for i, n in enumerate(self.names) if region(n) != "root"]
        ok = all(x["maxMomentArm"] > 1e-8 for x in muscles) and np.all(maximum[:, internal].max(axis=0) > 1e-8)
        return {"id": "native-coverage", "status": "passed" if ok and residual < 1e-9 else "failed",
                "actuatorsWithMoment": sum(x["maxMomentArm"] > 1e-8 for x in muscles),
                "totalActuators": self.model.nu, "internalCoordinates": len(internal),
                "internalCoordinatesWithMuscle": int(np.count_nonzero(maximum[:, internal].max(axis=0) > 1e-8)),
                "maxEqualityResidual": residual}, {"muscles": muscles, "regions": regions}

    def geometry(self):
        q = self.sample(3821)
        d, p = self.state(q)
        expected = self.moment(d) @ p
        errors = []
        step = 2e-6
        for k, j in enumerate(self.independent):
            plus, minus = q.copy(), q.copy()
            plus[self.model.jnt_qposadr[j]] += step
            minus[self.model.jnt_qposadr[j]] -= step
            length_plus = self.state(plus)[0].actuator_length.copy()
            length_minus = self.state(minus)[0].actuator_length.copy()
            measured = (length_plus - length_minus) / (2 * step)
            a = int(np.argmax(np.abs(measured - expected[:, k])))
            errors.append({"coordinate": self.names[k], "muscle": self.muscle_names[a],
                           "absoluteError": float(abs(measured[a] - expected[a, k]))})
        maximum = max(row["absoluteError"] for row in errors)
        return {"id": "tendon-jacobian-finite-difference", "status": "passed" if maximum < 2e-5 else "failed",
                "maxAbsoluteError": maximum, "criterion": f"全部{self.model.nu}条肌腱长度、{len(self.independent)}个独立坐标；中心差分与原生力臂误差小于2e-5 m/rad，平移坐标单位为m/m。",
                "poseRadians": self.pose_record(q), "cases": errors}

    def gravity(self):
        q = self.sample(3901)
        d, p = self.state(q)
        expected = p.T @ d.qfrc_bias.copy()
        step = 2e-6
        errors = []

        def potential(pose):
            data, _ = self.state(pose)
            return -float(np.sum(self.model.body_mass * (data.xipos @ self.model.opt.gravity)))

        for k, j in enumerate(self.independent):
            plus, minus = q.copy(), q.copy()
            plus[self.model.jnt_qposadr[j]] += step
            minus[self.model.jnt_qposadr[j]] -= step
            measured = (potential(plus) - potential(minus)) / (2 * step)
            errors.append({"coordinate": self.names[k], "potentialDerivative": measured,
                           "nativeGravity": float(expected[k]), "absoluteError": float(abs(measured - expected[k]))})
        maximum = max(x["absoluteError"] for x in errors)
        return {"id": "gravity-potential-finite-difference", "status": "passed" if maximum < 2e-5 else "failed",
                "maxAbsoluteError": maximum, "criterion": "总质量和质心重力势能的独立差分与约束投影后的原生重力对照；误差小于2e-5 N或Nm。",
                "poseRadians": self.pose_record(q), "cases": errors}

    def force_bounds(self):
        cases = []
        for seed in (None, 4101, 4102):
            q = self.sample(seed)
            zero = self.state(q, 0.0)[0].actuator_force.copy()
            one = self.state(q, 1.0)[0].actuator_force.copy()
            maximum = 0.0
            for activation in (0.2, 0.35, 0.7):
                measured = self.state(q, activation)[0].actuator_force.copy()
                maximum = max(maximum, float(np.max(np.abs(measured - (zero + activation * (one - zero))))))
            cases.append({"seed": seed, "maxAffineErrorN": maximum,
                          "maxPositivePushingForceN": float(np.max(one, initial=0)),
                          "forceCapacityNegativeCount": int(np.count_nonzero(zero - one < -1e-8)),
                          "activeForceNonzeroCount": int(np.count_nonzero(zero - one > 1e-8)),
                          "maxTensionN": float(np.max(-one))})
        ok = all(x["maxAffineErrorN"] < 1e-8 and x["maxPositivePushingForceN"] < 1e-8 and x["forceCapacityNegativeCount"] == 0 for x in cases)
        return {"id": "native-muscle-force-bounds", "status": "passed" if ok else "failed",
                "criterion": "激活0..1的原生张力与被动张力+激活×主动容量一致，肌肉只拉不推；主动容量为零时如实保留，不用标称最大力代替。", "cases": cases}

    def inverse_dynamics(self):
        """Check native inverse dynamics against the mass-matrix equation."""
        m = self.model
        previous_flags = m.opt.disableflags
        cases = []
        try:
            # Explicit external supports belong in the application solver. This
            # check isolates the unconstrained joint-space inverse equation.
            m.opt.disableflags |= int(mujoco.mjtDisableBit.mjDSBL_CONSTRAINT)
            for seed in (4301, 4302, 4303):
                d, projection = self.state(self.sample(seed))
                rng = np.random.default_rng(seed)
                independent_velocity = rng.normal(0, 0.05, len(self.names))
                independent_acceleration = rng.normal(0, 0.2, len(self.names))
                velocity = projection @ independent_velocity
                acceleration = projection @ independent_acceleration
                for e in range(m.neq):
                    j1, j2 = int(m.eq_obj1id[e]), int(m.eq_obj2id[e])
                    if j2 < 0:
                        continue
                    a, b = int(m.jnt_dofadr[j1]), int(m.jnt_dofadr[j2])
                    x = d.qpos[m.jnt_qposadr[j2]] - m.qpos0[m.jnt_qposadr[j2]]
                    coefficients = m.eq_data[e, :5]
                    second = sum(k * (k - 1) * coefficients[k] * x ** (k - 2) for k in range(2, 5))
                    acceleration[a] += second * velocity[b] ** 2
                for relation in self.axial_relations:
                    j1, j2 = m.joint(relation["joint"]).id, m.joint(relation["flexionCoordinate"]).id
                    a, b = int(m.jnt_dofadr[j1]), int(m.jnt_dofadr[j2])
                    x = d.qpos[m.jnt_qposadr[j2]] - m.qpos0[m.jnt_qposadr[j2]]
                    coefficients = relation["baselinePolynomial"]
                    acceleration[a] += sum(k * (k - 1) * coefficients[k] * x ** (k - 2) for k in range(2, 5)) * velocity[b] ** 2
                d.qvel[:] = velocity
                mujoco.mj_forward(m, d)
                inertia = np.zeros((m.nv, m.nv))
                mujoco.mj_fullM(m, d, inertia)
                expected = inertia @ acceleration + d.qfrc_bias - d.qfrc_passive
                d.qacc[:] = acceleration
                mujoco.mj_inverse(m, d)
                error = float(np.max(np.abs(projection.T @ (d.qfrc_inverse - expected))))
                cases.append({"seed": seed, "maxProjectedInverseError": error,
                              "finite": bool(np.all(np.isfinite(d.qfrc_inverse)))})
        finally:
            m.opt.disableflags = previous_flags
        return {"id": "native-inverse-dynamics", "status": "passed" if all(c["finite"] and c["maxProjectedInverseError"] < 1e-8 for c in cases) else "failed",
                "criterion": "原生逆动力学与质量矩阵×加速度+惯性重力项−被动项对照，包含速度、加速度与非线性膝关节耦合；约束反力在此独立检查中关闭，外支撑由应用求解器另验。", "cases": cases}

    def left_hand_symmetry(self):
        names = ["APB", "FPB", "OPP", "ADPt", "ADPo", "ADM", "FDM", "ODM", "1stPI", "2ndPI",
                 "3rdPI", "1stDI_MC1", "1stDI_MC2", "2ndDI", "3rdDI", "4thDI", "LUML", "LUMR", "LUMM", "LUMI"]
        joint_names = ["cmc_flexion", "cmc_abduction", "mp_flexion", "ip_flexion",
                       "2mcp_flexion", "2pm_flexion", "2md_flexion", "3mcp_flexion",
                       "4mcp_flexion", "5mcp_flexion"]
        cases = []
        for amount in (0.0, 0.15, 0.5):
            q = self.sample()
            for name in joint_names:
                for key in (name, name + "_l"):
                    j = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_JOINT, key)
                    q[self.model.jnt_qposadr[j]] = min(amount, self.model.jnt_range[j, 1])
            d, _ = self.state(q, 0.35)
            length_error, force_error = 0.0, 0.0
            for name in names:
                right = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_ACTUATOR, name)
                left = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_ACTUATOR, name + "_l")
                length_error = max(length_error, float(abs(d.actuator_length[right] - d.actuator_length[left])))
                force_error = max(force_error, float(abs(d.actuator_force[right] - d.actuator_force[left])))
            cases.append({"fingerAngleRad": amount, "maxLengthDifferenceM": length_error, "maxTensionDifferenceN": force_error})
        return {"id": "left-hand-source-mirror", "status": "passed" if all(c["maxLengthDifferenceM"] < 1e-9 and c["maxTensionDifferenceN"] < 1e-7 for c in cases) else "failed",
                "criterion": "对称手指姿态下，新增20对手内在肌的长度与原生张力一致；检验镜像实现，不证明人体左右完全对称。", "cases": cases}

    def region_response(self):
        q = self.sample(4201)
        d, p = self.state(q, 0.35)
        base_force = d.actuator_force.copy()
        base_length = d.actuator_length.copy()
        matrix = self.moment(d) @ p
        results = []
        for name, indices in self.regions.items():
            if name == "root":
                continue
            local = np.abs(matrix[:, indices])
            _, col = np.unravel_index(np.argmax(local), local.shape)
            k = indices[col]
            j = self.independent[k]
            low, high = self.model.jnt_range[j]
            shifted = q.copy()
            change = min(0.03, (high - low) * 0.15)
            shifted[self.model.jnt_qposadr[j]] += change
            d2, _ = self.state(shifted, 0.35)
            influence = np.any(local > 1e-8, axis=1)
            force_change = np.abs(d2.actuator_force - base_force)
            selected = int(np.argmax(np.where(influence, force_change, -1)))
            results.append({"region": name, "coordinate": self.names[k], "changeRadians": change,
                            "muscle": self.muscle_names[selected], "lengthBeforeM": float(base_length[selected]),
                            "lengthAfterM": float(d2.actuator_length[selected]),
                            "tensionBeforeN": float(-base_force[selected]), "tensionAfterN": float(-d2.actuator_force[selected]),
                            "changedMuscles": int(np.count_nonzero(force_change[influence] > 1e-7)),
                            "status": "passed" if force_change[selected] > 1e-7 else "failed"})
        return {"id": "regional-native-posture-response", "status": "passed" if all(x["status"] == "passed" for x in results) else "failed",
                "criterion": "各内部区域在固定激活0.35时，姿态变化引起原生肌腱长度和张力变化；这是本构响应检查，不代表已推断真实招募策略。",
                "poseRadians": self.pose_record(q), "cases": results}

    def static_case(self, allow_stops, hand_oracle=None):
        """A separate LP determines whether exact static equilibrium exists."""
        q = self.sample()
        zero, p = self.state(q, 0.0)
        native_passive = zero.actuator_force.copy()
        rne = np.zeros(self.model.nv)
        mujoco.mj_rne(self.model, zero, 0, rne)
        required = p.T @ (rne - zero.qfrc_passive)
        if hand_oracle is None:
            length = zero.actuator_length.copy()
            moments = self.moment(zero) @ p
            passive = native_passive
            gain = self.state(q, 1.0)[0].actuator_force.copy() - native_passive
        else:
            length, jac = hand_oracle.geometry(zero)
            moments = jac @ p
            passive = hand_oracle.passive_bias(length)
            gain = hand_oracle.active_gain(length)
            required -= hand_oracle.generalized_correction(hand_oracle.public_pose(q))
        internal = [i for i, n in enumerate(self.names) if region(n) != "root"]
        matrix = (moments.T * gain)[internal]
        target = (required - moments.T @ passive)[internal]
        stop_names, stop_columns = [], []
        if allow_stops:
            for row, index in enumerate(internal):
                joint = self.independent[index]
                if self.names[index].startswith("knee_rotation_"):
                    continue  # Editing envelopes are not physical stop actuators.
                if not self.model.jnt_limited[joint]:
                    continue
                value = q[self.model.jnt_qposadr[joint]]
                low, high = self.model.jnt_range[joint]
                sign = 1.0 if abs(value - low) < 1e-9 else -1.0 if abs(value - high) < 1e-9 else 0.0
                if sign:
                    column = np.zeros(len(internal))
                    column[row] = sign
                    stop_columns.append(column)
                    stop_names.append((self.names[index], sign))
        if stop_columns:
            matrix = np.column_stack([matrix, *stop_columns])
        result = linprog(np.r_[np.ones(self.model.nu), np.full(len(stop_columns), 1e-4)], A_eq=matrix, b_eq=target,
                         bounds=[(0.0, 1.0)] * self.model.nu + [(0.0, None)] * len(stop_columns), method="highs",
                         options={"primal_feasibility_tolerance": 1e-9, "dual_feasibility_tolerance": 1e-9})
        residual = float(np.max(np.abs(matrix @ result.x - target))) if result.success else None
        inactive = [{"muscle": self.muscle_names[i], "lengthM": float(length[i]),
                     "lengthRangeM": self.model.actuator_lengthrange[i].tolist(),
                     "activeCapacityN": float(-gain[i])}
                    for i in np.flatnonzero(np.abs(gain) < 1e-8)]
        return {"allowsJointStops": allow_stops, "feasible": bool(result.success), "solverMessage": str(result.message),
                "scope": "independent-hybrid-unit-strength" if hand_oracle is not None else "native-xml-only",
                "maxResidualNm": residual, "poseRadians": self.pose_record(q),
                "zeroActiveCapacityAtThisPose": inactive,
                "stopTorquesNm": ({name: float(sign * result.x[self.model.nu + i])
                                    for i, (name, sign) in enumerate(stop_names)} if result.success else {})}

    def static_feasibility(self, hand_oracle=None):
        without = self.static_case(False, hand_oracle)
        with_stops = self.static_case(True, hand_oracle)
        before_path = MODEL_PATH.parent / "expanded-before-range-calibration.xml"
        source_cases = []
        if before_path.exists() and hand_oracle is None:
            self.release_data()
            original = Audit(before_path)
            source_cases = [original.static_case(False), original.static_case(True)]
        ok = with_stops["feasible"] and with_stops["maxResidualNm"] < 1e-7
        return {"id": "independent-hybrid-static-feasibility" if hand_oracle is not None else "independent-static-feasibility",
                "label": "当前混合被动模型的独立静态配力" if hand_oracle is not None else "XML原生静态配力对照",
                "status": "passed" if ok else "failed",
                "scope": "independent-hybrid-unit-strength" if hand_oracle is not None else "native-xml-only",
                "criterion": "分别检查无止挡与源边界合法单向止挡：下限只允许正反力，上限只允许负反力，内部非界限坐标不能获得止挡。激活0..1，骨盆支架仅承担根部6分量。",
                "withoutStops": without, "withStops": with_stops,
                "beforeCalibration": source_cases,
                "passiveLaw": ("36 条手部被动力及 24 坐标参考修正。声明的八条浅指屈肌独立求纤维和肌腱串联平衡；使用同一有效长度计算原生活性增益。"
                               if hand_oracle is not None and hand_oracle.fds_series else
                               "独立计算36条手部被动力和24坐标参考修正。" if hand_oracle is not None else
                               "仅XML原生MUSCLE，不包含运行时手部混合本构。"),
                "detail": "中立姿态可能需要关节止挡才可平衡；无止挡不可行如实记录，不把止挡反力解释为肌力，也不要求所有任意姿态都可行。"}

    def calibration(self):
        """Verify the v2 calibration only on its original, frozen geometry."""
        report_path = MODEL_PATH.parent / "hand-range-calibration.json"
        before_path = MODEL_PATH.parent / "expanded-before-range-calibration.xml"
        calibrated_parent = MODEL_PATH.parent / "expanded.xml"
        if not all(path.exists() for path in (report_path, before_path, calibrated_parent)):
            return {"id": "derived-hand-length-ranges", "status": "pending", "detail": "尚无完整校准来源和原始模型快照。"}
        self.release_data()
        report = json.loads(report_path.read_text("utf-8"))
        xml, relocated = historical_xml(before_path)
        before = mujoco.MjModel.from_xml_string(xml)
        historical = Audit(calibrated_parent)
        records = {item["name"]: item for item in report["muscles"]}
        before_elements = list(ET.parse(before_path).getroot().iter())
        after_elements = list(ET.parse(calibrated_parent).getroot().iter())
        unexpected = []
        if len(records) != 14 or len(report["muscles"]) != 14:
            unexpected.append("历史校准应恰有14条不同肌肉记录")
        equivalent_asset_paths = []
        if len(before_elements) != len(after_elements):
            unexpected.append("XML元素数量变化")
        for old, new in zip(before_elements, after_elements):
            if old.tag != new.tag or old.get("name") != new.get("name"):
                unexpected.append("XML结构或对象名称变化")
            for attribute in set(old.attrib) | set(new.attrib):
                if old.get(attribute) == new.get(attribute):
                    continue
                permitted = (old.tag == "mujoco" and attribute == "model") or (
                    old.tag == "general" and old.get("name") in records and attribute == "lengthrange")
                if attribute == "file" and old.tag in ("mesh", "texture", "hfield"):
                    old_path, relative = relocated[old.get(attribute)]
                    new_path = (calibrated_parent.parent / new.get(attribute)).resolve()
                    if old_path == new_path and old_path.is_file():
                        permitted = True
                        equivalent_asset_paths.append({"object": old.get("name"), "sourceAsset": relative})
                if not permitted:
                    unexpected.append(f"{old.tag}:{old.get('name')}:{attribute}")
        cases = []
        rng = np.random.default_rng(71731)
        for name, record in records.items():
            actuator = historical.model.actuator(name).id
            original = before.actuator(name).id
            derived = np.asarray(record["derivedLengthRangeM"])
            errors = []
            joint_names = list(record["extrema"][0]["q"])
            for extreme in record["extrema"]:
                q = historical.sample()
                for joint_name, value in extreme["q"].items():
                    joint = historical.model.joint(joint_name).id
                    q[historical.model.jnt_qposadr[joint]] = value
                    low, high = historical.model.jnt_range[joint]
                    if value < low - 1e-8 or value > high + 1e-8:
                        unexpected.append(f"{name}极值姿态超出{joint_name}范围")
                data, _ = historical.state(q)
                errors.append(abs(float(data.actuator_length[actuator]) - extreme["length"]))
            outside = 0.0
            for _ in range(30):
                q = historical.sample()
                for joint_name in joint_names:
                    joint = historical.model.joint(joint_name).id
                    q[historical.model.jnt_qposadr[joint]] = rng.uniform(*historical.model.jnt_range[joint])
                data, _ = historical.state(q)
                length = float(data.actuator_length[actuator])
                outside = max(outside, derived[0] - length, length - derived[1])
            data, _ = historical.state(historical.sample())
            gain = mujoco.mju_muscleGain(data.actuator_length[actuator], 0, historical.model.actuator_lengthrange[actuator],
                                        historical.model.actuator_acc0[actuator], historical.model.actuator_gainprm[actuator, :9])
            parameters_unchanged = np.array_equal(before.actuator_gainprm[original], historical.model.actuator_gainprm[actuator]) and np.array_equal(before.actuator_biasprm[original], historical.model.actuator_biasprm[actuator])
            # The historical XML stores 12 significant digits; the report
            # retains the optimizer's full precision.
            range_matches = bool(np.allclose(historical.model.actuator_lengthrange[actuator], derived,
                                             rtol=0, atol=5e-13))
            cases.append({"muscle": name, "sourceLengthRangeM": before.actuator_lengthrange[original].tolist(),
                          "derivedLengthRangeM": historical.model.actuator_lengthrange[actuator].tolist(),
                          "neutralActiveCapacityN": float(-gain), "maxEndpointReproductionErrorM": max(errors),
                          "randomLengthOutsideDerivedRangeM": float(outside), "forceParametersUnchanged": bool(parameters_unchanged),
                          "declaredRangeMatches": range_matches,
                          "status": "passed" if max(errors) < 2e-8 and outside < 2e-5 and gain < -1e-8 and parameters_unchanged and range_matches else "failed"})
        hashes_match = (report["beforeSha256"] == file_hash(before_path)
                        and report["afterSha256"] == file_hash(calibrated_parent)
                        and lineage_contains(report["afterSha256"]))
        ok = hashes_match and not unexpected and all(c["status"] == "passed" for c in cases)
        return {"id": "derived-hand-length-ranges", "status": "passed" if ok else "failed", "hashesMatch": hashes_match,
                "scope": "historical-v2-provenance-only", "auditedModelSha256": file_hash(calibrated_parent),
                "currentModelGeometryValidated": False,
                "unexpectedEdits": unexpected, "equivalentAssetPathCount": len(equivalent_asset_paths), "cases": cases,
                "criterion": "只在原v2校准前后XML上核对14条lengthrange修改、极值、随机样本和肌肉参数；当前版本须通过哈希父链连接该历史版本。",
                "detail": "本项仅证明历史来源，不证明当前手部路径、分支传力或长度范围。当前模型的几何与本构须另验；历史有界搜索不是人体长度测量。"}


class EffectiveTendonAudit:
    """Independent scalar-length reconstruction from the manifest and unmodified XML.

    Use the integral of the published moment arm and finite differences of the
    raw single-axis slice. Never call the production transmission or overwrite
    an audit model's MuJoCo tendons.
    """

    def __init__(self, audit, reference_q, declaration):
        self.audit = audit
        self.q0 = audit.project(reference_q)[0]
        m = audit.model
        self.scratch = None
        self.targets = {}
        self.names = []
        for target in declaration["targets"]:
            a = audit.muscle_names.index(target["actuator"])
            tendon = m.tendon(target["tendon"]).id
            if a in self.targets or m.actuator_trnid[a, 0] != tendon or m.actuator_gear[a, 0] != 1:
                raise ValueError("Independent audit requires distinct unit-gear named spatial tendons")
            axes = []
            for entry in target["axes"]:
                name = entry["joint"]
                joint = m.joint(name).id
                if joint not in audit.independent or m.jnt_type[joint] != mujoco.mjtJoint.mjJNT_HINGE:
                    raise ValueError("Effective tendon coordinate must be an independent hinge")
                address = int(m.jnt_qposadr[joint])
                self.q0[address] = 0.
                axes.append((address, int(m.jnt_dofadr[joint]), entry))
                self.names.append(name)
            self.targets[a] = (tendon, axes)
        if not self.targets:
            raise ValueError("Selected tendon declaration has no actuators")
        self.slice_length = lru_cache(maxsize=256)(self._slice_length)

    def _slice_length(self, tendon, address, angle):
        if self.scratch is None:
            self.scratch = mujoco.MjData(self.audit.model)
        m, d = self.audit.model, self.scratch
        d.qpos[:] = self.q0
        d.qpos[address] = angle
        mujoco.mj_kinematics(m, d)
        mujoco.mj_comPos(m, d)
        mujoco.mj_tendon(m, d)
        return float(d.ten_length[tendon])

    @staticmethod
    def arm_and_excursion(entry, angle):
        # Simpson integration is exact on each constant/quadratic piece.
        lo, hi = entry["measuredRangeRad"]
        a, b, c = entry["coefficientsMm"]

        def arm(x):
            x = min(max(x, lo), hi)
            return .001*(a*x**2+b*x+c)

        start, end = sorted((0., angle))
        knots = [start, *(x for x in (lo, hi) if start < x < end), end]
        area = sum((y-x)*(arm(x)+4*arm((x+y)/2)+arm(y))/6 for x, y in pairwise(knots))
        return arm(angle), area if angle >= 0. else -area

    def geometry(self, data):
        length = data.actuator_length.copy()
        jac = self.audit.moment(data)
        step = 2e-6
        for actuator, (tendon, axes) in self.targets.items():
            for address, dof, entry in axes:
                theta = float(data.qpos[address])
                arm, excursion = self.arm_and_excursion(entry, theta)
                sample = self.slice_length
                native_change = sample(tendon, address, theta)-sample(tendon, address, 0.)
                length[actuator] -= excursion+native_change
                slope = (sample(tendon, address, theta+step)-sample(tendon, address, theta-step))/(2*step)
                jac[actuator, dof] -= arm+slope
        return length, jac


FDS_SERIES_NAMES = tuple(name+side for name in ("FDSI", "FDSM", "FDSR", "FDSL") for side in ("", "_l"))
FDS_SERIES_DECLARATION = {
    "model": "thelen-fds-passive-series-v1", "muscles": list(FDS_SERIES_NAMES),
    "moduleSha256": file_hash(HERE / "passive_series.py"),
    "tendonStrainAtFmax": .04, "tendonToeForceFraction": .33, "tendonToeShape": 3,
    "fibreStrainAtFmax": .6, "fibreShape": 5,
    "slackLength": "effective-length-offset-from-validated-lengthrange",
    "source": "https://github.com/opensim-org/opensim-core/blob/main/OpenSim/Actuators/Thelen2003Muscle.cpp",
}
TOE_END = 99*.04/(166-67*math.exp(-3))


def _expm1_integral(z):
    """Integral of expm1(x), evaluated without cancellation near slack."""
    if abs(z) < 1e-4:
        return z*z*(.5+z*(1/6+z*(1/24+z/120)))
    return math.expm1(z)-z


@lru_cache(maxsize=2048)
def fds_series_state(length, optimal, slack, peak):
    """Solve equilibrium in fibre extension, using both forward stress curves.

    The production law solves for normalized force using inverse curves.
    Here stored energies are separate physical integrals in joules.
    """
    if not all(math.isfinite(v) and v > 0 for v in (length, optimal, slack, peak)):
        raise ValueError("FDS requires finite positive total, optimal and slack lengths and Fmax")
    total = length-optimal-slack
    if total <= 0:
        return 0., 0., 0., 0., 0.
    linear_slope = .67/(.04-TOE_END)
    def tendon(strain):
        if strain > TOE_END:
            return .33+linear_slope*(strain-TOE_END)
        return .33*math.expm1(3*strain/TOE_END)/math.expm1(3)
    def fibre(strain):
        return math.expm1(5*strain/.6)/math.expm1(5)
    def mismatch(fraction):
        return fibre(total*fraction/optimal)-tendon(total*(1-fraction)/slack)

    fraction = brentq(mismatch, 0., 1., xtol=1e-15, rtol=1e-15)
    xf, xt = total*fraction/optimal, total*(1-fraction)/slack
    tension, tendon_tension = peak*fibre(xf), peak*tendon(xt)
    fibre_energy = peak*optimal*.6/5*_expm1_integral(5*xf/.6)/math.expm1(5)
    toe = min(xt, TOE_END)
    post_toe = max(0., xt-TOE_END)
    tendon_energy = peak*slack*(.33*TOE_END/3*_expm1_integral(3*toe/TOE_END)/math.expm1(3)
                               + .33*post_toe + .5*linear_slope*post_toe**2)
    finite = (tension, tendon_tension, fibre_energy, tendon_energy)
    if (not all(math.isfinite(x) and x >= 0 for x in finite)
            or abs(tension-tendon_tension) > 1e-7):
        raise ValueError("Independent FDS fibre/tendon force balance failed")
    return tension, fibre_energy, tendon_energy, xf, xt


class HandPassiveAudit:
    """Independent XML geometry and exp-form oracle; never installs USER bias.

    The values below are pinned to the passive-linear and Thelen predeclarations,
    rather than imported from the implementation under test. Native Audit keeps
    its original MUSCLE laws, including when auditing historical v2/v3 models.
    """

    MUSCLES = tuple(name + suffix for name in (
        "FDSI", "FDSM", "FDSR", "FDSL", "1stDI_MC1", "1stDI_MC2", "2ndDI",
        "3rdDI", "4thDI", "1stPI", "2ndPI", "3rdPI", "LUMI", "LUMM",
        "LUMR", "LUML", "ADM", "ODM") for suffix in ("", "_l"))
    STIFFNESS = {
        "2mcp_flexion": 0.03662108695652174, "2pm_flexion": 0.014377778260869565,
        "2md_flexion": 0.0029039173913043476, "3mcp_flexion": 0.03828713636363636,
        "3pm_flexion": 0.017815152173913044, "3md_flexion": 0.003092331818181818,
        "4mcp_flexion": 0.02606752380952381, "4pm_flexion": 0.013039213043478262,
        "4md_flexion": 0.0028100636363636365, "5mcp_flexion": 0.012707869565217392,
        "5pm_flexion": 0.00497328, "5md_flexion": 0.001744847619047619,
    }

    def __init__(self, declaration, audit=None, transmission=None):
        self.audit = Audit() if audit is None else audit
        self.model = m = self.audit.model
        self.names = tuple(name + suffix for name in self.STIFFNESS for suffix in ("", "_l"))
        self.indices = np.array([self.audit.names.index(name) for name in self.names])
        self.selected = {self.audit.muscle_names.index(name) for name in self.MUSCLES}
        self.stiffness = np.array([self.STIFFNESS[name.removesuffix("_l")] for name in self.names])
        self.equilibrium = np.deg2rad([14 if "mcp" in name else 7 for name in self.names])
        self.factors = np.array([1 if m.jnt_type[j] == mujoco.mjtJoint.mjJNT_SLIDE else 180 / np.pi
                                 for j in self.audit.independent])
        self.pelvis_height = float(m.body_pos[m.body("pelvis").id, 2])
        self.defaults = {name: float(m.qpos0[m.jnt_qposadr[j]] * factor)
                         for name, j, factor in zip(self.audit.names, self.audit.independent, self.factors)}
        self.defaults["pelvis_ty"] += self.pelvis_height
        law, correction = declaration["passiveLaw"], declaration["referenceCorrection"]
        rows = correction["coordinates"]
        expected_rows = {(name, float(k), 14.0 if "mcp" in name else 7.0)
                         for name, k in zip(self.names, self.stiffness)}
        actual_rows = {(row["coordinate"], row["stiffnessNmPerRad"], row["equilibriumDeg"]) for row in rows}
        reference = declaration["referenceConfiguration"]
        if (len(law["muscles"]) != 36 or set(law["muscles"]) != set(self.MUSCLES)
                or law["e0"] != 0.6 or law["kpe"] != 5.0
                or correction["type"] != "reference-aggregate-linear-passive-v1"
                or len(rows) != 24 or actual_rows != expected_rows
                or reference != self.defaults
                or declaration["strengthScale"] != 1 or declaration["allMuscleScales"] != 1
                or m.nu != 740 or np.any(m.actuator_biastype != mujoco.mjtBias.mjBIAS_MUSCLE)
                or np.any(m.actuator_gaintype != mujoco.mjtGain.mjGAIN_MUSCLE)):
            raise ValueError("Independent hand audit rejects changed fixed parameters/reference or non-native source laws")
        for i in self.selected:
            prm, bounds = m.actuator_biasprm[i], m.actuator_lengthrange[i]
            if (not np.all(np.isfinite(prm[:3])) or not np.all(np.isfinite(bounds))
                    or prm[1] <= prm[0] or bounds[1] <= bounds[0] or prm[2] <= 0):
                raise ValueError("Independent Thelen oracle requires positive Fmax and valid length normalization")
        self.reference = dict(reference)
        self.transmission = (EffectiveTendonAudit(self.audit, self.native_pose(self.reference), transmission)
                             if transmission is not None else None)
        self.fds_series = {}
        if transmission is not None and "passiveSeries" in transmission:
            if transmission["passiveSeries"] != FDS_SERIES_DECLARATION:
                raise ValueError("The eight FDS passive series declaration or measured parameters changed")
            if set(self.transmission.targets) != {self.audit.muscle_names.index(n) for n in ("FDPL", "FDPL_l")}:
                raise ValueError("The FDS series audit requires exactly the two little FDP geometric targets")
            rows = MODEL_MANIFEST["handMechanics"]["fibreCalibration"]
            for name in FDS_SERIES_NAMES:
                records = [row for row in rows if row["muscle"] == name]
                if len(records) != 1 or records[0]["source"] != "Kerkhof2018-Table1":
                    raise ValueError("Missing or ambiguous FDS fibre calibration: "+name)
                i = self.audit.muscle_names.index(name)
                low, high = m.actuator_lengthrange[i]
                p = m.actuator_biasprm[i]
                optimal = (high-low)/(p[1]-p[0])
                slack = low-p[0]*optimal
                rec = records[0]
                if (i not in self.selected or min(optimal, slack, p[2]) <= 0
                        or not np.isfinite([optimal, slack, p[2]]).all()
                        or abs(optimal-rec["optimalFibreLengthM"]) > 1e-9
                        or abs(slack-rec["effectiveLengthOffsetM"]) > 1e-9 or p[2] != rec["fmaxN"]):
                    raise ValueError("Compiled FDS parameters differ from the original calibration: "+name)
                self.fds_series[i] = (float(optimal), float(slack), float(p[2]))
        self.neutral_lengths = self.geometry(self.reference_state(self.reference)[0])[0]

    def geometry(self, data):
        if self.transmission is None:
            return data.actuator_length.copy(), self.audit.moment(data)
        return self.transmission.geometry(data)

    def active_gain(self, lengths, velocities=None):
        m = self.model
        speeds = np.zeros(m.nu) if velocities is None else velocities
        return np.array([mujoco.mju_muscleGain(length, speed, m.actuator_lengthrange[i],
                                               m.actuator_acc0[i], m.actuator_gainprm[i, :9])
                         for i, (length, speed) in enumerate(zip(lengths, speeds, strict=True))])

    def release_workspaces(self):
        self.audit.release_data()
        if self.transmission is not None:
            self.transmission.scratch = None  # The slice cache contains scalar lengths only.

    def native_pose(self, q):
        pose = dict(self.defaults)
        pose.update(q)
        values = self.model.qpos0.copy()
        for name, j, factor in zip(self.audit.names, self.audit.independent, self.factors):
            values[self.model.jnt_qposadr[j]] = (pose[name] - (self.pelvis_height if name == "pelvis_ty" else 0)) / factor
        return values

    def public_pose(self, q):
        result = {name: float(q[self.model.jnt_qposadr[j]] * factor)
                  for name, j, factor in zip(self.audit.names, self.audit.independent, self.factors)}
        result["pelvis_ty"] += self.pelvis_height
        return result

    def reference_state(self, q):
        pose = dict(self.reference)
        pose.update({name: q.get(name, self.reference[name]) for name in self.names})
        return self.audit.state(self.native_pose(pose))

    def passive_bias(self, lengths, *, original_law=False):
        m = self.model
        result = np.empty(m.nu)
        for i, length in enumerate(lengths):
            if i in self.fds_series and not original_law:
                result[i] = -fds_series_state(float(length), *self.fds_series[i])[0]
                continue
            if i not in self.selected:
                result[i] = mujoco.mju_muscleBias(length, m.actuator_lengthrange[i],
                                               m.actuator_acc0[i], m.actuator_biasprm[i, :9])
                continue
            low, high = m.actuator_lengthrange[i]
            prm = m.actuator_biasprm[i]
            optimum = (high - low) / (prm[1] - prm[0])
            normalized = prm[0] + (length - low) / optimum
            result[i] = -prm[2] * (math.exp(5 * max(0.0, normalized - 1) / 0.6) - 1) / (math.exp(5) - 1)
        return result

    def reference_torque(self, q):
        data, projection = self.reference_state(q)
        length, jac = self.geometry(data)
        return ((jac @ projection).T @ self.passive_bias(length))[self.indices]

    def correction(self, q):
        angles = np.deg2rad([q.get(name, self.reference[name]) for name in self.names])
        return -self.stiffness * (angles - self.equilibrium) - self.reference_torque(q)

    def generalized_correction(self, q):
        result = np.zeros(len(self.audit.names))
        result[self.indices] = self.correction(q)
        return result

    def potential(self, q):
        """Linear target energy minus MTU energy at fixed non-finger reference."""
        data, _ = self.reference_state(q)
        lengths, _ = self.geometry(data)
        angles = np.deg2rad([q.get(name, self.reference[name]) for name in self.names])
        energy = 0.5 * float(np.sum(self.stiffness * (angles - self.equilibrium) ** 2))
        m = self.model
        for i in np.flatnonzero(np.abs(lengths - self.neutral_lengths) > 1e-13):
            if i in self.fds_series:
                current = fds_series_state(float(lengths[i]), *self.fds_series[i])
                reference = fds_series_state(float(self.neutral_lengths[i]), *self.fds_series[i])
                stored = sum(current[1:3])-sum(reference[1:3])
            elif i in self.selected:
                prm, bounds = m.actuator_biasprm[i], m.actuator_lengthrange[i]
                optimum = (bounds[1] - bounds[0]) / (prm[1] - prm[0])

                def primitive(length):
                    excess = max(0.0, prm[0] + (length - bounds[0]) / optimum - 1)
                    return prm[2] * optimum * (0.6 / 5 * (math.exp(5 * excess / 0.6) - 1) - excess) / (math.exp(5) - 1)

                stored = primitive(lengths[i]) - primitive(self.neutral_lengths[i])
            else:
                stored, _ = quad(lambda length: -mujoco.mju_muscleBias(
                    length, m.actuator_lengthrange[i], m.actuator_acc0[i], m.actuator_biasprm[i, :9]),
                    self.neutral_lengths[i], lengths[i], epsabs=1e-11, epsrel=1e-9)
            energy -= stored
        return float(energy)


def frame_vector(frame, field, names):
    """Reject missing/extra/nonfinite torque entries instead of filling zeros."""
    record = frame.get(field)
    if (not isinstance(record, dict) or set(record) != set(names)
            or any(isinstance(value, bool) or not isinstance(value, (int, float))
                   or not np.isfinite(value) for value in record.values())):
        raise ValueError(f"{field} does not contain exactly the declared finite coordinates")
    return np.array([record[name] for name in names])


def observed_hand_correction(ctx, q):
    """Measure the implementation's addition, never use it as the oracle."""
    complete, projection = ctx.state(q)
    complete_passive = complete.qfrc_passive.copy()
    del complete
    raw, raw_projection = ctx.state(q, _skip_hand_correction=True)
    if not np.array_equal(projection, raw_projection):
        raise ValueError("Skipping hand correction changed the coordinate projection")
    return projection.T @ (complete_passive - raw.qfrc_passive)


def hand_frame_checks(oracle, cases):
    """Validate independent hand torque, muscle scaling and output accounting."""
    records = []
    names = oracle.audit.names
    for label, frame, scale in cases:
        record = {"case": label, "quantitativeValid": frame.get("quantitativeValid") is True}
        if not record["quantitativeValid"]:
            records.append({**record, "status": "failed", "detail": "此对照缺少有效帧，不能用失效数据证明输出归属。"})
            continue
        try:
            expected_hand = oracle.generalized_correction(frame["q"])
            reported_hand = frame_vector(frame, "handReferenceTorques", oracle.names)
            joint = frame_vector(frame, "jointPassiveTorques", names)
            other = frame_vector(frame, "otherJointPassiveTorques", names)
            raw = frame_vector(frame, "rawTorques", names)
            external = frame_vector(frame, "externalTorques", names)
            required = frame_vector(frame, "torques", names)
            muscle_passive = frame_vector(frame, "passiveTorques", names)
            data, projection = oracle.audit.state(oracle.native_pose(frame["q"]))
            lengths, jac = oracle.geometry(data)
            bias = oracle.passive_bias(lengths) * scale
            expected_muscle_passive = (jac @ projection).T @ bias
            muscles = frame["muscles"]
            if (len(muscles) != 740 or [mu["name"] for mu in muscles] != oracle.audit.muscle_names
                    or any(isinstance(mu.get("passiveForce"), bool)
                           or not isinstance(mu.get("passiveForce"), (int, float))
                           or not np.isfinite(mu["passiveForce"]) for mu in muscles)):
                raise ValueError("Missing, reordered or nonfinite 740 muscle passive forces")
            errors = {
                "handReferenceNm": float(np.max(np.abs(reported_hand - expected_hand[oracle.indices]))),
                "jointPartitionNOrNm": float(np.max(np.abs(joint - other - expected_hand))),
                "netDemandNOrNm": float(np.max(np.abs(raw - joint - external - required))),
                "musclePassiveNOrNm": float(np.max(np.abs(muscle_passive - expected_muscle_passive))),
                "musclePassiveN": float(np.max(np.abs(np.array([mu["passiveForce"] for mu in muscles]) + bias))),
            }
            ok = all(np.isfinite(value) and value < 2e-6 for value in errors.values())
            record.update(status="passed" if ok else "failed", maxErrors=errors,
                          strengthRange=[float(np.min(scale)), float(np.max(scale))],
                          externalMaxNOrNm=float(np.max(np.abs(external))))
        except (KeyError, TypeError, ValueError) as exc:
            record.update(status="failed", detail=str(exc))
        records.append(record)
    return records


def hand_passive_check(ctx, solver, oracle, q, frame_cases, invalid_frames):
    """Independent hybrid force, reference-energy and strength attribution tests."""
    header = {"id": "production-hand-passive-mechanics", "label": "手部混合被动本构与参考修正",
              "scope": "current-hybrid-model; one fixed actuation pose, one mixed 24-axis pose and six energy-gradient axes",
              "criterion": "独立XML几何、直接exp的36条Thelen式及固定24坐标参考。比较全部740原生执行器和求解器被动力、主动容量，检验参考恒等、非手指坐标隔离、势能梯度及非1强度归属。"}
    if oracle.audit.names != ctx.names or oracle.audit.muscle_names != ctx.muscle_names:
        return {**header, "status": "failed", "detail": "独立模型与运行时坐标或肌肉顺序不一致。"}
    parameters_equal = all(np.array_equal(getattr(ctx.model, name), getattr(oracle.model, name))
                           for name in ("actuator_gainprm", "actuator_biasprm", "actuator_lengthrange",
                                        "actuator_acc0", "actuator_gaintype"))
    # Fixed source wrist-control offset excites the hand passive laws; it is not
    # described as a clinical palm flexion angle or selected by residual error.
    actuation_q = dict(q, flexion_r=-20.0)
    source_q = oracle.native_pose(actuation_q)
    source_data, _ = oracle.audit.state(source_q, 0.0)
    lengths, _ = oracle.geometry(source_data)
    independent_bias = oracle.passive_bias(lengths)
    source_gain = oracle.active_gain(lengths)
    del source_data
    oracle.release_workspaces()
    production_data, _ = ctx.state(actuation_q)
    ctx.hand_elasticity.assert_installed()
    production_data.act[:] = 0
    production_data.ctrl[:] = 0
    mujoco.mj_fwdActuation(ctx.model, production_data)
    actual_bias = production_data.actuator_force.copy()
    activation = np.linspace(0.0, 1.0, ctx.model.nu)
    for i, amount in enumerate(activation):
        address = int(ctx.model.actuator_actadr[i])
        if address >= 0:
            production_data.act[address] = amount
        else:
            production_data.ctrl[i] = amount
    ctx.hand_elasticity.assert_installed()
    mujoco.mj_fwdActuation(ctx.model, production_data)
    gain, bias = solver.muscle_laws(ctx, production_data, np.ones(ctx.model.nu))
    force_errors = {
        "nativePassiveN": float(np.max(np.abs(actual_bias - independent_bias))),
        "nativeMixedActivationN": float(np.max(np.abs(production_data.actuator_force - independent_bias - activation * source_gain))),
        "solverPassiveN": float(np.max(np.abs(bias - independent_bias))),
        "activeCapacityN": float(np.max(np.abs(gain - source_gain))),
    }
    scale = np.linspace(0.8, 1.2, ctx.model.nu)
    scaled_gain, scaled_bias = solver.muscle_laws(ctx, production_data, scale)
    force_errors["scaledActiveCapacityN"] = float(np.max(np.abs(scaled_gain - source_gain * scale)))
    force_errors["scaledPassiveN"] = float(np.max(np.abs(scaled_bias - independent_bias * scale)))
    del production_data

    mixed = dict(oracle.reference)
    mixed.update({name: float(angle) for name, angle in zip(oracle.names, np.linspace(3, 55, 24))})
    expected = oracle.generalized_correction(mixed)
    oracle.release_workspaces()
    observed = observed_hand_correction(ctx, mixed)
    angles = np.deg2rad([mixed[name] for name in oracle.names])
    target = -oracle.stiffness * (angles - oracle.equilibrium)
    changed_other = dict(mixed, flexion_r=-20, deviation_r=5, pro_sup_r=35,
                         elbow_flexion_r=60, shoulder_elv_r=25, flexion_l=15,
                         deviation_l=-5, pro_sup_l=25, elbow_flexion_l=35,
                         shoulder_elv_l=20, **{"2mcp_abduction": 8, "3mcp_abduction_l": 4})
    varied = observed_hand_correction(ctx, changed_other)
    equilibrium = dict(oracle.reference)
    equilibrium.update({name: 14.0 if "mcp" in name else 7.0 for name in oracle.names})
    equilibrium_observed = observed_hand_correction(ctx, equilibrium)
    mechanism_errors = {
        "allCoordinatesCorrectionNOrNm": float(np.max(np.abs(observed - expected))),
        "referenceIdentityNm": float(np.max(np.abs(oracle.reference_torque(mixed) + observed[oracle.indices] - target))),
        "nonFingerDependenceNOrNm": float(np.max(np.abs(varied - observed))),
        "equilibriumNetElasticNm": float(np.max(np.abs(oracle.reference_torque(equilibrium) + equilibrium_observed[oracle.indices]))),
    }
    gradient_cases = []
    step = 1e-5
    for name in ("2mcp_flexion", "3pm_flexion", "4md_flexion",
                 "5mcp_flexion_l", "2pm_flexion_l", "3md_flexion_l"):
        plus, minus = dict(mixed), dict(mixed)
        plus[name] += np.rad2deg(step)
        minus[name] -= np.rad2deg(step)
        gradient = -(oracle.potential(plus) - oracle.potential(minus)) / (2 * step)
        actual = float(observed[oracle.audit.names.index(name)])
        gradient_cases.append({"coordinate": name, "independentNegativeGradientNm": gradient,
                               "productionCorrectionNm": actual, "absoluteErrorNm": abs(gradient - actual)})
    accounting = hand_frame_checks(oracle, frame_cases)
    failed_fields_hidden = bool(invalid_frames) and all(
        frame.get(field) is None for frame in invalid_frames
        for field in ("handReferenceTorques", "otherJointPassiveTorques", "externalTorques"))
    ok = (parameters_equal and all(np.isfinite(x) and x < 1e-6 for x in force_errors.values())
          and all(np.isfinite(x) and x < 2e-6 for x in mechanism_errors.values())
          and all(np.isfinite(x["absoluteErrorNm"]) and x["absoluteErrorNm"] < 2e-5 for x in gradient_cases)
          and all(x["status"] == "passed" for x in accounting) and failed_fields_hidden)
    return {**header, "status": "passed" if ok else "failed", "parametersUnchanged": parameters_equal,
            "musclesCompared": 740, "replacedPassiveLaws": 36, "referenceCoordinates": 24,
            "actuationPose": actuation_q, "mixedReferencePose": mixed,
            "maxForceErrors": force_errors, "maxMechanismErrors": mechanism_errors,
            "potentialGradientCases": gradient_cases, "frameAccounting": accounting,
            "invalidOrPreviewFrames": len(invalid_frames), "invalidTorqueFieldsHidden": failed_fields_hidden,
            "limitation": "仅验证声明的教学研究混合模型和所列姿势；六轴局部势能差分不是全域凸性、稳定性或人体参数证明。"}


def shoulder_damping_check(ctx, frame, q, velocity, acceleration, hand_oracle=None, *, reference=None):
    """Reference physical angular velocity by independent rotation differences.

    Audit loads its own native XML and never calls the mechanics helper or
    ModelContext.state. Native inverse dynamics above remains a separate test.
    """
    declaration = ctx.manifest.get("shoulderMechanics", {})
    coefficient = declaration.get("dampingNmsPerRad")
    header = {"id": "production-physical-shoulder-damping",
              "label": "肩部物理阻尼与完整动态方程",
              "criterion": "独立XML与解析耦合；用骨旋转差分构建肩相对角速度，并按独立手部公式加入参考修正。核对惯性、全部被动项、扣除已报告外力后的净需求及肩阻尼耗散。"}
    if (declaration.get("type") != "relative-glenohumeral-viscous-v1" or
            isinstance(coefficient, bool) or not isinstance(coefficient, (int, float)) or
            not np.isfinite(coefficient) or coefficient <= 0):
        return {**header, "status": "failed", "detail": "缺少受支持的肩物理阻尼声明。"}
    reference = Audit() if reference is None else reference
    m = reference.model
    # The hand reference uses the unmodified XML settings. Compute it before
    # the shoulder-only constraint flag is set, even when sharing the model.
    hand = (np.zeros(len(reference.names)) if hand_oracle is None
            else hand_oracle.generalized_correction(q))
    if hand_oracle is not None:
        hand_oracle.release_workspaces()
    m.opt.disableflags |= int(mujoco.mjtDisableBit.mjDSBL_CONSTRAINT)
    native_q = m.qpos0.copy()
    factors = np.array([1.0 if m.jnt_type[j] == mujoco.mjtJoint.mjJNT_SLIDE else 180 / np.pi
                        for j in reference.independent])
    for column, joint in enumerate(reference.independent):
        name = reference.names[column]
        native_q[m.jnt_qposadr[joint]] = (
            q[name] - (ctx.pelvis_height if name == "pelvis_ty" else 0.0)) / factors[column]
    v = np.array([velocity.get(name, 0.0) for name in reference.names]) / factors
    a = np.array([acceleration.get(name, 0.0) for name in reference.names]) / factors
    data, projection = reference.state(native_q)
    step = 1e-5
    plus, minus = native_q.copy(), native_q.copy()
    for column, joint in enumerate(reference.independent):
        plus[m.jnt_qposadr[joint]] += step * v[column]
        minus[m.jnt_qposadr[joint]] -= step * v[column]
    projection_rate = (reference.project(plus)[1] - reference.project(minus)[1]) / (2 * step)
    native_acceleration = projection @ a + projection_rate @ v
    data.qvel[:] = projection @ v
    mujoco.mj_forward(m, data)
    inertia = np.zeros((m.nv, m.nv))
    mujoco.mj_fullM(m, data, inertia)
    raw = projection.T @ (inertia @ native_acceleration + data.qfrc_bias)
    native_passive = projection.T @ data.qfrc_passive.copy()
    body_ids = [[m.body(f"humerus_{side}").id, m.body(f"scapula_{side}").id] for side in "rl"]
    angular_jacobians = np.zeros((2, 3, len(reference.names)))
    for column, joint in enumerate(reference.independent):
        plus, minus = native_q.copy(), native_q.copy()
        plus[m.jnt_qposadr[joint]] += step
        minus[m.jnt_qposadr[joint]] -= step
        plus_rotations = reference.state(plus)[0].xmat.copy().reshape(-1, 3, 3)
        minus_rotations = reference.state(minus)[0].xmat.copy().reshape(-1, 3, 3)
        for side, (child, parent) in enumerate(body_ids):
            child_change = Rotation.from_matrix(plus_rotations[child] @ minus_rotations[child].T).as_rotvec()
            parent_change = Rotation.from_matrix(plus_rotations[parent] @ minus_rotations[parent].T).as_rotvec()
            angular_jacobians[side, :, column] = (child_change - parent_change) / (2 * step)
    omega = angular_jacobians @ v
    added = -coefficient * sum(jacobian.T @ speed for jacobian, speed in zip(angular_jacobians, omega))
    power = float(v @ added)
    expected_power = float(-coefficient * np.sum(omega * omega))
    # This fixture is unloaded and seated, so no external joint reaction may be
    # hidden here. Loaded/ground frames have their sign/partition checked below.
    external = frame_vector(frame, "externalTorques", reference.names) if hand_oracle is not None else np.zeros(len(reference.names))
    errors = {}
    for field, expected in (("rawTorques", raw), ("jointPassiveTorques", native_passive + added + hand),
                            ("torques", raw - native_passive - added - hand - external)):
        actual = np.array([frame[field][name] for name in reference.names])
        errors[field] = float(np.max(np.abs(actual - expected)))
    active_contribution = float(np.max(np.abs(added)))
    finite = bool(np.all(np.isfinite([*errors.values(), power, expected_power, active_contribution])))
    ok = (finite and errors["rawTorques"] < 2e-5 and errors["jointPassiveTorques"] < 2e-6
          and errors["torques"] < 2e-5 and power <= 1e-10
          and abs(power - expected_power) < 1e-10 and active_contribution > 1e-6
          and np.max(np.abs(external)) < 1e-10)
    return {**header, "status": "passed" if ok else "failed", "dampingNmsPerRad": coefficient,
            "maxErrorsNm": errors, "addedDampingMaxNm": active_contribution,
            "dampingPowerW": power, "expectedDampingPowerW": expected_power,
            "independentHandCorrectionMaxNm": float(np.max(np.abs(hand))),
            "reference": "independent XML + coordinate chain rule + bone-rotation finite differences",
            "q": q, "velocity": velocity, "acceleration": acceleration}


def tendon_branch_check(ctx, valid_frames, invalid_frames, *, mixed_failure):
    """Compare reported branch tension with XML pulley factors, not a helper."""
    issues = []
    declarations = ctx.manifest.get("tendonBranches", {})
    root = ET.parse(MODEL_PATH).getroot()
    expected = {}
    for actuator in root.findall("./actuator/*"):
        tendon = root.find(f'./tendon/spatial[@name="{actuator.attrib.get("tendon", "")}"]')
        if tendon is None or not tendon.findall("pulley"):
            continue
        name = actuator.attrib["name"]
        coefficients = [1.0]
        for pulley in tendon.findall("pulley"):
            divisor = float(pulley.attrib["divisor"])
            if not np.isfinite(divisor) or divisor <= 0:
                raise ValueError("Invalid XML pulley divisor: " + name)
            coefficients.append(1.0 / divisor)
        records = declarations.get(name, [])
        identifiers = [item.get("id") for item in records]
        if (len(records) != len(coefficients) or len(set(identifiers)) != len(identifiers) or
                any(not isinstance(identifier, str) or not identifier for identifier in identifiers)):
            issues.append(name + ": 分支声明缺失、重复或与XML数量不符")
            continue
        for record, coefficient in zip(records, coefficients):
            if record.get("coefficient") != coefficient:
                issues.append(name + ": 声明系数与XML滑轮倍率不符")
        expected[name] = list(zip(identifiers, coefficients))
    if not expected or set(expected) != set(declarations):
        issues.append("分支肌肉集合为空或与XML不一致")
    max_error, compared, nonzero = 0.0, 0, 0
    for valid, frames in ((True, valid_frames), (False, invalid_frames)):
        if not frames:
            issues.append("缺少有效帧" if valid else "缺少失效或预览帧")
        for frame in frames:
            muscles = {muscle["name"]: muscle for muscle in frame.get("muscles", [])}
            for name, definitions in expected.items():
                muscle = muscles.get(name, {})
                branches = muscle.get("branches", [])
                if [branch.get("id") for branch in branches] != [item[0] for item in definitions]:
                    issues.append(name + ": 返回分支缺失或顺序不符")
                    continue
                for branch, (_, coefficient) in zip(branches, definitions):
                    path = branch.get("path", [])
                    if (len(path) < 2 or any(len(point) != 3 or not np.all(np.isfinite(point)) for point in path)):
                        issues.append(name + ": 分支几何未保留或坐标无效")
                    if branch.get("coefficient") != coefficient:
                        issues.append(name + ": 返回系数与XML不同")
                    force = branch.get("force")
                    if not valid:
                        if force is not None:
                            issues.append(name + ": 失效/预览帧仍保留分支力")
                        continue
                    main = muscle.get("force")
                    if (not isinstance(force, (int, float)) or isinstance(force, bool) or
                            not isinstance(main, (int, float)) or isinstance(main, bool) or
                            not np.isfinite(force) or not np.isfinite(main) or force < 0 or main < 0):
                        issues.append(name + ": 有效帧分支或主干张力无效")
                        continue
                    error = abs(force - main * coefficient)
                    max_error = max(max_error, error)
                    compared += 1
                    nonzero += main > 1e-8
                    if error > 1e-8 * max(1.0, abs(force)):
                        issues.append(name + ": 分支力不等于主张力乘XML系数")
    if not mixed_failure:
        issues.append("尚未证明局部帧失败后，原本可行帧的分支力也被清空")
    if not compared or not nonzero:
        issues.append("缺少非零张力分支对照")
    return {"id": "production-tendon-branch-forces", "label": "手部分支张力与失效清理",
            "status": "passed" if not issues else "failed",
            "criterion": "逐支对照XML滑轮倍率：分支张力=主肌腱张力×系数；有效、失败与预览均保留几何，整段任一帧失败后所有分支力清空。",
            "branchedMuscles": len(expected), "comparedBranches": compared,
            "nonzeroComparisons": int(nonzero), "maxForceErrorN": max_error,
            "validFrames": len(valid_frames), "invalidOrPreviewFrames": len(invalid_frames),
            "mixedSequenceFailedAndRetainedFeasibleFrame": mixed_failure,
            "issues": sorted(set(issues))}


def fds_series_constitutive_check(ctx, oracle):
    """Native eight-muscle passive callbacks at slack, toe and linear stretches.

    These synthetic input lengths exercise the law itself; they are not
    claimed to be joint poses. Physical motion is audited separately.
    """
    ids = np.asarray(list(oracle.fds_series), dtype=int)
    if len(ids) != 8 or [ctx.muscle_names[i] for i in ids] != list(FDS_SERIES_NAMES):
        raise ValueError("Constitutive check requires the eight identified FDS units")
    # At zero activation the actual actuator output gives the signed passive
    # force. Fresh data are owned by this check and never returned to a solver.
    d, _ = ctx.state(ctx.defaults, _skip_hand_correction=True)
    d.act[:] = 0.
    d.ctrl[:] = 0.
    rows = []
    for label, xt in (("below-slack", -.001), ("toe", TOE_END/2), ("join", TOE_END),
                      ("unit-normalized-force", .04)):
        if xt <= 0.:
            expected_fraction = xf = 0.
        elif xt <= TOE_END:
            expected_fraction = .33*math.expm1(3*xt/TOE_END)/math.expm1(3)
            xf = .6/5*math.log1p(expected_fraction*math.expm1(5))
        else:
            expected_fraction, xf = 1., .6
        expected, measured_energy_errors, balance = [], [], []
        for i in ids:
            optimal, slack, peak = oracle.fds_series[i]
            total = optimal*(1+xf)+slack*(1+xt)
            d.actuator_length[i] = total
            expected.append(peak*expected_fraction)
            force, uf, ut, sf, st = fds_series_state(total, optimal, slack, peak)
            recovered_length = (optimal*(1+sf)+slack*(1+st)) if xt > 0 else total
            balance.append(abs(recovered_length-total))
            step = 2e-7*min(optimal, slack)
            plus = fds_series_state(total+step, optimal, slack, peak)
            minus = fds_series_state(total-step, optimal, slack, peak)
            work_force = (sum(plus[1:3])-sum(minus[1:3]))/(2*step)
            measured_energy_errors.append(abs(force-work_force))
            if min(uf, ut) < 0 or abs(force-expected[-1]) > 1e-7:
                raise ValueError("Independent FDS elastic elements failed their known force/stretch point")
        ctx.hand_elasticity.assert_installed()
        mujoco.mj_fwdActuation(ctx.model, d)
        rows.append({"branch": label, "maxNativePassiveForceErrorN":
                     float(np.max(np.abs(-d.actuator_force[ids]-expected))),
                     "maxEnergyDerivativeErrorN": max(measured_energy_errors),
                     "maxLengthPartitionErrorM": max(balance)})
    limits = {"maxNativePassiveForceErrorN": 1e-6, "maxEnergyDerivativeErrorN": 2e-5,
              "maxLengthPartitionErrorM": 1e-12}
    ok = all(math.isfinite(row[key]) and row[key] <= limit for row in rows for key, limit in limits.items())
    return {"id": "production-fds-series-passive-law", "label": "八条浅指屈肌的纤维与肌腱被动串联",
            "status": "passed" if ok else "failed", "scope": "isolated constitutive inputs; zero activation",
            "muscles": list(FDS_SERIES_NAMES), "limits": limits, "cases": rows}


def effective_tendon_check(ctx, oracle):
    """Test the selected effective lengths and virtual work at a mixed moving pose."""
    transmission = oracle.transmission
    if transmission is None or not transmission.targets:
        raise ValueError("The selected v5 transmission needs an independent length oracle")
    q = dict(ctx.defaults)
    axes = list(dict.fromkeys(transmission.names))
    for side, suffix, offset in (("r", "", 0.), ("l", "_l", 2.)):
        for digit in (3, 5):
            for part, angle in (("mcp", 28.), ("pm", 36.), ("md", 22.)):
                name = f"{digit}{part}_flexion{suffix}"
                q[name] = angle+offset
                if name not in axes:
                    axes.append(name)
            abduction = f"{digit}mcp_abduction{suffix}"
            q[abduction] = 2.
            axes.append(abduction)
        for name, angle in ((f"flexion_{side}", -12.+offset), (f"deviation_{side}", 3.-offset),
                            (f"pro_sup_{side}", 19.-offset), (f"elbow_flexion_{side}", 37.+offset)):
            q[name] = angle
            axes.append(name)
    # Nontrivial independent-to-native coordinate coupling in addition to
    # simultaneous finger, wrist and forearm motions.
    knee = oracle.audit.axial_relations[0]["flexionCoordinate"]
    lo, hi = ctx.bounds(knee)
    q[knee] = .5*(lo+hi)
    axes.append(knee)
    velocity = {name: (-1)**i*(6.+i/3) for i, name in enumerate(axes)}
    m = oracle.model
    oracle.release_workspaces()
    actual, projection = ctx.state(q, velocity, _skip_hand_correction=True)
    # Keep independent and production native arenas in separate phases. Copy
    # inputs and outputs before releasing each MjData (its arrays are views).
    native_q = actual.qpos.copy()
    native_v = actual.qvel.copy()
    actual_lengths = actual.actuator_length.copy()
    actual_velocities = actual.actuator_velocity.copy()
    actual_jac = oracle.audit.moment(actual)
    activation = np.linspace(.1, .7, m.nu)
    for i, value in enumerate(activation):
        addr = ctx.model.actuator_actadr[i]
        if addr >= 0:
            actual.act[addr] = value
        else:
            actual.ctrl[i] = value
    mujoco.mj_fwdActuation(ctx.model, actual)
    actual_force = actual.actuator_force.copy()
    actual_qforce = actual.qfrc_actuator.copy()
    del actual
    raw = oracle.audit.data
    # Matching exact native inputs isolates transmission changes from tiny
    # differences between the production and independently projected poses.
    raw.qpos[:] = native_q
    raw.qvel[:] = native_v
    mujoco.mj_forward(m, raw)
    lengths, jac = oracle.geometry(raw)
    raw_jac = oracle.audit.moment(raw)
    targets = np.array(list(transmission.targets), dtype=int)
    other = np.ones(m.nu, dtype=bool)
    other[targets] = False
    exact = {
        "lengths": np.array_equal(actual_lengths[other], raw.actuator_length[other]),
        "velocities": np.array_equal(actual_velocities[other], raw.actuator_velocity[other]),
        "nativeMomentRows": np.array_equal(actual_jac[other], raw_jac[other]),
    }
    velocity_oracle = jac @ raw.qvel
    expected_force = oracle.passive_bias(lengths) + activation*oracle.active_gain(lengths, velocity_oracle)
    original_force = (oracle.passive_bias(raw.actuator_length.copy(), original_law=True)
                      + activation*oracle.active_gain(raw.actuator_length, raw.actuator_velocity))
    unchanged_force = other.copy()
    series_ids = np.array(list(oracle.fds_series), dtype=int)
    unchanged_force[series_ids] = False
    checks = {
        "lengthM": (float(np.max(np.abs(actual_lengths-lengths))), 1e-10),
        "targetJacobianMPerRad": (float(np.max(np.abs(actual_jac[targets]-jac[targets]))), 2e-5),
        "velocityMPerS": (float(np.max(np.abs(actual_velocities-velocity_oracle))), 1e-7),
        "all740ForceN": (float(np.max(np.abs(actual_force-expected_force))), 1e-6),
        "unchangedActuatorsOriginalForceN": (float(np.max(np.abs(actual_force[unchanged_force]
                                             -original_force[unchanged_force]))), 1e-6),
        "generalizedForce": (float(np.max(np.abs(actual_qforce-jac.T@expected_force))), 2e-6),
        "powerW": (abs(float(native_v@actual_qforce-velocity_oracle@expected_force)), 2e-6),
    }
    projected = actual_jac @ projection
    del raw
    oracle.release_workspaces()
    step = 2e-6
    rows = []
    for name in axes:
        plus, minus = q.copy(), q.copy()
        plus[name] += math.degrees(step)
        minus[name] -= math.degrees(step)
        high = ctx.state(plus, _skip_hand_correction=True)[0].actuator_length[targets].copy()
        low = ctx.state(minus, _skip_hand_correction=True)[0].actuator_length[targets].copy()
        difference = (high-low)/(2*step)
        err = float(np.max(np.abs(difference-projected[targets, ctx.index[name]])))
        rows.append({"axis": name, "maxTargetJacobianErrorMPerRad": err})
    ok = (all(exact.values()) and all(math.isfinite(e) and e <= limit for e, limit in checks.values())
          and all(math.isfinite(row["maxTargetJacobianErrorMPerRad"])
                  and row["maxTargetJacobianErrorMPerRad"] <= 2e-5 for row in rows))
    return {"id": "production-effective-tendon-transmission", "label": "有效肌腱长度、速度、逐肌力与虚功",
            "status": "passed" if ok else "failed", "targets": [oracle.audit.muscle_names[i] for i in targets],
            "unchangedLengthAndMomentRows": int(other.sum()),
            "unchangedForceAtEqualInputs": int(unchanged_force.sum()), "passiveLawOnlyChanged": len(series_ids),
            "unchangedNativeDataExact": exact,
            "errors": {k: e for k, (e, _) in checks.items()}, "limits": {k: limit for k, (_, limit) in checks.items()},
            "finiteDifferenceStepRad": step, "coordinateDifferences": rows, "mixedPosePublic": q,
            "velocityPublic": velocity, "activationRange": [float(activation.min()), float(activation.max())],
            "nativeMomentChangePerTarget": np.max(np.abs(actual_jac[targets]-raw_jac[targets]), axis=1).tolist()}


def hand_report_fields(frame):
    """Keep the quantities actually consumed by the independent hand/shoulder checks."""
    keys = ("q", "quantitativeValid", "handReferenceTorques", "jointPassiveTorques",
            "otherJointPassiveTorques", "rawTorques", "externalTorques", "torques", "passiveTorques")
    out = {key: frame[key] for key in keys if key in frame}
    if "muscles" in frame:
        out["muscles"] = [{key: unit[key] for key in ("name", "passiveForce") if key in unit}
                          for unit in frame["muscles"]]
    return out


def production_checks(audit=None):
    """Exercise production results, with an independent native reference."""
    engine = ENGINE
    solver = runtime_module("fullbody_solver")
    grasp = runtime_module("grasp")
    # The XML was compiled before the production USER callback. Keep its
    # immutable model but no independent data arena during grasp/motion solves.
    audit = Audit() if audit is None else audit
    audit.release_data()
    gc.collect()
    print(f"Native audit: production motion (independent arena size {audit.model.narena} bytes; released).", flush=True)
    ctx = engine.context()

    def scene(q, load=0.0, support="seated"):
        return solver.normalize({"keyframes": [{"t": 0.0, "q": q}, {"t": 0.2, "q": q}],
                                 "loadKg": load, "support": support, "hand": "right"})

    def solve_frame(q, load=0.0, velocity=None, acceleration=None):
        configured = scene(q, load)
        normalized = configured["keyframes"][0]["q"]
        return solver.solve_frame(normalized, velocity or {}, acceleration or {}, configured)[0]

    closure = grasp.attach({"q": {}, "loadKg": 2})
    if not closure["grasp"]["geometryValid"]:
        raise RuntimeError("受控握持基准未形成有效接触几何。")
    held_q = closure["q"]
    dynamic_q = dict(held_q, elbow_flexion_r=45, shoulder_elv_r=15, T1_head_neck_FE=8)
    velocity = {"elbow_flexion_r": 20, "shoulder_elv_r": 5, "T1_head_neck_FE": 2}
    acceleration = {"elbow_flexion_r": 40, "shoulder_elv_r": -10, "T1_head_neck_FE": 3}
    dynamic = solve_frame(dynamic_q, 0, velocity, acceleration)
    loaded_dynamic = solve_frame(dynamic_q, 2, velocity, acceleration)
    data, projection = ctx.state(dynamic_q, velocity, acceleration)
    inertia = np.zeros((ctx.model.nv, ctx.model.nv))
    mujoco.mj_fullM(ctx.model, data, inertia)
    expected = projection.T @ (inertia @ data.qacc + data.qfrc_bias)
    actual = np.array([dynamic["rawTorques"][name] for name in ctx.names])
    raw_error = float(np.max(np.abs(actual - expected)))
    del data, inertia

    hand_id = ctx.body_ids["capitate"]

    def point_at(pose):
        state, _ = ctx.state(pose, _skip_hand_correction=True)
        return state.xpos[hand_id] + state.xmat[hand_id].reshape(3, 3) @ grasp.PALM_CENTER

    def rotation_at(pose):
        state, _ = ctx.state(pose, _skip_hand_correction=True)
        return grasp.palm_frame(ctx, state, "r")[2]

    def vee(matrix):
        return np.array([matrix[2, 1] - matrix[1, 2], matrix[0, 2] - matrix[2, 0], matrix[1, 0] - matrix[0, 1]]) / 2

    time_step = 2e-4
    plus = {name: value + velocity.get(name, 0.0) * time_step + 0.5 * acceleration.get(name, 0.0) * time_step ** 2 for name, value in dynamic_q.items()}
    minus = {name: value - velocity.get(name, 0.0) * time_step + 0.5 * acceleration.get(name, 0.0) * time_step ** 2 for name, value in dynamic_q.items()}
    point_acceleration = (point_at(plus) - 2 * point_at(dynamic_q) + point_at(minus)) / time_step ** 2
    load = loaded_dynamic["loads"][0]
    reported_acceleration = engine.WORLD.T @ np.array(load["acceleration"])
    acceleration_error = float(np.max(np.abs(point_acceleration - reported_acceleration)))
    force = engine.WORLD.T @ np.array(load["force"])
    force_error = float(np.max(np.abs(force - 2 * (ctx.model.opt.gravity - point_acceleration))))
    r0, rp, rm = rotation_at(dynamic_q), rotation_at(plus), rotation_at(minus)
    dr = (rp - rm) / (2 * time_step)
    ddr = (rp - 2 * r0 + rm) / time_step ** 2
    omega = vee(dr @ r0.T)
    alpha = vee(ddr @ r0.T + dr @ dr.T)
    tensor = r0 @ grasp.inertia(2, grasp.geometry("dumbbell")) @ r0.T
    expected_moment = -(tensor @ alpha + np.cross(omega, tensor @ omega))
    moment = engine.WORLD.T @ np.array(load["moment"])
    moment_error = float(np.max(np.abs(moment - expected_moment)))
    virtual_work = []
    for name in ("elbow_flexion_r", "shoulder_elv_r", "L5_S1_FE", "T1_head_neck_FE", "pelvis_ty"):
        step = 1e-4
        a, b = dict(dynamic_q), dict(dynamic_q)
        a[name] += step
        b[name] -= step
        derivative = (point_at(a) - point_at(b)) / (2 * step / ctx.factor[name])
        angular_derivative = vee((rotation_at(a) - rotation_at(b)) @ r0.T / (2 * step / ctx.factor[name]))
        expected_delta = -float(derivative @ force + angular_derivative @ moment)
        actual_delta = loaded_dynamic["torques"][name] - dynamic["torques"][name]
        virtual_work.append({"coordinate": name, "expectedLoadTorque": expected_delta,
                             "actualLoadTorque": actual_delta, "absoluteError": abs(actual_delta - expected_delta)})
    dynamics_ok = raw_error < 1e-8 and acceleration_error < 2e-5 and force_error < 4e-5 and moment_error < 2e-5 and loaded_dynamic["quantitativeValid"] and all(x["absoluteError"] < 2e-5 for x in virtual_work)
    dynamics_check = {"id": "production-dynamic-load", "label": "实际求解链的惯性与手持动载", "status": "passed" if dynamics_ok else "failed",
                      "criterion": "完整质量矩阵与armature对照；闭合手实际接触配力须通过。器械COM加速度与转动惯性矩用位置/旋转时间差分核查，祖先关节负荷用六维wrench虚功核查。",
                      "maxRawTorqueError": raw_error, "maxGripAccelerationErrorMps2": acceleration_error,
                      "maxLoadForceErrorN": force_error, "maxLoadMomentErrorNm": moment_error, "loadedFrameValid": loaded_dynamic["quantitativeValid"], "virtualWorkCases": virtual_work,
                      "q": dynamic_q, "velocity": velocity, "acceleration": acceleration}

    unloaded = solve_frame(held_q)
    loaded = solve_frame(held_q, 2)
    force_before = {x["name"]: x["force"] for x in unloaded["muscles"]}
    force_after = {x["name"]: x["force"] for x in loaded["muscles"]}
    changes = []
    if unloaded["quantitativeValid"] and loaded["quantitativeValid"]:
        changes = sorted(({"muscle": name, "beforeN": force_before[name], "afterN": force_after[name], "deltaN": force_after[name] - force_before[name]}
                          for name in force_before), key=lambda x: abs(x["deltaN"]), reverse=True)[:12]
    stop_errors = []
    for frame in (unloaded, loaded):
        for name, reaction in frame.get("jointLimitTorques", {}).items():
            if abs(reaction) < 1e-10:
                continue
            joint = ctx.joint_ids[name]
            value = (frame["q"][name] - (ctx.pelvis_height if name == "pelvis_ty" else 0.0)) / ctx.factor[name]
            low, high = ctx.model.jnt_range[joint]
            allowed = (abs(value - low) < 2e-8 and reaction >= 0) or (abs(value - high) < 2e-8 and reaction <= 0)
            if not allowed:
                stop_errors.append({"coordinate": name, "angleRadians": value, "reaction": reaction, "sourceRange": [float(low), float(high)]})
    departure_cases = []
    for mode in ("velocity", "acceleration"):
        moving = solve_frame({}, velocity={"2pm_flexion": 1.0} if mode == "velocity" else None,
                             acceleration={"2pm_flexion": 1.0} if mode == "acceleration" else None)
        omitted = "2pm_flexion" not in moving.get("jointLimitTorques", {})
        departure_cases.append({"mode": mode, "coordinate": "2pm_flexion", "stopOmitted": omitted})
    elbow_increase = loaded["torques"]["elbow_flexion_r"] - unloaded["torques"]["elbow_flexion_r"]
    load_ok = unloaded["quantitativeValid"] and loaded["quantitativeValid"] and elbow_increase > 1 and changes and any(x["deltaN"] > 1 for x in changes) and not stop_errors and all(x["stopOmitted"] for x in departure_cases)
    for frame in (unloaded, loaded):
        load_ok = load_ok and frame["recruitment"]["optimizer"]["success"] and frame["balanceErrorNm"] < 1e-6
        if frame["quantitativeValid"]:
            load_ok = load_ok and all(x["force"] >= -1e-8 and -1e-9 <= x["activation"] <= 1 + 1e-9 for x in frame["muscles"])
    load_check = {"id": "production-controlled-load", "label": "实际740肌肉配力的受控配重响应", "status": "passed" if load_ok else "failed",
                  "criterion": "右肘源零位、同一闭合手指姿势和骨盆支撑下0→2kg；两次均精确可行，激活0..1，肌肉仅拉力。带载手不使用指关节止挡替代握力，其余止挡只在原始界限且方向合法。",
                  "unloadedValid": unloaded["quantitativeValid"], "loadedValid": loaded["quantitativeValid"],
                  "unloadedResidualNm": unloaded["balanceErrorNm"], "loadedResidualNm": loaded["balanceErrorNm"],
                  "elbowTorqueIncreaseNm": elbow_increase, "muscleChanges": changes, "illegalStops": stop_errors,
                  "jointStopTorquesNm": loaded.get("jointLimitTorques", {}), "departingBoundaryCases": departure_cases}

    failures = []
    invalid_branch_frames = []
    for name, configured in (("过重手持负载", scene(held_q, 50)),
                             ("张手不能挂载", scene({"elbow_flexion_r": 20}, 5)),
                             ("悬空足底承重", scene({"pelvis_ty": 1.25}, 0, "feet"))):
        result = solver.solve(configured)
        invalid_branch_frames.extend(result["frames"])
        poses_retained = bool(result["frames"]) and all(frame.get("bodies") and frame.get("q") == configured["keyframes"][0]["q"] for frame in result["frames"])
        forces_hidden = all(not frame["muscleValid"] and not frame["quantitativeValid"] and frame["muscleTorques"] is None and all(mu["force"] is None and mu["activation"] is None for mu in frame["muscles"]) for frame in result["frames"])
        ok = result["status"] == "infeasible" and not result["quantitativeValid"] and bool(result["failures"]) and poses_retained and forces_hidden
        failures.append({"case": name, "status": "passed" if ok else "failed", "resultStatus": result["status"],
                         "posesRetained": poses_retained, "forcesHidden": forces_hidden, "failedFrames": len(result["failures"]),
                         "frameCount": len(result["frames"]), "reasons": result["failures"][:2]})
    recovered = solver.solve(scene(held_q, 2))
    failures.append({"case": "失败后重新求解有效配重", "status": "passed" if recovered["quantitativeValid"] else "failed", "resultStatus": recovered["status"]})
    failure_check = {"id": "production-reject-and-retain-pose", "label": "不可能动作停用肌力、保留姿势并可恢复", "status": "passed" if all(x["status"] == "passed" for x in failures) else "failed",
                     "criterion": "50kg负载和悬空足底均须不可行；所有帧保留骨架姿势，隐藏肌力/激活，再次有效求解可恢复。", "cases": failures}
    checks = [dynamics_check, load_check, failure_check]
    has_hand = "handElasticity" in ctx.manifest
    repair_model = (MODEL_ID == "ms740-motion-repair-bodyvista-research-v4" or
                    "shoulderMechanics" in ctx.manifest or "tendonBranches" in ctx.manifest
                    or has_hand)
    if repair_model:
        # The first held pose is feasible; the final open hand cannot retain a
        # load. This exercises the whole-sequence cleanup, not just bad frames.
        mixed_scene = scene(held_q, 2)
        mixed_scene["keyframes"][-1]["q"] = dict(ctx.defaults)
        mixed = solver.solve(mixed_scene)
        mixed_failure = bool(mixed["status"] == "infeasible" and mixed.get("failures") and
                             any(frame.get("frameFeasible") is True for frame in mixed["frames"]))
        invalid_branch_frames.extend(mixed["frames"])
        preview = solver.solve({**scene(held_q, 2), "preview": True})
        invalid_branch_frames.extend(preview["frames"])
        branches = tendon_branch_check(
            ctx, [dynamic, loaded_dynamic, unloaded, loaded, *recovered["frames"]],
            invalid_branch_frames, mixed_failure=mixed_failure)
        del mixed, preview
    shoulder_frame = hand_report_fields(dynamic)
    if has_hand:
        cases = [(label, hand_report_fields(frame), np.ones(ctx.model.nu)) for label, frame in (
            ("unloaded-dynamic", dynamic), ("loaded-dynamic", loaded_dynamic),
            ("unloaded-static", unloaded), ("loaded-static", loaded))]
        cases.extend((f"recovered-{i}", hand_report_fields(frame), np.ones(ctx.model.nu))
                     for i, frame in enumerate(recovered["frames"]))
    # Body meshes and hundreds of branch paths have already been checked above.
    invalid_branch_frames = [{key: f.get(key) for key in
                              ("handReferenceTorques", "otherJointPassiveTorques", "externalTorques")}
                             for f in invalid_branch_frames]
    del dynamic, loaded_dynamic, unloaded, loaded, recovered, frame, moving, result
    if has_hand:
        for strength, muscles in ((0.8, {}), (1.2, {"FDSI": 0.9, "FDSI_l": 1.1})):
            configured = solver.normalize({**scene(held_q), "strengthScale": strength, "muscleScale": muscles})
            scaled = solver.solve_frame(configured["keyframes"][0]["q"], {}, {}, configured)[0]
            scale = np.array([strength * muscles.get(name, 1.0) for name in ctx.muscle_names])
            cases.append((f"strength-{strength}", hand_report_fields(scaled), scale))
            del scaled
    hand_oracle = (HandPassiveAudit(ctx.manifest["handElasticity"], audit,
                                    transmission=ctx.manifest.get("effectiveTendonTransmission"))
                   if has_hand else None)
    if repair_model:
        print("Native audit: independent shoulder and hand comparisons.", flush=True)
        # The shoulder comparison intentionally disables constraints. Restore
        # flags before reusing this independent XML model for the hand oracle.
        flags = int(audit.model.opt.disableflags)
        try:
            checks.append(shoulder_damping_check(ctx, shoulder_frame, dynamic_q, velocity, acceleration,
                                                 hand_oracle, reference=audit))
        finally:
            audit.model.opt.disableflags = flags
            if has_hand:
                hand_oracle.release_workspaces()
            else:
                audit.release_data()
        checks.append(branches)
    if hand_oracle is not None:
        checks.append(hand_passive_check(ctx, solver, hand_oracle, dynamic_q, cases, invalid_branch_frames))
        checks.append(hand_oracle.audit.static_feasibility(hand_oracle))
        if hand_oracle.transmission is not None:
            checks.append(effective_tendon_check(ctx, hand_oracle))
        if hand_oracle.fds_series:
            hand_oracle.release_workspaces()
            checks.append(fds_series_constitutive_check(ctx, hand_oracle))
        hand_oracle.release_workspaces()
    return checks


def api_checks(base_url):
    cases = []
    for path in ("/api/fullbody/model", "/api/body/model", "/api/model",
                 "/experiments/elbow-lab/", "/experiments/body-lab/"):
        try:
            with urllib.request.urlopen(base_url.rstrip("/") + path, timeout=30) as response:
                payload = response.read()
                row = {"path": path, "httpStatus": response.status, "bytes": len(payload), "status": "passed"}
                if path.endswith("model"):
                    parsed = json.loads(payload)
                    row["modelId"] = parsed.get("id")
                    row["muscleCount"] = len(parsed.get("muscles", []))
                    if path == "/api/fullbody/model":
                        row["modelSha256"] = parsed.get("sourceSha256")
                        row["matchesLocalModel"] = row["modelSha256"] == hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
                        expected_computation = ENGINE.COMPUTATION_SHA256
                        row["computationSha256"] = parsed.get("computationSha256")
                        row["matchesLocalComputation"] = row["computationSha256"] == expected_computation
                        if row["modelId"] != MODEL_ID or row["muscleCount"] != 740 or not row["matchesLocalModel"] or not row["matchesLocalComputation"]:
                            row["status"] = "failed"
                cases.append(row)
        except (urllib.error.URLError, TimeoutError, ValueError) as error:
            cases.append({"path": path, "status": "failed", "error": str(error)})
    request = urllib.request.Request(base_url.rstrip("/") + "/api/fullbody/pose",
                                     data=json.dumps({"q": {"elbow_flexion_r": 300}, "computationSha256": ENGINE.COMPUTATION_SHA256}).encode(),
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30):
            cases.append({"path": "/api/fullbody/pose", "case": "invalid-range", "status": "failed"})
    except urllib.error.HTTPError as error:
        cases.append({"path": "/api/fullbody/pose", "case": "invalid-range", "httpStatus": error.code,
                      "status": "passed" if error.code == 422 else "pending" if error.code == 429 else "failed", "response": error.read().decode("utf-8")})
    except (urllib.error.URLError, TimeoutError) as error:
        cases.append({"path": "/api/fullbody/pose", "case": "invalid-range", "status": "failed", "error": str(error)})
    status = "failed" if any(c["status"] == "failed" for c in cases) else "pending" if any(c["status"] == "pending" for c in cases) else "passed"
    return {"id": "local-api-compatibility", "label": "本地服务与两套实验台兼容", "status": status,
            "criterion": "读取新旧模型和两个页面；超限新姿势返回422。此检查不代替求解和浏览器交互验收。", "cases": cases}


def run(api_url=None):
    if MODEL_ID == "ms740-shoulder-hand-franko-v5" and (
            (MODEL_MANIFEST.get("effectiveTendonTransmission") or {}).get("passiveSeries") != FDS_SERIES_DECLARATION):
        raise ValueError("This audit requires the selected and pinned eight-FDS series model")
    source_identity = (file_hash(MODEL_PATH), file_hash(MODEL_MANIFEST_PATH),
                       ENGINE.computation_fingerprint(), file_hash(Path(__file__)))
    if source_identity[2] != ENGINE.COMPUTATION_SHA256:
        raise RuntimeError("计算源码在验证开始前变化，请启动新的验证进程。")
    audit = Audit()
    coverage_check, coverage = audit.coverage()
    checks = [coverage_check, audit.geometry(), audit.gravity(), audit.inverse_dynamics(),
              audit.force_bounds(), audit.region_response(), audit.left_hand_symmetry(), audit.static_feasibility(), audit.calibration()]
    labels = {
        "native-coverage": f"740 条肌腱与 {len(audit.independent) - 6} 个内部坐标覆盖",
        "tendon-jacobian-finite-difference": "肌腱长度差分与力臂",
        "gravity-potential-finite-difference": "重力势能与原生动力学",
        "native-inverse-dynamics": "原生逆动力学与质量矩阵",
        "native-muscle-force-bounds": "原生主动与被动张力边界",
        "regional-native-posture-response": "各区域姿态与真实张力响应",
        "left-hand-source-mirror": "左手镜像几何和张力",
        "independent-static-feasibility": "完整肌肉系统的独立静态可行性",
        "derived-hand-length-ranges": "v2历史手部长度校准来源（不证明当前路径）",
    }
    for check in checks:
        check["label"] = labels[check["id"]]
        geometry_only = (MODEL_MANIFEST.get("effectiveTendonTransmission") and check["id"] in
                         ("native-coverage", "tendon-jacobian-finite-difference"))
        if geometry_only or MODEL_MANIFEST.get("handElasticity") and check["id"] in (
                "native-inverse-dynamics", "native-muscle-force-bounds",
                "regional-native-posture-response", "left-hand-source-mirror",
                "independent-static-feasibility"):
            check["scope"] = "native-xml-only"
            check["label"] += "（XML原生对照）"
            check["scopeNote"] = "本项采用 XML 原生空间肌腱及原生本构。运行时手部被动力、有效肌腱传动和静态配力另作独立核验。"
    checks.extend(production_checks(audit))
    if api_url:
        checks.append(api_checks(api_url))
    if source_identity != (file_hash(MODEL_PATH), file_hash(MODEL_MANIFEST_PATH),
                           ENGINE.computation_fingerprint(), file_hash(Path(__file__))):
        raise RuntimeError("模型、manifest或计算/验证源码在验证期间变化；未发布验证JSON。")
    digest = source_identity[0]
    common = {"model": MODEL_ID, "modelSha256": digest,
              "computationSha256": ENGINE.COMPUTATION_SHA256,
              "modelManifestSha256": source_identity[1], "verificationCodeSha256": source_identity[3],
              "mujocoVersion": mujoco.__version__, "generatedAt": datetime.now(timezone.utc).isoformat()}
    coverage.update(common)
    force_check = next(c for c in checks if c["id"] == "native-muscle-force-bounds")
    neutral_force_case = next(c for c in force_check["cases"] if c["seed"] is None)
    coverage["nativeNeutralActivelyCapableUnits"] = neutral_force_case["activeForceNonzeroCount"]
    coverage.update({"sourceActuators": 700, "addedHandIntrinsicActuators": 40,
                     "scalarJoints": audit.model.njnt, "jointEqualities": audit.model.neq,
                     "analyticKneeRelations": len(audit.axial_relations),
                     "independentCoordinatesIncludingRoot": len(audit.independent),
                     "limits": ["五指均可动，但各足只有一个整体跖趾自由度，未分离每根足趾。",
                                "颈部为头颈整体三轴关节，未分离七节颈椎。",
                                "肋间肌与逐根肋骨可计算，不包含膈肌、肺气压、胸肋软骨和完整呼吸生理。",
                                "无眼外肌、面部表情肌、舌肌、咀嚼肌或盆底模型。",
                                "左手新增关节轴及肌肉参数采用左右对称假设；左手几何和附着点来自原始模型。",
                                ("手部含声明的伸肌腱膜分支近似；分支传力与长度参数须按当前模型验证，v2的14条长度校准仅为历史来源，不是人体测量。"
                                 if MODEL_MANIFEST.get("tendonBranches") else
                                 "v2历史14条手内在肌长度范围来自几何与关节范围算法重估；不是独立人体测量，当前模型未补建伸肌腱膜。"),
                                "处于原始关节界限的静止姿态可由合法单向止挡承担部分力矩，止挡反力与肌力分开报告。",
                                "740为肌腱执行单元数量，不等于740块独立解剖肌肉；多束划分和左右计数不可混用。",
                                "数值一致性不等于人体张力真值或临床验证。"]})
    if MODEL_MANIFEST.get("handElasticity"):
        coverage["limits"].append("36条手部肌腱采用声明的Thelen被动力，24个指屈伸坐标采用固定参考修正；这是通用参数的混合研究模型，不是完整Thelen肌肉或独立测得的韧带力。")
    if MODEL_MANIFEST.get("effectiveTendonTransmission"):
        coverage["geometryScope"] = "original-xml-spatial-tendons"
        coverage["effectiveTransmissionCheck"] = "production-effective-tendon-transmission"
        coverage["limits"].append("区域几何覆盖统计使用原 XML 空间肌腱。清单中具名的肌腱另用有效长度、力矩臂与逐肌功率核验。")
    if (MODEL_MANIFEST.get("effectiveTendonTransmission") or {}).get("passiveSeries"):
        coverage["passiveSeriesCheck"] = "production-fds-series-passive-law"
        coverage["limits"].append("八条浅指屈肌的被动张力由纤维和肌腱串联平衡决定。验证使用两者储能之和；主动增益仍按原模型计算。")
    validation = {**common, "status": "passed" if all(x["status"] == "passed" for x in checks) else "failed",
                  "scope": ("独立原生几何与动力学对照；当前手部混合本构另用独立exp公式、参考势能及固定单位强度的201内部坐标静态LP核验。"
                            if MODEL_MANIFEST.get("handElasticity") else
                            "独立原生几何、动力学、肌肉本构与完整系统静态可行性检查。"), "checks": checks,
                  "externalValidation": {"status": "pending", "scope": "浏览器与HTTP当前模型版本须另行验收；不继承旧版本界面通过结果。",
                                         "evidence": "fullbody-ui-validation.json",
                                         "note": "数值脚本不会操作浏览器，须核对界面报告modelSha256。"},
                  "pending": ["人体或外部实验测量验证"] + ([] if api_url else ["双实验台服务兼容"])}
    write_json(HERE / "fullbody-coverage.json", coverage)
    write_json(HERE / "fullbody-validation.json", validation)
    print(json.dumps({"status": validation["status"], "checks": [{k: v for k, v in c.items() if k not in ("cases", "poseRadians", "zeroActiveCapacityAtThisPose", "withoutStops", "withStops", "beforeCalibration", "virtualWorkCases", "q", "velocity", "acceleration", "muscleChanges", "jointStopTorquesNm")} for c in checks]}, ensure_ascii=False, indent=2))
    return 0 if validation["status"] == "passed" else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", help="可选：同时检查运行中的本地服务，例如 http://127.0.0.1:4192")
    args = parser.parse_args()
    raise SystemExit(run(args.api_url))
