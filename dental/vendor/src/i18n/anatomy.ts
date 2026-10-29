/**
 * Anatomical names in every interface language. The registry stores each
 * structure's name per language (Structure.names) using these tables; the
 * English names stay the reference (Structure.name).
 *
 * Swedish, German and Spanish follow the terms used in dental education in each
 * country: native terms where they are standard (Överkäke / Oberkiefer / Maxilar,
 * Emalj / Zahnschmelz / Esmalte), Latin (Terminologia Anatomica) for nerves,
 * vessels and muscles in Swedish and German, and the Spanish forms of the
 * anatomical nomenclature in Spanish. Latin uses Terminologia Anatomica (and
 * Terminologia Dentalis-style terms for the tooth tissues) throughout.
 * Imported by the build (about page), so imports carry their .ts extension.
 */
import type { Arch, Side, ToothType } from '../anatomy/types.ts';
import type { Lang } from './lang.ts';
import { PARANASAL_NAMES } from '../anatomy/paranasal.ts';
import { FEEDBACK_NAMES } from './feedbackNames.ts';

export type Names = Record<Lang, string>;
/** A name in every language but English (English comes from the structure definition). */
type Tr = Record<Exclude<Lang, 'en'>, string>;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------------ teeth */

export const TYPE_NAMES: Record<Lang, Record<ToothType, string>> = {
  en: {
    'central-incisor': 'central incisor',
    'lateral-incisor': 'lateral incisor',
    canine: 'canine',
    'first-premolar': 'first premolar',
    'second-premolar': 'second premolar',
    'first-molar': 'first molar',
    'second-molar': 'second molar',
    'third-molar': 'third molar',
  },
  sv: {
    'central-incisor': 'central incisiv',
    'lateral-incisor': 'lateral incisiv',
    canine: 'hörntand',
    'first-premolar': 'första premolar',
    'second-premolar': 'andra premolar',
    'first-molar': 'första molar',
    'second-molar': 'andra molar',
    'third-molar': 'tredje molar',
  },
  de: {
    'central-incisor': 'Mittlerer Schneidezahn',
    'lateral-incisor': 'Seitlicher Schneidezahn',
    canine: 'Eckzahn',
    'first-premolar': 'Erster Prämolar',
    'second-premolar': 'Zweiter Prämolar',
    'first-molar': 'Erster Molar',
    'second-molar': 'Zweiter Molar',
    'third-molar': 'Dritter Molar',
  },
  es: {
    'central-incisor': 'incisivo central',
    'lateral-incisor': 'incisivo lateral',
    canine: 'canino',
    'first-premolar': 'primer premolar',
    'second-premolar': 'segundo premolar',
    'first-molar': 'primer molar',
    'second-molar': 'segundo molar',
    'third-molar': 'tercer molar',
  },
  la: {
    'central-incisor': 'dens incisivus medialis',
    'lateral-incisor': 'dens incisivus lateralis',
    canine: 'dens caninus',
    'first-premolar': 'dens premolaris primus',
    'second-premolar': 'dens premolaris secundus',
    'first-molar': 'dens molaris primus',
    'second-molar': 'dens molaris secundus',
    'third-molar': 'dens molaris tertius',
  },
};

/** Plural headings for the tooth types ("Central incisors"). */
export const TYPE_PLURALS: Record<Lang, Record<ToothType, string>> = {
  en: {
    'central-incisor': 'Central incisors',
    'lateral-incisor': 'Lateral incisors',
    canine: 'Canines',
    'first-premolar': 'First premolars',
    'second-premolar': 'Second premolars',
    'first-molar': 'First molars',
    'second-molar': 'Second molars',
    'third-molar': 'Third molars',
  },
  sv: {
    'central-incisor': 'Centrala incisiver',
    'lateral-incisor': 'Laterala incisiver',
    canine: 'Hörntänder',
    'first-premolar': 'Första premolarer',
    'second-premolar': 'Andra premolarer',
    'first-molar': 'Första molarer',
    'second-molar': 'Andra molarer',
    'third-molar': 'Tredje molarer',
  },
  de: {
    'central-incisor': 'Mittlere Schneidezähne',
    'lateral-incisor': 'Seitliche Schneidezähne',
    canine: 'Eckzähne',
    'first-premolar': 'Erste Prämolaren',
    'second-premolar': 'Zweite Prämolaren',
    'first-molar': 'Erste Molaren',
    'second-molar': 'Zweite Molaren',
    'third-molar': 'Dritte Molaren',
  },
  es: {
    'central-incisor': 'Incisivos centrales',
    'lateral-incisor': 'Incisivos laterales',
    canine: 'Caninos',
    'first-premolar': 'Primeros premolares',
    'second-premolar': 'Segundos premolares',
    'first-molar': 'Primeros molares',
    'second-molar': 'Segundos molares',
    'third-molar': 'Terceros molares',
  },
  la: {
    'central-incisor': 'Dentes incisivi mediales',
    'lateral-incisor': 'Dentes incisivi laterales',
    canine: 'Dentes canini',
    'first-premolar': 'Dentes premolares primi',
    'second-premolar': 'Dentes premolares secundi',
    'first-molar': 'Dentes molares primi',
    'second-molar': 'Dentes molares secundi',
    'third-molar': 'Dentes molares tertii',
  },
};

/** Tooth type alone, capitalised ("First molar", "Första molar", "Erster Molar"). */
export function typeLabel(type: ToothType, lang: Lang): string {
  return cap(TYPE_NAMES[lang][type]);
}

/** Latin and Spanish use superior / inferior for the arches. */
const LA_ARCH: Record<Arch, string> = { maxillary: 'superior', mandibular: 'inferior' };
const ES_ARCH: Record<Arch, string> = { maxillary: 'superior', mandibular: 'inferior' };
const LA_SIDE: Record<Side, string> = { right: 'dexter', left: 'sinister' };
const ES_SIDE: Record<Side, string> = { right: 'derecho', left: 'izquierdo' };

/** Tooth type in one arch, no side ("Maxillary first molar"). */
export function archTypeName(type: ToothType, arch: Arch, lang: Lang): string {
  const t = TYPE_NAMES[lang][type];
  if (lang === 'sv') return cap(`${t} i ${arch === 'maxillary' ? 'överkäken' : 'underkäken'}`);
  if (lang === 'de') return `${t} im ${arch === 'maxillary' ? 'Oberkiefer' : 'Unterkiefer'}`;
  if (lang === 'es') return cap(`${t} ${ES_ARCH[arch]}`);
  if (lang === 'la') return cap(`${t} ${LA_ARCH[arch]}`);
  return cap(`${arch} ${t}`);
}

/** Full tooth name ("Mandibular left first molar"). */
export function toothNameIn(type: ToothType, arch: Arch, side: Side, lang: Lang): string {
  const t = TYPE_NAMES[lang][type];
  if (lang === 'sv') return `${side === 'right' ? 'Höger' : 'Vänster'} ${t} i ${arch === 'maxillary' ? 'överkäken' : 'underkäken'}`;
  if (lang === 'de') return `${t} im ${arch === 'maxillary' ? 'Oberkiefer' : 'Unterkiefer'} ${side === 'right' ? 'rechts' : 'links'}`;
  if (lang === 'es') return cap(`${t} ${ES_ARCH[arch]} ${ES_SIDE[side]}`);
  if (lang === 'la') return cap(`${t} ${LA_ARCH[arch]} ${LA_SIDE[side]}`);
  return cap(`${arch} ${side} ${t}`);
}

