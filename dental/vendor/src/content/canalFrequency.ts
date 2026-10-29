import data from './canal-counts.json' with { type: 'json' };
import { archOf, typeOf } from '../anatomy/notation.ts';
import { FEEDBACK_TEXT } from '../i18n/feedback.ts';
import type { Lang } from '../i18n/lang.ts';

export function canalFrequency(fdi: number) {
  const entry = data.entries[`tooth:${typeOf(fdi)}:${archOf(fdi)}`];
  if (!entry) return undefined;
  const source = data.sources[entry.source as keyof typeof data.sources];
  return { ...entry, source, rows: entry.counts.flatMap((count, i) => count ? [{ canals: i + 1, count, percent: count / entry.n * 100 }] : []) };
}

export function frequencyContext(fdi: number, lang: Lang): string[] {
  const item = canalFrequency(fdi);
  if (!item) return [];
  const t = FEEDBACK_TEXT[lang];
  return [t[item.source.population as 'toulouse' | 'jordan'], t[item.source.method as 'cbct' | 'clearing'], t[item.source.definition as 'observed' | 'maximum']];
}

export function formatPercent(value: number, lang: Lang): string {
  return `${value.toLocaleString(lang === 'la' ? 'en' : lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
