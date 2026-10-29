/**
 * Guide pages: one plain, text-first HTML page per tooth and per anatomical
 * structure, in every interface language (English at the root, the others in
 * /sv/, /de/, /es/, /la/), with localized slugs. They are what search engines
 * index; each links into the 3D explorer. A page is only indexed once its own
 * text is substantial (MIN_INDEX_WORDS), so thin drafts never reach the index.
 */
import { PERMANENT_FDI, archOf, fdiToPalmer, fdiToUniversal, sideOf, typeOf } from '../anatomy/notation.ts';
import { STRUCTURE_DEFS } from '../anatomy/structures.ts';
import { CONTENT } from '../content/content.ts';
import { PART_NAMES, baseStructureNames, toothNameIn, type Names, type PartKey } from '../i18n/anatomy.ts';
import { LANGS, LANG_NATIVE, type Lang } from '../i18n/lang.ts';
import { ABOUT_TEXT } from './about-text.ts';
import { PAGE_CSS, aboutPath } from './about.ts';
import { AUTHOR, REPOSITORY, SITE_NAME, type PageMeta } from './seo.ts';
import { canalFrequency, formatPercent, frequencyContext } from '../content/canalFrequency.ts';
import { FEEDBACK_TEXT } from '../i18n/feedback.ts';

/** Words of real text (summary, function, clinical notes, facts) a page needs before it is indexed. */
export const MIN_INDEX_WORDS = 150;