/** Everyday search terms for a tooth in the other languages (the English ones are in notation.ts). */
export function toothSearchAliases(type: ToothType, arch: Arch, fdi: number): string[] {
  const up = arch === 'maxillary';
  const sv = TYPE_NAMES.sv[type];
  const de = TYPE_NAMES.de[type];
  const es = TYPE_NAMES.es[type];
  const la = TYPE_NAMES.la[type];
  const out = [
    `${sv} i ${up ? 'överkäken' : 'underkäken'}`,
    `${up ? 'övre' : 'nedre'} ${sv}`,
    sv,
    `tand ${fdi}`,
    `${de} im ${up ? 'Oberkiefer' : 'Unterkiefer'}`,
    `${up ? 'oberer' : 'unterer'} ${de}`,
    de,
    `zahn ${fdi}`,
    `${es} ${up ? 'superior' : 'inferior'}`,
    `${es} ${up ? 'maxilar' : 'mandibular'}`,
    es,
    `diente ${fdi}`,
    `pieza ${fdi}`,
    `${la} ${up ? 'superior' : 'inferior'}`,
    `${la} ${up ? 'maxillaris' : 'mandibularis'}`,
    la,
    `dens ${fdi}`,
  ];
  const extra: Partial<Record<ToothType, string[]>> = {
    'central-incisor': ['framtand', 'mittre framtand', 'incisiv', 'Frontzahn', 'Schneidezahn', 'Inzisivus', 'incisivo', 'diente de delante', 'paleta', 'dens incisivus'],
    'lateral-incisor': ['framtand', 'incisiv', 'Frontzahn', 'Schneidezahn', 'Inzisivus', 'incisivo', 'dens incisivus'],
    canine: ['kanin', 'hörntand', 'Caninus', 'Eckzahn', 'colmillo', 'canino', 'dens caninus'],
    'first-premolar': ['premolar', 'kindtand', 'Prämolar', 'vorderer Backenzahn', 'premolar', 'bicúspide', 'dens premolaris'],
    'second-premolar': ['premolar', 'kindtand', 'Prämolar', 'vorderer Backenzahn', 'premolar', 'bicúspide', 'dens premolaris'],
    'first-molar': ['sexårsmolar', 'molar', 'kindtand', 'Sechsjahrmolar', 'Molar', 'Backenzahn', 'Mahlzahn', 'muela', 'molar de los seis años', 'dens molaris'],
    'second-molar': ['tolvårsmolar', 'molar', 'kindtand', 'Zwölfjahrmolar', 'Molar', 'Backenzahn', 'Mahlzahn', 'muela', 'molar de los doce años', 'dens molaris'],
    'third-molar': ['visdomstand', 'visdomständer', 'molar', 'Weisheitszahn', 'Weisheitszähne', 'Molar', 'muela del juicio', 'cordal', 'dens serotinus', 'dens sapientiae'],
  };
  return [...out, ...(extra[type] ?? [])];
}

/* ------------------------------------------------------------------ tooth parts */

export type PartKey =
  | 'crown'
  | 'root'
  | 'roots'
  | 'enamel'
  | 'dentin'
  | 'dentin-coronal'
  | 'dentin-radicular'
  | 'cementum'
  | 'pulp'
  | 'pulp-chamber'
  | 'pdl'
  | 'root-canal'
  | 'root-canals'
  | 'cej'
  | 'apex';

export const PART_NAMES: Record<Lang, Record<PartKey, string>> = {
  en: {
    crown: 'Crown',
    root: 'Root',
    roots: 'Roots',
    enamel: 'Enamel',
    dentin: 'Dentin',
    'dentin-coronal': 'Coronal dentin',
    'dentin-radicular': 'Radicular dentin',
    cementum: 'Cementum',
    pulp: 'Dental pulp',
    'pulp-chamber': 'Pulp chamber',
    pdl: 'Periodontal ligament',
    'root-canal': 'Root canal',
    'root-canals': 'Root canals',
    cej: 'Cementoenamel junction',
    apex: 'Root apex',
  },
  sv: {
    crown: 'Krona',
    root: 'Rot',
    roots: 'Rötter',
    enamel: 'Emalj',
    dentin: 'Dentin',
    'dentin-coronal': 'Koronalt dentin',
    'dentin-radicular': 'Radikulärt dentin',
    cementum: 'Rotcement',
    pulp: 'Pulpa',
    'pulp-chamber': 'Pulpakammare',
    pdl: 'Parodontalligament',
    'root-canal': 'Rotkanal',
    'root-canals': 'Rotkanaler',
    cej: 'Emalj-cementgränsen',
    apex: 'Rotspets',
  },
  de: {
    crown: 'Krone',
    root: 'Wurzel',
    roots: 'Wurzeln',
    enamel: 'Zahnschmelz',
    dentin: 'Dentin',
    'dentin-coronal': 'Koronales Dentin',
    'dentin-radicular': 'Radikuläres Dentin',
    cementum: 'Wurzelzement',
    pulp: 'Zahnpulpa',
    'pulp-chamber': 'Pulpakammer',
    pdl: 'Desmodont',
    'root-canal': 'Wurzelkanal',
    'root-canals': 'Wurzelkanäle',
    cej: 'Schmelz-Zement-Grenze',
    apex: 'Wurzelspitze',
  },
  es: {
    crown: 'Corona',
    root: 'Raíz',
    roots: 'Raíces',
    enamel: 'Esmalte',
    dentin: 'Dentina',
    'dentin-coronal': 'Dentina coronal',
    'dentin-radicular': 'Dentina radicular',
    cementum: 'Cemento',
    pulp: 'Pulpa dental',
    'pulp-chamber': 'Cámara pulpar',
    pdl: 'Ligamento periodontal',
    'root-canal': 'Conducto radicular',
    'root-canals': 'Conductos radiculares',
    cej: 'Unión amelocementaria',
    apex: 'Ápice radicular',
  },
  la: {
    crown: 'Corona dentis',
    root: 'Radix dentis',
    roots: 'Radices dentis',
    enamel: 'Enamelum',
    dentin: 'Dentinum',
    'dentin-coronal': 'Dentinum coronale',
    'dentin-radicular': 'Dentinum radiculare',
    cementum: 'Cementum',
    pulp: 'Pulpa dentis',
    'pulp-chamber': 'Cavitas coronae',
    pdl: 'Ligamentum periodontale',
    'root-canal': 'Canalis radicis dentis',
    'root-canals': 'Canales radicis dentis',
    cej: 'Linea cervicalis',
    apex: 'Apex radicis dentis',
  },
};

const allLangs = (f: (l: Lang) => string): Names => ({ en: f('en'), sv: f('sv'), de: f('de'), es: f('es'), la: f('la') });

export const partNames = (k: PartKey): Names => allLangs((l) => PART_NAMES[l][k]);

