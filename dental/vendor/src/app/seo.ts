/**
 * Search and sharing metadata. Pure functions shared by the build (vite.config.ts
 * writes the head tags, robots.txt, sitemap.xml and one static entry page per
 * tooth) and the app (document title while navigating).
 */
import { PERMANENT_FDI, fdiToPalmer, fdiToUniversal, toothName } from '../anatomy/notation.ts';
import type { Structure } from '../anatomy/types.ts';
import type { Lang } from '../i18n/lang.ts';
import { ABOUT_TEXT } from './about-text.ts';

export const SITE_NAME = 'Dental Scope';
export const AUTHOR = 'Yoseph';
export const REPOSITORY = 'https://github.com/Yoosseph/dental-scope';

export interface PageMeta {
  /** path below the site root, '' for home; tooth pages end with '/' (GitHub Pages serves folder/index.html) */
  path: string;
  title: string;
  description: string;
  /** page language (default English) */
  lang?: Lang;
  /** the same page in other languages, for hreflang links: language → path */
  alternates?: Partial<Record<Lang, string>>;
  /** breadcrumb trail after the site root (name + path); the page itself is appended */
  crumbs?: { name: string; path: string }[];
  /** the anatomical structure the page is about, for structured data */
  about?: { name: string; alternateName?: string[] };
  /** an educational text page (schema.org LearningResource) */
  learning?: boolean;
}

export const HOME: PageMeta = {
  path: '',
  title: SITE_NAME,
  description:
    'Free interactive 3D dental anatomy: all 32 permanent teeth with FDI, Universal and Palmer numbers, enamel to root canals, jaws and nerves. Educational tool.',
};

const ABOUT_ALTERNATES: Record<Lang, string> = { en: 'about/', sv: 'about/sv/', de: 'about/de/', es: 'about/es/', la: 'about/la/' };
const aboutPage = (lang: Lang): PageMeta => ({
  path: ABOUT_ALTERNATES[lang],
  title: ABOUT_TEXT[lang].title,
  description: ABOUT_TEXT[lang].description,
  lang,
  alternates: ABOUT_ALTERNATES,
});

export const ABOUT: PageMeta = aboutPage('en');
/** The about page in every language: English, Swedish, German, Spanish, Latin. */
export const ABOUT_PAGES: PageMeta[] = [ABOUT, aboutPage('sv'), aboutPage('de'), aboutPage('es'), aboutPage('la')];
const LOCALE: Record<Lang, string> = { en: 'en_US', sv: 'sv_SE', de: 'de_DE', es: 'es_ES', la: 'la_VA' };
const ABOUT_CRUMB: Record<Lang, string> = { en: 'About', sv: 'Om', de: 'Über', es: 'Acerca de', la: 'De opere' };

export const OG_IMAGE = { path: 'og-image.png', width: 1200, height: 630, alt: 'Dental Scope: 3D model of the jaws and permanent teeth' };

export function toothPage(fdi: number): PageMeta {
  const name = toothName(fdi);
  const numbers = `FDI ${fdi} · Universal ${fdiToUniversal(fdi)}`;
  return {
    path: `tooth/${fdi}/`,
    title: `${name} (${numbers}) — ${SITE_NAME}`,
    description: `Interactive 3D model of the ${name.toLowerCase()} (${numbers} · Palmer ${fdiToPalmer(fdi)}): crown, roots, pulp and canals. Educational reference.`,
  };
}

export const TOOTH_PAGES: PageMeta[] = PERMANENT_FDI.map(toothPage);

/** The browser tab keeps the tool name while navigating and inspecting anatomy. */
export function documentTitle(_sel: Pick<Structure, 'name' | 'tooth'> | undefined): string {
  return SITE_NAME;
}

