"""Use tiny local fixtures for the packer/installer contract."""
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

import prepare_release_bundle as pack
import setup_release_assets as install
import verify_bundle_restore as restore


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pretty(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


MUSCLES = [f"test_muscle_{n}" for n in range(740)]
COORDINATES = ["pelvis_tx", "pelvis_ty", "pelvis_tz", "pelvis_tilt", "pelvis_list", "pelvis_rotation", "finger"]
BRANCHES = [{"id": "main", "coefficient": 1.0}, {"id": "distal", "coefficient": 0.5}]


def fixture_frame(time):
    zeros = {key: 0.0 for key in COORDINATES}
    path = [[0.0, 0.0, 0.0], [0.01, 0.0, 0.0]]
    muscles = [{"name": name, "force": 2.0 if i == 0 else 0.0, "activeCapacity": 4.0,
                "activation": 0.5 if i == 0 else 0.0, "passiveForce": 0.0, "path": path} for i, name in enumerate(MUSCLES)]
    muscles[0]["branches"] = [{**b, "force": 2.0*b["coefficient"], "path": path} for b in BRANCHES]
    return {"t": time, "q": zeros.copy(), "quantitativeValid": True, "frameFeasible": True, "muscleValid": True,
            "anatomy": {"valid": True}, "support": {"feasible": True, "baseResidual": {k: 0.0 for k in COORDINATES[:-1]}},
            "groundCheck": {"feasible": True}, "muscles": muscles, "recruitment": {"internalCoordinatesIncluded": 1},
            **{k: zeros.copy() for k in ("torques", "rawTorques", "muscleTorques", "passiveTorques", "jointPassiveTorques",
                                        "reserveTorques", "otherJointPassiveTorques", "externalTorques")},
            "handReferenceTorques": {"finger": 0.0}, "jointLimitTorques": {}, "balanceErrorNm": 0.0, "nativeForceErrorN": 0.0,
            "grasp": {"geometryValid": True, "feasible": True, "objectResidualForceN": 0.0, "objectResidualMomentNm": 0.0,
                      "contacts": [{"normalN": 1.0, "frictionMarginN": 0.0, "forceOnObject": [1.0, 0.0, 0.0]}]}}


class PrepareBundleTests(unittest.TestCase):
    def setUp(self):
        scratch = install.REPO / ".runtime-cache" / "release-bundle-tests"
        scratch.mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix="tiny-", dir=scratch)
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.root = self.base / "checkout"
        self.root.mkdir()
        self.tag = "fixture-v1"
        self.model = pack.LAB + "candidates/runtime/tiny.xml"
        self.declaration = self.model[:-4] + "-manifest.json"
        self.parent_xml = pack.LAB + "candidates/runtime/parent.xml"
        self.parent_manifest = self.parent_xml[:-4] + "-manifest.json"
        self.notice = "licenses/atlas.txt"
        code = "tiny_engine.py"
        files = pack.BASE_FILES | {self.model, self.declaration, self.parent_xml, self.parent_manifest,
                                   pack.LAB + code, self.notice}
        self.spec = {"releaseTag": self.tag, "sourceCommit": "a" * 40, "modelXml": self.model,
                     "modelManifest": self.declaration, "atlasLicense": self.notice,
                     "computationFiles": [code], "requiredFiles": sorted(files)}
        for name in files:
            self.put(name, b"fixture")
        model_bytes = ('<mujoco><asset><mesh file="../ms-human-700/tiny.stl"/></asset><worldbody><body>' +
                       ''.join(f'<joint name="{n}"/>' for n in COORDINATES) + '</body></worldbody><actuator>' +
                       ''.join(f'<general name="{n}"/>' for n in MUSCLES) + '</actuator></mujoco>').encode()
        self.put(self.model, model_bytes)
        source_license = self.put(install.ZIP_PREFIXES["ms-human-source"] + "LICENSE", b"license")
        mesh_sha = self.put(install.ZIP_PREFIXES["ms-human-source"] + "tiny.stl", b"mesh")
        source_index = {"repository": "google-deepmind/mujoco_menagerie", "license": "Apache-2.0",
                        "commit": pack.SOURCE_COMMIT,
                        "files": [{"path": "LICENSE", "bytes": 7, "sha256": source_license},
                                  {"path": "tiny.stl", "bytes": 4, "sha256": mesh_sha}]}
        source_hash = self.put(pack.SOURCE, pretty(source_index))
        declaration = {"derivedSha256": sha(model_bytes), "derivedFrom": "parent.xml",
                       "derivedFromSha256": sha(b"fixture"), "derivedFromManifest": "parent-manifest.json",
                       "derivedFromManifestSha256": sha(b"fixture"),
                       "sourceManifest": "../ms-human-700/SOURCE_MANIFEST.json",
                       "sourceManifestSha256": source_hash, "muscleCount": len(MUSCLES),
                       "independentCoordinates": len(COORDINATES), "tendonBranches": {MUSCLES[0]: BRANCHES},
                       "handElasticity": {"referenceCorrection": {"coordinates": [{"coordinate": "finger"}]}}}
        declaration_sha = self.put(self.declaration, pretty(declaration))
        fingerprint = sha(code.encode() + b"\0fixture\0model-manifest-sha256\0" +
                          bytes.fromhex(declaration_sha) + b"\0")
        self.identity = {"model": "tiny-model", "modelSha256": sha(model_bytes),
                         "computationSha256": fingerprint}
        self.put(pack.READY, pretty(dict(self.identity, ready=True, publicationValidated=True)))
        self.put(pack.VALIDATION, pretty(dict(self.identity, status="passed")))
        self.coverage = dict(self.identity, muscles=[{"id": n} for n in MUSCLES], independentCoordinatesIncludingRoot=len(COORDINATES))
        self.ui = dict(self.identity, modelId=self.identity["model"], status="passed", candidatePreview=False,
                       fixedCacheValidated=True, completedAt="2026-01-01T12:00:00+00:00")
        self.put(pack.COVERAGE, pretty(self.coverage))
        self.put(pack.UI_VALIDATION, pretty(self.ui))
        self.put(install.RAW_TARGETS["bone-volumes"], b"bone")
        self.put(install.RAW_TARGETS["atlas-muscles"], b"atlas")
        self.put(pack.LAB + "geometry/bone-volumes.json", pretty(
            {"sourceGeometrySha256": sha(b"fixture"), "binarySha256": sha(b"bone"), "byteLength": 4}))
        self.put(pack.LAB + "atlas-muscles.json", pretty(
            {"boneVolumeBinarySha256": sha(b"bone"), "binarySha256": sha(b"atlas"),
             "byteLength": 5, "surfaceCount": 460}))
        scene = {"model": self.identity["model"], "label": "测试", "loadKg": 1.0, "preview": False,
                 "keyframes": [{"t": t, "q": {k: 0.0 for k in COORDINATES}} for t in (0.0, 1.0)]}
        result = {"model": self.identity["model"], "computationSha256": fingerprint,
                  "status": "solved", "kinematicOnly": False, "quantitativeValid": True, "failures": [],
                  "scene": deepcopy(scene), "frames": [fixture_frame(t) for t in (0.0, 1.0)],
                  "metrics": {"frames": 2, "durationSeconds": 1.0, "musclesIncluded": 740, "allMusclesFeasible": True,
                              "failedFrames": 0}}
        self.envelope = dict(self.identity, schema=1, scene=scene, result=result)
        verification = {key: self.identity[key] for key in ("modelSha256", "computationSha256")}
        verification.update(verified=True, frames=2, resultSha256=sha(compact(result)), sceneSha256=sha(pretty(scene)))
        self.catalog = dict(self.identity, schema=1, motions=[{"id": "tiny", "scene": scene,
                                                              "verification": verification}])
        self.store_motion()
        controls = patch.multiple(pack, CASE_IDS={"tiny"}, FRAME_COUNT=2, SOURCE_COUNT=2,
                                  SOURCE_INDEX_SHA=source_hash, ATLAS_SHA=sha(b"atlas"),
                                  ATLAS_LICENSE_SHA=sha(b"fixture"))
        controls.start()
        self.addCleanup(controls.stop)
        self.git = patch.object(pack, "git_required", side_effect=lambda root, commit, records, **opts: records)
        self.git.start()
        self.addCleanup(self.git.stop)

    def put(self, name, data):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return sha(data)

    def store_motion(self):
        raw = compact(self.envelope)
        digest = sha(raw)
        compressed = gzip.compress(raw, mtime=0)
        self.motion = install.ZIP_PREFIXES["motion-cache"] + digest + ".json.gz"
        self.put(self.motion, compressed)
        self.catalog["motions"][0]["cachedResult"] = {"url": f"./motion-cache/{digest}.json", "sha256": digest,
                                                     "bytes": len(raw), "compressedBytes": len(compressed)}
        self.put(pack.CATALOG, pretty(self.catalog))

    def test_complete_reproducible_bundle_decodes_with_existing_installer(self):
        self.put(install.ZIP_PREFIXES["ms-human-source"] + "unlisted-stale-file.stl", b"old")
        self.put(install.ZIP_PREFIXES["motion-cache"] + "0" * 64 + ".json.gz", b"old")
        output = pack.prepare(self.spec, self.root)
        manifest = install.load_manifest(output / "release-assets.json")
        self.assertEqual(len(manifest["assets"]), 4)
        self.assertEqual({item["path"] for item in manifest["requiredFiles"]}, set(self.spec["requiredFiles"]))
        for asset in manifest["assets"]:
            data = (output / asset["name"]).read_bytes()
            self.assertEqual(len(data), asset["bytes"])
            self.assertEqual(sha(data), asset["sha256"])
            if asset["format"] == "zip":
                with zipfile.ZipFile(output / asset["name"]) as bundle:
                    self.assertEqual(bundle.namelist(), sorted(v["path"] for v in asset["files"]))
                    self.assertFalse(any("stale" in name for name in bundle.namelist()))
                with tempfile.TemporaryDirectory(dir=self.base) as tiny_stage:
                    paths = install._unpack(asset, output / asset["name"], Path(tiny_stage))
                    install._check_index(asset, paths, manifest)
        # Preserve the first result, then reproduce in the same checkout with different source mtimes.
        archived = self.base / "first-run"
        output.rename(archived)
        (self.root / self.motion).touch()
        second = pack.prepare(self.spec, self.root)
        self.assertEqual({p.name: p.read_bytes() for p in second.iterdir()},
                         {p.name: p.read_bytes() for p in archived.iterdir()})

    def test_ready_false_precedes_large_inputs_and_creates_nothing(self):
        self.put(pack.READY, pretty(dict(self.identity, ready=False)))
        with patch.object(pack, "approved_source") as source, self.assertRaisesRegex(install.AssetSetupError, "ready"):
            pack.prepare(self.spec, self.root)
        source.assert_not_called()
        self.assertFalse((self.root / ".runtime-cache").exists())

    def test_offline_restore_from_all_four_packages_into_asset_free_copy(self):
        output = pack.prepare(self.spec, self.root)
        manifest = install.load_manifest(output / "release-assets.json")
        clean = self.base / "clean"
        clean.mkdir()
        for item in manifest["requiredFiles"]:
            target = clean / item["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(self.root / item["path"], target)
        with patch.object(install, "build_opener", side_effect=AssertionError("Unexpected network")):
            before = install.prepare_assets(manifest, root=clean)
            self.assertTrue(all(row["status"] == "missing" for row in before["files"]))
            last = manifest["assets"][-1]
            archive = output / last["name"]
            data = archive.read_bytes()
            archive.write_bytes(data[:-1])
            with self.assertRaises(install.AssetSetupError):
                install.prepare_assets(manifest, root=clean, bundle_dir=output)
            self.assertTrue(all(not (clean / r["path"]).exists() for r in before["files"]))
            archive.write_bytes(data)
            with patch.object(restore, "checkout_commit", return_value=manifest["sourceCommit"]):
                result = restore.verify(output, clean)
                self.assertTrue(result["offlineRestoreValidated"])
                self.assertEqual(result["installedFiles"], len(before["files"]))
                with self.assertRaisesRegex(install.AssetSetupError, "没有任何已安装"):
                    restore.verify(output, clean)
            self.assertTrue(install.prepare_assets(manifest, root=clean)["complete"])
            reused = install.prepare_assets(manifest, root=clean, bundle_dir=output)
            self.assertTrue(all(r["status"] == "reused" for r in reused["files"]))

    def test_stale_computation_and_source_identity_are_rejected(self):
        self.put(pack.LAB + "tiny_engine.py", b"new")
        with self.assertRaisesRegex(install.AssetSetupError, "计算代码"):
            pack.prepare(self.spec, self.root)
        self.put(pack.LAB + "tiny_engine.py", b"fixture")
        self.put(pack.SOURCE, pretty({"files": []}))
        with self.assertRaisesRegex(install.AssetSetupError, "来源清单"):
            pack.prepare(self.spec, self.root)

    def test_stale_or_partial_motion_and_mutated_scene_rejected(self):
        self.envelope["modelSha256"] = "0" * 64
        self.store_motion()
        with self.assertRaisesRegex(install.AssetSetupError, "动作信封"):
            pack.prepare(self.spec, self.root)
        self.envelope["modelSha256"] = self.identity["modelSha256"]
        self.envelope["scene"]["label"] = "其他动作"
        self.store_motion()
        with self.assertRaisesRegex(install.AssetSetupError, "场景与"):
            pack.prepare(self.spec, self.root)
        self.catalog["motions"] = []
        self.put(pack.CATALOG, pretty(self.catalog))
        with self.assertRaisesRegex(install.AssetSetupError, "动作目录"):
            pack.prepare(self.spec, self.root)

    def test_rehashed_invalid_force_ledgers_cannot_be_packaged(self):
        frame = self.envelope["result"]["frames"][0]
        for label, mutate in (
            ("placeholders", lambda f: f.update(muscles=[0] * len(MUSCLES))),
            ("duplicate", lambda f: f["muscles"][1].update(name=MUSCLES[0])),
            ("absent force", lambda f: f["muscles"][0].pop("force")),
            ("activation", lambda f: f["muscles"][1].update(activation=2.0)),
            ("missing branch", lambda f: f["muscles"][0]["branches"].pop()),
            ("branch force", lambda f: f["muscles"][0]["branches"][1].update(force=2.0)),
            ("torque", lambda f: f["rawTorques"].update(finger=0.1)),
            ("reserve", lambda f: f["reserveTorques"].update(finger=0.2)),
            ("reference", lambda f: f["handReferenceTorques"].clear()),
            ("base", lambda f: f["support"]["baseResidual"].pop("pelvis_tx")),
            ("object balance", lambda f: f["grasp"].update(objectResidualMomentNm=1.0)),
            ("dumbbell contact", lambda f: f["grasp"]["contacts"][0].update(forceOnObject=[])),
        ):
            with self.subTest(label=label):
                invalid = deepcopy(frame)
                mutate(invalid)
                self.envelope["result"]["frames"][0] = invalid
                self.catalog["motions"][0]["verification"]["resultSha256"] = sha(compact(self.envelope["result"]))
                self.store_motion()
                with self.assertRaisesRegex(install.AssetSetupError, "帧受力"):
                    pack.prepare(self.spec, self.root)

    def test_publication_marker_and_current_coverage_and_ui_are_required(self):
        for mark in (None, False):
            record = dict(self.identity, ready=True)
            if mark is not None:
                record["publicationValidated"] = mark
            self.put(pack.READY, pretty(record))
            with self.assertRaisesRegex(install.AssetSetupError, "publicationValidated"):
                pack.prepare(self.spec, self.root)
        self.put(pack.READY, pretty(dict(self.identity, ready=True, publicationValidated=True)))
        self.put(pack.COVERAGE, pretty(dict(self.coverage, model="historical-v3")))
        with self.assertRaisesRegex(install.AssetSetupError, "覆盖报告"):
            pack.prepare(self.spec, self.root)
        self.put(pack.COVERAGE, pretty(self.coverage))
        for values in ({"candidatePreview": True}, {"fixedCacheValidated": False}, {"status": "failed"},
                       {"modelId": "historical-v3"}, {"computationSha256": "0" * 64}, {"completedAt": None}):
            with self.subTest(values=values):
                self.put(pack.UI_VALIDATION, pretty(dict(self.ui, **values)))
                with self.assertRaisesRegex(install.AssetSetupError, "网页缓存验收"):
                    pack.prepare(self.spec, self.root)

    def test_asset_mismatch_removes_staging_and_preserves_existing_output(self):
        self.put(install.RAW_TARGETS["atlas-muscles"], b"wrong")
        with self.assertRaisesRegex(install.AssetSetupError, "原始二进制"):
            pack.prepare(self.spec, self.root)
        parent = self.root / ".runtime-cache/release-bundles"
        self.assertEqual(list(parent.iterdir()), [])
        final = parent / self.tag
        final.mkdir()
        (final / "keep.txt").write_bytes(b"keep")
        with self.assertRaisesRegex(install.AssetSetupError, "已存在"):
            pack.prepare(self.spec, self.root)
        self.assertEqual((final / "keep.txt").read_bytes(), b"keep")

    def test_required_paths_reject_directories_and_missing_attribution(self):
        self.spec["requiredFiles"].remove(self.notice)
        with self.assertRaisesRegex(install.AssetSetupError, "requiredFiles"):
            pack.prepare(self.spec, self.root)
        self.spec["requiredFiles"].append("../outside")
        with self.assertRaises(install.AssetSetupError):
            pack.prepare(self.spec, self.root)

    def test_xml_reference_missing_from_installation_closure(self):
        with self.assertRaisesRegex(install.AssetSetupError, "网格"):
            pack.check_model_meshes(self.root, self.model, set())

    def test_matching_candidate_with_explicit_publication_hold_is_rejected(self):
        candidate = dict(self.identity, publicationValidated=False)
        self.put(pack.READY, pretty(dict(self.identity, ready=True, publicationValidated=True, candidate=candidate)))
        with self.assertRaisesRegex(install.AssetSetupError, "发布验收"):
            pack.prepare(self.spec, self.root)

    def test_v5_requires_selected_module_inherited_declaration_and_real_hash(self):
        base = {"modelId": "v4-fixture", "derivedSha256": self.identity["modelSha256"], "muscleCount": 740}
        base_hash = self.put(self.parent_manifest, pretty(base))
        module = "franko_transmission.py"
        module_hash = self.put(pack.LAB + module, b"fixture module, unspecified candidate revision")
        series_module = "passive_series.py"
        series_hash = self.put(pack.LAB + series_module, b"fixture passive series implementation")
        records = {name: pack.file_record(self.root, name) for name in
                   (self.parent_manifest, pack.LAB + module, pack.LAB + series_module)}
        series = {"model": "thelen-fds-passive-series-v1", "muscles": [stem + side for stem in
                  ("FDSI", "FDSM", "FDSR", "FDSL") for side in ("", "_l")], "tendonStrainAtFmax": 0.04,
                  "tendonToeForceFraction": 0.33, "tendonToeShape": 3, "fibreStrainAtFmax": 0.6, "fibreShape": 5,
                  "slackLength": "effective-length-offset-from-validated-lengthrange", "moduleSha256": series_hash}
        selected = dict(base, modelId=self.identity["model"], transmissionStatus="selected",
                        baseModelManifest={"file": Path(self.parent_manifest).name, "sha256": base_hash},
                        transmissionModuleSha256=module_hash,
                        effectiveTendonTransmission={"fixture": "selected", "passiveSeries": series})
        spec = dict(self.spec, computationFiles=[module, series_module])
        def check(row, specification=spec):
            pack.check_selected_transmission(self.root, row, self.identity, specification,
                                             Path(self.model).parent, records)
        check(selected)
        for mutation in ({"transmissionStatus": "pending"}, {"transmissionModuleSha256": "0" * 64},
                         {"effectiveTendonTransmission": None}, {"effectiveTendonTransmission": {"fixture": "old"}},
                         {"effectiveTendonTransmission": {"passiveSeries": dict(series, moduleSha256="0" * 64)}},
                         {"effectiveTendonTransmission": {"passiveSeries": dict(series, muscles=series["muscles"][:-1])}},
                         {"effectiveTendonTransmission": {"passiveSeries": dict(series, tendonStrainAtFmax=0.033)}},
                         {"muscleCount": 741}):
            with self.subTest(mutation=mutation), self.assertRaises(install.AssetSetupError):
                check(dict(selected, **mutation))
        with self.assertRaises(install.AssetSetupError):
            check(selected, dict(spec, computationFiles=[module]))

    def test_git_bytes_match_portable_checkout_and_detect_line_ending_change(self):
        # Use an existing committed public blob via a temporary Git object-store alternate.
        # All index, ref and object content in the originating repository stays untouched.
        root = self.base / "git-bytes"
        root.mkdir()
        def git(directory, *args):
            return subprocess.check_output(["git", "-C", str(directory), *args], stderr=subprocess.PIPE)
        commit = git(install.REPO, "rev-parse", "HEAD").decode().strip()
        objects = git(install.REPO, "rev-parse", "--path-format=absolute", "--git-path", "objects").decode().strip()
        name = "LICENSE"
        lf = git(install.REPO, "cat-file", "blob", commit + ":" + name)
        self.assertIn(b"\n", lf)
        self.assertNotIn(b"\r\n", lf)
        with patch.dict(os.environ, {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                                     "GIT_ALTERNATE_OBJECT_DIRECTORIES": objects}):
            git(root, "init", "-q")
            git(root, "config", "core.autocrlf", "true")
            (root / name).write_bytes(lf)
            self.git.stop()
            try:
                pack.git_required(root, commit, {name: pack.file_record(root, name)})
                (root / name).write_bytes(lf.replace(b"\n", b"\r\n"))
                with self.assertRaisesRegex(install.AssetSetupError, "检出字节"):
                    pack.git_required(root, commit, {name: pack.file_record(root, name)})
                portable = pack.git_required(root, commit, {name: pack.file_record(root, name)}, portable_text=True)
                self.assertEqual(portable[name]["sha256"], sha(lf))
            finally:
                self.git.start()


if __name__ == "__main__":
    unittest.main()
