"""Native MuJoCo whole-body research variant, with exact coordinate coupling.

Public angles are degrees, positions metres in X-forward/Y-up/Z-right. The
source XML uses Z-up. Callers serialize access to the cached native model.
"""

import hashlib
import json
import math
import re
from functools import lru_cache
from itertools import pairwise
from pathlib import Path

import mujoco
import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation

if __package__:
    from .anatomy_constraints import AnatomyConstraints, knee_rotation_limits
    from . import hand_mechanics, model_mechanics
else:
    from anatomy_constraints import AnatomyConstraints, knee_rotation_limits
    import hand_mechanics
    import model_mechanics

HERE = Path(__file__).resolve().parent
V4_MODEL_ID = "ms740-motion-repair-bodyvista-research-v4"
V5_MODEL_ID = "ms740-shoulder-hand-franko-v5"
V4_MANIFEST_NAME = "expanded-motion-repair-manifest.json"
V4_MANIFEST_SHA256 = "50303263621e3b56c4e3c2c5310cf2d423a79015e77957a680250a7f796e3bd3"


def computation_fingerprint():
    """Identify calculation code and declarations separately from the source XML."""
    digest = hashlib.sha256()
    for name in ("fullbody_engine.py", "fullbody_solver.py", "grasp.py", "anatomy_constraints.py", "model_mechanics.py", "hand_mechanics.py", "native_worker.py", "franko_transmission.py", "passive_series.py"):
        digest.update(name.encode("utf-8") + b"\0")
        digest.update((HERE / name).read_bytes())
        digest.update(b"\0")
    digest.update(b"model-manifest-sha256\0")
    digest.update(hashlib.sha256(MODEL_MANIFEST_PATH.read_bytes()).digest())
    digest.update(b"\0")
    return digest.hexdigest()


MODEL_PATH = HERE / "candidates/runtime/expanded-motion-repair.xml"
MODEL_MANIFEST_PATH = MODEL_PATH.with_name("expanded-motion-repair-v5-manifest.json")
MODEL_ID = V5_MODEL_ID
COMPUTATION_SHA256 = computation_fingerprint()
COMPATIBLE_POSE_MODELS = [
    V4_MODEL_ID,
    "ms740-knee-rotation-bodyvista-research-v3",
    "ms740-restored-calibrated-bodyvista-research-v2",
]
WORLD = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, -1.0, 0.0]])
# Source knee polynomial fits slightly overshoot rounded dependent limits near
# extension. Keep a declared sub-millimetre/sub-degree tolerance, while rejecting
# the much larger violations at the source independent maximum flexion.
COUPLED_ROTATION_TOLERANCE = 1e-3
COUPLED_TRANSLATION_TOLERANCE = 5e-5


class ScenarioError(ValueError):
    """Unsupported or malformed scenario."""


def _validated_franko_module(manifest):
    """Verify this is exactly the v4 declaration plus the named v5 transmission."""
    base = {"file": V4_MANIFEST_NAME, "sha256": V4_MANIFEST_SHA256}
    if manifest.get("baseModelManifest") != base:
        raise RuntimeError("v5 引用的 v4 模型清单与已核验版本不符。")
    raw = (MODEL_MANIFEST_PATH.parent / V4_MANIFEST_NAME).read_bytes()
    if hashlib.sha256(raw).hexdigest() != V4_MANIFEST_SHA256:
        raise RuntimeError("v4 基础模型清单内容已变化。")
    status = manifest.get("transmissionStatus")
    if status != "selected":
        raise RuntimeError("v5 清单尚未选择要计算的手指传动。")
    module_sha = hashlib.sha256((HERE / "franko_transmission.py").read_bytes()).hexdigest()
    if module_sha != manifest.get("transmissionModuleSha256"):
        raise RuntimeError("v5 手指传动源代码与当前清单指定的版本不符。")
    if __package__:
        from . import franko_transmission
    else:
        import franko_transmission

    inherited = json.loads(raw)
    if inherited.get("modelId") != V4_MODEL_ID or inherited.get("derivedSha256") != franko_transmission.V4_MODEL_SHA:
        raise RuntimeError("v5 手指传动与基础人体模型不匹配。")
    expected = dict(inherited, modelId=V5_MODEL_ID, baseModelManifest=base,
                    transmissionStatus=status, transmissionModuleSha256=module_sha,
                    effectiveTendonTransmission=franko_transmission.declaration())
    if json.dumps(manifest, sort_keys=True, allow_nan=False) != json.dumps(expected, sort_keys=True, allow_nan=False):
        raise RuntimeError("v5 的原模型材料、肌腱名称、关节或力臂曲线与已核验声明不符。")
    return franko_transmission


