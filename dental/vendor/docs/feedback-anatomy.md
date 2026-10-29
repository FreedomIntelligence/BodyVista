# Dental feedback implementation and review

Implemented 2026-10-04 in the existing React/Three.js explorer, with no new runtime dependencies. The user approved retaining atlas anatomy and adding researched schematic teaching paths where source meshes were unavailable. Text remains **draft**, pending dental review. Nothing has been merged.

## Included

- Swedish **Bihålor**, specifically the maxillary sinuses. Old `käkhåla` search terms remain. The generated `sv/anatomi/kakhalor/` page redirects to the new Swedish guide.
- **Nerves & muscles** layer preset, plus a contextual hint for layer and individual transparency.
- Nerve passage views: mandibular/mental/infraorbital foramina, mandibular canal, and the exits of V1/V2/V3, VII, IX/X and XII. Nerve and passage details link to each other. The mental foramen text describes its common premolar locations and variation.
- Canal-count tables for all 16 permanent tooth types, displayed for all 32 teeth and in all five languages, including static guide pages.
- Full sampled atlas CN V root and ganglion, retained atlas V2/V3 and dental branches, schematic V1, VII with five separately selectable terminal branch groups, IX, X and XII on both sides.
- Opening/closing controls with play, pause, scrub, reset and left/right joint views. Lower teeth, gingiva, alveolar bone and mandible move together. Discs translate with less rotation; pterygoid and other muscle deformation illustrates fixed and moving attachments. Reduced-motion preferences prevent playback; manual scrubbing remains available. Moving landmarks and labels follow their host geometry.

## Evidence and model limits

### Description and navigation follow-up

The registry-wide audit found 36 selectable items without summaries, including paired skull bones, the hyoid, category groups and the infraorbital foramina. They now have localized descriptions in all five languages. Masseter parts, lateral pterygoid heads and upper/lower gingiva also have specific descriptions, and each facial terminal branch describes its own distribution.

