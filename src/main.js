import {dentalFDI,dentalTissues,dentalRelated} from './dental-structure.js';
import {openDental,closeDental,setupDental,setupDentalMotion} from './dental-workspace.js';
import './styles.css';
import {regionIcon} from './region-icon.js';
import {structureChatGPTLink,structureDeepSeekLink} from './chatgpt-link.js';
import './interaction.css';
import './workspace.css';
import './view-navigation.css';
import './visual-system.css';
import {AtlasCamera, setupViewNavigation} from './view-navigation.js';
import {setupInteraction} from './interaction.js';
import {t, translateDOM, initLanguage, registerNames, getLanguage, partName, setText, formatDate} from './i18n.js';
import { copy, AnatomyHistory, appearance, isJoint, searchParts, validateView } from './state.js';
import catalog from '../catalog.json';
import content from './content.json';
import motionCatalog from './motions.json';
import * as THREE from './vendor/three.js';
import {GLTFLoader} from './vendor/GLTFLoader.js';
import {UprightControls} from './upright-controls.js';

const $=id=>document.getElementById(id);

const parts=catalog.parts.map(part=>({...part,japanese:partName(part,'ja')}));
registerNames(parts);
let interaction = null;
const partMap=new Map(parts.map(p=>[p.id,p])),systems=new Map(catalog.systems.map(s=>[s.id,s]));
const entries=new Map(),loaded=new Map(),history=new AnatomyHistory(20),loader=new GLTFLoader();
const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
const initialLayers=()=>Object.fromEntries(catalog.systems.map(s=>[s.id,s.id==='skeletal'?3:s.id==='skin'?1:0]));
let state={version:1,layers:initialLayers(),joints:3,hidden:[],added:[],selected:[],faded:[],isolate:null,region:'all',axis:'z',section:0,explode:0,strokes:[],labels:[],micro:null};
let motion=null,motionScope='',motionEntries=[],micro=null,microTime=0,microPlaying=true,microLast=0;
let hoverLabel=null;
const mobileLabels=matchMedia('(max-width:760px), (max-width:900px) and (max-height:500px)');
let queue=Promise.resolve(),rangeBefore=null,tool='',galleryTab='systems',browseMode='structures',searchLimit=60,toastTimer,inAction=false;
let storageKey='bio2mesh-atlas-library-v1',library={views:[],notes:[],bookmarks:[],scores:[]};
try{Object.assign(library,JSON.parse(localStorage.getItem(storageKey)||'{}'));}catch{}
for(const k of ['views','notes','bookmarks','scores'])if(!Array.isArray(library[k]))library[k]=[];
const scene=new THREE.Scene(),body=new THREE.Group(),annotationGroup=new THREE.Group();
scene.add(body,annotationGroup);
const camera=new AtlasCamera(32,1,.003,80);camera.up.set(0,0,1);camera.position.set(.1,-5,.1);
const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,stencil:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.localClippingEnabled=true;renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.95;
$('stage').append(renderer.domElement);
const controls=new UprightControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.1;controls.minDistance=.08;controls.maxDistance=15;controls.minZoom=.05;controls.maxZoom=20;camera.orbitTarget=controls.target;
let viewNavigation;
scene.add(new THREE.HemisphereLight(0xffffff,0x74818b,1.5));
for(const [p,intensity] of [[[3,-4,6],1.9],[[-3,-1,2],.7],[[0,4,3],1.1]]){
 const light=new THREE.DirectionalLight(0xffffff,intensity);light.position.set(...p);scene.add(light);
}
const clipPlane=new THREE.Plane(V(0,0,-1),2),raycaster=new THREE.Raycaster();
const safeText=(node,text)=>{node.textContent=text??'';return node;};
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
function toast(text){clearTimeout(toastTimer);setText($('toast'),text);$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
function saveLibrary(){try{localStorage.setItem(storageKey,JSON.stringify(library));return true;}catch{toast('浏览器存储空间不足，请导出视图后清理旧记录。');return false;}}
function busy(){setText($('loading-text'),'加载中...');$('loading').hidden=false;}
function idle(){$('loading').hidden=true;interaction?.sync();}
function snapshot(){camera.normalizeZoom();return {...copy(state),camera:camera.position.toArray(),target:controls.target.toArray(),up:camera.up.toArray(),projection:camera.isOrthographicCamera?'orthographic':'perspective',motion:motion?{scope:motionScope,state:motion.snapshot()}:null};}
function historyScope(scope){history.setScope(scope);rangeBefore=null;historyUI();}
function historyUI(){$('undo').disabled=!history.canUndo;$('redo').disabled=!history.canRedo;interaction?.sync();}
function run(fn){const before=history.capture(snapshot());fn();if(!inAction)history.commit(before,snapshot());historyUI();}
function beginChange(){rangeBefore??=history.capture(snapshot());}
function finishChange(){if(rangeBefore){history.commit(rangeBefore,snapshot());rangeBefore=null;historyUI();}}
function action(fn){
 queue=queue.then(async()=>{const before=history.capture(snapshot());inAction=true;try{await fn();history.commit(before,snapshot());historyUI();}catch(e){console.error(e);toast('操作未完成：'+e.message);}finally{inAction=false;idle();}});
 return queue;
}
function disposeTree(root){root.traverse(o=>{o.geometry?.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m?.dispose());});}
function teardownMotion(){
 if(!motion)return;motion.clear();
 for(const e of motionEntries){
  e.meshes.forEach(m=>e.group.add(m));e.caps.forEach(p=>e.group.add(p.stencil));
  if(e.motion){e.motion.traverse(o=>{if(o.userData.bio2meshFlow){o.geometry.dispose();o.material.dispose();}});e.motion.removeFromParent();delete e.motion;}
 }
 motion=null;motionEntries=[];motionScope='';
}
async function loadSystem(key){
 if(loaded.has(key))return loaded.get(key);
 const system=systems.get(key);if(!system)throw Error('未知系统');
 const promise=new Promise((resolve,reject)=>{
  const script=document.createElement('script'),timer=setTimeout(()=>reject(Error(system.name+'加载超时')),120000);
  let settled=false;
  const cleanup=()=>{clearTimeout(timer);script.remove();assetResolvers.delete(key);};
  const parse=(buffer)=>loader.parse(buffer,'',gltf=>{
      gltf.scene.traverse(m=>{
       if(!m.isMesh)return;let p=m;while(p&&!p.userData.partId)p=p.parent;
       const id=p?.userData.partId||m.name,part=partMap.get(id);
      if(!part){disposeTree(m);return;}
      if(entries.has(id)){disposeTree(m);return;}
      m.geometry.computeVertexNormals();m.geometry.computeBoundingBox();
      m.material=m.material.clone();m.material.color.copy(atlasMaterialColor(part,system.color));m.material.flatShading=false;m.material.roughness=.7;m.material.metalness=0;m.material.side=THREE.DoubleSide;
      const group=new THREE.Group();group.name=part.name;body.add(group);
      const entry={part,group,meshes:[m],caps:[],color:m.material.color.clone(),offset:V(),box:m.geometry.boundingBox.clone()};
      m.userData.entry=entry;entries.set(id,entry);
      });
      // Reparent after traversal so siblings are never skipped.
      for(const entry of entries.values())if(!entry.meshes[0].parent||entry.meshes[0].parent!==entry.group&&!entry.motion)entry.group.add(...entry.meshes);
     if(!settled){settled=true;cleanup();applyVisibility();resolve(system);}
    },error=>{if(!settled){settled=true;cleanup();reject(error);}});
  const fallback=()=>{
   if(settled)return;
   assetResolvers.set(key,{resolve:bundle=>{
    try{parse(Uint8Array.from(atob(bundle.glb),c=>c.charCodeAt(0)).buffer);}catch(e){settled=true;cleanup();reject(e);}
   },reject});
   script.src=system.file;
   script.onerror=()=>{if(!settled){settled=true;cleanup();loaded.delete(key);reject(Error('找不到 '+system.file));}};
   document.head.append(script);
  };
  fetchModelBuffer(system.file.replace(/\.js$/,'.glb')).then(parse).catch(fallback);
 });
 loaded.set(key,promise);return promise;
}
const assetResolvers=new Map();
window.Bio2MeshAssetReady=bundle=>assetResolvers.get(bundle.system)?.resolve(bundle);
const detailResolvers=new Map(),detailed=new Map();
window.Bio2MeshDetailReady=bundle=>detailResolvers.get(bundle.id)?.(bundle);
// Bump this key when the model assets change so an old deployment cannot reuse them.
const modelCacheName='bodyvista-models-v2';
async function fetchModelBuffer(url){
 const absolute=new URL(url,document.baseURI).href;
 if('caches' in window){
  try{
   const cache=await caches.open(modelCacheName),cached=await cache.match(absolute);
   if(cached)return cached.arrayBuffer();
   const response=await fetch(absolute,{cache:'no-cache'});
   if(!response.ok)throw Error(`模型请求失败：${response.status}`);
   await cache.put(absolute,response.clone());
   return response.arrayBuffer();
  }catch{}
 }
 const response=await fetch(absolute);
 if(!response.ok)throw Error(`模型请求失败：${response.status}`);
 return response.arrayBuffer();
}
async function loadDetail(id){
 const part=partMap.get(id),entry=entries.get(id);
 if(!part?.detail_file||!entry||motion)return;
 if(detailed.has(id))return detailed.get(id);
 const promise=new Promise((resolve,reject)=>{
  const script=document.createElement('script'),timer=setTimeout(()=>reject(Error('结构细节载入超时')),90000);
  let settled=false;
  const cleanup=()=>{clearTimeout(timer);script.remove();detailResolvers.delete(id);};
  const parse=(buffer)=>loader.parse(buffer,'',gltf=>{
     let detailMesh;gltf.scene.traverse(m=>{if(m.isMesh)detailMesh=m;});
     if(!detailMesh){if(!settled){settled=true;cleanup();reject(Error('结构细节为空'));}return;}
     // Clipping stencils share the previous geometry; release their materials before replacing it.
     for(const p of entry.caps){p.stencil.removeFromParent();p.stencil.children.forEach(m=>m.material.dispose());p.cap.removeFromParent();p.cap.geometry.dispose();p.cap.material.dispose();}
     entry.caps=[];entry.meshes[0].geometry.dispose();
     detailMesh.geometry.computeVertexNormals();detailMesh.geometry.computeBoundingBox();
     entry.meshes[0].geometry=detailMesh.geometry;entry.box.copy(detailMesh.geometry.boundingBox);detailMesh.material.dispose();entry.detailLoaded=true;
     if(!settled){settled=true;cleanup();updateSection();resolve();}
    },error=>{if(!settled){settled=true;cleanup();detailed.delete(id);reject(error);}});
  const fallback=()=>{
   if(settled)return;
   detailResolvers.set(id,bundle=>{
    try{parse(Uint8Array.from(atob(bundle.glb),c=>c.charCodeAt(0)).buffer);}catch(e){settled=true;cleanup();detailed.delete(id);reject(e);}
   });
   script.src=part.detail_file;
   script.onerror=()=>{if(!settled){settled=true;cleanup();detailed.delete(id);reject(Error('结构细节文件不可用'));}};
   document.head.append(script);
  };
  fetchModelBuffer(part.detail_file.replace(/\.js$/,'.glb')).then(parse).catch(fallback);
 });
 detailed.set(id,promise);return promise;
}
async function ensure(keys){const todo=[...new Set(keys)].filter(k=>systems.has(k));if(todo.some(k=>!loaded.has(k)))busy();await Promise.all(todo.map(loadSystem));}
function updateSection(){
 const axis=$('axis').value,value=Number($('section').value);state.axis=axis;state.section=value;state.explode=Number($('explode').value);
 const bounds=new THREE.Box3();for(const e of entries.values())if(e.group.visible)bounds.union(e.box);
 if(bounds.isEmpty())bounds.set(V(-1,-1,-1.25),V(1,1,1.25));
 clipPlane.normal.set(0,0,0);clipPlane.normal[axis]=-1;clipPlane.constant=THREE.MathUtils.lerp(bounds.max[axis]+.002,bounds.min[axis]-.002,value/100);
 setText($('section-value'),value+'%');
 setText($('explode-value'),state.explode+'%');
 for(const e of entries.values()){
  const c=e.box.getCenter(V());e.offset.copy(c).multiplyScalar(state.explode*.012);e.group.position.copy(e.offset);
  for(const m of e.meshes){m.material.clippingPlanes=value?[clipPlane]:[];m.renderOrder=100000;}
  const closed=e.detailLoaded?e.part.detail_watertight:e.part.watertight;
  const intersects=value>0&&e.group.visible&&closed&&e.meshes[0].material.opacity>.98&&e.box.min[axis]+e.offset[axis]<clipPlane.constant&&e.box.max[axis]+e.offset[axis]>clipPlane.constant;
  if(intersects&&!e.caps.length)makeCaps(e);
  for(const p of e.caps){p.stencil.visible=p.cap.visible=!!intersects;p.cap.position.copy(clipPlane.coplanarPoint(V())).sub(e.offset);p.cap.quaternion.setFromUnitVectors(V(0,0,1),clipPlane.normal);}
 }
}
let capOrder=0;
function makeCaps(e){
 for(const mesh of e.meshes){
  const stencil=new THREE.Group(),order=capOrder++*3;
  for(const [side,op] of [[THREE.BackSide,THREE.IncrementWrapStencilOp],[THREE.FrontSide,THREE.DecrementWrapStencilOp]]){
   const material=new THREE.MeshBasicMaterial({side,depthWrite:false,depthTest:false,colorWrite:false,stencilWrite:true,stencilFunc:THREE.AlwaysStencilFunc,stencilFail:op,stencilZFail:op,stencilZPass:op,clippingPlanes:[clipPlane]});
   const m=new THREE.Mesh(mesh.geometry,material);m.renderOrder=order;stencil.add(m);
  }
  const material=new THREE.MeshBasicMaterial({color:e.color,side:THREE.DoubleSide,stencilWrite:true,stencilRef:0,stencilFunc:THREE.NotEqualStencilFunc,stencilFail:THREE.ReplaceStencilOp,stencilZFail:THREE.ReplaceStencilOp,stencilZPass:THREE.ReplaceStencilOp});
  const cap=new THREE.Mesh(new THREE.PlaneGeometry(8,8),material);cap.renderOrder=order+1;cap.onAfterRender=()=>renderer.clearStencil();e.group.add(stencil,cap);e.caps.push({stencil,cap});
 }
}
function applyVisibility(){
 state.selected=state.selected.filter(id=>partMap.has(id)&&appearance(partMap.get(id),state).visible);
 const focusSelection=state.focusSelection&&state.selected.length>0&&!motion&&!state.micro;
 let count=0;
 for(const e of entries.values()){
  const a=appearance(e.part,state);e.group.visible=a.visible&&!state.micro;if(e.group.visible)count++;
  for(const m of e.meshes){const selected=state.selected.includes(e.part.id),faded=state.faded.includes(e.part.id);
   const baseOpacity=e.part.systems.includes('skin')&&a.level===1?.038:a.opacity;
   const opacity=focusSelection&&!selected?Math.min(.08,baseOpacity):faded?Math.min(.18,baseOpacity):focusSelection&&selected?1:baseOpacity;
   const transparent=opacity<1;if(m.material.transparent!==transparent)m.material.needsUpdate=true;
   m.material.opacity=opacity;m.material.transparent=transparent;m.material.depthWrite=opacity>=.98;
   m.material.emissive.set(state.selected.includes(e.part.id)?0x137c92:0);m.material.emissiveIntensity=state.selected.includes(e.part.id)?.24:0;
  }
 }
 state.selected=state.selected.filter(id=>partMap.has(id)&&appearance(partMap.get(id),state).visible);
 setText($('visible-count'),count+' / '+parts.length+' 个结构');
 $('selection-tray').hidden=!state.selected.length||!!state.micro;setText($('selection-count'),'已选 '+state.selected.length);
 for(const row of $('layers').children){row.hidden=state.region!=='all'&&!parts.some(p=>p.regions?.includes(state.region)&&(row.dataset.system==='joints'?isJoint(p):p.systems.includes(row.dataset.system)&&!(row.dataset.system==='skeletal'&&isJoint(p))));const level=row.dataset.system==='joints'?state.joints??state.layers.skeletal:state.layers[row.dataset.system]||0;row.classList.toggle('inactive',!level);row.querySelectorAll('.layer-bar').forEach((b,i)=>{b.classList.toggle('on',i===level);b.setAttribute('aria-pressed',String(i===level));});row.querySelector('[data-delta="-1"]').disabled=!level;row.querySelector('[data-delta="1"]').disabled=level===3;}
 $('region').value=state.region;$('axis').value=state.axis;$('section').value=state.section;$('explode').value=state.explode;
 updateSection();motion?.captureMaterialBase();renderLabels();
}
function boxFor(ids){const b=new THREE.Box3();for(const e of entries.values())if((ids?.length?ids.includes(e.part.id):e.group.visible))b.union(e.box.clone().translate(e.offset));return b;}
function frameBox(box,direction=V(0,-1,0)){
 if(box.isEmpty())return;
 const center=box.getCenter(V()),forward=direction.clone().normalize(),right=V().crossVectors(V(0,0,1),forward).normalize(),up=V().crossVectors(forward,right).normalize();
 // Fit projected extents rather than a bounding sphere, so the whole body fills portrait and landscape views.
 if(right.lengthSq()<.1){right.set(1,0,0);up.crossVectors(forward,right).normalize();}
 let distance=.12;const tan=Math.tan(camera.fov*Math.PI/360);
 for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
  const v=V(x,y,z).sub(center);distance=Math.max(distance,Math.abs(v.dot(up))/tan+v.dot(forward),Math.abs(v.dot(right))/(tan*camera.aspect)+v.dot(forward));
 }
 const damping=controls.enableDamping;controls.enableDamping=false;controls.update();
 camera.up.set(0,0,1);controls.target.copy(center);camera.position.copy(center).addScaledVector(forward,distance*1.08);controls.update();controls.enableDamping=damping;camera.resetZoomReference();
}
function fit(ids){if(state.micro&&micro)frameBox(new THREE.Box3().setFromObject(micro.group));else frameBox(boxFor(ids));}
function exitMicro(){if(micro){scene.remove(micro.group);micro.dispose();micro=null;}state.micro=null;$('micro-controls').hidden=true;}
function setHeading(title='全身解剖',subtitle='从系统到结构，连续探索人体。',eyebrow='人体解剖'){setText($('scene-name'),title);setText($('scene-subtitle'),subtitle);setText($('scene-eyebrow'),eyebrow);}
function closeOverlays(){delete document.body.dataset.knowledgeCollapsed;delete document.body.dataset.activityCollapsed;for(const k of ['gallery','quiz'])$(k).hidden=true;document.querySelectorAll('[data-nav]').forEach(b=>b.setAttribute('aria-selected','false'));}
function drawer(panel){
 closeOverlays();$('inspector').hidden=false;$('inspector').dataset.panel=panel;
 const names={knowledge:'结构知识',activity:'动态演示',search:'解剖结构搜索'};
 for(const k of Object.keys(names))if(k!=='search')$(k+'-panel').hidden=k!==panel;
 $('drawer-title').textContent=names[panel];$('inspector').scrollTop=0;interaction?.closePopovers();interaction?.sync();resize();
}
function showKnowledge(part){
 $('ask-chatgpt').href=structureChatGPTLink(partName(part),getLanguage());
 $('ask-deepseek').href=structureDeepSeekLink(partName(part),getLanguage());
 $('knowledge-panel').querySelector('.inline-actions').hidden=false;
 $('selected-name').textContent=part.name;$('selected-english').textContent='';$('selected-english').hidden=true;
 const fdi=dentalFDI(part);
 $('dental-knowledge').hidden=!fdi;
 $('dental-tissues').replaceChildren();
 if(fdi){$('selected-english').hidden=false;$('selected-english').textContent='FDI · '+fdi;for(const group of dentalTissues){const section=el('section','dental-tissue-group');section.append(el('h3','',group.title));const list=el('dl');for(const [name,description] of group.items){const row=el('div');row.append(el('dt','',name),el('dd','',description));list.append(row);}section.append(list);$('dental-tissues').append(section);}}
 const knowledge=part.knowledge||{};
 const facts=(knowledge.facts||knowledge.points||[]).map(f=>typeof f==='string'?f:f.text||f.title||'').filter(Boolean);
 const summary=knowledge.summary||knowledge.intro||facts[0]||'';
 $('structure-overview').hidden=false;
 setText($('selected-system'),part.systems.map(k=>systems.get(k).name).join(' · '));
 $('knowledge-scope').hidden=knowledge.level!=='category_background';
 setText($('selected-summary'),summary);
 $('selected-summary').parentElement.hidden=!summary;
 setText($('selected-region'),part.regions.map(k=>regionNames[k]).filter(Boolean).join(' · '));
 $('selected-region').parentElement.hidden=!part.regions.length;
 const details=facts.filter(f=>f!==summary);
 $('selected-facts').replaceChildren(...details.map(f=>el('li','',f)));
 $('knowledge-facts-title').hidden=false;$('knowledge-facts-section').hidden=!details.length;
 const oralRelated=!!fdi||/^(mandible|maxilla(?: left| right)?)$/.test(part.english);
 const related=parts.filter(p=>p.id!==part.id&&p.systems.some(k=>part.systems.includes(k))&&p.regions.some(r=>r!=='all'&&part.regions.includes(r))).sort((a,b)=>(oralRelated?Number(!!dentalFDI(b))-Number(!!dentalFDI(a)):0)||Number(b.knowledge?.category===knowledge.category)-Number(a.knowledge?.category===knowledge.category)).slice(0,6);
 const dentalRelations=dentalRelated(part,parts);
 const relations=dentalRelations||related.map(p=>({part:p,relation:null}));
 setText($('related-note'),dentalRelations?'相邻牙、对侧同名牙与对应颌骨':'同区域同系统');
 $('selected-related').replaceChildren(...relations.map(({part:p,relation})=>{const button=el('button','',p.name);if(relation)button.append(el('small','related-role',relation));button.onclick=()=>action(()=>focusPart(p.id));return button;}));
 $('knowledge-related-section').hidden=!relations.length;
 $('selected-sources').replaceChildren();
 for(const source of knowledge.sources||[]){if(!source.url?.startsWith('https://'))continue;const a=el('a','',source.title||'延伸阅读 ↗');a.href=source.url;a.target='_blank';a.rel='noopener noreferrer';$('selected-sources').append(a);}
 $('knowledge-sources-section').hidden=!$('selected-sources').children.length;

}
function selectPart(id,add=false){
 hoverLabel=null;
 if(!partMap.has(id))return;
 state.selected=add?(state.selected.includes(id)?state.selected.filter(x=>x!==id):[...state.selected,id]):[id];
 state.focusSelection=!add&&tool===''&&!motion&&!state.micro;
 showKnowledge(partMap.get(id));applyVisibility();if(tool!=='multi')drawer('knowledge');
 if(state.focusSelection)fit(state.selected);
}
async function focusPart(id,add=false){
 if(history.scope!=='quiz')historyScope('anatomy');
 teardownMotion();exitMicro();const p=partMap.get(id),key=p.systems.find(k=>state.layers[k]>0)||p.systems[0];await ensure([key]);await loadDetail(id);state.added=[...new Set([...(state.added||[]),id])];
 state.hidden=state.hidden.filter(x=>x!==id);state.isolate=null;state.region='all';state.section=0;state.explode=0;
 selectPart(id,add);fit([id]);setHeading(p.name,p.systems.map(k=>systems.get(k).name).join(' · '));
}
async function setLayers(layers,title,region='all'){
 if(history.scope!=='quiz')historyScope('anatomy');
 setTool('');toggleSection(false);teardownMotion();exitMicro();await ensure(Object.entries(layers).filter(([,v])=>v>0).map(([k])=>k));
 Object.assign(state,{layers:{...initialLayers(),...layers},joints:layers.skeletal??0,hidden:[],added:[],faded:[],selected:[],isolate:null,region,section:0,explode:0,focusSelection:false});
 applyVisibility();setHeading(title||'全身解剖');fit();setTool('pan',false);
}
const blankLayers=()=>Object.fromEntries(catalog.systems.map(s=>[s.id,0]));
async function showSystem(key){await setLayers({...blankLayers(),[key]:3,skin:key==='skin'?3:1},systems.get(key).name);}
function icon(key){return atlasOrganIcon(key);}
function buildLayers(){
 for(const s of atlasLayerSystems()){
  const row=el('div','layer-row');row.dataset.system=s.id;row.title=s.name;
  const top=el('div','layer-top'),minus=el('button','layer-step','−'),plus=el('button','layer-step','+'),symbol=el('span','layer-icon'),title=el('span','layer-title',s.name);
  symbol.innerHTML=icon(s.id);minus.dataset.delta='-1';plus.dataset.delta='1';minus.ariaLabel='减少'+s.name;plus.ariaLabel='增加'+s.name;
  top.append(minus,symbol,title,plus);row.append(top);const bars=el('div','layer-bars');
  for(let level=0;level<=3;level++){const b=el('button','layer-bar',['隐藏','轮廓','半透明','实体'][level]);b.ariaLabel=s.name+'：'+['隐藏','轮廓','半透明','实体'][level];b.onclick=()=>action(async()=>{exitMicro();if(level)await ensure([s.id==='joints'?'skeletal':s.id]);if(s.id==='joints')state.joints=level;else state.layers[s.id]=level;applyVisibility();});bars.append(b);}
  for(const button of [minus,plus])button.onclick=()=>action(async()=>{exitMicro();const previous=s.id==='joints'?state.joints??state.layers.skeletal:state.layers[s.id],level=Math.max(0,Math.min(3,previous+Number(button.dataset.delta)));if(level)await ensure([s.id==='joints'?'skeletal':s.id]);if(s.id==='joints')state.joints=level;else state.layers[s.id]=level;applyVisibility();});
  row.append(bars);$('layers').append(row);const option=el('option','',s.name);option.value=s.id;$('search-system').append(option);
 }
}
function renderSearch(){
 for(const b of $('search-filters').children)b.setAttribute('aria-selected',String(b.dataset.filter===$('search-system').value));
 const found=searchParts(parts,$('structure-search').value,$('search-system').value);
 $('search-count').textContent=found.length+' 个匹配结构';$('search-results').replaceChildren();
 for(const p of found.slice(0,searchLimit)){
  const row=el('div','result-row'),symbol=el('span','result-organ'),label=el('button','result-label',p.name);symbol.innerHTML=regionIcon(p.regions);symbol.title=p.regions.map(r=>t(regionNames[r])).join(' · ');
  label.onclick=()=>action(()=>focusPart(p.id,tool==='multi'));
  const shown=appearance(p,state).visible,b=el('button','',shown?'向我显示 →':'添加 +');b.dataset.action='focus';
  b.onclick=()=>action(async()=>{if(shown){await focusPart(p.id,tool==='multi');return;}
   await ensure([p.systems[0]]);state.added=[...new Set([...(state.added||[]),p.id])];state.hidden=state.hidden.filter(id=>id!==p.id);state.isolate=null;state.region='all';
   state.selected=tool==='multi'?[...new Set([...state.selected,p.id])]:[p.id];applyVisibility();showKnowledge(p);renderSearch();toast('已添加 '+p.name);});
  const system=el('span','result-system',[...p.regions.map(r=>regionNames[r]).filter(Boolean),...p.systems.map(k=>systems.get(k)?.name).filter(Boolean)].join(' · '));
  row.append(symbol,label,system,b);$('search-results').append(row);
 }
 $('more-results').hidden=found.length<=searchLimit;translateDOM($('search-panel'));
}
const motionTemplate=$('motion-panel').outerHTML;
function enterDental(mode){closeOverlays();teardownMotion();exitMicro();$('inspector').hidden=true;setTool('pan',false);toggleSection(false);openDental(mode);if(mode!=='anatomy'){historyScope('motion');state.selected=[];setupDentalMotion(mode,motionTemplate);drawer('activity');}interaction?.sync();}
function buildActivities(){
 const dentalGroup=el('optgroup');dentalGroup.label='口腔与牙齿';
 for(const [value,label] of [['dental:jaw','开合口与咬合'],['dental:development','牙齿发育']]){const o=el('option','',label);o.value=value;dentalGroup.append(o);}
 const opt=el('option','','选择一种动态…');opt.value='';$('activity-select').append(opt);
 const combined=el('optgroup');combined.label='全身联动';
 for(const [id,label] of [['whole-body-vitality','生命律动：心搏、呼吸与循环'],['whole-body-circulation','全身血流：肺循环与体循环'],['whole-body-oxygen-journey','红细胞旅程：一次完整循环'],['whole-body-exercise','运动时的心肺节律'],['whole-body-conduction','心脏电传导与泵血']]){const o=el('option','',label);o.value='whole-body:'+id;combined.append(o);}
 $('activity-select').append(combined,dentalGroup);
 for(const s of catalog.systems){const group=el('optgroup');group.label=s.name;
  for(const m of motionCatalog[s.folder]||[]){const o=el('option','',m.label);o.value=s.id+':'+m.id;group.append(o);}$('activity-select').append(group);}
}
async function createController(scope){
 teardownMotion();await ensure(scope==='whole-body'?['cardiovascular','respiratory']: [scope]);
 const keys=scope==='whole-body'?['cardiovascular','respiratory']:[scope];
 motionEntries=[...entries.values()].filter(e=>e.part.systems.some(k=>keys.includes(k)));
 $('motion-panel').outerHTML=motionTemplate;$('motion-mode').replaceChildren();
 motion=createAnatomyMotion({THREE,entries:motionEntries,data:{up_axis:'z'},$,camera,controls,run,beginChange,finishChange,
  getSelected:()=>entries.get(state.selected[0]),updateSection,fit,partLabel:p=>p.name});
 motionScope=scope;$('motion-tab').click();
}
async function playActivity(value,play=true){
 if(!value)return;if(value.startsWith('dental:')){enterDental(value.split(':')[1]);return;}closeDental();historyScope('motion');setTool('pan',false);toggleSection(false);exitMicro();const [scope,id]=value.split(':');
 const layers={...blankLayers(),skeletal:scope==='skeletal'?3:1};
 if(scope==='whole-body'){layers.cardiovascular=3;layers.respiratory=2;}else layers[scope]=3;
 await ensure(Object.entries(layers).filter(([,v])=>v).map(([k])=>k));
 Object.assign(state,{layers,joints:layers.skeletal||0,selected:[],hidden:[],added:[],faded:[],isolate:null,region:'all',section:0,explode:0});
 applyVisibility();await createController(scope);
 if(!motion.modes.some(m=>m.id===id))throw Error('此动态所需的结构不完整：'+id);
 if(scope==='whole-body'){$('motion-focus').checked=false;$('motion-focus').dispatchEvent(new Event('change'));}
 $('motion-mode').value=id;$('motion-mode').dispatchEvent(new Event('change'));
 if(scope==='whole-body'){
  state.faded=motionEntries.filter(e=>/动脉|静脉/.test(e.part.color_category||e.part.knowledge?.category||'')||/artery|vein|aorta|vena cava|pulmonary trunk/.test(e.motionName)).map(e=>e.part.id);
  fit();
 }
 $('activity-select').value=value;document.querySelector('.motion-shell').hidden=false;$('micro-controls').hidden=true;
 if(play)$('motion-play').click();
 setHeading(motion.modes.find(m=>m.id===id).label,scope==='whole-body'?'心脏 · 肺 · 全身血管':systems.get(scope).name,'动态解剖');drawer('activity');
 applyVisibility();
}
async function showMicro(key){
 historyScope('micro');
 const topic=content.topics.find(x=>x.key===key);if(!topic)return;
 setTool('');toggleSection(false);teardownMotion();exitMicro();state.micro=key;micro=createMicroAnatomy(THREE,key);scene.add(micro.group);microTime=0;microPlaying=true;
 $('micro-play').textContent='❚❚ 暂停';$('micro-speed').value=1;
 state.selected=[];applyVisibility();setHeading(topic.title,'旋转观察结构与过程',content.sceneLabel);
 $('dental-knowledge').hidden=true;$('structure-overview').hidden=true;$('knowledge-related-section').hidden=true;$('knowledge-facts-title').hidden=true;$('knowledge-facts-section').hidden=false;$('knowledge-sources-section').hidden=!topic.sources.length;
 $('selected-english').hidden=false;$('selected-name').textContent=topic.title;$('selected-english').textContent=content.sceneLabel;$('selected-facts').replaceChildren(...topic.facts.map(t=>el('li','',t)));
 $('selected-sources').replaceChildren(...topic.sources.map(s=>{const a=el('a','',s.title);a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';return a;}));
 $('knowledge-panel').querySelector('.inline-actions').hidden=true;
 drawer('knowledge');$('knowledge-panel').append($('micro-controls'));$('micro-controls').hidden=false;
 fit();renderLabels();
}
async function restore(view){
 historyScope(view.motion?'motion':view.micro?'micro':history.scope==='quiz'?'quiz':'anatomy');
 teardownMotion();exitMicro();
 await ensure([...Object.entries(view.layers).filter(([,v])=>v>0).map(([k])=>k),...(view.joints>0?['skeletal']:[])]);
 const {camera:position,target,up,projection,motion:oldMotion,...rest}=copy(view);state=rest;state.faded||=[];state.region||='all';
 if(state.micro)await showMicro(state.micro);
 applyVisibility();rebuildStrokes();setHeading(state.micro?content.topics.find(x=>x.key===state.micro)?.title:'保存的视图');
 if(oldMotion?.scope){await createController(oldMotion.scope);motion.restore(oldMotion.state);$('activity-select').value=oldMotion.scope+':'+oldMotion.state.id;}
 camera.up.fromArray(up||[0,0,1]);camera.position.fromArray(position);controls.target.fromArray(target);camera.zoom=1;camera.setProjection(projection==='orthographic');controls.update();
 if(state.selected[0])showKnowledge(partMap.get(state.selected[0]));$('slice-bar').hidden=!(state.section||state.explode);document.body.classList.toggle('slicing',!$('slice-bar').hidden);applyVisibility();historyUI();
}
function addLabel(text,position){state.labels.push({text,position});renderLabels();}
function rebuildStrokes(){
 for(const child of [...annotationGroup.children]){annotationGroup.remove(child);disposeTree(child);}
 for(const stroke of state.strokes){
  if(stroke.points.length<2)continue;
  const points=stroke.points.map(p=>V(...p));
  const material={color:/^#[0-9a-f]{6}$/i.test(stroke.color)?stroke.color:'#de735e',depthTest:false,depthWrite:false};
  const line=stroke.radius ? new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),Math.max(2,points.length*2),stroke.radius,6,false),new THREE.MeshBasicMaterial(material)) : new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial(material));
  line.renderOrder=10;annotationGroup.add(line);
 }
}
function hasStructureLabel(id){
 return state.labels.some(label=>label.structureId===id||(!label.structureId&&label.text===partMap.get(id)?.name));
}
function renderLabels(){
 const labeled=state.selected.length>0&&state.selected.every(hasStructureLabel);
 const labelButton=$('label-selected');
 if(labelButton.getAttribute('aria-pressed')!==String(labeled)){
  labelButton.setAttribute('aria-pressed',String(labeled));setText(labelButton,labeled?'取消标签':'添加标签');
 }

 const labels=state.micro&&micro?micro.labels:[...state.labels];
 if(!state.micro&&!motion&&['','multi'].includes(tool)&&$('auto-labels').checked&&hoverLabel&&!hasStructureLabel(hoverLabel.id))labels.push(hoverLabel);
 if(mobileLabels.matches&&!state.micro&&!motion&&!quizRun?.finding){
  for(const id of state.selected){const entry=entries.get(id);if(!entry?.group.visible||hasStructureLabel(id))continue;labels.push({id,text:partMap.get(id).name,position:entry.box.getCenter(V()).toArray()});}
 }
 const nodes=[];
 for(const item of labels){const p=V(...item.position).project(camera);if(p.z< -1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1)continue;
  const node=el('span','annotation');setText(node,item.text);node.style.left=((p.x+1)/2*$('stage').clientWidth)+'px';node.style.top=((-p.y+1)/2*$('stage').clientHeight)+'px';nodes.push(node);}
 $('annotation-labels').replaceChildren(...nodes);
}
let pointerStart=null,drawing=null,measurePoints=[],pointerDragging=false;
const touchPointers=new Set();
let multiTouchGesture=false,erasing=false,drawEraser=false;
const drawingPlane=new THREE.Plane();
renderer.domElement.addEventListener('pointerdown',event=>{
 if(event.pointerType!=='touch')return;
 touchPointers.add(event.pointerId);
 if(touchPointers.size>1){multiTouchGesture=true;pointerStart=null;drawing=null;erasing=false;finishChange();controls.enabled=true;}
},{capture:true});
function endTouch(event){
 touchPointers.delete(event.pointerId);
 if(!touchPointers.size)queueMicrotask(()=>{multiTouchGesture=false;controls.enabled=true;controls.mouseButtons.LEFT=['draw','measure'].includes(tool)?null:tool==='pan'?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;controls.touches.ONE=['draw','measure'].includes(tool)?null:tool==='pan'?THREE.TOUCH.PAN:THREE.TOUCH.ROTATE;});
}
renderer.domElement.addEventListener('pointerup',endTouch);
renderer.domElement.addEventListener('pointercancel',endTouch);

