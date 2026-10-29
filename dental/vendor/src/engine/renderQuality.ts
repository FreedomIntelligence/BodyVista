/** Bound GPU work on high-DPI tablets while preserving detail on smaller screens.
 * Pixel-count budgeting follows the Three.js responsive-rendering manual. */
export function renderPixelRatio(width: number, height: number, deviceRatio: number, touch: boolean): number {
  const budget = touch ? 2_000_000 : 4_000_000;
  return Math.min(deviceRatio || 1, touch ? 1.5 : 2, Math.sqrt(budget / Math.max(1, width * height)));
}
