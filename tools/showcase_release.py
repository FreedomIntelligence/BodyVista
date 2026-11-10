"""Pack and verify the expanded replay catalog against its frozen v1.1.0 model."""

import argparse
import gzip
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAB = Path("experiments/body-lab")
sys.path.insert(0, str(ROOT / LAB))
import prepare_release_bundle as pack
import setup_release_assets as release

BASE_TAG = "v1.1.0"
BASE_SHA256 = "56a52cc1835f83ffa009ecfb566314ae96398feff235eba1a2a836e2bc3c12dc"
TAG = "v1.3.0"
LOCK = ROOT / "tools/pages-assets" / f"showcase-{TAG}.json"
PREVIOUS_LOCK = LOCK.with_name("showcase-v1.2.0.json")
PREFIX = release.ZIP_PREFIXES["motion-cache"]
CATALOG = PREFIX + "catalog.json"
MODEL_FILE = (LAB / "fullbody-model-data.json").as_posix()
BROWSER_CASE_LIMIT = 64 * 1024 * 1024   # motion-cache.js / MAX_CASE_BYTES


def base_manifest():
    path = LOCK.parent / (BASE_TAG + "-assets.json")
    if hashlib.sha256(path.read_bytes()).hexdigest() != BASE_SHA256:
        raise ValueError("基础模型的发行清单已变化")
    return release.load_manifest(path)


def base_install_manifest(base):
    # The model, its sources, companion data and licenses retain their original
    # bytes. The tagged source checkout supplies the new player and HTTP server.
    data_suffixes = {".bin", ".json", ".xml", ".osim", ".txt"}
    numerical_modules = {
        "fullbody_engine.py", "fullbody_solver.py", "grasp.py", "anatomy_constraints.py",
        "model_mechanics.py", "hand_mechanics.py", "native_worker.py", "franko_transmission.py",
        "passive_series.py", "native_bridge.py", "engine.py", "solver.py", "pose_dynamics.py",
    }
    licenses = {"LICENSE", "THIRD_PARTY_NOTICES.md", "experiments/body-lab/ASSET_ATTRIBUTION.md"}
    required = [item for item in base["requiredFiles"] if Path(item["path"]).suffix in data_suffixes
                or Path(item["path"]).name in numerical_modules or item["path"] in licenses]
    return {**base, "requiredFiles": required,
            "assets": [asset for asset in base["assets"] if asset["role"] != "motion-cache"]}


def validate_lock(lock, base, root=ROOT):
    asset = lock["asset"]
    if (lock["releaseTag"] != TAG or lock["baseManifestSha256"] != BASE_SHA256
            or asset["role"] != "motion-cache" or asset["name"] != f"bodyvista-motion-cache-{TAG}.zip"
            or lock["modelData"]["path"] != MODEL_FILE):
        raise ValueError("动作库的标签、模型或资源名不匹配")
    manifest = {**base, "releaseTag": TAG, "requiredFiles": [lock["modelData"]], "assets": [asset]}
    release.validate_manifest(manifest)
    if not release._matches(root / MODEL_FILE, lock["modelData"]):
        raise ValueError("缺少此动作库配套的人体模型信息")
    model = release._load_json(root / MODEL_FILE, 8 * 1024 * 1024)
    if (model["id"], model["sourceSha256"], model["computationSha256"]) != (
        base["modelId"], base["modelSha256"], base["computationSha256"]
    ):
        raise ValueError("动作数据和模型信息使用不同的模型或计算源码")
    old_asset = release._load_json(PREVIOUS_LOCK)["asset"]
    files = {record["path"]: record for record in asset["files"]}
    for record in old_asset["files"]:
        if record["path"] != CATALOG and files.get(record["path"]) != record:
            raise ValueError("旧版动作的压缩数据与已发布的文件不同")
    return asset


def catalog_summary(catalog):
    groups = set()
    payloads = set()
    frames = 0
    motions = catalog["motions"]
    for motion in motions:
        verification = motion["verification"]
        count = verification["frames"]
        group = motion.get("category")
        if (not isinstance(group, str) or not group.strip() or type(count) is not int or count < 2
                or verification.get("verified") is not True or verification.get("failedFrames") != 0
                or verification.get("allMusclesFeasible") is not True or verification.get("musclesIncluded") != 740
                or any(verification.get(k) != catalog[k] for k in ("modelSha256", "computationSha256"))):
            raise ValueError(f"动作缺少分类或同版的完整核验：{motion['id']}")
        payload = motion["cachedResult"]["sha256"]
        if payload in payloads:
            raise ValueError(f"动作重复引用了其他案例的结果：{motion['id']}")
        payloads.add(payload)
        groups.add(group)
        frames += count
    if len(motions) != 100 or len(groups) != 7:
        raise ValueError("本版动作库应包含 7 类共 100 个已核验动作")
    return {"cases": len(motions), "frames": frames, "categories": sorted(groups)}