function hits(event,selecting=false){
 const r=renderer.domElement.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),camera);
 const candidates=[...entries.values()].filter(e=>{
  if(!e.group.visible)return false;
  if(!selecting)return true;
  const selected=state.selected.includes(e.part.id);
  // The faint body outline is context, not a selectable surface.
  if(!selected&&e.part.systems.includes('skin')&&appearance(e.part,state).level===1)return false;
  // While inspecting a structure, background clicks must not change the focus.
  if(state.focusSelection&&state.selected.length&&tool===''&&!event.shiftKey&&!selected)return false;
  return true;
 });
 const list=raycaster.intersectObjects(candidates.flatMap(e=>e.meshes),false).filter(h=>!state.section||clipPlane.distanceToPoint(h.point)>=0);
 return list.filter(h=>h.object.material.opacity>.36).concat(list.filter(h=>h.object.material.opacity<=.36));
}
function eraseStroke(event){
 const r=renderer.domElement.getBoundingClientRect(),x=event.clientX-r.left,y=event.clientY-r.top;
 const before=state.strokes.length;
 state.strokes=state.strokes.filter(stroke=>{
  // Measurements are separate from drawings and keep their labels intact.
  if(!stroke.radius)return true;
  const points=stroke.points.map(p=>V(...p).project(camera));
  return !points.some((p,i)=>{
   if(!i||p.z< -1||p.z>1)return false;
   const a=points[i-1],ax=(a.x+1)*r.width/2,ay=(1-a.y)*r.height/2,bx=(p.x+1)*r.width/2,by=(1-p.y)*r.height/2;
   const dx=bx-ax,dy=by-ay,u=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));
   return Math.hypot(x-ax-u*dx,y-ay-u*dy)<=12;
  });
 });
 if(state.strokes.length!==before)rebuildStrokes();
}
$('draw-width').oninput=()=>{$('draw-width-value').textContent=$('draw-width').value+' px';};
for(const [id,erase] of [['draw-pen',false],['draw-eraser',true]])$(id).onclick=()=>{
 drawEraser=erase;$('draw-pen').setAttribute('aria-pressed',String(!erase));$('draw-eraser').setAttribute('aria-pressed',String(erase));
 $('draw-color').disabled=erase;$('draw-width').disabled=erase;
 renderer.domElement.style.cursor=erase?'cell':'crosshair';
};
function updateCanvasCursor(selectable=false,dragging=false){
 renderer.domElement.style.cursor=tool==='pan'?(dragging?'grabbing':'grab'):tool==='draw'?(drawEraser?'cell':'crosshair'):['dissect','measure'].includes(tool)?'crosshair':selectable?'pointer':'default';
}
function setTool(value,toggle=true){
 hoverLabel=null;renderLabels();

 if(value&&value!=='pan'&&(state.micro||motion||quizRun?.finding))return;
 if(value&&!$('slice-bar').hidden)toggleSection(false);
 if(value&&value!=='pan')$('inspector').hidden=true;
 interaction?.closePopovers();
 tool=toggle&&tool===value?'':value;controls.enabled=true;controls.mouseButtons.LEFT=['draw','measure'].includes(tool)?null:tool==='pan'?THREE.MOUSE.PAN:THREE.MOUSE.ROTATE;controls.touches.ONE=['draw','measure'].includes(tool)?null:tool==='pan'?THREE.TOUCH.PAN:THREE.TOUCH.ROTATE;
 for(const [id,key] of [['dissect-tool','dissect'],['multiselect-tool','multi'],['draw-tool','draw'],['measure-tool','measure'],['pan-view','pan']])$(id).setAttribute('aria-pressed',String(tool===key));
 const tips={dissect:'点击结构即可隐藏，撤销可以逐步恢复。',multi:'点击多个结构，或按住 Shift 追加选择。',draw:'在模型表面拖动绘制。',measure:'依次点击模型上的两个位置。'};
 measurePoints=[];updateCanvasCursor();interaction?.sync();
}
renderer.domElement.addEventListener('pointerdown',event=>{
 if(event.button!==0||multiTouchGesture||tool==='pan')return;
 pointerStart={x:event.clientX,y:event.clientY};pointerDragging=false;
 if(tool==='draw'&&!state.micro){
  if(drawEraser){beginChange();erasing=true;eraseStroke(event);renderer.domElement.setPointerCapture(event.pointerId);return;}
  const hit=hits(event)[0];
  // Empty canvas uses a view-facing plane at the initial surface or orbit target.
  drawingPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(V()),hit?.point||controls.target);
  const point=hit?.point||raycaster.ray.intersectPlane(drawingPlane,V());
  if(point){beginChange();drawing={color:$('draw-color').value,radius:Number($('draw-width').value)*(camera.isOrthographicCamera?camera.position.distanceTo(controls.target):point.distanceTo(camera.position))*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/renderer.domElement.clientHeight,points:[point.toArray()]};state.strokes.push(drawing);renderer.domElement.setPointerCapture(event.pointerId);}
 }
});
renderer.domElement.addEventListener('pointerleave',()=>{hoverLabel=null;updateCanvasCursor();renderLabels();});
renderer.domElement.addEventListener('pointermove',event=>{
 hoverLabel=null;
 if(event.pointerType!=='touch'&&!event.buttons&&!state.micro&&!motion&&!quizRun?.finding&&['','multi'].includes(tool)){
  const hit=hits(event,true)[0];
  updateCanvasCursor(!!hit);
  if(hit&&$('auto-labels').checked){const part=hit.object.userData.entry.part;hoverLabel={id:part.id,text:part.name,position:hit.point.toArray()};}
 }
 renderLabels();
 if(pointerStart&&Math.hypot(event.clientX-pointerStart.x,event.clientY-pointerStart.y)>5)pointerDragging=true;
 if(!multiTouchGesture&&erasing){eraseStroke(event);return;}
 if(!multiTouchGesture&&drawing&&drawing.points.length<3000){const hit=hits(event)[0],point=hit?.point||raycaster.ray.intersectPlane(drawingPlane,V());if(point){const p=point.toArray(),last=drawing.points.at(-1);if(V(...p).distanceTo(V(...last))>.002){drawing.points.push(p);rebuildStrokes();}}}
});
renderer.domElement.addEventListener('pointerup',event=>{
 if(multiTouchGesture){pointerStart=null;return;}
 if(drawing||erasing){drawing=null;erasing=false;finishChange();pointerStart=null;return;}
 if(!pointerStart||pointerDragging||state.micro){pointerStart=null;return;}pointerStart=null;
 const hit=hits(event,tool!=='measure'&&!quizRun?.finding)[0];if(!hit)return;const id=hit.object.userData.entry.part.id;
 if(quizRun?.finding){answerFind(id);return;}
 if(tool==='measure'){run(()=>{measurePoints.push(hit.point.toArray());if(measurePoints.length===2){const distance=V(...measurePoints[0]).distanceTo(V(...measurePoints[1]))/catalog.height*100;
   state.strokes.push({color:'#167c91',points:measurePoints});addLabel(distance.toFixed(1)+'% 全身高度',V(...measurePoints[0]).add(V(...measurePoints[1])).multiplyScalar(.5).toArray());measurePoints=[];rebuildStrokes();}});return;}
 if(tool==='dissect')run(()=>{state.hidden.push(id);state.selected=state.selected.filter(x=>x!==id);applyVisibility();});
 else action(async()=>{await loadDetail(id);selectPart(id,tool==='multi'||event.shiftKey);});
});
renderer.domElement.addEventListener('pointercancel',()=>{drawing=null;erasing=false;pointerStart=null;finishChange();});
controls.addEventListener('start',()=>{updateCanvasCursor(false,true);hoverLabel=null;renderLabels();if(!['draw','measure'].includes(tool)||multiTouchGesture)beginChange();});
controls.addEventListener('end',()=>{updateCanvasCursor();finishChange();});
const regionNames={all:'全身',head:'头部',neck:'颈部',thorax:'胸部',abdomen:'腹部',pelvis:'盆部',upper:'上肢',lower:'下肢'};
function thumb(key){
 const box=el('div','thumb'),img=el('img');img.alt='';img.loading='lazy';img.decoding='async';img.fetchPriority='low';img.src='thumbs/'+key+'.png';
 img.onerror=()=>{img.remove();box.innerHTML=icon(systems.has(key)?key:'skin');};box.append(img);return box;
}
function card(title,subtitle,key,fn,attribute){
 const b=el('button','view-card');b.append(key==='dental'?el('div','thumb'):thumb(key));const caption=el('div','card-caption',title);if(subtitle)caption.append(el('small','',subtitle));b.append(caption);
 if(attribute)b.dataset[attribute[0]]=attribute[1];b.onclick=()=>action(async()=>{closeOverlays();await fn();});return b;
}
async function presetRegion(region){
 await setLayers({...blankLayers(),skeletal:2,muscular:region==='upper'||region==='lower'?3:0,cardiovascular:3,nervous:region==='head'?3:1,respiratory:region==='thorax'?2:0,digestive:region==='abdomen'?3:0,urinary:region==='pelvis'?3:0},regionNames[region]);
 state.region=region;applyVisibility();fit();
}
function renderGallery(){
 $('gallery').dataset.browseMode=browseMode;
 const structures=browseMode==='structures',microOnly=browseMode==='micro';
 for(const button of document.querySelectorAll('[data-gallery]'))button.setAttribute('aria-selected',String(button.dataset.gallery===galleryTab));
 setText($('browse-title'),microOnly?'显微解剖结构':'查找与浏览');
 $('browse-tabs').hidden=microOnly;
 document.querySelector('.gallery-tabs').hidden=structures||microOnly;
 $('search-panel').hidden=!structures;$('gallery-content').hidden=structures;
 for(const button of document.querySelectorAll('[data-browse]'))button.setAttribute('aria-selected',String(button.dataset.browse===browseMode));
 const placeholder=structures?'输入结构名称…':'按名称筛选视图…';
 $('gallery-query').placeholder=t(placeholder);$('gallery-query').setAttribute('aria-label',t(placeholder));
 if(structures){$('structure-search').value=$('gallery-query').value;renderSearch();return;}

 $('gallery-content').replaceChildren();const query=$('gallery-query').value.trim().toLowerCase();
 const section=(title,cards)=>{cards.forEach(card=>translateDOM(card));const filtered=cards.filter(c=>!query||t(c.textContent).toLowerCase().includes(query)||c.textContent.toLowerCase().includes(query));if(!filtered.length)return;const row=el('section','gallery-section');row.append(el('h2','',title));const grid=el('div','card-grid');grid.append(...filtered);row.append(grid);$('gallery-content').append(row);};
 if(galleryTab==='systems'){
  section('系统视图',catalog.systems.map(s=>card(s.name,s.parts.length+' 个结构',s.id,()=>showSystem(s.id))));
  section('多系统组合',[card('完整骨架与体表','全身起始视图','skeletal',()=>setLayers(initialLayers())),card('胸腹内脏','心肺、消化与泌尿','organs',()=>internalView()),card('心肺循环','呼吸与循环共同呈现','circulation',()=>playActivity('whole-body:whole-body-circulation'))]);
 }else if(galleryTab==='regions')section('从区域进入',[...Object.entries(regionNames)].filter(([k])=>k!=='all').map(([k,n])=>card(n,'跨系统观察','region-'+k,()=>presetRegion(k))));
 else if(galleryTab==='lab'){
  section('大体解剖实验室',[
   card('胸腔层次','从骨性胸廓进入心肺','region-thorax',async()=>{await presetRegion('thorax');state.layers.skeletal=3;applyVisibility();setTool('dissect');}),
   card('腹腔层次','逐层暴露腹部器官','region-abdomen',async()=>{await presetRegion('abdomen');setTool('dissect');}),
   card('头部神经与骨骼','观察颅骨与脑的关系','region-head',async()=>{await presetRegion('head');setTool('dissect');}),
   card('上肢肌骨关系','解剖隐藏与多选','region-upper',async()=>{await presetRegion('upper');setTool('dissect');}),
   card('盆部器官','泌尿与生殖','region-pelvis',async()=>{await presetRegion('pelvis');await ensure(['reproductive']);state.layers.reproductive=3;applyVisibility();setTool('dissect');})
  ]);
 }else if(galleryTab==='sections')section('在真实模型上剖切',[['z','胸部横断面'],['x','胸部矢状面'],['y','胸部冠状面']].map(([axis,name])=>card(name,'滑动调整切面位置','section-'+axis,()=>openSection(axis))));
 else if(galleryTab==='micro')section('显微结构示意',content.topics.map(t=>card(t.title,'',t.key,()=>showMicro(t.key),['micro',t.key])));
 if(!$('gallery-content').children.length)$('gallery-content').append(el('p','empty','没有找到匹配视图。'));translateDOM($('gallery'));
}
async function internalView(region='all'){await setLayers({...blankLayers(),skeletal:1,cardiovascular:3,respiratory:2,digestive:3,urinary:3,...(region!=='all'?{nervous:3,lymphatic:3,endocrine:3,sensory:3,reproductive:3}:{})},'内部器官',region);}
async function openSection(axis){
 await setLayers({...blankLayers(),skeletal:3,cardiovascular:3,respiratory:3,digestive:3,nervous:3},'胸部剖切');
 Object.assign(state,{axis,section:50,region:'thorax'});applyVisibility();toggleSection(true);

 setHeading({x:'胸部矢状面',y:'胸部冠状面',z:'胸部横断面'}[axis],'滑动调整剖切位置');
}
function captureImage(width=360){
 renderer.render(scene,camera);const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.round(width*renderer.domElement.height/renderer.domElement.width);
 const ctx=canvas.getContext('2d');ctx.fillStyle='#f8fbfb';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(renderer.domElement,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');
}
function alignSectionView(){
 const bounds=boxFor();if(bounds.isEmpty())return;
 // Look from the removed half towards the retained half, so the cut is visible.
 const axis=state.axis,cut=clipPlane.constant;
 bounds.min[axis]=bounds.max[axis]=cut;
 resize();frameBox(bounds,clipPlane.normal.clone().negate());renderLabels();
}
function toggleSection(force){const on=force??$('slice-bar').hidden;if(on){if(state.micro||motion)return;setTool('');$('inspector').hidden=true;}$('slice-bar').hidden=!on;$('section-tool').setAttribute('aria-pressed',String(on));document.body.classList.toggle('slicing',on);if(!on){state.section=0;state.explode=0;applyVisibility();}interaction?.sync();if(on){updateSection();alignSectionView();}}
let quizRun=null;
const shuffle=items=>[...items].sort(()=>Math.random()-.5);
const quizCandidates=parts.filter(p=>/^(left ventricle|right atrium|stomach|liver|spleen|pancreas|urinary bladder|thyroid gland|trachea|kidney (left|right)|femur (left|right)|humerus (left|right)|patella (left|right)|mandible|ascending aorta|testis (left|right)|upper lobe of left lung)$/.test((p.original_english||p.english||'').toLowerCase()));
const finder=el('div','quiz-finder');finder.hidden=true;$('canvas-area').append(finder);
function scoreText(){return library.scores.slice(-5).reverse().map(s=>formatDate(s.date)+' · '+t(s.kind)+' '+s.correct+'/'+s.total).join(' / ');}
function quizStage(stage){
 $('quiz').dataset.stage=stage;
 $('quiz-types').hidden=stage!=='setup';
 $('quiz-start').hidden=stage==='setup';$('quiz-home').hidden=stage==='setup';
 $('quiz-start').textContent=stage==='results'?'再挑战一次':'重新开始';
 $('quiz-home').textContent=stage==='results'?'选择其他挑战':'结束练习';
}
function quizHome(){
 quizRun=null;finder.hidden=true;$('quiz').hidden=false;quizStage('setup');
 $('quiz-question').textContent='选择挑战类型';$('quiz-progress').textContent='选择练习范围，开始一次 5 题练习。';
 $('quiz-feedback').textContent='';$('quiz-answers').replaceChildren();$('quiz-figure')?.remove();
 $('quiz-next').hidden=true;$('quiz-locate').hidden=true;interaction?.sync();
}
async function startQuiz(kind=quizRun?.kind){
 if(!kind)return;historyScope('quiz');quizStage('playing');finder.hidden=true;$('quiz').hidden=false;
 quizRun={kind,index:0,correct:0,answered:false,finding:false,questions:kind==='micro'?shuffle(content.topics.flatMap(t=>t.quiz.map(q=>({...q,topic:t.key})))).slice(0,5):shuffle(quizCandidates).slice(0,5)};
 try{if(!quizRun.questions.length)throw Error('没有可用题目');await nextQuestion();}catch(error){quizHome();throw error;}
}
async function nextQuestion(){
 const q=quizRun.questions[quizRun.index];quizRun.answered=false;quizRun.finding=false;
 $('quiz-progress').textContent='第 '+(quizRun.index+1)+' / '+quizRun.questions.length+' 题 · 已答对 '+quizRun.correct+' 题';
 $('quiz-feedback').textContent='';$('quiz-next').hidden=true;$('quiz-locate').hidden=true;$('quiz-answers').replaceChildren();
 $('quiz-start').textContent='重新开始';$('quiz-figure')?.remove();
 if(quizRun.kind==='micro'){
  $('quiz-question').textContent=q.question;
  q.options.forEach((text,i)=>{const b=el('button','quiz-answer',text);b.onclick=()=>answerQuiz(i===q.answerIndex,q.explanation,q.answerIndex);$('quiz-answers').append(b);});translateDOM($('quiz'));
 }else{
  const key=q.systems[0];await showSystem(key);await loadDetail(q.id);state.layers.skin=0;state.selected=[];state.section=0;
  if(quizRun.kind==='dissection'){
   state.isolate=null;state.region=q.regions[0];applyVisibility();fit();closeOverlays();$('inspector').hidden=true;
   quizRun.finding=true;finder.hidden=false;finder.replaceChildren(el('b','','找到：'+q.name),el('span','','点击对应结构'));
   const end=el('button','','结束练习');end.onclick=quizHome;finder.append(quizRestartButton(),end);setHeading('解剖寻找',regionNames[state.region]);resize();return;
  }
  state.isolate=[q.id];applyVisibility();fit([q.id]);setHeading('结构识别','');
  $('quiz').hidden=false;const img=el('img');img.id='quiz-figure';img.alt='本题需要识别的结构';img.src=captureImage(480);$('quiz-question').after(img);
  $('quiz-question').textContent='图中是哪一个结构？';
  const alternatives=shuffle(quizCandidates.filter(p=>p.id!==q.id&&p.name!==q.name)).slice(0,3),options=shuffle([q,...alternatives]);
  const correct=options.findIndex(p=>p.id===q.id);
  options.forEach(p=>{const b=el('button','quiz-answer',p.name);b.onclick=()=>answerQuiz(p.id===q.id,'正确答案：'+q.name+'。所属系统：'+systems.get(q.systems[0]).name+'。',correct);$('quiz-answers').append(b);});
 }
}
function quizRestartButton(){const button=el('button','','重新开始');button.onclick=()=>action(startQuiz);return button;}
function finishQuiz(){
 if($('quiz').dataset.stage==='results')return;quizStage('results');$('quiz-feedback').textContent='';
 finder.hidden=true;quizRun.finding=false;const total=quizRun.questions.length;
 const score={kind:{structure:'结构识别',micro:'显微解剖',dissection:'解剖寻找'}[quizRun.kind],correct:quizRun.correct,total,date:new Date().toISOString()};
 library.scores.push(score);library.scores=library.scores.slice(-100);saveLibrary();
 $('quiz').hidden=false;$('quiz-question').textContent='本次练习完成';$('quiz-progress').textContent='答对 '+score.correct+' / '+total+' 题';$('quiz-answers').replaceChildren();$('quiz-figure')?.remove();$('quiz-next').hidden=true;$('quiz-locate').hidden=true;$('quiz-scores').textContent=scoreText();
}
function answerQuiz(correct,explanation,index){
 if(!quizRun||$('quiz').dataset.stage!=='playing'||quizRun.answered)return;quizRun.answered=true;if(correct)quizRun.correct++;
 $('quiz-progress').textContent='第 '+(quizRun.index+1)+' / '+quizRun.questions.length+' 题 · 已答对 '+quizRun.correct+' 题';
 [...$('quiz-answers').children].forEach((b,i)=>{b.disabled=true;if(i===index)b.classList.add('correct');});
 $('quiz-feedback').textContent=(correct?'回答正确。':'再记一次。')+explanation;
 $('quiz-next').hidden=false;$('quiz-next').textContent=quizRun.index===quizRun.questions.length-1?'查看成绩':'下一题';
 $('quiz-locate').hidden=quizRun.kind==='micro';
}
function answerFind(id){
 const q=quizRun.questions[quizRun.index];if(id!==q.id){toast('这是'+partMap.get(id).name+'，继续寻找'+q.name+'。');return;}
 quizRun.finding=false;quizRun.answered=true;quizRun.correct++;toast('找到了：'+q.name);
 finder.replaceChildren(el('b','','✓ '+q.name),el('span','','回答正确'));
 const next=el('button','primary',quizRun.index===quizRun.questions.length-1?'查看成绩':'下一题');
 next.onclick=()=>{if(next.disabled)return;next.disabled=true;action(async()=>{quizRun.index++;if(quizRun.index>=quizRun.questions.length)finishQuiz();else await nextQuestion();});};const end=el('button','','结束练习');end.onclick=quizHome;finder.append(next,quizRestartButton(),end);
}
function resize(){
 const width=$('stage').clientWidth,height=$('stage').clientHeight;if(!width||!height)return;
 renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();renderLabels();
}
new ResizeObserver(resize).observe($('stage'));
let lastLabels=0;
renderer.setAnimationLoop(time=>{
 if(document.body.dataset.dental)return;
 controls.update();motion?.tick(time);
 if(micro){if(microPlaying&&microLast)microTime+=Math.min(.08,(time-microLast)/1000)*Number($('micro-speed').value);microLast=time;micro.tick(microTime);}
 if(time-lastLabels>90){renderLabels();updateVitalSigns();interaction?.syncPlayback();lastLabels=time;}
 viewNavigation?.update();
 renderer.render(scene,camera);
});
function openNav(name){
 if(['media','micro','quiz'].includes(name))historyScope(name==='media'?'motion':name);
 closeOverlays();setTool('');if(quizRun)quizRun.finding=false;finder.hidden=true;
 if(['views','search','micro'].includes(name)){
  browseMode=name==='micro'?'micro':name==='views'?'views':browseMode==='micro'?'structures':browseMode;
  if(name==='micro')galleryTab='micro';else if(galleryTab==='micro')galleryTab='systems';
  $('inspector').hidden=true;$('gallery').hidden=false;renderGallery();interaction?.sync();$('gallery-query').focus();
 }
 if(name==='media'&&document.body.dataset.dentalMotion){drawer('activity');return;}
 if(name==='media'){
  setTool('pan',false);drawer('activity');
  if(state.micro){$('activity-panel').append($('micro-controls'));$('micro-controls').hidden=false;document.querySelector('.motion-shell').hidden=true;}
  else{document.querySelector('.motion-shell').hidden=!motion;$('micro-controls').hidden=true;if(!motion){$('motion-play').disabled=true;$('motion-step').disabled=true;$('motion-reset').disabled=true;}}
 }
 if(name==='quiz'){if(!quizRun)quizHome();$('inspector').hidden=true;$('quiz').hidden=false;$('quiz-scores').textContent=scoreText();if(quizRun?.kind==='dissection'&&$('quiz').dataset.stage==='playing'){$('quiz').hidden=true;finder.hidden=false;quizRun.finding=!quizRun.answered;}}
 document.querySelectorAll('[data-nav="'+name+'"]').forEach(b=>b.setAttribute('aria-selected','true'));
}
document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>openNav(b.dataset.nav));
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>{$(b.dataset.close).hidden=true;if(b.dataset.close==='quiz'){finder.hidden=true;if(quizRun)quizRun.finding=false;}});
document.querySelectorAll('[data-dialog-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
document.querySelectorAll('[data-gallery]').forEach(b=>b.onclick=()=>{galleryTab=b.dataset.gallery;document.querySelectorAll('[data-gallery]').forEach(x=>x.setAttribute('aria-selected',String(x===b)));renderGallery();});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>run(()=>{
 const dirs={front:V(0,-1,0),back:V(0,1,0),left:V(1,0,0),right:V(-1,0,0)},distance=camera.position.distanceTo(controls.target);
 camera.position.copy(controls.target).add(dirs[b.dataset.view].multiplyScalar(distance));controls.update();
}));
$('gallery-query').oninput=()=>{searchLimit=60;renderGallery();};
for(const button of document.querySelectorAll('[data-browse]'))button.onclick=()=>{browseMode=button.dataset.browse;searchLimit=60;renderGallery();interaction?.sync();};
for(const id of ['bug-feedback','github-link'])$(id).onclick=()=>{const url=$(id).dataset.url?.trim();if(url)window.open(url,'_blank','noopener,noreferrer');};
$('share-site').onclick=async()=>{
 const text=t("BodyVista 是一个免费的三维人体交互学习网站，提供 2,900 个解剖结构、12 个人体系统、140 项动态演示入口和 6 个微观主题。你可以旋转、缩放、剖切人体，探索结构与功能，并通过解剖挑战检验学习成果。支持中文、英文、日文，电脑和手机均可使用。")+'\n\n'+t("欢迎访问 https://freedomintelligence.github.io/bodyvista/ 体验");
 try {
  try { await navigator.clipboard.writeText(text); }
  catch {
   const previous=document.activeElement,input=document.createElement('textarea');
   input.value=text;input.readOnly=true;input.style.cssText='position:fixed;left:-9999px;top:0';document.body.append(input);
   try {input.select();input.setSelectionRange(0,input.value.length);if(!document.execCommand('copy'))throw Error('Clipboard unavailable');}
   finally {input.remove();previous?.focus({preventScroll:true});}
  }
  toast('分享文案已复制');
 } catch {toast('复制失败，请检查浏览器剪贴板权限后重试');}
};
$('settings').onclick=()=>$('settings-dialog').showModal();$('help').onclick=()=>$('help-dialog').showModal();
$('exit-fullscreen').onclick=()=>document.exitFullscreen();
document.addEventListener('fullscreenchange',()=>{$('exit-fullscreen').hidden=!document.fullscreenElement;resize();});
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('当前浏览器窗口不支持全屏。');}};
$('background').onchange=()=>{document.body.classList.remove('dark','warm');if($('background').value!=='light')document.body.classList.add($('background').value);};
$('toggle-sidebar').onclick=()=>{document.body.classList.toggle('sidebar-collapsed');const collapsed=document.body.classList.contains('sidebar-collapsed');$('toggle-sidebar').setAttribute('aria-expanded',String(!collapsed));$('toggle-sidebar').ariaLabel=collapsed?'展开系统图层':'收起系统图层';};
$('close-inspector').onclick=()=>{
 document.body.dataset.activityCollapsed=String($('inspector').dataset.panel==='activity');
 document.body.dataset.knowledgeCollapsed=String($('inspector').dataset.panel==='knowledge');
 $('inspector').hidden=true;interaction?.sync();resize();
};
$('restore-knowledge').onclick=()=>{if(state.selected.length||state.micro)drawer('knowledge');};
$('restore-activity').onclick=()=>openNav('media');
$('open-search').onclick=()=>openNav('search');
$('anatomy-workspace').onclick=()=>action(async()=>{historyScope('anatomy');closeOverlays();$('inspector').hidden=true;setTool('');toggleSection(false);if(motion||state.micro)await setLayers(initialLayers());document.body.classList.toggle('sidebar-collapsed',matchMedia('(max-width:760px), (max-width:900px) and (max-height:500px)').matches);interaction?.sync();});
$('motion-workspace').onclick=()=>action(async()=>{if(!motion)await playActivity('whole-body:whole-body-vitality');else openNav('media');});
$('micro-workspace').onclick=()=>{galleryTab='micro';openNav('micro');document.querySelectorAll('[data-gallery]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.gallery==='micro')));};
document.querySelector('.atlas-brand').onclick=e=>{
 e.preventDefault();
 action(async()=>{
  historyScope('anatomy');closeOverlays();$('inspector').hidden=true;interaction?.closePopovers();
  if(quizRun)quizRun.finding=false;finder.hidden=true;
  await setLayers(initialLayers());
  document.body.classList.toggle('sidebar-collapsed',matchMedia('(max-width:760px), (max-width:900px) and (max-height:500px)').matches);
  interaction?.sync();
 });
};
$('structure-search').oninput=()=>{searchLimit=60;renderSearch();};$('search-system').onchange=()=>{searchLimit=60;renderSearch();};
$('more-results').onclick=()=>{searchLimit+=60;renderSearch();};
$('base-view').onclick=()=>action(()=>setLayers(initialLayers(),'骨骼与体表',state.region));
$('organs-view').onclick=()=>action(()=>internalView(state.region));
$('all-layers').onclick=()=>action(()=>setLayers(Object.fromEntries(catalog.systems.map(s=>[s.id,s.id==='skin'?1:s.id==='muscular'?1:3])),'全部系统',state.region));
$('region').onchange=()=>run(()=>{state.region=$('region').value;state.selected=[];state.isolate=null;state.focusSelection=false;hoverLabel=null;applyVisibility();interaction?.sync();resize();fit();setHeading(regionNames[state.region]);});
$('fit').onclick=()=>run(()=>{state.focusSelection=false;applyVisibility();fit();});
$('undo').onclick=()=>{queue=queue.then(async()=>{const s=history.undo(snapshot());if(s){await restore(s);toast('已撤销');}historyUI();idle();}).catch(e=>toast(e.message));};
$('redo').onclick=()=>{queue=queue.then(async()=>{const s=history.redo(snapshot());if(s){await restore(s);toast('已重做');}historyUI();idle();}).catch(e=>toast(e.message));};
for(const [id,factor] of [['zoom-in',.8],['zoom-out',1.25]])$(id).onclick=()=>run(()=>{camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);controls.update();});
for(const [id,key] of [['dissect-tool','dissect'],['multiselect-tool','multi'],['draw-tool','draw'],['measure-tool','measure']])$(id).onclick=()=>setTool(key);
$('isolate-selected').onclick=()=>run(()=>{state.isolate=state.isolate?null:[...state.selected];applyVisibility();fit(state.selected);});
$('hide-selected').onclick=()=>run(()=>{state.hidden=[...new Set([...state.hidden,...state.selected])];if(state.isolate){state.isolate=state.isolate.filter(id=>!state.hidden.includes(id));if(!state.isolate.length)state.isolate=null;}state.selected=[];applyVisibility();});
$('fade-selected').onclick=()=>run(()=>{for(const id of state.selected)state.faded=state.faded.includes(id)?state.faded.filter(x=>x!==id):[...state.faded,id];applyVisibility();});
$('clear-selected').onclick=()=>run(()=>{
 state.selected=[];state.isolate=null;state.focusSelection=false;
 applyVisibility();interaction?.sync();resize();fit();
});
$('focus-selected').onclick=()=>run(()=>fit(state.selected));
$('label-selected').onclick=()=>run(()=>{
 const remove=state.selected.length>0&&state.selected.every(hasStructureLabel);
 if(remove){const names=new Set(state.selected.map(id=>partMap.get(id)?.name));state.labels=state.labels.filter(label=>!state.selected.includes(label.structureId)&&!(!label.structureId&&names.has(label.text)));}
 else for(const id of state.selected){const e=entries.get(id);if(e&&!hasStructureLabel(id))state.labels.push({structureId:id,text:e.part.name,position:e.box.getCenter(V()).add(e.offset).toArray()});}
 renderLabels();
});
$('clear-annotations').onclick=()=>run(()=>{state.labels=[];state.strokes=[];rebuildStrokes();renderLabels();});
let desktopAutoLabels=$('auto-labels').checked;
const syncAutoLabels=()=>{$('auto-labels').checked=mobileLabels.matches||desktopAutoLabels;hoverLabel=null;renderLabels();};
$('auto-labels').onchange=()=>{if(!mobileLabels.matches)desktopAutoLabels=$('auto-labels').checked;syncAutoLabels();};
mobileLabels.addEventListener('change',syncAutoLabels);syncAutoLabels();
$('section-tool').onclick=()=>run(()=>toggleSection());
for(const id of ['section','explode']){
 $(id).addEventListener('pointerdown',beginChange);$(id).addEventListener('keydown',beginChange);
 $(id).oninput=()=>{beginChange();if(motion)teardownMotion();updateSection();};$(id).onchange=finishChange;$(id).onkeyup=finishChange;
}
$('axis').onchange=()=>run(()=>{updateSection();alignSectionView();});
$('activity-select').onchange=()=>action(()=>playActivity($('activity-select').value));
$('life-mode').onclick=()=>action(()=>playActivity('whole-body:whole-body-vitality'));
$('micro-play').onclick=()=>{microPlaying=!microPlaying;$('micro-play').textContent=microPlaying?'❚❚ 暂停':'▶ 播放';};
$('capture-image').onclick=()=>{const a=document.createElement('a');a.href=captureImage(1600);a.download='bodyvista-'+Date.now()+'.png';a.click();toast('场景图片已导出');};
document.querySelectorAll('[data-quiz-kind]').forEach(button=>button.onclick=()=>{
 if($('quiz').dataset.stage==='playing')return;
 quizStage('playing');action(()=>startQuiz(button.dataset.quizKind));
});
$('quiz-start').onclick=()=>action(()=>startQuiz());
$('quiz-home').onclick=()=>action(quizHome);
$('quiz-next').onclick=()=>{
 if(!quizRun?.answered||$('quiz-next').hidden)return;
 $('quiz-next').hidden=true;action(async()=>{quizRun.index++;if(quizRun.index>=quizRun.questions.length)finishQuiz();else await nextQuestion();});
};
$('quiz-locate').onclick=()=>action(()=>focusPart(quizRun.questions[quizRun.index].id));
window.addEventListener('keydown',event=>{
 const typing=/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
 if(!typing&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();$(event.shiftKey?'redo':'undo').click();}
 if(!typing&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='y'){event.preventDefault();$('redo').click();}
 if(event.key==='Escape'&&!document.querySelector('dialog[open]')){setTool('');closeOverlays();$('inspector').hidden=true;interaction?.closePopovers();if(quizRun?.finding){finder.hidden=true;quizRun.finding=false;$('quiz').hidden=false;}interaction?.sync();}
});
// Read-only diagnostics plus the same view operations used by the UI, for embedding and thumbnail builds.
window.BodyVista={
 getState:snapshot,getCounts:()=>({loaded:entries.size,total:parts.length,visible:[...entries.values()].filter(e=>e.group.visible).length,systems:loaded.size}),
 getMotionModes:()=>motion?.modes||[],getFlowStats:atlasFlowStats,getEntry:id=>entries.get(id),capture:captureImage,
 showSystem:key=>action(()=>showSystem(key)),showMicro:key=>action(()=>showMicro(key)),showRegion:key=>action(()=>presetRegion(key)),
 showInternal:()=>action(internalView),showSection:axis=>action(()=>openSection(axis)),playActivity:value=>action(()=>playActivity(value,false)),
 restore:view=>action(()=>restore(validateView(view,new Set(partMap.keys()),new Set(systems.keys())))),
 whenIdle:()=>queue,rendererInfo:()=>copy(renderer.info.render)
};
initializeAtlasControls();buildLayers();buildActivities();
viewNavigation=setupViewNavigation({camera,controls,stage:$('stage'),togglePan:()=>setTool('pan'),beginChange,finishChange});
interaction=setupInteraction({
 context:()=>({dental:document.body.dataset.dental,detailId:state.selected[0],micro:state.micro,motion:!!motion||!!document.body.dataset.dentalMotion,tool,slicing:!$('slice-bar').hidden,selected:state.selected.length,isolated:!!state.isolate,allFaded:state.selected.length>0&&state.selected.every(id=>state.faded.includes(id)),finding:!finder.hidden,playing:state.micro?microPlaying:motion?.snapshot().playing}),
 exitMode:()=>action(async()=>{
   if(motion||state.micro){$('inspector').hidden=true;await setLayers(initialLayers());}
   else {setTool('');toggleSection(false);}
 }),
 togglePlayback:()=>{if(state.micro)$('micro-play').click();else if(motion)$('motion-play').click();},
 openPlayback:()=>openNav('media')
});
document.addEventListener('atlas:language',()=>{if(state.selected[0]&&!state.micro)showKnowledge(partMap.get(state.selected[0]));if($('inspector').dataset.panel==='search')renderSearch();if(!$('gallery').hidden)renderGallery();$('quiz-scores').textContent=scoreText();motion?.refresh(true);updateVitalSigns();interaction.sync();renderLabels();});
setupDental({exit:mode=>action(async()=>{if(mode==='anatomy')await presetRegion('head');else await playActivity('whole-body:whole-body-vitality');interaction?.sync();}),sync:()=>interaction?.sync()});
 setTool('pan',false);initLanguage();resize();historyUI();
try{
 await ensure(['skeletal','skin']);applyVisibility();fit();
 const major=parts.filter(p=>p.detail_file&&/^(frontal bone|parietal bone|temporal bone|occipital bone|sphenoid bone|maxilla|mandible|zygomatic bone|sacrum|hip bone|femur|humerus|tibia|ulna|radius)( |$)/.test(p.english));
 busy();for(let i=0;i<major.length;i+=5)await Promise.all(major.slice(i,i+5).map(p=>loadDetail(p.id)));
 idle();document.body.dataset.ready='true';
}
catch(error){setText($('loading-text'),'模型加载失败：'+error.message);document.body.dataset.ready='error';}

/* Workspace controls and original line icons for the full-body Atlas. */
function atlasToolIcon(key){
 const paths={
  pan:'M12 18V8a3 3 0 0 1 6 0v9-12a3 3 0 0 1 6 0v12-9a3 3 0 0 1 6 0v11-6a3 3 0 0 1 6 0v11c0 9-4 13-13 13-7 0-9-4-12-8l-6-8a3 3 0 0 1 5-4l2 3',
  select:'M8 3v29l8-8 6 11 5-3-6-10 12-1z',
  undo:'M12 7 4 13l8 5M5 13h16c13 0 13 19-1 19h-7',redo:'M24 7l8 6-8 5M31 13H15C2 13 2 32 16 32h7',
  'chevron-left':'M23 6 12 19l11 13','chevron-right':'M13 6l11 13-11 13',
  reset:'M18 3l-6 6 7 2M13 9C2 15 5 32 19 33c17 0 20-22 7-28',
  link:'M15 25l-3 3a7 7 0 0 1-10-10l7-7a7 7 0 0 1 10 0l2 2m0-2 3-3a7 7 0 0 1 10 10l-7 7a7 7 0 0 1-10 0l-2-2M13 13l12 12',
  settings:'m15 3-1 5-5 3-5-1-3 6 4 3v5l-3 4 4 5 5-2 5 2 2 4 6-1 1-5 4-3 5 1 2-6-4-3v-5l3-4-4-5-4 2-5-2-2-4z M25 19a6 6 0 1 1-12 0 6 6 0 0 1 12 0',
  help:'M35 19a16 16 0 1 1-32 0 16 16 0 0 1 32 0M14 13c0-7 13-7 11 0-1 3-6 4-6 8m0 5v1',
  fullscreen:'M3 14V3h11m10 0h11v11m0 10v11H24M14 35H3V24M4 4l10 10M34 4 24 14M4 34l10-10m20 10L24 24',
  fit:'M6 14V6h8m10 0h8v8m0 10v8h-8m-10 0H6v-8M19 11v16m-8-8h16',
  menu:'M4 5h11v11H4zM22 5h11v11H22zM4 23h11v11H4zM22 23h11v11H22z',
  search:'M16 24a10 10 0 1 1 14-14 10 10 0 0 1-14 14zM18 23 6 35M3 5h7M3 12h5M3 19h5',
  scalpel:'M27 3 36 9 20 28 13 22zM13 22 3 35l11-3 6-4M25 5l8 6',
  multi:'M22 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0M10 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0M34 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0M22 31a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  pencil:'m6 25 20-22 9 9-20 22-12 3zM22 7l9 9M6 25l9 9M9 22l9 9',
  notes:'M3 6h22M14 6v27m-7 0h14M3 6v5m22-5v5m7-5v27m-4-21h8m-8 14h8',
  star:'m19 2 5 11 12 2-9 9 2 12-10-6-10 6 2-12-9-9 12-2zM19 13v13m-6-6h12',
  share:'M19 26V2m-7 7 7-7 7 7M12 15H5v20h28V15h-7',
  pulse:'M3 20h7l4-11 7 22 5-17 3 6h7',
  layers:'M19 3 3 11l16 8 16-8zM3 19l16 8 16-8M3 27l16 8 16-8',
  quiz:'M26 5H5v30h28V17M13 17l6 6L35 4',
  section:'M4 6h30v27H4zM4 19h30M13 6v27M25 6v27',
  measure:'M3 12v14m32-14v14M3 19h32M8 14l-5 5 5 5m22-10 5 5-5 5'
 };
 return '<svg viewBox="0 0 38 38" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[key]||paths.menu)+'"/></svg>';
}
function atlasOrganIcon(key){
 const body='M16 1a2.7 2.7 0 1 1 0 5.4A2.7 2.7 0 0 1 16 1M11.6 7h8.8l3 7.8 1.6 6-2 1-2.5-6.7-1.1-2.5.2 9L21 31h-3l-2-10-2 10h-3l1.4-9.4.2-9L9 21.8l-2-1 1.6-6z';
 const shapes={
  skin:body,'body-organs':body,
  skeletal:'M16 2C4 2 3 11 6 17l3 4 1 7h12l1-7 3-4C29 11 28 2 16 2ZM9 11a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm14 0a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm-7 5 2 5h-4Zm-5 8h2v4h-2Zm4 0h2v4h-2Zm4 0h2v4h-2Z',
  joints:'M11 1h10l-1 8c5 6 4 9-1 9l-3-2-3 2c-5 0-6-3-1-9zM11 21c2-3 4-3 5-1 1-2 3-2 5 1l-2 5 1 6h-8l1-6z',
  muscular:'M5 20 8 10l-1-4 4-3 4 3-2 3-2-1-1 9c2-3 5-3 8-1l4 2 1-7-4-4 2-4 5 3 3 5-1 12C25 32 12 31 5 25z',
  nervous:'M14 4C7-1 4 6 5 10c-7 3-4 12 1 13 0 7 9 9 11 2l3 5 3 1-2-7c10-1 10-8 7-10 6-6-2-15-7-12-2-3-5-2-7 2z',
  cardiovascular:'M17 10 15 3l3-2 2 7 5-4 2 3-5 6c11 12 4 20-4 17-8-2-14-12-12-17 1-4 5-5 9-3z',
  respiratory:'M15 2h2v10l5-6c3-1 8 7 9 17 1 6-9 8-12 3l-1-11-2-2-2 2-1 11C9 32 0 29 1 23 2 13 7 5 10 6l5 6z',
  digestive:'M14 1h4v9c6-1 4-4 9-2 6 5 5 16-1 21-8 6-13-4-19-4-4 0-3 5-5 4-2-4 1-9 5-9 5 0 6 5 9 2 4-4-2-6-2-9z',
  urinary:'M9 3C-3 3-1 26 7 27c7 0 7-7 4-10-4-5 5-10-2-14Zm14 0c12 0 10 23 2 24-7 0-7-7-4-10 4-5-5-10 2-14ZM12 21h2l1 9h-2Zm6 0h2l-1 9h-2Z',
  sensory:'M0 16C8 3 23 3 32 16 23 29 8 29 0 16Zm7 0a9 9 0 1 0 18 0 9 9 0 0 0-18 0Zm5 0a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z',
  reproductive:'M3 4 0 12l3 14 10 5 3-8 3 8 10-5 3-14-3-8-8 3-5 7-5-7zM7 12l7 5-3 8-5-4Zm18 0 1 9-5 4-3-8Z',
  endocrine:'M14 12C7-2 0 5 4 20c3 10 8 7 10 1h4c2 6 7 9 10-1C32 5 25-2 18 12z',
  lymphatic:'M13 12 5 6l1-2 9 7 9-8 2 2-9 8 9 13-2 2-9-13-9 13-2-2zM8 5a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm12 9a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM32 4a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM9 28a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm22 0a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'
 };
 let extra='';
 if(key==='body-organs')extra='<path d="M14 12c-4-4-5 5-2 6l2-1zm4 0c4-4 5 5 2 6l-2-1zM14 19h4l1 3h-6z" fill="#fff" opacity=".75"/>';
 return '<svg viewBox="0 0 32 32" aria-hidden="true" fill="currentColor"><path fill-rule="evenodd" d="'+(shapes[key]||body)+'"/>'+extra+'</svg>';
}
function atlasMaterialColor(part,fallback){
 const color=new THREE.Color(part.teaching_color||fallback),category=part.color_category||'';
 if(part.systems.includes('skin'))return color.set('#e7e6e3');
 const palette=category==='骨'||category==='听小骨'?['#e6dfd0',.77]:category==='牙'?['#f4ead5',.85]:/软骨/.test(category)?['#cdd5d4',.8]:/韧带|关节囊|纤维膜/.test(category)?['#ccc6b7',.7]:null;
 return palette?color.lerp(new THREE.Color(palette[0]),palette[1]):color;
}
function initializeAtlasControls(){
 document.querySelectorAll('[data-icon]').forEach(n=>n.innerHTML=atlasToolIcon(n.dataset.icon));
 document.querySelectorAll('[data-organ]').forEach(n=>n.innerHTML=atlasOrganIcon(n.dataset.organ));

 for(const s of [{id:'all',name:'全部系统'},...atlasLayerSystems()]){
  const b=el('button');b.title=s.name;b.ariaLabel='筛选'+s.name;b.dataset.filter=s.id;b.setAttribute('aria-selected',String(s.id==='all'));
  b.innerHTML=s.id==='all'?atlasToolIcon('search'):atlasOrganIcon(s.id);
  b.onclick=()=>{$('search-system').value=s.id;searchLimit=60;renderSearch();};$('search-filters').append(b);
 }
 for(const [index,name] of ['右心','肺动脉','肺与肺静脉','左心','体动脉','体静脉'].entries()){
  const b=el('button','',name);b.dataset.stop=index;
  b.onclick=()=>action(async()=>{if(!motion||motion.snapshot().id!=='whole-body-oxygen-journey')await playActivity('whole-body:whole-body-oxygen-journey',false);
   const phase=(index+.3)/6;$('motion-phase').value=phase*100;$('motion-phase').dispatchEvent(new Event('input'));finishChange();updateVitalSigns();});
  $('circulation-stops').append(b);
 }
}
function atlasLayerSystems(){
 const order=['skeletal','joints','muscular','nervous','cardiovascular','respiratory','digestive','urinary','lymphatic','endocrine','reproductive','sensory','skin'];
 return order.map(id=>id==='joints'?{id,name:'关节与韧带'}:systems.get(id));
}
function updateVitalSigns(){
 const s=motion?.snapshot(),whole=s?.id.startsWith('whole-body-'),cardiac=whole||/cardiac|heart|coronary|ventricular|aortic|pulse/.test(s?.id||'');
 $('vital-signs').hidden=!cardiac||!!state.micro;$('circulation-guide').hidden=!whole||!!state.micro;
 if(!cardiac)return;
 const beat=whole?(s.phase*(s.id==='whole-body-exercise'?8:5))%1:s.phase;
 setText($('cardiac-phase'),beat<.22?'心房收缩':beat<.64?'心室射血':'舒张充盈');
 setText($('breath-phase'),(s.id==='whole-body-exercise'?(s.phase*2)%1:s.phase)<.4?'吸气':'呼气');
 const gaussian=(x,c,w)=>Math.exp(-(((x-c)/w)**2));
 const y=x=>25-5*gaussian(x,.14,.04)+6*gaussian(x,.27,.018)-22*gaussian(x,.3,.015)+8*gaussian(x,.33,.018)-7*gaussian(x,.56,.08);
 $('rhythm-wave').querySelector('path').setAttribute('d',Array.from({length:131},(_,i)=>(i?'L':'M')+(i*2)+','+y(i/130).toFixed(2)).join(''));
 $('rhythm-wave').querySelector('circle').setAttribute('cx',beat*260);$('rhythm-wave').querySelector('circle').setAttribute('cy',y(beat));
 for(const b of $('circulation-stops').children)b.classList.toggle('active',s.id==='whole-body-oxygen-journey'&&Number(b.dataset.stop)===Math.min(5,Math.floor(s.phase*6)));
}
function atlasFlowStats(){
 let cells=0,vessels=0,visible=0,finite=true,biconcave=true,sample=[];
 for(const e of entries.values())e.motion?.traverse(o=>{
  if(!o.userData.bio2meshBlood)return;cells+=o.count;vessels++;if(o.visible&&e.group.visible)visible+=o.count;
  biconcave&&=o.geometry.userData.biconcave===true;
  finite&&=Array.from(o.instanceMatrix.array).every(Number.isFinite);
  if(o.visible&&sample.length<48)sample.push(...Array.from(o.instanceMatrix.array.slice(0,16)).map(v=>Number(v.toFixed(7))));
 });
 return {cells,vessels,visible,finite,biconcave,sample};
}

/* Original procedural teaching scenes. All dimensions use illustration units. */
function createMicroAnatomy(THREE,key){
 const group=new THREE.Group(),labels=[],updates=[],V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
 const material=(color,opacity=1)=>new THREE.MeshStandardMaterial({color,roughness:.5,metalness:0,transparent:opacity<1,opacity,depthWrite:opacity===1,side:THREE.DoubleSide});
 const mat={pink:material('#d99d9e'),red:material('#b9656b'),blue:material('#6eacc2'),gold:material('#e2ba72'),wall:material('#d8aca4',.28),teal:material('#79aaa7')};
 function mesh(geometry,m,position=[0,0,0],scale=[1,1,1]){const o=new THREE.Mesh(geometry,m);o.position.set(...position);o.scale.set(...scale);group.add(o);return o;}
 function sphere(p,r,m,scale=[1,1,1]){return mesh(new THREE.SphereGeometry(r,24,18),m,p,scale);}
 function tube(points,r,m,closed=false){const curve=new THREE.CatmullRomCurve3(points.map(p=>V(...p)),closed);mesh(new THREE.TubeGeometry(curve,100,r,10,closed),m);return curve;}
 function label(text,p){labels.push({text,position:p});}
 function flow(curve,m,count=15,rate=.1,size=.025){
  const particles=Array.from({length:count},()=>sphere([0,0,0],size,m));
  updates.push(t=>particles.forEach((p,i)=>p.position.copy(curve.getPointAt((t*rate+i/count)%1))));
 }
 function bar(a,b,r,m){const d=V(...b).sub(V(...a));const o=mesh(new THREE.CylinderGeometry(r,r,d.length(),16),m,V(...a).add(V(...b)).multiplyScalar(.5).toArray());o.quaternion.setFromUnitVectors(V(0,1,0),d.normalize());return o;}
 if(key==='alveoli'){
  const air=tube([[0,0,1.05],[0,0,.65],[0,0,.35]],.115,mat.pink);flow(air,mat.teal,8,.15,.025);
  for(let i=0;i<7;i++){
   const angle=i*Math.PI*2/7,x=Math.cos(angle)*.42,y=Math.sin(angle)*.24,z=-.05+(i%2)*.24;
   const sac=sphere([x,y,z],.33,mat.wall);updates.push(t=>sac.scale.setScalar(1+.045*Math.sin(t*1.8)));
   const pts=Array.from({length:17},(_,k)=>{const a=k/16*2*Math.PI;return[x+Math.cos(a)*.34,y-.1,z+Math.sin(a)*.32];});
   const cap=tube(pts,.025,i<3?mat.blue:mat.red,true);flow(cap,i<3?mat.blue:mat.red,8,.12,.032);
  }
  const gases=Array.from({length:18},(_,i)=>sphere([0,0,0],.014,i%2?mat.teal:mat.gold));
  updates.push(t=>gases.forEach((g,i)=>{const u=(t*.2+i/18)%1,a=i*2.4;g.position.set(Math.cos(a)*(.12+.5*u),-.13,Math.sin(a)*(.12+.5*u));}));
  label('肺泡腔',[.2,-.2,.22]);label('肺泡周围毛细血管',[-.48,-.26,-.28]);label('细支气管',[0,0,.98]);
 }else if(key==='nephron'){
  sphere([-.38,0,.62],.32,mat.wall);
  const coil=Array.from({length:80},(_,i)=>{const a=i*.45;return[-.38+Math.cos(a)*.16,Math.sin(a)*.09,.62+Math.sin(a*.31)*.16];});
  flow(tube(coil,.022,mat.red),mat.red,14,.08);
  const path=tube([[-.15,0,.56],[.1,.03,.75],[.4,.03,.48],[.04,0,.28],[.02,0,-.65],[.3,0,-.85],[.46,0,-.62],[.45,0,.25],[.72,0,.47],[.6,0,.6],[.85,0,.7],[1,0,.32],[.96,0,-.85]],.065,mat.gold);
  flow(path,mat.teal,28,.065,.031);
  label('肾小球',[-.38,-.25,.62]);label('肾小囊',[-.65,0,.8]);label('肾小管',[.25,0,.72]);label('肾单位袢',[.25,0,-.82]);label('集合管',[.96,0,-.45]);
 }else if(key==='sarcomere'){
  const left=mesh(new THREE.BoxGeometry(.06,.55,1),mat.teal,[-.85,0,0]),right=mesh(new THREE.BoxGeometry(.06,.55,1),mat.teal,[.85,0,0]);
  const actin=[];
  for(let j=0;j<5;j++){
   const z=(j-2)*.18;bar([-.48,.05,z],[.48,.05,z],.035,mat.red);
   for(const side of [-1,1]){const a=bar([side*.92,-.1,z+.07],[side*.24,-.1,z+.07],.018,mat.gold);actin.push([a,side,a.position.x]);}
   for(let k=0;k<8;k++){const x=(k-3.5)*.12;bar([x,.04,z],[x+.04,-.065,z+.07],.012,mat.red);}
  }
  updates.push(t=>{const q=(1-Math.cos(t*1.6))*.5;left.position.x=-.85+.15*q;right.position.x=.85-.15*q;actin.forEach(([o,s,x])=>o.position.x=x-s*.15*q);});
  label('Z 线',[-.85,-.2,.55]);label('细肌丝（肌动蛋白）',[-.5,-.2,.34]);label('粗肌丝（肌球蛋白）',[.1,-.2,-.35]);
 }else if(key==='synapse'){
  sphere([0,0,.43],.55,mat.wall,[1,.6,.75]);bar([0,0,.7],[0,0,1.15],.14,mat.pink);
  mesh(new THREE.BoxGeometry(1.4,.55,.12),mat.teal,[0,0,-.35]);
  for(let i=0;i<8;i++){sphere([Math.cos(i*2.4)*.32,-.15,.4+Math.sin(i*2.4)*.18],.07,mat.gold);mesh(new THREE.BoxGeometry(.07,.15,.1),mat.blue,[(i-3.5)*.16,-.12,-.24]);}
  const transmitters=Array.from({length:24},()=>sphere([0,0,0],.021,mat.gold));
  updates.push(t=>transmitters.forEach((o,i)=>{const u=(t*.28+i/24)%1;o.position.set(Math.sin(i*2.4)*(.15+u*.4),-.17,.25-u*.48);o.material=mat.gold;}));
  label('突触前末梢',[.4,-.2,.64]);label('突触间隙',[.55,-.2,-.04]);label('突触后膜',[.6,-.2,-.35]);label('递质囊泡',[-.32,-.2,.45]);
 }else if(key==='villi'){
  mesh(new THREE.BoxGeometry(1.8,.7,.15),mat.pink,[0,0,-.65]);
  for(let i=0;i<5;i++){
   const x=(i-2)*.36;const v=sphere([x,0,-.02],.17,mat.wall,[1,1,3.1]);
   tube([[x-.07,-.07,-.55],[x-.075,-.07,.37],[x,-.07,.47],[x+.07,-.07,.37],[x+.07,-.07,-.55]],.017,mat.red);
   const lacteal=tube([[x,.01,-.6],[x,.01,.3]],.026,mat.teal);flow(lacteal,mat.gold,9,.1,.018);
   updates.push(t=>v.rotation.y=.025*Math.sin(t*1.3+i));
  }
  label('小肠绒毛',[-.7,-.2,.55]);label('毛细血管网',[0,-.2,.25]);label('中央乳糜管',[.37,-.2,.1]);label('黏膜下方',[.5,-.2,-.7]);
 }else if(key==='vessel'){
  const walls=[];
  for(const [radius,m] of [[.53,mat.pink],[.44,mat.gold],[.35,mat.red]]){
   const o=mesh(new THREE.CylinderGeometry(radius,radius,1.7,48,1,true,Math.PI*.4,Math.PI*1.2),m);o.rotation.x=Math.PI/2;
   walls.push(o);
  }
  mat.cells=material('#c72f35');mat.cells.roughness=.38;
  const cells=Array.from({length:38},()=>mesh(createErythrocyteGeometry(THREE,24,14),mat.cells,[0,0,0],[.065,.065,.065]));
  updates.push(t=>{
   const beat=.028*Math.sin(t*5.5);
   walls.forEach(o=>{o.scale.x=1+beat;o.scale.z=1+beat;});
   cells.forEach((o,i)=>{const a=i*2.4,r=.035+(i%5)*.046,speed=.3*(1-(r/.36)**2),u=(t*speed+.012*Math.sin(t*5.5)+i/38)%1;
    o.position.set(Math.cos(a)*r,Math.sin(a)*r,(u-.5)*1.7);o.rotation.set(.35*Math.sin(t+i),.25*Math.cos(t*.7+i),t*.22+i);
   });
  });
  label('外膜',[.56,-.15,.62]);label('中膜',[.43,-.25,.25]);label('内膜',[.28,-.2,-.26]);label('双凹圆盘形红细胞',[0,-.1,-.65]);
 }
 return {group,labels,tick:time=>updates.forEach(fn=>fn(time)),dispose(){group.traverse(o=>{if(o.geometry)o.geometry.dispose();});new Set(Object.values(mat)).forEach(m=>m.dispose());}};
}

/* BodyVista teaching motions v2. Geometry changes exist only in the browser.
 * The downloaded GLB and its atlas coordinate frame remain the original data.
 * All presets are gated by actual named parts; no inferred missing structures.
 */
function createAnatomyMotion({THREE,entries,data,$,camera,controls,run,beginChange,finishChange,getSelected,updateSection,fit,partLabel}){
 const TAU=Math.PI*2,V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
 const basis=new THREE.Matrix4(),r=data.anatomical_rotation;
 if(r)basis.set(r[0][0],r[0][1],r[0][2],0,r[1][0],r[1][1],r[1][2],0,r[2][0],r[2][1],r[2][2],0,0,0,0,1);
 else if(data.up_axis==='y')basis.makeRotationX(-Math.PI/2);
 const inverseBasis=basis.clone().invert(),scratch=V();
 const modeMap=new Map(),modes=[],posed=new Set(),lit=new Set(),deformed=new Set(),vertexCache=new Map();
 let state={id:'',playing:false,phase:0,speed:1,amplitude:1,side:'both',focus:true,contextFade:true,flow:true,rhythm:'natural'},living=null,lastTime=null,frame=0,phaseLabel='准备开始',phaseDetail='',activeNames=[],lastUI=0;
 let base={camera:camera.position.toArray(),target:controls.target.toArray(),section:Number($('section').value),explode:Number($('explode').value)};
 const matList=e=>e.meshes.flatMap(m=>Array.isArray(m.material)?m.material:[m.material]).concat(e.caps.map(p=>p.cap.material));
 const materialBase=new Map();
 for(const e of entries){
  e.motion=new THREE.Group();e.motion.matrixAutoUpdate=false;e.group.add(e.motion);
  e.meshes.forEach(m=>e.motion.add(m));e.caps.forEach(p=>e.motion.add(p.stencil));
  e.motionName=String(e.part.original_english||e.part.english||e.part.knowledge?.english||e.part.name).toLowerCase().replace(/[()]/g,'').replace(/\s+/g,' ').trim().replace(/^aortic arch$/,'arch of aorta');
  e.motionCategory=e.part.color_category||e.part.knowledge?.category||'';
  e.motionBox=new THREE.Box3();
  for(const m of e.meshes){const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++)e.motionBox.expandByPoint(scratch.fromBufferAttribute(p,i).applyMatrix4(inverseBasis));}
  e.motionCenter=e.motionBox.getCenter(V());e.motionSize=e.motionBox.getSize(V());
  for(const m of matList(e))materialBase.set(m,{opacity:m.opacity,transparent:m.transparent,depthWrite:m.depthWrite});
 }
 const match=re=>entries.filter(e=>re.test(e.motionName)),exact=name=>entries.find(e=>e.motionName===name);
 const category=name=>entries.filter(e=>e.motionCategory===name),unique=arr=>[...new Set(arr.flat())];
 const both=re=>match(re),sideOK=e=>state.side==='both'||new RegExp('\\b'+state.side+'\\b').test(e.motionName);
 const boxOf=arr=>{const b=new THREE.Box3();arr.forEach(e=>b.union(e.motionBox));return b;};
 const middle=arr=>boxOf(arr).getCenter(V());
 const wave=p=>(1-Math.cos(TAU*p))/2;
 const pulse=(p,a,b)=>p>a&&p<b?Math.sin(Math.PI*(p-a)/(b-a)):0;
 const chapter=slug=>'https://openstax.org/books/anatomy-and-physiology-2e/pages/'+slug;
 const source={joint:chapter('9-5-types-of-body-movements'),heart:chapter('19-3-cardiac-cycle'),blood:chapter('20-2-blood-flow-blood-pressure-and-resistance'),breath:chapter('22-3-the-process-of-breathing'),air:chapter('22-1-organs-and-structures-of-the-respiratory-system'),digest:chapter('23-2-digestive-system-processes-and-regulation'),swallow:chapter('23-3-the-mouth-pharynx-and-esophagus'),urine:chapter('25-2-gross-anatomy-of-urine-transport'),eye:chapter('14-1-sensory-perception'),muscle:chapter('10-2-skeletal-muscle'),nerve:chapter('12-4-the-action-potential'),lymph:chapter('21-1-anatomy-of-the-lymphatic-and-immune-systems'),thyroid:chapter('17-4-the-thyroid-gland'),male:chapter('27-1-anatomy-and-physiology-of-the-testicular-reproductive-system')};
 function add(m){
  m.targets=unique(m.targets||[]).filter(Boolean);if(!m.targets.length&&!m.general)return;
  m.duration=m.duration||6;m.kind=m.kind||'运动形变示意';m.group=m.group||'生理过程';modes.push(m);modeMap.set(m.id,m);
 }
 function pose(e,pivot,axis=V(1,0,0),angle=0,scales=[1,1,1],translation=null){
  // Build in anatomical axes, then conjugate into the exported coordinate frame.
  const local=new THREE.Matrix4().makeRotationAxis(axis,angle).multiply(new THREE.Matrix4().makeScale(...scales));
  scratch.copy(pivot).sub(pivot.clone().applyMatrix4(local));if(translation)scratch.add(translation);
  local.setPosition(scratch);e.motion.matrix.copy(basis).multiply(local).multiply(inverseBasis);e.motion.matrixWorldNeedsUpdate=true;posed.add(e);
 }
 function scaleParts(arr,pivot,scales){arr.forEach(e=>pose(e,pivot,V(1,0,0),0,scales));}
 function restoreLight(e){
  const selected=e===getSelected();for(const m of matList(e))if(m.emissive){m.emissive.set(selected?0x0071e3:0);m.emissiveIntensity=selected?.17:0;}
 }
 function light(arr,intensity=.65,color=0xf2a64b){for(const e of arr){for(const m of matList(e))if(m.emissive){m.emissive.set(color);m.emissiveIntensity=intensity*state.amplitude;}lit.add(e);}}
 function resetFrame(){
  living?.resetFrame();
  for(const e of posed){e.motion.matrix.identity();e.motion.matrixWorldNeedsUpdate=true;}posed.clear();
  for(const e of lit)restoreLight(e);lit.clear();
 }
 function restoreVertices(){
  for(const mesh of deformed){const c=vertexCache.get(mesh);mesh.geometry.attributes.position.array.set(c.original);mesh.geometry.attributes.position.needsUpdate=true;if(c.normals){mesh.geometry.attributes.normal.array.set(c.normals);mesh.geometry.attributes.normal.needsUpdate=true;}mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();}
  deformed.clear();
 }
 function resetEffects(){
  resetFrame();restoreVertices();
 }
 function applyContext(){
  const mode=modeMap.get(state.id),active=new Set(mode?.targets||[]),fade=state.contextFade&&mode&&!mode.general;
  for(const e of entries)for(const m of matList(e)){
   const original=materialBase.get(m),dim=fade&&!active.has(e),opacity=dim?Math.min(original.opacity,.07):original.opacity;
   const transparent=dim||original.transparent,depthWrite=dim?false:original.depthWrite;
   if(m.opacity!==opacity||m.transparent!==transparent||m.depthWrite!==depthWrite){m.opacity=opacity;m.transparent=transparent;m.depthWrite=depthWrite;m.needsUpdate=true;}
  }
 }
 function captureMaterialBase(){for(const e of entries)for(const mesh of e.meshes)for(const m of Array.isArray(mesh.material)?mesh.material:[mesh.material])materialBase.set(m,{opacity:m.opacity,transparent:m.transparent,depthWrite:m.depthWrite});applyContext();}
 function cacheVertices(mesh){
  if(vertexCache.has(mesh))return vertexCache.get(mesh);
  const original=mesh.geometry.attributes.position.array.slice(),anatomical=new Float32Array(original.length);
  for(let i=0;i<original.length;i+=3){scratch.fromArray(original,i).applyMatrix4(inverseBasis).toArray(anatomical,i);}
  const c={original,anatomical,normals:mesh.geometry.attributes.normal?.array.slice()};vertexCache.set(mesh,c);return c;
 }
 function deform(e,fn){
  for(const m of e.meshes){const c=cacheVertices(m),out=m.geometry.attributes.position.array;
   if(state.phase===0||state.amplitude===0){out.set(c.original);m.geometry.attributes.position.needsUpdate=true;if(c.normals){m.geometry.attributes.normal.array.set(c.normals);m.geometry.attributes.normal.needsUpdate=true;}m.geometry.computeBoundingBox();m.geometry.computeBoundingSphere();deformed.add(m);continue;}
   for(let i=0;i<c.anatomical.length;i+=3){scratch.fromArray(c.anatomical,i);fn(scratch,c,i);scratch.applyMatrix4(basis).toArray(out,i);}
   m.geometry.attributes.position.needsUpdate=true;
   if(!state.playing||frame%3===0)m.geometry.computeVertexNormals();
   m.geometry.computeBoundingBox();m.geometry.computeBoundingSphere();deformed.add(m);
  }
 }
 function tubeWave(e,p,strength=.3){
  const b=e.motionBox,span=Math.max(.0001,b.max.z-b.min.z),bins=48;
  for(const mesh of e.meshes){const c=cacheVertices(mesh);if(!c.tube){
    const slices=Array.from({length:bins},()=>({x:0,y:0,n:0}));
    for(let i=0;i<c.anatomical.length;i+=3){const k=Math.min(bins-1,Math.max(0,Math.floor((c.anatomical[i+2]-b.min.z)/span*bins)));slices[k].x+=c.anatomical[i];slices[k].y+=c.anatomical[i+1];slices[k].n++;}
    for(const slice of slices)if(slice.n){slice.x/=slice.n;slice.y/=slice.n;}
    for(let k=0;k<bins;k++)if(!slices[k].n){let nearest=null;for(let d=1;d<bins&&!nearest;d++)for(const j of [k-d,k+d])if(j>=0&&j<bins&&slices[j].n){nearest=slices[j];break;}slices[k].x=nearest?.x??e.motionCenter.x;slices[k].y=nearest?.y??e.motionCenter.y;}
    c.tube=slices;
   }}
  const gate=Math.min(1,p*15,(1-p)*15),location=1.18-1.36*p;
  deform(e,(v,c)=>{const z=(v.z-b.min.z)/span,k=Math.min(bins-1,Math.max(0,Math.floor(z*bins))),center=c.tube[k];const squeeze=strength*state.amplitude*gate*Math.exp(-(((z-location)/.12)**2));v.x=center.x+(v.x-center.x)*(1-squeeze);v.y=center.y+(v.y-center.y)*(1-squeeze);});
 }
 function explain(title,detail='',arr=[]){phaseLabel=title;phaseDetail=detail;activeNames=arr;}
 function sequence(id,label,stages,description,link,group='过程讲解'){
  const valid=stages.filter(s=>s.parts.length);if(valid.length<2)return;
  add({id,label,group,kind:'过程高亮示意',description,source:link,targets:valid.flatMap(s=>s.parts),duration:Math.max(6,valid.length*1.8),stages:valid,apply(p){const i=Math.min(valid.length-1,Math.floor(p*valid.length)),s=valid[i];light(s.parts,.5+.2*Math.sin(Math.PI*(p*valid.length-i)));explain((i+1)+' / '+valid.length+' · '+s.label,s.note||'',s.parts);}});
 }
 const s=(label,parts,note='')=>({label,parts,note});

 // Cardiac chambers are exact-name matches: nearby named vessels must not contract.
 const atria=both(/^(left|right) atrium$/),ventricles=both(/^(left|right) ventricle$/),valves=both(/leaflet/),papillary=both(/papillary muscle/);
 if(atria.length&&ventricles.length){
  const heart=unique([atria,ventricles,valves,papillary]);
  add({id:'heartbeat',label:'心脏搏动',targets:heart,source:source.heart,duration:1.6,description:'心房先收缩，随后心室收缩，再进入舒张充盈。',apply(p){
   const a=pulse(p,.04,.22),v=pulse(p,.24,.58),amp=state.amplitude;
   for(const e of atria)scaleParts([e],e.motionCenter,[1-.09*a*amp,1-.09*a*amp,1-.12*a*amp]);
   const c=middle(ventricles);scaleParts(unique([ventricles,papillary]),c,[1-.09*v*amp,1-.09*v*amp,1-.12*v*amp]);
   if(a>.1)light(atria,a*.35);if(v>.1)light(ventricles,v*.35);
   explain(p<.24?'心房收缩 · 心室充盈':p<.6?'心室收缩 · 射血阶段':'全心舒张 · 再次充盈','观察心房与心室的先后变化。',p<.24?atria:ventricles);
  }});
  sequence('valve-cycle','心脏瓣膜开闭时序',[
   s('房室瓣开放阶段',valves.filter(e=>/atrioventricular/.test(e.motionName)),'心室充盈时，房室瓣开放。'),
   s('半月瓣开放阶段',valves.filter(e=>/semilunar/.test(e.motionName)),'心室射血时，半月瓣开放。')],
   '瓣膜随心动周期开放与关闭，两侧压力差推动血液单向流动。',source.heart);
  sequence('pulmonary-circulation','肺循环路径',[
   s('右心室',both(/^right ventricle$/)),s('肺动脉',both(/pulmonary (trunk|artery)/)),s('肺静脉',both(/pulmonary vein/),'气体交换发生于肺毛细血管，血液随后经肺静脉回流。'),s('左心房',both(/^left atrium$/))],
   '沿右心室、肺动脉、肺静脉和左心房，观察肺循环的路径。',source.heart);
  sequence('systemic-circulation','体循环主要通路',[
   s('左心室',both(/^left ventricle$/)),s('主动脉',both(/^(ascending aorta|arch of aorta|thoracic aorta|abdominal aorta)$/)),s('腔静脉',both(/^(superior|inferior) vena cava$/),'静脉血汇入腔静脉，回到右心房。'),s('右心房',both(/^right atrium$/))],
   '从左心室射出的血液经主动脉进入体循环，回流最终汇入腔静脉和右心房。展示主要通路的先后关系。',source.heart);
 }
 // Respiratory lobes use a common pivot per lung, retaining contacts between lobes.
 const lobes=both(/lobe of (left|right) lung/);
 if(lobes.length){
  const lungs=['left','right'].map(side=>({parts:lobes.filter(e=>e.motionName.includes(side))})).filter(x=>x.parts.length);
  for(const lung of lungs){lung.box=boxOf(lung.parts);lung.pivot=lung.box.getCenter(V());lung.pivot.z=lung.box.max.z;}
  add({id:'breathing',label:'肺的吸气与呼气',targets:lobes,source:source.breath,duration:5,description:'吸气时胸腔扩大，肺随之扩张；呼气时肺回缩。两侧肺叶按同一侧的共同支点变化，便于观察体积变化。',apply(p){const q=wave(p)*state.amplitude;for(const lung of lungs)scaleParts(lung.parts,lung.pivot,[1+.055*q,1+.075*q,1+.065*q]);explain(p<.5?'吸气 · 肺容积增加':'呼气 · 肺逐渐回缩','观察吸气与呼气时的肺部轮廓。',lobes);}});
 }
 sequence('airway-route','空气进入肺的路径',[
  s('鼻腔与咽',both(/nasal mucosa|nasopharynx|oropharynx|laryngopharynx/)),s('气管',both(/^trachea$/)),s('主支气管',both(/^(left|right) main bronchus$/)),s('肺叶及肺段支气管',both(/lobar bronchus|segmental bronchus/)),s('肺叶',lobes)],
  '沿气道观察空气进入肺部的路径。',source.air);
 const epiglottis=exact('epiglottis');
 if(epiglottis){const pivot=epiglottis.motionCenter.clone();pivot.z=epiglottis.motionBox.min.z;
  add({id:'epiglottis',label:'吞咽时的会厌倾转',targets:[epiglottis],source:source.swallow,duration:4,description:'吞咽时，会厌倾转，配合喉部活动保护气道入口。',apply(p){pose(epiglottis,pivot,V(1,0,0),-.65*wave(p)*state.amplitude);explain(p<.5?'会厌向后倾转':'会厌回到起始位','观察会厌与喉入口的位置变化。',[epiglottis]);}});
 }
 const esophagus=both(/^(oesophagus|esophagus)$/);
 if(esophagus.length)add({id:'esophageal-wave',label:'食管蠕动',targets:esophagus,source:source.swallow,description:'收缩波沿食管向下推进，将食团送向胃。',apply(p){esophagus.forEach(e=>tubeWave(e,p));explain('收缩波向胃侧推进','观察局部管径变窄的位置随时间下移。',esophagus);}});
 const stomach=both(/^(stomach|mucosa of stomach)$/);
 if(stomach.length){const c=middle(stomach);
  add({id:'stomach-mixing',label:'胃壁节律收缩',targets:stomach,source:source.digest,description:'胃壁节律性收缩，帮助混合食物并逐步排空。',apply(p){const q=wave(p)*state.amplitude;scaleParts(stomach,c,[1+.045*q,1-.08*q,1-.045*q]);explain(p<.5?'胃壁收缩':'胃壁舒张','观察整体轮廓随节律变化。',stomach);}});
 }
 if(esophagus.length&&stomach.length)sequence('digestive-route','消化道推进顺序',[
  s('口腔起点',both(/^tongue$/)),s('食管',esophagus),s('胃',stomach),s('十二指肠',both(/^duodenum$/)),s('空肠',both(/^jejunum$/),'接下来观察结肠的形态与位置。'),s('结肠',both(/^(ascending|transverse|descending|sigmoid) colon$/))],
  '沿消化道依次观察各段结构及其连接关系。',source.digest);
 sequence('bile-route','胆汁进入肠道的通路',[
  s('肝',both(/^liver$/)),s('胆囊',both(/^gallbladder$/),'肝脏分泌胆汁，胆囊储存和浓缩胆汁。'),s('胆管',both(/^bile duct$/)),s('十二指肠',both(/^duodenum$/))],
   '胆汁由肝产生，可在胆囊储存，经胆道进入十二指肠。这里用结构高亮区分产生、储存和输送的环节。',chapter('23-6-accessory-organs-in-digestion-the-liver-pancreas-and-gallbladder'));
 sequence('saliva-route','唾液腺与导管',[
  s('腮腺',both(/^parotid gland/)),s('腮腺管',both(/^parotid duct/)),s('下颌下腺',both(/^submandibular gland/)),s('下颌下腺管',both(/^submandibular duct/))],
  '分别观察腮腺和下颌下腺，沿各自导管认识唾液的分泌通路。',source.swallow);
 const ureters=both(/^ureter (left|right)$/),bladder=both(/^urinary bladder$/);
 if(ureters.length)add({id:'ureter-wave',label:'输尿管蠕动',targets:ureters,source:source.urine,description:'输尿管壁产生收缩波，将尿液从肾盂推向膀胱。',apply(p){ureters.forEach(e=>tubeWave(e,p,.35));explain('收缩波由上向下推进','左右输尿管同时演示，便于对照。',ureters);}});
 if(bladder.length){const b=boxOf(bladder),pivot=b.getCenter(V());pivot.z=b.min.z;
  add({id:'bladder-cycle',label:'膀胱充盈与排空',targets:bladder,source:source.urine,duration:8,description:'膀胱储尿时逐渐充盈，排尿后回缩。',apply(p){const q=wave(p)*state.amplitude;scaleParts(bladder,pivot,[1+.16*q,1+.16*q,1+.24*q]);explain(p<.5?'储尿 · 膀胱逐渐充盈':'排空 · 膀胱容积减小','可拖动进度停在任意阶段。',bladder);}});
 }
 sequence('urine-route','尿液排出通路',[
  s('肾',both(/^kidney (left|right)$/)),s('肾盂',both(/^renal pelvis/)),s('输尿管',ureters),s('膀胱',bladder),s('尿道',both(/^urethra$/))],
  '依次认识肾、肾盂、输尿管、膀胱和尿道，观察尿液形成后的运输通路。',source.urine);

 // Articulations use conservative rigid bone chains. Joint locations are atlas estimates.
 const bones=entries.filter(e=>e.motionCategory==='骨'||/^(humerus|radius|ulna|femur|patella|tibia|fibula|talus|calcaneus|mandible|atlas c1|axis c2)( |$)/.test(e.motionName));
 const isHand=e=>/finger of hand|metacarpal|scaphoid|lunate|triquetr|pisiform|trapezium|trapezoid bone|capitate|hamate/.test(e.motionName);
 const isFoot=e=>/toe|finger of foot|metatarsal|talus|calcaneus|navicular bone|cuneiform|cuboid/.test(e.motionName);
 const sideBones=side=>bones.filter(e=>new RegExp('\\b'+side+'\\b').test(e.motionName));
 function endpoint(e,upper){
  const b=e.motionBox,threshold=upper?b.max.z-e.motionSize.z*.085:b.min.z+e.motionSize.z*.085;let count=0;const sum=V();
  for(const m of e.meshes){const p=m.geometry.attributes.position;for(let i=0;i<p.count;i++){scratch.fromBufferAttribute(p,i).applyMatrix4(inverseBasis);if(upper?scratch.z>=threshold:scratch.z<=threshold){sum.add(scratch);count++;}}}
  return count?sum.multiplyScalar(1/count):e.motionCenter.clone();
 }
 function joint(id,label,anchorName,anchorUpper,selector,degrees,axisName='x',sign=-1,detail=''){
  const rigs=[];
  for(const side of ['left','right']){const anchor=exact(anchorName+' '+side),chain=sideBones(side).filter(selector);if(!anchor||!chain.length)continue;
   const pivot=endpoint(anchor,anchorUpper),rig={side,anchor,pivot,chain};
   // Bind small connective tissues to the nearest moving bone, excluding axial tissues.
   const movingSet=new Set(chain),candidateBones=sideBones(side);
   const tissues=entries.filter(e=>/韧带|关节囊|软骨|纤维膜|髌下/.test(e.motionCategory)&&new RegExp('\\b'+side+'\\b').test(e.motionName));
   for(const e of tissues){let best=null,d=Infinity;for(const b of candidateBones){const dist=b.motionBox.distanceToPoint(e.motionCenter);if(dist<d){d=dist;best=b;}}if(movingSet.has(best)&&d<.045)rig.chain.push(e);}
   rigs.push(rig);
  }
  if(!rigs.length)return;
  add({id,label,group:'关节运动',side:true,targets:rigs.flatMap(x=>[x.anchor,...x.chain]),source:source.joint,duration:5,description:detail+' 观察关节两侧骨骼的联动。',apply(p){const q=wave(p)*state.amplitude;
   for(const rig of rigs){if(state.side!=='both'&&state.side!==rig.side)continue;const axis=V();axis[axisName]=1;const angle=degrees*Math.PI/180*q*(sign==='side'?(rig.side==='left'?-1:1):sign);rig.chain.forEach(e=>pose(e,rig.pivot,axis,angle));}
   explain(Math.abs(p-.5)<.03?'运动幅度最大处':p<.5?'向演示方向运动':'逐渐回到起始姿态','拖动进度、切换左右侧，可以对照远端骨链与近端支点。');
  }});
 }
 joint('shoulder-flexion','肩关节前屈','humerus',true,e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e),70,'x',-1,'上臂向前抬起，前臂和手随上臂一起移动。');
 joint('shoulder-abduction','肩关节外展','humerus',true,e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e),65,'y','side','上肢向身体两侧抬起，观察肩关节的外展方向。');
 joint('elbow-flexion','肘关节屈伸','humerus',false,e=>/^(radius|ulna) /.test(e.motionName)||isHand(e),100,'x',-1,'前臂绕肘部向前屈曲，肱骨保持原位。');
 joint('wrist-flexion','腕关节掌屈','radius',false,isHand,45,'x',-1,'手部向掌侧屈曲，前臂骨保持原位。');
 joint('hip-flexion','髋关节前屈','femur',true,e=>/^(femur|patella|tibia|fibula) /.test(e.motionName)||isFoot(e),55,'x',-1,'大腿向前抬起，小腿和足随之移动。');
 joint('hip-abduction','髋关节外展','femur',true,e=>/^(femur|patella|tibia|fibula) /.test(e.motionName)||isFoot(e),30,'y','side','下肢向身体外侧展开，观察髋部作为近端支点。');
 joint('knee-flexion','膝关节屈伸','femur',false,e=>/^(tibia|fibula) /.test(e.motionName)||isFoot(e),90,'x',1,'观察小腿向后屈曲，再逐渐伸直。');
 joint('ankle-dorsiflexion','踝关节背屈','tibia',false,isFoot,22,'x',-1,'足尖向小腿前侧抬起，认识踝关节背屈方向。');
 const atlas=exact('atlas c1'),mandible=exact('mandible');
 if(atlas&&bones.length){const pivot=atlas.motionCenter.clone(),head=unique([bones.filter(e=>(e===mandible||e.motionCenter.z>atlas.motionBox.max.z)&&!/atlas|axis/.test(e.motionName)),category('听小骨')]);const teeth=category('牙');
  for(const [id,label,axis,angle,description] of [['head-nod','头部点头',V(1,0,0),.2,'头部围绕上颈部轻度前屈与回位，认识点头方向。'],['head-turn','头部左右转动',V(0,0,1),.5,'头部围绕上颈部左右转动，认识旋转方向。']]){
   add({id,label,group:'关节运动',targets:unique([head,teeth,atlas]),source:source.joint,description:description+'',apply(p){const q=id==='head-turn'?Math.sin(TAU*p):wave(p);unique([head,teeth]).forEach(e=>pose(e,pivot,axis,angle*q*state.amplitude));explain(label,'观察头部朝向的变化。');}});
  }
 }
 if(mandible&&bones.length){const pivot=mandible.motionCenter.clone();pivot.y=mandible.motionBox.max.y; pivot.z=mandible.motionBox.max.z;const chain=unique([[mandible],both(/^lower (?:.* )?(?:tooth|canine|premolar|incisor)\b/)]);
  add({id:'jaw-opening',label:'下颌张口与闭口',group:'关节运动',targets:chain,source:source.joint,description:'观察下颌骨与下牙列在张口、闭口时的转动。',apply(p){chain.forEach(e=>pose(e,pivot,V(1,0,0),.26*wave(p)*state.amplitude));explain(p<.5?'逐渐张口':'逐渐闭口');}});
 }
 // Muscle shapes illustrate shortening and thickening, without inventing a force model.
 function musclePair(id,label,a,b,description){if(!a.length||!b.length)return;
  add({id,label,group:'肌肉活动',targets:unique([a,b]),source:source.muscle,description:description+' 观察肌腹交替缩短与舒张。',apply(p){const q=(p<.5?wave(p*2):0)*state.amplitude;
   for(const [arr,value] of [[a,q],[b,(p>.5?wave((p-.5)*2):0)*state.amplitude]])for(const e of arr){const z=1-.075*value,w=1/Math.sqrt(z);scaleParts([e],e.motionCenter,[w,w,z]);if(value>.1)light([e],value*.5);}
   explain(p<.5?'观察前一组肌肉':'观察拮抗肌群','肌腹缩短时，横径略增。',p<.5?a:b);
  }});
 }
 musclePair('elbow-muscles','肱二头肌与肱三头肌',both(/biceps brachii/),both(/triceps brachii/),'肱二头肌参与屈肘，肱三头肌参与伸肘。');
 musclePair('thigh-muscles','股前与股后肌群',both(/rectus femoris|vastus (lateralis|medialis|intermedius)/),both(/biceps femoris|semitendinosus|semimembranosus/),'股四头肌主要参与伸膝，股后肌群参与屈膝等动作。');
 musclePair('ankle-muscles','小腿前后肌群',both(/^tibialis anterior/),both(/gastrocnemius|^soleus /),'胫骨前肌参与背屈，腓肠肌与比目鱼肌参与跖屈。');
 const diaphragm=both(/^(diaphragm|diaphragmatic fascia)$/);
 if(diaphragm.length){const b=boxOf(diaphragm),pivot=b.getCenter(V());pivot.z=b.min.z;
  add({id:'diaphragm',label:'膈肌吸气运动',group:'肌肉活动',targets:diaphragm,source:source.breath,duration:5,description:'膈肌收缩时穹隆下降，增加胸腔容积；舒张时逐渐回升。',apply(p){scaleParts(diaphragm,pivot,[1,1,1-.28*wave(p)*state.amplitude]);explain(Math.abs(p-.5)<.03?'吸气末 · 膈穹隆处于低位':p<.5?'吸气 · 膈穹隆下降':'呼气 · 膈穹隆回升','观察穹隆高度的节律变化。',diaphragm);}});
 }
 // Eyes share one pivot per side; lens/iris deformations remain local to their own tissue.
 const lenses=both(/^lens (left|right)$/),irises=both(/^iris (left|right)$/);
 const eyeParts=entries.filter(e=>/^(cornea|iris|lens|retina|sclera|vitreous|anterior chamber|posterior chamber|anterior segment|posterior segment|zonular fibres)/.test(e.motionName));
 if(lenses.length&&eyeParts.length){const rigs=['left','right'].map(side=>{const parts=eyeParts.filter(e=>e.motionName.endsWith(side)),ref=exact('sclera '+side)||exact('lens '+side);return {parts,pivot:ref?.motionCenter};}).filter(x=>x.parts.length&&x.pivot);
  for(const [id,label,axis,angle] of [['eye-horizontal','双眼左右注视',V(0,0,1),.22],['eye-vertical','双眼上下转动',V(1,0,0),.18]])add({id,label,group:'感觉器官',targets:eyeParts,source:source.eye,description:'双眼协同转动，改变注视方向。',apply(p){for(const rig of rigs)rig.parts.forEach(e=>pose(e,rig.pivot,axis,Math.sin(TAU*p)*angle*state.amplitude));explain(label,'可暂停比较双眼朝向。',eyeParts);}});
  add({id:'lens-accommodation',label:'晶状体调节',group:'感觉器官',targets:lenses,source:source.eye,description:'看近物时晶状体变凸，屈光能力增加；看远物时相对变平。',apply(p){const q=wave(p)*state.amplitude;for(const e of lenses)scaleParts([e],e.motionCenter,[1-.025*q,1+.18*q,1-.025*q]);explain(p<.5?'近距离调节 · 晶状体变凸':'回到远距离状态','可先开启外层半透明，再放大查看晶状体。',lenses);}});
 }
 if(irises.length)add({id:'pupil-reflex',label:'瞳孔缩小与恢复',group:'感觉器官',targets:irises,source:source.eye,description:'虹膜内缘向瞳孔中心靠近，使瞳孔变小。主要改变内缘，示意瞳孔口径变化。',apply(p){const q=wave(p)*state.amplitude;
  for(const e of irises){const c=e.motionCenter,rx=e.motionSize.x/2,rz=e.motionSize.z/2;deform(e,v=>{const x=(v.x-c.x)/rx,z=(v.z-c.z)/rz,r=Math.hypot(x,z),f=1-.32*q*Math.max(0,1-Math.min(1,r));v.x=c.x+(v.x-c.x)*f;v.z=c.z+(v.z-c.z)*f;});}
  explain(p<.5?'虹膜内缘靠近 · 瞳孔缩小':'瞳孔逐渐恢复','通过虹膜开口观察口径变化。',irises);
 }});
 const ossicles=both(/^(malleus|incus|stapes) (left|right)$/),eardrums=both(/^(tympanic membrane|eardrum) /);
 if(ossicles.length&&eardrums.length)add({id:'hearing-vibration',label:'鼓膜与听小骨振动',group:'感觉器官',targets:unique([eardrums,ossicles]),source:source.eye,duration:2,description:'声振动经鼓膜和听小骨传向内耳，慢动作便于观察各部分的配合。',apply(p){const q=Math.sin(TAU*p)*state.amplitude;for(const e of unique([ossicles,eardrums]))pose(e,e.motionCenter,V(0,0,1),q*.015,[1,1,1],V((e.motionName.endsWith('left')?1:-1)*e.motionSize.length()*.015*q,0,0));explain('缓慢展示一个振动周期','观察鼓膜与听小骨的协同振动。',unique([eardrums,ossicles]));}});
 sequence('tear-route','泪液引流路径',[
  s('泪腺',both(/^lacrimal gland/)),s('泪小管',both(/lacrimal canalicul/)),s('泪囊',both(/^lacrimal sac/)),s('鼻泪管',both(/nasolacrimal duct/))],
  '泪腺分泌泪液润滑眼表，再经内眦附近的引流结构进入鼻泪管。',source.eye,'感觉器官');

 sequence('upper-limb-nerve','上肢神经分布顺序',[
  s('脊髓',both(/^(anterior horn|posterior horn|white matter) of spinal cord$/)),s('臂丛根与干',both(/roots of brachial plexus|^(superior|middle|inferior) trunk of brachial plexus/)),s('主要外周神经',both(/^(median|ulnar|radial) nerve (left|right)$/))],
  '从脊髓、臂丛到上肢主要神经，观察神经的分布关系。',chapter('13-4-the-peripheral-nervous-system'));
 sequence('spinal-horns','脊髓前后角功能对照',[
  s('后角',both(/^posterior horn of spinal cord$/),'后角参与处理传入的感觉信息。'),s('前角',both(/^anterior horn of spinal cord$/),'前角含有支配骨骼肌的躯体运动神经元。')],
  '对照脊髓后角与前角，认识感觉处理和躯体运动相关区域。',chapter('13-2-the-central-nervous-system'));
 sequence('lymph-regions','淋巴结区域巡览',[
  s('腹股沟区',both(/inguinal.*nodes|inguinal lymph/)),s('腹部与腰部',both(/lumbar.*nodes|aortic.*nodes/)),s('腋窝区',both(/axillary.*nodes/)),s('颈部',both(/cervical.*nodes/))],
  '分别观察颈部、腋窝、腹部及腹股沟的淋巴结分布。',source.lymph);
 sequence('immune-organs','免疫相关器官对照',[
  s('胸腺',both(/thymus/)),s('脾',both(/^spleen$/)),s('扁桃体',both(/tonsil/))],
  '轮流观察胸腺、脾和扁桃体的解剖位置，比较免疫相关器官在不同部位的分布。',source.lymph);
 sequence('thyroid-axis','垂体与甲状腺反馈',[
  s('腺垂体',both(/^adenohypophysis$/),'腺垂体分泌促甲状腺激素。'),s('甲状腺',both(/^thyroid gland$/),'甲状腺释放甲状腺激素。'),s('反馈至垂体',both(/^adenohypophysis$/),'甲状腺激素参与负反馈调节。')],
  '观察垂体与甲状腺之间的调节和反馈关系。',source.thyroid);
 sequence('endocrine-tour','主要内分泌腺巡览',[
  s('垂体',both(/^(adeno|neuro)hypophysis$/)),s('甲状腺与甲状旁腺',both(/thyroid gland|parathyroid gland/)),s('肾上腺',both(/^suprarenal gland/)),s('胰',both(/^pancreas$/)),s('睾丸',both(/^testis /))],
  '逐区观察主要内分泌腺，认识它们在身体中的位置。',chapter('17-1-an-overview-of-the-endocrine-system'));
 const deferens=both(/^ductus deferens /);
 if(deferens.length)sequence('sperm-route','精子运输相关结构',[
  s('睾丸',both(/^testis /)),s('附睾',both(/^epididymis /)),s('输精管',deferens),s('射精管',both(/^ejaculatory duct /))],
  '沿睾丸、附睾、输精管和射精管，观察运输相关结构。',source.male);
 sequence('male-glands','男性附属腺位置',[
  s('精囊',both(/^seminal gland /)),s('前列腺',both(/^prostate$/))],
  '对照精囊与前列腺，观察它们与运输通路的位置关系。',source.male);

 living=createLivingMotions({THREE,entries,add,modeMap,match,exact,unique,boxOf,middle,pose,deform,scaleParts,light,explain,source,basis,cacheVertices,endpoint,sideBones,isHand,isFoot,getState:()=>state});

 function setTab(name){
  $('motion-panel').hidden=name!=='motion';$('motion-panel').parentElement.dataset.tab=name;
  $('motion-tab').setAttribute('aria-selected',String(name==='motion'));$('structures-tab').setAttribute('aria-selected',String(name!=='motion'));
 }
 $('motion-tab').onclick=()=>setTab('motion');$('structures-tab').onclick=()=>setTab('structures');
 $('motion-launch').onclick=()=>{setTab('motion');if(innerWidth<=720)$('motion-panel').scrollIntoView({behavior:'auto',block:'start'});};
 const groups=new Map();for(const m of modes){let group=groups.get(m.group);if(!group){group=document.createElement('optgroup');group.label=m.group;groups.set(m.group,group);$('motion-mode').append(group);}const option=document.createElement('option');option.value=m.id;option.textContent=m.label;group.append(option);}
 $('motion-count').textContent=modes.length;$('motion-launch').textContent='▶ 动态演示';
 for(const id of ['motion-vivid','motion-mode','motion-play','motion-step','motion-reset'])$(id).disabled=!modes.length;
 function saveBase(){base={camera:camera.position.toArray(),target:controls.target.toArray(),section:Number($('section').value),explode:Number($('explode').value)};}
 function snapshot(){return {...state,base:{...base,camera:[...base.camera],target:[...base.target]}};}
 function focus(){
  const m=modeMap.get(state.id);if(!m||m.general)return;
  const candidates=m.focusTargets||m.targets,targets=m.side?candidates.filter(e=>sideOK(e)):candidates;if(!targets.length)return;
  const b=boxOf(targets);b.applyMatrix4(basis);const sphere=b.getBoundingSphere(new THREE.Sphere());
  const aspect=$('stage').clientWidth/Math.max(1,$('stage').clientHeight),angle=Math.min(camera.fov*Math.PI/360,Math.atan(Math.tan(camera.fov*Math.PI/360)*aspect));
  const direction=V(.13,-1,.22).transformDirection(basis),distance=Math.max(.22,sphere.radius/Math.sin(angle)*1.38);
  const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.target.copy(sphere.center);camera.position.copy(sphere.center).add(direction.multiplyScalar(distance));controls.update();controls.enableDamping=damping;
 }
 function sync(full=true){
  const m=modeMap.get(state.id);$('motion-mode').value=state.id;setText($('motion-play'),state.playing?'❚❚ 暂停':'▶ 播放');$('motion-play').setAttribute('aria-pressed',String(state.playing));
  $('motion-phase').value=Math.round(state.phase*1000)/10;$('motion-progress').textContent=Math.round(state.phase*100)+'%';
  setText($('motion-phase-label'),phaseLabel);setText($('motion-phase-detail'),phaseDetail);
  $('motion-speed').value=state.speed;$('motion-speed-value').textContent=state.speed.toFixed(2).replace(/0$/,'')+'×';
  $('motion-amplitude').value=state.amplitude*100;$('motion-amplitude-value').textContent=Math.round(state.amplitude*100)+'%';
  $('motion-side').value=state.side;$('motion-focus').checked=state.focus;$('motion-context').checked=state.contextFade;
  $('motion-flow').checked=state.flow;$('motion-rhythm').value=state.rhythm;
  $('motion-side-label').hidden=!m?.side;$('motion-focus-now').disabled=!m||m.general;
  if(full){
   $('motion-kind').textContent=m?.kind||'自主探索';$('motion-description').textContent=m?.description||(modes.length?'选择一种动态，点击播放。':'当前模型暂无可用的器官动态演示，可在结构知识中继续查看部件。');
   $('motion-reference').hidden=!m?.source;if(m?.source)$('motion-reference').href=m.source;
  }
  const status=activeNames.slice(0,4).map(e=>partLabel(e.part)+(e.group.visible?'':'（已隐藏）')).join('、');
  setText($('motion-targets'),status+(activeNames.length>4?' · '+activeNames.length+' 个结构':''));
 }
 function refresh(full=false){resetFrame();const m=modeMap.get(state.id);if(m){activeNames=[];m.apply(state.phase);}else{phaseLabel='准备开始';phaseDetail='';activeNames=[];}applyContext();sync(full);}
 function choose(id){resetEffects();state.id=id;state.phase=0;state.playing=false;lastTime=null;saveBase();if(state.focus)focus();saveBase();refresh(true);}
 function stopAndReset(){resetEffects();state.playing=false;state.phase=0;lastTime=null;refresh(true);}
 function clear(){resetEffects();state.id='';state.playing=false;state.phase=0;lastTime=null;refresh(true);}
 function restore(s){resetEffects();if(!s)return;state={...s};delete state.base;base={...s.base,camera:[...s.base.camera],target:[...s.base.target]};lastTime=null;refresh(true);}
 $('motion-mode').onchange=()=>run(()=>choose($('motion-mode').value));
 $('motion-vivid').onclick=()=>{if(!modes.length)return;run(()=>{choose(living?.preferred||modes[0].id);state.playing=true;lastTime=null;sync();});};
 $('motion-flow').onchange=()=>run(()=>{state.flow=$('motion-flow').checked;refresh();});
 $('motion-rhythm').onchange=()=>run(()=>{state.rhythm=$('motion-rhythm').value;lastTime=null;sync();});
 $('motion-play').onclick=()=>{if(!modes.length)return;run(()=>{if(!state.id)choose(modes[0].id);state.playing=!state.playing;lastTime=null;sync();});};
 $('motion-reset').onclick=()=>run(stopAndReset);
 $('motion-step').onclick=()=>{if(!modes.length)return;run(()=>{if(!state.id)choose(modes[0].id);state.playing=false;state.phase=(state.phase+.025)%1;refresh();});};
 $('motion-side').onchange=()=>run(()=>{state.side=$('motion-side').value;refresh();if(state.focus)focus();});
 $('motion-focus').onchange=()=>run(()=>{state.focus=$('motion-focus').checked;});
 $('motion-context').onchange=()=>run(()=>{state.contextFade=$('motion-context').checked;applyContext();});
 $('motion-focus-now').onclick=()=>run(focus);
 for(const [id,key,convert] of [['motion-phase','phase',v=>Number(v)/100],['motion-speed','speed',Number],['motion-amplitude','amplitude',v=>Number(v)/100]]){
  const el=$(id);el.addEventListener('pointerdown',()=>beginChange('motion'));
  el.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))beginChange('motion');});
  el.oninput=()=>{beginChange('motion');state[key]=convert(el.value);if(key==='phase')state.playing=false;refresh();};
  el.onchange=finishChange;el.addEventListener('keyup',finishChange);el.addEventListener('blur',finishChange);
 }
 function tick(time){
  if(!state.playing||document.hidden){lastTime=null;return;}
  if(lastTime===null){lastTime=time;return;}if(time-lastTime<16)return;
  const dt=Math.min((time-lastTime)/1000,.12);lastTime=time;const m=modeMap.get(state.id);if(!m)return;
  const rhythm={natural:1,calm:.78,active:1.3,slow:.4}[state.rhythm]||1;
  state.phase=(state.phase+dt*state.speed*rhythm/m.duration)%1;frame++;
  resetFrame();activeNames=[];m.apply(state.phase);if(time-lastUI>95){sync(false);lastUI=time;}
 }
 setTab('structures');sync();
 return {snapshot,restore,stopAndReset,clear,tick,refresh,captureMaterialBase,modes:modes.map(m=>({id:m.id,label:m.label,kind:m.kind,targets:m.targets.map(e=>e.part.id)}))};
}

