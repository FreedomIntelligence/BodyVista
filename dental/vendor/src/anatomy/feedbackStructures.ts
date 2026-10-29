import type { StructureDef } from './structures.ts';

const nerves = [
  ['ophthalmic-nerve', 'ophthalmic nerve (V1)', 'n. ophthalmicus', 'cn v1'],
  ['facial-nerve', 'facial nerve (VII)', 'n. facialis', 'cn vii'],
  ['glossopharyngeal-nerve', 'glossopharyngeal nerve (IX)', 'n. glossopharyngeus', 'cn ix'],
  ['vagus-nerve', 'vagus nerve (X)', 'n. vagus', 'cn x'],
  ['hypoglossal-nerve', 'hypoglossal nerve (XII)', 'n. hypoglossus', 'cn xii'],
];
const branches = ['temporal', 'zygomatic', 'buccal', 'marginal-mandibular', 'cervical'];
const exits = [
  ['superior-orbital-fissure', 'superior orbital fissure', 'sphenoid-bone', 'fissura orbitalis superior'],
  ['foramen-rotundum', 'foramen rotundum', 'sphenoid-bone', 'foramen rotundum'],
  ['foramen-ovale', 'foramen ovale', 'sphenoid-bone', 'foramen ovale'],
  ['stylomastoid-foramen', 'stylomastoid foramen', 'temporal-bone', 'foramen stylomastoideum'],
  ['jugular-foramen', 'jugular foramen', 'occipital-bone', 'foramen jugulare'],
  ['hypoglossal-canal', 'hypoglossal canal', 'occipital-bone', 'canalis nervi hypoglossi'],
  ['articular-eminence', 'articular eminence', 'temporal-bone', 'eminentia articularis', 'tuberculum articulare'],
];
export const FEEDBACK_STRUCTURES: StructureDef[] = (['right', 'left'] as const).flatMap((side) => {
  const prefix = side === 'right' ? 'Right' : 'Left';
  return [
    { id: `infraorbital-foramen-${side}`, name: `${prefix} infraorbital foramen`, parent: `maxilla-${side}`, kind: 'landmark', landmark: `infraorbital-foramen-${side}`, categories: ['maxilla'], provenance: 'atlas', labelPriority: 3, aliases: ['foramen infraorbitale', 'infraorbital exit'] },
    ...nerves.map(([base, name, latin, abbr]): StructureDef => ({ id: `${base}-${side}`, name: `${prefix} ${name}`, parent: base === 'ophthalmic-nerve' ? `trigeminal-nerve-${side}` : base === 'facial-nerve' ? 'facial-nerves' : 'lower-cranial-nerves', categories: ['nerves'], meshes: [`${base}-${side}`], provenance: 'schematic', labelPriority: 3, aliases: [latin, abbr, name], })),
    ...branches.map((branch): StructureDef => ({ id: `facial-${branch}-branch-${side}`, name: `${prefix} ${branch.replace('-', ' ')} branch of facial nerve`, parent: `facial-nerve-${side}`, categories: ['nerves'], meshes: [`facial-${branch}-branch-${side}`], provenance: 'schematic', labelPriority: 2, aliases: [`facial ${branch} branch`, 'cn vii'] })),
    { id: `mandibular-canal-${side}`, name: `${prefix} mandibular canal`, parent: 'mandible', categories: ['mandible'], meshes: [`mandibular-canal-${side}`], provenance: 'schematic', labelPriority: 3, aliases: ['canalis mandibulae', 'inferior alveolar canal', 'mandibularkanal'] },
    ...exits.map(([base, name, parent, ...aliases]): StructureDef => ({ id: `${base}-${side}`, name: `${prefix} ${name}`, parent: parent === 'temporal-bone' ? `${parent}-${side}` : parent, kind: 'landmark', landmark: `${base}-${side}`, categories: base === 'articular-eminence' ? ['tmj'] : ['skull'], provenance: 'schematic', labelPriority: 3, aliases })),
  ];
});
