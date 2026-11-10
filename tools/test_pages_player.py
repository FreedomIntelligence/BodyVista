"""Check the Pages player's module graph without building or downloading model assets."""

from pathlib import Path
import runpy
import unittest


pack = runpy.run_path(str(Path(__file__).with_name("build-pages-replay.py")))
ROOT, LAB = pack["ROOT"], pack["LAB"]
version = pack["version_player_references"]
BUILD = "0123456789abcdef0000"


class PlayerCacheTests(unittest.TestCase):
    def test_published_graph_is_versioned_including_workers_and_three(self):
        for path in pack["FRONTEND_FILES"] | {LAB / "index.html"}:
            source = (ROOT / path).read_text(encoding="utf-8")
            with self.subTest(path=path):
                result = version(source, path, BUILD)
                self.assertNotRegex(result, pack["FRONTEND_REFERENCE"])
        paths = {
            "index.html": ('src="./app.js', 'href="./style.css'),
            "app.js": ('from "./motion-locale.js', 'import("./public-replay.js'),
            "fullbody-view.js": ('import("./anatomical-muscles.js', 'from "../../src/vendor/three.js'),
            "muscle-shape-pool.js": ('new URL("./muscle-shape-worker.js',),
        }
        for name, links in paths.items():
            path = LAB / name
            result = version((ROOT / path).read_text(encoding="utf-8"), path, BUILD)
            for link in links:
                self.assertIn(link + "?ui=" + BUILD + '"', result)

    def test_data_and_motion_urls_are_shared_across_ui_versions(self):
        source = 'fetch("./motion-cache/catalog.json"); new URL("./preview-muscles.bin", import.meta.url)'
        self.assertEqual(version(source, LAB / "app.js", BUILD), source)

    def test_unknown_module_fails_at_build_time(self):
        with self.assertRaises(ValueError):
            version('import("./missing-player-module.js")', LAB / "app.js", BUILD)


if __name__ == "__main__":
    unittest.main()