/* Continuous atlas animations. Parameters describe teaching motion, not patient measurements.
 * Every deformation starts from the source vertices. Fluid/signal particles are symbolic.
 */
function createLivingMotions(api){
 const {THREE,entries,add,modeMap,match,exact,unique,boxOf,middle,pose,deform,scaleParts,light,explain,source,basis,cacheVertices,endpoint,sideBones,isHand,isFoot}=api;
 const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),TAU=2*Math.PI;
 const clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
 const wave=p=>(1-Math.cos(TAU*p))/2,st=()=>api.getState(),amp=()=>st().amplitude;
 const bump=(p,start,peak,end)=>p<peak?smooth((p-start)/(peak-start)):1-smooth((p-peak)/(end-peak));
 const gate=p=>smooth(p/.065)*smooth((1-p)/.065);
 const breath=p=>p<.4?smooth(p/.4):1-smooth((p-.4)/.6);
 const fields=new Map(),flows=new Map(),motionModes=[],blood=createBloodFlow(api,field);
 function register(m){if(!m.targets?.length)return;m.kind=m.kind||'连续形变与联动';add(m);motionModes.push(m);}
 function enhance(id,values){const old=modeMap.get(id);if(old)Object.assign(old,values);return old;}
 function chooseSide(e){return st().side==='both'||e.motionName.endsWith(st().side);}
 // Smooth center estimates along the largest dimension; individual tubes remain separate.
 function field(e){
  if(fields.has(e))return fields.get(e);
  const size=e.motionSize,axis=['x','y','z'].reduce((a,b)=>size[a]>size[b]?a:b),lo=e.motionBox.min[axis],span=Math.max(size[axis],1e-6);
  const centers=Array.from({length:40},()=>({sum:V(),n:0}));
  for(const mesh of e.meshes){const a=cacheVertices(mesh).anatomical,stride=Math.max(1,Math.ceil(a.length/3/16000));
   for(let i=0;i<a.length;i+=stride*3){const p=V().fromArray(a,i),bin=Math.min(39,Math.floor(clamp((p[axis]-lo)/span)*40));centers[bin].sum.add(p);centers[bin].n++;}}
  for(const c of centers)if(c.n)c.sum.multiplyScalar(1/c.n);
  for(let i=0;i<40;i++)if(!centers[i].n){let best=0,d=Infinity;for(let j=0;j<40;j++)if(centers[j].n&&Math.abs(i-j)<d){best=j;d=Math.abs(i-j);}centers[i].sum.copy(centers[best].sum);}
  const points=centers.map((c,i)=>{const p=c.sum.clone();if(i>0&&i<39)p.add(centers[i-1].sum).add(centers[i+1].sum).multiplyScalar(1/3);p[axis]=lo+span*(i+.5)/40;return p;});
  const value={axis,lo,span,points};fields.set(e,value);return value;
 }
 function curveAt(f,t,out){const n=clamp(t)*39,k=Math.min(38,Math.floor(n));return out.copy(f.points[k]).lerp(f.points[k+1],n-k);}
 function tube(e,p,{strength=.22,cycles=1,direction=-1,segmented=false}={}){
  const f=field(e),c=V(),a=amp()*gate(p)*gate(st().phase);
  deform(e,v=>{const u=clamp((v[f.axis]-f.lo)/f.span);curveAt(f,u,c);
   const q=segmented?(.5+.5*Math.cos(TAU*(u*5+p))):Math.exp(-(((u-(direction<0?1.2-1.4*p:-.2+1.4*p))/.14)**2));
   const contraction=strength*a*q*(segmented?wave(p):1);
   for(const key of ['x','y','z'])if(key!==f.axis)v[key]=c[key]+(v[key]-c[key])*(1-contraction);
  });
 }
 function soft(e,q,{shorten=.08,bulge=.035,twist=0,axis='z',anchor=0}={}){
  const c=e.motionCenter,b=e.motionBox,size=Math.max(e.motionSize[axis],1e-6),others=['x','y','z'].filter(k=>k!==axis);
  deform(e,v=>{const u=clamp((v[axis]-b.min[axis])/size),belly=Math.sin(Math.PI*u),weight=anchor?smooth(u)*belly:belly;
   const t=twist*q*(u-.5),cs=Math.cos(t),sn=Math.sin(t),x=v[others[0]]-c[others[0]],y=v[others[1]]-c[others[1]];
   v[others[0]]=c[others[0]]+(x*cs-y*sn)*(1+bulge*q*weight);
   v[others[1]]=c[others[1]]+(x*sn+y*cs)*(1+bulge*q*weight);
   v[axis]-=(v[axis]-(anchor?b.min[axis]:c[axis]))*shorten*q*weight;
  });
 }
 function particle(e,p,{color=0xffcf62,direction=-1,cloud=false,count=18,opacity=.78}={}){
  if(!cloud&&blood.draw(e,p,{color,direction,opacity}))return;
  if(!st().flow||!amp()||p===0)return;
  let fx=flows.get(e);
  if(!fx){
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(count*3),3));
   const material=new THREE.PointsMaterial({color,size:Math.max(.0012,Math.min(.004,e.motionSize.length()*.018)),transparent:true,opacity:.78,depthWrite:false,depthTest:false,sizeAttenuation:true});
   // Round soft dots instead of square point sprites; no external textures.
   material.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat r = length(gl_PointCoord - vec2(0.5)); if (r > 0.5) discard; diffuseColor.a *= 1.0 - smoothstep(0.12,0.5,r);');};
   const object=new THREE.Points(geometry,material);object.userData.bio2meshFlow=true;object.renderOrder=5;object.frustumCulled=false;e.motion.add(object);
   fx={object,count};flows.set(e,fx);
  }
  const object=fx.object;object.visible=true;object.material.color.set(color);object.material.opacity=clamp(opacity)*amp()*gate(p);
  object.material.clippingPlanes=e.meshes[0]?.material.clippingPlanes||[];
  const a=object.geometry.attributes.position.array,f=field(e),v=V();
  for(let i=0;i<fx.count;i++){
   const t=(i/fx.count+p*1.7)%1;
   if(cloud){const theta=i*2.39996,rad=.16+.65*t;v.set(e.motionCenter.x+Math.cos(theta)*e.motionSize.x*.48*rad,e.motionCenter.y+Math.sin(theta)*e.motionSize.y*.48*rad,e.motionCenter.z+Math.sin(theta*1.31+TAU*p)*e.motionSize.z*.35*rad);}
   else curveAt(f,direction<0?1-t:t,v);
   v.applyMatrix4(basis).toArray(a,i*3);
  }
  object.geometry.attributes.position.needsUpdate=true;
 }
 const atria=match(/^(left|right) atrium$/),ventricles=match(/^(left|right) ventricle$/),valves=match(/leaflet/),papillary=match(/papillary muscle/);
 const arteries=match(/^(ascending aorta|arch of aorta|thoracic aorta|abdominal aorta|pulmonary trunk|left pulmonary artery|right pulmonary artery)$/);
 const veins=match(/^(superior|inferior) vena cava$|^(left|right) (superior|inferior) pulmonary vein$/);
 function valveMotion(p){
  const systole=bump(p,.18,.3,.66)*amp();
  for(const e of valves){const semilunar=/semilunar|coronary leaflet/.test(e.motionName),q=(semilunar?1:-1)*systole,c=e.motionCenter;
   // Bend the free interior more than its surrounding attachment ring.
   deform(e,v=>{const dx=(v.x-c.x)/Math.max(e.motionSize.x,.0001),dz=(v.z-c.z)/Math.max(e.motionSize.z,.0001),w=Math.max(0,1-2*Math.hypot(dx,dz));v.y+=q*Math.max(e.motionSize.length()*.12,.0006)*w;v.z+=q*e.motionSize.z*.16*w;});
  }
 }
 const oldHeartbeat=modeMap.get('heartbeat')?.apply;
 function heart(p,flow=false){
  const a=bump(p,.03,.14,.23)*amp(),q=bump(p,.22,.39,.64)*amp();
  for(const e of atria)scaleParts([e],e.motionCenter,[1-.025*a,1-.025*a,1-.04*a]);
  if(ventricles.length)scaleParts(unique([ventricles,papillary]),middle(ventricles),[1-.035*q,1-.035*q,1-.055*q]);
  for(const e of atria)soft(e,a,{shorten:.04,bulge:-.055});
  for(const e of [...ventricles,...papillary])soft(e,q,{shorten:.035,bulge:-.035,twist:e.motionName.startsWith('left')?.20:.08});
  valveMotion(p);
  if(flow)for(const e of arteries){tube(e,p,{strength:-.08});particle(e,p,{color:0xfa7f72,direction:e.motionName==='ascending aorta'?1:-1});}
  explain(p<.22?'心房收缩 · 心室继续充盈':p<.64?'心室扭转收缩 · 瓣膜协同射血':'心肌舒张 · 弹性回位','心肌与瓣膜协调活动，血液沿通路流动。',[...atria,...ventricles]);
 }
 if(oldHeartbeat){
  enhance('heartbeat',{apply:p=>heart(p),duration:.9,description:'心房先收缩，心室随后缩短并轻度扭转；瓣膜随充盈与射血阶段开合，舒张时回位。'});
  enhance('valve-cycle',{apply:p=>{valveMotion(p);explain(p<.2||p>.66?'房室瓣充盈阶段':'心室射血阶段','通过瓣叶自由缘的弯曲观察两个阶段。',valves);},kind:'瓣叶形变示意',description:'已有瓣叶随心动周期弯曲，模拟开放与关闭的相对变化；附着环保持稳定。'});
  register({id:'cardiac-living',label:'心脏、瓣膜与血流联动',group:'器官联动',targets:unique([atria,ventricles,valves,papillary,arteries]),focusTargets:unique([atria,ventricles,valves]),duration:.9,priority:100,source:source.heart,description:'观察心肌收缩、瓣膜开合与血流方向的联动。',apply:p=>heart(p,true)});
  register({id:'ventricular-twist',label:'心室扭转与舒张回弹',group:'生理过程',targets:ventricles,duration:1.4,source:'https://pubmed.ncbi.nlm.nih.gov/11545133/',description:'沿心室长轴观察扭转收缩，再观察舒张时的回弹。',apply(p){for(const e of ventricles)soft(e,bump(p,.12,.42,.8)*amp(),{shorten:.07,bulge:-.09,twist:.3});explain(p<.45?'扭转与缩短':'舒张与回弹','心室各高度的旋转角不同。',ventricles);}});
 }
 if(arteries.length)register({id:'arterial-pulse',label:'动脉脉搏波传播',targets:arteries,duration:1.2,source:source.blood,description:'观察脉搏引起的管壁扩张，沿动脉逐段传播。',apply(p){for(const e of arteries){tube(e,p,{strength:-.11});particle(e,p,{color:0xff8676,direction:e.motionName==='ascending aorta'?1:-1});}explain('管壁局部扩张随脉搏传播','观察相邻位置先后膨起。',arteries);}});
 if(veins.length)register({id:'venous-return',label:'静脉回流与呼吸性变化',targets:veins,duration:5,source:source.blood,description:'观察静脉血回流的方向，以及管壁随呼吸产生的轻度起伏。',apply(p){for(const e of veins){soft(e,breath(p)*amp(),{shorten:0,bulge:.025});particle(e,p,{color:0x77b8f7,direction:/superior vena/.test(e.motionName)?-1:1});}explain('回流持续 · 管壁轻度起伏','可关闭粒子，只观察管壁。',veins);}});

 const lobes=match(/lobe of (left|right) lung/),bronchi=match(/lobar bronchus|segmental bronchus|^(left|right) main bronchus$/);
 const lungRigs=['left','right'].map(side=>{const parts=lobes.filter(e=>e.motionName.includes(side));return {side,parts,box:parts.length?boxOf(parts):null};}).filter(r=>r.parts.length);
 function lungs(p,depth=1){
  const q=breath(p)*amp()*depth;
  for(const rig of lungRigs){const c=rig.box.getCenter(V()),span=Math.max(rig.box.max.z-rig.box.min.z,.0001),targets=unique([rig.parts,bronchi.filter(e=>e.motionName.includes(rig.side))]);
   for(const e of targets){
    pose(e,V(c.x,c.y,rig.box.max.z),V(1,0,0),0,[1+.012*q,1+.016*q,1+.009*q]);
    deform(e,v=>{const basal=clamp((rig.box.max.z-v.z)/span),w=.15+.85*smooth(basal);v.x+=(v.x-c.x)*.035*q*w;v.y+=(v.y-c.y)*.055*q*w;v.z-=span*.042*q*w;});
   }
  }
  explain(p<.4?'吸气 · 肺底和胸廓方向扩张':'呼气 · 肺组织缓慢回缩','肺叶和同侧支气管使用相同位移场，保持空间联系。',lobes);
 }
 if(lobes.length){
  enhance('breathing',{targets:unique([lobes,bronchi]),apply:p=>lungs(p),description:'肺底的扩张比肺尖明显；肺叶和同侧支气管随同一个连续位移场移动。吸气较快，呼气缓慢回位。'});
  register({id:'breathing-coupled',label:'肺叶、支气管与气流联动',group:'器官联动',targets:unique([lobes,bronchi]),duration:5,priority:95,source:source.breath,description:'观察吸气与呼气时，肺叶、支气管和气流的协同变化。',apply(p){lungs(p);for(const e of bronchi.filter(e=>/main bronchus/.test(e.motionName)))particle(e,p,{color:0x86dfef,direction:p<.4?-1:1});}});
  register({id:'deep-breath',label:'深吸气与缓慢呼气',targets:unique([lobes,bronchi]),duration:8,source:source.breath,description:'延长呼吸周期并增大肺底形变，便于比较吸气末与呼气末的外形。',apply:p=>lungs(p,1.65)});
  register({id:'sigh',label:'叹息样呼吸节律',targets:unique([lobes,bronchi]),duration:9,source:source.breath,description:'用一次较深吸气和较长呼气展示不同呼吸节律下的外形变化。',apply(p){const t=p<.3?p/.3*.4:.4+(p-.3)/.7*.6;lungs(t,1.4);}});
 }

 const stomach=match(/^(stomach|mucosa of stomach)$/),small=match(/^(duodenum|jejunum|ileum)$/),colon=match(/^(ascending|transverse|descending|sigmoid) colon$/),gall=match(/^gallbladder$/),esophagus=match(/^(oesophagus|esophagus)$/);
 const tongue=match(/^tongue$/),palate=match(/^soft palate$|^uvula of palate$/),pharynx=match(/^(oropharynx|laryngopharynx)$/),epiglottis=exact('epiglottis');
 function stomachWave(p){for(const e of stomach){tube(e,p,{strength:.18,direction:1});softPose(e,p);}}
 function softPose(e,p){pose(e,e.motionCenter,V(0,0,1),.025*Math.sin(TAU*p)*amp());}
 if(stomach.length)register({id:'stomach-wave',label:'胃壁推进波与搅拌',targets:stomach,duration:6,source:source.digest,description:'局部收缩沿胃壁移动，同时叠加轻微扭动，展示混合与推进的形态概念。',apply(p){stomachWave(p);explain('局部收缩波沿胃壁推进','观察收缩位置随时间移动。',stomach);}});
 for(const [id,label,segmented] of [['intestine-segmentation','小肠分节运动',true],['intestine-peristalsis','小肠局部蠕动',false]])if(small.length)register({id,label,targets:small,duration:7,source:source.digest,description:'肠壁不同位置交替收缩，帮助混合并推进肠内容物。',apply(p){small.forEach(e=>tube(e,p,{strength:.2,segmented}));explain(segmented?'相邻肠段交替收缩':'局部收缩逐渐推进','形变用于观察肠壁运动。',small);}});
 if(colon.length)register({id:'colon-haustral',label:'结肠袋交替收缩',targets:colon,duration:8,source:source.digest,description:'在已有结肠外形上叠加分段收缩和舒张，帮助观察缓慢的混合运动。',apply(p){colon.forEach((e,i)=>tube(e,(p+i*.06)%1,{strength:.13,segmented:true}));explain('结肠不同位置交替收缩','拖动进度观察袋状外形变化。',colon);}});
 if(gall.length)register({id:'gallbladder-emptying',label:'胆囊缓慢收缩与恢复',targets:gall,duration:9,source:source.digest,description:'胆囊壁缓慢收缩，示意储存胆汁排出时的外形变化；周期经过压缩以便观察。',apply(p){gall.forEach(e=>soft(e,wave(p)*amp(),{shorten:.2,bulge:-.18,anchor:1}));explain(p<.5?'胆囊壁缓慢收缩':'回到起始外形','观察胆囊壁的收缩与回位。',gall);}});
 if(esophagus.length||tongue.length||epiglottis)register({id:'swallow-coupled',label:'舌、咽、会厌与食管联动',group:'器官联动',targets:unique([tongue,palate,pharynx,epiglottis?[epiglottis]:[],esophagus]),duration:4.5,source:source.swallow,description:'依次观察舌体活动、软腭抬升、咽部收缩、会厌倾转和食管蠕动。',apply(p){
  for(const e of tongue)soft(e,bump(p,.02,.18,.4)*amp(),{shorten:.08,bulge:.05,twist:.08});
  for(const e of palate)pose(e,e.motionCenter,V(1,0,0),-.22*bump(p,.08,.3,.62)*amp());
  for(const e of pharynx)soft(e,bump(p,.2,.43,.65)*amp(),{shorten:.05,bulge:-.1});
  if(epiglottis){const pivot=epiglottis.motionCenter.clone();pivot.z=epiglottis.motionBox.min.z;pose(epiglottis,pivot,V(1,0,0),-.55*bump(p,.12,.36,.63)*amp());}
  for(const e of esophagus)tube(e,clamp((p-.32)/.68),{strength:.25});
  explain(p<.3?'口腔准备与软腭抬升':p<.6?'咽部推进与喉入口保护':'食管收缩波下传','各部件按先后关系联动。');
 }});
 if(stomach.length&&small.length)register({id:'digestion-coupled',label:'胃肠节律联动',group:'器官联动',targets:unique([stomach,small,colon]),duration:10,priority:90,source:source.digest,description:'胃壁推进波与肠道分节运动同时播放，各段节律略有错开，展示持续的消化道活动。',apply(p){stomachWave(p);small.forEach(e=>tube(e,p,{segmented:true,strength:.17}));colon.forEach(e=>tube(e,p,{segmented:true,strength:.1}));explain('胃壁推进 · 肠道交替收缩','可分别选择单个器官的演示进行观察。');}});

 const ureters=match(/^ureter (left|right)$/),bladder=match(/^urinary bladder$/),urethra=match(/^urethra$/);
 function bladderShape(p){bladder.forEach(e=>soft(e,wave(p)*amp(),{shorten:-.20,bulge:.22,anchor:1}));}
 if(ureters.length){
  register({id:'ureter-alternate',label:'左右输尿管交错蠕动',targets:ureters,duration:7,source:source.urine,description:'左右输尿管的收缩波以不同相位向膀胱方向推进，避免两侧机械地完全同步。',apply(p){ureters.forEach((e,i)=>tube(e,(p+i*.35)%1,{strength:.3}));explain('左右收缩波交错向下推进','每一侧都从独立的原始形态计算形变。',ureters);}});
  register({id:'urine-coupled',label:'输尿管推进与膀胱充盈',group:'器官联动',targets:unique([ureters,bladder]),duration:9,priority:90,source:source.urine,description:'输尿管局部收缩与膀胱缓慢充盈同时显示；粒子表示尿液向膀胱的输送方向，周期经过压缩。',apply(p){ureters.forEach((e,i)=>{tube(e,(p+i*.32)%1,{strength:.28});particle(e,p,{color:0xffdb79});});bladderShape(p);explain(p<.5?'输尿管推进 · 膀胱逐渐充盈':'输送继续 · 膀胱回到起始外形','输尿管和膀胱使用不同节律。');}});
 }
 if(bladder.length&&urethra.length)register({id:'micturition',label:'膀胱壁收缩与排尿通路',targets:unique([bladder,urethra]),duration:8,source:source.urine,description:'观察膀胱壁收缩，以及尿液沿尿道排出的方向。',apply(p){bladder.forEach(e=>soft(e,wave(p)*amp(),{shorten:.15,bulge:-.18,anchor:1}));urethra.forEach(e=>particle(e,p,{color:0xffda7c}));explain('膀胱壁缓慢收缩','沿尿道观察尿液排出的方向。',bladder);}});

 const diaphragm=match(/^(diaphragm|diaphragmatic fascia)$/),intercostal=match(/^(external|internal|innermost) intercostal muscles/),abdominal=match(/^rectus abdominis muscle|^(external|internal) abdominal oblique/);
 function diaphragmShape(p){
  const q=breath(p)*amp();
  for(const e of diaphragm){const b=e.motionBox,c=e.motionCenter;
   deform(e,v=>{const nx=(v.x-c.x)/Math.max(e.motionSize.x*.55,.0001),ny=(v.y-c.y)/Math.max(e.motionSize.y*.6,.0001),weight=Math.max(0,1-Math.min(1,nx*nx+ny*ny));v.z-=e.motionSize.z*.28*q*weight;});
   // A small common descent accompanies dome flattening.
   pose(e,c,V(1,0,0),0,[1,1,1],V(0,0,-e.motionSize.z*.025*q));
  }
 }
 if(diaphragm.length){
  enhance('diaphragm',{apply(p){diaphragmShape(p);explain(p<.4?'吸气 · 膈肌中央下降':'呼气 · 膈穹隆回升','中央穹隆的位移大于周边附着处。',diaphragm);},description:'膈肌中央穹隆下降并变平，周缘移动较小；呼气时平滑回升。'});
  register({id:'respiratory-muscles',label:'膈肌、肋间肌与腹壁联动',group:'器官联动',targets:unique([diaphragm,intercostal,abdominal]),duration:5,priority:92,source:source.breath,description:'膈穹隆下降时，肋间肌和腹壁随呼吸出现轻度外形变化。保留各组织的附着端，突出中央活动。',apply(p){diaphragmShape(p);intercostal.forEach(e=>soft(e,breath(p)*amp(),{shorten:.025,bulge:.045}));abdominal.forEach(e=>soft(e,breath(p)*amp(),{shorten:0,bulge:.05}));explain(p<.4?'吸气 · 膈肌下降、胸腹壁活动':'呼气 · 胸腹壁回位','不同肌群随同一呼吸周期联动。');}});
 }
 const muscles=entries.filter(e=>/肌/.test(e.motionCategory)&&/muscle|biceps|triceps|soleus|masseter|temporalis/.test(e.motionName));
 const limbMuscles=muscles.filter(e=>/biceps brachii|triceps brachii|rectus femoris|gastrocnemius/.test(e.motionName));
 if(limbMuscles.length)register({id:'muscle-belly',label:'肌腹收缩与肌腱端固定',group:'肌肉活动',targets:limbMuscles,duration:4,source:source.muscle,description:'肌腹中央缩短并增粗，靠近两端的形变逐渐减小，避免整块肌肉像刚体一样缩放。',apply(p){for(const e of limbMuscles)soft(e,wave(p)*amp(),{shorten:.12,bulge:.09,axis:field(e).axis});explain(p<.5?'肌腹收缩、中央增粗':'肌腹逐渐放松','两端的位移被平滑抑制。',limbMuscles);}});
 const eyeMuscles=match(/^palpebral part of orbicularis oculi|^levator palpebrae superioris/),chewers=match(/^(deep|superficial) part of masseter|^temporalis muscle/);
 if(eyeMuscles.length)register({id:'blink-muscles',label:'眨眼相关肌群交替活动',group:'肌肉活动',targets:eyeMuscles,duration:3.8,source:source.eye,description:'观察眼轮匝肌与上睑提肌在眨眼过程中的交替活动。',apply(p){const q=bump(p,.24,.31,.42)*amp();eyeMuscles.forEach(e=>soft(e,/orbicularis/.test(e.motionName)?q:-q*.45,{shorten:.1,bulge:.055,axis:field(e).axis}));explain('快速闭合阶段 · 较慢恢复阶段','对照闭眼与睁眼时的肌群变化。',eyeMuscles);}});
 if(chewers.length)register({id:'chewing-muscles',label:'咀嚼肌节律收缩',group:'肌肉活动',targets:chewers,duration:1.6,source:source.muscle,description:'咬肌和颞肌随咀嚼节律收缩和放松，左右侧相位略有错开。',apply(p){for(const e of chewers)soft(e,wave(p)*amp()*(e.motionName.endsWith('left')?1:.8),{shorten:.09,bulge:.075,axis:field(e).axis});explain(p<.5?'咀嚼肌收缩':'咀嚼肌舒张','肌腹中央活动比附着端明显。',chewers);}});

 // Hierarchical rigid chains: compose joint matrices about source-space pivots.
 function transform(pivot,axis,angle){const m=new THREE.Matrix4().makeRotationAxis(axis,angle);m.setPosition(pivot.clone().sub(pivot.clone().applyMatrix4(m)));return m;}
 function chainPose(arr,matrices){const local=new THREE.Matrix4();for(const m of matrices)local.multiply(m);const inverse=basis.clone().invert();for(const e of arr){pose(e,e.motionCenter);e.motion.matrix.copy(basis).multiply(local).multiply(inverse);e.motion.matrixWorldNeedsUpdate=true;}}
 const rigs=['left','right'].map(side=>({side,bones:sideBones(side),humerus:exact('humerus '+side),radius:exact('radius '+side),ulna:exact('ulna '+side),femur:exact('femur '+side),tibia:exact('tibia '+side)}));
 const armRigs=rigs.filter(r=>r.humerus&&r.radius&&r.ulna),legRigs=rigs.filter(r=>r.femur&&r.tibia);
 if(armRigs.length){
  const armTargets=armRigs.flatMap(r=>r.bones.filter(e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e)));
  register({id:'forearm-rotation',label:'前臂旋前与旋后',group:'关节运动',side:true,targets:armTargets,source:source.joint,duration:5,description:'观察桡骨与手部围绕前臂长轴转动，完成旋前与回位。',apply(p){for(const r of armRigs){if(st().side!=='both'&&st().side!==r.side)continue;const pivot=endpoint(r.radius,true),axis=endpoint(r.ulna,false).sub(pivot).normalize();chainPose(r.bones.filter(e=>e===r.radius||isHand(e)),[transform(pivot,axis,wave(p)*1.1*amp()*(r.side==='left'?1:-1))]);}explain(p<.5?'桡骨与手部旋转':'回到起始位','比较固定的尺骨和移动的桡骨。');}});
  register({id:'wrist-deviation',label:'腕关节桡偏与尺偏',group:'关节运动',side:true,targets:armRigs.flatMap(r=>r.bones.filter(isHand)),source:source.joint,duration:5,description:'手部围绕腕部向桡侧和尺侧轻度摆动，前臂保持原位。',apply(p){for(const r of armRigs)if(st().side==='both'||st().side===r.side)chainPose(r.bones.filter(isHand),[transform(endpoint(r.radius,false),V(0,1,0),Math.sin(TAU*p)*.25*amp())]);explain('手部左右偏移','前臂位置保持稳定。');}});
  register({id:'shoulder-circle',label:'肩关节平滑环转',group:'关节运动',side:true,targets:armTargets,source:source.joint,duration:7,description:'将小幅前屈与外展平滑组合，远端前臂和手随上臂一起移动。',apply(p){for(const r of armRigs)if(st().side==='both'||st().side===r.side){const pivot=endpoint(r.humerus,true);chainPose(r.bones.filter(e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e)),[transform(pivot,V(1,0,0),-.45*wave(p)*amp()),transform(pivot,V(0,1,0),.28*Math.sin(TAU*p)*amp())]);}explain('连续前屈与外展组合','保持同侧上肢作为相连骨链。');}});
 }
 if(legRigs.length){
  const legTargets=legRigs.flatMap(r=>r.bones.filter(e=>/^(femur|patella|tibia|fibula) /.test(e.motionName)||isFoot(e)));
  register({id:'ankle-plantarflexion',label:'踝关节跖屈与回位',group:'关节运动',side:true,targets:legRigs.flatMap(r=>r.bones.filter(isFoot)),source:source.joint,duration:4,description:'足部绕踝向下伸展，观察跖屈方向。',apply(p){for(const r of legRigs)if(st().side==='both'||st().side===r.side)chainPose(r.bones.filter(isFoot),[transform(endpoint(r.tibia,false),V(1,0,0),wave(p)*.45*amp())]);explain('足尖向下伸展并回位');}});
  register({id:'hip-circle',label:'髋关节小幅环转',group:'关节运动',side:true,targets:legTargets,source:source.joint,duration:7,description:'将小幅屈伸与外展组合成连续运动，保持大腿、小腿与足相连。',apply(p){for(const r of legRigs)if(st().side==='both'||st().side===r.side){const pivot=endpoint(r.femur,true);chainPose(r.bones.filter(e=>/^(femur|patella|tibia|fibula) /.test(e.motionName)||isFoot(e)),[transform(pivot,V(1,0,0),-.35*wave(p)*amp()),transform(pivot,V(0,1,0),.18*Math.sin(TAU*p)*amp())]);}explain('大腿带动小腿与足连续环转');}});
  register({id:'gait-cycle',label:'步行摆腿与对侧摆臂',group:'器官联动',side:true,targets:unique([legTargets,armRigs.flatMap(r=>r.bones.filter(e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e)))]),source:source.joint,duration:2.4,priority:88,description:'髋、膝、踝协同运动，对侧上肢轻度摆动，呈现步态节律。',apply(p){
   for(const r of legRigs){if(st().side!=='both'&&st().side!==r.side)continue;const sign=r.side==='left'?1:-1,q=Math.sin(TAU*p)*sign*amp(),lift=Math.max(0,q);
    const hip=transform(endpoint(r.femur,true),V(1,0,0),-.35*q),knee=transform(endpoint(r.femur,false),V(1,0,0),.55*lift),ankle=transform(endpoint(r.tibia,false),V(1,0,0),-.15*lift);
    chainPose([r.femur], [hip]);chainPose(r.bones.filter(e=>/^(tibia|fibula|patella) /.test(e.motionName)),[hip,knee]);chainPose(r.bones.filter(isFoot),[hip,knee,ankle]);
   }
   for(const r of armRigs)if(st().side==='both'||st().side===r.side){const q=Math.sin(TAU*p)*(r.side==='left'?-1:1)*amp();chainPose(r.bones.filter(e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e)),[transform(endpoint(r.humerus,true),V(1,0,0),-.2*q)]);}
   explain('左右腿交替 · 对侧上肢随动','髋部变换传递给膝和踝，避免小腿脱离大腿。');
  }});
 }
 for(const [id,label,body] of [['fingers-grasp','手指分节屈曲','hand'],['toes-curl','足趾分节屈曲','foot']]){
  const fingers=match(new RegExp('phalanx of .* (?:finger of '+body+(body==='foot'?'|toe':'')+')'));
  if(fingers.length)register({id,label,group:'关节运动',side:true,targets:fingers,source:source.joint,duration:5,description:'近节、中节和远节依次屈曲，远端骨节继承近端姿态，展示抓握或屈趾的骨链关系。',apply(p){
   for(const side of ['left','right'])for(const number of ['first','second','third','fourth','fifth']){
    if(st().side!=='both'&&st().side!==side)continue;
    const group=fingers.filter(e=>e.motionName.includes(number)&&e.motionName.endsWith(side)),proximal=group.find(e=>e.motionName.startsWith('proximal'));if(!proximal)continue;
    const q=wave(p)*amp(),base=transform(endpoint(proximal,true),V(1,0,0),-.6*q),mid=group.find(e=>e.motionName.startsWith('middle')),distal=group.find(e=>e.motionName.startsWith('distal'));
    chainPose([proximal],[base]);const bend=transform(endpoint(proximal,false),V(1,0,0),-.65*q);if(mid)chainPose([mid],[base,bend]);if(distal)chainPose([distal],[base,bend,...(mid?[transform(endpoint(mid,false),V(1,0,0),-.35*q)]:[])]);
   }explain(p<.5?'各节逐渐屈曲':'各节平滑伸展','远端随近端一起移动。');
  }});
 }
 const ribs=match(/(?:^| )rib (left|right)$|^costal cartilage/),sternum=match(/^body of sternum$|^manubrium$|^xiphoid process$/);
 if(ribs.length)register({id:'rib-breathing',label:'呼吸时肋骨与胸骨运动',group:'生理过程',targets:unique([ribs,sternum]),duration:5,source:source.breath,description:'肋骨围绕后端轻度抬升和外展，胸骨随之向前上方移动，展示胸廓扩张方向。',apply(p){const q=breath(p)*amp();for(const e of ribs){const pivot=e.motionCenter.clone();pivot.y=e.motionBox.max.y;pose(e,pivot,V(1,0,0),-.035*q,[1+.01*q,1,1]);}sternum.forEach(e=>pose(e,e.motionCenter,V(1,0,0),0,[1,1,1],V(0,-.003*q,.002*q)));explain(p<.4?'吸气 · 胸廓抬升与扩张':'呼气 · 胸廓回位','肋骨运动范围经过缩小以避免明显穿插。');}});
 const mandible=exact('mandible');
 if(mandible){const parts=unique([[mandible],match(/^lower .* (?:tooth|canine|premolar|incisor)(?: |$)/)]),pivot=mandible.motionCenter.clone();pivot.z=mandible.motionBox.max.z;pivot.y=mandible.motionBox.max.y;
  register({id:'jaw-chewing',label:'下颌旋转、前移与咀嚼',group:'关节运动',targets:parts,duration:2,source:source.joint,description:'在张口旋转之外叠加轻度前移和侧向偏移，形成平滑咀嚼轨迹。',apply(p){const q=wave(p)*amp();parts.forEach(e=>pose(e,pivot,V(1,0,0),.18*q,[1,1,1],V(.002*Math.sin(TAU*p)*amp(),-.003*q,0)));explain(p<.5?'张口并轻度前移':'闭口并回位');}});
 }

 const irises=match(/^iris (left|right)$/),lenses=match(/^lens (left|right)$/),eyes=match(/^(cornea|iris|lens|retina|sclera|vitreous|anterior chamber|posterior chamber|anterior segment|posterior segment|zonular fibres)/);
 function pupil(q){for(const e of irises){const c=e.motionCenter;deform(e,v=>{const radius=Math.hypot((v.x-c.x)/Math.max(e.motionSize.x/2,.0001),(v.z-c.z)/Math.max(e.motionSize.z/2,.0001)),f=1-.36*q*Math.max(0,1-Math.min(1,radius));v.x=c.x+(v.x-c.x)*f;v.z=c.z+(v.z-c.z)*f;});}}
 function eyeRotation(angleX,angleZ,converge=false){for(const side of ['left','right']){const ref=exact('sclera '+side)||exact('lens '+side);if(!ref)continue;chainPose(eyes.filter(e=>e.motionName.endsWith(side)),[transform(ref.motionCenter,V(0,0,1),angleZ*(converge?(side==='left'?1:-1):1)),transform(ref.motionCenter,V(1,0,0),angleX)]);}}
 if(eyes.length&&lenses.length){
  register({id:'near-response',label:'近反应：会聚、调节与缩瞳',group:'器官联动',targets:eyes,duration:6,priority:85,source:source.eye,description:'双眼向内会聚，晶状体变凸，瞳孔同时缩小；随后平滑回到看远状态。',apply(p){const q=wave(p)*amp();eyeRotation(0,.13*q,true);pupil(q);for(const e of lenses)soft(e,q,{shorten:-.2,bulge:-.025,axis:'y'});explain(p<.5?'看近 · 会聚、晶状体变凸、瞳孔缩小':'看远 · 三项变化逐渐恢复','双眼围绕各自眼球中心转动。',eyes);}});
  register({id:'eye-saccades',label:'双眼快速扫视与停留',group:'感觉器官',targets:eyes,duration:4,source:source.eye,description:'双眼快速切换注视方向，并在目标方向短暂停留，区别于匀速来回转动。',apply(p){let q=p<.2?smooth(p/.2):p<.45?1:p<.6?1-2*smooth((p-.45)/.15):p<.8?-1:-1+smooth((p-.8)/.2);eyeRotation(.03*wave(p)*amp(),q*.22*amp());explain('快速转向 · 短暂停留','眼球各组织绕同一个中心转动。',eyes);}});
  register({id:'eye-pursuit',label:'双眼平滑追踪',group:'感觉器官',targets:eyes,duration:7,source:source.eye,description:'双眼沿缓慢的水平与垂直组合轨迹追踪，保持各眼球内部结构同步。',apply(p){eyeRotation(.11*wave(p)*amp(),.22*Math.sin(TAU*p)*amp());explain('双眼连续追踪移动目标','水平和垂直运动平滑组合。',eyes);}});
 }
 const drums=match(/^tympanic membrane /),ossicles=match(/^(malleus|incus|stapes) /);
 if(drums.length){const oldHearing=modeMap.get('hearing-vibration')?.apply;
  register({id:'eardrum-wave',label:'鼓膜振型与听骨链传递',group:'感觉器官',targets:unique([drums,ossicles]),duration:2.4,source:source.eye,description:'鼓膜中央振幅较大、周缘较小，听小骨随之轻微运动。振动经过大幅降速与放大以便观察。',apply(p){oldHearing?.(p);for(const e of drums){const c=e.motionCenter,axis=['x','y','z'].reduce((a,b)=>e.motionSize[a]<e.motionSize[b]?a:b),keys=['x','y','z'].filter(k=>k!==axis);deform(e,v=>{const r=Math.hypot((v[keys[0]]-c[keys[0]])/Math.max(e.motionSize[keys[0]]*.5,.0001),(v[keys[1]]-c[keys[1]])/Math.max(e.motionSize[keys[1]]*.5,.0001));v[axis]+=Math.sin(TAU*p*3)*amp()*e.motionSize.length()*.025*Math.max(0,1-r*r);});}explain('鼓膜中央振动 · 听骨链跟随','鼓膜周缘的位移被抑制。',drums);}});
 }
 const tearDucts=match(/^nasolacrimal duct|^lacrimal canaliculus/);
 if(tearDucts.length)register({id:'tear-drainage',label:'泪液引流方向',group:'感觉器官',targets:tearDucts,duration:6,source:source.eye,kind:'流向粒子示意',description:'沿泪小管和鼻泪管，观察泪液的引流方向。',apply(p){tearDucts.forEach(e=>{particle(e,p,{color:0xa0e5f2});light([e],.15*wave(p));});explain('沿泪道观察引流方向','依次观察各段泪道。',tearDucts);}});
 const nerves=match(/^median nerve |^ulnar nerve |^sciatic nerve |^optic nerve /);
 if(nerves.length)register({id:'neural-impulses',label:'神经信号沿纤维传播',group:'生理过程',targets:nerves,duration:5,priority:80,source:source.nerve,kind:'信号传播示意',description:'发光粒子沿现有神经走行传播，表示信号传递的概念；神经本身保持原始形态。',apply(p){nerves.forEach(e=>{particle(e,p,{color:0xf7d772});light([e],.18*wave(p));});explain('信号沿神经走行传播','慢动作观察信号沿神经走行传播。',nerves);}});
 const deferens=match(/^ductus deferens /),ejaculatory=match(/^ejaculatory duct /);
 if(deferens.length)register({id:'deferens-wave',label:'输精管平滑肌推进波',group:'生理过程',targets:unique([deferens,ejaculatory]),duration:7,priority:80,source:source.male,description:'观察输精管平滑肌的推进性收缩，局部管径随收缩波依次改变。',apply(p){deferens.forEach(e=>tube(e,p,{strength:.2}));explain('输精管壁局部收缩向前推进','沿管壁观察收缩波。',deferens);}});
 const glands=match(/^thyroid gland$|^parathyroid gland|^suprarenal gland|^adenohypophysis$|^neurohypophysis$|^pineal gland$/);
 if(glands.length&&!arteries.length&&!stomach.length)register({id:'endocrine-signals',label:'内分泌信号释放',group:'生理过程',targets:glands,duration:7,priority:70,source:source.thyroid,kind:'信号粒子示意',description:'通过腺体周围的粒子，观察激素信号的释放。',apply(p){glands.forEach(e=>{particle(e,p,{color:0xe7b6fb,cloud:true});light([e],.12*wave(p));});explain('腺体释放信号 · 结构保持稳定','观察信号从腺体附近向外扩散。',glands);}});
 const nodes=match(/^(cervical|axillary|inguinal|submandibular|superficial inguinal).*nodes/);
 if(nodes.length)register({id:'immune-surveillance',label:'淋巴结内细胞巡行',group:'生理过程',targets:nodes.slice(0,16),duration:8,priority:70,source:source.lymph,kind:'细胞活动粒子示意',description:'通过局部移动的粒子，观察淋巴结内的免疫细胞巡行。',apply(p){nodes.slice(0,16).forEach(e=>{particle(e,p,{color:0xb6e4a4,cloud:true,count:10});light([e],.13*wave(p));});explain('局部巡行 · 淋巴结外形保持稳定','观察各组细胞的局部活动。');}});
 const skin=entries.filter(e=>/^skin$/.test(e.motionName)||e.motionCategory==='皮肤');
 if(skin.length)register({id:'surface-breathing',label:'体表胸腹呼吸起伏',group:'生理过程',targets:skin,duration:5,priority:65,source:source.breath,description:'在体表胸腹区域加入平滑的小幅呼吸起伏，四肢和头部保持稳定。使用身体比例定位胸腹范围。',apply(p){for(const e of skin){const c=e.motionCenter,b=e.motionBox,zspan=Math.max(e.motionSize.z,.0001);deform(e,v=>{const z=(v.z-b.min.z)/zspan,lateral=1-smooth((Math.abs(v.x-c.x)/Math.max(e.motionSize.x,.0001)-.18)/.12),w=smooth((z-.48)/.12)*(1-smooth((z-.78)/.1))*lateral*breath(p)*amp();v.x+=(v.x-c.x)*.012*w;v.y+=(v.y-c.y)*.028*w;});}explain(p<.4?'吸气 · 胸腹轮廓轻度扩张':'呼气 · 体表轮廓回位','只改变胸腹区域的外轮廓。',skin);}});
 createPhysiologyMotions({...api,register,enhance,soft,tube,particle,field,heart,lungs,diaphragmShape,pupil,eyeRotation,transform,chainPose});
 return {preferred:motionModes.filter(m=>m.priority).sort((a,b)=>b.priority-a.priority)[0]?.id,
  resetFrame(){blood.resetFrame();for(const fx of flows.values())fx.object.visible=false;}};
}

