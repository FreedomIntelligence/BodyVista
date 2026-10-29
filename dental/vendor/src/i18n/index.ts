/**
 * Interface translation. The active language lives in the app store (`lang`),
 * so components re-render when it changes: read text with `useT()` in React,
 * or `t()` outside it.
 */
import { getState, useApp } from '../state/store';
import { de } from './de';
import { en, type Messages } from './en';
import type { Lang } from './lang';
import { sv } from './sv';
import { es } from './es';
import { la } from './la';

export type { Messages } from './en';
export * from './lang';

export const MESSAGES: Record<Lang, Messages> = { en, sv, de, es, la };

/** Messages for the active language (outside React). */
export const t = (): Messages => MESSAGES[getState().lang];

/** Messages for the active language; re-renders on language change. */
export function useT(): Messages {
  return MESSAGES[useApp((s) => s.lang)];
}

export function useLang(): Lang {
  return useApp((s) => s.lang);
}

/** A structure's name in a language (English when no translation is stored). */
export function nameOf(s: { name: string; names?: Partial<Record<Lang, string>> }, lang: Lang): string {
  return s.names?.[lang] ?? s.name;
}

/** Short 3D-label name, falling back to the full name. */
export function shortOf(s: { name: string; names?: Partial<Record<Lang, string>>; shortName?: string; shortNames?: Partial<Record<Lang, string>> }, lang: Lang): string {
  return s.shortNames?.[lang] ?? s.shortName ?? nameOf(s, lang);
}
