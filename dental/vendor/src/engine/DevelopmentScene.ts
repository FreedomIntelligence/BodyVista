import * as THREE from 'three';
import { DEVELOPMENT_MORPH_SECONDS, DEVELOPMENT_STAGES, DEVELOPMENT_TEETH, developmentAge, developmentStatus, successorFdi, type DevelopmentStageId, type DevelopmentTooth } from '../anatomy/development';
import type { Registry } from '../anatomy/registry';
import type { CategoryId } from '../anatomy/types';
import type { AppState } from '../state/store';
import { applyThemeToMaterial, createTissueMaterial, setMaterialOpacity, styleKeyFor, type TissueMaterial } from './materials';
import { easeInOutCubic } from './animator';
import { resolveMesh } from '../state/visibility';

/** Illustrative proportions, NOT fitted pediatric measurements. One spatial
 * deformation keeps atlas bones and tissues connected. Cranial maturation
 * precedes facial maturation (Bastir et al., J Anat 2006); that paper does not
 * supply these coefficients or validate this geometry. */
export function developmentPoint(point: THREE.Vector3, stage: DevelopmentStageId): THREE.Vector3 {
  const maturity = developmentAge(stage) / 18;
  const cranial = 0.73 + 0.27 * maturity;
  const facial = 0.43 + 0.57 * maturity;
  const blend = THREE.MathUtils.smoothstep(point.y, 5, 11);
  point.x *= THREE.MathUtils.lerp(facial, cranial, blend);
  point.y = 6 + (point.y - 6) * THREE.MathUtils.lerp(0.42 + 0.58 * maturity, cranial, blend);
  point.z = -5 + (point.z + 5) * THREE.MathUtils.lerp(0.47 + 0.53 * maturity, cranial, blend);
  return point;
}

interface Source { geometry: THREE.BufferGeometry; categories: CategoryId[] }
interface Visual { mesh: THREE.Mesh<THREE.BufferGeometry, TissueMaterial>; tooth?: DevelopmentTooth; jaw: boolean; soft: boolean; leaving?: boolean; opacityFrom?: number; colorFrom?: THREE.Color }
interface Pose extends Visual { visible: boolean; color: THREE.Color; opacity: number }
const BONES: CategoryId[] = ['skull', 'maxilla', 'mandible', 'alveolar-bone'];
const SUPPORT: CategoryId[] = ['gingiva', 'muscles', 'nerves', 'arteries', 'veins', 'salivary', 'tmj'];

/** Non-selectable, live 3D teaching scene. Original atlas geometries stay immutable;
 * only owned clones are reshaped/disposed. No pediatric imaging is bundled. */
export class DevelopmentScene {
  readonly root = new THREE.Group();
  readonly bounds = new THREE.Box3();
  private sources = new Map<string, Source>();
  private visuals: Visual[] = [];
  private stage: DevelopmentStageId | null = null;
  private dirty = false;
  private state: AppState | null = null;
  private transition: { elapsed: number; autoplay: boolean } | null = null;
  private timelineFrom: number = DEVELOPMENT_STAGES.length;
  private timelineTo: number = DEVELOPMENT_STAGES.length;
  private reducedPlaybackElapsed = 0;

  get active() { return this.root.visible; }
  private get progress() {
    if (!this.transition) return 1;
    const fraction = this.transition.elapsed / DEVELOPMENT_MORPH_SECONDS;
    return this.transition.autoplay ? fraction : easeInOutCubic(fraction);
  }
  /** Autoplay stays at constant speed across checkpoints; manual seeks ease. */
  get timelinePosition() {
    return THREE.MathUtils.lerp(this.timelineFrom, this.timelineTo, this.progress);
  }
  get remainingSeconds() { return this.transition ? DEVELOPMENT_MORPH_SECONDS - this.transition.elapsed : 0; }
  get holdsAdult() { return this.active && this.stage === null && !!this.transition && this.transition.elapsed / DEVELOPMENT_MORPH_SECONDS < 0.85; }

  constructor(private registry: Registry) { this.root.visible = false; }

  addSource(key: string, geometry: THREE.BufferGeometry, categories: CategoryId[]) {
    if (!/^tooth-\d\d$/.test(key) && !categories.some((c) => BONES.includes(c) || SUPPORT.includes(c))) return;
    // Detailed tooth layers are adult-only. Sinus cavities, sutures and fontanelles
    // have no age-specific reconstruction and are not invented here.
    if (this.registry.get(this.registry.meshOwner.get(key) ?? '')?.toothFdi && !/^tooth-\d\d$/.test(key)) return;
    this.sources.set(key, { geometry, categories });
    this.dirty = true;
  }

