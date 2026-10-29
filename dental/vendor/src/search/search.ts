/**
 * Anatomical search. Small in-house scorer over the registry
 * (names, aliases, notation, categories). See docs/architecture.md §8.
 */
import type { Registry } from '../anatomy/registry';
import { CATEGORY_BY_ID } from '../anatomy/categories';
import { de } from '../i18n/de';
import { sv } from '../i18n/sv';
import { palmerToFdi, universalToFdi } from '../anatomy/notation';
import type { NumberingSystem, Structure } from '../anatomy/types';

export interface SearchEntry {
  id: string;
  name: string;
  terms: string[]; // normalised
  kindBoost: number;
}

export interface SearchResult {
  id: string;
  score: number;
  /** why it matched, e.g. "Universal #8" */
  hint?: string;
}

const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
  first: 'first', second: 'second', third: 'third',
};

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/dentine/g, 'dentin')
    .replace(/[^a-z0-9#\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => NUMBER_WORDS[w] ?? w)
    .join(' ');
}

export function buildIndex(registry: Registry): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const s of registry.byId.values()) {
    if (s.id === registry.rootId) continue;
    const terms = new Set<string>([normalise(s.name), ...s.aliases.map(normalise)]);
    if (s.shortName) terms.add(normalise(s.shortName));
    for (const c of s.categories) {
      terms.add(normalise(CATEGORY_BY_ID[c]?.label ?? c));
      // category names in the other interface languages
      terms.add(normalise(sv.category[c] ?? c));
      terms.add(normalise(de.category[c] ?? c));
    }
    out.push({ id: s.id, name: s.name, terms: [...terms], kindBoost: kindBoost(s) });
  }
  return out;
}

function kindBoost(s: Structure): number {
  // whole teeth and top-level structures first; per-tooth tissue copies last
  if (s.tooth) return 3;
  if (s.toothFdi === undefined) return s.kind === 'group' ? 2 : 2.5;
  return s.kind === 'landmark' ? 0 : 0.5;
}

function termScore(q: string, qWords: string[], term: string): number {
  if (term === q) return 100;
  if (term.startsWith(q)) return 80 - Math.min(20, term.length - q.length) * 0.5;
  const words = term.split(' ');
  // every query word is a prefix of some term word
  if (qWords.every((w) => words.some((tw) => tw.startsWith(w)))) {
    const exactWords = qWords.filter((w) => words.includes(w)).length;
    return 55 + exactWords * 4 - Math.min(15, words.length - qWords.length) * 0.8;
  }
  if (term.includes(q)) return 40;
  // subsequence (typo-tolerant-ish)
  let i = 0;
  for (const ch of term) if (ch === q[i]) i++;
  if (i === q.length && q.length >= 4) return 15;
  return 0;
}

/**
 * Tooth-number queries: "11", "tooth 8", "#8", "UR6", "fdi 36", "universal 19".
 * Returns FDI numbers with a hint; the active system is ranked first.
 */
export function parseToothQuery(raw: string, system: NumberingSystem): { fdi: number; hint: string; primary: boolean }[] {
  const q = raw.trim().toLowerCase();
  const out: { fdi: number; hint: string; primary: boolean }[] = [];
  const pal = palmerToFdi(q.replace(/^palmer\s*/, ''));
  if (pal) return [{ fdi: pal, hint: `Palmer ${q.toUpperCase().replace(/\s+/g, '')}`, primary: true }];
  // "tooth" in English, Swedish (tand) and German (zahn)
  const m = /^(?:(tooth|tand|zahn|fdi|universal|uni|#)\s*)?#?\s*(\d{1,2})$/.exec(q);
  if (!m) return out;
  const n = Number(m[2]);
  const prefix = m[1];
  const fdiOk = n >= 11 && n <= 48 && n % 10 >= 1 && n % 10 <= 8 && Math.floor(n / 10) <= 4;
  const uniOk = n >= 1 && n <= 32;
  const wantUni = prefix === 'universal' || prefix === 'uni' || prefix === '#' || q.startsWith('#');
  const wantFdi = prefix === 'fdi';
  if (fdiOk && !wantUni) out.push({ fdi: n, hint: `FDI ${n}`, primary: wantFdi || system === 'fdi' || !uniOk });
  if (uniOk && !wantFdi) out.push({ fdi: universalToFdi(n), hint: `Universal #${n}`, primary: wantUni || system === 'universal' || !fdiOk });
  out.sort((a, b) => Number(b.primary) - Number(a.primary));
  return out;
}

export function search(index: SearchEntry[], registry: Registry, raw: string, system: NumberingSystem, limit = 30): SearchResult[] {
  const q = normalise(raw);
  if (!q) return [];
  const results = new Map<string, SearchResult>();
  const put = (r: SearchResult) => {
    const ex = results.get(r.id);
    if (!ex || ex.score < r.score) results.set(r.id, r);
  };

  parseToothQuery(raw, system).forEach((t, i) => put({ id: `tooth-${t.fdi}`, score: 1000 - i * 10, hint: t.hint }));

  const qWords = q.split(' ');
  // "tooth 36 pulp" → narrow to that tooth
  const toothCtx = /\b(?:(?:tooth|tand|zahn)\s*)?#?(\d{1,2})\b/.exec(raw.toLowerCase());
  for (const e of index) {
    let best = 0;
    for (const t of e.terms) {
      const s = termScore(q, qWords, t);
      if (s > best) best = s;
      if (best === 100) break;
    }
    if (best <= 0) continue;
    let score = best + e.kindBoost * 6;
    const st = registry.get(e.id)!;
    if (toothCtx && st.toothFdi !== undefined) {
      const n = Number(toothCtx[1]);
      const matchesTooth = st.toothFdi === n || (n >= 1 && n <= 32 && universalToFdi(n) === st.toothFdi);
      score += matchesTooth ? 25 : -25;
    }
    if (st.toothFdi === 36 && !st.tooth) score += 2; // detailed exemplar first
    put({ id: e.id, score });
  }
  return collapseToothParts([...results.values()].sort((a, b) => b.score - a.score), registry).slice(0, limit);
}

/**
 * "enamel" would otherwise list 32 enamel entries. Keep the first few per
 * tissue kind and prefer the exemplar/selected tooth.
 */
function collapseToothParts(results: SearchResult[], registry: Registry): SearchResult[] {
  const perKind = new Map<string, number>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const s = registry.get(r.id)!;
    if (s.toothFdi !== undefined && !s.tooth) {
      const kind = r.id.replace(/-\d{2}$/, '').replace(/-(mesial|distal|buccal|palatal|single|mesiobuccal|distobuccal)(-\d)?/, '');
      const n = perKind.get(kind) ?? 0;
      perKind.set(kind, n + 1);
      if (n >= 4) continue;
    }
    out.push(r);
  }
  return out;
}
