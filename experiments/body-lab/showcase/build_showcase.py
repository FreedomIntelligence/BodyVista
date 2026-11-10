"""Build public motion cases against the frozen BodyVista model, one Windows job at a time."""
import argparse
from collections import Counter
from copy import deepcopy
from datetime import datetime, timezone
import gc
import gzip
import hashlib
import json
from pathlib import Path
import sys
import time

HERE = Path(__file__).resolve().parent
LAB = HERE.parent
REPO = LAB.parent.parent
GUARD = LAB / "candidates/library-refresh-20261106"
FIXTURES = LAB / "candidates/model-repair-20261106"
RUN = REPO / ".runtime-cache/showcase-full"
MODEL = "ms740-shoulder-hand-franko-v5"
MODEL_HASH = "d754382200ed601e74949b7d2edc1fc4b1cb29bcfa4bc22f96d21010dc631b62"
CODE_HASH = "b5db51b54385a0df803d61fc68446543e9081a93d4e8b5e11ba17ac3d1058b0d"
IDENTITY = dict(model=MODEL, modelSha256=MODEL_HASH, computationSha256=CODE_HASH)
sys.path.insert(0, str(GUARD))
from resource_guard import MIB, available_memory, run_guarded, windows_api, worker_gate


def read(path):
    return json.loads(path.read_bytes())


def raw(data):
    return json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def check(ok, message):
    if not ok:
        raise RuntimeError(message)


def prepare(spec, fixtures):
    source = fixtures[spec["fixtureSet"]]
    path = FIXTURES / source["path"]
    data = path.read_bytes()
    check(digest(data) == source["sha256"], "Fixture source changed")
    fixture = next(case for case in json.loads(data)["cases"] if case["id"] == spec["fixture"])
    scene = deepcopy(fixture["scene"])
    if "poses" in spec:
        neutral = scene["keyframes"][0]["q"]
        scene["keyframes"] = []
        for seconds, overrides in spec["poses"]:
            check(set(overrides) <= neutral.keys(), f"Unknown coordinate in {spec['id']}")
            scene["keyframes"].append({"t": seconds, "q": {**neutral, **overrides}})
    scene["model"] = MODEL
    return scene


def load_runtime():
    import importlib
    sys.path.insert(0, str(LAB.parent))
    builder = importlib.import_module("body-lab.build_motion_cache")
    solver = importlib.import_module("body-lab.fullbody_solver")
    engine, normalize, identity = builder.runtime()
    check(all(identity[k] == v for k, v in IDENTITY.items()), "Frozen model mismatch")
    check(len(identity["muscles"]) == 740 and engine.computation_fingerprint() == CODE_HASH,
          "Frozen solver mismatch")
    return builder, solver, engine, normalize, identity


def case_input(spec, definition):
    scene = prepare(spec, definition["fixtureSets"])
    return scene, digest(raw([spec, scene, IDENTITY]))


