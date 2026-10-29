import * as THREE from 'three';
import type { Manifest } from '../anatomy/types';

/** Optional paths fitted to the teaching crown, following its actual world transform. */
export class SurfaceFeatureLayer {
  readonly root = new THREE.Group();
  private tooth = -1;
  private paths: THREE.Line[] = [];
  constructor(private manifest: Manifest) { this.root.visible = false; }
  update(fdi: number | null, enabled: boolean, host?: THREE.Mesh, selected?: string | null) {
    this.root.visible = enabled && fdi !== null && !!host?.visible;
    if (!this.root.visible || fdi === null || !host) return;
    if (this.tooth !== fdi) {
      this.clear(); this.tooth = fdi;
      for (const feature of this.manifest.teeth[String(fdi)]?.surfaceFeatures ?? []) {
        if (!feature.path || feature.path.length < 2) continue;
        const geometry = new THREE.BufferGeometry().setFromPoints(feature.path.map(p => new THREE.Vector3(...p)));
        const color = feature.key.includes('groove') ? '#267e91' : feature.key.includes('ridge') ? '#bc8431' : '#8063aa';
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .85, depthTest: true, depthWrite: false }));
        line.name = `surface-${feature.key}-${fdi}`;
        this.paths.push(line); this.root.add(line);
      }
    }
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(host.matrixWorld);
    this.root.matrixWorldNeedsUpdate = true;
    for (const line of this.paths) (line.material as THREE.LineBasicMaterial).opacity = selected === line.name ? 1 : .8;
  }
  private clear() { for (const line of this.paths) { line.geometry.dispose(); (line.material as THREE.Material).dispose(); } this.paths = []; this.root.clear(); }
  dispose() { this.clear(); }
}
