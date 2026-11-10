import { getLanguage, t } from './i18n.js';

const mode = 'muscle-motion';
const validCase = id => typeof id === 'string' && /^[a-z0-9_]{1,80}$/.test(id);

export function setupMuscleWorkspace({onChange, closeNavigation}) {
  const tab = document.getElementById('muscle-workspace');
  const panel = document.getElementById('muscle-panel');
  const header = tab.closest('header');
  let frame = null;
  let displayedCase = null;

  function syncLanguage() {
    if (!frame) return;
    frame.title = t('肌肉运动');
    // The standalone build can embed the verified player from Pages.
    const origin = frame.contentDocument ? location.origin : 'https://freedomintelligence.github.io';
    frame.contentWindow?.postMessage({type:'bodyvista:language', lang:getLanguage()}, origin);
  }

  function applyLocation() {
    const url = new URL(location.href);
    const open = url.searchParams.get('workspace') === mode;
    const caseParam = url.searchParams.get('case');
    const requestedCase = validCase(caseParam) ? caseParam : null;
    if (open === Boolean(frame) && (!open || requestedCase === displayedCase)) return;
    frame?.remove();
    frame = null;
    displayedCase = requestedCase;
    panel.hidden = !open;
    document.body.toggleAttribute('data-muscle-workspace', open);
    if (open) {
      const src = new URL('./experiments/body-lab/player.html', location.href);
      src.searchParams.set('lang', getLanguage());
      if (requestedCase) src.searchParams.set('case', requestedCase);
      const demo = url.searchParams.get('demo');
      if (demo) src.searchParams.set('demo', demo);
      frame = document.createElement('iframe');
      frame.title = t('肌肉运动');
      frame.addEventListener('load', ({currentTarget}) => {
        currentTarget.contentDocument?.addEventListener('pointerdown', closeNavigation, {capture:true});
        syncLanguage();
      });
      frame.src = src.href;
      panel.append(frame);
      tab.setAttribute('aria-current', 'page');
    } else {
      tab.removeAttribute('aria-current');
    }
    onChange(open);
  }

  function openWorkspace(event) {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    if (frame) return;
    const selected = header.querySelector('.workspace-tabs button[aria-selected=true]');
    // Existing atlas tabs share a URL. Remember the visible tab for Back.
    history.replaceState({...history.state, atlasTab: selected?.id}, '');
    const url = new URL(location.href);
    url.searchParams.set('workspace', mode);
    history.pushState(null, '', url);
    applyLocation();
    if (event.detail === 0) panel.focus({preventScroll:true});
  }

  tab.addEventListener('click', openWorkspace);
  header.addEventListener('click', event => {
    const next = event.target.closest('.workspace-tabs button, .atlas-brand');
    if (!next) return;
    const state = {...history.state, atlasTab: next.id || 'anatomy-workspace'};
    if (!frame) {
      if (history.state?.atlasTab) history.replaceState(state, '');
      return;
    }
    const url = new URL(location.href);
    url.searchParams.delete('workspace');
    url.searchParams.delete('case');
    url.searchParams.delete('demo');
    history.pushState(state, '', url);
    applyLocation(); // The clicked control then runs its original atlas action.
  }, true);
  window.addEventListener('popstate', () => {
    const wasOpen = Boolean(frame);
    applyLocation();
    if (!wasOpen || frame) return;
    const saved = history.state?.atlasTab || 'anatomy-workspace';
    const previous = [...header.querySelectorAll('.workspace-tabs button')].find(button => button.id === saved);
    if (previous && previous.getAttribute('aria-selected') !== 'true') previous.click();
  });
  window.addEventListener('message', event => {
    if (!frame || event.source !== frame.contentWindow) return;
    if (event.data?.type === 'bodyvista:language-ready' &&
        (event.origin === location.origin || event.origin === 'https://freedomintelligence.github.io')) {
      syncLanguage();
      return;
    }
    if (event.origin !== location.origin || event.data?.type !== 'bodyvista:muscle-case' ||
        (event.data.id !== null && !validCase(event.data.id))) return;
    displayedCase = event.data.id;
    const url = new URL(location.href);
    if (url.searchParams.get('case') === displayedCase) return;
    if (displayedCase === null) url.searchParams.delete('case');
    else url.searchParams.set('case', displayedCase);
    history.replaceState(history.state, '', url);
  });
  document.addEventListener('atlas:language', syncLanguage);
  applyLocation();
}
