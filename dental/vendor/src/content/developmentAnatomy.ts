import { DEVELOPMENT_TEETH, developmentContentKey } from '../anatomy/development.ts';
import type { Lang } from '../i18n/lang.ts';
import { DEVELOPMENT_TEXT } from '../i18n/development.ts';

export const DEVELOPMENT_SOURCES = [
  { title: 'Bastir et al. · Craniofacial maturation (2006)', url: 'https://pubmed.ncbi.nlm.nih.gov/17062021/' },
  { title: 'AAPD · Dental Growth and Development (2025)', url: 'https://www.aapd.org/globalassets/media/policies_guidelines/r_dentalgrowth25.pdf' },
  { title: 'StatPearls · Primary Dentition', url: 'https://www.ncbi.nlm.nih.gov/books/NBK573074/' },
  { title: 'StatPearls · Tooth Eruption', url: 'https://www.ncbi.nlm.nih.gov/books/NBK549878/' },
];

/** Each primary tooth type has its own description; never reuse adult premolar text. */
const PRIMARY: Record<Lang, readonly string[]> = {
  en: [
    'The primary central incisor lies beside the midline, mesial to the lateral incisor. Its cutting edge helps bite food; a permanent central incisor succeeds it during mixed dentition.',
    'The primary lateral incisor lies between the central incisor and canine. It contributes to the anterior cutting edge and is replaced by a permanent lateral incisor.',
    'The primary canine lies between the lateral incisor and first primary molar, at the turn of the arch. Its pointed crown helps tear food; its successor is the permanent canine.',
    'The first primary molar lies behind the canine and in front of the second primary molar. Its broad crown helps crush food. The first permanent premolar develops in the region between and beneath its roots and replaces it.',
    'The second primary molar lies behind the first primary molar. It helps grind food and is replaced by the second permanent premolar. The first permanent molar emerges behind it and does not replace it.',
  ],
  sv: [
    'Den centrala mjölkframtanden ligger intill mittlinjen, mesialt om den laterala framtanden. Skäreggen hjälper till att bita av mat; en permanent central framtand ersätter den under växelbettet.',
    'Den laterala mjölkframtanden ligger mellan den centrala framtanden och hörntanden. Den bidrar till framtändernas skärande kant och ersätts av en permanent lateral framtand.',
    'Mjölkhörntanden ligger mellan den laterala framtanden och den första mjölkmolaren, där tandbågen svänger. Den spetsiga kronan hjälper till att slita sönder mat; efterföljaren är den permanenta hörntanden.',
    'Den första mjölkmolaren ligger bakom hörntanden och framför den andra mjölkmolaren. Den breda kronan hjälper till att krossa mat. Första permanenta premolaren utvecklas i området mellan och under dess rötter och ersätter den.',
    'Den andra mjölkmolaren ligger bakom den första mjölkmolaren. Den hjälper till att mala mat och ersätts av den andra permanenta premolaren. Den första permanenta molaren bryter fram bakom den och ersätter den inte.',
  ],
  de: [
    'Der mittlere Milchschneidezahn liegt neben der Mittellinie, mesial vom seitlichen Schneidezahn. Seine Schneidekante hilft beim Abbeißen; im Wechselgebiss wird er durch einen bleibenden mittleren Schneidezahn ersetzt.',
    'Der seitliche Milchschneidezahn liegt zwischen dem mittleren Schneidezahn und dem Eckzahn. Er bildet einen Teil der vorderen Schneidekante und wird durch einen bleibenden seitlichen Schneidezahn ersetzt.',
    'Der Milcheckzahn liegt zwischen dem seitlichen Schneidezahn und dem ersten Milchmolaren an der Biegung des Zahnbogens. Seine spitze Krone hilft beim Zerreißen der Nahrung; sein Nachfolger ist der bleibende Eckzahn.',
    'Der erste Milchmolar liegt hinter dem Eckzahn und vor dem zweiten Milchmolaren. Seine breite Krone zerkleinert Nahrung. Der erste bleibende Prämolar entwickelt sich zwischen und unter seinen Wurzeln und ersetzt ihn.',
    'Der zweite Milchmolar liegt hinter dem ersten Milchmolaren. Er zermahlt Nahrung und wird durch den zweiten bleibenden Prämolaren ersetzt. Der erste bleibende Molar bricht hinter ihm durch, ohne ihn zu ersetzen.',
  ],
  es: [
    'El incisivo central temporal se sitúa junto a la línea media, mesial al incisivo lateral. Su borde cortante ayuda a morder los alimentos; lo sustituye un incisivo central permanente durante la dentición mixta.',
    'El incisivo lateral temporal se sitúa entre el incisivo central y el canino. Contribuye al borde cortante anterior y es sustituido por un incisivo lateral permanente.',
    'El canino temporal se sitúa entre el incisivo lateral y el primer molar temporal, en la curva del arco. Su corona puntiaguda ayuda a desgarrar los alimentos; su sucesor es el canino permanente.',
    'El primer molar temporal se sitúa detrás del canino y delante del segundo molar temporal. Su corona ancha tritura alimentos. El primer premolar permanente se desarrolla entre y bajo sus raíces y lo sustituye.',
    'El segundo molar temporal se sitúa detrás del primer molar temporal. Ayuda a moler alimentos y es sustituido por el segundo premolar permanente. El primer molar permanente erupciona detrás de él sin sustituirlo.',
  ],
  la: [
    'Incisivus centralis deciduus iuxta lineam medianam, mesialiter ab incisivo laterali situs est. Margo incisalis cibum incidit; incisivus centralis permanens eum in dentitione mixta substituit.',
    'Incisivus lateralis deciduus inter incisivum centralem et caninum situs est. Marginem anteriorem secantem constituit et ab incisivo laterali permanente substituitur.',
    'Caninus deciduus inter incisivum lateralem et primum molarem deciduum ad curvaturam arcus situs est. Corona acuta cibum lacerat; successor eius caninus permanens est.',
    'Primus molaris deciduus post caninum et ante secundum molarem deciduum situs est. Corona lata cibum conterit. Primus premolaris permanens inter et infra radices eius evolvitur atque eum substituit.',
    'Secundus molaris deciduus post primum molarem deciduum situs est. Cibum molit et a secundo premolari permanente substituitur. Primus molaris permanens post eum erumpit neque eum substituit.',
  ],
};

