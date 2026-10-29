import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../src/vendor/three.js';
import {AtlasCamera} from '../src/view-navigation.js';

function camera() {
 const c=new AtlasCamera(32,1.5,.003,80);
 c.up.set(0,0,1);c.position.set(0,-5,0);c.orbitTarget=new THREE.Vector3();c.lookAt(c.orbitTarget);c.updateMatrixWorld();return c;
}
test('projection switch preserves scale at the orbit target and camera identity',()=>{
 const c=camera(),point=new THREE.Vector3(.4,0,.3);
 const before=point.clone().project(c);c.setProjection(true);const after=point.clone().project(c);
 assert.ok(Math.abs(before.x-after.x)<1e-10);assert.ok(Math.abs(before.y-after.y)<1e-10);
 assert.equal(c.isPerspectiveCamera,false);assert.equal(c.isOrthographicCamera,true);
 c.setProjection(false);assert.ok(point.clone().project(c).distanceTo(before)<1e-10);
});
test('orthographic picking produces parallel rays at distinct positions',()=>{
 const c=camera();c.setProjection(true);
 const a=new THREE.Raycaster(),b=new THREE.Raycaster();a.setFromCamera(new THREE.Vector2(-.5,0),c);b.setFromCamera(new THREE.Vector2(.5,0),c);
 assert.ok(a.ray.direction.distanceTo(b.ray.direction)<1e-10);assert.ok(a.ray.origin.distanceTo(b.ray.origin)>1);
});
test('orthographic framing responds to viewport aspect and orbit distance',()=>{
 const c=camera();c.setProjection(true);const height=c.top-c.bottom;
 c.aspect=.5;c.updateProjectionMatrix();assert.ok(Math.abs((c.right-c.left)/height-.5)<1e-10);
 c.position.multiplyScalar(2);c.updateProjectionMatrix();assert.ok(Math.abs(c.top-c.bottom-height*2)<1e-10);
});

test('normalizing orthographic zoom preserves the image for history and saved views',()=>{
 const c=camera();c.setProjection(true);c.zoom=2;c.updateProjectionMatrix();
 const point=new THREE.Vector3(.3,0,.2),before=point.clone().project(c);
 c.normalizeZoom();c.updateMatrixWorld();const after=point.clone().project(c);
 assert.equal(c.zoom,1);assert.equal(c.position.distanceTo(c.orbitTarget),2.5);
 assert.ok(Math.abs(before.x-after.x)<1e-10);assert.ok(Math.abs(before.y-after.y)<1e-10);
});

test('magnification tracks zoom, ignores pan and rotation, and resets to one',()=>{
 const c=camera();c.resetZoomReference();assert.equal(c.magnification,1);
 c.position.multiplyScalar(.5);assert.equal(c.magnification,2);
 c.position.set(2.5,0,0);assert.equal(c.magnification,2);
 const pan=new THREE.Vector3(3,4,1);c.position.add(pan);c.orbitTarget.add(pan);assert.equal(c.magnification,2);
 c.setProjection(true);assert.equal(c.magnification,2);
 c.zoom=2;c.normalizeZoom();assert.equal(c.magnification,4);
 c.resetZoomReference();assert.equal(c.magnification,1);
 c.position.sub(c.orbitTarget).multiplyScalar(2).add(c.orbitTarget);assert.equal(c.magnification,.5);
});
