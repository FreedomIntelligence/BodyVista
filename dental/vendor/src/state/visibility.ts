/**
 * Pure visibility resolution: (registry, state, loaded teeth) → per-mesh visual.
 * One function decides visibility so modes/timeline/procedures can plug in
 * extra filters without touching UI code (see docs/architecture.md §5).
 */
import type { Registry } from '../anatomy/registry';
import type { CategoryState } from '../anatomy/categories';
import type { AppState } from './store';
import { nerveInView, nerveViewFor } from '../anatomy/nerveViews';
import { developmentStatus } from '../anatomy/development';

/**
 * 'faint' is a quieter ghost used for surrounding context. 'see-through' is bone with the
 * nerve and vessel layers on: clearly visible, but open enough to show what runs inside it.
 */
export type MeshVisual = 'on' | 'see-through' | 'ghost' | 'faint' | 'off';

const RANK: Record<MeshVisual, number> = { off: 0, faint: 1, ghost: 2, 'see-through': 3, on: 4 };

const BONE = new Set(['maxilla', 'mandible', 'alveolar-bone']);
const NEUROVASCULAR = ['nerves', 'arteries', 'veins'] as const;

/**
 * Bone turns see-through whenever a nerve or vessel layer is fully on (the paths run inside it),
 * and the maxilla also while a maxillary sinus is selected (the sinus lies inside it).
 */
function boneSeeThrough(cats: readonly string[], state: AppState, registry: Registry): boolean {
  // not while sectioning (the cut shows solid bone) or on the laid-out board (nothing runs inside it there)
  const selected = state.selectedId ? registry.get(state.selectedId) : undefined;
  if (!state.clip.enabled && state.explodePhase !== 2 && selected?.categories.includes('sinus') && cats.includes('skull')) return true;
  if (state.clip.enabled || state.explodePhase === 2 || !cats.some((c) => BONE.has(c))) return false;
  if (NEUROVASCULAR.some((c) => state.categories[c] === 'on')) return true;
  return !!selected?.categories.includes('sinus') && cats.includes('maxilla');
}
const minVis = (a: MeshVisual, b: MeshVisual): MeshVisual => (RANK[a] <= RANK[b] ? a : b);

export type VisibilityFilter = (meshKey: string, ownerId: string, state: AppState) => MeshVisual;
const extraFilters: VisibilityFilter[] = [];

/** Register an additional filter (e.g. a mode or a future eruption timeline). */
export function registerVisibilityFilter(f: VisibilityFilter): () => void {
  extraFilters.push(f);
  return () => {
    const i = extraFilters.indexOf(f);
    if (i >= 0) extraFilters.splice(i, 1);
  };
}

/** Which tissue a tooth-layer mesh key represents, e.g. "dentin-coronal-36" → "dentin-coronal". */
export function layerKind(meshKey: string): string {
  return meshKey.replace(/-\d{2}$/, '').replace(/^canal-.*/, 'canal');
}

/** Per dissection level, how tooth layers differ from fully shown ('on'). */
const DISSECT_RULES: Record<number, Partial<Record<string, MeshVisual>>> = {
  0: { pdl: 'off' },
  1: { pdl: 'ghost' },
  2: { enamel: 'off', pdl: 'off', cementum: 'ghost' },
  3: { enamel: 'off', pdl: 'off', cementum: 'off', 'dentin-coronal': 'ghost', 'dentin-radicular': 'ghost' },
  // root canals: the pulp chamber and canals on their own, dentin removed
  4: { enamel: 'off', pdl: 'off', cementum: 'off', 'dentin-coronal': 'off', 'dentin-radicular': 'off' },
};

/** Per dissection level, how each tooth layer is shown. */
export function dissectRule(level: number, kind: string): MeshVisual {
  return DISSECT_RULES[level]?.[kind] ?? 'on';
}

export interface VisibilityContext {
  registry: Registry;
  state: AppState;
  loadedTeeth: Set<number>;
}

/** Are the internal layers of this tooth what should be displayed (instead of its outer shell)? */
export function layersActive(fdi: number, ctx: VisibilityContext): boolean {
  const { state, loadedTeeth } = ctx;
  if (!loadedTeeth.has(fdi)) return false;
  if (state.dissectFdi === fdi) return true;
  // Quiz keeps the board whole: only the tooth being inspected swaps its shell for its tissues
  if (state.mode === 'quiz') return state.clip.enabled && state.selectedId === `tooth-${fdi}`;
  return state.dissectFdi === null && state.clip.enabled;
}