def finite(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ScenarioError(f"{label} 必须是有限数字。")
    try:
        converted = float(value)
    except (OverflowError, TypeError, ValueError) as exc:
        raise ScenarioError(f"{label} 必须是有限数字。") from exc
    if not math.isfinite(converted):
        raise ScenarioError(f"{label} 必须是有限数字。")
    return converted


def dense_moments(model, data):
    values = np.asarray(data.actuator_moment)
    if values.ndim == 2:
        return values.copy()
    out = np.zeros((model.nu, model.nv))
    for index in range(model.nu):
        start = int(data.moment_rowadr[index])
        end = start + int(data.moment_rownnz[index])
        out[index, data.moment_colind[start:end]] = values[start:end]
    return out


def transform(rotation, position):
    matrix = np.eye(4)
    matrix[:3, :3] = rotation
    matrix[:3, 3] = position
    return np.round(matrix.T.reshape(-1), 6).tolist()


def quat_matrix(quat):
    out = np.zeros(9)
    mujoco.mju_quat2Mat(out, quat)
    return out.reshape(3, 3)


def body_label(name):
    side = "左" if name.endswith(("_l", "_L")) else "右"
    stem = name.removesuffix("_l").removesuffix("_r")
    if name.startswith("lumbar"):
        return "腰椎" + name.removeprefix("lumbar")
    if name.startswith("thoracic"):
        return "胸椎" + name.removeprefix("thoracic")
    match = re.fullmatch(r"rib(\d+)_([RL])", name)
    if match:
        return ("右" if match[2] == "R" else "左") + "第" + match[1] + "肋"
    match = re.fullmatch(r"([2-5])(proxph|midph|distph)", stem)
    if match:
        return (
            side
            + {"2": "食指", "3": "中指", "4": "无名指", "5": "小指"}[match[1]]
            + {"proxph": "近节", "midph": "中节", "distph": "末节"}[match[2]]
        )
    labels = {
        "Abdomen": "腹部",
        "head_neck": "头颈",
        "proximal_thumb": "拇指近节",
        "distal_thumb": "拇指末节",
        "firstmc": "第一掌骨",
        "firstmc1": "拇指根部",
        "secondmc": "第二掌骨",
        "thirdmc": "第三掌骨",
        "fourthmc": "第四掌骨",
        "fifthmc": "第五掌骨",
        "proximal_row": "腕骨",
        "capitate": "手掌",
        "trapezium": "大多角骨",
        "trapezoid": "小多角骨",
        "hamate": "钩骨",
        "radius": "桡骨",
        "ulna": "尺骨",
        "humerus": "上臂",
        "scapula": "肩胛",
        "clavicle": "锁骨",
        "calcn": "足跟",
        "talus": "踝",
        "toes": "足趾",
    }
    return (
        ("" if stem in ("Abdomen", "head_neck") else side) + labels[stem]
        if stem in labels
        else name
    )


class ModelContext:
    def __init__(self):
        manifest = json.loads(MODEL_MANIFEST_PATH.read_text("utf-8"))
        repaired_model = MODEL_ID in (V4_MODEL_ID, V5_MODEL_ID)
        if ((repaired_model and manifest.get("modelId") != MODEL_ID)
            or ("modelId" in manifest and manifest["modelId"] != MODEL_ID)):
            raise RuntimeError("模型版本与派生声明中的 modelId 不符。")
        if repaired_model:
            for field in ("shoulderMechanics", "handMechanics", "tendonBranches"):
                if not isinstance(manifest.get(field), dict) or not manifest[field]:
                    raise RuntimeError(f"v4 模型缺少必要的 {field} 声明。")
        elif "shoulderMechanics" in manifest or "handElasticity" in manifest:
            raise RuntimeError("当前模型版本不允许叠加 v4 肩部阻尼；请使用完整核验的 v4 模型。")
        franko = _validated_franko_module(manifest) if MODEL_ID == V5_MODEL_ID else None
        if franko is None and "effectiveTendonTransmission" in manifest:
            raise RuntimeError("手指有效传动声明只适用于具名的 v5 模型。")
        self.sha = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()
        if self.sha != manifest["derivedSha256"]:
            raise RuntimeError("扩展模型与派生记录不符，请先重新核验来源。")
        for path_key, hash_key in (("derivedFrom", "derivedFromSha256"), ("derivedFromManifest", "derivedFromManifestSha256")):
            if hashlib.sha256((MODEL_PATH.parent / manifest[path_key]).read_bytes()).hexdigest() != manifest[hash_key]:
                raise RuntimeError("派生模型的父版本与记录不符。")
        source_path = MODEL_PATH.parent / manifest["sourceManifest"]
        if hashlib.sha256(source_path.read_bytes()).hexdigest() != manifest.get(
            "sourceManifestSha256"
        ):
            raise RuntimeError("源模型资产清单与派生记录不符。")
        source_manifest = json.loads(source_path.read_text("utf-8"))
        for asset in source_manifest["files"]:
            if (
                hashlib.sha256(
                    (source_path.parent / asset["path"]).read_bytes()
                ).hexdigest()
                != asset["sha256"]
            ):
                raise RuntimeError("源模型文件校验失败：" + asset["path"])
        self.model = mujoco.MjModel.from_xml_path(str(MODEL_PATH))
        self.manifest = manifest
        self.hand_elasticity = None
        self.franko_transmission = None
        if "handElasticity" in manifest and (
                not isinstance(manifest["handElasticity"], dict) or not manifest["handElasticity"]):
            raise RuntimeError("手指被动模型声明缺失或无效。")
        self.shoulder_mechanics = manifest.get("shoulderMechanics")
        if "shoulderMechanics" in manifest and (
            not isinstance(self.shoulder_mechanics, dict)
            or self.shoulder_mechanics.get("type") != "relative-glenohumeral-viscous-v1"
            or isinstance(self.shoulder_mechanics.get("dampingNmsPerRad"), bool)
            or self.shoulder_mechanics.get("dampingNmsPerRad") != model_mechanics.SHOULDER_DAMPING_NMS_PER_RAD
        ):
            raise RuntimeError("肩部力学声明与当前计算公式不符。")
        m = self.model
        if m.nq != m.nv or np.any(~np.isin(m.jnt_type, [2, 3])):
            raise RuntimeError("本适配器要求源模型的标量平移/转动关节。")
        if np.any(m.actuator_gaintype != mujoco.mjtGain.mjGAIN_MUSCLE):
            raise RuntimeError("扩展模型存在非肌肉执行器，不能混入逐肌输出。")
        # Coordinate equalities are imposed analytically below, so native soft
        # constraint corrections cannot conceal a failed recruitment balance.
        # Ground/support forces are supplied explicitly by the solver.
        m.opt.disableflags |= int(mujoco.mjtDisableBit.mjDSBL_CONSTRAINT)
        self.joint_ids = {m.joint(i).name: i for i in range(m.njnt)}
        self.body_ids = {m.body(i).name: i for i in range(1, m.nbody)}
        if self.shoulder_mechanics:
            for name in model_mechanics.SHOULDER_PARAMETER_COORDINATES:
                if name not in self.joint_ids:
                    raise RuntimeError(f"肩部工程阻尼缺少原生坐标 {name}。")
                joint = self.joint_ids[name]
                dof = int(m.jnt_dofadr[joint])
                if (m.jnt_stiffness[joint] != 0 or np.any(m.dof_damping[dof] != 0)
                    or m.dof_armature[dof] != 0):
                    raise RuntimeError(f"肩部坐标 {name} 的原生刚度、阻尼和附加惯量必须清零，不能重复计入。")
        self.coupled = {}
        for i in range(m.neq):
            if m.eq_type[i] != mujoco.mjtEq.mjEQ_JOINT or m.eq_obj2id[i] < 0:
                raise RuntimeError("扩展模型存在未支持的非标量耦合约束。")
            self.coupled[int(m.eq_obj1id[i])] = (
                int(m.eq_obj2id[i]),
                m.eq_data[i, :5].copy(),
            )
        self.knee_rotations = {}
        for relation in manifest["kneeAxialRelations"]:
            joint = self.joint_ids[relation["coordinate"]]
            self.knee_rotations[joint] = {
                **relation,
                "source": self.joint_ids[relation["flexionCoordinate"]],
                "coef": np.asarray(relation["baselinePolynomial"], dtype=float),
            }
        self.names = [
            name for name, i in self.joint_ids.items() if i not in self.coupled
        ]
        self.index = {name: i for i, name in enumerate(self.names)}
        self.factor = {
            name: 1.0 if m.jnt_type[self.joint_ids[name]] == 2 else 180 / math.pi
            for name in self.names
        }
        self.effective_ranges = {
            name: m.jnt_range[self.joint_ids[name]].copy() for name in self.names
        }
        for joint, relation in self.knee_rotations.items():
            self.effective_ranges[m.joint(joint).name] = np.deg2rad(relation["offsetRangeDeg"])
        baseline_relations = dict(self.coupled)
        baseline_relations.update({j: (r["source"], r["coef"]) for j, r in self.knee_rotations.items()})
        # An independent knee range is wider than several coupled source
        # patellar/translation ranges. Intersect all polynomial constraints;
        # keep the feasible interval containing the source reference posture.
        for name in self.names:
            source = self.joint_ids[name]
            lo, hi = self.effective_ranges[name]
            reference = m.qpos0[m.jnt_qposadr[source]]
            for dependent, (parent, coef) in baseline_relations.items():
                if parent != source or not m.jnt_limited[dependent]:
                    continue
                lower, upper = (
                    self.knee_rotations[dependent]["sourceBaselineRangeRad"]
                    if dependent in self.knee_rotations else m.jnt_range[dependent]
                )
                limit_tolerance = (
                    COUPLED_TRANSLATION_TOLERANCE
                    if m.jnt_type[dependent] == 2
                    else COUPLED_ROTATION_TOLERANCE
                )
                lower, upper = lower - limit_tolerance, upper + limit_tolerance
                offset = m.qpos0[m.jnt_qposadr[dependent]]
                edges = [lo, hi]
                for bound in (lower, upper):
                    polynomial = coef.copy()
                    polynomial[0] += offset - bound
                    edges.extend(
                        float(root.real + reference)
                        for root in np.polynomial.polynomial.polyroots(polynomial)
                        if abs(root.imag) < 1e-8 and lo < root.real + reference < hi
                    )
                edges = sorted(set(edges))
                intervals = [
                    (a, b)
                    for a, b in pairwise(edges)
                    if lower - 1e-9
                    <= offset
                    + np.polynomial.polynomial.polyval((a + b) / 2 - reference, coef)
                    <= upper + 1e-9
                ]
                candidates = [
                    (a, b) for a, b in intervals if a - 1e-9 <= reference <= b + 1e-9
                ]
                if not candidates:
                    raise RuntimeError(f"源坐标 {name} 参考姿势违反从属关节范围。")
                lo, hi = candidates[0]
            self.effective_ranges[name] = np.array([lo, hi])
        self.defaults = {
            name: float(
                m.qpos0[m.jnt_qposadr[self.joint_ids[name]]] * self.factor[name]
            )
            for name in self.names
        }
        # The frontend presents pelvis_ty as absolute pelvis height, matching
        # the existing editor. Source XML encodes it relative to the 0.95 m root.
        self.pelvis_height = float(m.body_pos[self.body_ids["pelvis"], 2])
        self.defaults["pelvis_ty"] += self.pelvis_height
        self.aliases = {}
        for side in "rl":
            self.aliases.update(
                {
                    f"elbow_flex_{side}": f"elbow_flexion_{side}",
                    f"wrist_flex_{side}": f"flexion_{side}",
                    f"wrist_dev_{side}": f"deviation_{side}",
                }
            )
        self.mass = float(np.sum(m.body_mass))
        self.muscle_names = [m.actuator(i).name for i in range(m.nu)]
        if m.nu != 740 or manifest.get("muscleCount") != 740 or len(set(self.muscle_names)) != 740:
            raise RuntimeError("派生模型必须保留全部 740 个独立命名的肌肉输入。")
        if "tendonBranches" in manifest:
            parent_model = mujoco.MjModel.from_xml_path(str(MODEL_PATH.parent / manifest["derivedFrom"]))
            parent_names = [parent_model.actuator(i).name for i in range(parent_model.nu)]
            del parent_model
            if self.muscle_names != parent_names:
                raise RuntimeError("肌腱分支模型改变了父版本的 740 个肌肉输入或顺序。")
        self.tendon_branches = self.validate_tendon_branches()
        self.regions = [self.muscle_region(i) for i in range(m.nu)]
        self.body_metadata = self.make_handles()
        # A body record is not automatically an editable joint. Fixed/coupled
        # bones retain labels and source metadata without creating fake handles;
        # the two wrist source bodies share one canonical capitate control.
        self.handles = [h for h in self.body_metadata if h["editable"]]
        self.bone_vertices = {}
        for body in self.body_ids.values():
            vertices = []
            for geom in range(m.body_geomadr[body], m.body_geomadr[body] + m.body_geomnum[body]):
                if m.geom_type[geom] != mujoco.mjtGeom.mjGEOM_MESH or m.geom_group[geom] != 0:
                    continue
                mid = int(m.geom_dataid[geom])
                start, count = int(m.mesh_vertadr[mid]), int(m.mesh_vertnum[mid])
                vertices.append(
                    m.mesh_vert[start : start + count] @ quat_matrix(m.geom_quat[geom]).T
                    + m.geom_pos[geom]
                )
            if vertices:
                self.bone_vertices[body] = np.vstack(vertices)
        self.data = mujoco.MjData(m)
        self.anatomy = AnatomyConstraints(self)
        if franko is not None:
            # HandMechanics.reference uses these same public defaults. Build the
            # uncorrected zero-flexion posture before installing its bias callback.
            reference = dict(self.defaults)
            targets = manifest["effectiveTendonTransmission"]["targets"]
            axes = {axis["joint"] for target in targets for axis in target["axes"]}
            for name in axes:
                if name not in reference:
                    raise RuntimeError(f"v5 有效传动缺少原生参考屈曲坐标 {name}。")
                reference[name] = 0.
            neutral, _ = self.state(reference, _skip_hand_correction=True)
            self.franko_transmission = franko.FrankoTransmission(m, neutral.qpos)
        if "handElasticity" in manifest:
            # Anatomy initialization samples the baseline pose. Finish every
            # model compilation before installing the process-wide callback.
            self.hand_elasticity = hand_mechanics.HandMechanics(self, manifest["handElasticity"])
            self.hand_elasticity.install()

    def validate_tendon_branches(self):
        definitions = self.manifest.get("tendonBranches", {})
        if not isinstance(definitions, dict) or set(definitions) - set(self.muscle_names):
            raise RuntimeError("肌腱分支声明包含未知肌肉或格式错误。")
        checked = {}
        m = self.model
        for actuator, name in enumerate(self.muscle_names):
            tendon = int(m.actuator_trnid[actuator, 0])
            pulleys = [k for k in range(m.tendon_adr[tendon], m.tendon_adr[tendon] + m.tendon_num[tendon])
                       if m.wrap_type[k] == mujoco.mjtWrap.mjWRAP_PULLEY]
            branches = definitions.get(name)
            if branches is None and name not in definitions:
                if pulleys:
                    raise RuntimeError(f"原生肌腱 {name} 存在未声明的分支。")
                continue
            if not isinstance(branches, list) or len(branches) != len(pulleys) + 1:
                raise RuntimeError(f"肌腱 {name} 的原生分支数与声明不符。")
            divisors = [float(m.wrap_prm[k]) for k in pulleys]
            if any(not math.isfinite(value) or value <= 0 for value in divisors):
                raise RuntimeError(f"肌腱 {name} 的原生分流系数无效。")
            coefficients = [1.0] + [1 / value for value in divisors]
            ids = set()
            checked[name] = []
            for branch, coefficient in zip(branches, coefficients):
                if not isinstance(branch, dict):
                    raise RuntimeError(f"肌腱 {name} 的分支声明格式错误。")
                value, branch_id = branch.get("coefficient"), branch.get("id")
                if (not isinstance(branch_id, str) or not branch_id or branch_id in ids
                    or not isinstance(branch.get("label"), str) or not branch["label"]
                    or isinstance(value, bool) or not isinstance(value, (int, float))
                    or not math.isfinite(value) or value <= 0
                    or not math.isclose(value, coefficient, rel_tol=1e-10, abs_tol=1e-12)):
                    raise RuntimeError(f"肌腱 {name} 的分支标识或传力比例与原生模型不符。")
                ids.add(branch_id)
                checked[name].append({"id": branch_id, "label": branch["label"], "coefficient": float(value)})
        return checked

    def ancestors(self, body_id):
        out = []
        while body_id:
            out.append(int(body_id))
            body_id = self.model.body_parentid[body_id]
        return out

    def region(self, body_id):
        names = {self.model.body(i).name for i in self.ancestors(body_id)}
        name = self.model.body(body_id).name
        for side in "rl":
            if ("proximal_row" if side == "r" else "proximal_row_l") in names:
                return "hand_" + side
            if "clavicle_" + side in names:
                return "arm_" + side
            if "talus_" + side in names:
                return "foot_" + side
            if "femur_" + side in names:
                return "leg_" + side
        if "head_neck" in names:
            return "neck"
        if name.startswith("rib"):
            return "ribs"
        return "trunk"

    def muscle_region(self, actuator_id):
        m = self.model
        tendon = int(m.actuator_trnid[actuator_id, 0])
        regions = []
        for k in range(
            m.tendon_adr[tendon], m.tendon_adr[tendon] + m.tendon_num[tendon]
        ):
            if m.wrap_type[k] == mujoco.mjtWrap.mjWRAP_SITE:
                regions.append(self.region(int(m.site_bodyid[m.wrap_objid[k]])))
        for prefix in ("hand", "arm", "foot", "leg", "neck", "ribs"):
            for region in regions:
                if region.startswith(prefix):
                    return region
        return "trunk"

    def bounds(self, name):
        lower, upper = self.effective_ranges[name] * self.factor[name]
        if name == "pelvis_ty":
            lower += self.pelvis_height
            upper += self.pelvis_height
        return float(lower), float(upper)

    def normalize_q(self, q=None):
        if q is None:
            q = {}
        if not isinstance(q, dict):
            raise ScenarioError("姿势 q 必须是关节名称到数值的对象。")
        out = dict(self.defaults)
        for key, value in q.items():
            name = self.aliases.get(key, key)
            if name not in self.index:
                raise ScenarioError(f"未知或从属坐标：{key}")
            value = finite(value, key)
            lo, hi = self.bounds(name)
            if value < lo - 1e-5 or value > hi + 1e-5:
                raise ScenarioError(f"{key} 超出模型范围 [{lo:.3f}, {hi:.3f}]。")
            out[name] = float(np.clip(value, lo, hi))
        return out

    def anatomy_report(self, q, data=None):
        q = self.normalize_q(q)
        if data is None:
            data, _ = self.state(q)
        return self.anatomy.report(q, data)

    def state(self, q, velocity=None, acceleration=None, *, _skip_hand_correction=False):
        q = self.normalize_q(q)
        m = self.model
        data = mujoco.MjData(m)
        projection = np.zeros((m.nv, len(self.names)))
        velocity, acceleration = velocity or {}, acceleration or {}
        for column, name in enumerate(self.names):
            jid = self.joint_ids[name]
            qid, vid = int(m.jnt_qposadr[jid]), int(m.jnt_dofadr[jid])
            data.qpos[qid] = (
                q[name] - (self.pelvis_height if name == "pelvis_ty" else 0)
            ) / self.factor[name]
            data.qvel[vid] = velocity.get(name, 0.0) / self.factor[name]
            data.qacc[vid] = acceleration.get(name, 0.0) / self.factor[name]
            projection[vid, column] = 1.0
        pending = dict(self.coupled)
        while pending:
            ready = [j for j, (source, _) in pending.items() if source not in pending]
            if not ready:
                raise RuntimeError("源坐标耦合存在循环。")
            for joint in ready:
                source, coef = pending.pop(joint)
                p, v = int(m.jnt_qposadr[joint]), int(m.jnt_dofadr[joint])
                sp, sv = int(m.jnt_qposadr[source]), int(m.jnt_dofadr[source])
                x = data.qpos[sp] - m.qpos0[sp]
                first = sum(k * coef[k] * x ** (k - 1) for k in range(1, 5))
                second = sum(k * (k - 1) * coef[k] * x ** (k - 2) for k in range(2, 5))
                data.qpos[p] = m.qpos0[p] + sum(coef[k] * x**k for k in range(5))
                data.qvel[v] = first * data.qvel[sv]
                data.qacc[v] = first * data.qacc[sv] + second * data.qvel[sv] ** 2
                projection[v] = first * projection[sv]
        self.apply_knee_rotations(data, projection)
        prescribed_acc = data.qacc.copy()
        for joint in self.coupled:
            value = data.qpos[m.jnt_qposadr[joint]]
            lo, hi = m.jnt_range[joint]
            tolerance = (
                COUPLED_TRANSLATION_TOLERANCE
                if m.jnt_type[joint] == 2
                else COUPLED_ROTATION_TOLERANCE
            )
            if (
                m.jnt_limited[joint]
                and not lo - tolerance - 1e-7 <= value <= hi + tolerance + 1e-7
            ):
                raise ScenarioError(
                    f"姿势使从属关节 {m.joint(joint).name} 超出源范围。"
                )
        if self.hand_elasticity:
            self.hand_elasticity.assert_installed()
        mujoco.mj_forward(m, data)
        if self.franko_transmission is not None:
            # Also applies to the raw state used to compute the passive hand reference.
            self.franko_transmission.correct_fresh(data)
        if self.shoulder_mechanics:
            data.qfrc_passive[:] += model_mechanics.shoulder_passive_forces(self, data)
        if self.hand_elasticity and not _skip_hand_correction:
            data.qfrc_passive[:] += self.hand_elasticity.passive_forces(
                q, lambda reference: self.state(reference, _skip_hand_correction=True), dense_moments)
        data.qacc[:] = prescribed_acc
        return data, projection

    def apply_knee_rotations(self, data, projection):
        """Map independent axial offsets to physical angles and exact derivatives.

        Call once after scalar couplings, with qpos/qvel/qacc at each axial
        joint still holding the independent offset. No DOF, mass or actuator
        is added to the physical body tree.
        """
        m = self.model
        for joint, relation in self.knee_rotations.items():
            source, coef, sign = relation["source"], relation["coef"], relation["offsetSign"]
            p, v = int(m.jnt_qposadr[joint]), int(m.jnt_dofadr[joint])
            sp, sv = int(m.jnt_qposadr[source]), int(m.jnt_dofadr[source])
            x = data.qpos[sp] - m.qpos0[sp]
            first = sum(k * coef[k] * x ** (k - 1) for k in range(1, 5))
            second = sum(k * (k - 1) * coef[k] * x ** (k - 2) for k in range(2, 5))
            data.qpos[p] = m.qpos0[p] + np.polynomial.polynomial.polyval(x, coef) + sign * data.qpos[p]
            data.qvel[v] = first * data.qvel[sv] + sign * data.qvel[v]
            data.qacc[v] = first * data.qacc[sv] + second * data.qvel[sv] ** 2 + sign * data.qacc[v]
            projection[v] = first * projection[sv] + sign * projection[v]

    def coordinate_axis(self, data, name):
        joint = self.joint_ids[name]
        sign = self.knee_rotations.get(joint, {}).get("offsetSign", 1)
        return sign * (WORLD @ data.xaxis[joint])

    def coordinate_limits(self, q, names):
        return {
            name: knee_rotation_limits(q[f"knee_angle_{name[-1]}"])
            for name in names if name.startswith("knee_rotation_")
        }

    def make_handles(self):
        handles = []
        common = {
            "pelvis": "骨盆",
            "head_neck": "头颈",
            "lumbar5": "腰部",
            "thoracic1": "胸部",
        }
        for side, label in (("r", "右"), ("l", "左")):
            common.update(
                {
                    f"humerus_{side}": label + "肩",
                    f"ulna_{side}": label + "肘",
                    f"radius_{side}": label + "前臂旋转",
                    ("capitate" if side == "r" else "capitate_l"): label + "手腕",
                    f"femur_{side}": label + "髋",
                    f"tibia_{side}": label + "膝",
                    f"talus_{side}": label + "踝",
                    f"calcn_{side}": label + "距下关节",
                    f"toes_{side}": label + "足趾",
                }
            )
        for name, body_id in self.body_ids.items():
            if any(
                token in name for token in ("phant", "patella", "sacrum", "sternum")
            ):
                continue
            chain = self.ancestors(body_id)
            influences = {}
            for raw_id in range(self.model.njnt):
                body = int(self.model.jnt_bodyid[raw_id])
                if body not in chain:
                    continue
                source = raw_id
                while source in self.coupled:
                    source = self.coupled[source][0]
                n = self.model.joint(source).name
                if not n.startswith("pelvis_"):
                    influences[n] = min(chain.index(body), influences.get(n, 999))
            names = sorted(influences, key=influences.get)
            if not names and name != "pelvis":
                continue
            # A handle is a joint anchor, never a bone's inertial centre.
            # Wrist motion is a source compound joint, with the independent
            # coordinates on proximal_row and coupled motion on capitate.
            pivot_body = body_id
            rotation_root = body_id
            local_bodies = [body_id]
            if name.startswith("capitate"):
                pivot_body = int(self.model.body_parentid[body_id])
                rotation_root = pivot_body
                local_bodies = [pivot_body, body_id]
            elif name.startswith("humerus_"):
                # The three shoulder coordinates span massless source bodies.
                # The rotation path separately includes the fixed source
                # scapula/clavicle coupling while locking the thorax.
                local_bodies = chain[: chain.index(self.body_ids["scapula_" + name[-1]])]
                rotation_root = local_bodies[-1]
            own_joints = [
                j for j in range(self.model.njnt)
                if int(self.model.jnt_bodyid[j]) in local_bodies
                and j not in self.coupled and self.model.jnt_type[j] == 3
            ]
            anchor_joints = [
                j for j in range(self.model.njnt)
                if int(self.model.jnt_bodyid[j]) == pivot_body
            ]
            if not anchor_joints:
                # A fixed bone has no independently editable joint. Retain a
                # visible source anchor, but never borrow an ancestor's DOFs.
                ancestor = next(
                    b for b in chain if self.model.body_jntnum[b] > 0
                )
                pivot_body = ancestor
                anchor_joints = list(range(
                    self.model.body_jntadr[ancestor],
                    self.model.body_jntadr[ancestor] + self.model.body_jntnum[ancestor],
                ))
            anchor = next(
                (j for j in anchor_joints if j not in self.coupled
                 and self.model.jnt_type[j] == 3), anchor_joints[0]
            )
            local = self.model.jnt_pos[anchor].copy()
            canonical = (
                "capitate" if name == "proximal_row" else
                "capitate_l" if name == "proximal_row_l" else
                name if own_joints else None
            )
            control_status = (
                "shared-joint-alias" if canonical and canonical != name else
                "independent-joint" if own_joints else
                "coupled-body" if self.model.body_jntnum[body_id] else
                "fixed-bone"
            )
            handles.append(
                {
                    "name": name,
                    "label": common.get(name, body_label(name)),
                    "body": name,
                    "region": self.region(body_id),
                    "side": "left"
                    if self.region(body_id).endswith("_l")
                    else "right"
                    if self.region(body_id).endswith("_r")
                    else "center",
                    "coordinates": names,
                    "parent_chain": [self.model.body(i).name for i in chain],
                    "local": local.tolist(),
                    "pivotJoint": self.model.joint(anchor).name,
                    "pivotBody": self.model.body(pivot_body).name,
                    "pivotSource": "source-joint-anchor",
                    "rotationBody": name,
                    "rotationRoot": self.model.body(rotation_root).name,
                    "localCoordinates": [self.model.joint(j).name for j in own_joints],
                    "rotationSupported": bool(own_joints),
                    "editable": bool(own_joints) and canonical == name,
                    "canonicalHandle": canonical,
                    "controlStatus": control_status,
                    "lockedAncestorBodies": [
                        self.model.body(b).name
                        for b in self.ancestors(int(self.model.body_parentid[rotation_root]))
                    ],
                    "overview": name in common,
                }
            )
        by_name = {handle["name"]: handle for handle in handles}
        for side, label in (("r", "右"), ("l", "左")):
            suffix = "" if side == "r" else "_l"
            related = {
                f"ulna_{side}": [(f"radius_{side}", label + "前臂旋前 / 旋后")],
                f"radius_{side}": [(f"ulna_{side}", label + "肘屈伸")],
                f"capitate{suffix}": [(f"radius_{side}", label + "前臂旋前 / 旋后")],
                f"talus_{side}": [(f"calcn_{side}", label + "距下内翻 / 外翻")],
                f"calcn_{side}": [(f"talus_{side}", label + "踝背屈 / 跖屈")],
                f"firstmc1{suffix}": [(f"firstmc{suffix}", label + "拇指根部外展 / 内收")],
                f"firstmc{suffix}": [(f"firstmc1{suffix}", label + "拇指根部屈伸")],
            }
            for name, targets in related.items():
                by_name[name]["relatedControls"] = [
                    {"name": target, "label": target_label}
                    for target, target_label in targets
                ]
            by_name[f"humerus_{side}"]["controlNote"] = (
                "垂臂时抬举方向与内外旋轴会重合；先选抬举方向，再抬臂。"
            )
        return handles

    def marker(self, data, handle):
        return WORLD @ data.xanchor[self.joint_ids[handle["pivotJoint"]]]

    def joints(self, data):
        out = {
            h["name"]: np.round(self.marker(data, h), 6).tolist() for h in self.handles
        }
        out["head"] = out["head_neck"]
        out["lumbar"] = out["lumbar5"]
        out["torso"] = out["thoracic1"]
        for s in "rl":
            for key, body in (
                ("shoulder", "humerus_" + s),
                ("elbow", "ulna_" + s),
                ("hip", "femur_" + s),
                ("knee", "tibia_" + s),
                ("ankle", "talus_" + s),
                ("toe", "toes_" + s),
                ("heel", "calcn_" + s),
            ):
                out[key + "_" + s] = out.get(
                    body, (WORLD @ data.xpos[self.body_ids[body]]).tolist()
                )
            # Equipment attaches at the palm, independently of the wrist
            # rotation handle. Keep the established source-local grip point.
            palm_body = self.body_ids["capitate" if s == "r" else "capitate_l"]
            out["hand_" + s] = (
                WORLD @ (data.xpos[palm_body]
                         + data.xmat[palm_body].reshape(3, 3) @ np.array([0.0, -0.045, 0.0]))
            ).tolist()
            out["wrist_" + s] = (
                WORLD
                @ data.xpos[
                    self.body_ids["proximal_row" if s == "r" else "proximal_row_l"]
                ]
            ).tolist()
        return out

    def snapshot(self, data, q):
        m = self.model
        points = data.wrap_xpos.reshape(-1, 3)
        muscle_records = []
        moments = dense_moments(m, data)
        for i, name in enumerate(self.muscle_names):
            tendon = int(m.actuator_trnid[i, 0])
            branches = None
            if name in self.tendon_branches:
                branches = model_mechanics.tendon_branch_paths(data, tendon, self.tendon_branches[name], WORLD)
                path = branches[0]["path"]
            else:
                start, count = int(data.ten_wrapadr[tendon]), int(data.ten_wrapnum[tendon])
                path = np.round(points[start : start + count] @ WORLD.T, 6).tolist()
            muscle_records.append(
                {
                    "name": name,
                    "path": path,
                    **({"branches": branches} if branches is not None else {}),
                    "length": float(data.actuator_length[i]),
                    "maxForce": float(m.actuator_gainprm[i, 2]),
                    "region": self.regions[i],
                    "force": None,
                    "activation": None,
                    "coverageStatus": "native-moment"
                    if np.max(np.abs(moments[i])) > 1e-8
                    else "zero-moment-at-pose",
                }
            )
        return {
            "q": q,
            "bodies": [
                {
                    "name": name,
                    "matrix": transform(
                        WORLD @ data.xmat[i].reshape(3, 3), WORLD @ data.xpos[i]
                    ),
                }
                for name, i in self.body_ids.items()
            ],
            "joints": self.joints(data),
            "jointRotations": {
                h["name"]: {
                    "axes": [
                        self.coordinate_axis(data, n).tolist()
                        for n in h["localCoordinates"]
                    ],
                    "coordinates": h["localCoordinates"],
                    "supported": h["rotationSupported"],
                    "limits": self.coordinate_limits(q, h["localCoordinates"]),
                }
                for h in self.handles
            },
            "muscles": muscle_records,
        }

    def export_geometry(self):
        m = self.model
        meshes, bodies = {}, []
        for body_name, bid in self.body_ids.items():
            records = []
            for geom in range(
                m.body_geomadr[bid], m.body_geomadr[bid] + m.body_geomnum[bid]
            ):
                if (
                    m.geom_type[geom] != mujoco.mjtGeom.mjGEOM_MESH
                    or m.geom_group[geom] != 0
                ):
                    continue
                mid = int(m.geom_dataid[geom])
                key = str(mid)
                if key not in meshes:
                    start, count = int(m.mesh_vertadr[mid]), int(m.mesh_vertnum[mid])
                    face_start, face_count = (
                        int(m.mesh_faceadr[mid]),
                        int(m.mesh_facenum[mid]),
                    )
                    meshes[key] = {
                        "positions": m.mesh_vert[start : start + count]
                        .reshape(-1)
                        .tolist(),
                        "indices": m.mesh_face[face_start : face_start + face_count]
                        .reshape(-1)
                        .tolist(),
                    }
                records.append(
                    {
                        "file": key,
                        "matrix": transform(
                            quat_matrix(m.geom_quat[geom]), m.geom_pos[geom]
                        ),
                        "rgba": m.geom_rgba[geom].tolist(),
                    }
                )
            if records:
                bodies.append({"name": body_name, "meshes": records})
        path = HERE / "geometry/fullbody-bones.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "model": MODEL_ID,
                    "coordinateSystem": "body-local native; frame matrices map to X-forward Y-up Z-right",
                    "bodies": bodies,
                    "meshes": meshes,
                },
                separators=(",", ":"),
            ),
            "utf-8",
        )
        return path


