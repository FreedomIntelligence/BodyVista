"""Effective FDP transmission used by the BodyVista v5 frame solver.

Franko et al. (2011), Table 2, DOI 10.1016/j.jbiomech.2011.04.025.
Both small fingers use measured MCP/PIP/DIP flexion moment arms. The effective length is the native
length plus an integrated single-axis correction for each declared hinge.
Original joint interaction terms and non-target actuator paths are retained.

Construct one transmission per native worker/model, at its neutral posture.
Call correct_fresh once after native forward and before the hand passive
reference. The reference itself must also use the updated transmission.
"""
from __future__ import annotations

import functools
import hashlib
from pathlib import Path
import math
import threading
from dataclasses import dataclass

import mujoco
import numpy as np

V4_MODEL_SHA = "d754382200ed601e74949b7d2edc1fc4b1cb29bcfa4bc22f96d21010dc631b62"
MODEL_ID = "franko-small-fdp-thelen-fds-series-v1"
CACHE_SIZE = 256


@dataclass(frozen=True)
class MomentArm:
    """Table 2 polynomial in mm, measured domain in radians."""
    a: float
    b: float
    c: float
    lo: float
    hi: float

    def metres(self, theta: float) -> float:
        if not math.isfinite(theta):
            raise ValueError("Nonfinite finger angle")
        x = min(max(theta, self.lo), self.hi)
        return ((self.a*x+self.b)*x+self.c)*.001

    def excursion(self, theta: float) -> float:
        """Integral from zero; endpoint-constant arm outside the measured domain."""
        if not math.isfinite(theta):
            raise ValueError("Nonfinite finger angle")
        if theta <= self.lo:
            return theta*self.metres(self.lo)
        x = min(theta, self.hi)
        integral = (x-self.lo)*(.001*self.c + .0005*self.b*(x+self.lo)
                                 + .001*self.a*(x*x+x*self.lo+self.lo*self.lo)/3.)
        return self.lo*self.metres(self.lo)+integral+(theta-x)*self.metres(self.hi)


SMALL = (MomentArm(14.8, -12.7, 14.4, .05, .79),
         MomentArm(16.4, -21.8, 14.2, .05, 1.32),
         MomentArm(15., -8.3, 8.7, .05, .61))



@dataclass(frozen=True)
class Target:
    actuator: str
    joints: tuple[str, ...]
    arms: tuple[MomentArm, ...]


# Only the two small-finger deep flexor paths are replaced.
TARGETS = tuple(Target("FDPL"+side, tuple("5"+part+"_flexion"+side for part in
                ("mcp","pm","md")), SMALL) for side in ("","_l"))
FDS_NAMES = tuple(name+side for name in ("FDSI","FDSM","FDSR","FDSL") for side in ("","_l"))
NAMES = tuple(target.actuator for target in TARGETS)
NEUTRAL_AXES = tuple(name for target in TARGETS for name in target.joints)


def declaration() -> dict:
    """Return a fresh JSON-serializable model declaration in stable path order."""
    return {"modelId": MODEL_ID, "nativeBaseModelSha256": V4_MODEL_SHA,
            "source": {"doi": "10.1016/j.jbiomech.2011.04.025", "pmid": "21561624", "table": 2},
            "angleUnit": "rad", "armUnit": "mm", "coefficientOrder": ["quadratic", "linear", "constant"],
            "outsideMeasuredRange": "nearest-endpoint-constant-moment-arm",
            "passiveSeries": {"model":"thelen-fds-passive-series-v1","muscles":list(FDS_NAMES),
                "tendonStrainAtFmax":.04,"tendonToeForceFraction":.33,"tendonToeShape":3,
                "fibreStrainAtFmax":.6,"fibreShape":5,
                "slackLength":"effective-length-offset-from-validated-lengthrange",
                "moduleSha256": hashlib.sha256(Path(__file__).with_name("passive_series.py").read_bytes()).hexdigest(),
                "source":"https://github.com/opensim-org/opensim-core/blob/main/OpenSim/Actuators/Thelen2003Muscle.cpp"},
            "targets": [{"actuator": target.actuator, "tendon": target.actuator+"_tendon",
                         "axes": [{"joint": name, "coefficientsMm": [arm.a, arm.b, arm.c],
                                   "measuredRangeRad": [arm.lo, arm.hi]}
                                  for name, arm in zip(target.joints, target.arms, strict=True)]}
                        for target in TARGETS]}