  update(state: AppState, animate = false, autoplay = false) {
    this.state = state;
    if (this.stage !== state.developmentStage || this.dirty) {
      this.reducedPlaybackElapsed = 0;
      const position = this.timelinePosition;
      const previous = animate && this.active ? this.capture() : new Map<string, Pose>();
      this.stage = state.developmentStage;
      if (this.stage) this.rebuild(this.stage);
      else if (previous.size) this.rebuildAdult();
      else this.clear();
      this.dirty = false;
      if (previous.size) this.beginTransition(previous, autoplay);
      this.timelineFrom = position;
      this.timelineTo = this.stage ? DEVELOPMENT_STAGES.findIndex((stage) => stage.id === this.stage) : DEVELOPMENT_STAGES.length;
    }
    this.root.visible = !!this.stage || !!this.transition;
    if (this.transition && state.developmentPlaying && !this.transition.autoplay) {
      // Taking over a manual seek must retain its currently displayed pose.
      this.transition.elapsed = this.progress * DEVELOPMENT_MORPH_SECONDS;
      this.transition.autoplay = true;
    }
    this.applyAppearance();
  }

  /** The render clock owns playback: no timer gaps or easing stops at milestones.
   * Carry the unused part of a boundary frame into the next growth segment. */
  tickPlayback(dt: number, advance: () => void, reducedMotion = false): boolean {
    if (reducedMotion) {
      if (this.state?.developmentPlaying) {
        this.reducedPlaybackElapsed += dt;
        if (this.reducedPlaybackElapsed >= DEVELOPMENT_MORPH_SECONDS) advance();
      }
      return this.tick(dt);
    }
    if (this.state?.developmentPlaying && !this.transition) advance();
    const remaining = this.remainingSeconds;
    let changed = this.tick(dt);
    if (this.state?.developmentPlaying && !this.transition) {
      advance();
      changed = this.tick(Math.max(0, dt - remaining)) || changed;
    }
    return changed;
  }

  /** Frame updates change GPU morph influences, never rebuild vertices. */
  tick(dt: number): boolean {
    if (!this.transition || !this.state) return false;
    if (this.transition.autoplay && this.stage && !this.state.developmentPlaying) return false;
    this.transition.elapsed = Math.min(DEVELOPMENT_MORPH_SECONDS, this.transition.elapsed + dt);
    const k = this.progress;
    for (const visual of this.visuals) visual.mesh.morphTargetInfluences![0] = 1 - k;
    this.applyAppearance();
    if (this.transition.elapsed >= DEVELOPMENT_MORPH_SECONDS) this.finishTransition();
    return true;
  }

  finishTransition() {
    this.transition = null;
    if (!this.stage) { this.clear(); this.root.visible = false; return; }
    this.visuals = this.visuals.filter((visual) => {
      if (visual.leaving) { this.root.remove(visual.mesh); visual.mesh.geometry.dispose(); visual.mesh.material.dispose(); return false; }
      if (visual.mesh.morphTargetInfluences) visual.mesh.morphTargetInfluences[0] = 0;
      visual.opacityFrom = undefined;
      visual.colorFrom = undefined;
      return true;
    });
    this.applyAppearance();
  }

  private applyAppearance() {
    const state = this.state;
    if (!state) return;
    const k = this.progress;
    // The original adult scene fades in over the end of the final growth step.
    const adultFade = !this.stage && this.transition ? 1 - THREE.MathUtils.smoothstep(this.transition.elapsed / DEVELOPMENT_MORPH_SECONDS, 0.85, 1) : 1;
    for (const visual of this.visuals) {
      const status = visual.tooth && this.stage ? developmentStatus(visual.tooth, this.stage) : null;
      let opacity = visual.leaving ? 0 : visual.jaw && state.developmentShowUnerupted ? 0.22 : visual.soft ? 0.62 : 1;
      let visible = (!visual.soft || state.developmentSoftTissue) && (status !== 'unerupted' || state.developmentShowUnerupted);
      if (!this.stage) {
        const visibility = resolveMesh(visual.mesh.name.replace('growth-', ''), { registry: this.registry, state, loadedTeeth: new Set() });
        opacity = visibility === 'on' ? 1 : visibility === 'see-through' ? 0.22 : visibility === 'ghost' ? state.ghostOpacity : visibility === 'faint' ? 0.08 : 0;
        visible = opacity > 0;
      }
      const interpolated = THREE.MathUtils.lerp(visual.opacityFrom ?? opacity, opacity, k) * adultFade;
      visual.mesh.visible = (visible || !!visual.leaving) && interpolated > 0.001;
      applyThemeToMaterial(visual.mesh.material, state.theme);
      if (visual.colorFrom) visual.mesh.material.color.lerp(visual.colorFrom, 1 - k);
      setMaterialOpacity(visual.mesh.material, interpolated);
      visual.mesh.renderOrder = visual.jaw && state.developmentShowUnerupted ? 2 : 0;
    }
  }

