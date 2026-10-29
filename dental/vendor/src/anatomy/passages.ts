import type { Registry } from './registry';

const ROUTES = [
  ['trigeminal-nerve', 'ophthalmic-nerve', 'maxillary-nerve', 'mandibular-nerve', 'superior-orbital-fissure', 'foramen-rotundum', 'foramen-ovale'],
  ['mandibular-foramen', 'mandibular-canal', 'inferior-alveolar-nerve', 'mental-foramen', 'mental-nerve', 'incisive-nerve'],
  ['infraorbital-foramen', 'infraorbital-nerve', 'maxillary-nerve'],
  ['superior-orbital-fissure', 'ophthalmic-nerve', 'trigeminal-nerve'],
  ['foramen-rotundum', 'maxillary-nerve'], ['foramen-ovale', 'mandibular-nerve'],
  ['stylomastoid-foramen', 'facial-nerve', 'facial-temporal-branch', 'facial-zygomatic-branch', 'facial-buccal-branch', 'facial-marginal-mandibular-branch', 'facial-cervical-branch'],
  ['jugular-foramen', 'glossopharyngeal-nerve', 'vagus-nerve'], ['hypoglossal-canal', 'hypoglossal-nerve'],
];
export function passageFor(registry: Registry, id: string): string[] {
  const match = /^(.*)-(right|left)$/.exec(id);
  if (!match) return [];
  const routes = ROUTES.filter((r) => r.includes(match[1]) && (r[0] !== 'trigeminal-nerve' || match[1] === 'trigeminal-nerve'));
  return [...new Set(routes.flat().map((key) => `${key}-${match[2]}`))].filter((key) => !!registry.get(key));
}

/** Landmarks follow their actual supporting bone, including during dissection. */
export function landmarkHost(registry: Registry, id: string): string | undefined {
  const structure = registry.get(id);
  if (!structure) return undefined;
  const side = /-(right|left)$/.exec(id)?.[1];
  for (const parent of registry.ancestors(id)) {
    const keys = registry.meshesOf(parent.id);
    const bone = keys.find((k) => k === 'mandible-body' || (side && k === `maxilla-${side}`) || k === parent.id);
    if (bone) return bone;
    if (parent.meshes.length) return parent.meshes[0];
    if (parent.id === registry.rootId) break;
  }
  return undefined;
}
