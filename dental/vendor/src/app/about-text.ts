/**
 * Text of the static /about/ page in each interface language
 * (English at about/, Swedish at about/sv/, German at about/de/, Spanish at about/es/, Latin at about/la/).
 * Anatomical names come from src/i18n/anatomy.ts and descriptions from src/content/<lang>/.
 */
import type { Lang } from '../i18n/lang.ts';

export interface AboutText {
  htmlLang: string;
  title: string;
  description: string;
  openExplorer: string;
  h1: string;
  lede: string;
  toc: [string, string, string, string, string, string, string];
  onThisPage: string;
  featuresTitle: string;
  features: [string, string][];
  teethTitle: string;
  teethIntro: string;
  quadrants: [string, string, string, string];
  numberingTitle: string;
  numberingIntro: string;
  numberingHead: [string, string, string];
  numberingRows: [string, string, string][];
  typesTitle: string;
  typesIntro: string;
  upper: string;
  lower: string;
  functionLabel: string;
  notesLabel: string;
  rootsLabel: string;
  canalsLabel: string;
  eruptionLabel: string;
  viewIn3d: string;
  glossaryTitle: string;
  glossaryIntro: string;
  glossaryGroups: [string, string, string, string, string, string];
  /** term names where the automatic one (from the content key) does not fit */
  termNames: Record<string, string>;
  faqTitle: string;
  faq: { q: string; a: string }[];
  creditsTitle: string;
  /** credits paragraph as HTML; {author}, {repo}, {bp3d} and {licence} are link placeholders */
  creditsHtml: string;
  note: string;
  footer: string;
  madeBy: string;
  otherLanguages: string;
}

const en: AboutText = {
  htmlLang: 'en',
  title: 'About Dental Scope: Free Interactive 3D Dental Anatomy Atlas',
  description:
    'A free, open-source 3D tooth atlas for dental students: every permanent tooth, tooth numbering systems, tooth tissues, jaws, nerves and muscles, explained.',
  openExplorer: 'Open the 3D explorer →',
  h1: 'Dental Scope: free interactive 3D dental anatomy',
  lede: 'Dental Scope is a free, open-source 3D dental anatomy explorer. Rotate a full skull and both jaws, pick any of the 32 permanent teeth, and dissect a tooth layer by layer, from enamel and dentin down to the pulp and root canals. It runs in the browser with nothing to install.',
  toc: ['Features', 'All 32 teeth', 'Tooth numbering', 'Tooth types', 'Anatomy glossary', 'FAQ', 'Anatomy sources'],
  onThisPage: 'On this page',
  featuresTitle: 'What you can do',
  features: [
    ['Explore the whole mouth in 3D', 'skull, maxilla, mandible, gums and all permanent teeth, including third molars (wisdom teeth).'],
    ['See inside every tooth', 'enamel, dentin, cementum, periodontal ligament, pulp chamber, pulp horns and root canals.'],
    ['Dissect anatomy', 'separate the layers step by step, or lay every structure out side by side.'],
    ['Section view', 'cut through the model to see cross-sections of teeth and bone.'],
    ['Three numbering systems', 'FDI (ISO 3950), Universal (ADA) and Palmer, switchable at any time.'],
    ['Nerves, vessels and muscles', 'inferior alveolar, lingual and superior alveolar nerves, the temporomandibular joint and the muscles of mastication.'],
    ['Search', 'any structure or tooth by name or number.'],
    ['English, Swedish, German, Spanish and Latin', 'switch the language with the flags at the top of the explorer.'],
  ],
  teethTitle: 'All 32 permanent teeth',
  teethIntro: 'Each link opens the 3D explorer with that tooth selected.',
  quadrants: ['Upper right (FDI quadrant 1)', 'Upper left (FDI quadrant 2)', 'Lower left (FDI quadrant 3)', 'Lower right (FDI quadrant 4)'],
  numberingTitle: 'Tooth numbering systems',
  numberingIntro:
    'Dentists name teeth with a short code. Dental Scope shows all three systems in common use, so you can learn to read each one. Take the lower left first molar as an example:',
  numberingHead: ['System', 'How it works', 'Lower left first molar'],
  numberingRows: [
    ['FDI (ISO 3950)', 'Two digits: the quadrant (1 upper right, 2 upper left, 3 lower left, 4 lower right), then the position from the midline (1 central incisor to 8 third molar). Used in most of the world.', '36'],
    ['Universal (ADA)', 'Numbers 1 to 32, starting at the upper right third molar, running along the upper arch to the upper left, then back along the lower arch from the lower left third molar to the lower right. Used mainly in the United States.', '#19'],
    ['Palmer', 'A quadrant symbol with the position number 1 to 8, written here in text form as UR, UL, LL or LR plus the position. Common in the United Kingdom and in orthodontics.', 'LL6'],
  ],
  typesTitle: 'Tooth types',
  typesIntro:
    'The permanent dentition has eight teeth in each quadrant: two incisors, one canine, two premolars and three molars. Typical textbook values are shown; individual anatomy varies.',
  upper: 'upper',
  lower: 'lower',
  functionLabel: 'Function.',
  notesLabel: 'Notes.',
  rootsLabel: 'Roots',
  canalsLabel: 'Root canals',
  eruptionLabel: 'Eruption',
  viewIn3d: 'View in 3D:',
  glossaryTitle: 'Dental anatomy glossary',
  glossaryIntro: 'The structures you can select in the 3D model, in short.',
  glossaryGroups: ['Parts of a tooth', 'Tooth tissues', 'Periodontium (supporting tissues)', 'Jaws and joint', 'Nerves and vessels', 'Muscles of mastication and the face'],
  termNames: {
    cej: 'Cementoenamel junction (CEJ)',
    pdl: 'Periodontal ligament (PDL)',
    tmj: 'Temporomandibular joint (TMJ)',
    'maxillary-alveolar-process': 'Maxillary alveolar process',
    'mandibular-alveolar-process': 'Mandibular alveolar process',
  },
  faqTitle: 'Frequently asked questions',
  faq: [
    {
      q: 'What is Dental Scope?',
      a: 'Dental Scope is a free, open-source, interactive 3D model of human dental anatomy that runs in the web browser. You can rotate the skull and jaws, select any of the 32 permanent teeth, peel away enamel and dentin to see the pulp and root canals, and look at the nerves, vessels and muscles around the teeth.',
    },
    {
      q: 'Is Dental Scope free?',
      a: 'Yes. It is free to use with no account or installation, and its source code is open under the MIT licence. The 3D anatomy is derived from BodyParts3D and shared under CC BY-SA 2.1 Japan.',
    },
    {
      q: 'Who is it for?',
      a: 'Dental students, dental hygiene and dental assisting students, teachers who want a 3D model to show in class, and anyone curious about how teeth are built and numbered.',
    },
    {
      q: 'Which tooth numbering systems does it support?',
      a: 'All three common systems. The FDI World Dental Federation system (ISO 3950) uses two digits: quadrant then position, so the lower left first molar is 36. The Universal system used in the United States numbers the teeth 1 to 32, making the same tooth #19. Palmer notation writes the quadrant and position, here LL6. Switch between them with the FDI, UNI and PAL buttons.',
    },
    {
      q: 'Can I see inside a tooth?',
      a: 'Yes. Select a tooth and open Dissect anatomy to separate it into enamel, dentin, cementum, periodontal ligament, pulp chamber and root canals, or use the Section tool to cut through the model.',
    },
    {
      q: 'Does it work on phones and tablets?',
      a: 'Yes, in any current version of Chrome, Edge, Firefox or Safari with WebGL, on desktop, tablet or phone.',
    },
    {
      q: 'Which languages is it available in?',
      a: 'English, Swedish, German, Spanish and Latin. The whole explorer, including the anatomical names and descriptions, is translated; choose a language with the flags at the top.',
    },
    {
      q: 'Can Dental Scope be used for diagnosis?',
      a: 'No. Dental Scope is an educational reference only. Internal tooth tissues are modeled with simplified proportions and nerves and vessels follow an anatomy atlas rather than measurements of one person, so it must not be used for diagnosis, treatment planning or clinical decisions.',
    },
  ],
  creditsTitle: 'Anatomy sources and licences',
  creditsHtml:
    'Made by {author}. The source code is on <a href="{repo}" rel="noopener">GitHub</a>. The jaws, teeth, skull and muscles come from <a href="{bp3d}" rel="noopener">BodyParts3D</a>, © The Database Center for Life Science, licensed under <a href="{licence}" rel="noopener">CC Attribution-Share Alike 2.1 Japan</a>. Third molars, gums, alveolar bone and the joint are derived from those meshes; enamel, dentin, cementum, periodontal ligament, pulp and canals are modeled with simplified proportions. The dental nerve and vessel paths follow the <a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" rel="noopener">Z-Anatomy</a> atlas (CC BY-SA 4.0), fitted onto these jaws; the superior alveolar nerves, the inferior alveolar vein and the pterygoid plexus are schematic. V1, VII, IX, X and XII additions, skull-exit markers and joint movement are schematic teaching examples. The maxillary sinuses are modeled inside the maxilla, as neither source includes them.',
  note: 'Dental Scope is an educational reference. It is not intended for diagnosis, treatment planning or clinical decisions.',
  footer: 'Free 3D dental anatomy',
  madeBy: 'Made by',
  otherLanguages: 'Language',
};