/** Short 3D-label names of tooth parts. */
export const PART_SHORT: Record<Lang, Record<'pdl' | 'cej' | 'apex' | 'apical-foramen' | 'pulp-horn' | 'canal', string>> = {
  en: { pdl: 'PDL', cej: 'CEJ', apex: 'Apex', 'apical-foramen': 'Apical foramen', 'pulp-horn': 'Pulp horn', canal: 'Canal' },
  sv: { pdl: 'PDL', cej: 'ECG', apex: 'Apex', 'apical-foramen': 'Foramen apicale', 'pulp-horn': 'Pulpahorn', canal: 'Kanal' },
  de: { pdl: 'Desmodont', cej: 'SZG', apex: 'Apex', 'apical-foramen': 'Foramen apicale', 'pulp-horn': 'Pulpahorn', canal: 'Kanal' },
  es: { pdl: 'LPD', cej: 'UAC', apex: 'Ápice', 'apical-foramen': 'Foramen apical', 'pulp-horn': 'Cuerno pulpar', canal: 'Conducto' },
  la: { pdl: 'Lig. periodont.', cej: 'Linea cerv.', apex: 'Apex', 'apical-foramen': 'Foramen apicis', 'pulp-horn': 'Cornu pulpae', canal: 'Canalis' },
};
export const partShort = (k: keyof (typeof PART_SHORT)['en']): Names => allLangs((l) => PART_SHORT[l][k]);

export const pulpHornNames = (n: string): Names => ({ en: `Pulp horn ${n}`, sv: `Pulpahorn ${n}`, de: `Pulpahorn ${n}`, es: `Cuerno pulpar ${n}`, la: `Cornu pulpae ${n}` });
export const apicalForamenNames = (abbr: Names): Names => ({
  en: `Apical foramen (${abbr.en})`,
  sv: `Foramen apicale (${abbr.sv})`,
  de: `Foramen apicale (${abbr.de})`,
  es: `Foramen apical (${abbr.es})`,
  la: `Foramen apicis dentis (${abbr.la})`,
});

/** Search terms for tooth parts in the other languages, by part. */
export const PART_ALIASES: Record<string, string[]> = {
  crown: ['krona', 'tandkrona', 'Krone', 'Zahnkrone', 'corona', 'corona dental', 'corona dentis'],
  root: ['rot', 'rötter', 'tandrot', 'Wurzel', 'Wurzeln', 'Zahnwurzel', 'raíz', 'raíces', 'radix', 'radix dentis', 'radices'],
  enamel: ['emalj', 'tandemalj', 'Schmelz', 'Zahnschmelz', 'esmalte', 'esmalte dental', 'enamelum'],
  dentin: ['dentin', 'Dentin', 'Zahnbein', 'dentina', 'dentinum'],
  cementum: ['cement', 'rotcement', 'Zement', 'Wurzelzement', 'cemento', 'cemento radicular', 'cementum'],
  pulp: ['pulpa', 'tandpulpa', 'tandnerv', 'nerven i tanden', 'Pulpa', 'Zahnpulpa', 'Zahnmark', 'Zahnnerv', 'pulpa dental', 'nervio del diente', 'pulpa dentis'],
  'pulp-chamber': ['pulpakammare', 'Pulpakammer', 'Pulpenkavum', 'cámara pulpar', 'cavitas coronae', 'cavitas dentis'],
  pdl: ['rothinna', 'parodontalligament', 'Desmodont', 'Wurzelhaut', 'parodontales Ligament', 'ligamento periodontal', 'periodonto', 'ligamentum periodontale', 'desmodontium'],
  'root-canals': ['rotkanal', 'rotkanaler', 'kanal', 'Wurzelkanal', 'Wurzelkanäle', 'Kanal', 'conducto', 'conductos', 'conducto radicular', 'endodoncia', 'canalis radicis dentis', 'canales'],
  canal: ['rotkanal', 'kanal', 'Wurzelkanal', 'Kanal', 'conducto', 'conducto radicular', 'canalis', 'canalis radicis dentis'],
  'apical-foramen': ['foramen apicale', 'rotspets', 'Foramen apicale', 'Wurzelspitze', 'foramen apical', 'ápice', 'foramen apicis dentis'],
  'pulp-horn': ['pulpahorn', 'Pulpahorn', 'cuerno pulpar', 'cornu pulpae'],
  cej: ['ECG', 'emalj-cementgräns', 'emalj-cementgränsen', 'tandhals', 'SZG', 'Schmelz-Zement-Grenze', 'Zahnhals', 'UAC', 'unión amelocementaria', 'cuello del diente', 'línea cervical', 'linea cervicalis', 'cervix dentis'],
  apex: ['apex', 'rotspets', 'Apex', 'Wurzelspitze', 'ápice', 'ápice radicular', 'apex radicis dentis'],
};

/* ------------------------------------------------------------------ root canals */

/** Root position words: Swedish, German (feminine, for "Wurzel"), Spanish (masculine) and Latin. */
const ROOT_WORD: Record<string, Tr> = {
  mesial: { sv: 'Mesial', de: 'Mesiale', es: 'mesial', la: 'mesialis' },
  distal: { sv: 'Distal', de: 'Distale', es: 'distal', la: 'distalis' },
  buccal: { sv: 'Buckal', de: 'Bukkale', es: 'vestibular', la: 'buccalis' },
  palatal: { sv: 'Palatinal', de: 'Palatinale', es: 'palatino', la: 'palatinalis' },
  lingual: { sv: 'Lingual', de: 'Linguale', es: 'lingual', la: 'lingualis' },
  mesiobuccal: { sv: 'Mesiobuckal', de: 'Mesiobukkale', es: 'mesiovestibular', la: 'mesiobuccalis' },
  distobuccal: { sv: 'Distobuckal', de: 'Distobukkale', es: 'distovestibular', la: 'distobuccalis' },
};

/** Spanish adjective for a feminine noun (la raíz): "palatino" → "palatina". */
const esFem = (adj: string) => adj.replace(/o$/, 'a');

/** Root names by root label ("Mesial root"). */
export function rootNames(label: string): Names | undefined {
  if (label === 'single') return partNames('root');
  const w = ROOT_WORD[label];
  if (!w) return undefined;
  return { en: `${cap(label)} root`, sv: `${w.sv} rot`, de: `${w.de} Wurzel`, es: `Raíz ${esFem(w.es)}`, la: `Radix ${w.la}` };
}

/** German adjective ending for a masculine noun (der Kanal): "Mesiale" → "Mesialer". */
const deMasc = (adj: string) => adj.replace(/e$/, 'er');

/** Spanish clinicians write vestibular (V) where English writes buccal (B): MB → MV, DB → DV. */
const esAbbr = (abbr: string) => abbr.replace(/B/g, 'V');

/**
 * Name and abbreviation of a root canal, given its root, the number of canals in that root,
 * its index (buccal first) and the arch.
 */
