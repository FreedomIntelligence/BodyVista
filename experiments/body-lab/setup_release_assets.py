"""Install explicitly pinned Release resources; standard library, no model imports.

No final manifest is bundled until model and library validation are complete.
Importing this module and running --check never downloads or creates files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
import struct
import sys
import tempfile
import zipfile
import zlib
from pathlib import Path, PurePosixPath
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

REPO = Path(__file__).resolve().parents[2]
REPOSITORY = "FreedomIntelligence/BodyVista"
LAB = "experiments/body-lab/"
CHUNK_BYTES = 64 * 1024
MAX_ASSET_BYTES = 512 * 1024 * 1024
MAX_INSTALLED_BYTES = 2 * 1024 * 1024 * 1024
MAX_PATH_CHARS = 1024
MAX_PATH_DEPTH = 32
MAX_COMPONENT_CHARS = 255
MAX_CENTRAL_DIRECTORY_BYTES = 8 * 1024 * 1024
MAX_ZIP_EXTRA_BYTES = 4096
MAX_ZIP_COMMENT_BYTES = 4096
CDN_HOSTS = frozenset({"release-assets.githubusercontent.com", "objects.githubusercontent.com"})
RAW_TARGETS = {"bone-volumes": LAB + "geometry/bone-volumes.bin",
               "atlas-muscles": LAB + "atlas-muscles.bin"}
ZIP_PREFIXES = {"ms-human-source": LAB + "candidates/ms-human-700/",
                "motion-cache": LAB + "motion-cache/"}
RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
            *(f"LPT{i}" for i in range(1, 10))}


class AssetSetupError(RuntimeError):
    """A manifest, response, archive or destination violates the install contract."""


def _digest(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise AssetSetupError(f"{label} 必须是完整 SHA-256")
    return value


def _relative_path(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise AssetSetupError("安装路径必须是具名的 POSIX 相对路径")
    if len(value) > MAX_PATH_CHARS or value.count("/") >= MAX_PATH_DEPTH:
        raise AssetSetupError("安装路径超过 1024 字符或 32 层")
    parts = value.split("/")
    if any(len(part) > MAX_COMPONENT_CHARS for part in parts):
        raise AssetSetupError("安装路径组件超过 255 字符")
    if any(not re.fullmatch(r"[A-Za-z0-9_.-]+", part) or part.lower() in {".", "..", ".git", "__pycache__"}
           or part.endswith(".") or part.split(".")[0].upper() in RESERVED for part in parts):
        raise AssetSetupError(f"不允许的安装路径：{value}")
    return value


def _file_spec(value):
    if not isinstance(value, dict) or set(value) != {"path", "bytes", "sha256"}:
        raise AssetSetupError("文件声明必须包含且仅包含 path、bytes、sha256")
    _relative_path(value["path"])
    size = value["bytes"]
    if type(size) is not int or not 0 < size <= MAX_ASSET_BYTES:
        raise AssetSetupError("文件字节数必须在 1 到 512 MiB 之间")
    _digest(value["sha256"], "文件哈希")


def validate_manifest(value):
    """Validate the full declaration before touching any install directory."""
    fields = {"schema", "repository", "releaseTag", "sourceCommit", "modelId",
              "modelSha256", "computationSha256", "requiredFiles", "assets"}
    if not isinstance(value, dict) or set(value) != fields or type(value["schema"]) is not int or value["schema"] != 1:
        raise AssetSetupError("需要 schema 1 的完整发行清单；草案或未知字段不能安装")
    if value["repository"] != REPOSITORY:
        raise AssetSetupError("仅允许 BodyVista 的固定 GitHub 仓库")
    tag = value["releaseTag"]
    if not isinstance(tag, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", tag) or tag.lower() in {"latest", "draft", "todo", "tbd"}:
        raise AssetSetupError("发行标签必须固定，不能使用 latest 或草案占位")
    if not isinstance(value["sourceCommit"], str) or not re.fullmatch(r"[0-9a-f]{40}", value["sourceCommit"]):
        raise AssetSetupError("sourceCommit 必须是完整 Git 提交号")
    if not isinstance(value["modelId"], str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,120}", value["modelId"]):
        raise AssetSetupError("modelId 必须具名")
    _digest(value["modelSha256"], "模型哈希")
    _digest(value["computationSha256"], "计算代码哈希")
    required, assets = value["requiredFiles"], value["assets"]
    if not isinstance(required, list) or not required or len(required) > 1000:
        raise AssetSetupError("requiredFiles 必须列出同版代码、配套 JSON 和归属文件")
    if not isinstance(assets, list) or not 1 <= len(assets) <= 4:
        raise AssetSetupError("assets 必须包含 1 到 4 个具名资源")
    seen_paths, seen_roles, seen_names = set(), set(), set()
    total = 0

    def add_file(item):
        nonlocal total
        _file_spec(item)
        key = item["path"].casefold()
        if key in seen_paths:
            raise AssetSetupError("文件路径重复或仅大小写不同")
        seen_paths.add(key)
        total += item["bytes"]

    for item in required:
        add_file(item)
    for asset in assets:
        if not isinstance(asset, dict) or set(asset) != {"role", "name", "url", "bytes", "sha256", "format", "files"}:
            raise AssetSetupError("资源声明字段不完整或含未知字段")
        role, name = asset["role"], asset["name"]
        if not isinstance(role, str) or role not in RAW_TARGETS.keys() | ZIP_PREFIXES.keys() or role in seen_roles:
            raise AssetSetupError("资源角色未知或重复")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,159}", name) or name.casefold() in seen_names:
            raise AssetSetupError("资源名不合法或重复")
        seen_roles.add(role)
        seen_names.add(name.casefold())
        expected_url = f"https://github.com/{REPOSITORY}/releases/download/{tag}/{name}"
        if asset["url"] != expected_url:
            raise AssetSetupError("下载地址必须指向清单的固定仓库、标签和资源名")
        _file_spec({"path": name, "bytes": asset["bytes"], "sha256": asset["sha256"]})
        files = asset["files"]
        if not isinstance(files, list) or not 1 <= len(files) <= 1000:
            raise AssetSetupError("资源必须声明完整且有限的成员白名单")
        expected_format = "raw" if role in RAW_TARGETS else "zip"
        if asset["format"] != expected_format:
            raise AssetSetupError("资源格式与角色不符")
        if expected_format == "raw" and len(files) != 1:
            raise AssetSetupError("原始二进制必须且只能对应一个文件")
        for item in files:
            add_file(item)
            path = item["path"]
            if expected_format == "raw":
                if path != RAW_TARGETS[role] or (item["bytes"], item["sha256"]) != (asset["bytes"], asset["sha256"]):
                    raise AssetSetupError("原始二进制的路径、字节数或哈希不一致")
            elif not path.startswith(ZIP_PREFIXES[role]):
                raise AssetSetupError("ZIP 成员超出该资源角色的安装范围")
            elif role == "motion-cache" and not re.fullmatch(r"catalog\.json|[0-9a-f]{64}\.json\.gz", path[len(ZIP_PREFIXES[role]):]):
                raise AssetSetupError("动作包只允许目录与内容寻址的 gzip 结果")
        mandatory = {"ms-human-source": "SOURCE_MANIFEST.json", "motion-cache": "catalog.json"}.get(role)
        if mandatory and ZIP_PREFIXES[role] + mandatory not in {item["path"] for item in files}:
            raise AssetSetupError("ZIP 缺少运行时资源目录")
    if total > MAX_INSTALLED_BYTES:
        raise AssetSetupError("声明的文件总量超过 2 GiB")
    return value


def _load_json(path, limit=2 * 1024 * 1024):
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result:
                raise AssetSetupError("发行清单有重复 JSON 键")
            result[key] = item
        return result

    def bad_constant(_):
        raise AssetSetupError("发行清单不允许非有限数值")

    with Path(path).open("rb") as source:
        raw = source.read(limit + 1)
    if len(raw) > limit:
        raise AssetSetupError("JSON 清单超过允许字节数")
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=bad_constant)


def load_manifest(path):
    return validate_manifest(_load_json(path))


def _reject_link(info, path):
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400):
        raise AssetSetupError(f"拒绝符号链接或重解析点：{path}")


def _directory(path, *, create=False):
    """Check every ancestor before creating anything below it, including the root."""
    path = Path(os.path.abspath(path))
    for current in (*reversed(path.parents), path):
        try:
            info = current.lstat()
        except FileNotFoundError:
            if not create:
                continue
            current.mkdir(exist_ok=True)
            info = current.lstat()
        _reject_link(info, current)
        if not stat.S_ISDIR(info.st_mode):
            raise AssetSetupError(f"目标祖先不是普通目录：{current}")
    return path


def _identity(info, *, opened=False):
    stamp = getattr(info, "st_birthtime_ns", info.st_ctime_ns) if opened else info.st_ctime_ns
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, stamp


def _matches(path, item):
    _directory(path.parent)
    try:
        before = path.lstat()
    except FileNotFoundError:
        return False
    _reject_link(before, path)
    if not stat.S_ISREG(before.st_mode) or before.st_size != item["bytes"]:
        raise AssetSetupError(f"已有文件类型或字节数不符，保留原文件：{item['path']}")
    flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
    digest, count = hashlib.sha256(), 0
    with os.fdopen(os.open(path, flags), "rb") as source:
        opened = os.fstat(source.fileno())
        if _identity(before, opened=True) != _identity(opened, opened=True):
            raise AssetSetupError("文件在打开时发生变化")
        while chunk := source.read(min(CHUNK_BYTES, item["bytes"] - count + 1)):
            count += len(chunk)
            if count > item["bytes"]:
                raise AssetSetupError("文件在校验时增长")
            digest.update(chunk)
        after = os.fstat(source.fileno())
    if _identity(opened) != _identity(after) or _identity(before) != _identity(path.lstat()):
        raise AssetSetupError("文件在校验时发生变化")
    if count != item["bytes"] or digest.hexdigest() != item["sha256"]:
        raise AssetSetupError(f"已有文件 SHA-256 不符，保留原文件：{item['path']}")
    return True


def _allowed_response_url(url, origin):
    parsed = urlsplit(url)
    try:
        port = parsed.port
    except ValueError:
        return False
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.fragment or port not in (None, 443):
        return False
    return url == origin or parsed.hostname in CDN_HOSTS


class ReleaseRedirects(HTTPRedirectHandler):
    max_repeats = 2
    max_redirections = 4

    def __init__(self, origin):
        self.origin = origin

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not _allowed_response_url(newurl, self.origin):
            raise AssetSetupError("拒绝跳转到非 HTTPS 或非白名单 GitHub 资产地址")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _write_checked(source, target, item):
    count, digest = 0, hashlib.sha256()
    with target.open("xb") as output:
        while chunk := source.read(min(CHUNK_BYTES, item["bytes"] - count + 1)):
            count += len(chunk)
            if count > item["bytes"]:
                raise AssetSetupError(f"数据超过声明字节数：{item['path']}")
            output.write(chunk)
            digest.update(chunk)
        if count != item["bytes"] or digest.hexdigest() != item["sha256"]:
            raise AssetSetupError(f"数据字节数或 SHA-256 不符：{item['path']}")
        output.flush()
        os.fsync(output.fileno())


def _download(asset, target, timeout):
    opener = build_opener(ReleaseRedirects(asset["url"]))
    request = Request(asset["url"], headers={"Accept-Encoding": "identity", "User-Agent": "BodyVista-release-setup/1"})
    with opener.open(request, timeout=timeout) as response:
        if response.getcode() != 200 or not _allowed_response_url(response.geturl(), asset["url"]):
            raise AssetSetupError("资源响应状态或最终地址不符")
        if response.headers.get("Content-Encoding", "identity").lower() != "identity":
            raise AssetSetupError("资源响应不能额外压缩或转换")
        length = response.headers.get("Content-Length")
        if length is not None and (not length.isdecimal() or int(length) != asset["bytes"]):
            raise AssetSetupError("HTTP Content-Length 与清单不符")
        _write_checked(response, target, {"path": asset["name"], "bytes": asset["bytes"], "sha256": asset["sha256"]})


def _preflight_zip(archive, expected, directories):
    """Bound central-directory work before ZipFile allocates ZipInfo objects.

    These <=512 MiB release bundles do not need ZIP64 or multi-volume ZIP.
    Parse classic EOCD and each central entry with bounded reads; do not trust
    EOCD's entry count to describe the actual central-directory record count.
    """
    allowed_count = len(expected) + len(directories)
    with archive.open("rb") as source:
        size = source.seek(0, os.SEEK_END)
        if not 22 <= size <= MAX_ASSET_BYTES:
            raise AssetSetupError("ZIP 文件大小不合法")
        tail_start = max(0, size - 65535 - 22)
        source.seek(tail_start)
        tail = source.read(65535 + 22)
        offset = tail.rfind(b"PK\x05\x06")
        if offset < 0 or len(tail) - offset < 22:
            raise AssetSetupError("ZIP 缺少完整 EOCD")
        _, disk, cd_disk, disk_count, count, cd_size, cd_offset, comment_size = struct.unpack_from("<4s4H2IH", tail, offset)
        eocd_offset = tail_start + offset
        if offset + 22 + comment_size != len(tail):
            raise AssetSetupError("ZIP EOCD 长度或尾部数据不符")
        if count == 0xFFFF or disk_count == 0xFFFF or cd_size == 0xFFFFFFFF or cd_offset == 0xFFFFFFFF:
            raise AssetSetupError("发行资源不接受 ZIP64")
        if eocd_offset >= 20:
            source.seek(eocd_offset - 20)
            if source.read(4) == b"PK\x06\x07":
                raise AssetSetupError("发行资源不接受 ZIP64 locator")
        if disk or cd_disk or disk_count != count:
            raise AssetSetupError("发行资源不接受多卷 ZIP")
        if not len(expected) <= count <= allowed_count:
            raise AssetSetupError("ZIP EOCD 成员数超过白名单范围或不足")
        max_entry_bytes = 46 + MAX_PATH_CHARS + 1 + MAX_ZIP_EXTRA_BYTES + MAX_ZIP_COMMENT_BYTES
        if not 46 * count <= cd_size <= min(MAX_CENTRAL_DIRECTORY_BYTES, allowed_count * max_entry_bytes):
            raise AssetSetupError("ZIP 中央目录字节数超过预检上限或不足")
        if cd_offset + cd_size != eocd_offset:
            raise AssetSetupError("ZIP 中央目录位置或长度不符")
        source.seek(cd_offset)
        remaining, seen = cd_size, set()
        while remaining:
            if len(seen) >= count or remaining < 46:
                raise AssetSetupError("ZIP 中央目录实际成员数与 EOCD 不符")
            header = source.read(46)
            if len(header) != 46:
                raise AssetSetupError("ZIP 中央目录截断")
            fields = struct.unpack("<4s6H3I5H2I", header)
            if fields[0] != b"PK\x01\x02":
                raise AssetSetupError("ZIP 中央目录记录无效")
            if fields[2] >= 45:
                raise AssetSetupError("发行资源不接受需要 ZIP64 或更高版本的成员")
            flags, compressed_size, uncompressed_size = fields[3], fields[8], fields[9]
            name_size, extra_size, entry_comment_size, entry_disk = fields[10:14]
            local_offset = fields[16]
            if compressed_size == 0xFFFFFFFF or uncompressed_size == 0xFFFFFFFF or local_offset == 0xFFFFFFFF:
                raise AssetSetupError("发行资源不接受 ZIP64 成员")
            if entry_disk or local_offset >= cd_offset:
                raise AssetSetupError("ZIP 成员分卷或偏移不合法")
            if not 1 <= name_size <= MAX_PATH_CHARS + 1 or extra_size > MAX_ZIP_EXTRA_BYTES or entry_comment_size > MAX_ZIP_COMMENT_BYTES:
                raise AssetSetupError("ZIP 成员名称、扩展区或注释超过预检上限")
            record_size = 46 + name_size + extra_size + entry_comment_size
            if record_size > remaining:
                raise AssetSetupError("ZIP 中央目录成员长度越界")
            try:
                filename = source.read(name_size).decode("utf-8" if flags & 0x800 else "cp437")
            except UnicodeDecodeError:
                raise AssetSetupError("ZIP 成员名称编码无效") from None
            name = filename.removesuffix("/")
            _relative_path(name)
            allowed = directories if filename.endswith("/") else expected
            if name not in allowed or name.casefold() in seen:
                raise AssetSetupError("ZIP 中央目录有重复或未声明成员")
            seen.add(name.casefold())
            extra = source.read(extra_size)
            position = 0
            while position < len(extra):
                if len(extra) - position < 4:
                    raise AssetSetupError("ZIP 扩展字段截断")
                kind, field_size = struct.unpack_from("<HH", extra, position)
                if kind == 1:
                    raise AssetSetupError("发行资源不接受 ZIP64 扩展字段")
                position += 4 + field_size
                if position > len(extra):
                    raise AssetSetupError("ZIP 扩展字段长度越界")
            source.seek(entry_comment_size, os.SEEK_CUR)
            remaining -= record_size
        if len(seen) != count:
            raise AssetSetupError("ZIP 中央目录实际成员数与 EOCD 不符")


def _unpack(asset, archive, staging):
    expected = {item["path"]: item for item in asset["files"]}
    for name in expected:
        _relative_path(name)
    directories = {str(parent) for name in expected for parent in PurePosixPath(name).parents if str(parent) != "."}
    _preflight_zip(archive, expected, directories)
    seen = set()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            name = member.filename.removesuffix("/")
            _relative_path(name)
            if name.casefold() in seen:
                raise AssetSetupError("ZIP 有重复或大小写冲突的路径")
            seen.add(name.casefold())
            mode = member.external_attr >> 16
            if stat.S_IFMT(mode) not in (0, stat.S_IFDIR if member.is_dir() else stat.S_IFREG):
                raise AssetSetupError("ZIP 不允许符号链接或特殊文件")
            if member.flag_bits & 1 or member.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise AssetSetupError("ZIP 不允许加密或未经支持的压缩方式")
            if member.is_dir():
                if name not in directories or member.file_size:
                    raise AssetSetupError("ZIP 含未声明目录或目录数据")
                continue
            if name not in expected or member.file_size != expected[name]["bytes"]:
                raise AssetSetupError("ZIP 成员或字节数与白名单不符")
            target = staging / name
            _directory(target.parent, create=True)
            with bundle.open(member) as source:
                _write_checked(source, target, expected[name])
        if not {name.casefold() for name in expected}.issubset(seen):
            raise AssetSetupError("ZIP 缺少白名单文件")
    return {name: staging / name for name in expected}


def _check_index(asset, paths, manifest):
    """The ZIP whitelist must also close over the index read by the runtime."""
    role = asset["role"]
    if role not in ZIP_PREFIXES:
        return
    prefix = ZIP_PREFIXES[role]
    index_name = prefix + ("SOURCE_MANIFEST.json" if role == "ms-human-source" else "catalog.json")
    index = _load_json(paths[index_name], 8 * 1024 * 1024)
    if not isinstance(index, dict):
        raise AssetSetupError("资源目录必须是 JSON 对象")
    expected = {item["path"]: item for item in asset["files"] if item["path"] != index_name}
    references = {}
    if role == "ms-human-source":
        files = index.get("files")
        if not isinstance(files, list) or not files:
            raise AssetSetupError("来源目录缺少完整 files 列表")
        for item in files:
            if not isinstance(item, dict):
                raise AssetSetupError("来源目录文件声明不合法")
            record = {key: item.get(key) for key in ("path", "bytes", "sha256")}
            _file_spec(record)
            path = prefix + record["path"]
            if path in references:
                raise AssetSetupError("来源目录引用重复")
            record["path"] = path
            references[path] = record
        if references != expected:
            raise AssetSetupError("ZIP 白名单与 SOURCE_MANIFEST 的完整引用集合／哈希不符")
    else:
        if type(index.get("schema")) is not int or index["schema"] != 1 or any(index.get(key) != manifest[key] for key in ("modelSha256", "computationSha256")) or index.get("model") != manifest["modelId"]:
            raise AssetSetupError("动作目录与发行模型／计算版本不符")
        motions = index.get("motions")
        if not isinstance(motions, list) or not motions:
            raise AssetSetupError("动作目录缺少 motions")
        ids = set()
        for motion in motions:
            if not isinstance(motion, dict) or not isinstance(motion.get("id"), str) or not motion["id"] or motion["id"] in ids:
                raise AssetSetupError("动作 ID 缺失或重复")
            ids.add(motion["id"])
            cached = motion.get("cachedResult")
            if not isinstance(cached, dict):
                raise AssetSetupError("动作缺少固定缓存引用")
            digest = _digest(cached.get("sha256"), "动作内容哈希")
            if cached.get("url") != f"./motion-cache/{digest}.json":
                raise AssetSetupError("动作缓存路径与内容哈希不符")
            path = prefix + digest + ".json.gz"
            size = cached.get("compressedBytes")
            if type(size) is not int or size <= 0 or path not in expected or size != expected[path]["bytes"]:
                raise AssetSetupError("动作目录引用了未声明或大小不符的 gzip 结果")
            references[path] = expected[path]
        if references != expected:
            raise AssetSetupError("动作 ZIP 含目录未引用的旧结果")


def prepare_assets(manifest, *, root=REPO, download=False, bundle_dir=None, timeout=30.0):
    """Verify first; stage every missing asset before publishing any new file.

    Publication is atomic per file and never replaces an existing file. A stop
    during publication can leave a valid subset; a later run verifies and reuses
    it. This is resource preparation, not model/publication validation.
    """
    validate_manifest(manifest)
    if type(download) is not bool or isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 < timeout <= 120:
        raise AssetSetupError("download 必须为布尔值，timeout 必须在 0 到 120 秒之间")
    if download and bundle_dir is not None:
        raise AssetSetupError("请选择网络下载或本地资源包恢复")
    root = _directory(root)
    if not root.is_dir():
        raise AssetSetupError("安装仓库根目录必须已经存在")
    for item in manifest["requiredFiles"]:
        if not _matches(root / item["path"], item):
            raise AssetSetupError(f"缺少同版代码／配套清单／许可文件：{item['path']}")
    records = []
    pending = []
    for asset in manifest["assets"]:
        asset_missing = False
        for item in asset["files"]:
            state = "reused" if _matches(root / item["path"], item) else "missing"
            records.append({"path": item["path"], "status": state})
            asset_missing |= state == "missing"
        if asset_missing:
            pending.append(asset)
        if asset["format"] == "zip":
            index_suffix = "SOURCE_MANIFEST.json" if asset["role"] == "ms-human-source" else "catalog.json"
            paths = {item["path"]: root / item["path"] for item in asset["files"]}
            if paths[ZIP_PREFIXES[asset["role"]] + index_suffix].is_file():
                _check_index(asset, paths, manifest)
    local_packages = {}
    if bundle_dir is not None:
        folder = _directory(bundle_dir)
        if not folder.is_dir():
            raise AssetSetupError("本地发行包目录不存在")
        for asset in manifest["assets"]:
            spec = {"path": asset["name"], "bytes": asset["bytes"], "sha256": asset["sha256"]}
            path = folder / spec["path"]
            if not _matches(path, spec):
                raise AssetSetupError(f"本地发行包缺少资源：{asset['name']}")
            local_packages[asset["name"]] = (path, spec)
    if (download or bundle_dir is not None) and pending:
        stage_parent = _directory(root / ".runtime-cache" / "release-assets", create=True)
        if not stage_parent.resolve().is_relative_to(root.resolve()):
            raise AssetSetupError("暂存目录超出仓库")
        with tempfile.TemporaryDirectory(prefix="install-", dir=stage_parent) as name:
            staging = Path(name)
            if not staging.resolve().is_relative_to(stage_parent.resolve()):
                raise AssetSetupError("临时目录超出已核对的暂存目录")
            prepared = {}
            for index, asset in enumerate(pending):
                archive = staging / f"asset-{index}.part"
                if bundle_dir is None:
                    _download(asset, archive, float(timeout))
                else:
                    path, spec = local_packages[asset["name"]]
                    with path.open("rb") as existing:
                        _write_checked(existing, archive, spec)
                if asset["format"] == "raw":
                    prepared[asset["files"][0]["path"]] = archive
                else:
                    unpacked = _unpack(asset, archive, staging / f"members-{index}")
                    _check_index(asset, unpacked, manifest)
                    prepared.update(unpacked)
            # Source files may be edited while downloads run; stop before linking
            # if code, licenses, metadata or a previously valid resource changed.
            reused = {row["path"] for row in records if row["status"] == "reused"}
            for item in manifest["requiredFiles"] + [item for asset in manifest["assets"] for item in asset["files"] if item["path"] in reused]:
                if not _matches(root / item["path"], item):
                    raise AssetSetupError("已核对的输入在资源准备期间消失")
            items = {item["path"]: item for asset in pending for item in asset["files"]}
            for row in records:
                if row["status"] != "missing":
                    continue
                item = items[row["path"]]
                target = root / item["path"]
                _directory(target.parent, create=True)
                if _matches(target, item):
                    row["status"] = "reused"
                    continue
                source = prepared[item["path"]]
                if not _matches(source, item):
                    raise AssetSetupError("待安装文件消失")
                try:
                    os.link(source, target)
                except FileExistsError:
                    if not _matches(target, item):
                        raise AssetSetupError("目标在安装时消失") from None
                    row["status"] = "reused"
                else:
                    if not _matches(target, item):
                        raise AssetSetupError("安装后文件消失")
                    row["status"] = "installed"
    return {"complete": all(row["status"] != "missing" for row in records),
            "releaseTag": manifest["releaseTag"], "fileCount": len(records), "files": records,
            "modelValidated": False, "publicationValidated": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True, help="验收后冻结的发行清单；本脚本不提供占位清单")
    parser.add_argument("--root", type=Path, default=REPO, help="已存在的对应版本仓库根目录")
    parser.add_argument("--timeout", type=float, default=30.0)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="只读离线核对，不创建目录")
    mode.add_argument("--download", action="store_true", help="显式下载缺失资源，校验后不覆盖安装")
    mode.add_argument("--from-bundle", type=Path, help="从本地同版发行包目录离线恢复，校验后不覆盖安装")
    args = parser.parse_args(argv)
    try:
        report = prepare_assets(load_manifest(args.manifest), root=args.root, download=args.download,
                                bundle_dir=args.from_bundle, timeout=args.timeout)
    except (AssetSetupError, OSError, ValueError, KeyError, TypeError, URLError, zipfile.BadZipFile,
            EOFError, zlib.error, NotImplementedError) as error:
        # urllib errors may contain signed CDN URLs; never print those URLs.
        message = str(error) if isinstance(error, AssetSetupError) else type(error).__name__
        print(json.dumps({"complete": False, "error": message}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["complete"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
