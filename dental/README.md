# BodyVista oral workspace

This is a locally bundled, on-demand workspace, not an embed of a hosted website.
`index.html` is a second Vite entry. Model URLs are relative to `dental/`, so both
root and GitHub Pages project deployments work. `src/dental-workspace.js` owns
navigation and the same-origin language/exit bridge. Removing the iframe releases
its WebGL context and playback without changing anatomy quiz questions.

The engine, anatomical registry, source descriptions and models were adapted from
the local Dental Scope project. Original MIT license, attribution and model asset
modification records are retained under `vendor/`. BodyVista adds a Chinese,
English and Japanese interface, tooth naming, localized tissue summaries, parent
navigation, responsive controls and screenshot capture. The model remains a
schematic educational representation; descriptions await expert review. Adapted
educational descriptions are distributed under CC BY-SA 4.0; model licenses
remain as listed in `vendor/CREDITS.md` and `vendor/docs/assets.md`.

Build with `npm run build`. The build checks upstream description coverage and
BodyVista oral translations before packaging. `dental/models` is copied to the
production bundle; no backend or runtime external API is required.

Jaw movement and development run as scene-only embedded renderers inside the
existing Life in Motion canvas. The host owns the activity selector, shared
transport, progress and playback settings. Same-origin messages connect these
controls to the renderer; anatomical tooth exploration keeps its own workspace.
