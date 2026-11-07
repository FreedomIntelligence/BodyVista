"""Native five-actuator regression tests for the selected v5 transmission."""
import hashlib
import json
import unittest
from pathlib import Path

import mujoco
import numpy as np

import franko_transmission as F


def _model():
    origins, hands, tendons, actuators = [], [], [], []
    inertial = '<inertial pos="0 0 .01" mass=".02" diaginertia="1e-4 1e-4 1e-4"/>'
    for side, suffix in enumerate(("", "_l")):
        wrist = "wrist"+suffix
        base = side*.12
        bodies = [f'<body pos="{base} 0 0"><joint name="{wrist}" axis="0 1 0"/>{inertial}']
        for finger, digit in (("FDPL", 5), ("FDPM", 3)):
            name = finger+suffix
            x = .018*(digit-4)
            origins.append(f'<site name="{name}origin" pos="{base+x-.02} -.03 .02"/>')
            for i, part in enumerate(("mcp", "pm", "md")):
                pos = f"{x} 0 .025" if i == 0 else "0 0 .025"
                bodies.append(f'<body pos="{pos}"><joint name="{digit}{part}_flexion{suffix}" axis="1 0 0"/>{inertial}')
            bodies.append(f'<site name="{name}tip" pos=".003 -.004 .023"/></body></body></body>')
            tendons.append(f'<spatial name="{name}_tendon"><site site="{name}origin"/><site site="{name}tip"/></spatial>')
            actuators.append(f'<general name="{name}" tendon="{name}_tendon" gaintype="affine" gainprm="1 3 .2"/>')
        hands.extend(bodies+['</body>'])
    return mujoco.MjModel.from_xml_string('<mujoco><compiler angle="radian"/><worldbody>'+''.join(origins+hands)
        +'</worldbody><tendon>'+''.join(tendons)+'</tendon><actuator>'+''.join(actuators)
        +'<motor name="other" joint="wrist"/></actuator></mujoco>')


def _state(model, q, velocity=None, correct=None):
    data = mujoco.MjData(model)
    data.qpos[:] = q
    if velocity is not None:
        data.qvel[:] = velocity
    data.ctrl[:] = [.7, -.4, .2, .5, .15]
    mujoco.mj_forward(model, data)
    if correct is not None:
        correct(data)
    return data


class FrankoTransmissionTests(unittest.TestCase):
    def test_manifest_selects_exact_module_and_table_axes(self):
        here = Path(__file__).resolve().parent
        manifest = json.loads((here/"candidates/runtime/expanded-motion-repair-v5-manifest.json").read_bytes())
        self.assertEqual(manifest["transmissionStatus"], "selected")
        self.assertEqual(manifest["transmissionModuleSha256"], hashlib.sha256((here/"franko_transmission.py").read_bytes()).hexdigest())
        self.assertEqual(manifest["effectiveTendonTransmission"], F.declaration())
        self.assertEqual(len(F.NEUTRAL_AXES), 6)
        rows = F.declaration()["targets"]
        self.assertEqual([r["actuator"] for r in rows], ["FDPL", "FDPL_l"])
        literal = [[14.8, -12.7, 14.4, .05, .79], [16.4, -21.8, 14.2, .05, 1.32], [15., -8.3, 8.7, .05, .61]]
        for row in rows:
            expected = literal
            self.assertEqual([a["coefficientsMm"]+a["measuredRangeRad"] for a in row["axes"]], expected)
            suffix = "_l" if row["actuator"].endswith("_l") else ""
            axes = ["5mcp_flexion", "5pm_flexion", "5md_flexion"]
            self.assertEqual([a["joint"] for a in row["axes"]], [name+suffix for name in axes])

    def test_measured_single_axis_and_continuous_extrapolation_on_both_sides(self):
        m = _model()
        tx = F.FrankoTransmission(m, m.qpos0)
        neutral = _state(m, m.qpos0, correct=tx.correct_fresh)
        np.testing.assert_array_equal(neutral.actuator_length, _state(m, m.qpos0).actuator_length)
        for target, path in zip(F.TARGETS, tx.paths, strict=True):
            for i, arm in enumerate(target.arms):
                for theta in (-.1, arm.lo, .37, arm.hi, arm.hi+.1):
                    q = m.qpos0.copy()
                    q[path.qpos[i]] = theta
                    d = _state(m, q, correct=tx.correct_fresh)
                    a = path.actuator
                    self.assertAlmostEqual(d.actuator_length[a]-neutral.actuator_length[a], -arm.excursion(theta), delta=1e-12)
                    ids, row = F._row(d.moment_rowadr, d.moment_rownnz, d.moment_colind, d.actuator_moment, a)
                    self.assertAlmostEqual(row[F._slots(ids, [path.dofs[i]])[0]], -arm.metres(theta), delta=1e-12)
                    step = 1e-6
                    self.assertAlmostEqual((arm.excursion(theta+step)-arm.excursion(theta-step))/(2*step),
                                           arm.metres(theta), delta=2e-8)

    def test_middle_proximal_moments_and_unrelated_actuator_stay_native(self):
        m = _model()
        tx = F.FrankoTransmission(m, m.qpos0)
        q, v = np.linspace(-.07, .50, m.nq), np.linspace(-.15, .21, m.nv)
        original, updated = _state(m, q, v), _state(m, q, v, tx.correct_fresh)
        for suffix in ("", "_l"):
            a = m.actuator("FDPM"+suffix).id
            ids, row = F._row(updated.moment_rowadr, updated.moment_rownnz, updated.moment_colind, updated.actuator_moment, a)
            _, raw = F._row(original.moment_rowadr, original.moment_rownnz, original.moment_colind, original.actuator_moment, a)
            dip = m.jnt_dofadr[m.joint("3md_flexion"+suffix).id]
            np.testing.assert_array_equal(row[ids != dip], raw[ids != dip])
            np.testing.assert_array_equal(row[ids == dip], raw[ids == dip])
        other = m.actuator("other").id
        for name in ("actuator_length", "actuator_velocity", "actuator_force"):
            self.assertEqual(getattr(updated, name)[other], getattr(original, name)[other])

    def test_mixed_velocity_and_full_native_generalized_force(self):
        m = _model()
        tx = F.FrankoTransmission(m, m.qpos0)
        q, v = np.linspace(-.07, .50, m.nq), np.linspace(-.15, .21, m.nv)
        d = _state(m, q, v, tx.correct_fresh)
        plus, minus = [_state(m, q+s*1e-6*v, correct=tx.correct_fresh) for s in (1, -1)]
        np.testing.assert_allclose((plus.actuator_length-minus.actuator_length)/2e-6, d.actuator_velocity,
                                   atol=1e-9, rtol=0.)
        generalized = np.zeros(m.nv)
        for i in range(m.nu):
            ids, row = F._row(d.moment_rowadr, d.moment_rownnz, d.moment_colind, d.actuator_moment, i)
            generalized[ids] += row*d.actuator_force[i]
        np.testing.assert_allclose(generalized, d.qfrc_actuator, atol=1e-12, rtol=0.)
        for p in tx.paths:
            self.assertEqual(d.actuator_velocity[p.actuator], d.ten_velocity[p.tendon])


if __name__ == "__main__":
    unittest.main()