/* Coordinated physiology and articulated motion on the structures actually present.
 * These are deterministic teaching deformations, not a patient-specific mechanics solver.
 * All dimensions derive from the source atlas; no generated organs or baked GLB edits.
 */
function createPhysiologyMotions(api){
 const {THREE,entries,match,exact,unique,boxOf,middle,pose,deform,light,explain,source,
  register,enhance,modeMap,soft,tube,particle,field,heart,lungs,diaphragmShape,pupil,
  eyeRotation,transform,chainPose,endpoint,sideBones,isHand,isFoot,getState}=api;
 const V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),TAU=2*Math.PI;
 const clamp=x=>Math.max(0,Math.min(1,x));
 const smooth=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10);};
 const wave=p=>(1-Math.cos(TAU*p))/2,amp=()=>getState().amplitude;
 const bump=(p,a,b,c)=>p<b?smooth((p-a)/(b-a)):1-smooth((p-b)/(c-b));
 const sideOK=side=>getState().side==='both'||getState().side===side;
 const chapter=slug=>'https://openstax.org/books/anatomy-and-physiology-2e/pages/'+slug;
 const move=(parts,offset)=>parts.forEach(e=>pose(e,e.motionCenter,V(1,0,0),0,[1,1,1],offset));
 const tissue=re=>match(re).filter(e=>!/bursa|tendon|sheath|ligament|trochlea/.test(e.motionName));
 const radial=(parts,q,amount)=>parts.forEach(e=>soft(e,q,{shorten:0,bulge:amount,axis:field(e).axis}));
 // Resolve direction against named endpoints, never assume left/right tubes share an axis.
 function flowTo(e,p,target,color,opacity=.78){
  const f=field(e),to=target?.motionCenter||target;
  const direction=to&&f.points[0].distanceToSquared(to)<f.points[39].distanceToSquared(to)?-1:1;
  particle(e,p,{color,direction,opacity});
 }
 function add(id,label,targets,duration,description,apply,extra={}){
  register({id,label,targets,duration,description,apply,source:source.joint,...extra});
 }

 const chambers=match(/^(left|right) (atrium|ventricle)$/),ventricles=match(/^(left|right) ventricle$/);
 const valves=match(/leaflet/),papillary=match(/papillary muscle/);
 const coronary=match(/^(left|right) coronary artery$|^anterior interventricular branch|^circumflex branch of left coronary/);
 const great=match(/^(ascending aorta|arch of aorta|thoracic aorta|abdominal aorta|pulmonary trunk|left pulmonary artery|right pulmonary artery)$/);
 if(ventricles.length){
  const cardiac=unique([chambers,valves,papillary,coronary]),center=middle(ventricles),height=boxOf(cardiac).getSize(V()).z;
  function attachedCoronary(p){
   const q=bump(p,.22,.39,.64)*amp();
   for(const e of coronary)pose(e,center,V(0,0,1),.025*q,[1-.035*q,1-.035*q,1-.055*q]);
  }
  // The coronary surface follows the heart instead of hovering over contracting myocardium.
  const original=modeMap.get('cardiac-living');
  if(original){const old=original.apply;enhance(original.id,{targets:unique([original.targets,coronary]),apply(p){old(p);attachedCoronary(p);}});}
  add('cardiorespiratory-rhythm','心搏与呼吸位移联动',unique([cardiac,great]),6,
   '五次心搏叠加一次缓慢呼吸位移，观察快慢两种节律同时发生。',p=>{
    cardiac.forEach(e=>pose(e,e.motionCenter));
    const beat=(p*5)%1;heart(beat,true);attachedCoronary(beat);
    const dz=-height*.035*wave(p)*amp();
    // Preserve each part's cardiac matrix and add the common anatomical translation.
    const shift=api.basis.clone().multiply(new THREE.Matrix4().makeTranslation(0,0,dz)).multiply(api.basis.clone().invert());
    for(const e of cardiac){e.motion.matrix.premultiply(shift);e.motion.matrixWorldNeedsUpdate=true;}
    explain('心肌快速搏动 · 心脏随呼吸缓慢移动','心房、心室、瓣叶和冠脉共同参与。',chambers);
   },{source:source.heart,group:'器官联动',priority:110,focusTargets:cardiac});
  if(coronary.length)add('coronary-perfusion','心肌收缩与冠脉舒张期灌注',unique([cardiac,coronary]),2.4,
   '心室舒张时冠状动脉灌注更明显，冠脉随心肌一起活动。',p=>{
    heart(p);attachedCoronary(p);
    for(const e of coronary)flowTo(e,p,center,0xffb38a,.2+.65*bump(p,.48,.75,.98));
    explain(p<.6?'心室收缩':'心室舒张 · 冠脉灌注增强','沿冠状动脉观察心肌的供血。',coronary);
   },{source:'https://pubmed.ncbi.nlm.nih.gov/1267523/',group:'器官联动',focusTargets:cardiac});
  add('ventricular-filling','心室早期充盈与心房助推',unique([chambers,valves]),3.5,
   '心室先舒张充盈，随后心房收缩补充充盈，最后恢复起始形态。',p=>{
    const fill=bump(p,.05,.32,.92)*amp(),kick=bump(p,.55,.68,.83)*amp();
    radial(ventricles,fill,.07);radial(chambers.filter(e=>/atrium/.test(e.motionName)),kick,-.08);
    for(const e of valves)soft(e,fill,{shorten:.04,bulge:.035});
    explain(p<.5?'舒张早期 · 心室充盈':p<.83?'心房收缩 · 补充充盈':'回到起始状态','比较心房与心室的先后变化。',chambers);
   },{source:source.heart});
 }
 const aorta=great.filter(e=>/aorta/.test(e.motionName));
 if(aorta.length)add('aortic-recoil','主动脉扩张与弹性回缩',aorta,2.2,
  '射血期主动脉扩张，随后缓慢回缩，维持舒张期的血液流动。',p=>{
   const q=bump(p,.04,.27,.98)*amp();radial(aorta,q,.10);
   aorta.forEach(e=>particle(e,p,{color:0xffa68b,direction:e.motionName==='ascending aorta'?1:-1}));
   explain(p<.27?'射血 · 管壁扩张':'弹性回缩 · 血流继续','观察快速扩张与较慢回弹。',aorta);
  },{source:source.blood});

 const lobes=match(/lobe of (left|right) lung/),airways=match(/^trachea$|main bronchus$/);
 // Registered multi-system scenes can animate the heart and lungs together.
 if(ventricles.length&&lobes.length){
  const pulmonary=match(/^(pulmonary trunk|(left|right) pulmonary artery)$/);
  const pulmonaryVeins=match(/^(left|right) (superior|inferior) pulmonary vein$/);
  const caval=match(/^(superior|inferior) vena cava\b/);
  // Atlas side names occur both before and after the vessel name; include distal limb vessels.
  const systemic=match(/^(abdominal|thoracic|ascending) aorta$|^arch of aorta$|(?:^| )(common carotid|internal carotid|subclavian|axillary|common iliac|external iliac|femoral|popliteal|anterior tibial|posterior tibial|brachial|radial|ulnar) artery(?: |$)/);
  const returning=match(/(?:^| )(internal jugular|subclavian|axillary|common iliac|external iliac|femoral|popliteal|anterior tibial|posterior tibial|brachial|cephalic|basilic|great saphenous) veins?(?: |$)/);
  const targets=unique([chambers,valves,coronary,lobes,pulmonary,pulmonaryVeins,caval,systemic,returning,airways]);
  function circulation(p,full,exercise=false){
   const beat=(p*(exercise?8:5))%1,respiration=exercise?(p*2)%1:p;heart(beat,true);lungs(respiration,exercise?1.1:.65);
   const right=exact('right ventricle'),left=exact('left atrium'),rightAtrium=exact('right atrium');
   for(const e of pulmonary)flowTo(e,p,middle(lobes),0x61b9e0);
   for(const e of pulmonaryVeins)flowTo(e,p,left,0xf17f73);
   for(const e of caval)flowTo(e,p,rightAtrium,0x61b9e0);
   for(const e of returning)flowTo(e,p,rightAtrium,0x61b9e0);
   for(const e of systemic){
    const f=field(e),center=right?.motionCenter||middle(chambers);
    const direction=f.points[0].distanceToSquared(center)>f.points[39].distanceToSquared(center)?-1:1;
    particle(e,p,{color:0xf17f73,direction,opacity:.9});
   }
   if(full)for(const e of airways)particle(e,p,{color:0xade2df,direction:respiration<.4?-1:1});
   explain(respiration<.4?'吸气 · 心脏持续泵血':'呼气 · 循环持续进行','肺循环连接心脏与肺；体循环连接心脏与全身。',chambers);
  }
  add('whole-body-circulation','全身血流：肺循环与体循环',targets,6,
   '低氧血经右心进入肺，富氧血由肺返回左心，再沿主动脉流向全身；静脉回流汇入右心。',
   p=>circulation(p,false),{group:'全身联动',source:source.blood,priority:125,focusTargets:unique([chambers,lobes])});
  add('whole-body-vitality','生命律动：心搏、呼吸与循环',targets,4,
   '一次呼吸中连续呈现五次心搏，联动观察肺叶起伏、心腔收缩、瓣膜开闭和血液循环。',
   p=>circulation(p,true),{group:'全身联动',source:source.breath,priority:130,focusTargets:unique([chambers,lobes])});
  const stops=[
   ['右心泵血',chambers.filter(e=>/^right /.test(e.motionName)),'右心将低氧血泵入肺动脉。'],
   ['肺动脉入肺',pulmonary,'血液从右心流向肺部。'],
   ['肺部交换与回流',unique([lobes,pulmonaryVeins]),'在肺部获得氧后，血液经肺静脉返回左心。'],
   ['左心射血',chambers.filter(e=>/^left /.test(e.motionName)),'左心将富氧血泵入主动脉。'],
   ['体动脉分配',systemic,'富氧血沿动脉分配至头颈、躯干和四肢。'],
   ['静脉汇入右心',unique([caval,returning]),'组织利用氧后，血液沿静脉回到右心。']
  ];
  add('whole-body-oxygen-journey','红细胞旅程：一次完整循环',targets,12,
   '在全身空间中依次观察右心、肺、左心与四肢血管。点击循环节点可暂停并比较每一段通路。',p=>{
    circulation(p,true);const item=stops[Math.min(5,Math.floor(p*6))];light(item[1],.3,0xecb76a);explain(item[0],item[2],item[1]);
   },{group:'全身联动',source:source.blood,priority:135});
  add('whole-body-exercise','运动时的心肺节律',targets,4,
   '更快的心搏配合更深、更频繁的呼吸，对照静息时心肺与循环的协同变化。',p=>circulation(p,true,true),{group:'全身联动',source:source.breath});
  add('whole-body-conduction','心脏电传导与泵血',targets,6,
   '先观察心房兴奋与收缩，再观察心室兴奋、射血和舒张。亮度的先后变化对应兴奋传播次序。',p=>{
    circulation(p,true);const b=(p*5)%1,atria=chambers.filter(e=>/atrium/.test(e.motionName));
    light(atria,.75*bump(b,.02,.12,.22),0xf4cf68);light(ventricles,.8*bump(b,.22,.3,.48),0xf4cf68);
    explain(b<.22?'心房先兴奋并收缩':b<.64?'心室随后兴奋并射血':'心肌舒张与充盈','兴奋的先后次序与泵血过程相互配合。',chambers);
   },{group:'全身联动',source:chapter('19-2-cardiac-muscle-and-electrical-activity'),focusTargets:chambers});
 }
 const larynx=match(/^(thyroid|cricoid|arytenoid|corniculate) cartilage/),arytenoids=match(/^arytenoid cartilage/),epi=exact('epiglottis');
 function glotticPose(p){
  const q=wave(p)*amp();
  for(const e of arytenoids)pose(e,e.motionCenter,V(0,0,1),(e.motionName.endsWith('left')?1:-1)*.18*q);
 }
 if(lobes.length){
  const targets=unique([lobes,match(/bronchus/),larynx]);
  add('cough-cycle','咳嗽：吸气、蓄压与快速呼气',targets,4.8,
   '先深吸气，再短暂停留，随后快速呼气，肺部平滑回到起始轮廓。',p=>{
    const t=p<.32?.4*smooth(p/.32):p<.46?.4:p<.72?.4+.6*smooth((p-.46)/.26):1;
    lungs(t,1.35);glotticPose(p);
    for(const e of airways)particle(e,p,{color:0x9ce2ee,direction:p<.32?-1:1,opacity:p>.46&&p<.72?.95:.35});
    explain(p<.32?'深吸气':p<.46?'短暂蓄压':p<.72?'快速呼气':'呼气后恢复','比较吸气与呼气的时间差。',lobes);
   },{source:source.breath,group:'器官联动'});
  if(arytenoids.length)add('phonation-breath','发声时的呼气与喉软骨联动',targets,7,
   '吸气后缓慢呼气，杓状软骨轻度内转；观察呼气与喉部位置的配合。',p=>{
    const t=p<.2?p*2:.4+(p-.2)*.75;lungs(t);glotticPose(p);
    airways.forEach(e=>particle(e,p,{color:0x9ce2ee,direction:p<.2?-1:1}));
    explain(p<.2?'吸气准备':'缓慢呼气 · 喉部配合','可单独隐藏肺叶，观察杓状软骨。',arytenoids);
   },{source:source.air,group:'器官联动'});
 }
 if(larynx.length&&epi)add('laryngeal-elevation','吞咽时喉部抬升与会厌联动',unique([larynx,[epi]]),4,
  '喉部向前上方抬升，会厌同时倾转，随后各部件协调复位。',p=>{
   const q=bump(p,.05,.40,.88)*amp(),span=boxOf(larynx).getSize(V()).z,offset=V(0,-span*.08*q,span*.18*q);
   move(larynx,offset);const pivot=epi.motionCenter.clone();pivot.z=epi.motionBox.min.z;
   pose(epi,pivot,V(1,0,0),-.5*q,[1,1,1],offset);
   explain(p<.4?'喉部抬升 · 会厌倾转':'喉部与会厌回位','喉软骨共享位移，保持相对位置。',larynx);
  },{source:source.swallow,group:'器官联动'});
 if(airways.length)add('airway-clearance','气道黏液向咽部运输',airways,8,
  '沿气管与主支气管观察黏液向咽部的运输方向。',p=>{
   const destination=epi||exact('trachea');
   for(const e of airways)flowTo(e,p,destination,0xade4cd);
   explain('向咽部缓慢运输','气道表面的纤毛共同推动黏液。',airways);
  },{source:source.air,kind:'运输过程'});
 if(arytenoids.length)add('arytenoid-breath','杓状软骨开合',arytenoids,5,
  '左右杓状软骨围绕各自支点小幅转动，观察喉部开合的骨架动作。',p=>{
   glotticPose(p);explain(p<.5?'左右软骨内转':'逐渐回位','两侧以相反方向协调转动。',arytenoids);
  },{source:source.air});

 const tongue=match(/^tongue$/),salivary=match(/^(parotid|submandibular) duct /),gall=match(/^gallbladder$/);
 const bile=match(/^bile duct$/),pancreatic=match(/^(accessory )?pancreatic duct$/),duodenum=exact('duodenum');
 if(tongue.length)add('tongue-propulsion','舌体推进与舌根接续',tongue,4.5,
  '舌面从前向后依次抬起，把口腔中的食团向咽部推进。',p=>{
   for(const e of tongue){const b=e.motionBox;deform(e,v=>{
    const u=clamp((v.y-b.min.y)/Math.max(e.motionSize.y,1e-6));
    const w=Math.exp(-(((u-(-.2+1.4*p))/.22)**2))*Math.sin(Math.PI*u)*Math.sin(Math.PI*p)**2;
    v.z+=e.motionSize.z*.20*w*amp();v.y+=e.motionSize.y*.04*w*amp();
   });}
   explain('舌前部抬起 · 推进到舌根','观察波形从前向后移动。',tongue);
  },{source:source.swallow});
 if(salivary.length)add('salivary-flow','唾液沿导管进入口腔',salivary,6,
  '唾液从腺体经导管流向口腔，参与润滑食物和消化准备。',p=>{
   salivary.forEach(e=>flowTo(e,p,tongue[0]||V(0,0,e.motionCenter.z),0xaee6f2));
   explain('腺体分泌 · 导管输送','对照左右腮腺管和下颌下腺管。',salivary);
  },{source:source.swallow});
 if(gall.length&&bile.length)add('bile-release','胆囊收缩与胆汁输送',unique([gall,bile]),9,
  '胆囊缓慢收缩，胆汁沿胆管进入十二指肠。',p=>{
   gall.forEach(e=>soft(e,wave(p)*amp(),{shorten:.15,bulge:-.14,anchor:1}));
   bile.forEach(e=>flowTo(e,p,duodenum,0xd5d56a));
   explain(p<.5?'胆囊收缩 · 胆汁流出':'胆囊轮廓回位','观察胆囊和胆管的配合。',gall);
  },{source:chapter('23-6-accessory-organs-in-digestion-the-liver-pancreas-and-gallbladder'),group:'器官联动'});
 if(pancreatic.length)add('pancreatic-flow','胰液沿胰管输送',pancreatic,7,
  '胰液经胰管输送到十二指肠，参与食物的化学性消化。',p=>{
   pancreatic.forEach(e=>flowTo(e,p,duodenum,0x99d4ed));explain('胰管输送 · 汇入十二指肠','观察主胰管与副胰管。',pancreatic);
  },{source:chapter('23-6-accessory-organs-in-digestion-the-liver-pancreas-and-gallbladder')});
 const colon=match(/^(ascending|transverse|descending|sigmoid) colon$/);
 if(colon.length)add('colon-mass-movement','结肠顺序推进',colon,10,
  '升结肠、横结肠、降结肠和乙状结肠依次出现推进性收缩。',p=>{
   for(const [i,name] of ['ascending','transverse','descending','sigmoid'].entries()){
    const local=clamp((p-i*.17)/.48);
    colon.filter(e=>e.motionName.startsWith(name)).forEach(e=>tube(e,local,{strength:.16,direction:name==='ascending'?1:-1}));
   }
   explain('推进波沿各结肠段接续','各段按通路先后进入收缩阶段。',colon);
  },{source:source.digest});
 const liver=match(/^liver$|segment of liver/);
 if(liver.length)add('liver-respiratory-motion','肝脏随呼吸下降与回升',liver,5,
  '吸气时膈肌下降，肝脏随之向下移动；呼气时回升。',p=>{
   const b=boxOf(liver),q=wave(p)*amp();move(liver,V(0,0,-b.getSize(V()).z*.06*q));
   explain(p<.5?'吸气 · 肝脏下降':'呼气 · 肝脏回升','肝脏和各分段保持整体关系。',liver);
  },{source:source.breath});

 const kidneys=match(/^kidney /),pelves=match(/^renal pelvis /),ureters=match(/^ureter /),bladder=exact('urinary bladder');
 if(kidneys.length)add('renal-breathing','肾脏随呼吸移动',unique([kidneys,pelves,ureters]),5,
  '肾脏和肾盂随呼吸轻度下降，输尿管上端跟随，下端保持稳定。',p=>{
   for(const side of ['left','right']){
    const kidney=exact('kidney '+side);if(!kidney)continue;
    const dz=-kidney.motionSize.z*.055*wave(p)*amp();
    move([kidney,...pelves.filter(e=>e.motionName.endsWith(side))],V(0,0,dz));
    for(const e of ureters.filter(e=>e.motionName.endsWith(side)))deform(e,v=>{
     v.z+=dz*smooth((v.z-e.motionBox.min.z)/Math.max(e.motionSize.z,1e-6));
    });
   }
   explain(p<.5?'吸气 · 肾与肾盂下降':'呼气 · 上尿路回位','输尿管由上向下平滑过渡到固定端。',kidneys);
  },{source:source.breath,group:'器官联动'});
 if(pelves.length&&ureters.length)add('pelvis-ureter-wave','肾盂与输尿管接续收缩',unique([pelves,ureters]),7,
  '收缩先在肾盂出现，再沿输尿管向膀胱方向推进。',p=>{
   for(const e of pelves)soft(e,bump(p,.04,.19,.42)*amp(),{shorten:.04,bulge:-.08});
   ureters.forEach(e=>tube(e,clamp((p-.18)/.82),{strength:.28}));
   explain(p<.25?'肾盂收缩':'收缩波向膀胱下传','观察上尿路的接续运动。',pelves);
  },{source:source.urine,group:'器官联动'});

 // Antagonists preserve their attachment regions and change the muscle belly itself.
 function antagonists(id,label,a,b,note,duration=5){
  if(!a.length||!b.length)return;
  add(id,label,unique([a,b]),duration,note,p=>{
   for(const [parts,q] of [[a,bump(p,0,.25,.5)],[b,bump(p,.5,.75,1)]]){
    for(const e of parts)soft(e,q*amp(),{shorten:.11,bulge:.065,axis:field(e).axis});
   }
   explain(p<.5?'第一组肌群收缩':'拮抗肌群接续活动','肌腹形变逐渐减小到附着端。',p<.5?a:b);
  },{source:source.muscle,group:'肌肉活动'});
 }
 antagonists('elbow-antagonists','屈肘与伸肘肌群连续交替',tissue(/biceps brachii/),tissue(/triceps brachii/),'肱二头肌和肱三头肌以错开的收缩时序展示屈伸配合。');
 antagonists('finger-antagonists','屈指与伸指肌群',tissue(/flexor digitorum (profundus|superficialis)/),tissue(/^extensor digitorum (left|right)$/),'屈指肌与伸指肌交替活动，观察前臂肌腹的形态变化。');
 antagonists('ankle-antagonists','背屈与跖屈肌腹活动',tissue(/^tibialis anterior/),tissue(/gastrocnemius|^soleus/),'小腿前侧与后侧肌群交替收缩。');
 antagonists('knee-antagonists','伸膝与屈膝肌腹活动',tissue(/rectus femoris|vastus /),tissue(/biceps femoris|semitendinosus|semimembranosus/),'股前和股后肌群以不同相位收缩。');
 antagonists('laryngeal-muscles','喉部开闭肌群配合',tissue(/^posterior crico arytenoid/),tissue(/^lateral crico arytenoid|^transverse arytenoid/),'后环杓肌与侧环杓肌、杓横肌交替活动，参与声门开合。');
 antagonists('gaze-muscles','双眼水平注视肌群配合',tissue(/^medial rectus muscle left$|^lateral rectus muscle right$/),tissue(/^medial rectus muscle right$|^lateral rectus muscle left$/),'一侧内直肌与对侧外直肌一起活动，双眼向同一方向注视。');
 const smile=tissue(/^zygomaticus (major|minor)/),lips=tissue(/^orbicularis oris/),buccinator=tissue(/^buccinator/);
 for(const [id,label,parts,note] of [
  ['smile-muscles','微笑时的颧肌收缩',smile,'颧大肌与颧小肌收缩，参与提起口角和上唇。'],
  ['lip-pursing','口轮匝肌收缩',lips,'口轮匝肌节律收缩，观察口周肌群的形态。'],
  ['buccinator-action','颊肌参与口腔推进',buccinator,'颊肌收缩，帮助把食物保持在牙列之间。']]){
  if(parts.length)add(id,label,parts,4,note,p=>{
   parts.forEach(e=>soft(e,wave(p)*amp(),{shorten:.09,bulge:.045,axis:field(e).axis}));
   explain(p<.5?'肌腹收缩':'平滑放松',note,parts);
  },{source:source.muscle,group:'肌肉活动'});
 }

 // Bind joint pivots once, using the undeformed atlas.
 const rigs=['left','right'].map(side=>{
  const bones=sideBones(side),femur=exact('femur '+side),tibia=exact('tibia '+side),humerus=exact('humerus '+side),radius=exact('radius '+side);
  return {side,bones,femur,tibia,humerus,radius,hip:femur&&endpoint(femur,true),knee:femur&&endpoint(femur,false),
   ankle:tibia&&endpoint(tibia,false),shoulder:humerus&&endpoint(humerus,true),elbow:humerus&&endpoint(humerus,false),
   wrist:radius&&endpoint(radius,false),foot:bones.filter(isFoot),hand:bones.filter(isHand)};
 });
 const legs=rigs.filter(r=>r.femur&&r.tibia),arms=rigs.filter(r=>r.humerus&&r.radius);
 const legParts=r=>r.bones.filter(e=>/^(femur|patella|tibia|fibula) /.test(e.motionName)||isFoot(e));
 const armParts=r=>r.bones.filter(e=>/^(humerus|radius|ulna) /.test(e.motionName)||isHand(e));
 if(legs.length){
  add('squat-chain','髋膝踝协同屈伸',legs.flatMap(legParts),6,'髋部前屈、膝部屈曲和踝部背屈同步进行，远端继承近端动作。',p=>{
   const q=wave(p)*amp();
   for(const r of legs)if(sideOK(r.side)){
    const hip=transform(r.hip,V(1,0,0),-.45*q),knee=transform(r.knee,V(1,0,0),.78*q),ankle=transform(r.ankle,V(1,0,0),-.33*q);
    chainPose([r.femur],[hip]);chainPose(r.bones.filter(e=>/^(tibia|fibula|patella) /.test(e.motionName)),[hip,knee]);chainPose(r.foot,[hip,knee,ankle]);
   }
   explain(p<.5?'髋膝屈曲 · 踝背屈':'三关节协同伸展','逐级传递骨链姿态。');
  },{side:true,group:'器官联动'});
  add('cycling-chain','骑行样髋膝交替运动',legs.flatMap(legParts),3.8,'双侧髋、膝、踝交替屈伸，表现连续的循环动作。',p=>{
   const envelope=Math.sin(Math.PI*p)**2;
   for(const r of legs)if(sideOK(r.side)){
    const t=(p+(r.side==='left'?0:.5))%1,q=wave(t)*amp()*envelope;
    const hip=transform(r.hip,V(1,0,0),-.55*q),knee=transform(r.knee,V(1,0,0),.9*q);
    chainPose([r.femur],[hip]);chainPose(r.bones.filter(e=>/^(tibia|fibula|patella) /.test(e.motionName)),[hip,knee]);chainPose(r.foot,[hip,knee,transform(r.ankle,V(1,0,0),-.2*q)]);
   }explain('双侧交替屈伸','比较髋、膝、踝的相位关系。');
  },{side:true,group:'器官联动'});
  for(const [id,label,sign] of [['hip-internal-rotation','髋关节内旋',1],['hip-external-rotation','髋关节外旋',-1]]){
   add(id,label,legs.flatMap(legParts),5,'下肢围绕髋部和股骨长轴旋转，小腿与足一起跟随。',p=>{
    for(const r of legs)if(sideOK(r.side))chainPose(legParts(r),[transform(r.hip,r.knee.clone().sub(r.hip).normalize(),sign*(r.side==='left'?1:-1)*.32*wave(p)*amp())]);
    explain(label,'比较髌骨和足尖的朝向。');
   },{side:true,group:'关节运动'});
  }
  add('foot-inversion-eversion','足部内翻与外翻',legs.flatMap(r=>r.foot),5.5,'足部围绕后足区域轻度内翻与外翻，比较足底朝向。',p=>{
   for(const r of legs)if(sideOK(r.side)){
    const talus=exact('talus '+r.side),pivot=talus?.motionCenter||r.ankle;
    chainPose(r.foot.filter(e=>e!==talus),[transform(pivot,V(0,1,0),Math.sin(TAU*p)*.18*amp()*(r.side==='left'?1:-1))]);
   }explain(p<.5?'足底向内转':'足底向外转','距骨保持为后足参照。');
  },{side:true,group:'关节运动'});
 }
 if(arms.length){
  add('reach-chain','伸手：肩肘腕连续配合',arms.flatMap(armParts),6,'肩部先抬起，肘部接续屈伸，腕部轻度调整，最后一起回位。',p=>{
   for(const r of arms)if(sideOK(r.side)){
    const q=wave(p)*amp(),shoulder=transform(r.shoulder,V(1,0,0),-.7*q),elbow=transform(r.elbow,V(1,0,0),-.5*bump(p,.08,.36,.86)*amp());
    chainPose([r.humerus],[shoulder]);chainPose(r.bones.filter(e=>/^(radius|ulna) /.test(e.motionName)),[shoulder,elbow]);chainPose(r.hand,[shoulder,elbow,transform(r.wrist,V(1,0,0),.12*q)]);
   }explain(p<.5?'抬臂 · 肘腕接续':'上肢平滑回位','观察肩、肘、腕的连续骨链。');
  },{side:true,group:'器官联动'});
  add('wrist-circle','腕关节环转',arms.flatMap(r=>r.hand),5.5,'掌屈背伸与桡尺偏平滑组合，手部保持整体运动。',p=>{
   for(const r of arms)if(sideOK(r.side))chainPose(r.hand,[transform(r.wrist,V(1,0,0),.25*wave(p)*amp()),transform(r.wrist,V(0,1,0),.14*Math.sin(TAU*p)*amp())]);
   explain('屈伸与侧偏组合','前臂保持稳定。');
  },{side:true,group:'关节运动'});
 }

 const irises=match(/^iris (left|right)$/),eyes=match(/^(cornea|iris|lens|retina|sclera|vitreous body|anterior chamber of eyeball|posterior segment of eyeball|anterior segment of eyeball|zonular fibres) (left|right)$/);
 if(irises.length)add('pupil-light-adaptation','瞳孔快速缩小与缓慢恢复',irises,7,
  '光照变化后，瞳孔较快缩小，再逐渐恢复，观察不同阶段的速度。',p=>{
   pupil(bump(p,.08,.25,.98)*amp());explain(p<.25?'快速缩瞳':'瞳孔缓慢恢复','虹膜外周保持稳定。',irises);
  },{source:source.eye,group:'感觉器官'});
 if(eyes.length)add('reading-saccades','阅读时的扫视与回扫',eyes,7,
  '双眼在一行内多次短暂停留，然后快速回扫到起始方向。',p=>{
   const steps=4,t=p<.8?p/.8:1,k=Math.floor(t*steps),fraction=t*steps-k;
   const x=p<.8?(k+smooth(fraction/.25))/steps:1-smooth((p-.8)/.2);
   eyeRotation(0,.3*x*amp());explain(p<.8?'短扫视 · 注视停留':'回扫','两眼保持同步转动。',eyes);
  },{source:source.eye,group:'感觉器官'});
 const auditory=match(/^auditory tube /);
 if(auditory.length)add('auditory-tube-opening','吞咽时咽鼓管开放',auditory,5,
  '咽鼓管短暂开放，帮助平衡鼓室与外界气压，随后回到静息形态。',p=>{
   radial(auditory,bump(p,.15,.42,.78)*amp(),.12);auditory.forEach(e=>particle(e,p,{color:0x9bdced}));
   explain(p<.42?'短暂开放':'恢复静息形态','观察左右咽鼓管。',auditory);
  },{source:source.eye,group:'感觉器官'});

 // Signal sequences are tied to named pathways; organ meshes are not made to contract.
 function signalSequence(id,label,stages,description,link,duration=8){
  const available=stages.filter(s=>s.parts.length);if(available.length<2)return;
  add(id,label,available.flatMap(s=>s.parts),duration,description,p=>{
   available.forEach((s,i)=>{
    const t=clamp((p-i/(available.length+1))*available.length),q=Math.sin(Math.PI*t)**2;
    if(q>.001)for(const e of s.parts){particle(e,t,{color:s.color||0xf0ce78,direction:s.direction||1,cloud:!!s.cloud,opacity:.8*q,count:12});light([e],.22*q,s.color||0xf0ce78);}
   });
   const active=Math.min(available.length-1,Math.floor(p*available.length));
   explain(available[active].label,description,available[active].parts);
  },{source:link,kind:'信号传播',group:'生理过程'});
 }
 signalSequence('spinal-reflex','脊髓反射：感觉传入与运动传出',[
  {label:'后根传入',parts:match(/^posterior root of spinal nerve/),direction:1},
  {label:'后角处理',parts:match(/^posterior horn of spinal cord$/),cloud:true},
  {label:'前角与前根传出',parts:match(/^anterior horn of spinal cord$|^anterior root of spinal nerve/),direction:-1}
 ],'感觉信息进入脊髓，经过局部处理，再由运动通路传出。',chapter('14-3-motor-responses'));
 signalSequence('visual-pathway','视觉信号向中枢传递',[
  {label:'视神经',parts:match(/^optic nerve /)},
  {label:'视交叉',parts:match(/^optic chiasm /)},
  {label:'视束',parts:match(/^optic tract /)}
 ],'沿视神经、视交叉和视束观察视觉信号的传递顺序。',source.eye);
 signalSequence('descending-motor','下行运动信号',[
  {label:'皮质脊髓束下行',parts:match(/^(anterior|lateral) corticospinal tract$/),direction:-1},
  {label:'脊髓前角',parts:match(/^anterior horn of spinal cord$/),cloud:true},
  {label:'前根传出',parts:match(/^anterior root of spinal nerve/),direction:-1}
 ],'运动信号沿下行通路到达脊髓，并由前根传出。',chapter('14-3-motor-responses'));
 signalSequence('thyroid-feedback-pulse','垂体与甲状腺信号往返',[
  {label:'垂体信号释放',parts:match(/^adenohypophysis$/),cloud:true,color:0xd8b2ed},
  {label:'甲状腺响应',parts:match(/^thyroid gland$/),cloud:true,color:0xf2bf84},
  {label:'反馈调节',parts:match(/^adenohypophysis$/),cloud:true,color:0x9bc9e8}
 ],'垂体信号促进甲状腺活动，甲状腺激素参与反馈调节。',source.thyroid);
 signalSequence('adrenal-axis','垂体与肾上腺调节',[
  {label:'腺垂体释放信号',parts:match(/^adenohypophysis$/),cloud:true},
  {label:'肾上腺响应',parts:match(/^suprarenal gland /),cloud:true},
  {label:'反馈至垂体',parts:match(/^adenohypophysis$/),cloud:true}
 ],'观察垂体、肾上腺及反馈调节的先后关系。',chapter('17-6-the-adrenal-glands'));
 const spleen=match(/^spleen$/),tonsils=match(/^palatine tonsil /);
 for(const [id,label,parts,note] of [
  ['splenic-surveillance','脾内免疫细胞活动',spleen,'脾参与血液过滤及免疫监视，细胞在局部持续活动。'],
  ['tonsil-surveillance','扁桃体局部免疫活动',tonsils,'扁桃体位于口咽部，参与识别进入的抗原。']]){
  if(parts.length)add(id,label,parts,8,note,p=>{parts.forEach(e=>particle(e,p,{cloud:true,color:0xb9e2a4,count:22}));explain('局部免疫细胞活动',note,parts);},{source:source.lymph,kind:'细胞活动'});
 }
 const deferens=match(/^ductus deferens /),ejaculatory=match(/^ejaculatory duct /),seminal=match(/^seminal gland /);
 if(deferens.length&&ejaculatory.length)add('male-transport-coupled','输精管与射精管接续推进',unique([deferens,ejaculatory,seminal]),7,
  '输精管的收缩波先行，精囊活动与射精管输送随后接续。',p=>{
   deferens.forEach(e=>tube(e,clamp(p/.75),{strength:.2}));
   seminal.forEach(e=>soft(e,bump(p,.3,.54,.85)*amp(),{shorten:.06,bulge:-.06}));
   ejaculatory.forEach(e=>{tube(e,clamp((p-.4)/.6),{strength:.12});flowTo(e,p,exact('prostate'),0xf1d4a6);});
   explain(p<.4?'输精管推进':'精囊与射精管接续','各段以不同相位参与运输。',p<.4?deferens:ejaculatory);
  },{source:source.male,group:'器官联动'});
 const skin=match(/^skin$/);
 if(skin.length)add('abdominal-breathing','腹式呼吸的体表起伏',skin,6,
  '吸气时腹部向前轻度隆起，呼气时回落，胸部的变化较小。',p=>{
   for(const e of skin){const c=e.motionCenter,b=e.motionBox;deform(e,v=>{
    const z=(v.z-b.min.z)/Math.max(e.motionSize.z,1e-6),x=(v.x-c.x)/Math.max(e.motionSize.x,1e-6);
    const region=Math.exp(-(((z-.58)/.075)**2))*Math.exp(-((x/.14)**4));
    const anterior=1-smooth((v.y-b.min.y)/Math.max(e.motionSize.y,1e-6));
    v.y-=e.motionSize.y*.045*region*anterior*wave(p)*amp();
   });}
   explain(p<.5?'吸气 · 腹壁隆起':'呼气 · 腹壁回落','头部和四肢保持稳定。',skin);
  },{source:source.breath});
}

