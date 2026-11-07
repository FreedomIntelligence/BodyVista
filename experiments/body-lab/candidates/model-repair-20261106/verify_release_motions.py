"""Verify fixed trajectories against the selected production runtime, without HTTP or presets."""
import argparse
import hashlib
import importlib
import json
import math
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
LAB = HERE.parents[1]
SOURCES = {
    "smoke": ("fingers/adm-smoke-inputs.json","b7687923a0d20c9832bdee2660996b041580261c45bae25c0fb4ec3c20228734"),
    "extended": ("fingers/extended-hand-fixtures.json","063851e1452b09a845507f68bd74f22320667ba9adfa02b1c9559095eb27c0a6"),
    "core": ("normal-motion-fixtures.json","85366ba5323368272b9b4a092417f13c791cfe291f5aa3a0d65f2e67d679e8d2"),
    "standing": ("standing-motion-fixtures.json","de3687f84a63c212d9361f667677abb413e0530f59e28b24ec47fd8ac1e87309"),
    "custom": ("fingers/franko-native-candidate/custom-motion-inputs.json","90d16350e77827d2014ca14f2df5159f9333c7ce60ecc1ed71165e7590a6e50c"),
}


def audit_case(case, suite, ctx, solver, complete):
    scene = solver.normalize(case["scene"])
    expected = case.get("expectedFeasible",True)
    segment_matches = True
    if suite == "smoke":
        q,v,a = solver.sample(scene,case["t"])
        frames = [solver.solve_frame(q,v,a,scene)[0]]
    elif case.get("static"):
        frames = [solver.solve_frame(scene["keyframes"][0]["q"],{},{},scene)[0]]
    else:
        result = solver.solve(scene)
        frames = result["frames"]
        segment_matches = (result["quantitativeValid"] is expected
            and result["status"] == ("solved" if expected else "infeasible")
            and result["metrics"]["frames"] == len(frames)
            and [f["t"] for f in frames] == solver.frame_times(scene))
    def full(frame):
        if not complete(frame,set(ctx.muscle_names),ctx.tendon_branches):
            return False
        for key in ("rawTorques","torques","muscleTorques","jointPassiveTorques","passiveTorques","reserveTorques"):
            if set(frame[key]) != set(ctx.names) or not all(map(math.isfinite,frame[key].values())):
                return False
        sup=frame["support"]
        if not sup["feasible"] or len(sup["baseResidual"]) != 6 or not all(map(math.isfinite,sup["baseResidual"].values())):
            return False
        if sup["mode"]=="feet" and not sup["forces"]:
            return False
        for contact in sup["forces"]:
            if len(contact["force"]) != 3 or not all(map(math.isfinite,contact["force"])):
                return False
        if scene["loadKg"] and scene["equipment"]["type"]=="dumbbell":
            contacts=frame["grasp"]["contacts"]
            if not contacts or any(c.get("forceOnObject") is None or len(c["forceOnObject"])!=3 or
                not all(map(math.isfinite,[*c["forceOnObject"],c["normalN"],c["frictionMarginN"]])) for c in contacts):
                return False
        return True
    completed=sum(full(f) for f in frames)
    valid=sum(f["frameFeasible"] for f in frames)
    withheld=all(f.get("muscleTorques") is None and all(m[k] is None for m in f["muscles"]
        for k in ("force","activation","activeCapacity","passiveForce"))
        and all(b.get("force") is None for m in f["muscles"] for b in m.get("branches",[]))
        and all(c.get(k) is None for c in f.get("grasp",{}).get("contacts",[])
                for k in ("forceOnObject","normalN","frictionMarginN")) for f in frames
                if not expected or not f["quantitativeValid"])
    worst=max(frames,key=lambda f:f["balanceErrorNm"])
    return {"id":case["id"],"expectedFeasible":expected,"frames":len(frames),"feasibleFrames":valid,
        "complete740Frames":completed,"invalidValuesWithheld":withheld,
        "maxInternalResidualNm":worst["balanceErrorNm"],"maxNativeErrorN":max(f["nativeForceErrorN"] for f in frames),
        "worstErrors":worst["errors"],"segmentMatches":segment_matches,"passed":len(frames)>0 and segment_matches
        and all(f["quantitativeValid"] is expected and f["muscleValid"] is expected for f in frames)
        and (completed==len(frames)==valid if expected else valid<len(frames) and completed==0 and withheld)}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite",choices=SOURCES,required=True)
    parser.add_argument("--first",type=int,default=0)
    parser.add_argument("--count",type=int)
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    path,pin=SOURCES[args.suite]
    binary=(HERE/path).read_bytes()
    if hashlib.sha256(binary).hexdigest()!=pin:
        raise ValueError("Changed fixed motion inputs")
    fixture=json.loads(binary)
    cases=fixture if isinstance(fixture,list) else fixture["cases"]
    chosen=cases[args.first:None if args.count is None else args.first+args.count]
    if args.first<0 or not chosen or (args.count is not None and len(chosen)!=args.count):
        raise ValueError("Empty or out of range")
    sys.path.insert(0,str(LAB.parent))
    from verify_normal_motions import complete
    e,s=[importlib.import_module("body-lab."+name) for name in ("fullbody_engine","fullbody_solver")]
    ctx=e.context()
    if ctx.model.nu!=740 or len(set(ctx.muscle_names))!=740:
        raise RuntimeError("740 distinct muscles required")
    result={"model":e.MODEL_ID,"modelSha256":ctx.sha,"computationSha256":e.COMPUTATION_SHA256,
        "suite":args.suite,"fixtureSha256":pin,"cases":[],"passed":False}
    args.output.parent.mkdir(exist_ok=True,parents=True)
    if args.output.exists():
        raise ValueError("Choose a new report path")
    for case in chosen:
        row=audit_case(case,args.suite,ctx,s,complete)
        result["cases"].append(row)
        print(f'{args.suite} {row["id"]}: {row["complete740Frames"]}/{row["frames"]} {row["passed"]}',flush=True)
        args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False),encoding="utf8")
    result["passed"]=all(r["passed"] for r in result["cases"]) and e.computation_fingerprint()==result["computationSha256"]
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False),encoding="utf8")
    return int(not result["passed"])


if __name__=="__main__":
    raise SystemExit(main())
