"""Native whole-body constraint and continuous-drag regression."""

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
ik_tests = importlib.import_module("body-lab.verify_ik")

# Source-range-valid counterexample, discovered by a deterministic native-model
# sweep. Its upper arm enters the chest core by about 10.7 mm.
CHEST_COLLISION = {
    "elv_angle_r": 116.41566412385879,
    "shoulder_elv_r": 41.77368543231868,
    "shoulder_rot_r": 27.587525756851647,
    "elbow_flexion_r": 10.39423673108667,
}
NECK_CORNER = {"T1_head_neck_FE": 28, "T1_head_neck_LB": 17, "T1_head_neck_AR": 17}


def verify():
    ctx = engine.context()
    originals = ctx.model.qpos0.copy(), ctx.model.jnt_range.copy()
    metadata = ctx.anatomy.metadata()
    assert len(metadata["coordinates"]) == 205
    assert (
        sum(c["kind"] == "source-model-range" for c in metadata["coordinates"]) == 199
    )
    assert len(ctx.coupled) == 44
    checked = 0
    for name in ctx.names:
        lo, hi = ctx.bounds(name)
        for value in (lo - 0.001, hi + 0.001):
            try:
                ctx.normalize_q({name: value})
            except engine.ScenarioError:
                checked += 1
            else:
                raise AssertionError((name, "source range bypassed", value))
    normal = []
    for label, _, q in [
        ("standing", "pelvis", {}),
        *ik_tests.CASES,
        (
            "squat",
            "talus_r",
            {
                "hip_flexion_r": 50,
                "hip_flexion_l": 50,
                "knee_angle_r": 80,
                "knee_angle_l": 80,
            },
        ),
        (
            "open_fingers",
            "2distph",
            {
                "2mcp_abduction": 10,
                "3mcp_abduction": 5,
                "4mcp_abduction": -5,
                "5mcp_abduction": -10,
            },
        ),
    ]:
        frame = engine.pose(q)
        assert frame["anatomy"]["valid"], (label, frame["anatomy"]["issues"])
        normal.append(label)
    invalid = []
    for label, q in (
        ("chest_penetration", CHEST_COLLISION),
        ("neck_corner", NECK_CORNER),
        (
            "wrist_corner",
            {
                "flexion_r": ctx.bounds("flexion_r")[1],
                "deviation_r": ctx.bounds("deviation_r")[1],
            },
        ),
    ):
        frame = engine.pose(q)
        assert not frame["anatomy"]["valid"], label
        assert frame["q"] == ctx.normalize_q(q), "historical pose silently changed"
        assert len(frame["muscles"]) == 740
        assert all(i.get("message") for i in frame["anatomy"]["issues"])
        invalid.append({"case": label, "issues": frame["anatomy"]["issues"]})
    # Explicitly exercise the same path guard used by IK, independent of the
    # optimizer's ability to find a different non-colliding endpoint.
    handle = ik_tests.handle_for(ctx, "capitate")
    names = engine.ik_coordinates(ctx, handle)
    factors = np.array([ctx.factor[n] for n in names])
    start = np.array([ctx.defaults[n] for n in names]) / factors
    candidate_q = ctx.normalize_q(CHEST_COLLISION)
    candidate = np.array([candidate_q[n] for n in names]) / factors
    point = engine.IKPoint(ctx, ctx.defaults, handle, names)
    accepted, guard = engine.guarded_ik_step(
        ctx, point, ctx.defaults, names, factors, start, candidate
    )
    assert guard["blocked"] and not np.array_equal(candidate, accepted)
    for fraction in np.linspace(0, 1, 31):
        q = dict(ctx.defaults)
        q.update(
            zip(names, ((start + fraction * (accepted - start)) * factors).tolist())
        )
        assert ctx.anatomy_report(q)["valid"], (
            "accepted path intersects a protected core"
        )
    recovery = []
    for joint, q in (("hand_r", CHEST_COLLISION), ("head", NECK_CORNER)):
        target = engine.pose({})["joints"][joint]
        frame = engine.ik({"joint": joint, "q": q, "target": target})
        assert frame["ik"]["constraints"]["recovery"]
        assert frame["anatomy"]["valid"], (joint, "unable to recover", frame["anatomy"])
        recovery.append(joint)
    # Continue along a small screen-space path and return. Near-neighbour input
    # must not cause a remote shoulder Euler branch or an unseen collision.
    q = ctx.defaults.copy()
    origin = np.array(engine.pose(q)["joints"]["hand_r"])
    path = list(np.linspace(0, 1, 21))[1:] + list(np.linspace(1, 0, 21))[1:]
    records = []
    for fraction in path:
        target = origin + np.array([0, 0.2, -0.2]) * fraction
        begin = perf_counter()
        frame = engine.ik(
            {
                "joint": "hand_r",
                "q": q,
                "target": target.tolist(),
                "planeNormal": [-1, 0, 0],
            }
        )
        seconds = perf_counter() - begin
        delta = max(abs(frame["q"][n] - q[n]) for n in names)
        assert frame["anatomy"]["valid"], frame["anatomy"]["issues"]
        assert delta < 20, ("nearby mouse target caused a joint branch jump", delta)
        assert frame["ik"]["errorM"] < 0.003, frame["ik"]
        records.append(
            {
                "fraction": float(fraction),
                "maxCoordinateStepDeg": delta,
                "seconds": seconds,
                "errorM": frame["ik"]["errorM"],
            }
        )
        q = frame["q"]
    assert np.array_equal(ctx.model.qpos0, originals[0])
    assert np.array_equal(ctx.model.jnt_range, originals[1])
    return {
        "passed": True,
        "sourceSha256": ctx.sha,
        "rangeBoundaryChecks": checked,
        "coverage": metadata["coverage"],
        "normalPoses": normal,
        "invalidPoses": invalid,
        "blockedPath": guard,
        "recovered": recovery,
        "continuousDrag": records,
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
