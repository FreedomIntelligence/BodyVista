"""Fixed-input shoulder/hand regressions, run against the actual active model.

The fixtures are written before choosing a candidate. Failed cases remain in
the report; this is a bounded regression suite, not a population success rate.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import importlib
import json
import math
import os
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

for variable in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[variable] = "1"

HERE = Path(__file__).resolve().parent
LAB = HERE.parent.parent
sys.path.insert(0, str(LAB.parent))
E = importlib.import_module("body-lab.fullbody_engine")
S = importlib.import_module("body-lab.fullbody_solver")
G = importlib.import_module("body-lab.grasp")


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n", "utf-8")


def finger(side, digit, mcp=0, pip=0, dip=0):
    suffix = "_l" if side == "l" else ""
    return {f"{digit}{joint}_flexion{suffix}": angle
            for joint, angle in (("mcp", mcp), ("pm", pip), ("md", dip))}


def fixtures():
    ctx = E.context()
    cases = []

    def add(identifier, end, start=None, seconds=2, static=False, expected=True, **conditions):
        a = dict(ctx.defaults, **(start or {}))
        b = dict(a, **end)
        scene = {"keyframes": [{"t": 0, "q": b if static else a},
                               {"t": 0.25 if static else seconds, "q": b}],
                 "loadKg": 0, "support": "assisted", "groundEnabled": False,
                 "supportFeet": "both", "hand": "right", "strengthScale": 1,
                 "muscleScale": {}, "equipment": {"type": "none"}, **conditions}
        cases.append({"id": identifier, "static": static, "expectedFeasible": expected, "scene": scene})

    for side in "rl":
        for plane, elevation, rotation in ((90, 10, 0), (30, 45, 0), (90, 60, 0),
                                           (30, 60, -20), (30, 60, 20)):
            add(f"shoulder_{side}_hold_{plane}_{elevation}_{rotation}",
                {f"elv_angle_{side}": plane, f"shoulder_elv_{side}": elevation,
                 f"shoulder_rot_{side}": rotation}, static=True)
        add(f"shoulder_{side}_diagonal_raise", {f"elv_angle_{side}": 90, f"shoulder_elv_{side}": 30})
        add(f"shoulder_{side}_raised_sweep", {f"elv_angle_{side}": 90},
            {f"shoulder_elv_{side}": 45, f"elbow_flexion_{side}": 45})
        add(f"shoulder_{side}_raised_rotation", {f"shoulder_rot_{side}": 20},
            {f"shoulder_elv_{side}": 45, f"elv_angle_{side}": 30, f"elbow_flexion_{side}": 45}, seconds=3)
        for digit in range(2, 6):
            for angle in (0.1, 5, 30):
                add(f"finger_{side}_{digit}_pip_hold_{angle}", finger(side, digit, pip=angle), static=True)
            add(f"finger_{side}_{digit}_pip_flex", finger(side, digit, pip=30))
            add(f"finger_{side}_{digit}_dip_flex", finger(side, digit, dip=20))
        fist = {name: angle for digit in range(2, 6)
                for name, angle in finger(side, digit, 60, 70, 40).items()}
        add(f"hand_{side}_close", fist, seconds=3)
        add(f"hand_{side}_open", {name: ctx.defaults[name] for name in fist}, fist, seconds=3)
        suffix = "_l" if side == "l" else ""
        add(f"thumb_{side}_flex", {f"cmc_flexion{suffix}": 10, f"mp_flexion{suffix}": 25,
                                  f"ip_flexion{suffix}": 20}, seconds=3)
        hand = "right" if side == "r" else "left"
        conditions = {"loadKg": 1, "hand": hand, "equipment": {"type": "dumbbell"}}
        held = G.attach({"q": ctx.defaults, **conditions})
        if held["grasp"]["geometryValid"] is not True:
            raise RuntimeError("Cannot construct baseline grip: " + side)
        add(f"loaded_{side}_raise_1kg", {f"shoulder_elv_{side}": 30, f"elbow_flexion_{side}": 60},
            held["q"], seconds=3, **conditions)
    add("both_arms_and_hands", {"shoulder_elv_r": 30, "elv_angle_r": 60, "elbow_flexion_r": 60,
                                "shoulder_elv_l": 30, "elv_angle_l": 60, "elbow_flexion_l": 60,
                                **finger("r", 2, 30, 30, 20), **finger("l", 2, 30, 30, 20)}, seconds=3)
    for name, coordinate, angle in (("elbow_control", "elbow_flexion_r", 45),
                                    ("wrist_control", "flexion_r", 5),
                                    ("hip_control", "hip_flexion_r", 20),
                                    ("knee_control", "knee_angle_r", 30)):
        add(name, {coordinate: angle})
    add("negative_unsupported_hold", {}, static=True, expected=False, support="free")
    add("negative_open_hand_load", {}, static=True, expected=False, loadKg=2,
        equipment={"type": "dumbbell"})
    add("negative_foot_lifts_under_fixed_support", {"hip_flexion_r": 20},
        expected=False, support="feet", groundEnabled=True)
    return {"schema": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
            "createdWithModel": E.MODEL_ID, "scope": "Predefined normal-motion probes and explicit invalid controls; not all human motions.",
            "cases": cases}


def compact(frame):
    return {"t": frame.get("t", 0), "feasible": frame["frameFeasible"],
            "balanceErrorNm": frame["balanceErrorNm"], "nativeForceErrorN": frame["nativeForceErrorN"],
            "anatomyValid": frame["anatomy"]["valid"], "supportFeasible": frame["support"]["feasible"],
            "errors": frame["errors"], "worstResiduals": frame["recruitment"]["worstResiduals"][:3]}


def complete_branches(muscle, definitions):
    branches = muscle.get("branches", [])
    expected = definitions.get(muscle["name"], [])
    if len(branches) != len(expected):
        return False
    for branch, definition in zip(branches, expected):
        force = branch.get("force")
        coefficient = branch.get("coefficient")
        path = branch.get("path", [])
        if (branch.get("id") != definition["id"] or
                not isinstance(coefficient, (int, float)) or not math.isfinite(coefficient) or
                abs(coefficient - definition["coefficient"]) > 1e-10 or
                not isinstance(force, (int, float)) or not math.isfinite(force) or force < 0 or
                abs(force - muscle["force"] * coefficient) > 1e-7 * max(1, muscle["force"]) or
                len(path) < 2 or any(len(point) != 3 or not all(math.isfinite(v) for v in point)
                                     for point in path)):
            return False
    return not branches or branches[0]["path"] == muscle["path"]


def complete(frame, names, definitions):
    muscles = frame["muscles"]
    return (frame["quantitativeValid"] is True and len(muscles) == len(names)
            and {m["name"] for m in muscles} == names
            and all(all(isinstance(m.get(k), (int, float)) and math.isfinite(m[k]) and m[k] >= 0
                        for k in ("force", "activation", "activeCapacity", "passiveForce"))
                    and m["activation"] <= 1 and complete_branches(m, definitions) for m in muscles)
            and not frame["idealActuatorTorques"] and frame["nativeForceErrorN"] < 1e-6
            and frame["balanceErrorNm"] <= 1e-7)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fixtures", type=Path, default=HERE / "normal-motion-fixtures.json")
    parser.add_argument("--only", default="")
    parser.add_argument("--candidate", type=Path,
                        help="Validate a versioned candidate without changing the live runtime selection")
    args = parser.parse_args()
    if args.candidate:
        E.MODEL_PATH = args.candidate.resolve()
        E.MODEL_MANIFEST_PATH = E.MODEL_PATH.with_name(E.MODEL_PATH.stem + "-manifest.json")
        manifest = json.loads(E.MODEL_MANIFEST_PATH.read_text("utf-8"))
        E.MODEL_ID = S.MODEL_ID = manifest["modelId"]
        E.COMPUTATION_SHA256 = E.computation_fingerprint()
        E.context.cache_clear()
    if not args.fixtures.exists():
        write(args.fixtures, fixtures())
    definition = json.loads(args.fixtures.read_text("utf-8"))
    ctx = E.context()
    reference_names = {node.attrib["name"] for node in ET.parse(
        LAB / "candidates/runtime/expanded-knee-rotation.xml").getroot().findall("./actuator/*")}
    if len(reference_names) != 740 or ctx.model.nu != 740 or set(ctx.muscle_names) != reference_names:
        raise RuntimeError("The fixed 740 muscle identities must all be retained")
    selected = [case for case in definition["cases"] if not args.only or args.only in case["id"]]
    if not selected:
        raise ValueError("No matching test cases; an empty suite cannot pass")
    report = {"startedAt": datetime.now(timezone.utc).isoformat(), "model": E.MODEL_ID,
              "modelSha256": ctx.sha, "computationSha256": E.COMPUTATION_SHA256,
              "fixturesSha256": hashlib.sha256(args.fixtures.read_bytes()).hexdigest(),
              "expectedCaseIds": [case["id"] for case in selected], "cases": []}
    for case in selected:
        scene = S.normalize(case["scene"])
        if case["static"]:
            frame, _ = S.solve_frame(scene["keyframes"][0]["q"], {}, {}, scene)
            frames = [frame]
            valid = frame["quantitativeValid"]
        else:
            result = S.solve(scene)
            frames = result["frames"]
            valid = result["quantitativeValid"]
        row = {"id": case["id"], "expectedFeasible": case["expectedFeasible"],
               "quantitativeValid": valid, "frames": len(frames),
               "feasibleFrames": sum(f["frameFeasible"] for f in frames),
               "completeForceFrames": sum(complete(f, reference_names, ctx.tendon_branches) for f in frames),
               "forceValuesExposedOnInvalidResult": sum(
                   m.get("force") is not None or any(b.get("force") is not None for b in m.get("branches", []))
                   for f in frames for m in f["muscles"]) if not valid else 0,
               "maxResidualNm": max(f["balanceErrorNm"] for f in frames),
               "allAnatomyValid": all(f["anatomy"]["valid"] for f in frames),
               "worst": compact(max(frames, key=lambda f: f["balanceErrorNm"]))}
        row["passed"] = (valid is case["expectedFeasible"] and
                         (row["completeForceFrames"] == row["frames"] if valid
                          else row["forceValuesExposedOnInvalidResult"] == 0))
        report["cases"].append(row)
        if E.computation_fingerprint() != E.COMPUTATION_SHA256:
            raise RuntimeError("Production source changed during verification")
        write(args.output, report)
        print(json.dumps({k: row[k] for k in ("id", "quantitativeValid", "feasibleFrames", "frames", "maxResidualNm")}), flush=True)
    report["completedAt"] = datetime.now(timezone.utc).isoformat()
    report["computationSha256After"] = E.computation_fingerprint()
    report["modelSha256After"] = hashlib.sha256(E.MODEL_PATH.read_bytes()).hexdigest()
    report["fixturesSha256After"] = hashlib.sha256(args.fixtures.read_bytes()).hexdigest()
    report["sourceStable"] = (report["modelSha256After"] == report["modelSha256"] and
                              report["computationSha256After"] == report["computationSha256"] and
                              report["fixturesSha256After"] == report["fixturesSha256"])
    report["passed"] = (report["sourceStable"] and
                        [row["id"] for row in report["cases"]] == report["expectedCaseIds"] and
                        all(row["passed"] for row in report["cases"]))
    write(args.output, report)


if __name__ == "__main__":
    main()
