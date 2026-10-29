import type { Arch, Side, ToothType } from './types.ts';
import { archOf, sideOf, typeOf, notationFor } from './notation.ts';

export const DEVELOPMENT_MORPH_SECONDS = 1.9;

/** Representative teaching snapshots, not an individual child's dental age. */
export const DEVELOPMENT_STAGES = [
  { id: 'infant', age: 0.75, years: '0.5–1' },
  { id: 'toddler', age: 2, years: '1–3' },
  { id: 'primary', age: 4, years: '3–5' },
  { id: 'early-mixed', age: 6.5, years: '6–7' },
  { id: 'incisor-transition', age: 8.5, years: '8–9' },
  { id: 'late-mixed', age: 10.5, years: '10–12' },
  { id: 'permanent', age: 13.5, years: '12–14' },
] as const;
export type DevelopmentStageId = typeof DEVELOPMENT_STAGES[number]['id'];
export type DevelopmentStatus = 'primary' | 'unerupted' | 'erupting' | 'erupted' | 'absent';
export interface DevelopmentTooth {
  fdi: number;
  dentition: 'primary' | 'permanent';
  arch: Arch;
  side: Side;
  type: ToothType;
}

export const DEVELOPMENT_TEETH: DevelopmentTooth[] = [1, 2, 3, 4].flatMap((q) => [
  ...[1, 2, 3, 4, 5].map((n): DevelopmentTooth => ({
    fdi: (q + 4) * 10 + n, dentition: 'primary', arch: archOf(q * 10 + n), side: sideOf(q * 10 + n),
    type: typeOf(q * 10 + (n >= 4 ? n + 2 : n)),
  })),
  ...[1, 2, 3, 4, 5, 6, 7].map((n): DevelopmentTooth => ({
    fdi: q * 10 + n, dentition: 'permanent', arch: archOf(q * 10 + n), side: sideOf(q * 10 + n), type: typeOf(q * 10 + n),
  })),
]);

/** AAPD 2025 Dental Growth and Development: eruption ranges in years, upper/lower.
 * Interpolation within a range is a schematic convention, not measured biology. */
export const ERUPTION_YEARS: Record<Arch, readonly (readonly [number, number])[]> = {
  maxillary: [[7, 8], [8, 9], [11, 12], [10, 11], [10, 12], [5.5, 7], [12, 14]],
  mandibular: [[6, 7], [7, 8], [9, 11], [10, 12], [11, 13], [5.5, 7], [12, 14]],
};
const PRIMARY_ERUPTION_MONTHS: Record<Arch, readonly (readonly [number, number])[]> = {
  maxillary: [[6, 10], [8, 12], [16, 20], [11, 18], [20, 30]],
  mandibular: [[5, 8], [7, 10], [16, 20], [11, 18], [20, 30]],
};
const CALCIFICATION_START: Record<Arch, readonly number[]> = {
  maxillary: [0.25, 10 / 12, 4 / 12, 1.5, 2, 0, 2.5],
  mandibular: [0.25, 0.25, 4 / 12, 1.5, 2, 0, 2.5],
};

export const developmentId = (fdi: number) => `development-tooth-${fdi}`;
export const developmentContentKey = (t: DevelopmentTooth) => `development:${t.dentition}:${t.type}:${t.arch}`;
export const developmentAge = (stage: DevelopmentStageId) => DEVELOPMENT_STAGES.find((s) => s.id === stage)!.age;

export function developmentStatus(t: DevelopmentTooth, stage: DevelopmentStageId): DevelopmentStatus {
  const age = developmentAge(stage);
  const [start, end] = ERUPTION_YEARS[t.arch][t.fdi % 10 - 1];
  if (t.dentition === 'primary') {
    if (age >= start) return 'absent';
    const [primaryStart, primaryEnd] = PRIMARY_ERUPTION_MONTHS[t.arch][t.fdi % 10 - 1];
    return age * 12 < primaryStart ? 'unerupted' : age * 12 < primaryEnd ? 'erupting' : 'primary';
  }
  if (age < CALCIFICATION_START[t.arch][t.fdi % 10 - 1]) return 'absent';
  return age < start ? 'unerupted' : age < end ? 'erupting' : 'erupted';
}

/** Primary first/second molars occupy the slots of their permanent premolar successors. */
export function successorFdi(t: DevelopmentTooth): number | null {
  return t.dentition === 'primary' ? t.fdi - 40 : null;
}

/** Universal A–T and Palmer A–E for the primary dentition; standard adult notation otherwise. */
export function developmentNotation(t: DevelopmentTooth) {
  if (t.dentition === 'permanent') return notationFor(t.fdi);
  const q = Math.floor(t.fdi / 10) - 4;
  const n = t.fdi % 10;
  const index = q === 1 ? 5 - n : q === 2 ? 4 + n : q === 3 ? 15 - n : 14 + n;
  return { fdi: String(t.fdi), universal: String.fromCharCode(65 + index), palmer: `${['UR', 'UL', 'LL', 'LR'][q - 1]}${String.fromCharCode(64 + n)}` };
}