/* Geometry-based teaching blood flow. Cell sizes and transit times are visual parameters.
 * Routes follow atlas vessel cross-section centers, with a curved route for the aortic arch.
 * Oxygen-poor cells are dark red; the atlas vessel colors remain available for orientation.
 */
function createErythrocyteGeometry(THREE,segments=16,rings=10){
 const geometry=new THREE.SphereGeometry(1,segments,rings),a=geometry.attributes.position;
 // A closed biconcave surface: a thin center and a thicker annular rim on both faces.
 for(let i=0;i<a.count;i++){
  const x=a.getX(i),y=a.getY(i),z=a.getZ(i),rho=Math.min(1,Math.hypot(x,y));
  a.setXYZ(i,x,y,Math.sign(z||1)*Math.sqrt(Math.max(0,1-rho*rho))*(.19+.57*rho*rho));
 }
 geometry.computeVertexNormals();geometry.computeBoundingSphere();geometry.userData.biconcave=true;return geometry;
}
function createBloodFlow(api,field){
 const {THREE,basis,cacheVertices,entries,getState}=api,V=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),flows=new Map(),TAU=Math.PI*2;
 const vessel=e=>/artery|vein|aorta|vena cava|pulmonary trunk|coronary sinus/.test(e.motionName)||/动脉|静脉/.test(e.motionCategory);
 const center=name=>entries.find(e=>e.motionName===name)?.motionCenter;
 function route(e){
  const f=field(e),points=f.points.map(v=>v.clone());
  // A longitudinal slice collapses the two limbs of an arch; angular slices retain the bend.
  if(e.motionName==='arch of aorta'){
   const c=e.motionCenter,lo=e.motionBox.min.z,bins=Array.from({length:40},()=>({sum:V(),n:0}));
   for(const mesh of e.meshes){const a=cacheVertices(mesh).anatomical;
    for(let i=0;i<a.length;i+=3){const theta=Math.atan2(Math.max(0,a[i+2]-lo),a[i]-c.x),k=Math.min(39,Math.floor(theta/Math.PI*40));bins[k].sum.add(V(a[i],a[i+1],a[i+2]));bins[k].n++;}
   }
   const populated=bins.filter(b=>b.n).map(b=>b.sum.multiplyScalar(1/b.n));
   if(populated.length>12){
    const curved=new THREE.CatmullRomCurve3(populated,false,'centripetal');
    for(let i=0;i<40;i++)points[i].copy(curved.getPoint(i/39));
    const upstream=center('ascending aorta');if(upstream&&points[0].distanceToSquared(upstream)>points[39].distanceToSquared(upstream))points.reverse();
   }
  }
  const curve=new THREE.CatmullRomCurve3(points,false,'centripetal');
  // Estimate caliber from distance to the polyline, not the box of a curved vessel.
  const radii=[];
  for(const mesh of e.meshes){const a=cacheVertices(mesh).anatomical,stride=Math.max(1,Math.ceil(a.length/3/3000));
   for(let i=0;i<a.length;i+=stride*3){let nearest=Infinity;
    for(let j=0;j<39;j++){
     const c=points[j],b=points[j+1],dx=b.x-c.x,dy=b.y-c.y,dz=b.z-c.z,px=a[i]-c.x,py=a[i+1]-c.y,pz=a[i+2]-c.z;
     const u=Math.max(0,Math.min(1,(px*dx+py*dy+pz*dz)/(dx*dx+dy*dy+dz*dz||1)));
     nearest=Math.min(nearest,(px-u*dx)**2+(py-u*dy)**2+(pz-u*dz)**2);
    }
    radii.push(Math.sqrt(nearest));
   }
  }
  radii.sort((a,b)=>a-b);
  const radius=Math.max(.00009,(radii[Math.floor(radii.length*.3)]||.0003)*.82),length=curve.getLength();
  return {curve,radius,length,points};
 }
 function bloodDirection(e,r,requested){
  if(e.motionName==='arch of aorta'||e.motionName==='ascending aorta')return 1;
  const pulmonaryVein=/pulmonary vein/.test(e.motionName),venous=/vein|vena cava|coronary sinus/.test(e.motionName)||e.motionCategory==='静脉';
  const heart=center(pulmonaryVein?'left atrium':venous?'right atrium':'left ventricle');
  if(!heart)return requested;
  const startNear=r.points[0].distanceToSquared(heart)<r.points[39].distanceToSquared(heart);
  return venous?(startNear?-1:1):(startNear?1:-1);
 }
 function draw(e,p,{color=0xf17f73,direction=1,opacity=.85}={}){
  if(!vessel(e))return false;
  const s=getState();if(!s.flow||!s.amplitude||p===0)return true;
  let fx=flows.get(e);
  if(!fx){
   const r=route(e),count=Math.max(16,Math.min(72,Math.ceil(r.length/Math.max(r.radius,1e-5)*.75)));
   const geometry=createErythrocyteGeometry(THREE),material=new THREE.MeshStandardMaterial({color:0xc43532,roughness:.42,metalness:0,transparent:true,opacity:.96,depthWrite:false});
   const object=new THREE.InstancedMesh(geometry,material,count);object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);object.frustumCulled=false;
   object.userData.bio2meshFlow=true;object.userData.bio2meshBlood=true;object.renderOrder=100001;e.motion.add(object);
   fx={object,route:r,count,transform:new THREE.Object3D(),point:V(),tangent:V(),u:V(),v:V(),twist:new THREE.Quaternion()};flows.set(e,fx);
  }
  const r=fx.route,o=fx.object,blue=(color&255)>((color>>16)&255),d=bloodDirection(e,r,direction);
  o.visible=true;o.material.color.setHex(blue?0x792635:0xd94035);o.material.opacity=Math.min(1,opacity+.12)*s.amplitude;
  o.material.depthTest=e.meshes.every(m=>m.material.opacity<.9);o.material.clippingPlanes=e.meshes[0]?.material.clippingPlanes||[];
  const beat=p*(s.id==='whole-body-exercise'?8:s.id.startsWith('whole-body-')?5:1);
  // Periodic advection is seamless at the loop boundary. Center lanes pass faster than edge lanes.
  const pulse=.055*Math.sin(TAU*beat),tumble=new THREE.Vector3(1,0,0);
  for(let i=0;i<fx.count;i++){
   const lane=i%3,cycles=4-lane,t=(i/fx.count+p*cycles+pulse)%1,u=d<0?1-t:t;
   r.curve.getPointAt(u,fx.point);r.curve.getTangentAt(u,fx.tangent).normalize();
   fx.u.crossVectors(fx.tangent,Math.abs(fx.tangent.z)>.9?V(0,1,0):V(0,0,1)).normalize();fx.v.crossVectors(fx.tangent,fx.u);
   const angle=i*2.399963+.12*Math.sin(TAU*p),radial=r.radius*(.12+lane*.19);
   fx.point.addScaledVector(fx.u,Math.cos(angle)*radial).addScaledVector(fx.v,Math.sin(angle)*radial);
   fx.transform.position.copy(fx.point).applyMatrix4(basis);
   fx.transform.quaternion.setFromUnitVectors(V(0,0,1),fx.tangent.clone().multiplyScalar(d).transformDirection(basis));
   fx.twist.setFromAxisAngle(tumble,.35*Math.sin(TAU*p+i));fx.transform.quaternion.multiply(fx.twist);
   const size=r.radius*(.27+(i%4)*.018);fx.transform.scale.set(size,size,size);
   fx.transform.updateMatrix();o.setMatrixAt(i,fx.transform.matrix);
  }
  o.instanceMatrix.needsUpdate=true;return true;
 }
 return {draw,resetFrame(){for(const f of flows.values())f.object.visible=false;}};
}
