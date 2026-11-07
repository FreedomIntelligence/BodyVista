# Third-Party Notices

BodyVista's own code and documentation are licensed under the [MIT License](LICENSE), copyright © 2026 FreedomAI, except for third-party and separately licensed material described below. The root license does not relicense these materials or remove their attribution requirements.

## Software

- **Dental Scope** — Copyright © 2026 Yoseph and Dental Scope contributors. Its source code is MIT licensed. Retain the [upstream license](dental/vendor/LICENSE), [credits](dental/vendor/CREDITS.md), and modification records. The adapted source is under `dental/vendor/src/`.
- **Three.js** — MIT. The main application includes a vendored copy and related loaders in `src/vendor/`; the oral renderer uses an npm dependency. Retain upstream copyright and license notices in both distributions.
- **Vite, React, Zustand, and three-mesh-bvh** — MIT. Dependency versions are recorded in `package-lock.json`; their distributions include their respective license texts and copyright notices.

## Main anatomy models and data

The `assets/` models, their thumbnails in `thumbs/`, and third-party anatomical data in `catalog.json` are not covered by BodyVista's MIT grant. Per-structure source records are stored in `catalog.json` under `source_attribution`.

The current records include:

- 2,899 structures marked `Z-Anatomy CC-BY-SA-4.0 with per-source attribution and NC exceptions; research only`.
- 1 structure marked `BodyParts3D CC BY 4.0`.

These are existing metadata labels, not a completed verification of the original permissions. In particular, the `NC exceptions; research only` marker requires source-level review before public distribution or claims about commercial reuse. Choosing MIT for the application code does not resolve these outstanding model permissions.

The reviewed 460-surface body-lab selection described below has a narrower, source-specific attribution record. Its conclusion does not clear the remaining atlas objects or change their metadata labels.

## Body and elbow experiment resources

The experiments retain separate licenses for code, anatomical display assets, and computational models. The detailed source versions, author roles, modifications, and remaining provenance limits are recorded in [Body and elbow asset attribution](experiments/body-lab/ASSET_ATTRIBUTION.md). This documentation does not mean that a repaired model or final Release has passed validation.

- **460 Z-Anatomy-derived muscle and tendon surfaces** — The body-lab selection contains 458 muscle surfaces and the left and right calcaneal tendons. These derived model assets and BodyVista's changes to them are shared under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en), with the original **BodyParts3D, © The Database Center for Life Science, CC Attribution-Share Alike 2.1 Japan** attribution retained. Preserve [Z-Anatomy's original license and credits](https://github.com/Z-Anatomy/Models-of-human-anatomy/blob/5a07944a0c73f4802450ec6d2adb4a171e8cdb30/License.txt), the per-surface records in [atlas-muscles.json](experiments/body-lab/atlas-muscles.json), and the selection, conversion, registration, subdivision, binding, and deformation records. This audited subset was not found to include the upstream named inner-ear or kidney NC exceptions; that finding is not a blanket clearance for the full atlas. The pinned license-text commit is **not** a known geometry-export commit: the original package version, `.blend` hash, and export log remain unrecorded. Atlas bone references retain their own source attribution and are not relicensed as MIT.
- **MS-Human-700 and native bone derivatives** — Developed by [LNS Group](https://github.com/LNSGroup/MS-Human-700), obtained from [MuJoCo Menagerie commit `98a70c569c4c1b6da467a20012f766ee1f8dc521`](https://github.com/google-deepmind/mujoco_menagerie/tree/98a70c569c4c1b6da467a20012f766ee1f8dc521/ms_human_700). The source package declares **Apache-2.0**. Retain its [upstream LICENSE](https://github.com/google-deepmind/mujoco_menagerie/blob/98a70c569c4c1b6da467a20012f766ee1f8dc521/ms_human_700/LICENSE), [README and academic citation](https://github.com/google-deepmind/mujoco_menagerie/blob/98a70c569c4c1b6da467a20012f766ee1f8dc521/ms_human_700/README.md), all 251 files listed in the source package’s installed `SOURCE_MANIFEST.json`, and BodyVista's derivative-model records. `fullbody-bones.json` and `bone-volumes.json` / `.bin` are exported from these native meshes and subsequently voxelized; they follow this source chain and are distinct from the Z-Anatomy surface selection.
- **OpenSim Arm26** — The fixed [OpenSim model at commit `84b487c4e3245359a64381e01f01b9cf4772d457`](https://github.com/opensim-org/opensim-models/blob/84b487c4e3245359a64381e01f01b9cf4772d457/Models/Arm26/arm26.osim) credits the OpenSim Development Team's J. Reinbolt, A. Seth, A. Habib, and S. Hamner, adapted from Kate Holzbaur's model, under **CC BY 3.0**. The original model and BodyVista's shoulder-locked lookup-table derivatives retain this attribution. Preserve the [source, paper, modifications, and limits](experiments/elbow-lab/model/README.md).
- **Hand transmission and FDS passive series elasticity**. Franko et al. (2011), *Moment arms of the human digital flexors*, Table 2, supplies the fitted moment arms for the two small-finger deep flexors. Eight existing FDS units use the OpenSim 4.6 Thelen2003Muscle passive curves, including tendon strain 0.04 at maximum isometric force. BodyVista implements the local calculation in Python. The cited OpenSim source credits Stanford University and its authors and carries Apache-2.0. [Franko et al.](https://pubmed.ncbi.nlm.nih.gov/21561624/) · [OpenSim 4.6 source](https://github.com/opensim-org/opensim-core/blob/4.6/OpenSim/Actuators/Thelen2003Muscle.cpp#L165-L171) · [Experimental asset attribution](experiments/body-lab/ASSET_ATTRIBUTION.md)

Original license texts are unchanged. Per-resource attribution must accompany separately downloaded Release assets as well as files shipped in Git. BodyVista's MIT grant does not extend to these third-party resources, and a successful resource hash check is not a license or model-validation decision.

## Oral and dental models

Models under `dental/models/` retain their individual source licenses. The upstream records identify BodyParts3D resources under CC BY-SA 2.1 Japan and Z-Anatomy-derived resources under CC BY-SA 4.0. Do not apply a single blanket license to all models.

Required BodyParts3D attribution recorded by the upstream project:

> BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan

Retain the [credits](dental/vendor/CREDITS.md), [asset provenance and modification records](dental/vendor/docs/assets.md), and [anatomical limitations and references](dental/vendor/docs/feedback-anatomy.md). References to `public/models/` in these retained upstream documents correspond to `dental/models/` in this integration.

## Educational content

Adapted Dental Scope educational descriptions retain CC BY-SA 4.0, as documented in the [upstream license](dental/vendor/LICENSE) and [integration notes](dental/README.md). This includes adaptations and translations of those descriptions; they are not relicensed under MIT.

Anatomical and physiological explanations elsewhere in the project include references to OpenStax and other sources. Preserve the references attached to the relevant entries. A citation alone does not determine the license of a passage; any reused third-party text retains its applicable permissions and attribution requirements.

## Scope and updates

This file records the current known sources and unresolved provenance issues. It does not grant permissions on behalf of third-party authors or replace their license texts. When adding or modifying third-party resources, record their source, author, license, and modifications here or in the linked per-asset records.
