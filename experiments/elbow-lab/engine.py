"""Fast, version-bound reduction of the OpenSim Arm26 locked-shoulder model.

SI units. Positive elbow torque flexes; 0 rad is down. The payload is an
ideal point mass at a fixed radial distance in the teaching flexion plane.
"""
import hashlib
import json
import math
from pathlib import Path

MODEL_DIR = Path(__file__).resolve().parent / "model"
SRC_SHA = "e2224d0044eb393b05d64926c3fa1682c451a9adc7f510e5517ef9958d3d41b9"
TABLE_SHA = "37fa48bde8ceadbe378989e1b330179ef8e9cf4fd49e51300800e34cc857f868"
MUSCLES = ["BIClong", "BICshort", "BRA", "TRIlong", "TRIlat", "TRImed"]
NAMES = ["肱二头肌长头", "肱二头肌短头", "肱肌", "肱三头肌长头", "肱三头肌外侧头", "肱三头肌内侧头"]
MAX_ANGLE = math.radians(130.0)


def _read_verified(filename, sha):
    # Git on Windows may check LF text files out with CRLF.
    raw = (MODEL_DIR / filename).read_bytes().replace(b"\r\n", b"\n")
    if hashlib.sha256(raw).hexdigest() != sha:
        raise RuntimeError(f"Arm26 input differs from the verified version: {filename}")
    return raw


_read_verified("arm26.osim", SRC_SHA)
_TABLE = json.loads(_read_verified("arm26-table.json", TABLE_SHA))
_ROWS = _TABLE["rows"]
_PARAMS = _TABLE["muscleParameters"]
if _TABLE["sourceSHA256"] != SRC_SHA or [m["id"] for m in _PARAMS] != MUSCLES:
    raise RuntimeError("Arm26 table binding or muscle order mismatch")


def model_info():
    """JSON-compatible, independently versioned model card."""
    return {
        "id": _TABLE["version"], "source": "OpenSim Arm26", "opensim": _TABLE["opensim"],
        "sourceSHA256": SRC_SHA, "tableSHA256": TABLE_SHA,
        "sourceUrl": "https://github.com/opensim-org/opensim-models/blob/"
                     "84b487c4e3245359a64381e01f01b9cf4772d457/Models/Arm26/arm26.osim",
        "muscles": [dict(p, label=n, action="flexor" if i < 3 else "extensor")
                    for i, (p, n) in enumerate(zip(_PARAMS, NAMES))],
        "angleRangeDeg": [0, 130], "shoulderDeg": 0, "gravityMS2": _TABLE["gravity"],
        "upperArmMassKg": _TABLE["upperArmMassKg"], "forearmHandMassKg": _TABLE["forearmHandMassKg"],
        "forearmHandInertiaKgM2": _TABLE["bareElbowInertiaKgM2"],
        "forearmHandGravity90Nm": _TABLE["bareGravity90Nm"],
        "tableStepDeg": _TABLE["stepDeg"],
        "assumptions": [
            "右肩锁定于零位，前臂与手作为一个刚体，固定前臂旋转；只有屈肘一个自由度。",
            "重力设为 9.81 m/s²；负重位于屈伸平面，在给定半径处随前臂转动。",
            "根据原模型的肌肉路径与 Thelen 参数，采用刚性肌腱；模型被动肌纤维力计入张力。",
            "主动分担将最大激活时的长度与速度能力按激活线性缩放；未模拟原始弹性肌腱状态。",
            "数值是模型估计；骨骼视图与数值模型的空间绑定由显示层说明。"
        ],
        "license": "CC BY 3.0 · OpenSim Development Team (Reinbolt, Seth, Habib, Hamner), adapted from Kate Holzbaur.",
    }


def _force_velocity(v, p):
    """Invert Thelen's normalized velocity equations at unit activation."""
    af = p["af"]
    if v <= 0.0:
        return max(0.0, (1.0 + v) / (1.0 - v / af))
    flen = p["flen"]
    k = (2.0 + 2.0 / af) / (flen - 1.0)
    high = flen * p["fvThreshold"]
    edge_v = (high - 1.0) / (k * (flen - high))
    if v <= edge_v:
        return (1.0 + k * v * flen) / (1.0 + k * v)
    tangent = k * (flen - high) ** 2 / (flen - 1.0)
    return high + (v - edge_v) * tangent


def mechanics(angle_rad, velocity_rad_s, acceleration_rad_s, load_kg, radius_m):
    """Return required net torque, gravity torque, inertia and six actuator terms.

    tension[i] = passive[i] + capacity[i] * activation[i].
    Required torque = gravity + inertia * acceleration, including payload.
    """
    if not all(math.isfinite(x) for x in
               (angle_rad, velocity_rad_s, acceleration_rad_s, load_kg, radius_m)):
        raise ValueError("角度、速度、加速度和负载必须为有限数值")
    if angle_rad < -1e-7 or angle_rad > MAX_ANGLE + 1e-7:
        raise ValueError("角度超出 Arm26 模型的 0–130° 范围")
    if load_kg < 0 or radius_m < 0:
        raise ValueError("负重和力臂不能小于零")
    q = min(MAX_ANGLE, max(0., angle_rad))
    pos = math.degrees(q) / _TABLE["stepDeg"]
    lo = min(int(pos), len(_ROWS) - 2)
    frac = pos - lo
    row = [a + frac * (b - a) for a, b in zip(_ROWS[lo], _ROWS[lo + 1])]
    arms = row[0:6]
    passive = row[6:12]
    active = [_force_velocity(scale * velocity_rad_s, p) * iso
              for scale, p, iso in zip(row[18:24], _PARAMS, row[12:18])]
    sine = math.sin(q)
    bare_gravity = _TABLE["bareGravity90Nm"] * sine
    load_gravity = load_kg * _TABLE["gravity"] * radius_m * sine
    inertia = _TABLE["bareElbowInertiaKgM2"] + load_kg * radius_m ** 2
    gravity = bare_gravity + load_gravity
    return {"torque": gravity + inertia * acceleration_rad_s, "gravity": gravity,
            "inertia": inertia, "load_gravity": load_gravity, "bare_gravity": bare_gravity,
            "arms": arms, "passive": passive, "capacity": active}

