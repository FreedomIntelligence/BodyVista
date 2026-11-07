"""Offline tiny-sample checks; temporary files stay on the repository's drive."""
import hashlib
import io
import json
from pathlib import Path
import stat
import struct
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from urllib.request import Request
import warnings
import zipfile

import setup_release_assets as S


def record(path, data):
    return {"path": path, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def manifest(assets):
    return {"schema": 1, "repository": S.REPOSITORY, "releaseTag": "test-offline-v1",
            "sourceCommit": "a" * 40, "modelId": "offline-fixture",
            "modelSha256": "b" * 64, "computationSha256": "c" * 64,
            "requiredFiles": [record("README.md", b"fixture notice")], "assets": assets}


def raw_asset(data=b"tiny", role="bone-volumes"):
    item = record(S.RAW_TARGETS[role], data)
    name = role + ".bin"
    return {"role": role, "name": name, "format": "raw", "bytes": len(data), "sha256": item["sha256"],
            "url": f"https://github.com/{S.REPOSITORY}/releases/download/test-offline-v1/{name}", "files": [item]}


def source_index_bytes():
    return json.dumps({"files": [record("LICENSE", b"tiny license")]}).encode()


def zip_asset(members=None, listed=None):
    prefix = S.ZIP_PREFIXES["ms-human-source"]
    members = members if members is not None else [(prefix + "SOURCE_MANIFEST.json", source_index_bytes()), (prefix + "LICENSE", b"tiny license")]
    output = io.BytesIO()
    with warnings.catch_warnings(), zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        warnings.simplefilter("ignore", UserWarning)
        for name, data in members:
            archive.writestr(name, data)
    data = output.getvalue()
    files = listed if listed is not None else [record(name.filename if isinstance(name, zipfile.ZipInfo) else name, value) for name, value in members]
    return {"role": "ms-human-source", "name": "source.zip", "format": "zip", "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(),
            "url": f"https://github.com/{S.REPOSITORY}/releases/download/test-offline-v1/source.zip", "files": files}, data


class Response(io.BytesIO):
    def __init__(self, data, url, headers=None, status=200):
        super().__init__(data)
        self.url, self.status = url, status
        self.headers = {"Content-Length": str(len(data)), "Content-Encoding": "identity"} if headers is None else headers

    def geturl(self):
        return self.url

    def getcode(self):
        return self.status


class ReleaseAssetTests(unittest.TestCase):
    def setUp(self):
        base = S._directory(S.REPO / ".runtime-cache" / "release-asset-tests", create=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="tiny-", dir=base)
        self.root = Path(self.temporary.name)
        self.assertTrue(self.root.resolve().is_relative_to(base.resolve()))
        self.addCleanup(self.temporary.cleanup)
        (self.root / "README.md").write_bytes(b"fixture notice")
        self.responses = {}
        self.requests = []

        def fake_open(request, timeout):
            self.requests.append(request)
            response = self.responses.get(request.full_url)
            if response is None:
                raise AssertionError("Tests must never access the network")
            return response()

        self.open_patch = patch.object(S, "build_opener", return_value=Mock(open=fake_open))
        self.build_opener = self.open_patch.start()
        self.addCleanup(self.open_patch.stop)

    def serve(self, asset, data, **kwargs):
        self.responses[asset["url"]] = lambda: Response(data, kwargs.get("url", asset["url"]), kwargs.get("headers"), kwargs.get("status", 200))

    def install(self, assets, **kwargs):
        return S.prepare_assets(manifest(assets), root=self.root, **kwargs)

    def assert_absent(self, asset):
        for item in asset["files"]:
            self.assertFalse((self.root / item["path"]).exists())

    def test_check_missing_is_read_only_and_offline(self):
        before = list(self.root.rglob("*"))
        result = self.install([raw_asset()])
        self.assertFalse(result["complete"])
        self.assertEqual(before, list(self.root.rglob("*")))
        self.build_opener.assert_not_called()

    def test_valid_raw_install_reuse_and_offline_check(self):
        asset = raw_asset()
        self.serve(asset, b"tiny")
        result = self.install([asset], download=True)
        self.assertTrue(result["complete"])
        self.assertEqual(result["files"][0]["status"], "installed")
        self.assertFalse(result["modelValidated"])
        self.assertEqual(self.requests[0].get_header("Accept-encoding"), "identity")
        self.assertEqual((self.root / asset["files"][0]["path"]).read_bytes(), b"tiny")
        self.install([asset], download=True)
        self.install([asset])
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(list((self.root / ".runtime-cache/release-assets").iterdir()), [])

    def test_existing_invalid_file_is_preserved_before_network(self):
        asset = raw_asset()
        target = self.root / asset["files"][0]["path"]
        target.parent.mkdir(parents=True)
        target.write_bytes(b"evil")
        with self.assertRaisesRegex(S.AssetSetupError, "SHA-256"):
            self.install([asset], download=True)
        self.assertEqual(target.read_bytes(), b"evil")
        self.build_opener.assert_not_called()

    def test_required_file_mismatch_stops_before_network(self):
        (self.root / "README.md").write_bytes(b"wrong notice")
        with self.assertRaises(S.AssetSetupError):
            self.install([raw_asset()], download=True)
        self.build_opener.assert_not_called()

    def test_bad_response_cannot_install_raw(self):
        asset = raw_asset()
        cases = [(b"evil", {}), (b"tin", {"headers": {}}), (b"tiny!", {"headers": {}}),
                 (b"tiny", {"headers": {"Content-Encoding": "gzip"}}),
                 (b"tiny", {"headers": {"Content-Length": "100"}}),
                 (b"tiny", {"status": 206}), (b"tiny", {"url": "https://evil.example/asset"})]
        for data, options in cases:
            with self.subTest(data=data, options=options):
                self.serve(asset, data, **options)
                with self.assertRaises(S.AssetSetupError):
                    self.install([asset], download=True)
                self.assert_absent(asset)

    def test_valid_zip_installs_declared_files(self):
        asset, data = zip_asset()
        self.serve(asset, data)
        self.assertTrue(self.install([asset], download=True)["complete"])
        self.assertEqual((self.root / asset["files"][1]["path"]).read_bytes(), b"tiny license")

    def test_zip_extra_missing_traversal_duplicate_and_symlink_rejected(self):
        valid, _ = zip_asset()
        prefix = S.ZIP_PREFIXES["ms-human-source"]
        base = [(prefix + "SOURCE_MANIFEST.json", source_index_bytes()), (prefix + "LICENSE", b"tiny license")]
        symbolic = zipfile.ZipInfo(prefix + "LICENSE")
        symbolic.create_system = 3
        symbolic.external_attr = (stat.S_IFLNK | 0o777) << 16
        cases = [base + [(prefix + "extra.txt", b"x")], base[:1],
                 base + [("../outside", b"x")], base + [base[0]],
                 base[:1] + [(symbolic, b"tiny license")],
                 base + [(prefix + "license", b"tiny license")]]
        for members in cases:
            with self.subTest(names=[str(x[0]) for x in members]):
                asset, data = zip_asset(members, valid["files"])
                self.serve(asset, data)
                with self.assertRaises(S.AssetSetupError):
                    self.install([asset], download=True)
                self.assert_absent(asset)

    def test_zip_member_hash_checked_even_when_archive_hash_matches(self):
        valid, _ = zip_asset()
        prefix = S.ZIP_PREFIXES["ms-human-source"]
        asset, data = zip_asset([(prefix + "SOURCE_MANIFEST.json", source_index_bytes()), (prefix + "LICENSE", b"fake license")], valid["files"])
        self.serve(asset, data)
        with self.assertRaisesRegex(S.AssetSetupError, "SHA-256"):
            self.install([asset], download=True)
        self.assert_absent(asset)

    def test_eocd_limits_reject_before_zipfile_constructor(self):
        asset, original = zip_asset()
        offset = original.rfind(b"PK\x05\x06")
        fields = list(struct.unpack_from("<4s4H2IH", original, offset))

        def altered(changes):
            replacement = fields.copy()
            for index, value in changes.items():
                replacement[index] = value
            return original[:offset] + struct.pack("<4s4H2IH", *replacement)

        cases = {
            "too-many-members": altered({3: 65534, 4: 65534}),
            "oversized-central-directory": altered({5: S.MAX_CENTRAL_DIRECTORY_BYTES + 1}),
            "zip64-sentinel": altered({3: 65535, 4: 65535}),
            "multiple-volumes": altered({1: 1}),
            "wrong-directory-position": altered({6: fields[6] + 1}),
            "truncated-eocd": original[:-1],
            "zip64-locator": original[:offset] + b"PK\x06\x07" + b"\0" * 16 + original[offset:],
        }
        path = self.root / "tiny-malformed.zip"
        for label, data in cases.items():
            with self.subTest(case=label):
                path.write_bytes(data)
                with patch.object(S.zipfile, "ZipFile") as parser, self.assertRaises(S.AssetSetupError):
                    S._unpack(asset, path, self.root / "unused-staging")
                parser.assert_not_called()
        self.assertFalse((self.root / "unused-staging").exists())

    def test_central_record_count_cannot_hide_behind_small_eocd_count(self):
        valid, _ = zip_asset()
        prefix = S.ZIP_PREFIXES["ms-human-source"]
        asset, data = zip_asset([(prefix + "SOURCE_MANIFEST.json", source_index_bytes()),
                                (prefix + "LICENSE", b"tiny license"), (prefix, b"")], valid["files"])
        offset = data.rfind(b"PK\x05\x06")
        fields = list(struct.unpack_from("<4s4H2IH", data, offset))
        fields[3] = fields[4] = 2
        path = self.root / "tiny-hidden-member.zip"
        path.write_bytes(data[:offset] + struct.pack("<4s4H2IH", *fields))
        with patch.object(S.zipfile, "ZipFile") as parser, self.assertRaisesRegex(S.AssetSetupError, "实际成员数"):
            S._unpack(asset, path, self.root / "unused-staging")
        parser.assert_not_called()

    def test_zip64_extra_and_oversized_member_metadata_rejected_before_zipfile(self):
        valid, _ = zip_asset()
        prefix = S.ZIP_PREFIXES["ms-human-source"]
        extras = [struct.pack("<HH", 1, 0),
                  struct.pack("<HH", 0xCAFE, S.MAX_ZIP_EXTRA_BYTES) + b"x" * S.MAX_ZIP_EXTRA_BYTES]
        for extra in extras:
            member = zipfile.ZipInfo(prefix + "LICENSE")
            member.extra = extra
            asset, data = zip_asset([(prefix + "SOURCE_MANIFEST.json", source_index_bytes()),
                                    (member, b"tiny license")], valid["files"])
            path = self.root / "tiny-extra.zip"
            path.write_bytes(data)
            with patch.object(S.zipfile, "ZipFile") as parser, self.assertRaises(S.AssetSetupError):
                S._unpack(asset, path, self.root / "unused-staging")
            parser.assert_not_called()

    def test_path_limits_apply_before_any_directory_expansion(self):
        cases = ["x" * (S.MAX_COMPONENT_CHARS + 1),
                 "/".join(["x"] * (S.MAX_PATH_DEPTH + 1)),
                 "/".join(["x" * 205] * 5)]
        for path in cases:
            value = manifest([raw_asset()])
            value["requiredFiles"][0]["path"] = path
            with self.subTest(path_size=len(path)), patch.object(S, "_directory") as directory, self.assertRaises(S.AssetSetupError):
                S.prepare_assets(value, root=self.root, download=True)
            directory.assert_not_called()
        self.build_opener.assert_not_called()

    def test_zip_path_limits_apply_before_zipinfo_allocation(self):
        valid, _ = zip_asset()
        prefix = S.ZIP_PREFIXES["ms-human-source"]
        for path in (prefix + "x" * 256, prefix + "/".join(["x"] * 33)):
            asset, data = zip_asset([(prefix + "SOURCE_MANIFEST.json", source_index_bytes()), (path, b"tiny license")], valid["files"])
            archive = self.root / "tiny-long-path.zip"
            archive.write_bytes(data)
            with patch.object(S.zipfile, "ZipFile") as parser, self.assertRaises(S.AssetSetupError):
                S._unpack(asset, archive, self.root / "unused-staging")
            parser.assert_not_called()

    def test_zip_cannot_omit_files_referenced_by_source_index(self):
        prefix = S.ZIP_PREFIXES["ms-human-source"]
        source_index = json.dumps({"files": [record("missing.xml", b"missing")]}).encode()
        asset, data = zip_asset([(prefix + "SOURCE_MANIFEST.json", source_index)])
        self.serve(asset, data)
        with self.assertRaisesRegex(S.AssetSetupError, "完整引用集合"):
            self.install([asset], download=True)
        self.assert_absent(asset)

    def test_motion_index_must_match_version_and_every_gzip_member(self):
        digest = hashlib.sha256(b"tiny-result").hexdigest()
        prefix = S.ZIP_PREFIXES["motion-cache"]
        item = record(prefix + digest + ".json.gz", b"tiny-gzip")
        value = manifest([])
        index = {"schema": 1, "model": value["modelId"], "modelSha256": value["modelSha256"],
                 "computationSha256": value["computationSha256"], "motions": [{"id": "tiny",
                 "cachedResult": {"url": f"./motion-cache/{digest}.json", "sha256": digest, "compressedBytes": item["bytes"]}}]}
        index_path = self.root / "tiny-index.json"
        index_data = json.dumps(index).encode()
        index_path.write_bytes(index_data)
        asset = {"role": "motion-cache", "files": [record(prefix + "catalog.json", index_data), item]}
        paths = {prefix + "catalog.json": index_path}
        S._check_index(asset, paths, value)
        index["computationSha256"] = "d" * 64
        index_path.write_text(json.dumps(index), encoding="utf8")
        with self.assertRaisesRegex(S.AssetSetupError, "计算版本"):
            S._check_index(asset, paths, value)
        index["computationSha256"] = value["computationSha256"]
        index["motions"][0]["cachedResult"]["compressedBytes"] += 1
        index_path.write_text(json.dumps(index), encoding="utf8")
        with self.assertRaisesRegex(S.AssetSetupError, "大小不符"):
            S._check_index(asset, paths, value)

    def test_every_asset_is_staged_before_any_publication(self):
        first, second = raw_asset(), raw_asset(b"next", "atlas-muscles")
        self.serve(first, b"tiny")
        self.serve(second, b"evil")
        with self.assertRaises(S.AssetSetupError):
            self.install([first, second], download=True)
        self.assert_absent(first)
        self.assert_absent(second)

    def test_racing_existing_target_is_never_overwritten(self):
        asset = raw_asset()
        self.serve(asset, b"tiny")
        target = self.root / asset["files"][0]["path"]

        def racing_link(source, destination):
            Path(destination).write_bytes(b"evil")
            raise FileExistsError

        with patch.object(S.os, "link", side_effect=racing_link), self.assertRaises(S.AssetSetupError):
            self.install([asset], download=True)
        self.assertEqual(target.read_bytes(), b"evil")

    def test_hard_link_failure_has_no_replace_fallback(self):
        asset = raw_asset()
        self.serve(asset, b"tiny")
        with patch.object(S.os, "link", side_effect=OSError("unsupported")), self.assertRaises(OSError):
            self.install([asset], download=True)
        self.assert_absent(asset)

    def test_manifest_rejects_paths_urls_and_ambiguous_identity(self):
        mutations = [lambda x: x.update(schema=True), lambda x: x.update(releaseTag="latest"),
                     lambda x: x.update(sourceCommit="pending"), lambda x: x.update(modelSha256="TODO"),
                     lambda x: x["assets"][0].update(url="https://example.com/resource.bin"),
                     lambda x: x["assets"][0]["files"][0].update(path="../outside"),
                     lambda x: x["assets"][0]["files"][0].update(path=S.LAB + "app.js"),
                     lambda x: x["assets"][0].update(bytes=True),
                     lambda x: x["requiredFiles"].append(record("readme.md", b"case collision")),
                     lambda x: x["requiredFiles"][0].update(path="CON.txt")]
        for mutate in mutations:
            value = manifest([raw_asset()])
            mutate(value)
            with self.subTest(value=value), self.assertRaises(S.AssetSetupError):
                S.prepare_assets(value, root=self.root, download=True)
        self.build_opener.assert_not_called()

    def test_duplicate_json_keys_and_draft_manifest_are_rejected(self):
        path = self.root / "test-manifest.json"
        path.write_text('{"schema":1,"schema":1}', encoding="utf8")
        with self.assertRaisesRegex(S.AssetSetupError, "重复 JSON"):
            S.load_manifest(path)
        path.write_text('{"schema":1,"status":"draft"}', encoding="utf8")
        with self.assertRaises(S.AssetSetupError):
            S.load_manifest(path)

    def test_redirect_whitelist_and_final_cdn_response(self):
        asset = raw_asset()
        handler = S.ReleaseRedirects(asset["url"])
        request = Request(asset["url"])
        accepted = "https://release-assets.githubusercontent.com/github-production-release-asset/test?signature=temporary"
        self.assertIsInstance(handler.redirect_request(request, None, 302, "Found", {}, accepted), Request)
        for url in ("http://release-assets.githubusercontent.com/file", "https://evil.example/file",
                    "https://release-assets.githubusercontent.com.evil.example/file", "https://user@release-assets.githubusercontent.com/file",
                    "https://release-assets.githubusercontent.com:444/file", "https://github.com/another/repository/file"):
            with self.subTest(url=url), self.assertRaises(S.AssetSetupError):
                handler.redirect_request(request, None, 302, "Found", {}, url)
        self.serve(asset, b"tiny", url=accepted)
        self.assertTrue(self.install([asset], download=True)["complete"])

    def test_reparse_point_is_rejected(self):
        info = SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0x400)
        with self.assertRaisesRegex(S.AssetSetupError, "重解析点"):
            S._reject_link(info, self.root)

    def test_windows_path_handle_timestamp_difference_does_not_skip_mutation_checks(self):
        target = self.root / "README.md"
        actual = target.lstat()
        common = {key: getattr(actual, key) for key in ("st_dev", "st_ino", "st_mode", "st_size", "st_mtime_ns")}
        path_info = SimpleNamespace(**common, st_ctime_ns=100, st_birthtime_ns=100)
        handle_info = SimpleNamespace(**common, st_ctime_ns=200, st_birthtime_ns=100)
        with patch.object(S, "_directory"), patch.object(Path, "lstat", return_value=path_info), patch.object(S.os, "fstat", return_value=handle_info):
            self.assertTrue(S._matches(target, record("README.md", b"fixture notice")))
        changed = SimpleNamespace(**common, st_ctime_ns=201, st_birthtime_ns=100)
        with patch.object(S, "_directory"), patch.object(Path, "lstat", return_value=path_info), patch.object(S.os, "fstat", side_effect=[handle_info, changed]), self.assertRaisesRegex(S.AssetSetupError, "校验时发生变化"):
            S._matches(target, record("README.md", b"fixture notice"))


if __name__ == "__main__":
    unittest.main()
