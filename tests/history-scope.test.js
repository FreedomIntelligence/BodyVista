import test from 'node:test';
import assert from 'node:assert/strict';
import {AnatomyHistory} from '../src/state.js';
const state=n=>({n,motion:null,micro:null});
test('leaving anatomy clears undo and redo; other pages never record',()=>{
 const h=new AnatomyHistory();h.commit(h.capture(state(0)),state(1));
 assert.equal(h.undo(state(1)).n,0);assert.equal(h.canRedo,true);
 for(const page of ['motion','micro','quiz']){
  h.setScope(page);h.commit(h.capture(state(1)),state(2));
  assert.equal(h.canUndo,false);assert.equal(h.canRedo,false);assert.equal(h.undo(state(2)),null);
 }
});
test('navigation and in-flight gestures cannot create cross-page undo',()=>{
 const h=new AnatomyHistory(),before=h.capture(state(0));
 h.setScope('motion');h.setScope('anatomy');h.commit(before,state(1));
 assert.equal(h.canUndo,false);
 const motion=h.capture({...state(1),motion:{id:'heartbeat'}});h.commit(motion,state(2));
 assert.equal(h.canUndo,false);
 h.commit(h.capture(state(2)),state(3));assert.equal(h.undo(state(3)).n,2);
});
test('anatomy keeps only the latest twenty steps',()=>{
 const h=new AnatomyHistory();for(let n=0;n<30;n++)h.commit(h.capture(state(n)),state(n+1));
 let current=state(30),count=0;while(h.canUndo){current=h.undo(current);count++;}
 assert.equal(count,20);assert.equal(current.n,10);
 assert.equal(h.redo(current).n,11);
});
