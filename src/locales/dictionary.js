import {strings as dental} from '../../dental/strings.js';
import ui from './ui.js';
import motions from './motions.js';
import micro from './micro.js';
import knowledge from './knowledge.json' with { type: 'json' };
import lessons from './lessons.json' with { type: 'json' };
import references from './references.json' with { type: 'json' };
import anatomy from './anatomy.json' with { type: 'json' };
import extra from './extra.json' with { type: 'json' };

export const dictionary = { ...dental, ...lessons, ...knowledge, ...references, ...ui, ...motions, ...micro, ...anatomy, ...extra };

// Only compose complete, translated sentences; never partially translate unknown text.
export function translateAuthoredText(text, slot) {
  const key = text.trim();
  if (dictionary[key]) return dictionary[key][slot];
  const sentences = key.match(/[^。！？]+[。！？]?/g);
  if (sentences?.length > 1 && sentences.every(sentence => dictionary[sentence.trim()])) {
    return sentences.map(sentence => dictionary[sentence.trim()][slot]).join(slot === 0 ? ' ' : '');
  }
}
