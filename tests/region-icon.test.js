import test from 'node:test';
import assert from 'node:assert/strict';
import {regionIcon} from '../src/region-icon.js';
test('location icons highlight each assigned body region and the whole body',()=>{
  const count=regions=>(regionIcon(regions).match(/fill="currentColor"/g)||[]).length;
  for(const region of ['head','neck','thorax','abdomen','pelvis','upper','lower'])assert.equal(count([region]),1);
  assert.equal(count(['head','neck']),2);
  assert.equal(count(['all']),7);
  assert.equal(count([]),0);
  assert.notEqual(regionIcon(['upper']),regionIcon(['head']));
});
