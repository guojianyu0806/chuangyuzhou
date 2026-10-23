import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createStore} from '../store.mjs';

const board=(presentation,stackPointer)=>({presentation,stackPointer,customized:true,
  cards:[{id:'one',x:-36,y:120,w:320,h:280,color:'#AE88FF'}],view:{x:15,y:-12,zoom:.7},snap:true,initialized:true});

test('layout choices and pointer heights persist across devices and server restarts without moving free-canvas cards',t=>{
  const directory=mkdtempSync(join(tmpdir(),'yuzhou-canvas-layout-'));
  let store=createStore(directory);
  t.after(()=>{
    store.close();
    const target=resolve(directory),allowedPrefix=resolve(join(tmpdir(),'yuzhou-canvas-layout-'));
    if(!target.startsWith(allowedPrefix))throw new Error('Unexpected canvas test cleanup target');
    rmSync(target,{recursive:true,force:true});
  });
  const original={schema:1,mode:'personal',profile:{},english:{},courses:[],tasks:[],captures:[],
    canvas:board('stack',.68),courseCanvas:board('grid-2',.22),boards:{tasks:board('grid-3',.5),'course:one:notes':board('stack',0)}};
  store.saveWorkspace(0,original);
  const secondDevice=store.getWorkspace();
  assert.deepEqual(secondDevice.state,original);
  secondDevice.state.canvas.presentation='grid-3';
  secondDevice.state.canvas.stackPointer=1;
  store.saveWorkspace(secondDevice.revision,secondDevice.state);
  assert.throws(()=>store.saveWorkspace(1,original),error=>error.code==='revision_conflict');
  store.close();store=createStore(directory);
  const restored=store.getWorkspace();
  assert.equal(restored.revision,2);
  assert.deepEqual(restored.state,secondDevice.state);
  assert.deepEqual(restored.state.canvas.cards,original.canvas.cards);
  assert.deepEqual(restored.state.canvas.view,original.canvas.view);
});