const ARCH_LOCATION: Record<Lang, Record<'maxillary' | 'mandibular', string>> = {
  en: { maxillary: 'In the upper dental arch, supported by the alveolar part of the maxilla; it opposes the lower arch.', mandibular: 'In the lower dental arch, supported by the alveolar part of the mandible; it opposes the upper arch.' },
  sv: { maxillary: 'I överkäkens tandbåge, med stöd i maxillans alveolära del; den möter underkäkens tandbåge.', mandibular: 'I underkäkens tandbåge, med stöd i mandibulans alveolära del; den möter överkäkens tandbåge.' },
  de: { maxillary: 'Im oberen Zahnbogen, getragen vom Alveolarteil der Maxilla; dem unteren Zahnbogen gegenüberliegend.', mandibular: 'Im unteren Zahnbogen, getragen vom Alveolarteil der Mandibula; dem oberen Zahnbogen gegenüberliegend.' },
  es: { maxillary: 'En el arco dental superior, sostenido por la parte alveolar del maxilar; se opone al arco inferior.', mandibular: 'En el arco dental inferior, sostenido por la parte alveolar de la mandíbula; se opone al arco superior.' },
  la: { maxillary: 'In arcu dentali superiore, parte alveolari maxillae sustentatus; arcui inferiori opponitur.', mandibular: 'In arcu dentali inferiore, parte alveolari mandibulae sustentatus; arcui superiori opponitur.' },
};

interface Entry { summary?: string; location?: string; clinical?: string; sources?: { title: string; url: string }[] }
export function developmentAnatomy(lang: Lang, base: Record<string, Entry>): Record<string, Entry> {
  const text = DEVELOPMENT_TEXT[lang];
  const out: Record<string, Entry> = {
    'development-dentition': { summary: text.stages.primary.summary, clinical: text.note, sources: DEVELOPMENT_SOURCES },
    'development-maxillary-arch': { summary: ARCH_LOCATION[lang].maxillary, clinical: text.note, sources: DEVELOPMENT_SOURCES },
    'development-mandibular-arch': { summary: ARCH_LOCATION[lang].mandibular, clinical: text.note, sources: DEVELOPMENT_SOURCES },
  };
  for (const t of DEVELOPMENT_TEETH) {
    const key = developmentContentKey(t);
    const adult = base[`tooth:${t.type}:${t.arch}`];
    out[key] = t.dentition === 'primary'
      ? { summary: PRIMARY[lang][t.fdi % 10 - 1], location: ARCH_LOCATION[lang][t.arch], clinical: text.note, sources: DEVELOPMENT_SOURCES }
      : { ...adult, location: ARCH_LOCATION[lang][t.arch], clinical: text.note, sources: [...(adult?.sources ?? []), ...DEVELOPMENT_SOURCES] };
  }
  return out;
}
