"""Equipment input and object regressions; never load the full-body model."""

import importlib
import os
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

for variable in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[variable] = "1"

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
G = importlib.import_module("body-lab.grasp")
S = importlib.import_module("body-lab.fullbody_solver")
E = importlib.import_module("body-lab.fullbody_engine")


class EquipmentSupportTests(unittest.TestCase):
    def scene(self, kind, mass, hand):
        return {"keyframes": [{"t": 0, "q": {}}, {"t": 1, "q": {}}],
                "equipment": {"type": kind, "massKg": mass},
                "loadKg": mass, "hand": hand}

    def test_removed_barbell_rejected_before_model_load(self):
        with patch.object(G, "context", side_effect=AssertionError("model loaded")), \
                patch.object(S, "context", side_effect=AssertionError("model loaded")):
            for mass in (0, 2):
                for hand in ("right", "left", "both"):
                    for operation in (G.equipment, G.attach, S.normalize, S.solve):
                        with self.subTest(mass=mass, hand=hand, operation=operation.__name__):
                            with self.assertRaisesRegex(E.ScenarioError, "杠铃功能已移除"):
                                operation(self.scene("barbell", mass, hand))

    def test_dumbbell_and_empty_normalization_is_preserved(self):
        stub = SimpleNamespace(normalize_q=dict, muscle_names=[])
        with patch.object(S, "context", return_value=stub):
            for hand in ("right", "left", "both"):
                scene = self.scene("dumbbell", 2, hand)
                expected = {"type": "dumbbell", "massKg": 2., "hand": hand, "friction": 1.}
                self.assertEqual(G.equipment(scene), expected)
                self.assertEqual(S.normalize(scene)["equipment"], expected)
                self.assertEqual(S.normalize(self.scene("none", 0, hand))["equipment"],
                                 {**expected, "type": "none", "massKg": 0.})

    def test_dumbbells_keep_independent_palms_and_total_mass(self):
        palms = {"r": (1, np.array([.2, .3, .4]), np.eye(3)),
                 "l": (2, np.array([-.2, .3, .4]), np.eye(3))}
        with patch.object(G, "palm_frame", side_effect=lambda ctx, data, side: palms[side]), \
                patch.object(G, "skin_geoms", return_value=[]):
            for hand, sides in (("right", ["r"]), ("left", ["l"]), ("both", ["r", "l"])):
                objects, errors = G.objects(None, None, self.scene("dumbbell", 2, hand))
                self.assertEqual(len(objects), len(sides))
                self.assertEqual(sum(item["massKg"] for item in objects), 2.)
                # No skin contacts are supplied by this fixture; it cannot claim a valid grasp.
                self.assertEqual(len(errors), len(sides))
                for item, side in zip(objects, sides):
                    self.assertEqual(item["sides"], [side])
                    np.testing.assert_array_equal(item["center"], palms[side][1])
                    self.assertEqual(item["geometry"]["shaftLengthM"], .22)
                    self.assertTrue(np.all(np.diag(item["inertia"]) > 0))


if __name__ == "__main__":
    unittest.main()
