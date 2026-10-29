/**
 * Which tooth dissection level shows a given tooth part (see DISSECT_LEVELS in the store and
 * DISSECT_RULES in visibility.ts). Used when a part is chosen from search, the tree or a link.
 */

/** A dissection level at which a given tooth part is fully visible. */
export function levelShowing(id: string): number {
  if (id.startsWith('canal-') || id.startsWith('root-canals-') || id.startsWith('apical-')) return 4;
  if (id.startsWith('enamel-') || id.startsWith('crown-') || id.startsWith('cej-')) return 0;
  if (id.startsWith('pdl-') || id.startsWith('cementum-') || id.startsWith('root-') || id.startsWith('apex-')) return 1;
  if (id.startsWith('dentin')) return 2;
  if (id.startsWith('pulp-chamber') || id.startsWith('pulp-horn') || id.startsWith('pulp-')) return 3;
  return 0;
}

/** Does the given dissection level already show this tooth part? */
export function levelShows(level: number, id: string): boolean {
  const want = levelShowing(id);
  if (want >= 3) return level >= 3;
  if (want === 2) return level === 2;
  return level <= 1 || want === level;
}