def _row(address, counts, columns, values, row):
    start = int(address[row])
    stop = start+int(counts[row])
    if start < 0 or stop > len(values) or stop > len(columns):
        raise ValueError("Invalid MuJoCo transmission sparse row")
    ids = np.asarray(columns[start:stop], dtype=int)
    if len(set(ids.tolist())) != len(ids):
        raise ValueError("Repeated degree of freedom in native sparse transmission")
    return ids, values[start:stop]


def _slots(ids, dofs):
    result = []
    for dof in dofs:
        found = np.flatnonzero(ids == dof)
        if len(found) != 1:
            raise ValueError("Native transmission does not represent the required flexion DOF")
        result.append(int(found[0]))
    return np.array(result, dtype=int)


@dataclass(frozen=True)
class _Path:
    actuator: int
    tendon: int
    qpos: tuple[int, ...]
    dofs: tuple[int, ...]


def _path(model, target):
    name = target.actuator
    actuator = int(model.actuator(name).id)
    tendon = int(model.tendon(name+"_tendon").id)
    same = (model.actuator_trntype == mujoco.mjtTrn.mjTRN_TENDON) & (model.actuator_trnid[:, 0] == tendon)
    if (model.actuator_trntype[actuator] != mujoco.mjtTrn.mjTRN_TENDON
            or model.actuator_trnid[actuator, 0] != tendon or np.count_nonzero(same) != 1
            or not np.array_equal(model.actuator_gear[actuator], [1., 0., 0., 0., 0., 0.])):
        raise ValueError("Expected one unit-gear actuator for the named FDP spatial tendon")
    for field in ("tendon_limited", "tendon_actfrclimited", "tendon_stiffness", "tendon_stiffnesspoly",
                  "tendon_damping", "tendon_dampingpoly", "tendon_armature", "tendon_frictionloss"):
        if np.any(getattr(model, field)[tendon]):
            raise ValueError("Unsupported independent tendon constraint or passive force: "+field)
    eq_tendon = np.asarray(model.eq_type) == mujoco.mjtEq.mjEQ_TENDON
    if np.any(eq_tendon & ((model.eq_obj1id == tendon) | (model.eq_obj2id == tendon))):
        raise ValueError("FDP transmission is coupled to a tendon equality")
    joints = [int(model.joint(axis).id) for axis in target.joints]
    if any(model.jnt_type[j] != mujoco.mjtJoint.mjJNT_HINGE for j in joints):
        raise ValueError("All target flexion axes must be native hinges")
    return _Path(actuator, tendon, tuple(int(model.jnt_qposadr[j]) for j in joints),
                 tuple(int(model.jnt_dofadr[j]) for j in joints))


