"""Export current model metadata after proving the existing atlas can represent its bones."""
import hashlib
import importlib
import json
import sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
LAB=HERE.parents[1]
sys.path.insert(0,str(LAB.parent))
engine=importlib.import_module("body-lab.fullbody_engine")


def main():
    audit=json.loads((HERE/"atlas-compatibility.json").read_bytes())
    atlas_file=LAB/"atlas-muscles.json"
    atlas=json.loads(atlas_file.read_bytes())
    info=engine.model_info()
    if (not audit["passed"] or audit["modelSha256"]!=info["sourceSha256"]
            or audit["atlasBinarySha256"]!=atlas["binarySha256"] or len(info["muscles"])!=740):
        raise RuntimeError("The final model or atlas does not match the compatibility audit")
    if info["id"] not in atlas["compatibleModelIds"]:
        if hashlib.sha256(atlas_file.read_bytes()).hexdigest()!=audit["atlasManifestSha256BeforeCompatibilityUpdate"]:
            raise RuntimeError("Unexpected atlas change before compatibility registration")
        atlas["compatibleModelIds"].append(info["id"])
        # Keep modelId/referenceModelId as the original geometric provenance.
        atlas_file.write_text(json.dumps(atlas,ensure_ascii=False,separators=(",",":")),encoding="utf8")
    (LAB/"fullbody-model-data.json").write_text(json.dumps(info,ensure_ascii=False,allow_nan=False,indent=2),encoding="utf8")
    print(info["id"],len(info["muscles"]),info["computationSha256"])


if __name__=="__main__":
    main()
