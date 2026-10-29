import './style.css';
import {Registry} from './vendor/src/anatomy/registry';
import {loadManifest} from './vendor/src/engine/assets';
import {Engine} from './vendor/src/engine/Engine';
import {actions,getState,setState,store} from './vendor/src/state/store';
import {DEVELOPMENT_STAGES} from './vendor/src/anatomy/development';
import {translate,toothName} from './strings.js';
import {structureChatGPTLink,structureDeepSeekLink} from '../src/chatgpt-link.js';
const $=(id:string)=>document.getElementById(id)!;
const params=new URLSearchParams(location.search);
let lang=['zh-CN','en','ja'].includes(params.get('lang')!)?params.get('lang')!:'zh-CN';
let mode=['jaw','development'].includes(params.get('mode')!)?params.get('mode')!:'anatomy';
const embedded=params.get('embedded')==='1'&&parent!==window;
if(embedded)document.body.classList.add('embedded-motion');
let engine:Engine,registry:Registry,selected=11,busy=false,ready=false,progress=0;
const tr=(s:string)=>translate(s,lang);
const labels=['完整牙齿','牙周组织','牙本质','牙髓','根管'];
const explanations=['牙齿由外部硬组织包围内部牙髓；切换层次可以观察不同组织之间的关系。','牙周组织围绕牙根，连接并支持牙齿。','牙本质位于牙釉质和牙骨质内侧，包围牙髓腔。','牙髓位于牙齿内部，包含血管、神经和结缔组织。','根管是牙根内牙髓腔的延续，向根尖方向延伸。'];
function button(text:string,fn:()=>unknown){const b=document.createElement('button');b.textContent=tr(text);b.onclick=()=>void run(fn);return b;}
function section(title:string){const s=document.createElement('section'),h=document.createElement('h2');h.textContent=tr(title);s.append(h);$('panel').append(s);return s;}
function range(parent:HTMLElement,title:string,value:number,max:number,fn:(value:number)=>void,id:string,step='0.01'){
 const label=document.createElement('label');label.textContent=tr(title);const input=document.createElement('input');input.type='range';input.min='0';input.max=String(max);input.step=step;input.value=String(value);input.id=id;input.setAttribute('aria-label',tr(title));input.oninput=()=>fn(+input.value);label.append(input);parent.append(label);return input;
}
function select(parent:HTMLElement,title:string,options:string[][],value:string,fn:(value:string)=>void,id:string){
 const label=document.createElement('label');label.textContent=tr(title);const input=document.createElement('select');input.id=id;input.setAttribute('aria-label',tr(title));for(const [v,name] of options){const o=document.createElement('option');o.value=v;o.textContent=tr(name);input.append(o);}input.value=value;input.onchange=()=>void run(()=>fn(input.value));label.append(input);parent.append(label);return input;
}
function check(parent:HTMLElement,title:string,checked:boolean,fn:(value:boolean)=>void){const label=document.createElement('label'),i=document.createElement('input');i.type='checkbox';i.checked=checked;i.onchange=()=>fn(i.checked);label.append(i,document.createTextNode(tr(title)));parent.append(label);}
async function run(fn:()=>unknown){if(busy)return;busy=true;sync();$('status').textContent=tr('加载中...');try{await fn();if(getState().selectionRequest?.status==='error')throw Error('selection');$('status').replaceChildren();}catch(e){console.error(e);$('status').replaceChildren(document.createTextNode(tr('加载失败，请重试')),button('重试',fn));}finally{busy=false;sync();}}
function render(){
 document.documentElement.lang=lang;$('stage').querySelector('canvas')?.setAttribute('aria-label',tr('口腔与牙齿'));document.body.dataset.mode=mode;const title=mode==='jaw'?'开合口与咬合':mode==='development'?'牙齿发育':'口腔与牙齿';$('title').textContent=tr(title);document.title=tr(title)+' · BodyVista';$('back').textContent='‹ '+tr(mode==='anatomy'?'返回头部':'返回生命律动');$('toggle').textContent=tr('控制面板');
 $('panel').replaceChildren();$('view-tools').replaceChildren();
 for(const [label,view] of [['正面','front'],['侧面','right'],['咬合面','superior']]){const b=button(label,()=>engine.setView(view as any));b.dataset.view=view;$('view-tools').append(b);}
 $('view-tools').append(button('复位',()=>engine.resetCamera()),button('截图',()=>{const a=document.createElement('a');a.download='bodyvista-'+Date.now()+'.png';a.href=engine.captureImage();a.click();}));
 const s=getState();
 if(mode==='anatomy'){
 const arch=section('选择牙齿');
 for(const [label,quadrants] of [['上颌',[1,2]],['下颌',[4,3]]] as const){const title=document.createElement('small');title.textContent=tr(label);arch.append(title);for(const q of quadrants){const row=document.createElement('div');row.className='tooth-row';const order=q===1||q===4?[8,7,6,5,4,3,2,1]:[1,2,3,4,5,6,7,8];for(const n of order){const fdi=q*10+n,b=button(String(fdi),async()=>{selected=fdi;if(getState().dissectFdi!==null)await engine.exploreTooth(fdi);else await engine.selectFromUI('tooth-'+fdi,{focus:true});render();});b.dataset.fdi=String(fdi);b.title=toothName(fdi,lang);b.setAttribute('aria-label',b.title+' · '+fdi);row.append(b);}arch.append(row);}}
 const info=section('牙列'),name=document.createElement('h2');name.id='selected-name';name.textContent=toothName(selected,lang)+' · '+selected;info.append(name);
 const group=document.createElement('div');group.className='actions';group.append(button(s.dissectFdi===null?'单独查看':'完整牙列',async()=>{if(getState().dissectFdi===null)await engine.exploreTooth(selected);else {actions.exitDissect();actions.select(null);engine.resetCamera();}render();}));info.append(group);
 if(s.dissectFdi!==null)select(info,'牙齿层次',labels.map((v,i)=>[String(i),v]),String(s.dissectLevel),v=>{actions.setDissectLevel(+v);sync();},'layers');
 else range(info,'牙弓分离',s.explode,1,v=>actions.setExplode(v),'explode');
 const p=document.createElement('p');p.id='explanation';info.append(p);
 const links=document.createElement('div');links.className='actions';for(const [label,url] of [['问 ChatGPT',structureChatGPTLink],['问 DeepSeek',structureDeepSeekLink]] as const){const a=document.createElement('a');a.textContent=tr(label);a.target='_blank';a.rel='noopener noreferrer';a.href=url(toothName(selected,lang),lang);links.append(a);}info.append(links);
 const clip=section('剖切');select(clip,'剖切',[['off','关闭'],['sagittal','矢状面'],['coronal','冠状面'],['axial','横切面']],s.clip.enabled?s.clip.axis:'off',v=>{actions.setClip({enabled:v!=='off',...(v!=='off'?{axis:v as any}:{}),offset:0});if(v!=='off')engine.setView(({sagittal:'right',coronal:'front',axial:'superior'} as any)[v]);sync();},'clip');range(clip,'切面位置',s.clip.offset+1,2,v=>actions.setClip({offset:v-1}),'clip-position');
 }else if(mode==='jaw'){
 const sectionEl=section('开合口与咬合');const b=button('播放',()=>getState().jawPlaying?engine.pauseJaw():engine.playJaw());b.id='play';sectionEl.append(b);range(sectionEl,'开口程度',s.jawOpening,1,v=>actions.setJawOpening(v),'jaw');
 }else{
 const sectionEl=section('牙齿发育');const b=button('播放',()=>getState().developmentPlaying?actions.pauseDevelopment():actions.playDevelopment());b.id='play';sectionEl.append(b);
 select(sectionEl,'发育阶段',[...DEVELOPMENT_STAGES.map(s=>[s.id,s.years+(lang==='en'?' years':lang==='ja'?' 歳':' 岁')]),['adult','成人']],s.developmentStage??'adult',v=>actions.setDevelopmentStage(v==='adult'?null:v as any),'development');
 check(sectionEl,'显示未萌出牙',s.developmentShowUnerupted,actions.setDevelopmentShowUnerupted);check(sectionEl,'显示软组织',s.developmentSoftTissue,actions.setDevelopmentSoftTissue);const p=document.createElement('p');p.textContent=tr('教学示意，不能用于判断个体发育年龄。');sectionEl.append(p);
 }
 const credits=document.createElement('details');credits.className='attribution';const summary=document.createElement('summary');summary.textContent=tr('内容与模型来源');credits.append(summary);const note=document.createElement('p');note.textContent=tr('模型与内容经过适配；教学内容待专业审核。');credits.append(note);
 for(const [title,href] of [['Dental Scope · MIT','./vendor/LICENSE'],['BodyParts3D · CC BY-SA 2.1 JP / CC BY-SA 4.0','./vendor/CREDITS.md'],[tr('牙齿资料'),'https://www.aapd.org/globalassets/media/policies_guidelines/r_dentalgrowth25.pdf']]){const a=document.createElement('a');a.textContent=title;a.href=href;a.target='_blank';a.rel='noopener noreferrer';credits.append(a,document.createElement('br'));}$('panel').append(credits);sync();
}
function sync(){if(!engine)return;notifyHost();document.querySelectorAll<HTMLInputElement>('#panel button,#panel input,#panel select,#view-tools button').forEach(control=>control.disabled=busy);const s=getState();document.querySelectorAll('[data-fdi]').forEach(b=>b.setAttribute('aria-pressed',String((b as HTMLElement).dataset.fdi===String(selected))));const p=$('explanation');if(p)p.textContent=tr(explanations[s.dissectFdi===null?0:s.dissectLevel]);const slider=$('clip-position') as HTMLInputElement;if(slider)slider.disabled=busy||!s.clip.enabled;const play=$('play');if(play)play.textContent=tr((mode==='jaw'?s.jawPlaying:s.developmentPlaying)?'暂停':'播放');const development=$('development') as HTMLSelectElement;if(development)development.value=s.developmentStage??'adult';}
$('back').onclick=()=>{if(parent===window){location.href='../index.html';return;}parent.postMessage({type:'bodyvista:dental-exit',mode},location.origin);};
$('toggle').onclick=()=>{document.body.classList.toggle('panel-hidden');$('toggle').setAttribute('aria-expanded',String(!document.body.classList.contains('panel-hidden')));};
window.addEventListener('message',e=>{if(e.source!==parent||e.origin!==location.origin)return;if(e.data?.type==='bodyvista:dental-command'&&ready){handleCommand(e.data.command,e.data.value);return;}if(e.data?.type==='bodyvista:language'&&['zh-CN','en','ja'].includes(e.data.lang)){lang=e.data.lang;render();}});
async function boot(){engine?.dispose();registry=new Registry(await loadManifest());engine=new Engine(registry);engine.interactiveSelection=!embedded;engine.mount($('stage'));$('stage').querySelector('canvas')?.setAttribute('aria-label',tr('口腔与牙齿'));render();await engine.loadAll();if(getState().error)throw Error('models');
 if(mode==='jaw'){await engine.showJaw();actions.applyStudyPreset('dentition');actions.setCategories({...getState().categories,mandible:'on',maxilla:'ghost',tmj:'on',skull:'ghost',muscles:'off'});setState({labels:false,hidden:{},ghosted:{},selectedId:null});actions.openJawControls(true);engine.resetCamera();engine.setView('right');engine.playJaw();}
 else if(mode==='development'){actions.setDevelopmentStage('infant',true);}
 else {actions.applyStudyPreset('dentition');setState({labels:false});actions.select('tooth-11');engine.resetCamera();}
 if(embedded)actions.setOrbitMode('free');
 store.subscribe((s,previous)=>{const structure=s.selectedId&&registry.get(s.selectedId);const fdi=structure&&(structure.toothFdi??structure.tooth?.fdi);if(mode==='anatomy'&&fdi&&fdi!==selected){selected=fdi;render();}else if(s.dissectFdi!==previous.dissectFdi)render();else sync();});
 engine.subscribeDevelopmentProgress(v=>{if(mode==='development'){progress=v/7;notifyHost();}});
 engine.subscribeJawProgress(v=>{if(mode==='jaw'){progress=v;notifyHost();}const slider=$('jaw') as HTMLInputElement;if(slider&&document.activeElement!==slider)slider.value=String(v);});ready=true;if(embedded)setupZoomReadout();render();notifyHost();$('stage').querySelector('canvas')?.setAttribute('aria-label',tr('口腔与牙齿'));}
