import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {appearance} from '../src/state.js';
const catalog=JSON.parse(readFileSync(new URL('../catalog.json',import.meta.url)));
const audit=JSON.parse(readFileSync(new URL('../docs/region-audit.json',import.meta.url)));
const byName=name=>{const p=catalog.parts.find(p=>p.name===name);assert.ok(p,name);return p;};
const check=(name,regions)=>assert.deepEqual(byName(name).regions,regions,name);
test('all catalog parts have explicit, valid and audited regional assignments',()=>{
 const allowed=new Set(['all','head','neck','thorax','abdomen','pelvis','upper','lower']);
 const records=new Map(audit.parts.map(p=>[p.id,p]));
 assert.equal(records.size,catalog.parts.length);
 for(const p of catalog.parts){
  assert.ok(p.regions.length>0,p.name);
  assert.equal(new Set(p.regions).size,p.regions.length);
  assert.ok(p.regions.every(r=>allowed.has(r)),p.name);
  assert.deepEqual(p.regions,records.get(p.id)?.regions,p.name);
  assert.ok(records.get(p.id).reason);
 }
});
test('abdominal and pelvic organs are no longer assigned to neighboring cavities',()=>{
 for(const name of ['肝','胃','胰','胆囊','十二指肠','左侧肾','右侧肾','左侧肾上腺','右侧肾上腺'])check(name,['abdomen']);
 for(const name of ['膀胱','前列腺','左侧精囊','右侧精囊'])check(name,['pelvis']);
});
test('vertebral and limb landmarks follow anatomical divisions',()=>{
 check('寰椎',['neck']);check('第七颈椎',['neck']);check('第一胸椎',['thorax']);check('第五腰椎',['abdomen']);
 check('左侧股骨',['lower']);check('左侧肱骨',['upper']);check('骶骨',['pelvis']);
});
test('regional membership supports crossing structures and excludes global skin from local views',()=>{
 check('气管',['neck','thorax']);check('食管',['neck','thorax','abdomen']);check('左侧输尿管',['abdomen','pelvis']);
 const layers=Object.fromEntries(catalog.systems.map(s=>[s.id,3]));
 const visible=(name,region)=>appearance(byName(name),{layers,region}).visible;
 assert.ok(visible('肝','abdomen'));assert.ok(!visible('肝','thorax'));
 assert.ok(visible('气管','neck')&&visible('气管','thorax'));
 assert.ok(visible('皮肤','all'));assert.ok(!visible('皮肤','head'));
});
test('head endocrine structures remain while thyroid and parathyroids are cervical',()=>{
 const head=catalog.parts.filter(p=>p.systems.includes('endocrine')&&p.regions.includes('head')).map(p=>p.name).sort();
 assert.deepEqual(head,['腺垂体','神经垂体','松果体'].sort());
 for(const name of ['甲状腺','左侧上甲状旁腺','右侧上甲状旁腺','左侧下甲状旁腺','右侧下甲状旁腺'])check(name,['neck']);
});
test('similar names do not confuse maxillary with axillary or cranial with spinal tracts',()=>{
 for(const p of catalog.parts.filter(p=>/maxillary|callosomarginal|nucleus of solitary tract|nucleus of hypoglossal nerve/.test(p.english)))assert.deepEqual(p.regions,['head'],p.name);
 for(const p of catalog.parts.filter(p=>/^axillary (artery|vein|nerve)/.test(p.english)))assert.deepEqual(p.regions,['upper'],p.name);
});
