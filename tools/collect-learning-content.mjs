import { parseAst } from 'rollup/parseAst';
import { readFileSync } from 'node:fs';
export function collectLearningContent(root = new URL('../', import.meta.url)) {
 const catalog=JSON.parse(readFileSync(new URL('catalog.json',root)));
 const content=JSON.parse(readFileSync(new URL('src/content.json',root)));
 const values=new Set();
 for(const part of catalog.parts){
  const k=part.knowledge||{};
  for(const fact of k.facts||[]) if(typeof fact==='string') values.add(fact);
  for(const source of k.sources||[]) values.add(source.title);
 }
 for(const topic of content.topics){
  values.add(topic.title);for(const fact of topic.facts)values.add(fact);
  for(const source of topic.sources)values.add(source.title);
  for(const q of topic.quiz){values.add(q.question);values.add(q.explanation);q.options.forEach(x=>values.add(x));}
 }
 const ast=parseAst(readFileSync(new URL('src/main.js',root),'utf8'));
 // These functions contain the authored lessons, phase captions and model labels.
 const functions=new Set(['createMicroAnatomy','createAnatomyMotion','createLivingMotions','createPhysiologyMotions','createBloodFlow']);
 function walk(node,active=false){
  if(!node||typeof node!=='object')return;
  active ||= node.type==='FunctionDeclaration'&&functions.has(node.id.name);
  if(active&&node.type==='Literal'&&typeof node.value==='string'&&/[\u4e00-\u9fff]/.test(node.value))values.add(node.value);
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(x=>walk(x,active));else if(value&&typeof value==='object')walk(value,active);
 }
 walk(ast);
 return [...values];
}
