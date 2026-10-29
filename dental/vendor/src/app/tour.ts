/** Script data and playback are independent of React and the anatomy engine. */
export interface TourStep {
  id: string;
  target?: string;
  action?: 'click' | 'search' | 'finish';
  value?: string;
  panel?: 'tools' | 'detail' | 'layers';
  /** Use the existing detail-sheet size control when demonstrating text on phones. */
  detailExpanded?: boolean;
  hold: number;
  /** Existing, sourced educational content accompanies these steps. */
  development?: 'primary' | 'early-mixed';
  waitFor?: { selectedId?: string; dissectFdi?: number; asset?: string; explode?: number; surfaceFeatures?: boolean };
}

export const FIRST_VISIT_TOOTH = 36;
export const FIRST_VISIT_TOUR: readonly TourStep[] = [
  { id: 'welcome', hold: 1800 },
  { id: 'open-skull', target: 'dissect-anatomy-play', action: 'click', panel: 'tools', waitFor: { explode: 1 }, hold: 3500 },
  { id: 'opening-teeth', target: 'preset-dentition', action: 'click', panel: 'layers', hold: 2400 },
  { id: 'primary', target: 'development-primary', action: 'click', panel: 'tools', development: 'primary', hold: 3200 },
  { id: 'mixed', target: 'development-early-mixed', action: 'click', panel: 'tools', development: 'early-mixed', hold: 3200 },
  { id: 'adult', target: 'development-adult', action: 'click', panel: 'tools', hold: 1000 },
  { id: 'teeth', target: 'preset-dentition', action: 'click', panel: 'layers', hold: 1000 },
  { id: 'search', target: 'search', action: 'click', hold: 1200 },
  { id: 'query', target: 'search-input', action: 'search', value: `fdi ${FIRST_VISIT_TOOTH}`, hold: 1100 },
  { id: 'tooth', target: `result-tooth-${FIRST_VISIT_TOOTH}`, action: 'click', waitFor: { selectedId: `tooth-${FIRST_VISIT_TOOTH}` }, hold: 2000 },
  { id: 'details', target: 'tooth-details', panel: 'detail', detailExpanded: true, hold: 2800 },
  { id: 'surfaces', target: 'surface-features-toggle', action: 'click', panel: 'detail', detailExpanded: false, waitFor: { dissectFdi: FIRST_VISIT_TOOTH, surfaceFeatures: true }, hold: 3500 },
  { id: 'surface-feature', target: `surface-central-groove-${FIRST_VISIT_TOOTH}`, action: 'click', panel: 'detail', waitFor: { selectedId: `surface-central-groove-${FIRST_VISIT_TOOTH}` }, hold: 2400 },
  { id: 'surface-description', target: 'tooth-details', panel: 'detail', detailExpanded: true, hold: 3500 },
  { id: 'surface-angle', target: 'surface-view-facial', action: 'click', panel: 'detail', detailExpanded: false, hold: 2400 },
  { id: 'surface-top', target: 'surface-view-occlusal', action: 'click', panel: 'detail', hold: 2400 },
  { id: 'surface-hide', target: 'surface-features-toggle', action: 'click', panel: 'detail', waitFor: { surfaceFeatures: false }, hold: 1000 },
  { id: 'surface-tooth', target: 'surface-parent-tooth', action: 'click', panel: 'detail', waitFor: { selectedId: `tooth-${FIRST_VISIT_TOOTH}` }, hold: 1000 },
  { id: 'inside', target: 'explore-inside', action: 'click', waitFor: { dissectFdi: FIRST_VISIT_TOOTH }, panel: 'detail', hold: 1600 },
  { id: 'dentin', target: 'dissect-2', action: 'click', panel: 'tools', hold: 2000 },
  { id: 'canals', target: 'dissect-4', action: 'click', panel: 'tools', hold: 2400 },
  { id: 'assembled', target: 'dissect-0', action: 'click', panel: 'tools', hold: 1000 },
  { id: 'layers', target: 'separate-layers', action: 'click', panel: 'tools', hold: 2400 },
  { id: 'mouth', target: 'back-mouth', action: 'click', panel: 'tools', hold: 1000 },
  { id: 'nerves', target: 'preset-nerves', action: 'click', waitFor: { asset: 'neurovascular' }, panel: 'layers', hold: 5500 },
  { id: 'ready', action: 'finish', hold: 0 },
];

export interface TourPlayback {
  paused: () => boolean;
  speed?: () => number;
  showStep: (step: TourStep, index: number) => void;
  prepare: (step: TourStep) => void;
  locate: (target: string) => boolean;
  point: (target: string, clicking: boolean) => void;
  activate: (step: TourStep) => void;
  settled: (step: TourStep) => boolean;
  clearPointer: () => void;
}

/** Abortable timers, including paused time, prevent a closed tour from clicking later. */
export function tourDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)));
    const abort = () => { clearTimeout(timer); reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export async function playTour(steps: readonly TourStep[], port: TourPlayback, signal: AbortSignal, reducedMotion = false, startIndex?: number) {
  const wait = async (ms: number, scaled = true, ignorePause = false) => {
    let remaining = ms;
    // Always pass through the gate, even for a zero-duration action.
    do {
      while (!ignorePause && port.paused()) await tourDelay(80, signal);
      const rate = scaled ? (port.speed?.() ?? 1) : 1;
      const slice = Math.min(80, remaining / rate);
      await tourDelay(slice, signal);
      signal.throwIfAborted();
      if (ignorePause || !port.paused()) remaining -= slice * rate;
    } while (remaining > 0 || (!ignorePause && port.paused()));
    signal.throwIfAborted();
  };
  const until = async (check: () => boolean, ignorePause: boolean) => {
    let elapsed = 0;
    while (!check()) {
      if (elapsed >= 15000) throw new Error('Tour target unavailable');
      // Loading and layout get the same real-time budget at every playback speed.
      await wait(80, false, ignorePause);
      elapsed += 80;
    }
    await wait(0, false, ignorePause);
  };
  for (const [index, step] of steps.entries()) {
    const rebuilding = index < (startIndex ?? 0);
    // A jump works while paused, then preserves the pause at the requested step.
    const seeking = startIndex !== undefined && index <= startIndex;
    await wait(0, false, seeking);
    port.clearPointer();
    if (!rebuilding) port.showStep(step, index);
    port.prepare(step);
    if (step.target) {
      await until(() => port.locate(step.target!), seeking);
      if (!rebuilding) {
        port.point(step.target, false);
        await wait(reducedMotion ? 100 : 450, true, seeking);
      }
      if (step.action && !rebuilding) {
        // Re-measure after layout/viewport changes; never click a stale target.
        await until(() => port.locate(step.target!), seeking);
        port.point(step.target, true);
        await wait(reducedMotion ? 100 : 150, true, seeking);
      }
    }
    if (step.action) port.activate(step);
    await until(() => port.settled(step), seeking);
    // Rebuild through the same controls, without narrating the preceding steps.
    if (!rebuilding) await wait(step.hold);
  }
  port.clearPointer();
}

export const GUIDE_VISIT_KEY = 'ds.guide.seen.v1';
type VisitStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function needsFirstVisitGuide(storage: VisitStorage): boolean {
  try { return storage.getItem(GUIDE_VISIT_KEY) !== 'seen'; } catch { return true; }
}
export function rememberGuideVisit(storage: VisitStorage) {
  try { storage.setItem(GUIDE_VISIT_KEY, 'seen'); } catch { /* Session still works without storage. */ }
}
