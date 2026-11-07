"""Offline release-stage checks; no native model, browser, or force computation."""
import json
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch

import freeze_release_evidence as freeze


def png(shade=0, width=1600, height=1050):
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    pixels = (b"\0" + bytes([shade]) * width) * height
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(pixels, 1)) + chunk(b"IEND", b""))


class ReleaseStages(unittest.TestCase):
    def setUp(self):
        cache = freeze.ROOT / ".runtime-cache"
        cache.mkdir(exist_ok=True)
        temp = tempfile.TemporaryDirectory(dir=cache)
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.marker = self.root / "model-ready.json"
        self.ui = self.root / "ui.json"
        for name, value in (("MARKER", self.marker), ("UI", self.ui)):
            mock = patch.object(freeze, name, value)
            mock.start()
            self.addCleanup(mock.stop)
        self.identity = {"model": freeze.MODEL, "modelSha256": "a" * 64, "computationSha256": freeze.COMPUTATION}
        self.doc = {**self.identity, "ready": True, "publicationValidated": False}
        self.file = self.root / "browser.json"
        self.cache_sha = "e" * 64
        stamp = lambda i: f"2026-11-07T12:00:{i:02d}Z"
        self.cache_path = "/experiments/body-lab/motion-cache/" + self.cache_sha + ".json"
        checks, shots = [], []
        for i, (name, label) in enumerate(freeze.BROWSER_CHECKS.items(), 1):
            check = {"name": name, "passed": True, "at": stamp(i * 2)}
            if label:
                filename = label + ".png"
                (self.root / filename).write_bytes(png(i))
                check["screenshot"] = filename
                shots.append({"name": label, "file": filename})
            checks.append(check)
        checks[1].update(frames=50, musclesPerFrame=740, solveRequests=1)
        checks[5].update(self.identity, cacheRequests=1, solveRequests=0, caseId="elbow",
                         cacheUrl="http://localhost:4192" + self.cache_path)
        checks[-1]["count"] = 0
        self.raw = {"status": "passed", "candidatePreview": False, "fixedCacheValidated": True, "pageErrors": [],
                    "expectedModel": freeze.MODEL, "model": {"id": freeze.MODEL, "sourceSha256": "a"*64,
                    "computationSha256": freeze.COMPUTATION}, "pageUrl": "http://localhost:4192/experiments/body-lab/",
                    "scriptSha256": freeze.digest((freeze.HERE / "browser-check.mjs").read_bytes()),
                    "fixtureSha256": freeze.SOURCES["custom"][1], "fixtureId": "custom_right_rotate_bend_make_fist",
                    "startedAt": stamp(0), "completedAt": stamp(17), "checks": checks, "screenshots": shots,
                    "network": [{"method": "POST", "path": "/api/fullbody/solve", "at": stamp(3)},
                                {"method": "GET", "path": self.cache_path, "at": stamp(11)}]}
        self.file.write_bytes(freeze.encoded(self.raw))

    def test_web_from_browser_native_schema_and_idempotent_both_stages(self):
        freeze.model_ready(self.doc)
        first = self.marker.stat().st_mtime_ns
        freeze.model_ready(self.doc)
        self.assertEqual(self.marker.stat().st_mtime_ns, first)
        library = {"cases": 11, "frames": 803}
        with patch.object(freeze, "release_cache", return_value=library):
            freeze.web_ready(self.doc, self.file)
            result = json.loads(self.ui.read_bytes())
            self.assertTrue(result["fixedCacheValidated"])
            self.assertEqual(result["motionLibrary"], library)
            self.assertEqual(result["computationSha256"], freeze.COMPUTATION)
            for record in [*result["screenshots"].values(), result["browserEvidence"]]:
                self.assertFalse(Path(record["path"]).is_absolute())
                self.assertEqual(record["sha256"], freeze.digest((freeze.ROOT / record["path"]).read_bytes()))
            final = self.marker.read_bytes()
            freeze.web_ready(self.doc, self.file)
            freeze.model_ready(self.doc)
            self.assertEqual(self.marker.read_bytes(), final)
            self.assertIs(json.loads(final)["publicationValidated"], True)

    def test_preview_stale_or_incomplete_web_and_extra_post_do_not_promote(self):
        freeze.model_ready(self.doc)
        for name, change in (
            ("preview", lambda r: r.update(candidatePreview=True)),
            ("model", lambda r: r["model"].update(computationSha256="c"*64)),
            ("missing-check", lambda r: r["checks"].pop(3)),
            ("error", lambda r: r["pageErrors"].append("error")),
            ("missing-shot", lambda r: r["screenshots"].pop()),
            ("extra-post", lambda r: r["network"].append({"path": "/api/fullbody/pose", "method": "POST",
                                                         "at": "2026-11-07T12:00:11Z"})),
        ):
            with self.subTest(name=name):
                raw = json.loads(freeze.encoded(self.raw))
                change(raw)
                self.file.write_bytes(freeze.encoded(raw))
                with self.assertRaises(ValueError):
                    freeze.web_ready(self.doc, self.file)
                self.assertFalse(self.ui.exists())
                self.assertIs(json.loads(self.marker.read_bytes())["publicationValidated"], False)

    def test_corrupt_png_or_absent_library_cannot_write_final_marker(self):
        freeze.model_ready(self.doc)
        shot = self.root / self.raw["screenshots"][0]["file"]
        original = shot.read_bytes()
        duplicate = (self.root / self.raw["screenshots"][1]["file"]).read_bytes()
        for invalid in (original[:-7], png(1, 1, 1), duplicate):
            shot.write_bytes(invalid)
            with self.assertRaises(ValueError):
                freeze.web_ready(self.doc, self.file)
        shot.write_bytes(original)
        with patch.object(freeze, "release_cache", side_effect=ValueError("缓存不完整")), self.assertRaises(ValueError):
            freeze.web_ready(self.doc, self.file)
        self.assertFalse(self.ui.exists())
        self.assertIs(json.loads(self.marker.read_bytes())["publicationValidated"], False)


if __name__ == "__main__":
    unittest.main()
