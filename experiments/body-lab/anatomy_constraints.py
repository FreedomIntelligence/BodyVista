"""Explainable teaching constraints, separate from the research model physics.

Source joint intervals and polynomial couplings are not population-normal ROM.
The additional corner envelopes and skeletal collision cores are conservative
engineering guards, not a clinically validated whole-body feasible-pose atlas.
"""

import re

import mujoco
import numpy as np

POLICY_ID = "source-ranges-knee-axial-teaching-guards-v2"
PENETRATION_TOLERANCE_M = 0.002
SOURCES = [
    {
        "id": "knee-rotation-zarins-1983",
        "url": "https://pubmed.ncbi.nlm.nih.gov/6869656/",
        "use": "正常膝旋转范围与屈膝角度的实验依据；本教学包络不是该研究的逐点拟合。",
    },
    {
        "id": "knee-rotation-almquist-2013",
        "url": "https://pubmed.ncbi.nlm.nih.gov/22778072/",
        "use": "30、60、90度屈膝的被动旋转范围没有显著差异；不假设该区间持续增大。",
    },
    {
        "id": "knee-rotation-muaidi-2009",
        "url": "https://doi.org/10.1111/j.1600-0838.2008.00783.x",
        "use": "主动膝旋转测量的参考；包络上限与平滑开锁函数属于保守工程选择。",
    },
    {
        "id": "source-model",
        "url": "https://github.com/google-deepmind/mujoco_menagerie/tree/98a70c569c4c1b6da467a20012f766ee1f8dc521/ms_human_700",
        "use": "源坐标定义、单轴范围、肩膝多项式耦合及骨骼几何。",
    },
    {
        "id": "joint-limit-dependence",
        "url": "https://www.cv-foundation.org/openaccess/content_cvpr_2015/papers/Akhter_Pose-Conditioned_Joint_Angle_2015_CVPR_paper.pdf",
        "use": "姿势相关限位与单视图多解的依据；未引入论文动作数据或假称复现其限位模型。",
    },
    {
        "id": "shoulder-coupling",
        "url": "https://www.epfl.ch/labs/cvlab/research/completed/research-completed-body-limits-index-php/",
        "use": "肩肘联合限位、胸廓/头部碰撞、欧拉角多解及分层约束方法的依据。",
    },
    {
        "id": "coordinate-convention",
        "url": "https://media.isbweb.org/images/documents/standards/isb_jcs_part_ii.pdf",
        "use": "关节坐标与临床动作角不能不经映射直接替换。",
    },
]


def knee_rotation_limits(flexion):
    """Independent offset envelope, not the source's coupled baseline angle.

    Smoothstep is a declared engineering interpolation, not a fitted ROM curve.
    Positive offset denotes internal rotation on either side.
    """
    amount = float(np.clip(float(flexion) / 30.0, 0.0, 1.0))
    opening = amount * amount * (3.0 - 2.0 * amount)
    return {
        "min": -35.0 * opening,
        "max": 25.0 * opening,
        "flexion": float(flexion),
        "source": "engineering-envelope",
        "reference": "offset-from-source-flexion-coupling",
    }


def segment_distance(a, b, c, d):
    """Closest distance of two closed segments, including degenerate ones."""
    u, v, w = b - a, d - c, a - c
    aa, bb, cc = float(u @ u), float(u @ v), float(v @ v)
    dd, ee = float(u @ w), float(v @ w)
    if aa < 1e-14:
        t = np.clip(ee / cc, 0, 1) if cc > 1e-14 else 0
        return float(np.linalg.norm(a - (c + t * v)))
    if cc < 1e-14:
        return float(np.linalg.norm(a + np.clip(-dd / aa, 0, 1) * u - c))
    denominator = aa * cc - bb * bb
    s = np.clip((bb * ee - cc * dd) / denominator, 0, 1) if denominator > 1e-14 else 0.0
    t = (bb * s + ee) / cc
    if t < 0:
        t, s = 0.0, np.clip(-dd / aa, 0, 1)
    elif t > 1:
        t, s = 1.0, np.clip((bb - dd) / aa, 0, 1)
    return float(np.linalg.norm(w + s * u - t * v))


