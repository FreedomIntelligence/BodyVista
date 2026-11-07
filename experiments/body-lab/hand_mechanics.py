"""Fixed hand passive laws and reference correction for the declared v4 model.

Construction validates declarations but does not run MuJoCo or install callbacks.
Call ``install`` only after all models have finished compiling. Before every
native forward/actuation call, the owner must call ``assert_installed``. Models
must compile with MUSCLE bias; only this instance changes its 36 entries to USER.
The reference correction is an aggregate research term, not a measured ligament
force. Neither its parameters nor its reference torque follow scene strength.
"""

from collections.abc import Callable, Mapping
import math
from types import MappingProxyType
from weakref import WeakValueDictionary

import mujoco
import numpy as np


PASSIVE_MUSCLES = tuple(
    name + suffix
    for name in (
        "FDSI", "FDSM", "FDSR", "FDSL", "1stDI_MC1", "1stDI_MC2",
        "2ndDI", "3rdDI", "4thDI", "1stPI", "2ndPI", "3rdPI",
        "LUMI", "LUMM", "LUMR", "LUML", "ADM", "ODM",
    )
    for suffix in ("", "_l")
)
STIFFNESS_NM_PER_RAD = MappingProxyType({
    "2mcp_flexion": 0.03662108695652174,
    "2pm_flexion": 0.014377778260869565,
    "2md_flexion": 0.0029039173913043476,
    "3mcp_flexion": 0.03828713636363636,
    "3pm_flexion": 0.017815152173913044,
    "3md_flexion": 0.003092331818181818,
    "4mcp_flexion": 0.02606752380952381,
    "4pm_flexion": 0.013039213043478262,
    "4md_flexion": 0.0028100636363636365,
    "5mcp_flexion": 0.012707869565217392,
    "5pm_flexion": 0.00497328,
    "5md_flexion": 0.001744847619047619,
})
FINGER_COORDINATES = tuple(
    name + suffix for name in STIFFNESS_NM_PER_RAD for suffix in ("", "_l")
)
REFERENCE_RULE = (
    "All independent coordinates fixed to immutable source defaults except the "
    "24 declared current finger flexion coordinates; no current "
    "wrist/elbow/forearm/abduction/thumb dependence"
)
E0, KPE = 0.6, 5.0
_DENOMINATOR = math.expm1(KPE)
_OWNERS: WeakValueDictionary = WeakValueDictionary()


def _address(model) -> int:
    # MuJoCo 3.17 callbacks.cc resolves native pointers through MjWrapperLookup;
    # _address identifies that native model even across Python wrapper access.
    # https://github.com/google-deepmind/mujoco/blob/3.17.0/python/mujoco/callbacks.cc
    value = int(model._address)
    if value <= 0:
        raise RuntimeError("Hand mechanics requires a live compiled model")
    return value


def _dispatch_bias(model, data, actuator: int) -> float:
    owner = _OWNERS.get(_address(model))
    if owner is None or actuator not in owner._passive_indices:
        raise RuntimeError("Unregistered model or actuator requested USER hand bias")
    return owner.bias(model, data, actuator)


