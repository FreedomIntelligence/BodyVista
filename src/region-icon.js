// Schematic location markers, not anatomical models. Highlight every assigned region.
const segments = {
  head: '<ellipse cx="20" cy="7" rx="5" ry="6"/>',
  neck: '<path d="M17 14h6v5h-6z"/>',
  thorax: '<path d="M12 20h16l-2 13H14z"/>',
  abdomen: '<path d="M14 34h12v8H14z"/>',
  pelvis: '<path d="M13 43h14l-3 7h-8z"/>',
  upper: '<path d="M10 20 6 22 2 44l4 1 5-18zm20 0 4 2 4 22-4 1-5-18z"/>',
  lower: '<path d="M13 51h6l-2 19h-5zm8 0h6l1 19h-5z"/>',
};
export function regionIcon(regions = []) {
  const selected = new Set(regions);
  return `<svg viewBox="0 0 40 72" aria-hidden="true" focusable="false">${Object.entries(segments).map(([region,path])=>`<g fill="${selected.has('all')||selected.has(region)?'currentColor':'#dce5e9'}">${path}</g>`).join('')}</svg>`;
}
