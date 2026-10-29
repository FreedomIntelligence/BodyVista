/**
 * Application state (Zustand vanilla store).
 * The engine subscribes with `store.subscribe`; React uses `useApp(selector)`.
 * Keep this plain data — no Three.js objects in here.
 */
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { INITIAL_CATEGORY_STATE, PRESETS, type CategoryState } from '../anatomy/categories';
import type { CategoryId, NumberingSystem } from '../anatomy/types';
import { DEFAULT_LANG, isLang, type Lang } from '../i18n/lang';
import type { NerveSide, NerveView } from '../anatomy/nerveViews';
import { DEVELOPMENT_STAGES, type DevelopmentStageId } from '../anatomy/development';
import { clearSavedQuiz } from '../modes/quiz';
import { adultSceneSnapshot, clearSceneTools, quizSceneSnapshot } from './sceneTransitions';

export type ClipAxis = 'sagittal' | 'coronal' | 'axial' | 'view';
export type ModeId = 'explore' | 'learn' | 'quiz' | 'compare';
/** Camera navigation: fixed turntable around the model centre, or free pivot that follows pan/focus. */
export type OrbitMode = 'fixed' | 'free';
/** Arch dissection phase: 1 = pulled apart in position, 2 = every structure laid out on a board. */
export type ExplodePhase = 1 | 2;
export type ViewPreset =
  | 'three-quarter'
  | 'front'
  | 'back'
  | 'left'
  | 'right'
  | 'superior'
  | 'inferior'
  | 'occlusal-upper'
  | 'occlusal-lower';

export interface ClipState {
  enabled: boolean;
  axis: ClipAxis;
  /** -1…1 across the active bounds */
  offset: number;
  flip: boolean;
}

/** Dissection levels for a single tooth (their names and hints are in the i18n messages, `level`). */
export const DISSECT_LEVELS = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] as const;

export interface AppState {
  studyView: 'vessels' | 'sinuses' | 'nerves' | null;
  vesselSide: 'both' | 'right' | 'left';
  vesselMode: 'both' | 'arteries' | 'veins';
  surfaceFeatures: boolean;
  developmentStage: DevelopmentStageId | null;
  developmentShowUnerupted: boolean;
  developmentSoftTissue: boolean;
  developmentPlaying: boolean;
  nerveView: NerveView;
  nerveSide: NerveSide;
  passageIds: string[];
  jawControls: boolean;
  jawSide: 'right' | 'left';
  jawOpening: number;
  jawPlaying: boolean;
  ready: boolean;
  loading: Record<string, number>; // stage → 0…1
  error?: string;
  selectionRequest: { id: string; kind: 'select' | 'explore'; status: 'loading' | 'error' } | null;

  selectedId: string | null;
  hoveredId: string | null;

  categories: Record<CategoryId, CategoryState>;
  hidden: Record<string, true>;
  ghosted: Record<string, true>;
  isolateId: string | null;
  /** when isolating, show the rest as translucent context */
  isolateContext: boolean;
  ghostOpacity: number;

  explode: number; // 0…1 arch level
  explodePhase: ExplodePhase;
  labels: boolean;
  clip: ClipState;
  numbering: NumberingSystem;
  view: ViewPreset | null;
  autoRotate: boolean;
  orbitMode: OrbitMode;

  dissectFdi: number | null;
  dissectLevel: number;
  toothExplode: number; // 0…1

  mode: ModeId;
  /** Board slot order while Quiz shuffles positions (null outside Quiz / when off); see `src/modes/quiz.ts`. */
  quizBoardOrder: number[] | null;
  /** The "New" pointer to Quiz mode was closed or the quiz was opened (saved per viewer). */
  quizNewSeen: boolean;
  searchOpen: boolean;
  searchQuery: string;
  guideOpen: boolean;
  guideCollapsed: boolean;
  guideRunId: number;
  aboutOpen: boolean;
  controlsOpen: boolean;
  creditsOpen: boolean;
  panel: 'layers' | 'tree';
  mobileSheet: 'none' | 'layers' | 'detail' | 'tools';
  theme: 'light' | 'dark';
  /** interface language */
  lang: Lang;
  /** bumped by resetAll, so UI with its own local state (e.g. the dissect player) can reset too */
  resetId: number;
  /** desktop panels tucked away off-screen (a handle stays visible to bring them back) */
  collapsed: Record<CollapsiblePanel, boolean>;
}

export type CollapsiblePanel = 'layers' | 'detail' | 'dock';

