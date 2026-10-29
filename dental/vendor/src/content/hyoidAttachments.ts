import { LANGS, type Lang } from '../i18n/lang';

export type HyoidGroup = 'skull' | 'jaw' | 'below';
type Translation = [string, string, string, string, string];
const attachments: { name: string; group: HyoidGroup; description: Translation }[] = [
  { name: 'Lig. stylohyoideum', group: 'skull', description: [
    'Connects the temporal bone’s styloid process to the lesser horn of the hyoid. This is a ligament, not an articulation between the bones.',
    'Förbinder tinningbenets processus styloideus med tungbenets mindre horn. Detta är ett ligament, inte en led mellan benen.',
    'Verbindet den Griffelfortsatz des Schläfenbeins mit dem kleinen Zungenbeinhorn. Es ist ein Band, kein Gelenk zwischen den Knochen.',
    'Une el proceso estiloides del temporal con el asta menor del hioides. Es un ligamento, no una articulación entre los huesos.',
    'Processum styloideum ossis temporalis cum cornu minore ossis hyoidei coniungit. Ligamentum est, non articulatio inter ossa.',
  ] },
  { name: 'M. stylohyoideus', group: 'skull', description: [
    'Runs from the styloid process to the hyoid near the body–greater horn junction. It elevates and retracts the hyoid.',
    'Löper från processus styloideus till tungbenet nära övergången mellan kroppen och det större hornet. Höjer och drar tungbenet bakåt.',
    'Zieht vom Griffelfortsatz zum Zungenbein nahe dem Übergang von Körper und großem Horn. Hebt das Zungenbein und zieht es zurück.',
    'Va del proceso estiloides al hioides cerca de la unión cuerpo–asta mayor. Eleva y retrae el hioides.',
    'A processu styloideo ad os hyoideum prope iunctionem corporis et cornus maioris currit. Os hyoideum elevat et retrahit.',
  ] },
  { name: 'M. digastricus', group: 'jaw', description: [
    'Its anterior belly starts at the mandible and its posterior belly at the temporal bone’s mastoid notch. A fibrous sling holds the intermediate tendon to the hyoid; the muscle can elevate the hyoid or help open the jaw.',
    'Främre buken börjar på underkäken och bakre buken i tinningbenets incisura mastoidea. En fibrös slinga håller mellansenan vid tungbenet; muskeln kan höja tungbenet eller hjälpa till att öppna käken.',
    'Der vordere Bauch entspringt am Unterkiefer, der hintere an der Mastoidkerbe des Schläfenbeins. Eine Faserschlinge hält die Zwischensehne am Zungenbein; der Muskel hebt das Zungenbein oder hilft bei der Kieferöffnung.',
    'El vientre anterior nace en la mandíbula y el posterior en la incisura mastoidea del temporal. Un asa fibrosa sujeta el tendón intermedio al hioides; eleva el hioides o ayuda a abrir la mandíbula.',
    'Venter anterior a mandibula, posterior ab incisura mastoidea ossis temporalis oritur. Ansa fibrosa tendinem intermedium ad os hyoideum tenet; musculus os hyoideum elevat aut mandibulam deprimere adiuvat.',
  ] },
  { name: 'M. mylohyoideus', group: 'jaw', description: [
    'Forms much of the muscular floor of the mouth, from the mandibular mylohyoid line to a midline raphe and the hyoid body. It raises the mouth floor and hyoid.',
    'Bildar en stor del av munbottens muskelplatta, från underkäkens linea mylohyoidea till en raphe i mittlinjen och tungbenets kropp. Höjer munbotten och tungbenet.',
    'Bildet einen großen Teil des muskulären Mundbodens von der Linea mylohyoidea zur mittigen Raphe und zum Zungenbeinkörper. Hebt Mundboden und Zungenbein.',
    'Forma gran parte del suelo muscular de la boca, desde la línea milohioidea mandibular al rafe medio y cuerpo del hioides. Eleva el suelo oral y el hioides.',
    'Magna pars fundi oris muscularis est, a linea mylohyoidea mandibulae ad raphen medianam et corpus ossis hyoidei. Fundum oris et os hyoideum elevat.',
  ] },
  { name: 'M. geniohyoideus', group: 'jaw', description: [
    'Runs from the inferior mental spines on the inner mandible to the hyoid body, above mylohyoid. It draws the hyoid forward and upward.',
    'Löper från de nedre spinae mentales på underkäkens insida till tungbenets kropp, ovanför mylohyoideus. Drar tungbenet framåt och uppåt.',
    'Zieht von den unteren Kinnstacheln der inneren Mandibula zum Zungenbeinkörper, oberhalb des Mylohyoideus. Zieht das Zungenbein nach vorn und oben.',
    'Va de las espinas mentonianas inferiores de la cara interna mandibular al cuerpo del hioides, sobre el milohioideo. Desplaza el hioides hacia delante y arriba.',
    'A spinis mentalibus inferioribus mandibulae ad corpus ossis hyoidei supra mylohyoideum currit. Os hyoideum antrorsum et sursum trahit.',
  ] },
  { name: 'M. sternohyoideus', group: 'below', description: [
    'Connects the manubrium and adjacent medial clavicular region to the hyoid body. It helps lower and stabilize the hyoid.',
    'Förbinder bröstbenets manubrium och närliggande mediala nyckelbensområde med tungbenets kropp. Hjälper till att sänka och stabilisera tungbenet.',
    'Verbindet Manubrium und benachbarte mediale Schlüsselbeinregion mit dem Zungenbeinkörper. Senkt und stabilisiert das Zungenbein.',
    'Conecta manubrio y región clavicular medial adyacente con el cuerpo del hioides. Ayuda a descender y estabilizar el hioides.',
    'Manubrium et regionem claviculae medialem adiacentem cum corpore ossis hyoidei coniungit. Os hyoideum deprimere et stabilire adiuvat.',
  ] },
  { name: 'M. omohyoideus', group: 'below', description: [
    'Links the scapula to the hyoid through two bellies and an intermediate tendon. It helps depress and stabilize the hyoid.',
    'Förbinder skulderbladet med tungbenet via två bukar och en mellansena. Hjälper till att sänka och stabilisera tungbenet.',
    'Verbindet Schulterblatt und Zungenbein über zwei Bäuche und eine Zwischensehne. Senkt und stabilisiert das Zungenbein.',
    'Une escápula e hioides mediante dos vientres y un tendón intermedio. Ayuda a descender y estabilizar el hioides.',
    'Scapulam cum osse hyoideo per duos ventres et tendinem intermedium coniungit. Os hyoideum deprimere et stabilire adiuvat.',
  ] },
  { name: 'M. thyrohyoideus', group: 'below', description: [
    'Connects the thyroid cartilage of the larynx to the hyoid body and greater horn. It lowers the hyoid or raises the larynx, depending on which attachment is stabilized.',
    'Förbinder struphuvudets sköldbrosk med tungbenets kropp och större horn. Sänker tungbenet eller höjer struphuvudet beroende på vilket fäste som stabiliseras.',
    'Verbindet den Schildknorpel des Kehlkopfs mit Zungenbeinkörper und großem Horn. Senkt das Zungenbein oder hebt den Kehlkopf, je nachdem welcher Ansatz fixiert ist.',
    'Une el cartílago tiroides laríngeo con el cuerpo y asta mayor del hioides. Desciende el hioides o eleva la laringe según la inserción estabilizada.',
    'Cartilaginem thyroideam laryngis cum corpore et cornu maiore ossis hyoidei coniungit. Os hyoideum deprimit aut laryngem elevat secundum insertionem stabilitam.',
  ] },
  { name: 'Membrana thyrohyoidea', group: 'below', description: [
    'A connective-tissue membrane between the hyoid and thyroid cartilage, linking the hyoid to the larynx. It is shown in this explanation, not as a muscle line in the diagram.',
    'Ett bindvävsmembran mellan tungbenet och sköldbrosket som förbinder tungbenet med struphuvudet. Det förklaras här och visas inte som en muskellinje i bilden.',
    'Eine Bindegewebsmembran zwischen Zungenbein und Schildknorpel, die zum Kehlkopf verbindet. Sie wird hier erklärt und nicht als Muskellinie dargestellt.',
    'Membrana de tejido conectivo entre hioides y cartílago tiroides que enlaza con la laringe. Se explica aquí y no se representa como una línea muscular.',
    'Membrana textus connectivi inter os hyoideum et cartilaginem thyroideam, os hyoideum cum larynge coniungens. Hic explicatur, non ut linea muscularis ostenditur.',
  ] },
];

export const HYOID_SOURCES = [
  { title: 'NCBI: Hyoid bone', url: 'https://www.ncbi.nlm.nih.gov/books/NBK539726/' },
  { title: 'NCBI: Suprahyoid muscles', url: 'https://www.ncbi.nlm.nih.gov/books/NBK546710/' },
  { title: 'NCBI: Sternohyoid muscle', url: 'https://www.ncbi.nlm.nih.gov/books/NBK547693/' },
  { title: 'NCBI: Thyrohyoid membrane', url: 'https://www.ncbi.nlm.nih.gov/books/NBK532995/' },
];
export function hyoidAttachments(lang: Lang) {
  const index = LANGS.indexOf(lang);
  return attachments.map((a) => ({ ...a, description: a.description[index] }));
}