def worker(spec, definition, directory):
    builder, solver, engine, normalize, identity = load_runtime()
    scene, signature = case_input(spec, definition)
    scene = {"schema": 1, "model": MODEL, **normalize(scene)}
    result = solver.solve(scene)
    check(engine.computation_fingerprint() == CODE_HASH and digest(engine.MODEL_PATH.read_bytes()) == MODEL_HASH,
          "Frozen model changed during solve")
    result["computationSha256"] = CODE_HASH
    if not result["quantitativeValid"]:
        failure = {"id": spec["id"], "signature": signature, "metrics": result["metrics"],
                   "failures": result["failures"]}
        builder.atomic_write(directory / "failure.json", raw(failure))
        raise RuntimeError(f"{spec['id']} did not solve: {str(result['failures'])[:500]}")
    poses = [k["q"] for k in scene["keyframes"]]
    check(any(q != poses[0] for q in poses), "Static clip")
    motion = {k: spec[k] for k in ("id", "category", "label", "description", "region", "view")}
    support = {"assisted": "由骨盆支架承托", "feet": "双脚踩地承重"}[scene["support"]]
    motion["description"] += "。" + support + "。"
    # Pick a changing unit in the viewed region so visitors start on a meaningful curve.
    muscles = read(LAB / "fullbody-model-data.json")["muscles"]
    permitted = {m["name"] for m in muscles if spec["region"] in ("all", m["region"])}
    by_name = {}
    for frame in result["frames"]:
        for unit in frame["muscles"]:
            if unit["name"] in permitted:
                by_name.setdefault(unit["name"], []).append(unit["force"])
    motion["muscle"] = max(by_name, key=lambda name: max(by_name[name]) - min(by_name[name]))
    motion["scene"] = scene
    scene_bytes = (json.dumps(scene, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode()
    builder.atomic_write(directory / "scene.json", scene_bytes)
    builder.atomic_write(directory / "result.json", raw(result))
    verified = {**result["metrics"], "verified": True, "sceneFile": "scene.json",
                "resultFile": "result.json", "modelSha256": MODEL_HASH, "computationSha256": CODE_HASH}
    for kind in ("scene", "result"):
        verified[kind + "Sha256"] = digest((directory / verified[kind + "File"]).read_bytes())
    motion["verification"] = verified
    timestamp = now()
    catalog = {**IDENTITY, "schema": 1, "generatedAt": timestamp, "completedAt": timestamp,
               "status": "passed", "sourceStable": True, "motions": [motion],
               "modelSha256After": digest(engine.MODEL_PATH.read_bytes()),
               "computationSha256After": engine.computation_fingerprint()}
    builder.validate_result(catalog, motion, scene, result, identity, normalize)
    del result
    gc.collect()
    builder.atomic_write(directory / "catalog.json", raw(catalog))
    published = builder.build([directory / "catalog.json"], output=directory / "cache")
    ref = published["motions"][0]["cachedResult"]
    receipt = {"inputSha256": signature, "gzipSha256": digest(asset(directory / "cache", ref).read_bytes()),
               "manifestSha256": digest((directory / "cache/catalog.json").read_bytes())}
    builder.atomic_write(directory / "receipt.json", raw(receipt))


def asset(directory, ref):
    return directory / (ref["sha256"] + ".json.gz")


def cached(spec, definition, directory):
    path = directory / "receipt.json"
    if not path.exists():
        return False
    receipt = read(path)
    if receipt["inputSha256"] != case_input(spec, definition)[1]:
        return False
    catalog = directory / "cache/catalog.json"
    check(digest(catalog.read_bytes()) == receipt["manifestSha256"], "Cached manifest changed")
    ref = read(catalog)["motions"][0]["cachedResult"]
    check(digest(asset(directory / "cache", ref).read_bytes()) == receipt["gzipSha256"], "Cached asset changed")
    return True


def publish(definition, base):
    import importlib
    sys.path.insert(0, str(LAB.parent))
    builder = importlib.import_module("body-lab.build_motion_cache")
    target = RUN / "motion-cache"
    target.mkdir(parents=True, exist_ok=True)
    old = read(base / "catalog.json")
    check(all(old[k] == v for k, v in IDENTITY.items()), "Old library identity mismatch")
    by_id = {m["id"]: m for m in old["motions"]}
    entries = []
    generation_times = [datetime.fromisoformat(old["generatedAt"])]
    for pin in definition["originals"]:
        motion = deepcopy(by_id[pin["id"]])
        check(motion["cachedResult"]["sha256"] == pin["sha256"], "Original data changed")
        motion["category"] = pin["category"]
        entries.append((base, motion))
    for spec in definition["cases"]:
        directory = RUN / "cases" / spec["id"]
        check(cached(spec, definition, directory), f"Missing {spec['id']}")
        catalog = read(directory / "cache/catalog.json")
        generation_times.append(datetime.fromisoformat(catalog["generatedAt"]))
        entries.append((directory / "cache", catalog["motions"][0]))
    generated_at = max(generation_times).astimezone(timezone.utc).isoformat()
    manifest = {**IDENTITY, "schema": 1, "generatedAt": generated_at, "motions": []}
    report = {**IDENTITY, "schema": 1, "motions": []}
    check(len({m["id"] for _, m in entries}) == len(entries) >= 50, "Public coverage incomplete")
    for source, motion in entries:
        ref = motion["cachedResult"]
        path = asset(source, ref)
        # Gzip digest binds the full envelope, including the independently validated frames.
        payload = gzip.decompress(path.read_bytes())
        check(len(payload) == ref["bytes"] and digest(payload) == ref["sha256"] and
              path.stat().st_size == ref["compressedBytes"], "Unmatched public asset")
        del payload
        destination = target / path.name
        if path.resolve() != destination.resolve():
            builder.atomic_write(destination, path.read_bytes())
        manifest["motions"].append(motion)
        verification = motion["verification"]
        check(verification["verified"] and verification["musclesIncluded"] == 740 and
              verification["failedFrames"] == 0 and verification["allMusclesFeasible"], "Incomplete evidence")
        report["motions"].append({**{k: motion[k] for k in ("id", "label", "category")},
            "frames": verification["frames"], "complete740Frames": verification["frames"],
            "sceneSha256": verification["sceneSha256"], "resultSha256": verification["resultSha256"],
            "envelopeSha256": ref["sha256"], "gzipBytes": ref["compressedBytes"]})
    report.update(motionCount=len(entries), frames=sum(m["frames"] for m in report["motions"]),
                  compressedBytes=sum(m["gzipBytes"] for m in report["motions"]),
                  categories=dict(Counter(m["category"] for m in report["motions"])))
    for path, data in [(target / "catalog.json", manifest), (HERE / "verification.json", report)]:
        builder.atomic_write(path, (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode())
    print(json.dumps({k: v for k, v in report.items() if k != "motions"}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", action="append", help="Select one or more cases by ID")
    parser.add_argument("--worker", help=argparse.SUPPRESS)
    parser.add_argument("--base-cache", type=Path, default=LAB / "motion-cache")
    parser.add_argument("--keep-going", action="store_true", help="Continue other cases after a failed solve")
    parser.add_argument("--publish-only", action="store_true", help="Assemble the completed case receipts")
    args = parser.parse_args()
    if args.worker:
        worker_gate()
    definition = read(HERE / "scenes.json")
    specs = {s["id"]: s for s in definition["cases"]}
    check(len(specs) == len(definition["cases"]), "Duplicate case ID")
    if args.worker:
        worker(specs[args.worker], definition, RUN / "cases" / args.worker)
        return
    if args.publish_only and args.case:
        parser.error("--publish-only assembles the entire catalog")
    import msvcrt
    with (GUARD / "batch.lock").open("a+b") as lock:
        if lock.tell() == 0:
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        if args.publish_only:
            publish(definition, args.base_cache.resolve())
            return
        kernel = windows_api()
        failures = []
        for identifier in args.case or specs:
            spec = specs[identifier]
            directory = RUN / "cases" / identifier
            if cached(spec, definition, directory):
                continue
            command = [sys.executable, "-B", "-X", "utf8", "-u", str(Path(__file__)), "--worker", identifier]
            while True:
                if available_memory(kernel) < 5100 * MIB:
                    print("Waiting for memory before starting", identifier, flush=True)
                    while available_memory(kernel) < 5100 * MIB:
                        time.sleep(5)
                print("Starting", identifier, flush=True)
                try:
                    stats = run_guarded(command, RUN / "tmp", timeout=900, memory_mib=1536, free_mib=4200)
                    break
                except RuntimeError as error:
                    if "保护阈值" not in str(error) and "可用内存不足" not in str(error):
                        if not args.keep_going:
                            raise
                        failures.append(identifier)
                        directory.mkdir(parents=True, exist_ok=True)
                        (directory / "worker-error.json").write_bytes(raw({
                            "id": identifier, "time": now(), "error": str(error),
                            "inputSha256": case_input(spec, definition)[1]}))
                        print("Failed", identifier, str(error), flush=True)
                        break
                    print("Interrupted to protect the physical memory reserve.", flush=True)
                    time.sleep(10)
            if identifier in failures:
                continue
            (directory / "resources.json").write_bytes(raw(stats))
            print("Validated", identifier, round(stats["seconds"], 1), "seconds", flush=True)
        if failures:
            raise SystemExit("Cases requiring attention: " + ", ".join(failures))
        if not args.case:
            publish(definition, args.base_cache.resolve())


if __name__ == "__main__":
    main()