const sv: AboutText = {
  htmlLang: 'sv',
  title: 'Om Dental Scope: gratis interaktiv 3D-atlas över tandanatomi',
  description:
    'En gratis 3D-tandatlas med öppen källkod för tandläkarstudenter: varje permanent tand, tandnumrering, tandvävnader, käkar, nerver och muskler, förklarade.',
  openExplorer: 'Öppna 3D-utforskaren →',
  h1: 'Dental Scope: gratis interaktiv tandanatomi i 3D',
  lede: 'Dental Scope är en gratis 3D-utforskare av tandanatomi med öppen källkod. Rotera en hel skalle och båda käkarna, välj vilken som helst av de 32 permanenta tänderna och dissekera en tand lager för lager, från emalj och dentin ner till pulpan och rotkanalerna. Den körs i webbläsaren utan att något behöver installeras.',
  toc: ['Funktioner', 'Alla 32 tänder', 'Tandnumrering', 'Tandtyper', 'Anatomisk ordlista', 'Vanliga frågor', 'Anatomiska källor'],
  onThisPage: 'På den här sidan',
  featuresTitle: 'Vad du kan göra',
  features: [
    ['Utforska hela munnen i 3D', 'skalle, överkäke, underkäke, tandkött och alla permanenta tänder, inklusive tredje molarerna (visdomständerna).'],
    ['Se in i varje tand', 'emalj, dentin, rotcement, parodontalligament, pulpakammare, pulpahorn och rotkanaler.'],
    ['Dissekera anatomin', 'separera lagren steg för steg, eller lägg ut varje struktur sida vid sida.'],
    ['Snittvy', 'skär genom modellen och se tvärsnitt av tänder och ben.'],
    ['Tre numreringssystem', 'FDI (ISO 3950), Universal (ADA) och Palmer, som du kan växla mellan när som helst.'],
    ['Nerver, kärl och muskler', 'n. alveolaris inferior, n. lingualis och de övre alveolarnerverna, käkleden och tuggmusklerna.'],
    ['Sök', 'efter valfri struktur eller tand med namn eller nummer.'],
    ['Engelska, svenska, tyska, spanska och latin', 'byt språk med flaggorna högst upp i utforskaren.'],
  ],
  teethTitle: 'Alla 32 permanenta tänder',
  teethIntro: 'Varje länk öppnar 3D-utforskaren med den tanden vald.',
  quadrants: ['Övre höger (FDI-kvadrant 1)', 'Övre vänster (FDI-kvadrant 2)', 'Nedre vänster (FDI-kvadrant 3)', 'Nedre höger (FDI-kvadrant 4)'],
  numberingTitle: 'Tandnumreringssystem',
  numberingIntro:
    'Tandläkare anger tänder med en kort kod. Dental Scope visar alla tre system som används i dag, så att du kan lära dig läsa vart och ett. Ta underkäkens vänstra första molar som exempel:',
  numberingHead: ['System', 'Så fungerar det', 'Vänster första molar i underkäken'],
  numberingRows: [
    ['FDI (ISO 3950)', 'Två siffror: kvadranten (1 övre höger, 2 övre vänster, 3 nedre vänster, 4 nedre höger) och sedan positionen från mittlinjen (1 central incisiv till 8 tredje molar). Används i större delen av världen, även i Sverige.', '36'],
    ['Universal (ADA)', 'Nummer 1 till 32, med start vid överkäkens högra tredje molar, längs överkäkens tandbåge till vänster sida och sedan tillbaka längs underkäkens tandbåge från vänster tredje molar till höger. Används främst i USA.', '#19'],
    ['Palmer', 'En kvadrantsymbol med positionsnumret 1 till 8, här skriven i textform som UR, UL, LL eller LR (engelska förkortningar för övre höger, övre vänster, nedre vänster, nedre höger) följt av positionen. Vanlig i Storbritannien och inom ortodonti.', 'LL6'],
  ],
  typesTitle: 'Tandtyper',
  typesIntro:
    'Den permanenta tandsättningen har åtta tänder i varje kvadrant: två incisiver, en hörntand, två premolarer och tre molarer. Typiska läroboksvärden visas; den individuella anatomin varierar.',
  upper: 'övre',
  lower: 'nedre',
  functionLabel: 'Funktion.',
  notesLabel: 'Kliniskt.',
  rootsLabel: 'Rötter',
  canalsLabel: 'Rotkanaler',
  eruptionLabel: 'Eruption',
  viewIn3d: 'Visa i 3D:',
  glossaryTitle: 'Ordlista för tandanatomi',
  glossaryIntro: 'Strukturerna du kan välja i 3D-modellen, kortfattat.',
  glossaryGroups: ['Tandens delar', 'Tandvävnader', 'Parodontium (tandens stödjevävnader)', 'Käkar och käkled', 'Nerver och kärl', 'Tuggmuskler och ansiktsmuskler'],
  termNames: {
    crown: 'Krona',
    root: 'Rot',
    cej: 'Emalj-cementgränsen (ECG)',
    apex: 'Rotspets (apex)',
    enamel: 'Emalj',
    dentin: 'Dentin',
    cementum: 'Rotcement',
    pulp: 'Pulpa',
    'pulp-chamber': 'Pulpakammare',
    'pulp-horn': 'Pulpahorn',
    'root-canals': 'Rotkanaler',
    'apical-foramen': 'Foramen apicale',
    periodontium: 'Parodontium',
    gingiva: 'Gingiva (tandkött)',
    pdl: 'Parodontalligament (PDL)',
    'maxillary-alveolar-process': 'Överkäkens alveolarutskott',
    'mandibular-alveolar-process': 'Underkäkens alveolarutskott',
    maxilla: 'Maxilla (överkäke)',
    mandible: 'Mandibel (underkäke)',
    'mandibular-condyle': 'Underkäkens ledhuvud',
    tmj: 'Käkleden (TMJ)',
    'articular-disc': 'Ledskiva (discus articularis)',
    'mandibular-foramen': 'Foramen mandibulae',
    'mental-foramen': 'Foramen mentale',
    'inferior-alveolar-nerve': 'Nervus alveolaris inferior',
    'mental-nerve': 'Nervus mentalis',
    'incisive-nerve': 'Nervus incisivus',
    'lingual-nerve': 'Nervus lingualis',
    'infraorbital-nerve': 'Nervus infraorbitalis',
    'posterior-superior-alveolar-nerve': 'Rami alveolares superiores posteriores',
    'middle-superior-alveolar-nerve': 'Ramus alveolaris superior medius',
    'anterior-superior-alveolar-nerve': 'Rami alveolares superiores anteriores',
    'greater-palatine-nerve': 'Nervus palatinus major',
    'nasopalatine-nerve': 'Nervus nasopalatinus',
    'inferior-alveolar-artery': 'Arteria alveolaris inferior',
    masseter: 'Musculus masseter',
    temporalis: 'Musculus temporalis',
    'medial-pterygoid': 'Musculus pterygoideus medialis',
    'lateral-pterygoid': 'Musculus pterygoideus lateralis',
    buccinator: 'Musculus buccinator',
    'orbicularis-oris': 'Musculus orbicularis oris',
    mentalis: 'Musculus mentalis',
  },
  faqTitle: 'Vanliga frågor',
  faq: [
    {
      q: 'Vad är Dental Scope?',
      a: 'Dental Scope är en gratis, interaktiv 3D-modell av människans tandanatomi med öppen källkod som körs i webbläsaren. Du kan rotera skallen och käkarna, välja vilken som helst av de 32 permanenta tänderna, skala bort emalj och dentin för att se pulpan och rotkanalerna, och titta på nerverna, kärlen och musklerna runt tänderna.',
    },
    {
      q: 'Är Dental Scope gratis?',
      a: 'Ja. Det är gratis att använda utan konto eller installation, och källkoden är öppen under MIT-licensen. 3D-anatomin är härledd från BodyParts3D och delas under CC BY-SA 2.1 Japan.',
    },
    {
      q: 'Vem är det till för?',
      a: 'Tandläkarstudenter, tandhygieniststudenter och blivande tandsköterskor, lärare som vill visa en 3D-modell i undervisningen och alla som är nyfikna på hur tänder är uppbyggda och numrerade.',
    },
    {
      q: 'Vilka tandnumreringssystem stöds?',
      a: 'Alla tre vanliga system. FDI-systemet (ISO 3950), som används i Sverige, har två siffror: kvadrant och sedan position, så underkäkens vänstra första molar är 36. Universal-systemet, som används i USA, numrerar tänderna 1 till 32, vilket gör samma tand till #19. Palmer-notationen anger kvadrant och position, här LL6. Växla mellan dem med knapparna FDI, UNI och PAL.',
    },
    {
      q: 'Kan jag se inuti en tand?',
      a: 'Ja. Välj en tand och öppna Dissekera anatomin för att dela upp den i emalj, dentin, rotcement, parodontalligament, pulpakammare och rotkanaler, eller använd Snitt-verktyget för att skära genom modellen.',
    },
    {
      q: 'Fungerar det på mobiler och surfplattor?',
      a: 'Ja, i alla aktuella versioner av Chrome, Edge, Firefox och Safari med WebGL, på dator, surfplatta och mobil.',
    },
    {
      q: 'Vilka språk finns det på?',
      a: 'Engelska, svenska, tyska, spanska och latin. Hela utforskaren är översatt, även de anatomiska namnen och beskrivningarna; välj språk med flaggorna högst upp.',
    },
    {
      q: 'Kan Dental Scope användas för diagnostik?',
      a: 'Nej. Dental Scope är enbart ett referensmaterial för utbildning. Tändernas inre vävnader är modellerade med förenklade proportioner och nerver och kärl följer en anatomisk atlas, inte mätningar på en enskild person, så det får inte användas för diagnostik, behandlingsplanering eller kliniska beslut.',
    },
  ],
  creditsTitle: 'Anatomiska källor och licenser',
  creditsHtml:
    'Skapad av {author}. Källkoden finns på <a href="{repo}" rel="noopener">GitHub</a>. Käkarna, tänderna, skallen och musklerna kommer från <a href="{bp3d}" rel="noopener">BodyParts3D</a>, © The Database Center for Life Science, licensierat under <a href="{licence}" rel="noopener">CC Attribution-Share Alike 2.1 Japan</a>. Tredje molarerna, tandköttet, alveolarbenet och käkleden är härledda från dessa modeller; emalj, dentin, rotcement, parodontalligament, pulpa och kanaler är modellerade med förenklade proportioner. De dentala nerv- och kärlförloppen följer <a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" rel="noopener">Z-Anatomy</a>-atlasen (CC BY-SA 4.0), anpassad till de här käkarna; de övre alveolarnerverna, v. alveolaris inferior och plexus pterygoideus är schematiska. Tilläggen V1, VII, IX, X och XII, markörer för skallens nervutgångar och käkledsrörelsen är schematiska undervisningsexempel. Bihålorna i överkäken är modellerade inuti överkäken, eftersom ingen av källorna innehåller dem.',
  note: 'Dental Scope är ett referensmaterial för utbildning. Det är inte avsett för diagnostik, behandlingsplanering eller kliniska beslut.',
  footer: 'Gratis tandanatomi i 3D',
  madeBy: 'Skapad av',
  otherLanguages: 'Språk',
};