@lru_cache(maxsize=1)
def context():
    return ModelContext()


def model_info():
    ctx = context()
    coordinates = []
    for name in ctx.names:
        lo, hi = ctx.bounds(name)
        bid = int(ctx.model.jnt_bodyid[ctx.joint_ids[name]])
        region = ctx.region(bid)
        coordinates.append(
            {
                "name": name,
                "label": name,
                "region": region,
                "min": lo,
                "max": hi,
                "default": ctx.defaults[name],
                "unit": "m" if ctx.factor[name] == 1 else "deg",
                "locked": False,
                "parent_chain": [ctx.model.body(i).name for i in ctx.ancestors(bid)],
            }
        )
    return {
        "id": MODEL_ID,
        "compatiblePoseModels": COMPATIBLE_POSE_MODELS,
        "name": "MS740 · 全身逐肌研究模型",
        "mujoco": mujoco.__version__,
        "sourceSha256": ctx.sha,
        "computationSha256": COMPUTATION_SHA256,
        "massKg": ctx.mass,
        "coordinateSystem": "X-forward Y-up Z-right, metres",
        "coordinates": coordinates,
        "defaults": ctx.defaults,
        "rawCoordinates": ctx.model.njnt,
        "independentCoordinates": len(ctx.names),
        "handReferenceCoordinates": list(ctx.hand_elasticity.names) if ctx.hand_elasticity else [],
        "effectiveTendonTransmission": ctx.manifest.get("effectiveTendonTransmission"),
        "transmissionStatus": ctx.manifest.get("transmissionStatus"),
        "editableCoordinates": len(ctx.names),
        "nativeJointEqualities": len(ctx.coupled),
        "analyticKneeRelations": len(ctx.knee_rotations),
        "muscles": [
            {
                "name": n,
                "region": ctx.regions[i],
                "maxIsometricForce": float(ctx.model.actuator_gainprm[i, 2]),
                **({"branches": [dict(branch) for branch in ctx.tendon_branches[n]]} if n in ctx.tendon_branches else {}),
            }
            for i, n in enumerate(ctx.muscle_names)
        ],
        "bodies": list(ctx.body_ids),
        "handles": ctx.handles,
        "bodyMetadata": ctx.body_metadata,
        "editableJointHandles": len(ctx.handles),
        "geometry": "geometry/fullbody-bones.json",
        "upperBodyActuators": 0,
        "coupledLimitTolerance": {
            "rotationRad": COUPLED_ROTATION_TOLERANCE,
            "translationM": COUPLED_TRANSLATION_TOLERANCE,
            "reason": "源膝关节拟合多项式与从属范围在伸直附近有微小不一致；输入范围已按此容差取交集。",
        },
        "scope": [
            "740 个原生肌肉单元共同进入全身配力，包括头颈、脊柱、胸廓、双臂、双手及双腿。",
            "恢复源文件中的 120 个脊柱/腹部/肋骨关节；双手采用详细附着点，左手关节与肌力参数使用对称假设。",
            "手指伸肌腱膜采用有来源的固定传力比例与独立腱段；各段张力由原肌肉输入推导，串联段不能相加作为肌肉总力。"
            if ctx.tendon_branches else
            "14条源参数失配的骨间肌按几何可达长度重估作用范围，最大肌力与附着路径未改；这是算法推导参数。",
            "双膝内外旋为原屈膝耦合基线上的独立偏移，正值内旋；屈膝0至30度按教学包络逐渐开放，30度以后上限不再增加。",
            "肩部按肱骨与肩胛骨的相对角速度计算 0.6 N·m·s/rad 的工程阻尼，与其余源关节被动作用单列；这不是个体测得的肩部参数。"
            if ctx.shoulder_mechanics else
            "这是改编研究模型；源关节弹簧/阻尼单独报告，配力残差不能当作肌肉张力。",
            "逐帧激活配力，不是前向神经控制或人体逐肌张力验证。",
            *(["手指传动清单中具名的肌腱采用实测屈曲力臂计算有效长度、速度和力矩。"
               "显示的空间路径仍为原模型几何。"] if ctx.franko_transmission is not None else []),
            *(["36 个重标手指肌腱采用 Thelen 默认被动张力曲线，主动容量与最大力量保留；仍为刚腱、零羽状角的混合研究模型。",
               "手指参考被动修正按固定参考姿势单列 N·m，并已计入关节被动合计；不是单根韧带力。力量倍率只缩放肌肉本构，参考修正保持不变。"] if ctx.hand_elasticity else []),
        ],
        "source": ctx.manifest,
        "anatomy": ctx.anatomy.metadata(),
        "rotationModes": {
            "strict-plane": "只改本级坐标并严格保持视角平面；无法实现时拒绝。",
            "source-joint": "选择关节轴后只改该坐标，保留并明确报告该关节的固定耦合。",
        },
    }