Skull descriptions were checked against [OpenStax, The Skull](https://openstax.org/books/anatomy-and-physiology-2e/pages/7-2-the-skull). Muscle and gingiva entries cite [mastication muscles](https://www.ncbi.nlm.nih.gov/books/NBK541027/), [masseter](https://www.ncbi.nlm.nih.gov/books/NBK539869/), [lateral pterygoid](https://www.ncbi.nlm.nih.gov/books/NBK549799/) and [oral gingiva](https://www.ncbi.nlm.nih.gov/books/NBK560662/). Vascular group text cites [carotid arteries](https://www.ncbi.nlm.nih.gov/books/NBK545238/) and [pterygoid plexus](https://www.ncbi.nlm.nih.gov/books/NBK555896/).

The hyoid panel shows its suspension from the skull and mandible and its lower attachments. Sources: [hyoid bone](https://www.ncbi.nlm.nih.gov/books/NBK539726/), [suprahyoid muscles](https://www.ncbi.nlm.nih.gov/books/NBK546710/), [sternohyoid](https://www.ncbi.nlm.nih.gov/books/NBK547693/) and [thyrohyoid membrane](https://www.ncbi.nlm.nih.gov/books/NBK532995/). It distinguishes the stylohyoid ligament, muscles and digastric tendon sling from a bony articulation. These explanatory attachments are not new 3D meshes.

Nerves now start with the dental V2/V3 supply. The layer panel offers dental, trigeminal, facial, IX/X/XII and all-nerve views, with anatomical left/right filtering. Search selection reveals the relevant hidden family and side. Focused nerve passage views override the family filter. Existing nerve geometry is unchanged.

Review the hyoid panel's three attachment tabs and the description for each skull bone, then switch nerve groups and sides on desktop and phone layouts. Missing descriptions or translations now fail tests and the production build.

| Topic | Source and interpretation |
|---|---|
| Canal counts, first through second molars | [Monsarrat et al., 2016, Table 2](https://doi.org/10.1371/journal.pone.0165329). 2,424 teeth from 102 retained adult CBCT scans, Toulouse, France, 200 µm voxels. Counts grouped across left/right teeth and across root-count columns by total canal count. Small canals may be missed. No third molars in this dataset. |
| Third molar counts | [Al-Qudah et al., 2023, Table 2](https://doi.org/10.1038/s41598-023-34134-7). Extracted teeth from northern Jordan, staining and clearing. Upper n=592: 1–5 canals = 35/68/310/167/12. Lower n=639: 7/188/356/87/1. The study uses the **maximum** canal count anywhere along a tooth. |
| Mental foramen position | [CBCT systematic review, 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC7806401/). Commonly between premolars or under the second premolar, with individual and population variation. The displayed landmark belongs to this fitted example. |
| CN V and exits | [NCBI trigeminal anatomy](https://www.ncbi.nlm.nih.gov/books/NBK482283/). V1/superior orbital fissure, V2/rotundum, V3/ovale. Root and existing divisions use fitted atlas data; V1 is representative rather than a complete orbital atlas. |
| Inferior alveolar nerve and canal | [NCBI inferior alveolar anatomy](https://www.ncbi.nlm.nih.gov/books/NBK546712/). The canal envelope follows the atlas nerve trunk between entry and exit landmarks. |
| CN VII | [NCBI facial nerve anatomy](https://www.ncbi.nlm.nih.gov/books/NBK554569/). Temporal-bone route, stylomastoid exit and terminal facial branches. Motor facial branches are distinguished from the sensory buccal nerve of V3. |
| CN IX/X | [NCBI glossopharyngeal and vagus anatomy](https://www.ncbi.nlm.nih.gov/books/NBK386/). Representative head and upper-neck paths; vagal thoracic/abdominal and recurrent laryngeal courses are outside this model. CN XI is mentioned at the jugular foramen but is not modeled. |
| CN XII | [NCBI hypoglossal anatomy](https://www.ncbi.nlm.nih.gov/books/NBK532869/). Skull exit and representative route towards the tongue. Tongue muscles are not included. |
| Joint opening | [TMJ imaging, 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9031630/), [movement discussion, 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4062347/). Rotation and translation overlap; the condyle–disc complex glides anteriorly/inferiorly on the articular eminence. The example stops at an illustrative opening rather than demonstrating dislocation over the tubercle. |

The two canal studies remain separate estimates with their methods and definitions visible. Percentages are computed from counts and sample sizes, not pooled across studies or presented as universal probabilities. They describe canals, not roots or Vertucci configurations. The tooth geometry continues to show one modeled configuration.

New cranial paths, skull-exit markers and the mandibular canal envelope are **schematic**. They do not carve measured openings into the source bone. VII branches are placed relative to the source masseter surface. The coordinate control points and simplified joint motion require anatomical review; this is not a complete cranial-nerve atlas, patient measurement or biomechanical simulation. The root, ganglion and three main trigeminal divisions are present; small terminal and intracranial branches remain simplified.

## Reproduction

`tools/import-canal-counts.py` imports PLOS Table 2 from its JATS manuscript XML and checks every count total. Third-molar counts are transcribed above and in the importer.

`tools/pipeline/cranial.py` is called by the normal full asset pipeline. For an existing uncompressed `.cache/build`, running it directly updates only neurovascular geometry and manifest additions, preserving the current gingiva and tooth assets. Follow with `npm run assets:compress` and `node tools/gen-assets-doc.mjs`. On Windows use the pipeline Python environment and `-X utf8` for validation output.

The engine retains arch-dissection morph target 0 and uses target 1 for jaw deformation. Rigid jaw transforms are applied to mesh matrices. Landmark hosts and label anchors use current world transforms; label morph displacement is sampled at the nearest vertex. Jaw playback stays in the engine, with progress updated directly in the controls at 10 Hz, avoiding React renders per animation frame. Joint motion and dissection/layout modes are mutually exclusive.

## Server review checklist

1. Switch to Swedish: verify **Bihålor**, old/new search terms and the old Swedish guide redirect in the production build.
2. Open teeth 14, 16, 31, 36, 18 and 38: inspect percentage tables, sample sizes and source links; compare upper/lower third-molar definitions with the other teeth.
3. Choose **Nerves & muscles**. Search/select mental nerve and mental foramen; use **Show nerve passage**. Inspect the route through translucent bone, labels, lower premolar references and reciprocal links.
4. Inspect V1/V2/V3, VII with its five branches, IX, X and XII on both sides. Review the schematic courses and skull-exit positions against the cited anatomy. Check VII around masseter, buccinator and orbicularis oris.
5. Open **Jaw movement**, scrub, play/pause and switch sides. Inspect condyle, disc, eminence and both pterygoid heads. Try transparency, labels, sectioning, tooth dissection and Reset all. Enable reduced motion and confirm playback stops while scrubbing works.
6. Repeat passage and joint controls on a phone-sized viewport and check light/dark themes and translated text.

Dental review of the new paths, landmark coordinates, deformation and content is still pending. Server review and merge approval remain with the user.

## Engineering checks

- Skull context and muscles start opaque in the overview; muscles are also opaque in the joint view. Arch disassembly makes the skull context and muscles translucent, the laid-out board fades them away, and reset restores the assembled visibility; this sequence was checked in the browser.
- TypeScript checks and production build pass; 148 tests pass, including count reconciliation, nerve connectivity, landmark hosts, route filtering, jaw-state regressions, nerve group/side navigation and description coverage (including rejection of missing translations and generic parent fallback).
- Asset validation passes for 35 GLBs, 407 meshes and 2,637,212 triangles, including cranial path connectivity and schematic provenance. It still reports 34 existing internal tooth surfaces with nonmanifold edges; this extension does not alter those tooth assets.
- Browser checks cover desktop and 390×844 layouts: canal tables, Swedish passage details, transparency, jaw scrubbing/playback, the production Swedish guide redirect, hyoid attachment tabs, skull descriptions and nerve group/side controls.
- The current gingiva/core asset was preserved, as were context and per-tooth geometry. The cranial extension changes `neurovascular.glb` and the manifest.
- The original feedback extension is organized in eight commits on `codex/dental-feedback`. The description, hyoid and nerve organization follow-up is organized in three further commits. Server review and merge approval remain pending.

## Feedback recheck, 2026-10-07

The repeated feedback was checked against the current registry, localized content, visibility controls, motion engine and shipped assets. The requested features are already present:

| Request | Where to find it |
|---|---|
| Nerve openings, names and locations | Search for a foramen or nerve, then choose **Visa nervens passage**. The mental foramen panel includes premolar location and variation, and links to the mental/inferior alveolar nerves and mandibular canal. |
| Canal-count percentages | Select any permanent tooth. **Kanalantal i en studie** shows counts, percentages, sample size, method and source; coverage includes wisdom teeth. |
| Temporalis, buccinator, masseter and orbicularis oris | The existing context asset contains each requested muscle. Use **Nerver & muskler** and search or the structure tree. |
| Swedish sinus terminology | The visible preset and category say **Bihålor**; maxillary sinus names identify the sinus in the upper jaw. Older search aliases and guide redirects remain usable. |
| Individual bone/muscle transparency | Select a structure and choose **Genomskinlig**, or use the transparency control beside a layer. Individual masseter transparency was checked in the browser. |
| Additional cranial nerves | **Nervgrupper** offers trigeminal V, facial VII, IX/X/XII and all nerves. The requested nerves are selectable on both sides. |
| Joint motion and pterygoid relationships | **Käkrörelse** offers play/pause, manual opening, reset and joint-side views, with condyle, disc, eminence and muscle context. Playback and manual opening were checked in the browser. |

The trigeminal root/ganglion and V1/V2/V3 are present, but this remains a representative teaching model rather than every small branch of a complete cranial-nerve atlas. The existing schematic and draft notices remain in place.

Recheck validation: **211 tests in 30 files pass**, including all 32 permanent teeth, five-language description coverage, passage navigation and jaw motion. The shipped-asset validator passes for **411 meshes**, checking decompression, file sizes, node registration, finite coordinates, triangle counts and bounds. The production build passes. The first-visit guide now runs faster, focuses the representative tooth within the space left by its panels, keeps labels on, and uses the opposite light/dark palette with a prominent skip control.
