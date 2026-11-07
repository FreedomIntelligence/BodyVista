"""Prepare the four pinned BodyVista Release assets locally, without loading a model."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import posixpath
import re
import stat
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
import zlib
from datetime import datetime
from pathlib import Path

import build_motion_cache as cache_builder
import setup_release_assets as install

LAB = install.LAB
READY = LAB + "candidates/model-repair-20261106/model-ready-for-library.json"
VALIDATION = LAB + "fullbody-validation.json"
COVERAGE = LAB + "fullbody-coverage.json"
UI_VALIDATION = LAB + "fullbody-ui-validation.json"
SOURCE = install.ZIP_PREFIXES["ms-human-source"] + "SOURCE_MANIFEST.json"
CATALOG = install.ZIP_PREFIXES["motion-cache"] + "catalog.json"
SOURCE_COMMIT = "98a70c569c4c1b6da467a20012f766ee1f8dc521"
SOURCE_INDEX_SHA = "398c7173af58e726098997c1c3c483c809d952337399cb26a0be1cda990dc5f8"
ATLAS_SHA = "645df971115568a0e24b47aec6cac88daa6c8eb2c94b01ba83e481fa51fa7d5a"
ATLAS_LICENSE_SHA = "9304fab639baf94d709b0b68a173b0302b18d6c0e64dabfd8e258b76a2636942"
# Same audited UTF-8 license with LF in place of the original file's 35 CRLFs.
ATLAS_LICENSE_LF_SHA = "af62c06f620b9da20138e4c22a3f56565482dd058266540994ace97a4e24b693"
SOURCE_COUNT = 251
CASE_IDS = {"elbow", "arm_raise", "neck", "thumb", "finger_spread", "knee_rotation",
            "knee_extension", "dumbbell_curl_2kg", "dumbbell_left_curl_1kg",
            "dumbbell_bilateral_2kg", "dumbbell_forearm_halfkg"}
FRAME_COUNT = 803
BASE_FILES = {"LICENSE", "THIRD_PARTY_NOTICES.md", LAB + "ASSET_ATTRIBUTION.md",
              LAB + "RELEASE_ASSETS.md", LAB + "setup_release_assets.py", LAB + "prepare_release_bundle.py",
              LAB + "geometry/fullbody-bones.json", LAB + "geometry/bone-volumes.json",
              LAB + "atlas-muscles.json", LAB + "build_motion_cache.py", VALIDATION, COVERAGE, UI_VALIDATION}
SPEC_FIELDS = {"releaseTag", "sourceCommit", "modelXml", "modelManifest", "computationFiles",
               "requiredFiles", "atlasLicense"}


def require(value, message):
    if not value:
        raise install.AssetSetupError(message)


def listed_paths(paths, label):
    require(isinstance(paths, list) and 0 < len(paths) <= 1000, f"{label} 需要逐文件清单")
    for name in paths:
        install._relative_path(name)
    require(len(paths) == len({name.casefold() for name in paths}), f"{label} 中的路径重复")
    return paths


def file_record(root, name, sink=None):
    """Stream the same bytes to the hash and optional destination; reject source changes."""
    path = root / install._relative_path(name)
    install._directory(path.parent)
    before = path.lstat()
    install._reject_link(before, path)
    size = before.st_size
    require(stat.S_ISREG(before.st_mode) and 0 < size <= install.MAX_ASSET_BYTES,
            f"来源不是允许大小的普通文件：{name}")
    digest = hashlib.sha256()
    count = 0
    with path.open("rb") as source:
        opened = os.fstat(source.fileno())
        require(install._identity(before, opened=True) == install._identity(opened, opened=True),
                f"打开文件时来源变化：{name}")
        while chunk := source.read(install.CHUNK_BYTES):
            count += len(chunk)
            require(count <= size, f"来源增长：{name}")
            digest.update(chunk)
            if sink is not None:
                sink.write(chunk)
        require(install._identity(opened) == install._identity(os.fstat(source.fileno())),
                f"读取期间来源变化：{name}")
    require(count == size and install._identity(before) == install._identity(path.lstat()),
            f"读取期间来源变化：{name}")
    return {"path": name, "bytes": size, "sha256": digest.hexdigest()}


def same_json(root, item, limit=8 * 1024 * 1024):
    data = install._load_json(root / item["path"], limit)
    require(install._matches(root / item["path"], item), "读取后清单与原快照不同")
    require(isinstance(data, dict), "需要 JSON 对象")
    return data


def git_required(root, commit, records, *, portable_text=False):
    """Check required checkout files against ordinary blobs in the stated Git commit."""
    def git(*args):
        return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE)

    require(git("rev-parse", "--verify", commit + "^{commit}").decode().strip() == commit,
            "指定 Git 提交不存在")
    portable = {}
    for name, record in records.items():
        entry = git("ls-tree", "-z", commit, "--", name).rstrip(b"\0")
        header, separator, blob_path = entry.partition(b"\t")
        fields = header.split()
        require(separator and blob_path.decode("utf-8") == name and len(fields) == 3
                and fields[0] in (b"100644", b"100755") and fields[1] == b"blob",
                f"同版 Git 提交中缺少普通文件：{name}")
        blob = git("hash-object", "--", name).strip()
        require(blob == fields[2], f"工作文件与声明的 Git 提交不同：{name}")
        attributes = git("check-attr", "-z", "filter", "--", name).split(b"\0")
        require(len(attributes) == 4 and attributes[2] in (b"unspecified", b"unset"),
                f"Git 前置文件使用外部过滤器，不能保证离线检出：{name}")
        checkout = git("-c", "core.autocrlf=false", "cat-file", "--filters", "--path=" + name,
                       fields[2].decode("ascii"))
        portable[name] = {"path": name, "bytes": len(checkout), "sha256": hashlib.sha256(checkout).hexdigest()}
        if portable[name] != record:
            ordinary_text = name in {"LICENSE", "README.md", "README.zh-CN.md", "THIRD_PARTY_NOTICES.md"} or (
                name.startswith(("src/vendor/", "assets/detail/")) and name.endswith(".js"))
            require(portable_text and ordinary_text,
                    f"清洁检出字节与打包输入不同，请核对换行和已提交的 .gitattributes：{name}")
            work = (root / name).read_bytes()
            require(hashlib.sha256(work).hexdigest() == record["sha256"] and
                    work.replace(b"\r\n", b"\n") == checkout.replace(b"\r\n", b"\n"),
                    f"工作文件变化或与可移植检出存在非换行差异：{name}")
    return portable


def checked_spec(spec):
    require(isinstance(spec, dict) and set(spec) == SPEC_FIELDS, "打包规格字段不完整或含未知字段")
    tag, commit = spec["releaseTag"], spec["sourceCommit"]
    require(isinstance(tag, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", tag)
            and tag.lower() not in {"latest", "draft", "todo", "tbd"}, "需要固定发行标签")
    install._relative_path(tag)
    require(isinstance(commit, str) and re.fullmatch(r"[0-9a-f]{40}", commit), "需要完整 Git 提交号")
    names = set(listed_paths(spec["requiredFiles"], "requiredFiles"))
    code = listed_paths(spec["computationFiles"], "computationFiles")
    for key in ("modelXml", "modelManifest", "atlasLicense"):
        install._relative_path(spec[key])
    mandatory = BASE_FILES | {spec[k] for k in ("modelXml", "modelManifest", "atlasLicense")}
    mandatory.update(LAB + name for name in code)
    require(mandatory <= names, "requiredFiles 缺少模型、计算源码、许可或显示配套文件")
    return sorted(names)


def final_identity(root, spec, required):
    marker_record = file_record(root, READY)
    marker = same_json(root, marker_record)
    require(marker.get("ready") is True and marker.get("publicationValidated") is True,
            "最终模型尚未 ready 或缺少明确的 publicationValidated:true")
    model = marker.get("model", marker.get("MODEL_ID"))
    require(isinstance(model, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", model), "模型身份无效")
    identity = {"model": model, **{key: install._digest(marker.get(key), key)
                                   for key in ("modelSha256", "computationSha256")}}
    candidate = marker.get("candidate")
    gates = [marker]
    if isinstance(candidate, dict) and all(candidate.get(k) == v for k, v in identity.items()):
        gates.append(candidate)
    require(all(row.get("publicationValidated") is not False and row.get("revalidationRequired") is not True
                for row in gates), "就绪记录仍要求重新验证或标明当前模型尚未通过发布验收")
    model_file, model_declaration = required[spec["modelXml"]], required[spec["modelManifest"]]
    declaration = same_json(root, model_declaration)
    require(model_file["sha256"] == declaration.get("derivedSha256") == identity["modelSha256"],
            "活动 XML、派生清单与就绪记录的模型哈希不同")
    parent = Path(model_file["path"]).parent
    if "baseModelManifest" in declaration or identity["model"] == "ms740-shoulder-hand-franko-v5":
        check_selected_transmission(root, declaration, identity, spec, parent, required)
    for field in ("derivedFrom", "derivedFromManifest"):
        name = (parent / install._relative_path(declaration.get(field))).as_posix()
        require(name in required and required[name]["sha256"] == declaration.get(field + "Sha256"),
                f"缺少匹配的模型父文件：{field}")
    require(declaration.get("sourceManifestSha256") == SOURCE_INDEX_SHA and
            (root / parent / declaration["sourceManifest"]).resolve() == (root / SOURCE).resolve(),
            "活动派生清单必须指向已审核的来源清单")
    computation = hashlib.sha256()
    for name in spec["computationFiles"]:
        computation.update(name.encode() + b"\0")
        item = required[LAB + name]
        require(item["bytes"] <= 8 * 1024 * 1024, "计算源码大小超出打包器限制")
        code = (root / item["path"]).read_bytes()
        require(hashlib.sha256(code).hexdigest() == item["sha256"], "计算源码发生变化")
        computation.update(code + b"\0")
    computation.update(b"model-manifest-sha256\0" + bytes.fromhex(model_declaration["sha256"]) + b"\0")
    require(computation.hexdigest() == identity["computationSha256"], "实际计算代码与就绪版本不同")
    report = same_json(root, required[VALIDATION])
    require(report.get("status") == "passed" and all(report.get(k) == v for k, v in identity.items()),
            "正式全身验证报告未通过或身份不一致")
    ui = same_json(root, required[UI_VALIDATION])
    reported_ids = [ui[key] for key in ("model", "modelId") if key in ui]
    require(reported_ids and all(v == model for v in reported_ids)
            and all(ui.get(k) == identity[k] for k in ("modelSha256", "computationSha256"))
            and ui.get("status") == "passed" and ui.get("candidatePreview") is False
            and ui.get("fixedCacheValidated") is True and isinstance(ui.get("completedAt"), str),
            "正式网页缓存验收缺失、未通过、属于预览或不是当前模型")
    try:
        completed = datetime.fromisoformat(ui["completedAt"].replace("Z", "+00:00"))
    except ValueError:
        raise install.AssetSetupError("正式网页缓存验收的完成时间无效") from None
    require(completed.utcoffset() is not None, "网页验收完成时间缺少时区")
    return identity, marker_record


def check_selected_transmission(root, declaration, identity, spec, parent, required):
    """Check the runtime's v5 inheritance and selected module without importing it."""
    base = declaration.get("baseModelManifest")
    require(isinstance(base, dict) and set(base) == {"file", "sha256"},
            "手指传动缺少固定的 v4 基础清单")
    base_name = (parent / install._relative_path(base["file"])).as_posix()
    require(base_name in required and required[base_name]["sha256"] == base["sha256"],
            "v4 基础清单缺失或哈希不同")
    require(declaration.get("modelId") == identity["model"] and declaration.get("transmissionStatus") == "selected"
            and isinstance(declaration.get("effectiveTendonTransmission"), dict)
            and declaration["effectiveTendonTransmission"], "活动清单尚未选择有效的手指传动")
    series = declaration["effectiveTendonTransmission"].get("passiveSeries")
    require(isinstance(series, dict), "选择的手指传动缺少 FDS 被动串联声明")
    names = series.get("muscles")
    expected_fds = {stem + side for stem in ("FDSI", "FDSM", "FDSR", "FDSL") for side in ("", "_l")}
    require(isinstance(names, list) and len(names) == len(expected_fds) and set(names) == expected_fds
            and series.get("model") == "thelen-fds-passive-series-v1"
            and series.get("tendonStrainAtFmax") == 0.04 and series.get("tendonToeForceFraction") == 0.33
            and series.get("tendonToeShape") == 3 and series.get("fibreStrainAtFmax") == 0.6
            and series.get("fibreShape") == 5 and series.get("slackLength") == "effective-length-offset-from-validated-lengthrange",
            "FDS 串联模型的八个具名单元、肌腱或纤维参数与本版声明不同")
    for module, declared_hash in (("franko_transmission.py", declaration.get("transmissionModuleSha256")),
                                  ("passive_series.py", series.get("moduleSha256"))):
        require(module in spec["computationFiles"] and LAB + module in required and
                install._digest(declared_hash, module) == required[LAB + module]["sha256"],
                f"实际 {module} 字节、清单哈希或计算指纹成员不符")
    inherited = same_json(root, required[base_name])
    allowed = {"modelId", "baseModelManifest", "transmissionStatus", "transmissionModuleSha256",
               "effectiveTendonTransmission"}
    require({k: v for k, v in inherited.items() if k not in allowed} ==
            {k: v for k, v in declaration.items() if k not in allowed},
            "v5 清单改变了已冻结 v4 基础模型的其他声明")