export function canalNames(root: string, n: number, i: number, arch: Arch): { names: Names; abbr: Names } {
  const abbrs = (a: string): Names => ({ en: a, sv: a, de: a, es: esAbbr(a), la: a });
  const canal = (en: string, sv: string, de: string, es: string, la: string, abbr: string) => ({ names: { en, sv, de, es, la }, abbr: abbrs(abbr) });
  if (root === 'single') return { names: partNames('root-canal'), abbr: partShort('canal') };
  if (n === 1) {
    const w = ROOT_WORD[root];
    const abbr = { mesial: 'M', distal: 'D', buccal: 'B', palatal: 'P', lingual: 'L', mesiobuccal: 'MB', distobuccal: 'DB' }[root] ?? root;
    if (!w) return canal(`${root} canal`, `${root} kanal`, `${root} Kanal`, `Conducto ${root}`, `Canalis ${root}`, abbr);
    return canal(`${cap(root)} canal`, `${w.sv} kanal`, `${deMasc(w.de)} Kanal`, `Conducto ${w.es}`, `Canalis ${w.la}`, abbr);
  }
  if (root === 'mesiobuccal')
    return i === 0
      ? canal('Mesiobuccal canal (MB1)', 'Mesiobuckal kanal (MB1)', 'Mesiobukkaler Kanal (MB1)', 'Conducto mesiovestibular (MV1)', 'Canalis mesiobuccalis (MB1)', 'MB1')
      : canal('Second mesiobuccal canal (MB2)', 'Andra mesiobuckala kanalen (MB2)', 'Zweiter mesiobukkaler Kanal (MB2)', 'Segundo conducto mesiovestibular (MV2)', 'Canalis mesiobuccalis secundus (MB2)', 'MB2');
  if (root === 'mesial')
    return i === 0
      ? canal('Mesiobuccal canal', 'Mesiobuckal kanal', 'Mesiobukkaler Kanal', 'Conducto mesiovestibular', 'Canalis mesiobuccalis', 'MB')
      : canal('Mesiolingual canal', 'Mesiolingual kanal', 'Mesiolingualer Kanal', 'Conducto mesiolingual', 'Canalis mesiolingualis', 'ML');
  if (root === 'distal')
    return i === 0
      ? canal('Distobuccal canal', 'Distobuckal kanal', 'Distobukkaler Kanal', 'Conducto distovestibular', 'Canalis distobuccalis', 'DB')
      : canal('Distolingual canal', 'Distolingual kanal', 'Distolingualer Kanal', 'Conducto distolingual', 'Canalis distolingualis', 'DL');
  if (i === 0) return canal('Buccal canal', 'Buckal kanal', 'Bukkaler Kanal', 'Conducto vestibular', 'Canalis buccalis', 'B');
  return arch === 'maxillary'
    ? canal('Palatal canal', 'Palatinal kanal', 'Palatinaler Kanal', 'Conducto palatino', 'Canalis palatinalis', 'P')
    : canal('Lingual canal', 'Lingual kanal', 'Lingualer Kanal', 'Conducto lingual', 'Canalis lingualis', 'L');
}

/* ------------------------------------------------------------------ other structures */

/** Names by exact structure id. */
const EXACT: Record<string, Tr> = {
  ...PARANASAL_NAMES,
  'trigeminal-nerves': { sv: 'Trigeminusnerver (V)', de: 'Trigeminusnerven (V)', es: 'Nervios trigéminos (V)', la: 'Nervi trigemini (V)' },
  'facial-nerves': { sv: 'Facialisnerver (VII)', de: 'Gesichtsnerven (VII)', es: 'Nervios faciales (VII)', la: 'Nervi faciales (VII)' },
  'lower-cranial-nerves': { sv: 'Kranialnerver IX, X och XII', de: 'Hirnnerven IX, X und XII', es: 'Nervios craneales IX, X y XII', la: 'Nervi craniales IX, X et XII' },
  'dental-anatomy': { sv: 'Tandanatomi', de: 'Zahnanatomie' , es: 'Anatomía dental', la: 'Anatomia dentalis' },
  maxilla: { sv: 'Överkäke', de: 'Oberkiefer' , es: 'Maxilar', la: 'Maxillae' },
  'maxillary-alveolar-process': { sv: 'Överkäkens alveolarutskott', de: 'Alveolarfortsatz des Oberkiefers' , es: 'Apófisis alveolar del maxilar', la: 'Processus alveolaris maxillae' },
  'maxillary-sinus': { sv: 'Bihålor i överkäken', de: 'Kieferhöhlen', es: 'Senos maxilares', la: 'Sinus maxillares' },
  'maxillary-dentition': { sv: 'Överkäkens tandbåge', de: 'Oberer Zahnbogen' , es: 'Arcada dentaria superior', la: 'Arcus dentalis superior' },
  'upper-right-quadrant': { sv: 'Övre högra kvadranten', de: 'Oberer rechter Quadrant' , es: 'Cuadrante superior derecho', la: 'Quadrans superior dexter' },
  'upper-left-quadrant': { sv: 'Övre vänstra kvadranten', de: 'Oberer linker Quadrant' , es: 'Cuadrante superior izquierdo', la: 'Quadrans superior sinister' },
  'lower-left-quadrant': { sv: 'Nedre vänstra kvadranten', de: 'Unterer linker Quadrant' , es: 'Cuadrante inferior izquierdo', la: 'Quadrans inferior sinister' },
  'lower-right-quadrant': { sv: 'Nedre högra kvadranten', de: 'Unterer rechter Quadrant' , es: 'Cuadrante inferior derecho', la: 'Quadrans inferior dexter' },
  mandible: { sv: 'Underkäke', de: 'Unterkiefer' , es: 'Mandíbula', la: 'Mandibula' },
  'mandible-body': { sv: 'Underkäkens kropp och grenar', de: 'Unterkieferkörper und Unterkieferäste' , es: 'Cuerpo y ramas de la mandíbula', la: 'Corpus et rami mandibulae' },
  'mandibular-alveolar-process': { sv: 'Underkäkens alveolarutskott', de: 'Alveolarfortsatz des Unterkiefers' , es: 'Porción alveolar de la mandíbula', la: 'Pars alveolaris mandibulae' },
  'mandibular-dentition': { sv: 'Underkäkens tandbåge', de: 'Unterer Zahnbogen' , es: 'Arcada dentaria inferior', la: 'Arcus dentalis inferior' },
  periodontium: { sv: 'Parodontium', de: 'Parodontium' , es: 'Periodonto', la: 'Periodontium' },
  gingiva: { sv: 'Gingiva', de: 'Gingiva' , es: 'Encía', la: 'Gingiva' },
  'gingiva-upper': { sv: 'Gingiva i överkäken', de: 'Gingiva des Oberkiefers' , es: 'Encía superior', la: 'Gingiva maxillaris' },
  'gingiva-lower': { sv: 'Gingiva i underkäken', de: 'Gingiva des Unterkiefers' , es: 'Encía inferior', la: 'Gingiva mandibularis' },
  neurovascular: { sv: 'Nerver och kärl', de: 'Nerven und Gefäße' , es: 'Nervios y vasos', la: 'Nervi et vasa' },
  nerves: { sv: 'Nerver', de: 'Nerven' , es: 'Nervios', la: 'Nervi' },
  'mandibular-nerve-branches': { sv: 'Grenar av n. mandibularis (V3)', de: 'Äste des N. mandibularis (V3)' , es: 'Ramas del nervio mandibular (V3)', la: 'Rami nervi mandibularis (V3)' },
  'maxillary-nerve-branches': { sv: 'Grenar av n. maxillaris (V2)', de: 'Äste des N. maxillaris (V2)' , es: 'Ramas del nervio maxilar (V2)', la: 'Rami nervi maxillaris (V2)' },
  vessels: { sv: 'Blodkärl', de: 'Blutgefäße' , es: 'Vasos sanguíneos', la: 'Vasa sanguinea' },
  'arterial-supply': { sv: 'Artärer', de: 'Arterien' , es: 'Arterias', la: 'Arteriae' },
  'venous-drainage': { sv: 'Vener', de: 'Venen' , es: 'Venas', la: 'Venae' },
  tmj: { sv: 'Käklederna', de: 'Kiefergelenke' , es: 'Articulaciones temporomandibulares', la: 'Articulationes temporomandibulares' },
  skull: { sv: 'Skalle (kontext)', de: 'Schädel (Kontext)' , es: 'Cráneo (contexto)', la: 'Cranium (contextus)' },
  'frontal-bone': { sv: 'Pannben', de: 'Stirnbein' , es: 'Hueso frontal', la: 'Os frontale' },
  'occipital-bone': { sv: 'Nackben', de: 'Hinterhauptsbein' , es: 'Hueso occipital', la: 'Os occipitale' },
  'sphenoid-bone': { sv: 'Kilben', de: 'Keilbein' , es: 'Hueso esfenoides', la: 'Os sphenoidale' },
  'ethmoid-bone': { sv: 'Silben', de: 'Siebbein' , es: 'Hueso etmoides', la: 'Os ethmoidale' },
  vomer: { sv: 'Plogben', de: 'Pflugscharbein' , es: 'Vómer', la: 'Vomer' },
  'hyoid-bone': { sv: 'Tungben', de: 'Zungenbein' , es: 'Hueso hioides', la: 'Os hyoideum' },
  muscles: { sv: 'Tuggmuskler och muskler runt munnen', de: 'Kaumuskeln und Muskeln um den Mund' , es: 'Músculos de la masticación y peribucales', la: 'Musculi masticatorii et musculi circum os' },
  'orbicularis-oris': { sv: 'Musculus orbicularis oris', de: 'Musculus orbicularis oris' , es: 'Músculo orbicular de la boca', la: 'Musculus orbicularis oris' },
};

