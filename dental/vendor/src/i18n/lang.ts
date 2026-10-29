/** Interface languages. English is the default; Swedish, German, Spanish and Latin are full translations. */
export type Lang = 'en' | 'sv' | 'de' | 'es' | 'la';

export const LANGS: readonly Lang[] = ['en', 'sv', 'de', 'es', 'la'];
export const DEFAULT_LANG: Lang = 'en';

/** Each language's name in its own language (for the switcher). */
export const LANG_NATIVE: Record<Lang, string> = { en: 'English', sv: 'Svenska', de: 'Deutsch', es: 'Español', la: 'Latina' };

export const isLang = (v: unknown): v is Lang => (LANGS as readonly unknown[]).includes(v);