def approved_source(root):
    index_item = file_record(root, SOURCE)
    require(index_item["sha256"] == SOURCE_INDEX_SHA, "MS-Human 来源清单与已审核版本不同")
    index = same_json(root, index_item)
    rows = index.get("files")
    require(index.get("repository") == "google-deepmind/mujoco_menagerie" and
            index.get("commit") == SOURCE_COMMIT and index.get("license") == "Apache-2.0" and
            isinstance(rows, list) and len(rows) == SOURCE_COUNT, "来源、许可或文件数不符")
    result = [index_item]
    for row in rows:
        item = {k: row[k] for k in ("path", "bytes", "sha256")}
        install._file_spec(item)
        item["path"] = install.ZIP_PREFIXES["ms-human-source"] + item["path"]
        result.append(item)
    require(install.ZIP_PREFIXES["ms-human-source"] + "LICENSE" in {r["path"] for r in result},
            "来源包缺少上游许可")
    return result


def check_model_meshes(root, model_xml, available):
    """Resolve the meshes referenced by the flat derived XML, including compiler meshdir."""
    xml = ET.parse(root / model_xml).getroot()
    compiler = xml.find("compiler")
    settings = {} if compiler is None else compiler.attrib
    meshdir = settings.get("meshdir", settings.get("assetdir", ""))
    strip_path = settings.get("strippath", "false").lower() == "true"
    for mesh in xml.findall(".//asset/mesh[@file]"):
        name = mesh.attrib["file"].replace("\\", "/")
        if strip_path:
            name = posixpath.basename(name)
        path = posixpath.normpath(posixpath.join(posixpath.dirname(model_xml), meshdir, name))
        require(install._relative_path(path) in available, f"活动 XML 的网格未列入安装闭包：{path}")


