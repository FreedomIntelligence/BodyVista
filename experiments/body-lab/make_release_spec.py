"""Create a local packaging spec from the actual runtime and an immutable Git commit."""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import prepare_release_bundle as bundle
import setup_release_assets as install

LAB = install.LAB
ELBOW = "experiments/elbow-lab/"
REPAIR = LAB + "candidates/model-repair-20261106/"
REFRESH = LAB + "candidates/library-refresh-20261106/"
SCENE_CATALOGS = tuple(LAB + "candidates/" + name + "/catalog.json" for name in
                       ("verified-motions-20261103", "dumbbell-motions-20261103"))
EXAMPLES = ("examples/custom_right_rotate_bend_make_fist.json", "examples/custom_left_open_while_rotating.json")
ATLAS_LICENSE = LAB + "licenses/Z-Anatomy-License.txt"
BODY_NAMES = (
    "__init__.py", "index.html", "app.js", "style.css", "fullbody-view.js", "motion-cache.js",
    "anatomical-muscles.js", "bone-volumes.js", "muscle-path-shape.js", "muscle-sheet-shape.js",
    "muscle-shape-pool.js", "muscle-shape-worker.js", "muscle-surface-contact.js",
    "preview-muscles.js", "preview-muscles.json", "preview-muscles.bin",
    "native_bridge.py", "runtime_performance.py", "fullbody-coverage.json", "fullbody_verify.py",
    "fullbody-ui-validation.json", "muscle-review.html", "review-media/manifest.json",
    "README.md", "FULLBODY.md", "GRASP.md", "ANATOMY_CONSTRAINTS.md", "BONE_CONTACT.md",
    "candidates/runtime/requirements-lock.txt", "candidates/runtime/expanded-before-range-calibration.xml",
    "candidates/runtime/hand-range-calibration.json", "make_release_spec.py", "verify_bundle_restore.py", *EXAMPLES,
)
ELBOW_NAMES = (
    "server.py", "engine.py", "solver.py", "pose_dynamics.py", "index.html", "app.js",
    "arm-view.js", "muscle-shape.js", "pose-editor.js", "style.css", "pose-editor.css",
    "demo.json", "atlas/bindings.json", "model/arm26.osim", "model/arm26-table.json",
    "model/fiber-lengths.json", "model/pose-forces.json", "model/README.md", "README.md",
)
VENDOR = ("three.js", "OrbitControls.js", "GLTFLoader.js", "buffer-utils.js")
REPRODUCE = {REPAIR + name for name in ("verify_release_motions.py", "verify_normal_motions.py", "verify_suites.py",
             "export_model_info.py", "browser-check.mjs", "RELEASE_PREPARATION.md")}
REPRODUCE.update(REFRESH + name for name in ("refresh_library.py", "resource_guard.py", "test_refresh_library.py"))
GIT_ONLY = {".gitignore", "vite.config.js", "tests/motion-cache.test.js", "tests/muscle-shape-pool.test.js"}
GIT_ONLY.update(LAB + name for name in ("test_release_assets.py", "test_prepare_release_bundle.py",
                "test_make_release_spec.py", "test_motion_cache.py", "test_franko_transmission.py",
                "test_passive_series.py", "test_native_worker_limits.py", "test_equipment_support.py", "verify_grasp.py",
                "verify_ground.py", "verify_constraints.py", "verify_local_rotation.py", "build_bone_volumes.py"))


