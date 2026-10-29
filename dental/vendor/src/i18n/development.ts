import type { Lang } from './lang.ts';
import type { DevelopmentStageId, DevelopmentStatus } from '../anatomy/development.ts';

interface DevelopmentText {
  title: string; atlas: string; adult: string; years: string; stage: string; showUnerupted: string; jaw: string;
  play: string; pause: string; replay: string; softTissue: string; skullNote: string;
  note: string; draft: string; excluded: string; teeth: string; sources: string;
  primaryPrefix: string; permanentPrefix: string; upperArch: string; lowerArch: string;
  stages: Record<DevelopmentStageId, { title: string; summary: string }>;
  status: Record<DevelopmentStatus, string>;
}

export const DEVELOPMENT_TEXT: Record<Lang, DevelopmentText> = {
  en: {
    play: 'Play', pause: 'Pause', replay: 'Replay from beginning', softTissue: 'Supporting tissues', skullNote: '3D skull derived from adult atlas meshes, with illustrative younger proportions. Primary tooth shapes also use resized adult templates. Sutures, fontanelles and sinus growth are not reconstructed from pediatric imaging.',
    adult: 'Adult',
    title: 'Bite development', atlas: 'Adult anatomy', years: 'years', stage: 'Development stage', showUnerupted: 'Show teeth inside the jaws', jaw: 'Transparent jaw arches',
    note: 'Schematic example: ages and eruption vary between children. Shapes, positions and root lengths are illustrative; this is not a measured growth model or a dental-age assessment.',
    draft: 'Draft · awaiting expert review', excluded: 'Wisdom teeth are outside the scope of these childhood stages.', teeth: 'Teeth in this stage', sources: 'Medical sources',
    primaryPrefix: 'Primary', permanentPrefix: 'Permanent', upperArch: 'Developing maxillary dental arch', lowerArch: 'Developing mandibular dental arch',
    stages: {
      infant: { title: 'First primary teeth', summary: 'Primary incisors begin to emerge. Other primary teeth remain inside the jaws. Only permanent teeth whose calcification has begun are represented, with schematic crowns.' },
      toddler: { title: 'Primary tooth eruption', summary: 'Primary canines and molars join the incisors. The primary dentition becomes complete as the second primary molars erupt; permanent successors continue developing inside the jaws.' },
      primary: { title: 'Primary dentition', summary: 'The primary teeth occupy both arches. Permanent successors develop within the jaws; permanent molars develop behind the primary molars.' },
      'early-mixed': { title: 'Early mixed dentition', summary: 'First permanent molars and lower central incisors begin to emerge. The molars erupt behind the primary teeth without replacing a primary tooth.' },
      'incisor-transition': { title: 'Incisor transition', summary: 'Permanent incisors replace the primary incisors. Primary canines and molars remain alongside the permanent incisors and first molars.' },
      'late-mixed': { title: 'Canine and premolar transition', summary: 'Canines and premolars emerge at different times in the upper and lower arches. Premolars replace primary molars; other successors are still inside the jaws.' },
      permanent: { title: 'Young permanent dentition', summary: 'The primary teeth have been replaced in this example. Second permanent molars are emerging behind the first molars; root development can continue after eruption.' },
    },
    status: { primary: 'Primary tooth', unerupted: 'Inside the jaw', erupting: 'Erupting', erupted: 'Erupted permanent tooth', absent: 'Shed primary tooth' },
  },
  sv: {
    play: 'Spela', pause: 'Pausa', replay: 'Spela från början', softTissue: 'Omgivande vävnader', skullNote: '3D-skalle utifrån vuxenatlasens modeller, med illustrativa yngre proportioner. Mjölktändernas former utgår också från förminskade vuxentänder. Suturer, fontaneller och bihålornas tillväxt har inte rekonstruerats från barnavbildning.',
    adult: 'Vuxen',
    title: 'Bettets utveckling', atlas: 'Vuxenanatomi', years: 'år', stage: 'Utvecklingsstadium', showUnerupted: 'Visa tänder inne i käkarna', jaw: 'Genomskinliga käkbågar',
    note: 'Schematiskt exempel: åldrar och tandframbrott varierar mellan barn. Former, lägen och rotlängder är illustrativa; detta är ingen uppmätt tillväxtmodell eller bedömning av tandålder.',
    draft: 'Utkast · inväntar expertgranskning', excluded: 'Visdomständer ingår inte i dessa barndomsstadier.', teeth: 'Tänder i stadiet', sources: 'Medicinska källor',
    primaryPrefix: 'Mjölktand:', permanentPrefix: 'Permanent tand:', upperArch: 'Överkäkens tandbåge under utveckling', lowerArch: 'Underkäkens tandbåge under utveckling',
    stages: {
      infant: { title: 'De första mjölktänderna', summary: 'Mjölkframtänder börjar bryta fram. Andra mjölktänder finns fortfarande inne i käkarna. Endast permanenta tänder vars mineralisering har börjat visas, med schematiska kronor.' },
      toddler: { title: 'Mjölktändernas frambrott', summary: 'Mjölkhörntänder och mjölkmolarer tillkommer efter framtänderna. Mjölktandsbettet blir komplett när de andra mjölkmolarerna bryter fram; permanenta efterföljare fortsätter utvecklas inne i käkarna.' },
      primary: { title: 'Mjölktandsbett', summary: 'Mjölktänderna finns i båda tandbågarna. Permanenta efterföljare utvecklas inne i käkarna; permanenta molarer utvecklas bakom mjölkmolarerna.' },
      'early-mixed': { title: 'Tidigt växelbett', summary: 'De första permanenta molarerna och underkäkens centrala framtänder börjar bryta fram. Molarerna kommer bakom mjölktänderna utan att ersätta någon mjölktand.' },
      'incisor-transition': { title: 'Framtandsväxling', summary: 'Permanenta framtänder ersätter mjölkframtänderna. Mjölkhörntänder och mjölkmolarer finns kvar tillsammans med permanenta framtänder och första molarer.' },
      'late-mixed': { title: 'Hörntands- och premolarväxling', summary: 'Hörntänder och premolarer bryter fram vid olika tidpunkter i över- och underkäken. Premolarer ersätter mjölkmolarer; andra efterföljare finns fortfarande inne i käkarna.' },
      permanent: { title: 'Ungt permanent bett', summary: 'I detta exempel har mjölktänderna ersatts. Andra permanenta molarer bryter fram bakom de första molarerna; rotutvecklingen kan fortsätta efter tandframbrottet.' },
    },
    status: { primary: 'Mjölktand', unerupted: 'Inne i käken', erupting: 'Under frambrott', erupted: 'Frambruten permanent tand', absent: 'Tappad mjölktand' },
  },
  de: {
    play: 'Abspielen', pause: 'Pausieren', replay: 'Von Anfang abspielen', softTissue: 'Umgebende Gewebe', skullNote: '3D-Schädel aus den Modellen des Erwachsenenatlas mit illustrativen jüngeren Proportionen. Auch Milchzähne verwenden verkleinerte Vorlagen erwachsener Zähne. Suturen, Fontanellen und Nebenhöhlenwachstum wurden nicht aus pädiatrischer Bildgebung rekonstruiert.',
    adult: 'Erwachsen',
    title: 'Gebissentwicklung', atlas: 'Erwachsenenanatomie', years: 'Jahre', stage: 'Entwicklungsstadium', showUnerupted: 'Zähne im Kiefer zeigen', jaw: 'Transparente Kieferbögen',
    note: 'Schematisches Beispiel: Alter und Zahndurchbruch variieren zwischen Kindern. Formen, Positionen und Wurzellängen sind illustrativ; kein vermessenes Wachstumsmodell und keine Bestimmung des Zahnalters.',
    draft: 'Entwurf · fachliche Prüfung ausstehend', excluded: 'Weisheitszähne gehören nicht zu diesen Kindheitsstadien.', teeth: 'Zähne in diesem Stadium', sources: 'Medizinische Quellen',
    primaryPrefix: 'Milchzahn:', permanentPrefix: 'Bleibender Zahn:', upperArch: 'Oberkieferzahnbogen in Entwicklung', lowerArch: 'Unterkieferzahnbogen in Entwicklung',
    stages: {
      infant: { title: 'Erste Milchzähne', summary: 'Milchschneidezähne beginnen durchzubrechen. Andere Milchzähne liegen noch im Kiefer. Nur bleibende Zähne mit bereits begonnener Mineralisation werden mit schematischen Kronen dargestellt.' },
      toddler: { title: 'Durchbruch der Milchzähne', summary: 'Milcheckzähne und Milchmolaren folgen den Schneidezähnen. Mit dem Durchbruch der zweiten Milchmolaren vervollständigt sich das Milchgebiss; bleibende Nachfolger entwickeln sich weiter im Kiefer.' },
      primary: { title: 'Milchgebiss', summary: 'Milchzähne besetzen beide Zahnbögen. Bleibende Nachfolger entwickeln sich im Kiefer; bleibende Molaren entstehen hinter den Milchmolaren.' },
      'early-mixed': { title: 'Frühes Wechselgebiss', summary: 'Die ersten bleibenden Molaren und unteren mittleren Schneidezähne beginnen durchzubrechen. Die Molaren erscheinen hinter den Milchzähnen, ohne einen Milchzahn zu ersetzen.' },
      'incisor-transition': { title: 'Schneidezahnwechsel', summary: 'Bleibende Schneidezähne ersetzen die Milchschneidezähne. Milcheckzähne und Milchmolaren bleiben neben den bleibenden Schneidezähnen und ersten Molaren bestehen.' },
      'late-mixed': { title: 'Eckzahn- und Prämolarenwechsel', summary: 'Eckzähne und Prämolaren brechen in Ober- und Unterkiefer zu unterschiedlichen Zeiten durch. Prämolaren ersetzen Milchmolaren; andere Nachfolger liegen noch im Kiefer.' },
      permanent: { title: 'Junges bleibendes Gebiss', summary: 'In diesem Beispiel sind die Milchzähne ersetzt. Zweite bleibende Molaren brechen hinter den ersten Molaren durch; die Wurzelentwicklung kann nach dem Durchbruch weitergehen.' },
    },
    status: { primary: 'Milchzahn', unerupted: 'Im Kiefer', erupting: 'Im Durchbruch', erupted: 'Durchgebrochener bleibender Zahn', absent: 'Ausgefallener Milchzahn' },
  },
  es: {
    play: 'Reproducir', pause: 'Pausar', replay: 'Reproducir desde el inicio', softTissue: 'Tejidos circundantes', skullNote: 'Cráneo 3D derivado del atlas adulto con proporciones juveniles ilustrativas. Los dientes temporales también utilizan plantillas adultas reducidas. Las suturas, fontanelas y el crecimiento de los senos no se reconstruyen a partir de imágenes pediátricas.',
    adult: 'Adulto',
    title: 'Desarrollo de la dentición', atlas: 'Anatomía adulta', years: 'años', stage: 'Etapa de desarrollo', showUnerupted: 'Mostrar dientes dentro de los maxilares', jaw: 'Arcos maxilares transparentes',
    note: 'Ejemplo esquemático: las edades y la erupción varían entre niños. Las formas, posiciones y longitudes radiculares son ilustrativas; no es un modelo de crecimiento medido ni una evaluación de edad dental.',
    draft: 'Borrador · pendiente de revisión experta', excluded: 'Las muelas del juicio no se incluyen en estas etapas infantiles.', teeth: 'Dientes de esta etapa', sources: 'Fuentes médicas',
    primaryPrefix: 'Diente temporal:', permanentPrefix: 'Diente permanente:', upperArch: 'Arco dental maxilar en desarrollo', lowerArch: 'Arco dental mandibular en desarrollo',
    stages: {
      infant: { title: 'Primeros dientes temporales', summary: 'Los incisivos temporales comienzan a emerger. Otros dientes temporales siguen dentro de los maxilares. Solo se representan dientes permanentes cuya mineralización ha comenzado, con coronas esquemáticas.' },
      toddler: { title: 'Erupción de dientes temporales', summary: 'Los caninos y molares temporales se añaden a los incisivos. La dentición temporal se completa al erupcionar los segundos molares; los sucesores permanentes siguen desarrollándose dentro de los maxilares.' },
      primary: { title: 'Dentición temporal', summary: 'Los dientes temporales ocupan ambos arcos. Los sucesores permanentes se desarrollan dentro de los maxilares; los molares permanentes se forman detrás de los temporales.' },
      'early-mixed': { title: 'Dentición mixta temprana', summary: 'Comienzan a emerger los primeros molares permanentes y los incisivos centrales inferiores. Los molares erupcionan detrás de los temporales sin sustituir un diente temporal.' },
      'incisor-transition': { title: 'Recambio de incisivos', summary: 'Los incisivos permanentes sustituyen a los temporales. Los caninos y molares temporales permanecen junto a los incisivos y primeros molares permanentes.' },
      'late-mixed': { title: 'Recambio de caninos y premolares', summary: 'Los caninos y premolares erupcionan en momentos distintos en los arcos superior e inferior. Los premolares sustituyen a los molares temporales; otros sucesores siguen dentro de los maxilares.' },
      permanent: { title: 'Dentición permanente joven', summary: 'En este ejemplo ya se han sustituido los dientes temporales. Los segundos molares permanentes emergen detrás de los primeros; el desarrollo radicular puede continuar tras la erupción.' },
    },
    status: { primary: 'Diente temporal', unerupted: 'Dentro del maxilar', erupting: 'En erupción', erupted: 'Diente permanente erupcionado', absent: 'Diente temporal exfoliado' },
  },
  la: {
    play: 'Exhibere', pause: 'Pausare', replay: 'Ab initio exhibere', softTissue: 'Textus circumstantes', skullNote: 'Cranium tridimensionale ex exemplari adulti, proportionibus iuvenilibus illustrativis. Dentes decidui quoque formas adultas diminutas adhibent. Suturae, fonticuli et incrementum sinuum ex imaginibus puerorum non reconstruuntur.',
    adult: 'Adultus',
    title: 'Evolutio dentitionis', atlas: 'Anatomia adulti', years: 'anni', stage: 'Stadium evolutionis', showUnerupted: 'Dentes intra maxillas monstrare', jaw: 'Arcus maxillares pellucidi',
    note: 'Exemplum schematicum: aetas et eruptio inter infantes variant. Formae, situs et longitudines radicum illustrant tantum; nec exemplar incrementi mensurati nec aestimatio aetatis dentalis est.',
    draft: 'Adumbratio · recensio periti exspectatur', excluded: 'Dentes serotini in his stadiis pueritiae non includuntur.', teeth: 'Dentes huius stadii', sources: 'Fontes medici',
    primaryPrefix: 'Dens deciduus:', permanentPrefix: 'Dens permanens:', upperArch: 'Arcus dentalis maxillaris evolvens', lowerArch: 'Arcus dentalis mandibularis evolvens',
    stages: {
      infant: { title: 'Primi dentes decidui', summary: 'Incisivi decidui erumpere incipiunt. Alii dentes decidui adhuc intra maxillas sunt. Soli dentes permanentes quorum mineralisatio incepta est coronis schematicis repraesentantur.' },
      toddler: { title: 'Eruptio dentium deciduorum', summary: 'Canini et molares decidui incisivis adduntur. Dentitio decidua eruptionibus secundorum molarium completur; successores permanentes intra maxillas adhuc evolvuntur.' },
      primary: { title: 'Dentitio decidua', summary: 'Dentes decidui ambos arcus occupant. Successores permanentes intra maxillas evolvuntur; molares permanentes post molares deciduos formantur.' },
      'early-mixed': { title: 'Dentitio mixta initialis', summary: 'Primi molares permanentes et incisivi centrales inferiores erumpere incipiunt. Molares post dentes deciduos erumpunt, nullo dente deciduo substituto.' },
      'incisor-transition': { title: 'Substitutio incisivorum', summary: 'Incisivi permanentes deciduos substituunt. Canini et molares decidui iuxta incisivos permanentes et primos molares permanent.' },
      'late-mixed': { title: 'Substitutio caninorum et premolarium', summary: 'Canini et premolares temporibus diversis in arcubus superiore et inferiore erumpunt. Premolares molares deciduos substituunt; alii successores adhuc intra maxillas sunt.' },
      permanent: { title: 'Dentitio permanens iuvenilis', summary: 'In hoc exemplo dentes decidui substituti sunt. Secundi molares permanentes post primos erumpunt; radices post eruptionem adhuc evolvi possunt.' },
    },
    status: { primary: 'Dens deciduus', unerupted: 'Intra maxillam', erupting: 'Erumpens', erupted: 'Dens permanens eruptus', absent: 'Dens deciduus exfoliatus' },
  },
};
