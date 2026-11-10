"""Install the v1.2.0 motion library and its v1.1.0 model assets into this checkout."""

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path
from urllib.error import URLError
from zipfile import BadZipFile

import showcase_release as showcase

release = showcase.release


def catalog_state(root, expected, base):
    target = root / showcase.CATALOG
    if not target.exists():
        return "missing"
    record = showcase.pack.file_record(root, showcase.CATALOG)
    if record == expected:
        return "current"
    old_asset = next(a for a in base["assets"] if a["role"] == "motion-cache")
    if record == next(r for r in old_asset["files"] if r["path"] == showcase.CATALOG):
        return "v1.1.0"
    raise ValueError("本地动作目录与两个正式版本都不同，已保留原文件。请在新的源码目录安装。")


def install(root, *, download=False, bundle_dir=None):
    base = showcase.base_manifest()
    root_lock = root / showcase.LOCK.relative_to(showcase.ROOT)
    if not root_lock.is_file() or root_lock.read_bytes() != showcase.LOCK.read_bytes():
        raise ValueError("请选择已经检出 v1.2.0 源码及其动作清单的目录")
    lock = release._load_json(showcase.LOCK)
    asset = showcase.validate_lock(lock, base, root)
    records = {r["path"]: r for r in asset["files"]}
    catalog_record = records[showcase.CATALOG]
    state = catalog_state(root, catalog_record, base)
    missing = [r for p, r in records.items() if p != showcase.CATALOG and not release._matches(root / p, r)]
    base_status = release.prepare_assets(showcase.base_install_manifest(base), root=root,
                                         download=download, bundle_dir=bundle_dir)
    if state == "current" and not missing:
        if bundle_dir is not None:
            showcase.checked_archive(bundle_dir, asset)
        showcase.verify_members(lock, base, {p: root / p for p in records})
    elif not download and bundle_dir is None:
        return {"complete": False, "baseInstalled": base_status["complete"], "catalog": state,
                "missingMotionFiles": len(missing), "release": showcase.TAG}
    else:
        parent = release._directory(root / ".runtime-cache/release-assets", create=True)
        with tempfile.TemporaryDirectory(prefix="showcase-", dir=parent) as temp:
            staging = Path(temp)
            if download:
                release._download(asset, staging / asset["name"], 60)
                bundle_dir = staging
            members, _ = showcase.unpack_checked(bundle_dir, staging / "members", lock, base)
            for record in missing:
                target = root / record["path"]
                release._directory(target.parent, create=True)
                try:
                    os.link(members[record["path"]], target)
                except FileExistsError:
                    if not release._matches(target, record):
                        raise
            # Only switch the catalog once every referenced gzip is usable. A
            # stopped installation can safely retry with the old catalog live.
            for name, record in records.items():
                if name != showcase.CATALOG and not release._matches(root / name, record):
                    raise ValueError(f"目标动作文件缺失：{name}")
            target = root / showcase.CATALOG
            release._directory(target.parent, create=True)
            current = catalog_state(root, catalog_record, base)
            if current == "missing":
                try:
                    os.link(members[showcase.CATALOG], target)
                except FileExistsError:
                    if not release._matches(target, catalog_record):
                        raise
            elif current != "current":
                os.replace(members[showcase.CATALOG], target)
            if not release._matches(target, catalog_record):
                raise ValueError("安装后缺少动作目录")
    return {"complete": base_status["complete"], "release": showcase.TAG,
            "model": base["modelId"], **lock["summary"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="只读核对同版模型与完整动作库")
    mode.add_argument("--download", action="store_true", help="从固定的 GitHub Release 下载缺失资源")
    mode.add_argument("--from-bundle", type=Path, help="从放有三份基础资源和新版动作 ZIP 的目录恢复")
    parser.add_argument("--root", type=Path, default=showcase.ROOT, help="相同版本的源码目录")
    args = parser.parse_args()
    try:
        result = install(release._directory(args.root), download=args.download,
                         bundle_dir=release._directory(args.from_bundle) if args.from_bundle else None)
    except (OSError, ValueError, release.AssetSetupError, BadZipFile, URLError, EOFError) as error:
        # An HTTP exception may contain a signed asset URL.
        message = type(error).__name__ if isinstance(error, URLError) else str(error)
        print(json.dumps({"complete": False, "error": message}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
