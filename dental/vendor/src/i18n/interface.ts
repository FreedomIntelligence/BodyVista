import { LANGS, type Lang } from './lang';

const text = {
  retry: ['Retry', 'Försök igen', 'Erneut versuchen', 'Reintentar', 'Iterum conare'],
  loadingSelection: ['Loading anatomy…', 'Laddar anatomi…', 'Anatomie wird geladen…', 'Cargando anatomía…', 'Anatomia oneratur…'],
  selectionError: ['This anatomy could not be loaded. Please try again.', 'Anatomin kunde inte laddas. Försök igen.', 'Diese Anatomie konnte nicht geladen werden. Bitte erneut versuchen.', 'No se pudo cargar esta anatomía. Inténtelo de nuevo.', 'Haec anatomia onerari non potuit. Iterum conare.'],
  expandDetails: ['Expand details', 'Utöka detaljer', 'Details erweitern', 'Ampliar detalles', 'Singula amplifica'],
  collapseDetails: ['Collapse details', 'Minska detaljer', 'Details verkleinern', 'Reducir detalles', 'Singula contrahe'],
  toothCount: ['teeth', 'tänder', 'Zähne', 'dientes', 'dentes'],
  meshCount: ['mesh parts', 'modelldelar', 'Modellteile', 'partes del modelo', 'partes formae'],
  primaryDentition: ['Open primary dentition', 'Visa mjölktandsbett', 'Milchgebiss öffnen', 'Abrir dentición temporal', 'Dentitionem deciduam aperi'],
  showAll: ['Show all', 'Visa alla', 'Alle anzeigen', 'Mostrar todo', 'Omnia ostende'],
  showLess: ['Show fewer', 'Visa färre', 'Weniger anzeigen', 'Mostrar menos', 'Pauciora ostende'],
} satisfies Record<string, [string, string, string, string, string]>;

export function interfaceText(lang: Lang) {
  const index = LANGS.indexOf(lang);
  return Object.fromEntries(Object.entries(text).map(([key, values]) => [key, values[index]])) as Record<keyof typeof text, string>;
}