/** Absolute site root (with trailing slash), or null when not configured. */
export function normalizeSiteUrl(raw: string | undefined): string | null {
  const url = raw?.trim();
  if (!url || !/^https?:\/\/[^\s/]+/.test(url)) return null;
  return url.endsWith('/') ? url : `${url}/`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface HeadOptions {
  /** SPA fallback page: noindex, no canonical URL */
  notFound?: boolean;
  /** Google Search Console verification token (content of the google-site-verification meta tag) */
  googleVerification?: string | null;
  /** keep this page out of the index (links are still followed) */
  noindex?: boolean;
}

/** JSON for a <script type="application/ld+json">, safe inside HTML. */
export const jsonLd = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

/** schema.org structured data for a page (a single @graph). */
export function structuredData(page: PageMeta, siteUrl: string): unknown {
  const url = siteUrl + page.path;
  const website = { '@id': `${siteUrl}#website` };
  const person = { '@type': 'Person', '@id': `${siteUrl}#author`, name: AUTHOR, url: 'https://github.com/Yoosseph' };
  const graph: unknown[] = [];
  if (page.path === '') {
    graph.push(
      {
        '@type': 'WebSite',
        ...website,
        name: SITE_NAME,
        url: siteUrl,
        description: page.description,
        inLanguage: 'en',
        publisher: { '@id': person['@id'] },
      },
      {
        '@type': 'WebApplication',
        '@id': `${siteUrl}#app`,
        name: SITE_NAME,
        url: siteUrl,
        description: page.description,
        applicationCategory: 'EducationalApplication',
        applicationSubCategory: 'Dental anatomy',
        operatingSystem: 'Any (modern web browser)',
        browserRequirements: 'Requires JavaScript and WebGL',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        image: siteUrl + OG_IMAGE.path,
        inLanguage: 'en',
        audience: { '@type': 'EducationalAudience', educationalRole: 'student', audienceType: 'Dental students, dental hygiene and assisting students, educators' },
        keywords: 'dental anatomy, tooth anatomy, 3D teeth, tooth numbering, FDI, Universal numbering, Palmer notation, root canals, dental education',
        author: { '@id': person['@id'] },
        sameAs: [REPOSITORY],
      },
      person,
    );
  } else {
    const crumbs: { name: string; url: string }[] = [{ name: SITE_NAME, url: siteUrl }];
    const isAbout = page.path.startsWith('about/');
    if (page.crumbs) crumbs.push(...page.crumbs.map((c) => ({ name: c.name, url: siteUrl + c.path })));
    else if (page.path.startsWith('tooth/')) crumbs.push({ name: 'Teeth', url: `${siteUrl}${ABOUT.path}#teeth` });
    crumbs.push({ name: isAbout ? ABOUT_CRUMB[page.lang ?? 'en'] : (page.about?.name ?? page.title.replace(` — ${SITE_NAME}`, '')), url });
    const fdi = /^tooth\/(\d{2})\/$/.exec(page.path);
    graph.push({
      '@type': isAbout ? 'AboutPage' : page.learning ? ['WebPage', 'LearningResource'] : 'WebPage',
      ...(page.learning ? { learningResourceType: 'Reference', educationalUse: 'Self-study', isAccessibleForFree: true, audience: { '@type': 'EducationalAudience', educationalRole: 'student' } } : {}),
      '@id': url,
      url,
      name: page.title,
      description: page.description,
      inLanguage: page.lang ?? 'en',
      isPartOf: website,
      primaryImageOfPage: siteUrl + OG_IMAGE.path,
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
      },
      ...(page.about
        ? { about: { '@type': 'AnatomicalStructure', name: page.about.name, ...(page.about.alternateName ? { alternateName: page.about.alternateName } : {}) } }
        : fdi
        ? {
            about: {
              '@type': 'AnatomicalStructure',
              name: toothName(Number(fdi[1])),
              alternateName: [`FDI ${fdi[1]}`, `Universal ${fdiToUniversal(Number(fdi[1]))}`, `Palmer ${fdiToPalmer(Number(fdi[1]))}`],
              bodyLocation: 'Mouth',
            },
          }
        : {}),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/**
 * `<head>` tags for one page. URL-based tags (canonical, og:url, og:image,
 * structured data) need an absolute site URL and are left out without one.
 */
export function headTags(page: PageMeta, siteUrl: string | null, opts: HeadOptions = {}): string {
  const tags = [
    `<title>${SITE_NAME}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<meta name="author" content="${AUTHOR}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="${LOCALE[page.lang ?? 'en']}" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta name="twitter:title" content="${esc(page.title)}" />`,
    `<meta name="twitter:description" content="${esc(page.description)}" />`,
  ];
  if (opts.googleVerification) tags.push(`<meta name="google-site-verification" content="${esc(opts.googleVerification)}" />`);
  if (opts.notFound) {
    // SPA fallback for other deep links: served with HTTP 404, so keep it out of the index and don't claim a URL
    tags.push(`<meta name="robots" content="noindex" />`, `<meta name="twitter:card" content="summary" />`);
  } else if (siteUrl) {
    const url = siteUrl + page.path;
    tags.push(
      `<meta name="robots" content="${opts.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large'}" />`,
      `<link rel="canonical" href="${esc(url)}" />`,
      `<meta property="og:url" content="${esc(url)}" />`,
      ...Object.entries(opts.noindex ? {} : (page.alternates ?? {})).map(([l, p]) => `<link rel="alternate" hreflang="${l}" href="${esc(siteUrl + p)}" />`),
      ...(!opts.noindex && page.alternates?.en ? [`<link rel="alternate" hreflang="x-default" href="${esc(siteUrl + page.alternates.en)}" />`] : []),
      `<meta property="og:image" content="${esc(siteUrl + OG_IMAGE.path)}" />`,
      `<meta property="og:image:width" content="${OG_IMAGE.width}" />`,
      `<meta property="og:image:height" content="${OG_IMAGE.height}" />`,
      `<meta property="og:image:alt" content="${esc(OG_IMAGE.alt)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:image" content="${esc(siteUrl + OG_IMAGE.path)}" />`,
      jsonLd(structuredData(page, siteUrl)),
    );
  } else {
    tags.push(`<meta name="twitter:card" content="summary" />`);
  }
  return tags.join('\n    ');
}

export function robotsTxt(siteUrl: string | null, preview = false): string {
  // preview deployments must never be indexed
  if (preview) return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\n${siteUrl ? `\nSitemap: ${siteUrl}sitemap.xml\n` : ''}`;
}

/** A sitemap entry: a path, or a path with its language versions (written as xhtml:link hreflang). */
export type SitemapEntry = string | { path: string; alternates?: Partial<Record<Lang, string>> };

export function sitemapXml(siteUrl: string, entries: SitemapEntry[], lastmod?: string): string {
  const mod = lastmod ? `<lastmod>${lastmod}</lastmod>` : '';
  const urls = entries
    .map((entry) => {
      const { path, alternates } = typeof entry === 'string' ? { path: entry, alternates: undefined } : entry;
      const alt = Object.entries(alternates ?? {});
      const links = alt.length > 1
        ? [...alt, ...(alternates?.en ? [['x-default', alternates.en]] : [])].map(([l, p]) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(siteUrl + p)}"/>`).join('')
        : '';
      return `  <url><loc>${esc(siteUrl + path)}</loc>${mod}${links}</url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}
