import { collectDisplayContent } from './collect-display-content.mjs';
import { dictionary } from '../src/locales/dictionary.js';

const content = collectDisplayContent();
const missing = content.filter(text => {
  const values = dictionary[text.trim()];
  return !values || values.length !== 2 || values.some(value => typeof value !== 'string' || !value.trim());
});
if (missing.length) {
  console.error('Missing English or Japanese display content:\n' + missing.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Translation coverage: ${content.length} display strings have English and Japanese translations.`);
}
