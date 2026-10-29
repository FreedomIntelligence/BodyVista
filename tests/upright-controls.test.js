import test from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera, Vector3} from '../src/vendor/three.js';
import {UprightControls, rotateView} from '../src/upright-controls.js';

function setup() {
 const camera=new PerspectiveCamera();camera.up.set(0,0,1);camera.position.set(0,-5,0);
 return {camera,controls:new UprightControls(camera)};
}
test('large repeated drags stop at poles without rolling or changing distance',()=>{
 const {camera,controls}=setup();
 for(const angle of [20,20,-40,-40]) {
  controls._rotateUp(angle);controls._rotateLeft(.7);controls.update();
  assert.ok(camera.up.distanceTo(new Vector3(0,0,1))<1e-8);
  assert.ok(Math.abs(camera.position.length()-5)<1e-8);
  const screenUp=new Vector3(0,1,0).applyQuaternion(camera.quaternion);
  assert.ok(screenUp.z>=0);
 }
});
test('old rolled views are straightened without losing pan and zoom',()=>{
 const {camera,controls}=setup();
 controls.target.set(1,2,3);camera.position.copy(controls.target).add(new Vector3(0,-2,1));camera.up.set(1,0,0);
 controls.update();
 assert.ok(camera.up.distanceTo(new Vector3(0,0,1))<1e-8);
 assert.ok(controls.target.distanceTo(new Vector3(1,2,3))<1e-8);
 assert.ok(Math.abs(camera.position.distanceTo(controls.target)-Math.sqrt(5))<1e-8);
});
test('gizmo rotation obeys the same upright restriction',()=>{
 const {camera,controls}=setup();
 for(const vertical of [10,-20,10]) {
  rotateView(camera,controls.target,.4,vertical);controls.update();
  assert.ok(camera.up.z===1);
  assert.ok(new Vector3(0,1,0).applyQuaternion(camera.quaternion).z>=0);
  assert.ok(Math.abs(camera.position.length()-5)<1e-8);
 }
});
