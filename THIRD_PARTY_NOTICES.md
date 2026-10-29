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
