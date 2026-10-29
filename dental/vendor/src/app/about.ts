/**
 * The /about/ page: a plain, fast, text-first HTML page (no WebGL, no app bundle)
 * that search engines and readers can use. It explains the project and carries
 * a readable guide to every permanent tooth, the numbering systems and the
 * structures in the 3D model, with links into the explorer. Built by vite.config.ts
 * in English (about/), Swedish (about/sv/), German (about/de/), Spanish (about/es/) and Latin (about/la/).
 */
import { PERMANENT_FDI, TOOTH_TYPES, archOf, fdiToPalmer, fdiToUniversal, sideOf, typeOf } from '../anatomy/notation.ts';
import type { ToothType } from '../anatomy/types.ts';
import { CONTENT } from '../content/content.ts';
import { toothGuide } from '../content/toothGuides.ts';
import { TYPE_PLURALS, archTypeName, toothNameIn } from '../i18n/anatomy.ts';
import { LANGS, LANG_NATIVE, type Lang } from '../i18n/lang.ts';
import { ABOUT_TEXT } from './about-text.ts';
import { AUTHOR, REPOSITORY, SITE_NAME, jsonLd } from './seo.ts';

interface Entry {
  summary?: string;
  function?: string;
  clinical?: string;
  roots?: string;
  canals?: string;
  eruption?: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Glossary groups (headings are in ABOUT_TEXT.glossaryGroups): content keys per group */
const GLOSSARY: string[][] = [
  ['crown', 'root', 'cej', 'apex'],
  ['enamel', 'dentin', 'cementum', 'pulp', 'pulp-chamber', 'pulp-horn', 'root-canals', 'apical-foramen'],
  ['periodontium', 'gingiva', 'pdl', 'maxillary-alveolar-process', 'mandibular-alveolar-process'],
  ['maxilla', 'maxillary-sinus', 'mandible', 'mandibular-condyle', 'tmj', 'articular-disc', 'mandibular-foramen', 'mental-foramen'],
  [
    'inferior-alveolar-nerve',
    'mental-nerve',
    'incisive-nerve',
    'lingual-nerve',
    'infraorbital-nerve',
    'posterior-superior-alveolar-nerve',
    'middle-superior-alveolar-nerve',
    'anterior-superior-alveolar-nerve',
    'greater-palatine-nerve',
    'nasopalatine-nerve',
    'inferior-alveolar-artery',
  ],
  ['masseter', 'temporalis', 'medial-pterygoid', 'lateral-pterygoid', 'buccinator', 'orbicularis-oris', 'mentalis'],
];

/** The English FAQ (also used as the page's FAQPage structured data). */
export const FAQ = ABOUT_TEXT.en.faq;

/** Path of the about page for a language, below the site root. */
export const aboutPath = (lang: Lang) => (lang === 'en' ? 'about/' : `about/${lang}/`);

const toothName = (fdi: number, lang: Lang) => toothNameIn(typeOf(fdi), archOf(fdi), sideOf(fdi), lang);

/** Explorer link for a tooth; translated pages open the explorer in their language. */
const toothHref = (fdi: number, base: string, lang: Lang) => `${base}tooth/${fdi}/${lang === 'en' ? '' : `?lang=${lang}`}`;

function toothRow(fdi: number, base: string, lang: Lang): string {
  return `<li><a href="${toothHref(fdi, base, lang)}">${esc(toothName(fdi, lang))}</a> <span class="num">FDI ${fdi} · Universal ${fdiToUniversal(fdi)} · Palmer ${fdiToPalmer(fdi)}</span></li>`;
}

const term = (label: string, value: string) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`;

/** A tooth type's nerve supply and identification guides, as titled definition lists. */
const guides = (key: string, lang: Lang) =>
  (toothGuide(key, lang) ?? []).map((g) => `<p><strong>${esc(g.title)}</strong></p><dl>${g.rows.map((r) => term(r.label, r.value)).join('')}</dl>`).join('');

function toothTypeSection(type: ToothType, base: string, lang: Lang): string {
  const T = ABOUT_TEXT[lang];
  const content = CONTENT[lang] as Record<string, Entry>;
  const arches = (['maxillary', 'mandibular'] as const)
    .map((arch) => {
      const e = content[`tooth:${type}:${arch}`];
      if (!e) return '';
      const fdis = PERMANENT_FDI.filter((f) => typeOf(f) === type && archOf(f) === arch);
      const facts = [
        e.roots && term(T.rootsLabel, e.roots),
        e.canals && term(T.canalsLabel, e.canals),
        e.eruption && term(T.eruptionLabel, e.eruption),
      ]
        .filter(Boolean)
        .join('');
      return `
        <article class="tooth" id="${arch}-${type}">
          <h4>${esc(archTypeName(type, arch, lang))} <span class="alt">(${esc(arch === 'maxillary' ? T.upper : T.lower)})</span></h4>
          ${e.summary ? `<p>${esc(e.summary)}</p>` : ''}
          ${e.function ? `<p><strong>${esc(T.functionLabel)}</strong> ${esc(e.function)}</p>` : ''}
          ${e.clinical ? `<p><strong>${esc(T.notesLabel)}</strong> ${esc(e.clinical)}</p>` : ''}
          ${facts ? `<dl>${facts}</dl>` : ''}
          ${guides(`tooth:${type}:${arch}`, lang)}
          <p class="links">${esc(T.viewIn3d)} ${fdis.map((f) => `<a href="${toothHref(f, base, lang)}">${esc(toothName(f, lang))} (${f} · #${fdiToUniversal(f)})</a>`).join(', ')}</p>
        </article>`;
    })
    .join('');
  return `<section class="type"><h3>${esc(TYPE_PLURALS[lang][type])}</h3>${arches}</section>`;
}

/**
 * Full HTML document for the about page in `lang`. `head` is the page's generated head tags;
 * `base` the site base path (for links into the explorer); `faviconHref` the icon URL.
 */
export function aboutHtml(head: string, base: string, faviconHref: string, lang: Lang = 'en'): string {
  const T = ABOUT_TEXT[lang];
  const STRUCTURES = CONTENT[lang] as Record<string, Entry>;
  const termName = (k: string) => T.termNames[k] ?? cap(k.replace(/-/g, ' '));
  const explorer = `${base}${lang === 'en' ? '' : `?lang=${lang}`}`;
  const glossary = GLOSSARY.map(
    (keys, i) => `
      <h3>${esc(T.glossaryGroups[i])}</h3>
      <dl class="terms">${keys
        .filter((k) => STRUCTURES[k]?.summary)
        .map((k) => `<dt>${esc(termName(k))}</dt><dd>${esc(STRUCTURES[k].summary!)}${STRUCTURES[k].function ? ` ${esc(STRUCTURES[k].function)}` : ''}</dd>`)
        .join('')}</dl>`,
  ).join('');
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    inLanguage: T.htmlLang,
    mainEntity: T.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
  const ids = ['features', 'teeth', 'numbering', 'types', 'glossary', 'faq', 'credits'];
  // links to this page in the other languages (relative to the site base)
  const langNav = LANGS.map((l) =>
    l === lang ? `<strong lang="${l}">${LANG_NATIVE[l]}</strong>` : `<a href="${base}${aboutPath(l)}" hreflang="${l}" lang="${l}">${LANG_NATIVE[l]}</a>`,
  ).join(' · ');
  const credits = T.creditsHtml
    .replace('{author}', AUTHOR)
    .replace('{repo}', REPOSITORY)
    .replace('{bp3d}', 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html')
    .replace('{licence}', 'https://creativecommons.org/licenses/by-sa/2.1/jp/deed.en');

  return `<!doctype html>
<html lang="${T.htmlLang}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#f7f5f0" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#11100e" media="(prefers-color-scheme: dark)" />
    ${head}
    ${jsonLd(faqLd)}
    <link rel="icon" type="image/x-icon" sizes="16x16 32x32 48x48" href="${base}favicon.ico" />
    <link rel="icon" type="image/png" sizes="96x96" href="${base}favicon.png" />
    <link rel="icon" type="image/svg+xml" sizes="any" href="${faviconHref}" />
    <style>${CSS}</style>
    <script defer src="/_vercel/insights/script.js"></script>
  </head>
  <body>
    <header class="top">
      <a class="brand" href="${explorer}">${SITE_NAME}</a>
      <a class="cta" href="${explorer}">${esc(T.openExplorer)}</a>
    </header>
    <main>
      <p class="langs" aria-label="${esc(T.otherLanguages)}">${langNav}</p>
      <h1>${esc(T.h1)}</h1>
      <p class="lede">${esc(T.lede)}</p>
      <p><a class="cta" href="${explorer}">${esc(T.openExplorer)}</a></p>

