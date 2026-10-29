/**
 * Nerve supply and identification guides for each permanent tooth type, by arch
 * (`tooth:<type>:<arch>`), in every interface language. Requested in dental
 * feedback: which nerve to anaesthetise for a tooth, and how students tell a loose
 * tooth's type, arch and side. Draft content pending expert review; sources and
 * limits are in docs/innervation-identification.md.
 */
import type { Arch, ToothType } from '../anatomy/types.ts';
import { LANGS, type Lang } from '../i18n/lang.ts';

type Translation = [string, string, string, string, string]; // en, sv, de, es, la
type Source = { title: string; url: string };

interface Guide {
  nerves: { pulp: Translation; facial: Translation; oral: Translation; numbing: Translation };
  /** `side` is the clue that finds mesial; `toothGuide` appends the arch's side rule. */
  identify: { type: Translation; arch: Translation; side: Translation };
  sources: Source[];
}

export type GuideRow = { label: string; value: string };
export type ToothGuide = { title: string; rows: GuideRow[] }[];

export const GUIDE_LABELS: Record<Lang, {
  nerves: string; pulp: string; facial: string; palatal: string; lingual: string; numbing: string;
  identify: string; type: string; arch: string; side: string;
}> = {
  en: { nerves: 'Nerve supply', pulp: 'Tooth (pulp)', facial: 'Cheek or lip side gum', palatal: 'Palatal gum', lingual: 'Tongue side gum', numbing: 'Numbing', identify: 'How to identify it', type: 'Which tooth', arch: 'Upper or lower', side: 'Right or left' },
  sv: { nerves: 'Nervförsörjning', pulp: 'Tanden (pulpan)', facial: 'Tandkött mot kind eller läpp', palatal: 'Tandkött mot gommen', lingual: 'Tandkött mot tungan', numbing: 'Bedövning', identify: 'Så känner du igen den', type: 'Vilken tand', arch: 'Över- eller underkäke', side: 'Höger eller vänster' },
  de: { nerves: 'Nervenversorgung', pulp: 'Zahn (Pulpa)', facial: 'Zahnfleisch vestibulär', palatal: 'Zahnfleisch palatinal', lingual: 'Zahnfleisch lingual', numbing: 'Betäubung', identify: 'So erkennen Sie ihn', type: 'Welcher Zahn', arch: 'Ober- oder Unterkiefer', side: 'Rechts oder links' },
  es: { nerves: 'Inervación', pulp: 'Diente (pulpa)', facial: 'Encía vestibular', palatal: 'Encía palatina', lingual: 'Encía lingual', numbing: 'Anestesia', identify: 'Cómo identificarlo', type: 'Qué diente', arch: 'Superior o inferior', side: 'Derecho o izquierdo' },
  la: { nerves: 'Innervatio', pulp: 'Dens (pulpa)', facial: 'Gingiva vestibularis', palatal: 'Gingiva palatina', lingual: 'Gingiva lingualis', numbing: 'Anaesthesia', identify: 'Quomodo agnoscatur', type: 'Quis dens', arch: 'Superior an inferior', side: 'Dexter an sinister' },
};

