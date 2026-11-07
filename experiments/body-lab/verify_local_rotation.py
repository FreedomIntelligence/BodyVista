"""Real-model regression for source anchors and local joint rotation."""

import argparse
import importlib
import json
import sys
from pathlib import Path
from time import perf_counter

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
engine = importlib.import_module("body-lab.fullbody_engine")


def verify():
    ctx = engine.context()
    model = ctx.model
    reference = (model.qpos0.copy(), model.jnt_range.copy(), model.eq_data.copy())
    covered = {n for h in ctx.handles for n in h["localCoordinates"]}
    assert covered == {n for n in ctx.names if ctx.factor[n] != 1}
    handles = {h["name"]: h for h in ctx.handles}
    anchor_checks = []
    for q in ({}, {"knee_angle_r": 60, "hip_flexion_r": 30, "elbow_flexion_r": 40}):
        data, _ = ctx.state(q)
        for h in ctx.handles:
            expected = engine.WORLD @ data.xanchor[ctx.joint_ids[h["pivotJoint"]]]
            assert np.array_equal(ctx.marker(data, h), expected), h["name"]
        joints = ctx.joints(data)
        for side in "rl":
            b = ctx.body_ids["capitate" if side == "r" else "capitate_l"]
            palm = engine.WORLD @ (data.xpos[b] + data.xmat[b].reshape(3, 3) @ [0, -0.045, 0])
            assert np.array_equal(joints["hand_" + side], palm)
            assert np.linalg.norm(palm - np.asarray(joints["wrist_" + side])) > 0.03
        anchor_checks.append(len(ctx.handles))
    # A source knee has a nonzero local anchor; a body origin is not equivalent.
    data, _ = ctx.state({"knee_angle_r": 60})
    h = handles["tibia_r"]
    knee_offset = float(np.linalg.norm(ctx.marker(data, h) - engine.WORLD @ data.xpos[ctx.body_ids["tibia_r"]]))
    assert knee_offset > 0.005

    cases = [
        ("ulna_r", "elbow_flexion_r", 30.0),
        ("ulna_l", "elbow_flexion_l", 15.0),
        ("femur_r", "hip_flexion_r", 15.0),
        ("femur_l", "hip_flexion_l", 15.0),
        ("lumbar5", "L5_S1_FE", 5.0),
        ("thoracic1", "T1_T2_FE", 1.0),
        ("head_neck", "T1_head_neck_FE", 5.0),
        ("rib3_L", "T3_r3L_X", 0.5),
        ("2midph", "2pm_flexion", 15.0),
        ("3midph_l", "3pm_flexion_l", 15.0),
        ("pelvis", "pelvis_tilt", 5.0),
    ]
    start, _ = ctx.state(ctx.defaults)
    records = []
    for handle, coordinate, angle in cases:
        h = handles[handle]
        axis = engine.WORLD @ start.xaxis[ctx.joint_ids[coordinate]]
        begin = perf_counter()
        frame = engine.rotate({"q": {}, "joint": handle, "axis": axis.tolist(), "angleDelta": angle})
        seconds = perf_counter() - begin
        result = frame["rotation"]
        assert result["accepted"], (handle, result)
        assert frame["anatomy"]["valid"], (handle, frame["anatomy"])
        assert all(frame["q"][n] == ctx.defaults[n] for n in ctx.names if n not in h["localCoordinates"])
        end, _ = ctx.state(frame["q"])
        ancestors = [ctx.body_ids[n] for n in h["lockedAncestorBodies"]]
        assert np.array_equal(end.xpos[ancestors], start.xpos[ancestors])
        assert np.array_equal(end.xmat[ancestors], start.xmat[ancestors])
        b = ctx.body_ids[handle]
        assert np.linalg.norm(end.xmat[b] - start.xmat[b]) > 0.001
        assert result["depthErrorM"] < 1e-6
        # Test a body-local point as well as the origin: a correct origin alone
        # cannot demonstrate that the bone's orientation stayed in the plane.
        offsets = np.eye(3) * 0.1
        p0 = offsets @ start.xmat[b].reshape(3, 3).T + start.xpos[b]
        p1 = offsets @ end.xmat[b].reshape(3, 3).T + end.xpos[b]
        assert np.max(np.abs((p1 - p0) @ engine.WORLD.T @ axis)) < 1e-6
        records.append({"joint": handle, "angle": angle, "seconds": seconds, "rotation": result})

    axis = engine.WORLD @ start.xaxis[ctx.joint_ids["elbow_flexion_r"]]
    perpendicular = np.cross(axis, [0, 1, 0])
    rejected = engine.rotate({"q": {}, "joint": "ulna_r", "axis": perpendicular.tolist(), "angleDelta": 15})
    assert not rejected["rotation"]["accepted"]
    assert rejected["q"] == ctx.defaults
    rejected_range = engine.rotate({"q": {}, "joint": "ulna_r", "axis": axis.tolist(), "angleDelta": 175})
    assert not rejected_range["rotation"]["accepted"]
    assert rejected_range["q"] == ctx.defaults
    # Every independent rotational coordinate has a local source-axis route.
    # Tiny in-range edits are enough here to test ownership and native coupling;
    # the larger normal movements below exercise the usability requirement.
    source_records = []
    for coordinate in sorted(covered):
        h = next(h for h in ctx.handles if coordinate in h["localCoordinates"])
        start_q = dict(ctx.defaults)
        if coordinate.startswith("knee_rotation_"):
            start_q[f"knee_angle_{coordinate[-1]}"] = 60
        coordinate_start, _ = ctx.state(start_q)
        normal = ctx.coordinate_axis(coordinate_start, coordinate)
        lo, hi = ctx.bounds(coordinate)
        delta = min(0.05, (hi - ctx.defaults[coordinate]) / 2)
        if delta < 0.001:
            delta = -min(0.05, (ctx.defaults[coordinate] - lo) / 2)
        frame = engine.rotate({"q": start_q, "joint": h["name"], "coordinate": coordinate,
                               "axis": normal.tolist(), "angleDelta": delta, "mode": "source-joint"})
        result = frame["rotation"]
        assert result["accepted"], (coordinate, result)
        assert abs(frame["q"][coordinate] - ctx.defaults[coordinate] - delta) < 1e-10
        assert all(frame["q"][n] == start_q[n] for n in ctx.names if n != coordinate)
        assert result["upstreamError"] == 0.0
        source_records.append({"coordinate": coordinate, "joint": h["name"], "depthM": result["depthErrorM"]})

    coupled_records = []
    for handle, coordinate, parents in [
        ("tibia_r", "knee_angle_r", ["femur_r"]),
        ("tibia_l", "knee_angle_l", ["femur_l"]),
        ("capitate", "flexion_r", ["radius_r", "ulna_r", "humerus_r"]),
        ("capitate_l", "flexion_l", ["radius_l", "ulna_l", "humerus_l"]),
        ("humerus_r", "shoulder_elv_r", ["thoracic1", "head_neck", "clavicle_l"]),
        ("humerus_l", "shoulder_elv_l", ["thoracic1", "head_neck", "clavicle_r"]),
    ]:
        normal = engine.WORLD @ start.xaxis[ctx.joint_ids[coordinate]]
        for angle in (5, 15, 30):
            frame = engine.rotate({"q": {}, "joint": handle, "coordinate": coordinate,
                                   "axis": normal.tolist(), "angleDelta": angle, "mode": "source-joint"})
            result = frame["rotation"]
            assert result["accepted"], (handle, angle, result)
            end, _ = ctx.state(frame["q"])
            for parent in parents:
                b = ctx.body_ids[parent]
                assert np.array_equal(end.xpos[b], start.xpos[b]), parent
                assert np.array_equal(end.xmat[b], start.xmat[b]), parent
            assert result["coupling"]["enabled"] and result["coupling"]["coordinates"]
            assert result["depthErrorM"] > 1e-4
            coupled_records.append({"joint": handle, "angle": angle, "rotation": result})

    wrong_source_axis = engine.rotate({"q": {}, "joint": "ulna_r", "coordinate": "elbow_flexion_r",
                                      "axis": perpendicular.tolist(), "angleDelta": 15, "mode": "source-joint"})
    assert not wrong_source_axis["rotation"]["accepted"]
    assert wrong_source_axis["q"] == ctx.defaults
    arbitrary_plane = engine.rotate({"q": {}, "joint": "femur_r", "axis": [-1, 1, 1], "angleDelta": 1})
    assert arbitrary_plane["rotation"]["accepted"]
    assert arbitrary_plane["rotation"]["depthErrorM"] < 1e-6
    historical_q = {"T1_head_neck_FE": 28, "T1_head_neck_LB": 17, "T1_head_neck_AR": 17}
    history_data, _ = ctx.state(historical_q)
    history_axis = engine.WORLD @ history_data.xaxis[ctx.joint_ids["T1_head_neck_FE"]]
    history_request = {"q": historical_q, "joint": "head_neck", "coordinate": "T1_head_neck_FE",
                       "axis": history_axis.tolist(), "mode": "source-joint"}
    recovered = engine.rotate({**history_request, "angleDelta": -10})
    worsened = engine.rotate({**history_request, "angleDelta": 1})
    assert recovered["rotation"]["accepted"] and recovered["rotation"]["guard"]["recovery"]
    assert not worsened["rotation"]["accepted"]
    assert worsened["q"] == ctx.normalize_q(historical_q)
    assert recovered["anatomy"]["issues"][0]["severity"] < ctx.anatomy_report(historical_q)["issues"][0]["severity"]
    invalid_inputs = [
        {"q": {}, "joint": "ulna_r", "axis": [0, 0, 0], "angleDelta": 5},
        {"q": {}, "joint": "ulna_r", "axis": [1, 0, 0], "angleDelta": True},
        {"q": {}, "joint": "ulna_r", "axis": [1, 0, 0], "angleDelta": 181},
        {"q": {}, "joint": "unknown", "axis": [1, 0, 0], "angleDelta": 5},
        {"q": {}, "joint": "ulna_r", "axis": [1, 0, 0], "angleDelta": 5,
         "mode": "source-joint", "coordinate": "hip_flexion_r"},
    ]
    for payload in invalid_inputs:
        try:
            engine.rotate(payload)
        except engine.ScenarioError:
            pass
        else:
            raise AssertionError(("malformed rotation accepted", payload))
    assert np.array_equal(model.qpos0, reference[0])
    assert np.array_equal(model.jnt_range, reference[1])
    assert np.array_equal(model.eq_data, reference[2])
    return {
        "passed": True, "sourceSha256": ctx.sha, "anchorChecksPerPose": anchor_checks,
        "independentRotationCoordinatesCovered": len(covered), "kneeAnchorOffsetM": knee_offset,
        "accepted": records, "offPlaneRejected": rejected["rotation"],
        "sourceRangeRejected": rejected_range["rotation"],
        "sourceCoordinateOwnership": source_records,
        "normalCoupledMovements": coupled_records,
        "historyRecovery": recovered["rotation"], "historyWorseningRejected": worsened["rotation"],
        "invalidInputChecks": len(invalid_inputs), "arbitraryPlane": arbitrary_plane["rotation"],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = verify()
    encoded = json.dumps(report, ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(encoded, "utf-8")
    print(encoded)
