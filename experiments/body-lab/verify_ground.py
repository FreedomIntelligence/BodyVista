"""Ground/support regressions against the actual full-body native model."""

import argparse
import importlib
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
solver = importlib.import_module("body-lab.fullbody_solver")
grasp = importlib.import_module("body-lab.grasp")


def scene(support="seated", ground=False, q=None, load=0.0):
    return solver.normalize(
        {
            "keyframes": [{"t": 0, "q": q or {}}, {"t": 0.2, "q": q or {}}],
            "support": support,
            "groundEnabled": ground,
            "loadKg": load,
        }
    )


def frame(configured, acceleration=None):
    return solver.solve_frame(
        configured["keyframes"][0]["q"], {}, acceleration or {}, configured
    )[0]


def verify():
    ctx = solver.context()
    expected_weight = float(np.sum(ctx.model.body_mass)) * 9.81
    with_ground, without_ground = frame(scene(ground=True)), frame(scene())
    assert with_ground["quantitativeValid"] and without_ground["quantitativeValid"]
    assert with_ground["rawTorques"] == without_ground["rawTorques"]
    assert with_ground["gravity"] == without_ground["gravity"]
    assert abs(without_ground["rawTorques"]["pelvis_ty"] - expected_weight) < 1e-9
    assert without_ground["gravity"]["accelerationMps2"] == [0.0, -9.81, 0.0]
    assert abs(without_ground["gravity"]["bodyWeightN"] - expected_weight) < 1e-9

    feet = frame(scene("feet", True))
    foot_vertical_force = sum(force["force"][1] for force in feet["support"]["forces"])
    assert feet["quantitativeValid"]
    assert abs(foot_vertical_force - expected_weight) < 1e-7

    free = solver.solve(scene("free", False))
    assert free["status"] == "infeasible" and len(free["failures"]) == len(
        free["frames"]
    )
    for value in free["frames"]:
        assert not value["support"]["feasible"]
        assert value["support"]["forces"] == []
        assert (
            abs(value["support"]["baseResidual"]["pelvis_ty"] - expected_weight) < 1e-9
        )
        assert value["q"] == scene()["keyframes"][0]["q"] and value["bodies"]
        assert len(value["muscles"]) == 740
        assert all(muscle["force"] is None for muscle in value["muscles"])
    # No support is not categorically invalid: gravity-compatible acceleration
    # cancels its root force. This is one prescribed frame, not a fall simulator.
    falling = frame(scene("free", False), {"pelvis_ty": -9.81})
    assert falling["quantitativeValid"] and falling["support"]["forces"] == []
    assert (
        max(abs(value) for value in falling["support"]["baseResidual"].values()) < 1e-8
    )

    closed = grasp.attach({"q": {"elbow_flexion_r": 75}, "loadKg": 2})
    assert closed["grasp"]["geometryValid"]
    loaded = frame(scene(q=closed["q"], load=2))
    assert loaded["quantitativeValid"]
    assert (
        abs(loaded["support"]["baseResidual"]["pelvis_ty"] - expected_weight - 19.62)
        < 1e-8
    )
    assert abs(loaded["gravity"]["totalWeightN"] - expected_weight - 19.62) < 1e-8

    lowered = {"pelvis_ty": ctx.defaults["pelvis_ty"] - 0.1}
    embedded = frame(scene(ground=True, q=lowered))
    ungrounded = frame(scene(ground=False, q=lowered))
    assert not embedded["quantitativeValid"] and not embedded["groundCheck"]["feasible"]
    assert embedded["groundCheck"]["penetrationMaxM"] > 0.08
    assert ungrounded["quantitativeValid"] and not ungrounded["groundCheck"]["enabled"]

    # A horizontally oriented torso intersects the ground while both calcaneus
    # surfaces/sole stations clear it. Foot-only checking would miss this case.
    data, _ = ctx.state({"pelvis_tilt": 90, "pelvis_ty": 0.15})
    body_contact = solver.ground_check(ctx, data, {"groundEnabled": True})
    names = {item["body"] for item in body_contact["penetratingBodies"]}
    assert not body_contact["feasible"] and "thoracic7" in names
    assert "calcn_r" not in names and "calcn_l" not in names
    assert body_contact["checkedBoneMeshes"] > 100

    old = {"keyframes": [{"t": 0, "q": {}}, {"t": 0.2, "q": {}}]}
    assert not solver.normalize(old)["groundEnabled"]
    assert solver.normalize({**old, "support": "feet"})["groundEnabled"]
    for bad in (0, 1, "true", None, [], {}):
        try:
            solver.normalize({**old, "groundEnabled": bad})
        except solver.ScenarioError:
            pass
        else:
            raise AssertionError(("non-boolean ground accepted", bad))
    try:
        solver.normalize({**old, "support": "feet", "groundEnabled": False})
    except solver.ScenarioError:
        pass
    else:
        raise AssertionError("foot support accepted without ground")
    return {
        "passed": True,
        "model": solver.MODEL_ID,
        "sourceSha256": ctx.sha,
        "gravity": with_ground["gravity"],
        "groundTogglePreservesRawDynamics": True,
        "footVerticalForceN": foot_vertical_force,
        "unsupportedStatic": {
            "status": free["status"],
            "failedFrames": len(free["failures"]),
            "missingVerticalForceN": free["frames"][0]["support"]["baseResidual"][
                "pelvis_ty"
            ],
            "posesRetained": True,
            "allMuscleForcesDisabled": True,
        },
        "prescribedFreeFallFrameFeasible": falling["quantitativeValid"],
        "twoKgAddedVerticalForceN": loaded["support"]["baseResidual"]["pelvis_ty"]
        - expected_weight,
        "loweredPelvis": embedded["groundCheck"],
        "torsoOnlyPenetration": body_contact,
        "legacyMigrationAndInputChecks": True,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    encoded = json.dumps(verify(), ensure_ascii=False, allow_nan=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, "utf-8")
    print(encoded)