      <nav class="toc" aria-label="${esc(T.onThisPage)}">
        ${ids.map((id, i) => `<a href="#${id}">${esc(T.toc[i])}</a>`).join(' · ')}
      </nav>

      <section id="features">
        <h2>${esc(T.featuresTitle)}</h2>
        <ul>
          ${T.features.map(([b, rest]) => `<li><strong>${esc(b)}</strong>: ${esc(rest)}</li>`).join('\n          ')}
        </ul>
      </section>

      <section id="teeth">
        <h2>${esc(T.teethTitle)}</h2>
        <p>${esc(T.teethIntro)}</p>
        <div class="quads">${T.quadrants
          .map((label, i) => `<div><h3>${esc(label)}</h3><ol>${PERMANENT_FDI.filter((f) => Math.floor(f / 10) === i + 1).map((f) => toothRow(f, base, lang)).join('')}</ol></div>`)
          .join('')}</div>
      </section>

      <section id="numbering">
        <h2>${esc(T.numberingTitle)}</h2>
        <p>${esc(T.numberingIntro)}</p>
        <table>
          <thead><tr>${T.numberingHead.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${T.numberingRows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('\n            ')}
          </tbody>
        </table>
      </section>

      <section id="types">
        <h2>${esc(T.typesTitle)}</h2>
        <p>${esc(T.typesIntro)}</p>
        ${TOOTH_TYPES.map((t) => toothTypeSection(t, base, lang)).join('')}
      </section>

      <section id="glossary">
        <h2>${esc(T.glossaryTitle)}</h2>
        <p>${esc(T.glossaryIntro)}</p>
        ${glossary}
      </section>

      <section id="faq">
        <h2>${esc(T.faqTitle)}</h2>
        ${T.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}
      </section>

      <section id="credits">
        <h2>${esc(T.creditsTitle)}</h2>
        <p>${credits}</p>
        <p class="note">${esc(T.note)}</p>
      </section>
    </main>
    <footer class="bottom"><a href="${explorer}">${SITE_NAME}</a> · ${esc(T.footer)} · ${esc(T.madeBy)} <a href="${REPOSITORY}" rel="noopener">${AUTHOR}</a></footer>
  </body>
</html>
`;
}

const CSS = `
:root{--bg:#f7f5f0;--ink:#1c1a17;--muted:#6b665d;--line:#d6d0c4;--card:#f6f3ed;--accent:#9a3b3b}
@media (prefers-color-scheme:dark){:root{--bg:#11100e;--ink:#ece8e1;--muted:#a39d92;--line:#2c2a26;--card:#1a1916;--accent:#e08a7e}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}
.top{display:flex;justify-content:space-between;align-items:center;gap:16px;max-width:880px;margin:0 auto;padding:20px 16px}
.brand{font:600 22px/1.2 Georgia,"Times New Roman",serif;color:var(--ink);text-decoration:none}
.cta{display:inline-block;padding:8px 14px;border-radius:999px;background:var(--ink);color:var(--bg);text-decoration:none;font-weight:600;font-size:14px;white-space:nowrap}
main{max-width:880px;margin:0 auto;padding:8px 16px 48px}
h1{font:600 clamp(30px,5vw,44px)/1.15 Georgia,"Times New Roman",serif;margin:24px 0 16px}
h2{font:600 26px/1.25 Georgia,"Times New Roman",serif;margin:48px 0 12px;padding-top:16px;border-top:1px solid var(--line)}
h3{font-size:18px;margin:28px 0 8px}
h4{font-size:16px;margin:0 0 6px}
.lede{font-size:18px}
.toc{margin:24px 0;color:var(--muted);font-size:14px}
.langs{margin:8px 0 0;color:var(--muted);font-size:14px}
.quads{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px 24px}
.quads ol{padding-left:20px;margin:0}
.num,.alt{color:var(--muted);font-size:13px;font-weight:400}
.tooth{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:12px 0}
.tooth p{margin:6px 0}
.tooth dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:8px 0;font-size:14px}
.tooth dt{color:var(--muted)}
.tooth dd{margin:0}
.links{font-size:14px}
.terms dt{font-weight:600;margin-top:10px}
.terms dd{margin:2px 0 0}
table{width:100%;border-collapse:collapse;font-size:15px;display:block;overflow-x:auto}
th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line)}
.note{color:var(--muted);font-size:14px}
.bottom{max-width:880px;margin:0 auto;padding:24px 16px 40px;color:var(--muted);font-size:14px;border-top:1px solid var(--line)}
`;

/** Shared stylesheet for the plain text pages (about, guide). */
export const PAGE_CSS = CSS;