export const initialState: AppState = {
  studyView: null, vesselSide: 'both', vesselMode: 'both',
  surfaceFeatures: false,
  developmentStage: null, developmentShowUnerupted: true, developmentSoftTissue: false, developmentPlaying: false,
  nerveView: 'dental', nerveSide: 'both',
  passageIds: [], jawControls: false, jawSide: 'right', jawOpening: 0, jawPlaying: false,
  ready: false,
  selectionRequest: null,
  loading: {},
  selectedId: null,
  hoveredId: null,
  categories: { ...INITIAL_CATEGORY_STATE },
  hidden: {},
  ghosted: {},
  isolateId: null,
  isolateContext: false,
  ghostOpacity: 0.18,
  explode: 0,
  explodePhase: 1,
  labels: false,
  clip: { enabled: false, axis: 'sagittal', offset: 0, flip: false },
  numbering: 'fdi',
  view: 'front',
  autoRotate: false,
  orbitMode: 'fixed',
  dissectFdi: null,
  dissectLevel: 0,
  toothExplode: 0,
  mode: 'explore',
  quizBoardOrder: null,
  quizNewSeen: false,
  searchOpen: false,
  searchQuery: '',
  guideOpen: false,
  guideCollapsed: false,
  guideRunId: 0,
  aboutOpen: false,
  controlsOpen: false,
  creditsOpen: false,
  panel: 'layers',
  mobileSheet: 'none',
  theme: 'light', // light by default; users can switch to dark (choice is remembered)
  lang: DEFAULT_LANG,
  resetId: 0,
  collapsed: { layers: false, detail: false, dock: false },
};

export const store = createStore<AppState>()(() => ({ ...initialState }));

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(store, selector);
}

export const getState = store.getState;
export const setState = store.setState;

/* ------------------------------------------------------------------ actions */

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** localStorage keys of the per-viewer preferences. */
const PREF = { numbering: 'ds.numbering', theme: 'ds.theme', orbit: 'ds.orbit', lang: 'ds.lang', quizNew: 'ds.quiz.new.seen.v1' } as const;

/** Remember a per-viewer preference (restored by restorePreferences). */
function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** orbit mode to restore when the user leaves a tooth (set when entering one switched it to free) */
let orbitBeforeTooth: OrbitMode | null = null;
let adultSceneBeforeDevelopment: Partial<AppState> | null = null;
/** Explore scene to restore when Quiz mode is left (see `enterQuiz`/`exitQuiz`). */
let quizSceneBefore: Partial<AppState> | null = null;

