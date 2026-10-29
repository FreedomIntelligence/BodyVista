import type { CategoryId, Structure } from './types';

export interface CategoryDef {
  id: CategoryId;
  label: string;
  /** dot colour in the layers panel; matches the tissue colour in the scene */
  color: string;
  group: 'Dentition' | 'Tooth tissues' | 'Periodontium' | 'Bone' | 'Neurovascular' | 'Supporting anatomy';
  /** initial state: on, ghost (translucent) or off */
  initial: 'on' | 'ghost' | 'off';
  /** a category with no geometry yet (shown as "not yet modeled") */
  planned?: boolean;
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'permanent-teeth', label: 'Permanent teeth', color: '#e9e2cf', group: 'Dentition', initial: 'on' },
  { id: 'primary-teeth', label: 'Primary teeth', color: '#e8bd77', group: 'Dentition', initial: 'off' },
  { id: 'enamel', label: 'Enamel', color: '#f1eee4', group: 'Tooth tissues', initial: 'on' },
  { id: 'dentin', label: 'Dentin', color: '#e2c07f', group: 'Tooth tissues', initial: 'on' },
  { id: 'cementum', label: 'Cementum', color: '#c6a270', group: 'Tooth tissues', initial: 'on' },
  { id: 'dental-pulp', label: 'Dental pulp', color: '#c8484f', group: 'Tooth tissues', initial: 'on' },
  { id: 'root-canals', label: 'Root canals', color: '#a8323e', group: 'Tooth tissues', initial: 'on' },
  { id: 'gingiva', label: 'Gingiva', color: '#c77c81', group: 'Periodontium', initial: 'on' },
  { id: 'periodontal-ligament', label: 'Periodontal ligament', color: '#cf7f7a', group: 'Periodontium', initial: 'on' },
  { id: 'alveolar-bone', label: 'Alveolar bone', color: '#ddd3bd', group: 'Periodontium', initial: 'on' },
  { id: 'maxilla', label: 'Maxilla', color: '#e6dfcd', group: 'Bone', initial: 'on' },
  { id: 'mandible', label: 'Mandible', color: '#e6dfcd', group: 'Bone', initial: 'on' },
  { id: 'tmj', label: 'Temporomandibular joint', color: '#7fa9bd', group: 'Bone', initial: 'on' },
  { id: 'sinus', label: 'Paranasal sinuses', color: '#8ec3d6', group: 'Bone', initial: 'on' },
  { id: 'nerves', label: 'Nerves', color: '#d9b347', group: 'Neurovascular', initial: 'on' },
  { id: 'arteries', label: 'Arteries', color: '#c3362c', group: 'Neurovascular', initial: 'on' },
  { id: 'veins', label: 'Veins', color: '#3163c4', group: 'Neurovascular', initial: 'on' },
  { id: 'skull', label: 'Skull (context)', color: '#d8d2c3', group: 'Supporting anatomy', initial: 'on' },
  { id: 'muscles', label: 'Muscles of mastication', color: '#a34d44', group: 'Supporting anatomy', initial: 'on' },
  { id: 'salivary', label: 'Salivary glands', color: '#c9a3b8', group: 'Supporting anatomy', initial: 'off', planned: true },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, CategoryDef>;

/**
 * The category a structure is shown under (colour dot, eyebrow): its first one other than the
 * general teeth layer, else its only one. Undefined for structures that declare none.
 */
export function primaryCategory(s: Pick<Structure, 'categories'>): CategoryId | undefined {
  return s.categories.find((c) => c !== 'permanent-teeth') ?? s.categories[0];
}

export type CategoryState = 'on' | 'ghost' | 'off';

export interface LayerPreset {
  id: string;
  label: string;
  state: Partial<Record<CategoryId, CategoryState>>;
}

const all = (s: CategoryState) =>
  Object.fromEntries(CATEGORIES.map((c) => [c.id, s])) as Record<CategoryId, CategoryState>;

export const INITIAL_CATEGORY_STATE: Record<CategoryId, CategoryState> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.initial]),
) as Record<CategoryId, CategoryState>;

export const PRESETS: LayerPreset[] = [
  { id: 'sinuses', label: 'Sinuses', state: { ...all('off'), sinus: 'on', skull: 'ghost', maxilla: 'ghost', mandible: 'ghost', 'alveolar-bone': 'ghost', 'permanent-teeth': 'ghost', enamel: 'ghost', dentin: 'ghost', cementum: 'ghost' } },
  { id: 'vessels', label: 'Vessels', state: { ...all('off'), arteries: 'on', veins: 'on', nerves: 'ghost', muscles: 'ghost', skull: 'ghost', maxilla: 'ghost', mandible: 'ghost', 'alveolar-bone': 'ghost', 'permanent-teeth': 'ghost', enamel: 'ghost', dentin: 'ghost', cementum: 'ghost' } },
  { id: 'nerve-muscles', label: 'Nerves & muscles', state: { ...all('off'), nerves: 'on', muscles: 'ghost', maxilla: 'ghost', mandible: 'ghost', 'alveolar-bone': 'ghost', skull: 'ghost', tmj: 'ghost', 'permanent-teeth': 'on', enamel: 'on', dentin: 'on', cementum: 'on', 'dental-pulp': 'on', 'root-canals': 'on' } },
  { id: 'overview', label: 'Overview', state: INITIAL_CATEGORY_STATE },
  {
    id: 'dentition',
    label: 'Teeth',
    state: { ...all('off'), 'permanent-teeth': 'on', enamel: 'on', dentin: 'on', cementum: 'on', 'dental-pulp': 'on', 'root-canals': 'on', 'periodontal-ligament': 'on' },
  },
  {
    id: 'bone',
    label: 'Bone',
    state: { ...all('off'), maxilla: 'on', mandible: 'on', 'alveolar-bone': 'on', tmj: 'on', sinus: 'on', skull: 'on' },
  },
  {
    id: 'nerves',
    label: 'Nerves',
    state: {
      ...all('off'),
      // nerves in front; vessels stay as translucent reference (issue #27)
      nerves: 'on',
      arteries: 'ghost',
      veins: 'ghost',
      'permanent-teeth': 'on',
      enamel: 'on',
      dentin: 'on',
      cementum: 'on',
      'dental-pulp': 'on',
      'root-canals': 'on',
      maxilla: 'ghost',
      mandible: 'ghost',
      'alveolar-bone': 'ghost',
      tmj: 'ghost',
      skull: 'ghost',
    },
  },
];
