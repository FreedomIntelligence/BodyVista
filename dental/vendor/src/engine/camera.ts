/**
 * Camera rig: OrbitControls + smooth focus transitions and view presets.
 *
 * Two orbit modes (store `orbitMode`):
 *  - fixed: a turntable around `pivot`, the centre of the current scene (the
 *    skull, separated dentition, or tooth being dissected). Pan and wheel zoom never move it
 *    for good: after a pan the target glides back (`pivotSpring`), wheel zoom is
 *    centred, and focus/presets keep the target on the pivot (`fixedFocusPose`).
 *  - free: OrbitControls as usual; pan, zoom-to-cursor and focus move the target.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Animator } from './animator';
import type { OrbitMode, ViewPreset } from '../state/store';

export interface FocusOptions {
  /** preferred viewing direction (from target toward camera) */
  direction?: THREE.Vector3;
  /** multiply the fitted distance */
  padding?: number;
  /** explicit camera distance (overrides the sphere fit) */
  distance?: number;
  duration?: number;
  /** Re-centre the orbit along with the camera, rather than retaining its old pivot. */
  movePivot?: boolean;
  done?: () => void;
}

export const PRESET_DIRS: Record<ViewPreset, THREE.Vector3> = {
  'three-quarter': new THREE.Vector3(0.62, 0.22, 0.75),
  back: new THREE.Vector3(0, 0.02, -1),
  front: new THREE.Vector3(0, 0.02, 1),
  left: new THREE.Vector3(1, 0.02, 0.0001),
  right: new THREE.Vector3(-1, 0.02, 0.0001),
  superior: new THREE.Vector3(0.0001, 1, 0.12),
  inferior: new THREE.Vector3(0.0001, -1, 0.12),
  'occlusal-upper': new THREE.Vector3(0.0001, -1, 0.35),
  'occlusal-lower': new THREE.Vector3(0.0001, 1, 0.35),
};

/**
 * Fixed-orbit framing of a structure: target stays on `pivot`; the camera sits on
 * the ray from the pivot through the structure, `fitDistance` beyond it, so the
 * structure is centred on screen. `fallbackDir` is used when the structure is at the pivot.
 */
export function fixedFocusPose(pivot: THREE.Vector3, center: THREE.Vector3, radius: number, fitDistance: number, fallbackDir: THREE.Vector3) {
  const out = center.clone().sub(pivot);
  const dir = out.length() > radius * 0.25 ? out.clone().normalize() : fallbackDir.clone().normalize();
  const position = pivot.clone().addScaledVector(dir, Math.max(0, out.dot(dir)) + fitDistance);
  return { target: pivot.clone(), position };
}