export const actions = {
  applyStudyPreset(id: string) {
    if (getState().dissectFdi !== null) actions.exitDissect();
    if (getState().developmentStage) actions.setDevelopmentStage(null);
    const preset = PRESETS.find(p => p.id === id);
    if (!preset) return;
    setState(s => ({ ...clearSceneTools(s), categories: { ...s.categories, ...preset.state }, studyView: id === 'vessels' || id === 'sinuses' || id === 'nerves' ? id : null,
      ...(id === 'nerves' ? { nerveView: 'dental', nerveSide: 'both' } : {}),
      vesselSide: 'both', vesselMode: 'both', labels: id === 'vessels' || id === 'sinuses' || id === 'nerves' ? true : s.labels }));
  },
  setVesselSide(vesselSide: AppState['vesselSide']) { setState({ vesselSide, selectedId: null, selectionRequest: null, hoveredId: null, isolateId: null, isolateContext: false }); },
  setVesselMode(vesselMode: AppState['vesselMode']) { setState({ vesselMode, selectedId: null, selectionRequest: null, hoveredId: null, isolateId: null, isolateContext: false }); },
  setSurfaceFeatures(surfaceFeatures: boolean) { setState({ surfaceFeatures }); },
  setDevelopmentStage(developmentStage: DevelopmentStageId | null, playing = false) {
    const previous = getState();
    if (previous.developmentStage === developmentStage) {
      setState({ developmentPlaying: playing && developmentStage !== null });
      return;
    }
    if (getState().dissectFdi !== null) actions.exitDissect();
    if (developmentStage && !previous.developmentStage) {
      const s = getState();
      adultSceneBeforeDevelopment = adultSceneSnapshot(s);
    }
    const restore = developmentStage ? {} : adultSceneBeforeDevelopment ?? {};
    if (!developmentStage) adultSceneBeforeDevelopment = null;
    setState((s) => ({ ...clearSceneTools(s), studyView: null, developmentStage, developmentPlaying: playing && developmentStage !== null, categories: { ...s.categories, 'primary-teeth': 'on', 'permanent-teeth': 'on', 'alveolar-bone': 'on' }, ...restore }));
  },
  playDevelopment() {
    actions.setDevelopmentStage(getState().developmentStage ?? DEVELOPMENT_STAGES[0].id, true);
  },
  pauseDevelopment() { setState({ developmentPlaying: false }); },
  advanceDevelopment() {
    const s = getState();
    if (!s.developmentPlaying || !s.developmentStage) return;
    const index = DEVELOPMENT_STAGES.findIndex((stage) => stage.id === s.developmentStage);
    actions.setDevelopmentStage(DEVELOPMENT_STAGES[index + 1]?.id ?? null, true);
  },
  setDevelopmentSoftTissue(developmentSoftTissue: boolean) { setState({ developmentSoftTissue }); },
  setDevelopmentShowUnerupted(developmentShowUnerupted: boolean) {
    setState({ developmentShowUnerupted, selectedId: null, selectionRequest: null, hoveredId: null, isolateId: null, isolateContext: false });
  },
  setNerveView(nerveView: NerveView) {
    if (getState().dissectFdi !== null) actions.exitDissect();
    setState({ nerveView, passageIds: [], selectedId: null, selectionRequest: null, hoveredId: null, isolateId: null, isolateContext: false });
  },
  setNerveSide(nerveSide: NerveSide) {
    if (getState().dissectFdi !== null) actions.exitDissect();
    setState({ nerveSide, passageIds: [], selectedId: null, selectionRequest: null, hoveredId: null, isolateId: null, isolateContext: false });
  },
  openJawControls(on: boolean) {
    if (on && getState().dissectFdi !== null) actions.exitDissect();
    setState((s) => ({ jawControls: on, jawPlaying: false, jawOpening: on ? s.jawOpening : 0, explode: 0, explodePhase: 1, collapsed: { ...s.collapsed, dock: false }, mobileSheet: on ? 'tools' : s.mobileSheet }));
  },
  setJawOpening(value: number, playing = false) {
    if (getState().dissectFdi !== null) actions.exitDissect();
    setState({ jawOpening: clamp01(value), jawPlaying: playing, jawControls: true, explode: 0, explodePhase: 1, isolateId: null, isolateContext: false, passageIds: [] });
  },
  setCollapsed(panel: CollapsiblePanel, v: boolean) {
    setState((s) => ({ collapsed: { ...s.collapsed, [panel]: v } }));
  },
  /** Back to the start: every scene setting and preference to its default. Theme, language and loading progress are kept. */
  resetAll() {
    orbitBeforeTooth = null;
    adultSceneBeforeDevelopment = null;
    quizSceneBefore = null;
    clearSavedQuiz();
    setState((s) => ({ ...initialState, ready: s.ready, loading: s.loading, error: s.error, theme: s.theme, lang: s.lang, quizNewSeen: s.quizNewSeen, guideRunId: s.guideRunId, resetId: s.resetId + 1 }));
    persist(PREF.numbering, initialState.numbering);
    persist(PREF.orbit, initialState.orbitMode);
  },
  select(id: string | null) {
    setState((s) => ({
      selectedId: id,
      selectionRequest: null,
      // inside Quiz mode the quiz card is the detail view: keep the mobile sheet unchanged
      mobileSheet: id ? (s.mode === 'quiz' ? s.mobileSheet : 'detail') : 'none',
      passageIds: id && s.passageIds.includes(id) ? s.passageIds : [],
    }));
  },
  hover(id: string | null) {
    if (getState().hoveredId !== id) setState({ hoveredId: id });
  },
  setCategory(id: CategoryId, state: CategoryState) {
    setState((s) => ({ categories: { ...s.categories, [id]: state }, passageIds: [] }));
  },
  setCategories(next: Partial<Record<CategoryId, CategoryState>>) {
    setState((s) => ({ categories: { ...s.categories, ...next }, passageIds: [], hidden: {}, ghosted: {}, isolateId: null, isolateContext: false }));
  },
  showOnlyCategory(id: CategoryId) {
    setState((s) => {
      const next = { ...s.categories };
      for (const k of Object.keys(next) as CategoryId[]) next[k] = 'off';
      next[id] = 'on';
      // tooth tissues require the teeth layer
      if (['enamel', 'dentin', 'cementum', 'dental-pulp', 'root-canals', 'periodontal-ligament'].includes(id)) {
        next['permanent-teeth'] = 'on';
        if (id === 'root-canals') next['dental-pulp'] = 'on';
      }
      return { categories: next };
    });
  },
  hide(id: string) {
    setState((s) => {
      const hidden = { ...s.hidden, [id]: true as const };
      return { hidden, selectedId: s.selectedId === id ? null : s.selectedId };
    });
  },
  unhide(id: string) {
    setState((s) => {
      const hidden = { ...s.hidden };
      delete hidden[id];
      return { hidden };
    });
  },
  toggleGhost(id: string) {
    setState((s) => {
      const ghosted = { ...s.ghosted };
      if (ghosted[id]) delete ghosted[id];
      else ghosted[id] = true;
      return { ghosted };
    });
  },
  isolate(id: string | null) {
    setState({ isolateId: id, isolateContext: false });
  },
  setIsolateContext(on: boolean) {
    setState({ isolateContext: on });
  },
  resetVisibility() {
    setState({ studyView: null, vesselSide: 'both', vesselMode: 'both' });
    setState({ hidden: {}, ghosted: {}, isolateId: null, isolateContext: false, passageIds: [], categories: { ...INITIAL_CATEGORY_STATE } });
  },
  setExplode(v: number) {
    const explode = clamp01(v);
    // scrubbing the slider back leaves the laid-out phase
    setState((s) => ({ explode, explodePhase: explode < 1 ? 1 : s.explodePhase, jawOpening: 0, jawPlaying: false, jawControls: false }));
  },
  setExplodePhase(phase: ExplodePhase) {
    setState((s) => (phase === 2 ? { explodePhase: 2, explode: 1, clip: { ...s.clip, enabled: false }, jawOpening: 0, jawPlaying: false, jawControls: false } : { explodePhase: 1 }));
  },
  setToothExplode(v: number) {
    setState({ toothExplode: clamp01(v) });
  },
  toggleLabels() {
    setState((s) => ({ labels: !s.labels }));
  },
  setClip(patch: Partial<ClipState>) {
    // a section plane cuts through the scene in place, so it leaves the laid-out phase
    setState((s) => ({ clip: { ...s.clip, ...patch }, explodePhase: patch.enabled && s.mode !== 'quiz' ? 1 : s.explodePhase }));
  },
  setNumbering(n: NumberingSystem) {
    setState({ numbering: n });
    persist(PREF.numbering, n);
  },
  setView(v: ViewPreset | null) {
    setState({ view: v });
  },
  setAutoRotate(on: boolean) {
    setState({ autoRotate: on });
  },
  setOrbitMode(m: OrbitMode) {
    // a choice made inside a tooth is the user's own: keep it when they leave the tooth
    orbitBeforeTooth = null;
    setState({ orbitMode: m });
    persist(PREF.orbit, m);
  },
  enterDissect(fdi: number) {
    setState({ selectionRequest: null });
    if (getState().developmentStage) actions.setDevelopmentStage(null);
    setState(s => ({ developmentStage: null, studyView: null, jawOpening: 0, jawPlaying: false, jawControls: false, passageIds: [], categories: { ...s.categories, 'permanent-teeth': 'on', enamel: 'on', dentin: 'on', cementum: 'on', 'dental-pulp': 'on', 'root-canals': 'on', 'periodontal-ligament': 'on' } }));
    // Inside a tooth the free orbit is the useful one (pan and focus on a canal or a root);
    // the mouth-level orbit comes back when the tooth is left. Not saved as a preference.
    if (getState().dissectFdi === null && getState().orbitMode !== 'free') orbitBeforeTooth = getState().orbitMode;
    setState({ dissectFdi: fdi, dissectLevel: 0, toothExplode: 0, isolateId: `tooth-${fdi}`, isolateContext: true, explode: 0, explodePhase: 1, orbitMode: 'free' });
  },
  exitDissect() {
    setState({ selectionRequest: null });
    const restore = orbitBeforeTooth;
    orbitBeforeTooth = null;
    if (restore) setState({ orbitMode: restore });
    setState((s) => ({
      dissectFdi: null,
      dissectLevel: 0,
      toothExplode: 0,
      isolateId: s.isolateId?.startsWith('tooth-') ? null : s.isolateId,
      isolateContext: false,
      clip: { ...s.clip, enabled: false },
    }));
  },
  setDissectLevel(level: number) {
    setState({ dissectLevel: Math.max(0, Math.min(DISSECT_LEVELS.length - 1, level)) });
  },
  openSearch(open: boolean) {
    // search reveals names, so it always returns to the explorer
    if (open && getState().mode === 'quiz') actions.exitQuiz();
    setState({ searchOpen: open });
  },
  setSearchQuery(searchQuery: string) { setState({ searchQuery }); },
  startGuide() {
    if (getState().mode === 'quiz') actions.exitQuiz();
    setState((s) => ({ guideOpen: true, guideCollapsed: false, guideRunId: s.guideRunId + 1, labels: true, aboutOpen: false, controlsOpen: false, searchOpen: false }));
  },
  setGuideCollapsed(guideCollapsed: boolean) { setState({ guideCollapsed }); },
  closeGuide() { setState({ guideOpen: false, guideCollapsed: false }); },
  /** A demonstration starts/ends in the adult scene without rewriting viewer preferences. */
  resetGuideScene(labels = false) {
    const orbitMode = orbitBeforeTooth ?? getState().orbitMode;
    orbitBeforeTooth = null;
    adultSceneBeforeDevelopment = null;
    setState(s => ({ ...initialState, ready: s.ready, loading: s.loading, error: s.error, theme: s.theme, lang: s.lang, quizNewSeen: s.quizNewSeen,
      numbering: s.numbering, orbitMode, labels, mode: 'explore', guideOpen: s.guideOpen, guideCollapsed: s.guideCollapsed, guideRunId: s.guideRunId, resetId: s.resetId + 1 }));
  },
  openAbout(open: boolean) {
    setState(open ? { aboutOpen: true, controlsOpen: false } : { aboutOpen: false });
  },
  openControls(open: boolean) {
    setState(open ? { controlsOpen: true, aboutOpen: false } : { controlsOpen: false });
  },
  openCredits(open: boolean) {
    setState(open ? { creditsOpen: true, aboutOpen: false, controlsOpen: false, searchOpen: false, guideOpen: false } : { creditsOpen: false });
  },
  setPanel(p: AppState['panel']) {
    setState({ panel: p });
  },
  setMobileSheet(m: AppState['mobileSheet']) {
    setState({ mobileSheet: m });
  },
  setTheme(t: AppState['theme']) {
    setState({ theme: t });
    persist(PREF.theme, t);
  },
  setLang(l: Lang) {
    setState({ lang: l });
    persist(PREF.lang, l);
  },
  setMode(m: ModeId) {
    setState({ mode: m });
  },
  /** Enter Quiz mode: snapshot the explorer scene, then lay the 32 teeth out on the board. */
  enterQuiz() {
    const s = getState();
    if (s.mode === 'quiz') return;
    if (s.dissectFdi !== null) actions.exitDissect();
    if (s.developmentStage) actions.setDevelopmentStage(null);
    quizSceneBefore = quizSceneSnapshot(s);
    actions.dismissQuizNew();
    setState((st) => ({
      ...clearSceneTools(st),
      mode: 'quiz',
      labels: false,
      explode: 1,
      explodePhase: 2,
      searchOpen: false,
      aboutOpen: false,
      controlsOpen: false,
      creditsOpen: false,
      guideOpen: false,
      guideCollapsed: false,
      mobileSheet: 'none',
    }));
  },
  /** Leave Quiz mode and restore the explorer scene that was active before it. */
  exitQuiz() {
    if (getState().mode !== 'quiz') return;
    const restore = quizSceneBefore ?? {};
    quizSceneBefore = null;
    setState((st) => ({ ...clearSceneTools(st), mode: 'explore', ...restore }));
  },
  setQuizBoardOrder(quizBoardOrder: number[] | null) {
    setState({ quizBoardOrder });
  },
  /** Hide the "New" pointer to Quiz mode for good. */
  dismissQuizNew() {
    if (getState().quizNewSeen) return;
    setState({ quizNewSeen: true });
    persist(PREF.quizNew, 'seen');
  },
  setLoading(stage: string, v: number) {
    setState((s) => ({ loading: { ...s.loading, [stage]: v } }));
  },
};

/** Restore per-viewer preferences. A `?lang=sv` / `?lang=de` link sets (and remembers) the language. */
export function restorePreferences() {
  try {
    const fromUrl = new URLSearchParams(location.search).get('lang');
    if (isLang(fromUrl)) persist(PREF.lang, fromUrl);
    const n = localStorage.getItem(PREF.numbering);
    if (n === 'fdi' || n === 'universal' || n === 'palmer') setState({ numbering: n });
    const t = localStorage.getItem(PREF.theme);
    if (t === 'light' || t === 'dark') setState({ theme: t });
    const o = localStorage.getItem(PREF.orbit);
    if (o === 'fixed' || o === 'free') setState({ orbitMode: o });
    const l = localStorage.getItem(PREF.lang);
    if (isLang(l)) setState({ lang: l });
    if (localStorage.getItem(PREF.quizNew) === 'seen') setState({ quizNewSeen: true });
  } catch {
    /* storage unavailable */
  }
}
