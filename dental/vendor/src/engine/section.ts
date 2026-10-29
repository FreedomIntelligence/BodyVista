/**
 * Cross-section tool: one global clipping plane (sagittal / coronal / axial /
 * perpendicular to the view) plus a faint outline showing where it cuts.
 */
import * as THREE from 'three';
import type { ClipState } from '../state/store';
import { HIGHLIGHT } from './materials';

type PlaneAxis = 'sagittal' | 'coronal' | 'axial';
const WORLD_AXES: Record<PlaneAxis, THREE.Vector3> = {
  sagittal: new THREE.Vector3(1, 0, 0),
  coronal: new THREE.Vector3(0, 0, 1),
  axial: new THREE.Vector3(0, 1, 0),
};

/** Rounded vector string, for cheap change detection. */
const vecKey = (v: THREE.Vector3) => v.toArray().map((n) => n.toFixed(2)).join(',');

export class SectionTool {
  readonly plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  readonly planes: THREE.Plane[] = [this.plane];
  readonly outline: THREE.LineLoop;
  private normal = new THREE.Vector3(1, 0, 0);
  private lastKey = '';
  private axes: Record<PlaneAxis, THREE.Vector3> = WORLD_AXES;

  /**
   * Use a tooth's own frame while dissecting: "sagittal" becomes the
   * mesiodistal plane, "coronal" the buccolingual plane, "axial" a horizontal
   * cross-section of the tooth. Pass null for anatomical (world) planes.
   */
  setFrame(f: Record<PlaneAxis, [number, number, number]> | null) {
    this.axes = f
      ? { sagittal: new THREE.Vector3(...f.sagittal).normalize(), coronal: new THREE.Vector3(...f.coronal).normalize(), axial: new THREE.Vector3(...f.axial).normalize() }
      : WORLD_AXES;
  }

  constructor() {
    const g = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-1, -1, 0),
      new THREE.Vector3(1, -1, 0),
      new THREE.Vector3(1, 1, 0),
      new THREE.Vector3(-1, 1, 0),
    ]);
    const m = new THREE.LineBasicMaterial({ color: HIGHLIGHT, transparent: true, opacity: 0.3, depthTest: false });
    this.outline = new THREE.LineLoop(g, m);
    this.outline.renderOrder = 999;
    this.outline.visible = false;
  }

  /**
   * Recompute the plane. The side toward the camera is removed so the cut face
   * looks at the viewer; it is re-evaluated when the camera crosses the plane.
   */
  update(clip: ClipState, bounds: THREE.Box3, camera: THREE.Camera, target: THREE.Vector3) {
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    // the removed half is always the one facing the camera, so the cut surface faces the viewer
    const camSide = clip.axis === 'view' ? 0 : Math.sign(this.axes[clip.axis].dot(camera.position.clone().sub(center))) || 1;
    const key = `${clip.axis}|${clip.flip}|${camSide}|${vecKey(this.axes[clip.axis === 'view' ? 'axial' : clip.axis])}|${vecKey(center)}`;
    if (key !== this.lastKey || clip.axis === 'view') {
      if (clip.axis === 'view') {
        this.normal.copy(target).sub(camera.position).normalize();
      } else {
        this.normal.copy(this.axes[clip.axis]);
        const toCam = camera.position.clone().sub(center);
        if (this.normal.dot(toCam) > 0) this.normal.negate();
      }
      if (clip.flip) this.normal.negate();
      this.lastKey = key;
    }
    const extent = Math.abs(this.normal.x) * size.x + Math.abs(this.normal.y) * size.y + Math.abs(this.normal.z) * size.z;
    // the slider moves along the fixed anatomical axis, independent of which half is removed
    const along = clip.axis === 'view' ? this.normal : this.axes[clip.axis];
    const point = center.clone().addScaledVector(along, (clip.offset * extent) / 2);
    this.plane.setFromNormalAndCoplanarPoint(this.normal, point);

    // outline sized to the bounds, oriented to the plane
    const r = Math.max(size.x, size.y, size.z) * 0.55;
    this.outline.position.copy(point);
    this.outline.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.normal);
    this.outline.scale.setScalar(r);
    this.outline.visible = clip.enabled;
  }

  /** True if a world point survives the cut. */
  keeps(p: THREE.Vector3): boolean {
    return this.plane.distanceToPoint(p) >= 0;
  }
}
