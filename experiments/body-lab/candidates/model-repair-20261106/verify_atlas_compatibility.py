"""Check whether the existing anatomical surfaces can retain their v3 binding.

This verifies the specific rigid-body and DELT1 paths used by the current atlas.
It does not validate the appearance of every animated muscle surface.
"""

import hashlib
import json
import os
from pathlib import Path

for variable in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ[variable] = "1"

import mujoco
import numpy as np

HERE = Path(__file__).resolve().parent
LAB = HERE.parent.parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    base_path = LAB / "candidates/runtime/expanded-knee-rotation.xml"
    candidate_path = LAB / "candidates/runtime/expanded-motion-repair.xml"
    atlas_path = LAB / "atlas-muscles.json"
    sources = (base_path, candidate_path, atlas_path, LAB / "atlas-muscles.bin")
    source_hashes = [sha(path) for path in sources]
    atlas = json.loads(atlas_path.read_text("utf-8"))
    binary_hash = source_hashes[3]
    if binary_hash != atlas["binarySha256"]:
        raise ValueError("Existing atlas binary does not match its manifest")
    models = [mujoco.MjModel.from_xml_path(str(path)) for path in (base_path, candidate_path)]
    base, candidate = models
    checks = {field: bool(np.array_equal(getattr(base, field), getattr(candidate, field)))
              for field in ("body_pos", "body_quat", "body_parentid", "jnt_axis", "jnt_pos", "jnt_range", "qpos0")}
    checks["bodyNamesAndOrder"] = ([base.body(i).name for i in range(base.nbody)] ==
                                    [candidate.body(i).name for i in range(candidate.nbody)])
    states = []
    for model in models:
        data = mujoco.MjData(model)
        mujoco.mj_forward(model, data)
        states.append(data)
    checks["restWorldPositions"] = bool(np.array_equal(states[0].xpos, states[1].xpos))
    checks["restWorldRotations"] = bool(np.array_equal(states[0].xmat, states[1].xmat))
    native_parts = [part for part in atlas["parts"] if part.get("skinning") == "native-path"]
    native_checks = []
    for part in native_parts:
        for name in part["units"]:
            paths = []
            for model, data in zip(models, states):
                actuator = model.actuator(name).id
                tendon = int(model.actuator_trnid[actuator, 0])
                start = int(data.ten_wrapadr[tendon])
                count = int(data.ten_wrapnum[tendon])
                objects = data.wrap_obj.reshape(-1)[start:start + count]
                if np.any(objects == -2):
                    raise ValueError("The atlas DELT1 path unexpectedly acquired branches")
                paths.append(data.wrap_xpos.reshape(-1, 3)[start:start + count].copy())
            same = np.array_equal(paths[0], paths[1])
            native_checks.append({"surface": part["id"], "muscle": name, "samePath": bool(same)})
    checks["nativePathSet"] = {row["muscle"] for row in native_checks} == {"DELT1_r", "DELT1_l"}
    checks["nativeRestPaths"] = all(row["samePath"] for row in native_checks)
    checks["sourceStable"] = source_hashes == [sha(path) for path in sources]
    report = {"passed": all(checks.values()), "baseModelSha256": source_hashes[0],
              "modelSha256": source_hashes[1], "atlasManifestSha256BeforeCompatibilityUpdate": source_hashes[2],
              "atlasBinarySha256": binary_hash, "checks": checks, "nativePaths": native_checks,
              "scope": "Existing body binding and native DELT1 rest-path compatibility; not a new whole-surface visual audit."}
    (HERE / "atlas-compatibility.json").write_text(json.dumps(report, indent=2) + "\n", "utf-8")
    print(json.dumps(report, indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
