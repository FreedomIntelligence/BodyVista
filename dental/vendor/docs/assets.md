# Assets

Every 3D asset shipped in `public/models/`, where it comes from, its licence and what was changed.

## Licence and attribution

| | |
|---|---|
| Original source | BodyParts3D 3.0 (DBCLS) — <https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html> |
| Mirror used by the pipeline | <https://github.com/Kevin-Mattheus-Moerman/BodyParts3D> (verbatim STL conversion) |
| Author / institution | The Database Center for Life Science (DBCLS), Japan |
| Licence | CC BY-SA 2.1 Japan — <https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en> |
| Required attribution | "BodyParts3D, © The Database Center for Life Science licensed under CC Attribution-Share Alike 2.1 Japan" |
| Share-alike | All derived assets in `public/models/` are distributed under the same licence |
| Derived images | `public/og-image.png` (social preview) is a render of these models and carries the same licence and attribution |

## Provenance levels

| Level | Meaning |
|---|---|
| `source` | Real BodyParts3D geometry, only transformed and simplified |
| `derived` | Cut from or approximated using source geometry (alveolar bone, condyles, fossae, third molars) |
| `modeled` | Internal tooth anatomy generated inside the real tooth shape with simplified, approximate proportions (not measured); the maxillary sinuses, hollowed out of the maxilla with an approximate wall thickness |
| `atlas` | Nerve and vessel centrelines from the Z-Anatomy atlas (CC BY-SA 4.0), fitted onto these jaws: anatomical course, not measured in this individual |
| `schematic` | Teaching paths and landmarks placed to illustrate relationships: superior alveolar and palatal (greater palatine, nasopalatine) nerves, V1, VII/IX/X/XII, mandibular canal envelopes, inferior alveolar vein, pterygoid plexus and joint discs |

The provenance of every mesh is recorded in `manifest.json`; the About dialog explains the levels.

## Derivations in detail