const de: AboutText = {
  htmlLang: 'de',
  title: 'Über Dental Scope: kostenloser interaktiver 3D-Atlas der Zahnanatomie',
  description:
    'Ein kostenloser Open-Source-3D-Zahnatlas für Zahnmedizinstudierende: jeder bleibende Zahn, Zahnschemata, Zahngewebe, Kiefer, Nerven und Muskeln erklärt.',
  openExplorer: '3D-Explorer öffnen →',
  h1: 'Dental Scope: kostenlose interaktive Zahnanatomie in 3D',
  lede: 'Dental Scope ist ein kostenloser Open-Source-3D-Explorer der Zahnanatomie. Drehe einen vollständigen Schädel mit beiden Kiefern, wähle einen der 32 bleibenden Zähne und zerlege einen Zahn Schicht für Schicht, vom Schmelz und Dentin bis zur Pulpa und zu den Wurzelkanälen. Er läuft im Browser, ohne dass etwas installiert werden muss.',
  toc: ['Funktionen', 'Alle 32 Zähne', 'Zahnschemata', 'Zahntypen', 'Anatomie-Glossar', 'Häufige Fragen', 'Anatomische Quellen'],
  onThisPage: 'Auf dieser Seite',
  featuresTitle: 'Was du tun kannst',
  features: [
    ['Den ganzen Mund in 3D erkunden', 'Schädel, Oberkiefer, Unterkiefer, Zahnfleisch und alle bleibenden Zähne, einschließlich der Weisheitszähne (dritte Molaren).'],
    ['In jeden Zahn hineinsehen', 'Zahnschmelz, Dentin, Wurzelzement, Desmodont, Pulpakammer, Pulpahörner und Wurzelkanäle.'],
    ['Anatomie zerlegen', 'die Schichten Schritt für Schritt trennen oder jede Struktur nebeneinander auslegen.'],
    ['Schnittansicht', 'durch das Modell schneiden und Querschnitte von Zähnen und Knochen betrachten.'],
    ['Drei Zahnschemata', 'FDI (ISO 3950), Universal (ADA) und Palmer, jederzeit umschaltbar.'],
    ['Nerven, Gefäße und Muskeln', 'N. alveolaris inferior, N. lingualis und die oberen Alveolarnerven, das Kiefergelenk und die Kaumuskulatur.'],
    ['Suche', 'nach jeder Struktur und jedem Zahn über Name oder Nummer.'],
    ['Englisch, Schwedisch, Deutsch, Spanisch und Latein', 'die Sprache über die Flaggen oben im Explorer umschalten.'],
  ],
  teethTitle: 'Alle 32 bleibenden Zähne',
  teethIntro: 'Jeder Link öffnet den 3D-Explorer mit dem ausgewählten Zahn.',
  quadrants: ['Oben rechts (FDI-Quadrant 1)', 'Oben links (FDI-Quadrant 2)', 'Unten links (FDI-Quadrant 3)', 'Unten rechts (FDI-Quadrant 4)'],
  numberingTitle: 'Zahnschemata',
  numberingIntro:
    'In der Zahnmedizin werden Zähne mit einem kurzen Code bezeichnet. Dental Scope zeigt alle drei gebräuchlichen Systeme, damit du jedes lesen lernst. Als Beispiel dient der erste Molar im Unterkiefer links:',
  numberingHead: ['System', 'So funktioniert es', 'Erster Molar im Unterkiefer links'],
  numberingRows: [
    ['FDI (ISO 3950)', 'Zwei Ziffern: der Quadrant (1 oben rechts, 2 oben links, 3 unten links, 4 unten rechts), dann die Position ab der Mittellinie (1 mittlerer Schneidezahn bis 8 Weisheitszahn). Weltweit am weitesten verbreitet, auch in Deutschland, Österreich und der Schweiz.', '36'],
    ['Universal (ADA)', 'Die Zahlen 1 bis 32, beginnend beim oberen rechten Weisheitszahn, entlang des oberen Zahnbogens nach links und dann zurück entlang des unteren Zahnbogens vom unteren linken Weisheitszahn nach rechts. Vor allem in den USA gebräuchlich.', '#19'],
    ['Palmer', 'Ein Quadrantensymbol mit der Positionsnummer 1 bis 8, hier in Textform als UR, UL, LL oder LR (englische Abkürzungen für oben rechts, oben links, unten links, unten rechts) plus Position geschrieben. Verbreitet in Großbritannien und in der Kieferorthopädie.', 'LL6'],
  ],
  typesTitle: 'Zahntypen',
  typesIntro:
    'Das bleibende Gebiss hat acht Zähne pro Quadrant: zwei Schneidezähne, einen Eckzahn, zwei Prämolaren und drei Molaren. Gezeigt werden typische Lehrbuchwerte; die individuelle Anatomie variiert.',
  upper: 'oben',
  lower: 'unten',
  functionLabel: 'Funktion.',
  notesLabel: 'Klinisches.',
  rootsLabel: 'Wurzeln',
  canalsLabel: 'Wurzelkanäle',
  eruptionLabel: 'Durchbruch',
  viewIn3d: 'In 3D ansehen:',
  glossaryTitle: 'Glossar der Zahnanatomie',
  glossaryIntro: 'Die Strukturen, die du im 3D-Modell auswählen kannst, in Kürze.',
  glossaryGroups: ['Teile des Zahns', 'Zahngewebe', 'Parodontium (Zahnhalteapparat)', 'Kiefer und Kiefergelenk', 'Nerven und Gefäße', 'Kau- und Gesichtsmuskulatur'],
  termNames: {
    crown: 'Krone',
    root: 'Wurzel',
    cej: 'Schmelz-Zement-Grenze (SZG)',
    apex: 'Wurzelspitze (Apex)',
    enamel: 'Zahnschmelz',
    dentin: 'Dentin',
    cementum: 'Wurzelzement',
    pulp: 'Zahnpulpa',
    'pulp-chamber': 'Pulpakammer',
    'pulp-horn': 'Pulpahorn',
    'root-canals': 'Wurzelkanäle',
    'apical-foramen': 'Foramen apicale',
    periodontium: 'Parodontium (Zahnhalteapparat)',
    gingiva: 'Gingiva (Zahnfleisch)',
    pdl: 'Desmodont (Wurzelhaut)',
    'maxillary-alveolar-process': 'Alveolarfortsatz des Oberkiefers',
    'mandibular-alveolar-process': 'Alveolarfortsatz des Unterkiefers',
    maxilla: 'Oberkiefer (Maxilla)',
    mandible: 'Unterkiefer (Mandibula)',
    'mandibular-condyle': 'Unterkieferköpfchen',
    tmj: 'Kiefergelenk',
    'articular-disc': 'Discus articularis',
    'mandibular-foramen': 'Foramen mandibulae',
    'mental-foramen': 'Foramen mentale',
    'inferior-alveolar-nerve': 'Nervus alveolaris inferior',
    'mental-nerve': 'Nervus mentalis',
    'incisive-nerve': 'Nervus incisivus',
    'lingual-nerve': 'Nervus lingualis',
    'infraorbital-nerve': 'Nervus infraorbitalis',
    'posterior-superior-alveolar-nerve': 'Rami alveolares superiores posteriores',
    'middle-superior-alveolar-nerve': 'Ramus alveolaris superior medius',
    'anterior-superior-alveolar-nerve': 'Rami alveolares superiores anteriores',
    'greater-palatine-nerve': 'Nervus palatinus major',
    'nasopalatine-nerve': 'Nervus nasopalatinus',
    'inferior-alveolar-artery': 'Arteria alveolaris inferior',
    masseter: 'Musculus masseter',
    temporalis: 'Musculus temporalis',
    'medial-pterygoid': 'Musculus pterygoideus medialis',
    'lateral-pterygoid': 'Musculus pterygoideus lateralis',
    buccinator: 'Musculus buccinator',
    'orbicularis-oris': 'Musculus orbicularis oris',
    mentalis: 'Musculus mentalis',
  },
  faqTitle: 'Häufige Fragen',
  faq: [
    {
      q: 'Was ist Dental Scope?',
      a: 'Dental Scope ist ein kostenloses, interaktives Open-Source-3D-Modell der menschlichen Zahnanatomie, das im Webbrowser läuft. Du kannst Schädel und Kiefer drehen, jeden der 32 bleibenden Zähne auswählen, Schmelz und Dentin abtragen, um Pulpa und Wurzelkanäle zu sehen, und die Nerven, Gefäße und Muskeln rund um die Zähne betrachten.',
    },
    {
      q: 'Ist Dental Scope kostenlos?',
      a: 'Ja. Die Nutzung ist kostenlos, ohne Konto und ohne Installation, und der Quellcode ist unter der MIT-Lizenz offen. Die 3D-Anatomie ist aus BodyParts3D abgeleitet und steht unter CC BY-SA 2.1 Japan.',
    },
    {
      q: 'Für wen ist es gedacht?',
      a: 'Für Studierende der Zahnmedizin, angehende Dentalhygieniker und zahnmedizinische Fachangestellte, Lehrende, die im Unterricht ein 3D-Modell zeigen möchten, und alle, die neugierig sind, wie Zähne aufgebaut und nummeriert sind.',
    },
    {
      q: 'Welche Zahnschemata werden unterstützt?',
      a: 'Alle drei gebräuchlichen Systeme. Das FDI-Zahnschema (ISO 3950), das im deutschsprachigen Raum verwendet wird, hat zwei Ziffern: Quadrant und Position, der erste Molar im Unterkiefer links ist also 36. Das in den USA verwendete Universal-System nummeriert die Zähne von 1 bis 32, derselbe Zahn ist dort #19. Die Palmer-Notation gibt Quadrant und Position an, hier LL6. Umschalten kannst du mit den Schaltflächen FDI, UNI und PAL.',
    },
    {
      q: 'Kann ich in einen Zahn hineinsehen?',
      a: 'Ja. Wähle einen Zahn und öffne „Anatomie zerlegen“, um ihn in Zahnschmelz, Dentin, Wurzelzement, Desmodont, Pulpakammer und Wurzelkanäle zu trennen, oder schneide mit dem Werkzeug „Schnitt“ durch das Modell.',
    },
    {
      q: 'Funktioniert es auf Smartphones und Tablets?',
      a: 'Ja, in jeder aktuellen Version von Chrome, Edge, Firefox oder Safari mit WebGL, auf Computer, Tablet oder Smartphone.',
    },
    {
      q: 'In welchen Sprachen ist es verfügbar?',
      a: 'Englisch, Schwedisch, Deutsch, Spanisch und Latein. Der gesamte Explorer ist übersetzt, einschließlich der anatomischen Bezeichnungen und Beschreibungen; die Sprache wählst du über die Flaggen oben.',
    },
    {
      q: 'Kann Dental Scope zur Diagnose verwendet werden?',
      a: 'Nein. Dental Scope ist ausschließlich ein Nachschlagewerk für die Lehre. Die inneren Zahngewebe sind mit vereinfachten Proportionen modelliert und Nerven und Gefäße folgen einem anatomischen Atlas statt Messungen an einer einzelnen Person, daher darf es nicht für Diagnosen, Behandlungsplanung oder klinische Entscheidungen verwendet werden.',
    },
  ],
  creditsTitle: 'Anatomische Quellen und Lizenzen',
  creditsHtml:
    'Erstellt von {author}. Der Quellcode liegt auf <a href="{repo}" rel="noopener">GitHub</a>. Kiefer, Zähne, Schädel und Muskeln stammen aus <a href="{bp3d}" rel="noopener">BodyParts3D</a>, © The Database Center for Life Science, lizenziert unter <a href="{licence}" rel="noopener">CC Attribution-Share Alike 2.1 Japan</a>. Weisheitszähne, Zahnfleisch, Alveolarknochen und Kiefergelenk sind aus diesen Modellen abgeleitet; Zahnschmelz, Dentin, Wurzelzement, Desmodont, Pulpa und Kanäle sind mit vereinfachten Proportionen modelliert. Die dentalen Nerven- und Gefäßverläufe folgen dem <a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" rel="noopener">Z-Anatomy</a>-Atlas (CC BY-SA 4.0), angepasst an diese Kiefer; die oberen Alveolarnerven, die V. alveolaris inferior und der Plexus pterygoideus sind schematisch. Die Ergänzungen V1, VII, IX, X und XII, Schädelöffnungspunkte und Gelenkbewegung sind schematische Lehrbeispiele. Die Kieferhöhlen sind in den Oberkiefer hineinmodelliert, da keine der Quellen sie enthält.',
  note: 'Dental Scope ist ein Nachschlagewerk für die Lehre. Es ist nicht für Diagnosen, Behandlungsplanung oder klinische Entscheidungen bestimmt.',
  footer: 'Kostenlose Zahnanatomie in 3D',
  madeBy: 'Erstellt von',
  otherLanguages: 'Sprache',
};