def pose(q=None):
    ctx = context()
    q = ctx.normalize_q(q)
    data, _ = ctx.state(q)
    frame = ctx.snapshot(data, q)
    frame["anatomy"] = ctx.anatomy_report(q, data)
    return frame


def ik_coordinates(ctx, handle):
    """Keep a complete anatomical chain without borrowing unrelated joints."""
    region = handle["region"]
    names = handle["coordinates"]
    if region.startswith(("arm_", "hand_")):
        side = region[-1]
        allowed = {"arm_" + side, "hand_" + side}
    elif region.startswith(("leg_", "foot_")):
        side = region[-1]
        allowed = {"leg_" + side, "foot_" + side}
    else:
        # Neck and rib editing stays local. Trunk handles retain the entire
        # spine below them, rather than just three small upper-thoracic joints.
        allowed = {region}
    names = [
        n
        for n in names
        if ctx.region(int(ctx.model.jnt_bodyid[ctx.joint_ids[n]])) in allowed
    ]
    # Finger handles articulate their own finger; moving the wrist/shoulder
    # instead can visually satisfy the target without editing that finger.
    if region.startswith("hand_"):
        wrist_names = {"deviation_" + region[-1], "flexion_" + region[-1]}
        finger_names = [
            n
            for n in names
            if ctx.region(int(ctx.model.jnt_bodyid[ctx.joint_ids[n]])) == region
            and n not in wrist_names
        ]
        if finger_names:
            names = finger_names
    return names