/** Per-frame step that pulls the target back to the pivot (apply to target and camera alike). */
export function pivotSpring(target: THREE.Vector3, pivot: THREE.Vector3, dt: number, instant: boolean): THREE.Vector3 {
  const d = pivot.clone().sub(target);
  return instant ? d : d.multiplyScalar(1 - Math.exp(-dt * 7));
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private animator: Animator;
  /** called when the user takes over the camera (drag/zoom) */
  onUserInteract?: () => void;
  home = { target: new THREE.Vector3(0, 0.2, 0), radius: 5.2 };
  private mode_: OrbitMode = 'free';
  /** fixed-mode orbit centre (engine keeps it on the current scene centre via setPivot) */
  readonly pivot = new THREE.Vector3(0, 0.2, 0);
  private interacting = false;

  constructor(camera: THREE.PerspectiveCamera, dom: HTMLElement, animator: Animator) {
    this.camera = camera;
    this.animator = animator;
    const c = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.085;
    c.rotateSpeed = 0.75;
    c.zoomSpeed = 0.9;
    c.panSpeed = 0.85;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    c.minDistance = 0.9;
    c.maxDistance = 160; // room to frame the whole phase-2 board on a phone
    c.autoRotateSpeed = 0.9;
    c.addEventListener('start', () => {
      this.interacting = true;
      this.animator.cancel('camera');
      this.onUserInteract?.();
    });
    c.addEventListener('end', () => (this.interacting = false));
    this.controls = c;
  }

  get mode(): OrbitMode {
    return this.mode_;
  }

  setMode(mode: OrbitMode) {
    this.mode_ = mode;
    // fixed: wheel zoom stays centred on the pivot instead of dollying toward the cursor
    this.controls.zoomToCursor = mode === 'free';
  }

  setPivot(p: THREE.Vector3) {
    this.pivot.copy(p);
  }

  /**
   * Called every frame after controls.update(). In fixed mode, once the user has let go,
   * damping has settled (`controlsMoved` false) and no camera animation runs, glide the
   * target back to the pivot, keeping the view direction. Returns true when the camera moved.
   */
  tick(dt: number, controlsMoved: boolean): boolean {
    if (this.mode !== 'fixed' || this.interacting || controlsMoved || this.animator.isRunning('camera')) return false;
    const target = this.controls.target;
    if (target.distanceToSquared(this.pivot) < 1e-8) return false;
    const d = pivotSpring(target, this.pivot, dt, this.animator.reducedMotion);
    target.add(d);
    this.camera.position.add(d);
    if (target.distanceToSquared(this.pivot) < 1e-8) target.copy(this.pivot);
    return true;
  }

  distanceFor(radius: number, padding = 1.25): number {
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fitH = radius / Math.sin(fov / 2);
    const fitW = radius / Math.sin(Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    return Math.max(fitH, fitW) * padding;
  }

  /** Smoothly move so that `sphere` fills the view. */
  focusSphere(center: THREE.Vector3, radius: number, opts: FocusOptions = {}) {
    const cam = this.camera;
    const target0 = this.controls.target.clone();
    const pos0 = cam.position.clone();
    const dir = (opts.direction?.clone() ?? pos0.clone().sub(target0)).normalize();
    const dist = Math.max(opts.distance ?? this.distanceFor(Math.max(radius, 0.15), opts.padding ?? 1.3), this.controls.minDistance * 1.05);
    let target1 = center.clone();
    let pos1 = center.clone().addScaledVector(dir, dist);
    if (this.mode === 'fixed' && !opts.movePivot) ({ target: target1, position: pos1 } = fixedFocusPose(this.pivot, center, radius, dist, dir));

    // interpolate in spherical coordinates around a moving target so the camera arcs instead of cutting through geometry
    const off0 = pos0.clone().sub(target0);
    const off1 = pos1.clone().sub(target1);
    const s0 = new THREE.Spherical().setFromVector3(off0);
    const s1 = new THREE.Spherical().setFromVector3(off1);
    let dTheta = s1.theta - s0.theta;
    if (dTheta > Math.PI) dTheta -= Math.PI * 2;
    if (dTheta < -Math.PI) dTheta += Math.PI * 2;
    const tmp = new THREE.Spherical();
    const off = new THREE.Vector3();
    this.animator.run(
      'camera',
      opts.duration ?? 0.85,
      (k) => {
        this.controls.target.lerpVectors(target0, target1, k);
        if (opts.movePivot) this.pivot.copy(this.controls.target);
        tmp.radius = THREE.MathUtils.lerp(s0.radius, s1.radius, k);
        tmp.phi = THREE.MathUtils.lerp(s0.phi, s1.phi, k);
        tmp.theta = s0.theta + dTheta * k;
        off.setFromSpherical(tmp);
        cam.position.copy(this.controls.target).add(off);
        cam.lookAt(this.controls.target);
        this.updateClipping();
      },
      { done: opts.done },
    );
  }

  preset(p: ViewPreset, center = this.home.target, radius = this.home.radius, duration = 0.9) {
    if (this.mode === 'fixed') {
      // look from the preset direction at the pivot, far enough out to keep `center ± radius` in frame
      radius += center.distanceTo(this.pivot);
      center = this.pivot;
    }
    this.focusSphere(center, radius, { direction: PRESET_DIRS[p], padding: 1.05, duration });
  }

  home_(duration = 0.9) {
    this.preset('three-quarter', this.home.target, this.home.radius, duration);
  }

  zoom(factor: number) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(off.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    const target = this.controls.target.clone();
    const from = off.length();
    this.animator.run('camera', 0.25, (k) => {
      off.setLength(THREE.MathUtils.lerp(from, len, k));
      this.camera.position.copy(target).add(off);
      this.updateClipping();
    });
  }

  orbit(dAzimuth: number, dPolar: number) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const s = new THREE.Spherical().setFromVector3(off);
    s.theta += dAzimuth;
    s.phi = THREE.MathUtils.clamp(s.phi + dPolar, 0.05, Math.PI - 0.05);
    off.setFromSpherical(s);
    this.camera.position.copy(this.controls.target).add(off);
    this.camera.lookAt(this.controls.target);
  }

  /** Keep near/far tight around the target for depth precision at tooth scale. */
  updateClipping() {
    const d = this.camera.position.distanceTo(this.controls.target);
    const near = Math.max(0.02, d * 0.02);
    const far = Math.max(60, d * 12);
    if (Math.abs(this.camera.near - near) > 1e-4 || this.camera.far !== far) {
      this.camera.near = near;
      this.camera.far = far;
      this.camera.updateProjectionMatrix();
    }
  }
}