def force_contract(root, spec, required, identity):
    """Obtain expected muscle/coordinate names independently of any cached frame."""
    xml = ET.parse(root / spec["modelXml"]).getroot()
    actuator_names = [n.get("name") for n in xml.findall("actuator/*")]
    joint_names = [n.get("name") for n in xml.findall(".//worldbody//joint")]
    constrained = {n.get("joint1") for n in xml.findall("equality/joint")}
    coordinates = set(joint_names) - constrained
    manifest = same_json(root, required[spec["modelManifest"]])
    require(all(isinstance(n, str) and n for n in actuator_names + joint_names)
            and len(actuator_names) == len(set(actuator_names)) == manifest.get("muscleCount") == 740
            and len(joint_names) == len(set(joint_names)) and constrained <= set(joint_names)
            and len(coordinates) == manifest.get("independentCoordinates"), "XML 肌腱或独立坐标身份不完整")
    coverage = same_json(root, required[COVERAGE])
    rows = coverage.get("muscles")
    require(all(coverage.get(k) == v for k, v in identity.items())
            and coverage.get("independentCoordinatesIncludingRoot") == len(coordinates)
            and isinstance(rows, list) and len(rows) == len(actuator_names)
            and all(isinstance(row, dict) for row in rows) and {row.get("id") for row in rows} == set(actuator_names),
            "覆盖报告与最终 XML 的身份或肌腱集合不同")
    branches = manifest.get("tendonBranches", {})
    require(isinstance(branches, dict) and branches.keys() <= set(actuator_names), "模型分支声明的肌腱无效")
    hand_rows = manifest.get("handElasticity", {}).get("referenceCorrection", {}).get("coordinates", [])
    hands = {r["coordinate"] for r in hand_rows}
    require(len(hands) == len(hand_rows) and hands <= coordinates, "模型手部参考坐标无效")
    return {"muscles": set(actuator_names), "coordinates": coordinates, "branches": branches,
            "internal": {n for n in coordinates if not n.startswith("pelvis_")}, "handReferenceCoordinates": hands}