const es: AboutText = {
  htmlLang: 'es',
  title: 'Acerca de Dental Scope: atlas gratuito e interactivo de anatomía dental en 3D',
  description:
    'Atlas dental 3D gratuito y de código abierto para estudiantes de odontología: cada diente permanente, numeración dental, tejidos, maxilares, nervios y músculos.',
  openExplorer: 'Abrir el explorador 3D →',
  h1: 'Dental Scope: anatomía dental interactiva en 3D, gratis',
  lede: 'Dental Scope es un explorador 3D de anatomía dental gratuito y de código abierto. Gira un cráneo completo y ambos maxilares, elige cualquiera de los 32 dientes permanentes y disecciona un diente capa a capa, desde el esmalte y la dentina hasta la pulpa y los conductos radiculares. Funciona en el navegador, sin instalar nada.',
  toc: ['Funciones', 'Los 32 dientes', 'Numeración dental', 'Tipos de dientes', 'Glosario anatómico', 'Preguntas frecuentes', 'Fuentes anatómicas'],
  onThisPage: 'En esta página',
  featuresTitle: 'Qué puedes hacer',
  features: [
    ['Explorar toda la boca en 3D', 'cráneo, maxilar, mandíbula, encía y todos los dientes permanentes, incluidos los terceros molares (muelas del juicio).'],
    ['Ver el interior de cada diente', 'esmalte, dentina, cemento, ligamento periodontal, cámara pulpar, cuernos pulpares y conductos radiculares.'],
    ['Diseccionar la anatomía', 'separa las capas paso a paso o despliega todas las estructuras una junto a otra.'],
    ['Vista en corte', 'corta el modelo para ver secciones de los dientes y del hueso.'],
    ['Tres sistemas de numeración', 'FDI (ISO 3950), Universal (ADA) y Palmer, intercambiables en cualquier momento.'],
    ['Nervios, vasos y músculos', 'nervios alveolar inferior, lingual y alveolares superiores, la articulación temporomandibular y los músculos de la masticación.'],
    ['Búsqueda', 'cualquier estructura o diente por su nombre o su número.'],
    ['Inglés, sueco, alemán, español y latín', 'cambia el idioma con las banderas de la parte superior del explorador.'],
  ],
  teethTitle: 'Los 32 dientes permanentes',
  teethIntro: 'Cada enlace abre el explorador 3D con ese diente seleccionado.',
  quadrants: ['Superior derecho (cuadrante FDI 1)', 'Superior izquierdo (cuadrante FDI 2)', 'Inferior izquierdo (cuadrante FDI 3)', 'Inferior derecho (cuadrante FDI 4)'],
  numberingTitle: 'Sistemas de numeración dental',
  numberingIntro:
    'Los dentistas nombran los dientes con un código corto. Dental Scope muestra los tres sistemas de uso habitual, para que aprendas a leer cada uno. Tomemos como ejemplo el primer molar inferior izquierdo:',
  numberingHead: ['Sistema', 'Cómo funciona', 'Primer molar inferior izquierdo'],
  numberingRows: [
    ['FDI (ISO 3950)', 'Dos dígitos: el cuadrante (1 superior derecho, 2 superior izquierdo, 3 inferior izquierdo, 4 inferior derecho) y después la posición desde la línea media (del 1, incisivo central, al 8, tercer molar). Es el sistema usado en España y en la mayor parte del mundo.', '36'],
    ['Universal (ADA)', 'Números del 1 al 32, empezando por el tercer molar superior derecho, recorriendo la arcada superior hasta el lado izquierdo y volviendo por la arcada inferior desde el tercer molar inferior izquierdo hasta el derecho. Se usa sobre todo en Estados Unidos.', '#19'],
    ['Palmer', 'Un símbolo de cuadrante con el número de posición del 1 al 8, escrito aquí en forma de texto como UR, UL, LL o LR (abreviaturas inglesas de superior derecho, superior izquierdo, inferior izquierdo e inferior derecho) más la posición. Habitual en el Reino Unido y en ortodoncia.', 'LL6'],
  ],
  typesTitle: 'Tipos de dientes',
  typesIntro:
    'La dentición permanente tiene ocho dientes en cada cuadrante: dos incisivos, un canino, dos premolares y tres molares. Se muestran los valores típicos de los libros de texto; la anatomía individual varía.',
  upper: 'superior',
  lower: 'inferior',
  functionLabel: 'Función.',
  notesLabel: 'Notas.',
  rootsLabel: 'Raíces',
  canalsLabel: 'Conductos radiculares',
  eruptionLabel: 'Erupción',
  viewIn3d: 'Ver en 3D:',
  glossaryTitle: 'Glosario de anatomía dental',
  glossaryIntro: 'Las estructuras que puedes seleccionar en el modelo 3D, en pocas palabras.',
  glossaryGroups: ['Partes del diente', 'Tejidos dentales', 'Periodonto (tejidos de soporte)', 'Maxilares y articulación', 'Nervios y vasos', 'Músculos de la masticación y de la cara'],
  termNames: {
    crown: 'Corona',
    root: 'Raíz',
    cej: 'Unión amelocementaria (UAC)',
    apex: 'Ápice radicular',
    enamel: 'Esmalte',
    dentin: 'Dentina',
    cementum: 'Cemento',
    pulp: 'Pulpa dental',
    'pulp-chamber': 'Cámara pulpar',
    'pulp-horn': 'Cuerno pulpar',
    'root-canals': 'Conductos radiculares',
    'apical-foramen': 'Foramen apical',
    periodontium: 'Periodonto',
    gingiva: 'Encía',
    pdl: 'Ligamento periodontal (LPD)',
    'maxillary-alveolar-process': 'Apófisis alveolar del maxilar',
    'mandibular-alveolar-process': 'Porción alveolar de la mandíbula',
    maxilla: 'Maxilar',
    mandible: 'Mandíbula',
    'mandibular-condyle': 'Cóndilo mandibular',
    tmj: 'Articulación temporomandibular (ATM)',
    'articular-disc': 'Disco articular',
    'mandibular-foramen': 'Agujero mandibular',
    'mental-foramen': 'Agujero mentoniano',
    'inferior-alveolar-nerve': 'Nervio alveolar inferior',
    'mental-nerve': 'Nervio mentoniano',
    'incisive-nerve': 'Nervio incisivo',
    'lingual-nerve': 'Nervio lingual',
    'infraorbital-nerve': 'Nervio infraorbitario',
    'posterior-superior-alveolar-nerve': 'Nervios alveolares superiores posteriores',
    'middle-superior-alveolar-nerve': 'Nervio alveolar superior medio',
    'anterior-superior-alveolar-nerve': 'Nervios alveolares superiores anteriores',
    'greater-palatine-nerve': 'Nervio palatino mayor',
    'nasopalatine-nerve': 'Nervio nasopalatino',
    'inferior-alveolar-artery': 'Arteria alveolar inferior',
    masseter: 'Músculo masetero',
    temporalis: 'Músculo temporal',
    'medial-pterygoid': 'Músculo pterigoideo medial',
    'lateral-pterygoid': 'Músculo pterigoideo lateral',
    buccinator: 'Músculo buccinador',
    'orbicularis-oris': 'Músculo orbicular de la boca',
    mentalis: 'Músculo mentoniano',
  },
  faqTitle: 'Preguntas frecuentes',
  faq: [
    {
      q: '¿Qué es Dental Scope?',
      a: 'Dental Scope es un modelo 3D interactivo, gratuito y de código abierto de la anatomía dental humana que funciona en el navegador. Puedes girar el cráneo y los maxilares, seleccionar cualquiera de los 32 dientes permanentes, retirar el esmalte y la dentina para ver la pulpa y los conductos radiculares, y observar los nervios, los vasos y los músculos que rodean los dientes.',
    },
    {
      q: '¿Dental Scope es gratuito?',
      a: 'Sí. Se usa gratis, sin cuenta ni instalación, y su código fuente es abierto bajo la licencia MIT. La anatomía 3D se deriva de BodyParts3D y se comparte bajo CC BY-SA 2.1 Japan.',
    },
    {
      q: '¿Para quién es?',
      a: 'Para estudiantes de odontología, de higiene bucodental y de técnico en cuidados auxiliares, para docentes que quieren un modelo 3D para mostrar en clase y para cualquier persona con curiosidad por cómo están formados y numerados los dientes.',
    },
    {
      q: '¿Qué sistemas de numeración dental admite?',
      a: 'Los tres sistemas habituales. El sistema de la FDI (ISO 3950) usa dos dígitos: cuadrante y posición, así que el primer molar inferior izquierdo es el 36. El sistema Universal que se usa en Estados Unidos numera los dientes del 1 al 32, de modo que el mismo diente es el #19. La notación de Palmer escribe el cuadrante y la posición, aquí LL6. Puedes cambiar entre ellos con los botones FDI, UNI y PAL.',
    },
    {
      q: '¿Puedo ver el interior de un diente?',
      a: 'Sí. Selecciona un diente y abre Diseccionar la anatomía para separarlo en esmalte, dentina, cemento, ligamento periodontal, cámara pulpar y conductos radiculares, o usa la herramienta de corte para seccionar el modelo.',
    },
    {
      q: '¿Funciona en móviles y tabletas?',
      a: 'Sí, en cualquier versión actual de Chrome, Edge, Firefox o Safari con WebGL, en ordenador, tableta o móvil.',
    },
    {
      q: '¿En qué idiomas está disponible?',
      a: 'En inglés, sueco, alemán, español y latín. Todo el explorador está traducido, incluidos los nombres anatómicos y las descripciones; elige el idioma con las banderas de la parte superior.',
    },
    {
      q: '¿Se puede usar Dental Scope para diagnosticar?',
      a: 'No. Dental Scope es solo una referencia educativa. Los tejidos internos del diente se modelan con proporciones simplificadas, y los nervios y vasos siguen un atlas anatómico en lugar de mediciones de una persona concreta, por lo que no debe usarse para diagnosticar, planificar tratamientos ni tomar decisiones clínicas.',
    },
  ],
  creditsTitle: 'Fuentes anatómicas y licencias',
  creditsHtml:
    'Creado por {author}. El código fuente está en <a href="{repo}" rel="noopener">GitHub</a>. Los maxilares, los dientes, el cráneo y los músculos proceden de <a href="{bp3d}" rel="noopener">BodyParts3D</a>, © The Database Center for Life Science, con licencia <a href="{licence}" rel="noopener">CC Attribution-Share Alike 2.1 Japan</a>. Los terceros molares, la encía, el hueso alveolar y la articulación se derivan de esos modelos; el esmalte, la dentina, el cemento, el ligamento periodontal, la pulpa y los conductos se modelan con proporciones simplificadas. Los trayectos dentales de nervios y vasos siguen el atlas <a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" rel="noopener">Z-Anatomy</a> (CC BY-SA 4.0), ajustado a estos maxilares; los nervios alveolares superiores, la vena alveolar inferior y el plexo pterigoideo son esquemáticos. Las adiciones V1, VII, IX, X y XII, los puntos de salida del cráneo y el movimiento articular son ejemplos didácticos esquemáticos. Los senos maxilares están modelados dentro del maxilar, ya que ninguna de las fuentes los incluye.',
  note: 'Dental Scope es una referencia educativa. No está destinada al diagnóstico, la planificación de tratamientos ni la toma de decisiones clínicas.',
  footer: 'Anatomía dental en 3D, gratis',
  madeBy: 'Creado por',
  otherLanguages: 'Idioma',
};