def runtime_selection(text):
    """Read the literal configuration without importing MuJoCo or starting the service."""
    tree = ast.parse(text)
    assignments = {item.targets[0].id: item.value for item in tree.body
                   if isinstance(item, ast.Assign) and len(item.targets) == 1
                   and isinstance(item.targets[0], ast.Name)}
    model_node = assignments["MODEL_PATH"]
    bundle.require(isinstance(model_node, ast.BinOp) and isinstance(model_node.op, ast.Div)
                   and isinstance(model_node.left, ast.Name) and model_node.left.id == "HERE",
                   "请核查当前引擎的 MODEL_PATH 表达式")
    model = Path(install._relative_path(ast.literal_eval(model_node.right)))
    manifest_node = assignments["MODEL_MANIFEST_PATH"]
    bundle.require(isinstance(manifest_node, ast.Call) and isinstance(manifest_node.func, ast.Attribute)
                   and manifest_node.func.attr == "with_name" and isinstance(manifest_node.func.value, ast.Name)
                   and manifest_node.func.value.id == "MODEL_PATH" and len(manifest_node.args) == 1,
                   "请核查当前引擎的 MODEL_MANIFEST_PATH 表达式")
    manifest_name = install._relative_path(ast.literal_eval(manifest_node.args[0]))
    fingerprint = next((n for n in tree.body if isinstance(n, ast.FunctionDef)
                        and n.name == "computation_fingerprint"), None)
    loops = [] if fingerprint is None else [n for n in fingerprint.body if isinstance(n, ast.For)]
    bundle.require(len(loops) == 1, "请核查当前计算指纹的文件顺序")
    names = bundle.listed_paths(list(ast.literal_eval(loops[0].iter)), "computationFiles")
    return LAB + model.as_posix(), LAB + model.with_name(manifest_name).as_posix(), names


def model_files(root, model, manifest):
    names, visited, pending = {model}, set(), [manifest]
    while pending:
        current = pending.pop()
        if current in visited:
            continue
        visited.add(current)
        bundle.require(len(visited) <= 32, "模型父版本引用异常")
        names.add(current)
        row = install._load_json(root / current, 8 * 1024 * 1024)
        parent = Path(current).parent
        if "derivedFrom" in row:
            names.add((parent / install._relative_path(row["derivedFrom"])).as_posix())
        if "derivedFromManifest" in row:
            pending.append((parent / install._relative_path(row["derivedFromManifest"])).as_posix())
        if isinstance(row.get("baseModelManifest"), dict):
            pending.append((parent / install._relative_path(row["baseModelManifest"]["file"])).as_posix())
    return names


def fixture_inputs(root):
    """Select only pinned scene inputs, never archived output forces or run receipts."""
    names = set(REPRODUCE)
    verify = root / (REPAIR + "verify_release_motions.py")
    definition = next((node.value for node in ast.parse(verify.read_text("utf-8")).body
                       if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "SOURCES"
                                                               for t in node.targets)), None)
    bundle.require(definition is not None, "未找到具名的回归套件输入")
    suites = ast.literal_eval(definition)
    bundle.require(isinstance(suites, dict) and set(suites) == {"core", "smoke", "extended", "standing", "custom"},
                   "应用的回归套件与发布范围不同")
    for relative, sha in suites.values():
        name = REPAIR + install._relative_path(relative)
        bundle.require(hashlib.sha256((root / name).read_bytes()).hexdigest() == install._digest(sha, "套件 SHA"),
                       f"已冻结的回归输入内容不同：{name}")
        names.add(name)
    seen = set()
    for name in SCENE_CATALOGS:
        names.add(name)
        catalog = install._load_json(root / name, 8 * 1024 * 1024)
        for motion in catalog["motions"]:
            identifier, verification = motion["id"], motion["verification"]
            bundle.require(identifier in bundle.CASE_IDS and identifier not in seen, "原动作输入 ID 未知或重复")
            seen.add(identifier)
            file = install._relative_path(verification["sceneFile"])
            bundle.require(file == identifier + ".scene.json", "动作输入文件名与案例 ID 不同")
            path = (Path(name).parent / file).as_posix()
            bundle.require(hashlib.sha256((root / path).read_bytes()).hexdigest() == verification["sceneSha256"],
                           f"固定动作场景与来源记录不同：{path}")
            names.add(path)
    bundle.require(seen == bundle.CASE_IDS, "原动作输入集合不完整")
    return names


