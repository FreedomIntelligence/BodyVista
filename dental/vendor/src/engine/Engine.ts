/**
 * The imperative 3D engine. Owns Three.js; subscribes to the app store;
 * never triggers React renders per frame. See docs/architecture.md §6.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import type { Registry } from '../anatomy/registry';
import type { Structure } from '../anatomy/types';
import { formatTooth } from '../anatomy/notation';
import { nameOf, shortOf } from '../i18n';
import { store, getState, setState, actions, DISSECT_LEVELS, type AppState, type ViewPreset } from '../state/store';
import { levelShowing, levelShows } from '../state/dissectLevels';
import { resolveMesh, revealPatch, layersActive, type MeshVisual } from '../state/visibility';
import { Animator } from './animator';
import { AssetLoader } from './assets';
import { CameraRig, PRESET_DIRS } from './camera';
import { archOffset, isNeurovascular, neurovascularStretch, pulpLayerOffset, toothLayerOffset } from './explode';
import { boardAssemblyKey, boardSlot, archOrder, shuffledRanks, shelfLayout, type LayoutItem } from './layout';
import { computeLabelPoint } from './labelPoint';
import { LabelLayer, type LabelCandidate } from './labels';
import { HIGHLIGHT, THEME_LIGHTING, highlightColor, themedColor, applyThemeToMaterial, createTissueMaterial, setFibreAxis, setMaterialOpacity, styleKeyFor, type SceneTheme, type TissueMaterial } from './materials';
import { isSolid, quietLevel, quietOpacity } from './recede';
import { SectionTool } from './section';
import { colorToothShell, shadeEnamelCrevices } from './toothShading';
import { jawDeformation, jawMatrix, rigidJawPart } from './jawMotion';
import { landmarkHost, passageFor } from '../anatomy/passages';
import { PRESETS } from '../anatomy/categories';
import { SurfaceFeatureLayer } from './SurfaceFeatureLayer';
import { DevelopmentScene } from './DevelopmentScene';
import { developmentNotation } from '../anatomy/development';
import { isCompactLayout } from '../app/viewport';
import { renderPixelRatio } from './renderQuality';
import { resolveContent } from '../content/content';
import { SINUS_NOTE } from '../i18n/study';
import { dentitionFrame, skullOverviewFrame } from './framing';
import { navigate } from '../app/router';

interface MeshEntry {
  key: string;
  owner: string;
  mesh: THREE.Mesh<THREE.BufferGeometry, TissueMaterial>;
  archOffset: THREE.Vector3;
  toothOffset: THREE.Vector3;
  /** tooth offset on the Root canals level (pulp only) */
  pulpOffset: THREE.Vector3;
  visual: MeshVisual;
  opacity: number; // animated
  hi: number; // animated highlight
  hiTarget: number;
  hover: boolean;
  labelPoint?: THREE.Vector3; // geometry-space label anchor
  labelVertex?: number; // nearest vertex supplies the anchor's morph displacement
  /** tooth shells beside a shown gum: how the root is cut while it is in the gum (see refreshRootCuts) */
  rootCut?: { extract: number; collar: number };
  /**
   * Nerve or vessel. `quiet` is how far it has receded into the pale background (0 = full,
   * 1 = quiet): vessels while the jaws are dissected, regional trunks always (see quietTarget).
   */
  nv?: boolean;
  /** trunk outside the dental region (Structure.regional) */
  regional?: boolean;
  /** dental nerve: never recedes */
  nerve?: boolean;
  /** maxillary sinus: an air space, always drawn translucent */
  sinus?: boolean;
  quiet?: number;
  /** phase-2 board slot (world offset) and the eased current offset */
  boardTarget?: THREE.Vector3;
  boardPos?: THREE.Vector3;
}

/** Loading stages in order (their UI names live in Overlays' STAGE_LABEL). */
const STAGES = [
  { id: 'core', file: 'core.glb' },
  { id: 'context', file: 'context.glb' },
  { id: 'neurovascular', file: 'neurovascular.glb' },
] as const;

const EXEMPLAR_TOOTH = 36;

/** Phase-2 board: gap between laid-out parts (cm) and framing margins (height, width). */
const BOARD_GAP = 0.35;
const BOARD_MARGIN = { h: 1.5, w: 1.45 };

export class Engine {
  readonly registry: Registry;
  playbackSpeed = 1;
  interactiveSelection = true;
  readonly scene = new THREE.Scene();
  readonly animator = new Animator();
  readonly section = new SectionTool();
  renderer!: THREE.WebGLRenderer;
  rig!: CameraRig;
  labels!: LabelLayer;

  private container!: HTMLElement;
  private overlay!: HTMLElement;
  private tip!: HTMLElement;
  private entries = new Map<string, MeshEntry>();
  private loader = new AssetLoader();
  private loadedTeeth = new Set<number>();
  private toothLoads = new Map<number, Promise<void>>();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private pointerPx = { x: 0, y: 0 };
  private pointerDirty = false;
  private pointerInside = false;
  private tipKey = '';
  private down: { x: number; y: number; t: number } | null = null;
  private needsRender = true;
  private visualsMoving = true;
  private lastT = performance.now();
  private raf = 0;
  private unsub: (() => void)[] = [];
  private explodeCur = 0;
  private bvhQueue: THREE.BufferGeometry[] = [];
  private bvhScheduled = false;
  private toothExplodeCur = 0;
  /** 0…1 blend from the normal layer separation to the pulp-only one (Root canals level) */
  private pulpModeCur = 0;
  private readonly tmpOffset = new THREE.Vector3();
  /** 0…1 blend from the in-position explode (phase 1) to the laid-out board (phase 2) */
  private phaseCur = 0;
  private boardTimer = 0;
  private boardAspect = 1;
  private explodeTimer = 0;
  private preparingArch = false;
  private cancelArchPreparation?: () => void;
  private explodePreset?: ViewPreset;
  /** canvas area covered by panels (px), animated; shifts the optical centre */
  private insets = { right: 0, bottom: 0, left: 0, top: 0 };
  /** where the insets are animating to (the start framing fits into this) */
  private insetTarget = { right: 0, bottom: 0, left: 0, top: 0 };
  private insetsKnown = false;
  private marker: THREE.Mesh;
  private toothLight = new THREE.DirectionalLight('#ffffff', 2.4);
  private studyLightOffset = new THREE.Vector3();
  private overviewLights = new THREE.Group();
  private root = new THREE.Group();
  private developmentScene: DevelopmentScene;
  private surfaceLayer: SurfaceFeatureLayer;
  private sceneBounds = new THREE.Box3();
  /** everything in the manifest (the whole skull), for the start framing */
  private skullBounds = new THREE.Box3();
  private resizeObs?: ResizeObserver;
  private environmentTarget?: THREE.WebGLRenderTarget;
  private disposed = false;
  private jawCur = 0;
  private clipJaw = 0;
  private jawDirection = 1;
  private jawProgressListeners = new Set<(opening: number) => void>();
  private developmentProgressListeners = new Set<(position: number) => void>();
  private developmentProgress = -1;
  private jawProgressTime = 0;

