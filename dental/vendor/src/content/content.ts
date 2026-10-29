/**
 * Educational content lookup. Content is data (JSON), separate from anatomy
 * and UI, so it can be replaced by verified sources without code changes.
 */
import type { Registry } from '../anatomy/registry.ts';
import type { Lang } from '../i18n/lang.ts';
import teeth from './en/teeth.json' with { type: 'json' };
import structures from './en/structures.json' with { type: 'json' };
import teethSv from './sv/teeth.json' with { type: 'json' };
import structuresSv from './sv/structures.json' with { type: 'json' };
import teethDe from './de/teeth.json' with { type: 'json' };
import structuresDe from './de/structures.json' with { type: 'json' };
import teethEs from './es/teeth.json' with { type: 'json' };
import structuresEs from './es/structures.json' with { type: 'json' };
import teethLa from './la/teeth.json' with { type: 'json' };
import structuresLa from './la/structures.json' with { type: 'json' };
import { feedbackAnatomy } from './feedbackAnatomy.ts';
import { supportingAnatomy } from './supportingAnatomy.ts';
import { developmentAnatomy } from './developmentAnatomy.ts';
import { developmentContentKey } from '../anatomy/development.ts';
import { VESSEL_REFERENCES } from './vesselReferences.ts';
import { paranasalContent } from '../anatomy/paranasal.ts';
import { surfaceFeatureContent } from '../anatomy/surfaceFeatures.ts';
import { toothGuide, toothGuideSources, type ToothGuide } from './toothGuides.ts';

export type ContentStatus = 'placeholder' | 'draft' | 'reviewed';

interface RawEntry {
  summary?: string;
  function?: string;
  clinical?: string;
  location?: string;
  sources?: { title: string; url: string }[];
  facts?: { label: string; value: string }[];
  related?: string[];
  roots?: string;
  canals?: string;
  eruption?: string;
}

export interface ResolvedContent {
  key: string | null;
  summary?: string;
  function?: string;
  clinical?: string;
  location?: string;
  sources: { title: string; url: string }[];
  facts: { label: string; value: string }[];
  related: string[];
  /** Nerve supply and identification sections (permanent tooth types only). */
  guides: ToothGuide;
  status: ContentStatus;
}

const db = (t: unknown, s: unknown, lang: Lang): Record<string, RawEntry> => {
  const base = { ...(t as Record<string, RawEntry>), ...(s as Record<string, RawEntry>) };
  for (const [key, entry] of Object.entries(feedbackAnatomy(lang))) base[key] = { ...base[key], ...entry };
  for (const [key, entry] of Object.entries(supportingAnatomy(lang))) base[key] = { ...base[key], ...entry };
  Object.assign(base, developmentAnatomy(lang, base));
  Object.assign(base, surfaceFeatureContent(lang));
  for (const [key, entry] of Object.entries(paranasalContent(lang))) base[key] = { ...base[key], ...entry };
  for (const [key, source] of Object.entries(VESSEL_REFERENCES)) {
    const entry = base[key];
    if (entry && !entry.sources?.some(ref => ref.url === source.url)) entry.sources = [...entry.sources ?? [], source];
  }
  return base;
};
/** Content per interface language; every language has the same keys (checked by i18n.test.ts). */
export const CONTENT: Record<Lang, Record<string, RawEntry>> = {
  en: db(teeth, structures, 'en'),
  sv: db(teethSv, structuresSv, 'sv'),
  de: db(teethDe, structuresDe, 'de'),
  es: db(teethEs, structuresEs, 'es'),
  la: db(teethLa, structuresLa, 'la'),
};
const DB = CONTENT.en;

const FACT_LABELS: Record<Lang, { roots: string; canals: string; eruption: string }> = {
  en: { roots: 'Typical roots', canals: 'Typical canals', eruption: 'Typical eruption' },
  sv: { roots: 'Typiska rötter', canals: 'Typiska kanaler', eruption: 'Typisk eruptionsålder' },
  de: { roots: 'Typische Wurzeln', canals: 'Typische Kanäle', eruption: 'Typischer Durchbruch' },
  es: { roots: 'Raíces típicas', canals: 'Conductos típicos', eruption: 'Erupción típica' },
  la: { roots: 'Radices typicae', canals: 'Canales typici', eruption: 'Eruptio typica' },
};
const STATUS: ContentStatus = 'draft';

/** Candidate content keys for a structure id, most specific first. */
export function contentKeys(registry: Registry, id: string): string[] {
  const s = registry.get(id);
  const keys: string[] = [];
  if (s?.development) keys.push(developmentContentKey(s.development));
  if (s?.tooth) keys.push(`tooth:${s.tooth.type}:${s.tooth.arch}`);
  let k = id;
  if (s?.toothFdi !== undefined) {
    k = k.replace(/-\d{2}$/, '');
    if (k.startsWith('canal-')) keys.push('canal');
    if (k.startsWith('apical-foramen')) keys.push('apical-foramen');
    if (k.startsWith('pulp-horn')) keys.push('pulp-horn');
  }
  keys.push(k);
  // strip trailing qualifiers: -right/-left, -superficial, -upper, …
  let parts = k.split('-');
  while (parts.length > 1) {
    parts = parts.slice(0, -1);
    keys.push(parts.join('-'));
  }
  return keys;
}

export function resolveContent(registry: Registry, id: string, lang: Lang = 'en'): ResolvedContent {
  const key = contentKeys(registry, id).find((k) => DB[k]) ?? null;
  const raw = key ? (CONTENT[lang][key] ?? DB[key]) : undefined;
  const fl = FACT_LABELS[lang];
  const s = registry.get(id);
  const facts = [...(raw?.facts ?? [])];
  if (raw?.roots) facts.push({ label: fl.roots, value: raw.roots });
  if (raw?.canals) facts.push({ label: fl.canals, value: raw.canals });
  if (raw?.eruption) facts.push({ label: fl.eruption, value: raw.eruption });
  const related = ((key ? DB[key]?.related : undefined) ?? [])
    .map((r) => resolveRelated(registry, r, id))
    .filter((r): r is string => !!r && r !== id && r !== s?.parent);
  return {
    key,
    summary: raw?.summary,
    function: raw?.function,
    clinical: raw?.clinical,
    location: raw?.location,
    sources: [...(raw?.sources ?? []), ...(key ? toothGuideSources(key) : [])],
    facts,
    related: [...new Set(related)],
    guides: (key ? toothGuide(key, lang) : undefined) ?? [],
    status: raw ? STATUS : 'placeholder',
  };
}

function resolveRelated(registry: Registry, key: string, fromId: string): string | undefined {
  const s = registry.get(fromId);
  const fdi = s?.toothFdi;
  const side = /-(left|right)$/.exec(fromId)?.[1];
  const candidates: string[] = [];
  if (fdi !== undefined) {
    candidates.push(`${key}-${fdi}`);
    if (key === 'pulp-horn') candidates.push(`pulp-horn-1-${fdi}`);
    if (key === 'apical-foramen' || key === 'apex') {
      const af = registry.descendants(`tooth-${fdi}`).find((d) => d.id.startsWith(key === 'apex' ? 'apex-' : 'apical-foramen-'));
      if (af) candidates.push(af.id);
    }
  }
  if (key === 'alveolar-bone') candidates.push(fdi !== undefined && fdi < 30 ? 'maxillary-alveolar-process' : 'mandibular-alveolar-process');
  if (side) candidates.push(`${key}-${side}`);
  candidates.push(key, `${key}-right`);
  return candidates.find((c) => registry.get(c));
}