def segment_distances(a, b, c, d):
    """Vectorized form of segment_distance, with identical degeneracy rules."""
    u, v, w = b - a, d - c, a - c
    aa, bb, cc, dd, ee = (
        np.einsum("ij,ij->i", x, y) for x, y in ((u, u), (u, v), (v, v), (u, w), (v, w))
    )
    denominator = aa * cc - bb * bb
    s = np.clip(
        np.divide(
            bb * ee - cc * dd,
            denominator,
            out=np.zeros_like(aa),
            where=denominator > 1e-14,
        ),
        0,
        1,
    )
    t = np.divide(bb * s + ee, cc, out=np.zeros_like(cc), where=cc >= 1e-14)
    below, above = t < 0, t > 1
    s[below] = np.clip(
        np.divide(-dd, aa, out=np.zeros_like(aa), where=aa >= 1e-14)[below], 0, 1
    )
    s[above] = np.clip(
        np.divide(bb - dd, aa, out=np.zeros_like(aa), where=aa >= 1e-14)[above], 0, 1
    )
    t = np.clip(t, 0, 1)
    first_point, second_point = aa < 1e-14, cc < 1e-14
    s[first_point] = 0
    t[first_point] = np.clip(
        np.divide(ee, cc, out=np.zeros_like(cc), where=cc > 1e-14)[first_point], 0, 1
    )
    s[second_point & ~first_point] = np.clip(
        (-dd / np.maximum(aa, 1e-14))[second_point & ~first_point], 0, 1
    )
    t[second_point] = 0
    return np.linalg.norm(w + s[:, None] * u - t[:, None] * v, axis=1)


