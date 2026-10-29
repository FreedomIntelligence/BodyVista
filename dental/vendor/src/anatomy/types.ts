/** Core anatomical data types. See docs/architecture.md §8. */
import type { Lang } from '../i18n/lang.ts';
import type { DevelopmentTooth } from './development.ts';

export type Provenance = 'source' | 'derived' | 'modeled' | 'atlas' | 'schematic';
export type StructureKind = 'group' | 'mesh' | 'region' | 'landmark';
export type Arch = 'maxillary' | 'mandibular';
export type Side = 'right' | 'left';
export type ToothType =
  | 'central-incisor'
  | 'lateral-incisor'
  | 'canine'
  | 'first-premolar'
  | 'second-premolar'
  | 'first-molar'
  | 'second-molar'
  | 'third-molar';

export type NumberingSystem = 'fdi' | 'universal' | 'palmer';

export type CategoryId =
  | 'permanent-teeth'
  | 'primary-teeth'
  | 'enamel'
  | 'dentin'
  | 'cementum'
  | 'dental-pulp'
  | 'root-canals'
  | 'gingiva'
  | 'periodontal-ligament'
  | 'alveolar-bone'
  | 'maxilla'
  | 'mandible'
  | 'nerves'
  | 'arteries'
  | 'veins'
  | 'tmj'
  | 'sinus'
  | 'salivary'
  | 'muscles'
  | 'skull';

export type Vec3 = [number, number, number];

export interface ToothNotation {
  fdi: string;
  universal: string;
  palmer: string;
}

export interface RootInfo {
  label: string; // "mesial", "distal", "palatal", "mesiobuccal", "single", …
  canals: string[]; // structure ids of canals in this root
}

export interface ToothMeta {
  fdi: number;
  notation: ToothNotation;
  arch: Arch;
  side: Side;
  type: ToothType;
  dentition: 'permanent' | 'primary';
  roots: RootInfo[];
  /** layer structure ids available once the tooth asset is loaded */
  layers: string[];
  asset?: string;
  frame?: { origin: Vec3; axis: Vec3; mesial: Vec3; buccal: Vec3 };
}

export interface Structure {
  /** Fitted educational surface landmark/curve, not a measured anatomical segmentation. */
  surfaceFeature?: string;
  /** Schematic childhood dentition, separate from the adult atlas tooth layers. */
  development?: DevelopmentTooth;
  id: string;
  /** English name (the reference); `names` holds it in every interface language */
  name: string;
  names: Record<Lang, string>;
  kind: StructureKind;
  parent: string | null;
  children: string[];
  categories: CategoryId[];
  /** scene mesh keys owned directly by this structure */
  meshes: string[];
  aliases: string[];
  provenance: Provenance;
  sourceRef?: string;
  stage: 1 | 2 | 3 | 4;
  /** tooth FDI number this structure belongs to (tooth or tooth part) */
  toothFdi?: number;
  tooth?: ToothMeta;
  /** point for landmarks / label anchor override */
  anchor?: Vec3;
  labelPriority: number;
  /** short label used on the 3D label chip */
  shortName?: string;
  shortNames?: Record<Lang, string>;
  /** nerve or vessel trunk outside the dental region: drawn quiet, never labelled on its own */
  regional?: boolean;
}

/* ---------- manifest produced by tools/pipeline ---------- */

export interface ManifestMesh {
  stage: 1 | 2 | 3 | 4;
  file: string;
  bounds: [Vec3, Vec3];
  triangles: number;
  provenance: Provenance;
  sourceRef?: string;
}

export interface ManifestTooth {
  surfaceFeatures?: { key: string; anchor: Vec3; path: Vec3[] | null }[];
  arch: Arch;
  side: Side;
  type: ToothType;
  provenance: Provenance;
  frame: { origin: Vec3; axis: Vec3; mesial: Vec3; buccal: Vec3 };
  roots?: { label: string; canals: string[] }[];
  landmarks?: Record<string, Vec3>;
  layers?: string[];
  asset?: string;
  /** arch dissection: how far (cm) the tooth slides out of the gum along its axis */
  extract?: number;
  /** highest gum point over the tooth, along its axis from the cervical line (cm) */
  collar?: number;
}

export interface Manifest {
  /** Illustrative joint kinematics in app cm/radians, fitted to the condylar axis. */
  jawMotion?: { pivot: Vec3; translation: Vec3; rotation: number; provenance: 'schematic' };
  units: string;
  source: string;
  meshes: Record<string, ManifestMesh>;
  teeth: Record<string, ManifestTooth>;
  /** simplified centrelines of each nerve / vessel mesh (one polyline per branch) */
  paths: Record<string, Vec3[][]>;
  landmarks: Record<string, Vec3>;
  /** modelled maxillary sinuses: volume (cm³) and root apex → sinus floor distance (mm) per tooth */
  sinus?: Record<'right' | 'left', { volume: number; apexGap: Record<string, number> }>;
  /** arch dissection tiers (cm): jaw = how far each jaw moves from the bite; gingiva / teeth = how far they then move toward the bite */
  explode?: { jaw: number; upper: { gingiva: number; teeth: number }; lower: { gingiva: number; teeth: number } };
  bounds: [Vec3, Vec3];
  files?: Record<string, number>;
}
