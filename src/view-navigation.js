import {rotateView} from './upright-controls.js';
import * as THREE from './vendor/three.js';
import { t, translateDOM } from './i18n.js';

// One camera identity keeps animation controllers, picking and export in sync.
export class AtlasCamera extends THREE.PerspectiveCamera {
  updateProjectionMatrix() {
    if (!this.isOrthographicCamera) return super.updateProjectionMatrix();
    const distance = Math.max(.01, this.position.distanceTo(this.orbitTarget));
    const half = distance * Math.tan(this.fov * Math.PI / 360);
    this.left = -half * this.aspect; this.right = half * this.aspect;
    this.top = half; this.bottom = -half;
    THREE.OrthographicCamera.prototype.updateProjectionMatrix.call(this);
  }
  resetZoomReference() {
    this.normalizeZoom();
    this.zoomReference = this.position.distanceTo(this.orbitTarget);
  }
  get magnification() {
    return (this.zoomReference ?? this.position.distanceTo(this.orbitTarget)) * this.zoom / Math.max(.000001, this.position.distanceTo(this.orbitTarget));
  }
  normalizeZoom() {
    if(this.isOrthographicCamera && this.zoom!==1) {
      this.position.sub(this.orbitTarget).divideScalar(this.zoom).add(this.orbitTarget);
      this.zoom=1;
    }
    this.updateProjectionMatrix();
  }
  setProjection(orthographic) {
    this.isOrthographicCamera = orthographic;
    this.isPerspectiveCamera = !orthographic;
    this.updateProjectionMatrix();
  }
}

