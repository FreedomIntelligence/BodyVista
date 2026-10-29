/** Shared content and metadata for the credits popup and its deep links. */
import { LANGS, type Lang } from '../i18n/lang.ts';
import { SITE_NAME, type PageMeta } from './seo.ts';

interface CreditsText {
  title: string;
  description: string;
  creator: string;
  engineers: string;
  dental: string;
  dentalIntro: string;
  thanksTitle: string;
  thanks: string;
}

export const CREDITS_TEXT: Record<Lang, CreditsText> = {
  en: {
    title: 'Credits', description: 'Credits and contributors to Dental Scope.',
    creator: 'Repository creator and maintainer', engineers: 'Engineering contributors',
    dental: 'Dental contributors', dentalIntro: 'Dentists, dental students and practitioners.',
    thanksTitle: 'With thanks',
    thanks: 'Thank you to all the other dental practitioners who contributed and chose to remain anonymous or preferred not to have their names listed. Your support and feedback are greatly appreciated.',
  },
  sv: {
    title: 'Medverkande', description: 'Medverkande och bidragsgivare till Dental Scope.',
    creator: 'Kodarkivets skapare och förvaltare', engineers: 'Tekniska medverkande',
    dental: 'Odontologiska medverkande', dentalIntro: 'Tandläkare, tandläkarstudenter och yrkesverksamma inom tandvården.',
    thanksTitle: 'Stort tack',
    thanks: 'Tack till alla andra yrkesverksamma inom tandvården som har bidragit och valt att vara anonyma eller föredragit att inte få sina namn publicerade. Vi uppskattar verkligen ert stöd och era synpunkter.',
  },
  de: {
    title: 'Mitwirkende', description: 'Mitwirkende und Beitragende zu Dental Scope.',
    creator: 'Ersteller und Maintainer des Repositorys', engineers: 'Technische Mitwirkende',
    dental: 'Zahnmedizinische Mitwirkende', dentalIntro: 'Zahnärzte, Zahnmedizinstudierende und Fachkräfte aus der zahnmedizinischen Praxis.',
    thanksTitle: 'Vielen Dank',
    thanks: 'Vielen Dank an alle weiteren Fachkräfte aus der zahnmedizinischen Praxis, die beigetragen haben und anonym bleiben oder ihre Namen nicht veröffentlichen lassen möchten. Wir schätzen eure Unterstützung und Rückmeldungen sehr.',
  },
  es: {
    title: 'Créditos', description: 'Créditos y colaboradores de Dental Scope.',
    creator: 'Creador y responsable del mantenimiento del repositorio', engineers: 'Colaboradores de ingeniería',
    dental: 'Colaboradores de odontología', dentalIntro: 'Dentistas, estudiantes de odontología y profesionales del sector dental.',
    thanksTitle: 'Agradecimientos',
    thanks: 'Gracias a todos los demás profesionales del sector dental que han colaborado y han elegido permanecer en el anonimato o han preferido que no se publiquen sus nombres. Apreciamos mucho su apoyo y sus comentarios.',
  },
  la: {
    title: 'Collaboratores', description: 'Auctores et collaboratores operis Dental Scope.',
    creator: 'Conditor et curator repositorii', engineers: 'Collaboratores technici',
    dental: 'Collaboratores odontologici', dentalIntro: 'Odontologi, studentes odontologiae et alii in cura dentium versati.',
    thanksTitle: 'Gratias agimus',
    thanks: 'Gratias agimus omnibus aliis in cura dentium versatis qui operi contulerunt et anonymi manere vel nomina sua publicari noluerunt. Auxilium et consilia vestra magni aestimamus.',
  },
};

export interface Contributor {
  name: string;
  linkedin: string;
  github?: string;
}

export const CREATOR: Contributor[] = [{
  name: 'Yoseph Naoom',
  linkedin: 'https://www.linkedin.com/in/yoseph-naoom/',
  github: 'https://github.com/Yoosseph',
}];
export const ENGINEERS: Contributor[] = [{
  name: 'Oliver Fiala',
  linkedin: 'https://www.linkedin.com/in/oliver-fiala-979b27245/',
  github: 'https://github.com/Zwee42',
}];
export const DENTAL: Contributor[] = [
  { name: 'Roy Namo', linkedin: 'https://www.linkedin.com/in/roy-namo-3b3071207/', github: 'https://github.com/roynamo' },
  { name: 'Ghanem Al-Sabaawi', linkedin: 'https://www.linkedin.com/in/ghanem-al-sabaawi-4647372a3/' },
  { name: 'Dunya Omar', linkedin: 'https://www.linkedin.com/in/dunya-omar-9854552b6/' },
  { name: 'Amne Tamimi', linkedin: 'https://www.linkedin.com/in/amne-tamimi-89b284281/' },
  { name: 'Merna Marcus', linkedin: 'https://www.linkedin.com/in/merna-marcus/' },
];

export const creditsPath = (lang: Lang) => lang === 'en' ? 'credits/' : `credits/${lang}/`;
const alternates = Object.fromEntries(LANGS.map((lang) => [lang, creditsPath(lang)]));

export const CREDITS_PAGES: PageMeta[] = LANGS.map((lang) => ({
  path: creditsPath(lang),
  title: `${CREDITS_TEXT[lang].title} — ${SITE_NAME}`,
  description: CREDITS_TEXT[lang].description,
  lang,
  alternates,
}));