/** Names of paired structures by base id (the id without -right / -left); the side follows in brackets. */
const SIDED: Record<string, Tr> = {
  ...FEEDBACK_NAMES,
  ...PARANASAL_NAMES,
  maxilla: { sv: 'Maxilla', de: 'Maxilla' , es: 'Maxilar', la: 'Maxilla' },
  'maxillary-alveolar-process': { sv: 'Överkäkens alveolarutskott', de: 'Alveolarfortsatz des Oberkiefers' , es: 'Apófisis alveolar del maxilar', la: 'Processus alveolaris maxillae' },
  'maxillary-sinus': { sv: 'Bihåla i överkäken (sinus maxillaris)', de: 'Kieferhöhle', es: 'Seno maxilar', la: 'Sinus maxillaris' },
  'mandibular-condyle': { sv: 'Underkäkens ledhuvud', de: 'Unterkieferköpfchen' , es: 'Cóndilo mandibular', la: 'Caput mandibulae' },
  'mandibular-foramen': { sv: 'Foramen mandibulae', de: 'Foramen mandibulae' , es: 'Agujero mandibular', la: 'Foramen mandibulae' },
  'mental-foramen': { sv: 'Foramen mentale', de: 'Foramen mentale' , es: 'Agujero mentoniano', la: 'Foramen mentale' },
  'inferior-alveolar-nerve': { sv: 'Nervus alveolaris inferior', de: 'Nervus alveolaris inferior' , es: 'Nervio alveolar inferior', la: 'Nervus alveolaris inferior' },
  'mental-nerve': { sv: 'Nervus mentalis', de: 'Nervus mentalis' , es: 'Nervio mentoniano', la: 'Nervus mentalis' },
  'incisive-nerve': { sv: 'Nervus incisivus', de: 'Nervus incisivus' , es: 'Nervio incisivo', la: 'Nervus incisivus' },
  'lingual-nerve': { sv: 'Nervus lingualis', de: 'Nervus lingualis' , es: 'Nervio lingual', la: 'Nervus lingualis' },
  'infraorbital-nerve': { sv: 'Nervus infraorbitalis', de: 'Nervus infraorbitalis' , es: 'Nervio infraorbitario', la: 'Nervus infraorbitalis' },
  'posterior-superior-alveolar-nerve': { sv: 'Rami alveolares superiores posteriores', de: 'Rami alveolares superiores posteriores' , es: 'Nervios alveolares superiores posteriores', la: 'Rami alveolares superiores posteriores' },
  'middle-superior-alveolar-nerve': { sv: 'Ramus alveolaris superior medius', de: 'Ramus alveolaris superior medius' , es: 'Nervio alveolar superior medio', la: 'Ramus alveolaris superior medius' },
  'anterior-superior-alveolar-nerve': { sv: 'Rami alveolares superiores anteriores', de: 'Rami alveolares superiores anteriores' , es: 'Nervios alveolares superiores anteriores', la: 'Rami alveolares superiores anteriores' },
  'greater-palatine-nerve': { sv: 'Nervus palatinus major', de: 'Nervus palatinus major', es: 'Nervio palatino mayor', la: 'Nervus palatinus major' },
  'nasopalatine-nerve': { sv: 'Nervus nasopalatinus', de: 'Nervus nasopalatinus', es: 'Nervio nasopalatino', la: 'Nervus nasopalatinus' },
  'inferior-alveolar-artery': { sv: 'Arteria alveolaris inferior', de: 'Arteria alveolaris inferior' , es: 'Arteria alveolar inferior', la: 'Arteria alveolaris inferior' },
  'inferior-alveolar-vein': { sv: 'Vena alveolaris inferior', de: 'Vena alveolaris inferior' , es: 'Vena alveolar inferior', la: 'Vena alveolaris inferior' },
  'trigeminal-nerve': { sv: 'Nervus trigeminus (V)', de: 'Nervus trigeminus (V)' , es: 'Nervio trigémino (V)', la: 'Nervus trigeminus (V)' },
  'mandibular-nerve': { sv: 'Nervus mandibularis (V3)', de: 'Nervus mandibularis (V3)' , es: 'Nervio mandibular (V3)', la: 'Nervus mandibularis (V3)' },
  'maxillary-nerve': { sv: 'Nervus maxillaris (V2)', de: 'Nervus maxillaris (V2)' , es: 'Nervio maxilar (V2)', la: 'Nervus maxillaris (V2)' },
  'buccal-nerve': { sv: 'Nervus buccalis', de: 'Nervus buccalis' , es: 'Nervio bucal', la: 'Nervus buccalis' },
  'external-carotid-artery': { sv: 'Arteria carotis externa', de: 'Arteria carotis externa' , es: 'Arteria carótida externa', la: 'Arteria carotis externa' },
  'maxillary-artery': { sv: 'Arteria maxillaris', de: 'Arteria maxillaris' , es: 'Arteria maxilar', la: 'Arteria maxillaris' },
  'posterior-superior-alveolar-artery': { sv: 'Arteria alveolaris superior posterior', de: 'Arteria alveolaris superior posterior' , es: 'Arteria alveolar superior posterior', la: 'Arteria alveolaris superior posterior' },
  'descending-palatine-artery': { sv: 'Arteria palatina descendens', de: 'Arteria palatina descendens' , es: 'Arteria palatina descendente', la: 'Arteria palatina descendens' },
  'buccal-artery': { sv: 'Arteria buccalis', de: 'Arteria buccalis' , es: 'Arteria bucal', la: 'Arteria buccalis' },
  'facial-artery': { sv: 'Arteria facialis', de: 'Arteria facialis' , es: 'Arteria facial', la: 'Arteria facialis' },
  'pterygoid-plexus': { sv: 'Plexus pterygoideus', de: 'Plexus pterygoideus' , es: 'Plexo venoso pterigoideo', la: 'Plexus pterygoideus' },
  'maxillary-vein': { sv: 'Vena maxillaris', de: 'Vena maxillaris' , es: 'Vena maxilar', la: 'Vena maxillaris' },
  'retromandibular-vein': { sv: 'Vena retromandibularis', de: 'Vena retromandibularis' , es: 'Vena retromandibular', la: 'Vena retromandibularis' },
  'facial-vein': { sv: 'Vena facialis', de: 'Vena facialis' , es: 'Vena facial', la: 'Vena facialis' },
  'internal-jugular-vein': { sv: 'Vena jugularis interna', de: 'Vena jugularis interna' , es: 'Vena yugular interna', la: 'Vena jugularis interna' },
  tmj: { sv: 'Käkled', de: 'Kiefergelenk' , es: 'Articulación temporomandibular', la: 'Articulatio temporomandibularis' },
  'articular-disc': { sv: 'Ledskiva', de: 'Discus articularis' , es: 'Disco articular', la: 'Discus articularis' },
  'articular-fossa': { sv: 'Fossa mandibularis', de: 'Fossa mandibularis' , es: 'Fosa mandibular', la: 'Fossa mandibularis' },
  'temporal-bone': { sv: 'Tinningben', de: 'Schläfenbein' , es: 'Hueso temporal', la: 'Os temporale' },
  'zygomatic-bone': { sv: 'Okben', de: 'Jochbein' , es: 'Hueso cigomático', la: 'Os zygomaticum' },
  'palatine-bone': { sv: 'Gomben', de: 'Gaumenbein' , es: 'Hueso palatino', la: 'Os palatinum' },
  'parietal-bone': { sv: 'Hjässben', de: 'Scheitelbein' , es: 'Hueso parietal', la: 'Os parietale' },
  'nasal-bone': { sv: 'Näsben', de: 'Nasenbein' , es: 'Hueso nasal', la: 'Os nasale' },
  'lacrimal-bone': { sv: 'Tårben', de: 'Tränenbein' , es: 'Hueso lagrimal', la: 'Os lacrimale' },
  'inferior-nasal-concha': { sv: 'Nedre näsmussla', de: 'Untere Nasenmuschel' , es: 'Cornete nasal inferior', la: 'Concha nasalis inferior' },
  masseter: { sv: 'Musculus masseter', de: 'Musculus masseter' , es: 'Músculo masetero', la: 'Musculus masseter' },
  'masseter-superficial': { sv: 'M. masseter, ytlig del', de: 'M. masseter, oberflächlicher Anteil' , es: 'Masetero, porción superficial', la: 'M. masseter, pars superficialis' },
  'masseter-deep': { sv: 'M. masseter, djup del', de: 'M. masseter, tiefer Anteil' , es: 'Masetero, porción profunda', la: 'M. masseter, pars profunda' },
  'lateral-pterygoid': { sv: 'Musculus pterygoideus lateralis', de: 'Musculus pterygoideus lateralis' , es: 'Músculo pterigoideo lateral', la: 'Musculus pterygoideus lateralis' },
  'lateral-pterygoid-upper': { sv: 'M. pterygoideus lateralis, övre huvud', de: 'M. pterygoideus lateralis, oberer Kopf' , es: 'Pterigoideo lateral, cabeza superior', la: 'M. pterygoideus lateralis, caput superius' },
  'lateral-pterygoid-lower': { sv: 'M. pterygoideus lateralis, nedre huvud', de: 'M. pterygoideus lateralis, unterer Kopf' , es: 'Pterigoideo lateral, cabeza inferior', la: 'M. pterygoideus lateralis, caput inferius' },
  temporalis: { sv: 'Musculus temporalis', de: 'Musculus temporalis' , es: 'Músculo temporal', la: 'Musculus temporalis' },
  'medial-pterygoid': { sv: 'Musculus pterygoideus medialis', de: 'Musculus pterygoideus medialis' , es: 'Músculo pterigoideo medial', la: 'Musculus pterygoideus medialis' },
  buccinator: { sv: 'Musculus buccinator', de: 'Musculus buccinator' , es: 'Músculo buccinador', la: 'Musculus buccinator' },
  mentalis: { sv: 'Musculus mentalis', de: 'Musculus mentalis' , es: 'Músculo mentoniano', la: 'Musculus mentalis' },
};