class FrankoTransmission:
    """One fixed model and reference posture; isolated native-data workspace."""

    def __init__(self, model, neutral_qpos):
        self.model = model
        self._owner = threading.get_ident()
        self._scratch = mujoco.MjData(model)
        self._q0 = np.array(neutral_qpos, dtype=float, copy=True)
        self.paths = tuple(_path(model, target) for target in TARGETS)
        if self._q0.shape != (model.nq,) or not np.isfinite(self._q0).all():
            raise ValueError("Invalid native reference posture")
        for path in self.paths:
            if np.any(self._q0[list(path.qpos)] != 0.):
                raise ValueError("All target reference flexion hinges must be exactly zero")
        self._q0.setflags(write=False)
        self._slice = functools.lru_cache(maxsize=CACHE_SIZE)(self._sample_slice)
        self._base = tuple(self._slice(i, 0, 0.)[0] for i in range(len(TARGETS)))
        self.states = 0
        self.max_actuation_error = 0.

    def _tendon_row(self, data, path):
        m = self.model
        return _row(m.ten_J_rowadr, m.ten_J_rownnz, m.ten_J_colind, data.ten_J, path.tendon)

    def _sample_slice(self, index, axis, theta):
        scratch, path = self._scratch, self.paths[index]
        scratch.qpos[:] = self._q0
        scratch.qpos[path.qpos[axis]] = theta
        mujoco.mj_kinematics(self.model, scratch)
        mujoco.mj_comPos(self.model, scratch)
        mujoco.mj_tendon(self.model, scratch)
        columns, values = self._tendon_row(scratch, path)
        derivative = values[_slots(columns, [path.dofs[axis]])[0]]
        pair = float(scratch.ten_length[path.tendon]), float(derivative)
        if not all(map(math.isfinite, pair)):
            raise ValueError("Nonfinite native single-axis tendon excursion")
        return pair

    def correct_fresh(self, data):
        """Correct exactly once after native forward, before applying the hand reference."""
        if threading.get_ident() != self._owner:
            raise RuntimeError("Each native worker must own its transmission instance")
        baseline_forces = data.actuator_force.copy()
        expected = data.qfrc_actuator.copy()
        targets = []
        for index, (target, path) in enumerate(zip(TARGETS, self.paths, strict=True)):
            a, t = path.actuator, path.tendon
            acols, arow = _row(data.moment_rowadr, data.moment_rownnz, data.moment_colind, data.actuator_moment, a)
            tcols, trow = self._tendon_row(data, path)
            ai, ti = _slots(acols, path.dofs), _slots(tcols, path.dofs)
            if (data.ten_length[t] != data.actuator_length[a]
                    or not np.allclose(arow[ai], trow[ti], rtol=0., atol=1e-12)):
                raise ValueError("Native tendon and unit-gear actuator disagree")
            expected[acols] -= baseline_forces[a]*arow
            extension = 0.
            slopes = []
            for axis, arm in enumerate(target.arms):
                theta = float(data.qpos[path.qpos[axis]])
                native_length, native_slope = self._slice(index, axis, theta)
                extension += -arm.excursion(theta)-(native_length-self._base[index])
                slopes.append(-arm.metres(theta)-native_slope)
            length = float(data.ten_length[t]+extension)
            if not math.isfinite(length) or length <= 0. or not all(map(math.isfinite, slopes)):
                raise ValueError("Invalid effective FDP length or derivative")
            arow[ai] += slopes
            trow[ti] += slopes
            adot = float(arow@data.qvel[acols])
            tdot = float(trow@data.qvel[tcols])
            if not math.isfinite(adot) or not math.isfinite(tdot) or abs(adot-tdot) > 1e-12:
                raise ValueError("Effective tendon and actuator velocities disagree")
            data.ten_length[t] = data.actuator_length[a] = length
            data.ten_velocity[t] = data.actuator_velocity[a] = adot
            targets.append((a, acols, arow))
        mujoco.mj_fwdActuation(self.model, data)
        changed = [target[0] for target in targets]
        other = np.ones(self.model.nu, dtype=bool)
        other[changed] = False
        if not np.array_equal(data.actuator_force[other], baseline_forces[other]):
            raise ValueError("Changing the FDP transmission altered another actuator's output force")
        for a, acols, arow in targets:
            expected[acols] += data.actuator_force[a]*arow
        error = float(np.max(np.abs(data.qfrc_actuator-expected), initial=0.))
        if not math.isfinite(error) or error > 1e-9:
            raise ValueError(f"Native generalized actuator force differs from the transmission by {error}")
        self.max_actuation_error = max(self.max_actuation_error, error)
        self.states += 1

    def diagnostics(self):
        info = self._slice.cache_info()
        return {"candidate": MODEL_ID, "changedActuators": NAMES, "states": self.states,
                "sliceCacheEntries": info.currsize, "sliceCacheHits": info.hits, "sliceCacheMisses": info.misses,
                "maxGeneralizedActuationError": self.max_actuation_error, "source": "Franko 2011, Table 2"}

    def clear(self):
        self._slice.cache_clear()
