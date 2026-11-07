"""Narrow cache publication and HTTP behavior checks; no dynamics solve runs."""

from copy import deepcopy
import gzip
import hashlib
import http.client
from http.server import ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import zlib

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB))
import build_motion_cache as cache

SERVER_PATH = LAB.parent / "elbow-lab" / "server.py"
sys.path.insert(0, str(SERVER_PATH.parent))
spec = importlib.util.spec_from_file_location("motion_cache_test_server", SERVER_PATH)
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)


def fixture():
    identity = {"model": "test-model", "modelSha256": "a" * 64, "computationSha256": "b" * 64,
                "muscles": {"muscle"}, "coordinates": {"joint", "pelvis_ty"}, "internal": {"joint"}}
    scene = {"model": identity["model"], "keyframes": [{"t": 0, "q": {"joint": 0}},
             {"t": 1, "q": {"joint": 1}}], "loadKg": 0, "preview": False}
    frame = {"t": 0, "quantitativeValid": True, "frameFeasible": True, "muscleValid": True,
             "anatomy": {"valid": True}, "support": {"feasible": True, "baseResidual": {"pelvis_ty": 1}},
             "groundCheck": {"feasible": True}, "idealActuatorTorques": {}, "errors": [],
             "muscles": [{"name": "muscle", "force": 1, "activeCapacity": 2,
                          "passiveForce": 0, "activation": 0.5}],
             "recruitment": {"internalCoordinatesIncluded": 1}, "balanceErrorNm": 0,
             "nativeForceErrorN": 0, "jointLimitTorques": {}}
    for key in ("torques", "rawTorques", "muscleTorques", "passiveTorques", "jointPassiveTorques", "reserveTorques"):
        frame[key] = {"joint": 0, "pelvis_ty": 0}
    frames = []
    for time, q in cache.trajectory(scene):
        item = deepcopy(frame)
        item.update(t=time, q=q)
        frames.append(item)
    result = {"model": identity["model"], "computationSha256": identity["computationSha256"],
              "status": "solved", "quantitativeValid": True, "kinematicOnly": False, "failures": [],
              "scene": deepcopy(scene), "frames": frames,
              "metrics": {"frames": len(frames), "failedFrames": 0, "allMusclesFeasible": True,
                          "musclesIncluded": 1, "durationSeconds": 1}}
    catalog = {key: identity[key] for key in ("model", "modelSha256", "computationSha256")}
    catalog.update(status="passed", sourceStable=True, generatedAt="2026-11-03T00:00:00Z",
                   modelSha256After=identity["modelSha256"], computationSha256After=identity["computationSha256"])
    motion = {"id": "test", "scene": deepcopy(scene), "verification": {"verified": True, "frames": len(frames)}}
    return catalog, motion, scene, result, identity


