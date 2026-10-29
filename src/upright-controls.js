import { Vector3, MathUtils } from './vendor/three.js';
import { OrbitControls } from './vendor/OrbitControls.js';

// Keep the anatomical vertical fixed, including when restoring older rolled views.
export class UprightControls extends OrbitControls {
  update(deltaTime) {
    this.object.up.set(0, 0, 1);
    this._quat.setFromUnitVectors(this.object.up, new Vector3(0, 1, 0));
    this._quatInverse.copy(this._quat).invert();
    return super.update(deltaTime);
  }
}

// The orientation widget follows the same no-roll, no-pole-crossing rule.
export function rotateView(camera, target, horizontal, vertical) {
  const offset = camera.position.clone().sub(target);
  const radius = offset.length();
  if (!radius) return;
  const theta = Math.atan2(offset.x, -offset.y) - horizontal;
  const phi = MathUtils.clamp(Math.acos(MathUtils.clamp(offset.z / radius, -1, 1)) - vertical, .001, Math.PI - .001);
  camera.position.copy(target).add(new Vector3(
    Math.sin(theta) * Math.sin(phi), -Math.cos(theta) * Math.sin(phi), Math.cos(phi)
  ).multiplyScalar(radius));
  camera.up.set(0, 0, 1);
  camera.lookAt(target);
}
