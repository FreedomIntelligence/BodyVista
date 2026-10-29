import type { Arch, NumberingSystem, Side, ToothNotation, ToothType } from './types.ts';

export const TOOTH_TYPES: ToothType[] = [
  'central-incisor',
  'lateral-incisor',
  'canine',
  'first-premolar',
  'second-premolar',
  'first-molar',
  'second-molar',
  'third-molar',
];

/** All 32 permanent teeth in FDI order by quadrant. */
export const PERMANENT_FDI: number[] = [1, 2, 3, 4].flatMap((q) =>
  [1, 2, 3, 4, 5, 6, 7, 8].map((n) => q * 10 + n),
);

export function fdiParts(fdi: number): { quadrant: number; position: number } {
  return { quadrant: Math.floor(fdi / 10), position: fdi % 10 };
}

export function archOf(fdi: number): Arch {
  const q = fdiParts(fdi).quadrant;
  return q === 1 || q === 2 ? 'maxillary' : 'mandibular';
}

export function sideOf(fdi: number): Side {
  const q = fdiParts(fdi).quadrant;
  return q === 1 || q === 4 ? 'right' : 'left';
}

export function typeOf(fdi: number): ToothType {
  return TOOTH_TYPES[fdiParts(fdi).position - 1];
}

/** FDI (ISO 3950) → Universal (ADA) for permanent teeth. */
export function fdiToUniversal(fdi: number): number {
  const { quadrant: q, position: n } = fdiParts(fdi);
  switch (q) {
    case 1:
      return 9 - n;
    case 2:
      return 8 + n;
    case 3:
      return 25 - n;
    case 4:
      return 24 + n;
    default:
      throw new Error(`Not a permanent FDI number: ${fdi}`);
  }
}

export function universalToFdi(u: number): number {
  if (u < 1 || u > 32 || !Number.isInteger(u)) throw new Error(`Not a Universal number: ${u}`);
  if (u <= 8) return 10 + (9 - u);
  if (u <= 16) return 20 + (u - 8);
  if (u <= 24) return 30 + (25 - u);
  return 40 + (u - 24);
}

const PALMER_Q: Record<number, string> = { 1: 'UR', 2: 'UL', 3: 'LL', 4: 'LR' };

/** Palmer notation written in text form, e.g. "UR6". */
export function fdiToPalmer(fdi: number): string {
  const { quadrant, position } = fdiParts(fdi);
  return `${PALMER_Q[quadrant]}${position}`;
}

export function palmerToFdi(p: string): number | null {
  const m = /^(ur|ul|ll|lr)\s*([1-8])$/i.exec(p.trim());
  if (!m) return null;
  const q = { ur: 1, ul: 2, ll: 3, lr: 4 }[m[1].toLowerCase() as 'ur'];
  return q * 10 + Number(m[2]);
}

export function notationFor(fdi: number): ToothNotation {
  return { fdi: String(fdi), universal: String(fdiToUniversal(fdi)), palmer: fdiToPalmer(fdi) };
}

export function formatTooth(fdi: number, system: NumberingSystem): string {
  if (system === 'fdi') return String(fdi);
  if (system === 'universal') return `#${fdiToUniversal(fdi)}`;
  return fdiToPalmer(fdi);
}

export const NUMBERING_SYSTEMS: readonly NumberingSystem[] = ['fdi', 'universal', 'palmer'];

export const NUMBERING_LABEL: Record<NumberingSystem, string> = {
  fdi: 'FDI',
  universal: 'Universal',
  palmer: 'Palmer',
};

/** Three-letter chip labels. */
export const NUMBERING_SHORT: Record<NumberingSystem, string> = {
  fdi: 'FDI',
  universal: 'UNI',
  palmer: 'PAL',
};

export const TYPE_NAME: Record<ToothType, string> = {
  'central-incisor': 'central incisor',
  'lateral-incisor': 'lateral incisor',
  canine: 'canine',
  'first-premolar': 'first premolar',
  'second-premolar': 'second premolar',
  'first-molar': 'first molar',
  'second-molar': 'second molar',
  'third-molar': 'third molar',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Mandibular left first molar" */
export function toothName(fdi: number): string {
  return cap(`${archOf(fdi)} ${sideOf(fdi)} ${TYPE_NAME[typeOf(fdi)]}`);
}

/** Informal synonyms used by search. */
export function toothAliases(fdi: number): string[] {
  const arch = archOf(fdi);
  const side = sideOf(fdi);
  const t = typeOf(fdi);
  const ul = arch === 'maxillary' ? 'upper' : 'lower';
  const typeName = TYPE_NAME[t];
  const out = [
    `${ul} ${side} ${typeName}`,
    `${side} ${ul} ${typeName}`,
    `${side} ${arch} ${typeName}`,
    `${arch} ${typeName}`,
    `${ul} ${typeName}`,
    typeName,
  ];
  const extra: Partial<Record<ToothType, string[]>> = {
    canine: ['cuspid', 'eye tooth'],
    'first-premolar': ['first bicuspid', 'bicuspid'],
    'second-premolar': ['second bicuspid', 'bicuspid'],
    'first-molar': ['six-year molar', '6 year molar'],
    'second-molar': ['twelve-year molar', '12 year molar'],
    'third-molar': ['wisdom tooth', 'wisdom teeth'],
    'central-incisor': ['front tooth'],
  };
  for (const e of extra[t] ?? []) out.push(e, `${ul} ${e}`, `${ul} ${side} ${e}`);
  return out;
}
