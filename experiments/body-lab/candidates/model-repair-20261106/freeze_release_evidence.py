"""Freeze existing v5 evidence for library recomputation and local release acceptance."""
import argparse
import hashlib
import json
import os
import re
import struct
import sys
import tempfile
import zlib
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from verify_release_motions import SOURCES

HERE = Path(__file__).resolve().parent
LAB = HERE.parents[1]
ROOT = LAB.parents[1]
sys.path.insert(0, str(LAB))
import prepare_release_bundle as pack
from make_release_spec import runtime_selection
from setup_release_assets import AssetSetupError

MARKER = HERE / "model-ready-for-library.json"
UI = LAB / "fullbody-ui-validation.json"
MODEL = "ms740-shoulder-hand-franko-v5"
COMPUTATION = "b5db51b54385a0df803d61fc68446543e9081a93d4e8b5e11ba17ac3d1058b0d"
VERIFIER = "6968302f2e5dd3fbb54cee73bdb3b50731a9fc1a9e406f27365db20678b8e3f6"
NATIVE_CHECKS = {
    "native-coverage", "tendon-jacobian-finite-difference", "gravity-potential-finite-difference",
    "native-inverse-dynamics", "native-muscle-force-bounds", "regional-native-posture-response",
    "left-hand-source-mirror", "independent-static-feasibility", "derived-hand-length-ranges",
    "production-dynamic-load", "production-controlled-load", "production-reject-and-retain-pose",
    "production-physical-shoulder-damping", "production-tendon-branch-forces", "production-hand-passive-mechanics",
    "independent-hybrid-static-feasibility", "production-effective-tendon-transmission", "production-fds-series-passive-law",
}
BROWSER_CHECKS = {
    "v5_actual_anatomical_surface": "actual-anatomical-surface",
    "imported_custom_motion_real_solve": "custom-motion-solved",
    "changing_hand_branch_forces": "hand-tendon-branch-forces",
    "hand_passive_terms_reported_separately": "hand-passive-torques",
    "edit_invalidates_old_branch_forces": "edited-branch-values-cleared",
    "fixed_case_reads_cache_without_solve": "fixed-case-cache",
    "v3_pose_migration_preserves_knee_and_old_storage": "v3-knee-scene-restored",
    "no_unhandled_browser_errors": None,
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    record = {"path": path.resolve().relative_to(ROOT).as_posix()}
    data = path.read_bytes()
    record["sha256"] = digest(data)
    return json.loads(data), record


def matches(row, identity):
    return all(row.get(k) == v for k, v in identity.items())


def encoded(doc):
    return (json.dumps(doc, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()


def write_atomic(path, doc, replace=False):
    raw = encoded(doc)
    if path.exists() and path.read_bytes() == raw:
        return
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        tmp = Path(handle.name)
        handle.write(raw)
    try:
        if replace:
            os.replace(tmp, path)
        else:
            try:
                os.link(tmp, path)
            except FileExistsError:
                require(path.read_bytes() == raw, f"已有不同的证据文件，请核对：{path.name}")
    finally:
        tmp.unlink(missing_ok=True)


def frozen_model():
    model, manifest, modules = runtime_selection((LAB / "fullbody_engine.py").read_text("utf-8"))
    declaration, manifest_file = load(ROOT / manifest)
    fingerprint = hashlib.sha256()
    for name in modules:
        fingerprint.update(name.encode() + b"\0" + (LAB / name).read_bytes() + b"\0")
    fingerprint.update(b"model-manifest-sha256\0" + bytes.fromhex(manifest_file["sha256"]) + b"\0")
    identity = {"model": MODEL, "modelSha256": digest((ROOT / model).read_bytes()), "computationSha256": COMPUTATION}
    require(fingerprint.hexdigest() == COMPUTATION and declaration["modelId"] == MODEL
            and declaration["derivedSha256"] == identity["modelSha256"] and declaration["transmissionStatus"] == "selected",
            "当前计算源码、活动 XML 或模型声明偏离冻结版本")
    return identity, manifest_file


def suites(identity):
    require(digest((HERE / "verify_release_motions.py").read_bytes()) == VERIFIER, "运动验收脚本已变化")
    directory = HERE / "validation-v5/release" / (COMPUTATION[:16] + "-" + VERIFIER[:10])
    evidence, count, positive_frames = {}, 0, 0
    for name, (fixture_path, pin) in SOURCES.items():
        fixture, source = load(HERE / fixture_path)
        cases = fixture if isinstance(fixture, list) else fixture["cases"]
        report, file = load(directory / (name + ".json"))
        rows = report["cases"]
        require(source["sha256"] == pin == report["fixtureSha256"] and matches(report, identity) and
                report["verificationSha256"] == VERIFIER and report["suite"] == name and report["passed"] is True
                and len(cases) == len(rows) and rows, f"动作组未完成或身份不符：{name}")
        for case, row in zip(cases, rows, strict=True):
            expected = case.get("expectedFeasible", True)
            n = row["frames"]
            require(row["id"] == case["id"] and row["expectedFeasible"] is expected and row["passed"] is True
                    and row["segmentMatches"] is True and row["invalidValuesWithheld"] is True
                    and type(n) is int and n > 0, f"动作判定或帧数不符：{row['id']}")
            require((row["complete740Frames"] == row["feasibleFrames"] == n) if expected else
                    (row["complete740Frames"] == 0 and row["feasibleFrames"] < n), f"力值覆盖不符：{row['id']}")
            positive_frames += n if expected else 0
        count += len(rows)
        evidence[name] = {**file, "fixture": source, "cases": len(rows)}
    require((count, positive_frames) == (115, 2036), "冻结输入的 115 个案例或 2036 个阳性帧未齐")
    return {"suites": evidence, "caseCount": count, "positiveFramesWith740Forces": positive_frames}


def model_evidence():
    identity, manifest = frozen_model()
    native, native_file = load(LAB / "fullbody-validation.json")
    coverage, coverage_file = load(LAB / "fullbody-coverage.json")
    provenance = {**identity, "modelManifestSha256": manifest["sha256"],
                  "verificationCodeSha256": digest((LAB / "fullbody_verify.py").read_bytes())}
    checks = native["checks"]
    require(matches(native, provenance) and matches(coverage, provenance) and native["status"] == "passed"
            and NATIVE_CHECKS <= {c["id"] for c in checks} and all(c["status"] == "passed" for c in checks)
            and len(coverage["muscles"]) == len({m["id"] for m in coverage["muscles"]}) == 740,
            "同版原生检查或 740 肌腱覆盖报告未通过")
    atlas, atlas_file = load(HERE / "atlas-compatibility.json")
    declaration, _ = load(LAB / "atlas-muscles.json")
    require(atlas["passed"] is True and atlas["modelSha256"] == identity["modelSha256"]
            and atlas["atlasBinarySha256"] == declaration["binarySha256"] and atlas["checks"]
            and all(v is True for v in atlas["checks"].values()), "图谱兼容验证未通过")
    return {**identity, "ready": True, "publicationValidated": False, "modelManifest": manifest,
            "nativeValidation": native_file, "coverage": coverage_file, "atlasCompatibility": atlas_file,
            **suites(identity)}


def model_ready(doc):
    if MARKER.exists():
        prior, _ = load(MARKER)
        if prior.get("publicationValidated") is True:
            require(all(prior.get(k) == v for k, v in doc.items() if k != "publicationValidated"),
                    "已有正式标记的数值证据与当前来源不同")
            return
    write_atomic(MARKER, doc)


def stamp(text):
    value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    require(value.utcoffset() is not None, "浏览器记录缺少时间区域")
    return value


def screenshot(raw_dir, filename):
    require(isinstance(filename, str) and re.fullmatch(r"[A-Za-z0-9-]+\.png", filename),
            "截图路径不是同目录的 PNG")
    path = (raw_dir / filename).resolve()
    require(path.parent == raw_dir.resolve(), "截图越出报告目录")
    data = path.read_bytes()
    require(data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) > 45, "截图不是有效 PNG")
    offset, chunks = 8, []
    while offset < len(data):
        require(len(data) - offset >= 12, "PNG 数据截断")
        length, kind = struct.unpack_from(">I4s", data, offset)
        end = offset + 12 + length
        require(end <= len(data), "PNG 数据截断")
        payload = data[offset+8:end-4]
        require(zlib.crc32(kind + payload) == int.from_bytes(data[end-4:end], "big"), "PNG 校验和不符")
        if not chunks:
            require(kind == b"IHDR" and length == 13, "PNG 缺少尺寸声明")
            width, height = struct.unpack_from(">II", payload)
            require(width >= 1600 and height >= 1050, "截图小于正式浏览器的 1600 × 1050 视口")
        if kind == b"IEND":
            require(length == 0 and end == len(data), "PNG 结束标记无效")
        chunks.append(kind)
        offset = end
    require(b"IDAT" in chunks and chunks[-1] == b"IEND", "PNG 缺少实际图像或结束标记")
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(data)}


def browser_evidence(path, identity):
    raw, source = load(path)
    model = {"id": identity["model"], "sourceSha256": identity["modelSha256"],
             "computationSha256": identity["computationSha256"]}
    require(raw.get("status") == "passed" and raw.get("candidatePreview") is False
            and raw.get("fixedCacheValidated") is True and raw.get("pageErrors") == []
            and raw.get("model") == model and raw.get("expectedModel") == MODEL, "网页不是同版正式通过记录")
    script = HERE / "browser-check.mjs"
    require(raw["scriptSha256"] == digest(script.read_bytes()) and raw["fixtureSha256"] == SOURCES["custom"][1],
            "浏览器脚本或自定义输入指纹不同")
    fixtures, _ = load(HERE / SOURCES["custom"][0])
    require(raw["fixtureId"] in {case["id"] for case in fixtures["cases"]}, "自定义动作不在冻结输入内")
    page = urlsplit(raw["pageUrl"])
    require(page.hostname in {"127.0.0.1", "localhost", "::1"} and page.path == "/experiments/body-lab/",
            "网页证据不是本机全身工作台")
    checks = raw["checks"]
    require([c["name"] for c in checks] == list(BROWSER_CHECKS) and all(c["passed"] is True for c in checks),
            "缺少正式浏览器八项依次通过的记录")
    times = [stamp(raw["startedAt"]), *(stamp(c["at"]) for c in checks), stamp(raw["completedAt"])]
    require(times == sorted(times), "网页验收时间顺序无效")
    indexed = {c["name"]: c for c in checks}
    shots = raw["screenshots"]
    provided = {s["name"]: s["file"] for s in shots}
    require(len(shots) == len(provided) == 7 and set(provided) == set(BROWSER_CHECKS.values()) - {None}
            and len(set(provided.values())) == 7, "网页七张截图不全或重复")
    records = {}
    for name, label in BROWSER_CHECKS.items():
        if label:
            require(indexed[name]["screenshot"] == provided[label], "检查与其截图不对应")
            records[label] = screenshot(path.parent, provided[label])
    require(len({record["sha256"] for record in records.values()}) == len(records),
            "不同页面检查重复使用了相同截图")
    solve = indexed["imported_custom_motion_real_solve"]
    fixed = indexed["fixed_case_reads_cache_without_solve"]
    require(solve["frames"] > 0 and solve["musclesPerFrame"] == 740 and solve["solveRequests"] == 1
            and matches(fixed, identity) and fixed["cacheRequests"] == 1 and fixed["solveRequests"] == 0
            and checks[-1]["count"] == 0, "自定义求解、固定缓存或异常记录不符")
    cache_url = urlsplit(fixed["cacheUrl"])
    require(cache_url.scheme == page.scheme and cache_url.netloc == page.netloc and
            re.fullmatch(r"/experiments/body-lab/motion-cache/[a-f0-9]{64}\.json", cache_url.path),
            "固定案例未读取本机内容寻址缓存")
    network = raw["network"]
    before, after = stamp(indexed["edit_invalidates_old_branch_forces"]["at"]), stamp(fixed["at"])
    during = [event for event in network if before < stamp(event["at"]) <= after]
    require(all(e["method"] != "POST" for e in during) and
            sum(e["method"] == "GET" and e["path"] == cache_url.path for e in during) == 1 and
            sum(e["method"] == "POST" and e["path"] == "/api/fullbody/solve" for e in network) == 1,
            "固定案例须实际读取一次缓存且不发 POST，自定义整段须有一次真实求解")
    return {**identity, "modelId": identity["model"], "status": "passed", "candidatePreview": False,
            "fixedCacheValidated": True, "completedAt": raw["completedAt"], "browserEvidence": source,
            "fixtureId": raw["fixtureId"], "checks": list(BROWSER_CHECKS), "screenshots": records,
            "fixedCase": {"id": fixed["caseId"], "cacheSha256": Path(cache_url.path).stem, "postRequests": 0}}


def release_cache(identity, fixed_case):
    model, manifest, _ = runtime_selection((LAB / "fullbody_engine.py").read_text("utf-8"))
    inputs = {name: pack.file_record(ROOT, name) for name in (manifest, pack.COVERAGE)}
    contract = pack.force_contract(ROOT, {"modelXml": model, "modelManifest": manifest}, inputs, identity)
    files = pack.library_files(ROOT, identity, contract)
    catalog = pack.same_json(ROOT, files[0])
    motion = next((row for row in catalog["motions"] if row["id"] == fixed_case["id"]), None)
    require(motion is not None and motion["cachedResult"]["sha256"] == fixed_case["cacheSha256"],
            "浏览器使用的案例与正式动作目录不匹配")
    return {"catalog": files[0], "cases": len(catalog["motions"]), "frames": pack.FRAME_COUNT}


def web_ready(doc, path):
    prior, _ = load(MARKER)
    require(all(prior.get(k) == v for k, v in doc.items() if k != "publicationValidated"),
            "模型就绪记录与当前数值证据不匹配")
    identity = {k: doc[k] for k in ("model", "modelSha256", "computationSha256")}
    ui = browser_evidence(path.resolve(), identity)
    ui["motionLibrary"] = release_cache(identity, ui["fixedCase"])
    write_atomic(UI, ui)
    final = {**doc, "publicationValidated": True, "uiValidation": load(UI)[1],
             "scope": "本机正式网页和固定动作库已验收；此记录不表示已推送或已创建在线 Release。"}
    if prior.get("publicationValidated") is True:
        require(prior == final, "已有正式验收标记属于另一份网页报告")
    write_atomic(MARKER, final, replace=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--model-ready", action="store_true")
    action.add_argument("--web", type=Path, metavar="BROWSER_JSON")
    args = parser.parse_args()
    try:
        doc = model_evidence()
        if args.model_ready:
            model_ready(doc)
        else:
            web_ready(doc, args.web)
            print(UI.relative_to(ROOT).as_posix())
        print(MARKER.relative_to(ROOT).as_posix())
    except (ValueError, KeyError, TypeError, OSError, struct.error, AssetSetupError) as error:
        print(f"验收证据未冻结：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
