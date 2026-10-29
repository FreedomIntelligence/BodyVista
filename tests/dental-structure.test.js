import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dentalFDI} from '../src/dental-structure.js';
const parts=JSON.parse(readFileSync(new URL('../catalog.json',import.meta.url))).parts;
test('atlas teeth map to unique FDI numbers without including adjacent head anatomy',()=>{
 const teeth=parts.filter(p=>p.knowledge?.category==='牙');
 assert.equal(teeth.length,28);
 const numbers=teeth.map(dentalFDI);
 assert.equal(new Set(numbers).size,28);
 assert.ok(numbers.every(n=>n>=11&&n<=47&&n%10>=1&&n%10<=7));
 assert.equal(dentalFDI(parts.find(p=>p.english==='lower first molar tooth left')),36);
 assert.equal(dentalFDI(parts.find(p=>p.english==='upper medial incisor right')),11);
 assert.ok(parts.filter(p=>p.knowledge?.category!=='牙').every(p=>dentalFDI(p)===null));
});

import {dentalRelated} from '../src/dental-structure.js';
test('related teeth follow adjacency, counterpart and the correct jaw',()=>{
 const find=fdi=>parts.find(p=>dentalFDI(p)===fdi);
 const relations=dentalRelated(find(36),parts);
 assert.deepEqual(relations.map(r=>dentalFDI(r.part)),[35,37,46,null]);
 assert.equal(relations.at(-1).part.english,'mandible');
 const upper=dentalRelated(find(11),parts);
 assert.deepEqual(upper.map(r=>dentalFDI(r.part)),[21,12,null]);
 assert.equal(upper.at(-1).part.english,'maxilla right');
 for(const p of parts.filter(p=>dentalFDI(p))){const rows=dentalRelated(p,parts);assert.ok(rows.every(r=>r.part.id!==p.id));assert.equal(new Set(rows.map(r=>r.part.id)).size,rows.length);}
 assert.equal(dentalRelated(parts.find(p=>p.english==='mandible'),parts),null);
});