const statpearls = (title: string, id: string): Source => ({ title: `StatPearls: ${title}`, url: `https://www.ncbi.nlm.nih.gov/books/${id}/` });
const pubmed = (title: string, id: string): Source => ({ title, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/` });
const DENTITION = statpearls('Permanent Dentition', 'NBK570590');
const ALVEOLAR = statpearls('Alveolar Nerve', 'NBK546712');
const NASOPALATINE = statpearls('Nasopalatine Nerve', 'NBK538422');
const MANDIBULAR = statpearls('Mandibular Nerve', 'NBK507820');
const IANB = statpearls('Inferior Alveolar Nerve Block', 'NBK564368');
const TECHNIQUES = statpearls('Local Anesthesia Techniques in Dentistry', 'NBK580480');
const MOLAR_DISSECTION = pubmed('Loetscher & Walton 1988: Innervation of the maxillary first molar', '3422401');
const MOLAR_INJECTION = pubmed('Loetscher et al. 1988: Anesthesia of the maxillary first molar', '3166477');
const MSA = pubmed('Heasman 1984: Clinical anatomy of the superior alveolar nerves', '6239647');
const CROSSOVER = pubmed('Rood 1977: Causes of failure of mandibular analgesia', '268219');
const INCISOR_INFILTRATION = pubmed('Jaber et al. 2010: Infiltration for mandibular incisors', '20953168');
const UPPER_SOURCES = [ALVEOLAR, NASOPALATINE, TECHNIQUES, DENTITION];
const UPPER_PREMOLAR_SOURCES = [ALVEOLAR, MSA, NASOPALATINE, TECHNIQUES, DENTITION];
const LOWER_INCISOR_SOURCES = [DENTITION, CROSSOVER, INCISOR_INFILTRATION, IANB, MANDIBULAR];
const LOWER_SOURCES = [DENTITION, IANB, MANDIBULAR];
const LOWER_MOLAR_SOURCES = [MANDIBULAR, IANB, DENTITION];

/**
 * "Hold it crown down/up with the lip/cheek side towards you…": mesial on the viewer's
 * right means the person's right side. Incisors and canines show their lip side.
 */
const sideRule = (type: ToothType, arch: Arch): Translation => {
  const up = arch === 'mandibular';
  const lip = type.endsWith('incisor') || type === 'canine';
  return [
    `Hold it crown ${up ? 'up' : 'down'} with the ${lip ? 'lip' : 'cheek'} side towards you: if mesial is on your right, it is from the right side of the mouth; if it is on your left, from the left side.`,
    `Håll tanden med kronan ${up ? 'uppåt' : 'nedåt'} och ${lip ? 'läppsidan' : 'kindsidan'} mot dig: är den mesiala sidan till höger kommer tanden från munnens högra sida, är den till vänster från den vänstra.`,
    `Halten Sie den Zahn mit der Krone nach ${up ? 'oben' : 'unten'} und der ${lip ? 'Lippenseite' : 'Wangenseite'} zu sich: Liegt mesial rechts, stammt er aus der rechten Mundhälfte, liegt mesial links, aus der linken.`,
    `Sostenga el diente con la corona hacia ${up ? 'arriba' : 'abajo'} y la cara ${lip ? 'labial' : 'vestibular'} hacia usted: si mesial queda a su derecha, pertenece al lado derecho de la boca; si queda a su izquierda, al izquierdo.`,
    `Dentem corona ${up ? 'sursum' : 'deorsum'} versa et facie ${lip ? 'labiali' : 'buccali'} ad te conversa tene: si latus mesiale ad dextram tuam est, dens ex latere dextro oris est; si ad sinistram, ex sinistro.`,
  ];
};

// ---- shared nerve phrases ------------------------------------------------
const ASA: Translation = ['Anterior superior alveolar nerve.', 'N. alveolaris superior anterior.', 'N. alveolaris superior anterior.', 'Nervio alveolar superior anterior.', 'Nervus alveolaris superior anterior.'];
const ASA_PULP: Translation = [
  'Anterior superior alveolar nerve, a branch of the infraorbital nerve (V2).',
  'N. alveolaris superior anterior, en gren av n. infraorbitalis (V2).',
  'N. alveolaris superior anterior, ein Ast des N. infraorbitalis (V2).',
  'Nervio alveolar superior anterior, rama del nervio infraorbitario (V2).',
  'Nervus alveolaris superior anterior, ramus nervi infraorbitalis (V2).',
];
const NP: Translation = ['Nasopalatine nerve.', 'N. nasopalatinus.', 'N. nasopalatinus.', 'Nervio nasopalatino.', 'Nervus nasopalatinus.'];
const ANTERIOR_NUMBING: Translation = [
  'Usually a local infiltration beside the tooth; the palatal gum needs a separate nasopalatine injection.',
  'Oftast infiltrationsanestesi vid tanden; gomsidans tandkött kräver en separat nasopalatinusinjektion.',
  'Meist eine Infiltrationsanästhesie neben dem Zahn; das palatinale Zahnfleisch braucht eine eigene Injektion am N. nasopalatinus.',
  'Suele bastar una anestesia infiltrativa junto al diente; la encía palatina requiere una inyección nasopalatina aparte.',
  'Plerumque anaesthesia infiltrativa iuxta dentem sufficit; gingiva palatina separatam iniectionem nasopalatinam requirit.',
];
const PREMOLAR_PULP: Translation = [
  'Anterior superior alveolar nerve, helped by the middle superior alveolar nerve where that branch exists (it is missing in many people).',
  'N. alveolaris superior anterior, med tillskott från n. alveolaris superior medius där den grenen finns (den saknas hos många).',
  'N. alveolaris superior anterior, ergänzt durch den N. alveolaris superior medius, wo dieser Ast vorhanden ist (er fehlt bei vielen Menschen).',
  'Nervio alveolar superior anterior, con aporte del nervio alveolar superior medio cuando existe (falta en muchas personas).',
  'Nervus alveolaris superior anterior, adiuvante nervo alveolari superiore medio ubi adest (in multis deest).',
];
const SAME_SA: Translation = ['The same superior alveolar nerves.', 'Samma övre alveolarnerver.', 'Dieselben oberen Alveolarnerven.', 'Los mismos nervios alveolares superiores.', 'Iidem nervi alveolares superiores.'];
const GP: Translation = ['Greater palatine nerve.', 'N. palatinus major.', 'N. palatinus major.', 'Nervio palatino mayor.', 'Nervus palatinus major.'];
const GP_FORAMEN: Translation = [
  'Greater palatine nerve, which leaves the greater palatine foramen, usually palatal to the second or third molar.',
  'N. palatinus major, som kommer ut genom foramen palatinum majus, oftast palatinalt om andra eller tredje molaren.',
  'N. palatinus major, der aus dem Foramen palatinum majus austritt, meist palatinal des zweiten oder dritten Molaren.',
  'Nervio palatino mayor, que sale por el agujero palatino mayor, por lo general a la altura del segundo o tercer molar.',
  'Nervus palatinus major, qui per foramen palatinum majus exit, plerumque palatinaliter secundi vel tertii molaris.',
];
const PREMOLAR_NUMBING: Translation = [
  'Usually a local infiltration; the palatal gum needs a separate greater palatine injection.',
  'Oftast infiltrationsanestesi; gomsidans tandkött kräver en separat injektion vid n. palatinus major.',
  'Meist eine Infiltrationsanästhesie; das palatinale Zahnfleisch braucht eine eigene Injektion am N. palatinus major.',
  'Suele bastar una anestesia infiltrativa; la encía palatina requiere una inyección aparte en el nervio palatino mayor.',
  'Plerumque anaesthesia infiltrativa sufficit; gingiva palatina separatam iniectionem ad nervum palatinum majorem requirit.',
];
const PSA: Translation = ['Posterior superior alveolar nerve.', 'N. alveolaris superior posterior.', 'N. alveolaris superior posterior.', 'Nervio alveolar superior posterior.', 'Nervus alveolaris superior posterior.'];
const MOLAR_NUMBING: Translation = [
  'Infiltration or a posterior superior alveolar block; the palatal gum needs a greater palatine injection.',
  'Infiltrationsanestesi eller tuberblockad; gomsidans tandkött kräver en injektion vid n. palatinus major.',
  'Infiltrationsanästhesie oder Tuberanästhesie; das palatinale Zahnfleisch braucht eine Injektion am N. palatinus major.',
  'Anestesia infiltrativa o bloqueo alveolar superior posterior; la encía palatina requiere una inyección en el nervio palatino mayor.',
  'Anaesthesia infiltrativa vel anaesthesia tuberis; gingiva palatina iniectionem ad nervum palatinum majorem requirit.',
];
const MENTAL: Translation = ['Mental nerve.', 'N. mentalis.', 'N. mentalis.', 'Nervio mentoniano.', 'Nervus mentalis.'];
const LINGUAL: Translation = ['Lingual nerve.', 'N. lingualis.', 'N. lingualis.', 'Nervio lingual.', 'Nervus lingualis.'];
const BUCCAL: Translation = ['Buccal (long buccal) nerve.', 'N. buccalis.', 'N. buccalis.', 'Nervio bucal.', 'Nervus buccalis.'];
const INCISIVE: Translation = ['Incisive nerve (inferior alveolar nerve, V3).', 'N. incisivus (n. alveolaris inferior, V3).', 'N. incisivus (N. alveolaris inferior, V3).', 'Nervio incisivo (nervio alveolar inferior, V3).', 'Nervus incisivus (nervus alveolaris inferior, V3).'];
const PREMOLAR_IAN: Translation = [
  'Inferior alveolar nerve (V3) through its incisive branch; the mental foramen usually lies below the premolar roots.',
  'N. alveolaris inferior (V3) via sin incisiva gren; foramen mentale ligger oftast under premolarernas rötter.',
  'N. alveolaris inferior (V3) über seinen Ast N. incisivus; das Foramen mentale liegt meist unterhalb der Prämolarenwurzeln.',
  'Nervio alveolar inferior (V3) a través de su rama incisiva; el agujero mentoniano suele estar bajo las raíces de los premolares.',
  'Nervus alveolaris inferior (V3) per ramum incisivum; foramen mentale plerumque sub radicibus premolarium iacet.',
];
const PREMOLAR_BLOCK: Translation = [
  'An inferior alveolar block or an incisive block at the mental foramen.',
  'Mandibularblockad eller incisivusblockad vid foramen mentale.',
  'Leitungsanästhesie des N. alveolaris inferior oder Blockade des N. incisivus am Foramen mentale.',
  'Bloqueo del nervio alveolar inferior o bloqueo incisivo en el agujero mentoniano.',
  'Anaesthesia nervi alveolaris inferioris vel nervi incisivi ad foramen mentale.',
];
const IAN: Translation = [
  'Inferior alveolar nerve (V3), running in the mandibular canal below the roots.',
  'N. alveolaris inferior (V3), som löper i canalis mandibulae under rötterna.',
  'N. alveolaris inferior (V3), der im Canalis mandibulae unterhalb der Wurzeln verläuft.',
  'Nervio alveolar inferior (V3), que discurre por el conducto mandibular bajo las raíces.',
  'Nervus alveolaris inferior (V3), qui in canali mandibulae sub radicibus currit.',
];
const MOLAR_BLOCK: Translation = [
  'An inferior alveolar block, plus a buccal nerve injection for the cheek side gum.',
  'Mandibularblockad samt en buckalisinjektion för kindsidans tandkött.',
  'Leitungsanästhesie des N. alveolaris inferior und eine Injektion am N. buccalis für das vestibuläre Zahnfleisch.',
  'Bloqueo del nervio alveolar inferior y una inyección en el nervio bucal para la encía vestibular.',
  'Anaesthesia nervi alveolaris inferioris et iniectio ad nervum buccalem pro gingiva buccali.',
];

// ---- shared identification phrases ------------------------------------------
const LOWER_INCISOR_ARCH: Translation = [
  'Lower: much narrower than an upper incisor, with a smooth lingual surface and a small cingulum; upper incisors are wider with a rounded root.',
  'Underkäke: mycket smalare än en överkäksincisiv, med slät lingual yta och litet cingulum; överkäkens incisiver är bredare med rundad rot.',
  'Unterkiefer: viel schmaler als ein oberer Schneidezahn, mit glatter Lingualfläche und kleinem Tuberculum dentis; obere Schneidezähne sind breiter und haben eine rundliche Wurzel.',
  'Inferior: mucho más estrecho que un incisivo superior, con cara lingual lisa y cíngulo pequeño; los incisivos superiores son más anchos y de raíz redondeada.',
  'Inferior: multo angustior quam incisivus superior, facie linguali levi et cingulo parvo; incisivi superiores latiores sunt radice rotundata.',
];
const LOWER_MOLAR_ARCH: Translation = [
  'Lower: two roots side by side (mesial and distal) and a crown longer front to back than cheek to tongue; upper molars have three roots, including a palatal one.',
  'Underkäke: två rötter bredvid varandra (mesial och distal) och en krona som är längre framifrån och bakåt än från kind till tunga; överkäkens molarer har tre rötter, varav en palatinal.',
  'Unterkiefer: zwei nebeneinanderliegende Wurzeln (mesial und distal) und eine Krone, die von vorn nach hinten länger ist als von der Wange zur Zunge; obere Molaren haben drei Wurzeln, darunter eine palatinale.',
  'Inferior: dos raíces una junto a otra (mesial y distal) y una corona más larga de mesial a distal que de vestibular a lingual; los molares superiores tienen tres raíces, una de ellas palatina.',
  'Inferior: radices duae iuxta positae (mesialis et distalis) et corona mesiodistaliter longior quam buccolingualiter; molares superiores tres radices habent, inter quas palatinam.',
];

const GUIDES: Record<`${ToothType}:${Arch}`, Guide> = {
  'central-incisor:maxillary': {
    nerves: {
      pulp: ASA_PULP,
      facial: ASA,
      oral: [
        'Nasopalatine nerve, which leaves the incisive foramen just behind the central incisors.',
        'N. nasopalatinus, som kommer ut genom foramen incisivum strax bakom de centrala incisiverna.',
        'N. nasopalatinus, der direkt hinter den mittleren Schneidezähnen aus dem Foramen incisivum austritt.',
        'Nervio nasopalatino, que sale por el agujero incisivo justo detrás de los incisivos centrales.',
        'Nervus nasopalatinus, qui per foramen incisivum statim post incisivos mediales exit.',
      ],
      numbing: ANTERIOR_NUMBING,
    },
    identify: {
      type: [
        'The widest incisor: a broad, shovel-shaped crown with a straight cutting edge and one conical root.',
        'Den bredaste incisiven: en bred, skovelformad krona med rak skärkant och en konisk rot.',
        'Der breiteste Schneidezahn: eine breite, schaufelförmige Krone mit gerader Schneidekante und eine konische Wurzel.',
        'El incisivo más ancho: corona amplia en forma de pala, borde incisal recto y una raíz cónica.',
        'Incisivus latissimus: corona lata palaeformis, margo incisalis rectus, radix una conica.',
      ],
      arch: [
        'Upper: much wider than a lower incisor, with a deep lingual fossa and a clear cingulum; lower incisors are narrow, with a root flattened from side to side.',
        'Överkäke: mycket bredare än en underkäksincisiv, med djup lingual fossa och tydligt cingulum; underkäkens incisiver är smala med en rot som är tillplattad från sidorna.',
        'Oberkiefer: viel breiter als ein unterer Schneidezahn, mit tiefer lingualer Grube und deutlichem Tuberculum dentis; untere Schneidezähne sind schmal, ihre Wurzel ist seitlich abgeflacht.',
        'Superior: mucho más ancho que un incisivo inferior, con fosa lingual profunda y cíngulo marcado; los incisivos inferiores son estrechos y su raíz está aplanada lateralmente.',
        'Superior: multo latior quam incisivus inferior, fossa linguali profunda et cingulo manifesto; incisivi inferiores angusti sunt, radice a lateribus compressa.',
      ],
      side: [
        'The mesial corner of the cutting edge is almost a right angle; the distal corner is rounded.',
        'Skärkantens mesiala hörn är nästan rätvinkligt, det distala är rundat.',
        'Die mesiale Ecke der Schneidekante ist fast rechtwinklig, die distale abgerundet.',
        'El ángulo mesial del borde incisal es casi recto; el distal es redondeado.',
        'Angulus mesialis marginis incisalis fere rectus est, distalis rotundatus.',
      ],
    },
    sources: UPPER_SOURCES,
  },
  'lateral-incisor:maxillary': {
    nerves: { pulp: ASA_PULP, facial: ASA, oral: NP, numbing: ANTERIOR_NUMBING },
    identify: {
      type: [
        'Like a smaller central incisor: a narrower crown with more rounded corners, often a pit in the lingual fossa, and one root.',
        'Som en mindre central incisiv: smalare krona med mer rundade hörn, ofta en grop i den linguala fossan, och en rot.',
        'Wie ein kleinerer mittlerer Schneidezahn: schmalere Krone mit runderen Ecken, oft ein Grübchen in der lingualen Grube, und eine Wurzel.',
        'Como un incisivo central más pequeño: corona más estrecha, ángulos más redondeados, a menudo una fosita en la fosa lingual, y una raíz.',
        'Ut incisivus medialis minor: corona angustior angulis rotundioribus, saepe foveola in fossa linguali, radix una.',
      ],
      arch: [
        'Upper: a marked cingulum and lingual fossa and a rounded root; lower incisors have a smooth lingual surface and a root flattened from side to side.',
        'Överkäke: tydligt cingulum och lingual fossa samt en rundad rot; underkäkens incisiver har slät lingual yta och en rot som är tillplattad från sidorna.',
        'Oberkiefer: deutliches Tuberculum dentis, linguale Grube und eine rundliche Wurzel; untere Schneidezähne haben eine glatte Lingualfläche und eine seitlich abgeflachte Wurzel.',
        'Superior: cíngulo y fosa lingual marcados y raíz redondeada; los incisivos inferiores tienen la cara lingual lisa y la raíz aplanada lateralmente.',
        'Superior: cingulum et fossa lingualis manifesta, radix rotundata; incisivi inferiores faciem lingualem levem et radicem a lateribus compressam habent.',
      ],
      side: [
        'The distal corner is clearly rounder than the mesial one, and the root tip often bends distally.',
        'Det distala hörnet är tydligt rundare än det mesiala, och rotspetsen böjer ofta distalt.',
        'Die distale Ecke ist deutlich runder als die mesiale, und die Wurzelspitze biegt oft nach distal.',
        'El ángulo distal es claramente más redondeado que el mesial, y el ápice suele inclinarse hacia distal.',
        'Angulus distalis clare rotundior est quam mesialis, et apex radicis saepe distaliter flectitur.',
      ],
    },
    sources: UPPER_SOURCES,
  },
  'canine:maxillary': {
    nerves: {
      pulp: [
        'Anterior superior alveolar nerve (V2, through the infraorbital nerve).',
        'N. alveolaris superior anterior (V2, via n. infraorbitalis).',
        'N. alveolaris superior anterior (V2, über den N. infraorbitalis).',
        'Nervio alveolar superior anterior (V2, a través del nervio infraorbitario).',
        'Nervus alveolaris superior anterior (V2, per nervum infraorbitalem).',
      ],
      facial: ASA,
      oral: [
        'Nasopalatine nerve, overlapping here with the greater palatine nerve.',
        'N. nasopalatinus, som här överlappar med n. palatinus major.',
        'N. nasopalatinus, hier überlappend mit dem N. palatinus major.',
        'Nervio nasopalatino, que aquí se superpone con el nervio palatino mayor.',
        'Nervus nasopalatinus, qui hic cum nervo palatino majore se intermiscet.',
      ],
      numbing: [
        'Usually a local infiltration; the palatal gum needs a separate injection.',
        'Oftast infiltrationsanestesi; gomsidans tandkött kräver en separat injektion.',
        'Meist eine Infiltrationsanästhesie; das palatinale Zahnfleisch braucht eine eigene Injektion.',
        'Suele bastar una anestesia infiltrativa; la encía palatina requiere una inyección aparte.',
        'Plerumque anaesthesia infiltrativa sufficit; gingiva palatina separatam iniectionem requirit.',
      ],
    },
    identify: {
      type: [
        'One long, pointed cusp and the longest root in the mouth.',
        'En lång, spetsig kusp och munnens längsta rot.',
        'Ein langer, spitzer Höcker und die längste Wurzel im Mund.',
        'Una cúspide larga y puntiaguda y la raíz más larga de la boca.',
        'Cuspis una longa et acuta, radix longissima oris.',
      ],
      arch: [
        'Upper: a sharper cusp and a broader crown with a strong cingulum and lingual ridge; the lower canine is narrower and smoother lingually, and its mesial outline runs almost straight into the root.',
        'Överkäke: skarpare kusp och bredare krona med kraftigt cingulum och lingual ås; underkäkens hörntand är smalare och slätare lingualt, och dess mesiala kontur går nästan rakt över i roten.',
        'Oberkiefer: spitzerer Höcker und breitere Krone mit kräftigem Tuberculum dentis und lingualer Leiste; der untere Eckzahn ist schmaler, lingual glatter, und seine mesiale Kontur geht fast gerade in die Wurzel über.',
        'Superior: cúspide más afilada y corona más ancha con cíngulo y cresta lingual marcados; el canino inferior es más estrecho y liso por lingual, y su contorno mesial continúa casi recto con la raíz.',
        'Superior: cuspis acutior, corona latior cingulo et crista linguali validis; caninus inferior angustior et lingualiter levior est, eiusque margo mesialis fere recte in radicem transit.',
      ],
      side: [
        'The mesial cusp ridge is shorter than the distal one, and the distal contact area lies closer to the root.',
        'Kuspens mesiala kant är kortare än den distala, och den distala kontaktpunkten ligger närmare roten.',
        'Die mesiale Höckerkante ist kürzer als die distale, und der distale Kontaktpunkt liegt näher an der Wurzel.',
        'La arista mesial de la cúspide es más corta que la distal, y el punto de contacto distal está más cerca de la raíz.',
        'Crista cuspidis mesialis brevior est quam distalis, et area contactus distalis radici propior est.',
      ],
    },
    sources: UPPER_SOURCES,
  },
  'first-premolar:maxillary': {
    nerves: { pulp: PREMOLAR_PULP, facial: SAME_SA, oral: GP, numbing: PREMOLAR_NUMBING },
    identify: {
      type: [
        'Two cusps, buccal (cheek side) and palatal, with the buccal cusp clearly the larger; most often two roots, one buccal and one palatal.',
        'Två kuspar, buckal (mot kinden) och palatinal, där den buckala är klart störst; oftast två rötter, en buckal och en palatinal.',
        'Zwei Höcker, bukkal (wangenseitig) und palatinal, der bukkale deutlich größer; meist zwei Wurzeln, eine bukkale und eine palatinale.',
        'Dos cúspides, vestibular y palatina, la vestibular claramente mayor; en la mayoría de los casos dos raíces, una vestibular y una palatina.',
        'Cuspides duae, buccalis et palatina, buccali clare maiore; plerumque radices duae, buccalis et palatina.',
      ],
      arch: [
        'Upper: two cusps of almost the same width on a crown that sits straight on the root; lower premolars tilt their crown towards the tongue, and the lower first premolar has only a tiny lingual cusp.',
        'Överkäke: två nästan lika breda kuspar på en krona som sitter rakt på roten; underkäkens premolarer lutar kronan mot tungan, och underkäkens första premolar har bara en liten lingual kusp.',
        'Oberkiefer: zwei fast gleich breite Höcker auf einer Krone, die gerade auf der Wurzel sitzt; untere Prämolaren neigen ihre Krone zur Zunge, und der untere erste Prämolar hat nur einen winzigen lingualen Höcker.',
        'Superior: dos cúspides de anchura casi igual sobre una corona alineada con la raíz; los premolares inferiores inclinan la corona hacia la lengua, y el primer premolar inferior solo tiene una cúspide lingual diminuta.',
        'Superior: cuspides duae fere aeque latae in corona recte radici insidente; premolares inferiores coronam ad linguam inclinant, et primus premolaris inferior cuspidem lingualem minimam tantum habet.',
      ],
      side: [
        'A concavity on the mesial side of the crown neck, continuing onto the root and crossed by a groove over the mesial marginal ridge, marks mesial.',
        'En konkavitet på kronhalsens mesiala sida, som fortsätter ner på roten och korsas av en fåra över den mesiala randlisten, visar var mesialt är.',
        'Eine Einziehung an der mesialen Seite des Zahnhalses, die sich auf die Wurzel fortsetzt und von einer Furche über der mesialen Randleiste gekreuzt wird, zeigt mesial an.',
        'Una concavidad en la cara mesial del cuello, que continúa por la raíz y está cruzada por un surco sobre la cresta marginal mesial, indica el lado mesial.',
        'Concavitas in latere mesiali colli coronae, in radicem continuata et sulco super cristam marginalem mesialem transita, latus mesiale indicat.',
      ],
    },
    sources: UPPER_PREMOLAR_SOURCES,
  },
  'second-premolar:maxillary': {
    nerves: { pulp: PREMOLAR_PULP, facial: SAME_SA, oral: GP, numbing: PREMOLAR_NUMBING },
    identify: {
      type: [
        'Two cusps of almost equal height, a short central groove with extra small grooves, and usually a single root.',
        'Två nästan lika höga kuspar, en kort central fåra med extra små fåror, och oftast en enda rot.',
        'Zwei fast gleich hohe Höcker, eine kurze Zentralfissur mit zusätzlichen kleinen Furchen und meist eine einzige Wurzel.',
        'Dos cúspides de altura casi igual, un surco central corto con surcos accesorios y, por lo general, una sola raíz.',
        'Cuspides duae fere aeque altae, sulcus centralis brevis cum sulcis minoribus additis, plerumque radix una.',
      ],
      arch: [
        'Upper: buccal and palatal cusps of similar size on an upright crown; lower second premolars are squarer and often have two lingual cusps.',
        'Överkäke: buckal och palatinal kusp av liknande storlek på en upprätt krona; underkäkens andra premolar är fyrkantigare och har ofta två linguala kuspar.',
        'Oberkiefer: bukkaler und palatinaler Höcker ähnlich groß auf einer aufrechten Krone; der untere zweite Prämolar ist eckiger und hat oft zwei linguale Höcker.',
        'Superior: cúspides vestibular y palatina de tamaño similar sobre una corona erguida; el segundo premolar inferior es más cuadrado y a menudo tiene dos cúspides linguales.',
        'Superior: cuspides buccalis et palatina similis magnitudinis in corona erecta; secundus premolaris inferior quadratior est et saepe duas cuspides linguales habet.',
      ],
      side: [
        'There is no deep mesial concavity; the palatal cusp tip lies slightly mesial and the root often bends distally.',
        'Det finns ingen djup mesial konkavitet; den palatinala kuspspetsen ligger något mesialt och roten böjer ofta distalt.',
        'Eine tiefe mesiale Einziehung fehlt; die palatinale Höckerspitze liegt etwas mesial, und die Wurzel biegt oft nach distal.',
        'No hay una concavidad mesial profunda; la punta de la cúspide palatina está algo desplazada a mesial y la raíz suele inclinarse hacia distal.',
        'Concavitas mesialis profunda deest; apex cuspidis palatinae paulo mesialius situs est, et radix saepe distaliter flectitur.',
      ],
    },
    sources: UPPER_PREMOLAR_SOURCES,
  },
  'first-molar:maxillary': {
    nerves: {
      pulp: [
        'Posterior superior alveolar nerve, which always contributes; where a middle superior alveolar nerve exists, it also supplies this tooth in some people.',
        'N. alveolaris superior posterior, som alltid bidrar; där n. alveolaris superior medius finns försörjer den hos en del människor också denna tand.',
        'N. alveolaris superior posterior, der immer beteiligt ist; wo ein N. alveolaris superior medius vorhanden ist, versorgt er bei manchen Menschen diesen Zahn mit.',
        'Nervio alveolar superior posterior, que siempre contribuye; cuando existe un nervio alveolar superior medio, en algunas personas también inerva este diente.',
        'Nervus alveolaris superior posterior, qui semper confert; ubi nervus alveolaris superior medius adest, in quibusdam hunc quoque dentem innervat.',
      ],
      facial: PSA,
      oral: GP,
      numbing: [
        'Infiltration or a posterior superior alveolar block; a small share of people need an extra injection mesial to the tooth, and the palatal gum needs a greater palatine injection.',
        'Infiltrationsanestesi eller tuberblockad; en liten andel behöver en extra injektion mesialt om tanden, och gomsidans tandkött kräver en injektion vid n. palatinus major.',
        'Infiltrationsanästhesie oder Tuberanästhesie; ein kleiner Teil der Menschen braucht eine zusätzliche Injektion mesial des Zahns, das palatinale Zahnfleisch eine Injektion am N. palatinus major.',
        'Anestesia infiltrativa o bloqueo alveolar superior posterior; una pequeña parte de las personas necesita una inyección adicional por mesial del diente, y la encía palatina, una inyección en el nervio palatino mayor.',
        'Anaesthesia infiltrativa vel anaesthesia tuberis; pauci iniectionem additam mesialiter dentis requirunt, et gingiva palatina iniectionem ad nervum palatinum majorem.',
      ],
    },
    identify: {
      type: [
        'The largest upper crown: four main cusps, an oblique ridge from the mesiopalatal to the distobuccal cusp, often an extra Carabelli cusp on the palatal side, and three widely spread roots.',
        'Överkäkens största krona: fyra huvudkuspar, en sned ås från den mesiopalatinala till den distobuckala kuspen, ofta en extra Carabellis kusp palatinalt, och tre väl utspärrade rötter.',
        'Die größte obere Krone: vier Haupthöcker, eine schräge Leiste (Crista obliqua) vom mesiopalatinalen zum distobukkalen Höcker, oft ein zusätzliches Tuberculum Carabelli palatinal und drei weit gespreizte Wurzeln.',
        'La corona superior más grande: cuatro cúspides principales, una cresta oblicua de la cúspide mesiopalatina a la distovestibular, a menudo un tubérculo de Carabelli por palatino y tres raíces muy separadas.',
        'Corona superior maxima: cuspides principales quattuor, crista obliqua a cuspide mesiopalatina ad distobuccalem, saepe tuberculum Carabelli palatinum additum, radices tres late divaricatae.',
      ],
      arch: [
        'Upper: three roots (two buccal and one long palatal) and a rhomboid crown outline; lower molars have two roots, mesial and distal.',
        'Överkäke: tre rötter (två buckala och en lång palatinal) och en rombisk kronkontur; underkäkens molarer har två rötter, mesial och distal.',
        'Oberkiefer: drei Wurzeln (zwei bukkale und eine lange palatinale) und ein rhombischer Kronenumriss; untere Molaren haben zwei Wurzeln, mesial und distal.',
        'Superior: tres raíces (dos vestibulares y una palatina larga) y contorno coronal romboidal; los molares inferiores tienen dos raíces, mesial y distal.',
        'Superior: radices tres (duae buccales, una palatina longa) et ambitus coronae rhomboideus; molares inferiores duas radices habent, mesialem et distalem.',
      ],
      side: [
        'Turn the single palatal root towards the tongue. The large mesiopalatal cusp (with the Carabelli cusp, if present) and the broad mesiobuccal root are mesial, and the roots lean distally.',
        'Vänd den enda palatinala roten mot tungan. Den stora mesiopalatinala kuspen (med Carabellis kusp om den finns) och den breda mesiobuckala roten är mesiala, och rötterna lutar distalt.',
        'Drehen Sie die einzelne palatinale Wurzel zur Zunge. Der große mesiopalatinale Höcker (mit dem Tuberculum Carabelli, falls vorhanden) und die breite mesiobukkale Wurzel liegen mesial, und die Wurzeln neigen sich nach distal.',
        'Oriente la única raíz palatina hacia la lengua. La gran cúspide mesiopalatina (con el tubérculo de Carabelli, si existe) y la ancha raíz mesiovestibular son mesiales, y las raíces se inclinan hacia distal.',
        'Radicem palatinam unicam ad linguam verte. Cuspis mesiopalatina magna (cum tuberculo Carabelli, si adest) et radix mesiobuccalis lata mesiales sunt, et radices distaliter inclinant.',
      ],
    },
    sources: [MOLAR_DISSECTION, MOLAR_INJECTION, ALVEOLAR, NASOPALATINE, DENTITION],
  },
  'second-molar:maxillary': {
    nerves: {
      pulp: [
        'Posterior superior alveolar nerve, which enters the back of the maxilla near the tuberosity.',
        'N. alveolaris superior posterior, som går in i maxillans baksida nära tuber maxillae.',
        'N. alveolaris superior posterior, der nahe dem Tuber maxillae in die Rückseite der Maxilla eintritt.',
        'Nervio alveolar superior posterior, que entra en la cara posterior del maxilar cerca de la tuberosidad.',
        'Nervus alveolaris superior posterior, qui prope tuber partem posteriorem maxillae intrat.',
      ],
      facial: PSA,
      oral: GP_FORAMEN,
      numbing: MOLAR_NUMBING,
    },
    identify: {
      type: [
        'Smaller than the first molar, with a small or missing distopalatal cusp (often a heart-shaped, three-cusp outline), rarely a Carabelli cusp, and three roots that lie closer together.',
        'Mindre än första molaren, med liten eller saknad distopalatinal kusp (ofta en hjärtformad kontur med tre kuspar), sällan Carabellis kusp, och tre rötter som ligger närmare varandra.',
        'Kleiner als der erste Molar, mit kleinem oder fehlendem distopalatinalem Höcker (oft herzförmiger Umriss mit drei Höckern), selten einem Tuberculum Carabelli und drei enger stehenden Wurzeln.',
        'Más pequeño que el primer molar, con la cúspide distopalatina pequeña o ausente (a menudo un contorno acorazonado de tres cúspides), rara vez tubérculo de Carabelli y tres raíces más juntas.',
        'Minor quam primus molaris, cuspide distopalatina parva vel deficiente (saepe ambitu cordiformi tricuspidato), raro tuberculo Carabelli, radicibus tribus propius iunctis.',
      ],
      arch: [
        'Upper: three roots (two buccal and one palatal); lower molars have two.',
        'Överkäke: tre rötter (två buckala och en palatinal); underkäkens molarer har två.',
        'Oberkiefer: drei Wurzeln (zwei bukkale, eine palatinale); untere Molaren haben zwei.',
        'Superior: tres raíces (dos vestibulares y una palatina); los molares inferiores tienen dos.',
        'Superior: radices tres (duae buccales, una palatina); molares inferiores duas habent.',
      ],
      side: [
        'Turn the palatal root towards the tongue; the roots lean distally and the mesial half of the crown is the larger.',
        'Vänd den palatinala roten mot tungan; rötterna lutar distalt och kronans mesiala halva är störst.',
        'Drehen Sie die palatinale Wurzel zur Zunge; die Wurzeln neigen sich nach distal, und die mesiale Kronenhälfte ist die größere.',
        'Oriente la raíz palatina hacia la lengua; las raíces se inclinan hacia distal y la mitad mesial de la corona es la mayor.',
        'Radicem palatinam ad linguam verte; radices distaliter inclinant et dimidium mesiale coronae maius est.',
      ],
    },
    sources: UPPER_SOURCES,
  },
  'third-molar:maxillary': {
    nerves: { pulp: PSA, facial: PSA, oral: GP_FORAMEN, numbing: MOLAR_NUMBING },
    identify: {
      type: [
        'The most variable tooth: usually a small, heart-shaped crown with three cusps and short roots that are often fused.',
        'Den mest varierande tanden: oftast en liten hjärtformad krona med tre kuspar och korta rötter som ofta är sammanvuxna.',
        'Der variabelste Zahn: meist eine kleine, herzförmige Krone mit drei Höckern und kurzen, oft verschmolzenen Wurzeln.',
        'El diente más variable: suele tener una corona pequeña y acorazonada con tres cúspides y raíces cortas, a menudo fusionadas.',
        'Dens maxime varius: plerumque corona parva cordiformis tribus cuspidibus et radices breves saepe coalitae.',
      ],
      arch: [
        'Upper: any separate roots are two buccal and one palatal; lower third molars are longer front to back and usually keep a mesial and a distal root.',
        'Överkäke: separata rötter är i så fall två buckala och en palatinal; underkäkens visdomständer är längre framifrån och bakåt och har oftast en mesial och en distal rot.',
        'Oberkiefer: getrennte Wurzeln sind gegebenenfalls zwei bukkale und eine palatinale; untere Weisheitszähne sind von vorn nach hinten länger und haben meist eine mesiale und eine distale Wurzel.',
        'Superior: si hay raíces separadas, son dos vestibulares y una palatina; los terceros molares inferiores son más largos de mesial a distal y suelen conservar una raíz mesial y otra distal.',
        'Superior: radices separatae, si adsunt, duae buccales et una palatina sunt; molares tertii inferiores mesiodistaliter longiores sunt et plerumque radicem mesialem et distalem servant.',
      ],
      side: [
        'The fused roots usually bend distally. With this much variation, identification is often by elimination.',
        'De sammanvuxna rötterna böjer oftast distalt. Med så stor variation sker identifieringen ofta genom uteslutning.',
        'Die verschmolzenen Wurzeln biegen meist nach distal. Bei so großer Variabilität gelingt die Bestimmung oft nur im Ausschlussverfahren.',
        'Las raíces fusionadas suelen inclinarse hacia distal. Con tanta variación, la identificación suele hacerse por descarte.',
        'Radices coalitae plerumque distaliter flectuntur. Tanta varietate dens saepe per exclusionem agnoscitur.',
      ],
    },
    sources: UPPER_SOURCES,
  },
  'central-incisor:mandibular': {
    nerves: {
      pulp: [
        'Incisive nerve, the continuation of the inferior alveolar nerve (V3) in front of the mental foramen; fibres from the other side cross the midline.',
        'N. incisivus, fortsättningen av n. alveolaris inferior (V3) framför foramen mentale; fibrer från andra sidan korsar medellinjen.',
        'N. incisivus, die Fortsetzung des N. alveolaris inferior (V3) vor dem Foramen mentale; Fasern der Gegenseite kreuzen die Mittellinie.',
        'Nervio incisivo, continuación del nervio alveolar inferior (V3) por delante del agujero mentoniano; fibras del lado opuesto cruzan la línea media.',
        'Nervus incisivus, continuatio nervi alveolaris inferioris (V3) ante foramen mentale; fibrae lateris oppositi lineam medianam transeunt.',
      ],
      facial: MENTAL,
      oral: LINGUAL,
      numbing: [
        'An inferior alveolar block may leave it partly sensitive because of the crossing fibres; local infiltration is also effective for lower incisors.',
        'En mandibularblockad kan lämna tanden delvis känslig på grund av de korsande fibrerna; infiltrationsanestesi fungerar också för underkäkens incisiver.',
        'Eine Leitungsanästhesie des N. alveolaris inferior kann wegen der kreuzenden Fasern eine Restempfindung lassen; auch eine Infiltrationsanästhesie wirkt bei unteren Schneidezähnen.',
        'Un bloqueo del nervio alveolar inferior puede dejarlo parcialmente sensible por las fibras que cruzan; la anestesia infiltrativa también es eficaz en los incisivos inferiores.',
        'Anaesthesia nervi alveolaris inferioris propter fibras transeuntes sensum partim relinquere potest; anaesthesia infiltrativa quoque in incisivis inferioribus efficax est.',
      ],
    },
    identify: {
      type: [
        'The smallest permanent tooth: a narrow, almost symmetrical crown with sharp corners and a straight cutting edge, and one root flattened from side to side.',
        'Den minsta permanenta tanden: en smal, nästan symmetrisk krona med skarpa hörn och rak skärkant, och en rot som är tillplattad från sidorna.',
        'Der kleinste bleibende Zahn: eine schmale, fast symmetrische Krone mit scharfen Ecken und gerader Schneidekante und eine seitlich abgeflachte Wurzel.',
        'El diente permanente más pequeño: corona estrecha, casi simétrica, con ángulos agudos y borde incisal recto, y una raíz aplanada lateralmente.',
        'Dens permanens minimus: corona angusta fere symmetrica angulis acutis et margine incisali recto, radix una a lateribus compressa.',
      ],
      arch: LOWER_INCISOR_ARCH,
      side: [
        'Right and left are very hard to tell apart because both corners are sharp; a slightly deeper groove along the distal root surface is the most useful clue.',
        'Höger och vänster är mycket svåra att skilja eftersom båda hörnen är skarpa; en något djupare fåra längs rotens distala yta är den bästa ledtråden.',
        'Rechts und links sind sehr schwer zu unterscheiden, da beide Ecken scharf sind; eine etwas tiefere Furche auf der distalen Wurzelfläche ist der beste Hinweis.',
        'Derecho e izquierdo son muy difíciles de distinguir porque ambos ángulos son agudos; un surco algo más profundo en la cara distal de la raíz es la mejor pista.',
        'Dexter et sinister aegerrime distinguuntur, quod ambo anguli acuti sunt; sulcus paulo profundior in facie distali radicis optimum indicium est.',
      ],
    },
    sources: LOWER_INCISOR_SOURCES,
  },
  'lateral-incisor:mandibular': {
    nerves: {
      pulp: [
        'Incisive nerve (inferior alveolar nerve, V3), with some fibres crossing from the other side.',
        'N. incisivus (n. alveolaris inferior, V3), med vissa fibrer som korsar från andra sidan.',
        'N. incisivus (N. alveolaris inferior, V3), mit einigen Fasern von der Gegenseite.',
        'Nervio incisivo (nervio alveolar inferior, V3), con algunas fibras que cruzan desde el lado opuesto.',
        'Nervus incisivus (nervus alveolaris inferior, V3), cum fibris nonnullis e latere opposito transeuntibus.',
      ],
      facial: MENTAL,
      oral: LINGUAL,
      numbing: [
        'An inferior alveolar block or an incisive block at the mental foramen; local infiltration is also used for these teeth.',
        'Mandibularblockad eller incisivusblockad vid foramen mentale; infiltrationsanestesi används också för dessa tänder.',
        'Leitungsanästhesie des N. alveolaris inferior oder Blockade des N. incisivus am Foramen mentale; auch eine Infiltrationsanästhesie wird hier genutzt.',
        'Bloqueo del nervio alveolar inferior o bloqueo incisivo en el agujero mentoniano; también se usa anestesia infiltrativa en estos dientes.',
        'Anaesthesia nervi alveolaris inferioris vel nervi incisivi ad foramen mentale; anaesthesia infiltrativa quoque adhibetur.',
      ],
    },
    identify: {
      type: [
        'Slightly larger than the lower central incisor, with a more rounded distal corner and one flattened root.',
        'Något större än underkäkens centrala incisiv, med rundare distalt hörn och en tillplattad rot.',
        'Etwas größer als der untere mittlere Schneidezahn, mit runderer distaler Ecke und einer abgeflachten Wurzel.',
        'Algo mayor que el incisivo central inferior, con el ángulo distal más redondeado y una raíz aplanada.',
        'Paulo maior quam incisivus medialis inferior, angulo distali rotundiore et radice una compressa.',
      ],
      arch: LOWER_INCISOR_ARCH,
      side: [
        'The cutting edge is twisted distolingually to follow the curve of the arch, the cingulum lies distal to the centre and the distal corner is rounder.',
        'Skärkanten är vriden distolingualt efter tandbågens kurva, cingulum ligger distalt om mitten och det distala hörnet är rundare.',
        'Die Schneidekante ist dem Zahnbogen folgend nach distolingual gedreht, das Tuberculum dentis liegt distal der Mitte, und die distale Ecke ist runder.',
        'El borde incisal está girado hacia distolingual siguiendo la curva de la arcada, el cíngulo queda distal al centro y el ángulo distal es más redondeado.',
        'Margo incisalis secundum curvaturam arcus distolingualiter tortus est, cingulum distaliter a medio iacet, angulus distalis rotundior est.',
      ],
    },
    sources: LOWER_INCISOR_SOURCES,
  },
  'canine:mandibular': {
    nerves: {
      pulp: INCISIVE,
      facial: MENTAL,
      oral: LINGUAL,
      numbing: [
        'An inferior alveolar block, or an incisive block at the mental foramen, which also reaches the premolars and incisors on that side.',
        'Mandibularblockad, eller incisivusblockad vid foramen mentale som även når premolarerna och incisiverna på samma sida.',
        'Leitungsanästhesie des N. alveolaris inferior oder Blockade des N. incisivus am Foramen mentale, die auch Prämolaren und Schneidezähne derselben Seite erfasst.',
        'Bloqueo del nervio alveolar inferior, o bloqueo incisivo en el agujero mentoniano, que también alcanza los premolares e incisivos de ese lado.',
        'Anaesthesia nervi alveolaris inferioris, vel nervi incisivi ad foramen mentale, quae etiam premolares et incisivos eiusdem lateris attingit.',
      ],
    },
    identify: {
      type: [
        'One pointed cusp on a long, single root.',
        'En spetsig kusp på en lång, enkel rot.',
        'Ein spitzer Höcker auf einer langen, einzelnen Wurzel.',
        'Una cúspide puntiaguda sobre una raíz única y larga.',
        'Cuspis una acuta in radice longa singulari.',
      ],
      arch: [
        'Lower: a narrower crown that is smooth lingually, a blunter cusp, and a mesial outline that runs almost straight into the root; the upper canine is broader, with a strong cingulum and lingual ridge.',
        'Underkäke: smalare krona som är slät lingualt, trubbigare kusp och en mesial kontur som går nästan rakt över i roten; överkäkens hörntand är bredare med kraftigt cingulum och lingual ås.',
        'Unterkiefer: schmalere, lingual glatte Krone, stumpferer Höcker und eine mesiale Kontur, die fast gerade in die Wurzel übergeht; der obere Eckzahn ist breiter, mit kräftigem Tuberculum dentis und lingualer Leiste.',
        'Inferior: corona más estrecha y lisa por lingual, cúspide más roma y contorno mesial que continúa casi recto con la raíz; el canino superior es más ancho, con cíngulo y cresta lingual marcados.',
        'Inferior: corona angustior lingualiter levis, cuspis obtusior, margo mesialis fere recte in radicem transiens; caninus superior latior est cingulo et crista linguali validis.',
      ],
      side: [
        'The mesial cusp ridge is the shorter one and the mesial outline is almost straight with the root, while the distal contact area lies closer to the root.',
        'Kuspens mesiala kant är den kortare och den mesiala konturen nästan rak med roten, medan den distala kontaktpunkten ligger närmare roten.',
        'Die mesiale Höckerkante ist die kürzere, die mesiale Kontur verläuft fast gerade mit der Wurzel, und der distale Kontaktpunkt liegt näher an der Wurzel.',
        'La arista mesial de la cúspide es la más corta y el contorno mesial es casi recto con la raíz, mientras que el contacto distal está más cerca de la raíz.',
        'Crista cuspidis mesialis brevior est et margo mesialis cum radice fere rectus, area autem contactus distalis radici propior est.',
      ],
    },
    sources: LOWER_SOURCES,
  },
  'first-premolar:mandibular': {
    nerves: { pulp: PREMOLAR_IAN, facial: MENTAL, oral: LINGUAL, numbing: PREMOLAR_BLOCK },
    identify: {
      type: [
        'Looks like a small canine: a large pointed buccal cusp, a tiny non-working lingual cusp and one root.',
        'Liknar en liten hörntand: en stor spetsig buckal kusp, en liten, icke-funktionell lingual kusp och en rot.',
        'Wirkt wie ein kleiner Eckzahn: ein großer spitzer bukkaler Höcker, ein winziger, funktionsloser lingualer Höcker und eine Wurzel.',
        'Parece un canino pequeño: una cúspide vestibular grande y puntiaguda, una cúspide lingual diminuta sin función y una raíz.',
        'Caninum parvum imitatur: cuspis buccalis magna et acuta, cuspis lingualis minima sine munere, radix una.',
      ],
      arch: [
        'Lower: the crown leans towards the tongue over the root and the lingual cusp is tiny; upper premolars have two cusps of similar width on an upright crown.',
        'Underkäke: kronan lutar mot tungan över roten och den linguala kuspen är mycket liten; överkäkens premolarer har två kuspar av liknande bredd på en upprätt krona.',
        'Unterkiefer: die Krone neigt sich über der Wurzel zur Zunge, der linguale Höcker ist winzig; obere Prämolaren haben zwei ähnlich breite Höcker auf einer aufrechten Krone.',
        'Inferior: la corona se inclina hacia la lengua sobre la raíz y la cúspide lingual es diminuta; los premolares superiores tienen dos cúspides de anchura similar en una corona erguida.',
        'Inferior: corona supra radicem ad linguam inclinat et cuspis lingualis minima est; premolares superiores duas cuspides similis latitudinis in corona erecta habent.',
      ],
      side: [
        'A mesiolingual groove separates the mesial marginal ridge from the lingual cusp, and the mesial marginal ridge sits lower than the distal one.',
        'En mesiolingual fåra skiljer den mesiala randlisten från den linguala kuspen, och den mesiala randlisten ligger lägre än den distala.',
        'Eine mesiolinguale Furche trennt die mesiale Randleiste vom lingualen Höcker, und die mesiale Randleiste liegt tiefer als die distale.',
        'Un surco mesiolingual separa la cresta marginal mesial de la cúspide lingual, y la cresta marginal mesial está más baja que la distal.',
        'Sulcus mesiolingualis cristam marginalem mesialem a cuspide linguali separat, et crista marginalis mesialis humilior est quam distalis.',
      ],
    },
    sources: LOWER_SOURCES,
  },
  'second-premolar:mandibular': {
    nerves: { pulp: PREMOLAR_IAN, facial: MENTAL, oral: LINGUAL, numbing: PREMOLAR_BLOCK },
    identify: {
      type: [
        'A squarer crown with a larger lingual part than the first premolar: either three cusps (one buccal and two lingual, with Y-shaped grooves) or two cusps (H- or U-shaped grooves), and one root.',
        'En fyrkantigare krona med större lingual del än första premolaren: antingen tre kuspar (en buckal och två linguala, Y-formade fåror) eller två kuspar (H- eller U-formade fåror), och en rot.',
        'Eine eckigere Krone mit größerem lingualem Anteil als beim ersten Prämolaren: entweder drei Höcker (ein bukkaler, zwei linguale, Y-förmige Fissuren) oder zwei Höcker (H- oder U-förmige Fissuren), und eine Wurzel.',
        'Una corona más cuadrada con una parte lingual mayor que la del primer premolar: tres cúspides (una vestibular y dos linguales, surcos en Y) o dos cúspides (surcos en H o en U), y una raíz.',
        'Corona quadratior parte linguali maiore quam in primo premolari: aut cuspides tres (una buccalis, duae linguales, sulcis Y-formibus) aut duae (sulcis H- vel U-formibus), radix una.',
      ],
      arch: [
        'Lower: the crown tilts towards the tongue on a single root; upper second premolars have two even cusps on an upright crown.',
        'Underkäke: kronan lutar mot tungan på en enda rot; överkäkens andra premolar har två jämnstora kuspar på en upprätt krona.',
        'Unterkiefer: die Krone neigt sich auf einer einzelnen Wurzel zur Zunge; obere zweite Prämolaren haben zwei gleichmäßige Höcker auf einer aufrechten Krone.',
        'Inferior: la corona se inclina hacia la lengua sobre una sola raíz; el segundo premolar superior tiene dos cúspides parejas en una corona erguida.',
        'Inferior: corona in radice singulari ad linguam inclinat; secundus premolaris superior duas cuspides aequales in corona erecta habet.',
      ],
      side: [
        'In the three-cusp form the mesiolingual cusp is larger than the distolingual one; in the two-cusp form the lingual cusp tip lies mesially.',
        'I den trekuspiga formen är den mesiolinguala kuspen större än den distolinguala; i den tvåkuspiga formen ligger den linguala kuspspetsen mesialt.',
        'Bei der dreihöckrigen Form ist der mesiolinguale Höcker größer als der distolinguale; bei der zweihöckrigen liegt die linguale Höckerspitze mesial.',
        'En la forma de tres cúspides la mesiolingual es mayor que la distolingual; en la de dos cúspides la punta de la cúspide lingual está desplazada a mesial.',
        'In forma tricuspidata cuspis mesiolingualis maior est quam distolingualis; in bicuspidata apex cuspidis lingualis mesialiter iacet.',
      ],
    },
    sources: LOWER_SOURCES,
  },
  'first-molar:mandibular': {
    nerves: {
      pulp: IAN,
      facial: BUCCAL,
      oral: LINGUAL,
      numbing: [
        'An inferior alveolar block, which usually also reaches the lingual nerve; the cheek side gum needs a separate buccal nerve injection. The buccal nerve can also reach the molars through small retromolar foramina, one cause of incomplete numbness.',
        'Mandibularblockad, som oftast även når n. lingualis; kindsidans tandkött kräver en separat buckalisinjektion. N. buccalis kan också nå molarerna genom små retromolara foramina, en orsak till ofullständig bedövning.',
        'Leitungsanästhesie des N. alveolaris inferior, die meist auch den N. lingualis erfasst; das vestibuläre Zahnfleisch braucht eine eigene Injektion am N. buccalis. Der N. buccalis kann die Molaren auch über kleine retromolare Foramina erreichen, ein Grund für unvollständige Betäubung.',
        'Bloqueo del nervio alveolar inferior, que suele alcanzar también el nervio lingual; la encía vestibular requiere una inyección aparte en el nervio bucal. El nervio bucal puede llegar además a los molares por pequeños agujeros retromolares, una causa de anestesia incompleta.',
        'Anaesthesia nervi alveolaris inferioris, quae plerumque nervum lingualem quoque attingit; gingiva buccalis separatam iniectionem ad nervum buccalem requirit. Nervus buccalis molares etiam per foramina retromolaria parva attingere potest, quae causa anaesthesiae imperfectae est.',
      ],
    },
    identify: {
      type: [
        'Five cusps: three on the buccal side (mesiobuccal, distobuccal and a small distal cusp) and two on the lingual side, plus two well-separated roots, mesial and distal.',
        'Fem kuspar: tre på buckalsidan (mesiobuckal, distobuckal och en liten distal kusp) och två på lingualsidan, samt två väl åtskilda rötter, mesial och distal.',
        'Fünf Höcker: drei bukkal (mesiobukkal, distobukkal und ein kleiner distaler Höcker) und zwei lingual, dazu zwei deutlich getrennte Wurzeln, mesial und distal.',
        'Cinco cúspides: tres vestibulares (mesiovestibular, distovestibular y una pequeña distal) y dos linguales, además de dos raíces bien separadas, mesial y distal.',
        'Cuspides quinque: tres buccales (mesiobuccalis, distobuccalis et parva distalis) et duae linguales, praeterea radices duae bene separatae, mesialis et distalis.',
      ],
      arch: LOWER_MOLAR_ARCH,
      side: [
        'The small distal cusp marks the distal end, the lingual cusps are higher and more pointed, the mesial root curves distally and the straighter distal root slopes distally.',
        'Den lilla distala kuspen markerar den distala änden, de linguala kusparna är högre och spetsigare, den mesiala roten böjer distalt och den rakare distala roten lutar distalt.',
        'Der kleine distale Höcker markiert das distale Ende, die lingualen Höcker sind höher und spitzer, die mesiale Wurzel krümmt sich nach distal, und die geradere distale Wurzel neigt sich nach distal.',
        'La pequeña cúspide distal marca el extremo distal, las cúspides linguales son más altas y agudas, la raíz mesial se curva hacia distal y la distal, más recta, se inclina hacia distal.',
        'Cuspis distalis parva finem distalem notat, cuspides linguales altiores et acutiores sunt, radix mesialis distaliter curvatur et radix distalis rectior distaliter inclinat.',
      ],
    },
    sources: LOWER_MOLAR_SOURCES,
  },
  'second-molar:mandibular': {
    nerves: { pulp: IAN, facial: BUCCAL, oral: LINGUAL, numbing: MOLAR_BLOCK },
    identify: {
      type: [
        'Four cusps of similar size whose grooves cross in a plus-sign pattern, and two roots that are closer together and more parallel than the first molar’s.',
        'Fyra ungefär lika stora kuspar vars fåror korsar varandra som ett plustecken, och två rötter som står närmare varandra och mer parallellt än första molarens.',
        'Vier etwa gleich große Höcker, deren Fissuren sich wie ein Pluszeichen kreuzen, und zwei Wurzeln, die enger und paralleler stehen als beim ersten Molaren.',
        'Cuatro cúspides de tamaño similar cuyos surcos se cruzan en forma de signo más, y dos raíces más juntas y paralelas que las del primer molar.',
        'Cuspides quattuor fere aequales, quarum sulci in formam signi additionis se secant, et radices duae propius et magis parallelae quam in primo molari.',
      ],
      arch: LOWER_MOLAR_ARCH,
      side: [
        'The roots slope distally and the mesiobuccal cusp is the largest.',
        'Rötterna lutar distalt och den mesiobuckala kuspen är störst.',
        'Die Wurzeln neigen sich nach distal, und der mesiobukkale Höcker ist der größte.',
        'Las raíces se inclinan hacia distal y la cúspide mesiovestibular es la mayor.',
        'Radices distaliter inclinant et cuspis mesiobuccalis maxima est.',
      ],
    },
    sources: LOWER_MOLAR_SOURCES,
  },
  'third-molar:mandibular': {
    nerves: {
      pulp: [
        'Inferior alveolar nerve (V3); the roots often lie close to the mandibular canal.',
        'N. alveolaris inferior (V3); rötterna ligger ofta nära canalis mandibulae.',
        'N. alveolaris inferior (V3); die Wurzeln liegen oft nahe am Canalis mandibulae.',
        'Nervio alveolar inferior (V3); las raíces suelen estar cerca del conducto mandibular.',
        'Nervus alveolaris inferior (V3); radices saepe canali mandibulae propinquae sunt.',
      ],
      facial: BUCCAL,
      oral: [
        'Lingual nerve, which can run just beneath the thin lingual bone beside this tooth.',
        'N. lingualis, som kan löpa precis under det tunna linguala benet intill tanden.',
        'N. lingualis, der direkt unter der dünnen lingualen Knochenwand neben diesem Zahn verlaufen kann.',
        'Nervio lingual, que puede discurrir justo bajo la fina cortical lingual junto a este diente.',
        'Nervus lingualis, qui sub tenui lamina ossis linguali iuxta hunc dentem currere potest.',
      ],
      numbing: MOLAR_BLOCK,
    },
    identify: {
      type: [
        'Variable: a small crown with a wrinkled occlusal surface, four or five cusps, and short roots that are often fused.',
        'Varierande: en liten krona med skrynklig ocklusalyta, fyra eller fem kuspar och korta rötter som ofta är sammanvuxna.',
        'Variabel: eine kleine Krone mit zerfurchter Kaufläche, vier oder fünf Höcker und kurze, oft verschmolzene Wurzeln.',
        'Variable: corona pequeña con superficie oclusal arrugada, cuatro o cinco cúspides y raíces cortas, a menudo fusionadas.',
        'Varius: corona parva superficie occlusali rugosa, cuspides quattuor vel quinque, radices breves saepe coalitae.',
      ],
      arch: [
        'Lower: a crown longer front to back, with mesial and distal roots; upper third molars are often heart-shaped with three cusps.',
        'Underkäke: en krona som är längre framifrån och bakåt, med mesial och distal rot; överkäkens visdomständer är ofta hjärtformade med tre kuspar.',
        'Unterkiefer: eine von vorn nach hinten längere Krone mit mesialer und distaler Wurzel; obere Weisheitszähne sind oft herzförmig mit drei Höckern.',
        'Inferior: corona más larga de mesial a distal, con raíces mesial y distal; los terceros molares superiores suelen ser acorazonados, con tres cúspides.',
        'Inferior: corona mesiodistaliter longior radicibus mesiali et distali; molares tertii superiores saepe cordiformes sunt tribus cuspidibus.',
      ],
      side: [
        'The roots, often fused, curve distally.',
        'Rötterna, ofta sammanvuxna, böjer distalt.',
        'Die oft verschmolzenen Wurzeln krümmen sich nach distal.',
        'Las raíces, a menudo fusionadas, se curvan hacia distal.',
        'Radices, saepe coalitae, distaliter curvantur.',
      ],
    },
    sources: LOWER_MOLAR_SOURCES,
  },
};

/** Content key → its guide, if the key is a tooth type entry (`tooth:<type>:<arch>`). */
function guideFor(key: string): { guide: Guide; type: ToothType; arch: Arch } | undefined {
  const m = /^tooth:(.+):(maxillary|mandibular)$/.exec(key);
  const guide = m ? GUIDES[`${m[1]}:${m[2]}` as keyof typeof GUIDES] : undefined;
  return guide && { guide, type: m![1] as ToothType, arch: m![2] as Arch };
}

/** The two guide sections for a tooth content key, in a language. */
export function toothGuide(key: string, lang: Lang): ToothGuide | undefined {
  const found = guideFor(key);
  if (!found) return undefined;
  const { guide: { nerves, identify }, type, arch } = found;
  const i = LANGS.indexOf(lang);
  const L = GUIDE_LABELS[lang];
  return [
    { title: L.nerves, rows: [
      { label: L.pulp, value: nerves.pulp[i] },
      { label: L.facial, value: nerves.facial[i] },
      { label: arch === 'maxillary' ? L.palatal : L.lingual, value: nerves.oral[i] },
      { label: L.numbing, value: nerves.numbing[i] },
    ] },
    { title: L.identify, rows: [
      { label: L.type, value: identify.type[i] },
      { label: L.arch, value: identify.arch[i] },
      { label: L.side, value: `${identify.side[i]} ${sideRule(type, arch)[i]}` },
    ] },
  ];
}

/** Sources for a tooth key's guide, shown with the tooth's other references. */
export const toothGuideSources = (key: string): Source[] => guideFor(key)?.guide.sources ?? [];