class AnatomyConstraints:
    def __init__(self, ctx):
        self.ctx, self.model = ctx, ctx.model
        self.groups = self.make_groups()
        baseline, _ = ctx.state(ctx.defaults)
        self.cores = []
        self.add_core(
            baseline,
            "chest-upper",
            "胸廓上部",
            "thoracic4",
            [f"rib{i}_{s}" for i in range(1, 7) for s in "RL"],
        )
        self.add_core(
            baseline,
            "chest-lower",
            "胸廓下部",
            "thoracic9",
            [f"rib{i}_{s}" for i in range(7, 13) for s in "RL"],
        )
        self.add_core(baseline, "pelvis", "骨盆", "pelvis", ["pelvis"])
        self.add_core(baseline, "head", "头部", "head_neck", ["head_neck"])
        # The source has no abdominal surface. This interpolated central core
        # is explicitly an engineering proxy, not reconstructed soft tissue.
        lower, pelvis = self.cores[1], self.cores[2]
        anchor = ctx.body_ids["lumbar3"]
        rotation = baseline.xmat[anchor].reshape(3, 3)
        centers = [
            baseline.xpos[c["body"]]
            + baseline.xmat[c["body"]].reshape(3, 3) @ c["center"]
            for c in (lower, pelvis)
        ]
        middle = (centers[0] + centers[1]) / 2
        self.cores.append(
            {
                "code": "abdomen",
                "label": "腹部中央",
                "body": anchor,
                "center": rotation.T @ (middle - baseline.xpos[anchor]),
                "radii": np.array([0.075, 0.105, 0.095]),
                "basis": "interpolated-teaching-core",
            }
        )
        self.segments = []
        for side in "rl":
            suffix = "" if side == "r" else "_l"
            label = "右" if side == "r" else "左"
            # Core radii are skeletal proxies, not skin or muscle thickness.
            definitions = [
                ("upperarm", "上臂", f"humerus_{side}", f"ulna_{side}", 0.018, 0.16),
                (
                    "forearm",
                    "前臂",
                    f"ulna_{side}",
                    "proximal_row" + suffix,
                    0.016,
                    0.04,
                ),
                ("palm", "手掌", "capitate" + suffix, "3proxph" + suffix, 0.018, 0.0),
                ("thigh", "大腿", f"femur_{side}", f"tibia_{side}", 0.055, 0.15),
                ("shin", "小腿", f"tibia_{side}", f"talus_{side}", 0.035, 0.04),
                ("foot", "足", f"calcn_{side}", f"toes_{side}", 0.022, 0.0),
            ]
            for kind, term, first, second, radius, trim in definitions:
                self.segments.append(
                    {
                        "code": kind + "_" + side,
                        "label": label + term,
                        "kind": kind,
                        "side": side,
                        "first": ctx.body_ids[first],
                        "second": ctx.body_ids[second],
                        "radius": radius,
                        "trim": trim,
                    }
                )
        self.pairs = []
        for i, a in enumerate(self.segments):
            for j, b in enumerate(self.segments[:i]):
                # Connected segments share an anatomical joint. Their overlap
                # is expected and is controlled by source joint/coupling limits.
                same_limb = a["side"] == b["side"] and (
                    {a["kind"], b["kind"]} <= {"upperarm", "forearm", "palm"}
                    or {a["kind"], b["kind"]} <= {"thigh", "shin", "foot"}
                )
                if not same_limb:
                    self.pairs.append((j, i))
        self.prepare_batch_checks()

    def prepare_batch_checks(self):
        """Compile immutable model indices/ranges once, not at each path sample."""
        self.group_names = [name for group in self.groups for name in group["names"]]
        self.group_offsets = np.cumsum(
            [0] + [len(g["names"]) for g in self.groups[:-1]]
        )
        self.group_defaults = np.array([self.ctx.defaults[n] for n in self.group_names])
        bounds = np.array([self.ctx.bounds(n) for n in self.group_names])
        self.group_negative = np.maximum(self.group_defaults - bounds[:, 0], 1e-12)
        self.group_positive = np.maximum(bounds[:, 1] - self.group_defaults, 1e-12)
        self.group_budgets = np.array([g["budget"] for g in self.groups])
        self.core_bodies = np.array([core["body"] for core in self.cores])
        self.core_centers = np.array([core["center"] for core in self.cores])
        self.segment_first = np.array([s["first"] for s in self.segments])
        self.segment_second = np.array([s["second"] for s in self.segments])
        self.segment_trim = np.array([s["trim"] for s in self.segments])[:, None]
        radii = np.array([s["radius"] for s in self.segments])
        self.inflated_radii = (
            np.array([c["radii"] for c in self.cores])[None, :, :]
            + radii[:, None, None]
        )
        self.minimum_radii = self.inflated_radii.min(axis=2)
        self.core_pair_mask = np.array(
            [
                [
                    not (s["kind"] == "thigh" and c["code"] == "pelvis")
                    for c in self.cores
                ]
                for s in self.segments
            ]
        )
        self.pair_first, self.pair_second = np.array(self.pairs).T
        self.pair_radii = radii[self.pair_first] + radii[self.pair_second]
        self.coverage_data = {
            "independentCoordinates": len(self.ctx.names),
            "internalCoordinates": sum(
                not n.startswith("pelvis_") for n in self.ctx.names
            ),
            "sourceCouplings": len(self.ctx.coupled),
            "combinedTeachingEnvelopes": len(self.groups),
            "collisionSegments": len(self.segments),
            "collisionCores": len(self.cores),
            "completeAnatomicalFeasibility": False,
            "completeSurfaceCollision": False,
        }

    def make_groups(self):
        groups = {}
        for name in self.ctx.names:
            if name.startswith("pelvis_"):
                continue  # Root placement is not a joint's anatomical ROM.
            match = re.fullmatch(
                r"((?:[LT]\d+_[LTS]\d+|T1_head_neck|Abs|T\d+_r\d+[RL]))_(?:FE|LB|AR|X|Y|Z)",
                name,
            )
            if match:
                key = match[1]
            elif name.startswith(("hip_flexion_", "hip_adduction_", "hip_rotation_")):
                key = "hip_" + name[-1]
            elif name.startswith(("deviation_", "flexion_")):
                key = "wrist_" + name[-1]
            elif re.fullmatch(r"(?:[2-5]mcp|cmc)_(?:flexion|abduction)(?:_l)?", name):
                key = name.split("_")[0] + ("_l" if name.endswith("_l") else "_r")
            else:
                continue
            groups.setdefault(key, []).append(name)
        # Do not impose an ellipsoid on the shoulder's elevation-plane Euler
        # coordinates. They become singular near the arm-down configuration.
        return [
            {"code": key, "names": names, "budget": 1.5 if len(names) == 2 else 1.8}
            for key, names in groups.items()
            if len(names) > 1
        ]

    def bone_points(self, data, bodies):
        m = self.model
        out = []
        ids = {self.ctx.body_ids[n] for n in bodies if n in self.ctx.body_ids}
        for geom in range(m.ngeom):
            if (
                m.geom_bodyid[geom] not in ids
                or m.geom_group[geom] != 0
                or m.geom_type[geom] != mujoco.mjtGeom.mjGEOM_MESH
            ):
                continue
            mesh = int(m.geom_dataid[geom])
            start, count = int(m.mesh_vertadr[mesh]), int(m.mesh_vertnum[mesh])
            points = m.mesh_vert[start : start + count]
            out.append(
                points @ data.geom_xmat[geom].reshape(3, 3).T + data.geom_xpos[geom]
            )
        if not out:
            raise RuntimeError("解剖约束缺少源骨骼几何：" + ", ".join(bodies))
        return np.vstack(out)

    def add_core(self, data, code, label, anchor, bones):
        body = self.ctx.body_ids[anchor]
        local = (self.bone_points(data, bones) - data.xpos[body]) @ data.xmat[
            body
        ].reshape(3, 3)
        low, high = local.min(axis=0), local.max(axis=0)
        self.cores.append(
            {
                "code": code,
                "label": label,
                "body": body,
                "center": (low + high) / 2,
                "radii": (high - low) / 2 * 0.82,
                "basis": "source-bone-bounds-inset-ellipsoid",
            }
        )

    def report(self, q, data):
        issues = []
        for side, label in (("r", "右"), ("l", "左")):
            coordinate = f"knee_rotation_{side}"
            if coordinate not in q:
                continue
            flexion_name = f"knee_angle_{side}"
            limits = knee_rotation_limits(q[flexion_name])
            excess = max(limits["min"] - q[coordinate], q[coordinate] - limits["max"], 0.0)
            if excess > 1e-6:
                issues.append({
                    "kind": "knee-axial-envelope",
                    "code": "knee-axial:" + side,
                    "label": f"{label}膝屈曲 {q[flexion_name]:.1f}° 时，内外旋偏移应在 {limits['min']:.1f}° 至 {limits['max']:.1f}°；请减小旋转或增加屈膝",
                    "coordinates": [flexion_name, coordinate],
                    "severity": float(excess),
                    "limits": limits,
                    "basis": "declared-teaching-engineering-envelope",
                })
        delta = (
            np.fromiter((q[n] for n in self.group_names), dtype=float)
            - self.group_defaults
        )
        extent = np.where(delta >= 0, self.group_positive, self.group_negative)
        used = np.add.reduceat((np.abs(delta) / extent) ** 4, self.group_offsets)
        for index in np.flatnonzero(used > self.group_budgets + 1e-6):
            group = self.groups[index]
            issues.append(
                {
                    "kind": "joint-combination",
                    "code": "envelope:" + group["code"],
                    "label": "关节组合达到教学极端保护边界",
                    "coordinates": group["names"],
                    "severity": float(used[index] / group["budget"] - 1),
                    "basis": "conservative-teaching-envelope",
                }
            )
        starts = data.xpos[self.segment_first]
        ends = data.xpos[self.segment_second]
        starts = starts + self.segment_trim * (ends - starts)
        rotations = data.xmat[self.core_bodies].reshape(-1, 3, 3)
        centers = data.xpos[self.core_bodies] + np.einsum(
            "cij,cj->ci", rotations, self.core_centers
        )
        first = (
            np.einsum(
                "sci,cij->scj", starts[:, None, :] - centers[None, :, :], rotations
            )
            / self.inflated_radii
        )
        last = (
            np.einsum("sci,cij->scj", ends[:, None, :] - centers[None, :, :], rotations)
            / self.inflated_radii
        )
        vector = last - first
        t = np.clip(
            -np.einsum("sci,sci->sc", first, vector)
            / np.maximum(np.einsum("sci,sci->sc", vector, vector), 1e-15),
            0,
            1,
        )
        depths = (
            1 - np.linalg.norm(first + t[:, :, None] * vector, axis=2)
        ) * self.minimum_radii
        for i, j in np.argwhere(
            (depths > PENETRATION_TOLERANCE_M) & self.core_pair_mask
        ):
            segment, core = self.segments[i], self.cores[j]
            depth = float(depths[i, j])
            issues.append(
                {
                    "kind": "self-collision",
                    "code": segment["code"] + ":" + core["code"],
                    "label": segment["label"] + "进入" + core["label"] + "保护体",
                    "penetrationM": depth,
                    "severity": depth,
                    "basis": "skeletal-core-proxy",
                }
            )
        distances = segment_distances(
            starts[self.pair_first],
            ends[self.pair_first],
            starts[self.pair_second],
            ends[self.pair_second],
        )
        depths = self.pair_radii - distances
        for index in np.flatnonzero(depths > PENETRATION_TOLERANCE_M):
            i, j = self.pairs[index]
            left, right = self.segments[i], self.segments[j]
            depth = float(depths[index])
            issues.append(
                {
                    "kind": "self-collision",
                    "code": left["code"] + ":" + right["code"],
                    "label": left["label"] + "与" + right["label"] + "保护体重叠",
                    "penetrationM": depth,
                    "severity": depth,
                    "basis": "skeletal-core-proxy",
                }
            )
        for issue in issues:
            issue["message"] = issue["label"]
        return {
            "valid": not issues,
            "issues": issues,
            "violations": issues,
            "policyId": POLICY_ID,
            "coverage": self.coverage(),
        }

    def coverage(self):
        return dict(self.coverage_data)

    def metadata(self):
        return {
            "policyId": POLICY_ID,
            "coverage": self.coverage(),
            "sources": SOURCES,
            "kneeAxialEnvelope": {
                "formula": "u=clip(flexionDeg/30,0,1); opening=u*u*(3-2*u); offsetDeg in [-35*opening,25*opening]",
                "positiveDirection": "internal",
                "reference": "offset-from-source-flexion-coupling",
                "status": "教学工程包络，未按个体或人群拟合；0至30度平滑开放，30度以后不再放宽；不提供隐含止挡力。",
            },
            "coordinates": [
                {
                    "name": n,
                    "range": list(self.ctx.bounds(n)),
                    "kind": "scene-root"
                    if n.startswith("pelvis_")
                    else "derived-knee-offset"
                    if n.startswith("knee_rotation_")
                    else "source-model-range",
                    "unit": "m" if self.ctx.factor[n] == 1 else "deg",
                    "source": "teaching-knee-axial-envelope" if n.startswith("knee_rotation_") else "source-model",
                }
                for n in self.ctx.names
            ],
            "teachingEnvelope": {
                "formula": "sum(normalized_axis_displacement**4) <= budget",
                "twoAxisBudget": 1.5,
                "threeAxisBudget": 1.8,
                "status": "工程保护阈值，未按人体多轴可达域标定；不等于临床正常范围。",
            },
            "collision": {
                "scope": "胸廓、腹部中央、骨盆和头部核心与主要四肢段；非相邻主要肢段之间。",
                "status": "骨骼尺寸与具名工程代理；不覆盖皮肤、肌腹、逐指表面或全部相邻关节接触。",
                "toleranceM": PENETRATION_TOLERANCE_M,
            },
        }