class ValidationTests(unittest.TestCase):
    def test_hand_passive_terms_are_complete_and_counted_once(self):
        data = fixture()
        data[4]["handReferenceCoordinates"] = {"joint"}
        for frame in data[3]["frames"]:
            frame["handReferenceTorques"] = {"joint": 0.2}
            frame["otherJointPassiveTorques"] = {"joint": 0.3, "pelvis_ty": 0}
            frame["externalTorques"] = {"joint": 0.1, "pelvis_ty": 0}
            frame["rawTorques"]["joint"] = 1
            frame["jointPassiveTorques"]["joint"] = 0.5
            frame["torques"]["joint"] = frame["muscleTorques"]["joint"] = 0.4
        cache.validate_result(*data, lambda value: value)
        for mutate in (lambda f: f.pop("handReferenceTorques"),
                       lambda f: f["handReferenceTorques"].update(joint=None),
                       lambda f: f["handReferenceTorques"].update(extra=0),
                       lambda f: f["handReferenceTorques"].update(joint=0.4),
                       lambda f: f["otherJointPassiveTorques"].update(joint=0.5),
                       lambda f: f["externalTorques"].update(joint=0.2)):
            bad = deepcopy(data)
            mutate(bad[3]["frames"][1])
            with self.assertRaises(ValueError):
                cache.validate_result(*bad, lambda value: value)
        for frame in data[3]["frames"]:
            frame["handReferenceTorques"]["joint"] = 0
            frame["otherJointPassiveTorques"]["joint"] = 0.5
        cache.validate_result(*data, lambda value: value)

    def test_truncated_retimed_and_wrong_pose_results_are_rejected(self):
        data = fixture()
        truncated = deepcopy(data)
        result = truncated[3]
        result["frames"] = [result["frames"][0], result["frames"][-1]]
        result["metrics"]["frames"] = 2
        truncated[1]["verification"]["frames"] = 2
        with self.assertRaisesRegex(ValueError, "采样帧"):
            cache.validate_result(*truncated, lambda value: value)
        for mutation in (lambda d: d[3]["frames"][1].update(t=0.09),
                         lambda d: d[1]["verification"].update(frames=2),
                         lambda d: d[3]["frames"][1]["q"].update(joint=0.8)):
            bad = deepcopy(data)
            mutation(bad)
            with self.assertRaises(ValueError):
                cache.validate_result(*bad, lambda value: value)

    def test_declared_branches_require_complete_consistent_forces(self):
        data = fixture()
        definitions = [{"id": "main", "coefficient": 1.0}, {"id": "CS", "coefficient": 0.495}]
        data[4]["branches"] = {"muscle": definitions}
        for frame in data[3]["frames"]:
            muscle = frame["muscles"][0]
            muscle["path"] = [[0, 0, 0], [0, 1, 0]]
            muscle["branches"] = [{**definition, "force": definition["coefficient"],
                                   "path": [[index, 0, 0], [index, 1, 0]]}
                                  for index, definition in enumerate(definitions)]
        cache.validate_result(*data, lambda value: value)
        for mutate in (lambda m: m.pop("branches"),
                       lambda m: m["branches"][1].update(force=None),
                       lambda m: m["branches"][1].update(force=1),
                       lambda m: m["branches"][1].update(coefficient=0.4),
                       lambda m: m["branches"][1].update(path=[[1, 0, 0]])):
            bad = deepcopy(data)
            mutate(bad[3]["frames"][0]["muscles"][0])
            with self.assertRaises(ValueError):
                cache.validate_result(*bad, lambda value: value)

    def test_complete_case_and_rejections(self):
        data = fixture()
        cache.validate_result(*data, lambda value: value)
        for mutation in (lambda d: d[0].update(computationSha256="old"),
                         lambda d: d[0].update(sourceStable=False),
                         lambda d: d[3].update(status="infeasible"),
                         lambda d: d[3].update(kinematicOnly=True),
                         lambda d: d[3]["frames"][0]["muscles"][0].update(force=None),
                         lambda d: d[3]["frames"][0]["muscles"][0].update(activation=1.1),
                         lambda d: d[3]["frames"][0]["muscleTorques"].pop("joint"),
                         lambda d: d[3]["scene"].update(loadKg=3)):
            changed = deepcopy(data)
            mutation(changed)
            with self.assertRaises(ValueError):
                cache.validate_result(*changed, lambda value: value)

    def test_loaded_case_requires_contact_forces(self):
        catalog, motion, scene, result, identity = fixture()
        scene["loadKg"] = motion["scene"]["loadKg"] = result["scene"]["loadKg"] = 1
        with self.assertRaisesRegex(ValueError, "握持"):
            cache.validate_result(catalog, motion, scene, result, identity, lambda value: value)
        for frame in result["frames"]:
            frame["grasp"] = {"geometryValid": True, "feasible": True,
                "objectResidualForceN": 0, "objectResidualMomentNm": 0,
                "contacts": [{"normalN": 1, "frictionMarginN": 0, "forceOnObject": [0, 1, 0]}]}
        cache.validate_result(catalog, motion, scene, result, identity, lambda value: value)
        result["frames"][0]["grasp"]["contacts"][0]["forceOnObject"] = [0, None, 0]
        with self.assertRaisesRegex(ValueError, "接触力"):
            cache.validate_result(catalog, motion, scene, result, identity, lambda value: value)

    def test_json_finiteness_and_artifact_paths(self):
        for raw in ('{"x":NaN}', '{"x":Infinity}', '{"x":1e999}'):
            with self.assertRaises(ValueError):
                cache.load_json(raw)
        for name in ("../outside.json", "nested/case.json", "nested\\case.json", ""):
            with self.assertRaises(ValueError):
                cache.artifact_path(LAB, name)


class CacheHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.root = Path(cls.directory.name)
        (cls.root / "motion-cache").mkdir()
        cls.raw = json.dumps({"result": "preserved", "numbers": [0, 1, 2]}).encode()
        cls.digest = hashlib.sha256(cls.raw).hexdigest()
        cls.compressed = gzip.compress(cls.raw, mtime=0)
        (cls.root / "motion-cache" / (cls.digest + ".json.gz")).write_bytes(cls.compressed)
        (cls.root / "motion-cache/catalog.json").write_text('{"motions":[]}', encoding="utf-8")
        cls.body_patch = patch.object(server_module, "BODY", cls.root)
        cls.body_patch.start()
        cls.log_patch = patch.object(server_module.LabHandler, "log_message", lambda *args: None)
        cls.log_patch.start()
        cls.http = ThreadingHTTPServer(("127.0.0.1", 0), server_module.LabHandler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
        cls.body_patch.stop()
        cls.log_patch.stop()
        cls.directory.cleanup()

    def request(self, method, path=None, encoding="gzip"):
        connection = http.client.HTTPConnection("127.0.0.1", self.http.server_port)
        connection.request(method, path or f"/experiments/body-lab/motion-cache/{self.digest}.json",
                           headers={"Accept-Encoding": encoding})
        response = connection.getresponse()
        value = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return value

    def test_gzip_get_head_and_identity_fallback(self):
        status, headers, body = self.request("GET")
        self.assertEqual(status, 200)
        self.assertEqual(gzip.decompress(body), self.raw)
        self.assertEqual(headers["Content-Encoding"], "gzip")
        self.assertIn("immutable", headers["Cache-Control"])
        self.assertEqual(headers["Vary"], "Accept-Encoding")
        status, head, body = self.request("HEAD")
        self.assertEqual(status, 200)
        self.assertEqual(body, b"")
        self.assertEqual(int(head["Content-Length"]), len(self.compressed))
        for encoding in ("identity", "gzip;q=0, *;q=1"):
            status, headers, body = self.request("GET", encoding=encoding)
            self.assertEqual(status, 200)
            self.assertEqual(body, self.raw)
            self.assertNotIn("Content-Encoding", headers)
            _, headers, body = self.request("HEAD", encoding=encoding)
            self.assertEqual(body, b"")
            self.assertEqual(int(headers["Content-Length"]), len(self.raw))

    def test_manifest_and_unlisted_paths(self):
        status, headers, _ = self.request("GET", "/experiments/body-lab/motion-cache/catalog.json")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-cache")
        for path in ("../server.py", "%2e%2e/server.py", "anything.json", self.digest + ".json.gz", "c" * 64 + ".json"):
            self.assertEqual(self.request("GET", "/experiments/body-lab/motion-cache/" + path)[0], 404)

    def test_rejected_encodings_get_and_head(self):
        for encoding in ("gzip;q=0, identity;q=0", "gzip;q=0, identity;q=0, *;q=1", "*;q=0"):
            for method in ("GET", "HEAD"):
                with self.subTest(encoding=encoding, method=method):
                    status, headers, body = self.request(method, encoding=encoding)
                    self.assertEqual(status, 406)
                    self.assertNotIn("immutable", headers["Cache-Control"])
                    self.assertNotIn("Content-Encoding", headers)
                    self.assertEqual(len(body), 0 if method == "HEAD" else int(headers["Content-Length"]))
        self.assertEqual(self.request("GET", encoding="gzip;q=1, identity;q=0, *;q=0")[0], 200)

    def test_corrupt_cache_get_and_head(self):
        # Deflate's reserved block type raises zlib.error, not gzip.BadGzipFile.
        invalid_deflate = bytes.fromhex("1f8b0800000000000003") + b"\x07" + b"\0" * 8
        with self.assertRaises(zlib.error):
            gzip.decompress(invalid_deflate)
        corruptions = (b"not gzip", self.compressed[:-5], invalid_deflate,
                       gzip.compress(b'{"different":"content"}', mtime=0))
        for index, compressed in enumerate(corruptions):
            digest = hashlib.sha256(f"corruption-{index}".encode()).hexdigest()
            (self.root / "motion-cache" / (digest + ".json.gz")).write_bytes(compressed)
            path = f"/experiments/body-lab/motion-cache/{digest}.json"
            for method in ("GET", "HEAD"):
                for encoding in ("gzip", "identity"):
                    with self.subTest(index=index, method=method, encoding=encoding):
                        status, headers, body = self.request(method, path, encoding)
                        self.assertEqual(status, 503)
                        self.assertNotIn("immutable", headers["Cache-Control"])
                        self.assertNotIn("ETag", headers)
                        self.assertNotIn("Content-Encoding", headers)
                        self.assertEqual(len(body), 0 if method == "HEAD" else int(headers["Content-Length"]))

    def test_verified_file_reuse_and_changed_file_recheck(self):
        raw = b'{"case":"recheck"}'
        digest = hashlib.sha256(raw).hexdigest()
        compressed = gzip.compress(raw, mtime=0)
        target = self.root / "motion-cache" / (digest + ".json.gz")
        target.write_bytes(compressed)
        path = f"/experiments/body-lab/motion-cache/{digest}.json"
        with patch.object(server_module.gzip, "GzipFile", wraps=gzip.GzipFile) as open_stream:
            self.assertEqual(self.request("GET", path)[0], 200)
            self.assertEqual(self.request("HEAD", path)[0], 200)
            self.assertEqual(open_stream.call_count, 1)
            prior = target.stat()
            target.write_bytes(b"x" * len(compressed))
            os.utime(target, ns=(prior.st_atime_ns, prior.st_mtime_ns + 1_000_000_000))
            self.assertEqual(self.request("GET", path)[0], 503)
            self.assertEqual(open_stream.call_count, 2)


if __name__ == "__main__":
    unittest.main()
