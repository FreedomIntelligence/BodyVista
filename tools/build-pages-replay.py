"""Add the verified replay library, browser player and anatomical surfaces to a built site."""

import argparse
import gzip
import hashlib
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAB = Path("experiments/body-lab")
sys.path.insert(0, str(ROOT / LAB))
import setup_release_assets as release
import showcase_release as showcase

TAG = showcase.BASE_TAG
MANIFEST_SHA256 = showcase.BASE_SHA256
PAGES_LIMIT_BYTES = 1_000_000_000
CHUNK_BYTES = 8 * 1024 * 1024
SURFACE_MANIFESTS = {"atlas-muscles": "atlas-muscles.json", "bone-volumes": "geometry/bone-volumes.json"}
PLAYER_FILES = (
    "style.css", "app.js", "public-replay.js", "motion-cache.js",
    "motion-locale.js", "motion-locale-static.js", "motion-locale-data.js",
    "motion-locale-runtime.js", "motion-locale-evidence.js",
    "fullbody-view.js", "muscle-shape-pool.js", "muscle-shape-worker.js",
    "muscle-sheet-shape.js", "muscle-path-shape.js", "bone-volumes.js",
    "anatomical-muscles.js", "surface-binary.js", "preview-muscles.js", "preview-muscles.json", "preview-muscles.bin",
    "geometry/fullbody-bones.json", "fullbody-model-data.json",
    "fullbody-coverage.json", "fullbody-validation.json", "fullbody-ui-validation.json",
    "FULLBODY.md", "ASSET_ATTRIBUTION.md", "ANATOMY_CONSTRAINTS.md",
    "licenses/Z-Anatomy-License.txt",
    "examples/custom_right_rotate_bend_make_fist.json", "examples/custom_left_open_while_rotating.json",
)
VENDOR_FILES = ("three.js", "OrbitControls.js", "GLTFLoader.js", "buffer-utils.js")
PLAYER_BUILD_META = re.compile(r'<meta name="bodyvista-player-build" content="([a-f0-9]{20})">')
FRONTEND_REFERENCE = re.compile(r"""(["'])([.]{1,2}/[\w./-]+\.(?:js|css))\1""")
FRONTEND_FILES = {LAB / name for name in PLAYER_FILES if name.endswith((".js", ".css"))} | {
    Path("src/vendor") / name for name in VENDOR_FILES
}


def version_player_references(source, path, build):
    """Pin entry, module imports and worker URLs without changing data or model URLs."""
    def replace(match):
        quote, url = match.groups()
        target = (ROOT / path.parent / url).resolve().relative_to(ROOT)
        if target not in FRONTEND_FILES:
            raise ValueError(f"播放器引用了未打包的前端文件：{path} -> {url}")
        return f"{quote}{url}?ui={build}{quote}"
    return FRONTEND_REFERENCE.sub(replace, source)


def write_surface_chunks(binary, asset, target):
    """Publish lossless gzip chunks beside their shape manifest; verify the complete source."""
    if binary.stat().st_size != asset["bytes"]:
        raise ValueError(f"发行资源长度不符：{binary.name}")
    directory = target / "surface-chunks"
    directory.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    chunks = []
    with binary.open("rb") as source:
        while raw := source.read(CHUNK_BYTES):
            digest.update(raw)
            packed = gzip.compress(raw, compresslevel=3, mtime=0)
            name = hashlib.sha256(packed).hexdigest() + ".gz"
            (directory / name).write_bytes(packed)
            chunks.append({"file": f"surface-chunks/{name}", "bytes": len(raw),
                           "compressedBytes": len(packed), "sha256": hashlib.sha256(raw).hexdigest()})
    if sum(c["bytes"] for c in chunks) != asset["bytes"] or digest.hexdigest() != asset["sha256"]:
        raise ValueError(f"发行资源校验失败：{binary.name}")
    return chunks


def publish_surfaces(stage, bundle_dir, release_manifest):
    records = {r["path"]: r for r in release_manifest["requiredFiles"]}
    assets = {a["role"]: a for a in release_manifest["assets"]}
    player = stage / LAB
    for name in ("preview-muscles.json", "preview-muscles.bin"):
        if not release._matches(player / name, records[(LAB / name).as_posix()]):
            raise ValueError(f"预览表面与发行清单不匹配：{name}")
    preview = json.loads((player / "preview-muscles.json").read_bytes())
    preview_record = records[(LAB / "preview-muscles.bin").as_posix()]
    if (preview["byteLength"], preview["binarySha256"]) != (preview_record["bytes"], preview_record["sha256"]):
        raise ValueError("预览网格长度或哈希与清单不符。")

    summary = {}
    for role, name in SURFACE_MANIFESTS.items():
        source = ROOT / LAB / name
        if not release._matches(source, records[(LAB / name).as_posix()]):
            raise ValueError(f"解剖清单与发行版不匹配：{name}")
        manifest = json.loads(source.read_bytes())
        asset = assets[role]
        if (manifest["byteLength"], manifest["binarySha256"]) != (asset["bytes"], asset["sha256"]):
            raise ValueError(f"解剖清单与发行资源不匹配：{name}")
        if role == "atlas-muscles" and (
            preview["sourceBinarySha256"] != manifest["binarySha256"] or
            preview["surfaceCount"] != manifest["surfaceCount"] or
            [p["id"] for p in preview["parts"]] != [p["id"] for p in manifest["parts"]]
        ):
            raise ValueError("预览表面的来源、数量或部件顺序与精细图谱不同。")
        destination = player / name
        chunks = write_surface_chunks(bundle_dir / asset["name"], asset, destination.parent)
        manifest["binaryChunks"] = chunks
        destination.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        summary[role] = {"chunks": len(chunks), "rawBytes": asset["bytes"],
                         "compressedBytes": sum(c["compressedBytes"] for c in chunks)}
    return summary


