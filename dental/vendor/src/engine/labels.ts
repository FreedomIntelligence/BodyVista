/**
 * Anchored DOM labels with priority-based decluttering and occlusion culling.
 * Positions are written directly to the DOM each rendered frame — no React.
 */
import * as THREE from 'three';
import { t } from '../i18n';

export interface LabelCandidate {
  id: string;
  text: string;
  /** world-space anchor provider (called per frame, respects explode offsets) */
  anchor: () => THREE.Vector3;
  /** approximate world radius of the structure, drives zoom-based visibility */
  radius: number;
  priority: number;
  /** structure ids that count as "this label's structure" for occlusion tests */
  owners: Set<string>;
  /** Surface features need a tighter tolerance than internal landmarks (cm). */
  occlusionTolerance?: number;
  kind: 'tooth' | 'structure' | 'landmark';
}

interface LabelEl {
  el: HTMLButtonElement;
  visible: boolean;
  /** cached size (0 = measure again); only text and fonts change it, never position */
  w: number;
  h: number;
  /** last transform written, to skip identical style writes */
  transform: string;
}

const PAD = 4;

/** Screen-space rectangle in canvas pixels. */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export class LabelLayer {
  private root: HTMLElement;
  private els = new Map<string, LabelEl>();
  private candidates: LabelCandidate[] = [];
  private occluded = new Set<string>();
  private lastOcclusion = 0;
  private blocked: Rect[] = [];
  /** candidates in draw order (selected first, then priority); rebuilt when candidates or selection change */
  private sorted: LabelCandidate[] = [];
  private sortedFor: string | null | undefined = undefined;
  /** occlusion inputs other than the camera changed since the last occlusion pass */
  private occlusionDirty = true;
  private lastView = new THREE.Matrix4();
  private lastProj = new THREE.Matrix4();
  /** CSS selector for UI elements labels must not sit under */
  blockSelector = '.ds-panel, .ds-identity, .ds-top-actions';
  enabled = false;
  selectedId: string | null = null;
  onClick?: (id: string) => void;
  onHover?: (id: string | null, rect?: DOMRect) => void;
  /** returns the structure id at the first ray hit from the camera toward a point, or null */
  raycastOwner?: (from: THREE.Vector3, to: THREE.Vector3) => { id: string; distance: number } | null;
  /** false when a point has been cut away by the section plane */
  keeps?: (p: THREE.Vector3) => boolean;

  constructor(root: HTMLElement) {
    this.root = root;
    // label sizes are cached; web fonts arriving later change them
    document.fonts?.addEventListener?.('loadingdone', this.resetSizes);
  }

  private resetSizes = () => {
    for (const l of this.els.values()) l.w = l.h = 0;
  };

  /**
   * Something that affects occlusion other than the camera changed: meshes moved or faded,
   * visibility or the section plane changed. The next update recomputes occlusion.
   */
  markSceneChanged() {
    this.occlusionDirty = true;
  }

  setCandidates(c: LabelCandidate[]) {
    this.candidates = c;
    this.sortedFor = undefined;
    this.occlusionDirty = true;
    const ids = new Set(c.map((x) => x.id));
    for (const [id, l] of this.els) {
      if (!ids.has(id)) {
        l.el.remove();
        this.els.delete(id);
      }
    }
    for (const cand of c) {
      let l = this.els.get(cand.id);
      if (!l) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = `ds-label ds-label--${cand.kind}`;
        el.setAttribute('aria-describedby', 'ds-hover-info');
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onClick?.(cand.id);
        });
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        const showInfo = () => this.onHover?.(cand.id, el.getBoundingClientRect());
        const hideInfo = () => this.onHover?.(null);
        el.addEventListener('pointerenter', showInfo);
        el.addEventListener('pointerleave', hideInfo);
        el.addEventListener('focus', showInfo);
        el.addEventListener('blur', hideInfo);
        this.root.appendChild(el);
        l = { el, visible: false, w: 0, h: 0, transform: '' };
        this.els.set(cand.id, l);
      }
      if (l.el.textContent !== cand.text) {
        l.el.textContent = cand.text;
        l.w = l.h = 0;
      }
      // the language can change while the text stays the same (tooth numbers)
      const aria = t().selectX(cand.text);
      if (l.el.getAttribute('aria-label') !== aria) l.el.setAttribute('aria-label', aria);
      if (l.visible && l.el.matches(':hover, :focus')) this.onHover?.(cand.id, l.el.getBoundingClientRect());
    }
  }

  update(camera: THREE.PerspectiveCamera, width: number, height: number, now: number, force = false) {
    if (!this.enabled) {
      for (const l of this.els.values()) if (l.visible) this.show(l, false);
      return;
    }
    if (force || now - this.lastOcclusion > 180) {
      this.lastOcclusion = now;
      // occlusion is the costly part (a raycast per label): skip it while neither the camera
      // nor the scene has changed, e.g. for renders caused only by hover highlights
      const cameraMoved = !this.lastView.equals(camera.matrixWorld) || !this.lastProj.equals(camera.projectionMatrix);
      if (cameraMoved || this.occlusionDirty) {
        this.lastView.copy(camera.matrixWorld);
        this.lastProj.copy(camera.projectionMatrix);
        this.occlusionDirty = false;
        this.computeOcclusion(camera);
      }
      this.computeBlocked();
    }
    // read every uncached label size before writing any transform, so the browser lays out
    // at most once per frame instead of once per label
    for (const l of this.els.values()) {
      if (!l.w) {
        l.w = l.el.offsetWidth;
        l.h = l.el.offsetHeight;
      }
    }
    if (this.sortedFor !== this.selectedId) {
      const sel = this.selectedId;
      this.sorted = [...this.candidates].sort((a, b) => (b.id === sel ? 1 : 0) - (a.id === sel ? 1 : 0) || b.priority - a.priority);
      this.sortedFor = sel;
    }
    const placed: Rect[] = [];
    const tmp = new THREE.Vector3();
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    const pxPerUnitAt = (d: number) => height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * d);
    for (const c of this.sorted) {
      const l = this.els.get(c.id)!;
      const p = c.anchor();
      if (this.keeps && !this.keeps(p)) {
        this.show(l, false);
        continue;
      }
      tmp.copy(p).sub(camera.position);
      const depth = tmp.dot(camDir);
      if (depth <= camera.near) {
        this.show(l, false);
        continue;
      }
      const screenR = c.radius * pxPerUnitAt(depth);
      const minR = c.kind === 'tooth' ? 7 : 26 - c.priority * 4;
      const selected = c.id === this.selectedId;
      if ((!selected && screenR < minR) || this.occluded.has(c.id)) {
        this.show(l, false);
        continue;
      }
      tmp.copy(p).project(camera);
      if (tmp.x < -1 || tmp.x > 1 || tmp.y < -1 || tmp.y > 1) {
        this.show(l, false);
        continue;
      }
      const x = (tmp.x * 0.5 + 0.5) * width;
      const y = (-tmp.y * 0.5 + 0.5) * height;
      const w = l.w || 60;
      const h = l.h || 20;
      const rect: Rect = { x0: x - w / 2 - PAD, y0: y - h - 8 - PAD, x1: x + w / 2 + PAD, y1: y - 8 + PAD };
      const hits = (r: Rect) => overlaps(r, rect);
      if (this.blocked.some(hits) || (!selected && placed.some(hits))) {
        this.show(l, false);
        continue;
      }
      placed.push(rect);
      const transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, calc(-100% - 8px))`;
      if (transform !== l.transform) {
        l.transform = transform;
        l.el.style.transform = transform;
      }
      l.el.classList.toggle('is-selected', selected);
      this.show(l, true);
    }
  }

  private show(l: LabelEl, v: boolean) {
    if (l.visible === v) return;
    l.visible = v;
    l.el.classList.toggle('is-visible', v);
    l.el.tabIndex = v ? 0 : -1;
  }

  private computeOcclusion(camera: THREE.PerspectiveCamera) {
    this.occluded.clear();
    if (!this.raycastOwner) return;
    for (const c of this.candidates) {
      const p = c.anchor();
      const hit = this.raycastOwner(camera.position, p);
      if (!hit) continue;
      const dist = camera.position.distanceTo(p);
      // anchors sit on the structure's surface (landmarks just inside it): allow a small tolerance
      const tol = c.occlusionTolerance ?? (c.kind === 'landmark' ? 0.08 : 0.04);
      if (hit.distance < dist - tol && !c.owners.has(hit.id)) this.occluded.add(c.id);
    }
  }

  private computeBlocked() {
    const host = this.root.getBoundingClientRect();
    const els = document.querySelectorAll<HTMLElement>(this.blockSelector);
    this.blocked = [];
    els.forEach((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this.blocked.push({ x0: r.left - host.left, y0: r.top - host.top, x1: r.right - host.left, y1: r.bottom - host.top });
    });
  }

  dispose() {
    document.fonts?.removeEventListener?.('loadingdone', this.resetSizes);
    for (const l of this.els.values()) l.el.remove();
    this.els.clear();
  }
}
