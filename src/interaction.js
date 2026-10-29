import { t, translateDOM, setText } from './i18n.js';

export function setupInteraction({ context, exitMode, togglePlayback, openPlayback }) {
  const $ = id => document.getElementById(id);
  const body = document.body;
  const mobile = matchMedia('(max-width: 760px), (max-width: 900px) and (max-height: 500px)');
  let panelExpanded = false;
  let detailKey = null;
  const toggleNav = open => {
    body.classList.toggle('nav-open',open);
    $('mobile-nav-toggle').setAttribute('aria-expanded',String(open));
  };
  $('mobile-nav-toggle').onclick=()=>toggleNav(!body.classList.contains('nav-open'));
  document.querySelector('.app-header').addEventListener('click',event=>{
    if(event.target.closest('.workspace-tabs button,.atlas-brand,.header-actions button'))toggleNav(false);
  });
  document.addEventListener('pointerdown',event=>{
    if(!event.target.closest('.app-header'))toggleNav(false);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&body.classList.contains('nav-open')){toggleNav(false);$('mobile-nav-toggle').focus();}
  });

  function layers(open) {
    body.classList.toggle('sidebar-collapsed', !open);
    if (open && mobile.matches) $('inspector').hidden = true;
    sync();
  }
  function closePopovers() {
    body.classList.remove('edit-open');
  }
  function sync() {
    const c = context();
    const currentDetail = !$('inspector').hidden && $('inspector').dataset.panel==='knowledge' ? c.detailId || c.micro : null;
    if(currentDetail!==detailKey){panelExpanded=false;detailKey=currentDetail;}
    const detailPanel=$('inspector').dataset.panel==='knowledge';
    const expandLabel=detailPanel?(panelExpanded?'收起详情':'展开详情'):(panelExpanded?'收起面板':'展开面板');
    setText($('resize-panel'),expandLabel);
    $('resize-panel').setAttribute('aria-expanded',String(panelExpanded));
    $('resize-panel').setAttribute('aria-label',t(expandLabel));
    if(!c.selected&&!c.micro&&!$('inspector').hidden&&$('inspector').dataset.panel==='knowledge')$('inspector').hidden=true;
    const overlay = ['gallery', 'quiz'].find(id => !$(id).hidden);
    const mode = c.finding ? 'quiz' : c.micro ? 'micro' : c.motion ? 'motion' : c.tool || (c.slicing ? 'section' : 'explore');
    body.dataset.mode = mode;
    body.dataset.overlay = overlay || '';
    body.dataset.panel = $('inspector').hidden ? '' : $('inspector').dataset.panel;
    $('restore-activity').hidden = body.dataset.activityCollapsed !== 'true' || !$('inspector').hidden || !!overlay;
    $('restore-knowledge').hidden=body.dataset.knowledgeCollapsed!=='true'||!$('inspector').hidden||!!overlay||(!c.selected&&!c.micro)||!!c.motion;
 const activityPanel = $('inspector').dataset.panel === 'activity';
    $('close-inspector').setAttribute('aria-label',t(activityPanel ? '收起动态面板' : '收起结构知识'));
    $('close-inspector').title=t(activityPanel ? '收起动态面板' : '收起结构知识');
    $('close-inspector').textContent='›';
    body.classList.toggle('panel-expanded', panelExpanded);
    body.classList.toggle('has-selection', !!c.selected && !c.micro && !c.motion && !c.finding);
    const open = !body.classList.contains('sidebar-collapsed');
    $('sidebar').inert = !open || !!overlay || ['motion','micro','quiz'].includes(mode);
    $('workspace').inert = !!overlay;
    $('toggle-sidebar').setAttribute('aria-expanded', String(open));
    $('toggle-sidebar').setAttribute('aria-label', open ? '收起系统图层' : '展开系统图层');
    $('mobile-layers').setAttribute('aria-expanded', String(open));
    $('mobile-edit').setAttribute('aria-expanded', String(body.classList.contains('edit-open')));
    const names = {explore:'自由探索', dissect:'解剖模式', multi:'多选模式', draw:'画图模式', measure:'测量模式', section:'剖切模式', motion:'动态演示', micro:'显微结构', quiz:'解剖寻找'};
    const hints = {explore: mobile.matches ? '单指旋转 · 双指缩放 / 平移' : '拖动旋转 · 滚轮缩放 · 右键平移', dissect:'点击隐藏结构 · 可撤销恢复', multi:'点击添加或取消选择', draw:'在模型上拖动画线 · 完成后可旋转', measure:'依次点击模型上的两个位置', section:'拖动滑块观察内部结构', motion:'可暂停观察 · 设置中选择动态', micro:'旋转、缩放观察微观结构', quiz:'点击题目对应的结构'};
    $('mode-name').textContent = names[mode] || '';
    $('mode-hint').textContent = hints[mode] || '';
    $('mode-bar').hidden = mode === 'explore';
    $('exit-mode').hidden = mode === 'explore' || mode === 'quiz';
    $('exit-mode').textContent = ['motion','micro'].includes(mode) ? '返回人体' : '完成';
    $('playback-bar').hidden = true;
    $('selection-options').hidden = mobile.matches || !['explore','multi'].includes(mode) || !!overlay;
    $('annotation-tools').hidden = !['draw','measure'].includes(mode) || !!overlay;
    $('drawing-options').hidden = mode !== 'draw';
    $('measurement-options').hidden = mode !== 'measure';
    $('selection-tray').hidden = ($('inspector').hidden&&mode!=='multi') || !c.selected || ['motion','micro','quiz','draw','measure','dissect'].includes(mode) || (!$('inspector').hidden && $('inspector').dataset.panel !== 'knowledge' && mode !== 'multi');
    $('hide-selected').hidden = mode !== 'multi';
    $('fade-selected').textContent = c.allFaded ? '恢复不透明' : '半透明';
    $('isolate-selected').textContent = c.isolated ? '显示周围结构' : '单独查看';
    const activeWorkspace = c.dental ? (c.dental==='anatomy'?'anatomy':'motion') : overlay === 'quiz' || c.finding ? 'quiz' : c.micro || (overlay === 'gallery' && $('gallery').dataset.browseMode === 'micro') ? 'micro' : c.motion || body.dataset.panel === 'activity' ? 'motion' : 'anatomy';
    const pageName=c.dental ? (c.dental==='anatomy'?'口腔与牙齿':c.dental==='jaw'?'开合口与咬合':'牙齿发育') : overlay==='gallery'&&$('gallery').dataset.browseMode!=='micro'?'查找与浏览':{anatomy:'人体解剖',motion:'生命律动',micro:'微观探索',quiz:'解剖挑战'}[activeWorkspace];
    const pageTitle=t(pageName)+' · BodyVista';
    if(document.title!==pageTitle)document.title=pageTitle;
    for (const name of ['anatomy','motion','micro','quiz']) $(name+'-workspace').setAttribute('aria-selected',String(activeWorkspace === name));
    $('select-tool').setAttribute('aria-pressed',String(!c.tool && !c.slicing));
    const selectionParent = mode === 'multi' ? $('scene-actions') : $('inspector');
    if ($('selection-tray').parentElement !== selectionParent) {
      if (selectionParent === $('inspector')) selectionParent.insertBefore($('selection-tray'),$('knowledge-panel'));
      else selectionParent.append($('selection-tray'));
    }
    syncPlayback();
    translateDOM();
  }
  function syncPlayback() {
    const c = context();
    setText($('quick-play'),c.playing ? '❚❚ 暂停' : '▶ 播放');
    $('quick-play').setAttribute('aria-pressed', String(!!c.playing));
  }
  $('mobile-layers').onclick = () => layers(body.classList.contains('sidebar-collapsed'));
  $('toggle-sidebar').onclick = $('mobile-layers').onclick;
  $('mobile-edit').onclick = () => {
    const open = !body.classList.contains('edit-open');
    closePopovers();
    body.classList.toggle('edit-open', open);
    if (open) { $('inspector').hidden = true; layers(false); }
    sync();
  };
  $('mobile-activity').onclick = () => openPlayback();
  $('select-tool').onclick = exitMode;
  $('exit-mode').onclick = exitMode;
  $('return-body').onclick = exitMode;
  $('close-section').onclick = exitMode;
  $('quick-play').onclick = () => { togglePlayback(); syncPlayback(); };
  $('open-playback').onclick = openPlayback;
  $('resize-panel').onclick = () => {
    panelExpanded = !panelExpanded;
    $('resize-panel').setAttribute('aria-expanded', String(panelExpanded));
    $('resize-panel').setAttribute('aria-label', panelExpanded ? '收起面板' : '展开面板');
    sync();
  };
  document.querySelectorAll('[data-command]').forEach(button => button.onclick = () => {
    closePopovers(); $(button.dataset.command).click();
  });
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#edit-tools,#mobile-edit')) body.classList.remove('edit-open');
  });
  document.addEventListener('click', () => queueMicrotask(sync));
  document.addEventListener('change', () => queueMicrotask(sync));
  const resize = () => { toggleNav(false); panelExpanded = false; layers(!mobile.matches); };
  mobile.addEventListener('change', resize);
  // Only panel visibility is observed; animation text does not trigger a full UI pass.
  const observer = new MutationObserver(() => {
    if (mobile.matches && !$('inspector').hidden) body.classList.add('sidebar-collapsed');
    sync();
  });
  for (const id of ['inspector','gallery','quiz']) observer.observe($(id), {attributes:true,attributeFilter:['hidden','data-panel']});
  resize();
  return {sync, syncPlayback, closePopovers};
}
