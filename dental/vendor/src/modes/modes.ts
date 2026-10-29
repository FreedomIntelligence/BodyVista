/**
 * Educational modes (docs/architecture.md §10).
 * Explore and Quiz are implemented; Learn and Compare are scaffolded so they
 * can be built without touching the engine or the explorer UI.
 */
import type { Registry } from '../anatomy/registry';
import type { Engine } from '../engine/Engine';
import { registerVisibilityFilter, type VisibilityFilter } from '../state/visibility';
import { actions, setState, type ModeId } from '../state/store';

export interface ModeContext {
  registry: Registry;
  engine: Engine;
}

export interface Mode {
  id: ModeId;
  label: string;
  available: boolean;
  description: string;
  enter?(ctx: ModeContext): void;
  exit?(ctx: ModeContext): void;
  visibilityFilter?: VisibilityFilter;
}

/** Lesson data format for Learn mode. */
export interface LessonStep {
  title: string;
  body: string;
  target?: string; // structure id to select & focus
  view?: string; // camera preset
  categories?: Record<string, 'on' | 'ghost' | 'off'>;
  dissect?: { fdi: number; level: number };
}
export interface Lesson {
  id: string;
  title: string;
  steps: LessonStep[];
}

/** Quiz: pick a structure from a pool; the user must name it. */
export function pickQuizTarget(registry: Registry, pool: (id: string) => boolean, rnd = Math.random): string | null {
  const ids = [...registry.byId.values()].filter((s) => (s.kind === 'mesh' || s.tooth) && pool(s.id)).map((s) => s.id);
  return ids.length ? ids[Math.floor(rnd() * ids.length)] : null;
}

/**
 * Quiz mode shows only the 32 adult tooth shells on the separated board: every
 * other structure is turned off, and internal tooth layers stay hidden by the
 * base resolution. Outside Quiz mode the filter is a no-op, which also makes a
 * leftover registration harmless if the mode is left behind without `exit`.
 */
export function quizVisibilityFilter(registry: Registry): VisibilityFilter {
  return (_meshKey, ownerId, state) =>
    state.mode !== 'quiz' ? 'on' : registry.get(ownerId)?.toothFdi !== undefined ? 'on' : 'off';
}

export const EXPLORE_MODE: Mode = {
  id: 'explore',
  label: 'Explore',
  available: true,
  description: 'Free exploration of the whole dental anatomy.',
};

let quizFilterDispose: (() => void) | null = null;

/** The one Quiz filter for this page load; registering twice is harmless. */
function ensureQuizFilter(registry: Registry) {
  if (!quizFilterDispose) quizFilterDispose = registerVisibilityFilter(quizVisibilityFilter(registry));
}

function clearQuizFilter() {
  quizFilterDispose?.();
  quizFilterDispose = null;
}

export const QUIZ_MODE: Mode = {
  id: 'quiz',
  label: 'Quiz',
  available: true,
  description: 'Identify the 32 permanent teeth on the separated board.',
  enter(ctx) {
    ensureQuizFilter(ctx.registry);
    actions.enterQuiz();
    // Quiz jumps straight to the laid-out board. The explorer's slider
    // preloads the tooth shells first, so fetch any missing ones here and
    // re-frame once the whole set is packed (frameBoard is a no-op outside
    // the board, e.g. if the user already left the mode).
    void ctx.engine.ensureAllTeeth().then(() => ctx.engine.frameBoard()).catch(() => setState({ error: 'load' }));
  },
  exit() {
    clearQuizFilter();
    actions.exitQuiz();
  },
};

export const MODES: Mode[] = [
  EXPLORE_MODE,
  { id: 'learn', label: 'Learn', available: false, description: 'Guided lessons that step through anatomy (coming soon).' },
  QUIZ_MODE,
  { id: 'compare', label: 'Compare', available: false, description: 'Two teeth side by side (coming soon).' },
];

let activeFilterDispose: (() => void) | null = null;

export function switchMode(from: Mode | undefined, to: Mode, ctx: ModeContext) {
  from?.exit?.(ctx);
  activeFilterDispose?.();
  activeFilterDispose = to.visibilityFilter ? registerVisibilityFilter(to.visibilityFilter) : null;
  to.enter?.(ctx);
}