  /** Bake the currently displayed pose only when seeking interrupts a transition. */
  private capture(): Map<string, Pose> {
    return new Map(this.visuals.map((visual) => {
      const geometry = this.clone(visual.mesh.geometry);
      const influence = visual.mesh.morphTargetInfluences?.[0] ?? 0;
      for (const key of ['position', 'normal'] as const) {
        const base = geometry.getAttribute(key);
        const morph = visual.mesh.geometry.morphAttributes[key]?.[0];
        if (morph && influence) for (let i = 0; i < base.count; i++) base.setXYZ(i,
          THREE.MathUtils.lerp(base.getX(i), morph.getX(i), influence),
          THREE.MathUtils.lerp(base.getY(i), morph.getY(i), influence),
          THREE.MathUtils.lerp(base.getZ(i), morph.getZ(i), influence));
      }
      const mesh = new THREE.Mesh(geometry, visual.mesh.material);
      return [visual.mesh.name, { ...visual, mesh, visible: visual.mesh.visible, color: visual.mesh.material.color.clone(), opacity: visual.mesh.material.opacity }];
    }));
  }

  private beginTransition(previous: Map<string, Pose>, autoplay: boolean) {
    for (const visual of this.visuals) {
      const pose = previous.get(visual.mesh.name);
      const geometry = visual.mesh.geometry;
      const position = pose?.mesh.geometry.getAttribute('position') ?? this.collapsed(geometry);
      geometry.morphAttributes.position = [position];
      geometry.morphAttributes.normal = [pose?.mesh.geometry.getAttribute('normal') ?? geometry.getAttribute('normal').clone()];
      geometry.morphTargetsRelative = false;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      visual.mesh.updateMorphTargets();
      visual.mesh.morphTargetInfluences![0] = 1;
      visual.opacityFrom = pose?.visible ? pose.opacity : 0;
      visual.colorFrom = pose?.color;
      if (pose) { previous.delete(visual.mesh.name); pose.mesh.geometry.dispose(); }
    }
    for (const [key, pose] of previous) {
      const geometry = pose.mesh.geometry;
      const oldPosition = geometry.getAttribute('position').clone();
      geometry.setAttribute('position', this.collapsed(geometry));
      geometry.morphAttributes.position = [oldPosition];
      geometry.morphAttributes.normal = [geometry.getAttribute('normal').clone()];
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, createTissueMaterial(pose.mesh.material.userData.styleKey));
      mesh.name = key;
      mesh.updateMorphTargets(); mesh.morphTargetInfluences![0] = 1;
      this.root.add(mesh);
      this.visuals.push({ ...pose, mesh, leaving: true, opacityFrom: pose.visible ? pose.opacity : 0, colorFrom: pose.color });
    }
    this.transition = { elapsed: 0, autoplay };
  }

  private collapsed(geometry: THREE.BufferGeometry) {
    const positions = geometry.getAttribute('position').clone();
    const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
    for (let i = 0; i < positions.count; i++) positions.setXYZ(i,
      center.x + (positions.getX(i) - center.x) * 0.03,
      center.y + (positions.getY(i) - center.y) * 0.03,
      center.z + (positions.getZ(i) - center.z) * 0.03);
    return positions;
  }

  private rebuildAdult() {
    this.clear();
    for (const [key, source] of this.sources) {
      const geometry = this.clone(source.geometry);
      this.finish(geometry);
      const bone = source.categories.some((c) => BONES.includes(c));
      this.add(geometry, styleKeyFor(key, source.categories), key, false, !bone && !/^tooth-/.test(key));
    }
  }

  private clone(source: THREE.BufferGeometry) {
    const geometry = source.clone();
    geometry.morphAttributes = {};
    return geometry;
  }

  private finish(geometry: THREE.BufferGeometry) {
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }

  private add(geometry: THREE.BufferGeometry, style: string, key: string, jaw: boolean, soft: boolean, tooth?: DevelopmentTooth) {
    const mesh = new THREE.Mesh(geometry, createTissueMaterial(style));
    mesh.name = `growth-${key}`;
    // Intentionally omitted from Engine.entries / picking / labels.
    this.root.add(mesh);
    this.visuals.push({ mesh, jaw, soft, tooth });
    if (!soft) this.bounds.union(geometry.boundingBox!);
  }

  private rebuild(stage: DevelopmentStageId) {
    this.clear();
    const point = new THREE.Vector3();
    for (const [key, source] of this.sources) {
      if (/^tooth-/.test(key)) continue;
      const bone = source.categories.some((c) => BONES.includes(c));
      const geometry = this.clone(source.geometry);
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        developmentPoint(point.fromBufferAttribute(positions, i), stage);
        positions.setXYZ(i, point.x, point.y, point.z);
      }
      positions.needsUpdate = true;
      this.finish(geometry);
      this.add(geometry, styleKeyFor(key, source.categories), key,
        source.categories.some((c) => ['maxilla', 'mandible', 'alveolar-bone'].includes(c)), !bone);
    }
    for (const tooth of DEVELOPMENT_TEETH) {
      const status = developmentStatus(tooth, stage);
      if (status === 'absent') continue;
      const targetFdi = tooth.dentition === 'primary' ? successorFdi(tooth)! : tooth.fdi;
      // Primary molars use adult molar templates at successor premolar sites.
      const templateFdi = tooth.dentition === 'primary' && tooth.fdi % 10 >= 4 ? Math.floor(targetFdi / 10) * 10 + tooth.fdi % 10 + 2 : targetFdi;
      const source = this.sources.get(`tooth-${templateFdi}`);
      const from = this.registry.manifest.teeth[templateFdi];
      const to = this.registry.manifest.teeth[targetFdi];
      if (!source || !from || !to) continue;
      const geometry = this.clone(source.geometry);
      const sourceCervical = new THREE.Vector3(...(from.landmarks?.['cervical-line'] ?? from.frame.origin));
      const cervical = developmentPoint(new THREE.Vector3(...(to.landmarks?.['cervical-line'] ?? to.frame.origin)), stage);
      const axis = new THREE.Vector3(...to.frame.axis).normalize();
      const buccal = new THREE.Vector3(...to.frame.buccal).normalize();
      const basis = (frame: typeof from.frame) => new THREE.Matrix4().makeBasis(new THREE.Vector3(...frame.mesial), new THREE.Vector3(...frame.axis), new THREE.Vector3(...frame.buccal));
      const rotation = basis(to.frame).multiply(basis(from.frame).invert());
      const maturity = developmentAge(stage) / 18;
      const scale = tooth.dentition === 'primary' ? 0.6 + 0.12 * maturity : status === 'unerupted' ? 0.48 + 0.35 * maturity : 0.72 + 0.28 * maturity;
      const rootScale = status === 'unerupted' ? 0.12 : status === 'erupting' ? 0.55 : tooth.dentition === 'primary' ? 0.65 : 0.9;
      if (status === 'unerupted') cervical.addScaledVector(axis, -0.85 * scale).addScaledVector(buccal, tooth.fdi % 10 <= 3 ? -0.35 : -0.12);
      else if (status === 'erupting') cervical.addScaledVector(axis, -0.2);
      const positions = geometry.getAttribute('position');
      const sourceAxis = new THREE.Vector3(...from.frame.axis).normalize();
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).sub(sourceCervical);
        const height = point.dot(sourceAxis);
        if (height < 0) point.addScaledVector(sourceAxis, height * (rootScale - 1));
        point.applyMatrix4(rotation).multiplyScalar(scale).add(cervical);
        positions.setXYZ(i, point.x, point.y, point.z);
      }
      positions.needsUpdate = true;
      this.finish(geometry);
      const style = status === 'unerupted' ? 'development-unerupted' : tooth.dentition === 'primary' ? 'development-primary' : status === 'erupting' ? 'development-erupting' : 'development-permanent';
      this.add(geometry, style, `tooth-${tooth.fdi}`, false, false, tooth);
    }
  }

  private clear() {
    this.transition = null;
    for (const { mesh } of this.visuals) { mesh.geometry.dispose(); mesh.material.dispose(); }
    this.visuals = [];
    this.root.clear();
    this.bounds.makeEmpty();
  }

  dispose() { this.clear(); this.sources.clear(); }
}
