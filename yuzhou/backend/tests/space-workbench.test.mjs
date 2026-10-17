import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createStore,validateWorkspace} from '../store.mjs';
import {RUNTIME_ROOT,assertRuntimePath} from '../../runtime.mjs';
import {createWorkbench} from '../../frontend/src/workbench-model.js';
import {createCustomBlock} from '../../frontend/src/custom-blocks-model.js';
import {placeSpaceBlock} from '../../frontend/src/space-workbench-model.js';
const fixture=()=>({schema:1,mode:'personal',profile:{},english:{},courses:[],tasks:[],captures:[],workbench:createWorkbench('full'),spaces:[{id:'parent',title:'主项目',notes:[],files:[]},{id:'child',parentId:'parent',title:'子任务',notes:[],files:[]}]});
test('SQLite restart preserves nested space configuration, private block ownership and independent layout',t=>{
  mkdirSync(RUNTIME_ROOT,{recursive:true});const dir=mkdtempSync(join(RUNTIME_ROOT,'dev035-unit-'));assertRuntimePath(dir);let store=createStore(dir);
  t.after(()=>{store?.close();assertRuntimePath(dir);rmSync(dir,{recursive:true,force:true});});
  const state=fixture();placeSpaceBlock(state,'child','module:english',{x:800,y:400});const block=createCustomBlock(state,{kind:'note',spaceId:'child',title:'私有方块',config:{text:'原文保留'}});placeSpaceBlock(state,'child',block.id,{x:0,y:800});store.saveWorkspace(0,state);store.close();store=createStore(dir);assert.deepEqual(store.getWorkspace().state,state);
  const persisted=store.getWorkspace();for(const strip of [s=>{delete s.spaces[1].parentId;},s=>{delete s.spaces[1].workbench;},s=>{delete s.customBlocks.items[0].spaceId;},s=>{delete s.boards;}]){const old=structuredClone(persisted.state);strip(old);assert.throws(()=>store.saveWorkspace(persisted.revision,old),error=>error.code==='workspace_update_required');assert.deepEqual(store.getWorkspace(),persisted);}
});
test('server rejects cyclic hierarchy, invalid space configuration and orphaned custom blocks',()=>{
  const state=fixture();state.spaces[0].parentId='child';assert.throws(()=>validateWorkspace(state),error=>error.code==='invalid_space_workbench');delete state.spaces[0].parentId;
  state.spaces[1].workbench={version:1,sections:['notes'],modules:[]};assert.throws(()=>validateWorkspace(state),error=>error.code==='invalid_space_workbench');delete state.spaces[1].workbench;
  createCustomBlock(state,{kind:'note',title:'orphan',spaceId:'child'});state.spaces.pop();assert.throws(()=>validateWorkspace(state),error=>error.code==='invalid_space_workbench');
});