let zoomReference=0,zoomLocked=false;
function setupZoomReadout(){
 const controls=engine.rig.controls,camera=engine.rig.camera;
 const distance=()=>camera.position.distanceTo(controls.target)/camera.zoom;
 const update=()=>{
  if(!zoomLocked||!zoomReference)zoomReference=distance();
  parent.postMessage({type:'bodyvista:dental-zoom',zoom:zoomReference/Math.max(.000001,distance())},location.origin);
 };
 controls.addEventListener('start',()=>{if(!zoomLocked)zoomReference=distance();zoomLocked=true;});
 controls.addEventListener('change',update);update();
}
function notifyHost(){if(!embedded)return;const s=getState();parent.postMessage({type:'bodyvista:dental-state',ready:ready&&!busy,error:s.error,playing:mode==='jaw'?s.jawPlaying:s.developmentPlaying,position:Math.max(0,Math.min(1,progress)),stage:s.developmentStage},location.origin);}
function handleCommand(command:string,value:any){
 const s=getState();
 const seek=(v:number)=>{progress=Math.max(0,Math.min(1,v));if(mode==='jaw')actions.setJawOpening(progress);else actions.setDevelopmentStage(DEVELOPMENT_STAGES[Math.round(progress*7)]?.id??null);};
 if(command==='play'){if(mode==='jaw')engine.playJaw();else actions.playDevelopment();}
 else if(command==='pause'){if(mode==='jaw')engine.pauseJaw();else actions.pauseDevelopment();}
 else if(command==='reset'){zoomLocked=false;seek(0);engine.resetCamera();}
 else if(command==='step')seek(mode==='jaw'?progress+.025:Math.min(1,(Math.floor(progress*7)+1)/7));
 else if(command==='seek')seek(Number(value));
 else if(command==='stage')actions.setDevelopmentStage(value==='adult'?null:value);
 else if(command==='unerupted')actions.setDevelopmentShowUnerupted(!!value);
 else if(command==='soft')actions.setDevelopmentSoftTissue(!!value);
 else if(command==='view'){zoomLocked=false;if(value==='reset')engine.resetCamera();else engine.setView(value);}
 else if(command==='speed')engine.playbackSpeed=Math.max(.25,Math.min(2,Number(value)));
 else if(command==='zoom'){if(!zoomLocked)zoomReference=engine.rig.camera.position.distanceTo(engine.rig.controls.target)/engine.rig.camera.zoom;zoomLocked=true;engine.zoom(Number(value));}
 else if(command==='screenshot'){const a=document.createElement('a');a.download='bodyvista-'+Date.now()+'.png';a.href=engine.captureImage();a.click();}
 sync();
}
void run(boot);