const SIDE_WORD: Record<Side, Tr> = {
  right: { sv: 'höger', de: 'rechts', es: 'lado derecho', la: 'lateris dextri' },
  left: { sv: 'vänster', de: 'links', es: 'lado izquierdo', la: 'lateris sinistri' },
};

/** Names of a non-tooth structure; English comes from its definition. Undefined when a translation is missing. */
export function structureNames(id: string, en: string): Names | undefined {
  const exact = EXACT[id];
  if (exact) return { en, ...exact };
  const m = /^(.*)-(right|left)$/.exec(id);
  const sided = m ? SIDED[m[1]] : undefined;
  if (!m || !sided) return undefined;
  const side = SIDE_WORD[m[2] as Side];
  return { en, sv: `${sided.sv} (${side.sv})`, de: `${sided.de} (${side.de})`, es: `${sided.es} (${side.es})`, la: `${sided.la} (${side.la})` };
}

/**
 * Names of a structure without its side (\"Inferior alveolar nerve\", not \"Right …\"), for pages
 * about the structure in general. `en` is the English base name. Undefined when not translated.
 */
export function baseStructureNames(key: string, en: string, sided: boolean): Names | undefined {
  const t = sided ? SIDED[key] : EXACT[key];
  return t ? { en, ...t } : undefined;
}

/** Short 3D-label names of non-tooth structures, where English has one (by base id). */
export const STRUCTURE_SHORT: Record<string, Tr> = {
  'inferior-alveolar-nerve': { sv: 'N. alv. inf.', de: 'N. alv. inf.' , es: 'N. alv. inf.', la: 'N. alv. inf.' },
  'posterior-superior-alveolar-nerve': { sv: 'Rr. alv. sup. post.', de: 'Rr. alv. sup. post.' , es: 'N. alv. sup. post.', la: 'Rr. alv. sup. post.' },
  'middle-superior-alveolar-nerve': { sv: 'R. alv. sup. med.', de: 'R. alv. sup. med.' , es: 'N. alv. sup. medio', la: 'R. alv. sup. med.' },
  'anterior-superior-alveolar-nerve': { sv: 'Rr. alv. sup. ant.', de: 'Rr. alv. sup. ant.' , es: 'N. alv. sup. ant.', la: 'Rr. alv. sup. ant.' },
  'greater-palatine-nerve': { sv: 'N. pal. maj.', de: 'N. pal. maj.', es: 'N. pal. mayor', la: 'N. pal. maj.' },
  'nasopalatine-nerve': { sv: 'N. nasopal.', de: 'N. nasopal.', es: 'N. nasopal.', la: 'N. nasopal.' },
  'trigeminal-nerve': { sv: 'N. V', de: 'N. V' , es: 'Par V', la: 'N. V' },
  'mandibular-nerve': { sv: 'V3', de: 'V3' , es: 'V3', la: 'V3' },
  'maxillary-nerve': { sv: 'V2', de: 'V2' , es: 'V2', la: 'V2' },
};