def verified_motion(root, identity, force_model, motion):
    metadata, cached = motion["verification"], motion["cachedResult"]
    require(metadata.get("verified") is True and all(metadata.get(k) == identity[k] for k in
            ("modelSha256", "computationSha256")), "动作验证版本与就绪记录不符")
    sha = install._digest(cached["sha256"], "动作 SHA")
    size = cached["bytes"]
    require(type(size) is int and 0 < size <= install.MAX_ASSET_BYTES and
            cached["url"] == f"./motion-cache/{sha}.json", "动作缓存声明不合法")
    name = install.ZIP_PREFIXES["motion-cache"] + sha + ".json.gz"
    item = file_record(root, name)
    require(type(cached.get("compressedBytes")) is int and item["bytes"] == cached["compressedBytes"],
            "动作压缩字节数不符")
    with gzip.open(root / name, "rb") as stream:
        raw = stream.read(size + 1)
    require(len(raw) == size and hashlib.sha256(raw).hexdigest() == sha, "动作解压字节／哈希不符")
    envelope = json.loads(raw)
    require(type(envelope.get("schema")) is int and envelope["schema"] == 1 and
            all(envelope.get(k) == v for k, v in identity.items()) and
            envelope.get("scene") == motion["scene"] and motion["scene"].get("model") == identity["model"],
            "动作信封的模型、版本或场景不同")
    scene_bytes = (json.dumps(envelope["scene"], ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode()
    require(hashlib.sha256(scene_bytes).hexdigest() == metadata.get("sceneSha256"),
            "场景与最终验证时的场景字节不同")
    result = envelope["result"]
    digest = hashlib.sha256(json.dumps(result, ensure_ascii=False, allow_nan=False,
                                       separators=(",", ":")).encode()).hexdigest()
    require(digest == metadata.get("resultSha256"), "结果与最终验证时的结果字节不同")
    frames, summary = result["frames"], result["metrics"]
    scene, solved_scene = envelope["scene"], result.get("scene")
    require(isinstance(solved_scene, dict) and cache_builder.finite(scene.get("loadKg"))
            and scene["loadKg"] >= 0 and solved_scene.get("loadKg") == scene["loadKg"]
            and solved_scene.get("preview") is False and not scene.get("preview"),
            "动作负重、预览状态与实际求解条件不同")
    require(result.get("model") == identity["model"] and result.get("computationSha256") ==
            identity["computationSha256"] and result.get("status") == "solved" and
            result.get("kinematicOnly") is False and result.get("quantitativeValid") is True and
            result.get("failures") == [] and summary.get("failedFrames") == 0 and
            summary.get("allMusclesFeasible") is True and summary.get("musclesIncluded") == 740 and
            isinstance(frames, list) and len(frames) >= 2 and
            len(frames) == summary.get("frames") == metadata.get("frames"),
            "动作库含未完成、失败或不完整的力结果")
    last_t = -1
    for frame in frames:
        try:
            cache_builder.validate_force_frame(frame, force_model, scene["loadKg"])
        except (TypeError, KeyError, AttributeError, ValueError) as exc:
            raise install.AssetSetupError(f"{motion['id']} 帧受力检查失败：{exc}") from None
        t, q = frame.get("t"), frame.get("q")
        require(cache_builder.finite(t) and t > last_t and isinstance(q, dict) and
                set(q) == force_model["coordinates"] and all(cache_builder.finite(v) for v in q.values()),
                "动作帧的时间或姿势不完整")
        last_t = t
    require(frames[0]["t"] == 0 and last_t == scene["keyframes"][-1]["t"] == summary.get("durationSeconds"),
            "动作起止时间不同")
    return item, len(frames)


def library_files(root, identity, force_model):
    item = file_record(root, CATALOG)
    catalog = same_json(root, item)
    motions = catalog.get("motions")
    require(type(catalog.get("schema")) is int and catalog["schema"] == 1 and
            all(catalog.get(k) == v for k, v in identity.items()) and isinstance(motions, list) and
            len(motions) == len(CASE_IDS) and {m["id"] for m in motions} == CASE_IDS,
            "正式动作目录案例或模型版本不完整")
    files, total = [item], 0
    for motion in motions:
        entry, count = verified_motion(root, identity, force_model, motion)
        files.append(entry)
        total += count
    require(total == FRAME_COUNT, "正式动作库的总帧数与验收输入不同")
    return files


def display_files(root, required, spec):
    bone = same_json(root, required[LAB + "geometry/bone-volumes.json"])
    atlas = same_json(root, required[LAB + "atlas-muscles.json"])
    require(bone.get("sourceGeometrySha256") == required[LAB + "geometry/fullbody-bones.json"]["sha256"]
            and atlas.get("boneVolumeBinarySha256") == bone.get("binarySha256"), "显示资源配对哈希不符")
    require(required[spec["atlasLicense"]]["sha256"] in (ATLAS_LICENSE_SHA, ATLAS_LICENSE_LF_SHA) and
            atlas.get("binarySha256") == ATLAS_SHA and atlas.get("surfaceCount") == 460,
            "图谱二进制、许可或表面数量与已审选集不同")
    return {role: [{"path": install.RAW_TARGETS[role], "bytes": declaration["byteLength"],
                    "sha256": declaration["binarySha256"]}]
            for role, declaration in (("bone-volumes", bone), ("atlas-muscles", atlas))}


def materialize(root, output, role, tag, files):
    files = sorted(files, key=lambda item: item["path"])
    for item in files:
        install._file_spec(item)
    require(sum(item["bytes"] for item in files) <= install.MAX_ASSET_BYTES,
            "资源成员总量超出安装器的单包上限")
    fmt = "raw" if role in install.RAW_TARGETS else "zip"
    name = (f"bodyvista-ms-human-700-{SOURCE_COMMIT[:12]}.zip" if role == "ms-human-source" else
            f"bodyvista-{role}-{tag}." + ("bin" if fmt == "raw" else "zip"))
    path = output / name
    if fmt == "raw":
        with path.open("xb") as dest:
            require(file_record(root, files[0]["path"], dest) == files[0], "原始二进制不匹配")
    else:
        with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_STORED, allowZip64=False) as bundle:
            for item in files:
                info = zipfile.ZipInfo(item["path"], date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                with bundle.open(info, "w") as dest:
                    require(file_record(root, item["path"], dest) == item, "ZIP 成员与冻结记录不符")
        paths = {item["path"] for item in files}
        install._preflight_zip(path, paths, set())
    package = file_record(output, name)
    return {"role": role, "name": name, "format": fmt, "files": files,
            "bytes": package["bytes"], "sha256": package["sha256"],
            "url": f"https://github.com/{install.REPOSITORY}/releases/download/{tag}/{name}"}


def prepare(spec, root=install.REPO):
    names = checked_spec(spec)
    root = install._directory(root)
    # A held or stale model must fail before hashing the large inputs or creating output.
    ready = file_record(root, READY)
    marker = same_json(root, ready)
    require(marker.get("ready") is True and marker.get("publicationValidated") is True,
            "最终模型尚未 ready 或缺少明确的 publicationValidated:true")
    required = {name: file_record(root, name) for name in names}
    portable = git_required(root, spec["sourceCommit"], required, portable_text=True)
    identity, marker_record = final_identity(root, spec, required)
    require(marker_record == ready, "就绪记录在准备期间变化")
    groups = display_files(root, required, spec)
    groups["ms-human-source"] = approved_source(root)
    check_model_meshes(root, spec["modelXml"], set(required) | {item["path"] for item in groups["ms-human-source"]})
    groups["motion-cache"] = library_files(root, identity, force_contract(root, spec, required, identity))
    tag = spec["releaseTag"]
    parent = install._directory(root / ".runtime-cache" / "release-bundles", create=True)
    final = parent / tag
    require(not os.path.lexists(final), "目标标签目录已存在，请保留已有产物并检查其清单")
    with tempfile.TemporaryDirectory(prefix="packing-", dir=parent) as staging:
        output = Path(staging) / "bundle"
        output.mkdir()
        assets = [materialize(root, output, role, tag, files) for role, files in groups.items()]
        manifest = {"schema": 1, "repository": install.REPOSITORY, "releaseTag": tag,
                    "sourceCommit": spec["sourceCommit"], "modelId": identity["model"],
                    "modelSha256": identity["modelSha256"], "computationSha256": identity["computationSha256"],
                    "requiredFiles": list(portable.values()), "assets": assets}
        install.validate_manifest(manifest)
        for asset in assets:
            paths = {row["path"]: root / row["path"] for row in asset["files"]}
            install._check_index(asset, paths, manifest)
        with (output / "release-assets.json").open("xb") as dest:
            dest.write((json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode())
        install.load_manifest(output / "release-assets.json")
        require(all(install._matches(root / row["path"], row) for row in
                    [*required.values(), ready, groups["motion-cache"][0], groups["ms-human-source"][0]]),
                "完成前有冻结输入变化")
        require(not os.path.lexists(final), "标签目标在准备期间已由另一进程创建")
        os.rename(output, final)
    return final


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, required=True, help="本地 JSON 规格（精确 Git 文件/模型清单）")
    parser.add_argument("--root", type=Path, default=install.REPO)
    args = parser.parse_args()
    try:
        output = prepare(install._load_json(args.spec), args.root)
    except (install.AssetSetupError, OSError, ValueError, KeyError, TypeError, EOFError, ET.ParseError,
            subprocess.SubprocessError, zipfile.BadZipFile, zipfile.LargeZipFile, zlib.error) as exc:
        print(f"打包失败：{exc}", file=sys.stderr)
        return 1
    print(output / "release-assets.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
