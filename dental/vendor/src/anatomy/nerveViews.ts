import type { Registry } from './registry';

export const NERVE_VIEWS = ['dental', 'trigeminal', 'facial', 'lower-cranial', 'all'] as const;
export type NerveView = typeof NERVE_VIEWS[number];
export type NerveSide = 'both' | 'right' | 'left';
const DENTAL = /^(trigeminal-nerve|mandibular-nerve|inferior-alveolar-nerve|mental-nerve|incisive-nerve|lingual-nerve|buccal-nerve|maxillary-nerve|infraorbital-nerve|(?:posterior|middle|anterior)-superior-alveolar-nerve|greater-palatine-nerve|nasopalatine-nerve)(?:-|$)/;

/** Display groups preserve the anatomical course; they only choose which paths to inspect. */
export function nerveInView(registry: Registry, id: string, view: NerveView, side: NerveSide): boolean {
  const matchedSide = /-(right|left)$/.exec(id)?.[1];
  if (side !== 'both' && matchedSide && matchedSide !== side) return false;
  if (view === 'all') return true;
  if (view === 'dental') return DENTAL.test(id);
  return registry.isDescendant(id, view === 'trigeminal' ? 'trigeminal-nerves' : view === 'facial' ? 'facial-nerves' : 'lower-cranial-nerves');
}

export function nerveViewFor(registry: Registry, id: string): NerveView {
  if (/^trigeminal-nerve-(right|left)$/.test(id)) return 'trigeminal';
  if (DENTAL.test(id)) return 'dental';
  if (registry.isDescendant(id, 'trigeminal-nerves')) return 'trigeminal';
  if (registry.isDescendant(id, 'facial-nerves')) return 'facial';
  if (registry.isDescendant(id, 'lower-cranial-nerves')) return 'lower-cranial';
  return 'all';
}
