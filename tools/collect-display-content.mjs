import { parseAst } from 'rollup/parseAst';
import { readFileSync } from 'node:fs';
import { collectLearningContent } from './collect-learning-content.mjs';

export function collectDisplayContent(root = new URL('../', import.meta.url)) {
  const values = new Set(collectLearningContent(root));
  const add = value => { if (value?.trim() && /[\u4e00-\u9fffA-Za-z]/.test(value)) values.add(value.trim()); };
  const catalog = JSON.parse(readFileSync(new URL('catalog.json', root)));
  catalog.parts.forEach(part => add(part.name));
  catalog.systems.forEach(system => add(system.name));
  for (const file of ['src/main.js', 'src/dental-workspace.js', 'src/dental-structure.js', 'src/interaction.js','src/view-navigation.js', 'src/state.js']) {
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'Literal' && typeof node.value === 'string' && /[\u4e00-\u9fff]/.test(node.value)) add(node.value);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === 'object') walk(value);
      }
    }
    walk(parseAst(readFileSync(new URL(file, root), 'utf8')));
  }
  const html = readFileSync(new URL('index.html', root), 'utf8').replace(/<!--[^]*?-->/g, '');
  for (const match of html.matchAll(/>([^<>]+)</g)) add(match[1]);
  for (const match of html.matchAll(/(?:aria-label|title|placeholder|alt|label)="([^"]+)"/g)) add(match[1]);
  return [...values];
}