def verify_payload(path, cached):
    expected_size = cached["bytes"]
    if type(expected_size) is not int or not 0 < expected_size <= BROWSER_CASE_LIMIT:
        raise ValueError("解压后的动作长度超过播放器的 64 MiB 限制")
    digest = hashlib.sha256()
    size = 0
    with gzip.open(path, "rb") as source:
        while chunk := source.read(min(1024 * 1024, expected_size - size + 1)):
            size += len(chunk)
            if size > expected_size:
                raise ValueError(f"动作解压超过声明长度：{path.name}")
            digest.update(chunk)
    if size != expected_size or digest.hexdigest() != cached["sha256"]:
        raise ValueError(f"动作内容哈希或解压长度不符：{path.name}")


def verify_index(lock, base, members):
    asset = lock["asset"]
    release._check_index(asset, members, base)
    catalog = release._load_json(members[CATALOG], 8 * 1024 * 1024)
    if catalog_summary(catalog) != lock["summary"]:
        raise ValueError("目录中的案例、分类或帧数与正式清单不符")
    return catalog


def verify_members(lock, base, members):
    catalog = verify_index(lock, base, members)
    for motion in catalog["motions"]:
        cached = motion["cachedResult"]
        verify_payload(members[PREFIX + cached["sha256"] + ".json.gz"], cached)
    return catalog


def checked_archive(bundle_dir, asset):
    path = bundle_dir / asset["name"]
    record = {"path": asset["name"], "bytes": asset["bytes"], "sha256": asset["sha256"]}
    if not release._matches(path, record):
        raise FileNotFoundError(path)
    return path


def unpack_checked(bundle_dir, stage, lock, base):
    asset = lock["asset"]
    path = checked_archive(bundle_dir, asset)
    members = release._unpack(asset, path, stage)
    catalog = verify_members(lock, base, members)
    return members, catalog


def build(cache, output):
    base = base_manifest()
    cache = release._directory(cache)
    catalog = release._load_json(cache / "catalog.json", 8 * 1024 * 1024)
    summary = catalog_summary(catalog)
    names = ["catalog.json"]
    for motion in catalog["motions"]:
        digest = release._digest(motion["cachedResult"]["sha256"], "动作哈希")
        names.append(digest + ".json.gz")
    output = release._directory(output, create=True)
    with tempfile.TemporaryDirectory(prefix="pack-", dir=output) as temp:
        stage = Path(temp)
        installed = stage / PREFIX
        installed.mkdir(parents=True)
        records = []
        for name in sorted(set(names)):
            # Snapshot the selected catalog and only its referenced results.
            record = pack.file_record(cache, name)
            with (cache / name).open("rb") as source:
                release._write_checked(source, installed / name, record)
            records.append({**record, "path": PREFIX + name})
        asset = pack.materialize(stage, stage, "motion-cache", TAG, records)
        lock = {"releaseTag": TAG, "baseManifestSha256": BASE_SHA256,
                "modelData": pack.file_record(ROOT, MODEL_FILE), "summary": summary, "asset": asset}
        validate_lock(lock, base)
        catalog = verify_index(lock, base, {r["path"]: stage / r["path"] for r in records})
        identity = {"model": base["modelId"], "modelSha256": base["modelSha256"],
                    "computationSha256": base["computationSha256"]}
        spec = {"modelXml": f"{LAB.as_posix()}/candidates/runtime/expanded-motion-repair.xml",
                "modelManifest": f"{LAB.as_posix()}/candidates/runtime/expanded-motion-repair-v5-manifest.json"}
        source_files = {r["path"]: r for r in base["requiredFiles"]}
        if not release._matches(ROOT / spec["modelXml"], source_files[spec["modelXml"]]):
            raise FileNotFoundError(spec["modelXml"])
        contract = pack.force_contract(ROOT, spec, source_files, identity)
        for motion in catalog["motions"]:
            if motion["cachedResult"]["bytes"] > BROWSER_CASE_LIMIT:
                raise ValueError(f"动作超过播放器的 64 MiB 限制：{motion['id']}")
            pack.verified_motion(stage, identity, contract, motion)
        (stage / LOCK.name).write_bytes((json.dumps(lock, ensure_ascii=False, indent=2) + "\n").encode())
        # Detect conflicts before creating either output. Linking keeps each new
        # file atomic; a retry can finish an interrupted pair without replacement.
        missing = []
        for name in (asset["name"], LOCK.name):
            target = output / name
            record = pack.file_record(stage, name)
            if not release._matches(target, record):
                missing.append((name, target, record))
        for name, target, record in missing:
            try:
                os.link(stage / name, target)
            except FileExistsError:
                if not release._matches(target, record):
                    raise
    return {"archive": str(output / asset["name"]), "manifest": str(output / LOCK.name),
            "bytes": asset["bytes"], "sha256": asset["sha256"], **summary}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", required=True, type=Path, help="合并后的 catalog.json 和 gzip 所在目录")
    parser.add_argument("--output", required=True, type=Path, help="保存可重复生成的 ZIP 和发行清单")
    args = parser.parse_args()
    print(json.dumps(build(args.cache, args.output), ensure_ascii=False))