/** Search terms in the other languages by structure (base) id: everyday words, Latin names, abbreviations. */
export const STRUCTURE_ALIASES: Record<string, string[]> = {
  maxilla: ['överkäke', 'överkäken', 'överkäksben', 'maxilla', 'Oberkiefer', 'Oberkieferknochen', 'Maxilla', 'maxilar', 'maxilar superior', 'hueso maxilar', 'maxilla'],
  'maxillary-alveolar-process': ['alveolarutskott', 'alveolarben', 'tandfack', 'Alveolarfortsatz', 'Alveolarknochen', 'Zahnfach', 'Processus alveolaris', 'apófisis alveolar', 'hueso alveolar', 'alvéolo', 'processus alveolaris'],
  'maxillary-dentition': ['övre tänder', 'överkäkens tänder', 'obere Zähne', 'Oberkieferzähne', 'Zahnbogen', 'dientes superiores', 'arcada superior', 'arcus dentalis superior'],
  mandible: ['underkäke', 'underkäken', 'käkben', 'mandibel', 'mandibula', 'Unterkiefer', 'Unterkieferknochen', 'Mandibula', 'mandíbula', 'maxilar inferior', 'quijada', 'mandibula'],
  'mandible-body': ['ramus', 'käkvinkel', 'corpus mandibulae', 'Ramus mandibulae', 'Unterkieferast', 'Kieferwinkel', 'Corpus mandibulae', 'rama mandibular', 'ángulo mandibular', 'cuerpo mandibular', 'corpus mandibulae', 'ramus mandibulae'],
  'mandibular-alveolar-process': ['alveolarutskott', 'alveolarben', 'tandfack', 'Alveolarfortsatz', 'Alveolarknochen', 'Zahnfach', 'Processus alveolaris', 'apófisis alveolar', 'hueso alveolar', 'alvéolo', 'pars alveolaris'],
  'mandibular-condyle': ['kondyl', 'ledhuvud', 'caput mandibulae', 'Kondylus', 'Gelenkkopf', 'Caput mandibulae', 'Processus condylaris', 'cóndilo', 'cóndilo mandibular', 'caput mandibulae', 'processus condylaris'],
  'mandibular-dentition': ['nedre tänder', 'underkäkens tänder', 'untere Zähne', 'Unterkieferzähne', 'Zahnbogen', 'dientes inferiores', 'arcada inferior', 'arcus dentalis inferior'],
  'upper-right-quadrant': ['kvadrant 1', 'Quadrant 1', 'cuadrante 1', 'quadrans 1'],
  'upper-left-quadrant': ['kvadrant 2', 'Quadrant 2', 'cuadrante 2', 'quadrans 2'],
  'lower-left-quadrant': ['kvadrant 3', 'Quadrant 3', 'cuadrante 3', 'quadrans 3'],
  'lower-right-quadrant': ['kvadrant 4', 'Quadrant 4', 'cuadrante 4', 'quadrans 4'],
  'mandibular-foramen': ['foramen mandibulae', 'agujero mandibular', 'foramen mandibulae'],
  'mental-foramen': ['foramen mentale', 'agujero mentoniano', 'foramen mentoniano', 'foramen mentale'],
  periodontium: ['parodontium', 'tandfäste', 'stödjevävnad', 'Parodont', 'Parodontium', 'Zahnhalteapparat', 'periodonto', 'tejidos de soporte', 'periodontium'],
  gingiva: ['tandkött', 'gingiva', 'Zahnfleisch', 'Gingiva', 'encía', 'encías', 'gingiva'],
  'gingiva-upper': ['tandkött', 'Zahnfleisch', 'encía', 'encía superior'],
  'gingiva-lower': ['tandkött', 'Zahnfleisch', 'encía', 'encía inferior'],
  nerves: ['nerv', 'nerver', 'trigeminus', 'Nerv', 'Nerven', 'Trigeminus', 'nervio', 'nervios', 'trigémino', 'nervus', 'nervi'],
  'mandibular-nerve-branches': ['n. mandibularis', 'nervus mandibularis', 'nervio mandibular', 'nervus mandibularis'],
  'maxillary-nerve-branches': ['n. maxillaris', 'nervus maxillaris', 'nervio maxilar', 'nervus maxillaris'],
  'inferior-alveolar-nerve': ['n. alveolaris inferior', 'mandibularkanalen', 'mandibularblockad', 'Canalis mandibulae', 'Unterkiefernerv', 'Leitungsanästhesie', 'nervio alveolar inferior', 'nervio dentario inferior', 'conducto mandibular', 'anestesia troncular', 'canalis mandibulae', 'nervus alveolaris inferior'],
  'mental-nerve': ['n. mentalis', 'haknerv', 'Kinnnerv', 'nervio mentoniano', 'nervus mentalis'],
  'incisive-nerve': ['n. incisivus', 'nervio incisivo', 'nervus incisivus'],
  'lingual-nerve': ['n. lingualis', 'tungnerv', 'Zungennerv', 'nervio lingual', 'nervus lingualis'],
  'infraorbital-nerve': ['n. infraorbitalis', 'nervio infraorbitario', 'nervus infraorbitalis'],
  'posterior-superior-alveolar-nerve': ['n. alveolaris superior posterior', 'nervus alveolaris superior posterior', 'nervio alveolar superior posterior', 'nervio dentario posterior', 'rami alveolares superiores posteriores'],
  'middle-superior-alveolar-nerve': ['n. alveolaris superior medius', 'nervus alveolaris superior medius', 'nervio alveolar superior medio', 'ramus alveolaris superior medius'],
  'anterior-superior-alveolar-nerve': ['n. alveolaris superior anterior', 'nervus alveolaris superior anterior', 'nervio alveolar superior anterior', 'rami alveolares superiores anteriores'],
  'greater-palatine-nerve': ['n. palatinus major', 'nervus palatinus major', 'gomnerv', 'Gaumennerv', 'N. palatinus major', 'nervio palatino mayor', 'nervio palatino anterior'],
  'nasopalatine-nerve': ['n. nasopalatinus', 'nervus nasopalatinus', 'canalis incisivus', 'N. nasopalatinus', 'nervio nasopalatino', 'nervio esfenopalatino largo'],
  vessels: ['blodkärl', 'kärl', 'blodförsörjning', 'Blutgefäße', 'Gefäße', 'Blutversorgung', 'vasos', 'vasos sanguíneos', 'irrigación', 'vasa sanguinea'],
  'inferior-alveolar-artery': ['artär', 'a. alveolaris inferior', 'Arterie', 'arteria', 'arteria alveolar inferior', 'arteria dentaria inferior', 'arteria alveolaris inferior'],
  'inferior-alveolar-vein': ['ven', 'v. alveolaris inferior', 'Vene', 'vena', 'vena alveolar inferior', 'vena alveolaris inferior'],
  'trigeminal-nerve': ['trigeminusnerven', 'n. trigeminus', 'femte kranialnerven', 'Trigeminusnerv', 'N. trigeminus', 'fünfter Hirnnerv', 'trigémino', 'nervio trigémino', 'quinto par craneal', 'nervus trigeminus'],
  'mandibular-nerve': ['n. mandibularis', 'nervus mandibularis', 'N. mandibularis', 'nervio mandibular', 'nervus mandibularis'],
  'maxillary-nerve': ['n. maxillaris', 'nervus maxillaris', 'N. maxillaris', 'Oberkiefernerv', 'nervio maxilar', 'nervus maxillaris'],
  'buccal-nerve': ['n. buccalis', 'kindnerv', 'Wangennerv', 'N. buccalis', 'nervio bucal', 'nervio bucinador', 'nervus buccalis'],
  'arterial-supply': ['artär', 'artärer', 'Arterie', 'Arterien', 'arteria', 'arterias', 'arteriae'],
  'external-carotid-artery': ['yttre halsartären', 'halsartär', 'a. carotis externa', 'äußere Halsschlagader', 'Halsschlagader', 'A. carotis externa', 'carótida', 'carótida externa', 'arteria carotis externa'],
  'maxillary-artery': ['a. maxillaris', 'överkäksartären', 'Oberkieferarterie', 'A. maxillaris', 'arteria maxilar', 'arteria maxilar interna', 'arteria maxillaris'],
  'posterior-superior-alveolar-artery': ['a. alveolaris superior posterior', 'A. alveolaris superior posterior', 'arteria alveolar superior posterior', 'arteria alveolaris superior posterior'],
  'descending-palatine-artery': ['a. palatina descendens', 'a. palatina major', 'gomartär', 'Gaumenarterie', 'A. palatina major', 'arteria palatina', 'arteria palatina mayor', 'arteria palatina descendens', 'arteria palatina major'],
  'buccal-artery': ['a. buccalis', 'kindartär', 'Wangenarterie', 'A. buccalis', 'arteria bucal', 'arteria buccalis'],
  'facial-artery': ['ansiktsartären', 'a. facialis', 'Gesichtsarterie', 'A. facialis', 'arteria facial', 'arteria facialis'],
  'venous-drainage': ['ven', 'vener', 'Vene', 'Venen', 'vena', 'venas', 'venae'],
  'pterygoid-plexus': ['plexus pterygoideus', 'venplexus', 'Venengeflecht', 'Plexus pterygoideus', 'plexo pterigoideo', 'plexo venoso', 'plexus pterygoideus'],
  'maxillary-sinus': ['käkhåla', 'käkhålan', 'käkhålor', 'bihåla', 'bihålor', 'sinus maxillaris', 'Kieferhöhle', 'Nasennebenhöhle', 'Sinus maxillaris', 'seno maxilar', 'antro de Highmore', 'sinus maxillaris'],
  'maxillary-vein': ['v. maxillaris', 'V. maxillaris', 'vena maxilar', 'vena maxillaris'],
  'retromandibular-vein': ['v. retromandibularis', 'V. retromandibularis', 'vena retromandibular', 'vena retromandibularis'],
  'facial-vein': ['ansiktsvenen', 'v. facialis', 'Gesichtsvene', 'V. facialis', 'vena facial', 'vena facialis'],
  'internal-jugular-vein': ['inre halsvenen', 'halsven', 'v. jugularis interna', 'innere Drosselvene', 'Drosselvene', 'V. jugularis interna', 'yugular', 'yugular interna', 'vena jugularis interna'],
  tmj: ['käkled', 'käkleden', 'articulatio temporomandibularis', 'Kiefergelenk', 'Kiefergelenke', 'ATM', 'articulación temporomandibular', 'articulatio temporomandibularis'],
  'articular-disc': ['disk', 'diskus', 'käkledsdisk', 'ledskiva', 'Diskus', 'Gelenkscheibe', 'Discus articularis', 'disco', 'disco articular', 'menisco', 'discus articularis'],
  'articular-fossa': ['ledgrop', 'fossa mandibularis', 'Gelenkgrube', 'fosa mandibular', 'cavidad glenoidea', 'fossa mandibularis'],
  skull: ['skalle', 'kranium', 'Schädel', 'Cranium', 'cráneo', 'calavera', 'cranium'],
  'temporal-bone': ['os temporale', 'hueso temporal', 'os temporale'],
  'zygomatic-bone': ['os zygomaticum', 'kindben', 'Wangenbein', 'hueso cigomático', 'pómulo', 'malar', 'os zygomaticum'],
  'palatine-bone': ['os palatinum', 'gom', 'hårda gommen', 'Gaumen', 'harter Gaumen', 'hueso palatino', 'paladar', 'paladar duro', 'os palatinum', 'palatum durum'],
  'parietal-bone': ['os parietale', 'hueso parietal', 'os parietale'],
  'nasal-bone': ['os nasale', 'hueso nasal', 'os nasale'],
  'lacrimal-bone': ['os lacrimale', 'hueso lagrimal', 'unguis', 'os lacrimale'],
  'inferior-nasal-concha': ['concha nasalis inferior', 'cornete inferior', 'concha nasalis inferior'],
  'frontal-bone': ['os frontale', 'hueso frontal', 'os frontale'],
  'occipital-bone': ['os occipitale', 'hueso occipital', 'os occipitale'],
  'sphenoid-bone': ['os sphenoidale', 'esfenoides', 'apófisis pterigoides', 'os sphenoidale'],
  'ethmoid-bone': ['os ethmoidale', 'etmoides', 'os ethmoidale'],
  'hyoid-bone': ['os hyoideum', 'hioides', 'os hyoideum'],
  muscles: ['muskler', 'tuggmuskler', 'tuggmuskulatur', 'Muskeln', 'Kaumuskeln', 'Kaumuskulatur', 'músculos', 'músculos masticadores', 'musculatura masticatoria', 'musculi masticatorii'],
  masseter: ['tuggmuskel', 'massetermuskeln', 'm. masseter', 'großer Kaumuskel', 'Kaumuskel', 'masetero', 'músculo masetero', 'musculus masseter'],
  'masseter-superficial': ['m. masseter', 'masetero'],
  'masseter-deep': ['m. masseter', 'masetero'],
  'lateral-pterygoid': ['yttre vingmuskeln', 'm. pterygoideus lateralis', 'äußerer Flügelmuskel', 'pterigoideo lateral', 'pterigoideo externo', 'musculus pterygoideus lateralis'],
  'lateral-pterygoid-upper': ['m. pterygoideus lateralis', 'pterigoideo lateral'],
  'lateral-pterygoid-lower': ['m. pterygoideus lateralis', 'pterigoideo lateral'],
  temporalis: ['tinningmuskeln', 'm. temporalis', 'Schläfenmuskel', 'músculo temporal', 'musculus temporalis'],
  'medial-pterygoid': ['inre vingmuskeln', 'm. pterygoideus medialis', 'innerer Flügelmuskel', 'pterigoideo medial', 'pterigoideo interno', 'musculus pterygoideus medialis'],
  buccinator: ['kindmuskel', 'm. buccinator', 'Wangenmuskel', 'Trompetermuskel', 'buccinador', 'músculo de la mejilla', 'musculus buccinator'],
  mentalis: ['hakmuskel', 'm. mentalis', 'Kinnmuskel', 'músculo mentoniano', 'borla del mentón', 'musculus mentalis'],
  'orbicularis-oris': ['läppar', 'ringmuskeln runt munnen', 'm. orbicularis oris', 'Lippen', 'Mundringmuskel', 'orbicular de los labios', 'orbicular de la boca', 'labios', 'musculus orbicularis oris'],
  'vomer': ['vómer', 'vomer'],
};

/** Search aliases in the other languages of a structure id (paired ids use their base id). */
export function structureAliases(id: string): string[] {
  return STRUCTURE_ALIASES[id] ?? STRUCTURE_ALIASES[id.replace(/-(right|left)$/, '')] ?? [];
}
