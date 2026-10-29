/** Keep in sync with the compact-layout media queries in app.css. */
export const COMPACT_LAYOUT = '(max-width: 1023px), (pointer: coarse) and (max-width: 1366px)';

export const isCompactLayout = () => window.matchMedia(COMPACT_LAYOUT).matches;