class IKPoint:
    """Position-only native kinematics and exact coupled marker Jacobian.

    Iterations reuse MjData and avoid dynamics, muscle paths and finite
    differences. Variables and Jacobians use native radians/metres.
    """

    def __init__(self, ctx, q, handle, names):
        self.ctx, self.handle, self.names = ctx, handle, names
        self.model = m = ctx.model
        self.data = mujoco.MjData(m)
        self.body = ctx.body_ids[handle.get("pivotBody", handle["body"])]
        self.local = np.asarray(handle["local"])
        self.qids = [int(m.jnt_qposadr[ctx.joint_ids[n]]) for n in names]
        self.vids = [int(m.jnt_dofadr[ctx.joint_ids[n]]) for n in names]
        for name in ctx.names:
            jid = ctx.joint_ids[name]
            self.data.qpos[m.jnt_qposadr[jid]] = (
                q[name] - (ctx.pelvis_height if name == "pelvis_ty" else 0)
            ) / ctx.factor[name]
        self.projection = np.zeros((m.nv, len(names)))
        self.projection[self.vids, np.arange(len(names))] = 1.0
        self.independent_qpos = self.data.qpos.copy()
        self.independent_projection = self.projection.copy()
        self.jacobian = np.zeros((3, m.nv))
        self.coupling_batches = []
        pending = dict(ctx.coupled)
        while pending:
            ready = [j for j, (source, _) in pending.items() if source not in pending]
            if not ready:
                raise RuntimeError("源坐标耦合存在循环。")
            batch = []
            for joint in ready:
                source, coef = pending.pop(joint)
                batch.append(
                    (
                        int(m.jnt_qposadr[joint]),
                        int(m.jnt_dofadr[joint]),
                        int(m.jnt_qposadr[source]),
                        int(m.jnt_dofadr[source]),
                        coef,
                    )
                )
            self.coupling_batches.append(
                (
                    *(
                        np.array([item[i] for item in batch], dtype=int)
                        for i in range(4)
                    ),
                    np.array([item[4] for item in batch]),
                )
            )
        self.polynomial_powers = np.arange(5)
        self.derivative_orders = np.arange(1, 5)
        self.last = None

    def evaluate(self, values):
        if self.last is not None and np.array_equal(values, self.last):
            return self.position, self.derivative
        m, data = self.model, self.data
        # The physical knee axial angle includes a flexion baseline. Restore
        # raw independent offsets before each evaluation to avoid accumulation.
        data.qpos[:] = self.independent_qpos
        self.projection[:] = self.independent_projection
        data.qpos[self.qids] = values
        for p, v, sp, sv, coef in self.coupling_batches:
            x = data.qpos[sp] - m.qpos0[sp]
            powers = x[:, None] ** self.polynomial_powers
            data.qpos[p] = m.qpos0[p] + np.sum(coef * powers, axis=1)
            first = np.sum(coef[:, 1:] * self.derivative_orders * powers[:, :4], axis=1)
            self.projection[v] = first[:, None] * self.projection[sv]
        self.ctx.apply_knee_rotations(data, self.projection)
        # mj_jac requires these two stages, but no full forward dynamics.
        mujoco.mj_kinematics(m, data)
        mujoco.mj_comPos(m, data)
        point = data.xpos[self.body] + data.xmat[self.body].reshape(3, 3) @ self.local
        mujoco.mj_jac(m, data, self.jacobian, None, point, self.body)
        self.position = WORLD @ point
        self.derivative = WORLD @ self.jacobian @ self.projection
        self.last = values.copy()
        return self.position, self.derivative