interface Entry {
  summary?: string;
  /** longer description of form (crown, roots, canals) for the guide pages; not shown in the explorer panel */
  anatomy?: string;
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

interface GuideText {
  teethSlug: string;
  anatomySlug: string;
  teeth: string;
  anatomy: string;
  open3d: string;
  numbers: string;
  functionTitle: string;
  clinicalTitle: string;
  neighbours: string;
  mesial: string;
  distal: string;
  otherSide: string;
  antagonist: string;
  related: string;
  anatomyTitle: string;
  toothTail: string;
  structureTail: string;
  draft: string;
}

export const GUIDE_TEXT: Record<Lang, GuideText> = {
  en: {
    teethSlug: 'teeth',
    anatomySlug: 'anatomy',
    teeth: 'Teeth',
    anatomy: 'Anatomy',
    open3d: 'Open in 3D →',
    numbers: 'Tooth numbers',
    functionTitle: 'Function',
    clinicalTitle: 'Clinical relevance',
    neighbours: 'Neighbouring teeth',
    mesial: 'Mesial neighbour',
    distal: 'Distal neighbour',
    otherSide: 'Same tooth, other side',
    antagonist: 'Opposing tooth',
    related: 'Related structures',
    anatomyTitle: 'Form and anatomy',
    toothTail: 'tooth anatomy in 3D',
    structureTail: 'anatomy in 3D',
    draft: 'This text is a draft and has not yet been reviewed by a dental professional. Educational reference only, not for diagnosis or treatment.',
  },
  sv: {
    teethSlug: 'tander',
    anatomySlug: 'anatomi',
    teeth: 'Tänder',
    anatomy: 'Anatomi',
    open3d: 'Öppna i 3D →',
    numbers: 'Tandnummer',
    functionTitle: 'Funktion',
    clinicalTitle: 'Klinisk betydelse',
    neighbours: 'Granntänder',
    mesial: 'Mesial granne',
    distal: 'Distal granne',
    otherSide: 'Samma tand, andra sidan',
    antagonist: 'Motstående tand',
    related: 'Relaterade strukturer',
    anatomyTitle: 'Form och anatomi',
    toothTail: 'tandanatomi i 3D',
    structureTail: 'anatomi i 3D',
    draft: 'Texten är ett utkast och har ännu inte granskats av tandvårdspersonal. Endast för utbildning, inte för diagnos eller behandling.',
  },
  de: {
    teethSlug: 'zaehne',
    anatomySlug: 'anatomie',
    teeth: 'Zähne',
    anatomy: 'Anatomie',
    open3d: 'In 3D öffnen →',
    numbers: 'Zahnnummern',
    functionTitle: 'Funktion',
    clinicalTitle: 'Klinische Bedeutung',
    neighbours: 'Nachbarzähne',
    mesial: 'Mesialer Nachbar',
    distal: 'Distaler Nachbar',
    otherSide: 'Gleicher Zahn, andere Seite',
    antagonist: 'Gegenzahn',
    related: 'Verwandte Strukturen',
    anatomyTitle: 'Form und Anatomie',
    toothTail: 'Zahnanatomie in 3D',
    structureTail: 'Anatomie in 3D',
    draft: 'Dieser Text ist ein Entwurf und wurde noch nicht zahnärztlich geprüft. Nur zu Lernzwecken, nicht zur Diagnose oder Behandlung.',
  },
  es: {
    teethSlug: 'dientes',
    anatomySlug: 'anatomia',
    teeth: 'Dientes',
    anatomy: 'Anatomía',
    open3d: 'Abrir en 3D →',
    numbers: 'Numeración dental',
    functionTitle: 'Función',
    clinicalTitle: 'Relevancia clínica',
    neighbours: 'Dientes vecinos',
    mesial: 'Vecino mesial',
    distal: 'Vecino distal',
    otherSide: 'Mismo diente, otro lado',
    antagonist: 'Diente antagonista',
    related: 'Estructuras relacionadas',
    anatomyTitle: 'Forma y anatomía',
    toothTail: 'anatomía dental en 3D',
    structureTail: 'anatomía en 3D',
    draft: 'Este texto es un borrador y aún no ha sido revisado por un profesional de la odontología. Solo con fines educativos, no para diagnóstico ni tratamiento.',
  },
  la: {
    teethSlug: 'dentes',
    anatomySlug: 'anatomia',
    teeth: 'Dentes',
    anatomy: 'Anatomia',
    open3d: 'Aperi in 3D →',
    numbers: 'Numeri dentis',
    functionTitle: 'Functio',
    clinicalTitle: 'Momentum clinicum',
    neighbours: 'Dentes vicini',
    mesial: 'Vicinus mesialis',
    distal: 'Vicinus distalis',
    otherSide: 'Idem dens, latere altero',
    antagonist: 'Dens antagonista',
    related: 'Structurae cognatae',
    anatomyTitle: 'Forma et anatomia',
    toothTail: 'anatomia dentis in 3D',
    structureTail: 'anatomia in 3D',
    draft: 'Hic textus adumbratio est, nondum a medico dentario recognita. Ad discendum tantum, non ad diagnosim vel curationem.',
  },
};

/** URL slug: lower case ASCII; German umlauts become ae/oe/ue, other accents are dropped. */
export function slugify(s: string, lang: Lang): string {
  let t = s.toLowerCase();
  if (lang === 'de') t = t.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const langPrefix = (lang: Lang) => (lang === 'en' ? '' : `${lang}/`);
const toothName = (fdi: number, lang: Lang) => toothNameIn(typeOf(fdi), archOf(fdi), sideOf(fdi), lang);

/* ------------------------------------------------------------------ subjects */

export interface GuideSubject {
  /** 'tooth:36' or 'structure:<content key>' */
  id: string;
  names: Names;
  /** content entry key (shared by both sides of a tooth type) */
  contentKey: string;
  /** explorer deep link below the site base */
  appPath: string;
  fdi?: number;
}

/** Content keys that are groups, context or too generic for a page of their own. */
const SKIP = new Set(['skull', 'mandibular-nerve-branches', 'maxillary-nerve-branches', 'root', 'crown', 'canal', 'pulp-horn', 'apical-foramen']);

function structureSubject(key: string): GuideSubject | undefined {
  if (SKIP.has(key)) return undefined;
  const exact = STRUCTURE_DEFS.find((d) => d.id === key);
  const sided = exact ? undefined : STRUCTURE_DEFS.find((d) => d.id === `${key}-right`);
  if (exact || sided) {
    const def = (exact ?? sided)!;
    const en = exact ? def.name : def.name.replace(/^Right /, '').replace(/^./, (c) => c.toUpperCase());
    const names = baseStructureNames(key, en, !exact);
    return names ? { id: `structure:${key}`, names, contentKey: key, appPath: `structure/${def.id}/` } : undefined;
  }
  const part = PART_NAMES.en[key as PartKey];
  if (!part) return undefined;
  const names = Object.fromEntries(LANGS.map((l) => [l, PART_NAMES[l][key as PartKey]])) as Names;
  // tissues exist in every tooth: open a first molar's dissection to show them
  return { id: `structure:${key}`, names, contentKey: key, appPath: 'tooth/36/dissect/' };
}

export const TOOTH_SUBJECTS: GuideSubject[] = PERMANENT_FDI.map((fdi) => ({
  id: `tooth:${fdi}`,
  names: Object.fromEntries(LANGS.map((l) => [l, toothName(fdi, l)])) as Names,
  contentKey: `tooth:${typeOf(fdi)}:${archOf(fdi)}`,
  appPath: `tooth/${fdi}/`,
  fdi,
}));

export const STRUCTURE_SUBJECTS: GuideSubject[] = Object.keys(CONTENT.en)
  .filter((k) => !k.startsWith('_') && !k.startsWith('tooth:'))
  .map(structureSubject)
  .filter((s): s is GuideSubject => !!s);

export const GUIDE_SUBJECTS: GuideSubject[] = [...TOOTH_SUBJECTS, ...STRUCTURE_SUBJECTS];
const BY_ID = new Map(GUIDE_SUBJECTS.map((s) => [s.id, s]));

/** Path of a subject's guide page in a language, below the site root (ends with '/'). */
export function guidePath(s: GuideSubject, lang: Lang): string {
  const T = GUIDE_TEXT[lang];
  const slug = s.fdi !== undefined ? `${s.fdi}-${slugify(s.names[lang], lang)}` : slugify(s.names[lang], lang);
  return `${langPrefix(lang)}${s.fdi !== undefined ? T.teethSlug : T.anatomySlug}/${slug}/`;
}

/* ------------------------------------------------------------------ indexing */

const entryOf = (s: GuideSubject, lang: Lang): Entry | undefined => (CONTENT[lang] as Record<string, Entry>)[s.contentKey];

/** Words of the page's own text in that language. */
export function wordCount(s: GuideSubject, lang: Lang): number {
  const e = entryOf(s, lang);
  if (!e) return 0;
  const parts = [e.summary, e.anatomy, e.function, e.clinical, e.location, e.roots, e.canals, e.eruption, ...(e.facts ?? []).map((f) => `${f.label} ${f.value}`)];
  return parts.filter(Boolean).join(' ').split(/\s+/).filter(Boolean).length;
}

export const isIndexable = (s: GuideSubject, lang: Lang) => wordCount(s, lang) >= MIN_INDEX_WORDS;

export interface GuidePage extends PageMeta {
  lang: Lang;
  subject: GuideSubject;
  indexable: boolean;
}

/** Search snippet: the page's own text, led by the name when that text is too short to stand alone. */
function snippet(name: string, text: string, open3d: string): string {
  let t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 70) t = `${name}: ${t ? `${t} ` : ''}${open3d}.`;
  if (t.length <= 158) return t;
  const cut = t.slice(0, 157);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

export function guidePage(s: GuideSubject, lang: Lang): GuidePage {
  const T = GUIDE_TEXT[lang];
  const name = s.names[lang];
  const indexable = isIndexable(s, lang);
  // hreflang only links indexable versions of the same page
  const alternates = indexable ? Object.fromEntries(LANGS.filter((l) => isIndexable(s, l)).map((l) => [l, guidePath(s, l)])) : undefined;
  const title = s.fdi !== undefined ? `${name} (FDI ${s.fdi}) – ${T.toothTail} | ${SITE_NAME}` : `${name} – ${T.structureTail} | ${SITE_NAME}`;
  return {
    path: guidePath(s, lang),
    title,
    // a short summary alone makes a weak search snippet: continue with the function
    description: snippet(name, [entryOf(s, lang)?.summary, entryOf(s, lang)?.function].filter(Boolean).join(' '), T.open3d.replace(' →', '')),
    lang,
    alternates,
    crumbs: [{ name: s.fdi !== undefined ? T.teeth : T.anatomy, path: `${aboutPath(lang)}#${s.fdi !== undefined ? 'teeth' : 'glossary'}` }],
    about: {
      name,
      alternateName: s.fdi !== undefined ? [`FDI ${s.fdi}`, `Universal ${fdiToUniversal(s.fdi)}`, `Palmer ${fdiToPalmer(s.fdi)}`] : undefined,
    },
    learning: true,
    subject: s,
    indexable,
  };
}

export const GUIDE_PAGES: GuidePage[] = GUIDE_SUBJECTS.flatMap((s) => LANGS.map((l) => guidePage(s, l)));

/** Keep published Swedish sinus links usable after the terminology change. */
export const GUIDE_REDIRECTS = [{ path: 'sv/anatomi/kakhalor/', to: guidePath(BY_ID.get('structure:maxillary-sinus')!, 'sv') }];

/* ------------------------------------------------------------------ html */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Tooth in the same arch next to `fdi` toward (mesial) or away from (distal) the midline; crosses the midline for central incisors. */
export function neighbour(fdi: number, dir: 'mesial' | 'distal'): number | undefined {
  const q = Math.floor(fdi / 10);
  const pos = fdi % 10;
  if (dir === 'distal') return pos < 8 ? fdi + 1 : undefined;
  if (pos > 1) return fdi - 1;
  const across: Record<number, number> = { 1: 2, 2: 1, 3: 4, 4: 3 };
  return across[q] * 10 + 1;
}
export const otherSide = (fdi: number) => ({ 1: 2, 2: 1, 3: 4, 4: 3 })[Math.floor(fdi / 10) as 1 | 2 | 3 | 4] * 10 + (fdi % 10);
export const opposing = (fdi: number) => ({ 1: 4, 2: 3, 3: 2, 4: 1 })[Math.floor(fdi / 10) as 1 | 2 | 3 | 4] * 10 + (fdi % 10);

/**
 * The page as a complete HTML document. `head` holds the SEO tags from seo.ts,
 * `base` is the site base ('/' or a sub-path).
 */
export function guideHtml(page: GuidePage, head: string, base: string): string {
  const { lang, subject: s } = page;
  const T = GUIDE_TEXT[lang];
  const A = ABOUT_TEXT[lang];
  const e = entryOf(s, lang) ?? {};
  const q = lang === 'en' ? '' : `?lang=${lang}`;
  const link = (id: string) => {
    const t = BY_ID.get(id);
    return t ? `<a href="${base}${guidePath(t, lang)}">${esc(t.names[lang])}</a>` : '';
  };
  const app = `${base}${s.appPath}${q}`;
  const langNav = LANGS.map((l) =>
    l === lang ? `<strong lang="${l}">${LANG_NATIVE[l]}</strong>` : `<a href="${base}${guidePath(s, l)}" hreflang="${l}" lang="${l}">${LANG_NATIVE[l]}</a>`,
  ).join(' · ');
  const crumbTarget = `${base}${aboutPath(lang)}#${s.fdi !== undefined ? 'teeth' : 'glossary'}`;

  const facts: [string, string][] = [];
  if (s.fdi !== undefined) facts.push(['FDI', String(s.fdi)], ['Universal', String(fdiToUniversal(s.fdi))], ['Palmer', fdiToPalmer(s.fdi)]);
  if (e.roots) facts.push([A.rootsLabel, e.roots]);
  if (e.canals) facts.push([A.canalsLabel, e.canals]);
  if (e.eruption) facts.push([A.eruptionLabel, e.eruption]);
  for (const f of e.facts ?? []) facts.push([f.label, f.value]);

  const sections: string[] = [];
  if (e.anatomy) sections.push(`<h2>${esc(T.anatomyTitle)}</h2><p>${esc(e.anatomy)}</p>`);
  if (e.function) sections.push(`<h2>${esc(T.functionTitle)}</h2><p>${esc(e.function)}</p>`);
  if (e.clinical) sections.push(`<h2>${esc(T.clinicalTitle)}</h2><p>${esc(e.clinical)}</p>`);
  const F = FEEDBACK_TEXT[lang];
  if (e.location) sections.push(`<h2>${esc(F.location)}</h2><p>${esc(e.location)}</p>`);
  if (e.sources?.length) sections.push(`<p class="note">${esc(F.source)}: ${e.sources.map((r) => `<a href="${esc(r.url)}" rel="noopener">${esc(r.title)}</a>`).join(' · ')}</p>`);
  const frequency = s.fdi !== undefined ? canalFrequency(s.fdi) : undefined;
  if (frequency && s.fdi !== undefined) sections.push(`<h2>${esc(F.canalFrequency)}</h2><table class="canal-counts"><thead><tr><th scope="col">${esc(F.canals)}</th><th scope="col">${esc(F.frequency)}</th></tr></thead><tbody>${frequency.rows.map((r) => `<tr><th scope="row">${r.canals}</th><td>${esc(formatPercent(r.percent, lang))}</td></tr>`).join('')}</tbody></table><p class="note">${esc(F.sample)}: ${frequency.n}. ${esc(frequencyContext(s.fdi, lang).join(' '))}</p><p class="note">${esc(F.evidenceNote)} ${esc(F.modeledNote)}</p><p><a href="${frequency.source.url}" rel="noopener">${esc(frequency.source.citation)}</a></p>`);
  if (s.fdi !== undefined) {
    const rows: [string, number | undefined][] = [
      [T.mesial, neighbour(s.fdi, 'mesial')],
      [T.distal, neighbour(s.fdi, 'distal')],
      [T.otherSide, otherSide(s.fdi)],
      [T.antagonist, opposing(s.fdi)],
    ];
    sections.push(
      `<h2>${esc(T.neighbours)}</h2><dl class="facts">${rows
        .filter(([, f]) => f !== undefined)
        .map(([label, f]) => `<dt>${esc(label)}</dt><dd>${link(`tooth:${f}`)}</dd>`)
        .join('')}</dl>`,
    );
  }
  const related = ((CONTENT.en as Record<string, Entry>)[s.contentKey]?.related ?? []).map((k) => link(`structure:${k}`)).filter(Boolean);
  if (related.length) sections.push(`<h2>${esc(T.related)}</h2><p class="links">${related.join(' · ')}</p>`);

  return `<!doctype html>
<html lang="${A.htmlLang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#f7f5f0" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#11100e" media="(prefers-color-scheme: dark)" />
    ${head}
    <link rel="icon" type="image/x-icon" sizes="16x16 32x32 48x48" href="${base}favicon.ico" />
    <link rel="icon" type="image/png" sizes="96x96" href="${base}favicon.png" />
    <link rel="icon" type="image/svg+xml" sizes="any" href="${base}favicon.svg" />
    <style>${PAGE_CSS}${GUIDE_CSS}</style>
    <script defer src="/_vercel/insights/script.js"></script>
  </head>
  <body>
    <header class="top">
      <a class="brand" href="${base}${q}">${SITE_NAME}</a>
      <a class="cta" href="${app}">${esc(T.open3d)}</a>
    </header>
    <main>
      <nav class="crumbs" aria-label="Breadcrumb"><a href="${base}${q}">${SITE_NAME}</a> › <a href="${crumbTarget}">${esc(s.fdi !== undefined ? T.teeth : T.anatomy)}</a></nav>
      <p class="langs" aria-label="${esc(A.otherLanguages)}">${langNav}</p>
      <h1>${esc(s.names[lang])}</h1>
      ${e.summary ? `<p class="lede">${esc(e.summary)}</p>` : ''}
      <p><a class="cta" href="${app}">${esc(T.open3d)}</a></p>
      ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${sections.join('\n      ')}
      <p class="note">${esc(T.draft)}</p>
    </main>
    <footer class="bottom"><a href="${base}${aboutPath(lang)}">${SITE_NAME}</a> · ${esc(A.footer)} · ${esc(A.madeBy)} <a href="${REPOSITORY}" rel="noopener">${AUTHOR}</a></footer>
  </body>
</html>
`;
}

const GUIDE_CSS = `
.canal-counts{border-collapse:collapse;width:100%;max-width:480px}.canal-counts th,.canal-counts td{text-align:left;padding:6px 12px;border-bottom:1px solid var(--line)}
.crumbs{margin:16px 0 0;color:var(--muted);font-size:14px}
.facts{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:16px 0;padding:14px 16px;background:var(--card);border:1px solid var(--line);border-radius:12px;font-size:15px}
.facts dt{color:var(--muted)}
.facts dd{margin:0}
`;
