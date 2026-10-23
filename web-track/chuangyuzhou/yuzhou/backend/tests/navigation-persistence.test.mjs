import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createStore,validateWorkspace} from '../store.mjs';
import {assertRuntimePath} from '../../runtime.mjs';
import {createWorkbench} from '../../frontend/src/workbench-model.js';
import {configureNavigation,getNavigationItems,resetNavigation} from '../../frontend/src/navigation-model.js';
import {validateBackup,mergeBackup} from '../../frontend/src/backup.js';
import {applyWorkspaceActions,previewWorkspaceActions,undoWorkspaceActions} from '../../frontend/src/workspace-actions.js';
import {workspaceFingerprint} from '../workspace-queries.mjs';

const NOW='2026-10-13T12:00:00.000Z';
const fixture=()=>({schema:1,mode:'personal',profile:{},english:{},courses:[],spaces:[{id:'project-a',title:'合成项目',notes:[],files:[]}],tasks:[{id:'kept-task',title:'合成待办'}],captures:[],aiRequests:[],workbench:createWorkbench('full'),updatedAt:NOW});
const backup=state=>({format:'lumi-backup',version:1,state,files:[],exportedAt:NOW});
function temporary(t,beforeCleanup){assertRuntimePath(tmpdir());const directory=mkdtempSync(join(tmpdir(),'czb-navigation-'));t.after(()=>{beforeCleanup();const target=resolve(directory);assertRuntimePath(target);assert.ok(target.startsWith(resolve(join(tmpdir(),'czb-navigation-'))));rmSync(target,{recursive:true,force:true});});return directory;}

test('sidebar preferences survive SQLite restart, backup restore and explicit reset without altering records',t=>{
  let store;const directory=temporary(t,()=>store?.close());store=createStore(directory);
  const initial=fixture(),records=structuredClone(initial.tasks);configureNavigation(initial,{id:'tasks',placement:'more',position:0});configureNavigation(initial,{id:'space:project-a',placement:'hidden'});store.saveWorkspace(0,initial);store.close();store=createStore(directory);
  const restored=store.getWorkspace();assert.deepEqual(restored.state.workbench.navigation,initial.workbench.navigation);assert.deepEqual(restored.state.tasks,records);
  const exported=validateBackup(backup(restored.state));assert.deepEqual(exported.state.workbench.navigation,initial.workbench.navigation);
  const fresh=fixture();fresh.workbench=createWorkbench('blank');const merged=mergeBackup(fresh,backup(restored.state));assert.deepEqual(merged.state.workbench.navigation,initial.workbench.navigation);assert.deepEqual(getNavigationItems(merged.state),getNavigationItems(initial));
  resetNavigation(restored.state);store.saveWorkspace(restored.revision,restored.state);assert.equal(store.getWorkspace().state.workbench.navigation,undefined);assert.deepEqual(store.getWorkspace().state.tasks,records);
});

test('server and backup reject malformed sidebar preferences, while completed current preferences win imports',()=>{
  for(const navigation of [{version:1,items:[{id:'builder',placement:'hidden'}]},{version:1,items:[{id:'missing',placement:'primary'}]},{version:1,items:[{id:'tasks',placement:'primary'},{id:'tasks',placement:'more'}]}]){
    const state=fixture();state.workbench.navigation=navigation;assert.throws(()=>validateWorkspace(state));assert.throws(()=>validateBackup(backup(state)));
  }
  const current=fixture(),source=fixture();configureNavigation(current,{id:'english',placement:'more'});configureNavigation(source,{id:'english',placement:'hidden'});
  assert.deepEqual(mergeBackup(current,backup(source)).state.workbench.navigation,current.workbench.navigation);
});

test('AI module plans preserve sidebar preferences and navigation edits invalidate stale workbench undo',async()=>{
  const state=fixture();configureNavigation(state,{id:'tasks',placement:'more',position:0});const navigation=structuredClone(state.workbench.navigation),before=structuredClone(state),fingerprint=workspaceFingerprint(state);
  const actions=[{entity:'workbenchModule',operation:'update',id:'tasks',data:{title:'项目推进',position:2}},{entity:'workbenchSettings',operation:'update',id:'workbench',data:{title:'项目工作台'}}];
  previewWorkspaceActions(state,actions);assert.deepEqual(state,before);let counter=0;
  const receipt=applyWorkspaceActions(state,'synthetic-navigation',actions,{now:NOW,uid:()=>`navigation-${++counter}`});assert.deepEqual(state.workbench.navigation,navigation);validateWorkspace(state);assert.deepEqual(validateBackup(backup(state)).state.workbench.navigation,navigation);
  configureNavigation(state,{id:'tasks',placement:'hidden'});assert.notEqual(workspaceFingerprint(state),fingerprint);const manual=structuredClone(state.workbench);
  const result=await undoWorkspaceActions({state,uid:()=>`undo-${++counter}`,save:async()=>{}},receipt,'synthetic-navigation');assert.ok(result.retained>0);assert.deepEqual(state.workbench,manual);
});