def _number(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a finite number")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    return value


class HandMechanics:
    """Validate and install one immutable hand declaration for one model.

    declaration contains passiveLaw (the Thelen predeclaration),
    referenceCorrection (the linear predeclaration), referenceConfiguration
    (the complete frozen source defaults), strengthScale=1, allMuscleScales=1.
    raw_state passed below must bypass this correction, e.g.
    lambda q: ctx.state(q, _skip_hand_correction=True). It must still return the
    original native coordinate projection. moments is dense_moments(model,data).
    """

    def __init__(self, ctx, declaration: Mapping):
        self.ctx = ctx
        self.model = ctx.model
        self._model_address = _address(self.model)
        self._installed = False
        self._in_reference = False
        self._validate_declaration(declaration)
        self.names = FINGER_COORDINATES
        self.indices = np.array([ctx.index[name] for name in self.names], dtype=int)
        self.dofs = np.array([
            self.model.jnt_dofadr[ctx.joint_ids[name]] for name in self.names
        ], dtype=int)
        if len(set(self.dofs)) != 24:
            raise ValueError("Hand correction requires 24 distinct native DOFs")
        for name in self.names:
            joint = ctx.joint_ids[name]
            if (self.model.jnt_type[joint] != mujoco.mjtJoint.mjJNT_HINGE
                    or not math.isclose(ctx.factor[name], 180 / math.pi,
                                        rel_tol=0, abs_tol=1e-12)):
                raise ValueError("Hand correction requires independent degree-valued hinges")
        self.stiffness = np.array([
            STIFFNESS_NM_PER_RAD[name.removesuffix("_l")] for name in self.names
        ])
        self.equilibrium = np.deg2rad([
            14.0 if "mcp" in name else 7.0 for name in self.names
        ])
        self.reference = MappingProxyType(dict(ctx.defaults))
        self._passive_indices = frozenset(ctx.muscle_names.index(n) for n in PASSIVE_MUSCLES)
        self._series_lengths = {}
        series = ctx.manifest.get("effectiveTendonTransmission", {}).get("passiveSeries")
        if series:
            if __package__:
                from .passive_series import series_force
            else:
                from passive_series import series_force
            self._series_force = series_force
            for name in series["muscles"]:
                i = ctx.muscle_names.index(name)
                params = self.model.actuator_biasprm[i]
                low, high = self.model.actuator_lengthrange[i]
                l0 = float((high - low)/(params[1]-params[0]))
                lt = float(low - params[0]*l0)
                if i not in self._passive_indices or not (l0 > 0. and lt > 0. and params[2] > 0.):
                    raise ValueError("FDS passive series requires positive, calibrated lengths and Fmax")
                self._series_lengths[i] = (l0,lt)
        self._original_bias_types = self.model.actuator_biastype.copy()
        self._expected_bias_types = self._original_bias_types.copy()
        self._expected_bias_types[list(self._passive_indices)] = mujoco.mjtBias.mjBIAS_USER
        self._parameters = {
            name: getattr(self.model, name).copy() for name in (
                "actuator_gainprm", "actuator_biasprm", "actuator_lengthrange",
                "actuator_acc0", "actuator_gaintype",
            )
        }
        if (self.model.nu != 740 or len(ctx.muscle_names) != 740
                or len(set(ctx.muscle_names)) != 740
                or any(self.model.actuator(i).name != name
                       for i, name in enumerate(ctx.muscle_names))
                or np.any(self._original_bias_types != mujoco.mjtBias.mjBIAS_MUSCLE)
                or np.any(self.model.actuator_gaintype != mujoco.mjtGain.mjGAIN_MUSCLE)):
            raise ValueError("Compile the unchanged 740 native MUSCLE laws before installation")
        for i in self._passive_indices:
            prm, bounds = self.model.actuator_biasprm[i], self.model.actuator_lengthrange[i]
            if (not np.all(np.isfinite(prm[:3])) or not np.all(np.isfinite(bounds))
                    or prm[1] <= prm[0] or bounds[1] <= bounds[0] or prm[2] <= 0):
                raise ValueError("Thelen hand bias requires finite ranges and explicit positive Fmax")
        for values in (self.indices, self.dofs, self.stiffness, self.equilibrium):
            values.setflags(write=False)

    def _validate_declaration(self, declaration: Mapping) -> None:
        if not isinstance(declaration, Mapping):
            raise ValueError("Hand mechanics declaration must be an object")
        law = declaration.get("passiveLaw", {})
        correction = declaration.get("referenceCorrection", {})
        reference = declaration.get("referenceConfiguration", {})
        if not isinstance(law, Mapping) or not isinstance(correction, Mapping):
            raise ValueError("Missing passive-law or reference-correction declaration")
        muscles = law.get("muscles")
        if (not isinstance(muscles, (list, tuple)) or len(muscles) != 36
                or set(muscles) != set(PASSIVE_MUSCLES)
                or _number(law.get("e0"), "e0") != E0
                or _number(law.get("kpe"), "kpe") != KPE):
            raise ValueError("Hand passive law must retain the fixed 36 muscles, e0=0.6 and kpe=5")
        if (correction.get("type") != "reference-aggregate-linear-passive-v1"
                or correction.get("referenceRule") != REFERENCE_RULE):
            raise ValueError("Unexpected hand reference-correction mechanism")
        rows = correction.get("coordinates")
        if (not isinstance(rows, list) or len(rows) != 24
                or any(not isinstance(row, Mapping) for row in rows)
                or {row.get("coordinate") for row in rows} != set(FINGER_COORDINATES)):
            raise ValueError("Hand correction must declare exactly the fixed 24 coordinates")
        for row in rows:
            name = row["coordinate"]
            if (_number(row.get("stiffnessNmPerRad"), name) != STIFFNESS_NM_PER_RAD[name.removesuffix("_l")]
                    or _number(row.get("equilibriumDeg"), name) != (14.0 if "mcp" in name else 7.0)):
                raise ValueError(f"Hand reference parameters changed for {name}")
        if not isinstance(reference, Mapping) or set(reference) != set(self.ctx.defaults):
            raise ValueError("Hand reference must contain all independent source defaults")
        if any(_number(reference[name], name) != value for name, value in self.ctx.defaults.items()):
            raise ValueError("Hand reference must equal the immutable source defaults")
        for key in ("strengthScale", "allMuscleScales"):
            if _number(declaration.get(key), key) != 1:
                raise ValueError("The hand reference correction uses fixed unit strength")

    def install(self) -> None:
        """Install after compilation, refusing to replace an unrelated callback."""
        if self._installed:
            self.assert_installed()
            return
        previous = mujoco.get_mjcb_act_bias()
        if previous is not None and previous is not _dispatch_bias:
            raise RuntimeError("An external actuator-bias callback is already installed")
        if _OWNERS.get(self._model_address) is not None:
            raise RuntimeError("This native model already has a hand-mechanics owner")
        if not np.array_equal(self.model.actuator_biastype, self._original_bias_types):
            raise RuntimeError("Actuator bias types changed before hand installation")
        _OWNERS[self._model_address] = self
        try:
            mujoco.set_mjcb_act_bias(_dispatch_bias)
            self.model.actuator_biastype[:] = self._expected_bias_types
            self._installed = True
            self.assert_installed()
        except Exception:
            self.model.actuator_biastype[:] = self._original_bias_types
            self._installed = False
            _OWNERS.pop(self._model_address, None)
            mujoco.set_mjcb_act_bias(previous)
            raise

    def assert_installed(self) -> None:
        """Fail before native evaluation if callbacks, model or laws drifted."""
        if (not self._installed or _address(self.model) != self._model_address
                or _OWNERS.get(self._model_address) is not self
                or mujoco.get_mjcb_act_bias() is not _dispatch_bias
                or not np.array_equal(self.model.actuator_biastype, self._expected_bias_types)):
            raise RuntimeError("The model's declared hand-bias callback is missing or changed")
        if any(not np.array_equal(getattr(self.model, key), value)
               for key, value in self._parameters.items()):
            raise RuntimeError("Native muscle parameters changed after hand declaration")

    def uninstall(self) -> None:
        """Clean up this model even on drift, then propagate the drift error."""
        if not self._installed and _OWNERS.get(self._model_address) is not self:
            return
        try:
            self.assert_installed()
        finally:
            self.model.actuator_biastype[:] = self._original_bias_types
            self._installed = False
            if _OWNERS.get(self._model_address) is self:
                _OWNERS.pop(self._model_address)
            # Never overwrite a foreign callback or remove a dispatcher still
            # needed by another model. The original error propagates afterward.
            if not _OWNERS and mujoco.get_mjcb_act_bias() is _dispatch_bias:
                mujoco.set_mjcb_act_bias(None)

    def bias(self, model, data, i: int) -> float:
        """Unscaled signed passive force, shared by solver and USER callback."""
        if _address(model) != self._model_address or not 0 <= i < model.nu:
            raise RuntimeError("Hand bias called with another model or invalid actuator")
        if (not self._installed or mujoco.get_mjcb_act_bias() is not _dispatch_bias
                or _OWNERS.get(self._model_address) is not self):
            raise RuntimeError("Hand bias requires its registered native callback")
        expected = mujoco.mjtBias.mjBIAS_USER if i in self._passive_indices else mujoco.mjtBias.mjBIAS_MUSCLE
        if model.actuator_biastype[i] != expected:
            raise RuntimeError("Unexpected actuator bias type")
        length = float(data.actuator_length[i])
        if not math.isfinite(length):
            raise ValueError("Nonfinite muscle length")
        if i not in self._passive_indices:
            return float(mujoco.mju_muscleBias(length, model.actuator_lengthrange[i],
                         model.actuator_acc0[i], model.actuator_biasprm[i, :9]))
        prm, bounds = model.actuator_biasprm[i], model.actuator_lengthrange[i]
        l0 = (bounds[1] - bounds[0]) / (prm[1] - prm[0])
        normalized_length = prm[0] + (length - bounds[0]) / l0
        if i in self._series_lengths:
            fibre_length, slack_length = self._series_lengths[i]
            return -float(prm[2]) * self._series_force(length-fibre_length-slack_length, fibre_length, slack_length)
        if normalized_length <= 1:
            return 0.0
        value = -float(prm[2]) * math.expm1(KPE * (normalized_length - 1) / E0) / _DENOMINATOR
        if not math.isfinite(value):
            raise ValueError("Nonfinite hand passive force")
        return value

    def reference_torque(self, q: Mapping, raw_state: Callable, moments: Callable) -> np.ndarray:
        """24 MTU torques at current finger angles and fixed remaining defaults."""
        self.assert_installed()
        if self._in_reference:
            raise RuntimeError("Reference state must bypass the hand correction")
        normalized = self.ctx.normalize_q(q)
        reference = dict(self.reference)
        reference.update({name: normalized[name] for name in self.names})
        self._in_reference = True
        try:
            data, projection = raw_state(reference)
            # Bias below depends on lengths only, never activation or velocity.
            data.act[:] = 0
            data.ctrl[:] = 0
            projection = np.asarray(projection)
            expected = np.zeros((24, len(self.ctx.names)))
            expected[np.arange(24), self.indices] = 1
            if (projection.shape != (self.model.nv, len(self.ctx.names))
                    or not np.array_equal(projection[self.dofs], expected)):
                raise RuntimeError("Hand correction no longer maps to independent native hinges")
            moment = np.asarray(moments(self.model, data))
            if moment.shape != (self.model.nu, self.model.nv):
                raise RuntimeError("Unexpected native moment-arm matrix shape")
            bias = np.array([self.bias(self.model, data, i) for i in range(self.model.nu)])
            result = (moment @ projection[:, self.indices]).T @ bias
            if not np.all(np.isfinite(result)):
                raise ValueError("Nonfinite hand reference torque")
            return result
        finally:
            self._in_reference = False

    def correction(self, q: Mapping, raw_state: Callable, moments: Callable) -> np.ndarray:
        """Fixed-unit-strength aggregate correction, 24 values in N m."""
        normalized = self.ctx.normalize_q(q)
        angles = np.deg2rad([normalized[name] for name in self.names])
        target = -self.stiffness * (angles - self.equilibrium)
        return target - self.reference_torque(normalized, raw_state, moments)

    def passive_forces(self, q: Mapping, raw_state: Callable, moments: Callable) -> np.ndarray:
        """Native generalized force vector; only the 24 declared DOFs are nonzero."""
        forces = np.zeros(self.model.nv)
        forces[self.dofs] = self.correction(q, raw_state, moments)
        return forces
