"""Recompute the original 11 cases serially, behind Windows resource limits.

No physics or interpolation parameters are changed. Each case is calculated,
fully checked and compressed in a fresh child process. Publication is explicit.
"""

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import time

from resource_guard import run_guarded, worker_gate

HERE = Path(__file__).resolve().parent
LAB = HERE.parent.parent
REPO = LAB.parent.parent
PYTHON = Path(sys.executable)
READY = LAB / "candidates/model-repair-20261106/model-ready-for-library.json"
SOURCE_CATALOGS = tuple(LAB / "candidates" / name / "catalog.json" for name in
                        ("verified-motions-20261103", "dumbbell-motions-20261103"))
CASE_IDS = ("elbow", "arm_raise", "neck", "thumb", "finger_spread", "knee_rotation",
            "knee_extension", "dumbbell_curl_2kg", "dumbbell_left_curl_1kg",
            "dumbbell_bilateral_2kg", "dumbbell_forearm_halfkg")
IDENTITY_KEYS = ("model", "modelSha256", "computationSha256")
SOURCE_NAMES = ("fullbody_engine.py", "fullbody_solver.py", "grasp.py",
                "anatomy_constraints.py", "model_mechanics.py", "hand_mechanics.py", "franko_transmission.py", "native_worker.py",
                "passive_series.py", "build_motion_cache.py")


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def read(path):
    return json.loads(Path(path).read_text("utf-8"))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode("utf-8")
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(raw)
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def ready_identity(path, expected_sha=None):
    raw = Path(path).read_bytes()
    if expected_sha:
        require(hashlib.sha256(raw).hexdigest() == expected_sha,
                "模型就绪记录发生变化，停止本轮；请核实后重新启动。")
    marker = json.loads(raw)
    require(marker.get("ready") is True, "模型尚未冻结并通过验证，未启动任何案例计算。")
    identity = {"model": marker.get("model", marker.get("MODEL_ID")),
                **{key: marker.get(key) for key in IDENTITY_KEYS[1:]}}
    require(all(isinstance(value, str) and value for value in identity.values()), "模型就绪记录缺少身份。")
    return identity


def original_cases():
    cases = {}
    for source in SOURCE_CATALOGS:
        catalog_raw = source.read_bytes()
        catalog_sha = hashlib.sha256(catalog_raw).hexdigest()
        catalog = json.loads(catalog_raw)
        for motion in catalog["motions"]:
            identifier = motion["id"]
            require(identifier in CASE_IDS and identifier not in cases, "原动作目录含未知或重复案例。")
            evidence = motion["verification"]
            name = evidence["sceneFile"]
            require(isinstance(name, str) and Path(name).name == name and "/" not in name and "\\" not in name,
                    "原场景路径必须在证据目录内。")
            scene_path = source.parent / name
            require(scene_path.resolve().parent == source.parent.resolve(), "原场景链接越出证据目录。")
            scene_raw = scene_path.read_bytes()
            require(hashlib.sha256(scene_raw).hexdigest() == evidence["sceneSha256"],
                    "原场景文件与原验证哈希不一致。")
            cases[identifier] = (source, motion, scene_path, scene_raw, catalog_sha)
        require(sha(source) == catalog_sha, "读取原动作目录时文件发生变化。")
    require(set(cases) == set(CASE_IDS), "原动作库没有完整的 11 个固定案例。")
    return cases


def snapshot(paths):
    return {str(Path(path).resolve()): sha(path) for path in paths}


def check_snapshot(expected):
    require(all(Path(path).is_file() and sha(path) == digest for path, digest in expected.items()),
            "模型、求解或验证源码、原场景在本轮期间变化，拒绝继续或发布。")


def load_runtime(ready_path, ready_sha):
    expected = ready_identity(ready_path, ready_sha)
    code_paths = [LAB / name for name in SOURCE_NAMES] + [Path(__file__), HERE / "resource_guard.py"]
    before = snapshot(code_paths)
    sys.path.insert(0, str(LAB.parent))
    engine = importlib.import_module("body-lab.fullbody_engine")
    builder = importlib.import_module("body-lab.build_motion_cache")
    solver = importlib.import_module("body-lab.fullbody_solver")
    check_snapshot(before)
    model_before = snapshot([engine.MODEL_PATH, engine.MODEL_MANIFEST_PATH])
    _, normalize, identity = builder.runtime()
    check_snapshot(before | model_before)
    require({key: identity[key] for key in IDENTITY_KEYS} == expected,
            "活动模型与就绪声明不一致；没有使用旧缓存替换新结果。")
    require(engine.computation_fingerprint() == identity["computationSha256"], "导入期间计算版本变化。")
    require(sha(engine.MODEL_PATH) == identity["modelSha256"], "加载的模型与磁盘不同。")
    return engine, solver, builder, normalize, identity, before | model_before