def guarded_ik_step(ctx, point, q, names, factors, initial, candidate):
    """Stop at the first invalid configuration, not just at a valid endpoint.

    Historical invalid poses may move only while reducing their existing
    violations without introducing another one. Nothing is silently reset.
    """

    def inspect(values):
        point.evaluate(values)
        posture = dict(q)
        posture.update(zip(names, (values * factors).tolist()))
        report = ctx.anatomy.report(posture, point.data)
        return report, {issue["code"]: issue["severity"] for issue in report["issues"]}

    start_report, previous = inspect(initial)
    delta = candidate - initial
    # Bound the sum, not only the largest coordinate: many small spine
    # rotations can otherwise combine into a large distal displacement.
    steps = max(1, math.ceil(float(np.sum(np.abs(delta * factors))) / 3.0))
    accepted, last_fraction = initial.copy(), 0.0
    current_report = start_report
    blocked = False

    def improves_or_valid(severity, baseline):
        if not baseline:
            return not severity
        return all(
            code in baseline and value <= baseline[code] + 1e-8
            for code, value in severity.items()
        )

    for fraction in np.linspace(0, 1, steps + 1)[1:]:
        values = initial + fraction * delta
        report, severity = inspect(values)
        if improves_or_valid(severity, previous):
            accepted, last_fraction, current_report, previous = (
                values,
                fraction,
                report,
                severity,
            )
            continue
        # Refine the first detected boundary. This is a sampled path guard,
        # not exact continuous surface collision detection (CCD).
        low, high = last_fraction, fraction
        for _ in range(9):
            middle = (low + high) / 2
            trial = initial + middle * delta
            trial_report, trial_severity = inspect(trial)
            if improves_or_valid(trial_severity, previous):
                low, accepted, current_report = middle, trial, trial_report
            else:
                high = middle
        blocked = True
        break
    return accepted, {
        "blocked": blocked,
        "recovery": not start_report["valid"],
        "recovered": not start_report["valid"] and current_report["valid"],
        "startIssues": start_report["issues"],
        "pathSamples": steps,
    }