const la: AboutText = {
  htmlLang: 'la',
  title: 'De Dental Scope: atlas gratuitus et interactivus anatomiae dentalis tridimensionalis',
  description:
    'Atlas dentium tridimensionalis gratuitus, codice aperto, studiosis artis dentariae: dentes permanentes, numeratio, textus, maxillae, nervi et musculi.',
  openExplorer: 'Exploratorem tridimensionalem aperi →',
  h1: 'Dental Scope: anatomia dentalis tridimensionalis et interactiva, gratis',
  lede: 'Dental Scope est explorator anatomiae dentalis tridimensionalis, gratuitus et codice aperto. Cranium totum et ambas maxillas verte, quemlibet ex triginta duobus dentibus permanentibus elige, dentemque stratum post stratum disseca, ab enamelo et dentino usque ad pulpam et canales radicis. In navigatro currit, nihil instituendum est.',
  toc: ['Facultates', 'Omnes 32 dentes', 'Numeratio dentium', 'Genera dentium', 'Glossarium anatomicum', 'Quaestiones frequentes', 'Fontes anatomici'],
  onThisPage: 'In hac pagina',
  featuresTitle: 'Quid facere possis',
  features: [
    ['Totum os tridimensionaliter explora', 'cranium, maxillam, mandibulam, gingivam et omnes dentes permanentes, molaribus tertiis (dentibus serotinis) inclusis.'],
    ['Intra singulos dentes inspice', 'enamelum, dentinum, cementum, ligamentum periodontale, cavitatem coronae, cornua pulpae et canales radicis.'],
    ['Anatomiam disseca', 'strata gradatim separa aut omnes structuras alteram iuxta alteram expone.'],
    ['Aspectus sectionis', 'exemplar seca ut sectiones dentium et ossis videas.'],
    ['Tres rationes numerandi', 'FDI (ISO 3950), Universalis (ADA) et Palmer, quovis tempore mutabiles.'],
    ['Nervi, vasa et musculi', 'nervi alveolaris inferior, lingualis et alveolares superiores, articulatio temporomandibularis et musculi masticatorii.'],
    ['Quaestio', 'quamlibet structuram aut dentem nomine vel numero quaere.'],
    ['Anglice, Suecice, Germanice, Hispanice et Latine', 'linguam vexillis in summo exploratore muta.'],
  ],
  teethTitle: 'Omnes 32 dentes permanentes',
  teethIntro: 'Quisque nexus exploratorem tridimensionalem eo dente electo aperit.',
  quadrants: ['Superior dexter (quadrans FDI 1)', 'Superior sinister (quadrans FDI 2)', 'Inferior sinister (quadrans FDI 3)', 'Inferior dexter (quadrans FDI 4)'],
  numberingTitle: 'Rationes numerandi dentes',
  numberingIntro:
    'Medici dentarii dentes brevi nota nominant. Dental Scope omnes tres rationes usitatas ostendit, ut quamque legere discas. Exempli gratia sumatur dens molaris primus inferior sinister:',
  numberingHead: ['Ratio', 'Quomodo fiat', 'Dens molaris primus inferior sinister'],
  numberingRows: [
    ['FDI (ISO 3950)', 'Duae notae: quadrans (1 superior dexter, 2 superior sinister, 3 inferior sinister, 4 inferior dexter), deinde locus a linea mediana (ab 1, incisivo mediali, ad 8, molarem tertium). In maxima parte orbis terrarum adhibetur.', '36'],
    ['Universalis (ADA)', 'Numeri ab 1 ad 32, a molari tertio superiore dextro incipientes, per arcum superiorem ad sinistrum currentes, deinde per arcum inferiorem a molari tertio inferiore sinistro ad dextrum redeuntes. Praecipue in Civitatibus Foederatis adhibetur.', '#19'],
    ['Palmer', 'Signum quadrantis cum numero loci ab 1 ad 8, hic litteris scriptum ut UR, UL, LL vel LR (abbreviationes Anglicae pro superiore dextro, superiore sinistro, inferiore sinistro, inferiore dextro) cum loco. In Britannia et in orthodontia usitatum.', 'LL6'],
  ],
  typesTitle: 'Genera dentium',
  typesIntro:
    'Dentitio permanens in quoque quadrante octo dentes habet: duos incisivos, unum caninum, duos premolares et tres molares. Valores typici librorum ostenduntur; anatomia singulorum variat.',
  upper: 'superior',
  lower: 'inferior',
  functionLabel: 'Munus.',
  notesLabel: 'Adnotationes.',
  rootsLabel: 'Radices',
  canalsLabel: 'Canales radicis',
  eruptionLabel: 'Eruptio',
  viewIn3d: 'Tridimensionaliter inspice:',
  glossaryTitle: 'Glossarium anatomiae dentalis',
  glossaryIntro: 'Structurae quas in exemplari tridimensionali eligere potes, breviter.',
  glossaryGroups: ['Partes dentis', 'Textus dentis', 'Periodontium (textus sustinentes)', 'Maxillae et articulatio', 'Nervi et vasa', 'Musculi masticatorii et faciei'],
  termNames: {
    crown: 'Corona dentis',
    root: 'Radix dentis',
    cej: 'Linea cervicalis (junctura cementi et enameli)',
    apex: 'Apex radicis dentis',
    enamel: 'Enamelum',
    dentin: 'Dentinum',
    cementum: 'Cementum',
    pulp: 'Pulpa dentis',
    'pulp-chamber': 'Cavitas coronae',
    'pulp-horn': 'Cornu pulpae',
    'root-canals': 'Canales radicis dentis',
    'apical-foramen': 'Foramen apicis dentis',
    periodontium: 'Periodontium',
    gingiva: 'Gingiva',
    pdl: 'Ligamentum periodontale',
    'maxillary-alveolar-process': 'Processus alveolaris maxillae',
    'mandibular-alveolar-process': 'Pars alveolaris mandibulae',
    maxilla: 'Maxilla',
    mandible: 'Mandibula',
    'mandibular-condyle': 'Caput mandibulae',
    tmj: 'Articulatio temporomandibularis',
    'articular-disc': 'Discus articularis',
    'mandibular-foramen': 'Foramen mandibulae',
    'mental-foramen': 'Foramen mentale',
    'inferior-alveolar-nerve': 'Nervus alveolaris inferior',
    'mental-nerve': 'Nervus mentalis',
    'incisive-nerve': 'Nervus incisivus',
    'lingual-nerve': 'Nervus lingualis',
    'infraorbital-nerve': 'Nervus infraorbitalis',
    'posterior-superior-alveolar-nerve': 'Rami alveolares superiores posteriores',
    'middle-superior-alveolar-nerve': 'Ramus alveolaris superior medius',
    'anterior-superior-alveolar-nerve': 'Rami alveolares superiores anteriores',
    'greater-palatine-nerve': 'Nervus palatinus major',
    'nasopalatine-nerve': 'Nervus nasopalatinus',
    'inferior-alveolar-artery': 'Arteria alveolaris inferior',
    masseter: 'Musculus masseter',
    temporalis: 'Musculus temporalis',
    'medial-pterygoid': 'Musculus pterygoideus medialis',
    'lateral-pterygoid': 'Musculus pterygoideus lateralis',
    buccinator: 'Musculus buccinator',
    'orbicularis-oris': 'Musculus orbicularis oris',
    mentalis: 'Musculus mentalis',
  },
  faqTitle: 'Quaestiones frequentes',
  faq: [
    {
      q: 'Quid est Dental Scope?',
      a: 'Dental Scope est exemplar tridimensionale et interactivum anatomiae dentalis humanae, gratuitum et codice aperto, quod in navigatro currit. Cranium et maxillas vertere, quemlibet ex triginta duobus dentibus permanentibus eligere, enamelum et dentinum detrahere ut pulpam et canales radicis videas, nervosque, vasa et musculos circa dentes inspicere potes.',
    },
    {
      q: 'Estne Dental Scope gratuitum?',
      a: 'Est. Gratis adhibetur sine ratione usoris aut institutione, et codex eius sub licentia MIT apertus est. Anatomia tridimensionalis ex BodyParts3D derivatur et sub CC BY-SA 2.1 Japan communicatur.',
    },
    {
      q: 'Quibus destinatum est?',
      a: 'Studiosis artis dentariae, hygienae oris et assistentiae dentariae, magistris qui exemplar tridimensionale in schola ostendere volunt, omnibusque qui scire cupiunt quomodo dentes constructi et numerati sint.',
    },
    {
      q: 'Quas rationes numerandi dentes sustinet?',
      a: 'Omnes tres rationes usitatas. Ratio Foederationis Dentariae Mundialis FDI (ISO 3950) duas notas adhibet, quadrantem et locum, itaque dens molaris primus inferior sinister est 36. Ratio Universalis in Civitatibus Foederatis usitata dentes ab 1 ad 32 numerat, ut idem dens sit #19. Notatio Palmer quadrantem et locum scribit, hic LL6. Inter eas bullis FDI, UNI et PAL muta.',
    },
    {
      q: 'Possumne intra dentem inspicere?',
      a: 'Potes. Dentem elige et Anatomiam disseca aperi ut eum in enamelum, dentinum, cementum, ligamentum periodontale, cavitatem coronae et canales radicis separes, aut instrumento sectionis exemplar seca.',
    },
    {
      q: 'Operaturne in telephonis et tabulis?',
      a: 'Operatur, in quavis recenti versione Chrome, Edge, Firefox aut Safari cum WebGL, in computatro, tabula vel telephono.',
    },
    {
      q: 'Quibus linguis praesto est?',
      a: 'Anglice, Suecice, Germanice, Hispanice et Latine. Totus explorator conversus est, nominibus anatomicis et descriptionibus inclusis; linguam vexillis in summo elige.',
    },
    {
      q: 'Licetne Dental Scope ad diagnosim adhibere?',
      a: 'Non licet. Dental Scope tantum subsidium ad docendum est. Textus interni dentis proportionibus simplicibus finguntur, nervique et vasa atlantem anatomicum sequuntur, non mensuras unius hominis; itaque ad diagnosim, ad curationem instituendam aut ad consilia clinica adhiberi non debet.',
    },
  ],
  creditsTitle: 'Fontes anatomici et licentiae',
  creditsHtml:
    'Fecit {author}. Codex fontis in <a href="{repo}" rel="noopener">GitHub</a> est. Maxillae, dentes, cranium et musculi ex <a href="{bp3d}" rel="noopener">BodyParts3D</a> veniunt, © The Database Center for Life Science, sub licentia <a href="{licence}" rel="noopener">CC Attribution-Share Alike 2.1 Japan</a>. Molares tertii, gingiva, os alveolare et articulatio ex illis exemplaribus derivantur; enamelum, dentinum, cementum, ligamentum periodontale, pulpa et canales proportionibus simplicibus finguntur. Viae nervorum et vasorum dentalium atlantem <a href="https://github.com/Z-Anatomy/Models-of-human-anatomy" rel="noopener">Z-Anatomy</a> (CC BY-SA 4.0) sequuntur, his maxillis accommodatum; nervi alveolares superiores, vena alveolaris inferior et plexus pterygoideus schematici sunt. Additamenta V1, VII, IX, X et XII, signa exituum cranii et motus articulationis exempla didactica schematica sunt. Sinus maxillares intra maxillam ficti sunt, quia neuter fons eos continet.',
  note: 'Dental Scope subsidium ad docendum est. Non ad diagnosim, ad curationem instituendam aut ad consilia clinica destinatum est.',
  footer: 'Anatomia dentalis tridimensionalis, gratis',
  madeBy: 'Fecit',
  otherLanguages: 'Lingua',
};

export const ABOUT_TEXT: Record<Lang, AboutText> = { en, sv, de, es, la };