export function setupViewNavigation({ camera, controls, stage, togglePan, beginChange, finishChange }) {
  const root = document.getElementById('view-navigation');
  const sphere = document.getElementById('view-gizmo');
  const toggle = document.getElementById('toggle-view-navigation');
  const mobile = matchMedia('(max-width:760px), (max-width:900px) and (max-height:500px)');
  function showNavigation(open) {
    root.hidden=mobile.matches&&!open;
    toggle.setAttribute('aria-expanded',String(open));
  }
  toggle.onclick=()=>{
    const open=toggle.getAttribute('aria-expanded')!=='true';
    if(open) {document.body.classList.remove('edit-open');document.getElementById('mobile-edit').setAttribute('aria-expanded','false');}
    showNavigation(open);
  };
  document.getElementById('mobile-edit').addEventListener('click',()=>{if(mobile.matches)showNavigation(false);});
  mobile.addEventListener('change',()=>showNavigation(false));
  showNavigation(false);
  const projection = document.getElementById('projection-toggle');
  const vectors = {front:[0,-1,0],back:[0,1,0],left:[1,0,0],right:[-1,0,0],top:[0,0,1],bottom:[0,0,-1]};
  const names = {front:'前面',back:'后面',left:'左侧',right:'右侧',top:'上方',bottom:'下方'};
  const axisButtons = [...sphere.querySelectorAll('[data-direction]')];
  let gesture = null;
  function settle() {
    const damping=controls.enableDamping;
    controls.enableDamping=false;controls.update();controls.enableDamping=damping;
  }
  function normalizeZoom() { camera.normalizeZoom(); }
  function orient(key) {
    beginChange();settle();normalizeZoom();
    const direction=camera.position.clone().sub(controls.target).normalize();
    if(direction.dot(new THREE.Vector3(...vectors[key]))>.999)key={front:'back',back:'front',left:'right',right:'left',top:'bottom',bottom:'top'}[key];
    const distance=camera.position.distanceTo(controls.target);
    camera.up.set(0,0,1);
    camera.position.copy(controls.target).add(new THREE.Vector3(...vectors[key]).multiplyScalar(distance));
    controls.update();finishChange();
  }
  for(const button of axisButtons) button.onclick=e=>{if(e.detail===0)orient(button.dataset.direction);};
  projection.onclick=()=>{
    beginChange();settle();normalizeZoom();camera.setProjection(!camera.isOrthographicCamera);finishChange();refresh();
  };
  const zoomPad=document.getElementById('zoom-pad');
  function togglePad() {
    zoomPad.hidden=!zoomPad.hidden;
    document.getElementById('zoom-view').setAttribute('aria-expanded',String(!zoomPad.hidden));
  }
  root.querySelectorAll('[data-zoom]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.zoom).click());
  function closeZoom() {zoomPad.hidden=true;document.getElementById('zoom-view').setAttribute('aria-expanded','false');}
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#zoom-pad,#zoom-view'))closeZoom();});
  root.addEventListener('keydown',e=>{if(e.key==='Escape')closeZoom();});
  document.getElementById('pan-view').onclick=()=>{closeZoom();togglePan();};
  document.getElementById('zoom-view').onclick=e=>{if(e.detail===0)togglePad();};
  function bindDrag(element,kind) {
    element.addEventListener('pointerdown',e=>{
      if(e.button!==0 || gesture)return;
      settle();normalizeZoom();beginChange();
      const offset=camera.position.clone().sub(controls.target);
      gesture={id:e.pointerId,x:e.clientX,y:e.clientY,kind,offset,up:camera.up.clone(),target:controls.target.clone(),position:camera.position.clone(),moved:false,button:e.target.closest('[data-direction]')};
      if(gesture.button)delete gesture.button.dataset.dragged;
      element.setPointerCapture(e.pointerId);controls.enabled=false;e.preventDefault();
    });
    element.addEventListener('pointermove',e=>{
      if(!gesture||e.pointerId!==gesture.id)return;
      const g=gesture,dx=e.clientX-g.x,dy=e.clientY-g.y;
      if(Math.hypot(dx,dy)<3&&!g.moved)return;
      if(kind==='zoom'&&document.body.dataset.dentalMotion){
        document.dispatchEvent(new CustomEvent('atlas:dental-zoom',{detail:Math.exp((dy-(g.lastDy??0))*.012)}));
        g.lastDy=dy;g.moved=true;return;
      }
      g.moved=true;if(g.button)g.button.dataset.dragged='true';
      const radius=g.offset.length();
      if(kind==='rotate') {
        camera.position.copy(g.position);camera.up.copy(g.up);
        rotateView(camera,g.target,dx*.012,dy*.012);
      } else if(kind==='pan') {
        const scale=2*radius*Math.tan(camera.fov*Math.PI/360)/Math.max(1,stage.clientHeight);
        const delta=new THREE.Vector3(-dx*scale,dy*scale,0).applyQuaternion(camera.quaternion);
        camera.position.copy(g.position).add(delta);controls.target.copy(g.target).add(delta);
      } else {
        const distance=THREE.MathUtils.clamp(radius*Math.exp(dy*.012),controls.minDistance,controls.maxDistance);
        camera.position.copy(g.target).add(g.offset.clone().normalize().multiplyScalar(distance));
      }
      controls.update();normalizeZoom();
    });
    const end=e=>{if(!gesture||gesture.id!==e.pointerId)return;const g=gesture;gesture=null;controls.enabled=true;finishChange();if(!g.moved&&e.type==='pointerup'){if(g.button)orient(g.button.dataset.direction);else if(kind!=='rotate')togglePad(kind);}};
    element.addEventListener('pointerup',end);element.addEventListener('pointercancel',end);
    element.addEventListener('lostpointercapture',end);
  }
  bindDrag(sphere,'rotate');bindDrag(document.getElementById('zoom-view'),'zoom');
  // Keyboard alternatives to drag controls.
  for(const [id,kind] of [['pan-view','pan'],['zoom-view','zoom']])document.getElementById(id).addEventListener('keydown',e=>{
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','-'].includes(e.key))return;
    e.preventDefault();
    if(kind==='zoom'&&document.body.dataset.dentalMotion){document.dispatchEvent(new CustomEvent('atlas:dental-zoom',{detail:['ArrowUp','+'].includes(e.key)?.85:1/.85}));return;}
    beginChange();settle();normalizeZoom();
    if(kind==='pan'){
      const d=camera.position.distanceTo(controls.target)*.04;
      const delta=new THREE.Vector3(e.key==='ArrowLeft'?d:e.key==='ArrowRight'?-d:0,e.key==='ArrowUp'?d:e.key==='ArrowDown'?-d:0,0).applyQuaternion(camera.quaternion);
      camera.position.add(delta);controls.target.add(delta);
    }else camera.position.sub(controls.target).multiplyScalar(['ArrowUp','+'].includes(e.key)?.85:1/.85).clampLength(controls.minDistance,controls.maxDistance).add(controls.target);
    controls.update();finishChange();
  });
  function refresh() {
    projection.setAttribute('aria-pressed',String(!!camera.isOrthographicCamera));
    projection.setAttribute('aria-label',t(camera.isOrthographicCamera?'切换为透视视图':'切换为正交视图'));
    projection.title=t(camera.isOrthographicCamera?'切换为透视视图':'切换为正交视图');
    projection.querySelector('span').textContent=t(camera.isOrthographicCamera?'正交':'透视');
    for(const button of axisButtons)button.title=t(names[button.dataset.direction]);
  }
  let previousProjection;
  function update() {
    normalizeZoom();
    const label=Number(camera.magnification.toFixed(2))+'x';
    const output=document.getElementById('zoom-factor');
    if(output.textContent!==label)output.textContent=label;
    const inverse=camera.quaternion.clone().invert();
    for(const button of axisButtons) {
      const key=button.dataset.direction,v=new THREE.Vector3(...vectors[key]).applyQuaternion(inverse);
      const x=50+v.x*34,y=50-v.y*34;
      button.style.left=x+'%';button.style.top=y+'%';button.style.zIndex=String(Math.round((v.z+1)*10)+1);
      button.classList.toggle('far',v.z<-.1);
      const line=sphere.querySelector('[data-axis="'+key+'"]');line.setAttribute('x2',String(x));line.setAttribute('y2',String(y));
    }
    if(previousProjection!==camera.isOrthographicCamera){previousProjection=camera.isOrthographicCamera;refresh();}
  }
  document.addEventListener('atlas:language',()=>{translateDOM(root);refresh();});
  refresh();return {update};
}
