/**
 * Declarative definitions of non-tooth structures.
 * Teeth and their internal parts are generated in registry.ts from tables.
 * `meshes` are scene node keys produced by tools/pipeline/build_assets.py.
 */
import type { CategoryId, Provenance, StructureKind } from './types.ts';
import { FEEDBACK_STRUCTURES } from './feedbackStructures.ts';

export interface StructureDef {
  id: string;
  name: string;
  parent: string | null;
  kind?: StructureKind;
  categories?: CategoryId[];
  meshes?: string[];
  aliases?: string[];
  provenance?: Provenance;
  labelPriority?: number;
  shortName?: string;
  /** landmark key in manifest.landmarks */
  landmark?: string;
  /**
   * A nerve or vessel trunk outside the dental region, kept so the dental branches connect
   * to something: drawn quiet (pale and translucent) and never labelled on its own.
   */
  regional?: boolean;
}

const LR = ['right', 'left'] as const;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function bilateral(
  base: string,
  name: string,
  parent: (side: string) => string,
  extra: Omit<StructureDef, 'id' | 'name' | 'parent'> & { meshSuffixes?: string[] } = {},
): StructureDef[] {
  return LR.map((side) => {
    const { meshSuffixes, ...rest } = extra;
    const id = `${base}-${side}`;
    return {
      id,
      name: `${cap(side)} ${name}`,
      parent: parent(side),
      meshes: meshSuffixes ? meshSuffixes.map((s) => `${id}${s}`) : [id],
      ...rest,
      aliases: [...(rest.aliases ?? []), name, `${name} ${side}`],
    };
  });
}