def required_files(root, model, manifest, modules, extras):
    names = set(bundle.BASE_FILES) | model_files(root, model, manifest)
    names.update((".gitattributes", "README.md", "README.zh-CN.md", ATLAS_LICENSE))
    names.update(LAB + name for name in (*BODY_NAMES, *modules))
    names.update(ELBOW + name for name in ELBOW_NAMES)
    names.update("src/vendor/" + name for name in VENDOR)
    bindings = install._load_json(root / (ELBOW + "atlas/bindings.json"))
    for part in bindings["parts"]:
        name = install._relative_path(part["file"])
        bundle.require(re.fullmatch(r"assets/detail/z_[0-9a-f]+\.js", name), "右臂图谱引用异常")
        names.add(name)
    media = install._load_json(root / (LAB + "review-media/manifest.json"))
    for muscle in media["muscles"]:
        for film in muscle["films"]:
            name = install._relative_path(film["file"])
            bundle.require(re.fullmatch(r"[a-z0-9-]+\.(webm|mp4)", name), "界面录像引用异常")
            names.add(LAB + "review-media/" + name)
    names.update(install._relative_path(name) for name in extras)
    return sorted(names)


def make_spec(root, tag, commit, extras=()):
    root = install._directory(root)
    bundle.require(commit == "HEAD" or re.fullmatch(r"[0-9a-f]{40}", commit),
                   "请输入 HEAD 或完整的 40 位 Git 提交号")
    resolved = subprocess.check_output(["git", "-C", str(root), "rev-parse", "--verify", commit + "^{commit}"],
                                       stderr=subprocess.PIPE).decode("ascii").strip()
    model, manifest, modules = runtime_selection((root / (LAB + "fullbody_engine.py")).read_text("utf-8"))
    spec = {"releaseTag": tag, "sourceCommit": resolved, "modelXml": model, "modelManifest": manifest,
            "computationFiles": modules, "atlasLicense": ATLAS_LICENSE,
            "requiredFiles": sorted(set(required_files(root, model, manifest, modules, extras)) | fixture_inputs(root))}
    bundle.checked_spec(spec)
    return spec


def git_paths(spec):
    names = sorted(set(spec["requiredFiles"]) | GIT_ONLY)
    for name in names:
        install._relative_path(name)
        parts = Path(name).parts
        bundle.require(not set(parts) & {".runtime-cache", "__pycache__", "history", "runs", "ms-human-700", "motion-cache"}
                       and name not in {*install.RAW_TARGETS.values(), bundle.READY}
                       and not name.endswith((".result.json", ".json.gz", ".log")), "发布路径包含本地或发行资产")
    return names


def save_spec(root, spec):
    bundle.checked_spec(spec)
    records = {name: bundle.file_record(root, name) for name in spec["requiredFiles"]}
    bundle.git_required(root, spec["sourceCommit"], records, portable_text=True)
    parent = install._directory(root / ".runtime-cache" / "release-bundle-specs", create=True)
    target = parent / (spec["releaseTag"] + "-" + spec["sourceCommit"] + ".json")
    raw = (json.dumps(spec, ensure_ascii=False, indent=2) + "\n").encode()
    # The spec is published only after every single prerequisite passes.
    with tempfile.NamedTemporaryFile(dir=parent, delete=False) as out:
        tmp = Path(out.name)
        out.write(raw)
    try:
        try:
            os.link(tmp, target)
        except FileExistsError:
            bundle.require(install._matches(target, bundle.file_record(parent, tmp.name)) and target.read_bytes() == raw,
                           "已有不同规格，请保留并核对该版本的输入")
    finally:
        tmp.unlink(missing_ok=True)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--commit", default="HEAD")
    parser.add_argument("--extra-file", action="append", default=[], help="额外随 Git 提供的具名文件")
    parser.add_argument("--root", type=Path, default=install.REPO)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--list-files", action="store_true", help="只列出规格输入和缺失文件，不生成规格")
    mode.add_argument("--git-files", action="store_true", help="输出精确 Git 路径，每行一个，不操作暂存区")
    args = parser.parse_args()
    try:
        spec = make_spec(args.root, args.tag, args.commit, args.extra_file)
        if args.list_files:
            print(json.dumps({"sourceCommit": spec["sourceCommit"], "modelXml": spec["modelXml"],
                              "modelManifest": spec["modelManifest"], "computationFiles": spec["computationFiles"],
                              "requiredFiles": spec["requiredFiles"],
                              "missing": [p for p in spec["requiredFiles"] if not (args.root / p).is_file()]},
                             ensure_ascii=False, indent=2))
        elif args.git_files:
            print("\n".join(git_paths(spec)))
        else:
            print(save_spec(args.root, spec))
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, install.AssetSetupError) as exc:
        print(f"生成打包规格失败：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
