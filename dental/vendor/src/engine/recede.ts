/**
 * How nerves and vessels recede into the background (issues #26 and #27). Pure, so it is tested
 * without a renderer; the engine animates `quiet` toward `quietLevel` and fades by it.
 */
import type { MeshVisual } from '../state/visibility';

export interface RecedeEntry {
  /** highlight target: > 0 while selected or hovered */
  hiTarget: number;
  /** trunk outside the dental region (Structure.regional) */
  regional?: boolean;
  /** dental nerve */
  nerve?: boolean;
}

/** Quiet vessels: opacity when fully quiet. */
export const QUIET_OPACITY = 0.3;
/** Regional trunks: opacity when fully quiet. */
export const REGIONAL_OPACITY = 0.1;
/** Regional trunks outside the arch dissection: how quiet they are (≈ 0.37 opacity). */
export const REGIONAL_REST = 0.7;

/**
 * How far a nerve or vessel recedes (0 = full strength, 1 = quiet). `dissecting` is how far the
 * arch dissection has progressed (0…1). Dental nerves never recede. Dental vessels recede while the
 * jaws are dissected. Regional trunks are always part-way quiet and recede fully while the jaws are
 * dissected. Anything selected or hovered comes back at full strength.
 */
export function quietLevel(e: RecedeEntry, dissecting: number): number {
  if (e.hiTarget > 0) return 0;
  if (e.regional) return REGIONAL_REST + (1 - REGIONAL_REST) * dissecting;
  return e.nerve ? 0 : dissecting;
}

/** Opacity factor at a quiet level. */
export function quietOpacity(e: Pick<RecedeEntry, 'regional'>, quiet: number): number {
  return 1 - (1 - (e.regional ? REGIONAL_OPACITY : QUIET_OPACITY)) * quiet;
}

/**
 * Shown and not receded: counts for picking and hides labels behind it. Ghosts and quiet paths
 * never do, so a faded vessel never blocks the nerve behind it.
 */
export function isSolid(e: { visual: MeshVisual; quiet?: number }): boolean {
  return e.visual === 'on' && (e.quiet ?? 0) < 0.5;
}