  constructor(registry: Registry) {
    this.registry = registry;
    this.surfaceLayer = new SurfaceFeatureLayer(registry.manifest);
    this.scene.add(this.surfaceLayer.root, this.toothLight, this.toothLight.target);
    this.developmentScene = new DevelopmentScene(registry);
    this.scene.add(this.developmentScene.root);
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: HIGHLIGHT, depthTest: false, transparent: true, opacity: 0.95 }),
    );
    this.marker.renderOrder = 1000;
    this.marker.visible = false;
    const key = new THREE.DirectionalLight('#fff7ec', 1.35);
    key.position.set(4, 8, 7);
    const fill = new THREE.DirectionalLight('#dfe9ff', 0.4);
    fill.position.set(-6, 2, 4);
    const rim = new THREE.DirectionalLight('#ffffff', 0.45);
    rim.position.set(0, 3, -8);
    this.overviewLights.add(new THREE.HemisphereLight('#ffffff', '#8b8478', 0.4), key, fill, rim);
    this.scene.add(this.overviewLights);
    this.scene.add(this.root, this.marker, this.section.outline);
    const [lo, hi] = registry.manifest.bounds;
    this.sceneBounds.set(new THREE.Vector3(...lo).min(new THREE.Vector3(...hi)), new THREE.Vector3(...lo).max(new THREE.Vector3(...hi)));
    this.skullBounds.copy(this.sceneBounds);
    for (const m of Object.values(registry.manifest.meshes)) {
      if (m.bounds) this.skullBounds.expandByPoint(new THREE.Vector3(...m.bounds[0])).expandByPoint(new THREE.Vector3(...m.bounds[1]));
    }
  }

  /* ================================================================ setup */

  mount(container: HTMLElement) {
    this.disposed = false;
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    const mobile = matchMedia('(pointer: coarse)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.5 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'ds-canvas';
    renderer.domElement.setAttribute('aria-label', '3D view of dental anatomy. Drag to orbit, scroll to zoom, click a structure to inspect it.');
    renderer.domElement.setAttribute('role', 'img');
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.overlay = document.createElement('div');
    this.overlay.className = 'ds-overlay';
    container.appendChild(this.overlay);
    this.tip = document.createElement('div');
    this.tipKey = '';
    this.tip.className = 'ds-tip';
    this.tip.id = 'ds-hover-info';
    this.tip.setAttribute('role', 'tooltip');
    this.tip.setAttribute('aria-hidden', 'true');
    this.overlay.appendChild(this.tip);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = new RoomEnvironment();
    this.environmentTarget = pmrem.fromScene(environment, 0.04);
    this.scene.environment = this.environmentTarget.texture;
    environment.dispose();
    pmrem.dispose();
    this.applyTheme(getState().theme);

    const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 200);
    this.rig = new CameraRig(camera, renderer.domElement, this.animator);
    this.rig.setMode(getState().orbitMode);
    this.rig.onUserInteract = () => {
      this.cancelArchPreparation?.();
      if (getState().view) setState({ view: null });
    };
    this.rig.controls.addEventListener('change', () => this.invalidate());
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    // ?motion=reduce forces reduced motion (useful for screenshots and slow devices)
    this.animator.reducedMotion = reduce.matches || new URLSearchParams(location.search).get('motion') === 'reduce';
    const motionChange = (e: MediaQueryListEvent) => { this.animator.reducedMotion = e.matches; this.invalidate(); };
    reduce.addEventListener('change', motionChange);
    this.unsub.push(() => reduce.removeEventListener('change', motionChange));

    // initial framing: the whole skull, straight on (see startView)
    const sphere = this.sceneBounds.getBoundingSphere(new THREE.Sphere());
    this.rig.home = { target: sphere.center.clone().add(new THREE.Vector3(0, -0.15, -0.2)), radius: sphere.radius * 1.28 };
    this.updatePivot();
    this.resize();
    this.startView(0);

    this.labels = new LabelLayer(this.overlay);
    this.labels.onClick = (id) => { void navigate(() => this.selectFromUI(id, { focus: false })); };
    this.labels.onHover = (id, rect) => {
      actions.hover(id);
      if (id && rect) {
        const canvas = this.renderer.domElement.getBoundingClientRect();
        this.showHoverInfo(id, rect.right - canvas.left, rect.bottom - canvas.top);
      } else this.hideHoverInfo();
    };
    this.labels.raycastOwner = (from, to) => this.raycastOwner(from, to);
    this.labels.keeps = (p) => !getState().clip.enabled || this.section.keeps(p);

    this.bindPointer();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.unsub.push(store.subscribe((s, prev) => this.onState(s, prev)));
    document.addEventListener('visibilitychange', this.visibilityChange);
    this.unsub.push(() => document.removeEventListener('visibilitychange', this.visibilityChange));
    this.lastT = performance.now();
    this.loop();
  }

  dispose() {
    this.disposed = true;
    this.cancelArchPreparation?.();
    cancelAnimationFrame(this.raf);
    clearTimeout(this.boardTimer);
    clearTimeout(this.explodeTimer);
    this.unsub.forEach((u) => u());
    this.resizeObs?.disconnect();
    this.labels?.dispose();
    this.developmentScene.dispose();
    this.surfaceLayer.dispose();
    this.developmentProgressListeners.clear();
    this.rig?.controls.dispose();
    this.environmentTarget?.dispose();
    this.scene.environment = null;
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.overlay?.remove();
    this.unsub = [];
  }

  /* ============================================================== loading */

  async loadAll() {
    setState({ error: undefined });
    try {
      for (const st of STAGES) {
        actions.setLoading(st.id, 0);
        const geos = await this.loader.load(st.file, (p) => actions.setLoading(st.id, p));
        this.addGeometries(geos);
        actions.setLoading(st.id, 1);
        if (st.id === 'core') setState({ ready: true });
        this.refreshAll();
        await nextFrame();
      }
      // idle prefetch of the detailed exemplar tooth
      const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 600));
      idle(() => { if (!this.disposed) void this.ensureTooth(EXEMPLAR_TOOTH).catch(() => {}); });
    } catch (e) {
      console.error(e);
      setState({ error: 'load' }); // shown translated by the loading card
    }
  }

  ensureTooth(fdi: number): Promise<void> {
    if (this.loadedTeeth.has(fdi)) return Promise.resolve();
    const existing = this.toothLoads.get(fdi);
    if (existing) return existing;
    const asset = this.registry.get(`tooth-${fdi}`)?.tooth?.asset;
    if (!asset) return Promise.resolve();
    const p = this.loader.load(asset).then((geos) => {
      if (this.disposed) return;
      this.addGeometries(geos);
      this.loadedTeeth.add(fdi);
      this.refreshAll();
    }).catch((error: unknown) => {
      this.toothLoads.delete(fdi);
      throw error;
    });
    this.toothLoads.set(fdi, p);
    return p;
  }

  async ensureAllTeeth() {
    const teeth = this.registry.teeth().map((t) => t.toothFdi!);
    let done = 0;
    actions.setLoading('teeth', 0);
    await Promise.all(
      teeth.map((f) =>
        this.ensureTooth(f).then(() => {
          done++;
          actions.setLoading('teeth', done / teeth.length);
        }),
      ),
    );
  }

  private addGeometries(geos: Map<string, THREE.BufferGeometry>) {
    for (const [key, geo] of geos) {
      if (this.entries.has(key)) continue;
      const owner = this.registry.meshOwner.get(key);
      if (!owner) continue;
      const cats = this.registry.categoriesOfMesh(key);
      const style = styleKeyFor(key, cats);
      if (style === 'enamel') shadeEnamelCrevices(geo, this.registry, Number(key.split('-').at(-1)));
      const mat = createTissueMaterial(style);
      const shell = shellFdi(key);
      if (shell !== null) colorToothShell(geo, mat, this.registry, shell);
      applyThemeToMaterial(mat, getState().theme);
      setFibreAxis(mat, geo.boundingBox!);
      // nerves and vessels stretch between the jaws as they separate (per-vertex jaw weight → morph target)
      const jaw = geo.getAttribute('jaw') as THREE.BufferAttribute | undefined;
      if (jaw && isNeurovascular(cats)) {
        const d = neurovascularStretch(this.registry);
        const delta = new Float32Array(jaw.count * 3);
        for (let i = 0; i < jaw.count; i++) {
          const w = jaw.getX(i);
          delta[i * 3] = d.x * w;
          delta[i * 3 + 1] = d.y * w;
          delta[i * 3 + 2] = d.z * w;
        }
        geo.morphAttributes.position = [new THREE.BufferAttribute(delta, 3)];
        geo.morphTargetsRelative = true;
        geo.computeBoundingSphere();
      }
      const mesh = new THREE.Mesh(geo, mat);
      const rigid = rigidJawPart(key, this.registry.get(owner)?.toothFdi);
      if (!rigid && (cats.includes('muscles') || isNeurovascular(cats))) {
        // Index 0 remains the existing arch-dissection stretch; index 1 is jaw motion.
        if (!geo.morphAttributes.position) geo.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count * 3), 3)];
        geo.morphAttributes.position.push(new THREE.BufferAttribute(jawDeformation(geo, key, this.registry.manifest, isNeurovascular(cats)), 3));
        geo.morphTargetsRelative = true;
        geo.computeBoundingSphere();
      }
      mesh.matrixAutoUpdate = false;
      if (geo.morphAttributes.position) {
        mesh.updateMorphTargets();
        mesh.morphTargetInfluences![0] = 0;
      }
      mesh.name = key;
      mesh.userData.key = key;
      // Ray tests (hover, picking, label occlusion) use a bounding-volume tree once it is built:
      // the same hits as the plain test with far fewer triangles checked. The tree describes the
      // rest shape, so nerves and vessels fall back to the plain test while they are stretched.
      mesh.raycast = geo.morphAttributes.position ? morphAwareRaycast : acceleratedRaycast;
      this.bvhQueue.push(geo);
      mesh.visible = false;
      const center = geo.boundingBox!.getCenter(new THREE.Vector3());
      const entry: MeshEntry = {
        key,
        owner,
        mesh,
        nv: isNeurovascular(cats),
        regional: !!this.registry.get(owner)?.regional,
        nerve: cats.includes('nerves'),
        sinus: cats.includes('sinus'),
        quiet: 0,
        archOffset: archOffset(this.registry, key, center),
        toothOffset: toothLayerOffset(this.registry, key),
        pulpOffset: pulpLayerOffset(this.registry, key),
        visual: 'off',
        opacity: 0,
        hi: 0,
        hiTarget: 0,
        hover: false,
      };
      this.entries.set(key, entry);
      this.root.add(mesh);
      this.developmentScene.addSource(key, geo, cats);
    }
    this.scheduleBvh();
  }

  /** Build ray-test trees in idle time, a few meshes per slice, so loading never stalls. */
  private scheduleBvh() {
    if (this.bvhScheduled || !this.bvhQueue.length) return;
    this.bvhScheduled = true;
    // a timer rather than requestIdleCallback: while the scene animates the browser may never be idle
    setTimeout(() => {
      const until = performance.now() + 10;
      while (this.bvhQueue.length && performance.now() < until) {
        const geo = this.bvhQueue.shift()!;
        if (!geo.boundsTree && geo.index !== null) geo.boundsTree = new MeshBVH(geo);
      }
      this.bvhScheduled = false;
      if (!this.disposed) this.scheduleBvh();
    }, 30);
  }

  /* ========================================================= state sync */

  /** Orbit the whole skull at rest, then the dentition during arch exploration. */
  private updatePivot() {
    const { dissectFdi, developmentStage, explode, explodePhase, jawControls } = getState();
    const tooth = developmentStage || this.developmentScene.active ? this.developmentScene.bounds : dissectFdi !== null ? this.boundsOf(`tooth-${dissectFdi}`, false) : null;
    const assembled = !this.preparingArch && explode === 0 && explodePhase === 1 && !jawControls;
    this.rig.setPivot(tooth && !tooth.isEmpty() ? tooth.getCenter(new THREE.Vector3()) : assembled ? this.skullBounds.getCenter(new THREE.Vector3()) : this.rig.home.target);
    this.invalidate();
  }

  /** Is this a maxillary sinus (selecting one turns the maxilla see-through)? */
  private isSinus(id: string | null): boolean {
    return !!id && !!this.registry.get(id)?.categories.includes('sinus');
  }

  /** Match lighting and bone shading to the UI theme (see THEME_LIGHTING). */
  private applyTheme(theme: SceneTheme) {
    this.renderer.toneMappingExposure = THEME_LIGHTING[theme].exposure;
    this.scene.environmentIntensity = THEME_LIGHTING[theme].environment;
    for (const e of this.entries.values()) {
      applyThemeToMaterial(e.mesh.material, theme);
      if (e.quiet) e.mesh.material.color.lerp(QUIET_TINT[theme], QUIET_MIX * e.quiet);
    }
    this.invalidate();
  }

  private onState(s: AppState, p: AppState) {
    const developmentChanged = s.developmentStage !== p.developmentStage;
    if (s.resetId !== p.resetId || developmentChanged || s.dissectFdi !== p.dissectFdi || s.jawControls !== p.jawControls || s.selectedId !== p.selectedId) this.cancelArchPreparation?.();
    if (developmentChanged || s.developmentPlaying !== p.developmentPlaying || s.developmentShowUnerupted !== p.developmentShowUnerupted || s.developmentSoftTissue !== p.developmentSoftTissue || s.theme !== p.theme) {
      this.developmentScene.update(s, developmentChanged && !!p.developmentStage && s.resetId === p.resetId && !this.animator.reducedMotion, s.developmentPlaying || !s.developmentStage && p.developmentPlaying);
      this.notifyDevelopmentProgress();
    }
    if (!developmentChanged && s.developmentStage && s.developmentPlaying !== p.developmentPlaying) {
      if (!s.developmentPlaying) this.animator.cancel('camera');
      else if (this.developmentScene.remainingSeconds > 0) this.frameDevelopment();
    }
    const visChanged =
      developmentChanged || s.developmentShowUnerupted !== p.developmentShowUnerupted ||
      s.categories !== p.categories ||
      s.passageIds !== p.passageIds ||
      s.studyView !== p.studyView || s.vesselSide !== p.vesselSide || s.vesselMode !== p.vesselMode ||
      s.nerveView !== p.nerveView || s.nerveSide !== p.nerveSide ||
      s.jawControls !== p.jawControls || s.jawSide !== p.jawSide ||
      s.hidden !== p.hidden ||
      s.ghosted !== p.ghosted ||
      s.isolateId !== p.isolateId ||
      s.isolateContext !== p.isolateContext ||
      s.dissectFdi !== p.dissectFdi ||
      s.dissectLevel !== p.dissectLevel ||
      s.clip.enabled !== p.clip.enabled ||
      (s.explode > 0) !== (p.explode > 0) ||
      s.explodePhase !== p.explodePhase ||
      s.ghostOpacity !== p.ghostOpacity ||
      (s.selectedId !== p.selectedId && (this.isSinus(s.selectedId) || this.isSinus(p.selectedId)));
    // Quiz: with a section open, picking another tooth moves the cut and swaps that
    // tooth's shell for its tissues, so visibility and the board pack must follow.
    const quizCutMoved = s.mode === 'quiz' && s.clip.enabled && s.selectedId !== p.selectedId;
    if (s.mode !== p.mode) this.hideHoverInfo();
    if (visChanged || quizCutMoved) this.refreshVisibility();
    if (s.jawOpening !== p.jawOpening && !s.jawPlaying) this.jawCur = s.jawOpening;
    if (s.jawPlaying && !p.jawPlaying) {
      if (this.animator.reducedMotion) { actions.setJawOpening(s.jawOpening); return; }
      this.jawDirection = this.jawCur >= 0.999 ? -1 : 1;
    }
    if (s.jawOpening !== p.jawOpening || s.jawPlaying !== p.jawPlaying) this.labels?.markSceneChanged();
    if (s.explode !== p.explode || s.explodePhase !== p.explodePhase) this.refreshRootCuts(s);
    if (s.selectedId !== p.selectedId || s.hoveredId !== p.hoveredId || s.dissectFdi !== p.dissectFdi) this.refreshHighlight();
    if (visChanged || s.lang !== p.lang || s.numbering !== p.numbering) this.pointerDirty = true;
    if (s.clip !== p.clip || s.dissectFdi !== p.dissectFdi || (quizCutMoved && s.clip.enabled)) this.refreshClip();
    if (s.clip.enabled && !p.clip.enabled && s.dissectFdi === null) void this.ensureAllTeeth().catch(() => setState({ error: 'load' }));
    if (s.dissectFdi !== p.dissectFdi && s.dissectFdi !== null) void this.ensureTooth(s.dissectFdi).catch(() => {});
    if (s.autoRotate !== p.autoRotate) this.rig.controls.autoRotate = s.autoRotate;
    if (s.theme !== p.theme) this.applyTheme(s.theme);
    if (s.orbitMode !== p.orbitMode) this.rig.setMode(s.orbitMode);
    if (s.dissectFdi !== p.dissectFdi || (s.explode > 0) !== (p.explode > 0) || s.explodePhase !== p.explodePhase || s.jawControls !== p.jawControls) this.updatePivot();
    if (developmentChanged) {
      this.updatePivot();
      if (this.developmentScene.active) {
        if (!p.developmentStage) this.setView('three-quarter');
        else this.frameDevelopment();
      }
      else this.resetToStart();
    }
    if (visChanged || s.labels !== p.labels || s.surfaceFeatures !== p.surfaceFeatures || s.numbering !== p.numbering || s.selectedId !== p.selectedId || s.lang !== p.lang) this.refreshLabels();
    // a new phase or a changed set of visible structures re-packs the board and frames it
    if (s.explodePhase !== p.explodePhase || (s.explodePhase === 2 && visChanged)) this.layoutBoard(true);
    else if (s.explodePhase === 2 && (s.quizBoardOrder !== p.quizBoardOrder || quizCutMoved)) this.layoutBoard(false);
    if (s.explodePhase === 1 && p.explodePhase === 2 && s.dissectFdi === null && !s.isolateId) {
      // back from the board: frame the in-position dissection again
      this.reframeForExplode(s, s.explode > 0 ? 'three-quarter' : 'front');
      if (s.explode > 0 && s.view !== 'three-quarter') setState({ view: 'three-quarter' });
    } else if (s.explode !== p.explode && s.explodePhase === 1) this.reframeForExplode(s);
    this.invalidate();
  }

  /**
   * Phase 2: lay every fully visible structure out on a board facing the viewer
   * (see layout.ts); ghosted context fades out. `frame` also points the camera at it.
   */
  private layoutBoard(frame: boolean) {
    clearTimeout(this.boardTimer);
    clearTimeout(this.explodeTimer);
    this.explodeTimer = 0;
    this.explodePreset = undefined;
    if (getState().explodePhase !== 2) return;
    const items: LayoutItem[] = [];
    const assemblies = new Map<string, { bounds: THREE.Box3; members: MeshEntry[] }>();
    for (const e of this.entries.values()) {
      if (!isFullyShown(e.visual)) {
        e.boardTarget = e.boardPos = undefined;
        continue;
      }
      const key = boardAssemblyKey(e.key);
      let assembly = assemblies.get(key);
      if (!assembly) {
        assembly = { bounds: new THREE.Box3(), members: [] };
        assemblies.set(key, assembly);
      }
      assembly.bounds.union(e.mesh.geometry.boundingBox!);
      assembly.members.push(e);
    }
    // while Quiz shuffles positions, look the tooth up in the shuffled slot order instead of its reading order
    const board = getState().quizBoardOrder;
    const ranks = board && board.length === 32 ? shuffledRanks(board) : null;
    const rankOf = (fdi: number | undefined) => (fdi === undefined ? undefined : ranks ? ranks.get(fdi) ?? archOrder(fdi) : undefined);
    for (const [key, assembly] of assemblies) {
      const size = assembly.bounds.getSize(new THREE.Vector3());
      const owner = this.registry.meshOwner.get(key);
      items.push({ key, w: size.x, h: size.y, ...boardSlot(key, this.registry.categoriesOfMesh(key), owner ? this.registry.get(owner)?.toothFdi : undefined, rankOf) });
    }
    // The board packs to the area the UI leaves clear (see `boardViewport`) so on a
    // phone it sits above the Quiz bottom sheet instead of behind it.
    const view = this.boardViewport();
    const { centers, bounds } = shelfLayout(items, view.aspect, BOARD_GAP);
    this.boardAspect = this.rig.camera.aspect;
    const origin = this.rig.home.target;
    for (const [key, c] of centers) {
      const assembly = assemblies.get(key)!;
      const center = assembly.bounds.getCenter(new THREE.Vector3());
      const target = new THREE.Vector3(origin.x + c.x, origin.y + c.y, origin.z).sub(center);
      for (const e of assembly.members) {
        e.boardTarget = target.clone();
        // new slots are taken directly (the move from phase 1 is blended by phaseCur);
        // existing ones glide to their new place in tickVisuals
        e.boardPos ??= target.clone();
        if (this.phaseCur < 1e-3) e.boardPos.copy(target);
      }
    }
    if (frame) {
      // fit the board rectangle (not its bounding sphere) inside the clear viewport;
      // the view offset from `setInsets` centres it there and the margin keeps it clear
      // of the side panels, the dock and the mobile sheet
      const cam = this.rig.camera;
      const tanV = tanHalfFov(cam);
      const halfW = (bounds.x1 - bounds.x0) / 2;
      const halfH = (bounds.y1 - bounds.y0) / 2;
      const distance = Math.max(
        (halfH * BOARD_MARGIN.h) / (view.vFrac * tanV),
        (halfW * BOARD_MARGIN.w) / (view.hFrac * tanV * cam.aspect),
      );
      setState({ view: null });
      this.rig.focusSphere(new THREE.Vector3(origin.x, origin.y, origin.z), Math.hypot(halfW, halfH), { direction: new THREE.Vector3(0, 0.02, 1), distance, duration: 0.9 });
    }
    this.invalidate();
  }

  /** The part of the canvas the UI leaves clear, as a packing aspect plus width/height fractions. */
  private boardViewport() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const ins = this.insetTarget;
    const usableW = Math.max(160, w - ins.left - ins.right);
    const usableH = Math.max(160, h - ins.top - ins.bottom);
    return { aspect: usableW / usableH, hFrac: usableW / w, vFrac: usableH / h };
  }

  /** Keep the separating jaws in view: fit the camera to the exploded anatomy as the slider moves. */
  private reframeForExplode(s: AppState, preset?: ViewPreset) {
    if (s.developmentStage) return this.setView(preset ?? 'three-quarter');
    if (s.dissectFdi !== null || s.isolateId) return;
    if (s.explode === 0) {
      clearTimeout(this.explodeTimer);
      this.explodeTimer = 0;
      this.explodePreset = undefined;
      this.startView(0.6);
      return;
    }
    if (preset) this.explodePreset = preset;
    // Throttle framing while Play/scrubbing changes the slider continuously;
    // debouncing would leave the camera unchanged until separation finished.
    if (this.explodeTimer) return;
    this.explodeTimer = window.setTimeout(() => {
      this.explodeTimer = 0;
      const state = getState();
      const direction = this.explodePreset;
      this.explodePreset = undefined;
      if (state.explodePhase !== 1 || state.developmentStage || state.dissectFdi !== null || state.isolateId) return;
      const ex = state.explode;
      if (ex === 0) return this.startView(0.6);
      const box = this.explodedBounds(ex);
      if (box.isEmpty()) return;
      const cam = this.rig.camera;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const tanV = tanHalfFov(cam);
      // the fixed orbit keeps looking at its pivot, so fit the larger half on either side of it
      const c = this.rig.mode === 'fixed' ? this.rig.pivot : center;
      const halfH = Math.max(box.max.y - c.y, c.y - box.min.y);
      const halfW = Math.max(box.max.x - c.x, c.x - box.min.x);
      // leave room for the bottom toolbar and the side panels
      const fit = Math.max((halfH / tanV) * 1.15, (halfW / (tanV * cam.aspect)) * 1.25);
      const dir = direction ? PRESET_DIRS[direction].clone() : cam.position.clone().sub(this.rig.controls.target).normalize();
      this.rig.focusSphere(c, size.length() / 2, { direction: dir, distance: fit + size.z / 2, duration: 0.2 });
      this.invalidate();
    }, 120);
  }

  /** Bounds of the shown (non-context) anatomy at a given arch explode. */
  private explodedBounds(ex: number): THREE.Box3 {
    const box = new THREE.Box3();
    const b = new THREE.Box3();
    const stretch = neurovascularStretch(this.registry).multiplyScalar(ex);
    for (const e of this.entries.values()) {
      if (!isFullyShown(e.visual) || this.isContextMesh(e.key)) continue;
      const geo = e.mesh.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      b.copy(geo.boundingBox!).translate(e.archOffset.clone().multiplyScalar(ex));
      if (geo.morphAttributes.position) b.expandByPoint(b.max.clone().add(stretch));
      box.union(b);
    }
    return box;
  }

  private refreshAll() {
    this.developmentScene.update(getState());
    if (getState().developmentStage && !this.developmentScene.bounds.isEmpty()) { this.updatePivot(); this.setView(getState().view ?? 'three-quarter'); }
    this.refreshVisibility();
    this.refreshHighlight();
    this.refreshClip();
    this.refreshLabels();
    // geometry that arrives while the board is shown gets a slot too
    if (getState().explodePhase === 2) this.layoutBoard(false);
  }

  private visibilityCtx() {
    return { registry: this.registry, state: getState(), loadedTeeth: this.loadedTeeth };
  }

  private refreshVisibility() {
    const ctx = this.visibilityCtx();
    for (const e of this.entries.values()) e.visual = this.developmentScene.holdsAdult ? 'off' : resolveMesh(e.key, ctx);
    this.refreshRootCuts(ctx.state);
    this.labels?.markSceneChanged();
    this.invalidate();
  }

  /** Keep roots beneath opaque gingiva in the assembled mouth; reveal them as the arches separate. */
  private refreshRootCuts(s: AppState) {
    const ctx = this.visibilityCtx();
    for (const e of this.entries.values()) {
      const fdi = shellFdi(e.key);
      if (fdi === null) continue;
      const gum = fdi < 30 ? 'gingiva-upper' : 'gingiva-lower';
      const gumShown = resolveMesh(gum, ctx) === 'on' && s.dissectFdi === null && !s.clip.enabled && s.explodePhase === 1;
      const tooth = this.registry.manifest.teeth[String(fdi)];
      e.rootCut = gumShown ? { extract: tooth?.extract ?? 2, collar: tooth?.collar ?? 0.2 } : undefined;
      if (!e.rootCut) e.mesh.material.userData.fx.uRootCut.value = -100;
    }
    this.invalidate();
  }

  private refreshHighlight() {
    const { selectedId, hoveredId, dissectFdi } = getState();
    // inside a tooth, selecting the tooth itself shouldn't tint every layer
    const tintSel = selectedId && !(dissectFdi !== null && selectedId === `tooth-${dissectFdi}`);
    const sel = new Set(tintSel ? this.highlightMeshes(selectedId) : []);
    const hov = new Set(hoveredId && hoveredId !== selectedId ? this.highlightMeshes(hoveredId) : []);
    for (const e of this.entries.values()) {
      e.hiTarget = sel.has(e.key) ? 1 : hov.has(e.key) ? 0.55 : 0;
      e.hover = !sel.has(e.key) && hov.has(e.key);
      e.mesh.material.userData.fx.uHiColor.value.copy(highlightColor(e.mesh.material, e.hover));
    }
    const s = selectedId ? this.registry.get(selectedId) : undefined;
    this.marker.visible = !!s && s.kind === 'landmark' && !!s.anchor;
    this.invalidate();
  }

  /** Skull and muscles: the surroundings, left out when framing the dental anatomy. */
  private isContextMesh(key: string): boolean {
    const cats = this.registry.categoriesOfMesh(key);
    return cats.includes('skull') || cats.includes('muscles');
  }

  /** Meshes to tint for a structure (landmarks are shown by the marker instead). */
  private highlightMeshes(id: string): string[] {
    const s = this.registry.get(id);
    return s && s.kind !== 'landmark' ? this.registry.meshesOf(id) : [];
  }

  private activeBounds(): THREE.Box3 {
    const { dissectFdi } = getState();
    const refFdi = this.quizInspectFdi() ?? dissectFdi;
    if (refFdi !== null) {
      const b = this.boundsOf(`tooth-${refFdi}`, false);
      if (!b.isEmpty()) return b;
    }
    const b = new THREE.Box3();
    for (const e of this.entries.values()) {
      if (this.isContextMesh(e.key)) continue;
      b.union(e.mesh.geometry.boundingBox!.clone().applyMatrix4(e.mesh.matrixWorld));
    }
    return b.isEmpty() ? this.sceneBounds : b;
  }

  /**
   * FDI of the tooth the answer-safe inspection tools act on in Quiz mode: the
   * tooth picked on the board. Null in other modes and when nothing is picked.
   */
  private quizInspectFdi(): number | null {
    const { mode, selectedId } = getState();
    if (mode !== 'quiz' || !selectedId) return null;
    return this.registry.get(selectedId)?.toothFdi ?? null;
  }

  /** FDI of the tooth a mesh belongs to (shell or one of its layers), or null. */
  private toothFdiOfMesh(meshKey: string): number | null {
    const direct = shellFdi(meshKey);
    if (direct !== null) return direct;
    const owner = this.registry.meshOwner.get(meshKey);
    return (owner ? this.registry.get(owner)?.toothFdi : undefined) ?? null;
  }

  private refreshClip() {
    const { clip, dissectFdi } = getState();
    // in Quiz the section belongs to the tooth being inspected, not to the whole board
    const quizFdi = this.quizInspectFdi();
    const refFdi = quizFdi ?? dissectFdi;
    const frame = refFdi !== null ? this.registry.get(`tooth-${refFdi}`)?.tooth?.frame : undefined;
    this.section.setFrame(frame ? { sagittal: frame.buccal, coronal: frame.mesial, axial: frame.axis } : null);
    this.section.update(clip, this.activeBounds(), this.rig.camera, this.rig.controls.target);
    const planes = clip.enabled ? this.section.planes : null;
    for (const e of this.entries.values()) {
      const m = e.mesh.material;
      const style = m.userData.styleKey;
      // Quiz cuts only the picked tooth's meshes; the rest of the board stays whole
      const cut = planes !== null && (quizFdi === null || this.toothFdiOfMesh(e.key) === quizFdi);
      m.userData.fx.uCapEnabled.value = cut && ['shell', 'enamel', 'dentin-coronal', 'dentin-radicular', 'cementum', 'pdl', 'pulp-chamber', 'canal'].includes(style) ? 1 : 0;
      const want = cut ? planes : null;
      if ((m.clippingPlanes?.length ?? 0) !== (want?.length ?? 0)) {
        m.clippingPlanes = want;
        m.needsUpdate = true;
      }
    }
    this.labels?.markSceneChanged();
    this.invalidate();
  }

  /* ============================================================ labels */

  private refreshLabels() {
    if (!this.labels) return;
    const s = getState();
    this.labels.enabled = (s.labels || s.surfaceFeatures && s.dissectFdi !== null) && !this.developmentScene.active;
    this.labels.selectedId = s.selectedId;
    if (!s.labels && !(s.surfaceFeatures && s.dissectFdi !== null)) {
      this.labels.setCandidates([]);
      this.invalidate();
      return;
    }
    const out: LabelCandidate[] = [];
    const visibleMesh = (k: string) => {
      const e = this.entries.get(k);
      return !!e && e.visual !== 'off';
    };
    const addMeshLabel = (id: string, text: string, kind: LabelCandidate['kind'], prio: number, meshKeys: string[]) => {
      const keys = meshKeys.filter(visibleMesh);
      if (!keys.length) return;
      const e = this.entries.get(keys[0])!;
      const r = e.mesh.geometry.boundingSphere!.radius;
      out.push({
        id,
        text,
        kind,
        priority: prio,
        radius: r,
        owners: new Set([id, ...this.registry.descendants(id).map((d) => d.id), ...keys.map((k) => this.registry.meshOwner.get(k)!)]),
        anchor: () => this.labelAnchor(e),
      });
    };
    if (s.dissectFdi !== null) {
      const fdi = s.dissectFdi;
      const tooth = this.registry.get(`tooth-${fdi}`)!;
      for (const k of s.labels ? tooth.tooth?.layers ?? [] : []) {
        const st = this.registry.get(k);
        if (st && this.entries.get(k)?.visual === 'on') addMeshLabel(k, shortOf(st, s.lang), 'structure', st.labelPriority + 3, [k]);
      }
      for (const d of this.registry.descendants(tooth.id)) {
        if (d.surfaceFeature ? !s.surfaceFeatures || s.dissectLevel > 1 || s.clip.enabled : !s.labels) continue;
        if (d.kind !== 'landmark' || !d.anchor || d.id.startsWith('pulp-horn-') && !d.id.startsWith('pulp-horn-1-')) continue;
        const parentKey = d.surfaceFeature ? (this.entries.get(`enamel-${fdi}`)?.visual === 'on' ? `enamel-${fdi}` : tooth.id) : d.parent && this.registry.get(d.parent)?.meshes[0];
        const parentEntry = parentKey ? this.entries.get(parentKey) : undefined;
        if (parentEntry && parentEntry.visual === 'off') continue;
        const anchor = new THREE.Vector3(...d.anchor);
        out.push({
          id: d.id,
          text: shortOf(d, s.lang),
          kind: 'landmark',
          priority: d.labelPriority + 2,
          radius: 0.2,
          occlusionTolerance: d.surfaceFeature ? 0.012 : undefined,
          // Surface landmarks must be hidden by the far side of their own crown.
          owners: new Set([d.id, ...(!d.surfaceFeature && parentKey ? [this.registry.meshOwner.get(parentKey)!] : [])]),
          anchor: () => (parentEntry ? anchor.clone().applyMatrix4(parentEntry.mesh.matrixWorld) : anchor),
        });
      }
    } else {
      for (const t of this.registry.teeth()) {
        if (s.jawControls || s.studyView) continue;
        const fdi = t.toothFdi!;
        if (s.passageIds.length) {
          const lower = s.passageIds.some((id) => id.startsWith('mandibular-foramen-'));
          const upper = s.passageIds.some((id) => id.startsWith('infraorbital-foramen-'));
          const side = s.passageIds[0].endsWith('-right') ? 'right' : 'left';
          if ((!lower && !upper) || t.tooth?.side !== side || t.tooth?.arch !== (lower ? 'mandibular' : 'maxillary')) continue;
        }
        const keys = layersActive(fdi, this.visibilityCtx()) ? [`enamel-${fdi}`] : [t.id];
        addMeshLabel(t.id, formatTooth(fdi, s.numbering), 'tooth', 5, keys);
      }
      for (const st of this.registry.byId.values()) {
        if (s.studyView && st.id !== s.selectedId && !(s.studyView === 'sinuses' ? st.categories.includes('sinus') : s.studyView === 'nerves' ? st.categories.includes('nerves') : st.categories.some(c => c === 'arteries' || c === 'veins'))) continue;
        if (s.jawControls && (!st.id.endsWith(`-${s.jawSide}`) || !/^(mandibular-condyle|articular-|lateral-pterygoid|medial-pterygoid|temporalis|masseter)/.test(st.id))) continue;
        if (s.passageIds.length && st.kind === 'landmark' && !s.passageIds.includes(st.id)) continue;
        const passageLabel = s.passageIds.includes(st.id);
        const studyLabel = s.studyView === 'nerves' ? st.categories.includes('nerves') : s.studyView === 'vessels' && st.categories.some(c => c === 'arteries' || c === 'veins');
        if (st.toothFdi !== undefined || !passageLabel && !studyLabel && (st.labelPriority < 3 || st.regional)) continue;
        if (st.kind === 'mesh' || s.jawControls && st.kind === 'group') {
          const vis = this.registry.meshesOf(st.id).filter((k) => s.jawControls || s.passageIds.includes(st.id) ? visibleMesh(k) : isFullyShown(this.entries.get(k)?.visual ?? 'off'));
          const notation = st.development ? developmentNotation(st.development)[s.numbering] : null;
          if (vis.length) addMeshLabel(st.id, notation ?? shortOf(st, s.lang), st.development ? 'tooth' : 'structure', passageLabel || studyLabel ? Math.max(3, st.labelPriority) : st.labelPriority, vis);
        } else if (st.kind === 'landmark' && st.anchor) {
          const ok = st.categories.every((c) => s.categories[c] !== 'off');
          if (!ok) continue;
          const a = new THREE.Vector3(...st.anchor);
          const hostKey = landmarkHost(this.registry, st.id);
          const host = hostKey ? this.entries.get(hostKey) : undefined;
          out.push({ id: st.id, text: nameOf(st, s.lang), kind: 'landmark', priority: st.labelPriority, radius: 0.35, owners: new Set([st.id, ...(host ? [host.owner] : [])]), anchor: () => this.landmarkPosition(st) ?? a });
        }
      }
    }
    this.labels.setCandidates(out);
    this.invalidate();
  }

  private labelAnchor(e: MeshEntry): THREE.Vector3 {
    if (!e.labelPoint) e.labelPoint = computeLabelPoint(e.mesh.geometry, e.key, e.owner, this.registry);
    const point = e.labelPoint.clone();
    const morphs = e.mesh.geometry.morphAttributes.position;
    if (morphs?.length) {
      if (e.labelVertex === undefined) {
        const pos = e.mesh.geometry.getAttribute('position');
        const vertex = new THREE.Vector3();
        let distance = Infinity;
        for (let i = 0; i < pos.count; i++) {
          const d = vertex.fromBufferAttribute(pos, i).distanceToSquared(point);
          if (d < distance) { distance = d; e.labelVertex = i; }
        }
      }
      const delta = new THREE.Vector3();
      morphs.forEach((attribute, i) => {
        point.addScaledVector(delta.fromBufferAttribute(attribute, e.labelVertex!), e.mesh.morphTargetInfluences?.[i] ?? 0);
      });
    }
    return e.mesh.localToWorld(point);
  }

  /* ========================================================== picking */

  private bindPointer() {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointermove', (ev) => {
      // Touch gestures orbit/pinch; hover raycasts only help mouse and pen input.
      if (!this.interactiveSelection || ev.pointerType === 'touch') return;
      this.setPointer(ev);
      this.pointerInside = true;
      this.pointerDirty = true;
      this.invalidate();
    });
    dom.addEventListener('pointerleave', () => {
      this.pointerInside = false;
      actions.hover(null);
      this.hideHoverInfo();
    });
    dom.addEventListener('pointerdown', (ev) => {
      actions.hover(null);
      this.hideHoverInfo();
      this.down = ev.isPrimary ? { x: ev.clientX, y: ev.clientY, t: performance.now() } : null;
    });
    dom.addEventListener('pointercancel', () => { this.down = null; this.pointerDirty = true; });
    dom.addEventListener('pointerup', (ev) => {
      const d = this.down;
      this.down = null;
      this.pointerDirty = true;
      if (!d || !this.interactiveSelection) return;
      const moved = Math.hypot(ev.clientX - d.x, ev.clientY - d.y);
      if (moved > 6 || performance.now() - d.t > 600) return;
      this.setPointer(ev);
      const hit = this.pick();
      if (hit) void navigate(() => this.selectFromUI(hit, { focus: false, reveal: false }));
      else void navigate(() => actions.select(null));
    });
    dom.addEventListener('dblclick', (ev) => {
      if (!this.interactiveSelection) return;
      this.setPointer(ev);
      const hit = this.pick();
      if (hit) this.focus(hit);
    });
  }

  private setPointer(ev: PointerEvent | MouseEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointerPx = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    this.pointer.set((this.pointerPx.x / r.width) * 2 - 1, -(this.pointerPx.y / r.height) * 2 + 1);
  }

  private pickables(opaqueOnly = false): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    for (const e of this.entries.values()) if (e.mesh.visible && (opaqueOnly ? isSolid(e) : e.visual !== 'off')) out.push(e.mesh);
    return out;
  }

  /**
   * Entries hit by the current raycaster ray, nearest first, skipping parts cut away by the section.
   * `opaqueOnly` leaves ghosted and see-through meshes out of the test (they never occlude).
   */
  private *rayHits(opaqueOnly = false): Generator<{ entry: MeshEntry; distance: number }> {
    const clip = getState().clip.enabled;
    for (const h of this.raycaster.intersectObjects(this.pickables(opaqueOnly), false)) {
      if (clip && !this.section.keeps(h.point)) continue;
      const entry = this.entries.get(h.object.userData.key as string);
      if (entry) yield { entry, distance: h.distance };
    }
  }

  /** First solid hit, or a sinus through faded context in sinus study; ghosts are the fallback. */
  private pick(): string | null {
    if (this.developmentScene.active) return null;
    this.raycaster.setFromCamera(this.pointer, this.rig.camera);
    let ghost: string | null = null;
    const sinusStudy = getState().studyView === 'sinuses';
    for (const { entry } of this.rayHits()) {
      // In sinus study the faded skull is context, including a sinus the user
      // has ghosted. Prefer the first sinus actually reached through it.
      if (sinusStudy && entry.sinus) return entry.owner;
      if (isSolid(entry)) return entry.owner;
      ghost ??= entry.owner;
    }
    return ghost;
  }

  private raycastOwner(from: THREE.Vector3, to: THREE.Vector3): { id: string; distance: number } | null {
    this.raycaster.set(from, to.clone().sub(from).normalize());
    // only hits in front of the label anchor can hide it: stop the ray there
    this.raycaster.far = from.distanceTo(to);
    try {
      for (const { entry, distance } of this.rayHits(true)) return { id: entry.owner, distance };
      return null;
    } finally {
      this.raycaster.far = Infinity;
    }
  }

  private updateHover() {
    if (!this.pointerDirty || !this.pointerInside || this.down) return;
    this.pointerDirty = false;
    const id = this.pick();
    actions.hover(id);
    if (id) {
      this.showHoverInfo(id, this.pointerPx.x, this.pointerPx.y);
      this.renderer.domElement.style.cursor = 'pointer';
    } else {
      this.hideHoverInfo();
    }
  }

  private hideHoverInfo() {
    this.tip.classList.remove('is-visible');
    this.tip.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.style.cursor = '';
  }

  /** The same localized anatomy appears when hovering the volume or its label. */
  private showHoverInfo(id: string, x: number, y: number) {
    // Quiz: the tooltip names the tooth and its number, which would give the answer away
    if (getState().mode === 'quiz') {
      this.tip.classList.remove('is-visible');
      this.tip.setAttribute('aria-hidden', 'true');
      return;
    }
    const structure = this.registry.require(id);
    const { numbering, lang } = getState();
    const key = `${id}:${lang}:${numbering}`;
    if (key !== this.tipKey) {
      this.tipKey = key;
      const name = nameOf(structure, lang);
      const sinus = structure.categories.includes('sinus');
      this.tip.classList.toggle('ds-tip--anatomy', sinus);
      this.tip.replaceChildren();
      const title = document.createElement('strong');
      title.textContent = structure.toothFdi ? `${name} · ${formatTooth(structure.toothFdi, numbering)}` : name;
      this.tip.appendChild(title);
      if (sinus) {
        const summary = document.createElement('p');
        summary.textContent = resolveContent(this.registry, id, lang).summary!;
        const note = document.createElement('span');
        note.className = 'ds-tip-note';
        note.textContent = SINUS_NOTE[lang];
        this.tip.append(summary, note);
      }
    }
    const width = this.container.clientWidth, height = this.container.clientHeight;
    const bounds = this.tip.getBoundingClientRect();
    // Flip beside the pointer near an edge, then clamp within the canvas.
    const left = x + 14 + bounds.width <= width - 12 ? x + 14 : x - bounds.width - 14;
    const top = y + 16 + bounds.height <= height - 12 ? y + 16 : y - bounds.height - 16;
    this.tip.style.transform = `translate3d(${Math.max(12, Math.min(left, width - bounds.width - 12))}px, ${Math.max(12, Math.min(top, height - bounds.height - 12))}px, 0)`;
    this.tip.classList.add('is-visible');
    this.tip.setAttribute('aria-hidden', 'false');
  }

  /* ========================================================= commands */

  /**
   * Select a structure as if chosen from search/tree/deep link:
   * reveal it, load what it needs, fly to it and open its panel.
   */
  async selectFromUI(id: string, opts: { focus?: boolean; reveal?: boolean } = {}) {
    let s = this.registry.get(id);
    if (!s) return;
    // Quiz answers are whole teeth: a click on a sectioned tooth's tissue picks that tooth,
    // which keeps its section showing instead of swapping the shell back in
    if (getState().mode === 'quiz' && s.toothFdi !== undefined && id !== `tooth-${s.toothFdi}`) {
      id = `tooth-${s.toothFdi}`;
      s = this.registry.require(id);
    }
    if (!await this.prepareSelection(id, 'select', s.toothFdi)) return;
    if (!getState().developmentStage && this.developmentScene.active) { this.developmentScene.finishTransition(); this.refreshVisibility(); }
    if (id.startsWith('development-')) {
      actions.setDevelopmentStage(getState().developmentStage ?? 'incisor-transition');
      this.cancelSelection();
      this.setView('three-quarter');
      return;
    } else if (getState().developmentStage) actions.setDevelopmentStage(null);
    const { focus = true, reveal = true } = opts;
    const fdi = s.toothFdi;
    const isToothPart = fdi !== undefined && s.id !== `tooth-${fdi}`;
    if (!isToothPart && getState().dissectFdi !== null) actions.exitDissect();
    if (reveal) setState(revealPatch(this.registry, id, getState()));
    if (isToothPart) {
      const st = getState();
      const inTooth = st.dissectFdi === fdi;
      // a tooth part is shown inside the tooth, at a dissection level that reveals it
      // (unless an overview section already shows this tooth's layers)
      if (!inTooth && !(st.clip.enabled && this.loadedTeeth.has(fdi))) {
        actions.enterDissect(fdi);
        actions.setDissectLevel(levelShowing(id));
      } else if (inTooth && !levelShows(st.dissectLevel, id)) actions.setDissectLevel(levelShowing(id));
    }
    actions.select(id);
    if (focus) this.focus(id);
  }

  async showStudyView(id: 'sinuses' | 'vessels' | 'nerves', selected?: string) {
    actions.applyStudyPreset(id);
    const geometries = await this.loader.load(id === 'sinuses' ? 'context.glb' : 'neurovascular.glb');
    this.addGeometries(geometries);
    // Wait for the new controls/caption to render and their clearances to be measured.
    if (id === 'nerves') await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (this.disposed || getState().studyView !== id) return;
    if (id === 'nerves') {
      setState({ view: 'three-quarter' });
      this.frameNerves();
      if (selected) await this.selectFromUI(selected, { focus: true });
      return;
    }
    const box = new THREE.Box3();
    for (const entry of this.entries.values()) {
      const cats = this.registry.require(entry.owner).categories;
      if (id === 'sinuses' ? cats.includes('sinus') : cats.some(c => c === 'arteries' || c === 'veins')) box.union(new THREE.Box3().setFromObject(entry.mesh));
    }
    if (!box.isEmpty()) { const sphere = box.getBoundingSphere(new THREE.Sphere()); this.rig.focusSphere(sphere.center, sphere.radius, { direction: PRESET_DIRS['three-quarter'], padding: 1.2 }); }
    if (selected) await this.selectFromUI(selected, { focus: true });
  }

  /** Fit the displayed nerve paths, excluding the translucent skull and vessels. */
  private frameNerves() {
    const box = new THREE.Box3();
    for (const entry of this.entries.values()) {
      if (entry.visual === 'on' && this.registry.require(entry.owner).categories.includes('nerves')) box.union(new THREE.Box3().setFromObject(entry.mesh));
    }
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const width = this.container.clientWidth, height = this.container.clientHeight;
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.rig.camera.fov) / 2);
    const usableH = tanH * Math.max(.15, (height - this.insetTarget.bottom - this.insetTarget.top - 80) / height);
    const usableW = tanH * this.rig.camera.aspect * Math.max(.15, (width - this.insetTarget.right - this.insetTarget.left - 40) / width);
    const distance = sphere.radius / Math.sin(Math.atan(Math.min(usableH, usableW))) * 1.12;
    this.rig.focusSphere(sphere.center, sphere.radius, { direction: PRESET_DIRS['three-quarter'], distance, movePivot: true });
  }

  async studyToothSurface(fdi: number, view: 'occlusal' | 'inner' | 'facial' | 'mesial' | 'distal') {
    if (getState().dissectFdi !== fdi) actions.enterDissect(fdi);
    actions.setClip({ enabled: false });
    actions.setDissectLevel(0);
    actions.setToothExplode(0);
    await this.ensureTooth(fdi);
    if (getState().dissectFdi !== fdi) return;
    const tooth = this.registry.require(`tooth-${fdi}`).tooth!;
    if (!tooth.frame) return;
    const direction = new THREE.Vector3(...(view === 'occlusal' ? tooth.frame.axis : view === 'mesial' || view === 'distal' ? tooth.frame.mesial : tooth.frame.buccal));
    if (view === 'inner' || view === 'distal') direction.negate();
    // Study surfaces frame the crown; the ordinary tooth focus still shows roots.
    // Respect the control tray and header so a phone does not crop the feature.
    const sphere = this.boundsOf(`crown-${fdi}`, false).getBoundingSphere(new THREE.Sphere());
    const height = this.container.clientHeight, width = this.container.clientWidth;
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.rig.camera.fov) / 2);
    const usableH = tanH * Math.max(this.insetTarget.top ? .15 : .25, (height - this.insetTarget.bottom - this.insetTarget.top - (this.insetTarget.top ? 60 : 100)) / height);
    const usableW = tanH * this.rig.camera.aspect * Math.max(.3, (width - this.insetTarget.right - this.insetTarget.left - 40) / width);
    const distance = sphere.radius / Math.sin(Math.atan(Math.min(usableH, usableW))) * 1.12;
    this.rig.focusSphere(sphere.center, sphere.radius, { direction, distance });
  }

  /** Enter on the tooth's assembled pose, even while the mouth/board is moving back. */
  async exploreTooth(fdi: number) {
    if (!await this.prepareSelection(`tooth-${fdi}`, 'explore', fdi)) return;
    actions.enterDissect(fdi);
    // Let the new control tray render and its viewport insets be measured first.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (this.disposed || getState().dissectFdi !== fdi) return;
    this.focus(`tooth-${fdi}`, { restPose: true });
  }

  /** A newer choice, route, reset or scene transition invalidates this request. */
  private async prepareSelection(id: string, kind: 'select' | 'explore', fdi?: number) {
    const request = { id, kind, status: 'loading' as const };
    setState({ selectionRequest: request });
    try {
      if (fdi !== undefined) await this.ensureTooth(fdi);
      return !this.disposed && getState().selectionRequest === request;
    } catch {
      if (!this.disposed && getState().selectionRequest === request) setState({ selectionRequest: { ...request, status: 'error' } });
      return false;
    }
  }

  cancelSelection() { setState({ selectionRequest: null }); }

  async retrySelection() {
    const request = getState().selectionRequest;
    if (!request || request.status !== 'error') return;
    if (request.kind === 'explore') await this.exploreTooth(this.registry.require(request.id).toothFdi!);
    else await this.selectFromUI(request.id);
  }

  async retryAssets() {
    await this.loadAll();
    if (getState().clip.enabled && getState().dissectFdi === null) {
      try { await this.ensureAllTeeth(); }
      catch { setState({ error: 'load' }); }
    }
  }

  focus(id: string, opts: { restPose?: boolean } = {}) {
    this.cancelArchPreparation?.();
    const s = this.registry.get(id);
    if (!s) return;
    // Guided search frames the actual tooth, using the same clear viewport as dissection.
    const restPose = opts.restPose || (getState().guideOpen && !!s.tooth);
    const fdi = s.toothFdi;
    let dir: THREE.Vector3 | undefined;
    if (fdi !== undefined && s.tooth?.frame) {
      const f = s.tooth.frame;
      dir = new THREE.Vector3(...f.buccal).multiplyScalar(0.9).add(new THREE.Vector3(...f.axis).multiplyScalar(0.35)).add(new THREE.Vector3(0, 0, 0.25));
    } else if (fdi !== undefined) {
      const f = this.registry.get(`tooth-${fdi}`)?.tooth?.frame;
      if (f) dir = new THREE.Vector3(...f.buccal).add(new THREE.Vector3(...f.axis).multiplyScalar(0.25));
    }
    if (s.surfaceFeature && fdi !== undefined) {
      const t = this.registry.get(`tooth-${fdi}`)?.tooth;
      if (t?.frame) {
        const facial = s.surfaceFeature === 'labial-ridge' || s.surfaceFeature === 'buccal-ridge';
        dir = new THREE.Vector3(...(!facial && t.type.includes('molar') ? t.frame.axis : t.frame.buccal)).multiplyScalar(facial || t.type.includes('molar') ? 1 : -1);
      }
    }
    const landmark = s.kind === 'landmark' ? this.landmarkPosition(s) : null;
    if (landmark) {
      this.rig.focusSphere(landmark, 0.6, { direction: dir });
      return;
    }
    const box = this.boundsOf(id, true, restPose);
    if (box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const padding = s.kind === 'group' && sphere.radius > 2 ? 1.1 : 1.45;
    let distance: number | undefined;
    if (restPose) {
      const height = this.container.clientHeight, width = this.container.clientWidth;
      const tanH = Math.tan(THREE.MathUtils.degToRad(this.rig.camera.fov) / 2);
      const usableH = tanH * Math.max(this.insetTarget.top ? .15 : .25, (height - this.insetTarget.bottom - this.insetTarget.top - (this.insetTarget.top ? 60 : 100)) / height);
      const usableW = tanH * this.rig.camera.aspect * Math.max(.3, (width - this.insetTarget.right - this.insetTarget.left - 40) / width);
      distance = sphere.radius / Math.sin(Math.atan(Math.min(usableH, usableW))) * 1.12;
    }
    this.rig.focusSphere(sphere.center, sphere.radius, { direction: dir, padding, distance, movePivot: restPose });
  }

  async showPassage(id: string) {
    const ids = passageFor(this.registry, id);
    if (!ids.length) return;
    const geos = await this.loader.load('neurovascular.glb');
    this.addGeometries(geos);
    if (getState().dissectFdi !== null) actions.exitDissect();
    actions.openJawControls(false);
    actions.setCategories(PRESETS.find((p) => p.id === 'nerve-muscles')!.state);
    actions.select(id);
    setState({ passageIds: ids, labels: true, explode: 0, explodePhase: 1, orbitMode: 'free' });
    const box = new THREE.Box3();
    for (const routeId of ids) {
      const item = this.registry.require(routeId);
      const anchor = item.kind === 'landmark' ? this.landmarkPosition(item) : null;
      if (anchor) box.expandByPoint(anchor);
      else box.union(this.boundsOf(routeId, false));
    }
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const side = id.endsWith('-right') ? -1 : 1;
    this.rig.focusSphere(sphere.center, Math.max(0.7, sphere.radius), { direction: new THREE.Vector3(side, 0.15, 0.6), padding: 1.25 });
  }

  async showJaw(side: 'right' | 'left' = 'right') {
    this.addGeometries(await this.loader.load('context.glb'));
    const categories = { ...getState().categories };
    for (const key of Object.keys(categories) as (keyof typeof categories)[]) categories[key] = 'off';
    Object.assign(categories, { tmj: 'on', mandible: 'on', 'alveolar-bone': 'ghost', skull: 'ghost', muscles: 'on', 'permanent-teeth': 'ghost', enamel: 'ghost', dentin: 'ghost', cementum: 'ghost' });
    actions.setCategories(categories);
    actions.openJawControls(true);
    const other = side === 'right' ? 'left' : 'right';
    const hidden: Record<string, true> = { 'mandibular-canal-right': true, 'mandibular-canal-left': true };
    for (const structure of this.registry.byId.values()) {
      if (structure.id.endsWith(`-${other}`) && structure.categories.some((c) => c === 'tmj' || c === 'muscles')) hidden[structure.id] = true;
    }
    setState({ orbitMode: 'free', labels: true, jawSide: side, ghosted: { 'mandible-body': true }, hidden });
    const id = `tmj-${side}`;
    actions.select(id);
    // Selecting on a phone opens Details; keep the movement controls reachable.
    if (isCompactLayout()) actions.setMobileSheet('tools');
    this.focus(id);
    const joint = this.registry.manifest.landmarks[`condyle-top-${side}`];
    if (joint) this.rig.focusSphere(new THREE.Vector3(...joint).add(new THREE.Vector3(0, -0.3, 0.35)), 2.7, { direction: new THREE.Vector3(side === 'right' ? -1 : 1, 0.12, 0.25), padding: 1.15 });
  }

  subscribeJawProgress(callback: (opening: number) => void): () => void {
    this.jawProgressListeners.add(callback);
    callback(this.jawCur);
    return () => { this.jawProgressListeners.delete(callback); };
  }

  /** UI progress updates stay out of the React/Zustand render cycle. */
  subscribeDevelopmentProgress(callback: (position: number) => void): () => void {
    this.developmentProgressListeners.add(callback);
    callback(this.developmentScene.timelinePosition);
    return () => { this.developmentProgressListeners.delete(callback); };
  }

  private notifyDevelopmentProgress() {
    const position = this.developmentScene.timelinePosition;
    if (position === this.developmentProgress) return;
    this.developmentProgress = position;
    for (const callback of this.developmentProgressListeners) callback(position);
  }

  pauseJaw() { actions.setJawOpening(this.jawCur); }

  closeJaw() {
    actions.openJawControls(false);
    actions.resetVisibility();
    actions.select(null);
    setState({ orbitMode: 'fixed', labels: false, clip: { ...getState().clip, enabled: false } });
    this.resetToStart();
  }

  playJaw() { actions.setJawOpening(this.jawCur, true); }

  /** World position of a landmark: its anchor, moved with its parent mesh (explode offsets). */
  private landmarkPosition(s: Structure): THREE.Vector3 | null {
    if (!s.anchor) return null;
    const parentKey = s.surfaceFeature && s.toothFdi !== undefined ?
      (this.entries.get(`enamel-${s.toothFdi}`)?.visual === 'on' ? `enamel-${s.toothFdi}` : `tooth-${s.toothFdi}`) : landmarkHost(this.registry, s.id);
    const pos = new THREE.Vector3(...s.anchor);
    const parent = parentKey ? this.entries.get(parentKey) : undefined;
    return parent ? parent.mesh.localToWorld(pos) : pos;
  }

  /** Structure bounds in the current world pose, or the assembled geometry for entry framing. */
  boundsOf(id: string, visibleOnly: boolean, restPose = false): THREE.Box3 {
    const box = new THREE.Box3();
    const keys = this.registry.meshesOf(id);
    const tmp = new THREE.Box3();
    for (const k of keys) {
      const e = this.entries.get(k);
      if (e) {
        if (visibleOnly && e.visual === 'off' && keys.some((kk) => this.entries.get(kk)?.visual !== 'off')) continue;
        e.mesh.updateMatrixWorld(true);
        tmp.copy(e.mesh.geometry.boundingBox!);
        if (!restPose) tmp.applyMatrix4(e.mesh.matrixWorld);
        box.union(tmp);
      } else {
        const m = this.registry.manifest.meshes[k];
        if (m) box.union(new THREE.Box3(new THREE.Vector3(...m.bounds[0]), new THREE.Vector3(...m.bounds[1])));
      }
    }
    const s = this.registry.get(id);
    if (box.isEmpty() && s?.toothFdi !== undefined) return this.boundsOf(`tooth-${s.toothFdi}`, false, restPose);
    return box;
  }

  setView(p: ViewPreset) {
    this.cancelArchPreparation?.();
    const { dissectFdi, selectedId } = getState();
    setState({ view: p });
    if (this.developmentScene.active) { this.frameDevelopment(p); return; }
    // inside a tooth, or with a structure isolated, frame just that
    const framed = dissectFdi !== null ? this.boundsOf(`tooth-${dissectFdi}`, false) : selectedId && getState().isolateId ? this.boundsOf(selectedId, true) : null;
    if (framed && !framed.isEmpty()) {
      const sph = framed.getBoundingSphere(new THREE.Sphere());
      this.rig.preset(p, sph.center, sph.radius * 1.2);
    } else if (getState().explode > 0 && getState().explodePhase === 1) {
      // the separated jaws need a wider frame than the assembled mouth
      this.reframeForExplode(getState(), p);
    } else if (getState().explode === 0 && getState().explodePhase === 1 && !getState().jawControls) {
      if (p === 'front') this.startView();
      else {
        const skull = this.skullBounds.getBoundingSphere(new THREE.Sphere());
        this.rig.preset(p, skull.center, skull.radius);
      }
    } else {
      this.rig.preset(p);
    }
  }

  /** Fit the projected skull box into the space above the timeline. A sphere fit
   * leaves a tall skull unnecessarily tiny on narrow screens. */
  private frameDevelopment(preset?: ViewPreset) {
    const box = this.developmentScene.bounds;
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const direction = (preset ? PRESET_DIRS[preset].clone() : this.rig.camera.position.clone().sub(this.rig.controls.target)).normalize();
    const right = new THREE.Vector3().crossVectors(this.rig.camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    const width = this.container.clientWidth, height = this.container.clientHeight;
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.rig.camera.fov / 2));
    const tanW = tanH * this.rig.camera.aspect * Math.max(0.15, (width - this.insetTarget.right - this.insetTarget.left) / width);
    const usableH = tanH * Math.max(0.15, (height - this.insetTarget.bottom - this.insetTarget.top - 90) / height);
    let distance = 0;
    const point = new THREE.Vector3();
    // Fit actual surfaces rather than empty corners of the overall skull box.
    for (const child of this.developmentScene.root.children) {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry>;
      if (!mesh.visible) continue;
      const positions = mesh.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).sub(center);
        distance = Math.max(distance, point.dot(direction) + Math.abs(point.dot(right)) / tanW, point.dot(direction) + Math.abs(point.dot(up)) / usableH);
      }
    }
    this.rig.focusSphere(center, box.getBoundingSphere(new THREE.Sphere()).radius, { direction, distance: distance * 1.03, duration: this.developmentScene.remainingSeconds || 0.65 });
  }

  /** Default framing: the whole dentition, or the dissected tooth (setView frames it). */
  captureImage() {
    this.renderer.render(this.scene, this.rig.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  resetCamera() {
    if (getState().developmentStage) return this.setView('three-quarter');
    if (getState().dissectFdi !== null) return this.setView('three-quarter');
    if (getState().explode === 0 && getState().explodePhase === 1) return this.resetToStart();
    setState({ view: 'three-quarter' });
    this.rig.home_();
  }

  /** Fresh start: the assembled skull centred in a straight-on front view. */
  resetToStart() {
    this.cancelArchPreparation?.();
    this.updatePivot();
    if (getState().developmentStage) return this.setView('three-quarter');
    this.startView();
  }

  /**
   * Re-pack and frame the laid-out board. Quiz mode jumps straight to the
   * board, so the first pack can happen before every tooth shell has loaded;
   * once the last shell arrives this points the camera at the complete set.
   */
  frameBoard() {
    if (getState().explodePhase !== 2) return;
    this.layoutBoard(true);
  }

  /** Start with the whole skull centred and visible above the controls. */
  private startView(duration = 0.9) {
    if (getState().view !== 'front') setState({ view: 'front' });
    const cam = this.rig.camera;
    const frame = skullOverviewFrame(this.skullBounds, cam.fov, {
      width: this.container.clientWidth, height: this.container.clientHeight, ...this.insetTarget,
    });
    this.rig.focusSphere(frame.target, frame.radius, { direction: PRESET_DIRS.front, distance: frame.distance, duration, movePivot: true });
    this.invalidate();
  }

  /** Play first establishes the close dental view, then starts separation.
   * Cancellation leaves the current camera/orbit centre where the user paused. */
  prepareArchDissection(ready: () => void, cancelled: () => void): () => void {
    this.cancelArchPreparation?.();
    clearTimeout(this.explodeTimer);
    this.explodeTimer = 0;
    this.explodePreset = undefined;
    this.preparingArch = true;
    let active = true;
    const cancel = () => {
      if (!active) return;
      active = false;
      this.preparingArch = false;
      this.cancelArchPreparation = undefined;
      this.animator.cancel('camera');
      cancelled();
    };
    this.cancelArchPreparation = cancel;
    setState({ view: 'front', autoRotate: false });
    const frame = dentitionFrame(this.skullBounds, this.rig.home.target, this.rig.camera.fov, this.rig.camera.aspect);
    this.rig.focusSphere(frame.target, frame.radius, {
      direction: PRESET_DIRS.front, distance: frame.distance, duration: 0.8, movePivot: true,
      done: () => {
        if (!active) return;
        active = false;
        this.preparingArch = false;
        this.cancelArchPreparation = undefined;
        ready();
      },
    });
    this.invalidate();
    return cancel;
  }

  zoom(f: number) {
    this.cancelArchPreparation?.();
    this.rig.zoom(f);
  }

  orbit(dx: number, dy: number) {
    this.cancelArchPreparation?.();
    this.rig.orbit(dx, dy);
    this.invalidate();
  }

  invalidate() {
    this.needsRender = true;
  }

  /* ============================================================== loop */

  /**
   * Shift the optical centre away from UI that covers the canvas (detail panel,
   * mobile bottom sheet) so the focused anatomy stays visible. Animated.
   */
  setInsets(right: number, bottom: number, left = 0, top = 0) {
    const from = { ...this.insets };
    const t = this.insetTarget;
    if (t.right === right && t.bottom === bottom && t.left === left && t.top === top) return;
    this.insetTarget = { right, bottom, left, top };
    // still on the untouched start view (e.g. the panels just measured on load): refit it
    const s = getState();
    const first = !this.insetsKnown;
    this.insetsKnown = true;
    if (s.developmentStage) this.frameDevelopment(s.view ?? undefined);
    else if (s.guideOpen && s.studyView === 'nerves' && !s.selectedId) this.frameNerves();
    else if (s.guideOpen && s.selectedId && this.registry.get(s.selectedId)?.tooth) {
      // Search selection and its caption/tray render in separate frames; fit again once measured.
      this.focus(s.selectedId, { restPose: true });
    }
    else if (!this.preparingArch && s.view === 'front' && !s.selectedId && s.dissectFdi === null) {
      if (s.explode > 0 && s.explodePhase === 1) this.reframeForExplode(s);
      else if (s.explodePhase === 1) this.startView(first ? 0 : 0.35);
    }
    this.animator.run('insets', first ? 0 : 0.35, (k) => {
      this.insets.right = from.right + (right - from.right) * k;
      this.insets.bottom = from.bottom + (bottom - from.bottom) * k;
      this.insets.left = from.left + (left - from.left) * k;
      this.insets.top = from.top + (top - from.top) * k;
      this.applyViewOffset();
    });
    // Quiz jumps straight to the board before the bottom sheet has been measured;
    // re-pack and re-fit once the clear area is known so no tooth hides behind it.
    if (getState().mode === 'quiz' && getState().explodePhase === 2) {
      clearTimeout(this.boardTimer);
      this.boardTimer = window.setTimeout(() => this.layoutBoard(true), 150);
    }
  }

  private applyViewOffset() {
    if (!this.container) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const cam = this.rig.camera;
    if (this.insets.right || this.insets.bottom || this.insets.left || this.insets.top) cam.setViewOffset(w, h, (this.insets.right - this.insets.left) / 2, (this.insets.bottom - this.insets.top) / 2, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    this.invalidate();
  }

  private resize() {
    if (!this.container || !this.renderer) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    const ratio = renderPixelRatio(w, h, window.devicePixelRatio, matchMedia('(pointer: coarse)').matches);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / Math.max(h, 1);
    this.applyViewOffset();
    if (getState().developmentStage) this.frameDevelopment(getState().view ?? undefined);
    else if (this.insetsKnown && !this.preparingArch && getState().view === 'front' && getState().explode === 0 && getState().explodePhase === 1 && !getState().selectedId && getState().dissectFdi === null) this.startView(0);
    // re-pack the phase-2 board when the viewport shape really changes (e.g. a phone is rotated),
    // not for small resizes such as a mobile address bar, so the user's own camera move is kept
    if (getState().explodePhase === 2 && Math.abs(Math.log(this.rig.camera.aspect / this.boardAspect)) > 0.2) {
      clearTimeout(this.boardTimer);
      this.boardTimer = window.setTimeout(() => this.layoutBoard(true), 250);
    }
  }

  private loop = () => {
    if (this.disposed || document.hidden) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;

    const controlsMoved = this.rig.controls.update(dt);
    const pivotMoved = this.rig.tick(dt, controlsMoved);
    const controlsChanged = controlsMoved || pivotMoved;
    const animating = this.animator.active;
    this.animator.tick(dt);
    const heldAdult = this.developmentScene.holdsAdult;
    const growthActive = this.developmentScene.active;
    const growthChanged = this.developmentScene.tickPlayback(dt * this.playbackSpeed, () => actions.advanceDevelopment(), this.animator.reducedMotion);
    this.notifyDevelopmentProgress();
    if (heldAdult !== this.developmentScene.holdsAdult) this.refreshVisibility();
    if (growthActive && !this.developmentScene.active) { this.updatePivot(); this.refreshLabels(); this.resetToStart(); }
    // Once effects settle, avoid walking every mesh on each idle animation frame.
    const fx = this.needsRender || this.visualsMoving || animating || growthChanged ? this.tickVisuals(dt * this.playbackSpeed) : false;
    this.visualsMoving = fx;
    if (controlsChanged || animating || fx || growthChanged) this.pointerDirty = true;
    this.updateHover();
    if (controlsChanged || animating) this.rig.updateClipping();
    const jawMoved = this.clipJaw !== this.jawCur;
    this.clipJaw = this.jawCur;
    if (getState().clip.enabled && (controlsChanged || animating || jawMoved)) this.refreshClip();

    if (!(this.needsRender || controlsChanged || animating || fx || growthChanged)) return;
    this.needsRender = false;
    this.toothLight.visible = getState().dissectFdi !== null;
    this.overviewLights.visible = !this.toothLight.visible;
    this.scene.environmentIntensity = this.toothLight.visible ? .23 : THEME_LIGHTING[getState().theme].environment;
    // An oblique camera-relative key keeps the maxillary occlusal table lit,
    // while its slopes still receive different light in every study view.
    const studyDistance = this.rig.camera.position.distanceTo(this.rig.controls.target);
    this.studyLightOffset.set(-.65, .55, 0).applyQuaternion(this.rig.camera.quaternion).multiplyScalar(studyDistance);
    this.toothLight.position.copy(this.rig.camera.position).add(this.studyLightOffset);
    this.toothLight.target.position.copy(this.rig.controls.target);
    this.renderer.render(this.scene, this.rig.camera);
    const r = this.renderer.domElement;
    this.labels?.update(this.rig.camera, r.clientWidth, r.clientHeight, now, !(controlsChanged || animating || fx));
  };

  private visibilityChange = () => {
    cancelAnimationFrame(this.raf);
    if (document.hidden || this.disposed) return;
    this.lastT = performance.now();
    this.invalidate();
    this.loop();
  };

  /** Animate opacity, highlight, explode offsets and marker. Returns true while anything is moving. */
  private tickVisuals(dt: number): boolean {
    const s = getState();
    let moving = false;
    const previousJaw = this.jawCur;
    if (s.jawPlaying) {
      this.jawCur = Math.max(0, Math.min(1, this.jawCur + dt / 2.5 * this.jawDirection));
      if (this.jawCur >= 1) this.jawDirection = -1;
      else if (this.jawCur <= 0 && this.jawDirection < 0) actions.setJawOpening(0);
      moving = true;
    } else this.jawCur = s.jawOpening;
    const jawChanged = previousJaw !== this.jawCur;
    this.jawProgressTime += dt;
    if (this.jawProgressTime >= 0.1 || jawChanged && !s.jawPlaying) {
      this.jawProgressTime = 0;
      for (const callback of this.jawProgressListeners) callback(this.jawCur);
    }
    const mandiblePose = jawMatrix(this.registry.manifest, this.jawCur);
    const discPose = jawMatrix(this.registry.manifest, this.jawCur, true);
    const k = 1 - Math.exp(-dt * 14);
    const instant = this.animator.reducedMotion;
    const rate = instant ? 1 : k;
    const boardK = instant ? 1 : k * 0.55; // board moves are a little slower

    const ex = s.explode;
    if (Math.abs(this.explodeCur - ex) > 1e-4) {
      this.explodeCur = stepToward(this.explodeCur, ex, rate, 1e-3);
      moving = true;
    }
    const phase = s.explodePhase === 2 ? 1 : 0;
    if (Math.abs(this.phaseCur - phase) > 1e-4) {
      this.phaseCur = stepToward(this.phaseCur, phase, boardK, 1e-3);
      moving = true;
    }
    const tex = s.dissectFdi !== null ? s.toothExplode : 0;
    if (Math.abs(this.toothExplodeCur - tex) > 1e-4) {
      this.toothExplodeCur = stepToward(this.toothExplodeCur, tex, rate, 1e-3);
      moving = true;
    }

    const pulpMode = s.dissectFdi !== null && s.dissectLevel === DISSECT_LEVELS.length - 1 ? 1 : 0;
    if (Math.abs(this.pulpModeCur - pulpMode) > 1e-4) {
      this.pulpModeCur = stepToward(this.pulpModeCur, pulpMode, rate, 1e-3);
      moving = true;
    }

    // label occlusion only needs recomputing when meshes move or appear/disappear
    let layoutChanged = jawChanged;
    const prevPos = new THREE.Vector3();
    for (const e of this.entries.values()) {
      let target = visualOpacity(e.visual, s.ghostOpacity);
      if (e.nv) {
        const dissecting = s.explodePhase === 1 && s.dissectFdi === null ? Math.min(1, this.explodeCur * 2.5) : 0;
        const quietTarget = s.passageIds.includes(e.owner) || s.studyView === 'vessels' && this.registry.require(e.owner).categories.some(c => c === 'arteries' || c === 'veins') ? 0 : quietLevel(e, dissecting);
        if (Math.abs(e.quiet! - quietTarget) > 1e-3) {
          e.quiet = stepToward(e.quiet!, quietTarget, rate, 0.01);
          const mat = e.mesh.material;
          mat.color.copy(themedColor(mat.userData.styleKey, s.theme)).lerp(QUIET_TINT[s.theme], QUIET_MIX * e.quiet);
          moving = true;
        }
        target *= quietOpacity(e, e.quiet!);
      }
      if (e.sinus) target *= SINUS_OPACITY;
      if (e.key.startsWith('mandibular-canal-')) target = s.passageIds.includes(e.owner) && e.visual !== 'off' ? 0.22 : target * 0.22;
      if (s.explodePhase === 2 && !e.boardTarget) target = 0; // context is not laid out: fade it away
      if (Math.abs(e.opacity - target) > 1e-3) {
        e.opacity = stepToward(e.opacity, target, rate, 0.01);
        moving = true;
      }
      const vis = e.opacity > 0.005;
      if (e.mesh.visible !== vis) {
        e.mesh.visible = vis;
        layoutChanged = true;
      }
      if (vis) {
        setMaterialOpacity(e.mesh.material, e.opacity);
        e.mesh.renderOrder = e.opacity < 0.999 ? 10 : 0;
      }
      if (Math.abs(e.hi - e.hiTarget) > 1e-3) {
        e.hi = stepToward(e.hi, e.hiTarget, instant ? 1 : Math.min(1, k * 1.6), 0.01);
        e.mesh.material.userData.fx.uHi.value = e.hi;
        moving = true;
      }
      const toothPart = s.dissectFdi !== null && this.registry.get(e.owner)?.toothFdi === s.dissectFdi;
      prevPos.copy(e.mesh.position);
      e.mesh.position.copy(e.archOffset).multiplyScalar(this.explodeCur);
      if (e.rootCut) {
        // Roots below the gum line are never drawn while the gum is shown: assembled, the thin
        // see-through bone would otherwise show them sticking out under the gum; while a tooth
        // slides out, the part still inside the gum is cut away so a flared root never shows
        // through the narrower gum collar.
        e.mesh.material.userData.fx.uRootCut.value =
          this.explodeCur < 1e-3 ? ROOT_CUT_REST : e.rootCut.collar - this.explodeCur * e.rootCut.extract;
      }
      if (e.mesh.morphTargetInfluences) {
        const stretch = this.explodeCur * (1 - this.phaseCur);
        if (e.mesh.morphTargetInfluences[0] !== stretch) e.mesh.morphTargetInfluences[0] = stretch;
        if (e.mesh.morphTargetInfluences.length > 1) e.mesh.morphTargetInfluences[1] = this.jawCur;
      }
      if (toothPart) e.mesh.position.addScaledVector(this.tmpOffset.lerpVectors(e.toothOffset, e.pulpOffset, this.pulpModeCur), this.toothExplodeCur);
      if (e.boardPos && this.phaseCur > 0) {
        if (e.boardTarget && e.boardPos.distanceToSquared(e.boardTarget) > 1e-8) {
          e.boardPos.lerp(e.boardTarget, boardK);
          moving = true;
        }
        e.mesh.position.lerp(e.boardPos, this.phaseCur);
      }
      if (!layoutChanged && !prevPos.equals(e.mesh.position)) layoutChanged = true;
      e.mesh.matrix.makeTranslation(e.mesh.position.x, e.mesh.position.y, e.mesh.position.z);
      const rigid = rigidJawPart(e.key, this.registry.get(e.owner)?.toothFdi);
      if (rigid) e.mesh.matrix.premultiply(rigid === 'disc' ? discPose : mandiblePose);
      e.mesh.matrixWorldNeedsUpdate = true;
      e.mesh.updateMatrixWorld(true);
    }
    // while Quiz is active the surface features of the *selected* tooth are overlaid on the
    // board shell (not a dissected tooth); labels stay off, so nothing reveals the answer
    const host = s.dissectFdi !== null ? this.entries.get(`enamel-${s.dissectFdi}`) : undefined;
    const quizSurfaceFdi = s.mode === 'quiz' && s.selectedId ? (this.registry.get(s.selectedId)?.toothFdi ?? null) : null;
    const surfaceFdi = s.mode === 'quiz' ? quizSurfaceFdi : s.dissectFdi;
    const surfaceHost = (s.mode === 'quiz' && surfaceFdi !== null ? this.entries.get(`tooth-${surfaceFdi}`) : undefined) ?? host;
    const surfaceEnabled = surfaceFdi !== null && s.surfaceFeatures && !s.clip.enabled && !this.developmentScene.active && (s.mode === 'quiz' || s.dissectLevel <= 1);
    this.surfaceLayer.update(surfaceFdi, surfaceEnabled, surfaceHost?.mesh, s.selectedId);
    if (layoutChanged) this.labels?.markSceneChanged();

    const st = s.selectedId ? this.registry.get(s.selectedId) : undefined;
    this.marker.visible = !!st && st.kind === 'landmark' && !!st.anchor &&
      (!st.surfaceFeature || s.surfaceFeatures && s.dissectLevel <= 1 && !s.clip.enabled && !!host?.mesh.visible);
    (this.marker.material as THREE.MeshBasicMaterial).depthTest = !!st?.surfaceFeature;
    (this.marker.material as THREE.MeshBasicMaterial).depthWrite = false;
    const markerAt = this.marker.visible && st ? this.landmarkPosition(st) : null;
    if (markerAt) {
      this.marker.position.copy(markerAt);
      const d = this.rig.camera.position.distanceTo(this.marker.position);
      const pulse = this.animator.reducedMotion ? 1 : 1 + 0.18 * Math.sin(performance.now() / 260);
      this.marker.scale.setScalar(d * 0.0075 * pulse);
      if (!this.animator.reducedMotion) moving = true;
    }
    return moving;
  }
}

/* ------------------------------------------------------------------ helpers */

/** Accelerated ray test while the morph is at rest, the plain (morph-following) one while stretched. */
function morphAwareRaycast(this: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) {
  if (this.morphTargetInfluences?.some((v) => v !== 0)) THREE.Mesh.prototype.raycast.call(this, raycaster, hits);
  else acceleratedRaycast.call(this, raycaster, hits);
}

/** Mesh visuals that are shown in full (laid out on the board, framed, labelled): opaque or see-through bone. */
function isFullyShown(v: MeshVisual): boolean {
  return v === 'on' || v === 'see-through';
}

/** Resting opacity for a mesh visual (before the nerve and vessel fade and the board fade-out). */
function visualOpacity(v: MeshVisual, ghostOpacity: number): number {
  return v === 'on' ? 1 : v === 'see-through' ? SEE_THROUGH_OPACITY : v === 'ghost' ? ghostOpacity : v === 'faint' ? ghostOpacity * 0.45 : 0;
}

/** FDI number of a tooth shell mesh key ("tooth-36" → 36), or null for any other mesh. */
function shellFdi(key: string): number | null {
  const m = /^tooth-(\d{2})$/.exec(key);
  return m ? Number(m[1]) : null;
}

/** tan(vertical fov / 2): converts a half-height in view to the camera distance that fits it. */
function tanHalfFov(cam: THREE.PerspectiveCamera): number {
  return Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
}

/** Along the tooth axis from the cervical line (cm): where the gum collar hides the root in the assembled mouth. */
const ROOT_CUT_REST = -0.12;

const QUIET_MIX = 0.6;
const QUIET_TINT = { light: new THREE.Color('#d8d2c6'), dark: new THREE.Color('#3a3833') };

/** Sinus volumes stay translucent so the surrounding anatomy remains visible. */
const SINUS_OPACITY = 0.55;

/** Bone opacity while the nerve and vessel layers are on. */
const SEE_THROUGH_OPACITY = 0.32;

/** One easing step from `cur` toward `target`, snapping to the target once within `snap`. */
function stepToward(cur: number, target: number, rate: number, snap: number): number {
  const next = cur + (target - cur) * rate;
  return Math.abs(next - target) < snap ? target : next;
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r(null)));
}