- **Third molars (18, 28, 38, 48)** — copy of the second molar of the same quadrant, scaled to 90 % and moved distally along the arch. Mandibular placement is fitted to the neighbouring crown (rather than its roots), keeping the cusp height level with the second molar.
- **Gingiva** — the source gum surface is cut around each tooth with a narrow clearance so that gum and tooth solids do not occupy the same visible space. The source has only 28 teeth; `gingiva.py` adds a continuous posterior ridge on each arch around the second and third molar necks, blending it into the source with signed distance fields. Its crest follows the individual cervical contours, so the erupted crowns sit in closed, fitted sockets. The lower ridge extends to the source basal surface and retains the original gum body below the necks, preventing underside notches at the joins. Rounded upper collars are joined to the source gum while preserving its palatal and basal contours. Validation checks crown visibility and gum support around the viewer's root cutoff for all four wisdom teeth.
- **Alveolar processes** — faces of the maxilla / mandible within 4 mm of a tooth root (the part below the cervical line).
- **Mandibular condyles** — the top 10 mm of the posterior ramus on each side.
- **Articular fossae** — faces of the temporal bone within reach of the condylar head.
- **Articular discs** — draft schematic meshes fitted to each condylar landmark, with a rounded oval outline, curved inferior surface, thin intermediate zone, thicker anterior band and fuller posterior band. The band pattern follows [Detamore & Athanasiou, 2003](https://pubmed.ncbi.nlm.nih.gov/12684970/); dimensions, curvature and pearly tissue shading are illustrative rather than measured in this skull. These discs remain `schematic` pending expert review. `tmj.py` fixes the anterior/posterior axis on both sides and generates a smooth closed surface. Use `refresh_discs.py` followed by `refresh_discs.mjs` to replace only the two discs in the shipped context asset.
- **Tooth layers** — see `tools/pipeline/tooth_layers.py`: signed-distance field of each tooth → cervical line from a typical crown/root ratio → enamel and cementum by depth → pulp chamber by inner offset → canals traced along each detected root; canal count per root follows the most common textbook configuration.
- **Atlas nerves and vessels** — `tools/pipeline/extract_z_anatomy.py` (run once with Blender's `bpy` module) samples the Z-Anatomy Bezier curves, fits the Z-Anatomy mandible and maxillae onto the BodyParts3D ones with a similarity ICP (median residual on the mandible 0.27 mm) and writes the centrelines to `tools/pipeline/data/z-anatomy-neurovascular.json`. `build_assets.py` sweeps them into tubes, ends the inferior alveolar nerve's dental branches at the tooth apices (adding one for a tooth without a branch), clips the neck vessels (external carotid artery, internal jugular, retromandibular and facial veins) just below the angle of the mandible, retains the complete sampled trigeminal root and ganglion via `cranial.py`, leaves out the external jugular vein and the posterior division of the retromandibular vein, gives the inferior alveolar nerve trunk its real calibre (about 2.2 mm) and uses the atlas nerve path to place the mandibular, mental and infraorbital foramen landmarks.
- **Schematic nerves and vessels / TMJ discs** — the superior alveolar nerves branch from the atlas maxillary and infraorbital nerves to the upper apices; the pterygoid plexus is a small venous network on the lateral pterygoid draining into the atlas maxillary vein; the inferior alveolar vein runs beside the atlas artery from the plexus to the mental foramen. Discs sit between condylar head and fossa.
- **Palatal nerves** — `tools/pipeline/palatal.py`. Neither source has the greater palatine or nasopalatine nerves, so both are schematic tubes in app space: from the pterygopalatine fossa below the atlas maxillary nerve, the greater palatine nerve follows the atlas descending palatine artery down its canal and forward in the palatal groove, with short branches to the palatal gingiva of the premolars and molars; the nasopalatine nerve crosses to the vomer (control points measured beside this skull's deviated septum) and leaves the incisive foramen behind the central incisors with a fan to the anterior palatal gingiva. `build_assets.py` adds them after the cranial extension; to replace only these four meshes in the shipped assets run `refresh_palatal.py` and then `refresh_palatal.mjs`. Sources and limits: [innervation-identification.md](innervation-identification.md).
- **Maxillary sinuses** — `tools/pipeline/sinus.py`. Neither source has them (both maxillae are solid), so each is modelled: the BodyParts3D maxilla is voxelised (0.4 mm), eroded by a 1 mm wall, cut medially at the lateral nasal wall (the lateral edge of the inferior nasal concha), kept 1 mm from the tooth roots and 0.8 mm from the superior alveolar and infraorbital nerves, opened (2 mm) to drop thin remnants of the processes, and the largest cavity is meshed with marching cubes. `manifest.sinus` holds each volume and the distance from each upper root apex to the sinus floor.
- **Jaw weights** — every nerve and vessel vertex stores (in its vertex colour) how far it moves with the skull (1) rather than the mandible (0) when the arches separate, from its distances to the two bones, so paths between the jaws stretch instead of breaking.
- **Dissection tiers** (`manifest.explode`, `teeth[].extract`, `teeth[].collar`) — measured by `explode_plan` in `build_assets.py`; `validate_assets.py` checks that no tooth passes visibly through its gum at any point of the slider.

- **Cranial teaching extension and joint movement** — `cranial.py` restores the sampled atlas trigeminal root, adds representative V1/VII/IX/X/XII paths and skull-exit landmarks, and fits an illustrative rotation/translation plan to the condyles. The mandibular canal is a translucent envelope around the atlas nerve trunk, not a carved bone opening. See [feedback-anatomy.md](feedback-anatomy.md) for citations, provenance and review limits.

## Rebuilding

```bash
pip install -r tools/pipeline/requirements.txt
npm run assets:fetch      # sparse-checkout of the STL files listed in tools/pipeline/fma_ids.txt
npm run assets:build      # → tools/pipeline/.cache/build (≈15 min, tooth layers are cached)
npm run assets:compress   # → public/models
node tools/gen-assets-doc.mjs   # refresh the table below
python3 tools/pipeline/validate_assets.py tools/pipeline/.cache/build
```

`validate_assets.py` also checks that no nerve or vessel hangs below the mandible and that each maxillary sinus is one closed body inside its maxilla, clear of the teeth and of the nerves in its walls, with a volume of 3–25 cm³.

The Z-Anatomy centrelines are committed, so the steps above do not need Blender. To regenerate them, download `Z-Anatomy.zip` from <https://github.com/Z-Anatomy/Models-of-human-anatomy>, unzip `Startup.blend`, and run `python tools/pipeline/extract_z_anatomy.py --blend <Startup.blend> --bp3d tools/pipeline/raw/stl` with `bpy` 4.2 (Python 3.11), trimesh, SciPy and rtree installed. Loading the atlas needs about 4 GB of memory.

## Asset table

<!-- generated:start -->
| Mesh key | File | BodyParts3D source | Provenance | Modifications | Triangles |
|---|---|---|---|---|---|
| `anterior-superior-alveolar-nerve-left` | neurovascular.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 400 |
| `anterior-superior-alveolar-nerve-right` | neurovascular.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 400 |
| `articular-disc-left` | context.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 5,120 |
| `articular-disc-right` | context.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 5,120 |
| `articular-fossa-left` | context.glb | FMA52739 | derived | Transform + partition or approximation from the named source mesh (see below) | 260 |
| `articular-fossa-right` | context.glb | FMA52738 | derived | Transform + partition or approximation from the named source mesh (see below) | 269 |
| `buccal-artery-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 656 |
| `buccal-artery-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 656 |
| `buccal-nerve-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,184 |
| `buccal-nerve-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,184 |
| `buccinator-left` | context.glb | FMA46836 | source | Axis/unit transform, decimation, meshopt compression | 8,836 |
| `buccinator-right` | context.glb | FMA46835 | source | Axis/unit transform, decimation, meshopt compression | 8,858 |
| `descending-palatine-artery-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 2,464 |
| `descending-palatine-artery-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 2,464 |
| `ethmoid-bone` | context.glb | FMA52740 | source | Axis/unit transform, decimation, meshopt compression | 7,774 |
| `external-carotid-artery-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 840 |
| `external-carotid-artery-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 840 |
| `facial-artery-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,752 |
| `facial-artery-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,752 |
| `facial-buccal-branch-left` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 260 |
| `facial-buccal-branch-right` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 260 |
| `facial-cervical-branch-left` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 260 |
| `facial-cervical-branch-right` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 260 |
| `facial-marginal-mandibular-branch-left` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 260 |
| `facial-marginal-mandibular-branch-right` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 260 |
| `facial-nerve-left` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 620 |
| `facial-nerve-right` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 620 |
| `facial-temporal-branch-left` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 260 |
| `facial-temporal-branch-right` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 260 |
| `facial-vein-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 2,736 |
| `facial-vein-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 2,736 |
| `facial-zygomatic-branch-left` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 260 |
| `facial-zygomatic-branch-right` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 260 |
| `frontal-bone` | context.glb | FMA52734 | source | Axis/unit transform, decimation, meshopt compression | 15,000 |
| `frontal-sinus-left` | context.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 5,120 |
| `frontal-sinus-right` | context.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 5,120 |
| `gingiva-lower` | core.glb | FMA59764 | derived | Transform + partition or approximation from the named source mesh (see below) | 93,038 |
| `gingiva-upper` | core.glb | FMA59763 | derived | Transform + partition or approximation from the named source mesh (see below) | 99,072 |
| `glossopharyngeal-nerve-left` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 500 |
| `glossopharyngeal-nerve-right` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 500 |
| `greater-palatine-nerve-left` | neurovascular.glb | — | schematic | Teaching path generated by `palatal.py` (see innervation-identification.md) | 2,720 |
| `greater-palatine-nerve-right` | neurovascular.glb | — | schematic | Teaching path generated by `palatal.py` (see innervation-identification.md) | 2,720 |
| `hyoid-bone` | context.glb | FMA52749 | source | Axis/unit transform, decimation, meshopt compression | 5,534 |
| `hypoglossal-nerve-left` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 620 |
| `hypoglossal-nerve-right` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 620 |
| `incisive-nerve-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 656 |
| `incisive-nerve-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 656 |
| `inferior-alveolar-artery-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 4,024 |
| `inferior-alveolar-artery-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 4,024 |
| `inferior-alveolar-nerve-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 2,960 |
| `inferior-alveolar-nerve-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 2,960 |
| `inferior-alveolar-vein-left` | neurovascular.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 1,296 |
| `inferior-alveolar-vein-right` | neurovascular.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 1,296 |
| `inferior-nasal-concha-left` | context.glb | FMA54738 | source | Axis/unit transform, decimation, meshopt compression | 1,484 |
| `inferior-nasal-concha-right` | context.glb | FMA54737 | source | Axis/unit transform, decimation, meshopt compression | 1,616 |
| `infraorbital-nerve-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 2,968 |
| `infraorbital-nerve-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 2,968 |
| `internal-jugular-vein-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,440 |
| `internal-jugular-vein-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,440 |
| `lacrimal-bone-left` | context.glb | FMA53646 | source | Axis/unit transform, decimation, meshopt compression | 1,152 |
| `lacrimal-bone-right` | context.glb | FMA53645 | source | Axis/unit transform, decimation, meshopt compression | 1,114 |
| `lateral-pterygoid-lower-left` | context.glb | FMA49023 | source | Axis/unit transform, decimation, meshopt compression | 2,390 |
| `lateral-pterygoid-lower-right` | context.glb | FMA49022 | source | Axis/unit transform, decimation, meshopt compression | 2,420 |
| `lateral-pterygoid-upper-left` | context.glb | FMA49025 | source | Axis/unit transform, decimation, meshopt compression | 2,310 |
| `lateral-pterygoid-upper-right` | context.glb | FMA49024 | source | Axis/unit transform, decimation, meshopt compression | 2,328 |
| `lingual-nerve-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,168 |
| `lingual-nerve-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,168 |
| `mandible-body` | core.glb | FMA52748 | source | Axis/unit transform, decimation, meshopt compression | 10,599 |
| `mandibular-alveolar-process` | core.glb | FMA52748 | derived | Transform + partition or approximation from the named source mesh (see below) | 8,158 |
| `mandibular-canal-left` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 460 |
| `mandibular-canal-right` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 460 |
| `mandibular-condyle-left` | core.glb | FMA52748 | derived | Transform + partition or approximation from the named source mesh (see below) | 1,406 |
| `mandibular-condyle-right` | core.glb | FMA52748 | derived | Transform + partition or approximation from the named source mesh (see below) | 1,495 |
| `mandibular-nerve-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,800 |
| `mandibular-nerve-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,800 |
| `masseter-deep-left` | context.glb | FMA49005 | source | Axis/unit transform, decimation, meshopt compression | 9,000 |
| `masseter-deep-right` | context.glb | FMA49004 | source | Axis/unit transform, decimation, meshopt compression | 9,000 |
| `masseter-superficial-left` | context.glb | FMA49002 | source | Axis/unit transform, decimation, meshopt compression | 9,000 |
| `masseter-superficial-right` | context.glb | FMA49001 | source | Axis/unit transform, decimation, meshopt compression | 9,000 |
| `maxilla-left` | core.glb | FMA53650 | source | Axis/unit transform, decimation, meshopt compression | 7,747 |
| `maxilla-right` | core.glb | FMA53649 | source | Axis/unit transform, decimation, meshopt compression | 6,943 |
| `maxillary-alveolar-process-left` | core.glb | FMA53650 | derived | Transform + partition or approximation from the named source mesh (see below) | 6,759 |
| `maxillary-alveolar-process-right` | core.glb | FMA53649 | derived | Transform + partition or approximation from the named source mesh (see below) | 7,205 |
| `maxillary-artery-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 5,416 |
| `maxillary-artery-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 5,416 |
| `maxillary-nerve-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,176 |
| `maxillary-nerve-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,176 |
| `maxillary-sinus-left` | core.glb | FMA53650 | modeled | Modeled by `sinus.py`: the source maxilla hollowed out inward (see above) | 5,000 |
| `maxillary-sinus-right` | core.glb | FMA53649 | modeled | Modeled by `sinus.py`: the source maxilla hollowed out inward (see above) | 5,000 |
| `maxillary-vein-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,944 |
| `maxillary-vein-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,944 |
| `medial-pterygoid-left` | context.glb | FMA49013 | source | Axis/unit transform, decimation, meshopt compression | 7,368 |
| `medial-pterygoid-right` | context.glb | FMA49012 | source | Axis/unit transform, decimation, meshopt compression | 7,444 |
| `mental-nerve-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,200 |
| `mental-nerve-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,200 |
| `mentalis-left` | context.glb | FMA46827 | source | Axis/unit transform, decimation, meshopt compression | 1,852 |
| `mentalis-right` | context.glb | FMA46826 | source | Axis/unit transform, decimation, meshopt compression | 1,892 |
| `middle-superior-alveolar-nerve-left` | neurovascular.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 304 |
| `middle-superior-alveolar-nerve-right` | neurovascular.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 304 |
| `nasal-bone-left` | context.glb | FMA53648 | source | Axis/unit transform, decimation, meshopt compression | 1,124 |
| `nasal-bone-right` | context.glb | FMA53647 | source | Axis/unit transform, decimation, meshopt compression | 1,024 |
| `nasopalatine-nerve-left` | neurovascular.glb | — | schematic | Teaching path generated by `palatal.py` (see innervation-identification.md) | 1,520 |
| `nasopalatine-nerve-right` | neurovascular.glb | — | schematic | Teaching path generated by `palatal.py` (see innervation-identification.md) | 1,520 |
| `occipital-bone` | context.glb | FMA52735 | source | Axis/unit transform, decimation, meshopt compression | 11,998 |
| `ophthalmic-nerve-left` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 500 |
| `ophthalmic-nerve-right` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 500 |
| `orbicularis-oris` | context.glb | FMA46841 | source | Axis/unit transform, decimation, meshopt compression | 9,000 |
| `palatine-bone-left` | context.glb | FMA53656 | source | Axis/unit transform, decimation, meshopt compression | 3,642 |
| `palatine-bone-right` | context.glb | FMA53655 | source | Axis/unit transform, decimation, meshopt compression | 3,592 |
| `parietal-bone-left` | context.glb | FMA52789 | source | Axis/unit transform, decimation, meshopt compression | 12,000 |
| `parietal-bone-right` | context.glb | FMA52788 | source | Axis/unit transform, decimation, meshopt compression | 12,000 |
| `posterior-superior-alveolar-artery-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,168 |
| `posterior-superior-alveolar-artery-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 1,168 |
| `posterior-superior-alveolar-nerve-left` | neurovascular.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 400 |
| `posterior-superior-alveolar-nerve-right` | neurovascular.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 400 |
| `pterygoid-plexus-left` | neurovascular.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 1,648 |
| `pterygoid-plexus-right` | neurovascular.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 1,648 |
| `retromandibular-vein-left` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 816 |
| `retromandibular-vein-right` | neurovascular.glb | — | atlas | Z-Anatomy centreline (CC BY-SA 4.0) fitted to the jaws, swept into a tube by `build_assets.py` | 816 |
| `sphenoid-bone` | context.glb | FMA52736 | source | Axis/unit transform, decimation, meshopt compression | 15,000 |
| `sphenoidal-sinus-left` | context.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 5,120 |
| `sphenoidal-sinus-right` | context.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 5,120 |
| `temporal-bone-left` | context.glb | FMA52739 | source | Axis/unit transform, decimation, meshopt compression | 10,948 |
| `temporal-bone-right` | context.glb | FMA52738 | source | Axis/unit transform, decimation, meshopt compression | 11,005 |
| `temporalis-left` | context.glb | FMA49008 | source | Axis/unit transform, decimation, meshopt compression | 14,998 |
| `temporalis-right` | context.glb | FMA49007 | source | Axis/unit transform, decimation, meshopt compression | 15,000 |
| `tooth-11` | core.glb | FMA55681 | schematic | Generated by `build_assets.py` from computed landmarks | 25,784 |
| `tooth-12` | core.glb | FMA55680 | schematic | Generated by `build_assets.py` from computed landmarks | 27,368 |
| `tooth-13` | core.glb | FMA55798 | schematic | Generated by `build_assets.py` from computed landmarks | 27,864 |
| `tooth-14` | core.glb | FMA55689 | schematic | Generated by `build_assets.py` from computed landmarks | 32,216 |
| `tooth-15` | core.glb | FMA55688 | schematic | Generated by `build_assets.py` from computed landmarks | 52,568 |
| `tooth-16` | core.glb | FMA55698 | schematic | Generated by `build_assets.py` from computed landmarks | 43,144 |
| `tooth-17` | core.glb | FMA55697 | schematic | Generated by `build_assets.py` from computed landmarks | 37,016 |
| `tooth-18` | core.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 37,016 |
| `tooth-21` | core.glb | FMA55682 | schematic | Generated by `build_assets.py` from computed landmarks | 25,776 |
| `tooth-22` | core.glb | FMA55683 | schematic | Generated by `build_assets.py` from computed landmarks | 27,584 |
| `tooth-23` | core.glb | FMA55799 | schematic | Generated by `build_assets.py` from computed landmarks | 27,864 |
| `tooth-24` | core.glb | FMA55690 | schematic | Generated by `build_assets.py` from computed landmarks | 32,232 |
| `tooth-25` | core.glb | FMA55691 | schematic | Generated by `build_assets.py` from computed landmarks | 50,536 |
| `tooth-26` | core.glb | FMA55699 | schematic | Generated by `build_assets.py` from computed landmarks | 43,152 |
| `tooth-27` | core.glb | FMA55700 | schematic | Generated by `build_assets.py` from computed landmarks | 36,976 |
| `tooth-28` | core.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 36,976 |
| `tooth-31` | core.glb | FMA57143 | schematic | Generated by `build_assets.py` from computed landmarks | 18,384 |
| `tooth-32` | core.glb | FMA57141 | schematic | Generated by `build_assets.py` from computed landmarks | 19,216 |
| `tooth-33` | core.glb | FMA55687 | schematic | Generated by `build_assets.py` from computed landmarks | 23,624 |
| `tooth-34` | core.glb | FMA55693 | schematic | Generated by `build_assets.py` from computed landmarks | 23,544 |
| `tooth-35` | core.glb | FMA55692 | schematic | Generated by `build_assets.py` from computed landmarks | 22,480 |
| `tooth-36` | core.glb | FMA55704 | schematic | Generated by `build_assets.py` from computed landmarks | 35,240 |
| `tooth-37` | core.glb | FMA55703 | schematic | Generated by `build_assets.py` from computed landmarks | 32,352 |
| `tooth-38` | core.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 32,352 |
| `tooth-41` | core.glb | FMA57142 | schematic | Generated by `build_assets.py` from computed landmarks | 18,400 |
| `tooth-42` | core.glb | FMA57140 | schematic | Generated by `build_assets.py` from computed landmarks | 19,160 |
| `tooth-43` | core.glb | FMA55686 | schematic | Generated by `build_assets.py` from computed landmarks | 23,576 |
| `tooth-44` | core.glb | FMA55694 | schematic | Generated by `build_assets.py` from computed landmarks | 23,600 |
| `tooth-45` | core.glb | FMA55695 | schematic | Generated by `build_assets.py` from computed landmarks | 22,496 |
| `tooth-46` | core.glb | FMA55705 | schematic | Generated by `build_assets.py` from computed landmarks | 35,272 |
| `tooth-47` | core.glb | FMA55706 | schematic | Generated by `build_assets.py` from computed landmarks | 32,408 |
| `tooth-48` | core.glb | — | schematic | Generated by `build_assets.py` from computed landmarks | 32,408 |
| `trigeminal-nerve-left` | neurovascular.glb | — | atlas | Full sampled Z-Anatomy root and ganglion, swept into a tube by `cranial.py` | 660 |
| `trigeminal-nerve-right` | neurovascular.glb | — | atlas | Full sampled Z-Anatomy root and ganglion, swept into a tube by `cranial.py` | 660 |
| `vagus-nerve-left` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 500 |
| `vagus-nerve-right` | neurovascular.glb | — | schematic | Teaching path or canal envelope generated by `cranial.py` (see feedback-anatomy.md) | 500 |
| `vomer` | context.glb | FMA9710 | source | Axis/unit transform, decimation, meshopt compression | 2,422 |
| `zygomatic-bone-left` | context.glb | FMA52893 | source | Axis/unit transform, decimation, meshopt compression | 4,560 |
| `zygomatic-bone-right` | context.glb | FMA52892 | source | Axis/unit transform, decimation, meshopt compression | 4,612 |

Plus 32 tooth assets in `teeth/tooth-XX.glb` (provenance `modeled`), each containing enamel, coronal and radicular dentin, cementum, periodontal ligament, pulp chamber and one mesh per root canal, derived from the corresponding tooth mesh above.
<!-- generated:end -->


## Student-feedback teaching refinements (2026-10-05)

Permanent crown surfaces and their inner tissues now include schematic tooth-specific relief fitted to the existing BodyParts3D template. Source roots are preserved before simplification; third molars retain their derived second-molar origin. Frontal/sphenoidal volumes are original schematic regional examples, not segmented air cavities. No supplied screenshot or third-party artwork is a production asset. Ethmoidal air-cell teaching clusters were removed at the owner’s request. These additions retain draft review status. See [the implementation report](student-feedback-implementation.md) for medical sources, geometry/provenance limitations, generation commands and the review checklist. Existing source attribution/licensing remains in force; no contributor-credit feature has been added.