export function resolveMesh(meshKey: string, ctx: VisibilityContext): MeshVisual {
  const { registry, state } = ctx;
  const ownerId = registry.meshOwner.get(meshKey);
  if (!ownerId) return 'off';
  const owner = registry.require(ownerId);
  const developmental = ownerId.startsWith('development-');
  if (developmental !== (state.developmentStage !== null)) return 'off';
  if (owner.development && state.developmentStage) {
    const status = developmentStatus(owner.development, state.developmentStage);
    if (status === 'absent' || status === 'unerupted' && !state.developmentShowUnerupted) return 'off';
  }
  if (state.passageIds.length && owner.categories.includes('nerves') && !state.passageIds.some((id) => registry.isDescendant(ownerId, id))) return 'off';
  if (!state.passageIds.length && owner.categories.includes('nerves') && !nerveInView(registry, ownerId, state.nerveView, state.nerveSide)) return 'off';

  if (state.studyView === 'vessels' && owner.categories.some(c => c === 'arteries' || c === 'veins')) {
    if (state.vesselSide !== 'both' && !ownerId.endsWith(`-${state.vesselSide}`)) return 'off';
    if (state.vesselMode !== 'both' && !owner.categories.includes(state.vesselMode)) return 'off';
  }

  let v: MeshVisual = 'on';

  // categories: every category the mesh belongs to must allow it
  for (const c of registry.categoriesOfMesh(meshKey)) {
    const cs: CategoryState = state.categories[c] ?? 'on';
    v = minVis(v, cs);
  }
  if (developmental && !owner.development) v = minVis(v, 'ghost');

  // Solid in the assembled skull; translucent context once the arches separate.
  // Ghosted skull and muscles stay out of the laid-out board and fade away there.
  if (owner.categories.some((c) => c === 'muscles' || c === 'skull') && (state.explode > 0 || state.explodePhase === 2)) v = minVis(v, 'ghost');

  if (owner.toothFdi === undefined && boneSeeThrough(registry.categoriesOfMesh(meshKey), state, registry)) v = minVis(v, 'see-through');

  // explicit hide / ghost on the structure or any ancestor
  const chain = [owner, ...registry.ancestors(ownerId)];
  for (const s of chain) {
    if (state.hidden[s.id]) return 'off';
    if (state.ghosted[s.id]) v = minVis(v, 'ghost');
  }

  // tooth shell vs internal layers
  const fdi = owner.toothFdi;
  if (fdi !== undefined) {
    const active = layersActive(fdi, ctx);
    const isShell = meshKey === `tooth-${fdi}`;
    if (isShell && active) return 'off';
    if (!isShell) {
      if (!active) return 'off';
      if (state.dissectFdi === fdi) {
        const rule = dissectRule(state.dissectLevel, layerKind(meshKey));
        // with a section active every remaining tissue is opaque, so the cut shows all layers
        v = minVis(v, state.clip.enabled && rule === 'ghost' ? 'on' : rule);
      }
      else if (layerKind(meshKey) === 'pdl') return 'off';
    }
  }

  // isolation
  if (state.isolateId) {
    const inside = registry.isDescendant(ownerId, state.isolateId) || regionContains(registry, state.isolateId, meshKey);
    if (!inside) {
      if (!state.isolateContext) return 'off';
      if (state.dissectFdi !== null) {
        // tooth view: only the neighbouring teeth of the same quadrant and the tooth-bearing bone, very faint
        const q = Math.floor(state.dissectFdi / 10);
        const upper = q <= 2;
        if (fdi !== undefined) return Math.floor(fdi / 10) === q ? minVis(v, 'faint') : 'off';
        const alveolar = upper ? meshKey.startsWith('maxillary-alveolar-process') : meshKey === 'mandibular-alveolar-process';
        return alveolar ? minVis(v, 'faint') : 'off';
      }
      v = minVis(v, 'ghost');
    }
  }

  for (const f of extraFilters) {
    v = minVis(v, f(meshKey, ownerId, state));
    if (v === 'off') return v;
  }
  return v;
}

function regionContains(registry: Registry, id: string, meshKey: string): boolean {
  const s = registry.get(id);
  return !!s && s.kind === 'region' && s.meshes.includes(meshKey);
}

/** Make a structure reachable: unhide it and its ancestors, enable its categories, relax isolation. */
export function revealPatch(registry: Registry, id: string, state: AppState): Partial<AppState> {
  const hidden = { ...state.hidden };
  const chain = [id, ...registry.ancestors(id).map((a) => a.id)];
  for (const c of chain) delete hidden[c];
  const categories = { ...state.categories };
  const meshes = registry.meshesOf(id);
  const s = registry.get(id);
  const cats = new Set(s?.categories ?? []);
  for (const m of meshes) for (const c of registry.categoriesOfMesh(m)) cats.add(c);
  for (const c of cats) if (categories[c] === 'off') categories[c] = 'on';
  const patch: Partial<AppState> = { hidden, categories };
  if (state.studyView === 'vessels' && s?.categories.some(c => c === 'arteries' || c === 'veins')) {
    const side = /-(right|left)$/.exec(id)?.[1] as AppState['vesselSide'] | undefined;
    if (side && state.vesselSide !== 'both' && state.vesselSide !== side) patch.vesselSide = side;
    if (!side) patch.vesselSide = 'both';
    if (state.vesselMode !== 'both' && !s.categories.includes(state.vesselMode)) patch.vesselMode = 'both';
  }
  if (s?.categories.includes('nerves')) {
    if (!nerveInView(registry, id, state.nerveView, 'both') || /^trigeminal-nerve-(right|left)$/.test(id)) patch.nerveView = nerveViewFor(registry, id);
    const side = /-(right|left)$/.exec(id)?.[1] as 'right' | 'left' | undefined;
    if (side && state.nerveSide !== 'both' && state.nerveSide !== side) patch.nerveSide = side;
    if (!side) patch.nerveSide = 'both';
  }
  if (state.isolateId && !registry.isDescendant(id, state.isolateId)) {
    patch.isolateId = null;
    patch.isolateContext = false;
  }
  return patch;
}
