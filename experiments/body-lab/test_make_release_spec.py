"""Small, offline checks for deriving the release spec from the real runtime convention."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import make_release_spec as spec
import setup_release_assets as install


class SpecTests(unittest.TestCase):
    def test_release_fixtures_and_git_paths_exclude_historical_results(self):
        scratch = install.REPO / ".runtime-cache" / "release-bundle-tests"
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="tiny-inputs-", dir=scratch) as directory:
            root = Path(directory)
            def write(name, raw):
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(raw)
                return hashlib.sha256(raw).hexdigest()
            suites = {}
            for suite in ("core", "smoke", "extended", "standing", "custom"):
                path = suite + ".json"
                suites[suite] = (path, write(spec.REPAIR + path, b"[]"))
            write(spec.REPAIR + "verify_release_motions.py", ("SOURCES = " + repr(suites)).encode())
            ids = sorted(spec.bundle.CASE_IDS)
            for names, catalog in ((ids[:7], spec.SCENE_CATALOGS[0]), (ids[7:], spec.SCENE_CATALOGS[1])):
                motions = []
                for identifier in names:
                    name = identifier + ".scene.json"
                    sha = write((Path(catalog).parent / name).as_posix(), b'{"keyframes":[]}')
                    motions.append({"id": identifier, "verification": {"sceneFile": name, "sceneSha256": sha,
                                                                       "resultFile": identifier + ".result.json"}})
                write(catalog, json.dumps({"motions": motions}).encode())
            inputs = spec.fixture_inputs(root)
            paths = spec.git_paths({"requiredFiles": sorted(inputs)})
            self.assertEqual(sum(name.endswith(".scene.json") for name in paths), 11)
            self.assertFalse(any(name.endswith(".result.json") for name in paths))
            for private in (spec.bundle.READY, spec.LAB + "motion-cache/catalog.json", spec.LAB + "atlas-muscles.bin"):
                with self.assertRaises(install.AssetSetupError):
                    spec.git_paths({"requiredFiles": [private]})
            write(spec.REPAIR + "core.json", b"changed")
            with self.assertRaisesRegex(install.AssetSetupError, "回归输入"):
                spec.fixture_inputs(root)

    def test_separate_manifest_and_fingerprint_order_come_from_engine(self):
        source = (
            'MODEL_PATH = HERE / "candidates/runtime/model.xml"\n'
            'MODEL_MANIFEST_PATH = MODEL_PATH.with_name("other-version.json")\n'
            'def computation_fingerprint():\n'
            '    for name in ("fullbody_engine.py", "native_worker.py", "franko_transmission.py", "passive_series.py"):\n'
            '        pass\n'
        )
        model, manifest, modules = spec.runtime_selection(source)
        self.assertTrue(model.endswith("/model.xml"))
        self.assertTrue(manifest.endswith("/other-version.json"))
        self.assertEqual(modules, ["fullbody_engine.py", "native_worker.py", "franko_transmission.py", "passive_series.py"])
        with self.assertRaises((ValueError, install.AssetSetupError)):
            spec.runtime_selection(source.replace('HERE / "candidates/runtime/model.xml"', 'resolve_runtime()'))

    def test_parent_chain_and_separate_base_manifest_are_both_included(self):
        scratch = install.REPO / ".runtime-cache" / "release-bundle-tests"
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="tiny-graph-", dir=scratch) as temporary:
            root = Path(temporary)
            for name, row in {
                "v5.json": {"baseModelManifest": {"file": "v4.json"}, "derivedFrom": "parent.xml",
                            "derivedFromManifest": "v3.json"},
                "v4.json": {"derivedFromManifest": "v3.json", "derivedFrom": "parent.xml"},
                "v3.json": {"derivedFromManifest": "original.json", "derivedFrom": "original.xml"},
                "original.json": {"sourceManifest": "../source/SOURCE_MANIFEST.json"},
            }.items():
                (root / name).write_text(json.dumps(row), encoding="utf-8")
            self.assertEqual(spec.model_files(root, "active.xml", "v5.json"),
                             {"active.xml", "v5.json", "v4.json", "parent.xml", "v3.json", "original.xml",
                              "original.json"})

    def test_browser_bound_arm_parts_and_review_films_are_required(self):
        scratch = install.REPO / ".runtime-cache" / "release-bundle-tests"
        scratch.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="tiny-refs-", dir=scratch) as temporary:
            root = Path(temporary)
            for name, row in {
                "v5.json": {},
                spec.ELBOW + "atlas/bindings.json": {"parts": [{"file": "assets/detail/z_a12.js"}]},
                spec.LAB + "review-media/manifest.json": {"muscles": [{"films": [{"file": "tiny-left.webm"}]}]},
            }.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(json.dumps(row), encoding="utf-8")
            paths = spec.required_files(root, "v5.xml", "v5.json", ["franko_transmission.py", "passive_series.py"], [])
            self.assertIn("assets/detail/z_a12.js", paths)
            self.assertIn(spec.LAB + "review-media/tiny-left.webm", paths)
            self.assertIn(spec.LAB + "fullbody-ui-validation.json", paths)
            self.assertIn(spec.LAB + "franko_transmission.py", paths)
            self.assertIn(spec.LAB + "passive_series.py", paths)


if __name__ == "__main__":
    unittest.main()
