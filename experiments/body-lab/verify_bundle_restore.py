"""Verify a complete local Release against an existing, clean checkout without network."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
import zlib
from pathlib import Path

import setup_release_assets as install


def checkout_commit(root):
    def git(*args):
        return subprocess.check_output(["git", "-C", str(root), *args], stderr=subprocess.PIPE)
    top = Path(git("rev-parse", "--show-toplevel").decode("utf-8").strip()).resolve()
    if top != root.resolve() or git("status", "--porcelain=v1", "-z", "--untracked-files=all"):
        raise install.AssetSetupError("请选择工作树根目录，且其状态必须干净")
    return git("rev-parse", "--verify", "HEAD^{commit}").decode("ascii").strip()


def verify(bundle_dir, root):
    root = install._directory(root)
    folder = install._directory(bundle_dir)
    manifest = install.load_manifest(folder / "release-assets.json")
    if checkout_commit(root) != manifest["sourceCommit"]:
        raise install.AssetSetupError("干净检出提交与发行清单不符")
    if {asset["role"] for asset in manifest["assets"]} != install.RAW_TARGETS.keys() | install.ZIP_PREFIXES.keys():
        raise install.AssetSetupError("完整恢复验证需要四个资源角色")
    initial = install.prepare_assets(manifest, root=root)
    if any(row["status"] != "missing" for row in initial["files"]):
        raise install.AssetSetupError("恢复验证需要没有任何已安装发行资源的干净检出")
    applied = install.prepare_assets(manifest, root=root, bundle_dir=folder)
    checked = install.prepare_assets(manifest, root=root)
    if (not applied["complete"] or not all(row["status"] == "installed" for row in applied["files"])
            or not checked["complete"] or checkout_commit(root) != manifest["sourceCommit"]):
        raise install.AssetSetupError("恢复后文件、逐项哈希或 Git 工作树状态未通过")
    return {"releaseTag": manifest["releaseTag"], "sourceCommit": manifest["sourceCommit"],
            "offlineRestoreValidated": True, "assetCount": len(manifest["assets"]),
            "installedFiles": applied["fileCount"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True, help="已有的独立干净 Git 检出")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(verify(args.bundle, args.root), ensure_ascii=False))
    except (install.AssetSetupError, OSError, ValueError, subprocess.SubprocessError,
            zipfile.BadZipFile, EOFError, zlib.error) as exc:
        print(f"离线恢复验证失败：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