export const STRUCTURE_DEFS: StructureDef[] = [
  { id: 'dental-anatomy', name: 'Dental anatomy', parent: null, kind: 'group' },

  { id: 'paranasal-sinuses', name: 'Paranasal sinuses', parent: 'dental-anatomy', kind: 'group', categories: ['sinus'], aliases: ['all sinuses', 'sinus paranasales'], labelPriority: 5 },
  ...(['frontal-sinus', 'sphenoidal-sinus'] as const).flatMap((id) => {
    const name = id === 'frontal-sinus' ? 'frontal sinus' : 'sphenoidal sinus';
    return [{ id, name: cap(name), parent: 'paranasal-sinuses', kind: 'group' as const, categories: ['sinus' as const], aliases: [name, name.replace('sphenoidal', 'sphenoid'), 'paranasal'], labelPriority: 4 }, ...bilateral(id, name, () => id, { categories: ['sinus'], provenance: 'schematic', labelPriority: 4 })];
  }),

  /* ---------------- maxilla ---------------- */
  { id: 'maxilla', name: 'Maxilla', parent: 'dental-anatomy', kind: 'group', categories: ['maxilla'], aliases: ['upper jaw', 'maxillae', 'maxillary bone'], labelPriority: 6 },
  ...bilateral('maxilla', 'maxilla', () => 'maxilla', { categories: ['maxilla'], provenance: 'source', labelPriority: 3, aliases: ['upper jaw bone'] }),
  { id: 'maxillary-alveolar-process', name: 'Maxillary alveolar process', parent: 'maxilla', kind: 'group', categories: ['maxilla', 'alveolar-bone'], aliases: ['upper alveolar bone', 'alveolar ridge', 'alveolar bone', 'tooth socket', 'socket'], labelPriority: 4 },
  ...bilateral('maxillary-alveolar-process', 'maxillary alveolar process', () => 'maxillary-alveolar-process', { categories: ['maxilla', 'alveolar-bone'], provenance: 'derived', labelPriority: 2 }),
  // Modelled from this skull's maxilla (neither source has it): see tools/pipeline/sinus.py.
  { id: 'maxillary-sinus', name: 'Maxillary sinuses', parent: 'paranasal-sinuses', kind: 'group', categories: ['sinus'], aliases: ['sinus', 'sinuses', 'antrum', 'maxillary antrum', 'antrum of highmore'], labelPriority: 4 },
  ...bilateral('maxillary-sinus', 'maxillary sinus', () => 'maxillary-sinus', { categories: ['sinus'], provenance: 'modeled', labelPriority: 4, aliases: ['sinus', 'antrum', 'maxillary antrum', 'sinus floor'] }),
  { id: 'maxillary-dentition', name: 'Maxillary dentition', parent: 'maxilla', kind: 'group', categories: ['permanent-teeth'], aliases: ['upper teeth', 'upper arch', 'maxillary arch'], labelPriority: 5 },
  { id: 'upper-right-quadrant', name: 'Upper right quadrant', parent: 'maxillary-dentition', kind: 'group', aliases: ['quadrant 1', 'first quadrant', 'ur quadrant'] },
  { id: 'upper-left-quadrant', name: 'Upper left quadrant', parent: 'maxillary-dentition', kind: 'group', aliases: ['quadrant 2', 'second quadrant', 'ul quadrant'] },

  /* ---------------- mandible ---------------- */
  { id: 'mandible', name: 'Mandible', parent: 'dental-anatomy', kind: 'group', categories: ['mandible'], aliases: ['lower jaw', 'jawbone', 'mandibular bone'], labelPriority: 6 },
  { id: 'mandible-body', name: 'Body and rami of mandible', parent: 'mandible', categories: ['mandible'], meshes: ['mandible-body'], provenance: 'source', aliases: ['mandibular body', 'ramus', 'mandibular ramus', 'angle of mandible'], labelPriority: 3 },
  { id: 'mandibular-alveolar-process', name: 'Mandibular alveolar process', parent: 'mandible', categories: ['mandible', 'alveolar-bone'], meshes: ['mandibular-alveolar-process'], provenance: 'derived', aliases: ['lower alveolar bone', 'alveolar bone', 'alveolar ridge', 'tooth socket'], labelPriority: 4 },
  ...bilateral('mandibular-condyle', 'mandibular condyle', () => 'mandible', { categories: ['mandible', 'tmj'], provenance: 'derived', labelPriority: 3, aliases: ['condyle', 'condylar process', 'condylar head'] }),
  { id: 'mandibular-dentition', name: 'Mandibular dentition', parent: 'mandible', kind: 'group', categories: ['permanent-teeth'], aliases: ['lower teeth', 'lower arch', 'mandibular arch'], labelPriority: 5 },
  { id: 'lower-left-quadrant', name: 'Lower left quadrant', parent: 'mandibular-dentition', kind: 'group', aliases: ['quadrant 3', 'third quadrant', 'll quadrant'] },
  { id: 'lower-right-quadrant', name: 'Lower right quadrant', parent: 'mandibular-dentition', kind: 'group', aliases: ['quadrant 4', 'fourth quadrant', 'lr quadrant'] },
  ...LR.map((side) => ({ id: `mandibular-foramen-${side}`, name: `${cap(side)} mandibular foramen`, parent: 'mandible', kind: 'landmark' as const, categories: ['mandible' as const], landmark: `mandibular-foramen-${side}`, provenance: 'atlas' as const, aliases: ['mandibular foramen'], labelPriority: 2 })),
  ...LR.map((side) => ({ id: `mental-foramen-${side}`, name: `${cap(side)} mental foramen`, parent: 'mandible', kind: 'landmark' as const, categories: ['mandible' as const], landmark: `mental-foramen-${side}`, provenance: 'atlas' as const, aliases: ['mental foramen'], labelPriority: 3 })),

  /* ---------------- periodontium ---------------- */
  { id: 'periodontium', name: 'Periodontium', parent: 'dental-anatomy', kind: 'group', aliases: ['supporting tissues', 'gums and bone'] },
  { id: 'gingiva', name: 'Gingiva', parent: 'periodontium', kind: 'group', categories: ['gingiva'], aliases: ['gums', 'gum', 'gingivae'], labelPriority: 5 },
  { id: 'gingiva-upper', name: 'Maxillary gingiva', parent: 'gingiva', categories: ['gingiva'], meshes: ['gingiva-upper'], provenance: 'derived', aliases: ['upper gums', 'upper gingiva'], labelPriority: 4 },
  { id: 'gingiva-lower', name: 'Mandibular gingiva', parent: 'gingiva', categories: ['gingiva'], meshes: ['gingiva-lower'], provenance: 'derived', aliases: ['lower gums', 'lower gingiva'], labelPriority: 4 },

  /* ---------------- neurovascular ---------------- */
  // Nerve and vessel paths come from the Z-Anatomy atlas ('atlas'); the superior alveolar
  // nerves, the inferior alveolar vein and the pterygoid plexus are placed from landmarks ('schematic').
  // Nerves are the priority (issue #27): they carry the labels and stay at full strength while the
  // jaws are dissected. Trunks outside the dental region are `regional` (issue #26): drawn quiet.
  { id: 'neurovascular', name: 'Neurovascular anatomy', parent: 'dental-anatomy', kind: 'group', aliases: ['nerves and vessels'] },
  { id: 'nerves', name: 'Nerves', parent: 'neurovascular', kind: 'group', categories: ['nerves'], aliases: ['innervation', 'trigeminal'] },
  { id: 'trigeminal-nerves', name: 'Trigeminal nerves (V)', parent: 'nerves', kind: 'group', categories: ['nerves'], aliases: ['cn v', 'trigeminal divisions'] },
  { id: 'facial-nerves', name: 'Facial nerves (VII)', parent: 'nerves', kind: 'group', categories: ['nerves'], aliases: ['cn vii', 'facial branches'] },
  { id: 'lower-cranial-nerves', name: 'Cranial nerves IX, X and XII', parent: 'nerves', kind: 'group', categories: ['nerves'], aliases: ['lower cranial nerves'] },
  ...bilateral('trigeminal-nerve', 'trigeminal nerve (V)', () => 'trigeminal-nerves', { categories: ['nerves'], provenance: 'atlas', labelPriority: 1, regional: true, shortName: 'CN V', aliases: ['trigeminal', 'fifth cranial nerve', 'cn v', 'trigeminal ganglion'] }),
  { id: 'mandibular-nerve-branches', name: 'Mandibular nerve (V3) branches', parent: 'trigeminal-nerves', kind: 'group', categories: ['nerves'], aliases: ['v3', 'mandibular division', 'mandibular nerve'] },
  ...bilateral('mandibular-nerve', 'mandibular nerve (V3)', () => 'mandibular-nerve-branches', { categories: ['nerves'], provenance: 'atlas', labelPriority: 2, shortName: 'V3', aliases: ['v3', 'mandibular division'] }),
  ...bilateral('inferior-alveolar-nerve', 'inferior alveolar nerve', () => 'mandibular-nerve-branches', { categories: ['nerves'], provenance: 'atlas', labelPriority: 5, shortName: 'IAN', aliases: ['ian', 'inferior dental nerve', 'mandibular canal', 'inferior alveolar', 'dental branches'] }),
  ...bilateral('mental-nerve', 'mental nerve', () => 'mandibular-nerve-branches', { categories: ['nerves'], provenance: 'atlas', labelPriority: 3 }),
  ...bilateral('incisive-nerve', 'incisive nerve', () => 'mandibular-nerve-branches', { categories: ['nerves'], provenance: 'atlas', labelPriority: 2 }),
  ...bilateral('lingual-nerve', 'lingual nerve', () => 'mandibular-nerve-branches', { categories: ['nerves'], provenance: 'atlas', labelPriority: 4 }),
  ...bilateral('buccal-nerve', 'buccal nerve', () => 'mandibular-nerve-branches', { categories: ['nerves'], provenance: 'atlas', labelPriority: 2, aliases: ['long buccal nerve'] }),
  { id: 'maxillary-nerve-branches', name: 'Maxillary nerve (V2) branches', parent: 'trigeminal-nerves', kind: 'group', categories: ['nerves'], aliases: ['v2', 'maxillary division', 'maxillary nerve', 'superior alveolar nerves', 'palatal nerves'] },
  ...bilateral('maxillary-nerve', 'maxillary nerve (V2)', () => 'maxillary-nerve-branches', { categories: ['nerves'], provenance: 'atlas', labelPriority: 2, shortName: 'V2', aliases: ['v2', 'maxillary division'] }),
  ...bilateral('infraorbital-nerve', 'infraorbital nerve', () => 'maxillary-nerve-branches', { categories: ['nerves'], provenance: 'atlas', labelPriority: 3 }),
  ...bilateral('posterior-superior-alveolar-nerve', 'posterior superior alveolar nerve', () => 'maxillary-nerve-branches', { categories: ['nerves'], provenance: 'schematic', labelPriority: 3, shortName: 'PSA', aliases: ['psa'] }),
  ...bilateral('middle-superior-alveolar-nerve', 'middle superior alveolar nerve', () => 'maxillary-nerve-branches', { categories: ['nerves'], provenance: 'schematic', labelPriority: 1, shortName: 'MSA', aliases: ['msa'] }),
  ...bilateral('anterior-superior-alveolar-nerve', 'anterior superior alveolar nerve', () => 'maxillary-nerve-branches', { categories: ['nerves'], provenance: 'schematic', labelPriority: 3, shortName: 'ASA', aliases: ['asa'] }),
  ...bilateral('greater-palatine-nerve', 'greater palatine nerve', () => 'maxillary-nerve-branches', { categories: ['nerves'], provenance: 'schematic', labelPriority: 2, shortName: 'GPN', aliases: ['gpn', 'anterior palatine nerve', 'palatal nerve', 'greater palatine block'] }),
  ...bilateral('nasopalatine-nerve', 'nasopalatine nerve', () => 'maxillary-nerve-branches', { categories: ['nerves'], provenance: 'schematic', labelPriority: 2, shortName: 'NPN', aliases: ['npn', 'long sphenopalatine nerve', 'incisive canal', 'nasopalatine block'] }),
  { id: 'vessels', name: 'Blood vessels', parent: 'neurovascular', kind: 'group', categories: ['arteries', 'veins'], aliases: ['blood supply', 'vasculature'] },
  { id: 'arterial-supply', name: 'Arteries', parent: 'vessels', kind: 'group', categories: ['arteries'], aliases: ['artery', 'arteries', 'arterial supply', 'external carotid branches'] },
  ...bilateral('external-carotid-artery', 'external carotid artery', () => 'arterial-supply', { categories: ['arteries'], provenance: 'atlas', labelPriority: 1, regional: true, aliases: ['carotid', 'eca'] }),
  ...bilateral('maxillary-artery', 'maxillary artery', () => 'arterial-supply', { categories: ['arteries'], provenance: 'atlas', labelPriority: 2, regional: true }),
  ...bilateral('inferior-alveolar-artery', 'inferior alveolar artery', () => 'arterial-supply', { categories: ['arteries'], provenance: 'atlas', labelPriority: 2, aliases: ['mental artery'] }),
  ...bilateral('posterior-superior-alveolar-artery', 'posterior superior alveolar artery', () => 'arterial-supply', { categories: ['arteries'], provenance: 'atlas', labelPriority: 1, aliases: ['psa artery'] }),
  ...bilateral('descending-palatine-artery', 'descending palatine artery', () => 'arterial-supply', { categories: ['arteries'], provenance: 'atlas', labelPriority: 1, aliases: ['greater palatine artery', 'palatine artery'] }),
  ...bilateral('buccal-artery', 'buccal artery', () => 'arterial-supply', { categories: ['arteries'], provenance: 'atlas', labelPriority: 1, regional: true }),
  ...bilateral('facial-artery', 'facial artery', () => 'arterial-supply', { categories: ['arteries'], provenance: 'atlas', labelPriority: 1, regional: true }),
  { id: 'venous-drainage', name: 'Veins', parent: 'vessels', kind: 'group', categories: ['veins'], aliases: ['vein', 'veins', 'venous drainage'] },
  ...bilateral('inferior-alveolar-vein', 'inferior alveolar vein', () => 'venous-drainage', { categories: ['veins'], provenance: 'schematic', labelPriority: 2 }),
  ...bilateral('pterygoid-plexus', 'pterygoid venous plexus', () => 'venous-drainage', { categories: ['veins'], provenance: 'schematic', labelPriority: 2, regional: true, aliases: ['pterygoid plexus', 'venous plexus'] }),
  ...bilateral('maxillary-vein', 'maxillary vein', () => 'venous-drainage', { categories: ['veins'], provenance: 'atlas', labelPriority: 1, regional: true }),
  ...bilateral('retromandibular-vein', 'retromandibular vein', () => 'venous-drainage', { categories: ['veins'], provenance: 'atlas', labelPriority: 1, regional: true }),
  ...bilateral('facial-vein', 'facial vein', () => 'venous-drainage', { categories: ['veins'], provenance: 'atlas', labelPriority: 1, regional: true, aliases: ['common facial vein'] }),
  ...bilateral('internal-jugular-vein', 'internal jugular vein', () => 'venous-drainage', { categories: ['veins'], provenance: 'atlas', labelPriority: 1, regional: true, aliases: ['jugular', 'ijv'] }),

  /* ---------------- TMJ ---------------- */
  { id: 'tmj', name: 'Temporomandibular joints', parent: 'dental-anatomy', kind: 'group', categories: ['tmj'], aliases: ['tmj', 'jaw joint', 'temporomandibular joint'], labelPriority: 5 },
  ...LR.map((side) => ({ id: `tmj-${side}`, name: `${cap(side)} temporomandibular joint`, parent: 'tmj', kind: 'group' as const, categories: ['tmj' as const], aliases: ['tmj', 'jaw joint'], labelPriority: 4 })),
  ...bilateral('articular-disc', 'articular disc', (s) => `tmj-${s}`, { categories: ['tmj'], provenance: 'schematic', labelPriority: 3, aliases: ['tmj disc', 'meniscus', 'disc'] }),
  ...bilateral('articular-fossa', 'mandibular (glenoid) fossa', (s) => `tmj-${s}`, { categories: ['tmj', 'skull'], provenance: 'derived', labelPriority: 2, aliases: ['glenoid fossa', 'articular fossa', 'mandibular fossa'] }),

  /* ---------------- skull context ---------------- */
  { id: 'skull', name: 'Skull (context)', parent: 'dental-anatomy', kind: 'group', categories: ['skull'], aliases: ['cranium', 'skull'] },
  ...bilateral('temporal-bone', 'temporal bone', () => 'skull', { categories: ['skull'], provenance: 'source', labelPriority: 2 }),
  ...bilateral('zygomatic-bone', 'zygomatic bone', () => 'skull', { categories: ['skull'], provenance: 'source', labelPriority: 2, aliases: ['cheekbone', 'zygoma'] }),
  ...bilateral('palatine-bone', 'palatine bone', () => 'skull', { categories: ['skull'], provenance: 'source', labelPriority: 2, aliases: ['hard palate', 'palate'] }),
  ...bilateral('parietal-bone', 'parietal bone', () => 'skull', { categories: ['skull'], provenance: 'source', labelPriority: 1 }),
  ...bilateral('nasal-bone', 'nasal bone', () => 'skull', { categories: ['skull'], provenance: 'source', labelPriority: 1 }),
  ...bilateral('lacrimal-bone', 'lacrimal bone', () => 'skull', { categories: ['skull'], provenance: 'source', labelPriority: 0 }),
  ...bilateral('inferior-nasal-concha', 'inferior nasal concha', () => 'skull', { categories: ['skull'], provenance: 'source', labelPriority: 0 }),
  { id: 'frontal-bone', name: 'Frontal bone', parent: 'skull', categories: ['skull'], meshes: ['frontal-bone'], provenance: 'source', labelPriority: 1 },
  { id: 'occipital-bone', name: 'Occipital bone', parent: 'skull', categories: ['skull'], meshes: ['occipital-bone'], provenance: 'source', labelPriority: 1 },
  { id: 'sphenoid-bone', name: 'Sphenoid bone', parent: 'skull', categories: ['skull'], meshes: ['sphenoid-bone'], provenance: 'source', labelPriority: 1, aliases: ['pterygoid plates'] },
  { id: 'ethmoid-bone', name: 'Ethmoid bone', parent: 'skull', categories: ['skull'], meshes: ['ethmoid-bone'], provenance: 'source', labelPriority: 0 },
  { id: 'vomer', name: 'Vomer', parent: 'skull', categories: ['skull'], meshes: ['vomer'], provenance: 'source', labelPriority: 0 },
  { id: 'hyoid-bone', name: 'Hyoid bone', parent: 'skull', categories: ['skull'], meshes: ['hyoid-bone'], provenance: 'source', labelPriority: 1, aliases: ['hyoid'] },

  /* ---------------- muscles ---------------- */
  { id: 'muscles', name: 'Muscles of mastication and perioral muscles', parent: 'dental-anatomy', kind: 'group', categories: ['muscles'], aliases: ['muscles', 'chewing muscles', 'masticatory muscles'] },
  ...bilateral('masseter', 'masseter', () => 'muscles', { categories: ['muscles'], provenance: 'source', labelPriority: 3, meshes: [], kind: 'group' }),
  ...LR.flatMap((side) => [
    { id: `masseter-superficial-${side}`, name: `Superficial part of ${side} masseter`, parent: `masseter-${side}`, categories: ['muscles' as const], meshes: [`masseter-superficial-${side}`], provenance: 'source' as const, labelPriority: 1, aliases: ['masseter'] },
    { id: `masseter-deep-${side}`, name: `Deep part of ${side} masseter`, parent: `masseter-${side}`, categories: ['muscles' as const], meshes: [`masseter-deep-${side}`], provenance: 'source' as const, labelPriority: 1, aliases: ['masseter'] },
    { id: `lateral-pterygoid-${side}`, name: `${cap(side)} lateral pterygoid`, parent: 'muscles', kind: 'group' as const, categories: ['muscles' as const], provenance: 'source' as const, labelPriority: 3, aliases: ['lateral pterygoid'] },
    { id: `lateral-pterygoid-upper-${side}`, name: `Upper head of ${side} lateral pterygoid`, parent: `lateral-pterygoid-${side}`, categories: ['muscles' as const], meshes: [`lateral-pterygoid-upper-${side}`], provenance: 'source' as const, labelPriority: 1, aliases: ['lateral pterygoid'] },
    { id: `lateral-pterygoid-lower-${side}`, name: `Lower head of ${side} lateral pterygoid`, parent: `lateral-pterygoid-${side}`, categories: ['muscles' as const], meshes: [`lateral-pterygoid-lower-${side}`], provenance: 'source' as const, labelPriority: 1, aliases: ['lateral pterygoid'] },
  ]),
  ...bilateral('temporalis', 'temporalis', () => 'muscles', { categories: ['muscles'], provenance: 'source', labelPriority: 3, aliases: ['temporal muscle'] }),
  ...bilateral('medial-pterygoid', 'medial pterygoid', () => 'muscles', { categories: ['muscles'], provenance: 'source', labelPriority: 3 }),
  ...bilateral('buccinator', 'buccinator', () => 'muscles', { categories: ['muscles'], provenance: 'source', labelPriority: 2, aliases: ['cheek muscle'] }),
  ...bilateral('mentalis', 'mentalis', () => 'muscles', { categories: ['muscles'], provenance: 'source', labelPriority: 1 }),
  { id: 'orbicularis-oris', name: 'Orbicularis oris', parent: 'muscles', categories: ['muscles'], meshes: ['orbicularis-oris'], provenance: 'source', labelPriority: 2, aliases: ['lip muscle', 'lips'] },
  ...FEEDBACK_STRUCTURES,
];
