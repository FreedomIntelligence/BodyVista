 const copy=value=>JSON.parse(JSON.stringify(value));
 class History{
  constructor(limit=100){this.limit=limit;this.past=[];this.future=[];}
  record(before,after){if(JSON.stringify(before)===JSON.stringify(after))return;this.past.push(copy(before));if(this.past.length>this.limit)this.past.shift();this.future=[];}
  undo(current){if(!this.past.length)return null;this.future.push(copy(current));return this.past.pop();}
  redo(current){if(!this.future.length)return null;this.past.push(copy(current));return this.future.pop();}
  get canUndo(){return this.past.length>0;}
  get canRedo(){return this.future.length>0;}
 }
 class AnatomyHistory extends History {
  constructor(limit=20){super(limit);this.scope='anatomy';this.epoch=0;}
  setScope(scope){if(scope===this.scope)return;this.scope=scope;this.epoch++;this.past=[];this.future=[];}
  capture(state){return {state:copy(state),epoch:this.epoch,scope:this.scope};}
  commit(before,after){
   if(!before||before.epoch!==this.epoch||before.scope!=='anatomy'||this.scope!=='anatomy')return;
   if(before.state.motion||before.state.micro||after.motion||after.micro)return;
   super.record(before.state,after);
  }
  undo(current){return this.scope==='anatomy'?super.undo(current):null;}
  redo(current){return this.scope==='anatomy'?super.redo(current):null;}
 }
 function isJoint(part){return part.systems.includes('skeletal')&&/韧带|软骨|关节|纤维连接|纤维膜/.test(part.color_category||'');}
 function appearance(part,state){
  const level=Math.max(state.added?.includes(part.id)?3:0,...part.systems.map(s=>Number(s==='skeletal'&&isJoint(part)?state.joints??state.layers[s]??0:state.layers[s]||0)));
  const hidden=state.hidden instanceof Set?state.hidden.has(part.id):state.hidden?.includes(part.id);
  const isolated=state.isolate?.length&&!state.isolate.includes(part.id);
  const region=state.region&&state.region!=='all'&&!part.regions?.includes(state.region);
  return {visible:level>0&&!hidden&&!isolated&&!region,opacity:[0,.10,.35,1][level]||0,level};
 }
 function searchParts(parts,query='',system='all'){
  const words=String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const found=parts.filter(p=>(!system||system==='all'||system==='joints'&&isJoint(p)||p.systems.includes(system))&&words.every(w=>[p.name,p.english,p.japanese,p.knowledge?.title,p.color_category].join(' ').toLocaleLowerCase().includes(w)));
  const q=String(query).trim().toLocaleLowerCase();
  const rank=p=>{const names=[p.name,p.english,p.japanese,p.knowledge?.title].filter(Boolean).map(x=>x.toLocaleLowerCase());return names.includes(q)?0:names.some(n=>n.startsWith(q))?1:2;};
  return q?found.sort((a,b)=>rank(a)-rank(b)):found;
 }
 function validateView(input,ids,systems){
  const fail=()=>{throw Error('视图文件格式不正确或与当前图谱不匹配。');};
  const finiteVector=v=>Array.isArray(v)&&v.length===3&&v.every(x=>Number.isFinite(x)&&Math.abs(x)<100);
  const list=v=>Array.isArray(v)&&v.length<=5000&&v.every(x=>ids.has(x));
  if(!input||input.version!==1||!input.layers||!finiteVector(input.camera)||!finiteVector(input.target))fail();
  if(Object.entries(input.layers).some(([s,v])=>!systems.has(s)||![0,1,2,3].includes(v)))fail();
  if(!list(input.hidden)||!list(input.selected)||input.isolate&&!list(input.isolate))fail();
  if(input.added&&!list(input.added)||input.joints!==undefined&&![0,1,2,3].includes(input.joints))fail();
  if(input.faded&&!list(input.faded)||input.region&&!['all','head','neck','thorax','abdomen','pelvis','upper','lower'].includes(input.region))fail();
  if(input.micro&&!['alveoli','nephron','sarcomere','synapse','villi','vessel'].includes(input.micro))fail();
  if(!['x','y','z'].includes(input.axis)||!Number.isFinite(input.section)||input.section<0||input.section>100||!Number.isFinite(input.explode)||input.explode<0||input.explode>100)fail();
  if(!Array.isArray(input.strokes)||input.strokes.length>300||input.strokes.some(s=>!Array.isArray(s.points)||s.points.length>3000||s.points.some(v=>!finiteVector(v))))fail();
  if(!Array.isArray(input.labels)||input.labels.length>200||input.labels.some(s=>typeof s.text!=='string'||s.text.length>500||!finiteVector(s.position)))fail();
  if(input.up!==undefined&&(!finiteVector(input.up)||Math.hypot(...input.up)<1e-8))fail();
  if(input.projection!==undefined&&!['perspective','orthographic'].includes(input.projection))fail();
  if(input.motion){
   const m=input.motion,s=m.state;
   if(!(systems.has(m.scope)||m.scope==='whole-body')||!s||typeof s.id!=='string'||s.id.length>100||![s.phase,s.speed,s.amplitude].every(Number.isFinite))fail();
   if(s.phase<0||s.phase>1||s.speed<.25||s.speed>2||s.amplitude<0||s.amplitude>1||!['both','left','right'].includes(s.side))fail();
   if(!s.base||!finiteVector(s.base.camera)||!finiteVector(s.base.target))fail();
  }
  return copy(input);
 }

export { copy, History, AnatomyHistory, appearance, searchParts, validateView, isJoint };