def assemble(bundle_dir, dist, showcase_dir=None):
    if not (dist / "index.html").is_file():
        raise ValueError("先运行 npm run build 生成主站。")
    entry = dist / LAB / "player.html"
    marker = PLAYER_BUILD_META.search(entry.read_text(encoding="utf-8"))
    if marker is None:
        raise ValueError("主站缺少播放器版本，请先重新运行 npm run build。")
    build = marker.group(1)
    manifest_path = bundle_dir / "release-assets.json"
    if hashlib.sha256(manifest_path.read_bytes()).hexdigest() != MANIFEST_SHA256:
        raise ValueError(f"清单不是 GitHub {TAG} 的已发布版本。")
    manifest = release.load_manifest(manifest_path)
    model = json.loads((ROOT / LAB / "fullbody-model-data.json").read_bytes())
    identity = (manifest["modelId"], manifest["modelSha256"], manifest["computationSha256"])
    if identity != (model["id"], model["sourceSha256"], model["computationSha256"]):
        raise ValueError("网页模型与正式动作缓存的版本不同。")

    with tempfile.TemporaryDirectory(prefix="bodyvista-pages-") as working:
        stage = Path(working)
        if showcase_dir is None:
            asset = next(asset for asset in manifest["assets"] if asset["role"] == "motion-cache")
            archive = bundle_dir / asset["name"]
            archive_spec = {"path": asset["name"], "sha256": asset["sha256"], "bytes": asset["bytes"]}
            if not release._matches(archive, archive_spec):
                raise FileNotFoundError(archive)
            members = release._unpack(asset, archive, stage)
            release._check_index(asset, members, manifest)
            catalog = json.loads(members[showcase.CATALOG].read_bytes())
            tag, expected = TAG, (11, 803)
        else:
            lock = release._load_json(showcase.LOCK)
            showcase.validate_lock(lock, manifest)
            members, catalog = showcase.unpack_checked(showcase_dir, stage, lock, manifest)
            tag, expected = showcase.TAG, (lock["summary"]["cases"], lock["summary"]["frames"])
        motions = catalog["motions"]
        frames = sum(m["verification"]["frames"] for m in motions)
        if (len(motions), frames) != expected:
            raise ValueError("案例或帧数与指定版本的清单不符。")
        old_cache = dist / LAB / "motion-cache"
        for path in old_cache.rglob("*"):
            if not path.is_file() or path.relative_to(dist).as_posix() not in members:
                raise ValueError("构建目录有本次发行以外的缓存，请先重新运行 npm run build。")

        player = stage / LAB
        for name in PLAYER_FILES:
            target = player / name
            target.parent.mkdir(parents=True, exist_ok=True)
            if name.endswith(".js"):
                source = (ROOT / LAB / name).read_text(encoding="utf-8")
                target.write_text(version_player_references(source, LAB / name, build), encoding="utf-8")
            else:
                shutil.copyfile(ROOT / LAB / name, target)
        surfaces = publish_surfaces(stage, bundle_dir, manifest)
        html = (ROOT / LAB / "index.html").read_text(encoding="utf-8")
        if html.count("<head>") != 1 or 'name="bodyvista-mode"' in html:
            raise ValueError("实验台页面缺少唯一的静态模式注入位置。")
        html = html.replace("<head>", '<head>\n  <meta name="bodyvista-mode" content="replay" />\n  ' + marker.group(), 1)
        (player / "player.html").write_text(version_player_references(html, LAB / "player.html", build), encoding="utf-8")
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
            path = Path("src/vendor") / name
            target.write_text(version_player_references((ROOT / path).read_text(encoding="utf-8"), path, build), encoding="utf-8")
        for name in ("THIRD_PARTY_NOTICES.md", "LICENSE"):
            shutil.copyfile(ROOT / name, stage / name)
        shutil.copytree(stage, dist, dirs_exist_ok=True)

    site_bytes = sum(path.stat().st_size for path in dist.rglob("*") if path.is_file())
    if site_bytes > PAGES_LIMIT_BYTES:
        raise ValueError(f"发布目录 {site_bytes} 字节超过 GitHub Pages 的 1 GB 上限")
    return {"release": tag, "cases": len(motions), "frames": frames, "cacheFiles": len(members),
            "siteBytes": site_bytes,
            "surfaces": surfaces, "entry": "./?workspace=muscle-motion", "player": (LAB / "player.html").as_posix()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle-dir", type=Path, required=True,
                        help="GitHub v1.1.0 发行清单、动作缓存 ZIP、肌肉表面和骨体积 BIN 所在目录")
    parser.add_argument("--showcase-dir", type=Path,
                        help="v1.2.0 完整动作 ZIP 所在目录；提供此项时无需旧版动作 ZIP")
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    print(json.dumps(assemble(args.bundle_dir.resolve(), args.dist.resolve(), args.showcase_dir), ensure_ascii=False))


if __name__ == "__main__":
    main()
