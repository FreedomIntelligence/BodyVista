import { LANGS, type Lang } from './lang';

const text = {
  nerveGroups: ['Nerve groups', 'Nervgrupper', 'Nervengruppen', 'Grupos nerviosos', 'Greges nervorum'],
  nerveSide: ['Nerve side', 'Nervsida', 'Nervenseite', 'Lado nervioso', 'Latus nervorum'],
  dental: ['Dental · V2 / V3', 'Dentala · V2 / V3', 'Dental · V2 / V3', 'Dentales · V2 / V3', 'Dentales · V2 / V3'],
  trigeminal: ['Trigeminal · V', 'Trigeminus · V', 'Trigeminus · V', 'Trigémino · V', 'Trigeminus · V'],
  facial: ['Facial · VII', 'Facialis · VII', 'Facialis · VII', 'Facial · VII', 'Facialis · VII'],
  'lower-cranial': ['IX / X / XII', 'IX / X / XII', 'IX / X / XII', 'IX / X / XII', 'IX / X / XII'],
  all: ['All nerves', 'Alla nerver', 'Alle Nerven', 'Todos los nervios', 'Omnes nervi'],
  both: ['Both sides', 'Båda sidor', 'Beide Seiten', 'Ambos lados', 'Utrumque latus'],
  right: ['Right', 'Höger', 'Rechts', 'Derecho', 'Dexter'],
  left: ['Left', 'Vänster', 'Links', 'Izquierdo', 'Sinister'],
  nerveHint: ['Start with dental nerves; choose one side or another group to follow fewer paths. Selecting a hidden nerve reveals its group.', 'Börja med dentala nerver; välj en sida eller en annan grupp för färre förlopp. När du väljer en dold nerv visas dess grupp.', 'Beginnen Sie mit dentalen Nerven; wählen Sie eine Seite oder andere Gruppe für weniger Verläufe. Die Auswahl eines ausgeblendeten Nervs zeigt seine Gruppe.', 'Empiece con los nervios dentales; elija un lado u otro grupo para seguir menos trayectos. Seleccionar un nervio oculto muestra su grupo.', 'A nervis dentalibus incipe; unum latus aut alium gregem elige ut pauciores cursus sequaris. Nervum occultum eligere gregem eius ostendit.'],
  passageActive: ['A single passage is shown. Choose a group below to leave this view.', 'En nervpassage visas. Välj en grupp nedan för att lämna vyn.', 'Ein einzelner Durchtritt wird gezeigt. Wählen Sie unten eine Gruppe, um diese Ansicht zu verlassen.', 'Se muestra un solo trayecto. Elija un grupo abajo para salir de esta vista.', 'Unus transitus ostenditur. Gregem infra elige ut hunc visum relinquas.'],
  hyoidTitle: ['How the hyoid is suspended', 'Så hålls tungbenet på plats', 'Aufhängung des Zungenbeins', 'Cómo se suspende el hioides', 'Suspensio ossis hyoidei'],
  skull: ['From the skull', 'Från skallen', 'Vom Schädel', 'Desde el cráneo', 'A cranio'],
  jaw: ['From the jaw', 'Från underkäken', 'Vom Unterkiefer', 'Desde la mandíbula', 'A mandibula'],
  below: ['Below the hyoid', 'Nedanför tungbenet', 'Unter dem Zungenbein', 'Bajo el hioides', 'Infra os hyoideum'],
  temporal: ['Temporal bone', 'Tinningben', 'Schläfenbein', 'Temporal', 'Os temporale'],
  mandible: ['Mandible', 'Underkäke', 'Unterkiefer', 'Mandíbula', 'Mandibula'],
  hyoid: ['Hyoid', 'Tungben', 'Zungenbein', 'Hioides', 'Os hyoideum'],
  neck: ['Larynx · sternum · scapula', 'Struphuvud · bröstben · skulderblad', 'Kehlkopf · Brustbein · Schulterblatt', 'Laringe · esternón · escápula', 'Larynx · sternum · scapula'],
  hyoidNote: ['Schematic attachment diagram, not a bony joint. Solid lines represent muscle connections; the dashed line represents the stylohyoid ligament. These attachments are explained here rather than modeled as 3D meshes.', 'Schematisk bild av fästen, ingen benled. Heldragna linjer visar muskelförbindelser; den streckade visar lig. stylohyoideum. Fästena förklaras här och är inte modellerade som 3D-meshar.', 'Schematische Ansatzdarstellung, kein Knochengelenk. Durchgezogene Linien zeigen Muskelverbindungen, die gestrichelte das Stylohyoidband. Die Ansätze werden hier erklärt und sind keine 3D-Meshes.', 'Esquema de inserciones, no una articulación ósea. Las líneas continuas representan conexiones musculares; la discontinua, el ligamento estilohioideo. Se explican aquí y no se modelan como mallas 3D.', 'Schema insertionum, non articulatio ossea. Lineae continuae nexus musculares et linea interrupta ligamentum stylohyoideum demonstrant. Insertiones hic explicantur, non ut formae tridimensionales finguntur.'],
} satisfies Record<string, [string, string, string, string, string]>;

export function explorationText(lang: Lang) {
  const i = LANGS.indexOf(lang);
  return Object.fromEntries(Object.entries(text).map(([key, values]) => [key, values[i]])) as Record<keyof typeof text, string>;
}