def case_worker(args):
    worker_gate()
    engine, solver, builder, normalize, identity, source_snapshot = load_runtime(args.ready, args.ready_sha)
    all_cases = original_cases()
    source, old_motion, old_scene_path, scene_raw, catalog_sha = all_cases[args.worker]
    for row in all_cases.values():
        source_snapshot[str(row[0].resolve())] = row[4]
        source_snapshot[str(row[2].resolve())] = row[1]["verification"]["sceneSha256"]
    check_snapshot(source_snapshot)
    output = args.run / args.worker
    output.mkdir(parents=True, exist_ok=True)
    scene = json.loads(scene_raw)
    scene["model"] = identity["model"]
    receipt_path = output / "receipt.json"
    catalog_path = output / "catalog.json"
    identity_fields = {key: identity[key] for key in IDENTITY_KEYS}
    if receipt_path.exists():
        receipt = read(receipt_path)
        require(receipt.get("sourceSnapshot") == source_snapshot and
                receipt.get("identity") == identity_fields, "已有案例的版本不同；请使用新的运行目录。")
        check_snapshot(receipt["artifacts"])
        catalog = read(catalog_path)
        motion = catalog["motions"][0]
        result = builder.load_json((output / "result.json").read_bytes())
        require(normalize(read(output / "scene.json")) == normalize(scene), "续算的原场景不一致。")
        builder.validate_result(catalog, motion, scene, result, identity, normalize)
        print(json.dumps({"id": args.worker, "resumed": True, "frames": len(result["frames"])}), flush=True)
    else:
        catalog = {**identity_fields, "schema": 1, "generatedAt": now(), "status": "running",
                   "sourceStable": False, "sourceCatalog": str(source), "sourceCatalogSha256": catalog_sha}
        actual_solve_frame = solver.solve_frame
        unique = 0

        def paced_frame(*arguments, **keywords):
            nonlocal unique
            if unique % 10 == 0:
                check_snapshot(source_snapshot)
                ready_identity(args.ready, args.ready_sha)
            began = time.perf_counter()
            frame = actual_solve_frame(*arguments, **keywords)
            # Pace only wall time; scene times, derivatives, force parameters and
            # solver initial values pass through unchanged.
            elapsed = time.perf_counter() - began
            time.sleep(elapsed * 1.5)  # At most 40% duty on the one allowed CPU.
            unique += 1
            if unique % 10 == 0:
                print(json.dumps({"id": args.worker, "solvedUniqueFrames": unique}), flush=True)
            return frame

        solver.solve_frame = paced_frame
        try:
            result = solver.solve(scene)
        finally:
            solver.solve_frame = actual_solve_frame
        check_snapshot(source_snapshot)
        ready_identity(args.ready, args.ready_sha)
        require(engine.computation_fingerprint() == identity["computationSha256"], "求解期间计算版本变化。")
        result["computationSha256"] = identity["computationSha256"]
        if result.get("quantitativeValid") is not True:
            builder.atomic_write(output / ("failed-" + str(time.time_ns()) + ".json"),
                                 json.dumps(result, ensure_ascii=False, allow_nan=False,
                                            separators=(",", ":")).encode("utf-8"))
            raise RuntimeError(f"{args.worker} 未整段通过；失败证据已保留，未发布。")
        motion = deepcopy(old_motion)
        motion.pop("cachedResult", None)
        motion["scene"] = scene
        motion["verification"] = {**result["metrics"], "verified": True,
                                   "sceneFile": "scene.json", "resultFile": "result.json",
                                   "previousSceneSha256": old_motion["verification"]["sceneSha256"],
                                   **{key: identity[key] for key in IDENTITY_KEYS[1:]}}
        write(output / "scene.json", scene)
        builder.atomic_write(output / "result.json", json.dumps(
            result, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8"))
        for kind in ("scene", "result"):
            motion["verification"][kind + "Sha256"] = sha(output / (kind + ".json"))
        catalog.update(status="passed", sourceStable=True, completedAt=now(), motions=[motion],
                       modelSha256After=sha(engine.MODEL_PATH),
                       computationSha256After=engine.computation_fingerprint())
        builder.validate_result(catalog, motion, scene, result, identity, normalize)
        write(catalog_path, catalog)
        print(json.dumps({"id": args.worker, "valid": True, "frames": len(result["frames"])}), flush=True)
    # Release the decoded result before the publisher reads and checks it again.
    del result
    stage = output / "cache"
    published = builder.build([catalog_path], output=stage)
    check_snapshot(source_snapshot)
    ready_identity(args.ready, args.ready_sha)
    asset = stage / (published["motions"][0]["cachedResult"]["sha256"] + ".json.gz")
    write(receipt_path, {"identity": identity_fields, "sourceSnapshot": source_snapshot,
                         "validatedAt": now(), "artifacts": snapshot([
                             output / "scene.json", output / "result.json", catalog_path,
                             stage / "catalog.json", asset])})


def assemble(run, identity, ready_path, ready_sha, *, publish=False):
    """Copy only already checked assets; never decode all 803 frames together."""
    merged = {**identity, "schema": 1, "generatedAt": now(), "motions": []}
    stable = {}
    assets = []
    for identifier in CASE_IDS:
        case = run / identifier
        receipt = read(case / "receipt.json")
        require(receipt["identity"] == identity, "案例模型版本不一致。")
        check_snapshot(receipt["sourceSnapshot"])
        check_snapshot(receipt["artifacts"])
        require(not stable or stable == receipt["sourceSnapshot"], "案例源码快照不一致。")
        stable = receipt["sourceSnapshot"]
        catalog = read(case / "cache/catalog.json")
        require({key: catalog[key] for key in IDENTITY_KEYS} == identity and len(catalog["motions"]) == 1,
                "已验证缓存的目录身份不一致。")
        motion = catalog["motions"][0]
        require(motion["id"] == identifier, "已验证缓存的案例 ID 不一致。")
        merged["motions"].append(motion)
        asset = case / "cache" / (motion["cachedResult"]["sha256"] + ".json.gz")
        assets.append((asset, receipt["artifacts"][str(asset.resolve())]))
    require(sum(row["verification"]["frames"] for row in merged["motions"]) == 803,
            "完整动作库必须包含原有 803 个采样帧。")
    target = LAB / "motion-cache" if publish else run / "staged"
    target.mkdir(parents=True, exist_ok=True)
    if publish and (target / "catalog.json").exists() and not (run / "previous-catalog.json").exists():
        shutil.copyfile(target / "catalog.json", run / "previous-catalog.json")
    for asset, expected_asset_sha in assets:
        ready_identity(ready_path, ready_sha)
        check_snapshot(stable)
        destination = target / asset.name
        if destination.exists():
            require(sha(destination) == expected_asset_sha, "同名缓存内容不同，拒绝覆盖。")
        else:
            # Hash-addressed assets precede the catalog; a cancelled copy is never
            # referenced by the active catalog. Replace via a local temporary.
            temporary = target / (asset.name + ".copying")
            shutil.copyfile(asset, temporary)
            require(sha(temporary) == expected_asset_sha, "缓存复制校验失败。")
            os.replace(temporary, destination)
    ready_identity(ready_path, ready_sha)
    check_snapshot(stable)
    write(target / "catalog.json", merged)
    print(json.dumps({"status": "published" if publish else "staged", "motions": 11,
                      "frames": 803, "catalog": str(target / "catalog.json")}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--case", choices=CASE_IDS)
    group.add_argument("--all", action="store_true")
    group.add_argument("--publish", action="store_true", help="Revalidate all cases, then publish atomically")
    group.add_argument("--worker", choices=CASE_IDS, help=argparse.SUPPRESS)
    parser.add_argument("--ready", type=Path, default=READY)
    parser.add_argument("--run", type=Path, help="Defaults to a version-specific directory")
    parser.add_argument("--timeout", type=int, default=900, help="Per-case wall-time cap, including validation")
    parser.add_argument("--ready-sha", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.worker:
        case_worker(args)
        return
    require(args.timeout > 0, "案例时间限制必须大于零。")
    identity = ready_identity(args.ready)
    ready_sha = sha(args.ready)
    version = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()[:16]
    run = (args.run or HERE / "runs" / version).resolve()
    require(run.drive.lower() == "d:", "运行产物和临时文件必须在 D 盘。")
    original_cases()
    run.mkdir(parents=True, exist_ok=True)
    # The shared lock excludes batches even when they use different run directories.
    # An interrupted Python
    # process releases its Windows file lock automatically, including hard exits.
    import msvcrt
    with (HERE / "batch.lock").open("a+b") as lock:
        lock.seek(0)
        if not lock.read(1):
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        selected = (args.case,) if args.case else CASE_IDS
        for identifier in selected:
            ready_identity(args.ready, ready_sha)
            if args.publish:
                require((run / identifier / "receipt.json").is_file(), "发布前缺少完整计算证据；先运行 --all。")
            print(json.dumps({"starting": identifier, "cases": len(selected)}), flush=True)
            stats = run_guarded([str(PYTHON), "-B", "-X", "utf8", "-u", str(Path(__file__).resolve()),
                                 "--worker", identifier, "--ready", str(args.ready.resolve()),
                                 "--ready-sha", ready_sha, "--run", str(run)], run / "tmp", timeout=args.timeout)
            write(run / identifier / "resources.json", stats)
            print(json.dumps({"finished": identifier, **stats}), flush=True)
            time.sleep(1)
        if not args.case:
            assemble(run, identity, args.ready, ready_sha, publish=args.publish)
        else:
            print(json.dumps({"pilot": args.case, "run": str(run)}), flush=True)


if __name__ == "__main__":
    main()