def rotate(payload):
    """Rotate a local joint about a frozen world-space axis, with no ancestor IK.

    q is an immutable drag-start pose; angleDelta is the cumulative right-hand
    angle about axis. Source-joint uses an explicitly selected native joint
    axis and preserves its fixed coupling. Strict-plane uses the camera normal
    and rejects incompatible coupling. Depth measurements are along axis,
    so only a camera-normal request measures view depth.
    """
    if not isinstance(payload, dict):
        raise ScenarioError("旋转请求必须是对象。")
    ctx = context()
    mode = payload.get("mode", "source-joint" if payload.get("allowSourceCoupling") is True else "strict-plane")
    if mode not in ("strict-plane", "source-joint"):
        raise ScenarioError("旋转模式必须为 strict-plane 或 source-joint。")
    q = ctx.normalize_q(payload.get("q", {}))
    angle = finite(payload.get("angleDelta"), "旋转角度")
    if abs(angle) > 180:
        raise ScenarioError("单次拖动累计角度不能超过 180 度，请松开后继续旋转。")
    raw_axis = payload.get("axis")
    if not isinstance(raw_axis, list) or len(raw_axis) != 3:
        raise ScenarioError("旋转轴必须包含三个世界坐标分量。")
    axis = np.array([finite(v, "旋转轴") for v in raw_axis])
    scale = float(np.max(np.abs(axis)))
    if scale < 1e-12:
        raise ScenarioError("旋转轴不能是零向量。")
    axis /= scale
    axis /= np.linalg.norm(axis)
    aliases = {"head": "head_neck", "torso": "thoracic1", "lumbar": "lumbar5",
               "proximal_row": "capitate", "proximal_row_l": "capitate_l"}
    for side in "rl":
        aliases.update({
            f"hand_{side}": "capitate" if side == "r" else "capitate_l",
            f"wrist_{side}": "capitate" if side == "r" else "capitate_l",
            **{f"{key}_{side}": f"{body}_{side}" for key, body in (
                ("shoulder", "humerus"), ("elbow", "ulna"), ("hip", "femur"),
                ("knee", "tibia"), ("ankle", "talus"), ("toe", "toes"),
            )},
        })
    name = payload.get("joint")
    if not isinstance(name, str):
        raise ScenarioError("请选择当前模型中的关节。")
    name = aliases.get(name, name)
    handle = next((h for h in ctx.handles if h["name"] == name), None)
    if handle is None:
        raise ScenarioError("请选择当前模型中的关节。")
    names = handle["localCoordinates"]
    start_data, _ = ctx.state(q)
    pivot = ctx.marker(start_data, handle)
    source_axes = [
        ctx.coordinate_axis(start_data, n).tolist() for n in names
    ]
    info = {
        "accepted": False, "blocked": True, "code": "unsupported", "mode": mode,
        "reason": "", "requestedAngle": angle, "appliedAngle": 0.0,
        "pivot": pivot.tolist(), "coordinates": names, "axis": axis.tolist(),
        "axes": source_axes, "suggestedAxis": source_axes[0] if len(names) == 1 else None,
        "orientationErrorRad": 0.0, "depthErrorM": 0.0, "upstreamError": 0.0,
        "positionToleranceM": 1e-6, "orientationToleranceRad": 1e-6,
    }

    def response(posture, reason="", code="accepted"):
        frame = pose(posture)
        info.update(reason=reason, code=code)
        frame["rotation"] = info
        return frame

    if not names:
        return response(q, "此骨段在源模型中没有独立关节；不能借用上级关节移动它。", "fixed-joint")
    if abs(angle) < 1e-9:
        info.update(accepted=True, blocked=False)
        return response(q)

    factors = np.array([ctx.factor[n] for n in names])
    initial = np.array([q[n] for n in names]) / factors
    lower, upper = (np.array([ctx.bounds(n) for n in names]) / factors[:, None]).T
    point = IKPoint(ctx, q, handle, names)
    body = ctx.body_ids[handle["rotationBody"]]
    root = ctx.body_ids[handle["rotationRoot"]]
    coupled_joints = []
    for dependent in ctx.coupled:
        source = dependent
        while source in ctx.coupled:
            source = ctx.coupled[source][0]
        if ctx.model.joint(source).name in names:
            coupled_joints.append(dependent)
    roots = [root]
    if mode == "source-joint":
        # Shoulder girdle is an explicitly named compound joint in this mode.
        # No independent clavicle/scapula coordinate is invented or unlocked.
        if name.startswith("humerus_"):
            root = ctx.body_ids["clavicle_" + name[-1]]
            roots = [root]
        roots.extend(int(ctx.model.jnt_bodyid[j]) for j in coupled_joints)
    descendants = [
        b for b in ctx.body_ids.values()
        if any(r in ctx.ancestors(b) for r in roots)
    ]
    locked = [b for b in ctx.body_ids.values() if b not in descendants]
    original_rot = WORLD @ start_data.xmat[body].reshape(3, 3)
    desired_delta = Rotation.from_rotvec(axis * math.radians(angle)).as_matrix()
    desired_rot = desired_delta @ original_rot

    def residual(values):
        point.evaluate(values)
        actual = WORLD @ point.data.xmat[body].reshape(3, 3)
        return (actual - desired_rot).reshape(-1)

    if mode == "source-joint":
        alignments = np.asarray(source_axes) @ axis
        requested_coordinate = payload.get("coordinate")
        if requested_coordinate is not None and requested_coordinate not in names:
            raise ScenarioError("所选转轴不属于当前关节。")
        # Prefer the final coordinate when source axes coincide, e.g. axial
        # shoulder rotation at zero elevation. UI can name the axis explicitly.
        selected = names.index(requested_coordinate) if requested_coordinate else (
            len(names) - 1 - int(np.argmax(np.abs(alignments[::-1])))
        )
        if abs(alignments[selected]) < 1 - 1e-6:
            info["suggestedAxis"] = source_axes[selected]
            return response(q, "请先对准所选关节转轴；源关节模式只修改这一轴，不会自动组合其他轴追随鼠标。", "axis-mismatch")
        candidate = initial.copy()
        candidate[selected] += math.radians(angle) * np.sign(alignments[selected])
        info["selectedCoordinate"] = names[selected]
        if np.any(candidate < lower - 1e-10) or np.any(candidate > upper + 1e-10):
            return response(q, "旋转角度超出所选源关节范围，请减小角度。", "source-range")
        candidate = np.clip(candidate, lower, upper)
    else:
        result = least_squares(
            residual, np.clip(initial, lower + 1e-10, upper - 1e-10),
            bounds=(lower, upper), max_nfev=45,
            ftol=1e-10, xtol=1e-10, gtol=1e-12,
        )
        candidate = result.x
    point.evaluate(candidate)
    actual_rot = WORLD @ point.data.xmat[body].reshape(3, 3)
    info["orientationErrorRad"] = float(
        Rotation.from_matrix(actual_rot @ desired_rot.T).magnitude()
    )
    if mode == "strict-plane" and info["orientationErrorRad"] > 1e-6:
        return response(
            q, "当前视角的旋转轴不在此关节的可达轴与范围内，请对准关节轴或换个视角；不会带动上级或向前后偏移。",
            "axis-or-limit",
        )
    upstream_error = max(
        float(np.max(np.abs(point.data.xpos[locked] - start_data.xpos[locked]))),
        float(np.max(np.abs(point.data.xmat[locked] - start_data.xmat[locked]))),
    ) if locked else 0.0
    info["upstreamError"] = upstream_error
    if upstream_error > 1e-9:
        return response(
            q, "源模型的此项耦合会带动上级或其他骨段；本级编辑已阻止这次旋转。",
            "upstream-coupling",
        )
    # Check the complete downstream rigid transform, not just one projected
    # point. This also catches coupled knee translations and wrist offsets.
    rigid_bodies = [b for b in descendants if "phant" not in ctx.model.body(b).name]
    starts = start_data.xpos[rigid_bodies] @ WORLD.T
    actual_positions = point.data.xpos[rigid_bodies] @ WORLD.T
    expected_positions = (starts - pivot) @ desired_delta.T + pivot
    start_rotations = WORLD @ start_data.xmat[rigid_bodies].reshape(-1, 3, 3)
    actual_rotations = WORLD @ point.data.xmat[rigid_bodies].reshape(-1, 3, 3)
    expected_rotations = desired_delta @ start_rotations
    position_error = float(np.max(np.linalg.norm(actual_positions - expected_positions, axis=1)))
    rotation_error = float(np.max(np.abs(actual_rotations - expected_rotations)))
    # Orientation agreement plus unchanged origin depths fixes the depth of
    # every point of every downstream rigid bone, not only its anchor.
    info["depthErrorM"] = float(np.max(np.abs((actual_positions - starts) @ axis)))
    native_axis = WORLD.T @ axis
    for bid in rigid_bodies:
        vertices = ctx.bone_vertices.get(bid)
        if vertices is None:
            continue
        rotation_change = (point.data.xmat[bid] - start_data.xmat[bid]).reshape(3, 3)
        offset = float((point.data.xpos[bid] - start_data.xpos[bid]) @ native_axis)
        depth = vertices @ (rotation_change.T @ native_axis) + offset
        info["depthErrorM"] = max(info["depthErrorM"], float(np.max(np.abs(depth))))
    info["rigidPositionErrorM"] = position_error
    info["coupling"] = {
        "enabled": mode == "source-joint",
        "coordinates": [ctx.model.joint(j).name for j in coupled_joints],
        "affectedBodies": sorted({ctx.model.body(int(ctx.model.jnt_bodyid[j])).name for j in coupled_joints}),
        "maxDepthM": info["depthErrorM"],
        "pivotShiftM": float(np.linalg.norm(ctx.marker(point.data, handle) - pivot)),
        "description": (
            "屈伸保留源模型联动；内外旋是该基线上的独立偏移，受屈膝角度包络限制。"
            if name.startswith("tibia_") else
            "仅保留源模型规定的同关节联动，没有增加独立自由度。" if coupled_joints else "此关节没有源模型强制耦合。"
        ),
        "independentKneeOffset": (
            {"coordinate": f"knee_rotation_{name[-1]}", "reference": "offset-from-source-flexion-coupling"}
            if name.startswith("tibia_") else None
        ),
        "scope": (
            "肩复合关节：锁骨、肩胛、肱骨及下游；胸廓、颈与其他肢体固定。"
            if name.startswith("humerus_") and mode == "source-joint" else
            "手腕：腕骨及手部；桡骨、尺骨、肱骨固定。"
            if name.startswith(("capitate", "proximal_row")) else
            "膝关节：胫骨及下游、源耦合髌骨；股骨固定。"
            if name.startswith("tibia_") else
            "仅所选关节及下游，其他独立坐标固定。"
        ),
    }
    if mode == "strict-plane" and (position_error > 1e-6 or rotation_error > 1e-6 or info["depthErrorM"] > 1e-6):
        return response(
            q, "源关节的耦合运动包含平移或其他转轴，无法严格保持当前视角平面；本次旋转未应用。",
            "coupled-out-of-plane",
        )
    accepted, guard = guarded_ik_step(ctx, point, q, names, factors, initial, candidate)
    info["guard"] = guard
    if guard["blocked"]:
        trial_q = dict(q)
        trial_q.update(zip(names, (candidate * factors).tolist()))
        for side, label in (("r", "右"), ("l", "左")):
            if not any(n in names for n in (f"knee_angle_{side}", f"knee_rotation_{side}")):
                continue
            limits = knee_rotation_limits(trial_q[f"knee_angle_{side}"])
            if not limits["min"] - 1e-6 <= trial_q[f"knee_rotation_{side}"] <= limits["max"] + 1e-6:
                return response(
                    q, f"{label}膝屈曲 {limits['flexion']:.1f}° 时，内外旋偏移应在 {limits['min']:.1f}° 至 {limits['max']:.1f}°；请先减小旋转或增加屈膝。",
                    "knee-axial-envelope",
                )
        return response(
            q, "旋转路径已触及关节联合范围或防穿插边界，请减小角度。",
            "anatomy-boundary",
        )
    out = dict(q)
    if mode == "source-joint":
        # Preserve every unselected value exactly, including a nonzero flexion
        # angle while editing its axial offset (avoid degrees/radians roundoff).
        out[names[selected]] = float(accepted[selected] * factors[selected])
    else:
        out.update(zip(names, (accepted * factors).tolist()))
    info.update(accepted=True, blocked=False, appliedAngle=angle)
    return response(out)


