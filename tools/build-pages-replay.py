"""Add the v1.1.0 motion library and browser player to a built BodyVista site."""

import argparse
import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAB = Path("experiments/body-lab")
sys.path.insert(0, str(ROOT / LAB))
import setup_release_assets as release

TAG = "v1.1.0"
MANIFEST_SHA256 = "56a52cc1835f83ffa009ecfb566314ae96398feff235eba1a2a836e2bc3c12dc"
PLAYER_FILES = (
    "style.css", "app.js", "public-replay.js", "motion-cache.js",
    "fullbody-view.js", "muscle-shape-pool.js", "muscle-shape-worker.js",
    "muscle-sheet-shape.js", "muscle-path-shape.js", "bone-volumes.js",
    "geometry/fullbody-bones.json", "fullbody-model-data.json",
    "fullbody-coverage.json", "fullbody-validation.json", "fullbody-ui-validation.json",
    "FULLBODY.md", "ASSET_ATTRIBUTION.md", "ANATOMY_CONSTRAINTS.md",
    "licenses/Z-Anatomy-License.txt",
    "examples/custom_right_rotate_bend_make_fist.json", "examples/custom_left_open_while_rotating.json",
)
VENDOR_FILES = ("three.js", "OrbitControls.js", "GLTFLoader.js", "buffer-utils.js")


def assemble(bundle_dir, dist):
    if not (dist / "index.html").is_file():
        raise ValueError("先运行 npm run build 生成主站。")
    manifest_path = bundle_dir / "release-assets.json"
    if hashlib.sha256(manifest_path.read_bytes()).hexdigest() != MANIFEST_SHA256:
        raise ValueError(f"清单不是 GitHub {TAG} 的已发布版本。")
    manifest = release.load_manifest(manifest_path)
    asset = next(asset for asset in manifest["assets"] if asset["role"] == "motion-cache")
    archive = bundle_dir / asset["name"]
    archive_spec = {"path": asset["name"], "sha256": asset["sha256"], "bytes": asset["bytes"]}
    if not release._matches(archive, archive_spec):
        raise FileNotFoundError(archive)

    model = json.loads((ROOT / LAB / "fullbody-model-data.json").read_bytes())
    identity = (manifest["modelId"], manifest["modelSha256"], manifest["computationSha256"])
    if identity != (model["id"], model["sourceSha256"], model["computationSha256"]):
        raise ValueError("网页模型与正式动作缓存的版本不同。")

    with tempfile.TemporaryDirectory(prefix="bodyvista-pages-") as working:
        stage = Path(working)
        members = release._unpack(asset, archive, stage)
        release._check_index(asset, members, manifest)
        catalog = json.loads(members[(LAB / "motion-cache/catalog.json").as_posix()].read_bytes())
        motions = catalog["motions"]
        if len(motions) != 11 or sum(m["verification"]["frames"] for m in motions) != 803:
            raise ValueError("发行缓存应包含 11 个案例的 803 帧。")

        player = stage / LAB
        for name in PLAYER_FILES:
            target = player / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / LAB / name, target)
        html = (ROOT / LAB / "index.html").read_text(encoding="utf-8")
        if html.count("<head>") != 1 or 'name="bodyvista-mode"' in html:
            raise ValueError("实验台页面缺少唯一的静态模式注入位置。")
        (player / "player.html").write_text(html.replace(
            "<head>", '<head>\n  <meta name="bodyvista-mode" content="replay" />', 1
        ), encoding="utf-8")
        license_path = "experiments/body-lab/candidates/ms-human-700/LICENSE"
        license_record = next(item for source in manifest["assets"] if source["role"] == "ms-human-source"
                              for item in source["files"] if item["path"] == license_path)
        source_license = ROOT / "tools/pages-assets/MS-Human-LICENSE.txt"
        if not release._matches(source_license, license_record):
            raise FileNotFoundError(source_license)
        shutil.copyfile(source_license, player / "licenses/MS-Human-LICENSE.txt")

        for name in VENDOR_FILES:
            target = stage / "src/vendor" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / "src/vendor" / name, target)
        for name in ("THIRD_PARTY_NOTICES.md", "LICENSE"):
            shutil.copyfile(ROOT / name, stage / name)
        shutil.copytree(stage, dist, dirs_exist_ok=True)

    return {"release": TAG, "cases": len(motions), "frames": 803, "cacheFiles": len(members),
            "entry": "./?workspace=muscle-motion", "player": (LAB / "player.html").as_posix()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-dir", type=Path, required=True,
                        help="GitHub v1.1.0 release-assets.json 和 motion-cache ZIP 所在目录")
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    print(json.dumps(assemble(args.bundle_dir.resolve(), args.dist.resolve()), ensure_ascii=False))


if __name__ == "__main__":
    main()
