import {getLanguage,t,translateDOM,setText} from './i18n.js';
import './dental-workspace.css';
let frame=null;
export function closeDental(){if(!frame)return;frame.remove();frame=null;delete document.body.dataset.dental;delete document.body.dataset.dentalMotion;}
export function openDental(mode='anatomy'){
 closeDental();document.getElementById('zoom-factor').textContent='1x';frame=document.createElement('iframe');frame.id='dental-workspace';frame.title=t('口腔与牙齿');frame.src=`./dental/index.html?mode=${encodeURIComponent(mode)}&lang=${encodeURIComponent(getLanguage())}`;document.body.dataset.dental=mode;if(mode!=='anatomy'){document.body.dataset.dentalMotion='true';frame.src+='&embedded=1';document.getElementById('stage').append(frame);}else document.getElementById('workspace').append(frame);
}
export function setupDental({exit,sync}){
 window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow||!event.data?.type)return;if(event.data.type==='bodyvista:dental-zoom'){document.getElementById('zoom-factor').textContent=Number(event.data.zoom.toFixed(2))+'x';return;}if(event.data.type==='bodyvista:dental-state'){updateMotion(event.data);return;}if(event.data.type!=='bodyvista:dental-exit')return;const mode=document.body.dataset.dental;closeDental();exit(mode);});
 document.addEventListener('atlas:language',()=>{frame?.contentWindow?.postMessage({type:'bodyvista:language',lang:getLanguage()},location.origin);if(frame)frame.title=t('口腔与牙齿');});
 document.querySelectorAll('.workspace-tabs button,.atlas-brand,[data-nav="views"],[data-nav="search"]').forEach(b=>b.addEventListener('click',()=>{closeDental();sync();},true));
 const update=()=>document.documentElement.style.setProperty('--dental-header',document.querySelector('.app-header').getBoundingClientRect().bottom+'px');new ResizeObserver(update).observe(document.querySelector('.app-header'));update();
}

const $=id=>document.getElementById(id);
let latest={playing:false,position:0,stage:'infant',ready:false};
export function dentalCommand(command,value){frame?.contentWindow?.postMessage({type:'bodyvista:dental-command',command,value},location.origin);}
function updateMotion(state){
 latest=state;if(!document.body.dataset.dentalMotion)return;
 setText($('motion-play'),state.playing?'❚❚ 暂停':'▶ 播放');$('motion-play').setAttribute('aria-pressed',String(state.playing));
 for(const id of ['motion-play','motion-step','motion-reset','motion-phase'])$(id).disabled=!state.ready;
 $('motion-progress').textContent=Math.round(state.position*100)+'%';
 if(document.activeElement!==$('motion-phase'))$('motion-phase').value=state.position*100;
 for(const input of $('motion-settings').querySelectorAll('input,select'))input.disabled=!state.ready;
 const select=$('dental-development');if(select)select.value=state.stage??'adult';
 const label=document.body.dataset.dental==='jaw'?'开口程度':'发育阶段';
 setText($('motion-phase-label'),label);setText($('motion-phase-detail'),state.error?'加载失败，请重试':state.ready?'':'加载中...');
}
export function setupDentalMotion(mode,template){
 $('motion-panel').outerHTML=template;$('motion-panel').hidden=false;document.querySelector('.motion-shell').hidden=false;
 $('micro-controls').hidden=true;$('vital-signs').hidden=true;$('circulation-guide').hidden=true;
 $('activity-select').value='dental:'+mode;
 setText($('motion-panel').querySelector('h2'),mode==='jaw'?'开合口与咬合':'牙齿发育');
 for(const id of ['motion-vivid','motion-kind'])$(id).hidden=true;
 $('motion-mode').closest('label').hidden=true;
 for(const control of $('motion-settings').querySelector('.motion-settings-body').children)control.hidden=!control.contains($('motion-speed'));
 $('motion-speed').oninput=()=>{const value=Number($('motion-speed').value);$('motion-speed-value').textContent=value.toFixed(2)+'×';dentalCommand('speed',value);};
 setText($('motion-description'),mode==='development'?'教学示意，不能用于判断个体发育年龄。':'开合口与咬合');
 $('motion-reference').hidden=false;setText($('motion-reference'),'内容与模型来源');$('motion-reference').href='./dental/vendor/CREDITS.md';
 $('motion-play').onclick=()=>dentalCommand(latest.playing?'pause':'play');
 $('motion-step').onclick=()=>dentalCommand('step');$('motion-reset').onclick=()=>dentalCommand('reset');
 $('motion-phase').oninput=()=>dentalCommand('seek',Number($('motion-phase').value)/100);
 if(mode==='development'){
  const settings=document.createElement('div');settings.className='motion-settings-body';
  const label=document.createElement('label');label.className='motion-field';label.append(document.createTextNode('发育阶段'));
  const select=document.createElement('select');select.id='dental-development';select.setAttribute('aria-label','发育阶段');
  const stages=['infant','toddler','primary','early-mixed','incisor-transition','late-mixed','permanent','adult'];
  const names=['0.5–1','1–3','3–5','6–7','8–9','10–12','12–14'];
  stages.forEach((stage,i)=>{const o=document.createElement('option');o.value=stage;o.textContent=i===7?'成人':names[i];select.append(o);});
  select.onchange=()=>dentalCommand('stage',select.value);label.append(select);settings.append(label);
  for(const [key,text,checked] of [['unerupted','显示未萌出牙',true],['soft','显示软组织',false]]){const label=document.createElement('label');label.className='motion-context-label';const input=document.createElement('input');input.type='checkbox';input.checked=checked;input.onchange=()=>dentalCommand(key,input.checked);label.append(input,document.createTextNode(text));settings.append(label);}
  $('motion-settings').querySelector('.motion-settings-body').prepend(settings);
 }
 translateDOM($('activity-panel'));updateMotion({playing:false,position:0,stage:'infant',ready:false});
}
// Shared view controls act on the visible dental renderer rather than the hidden body scene.
document.addEventListener('click',event=>{
 if(!document.body.dataset.dentalMotion)return;
 const b=event.target.closest('button');if(!b)return;
 const commands={fit:['view','reset'], 'capture-image':['screenshot'], 'zoom-in':['zoom',.8],'zoom-out':['zoom',1.25]};
 const direction={front:'front',back:'back',left:'left',right:'right',top:'superior',bottom:'inferior'};
 const command=commands[b.id]||(b.dataset.direction?['view',direction[b.dataset.direction]]:null);
 if(command){event.preventDefault();event.stopImmediatePropagation();dentalCommand(...command);}
},true);

document.addEventListener('atlas:dental-zoom',event=>dentalCommand('zoom',event.detail));
