/**
 * Deep links (docs/architecture.md §4):
 *   /tooth/36            select & focus tooth 36 (FDI)
 *   /tooth/36/dissect    open the dissection of tooth 36
 *   /structure/<id>      select & focus any structure
 *   /credits/            open the credits popup over the explorer
 */
import type { Registry } from '../anatomy/registry';
import type { Structure } from '../anatomy/types';
import type { Engine } from '../engine/Engine';
import { actions, getState, store } from '../state/store';
import { documentTitle } from './seo';
import type { Lang } from '../i18n';
import { creditsPath } from './credits';

/** Tool name stays the same in every interface language. */
export function localTitle(sel: (Pick<Structure, 'name' | 'tooth'> & { names?: Partial<Record<Lang, string>> }) | undefined, _lang: Lang): string {
  return documentTitle(sel);
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
/**
 * With a relative base (e.g. `DS_BASE=./` for static hosting in an unknown
 * sub-folder) path URLs would break relative asset loading, so routes live in
 * the hash instead: `#/tooth/36`.
 */
const HASH = import.meta.env.BASE_URL.startsWith('.');

function currentPath(): string {
  return HASH ? location.hash.replace(/^#/, '') || '/' : location.pathname;
}

/** `VITE_DS_URL=off` disables URL updates (for embedding in hosts that own the URL). */
const WRITE_URL = import.meta.env.VITE_DS_URL !== 'off';

function writeUrl(path: string, push: boolean) {
  if (!WRITE_URL) return;
  const url = HASH ? `#${path.replace(/^\.?/, '')}` : path + location.search;
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}

export interface Route {
  id: string | null;
  dissect: boolean;
  credits?: boolean;
  lang?: Lang;
}

export function parsePath(path: string, registry: Registry): Route {
  const p = !HASH && path.startsWith(BASE) ? path.slice(BASE.length) : path;
  const credits = /^\/credits(?:\/(sv|de|es|la))?\/?$/.exec(p);
  if (credits) return { id: null, dissect: false, credits: true, lang: credits[1] as Lang | undefined };
  let m = /^\/tooth\/(\d{2})(\/dissect)?\/?$/.exec(p);
  if (m && registry.get(`tooth-${m[1]}`)) return { id: `tooth-${m[1]}`, dissect: !!m[2] };
  m = /^\/structure\/([a-z0-9-]+)\/?$/.exec(p);
  if (m && registry.get(m[1])) return { id: m[1], dissect: false };
  return { id: null, dissect: false };
}

/**
 * The address for the current scene. Quiz mode keeps the bare site address: a
 * picked tooth's URL (`/tooth/36/`) would reveal its number before it is submitted.
 */
function scenePath(s: { mode: string; selectedId: string | null; dissectFdi: number | null }, registry: Registry): string {
  return s.mode === 'quiz' ? pathFor(null, null, registry) : pathFor(s.selectedId, s.dissectFdi, registry);
}

export function pathFor(id: string | null, dissectFdi: number | null, registry: Registry): string {
  const base = HASH ? '' : BASE;
  if (!id && dissectFdi === null) return `${base}/`;
  if (!id && dissectFdi !== null) return `${base}/tooth/${dissectFdi}/dissect`;
  const s = registry.get(id!);
  // trailing slash matches the static tooth pages (tooth/36/index.html) and their canonical URLs
  if (s?.tooth) return `${base}/tooth/${s.tooth.fdi}${dissectFdi === s.tooth.fdi ? '/dissect' : '/'}`;
  return `${base}/structure/${id}`;
}

export function startRouter(engine: Engine, registry: Registry): () => void {
  let applying = false;
  let navigating = false;
  let revision = 0;

  const runNavigation = async (command: NavigationCommand) => {
    const push = !getState().guideOpen;
    const request = ++revision;
    applying = false;
    navigating = true;
    try { await command(); }
    finally {
      if (request === revision) {
        navigating = false;
        const s = getState();
        const next = s.creditsOpen ? `${HASH ? '' : BASE}/${creditsPath(s.lang)}` : scenePath(s, registry);
        if (next !== currentPath()) writeUrl(next, push);
      }
    }
  };
  navigationHandler = runNavigation;

  const apply = async (path: string) => {
    const request = ++revision;
    navigating = false;
    engine.cancelSelection();
    const r = parsePath(path, registry);
    applying = true;
    try {
      // Back/Forward leaves the quiz: a history entry would otherwise select a tooth by number
      if (getState().mode === 'quiz') actions.exitQuiz();
      if (r.credits) {
        if (r.lang) actions.setLang(r.lang);
        actions.openCredits(true);
        return;
      }
      actions.openCredits(false);
      if (!r.id) {
        if (getState().dissectFdi !== null) actions.exitDissect();
        actions.select(null);
        return;
      }
      const s = registry.get(r.id)!;
      if (r.dissect && s.tooth) {
        actions.select(r.id);
        await engine.exploreTooth(s.tooth.fdi);
      } else await engine.selectFromUI(r.id, { focus: true });
    } finally {
      if (request === revision) applying = false;
    }
  };

  const syncTitle = (id: string | null) => {
    document.title = localTitle(id ? registry.get(id) : undefined, getState().lang);
  };
  syncTitle(getState().selectedId);
  const unsub = store.subscribe((s, p) => {
    if (s.selectedId !== p.selectedId || s.lang !== p.lang) syncTitle(s.selectedId);
    if (applying || navigating) return;
    if (s.creditsOpen) {
      if (!p.creditsOpen || s.lang !== p.lang) writeUrl(`${HASH ? '' : BASE}/${creditsPath(s.lang)}`, !p.creditsOpen);
      return;
    }
    if (p.creditsOpen) {
      writeUrl(scenePath(s, registry), false);
      return;
    }
    if (s.selectedId === p.selectedId && s.dissectFdi === p.dissectFdi && s.mode === p.mode) return;
    const next = scenePath(s, registry);
    if (next !== currentPath()) writeUrl(next, false);
  });
  const onPop = () => void apply(currentPath());
  window.addEventListener('popstate', onPop);
  if (HASH) window.addEventListener('hashchange', onPop);
  void apply(currentPath());
  return () => {
    ++revision;
    if (navigationHandler === runNavigation) navigationHandler = undefined;
    unsub();
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('hashchange', onPop);
  };
}

type NavigationCommand = () => void | Promise<void>;
let navigationHandler: ((command: NavigationCommand) => Promise<void>) | undefined;

/** One explicit user action creates one history entry, after the scene commits. */
export async function navigate(command: NavigationCommand) {
  if (navigationHandler) await navigationHandler(command);
  else await command();
}