def ik(payload):
    if not isinstance(payload, dict):
        raise ScenarioError("拖动请求必须是对象。")
    ctx = context()
    q = ctx.normalize_q(payload.get("q"))
    target = payload.get("target")
    if not isinstance(target, list) or len(target) != 3:
        raise ScenarioError("拖动目标必须是三个世界坐标。")
    target = np.array([finite(v, "拖动目标") for v in target])
    if np.max(np.abs(target)) > 10:
        raise ScenarioError("拖动目标超出场景范围。")
    normal = payload.get("planeNormal")
    projector = np.eye(3)
    if normal is not None:
        if not isinstance(normal, list) or len(normal) != 3:
            raise ScenarioError("拖动视线必须是三个世界坐标分量。")
        normal = np.array([finite(v, "拖动视线") for v in normal])
        scale = float(np.max(np.abs(normal)))
        if scale < 1e-12:
            raise ScenarioError("拖动视线不能是零向量。")
        # Scale first to keep normalization finite even for large inputs.
        normal /= scale
        normal /= np.linalg.norm(normal)
        projector -= np.outer(normal, normal)
    name = payload.get("joint")
    aliases = {"head": "head_neck", "torso": "thoracic1", "lumbar": "lumbar5",
               "proximal_row": "capitate", "proximal_row_l": "capitate_l"}
    for s in "rl":
        aliases.update(
            {
                f"hand_{s}": "capitate" if s == "r" else "capitate_l",
                f"elbow_{s}": f"ulna_{s}",
                f"knee_{s}": f"tibia_{s}",
                f"ankle_{s}": f"talus_{s}",
                f"toe_{s}": f"toes_{s}",
            }
        )
    name = aliases.get(name, name)
    handle = next((h for h in ctx.handles if h["name"] == name), None)
    if handle is None:
        raise ScenarioError("请选择当前模型中可拖动的骨节。")
    if name == "pelvis":
        q["pelvis_ty"] = float(np.clip(target[1], *ctx.bounds("pelvis_ty")))
        for n, axis in (("pelvis_tx", 0), ("pelvis_tz", 2)):
            q[n] = float(np.clip(target[axis], *ctx.bounds(n)))
        return pose(q)
    # A screen drag specifies a target ray, not a rigid depth. Let depth change
    # along planeNormal; without it retain the precise 3-D target API.
    names = ik_coordinates(ctx, handle)
    if not names:
        raise ScenarioError("此控制点没有可独立调整的局部关节。")
    factors = np.array([ctx.factor[n] for n in names])
    initial = np.array([q[n] for n in names]) / factors
    lower, upper = (np.array([ctx.bounds(n) for n in names]) / factors[:, None]).T
    point = IKPoint(ctx, q, handle, names)
    # A single point cannot determine limb twist. Keep unobserved wrist,
    # forearm and shoulder rotations close to the current pose rather than
    # accepting a distant Euler branch merely for a micrometre error gain.
    regularization = np.array(
        [
            0.006
            if n.startswith(
                ("elv_angle_", "shoulder_rot_", "pro_sup_", "deviation_", "flexion_")
            )
            else 0.002
            for n in names
        ]
    )

    def residual(values):
        position, _ = point.evaluate(values)
        return np.r_[
            projector @ (position - target), (values - initial) * regularization
        ]

    def jacobian(values):
        _, derivative = point.evaluate(values)
        return np.vstack([projector @ derivative, np.diag(regularization)])

    starts = [initial]
    bent = initial.copy()
    for i, n in enumerate(names):
        if any(token in n for token in ("elbow", "knee", "shoulder_elv", "flexion")):
            bent[i] = max(bent[i], math.radians(15.0))
    starts.append(bent)
    for direction in (60.0, -60.0):
        seed = bent.copy()
        for i, n in enumerate(names):
            if n.startswith("elv_angle_"):
                seed[i] = math.radians(direction)
        if any(n.startswith("elv_angle_") for n in names):
            starts.append(seed)
    # An orthographic side view cannot distinguish a knee lifting outward
    # from the leg passing through its opposite. Seed the outward branch too.
    if any(n.startswith("hip_adduction_") for n in names):
        outward = bent.copy()
        for i, n in enumerate(names):
            if n.startswith("hip_adduction_"):
                outward[i] = math.radians(-20.0)
            if n.startswith("knee_angle_"):
                outward[i] = max(outward[i], math.radians(25.0))
        starts.append(outward)
    results = []
    attempted = []
    for start in starts:
        start = np.clip(start, lower + 1e-7, upper - 1e-7)
        if any(np.array_equal(start, previous) for previous in attempted):
            continue
        attempted.append(start)
        result = least_squares(
            residual,
            start,
            jac=jacobian,
            bounds=(lower, upper),
            max_nfev=60,
            ftol=1e-8,
            xtol=1e-8,
            gtol=1e-10,
        )
        accepted, guard = guarded_ik_step(
            ctx, point, q, names, factors, initial, result.x
        )
        results.append((result, accepted, guard))
        if np.linalg.norm(result.fun[:3]) < 5e-4 and not guard["blocked"]:
            break
    # Compare the complete objective, including continuity, across seeds.
    _, accepted, guard = min(
        results, key=lambda item: np.linalg.norm(residual(item[1]))
    )
    q.update(dict(zip(names, (accepted * factors).tolist())))
    frame = pose(q)
    position, _ = point.evaluate(accepted)
    error = float(np.linalg.norm(projector @ (position - target)))
    frame["ik"] = {
        "target": target.tolist(),
        "errorM": error,
        "clamped": error > 0.025 or guard["blocked"],
        "coordinates": names,
        "evaluations": sum(r.nfev for r, _, _ in results),
        "mode": "screen" if normal is not None else "world",
        "constraints": guard,
    }
    if normal is not None:
        frame["ik"]["planeNormal"] = normal.tolist()
    return frame


if __name__ == "__main__":
    ctx = context()
    path = ctx.export_geometry()
    (HERE / "fullbody-model-data.json").write_text(
        json.dumps(model_info(), ensure_ascii=False, indent=2), "utf-8"
    )
    print(
        json.dumps(
            {
                "geometry": str(path),
                "coordinates": len(ctx.names),
                "muscles": ctx.model.nu,
            }
        )
    )
