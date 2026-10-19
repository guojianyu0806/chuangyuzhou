import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackup,mergeBackup} from '../src/backup.js';
import {seedEnglish} from '../src/english.js';
import {applyWorkspaceActions,previewWorkspaceActions,undoWorkspaceActions} from '../src/workspace-actions.js';

const NOW='2026-10-09T13:00:00.000Z';
const LABELS={cards:'灵感墙',canvas:'自由画布',dream:'梦境模式'};
function fixture(view){
  return {
    schema:1,mode:'personal',profile:{name:'合成验证',major:'',provider:'deepseek'},
    spaces:[],courses:[],tasks:[],aiRequests:[],english:seedEnglish(false),updatedAt:NOW,
    ui:{sidebarPinned:true,lastCreatedColor:'#63E6DC',...(view===undefined?{}:{inboxView:view})},
    captures:[{id:'idea-existing',text:'已有想法，保持内容与手工位置。',category:'备忘',tags:'测试',color:'#FF9CCE',archived:false,createdAt:NOW}],
    boards:{inbox:{cards:[{id:'idea-existing',x:173,y:-85,w:340,h:390,color:'#FF9CCE'}],snap:false,initialized:true,customized:true,presentation:'stack',stackPointer:.7,view:{x:43,y:-26,zoom:.8},modifiedAt:NOW}},
  };
}
const backup=state=>({format:'lumi-backup',version:1,exportedAt:NOW,state,files:[]});
const action=view=>({entity:'uiSettings',operation:'update',id:'ui-settings',data:{inboxView:view}});
function apply(state,actions){let sequence=0;return applyWorkspaceActions(state,'inspiration-view',actions,{now:NOW,uid:()=>`inspiration-${++sequence}`});}
const undo=(state,receipt)=>undoWorkspaceActions({state,save:()=>{}},receipt,'inspiration-view');

test('inspiration display choices roundtrip legacy and new backups without migrating coordinates or records',()=>{
  for(const view of [undefined,'cards','dream','canvas']){
    const state=fixture(view),before=structuredClone(state);
    const restored=validateBackup(JSON.parse(JSON.stringify(backup(state)))).state;
    assert.equal(restored.ui.inboxView,view);
    assert.equal(Object.hasOwn(restored.ui,'inboxView'),view!==undefined);
    assert.deepEqual(restored.boards,state.boards);
    assert.equal(restored.captures[0].text,state.captures[0].text);
    assert.equal(restored.captures[0].color,state.captures[0].color);
    assert.deepEqual(state,before);
  }
});

test('backup import restores a missing view choice but never replaces an explicit choice or a customized board',()=>{
  for(const importedView of Object.keys(LABELS)){
    const imported=validateBackup(backup(fixture(importedView)));
    imported.state.boards.inbox.cards[0].x=990;
    for(const currentView of [undefined,...Object.keys(LABELS)]){
      const current=fixture(currentView),before=structuredClone(current);
      const merged=mergeBackup(current,imported);
      assert.equal(merged.state.ui.inboxView,currentView??importedView);
      assert.deepEqual(merged.state.boards,before.boards);
      assert.equal(merged.state.captures[0].text,before.captures[0].text);
      assert.deepEqual(current,before);
      assert.equal(mergeBackup(merged.state,imported).count,0);
    }
  }
});

test('backup validation rejects unsupported or malformed inspiration choices',()=>{
  for(const view of ['wall','arbitrary',null,{},1]){
    assert.throws(()=>validateBackup(backup(fixture(view))),/灵感显示方式/);
  }
});

test('AI previews name all inspiration views, leave state untouched and only change preferences after apply',async()=>{
  for(const previous of [undefined,...Object.keys(LABELS)]){
    for(const next of Object.keys(LABELS)){
      if(next===previous)continue;
      const state=fixture(previous),before=structuredClone(state),actions=[action(next)];
      const preview=previewWorkspaceActions(state,actions,{now:NOW});
      assert.equal(preview.length,1);
      const field=preview[0].fields.find(row=>row.label==='灵感显示方式');
      assert.equal(field.before,previous===undefined?'未设置':LABELS[previous]);
      assert.equal(field.after,LABELS[next]);
      assert.deepEqual(state,before,'preparing a preview cannot apply its preference');
      const receipt=apply(state,actions);
      assert.deepEqual(state.ui,{...before.ui,inboxView:next});
      assert.deepEqual(state.captures,before.captures);
      assert.deepEqual(state.boards,before.boards);
      assert.deepEqual(await undo(state,receipt),{removed:1,retained:0});
      assert.deepEqual(state.ui,before.ui);
      assert.deepEqual(state.captures,before.captures);
      assert.deepEqual(state.boards,before.boards);
    }
  }
});

test('undo keeps a later manual inspiration choice and leaves unrelated capture edits intact',async()=>{
  const state=fixture('dream'),receipt=apply(state,[action('canvas')]);
  state.ui.inboxView='cards';
  state.captures[0].text='确认之后补写的真实内容';
  state.boards.inbox.cards[0].x=280;
  assert.deepEqual(await undo(state,receipt),{removed:0,retained:1});
  assert.equal(state.ui.inboxView,'cards');
  assert.equal(state.captures[0].text,'确认之后补写的真实内容');
  assert.equal(state.boards.inbox.cards[0].x,280);
});

test('invalid AI view choices fail an entire mixed proposal atomically',()=>{
  const state=fixture('dream'),before=structuredClone(state);
  for(const invalid of ['wall','unsupported',null,{}]){
    const actions=[action('canvas'),action(invalid)];
    assert.throws(()=>previewWorkspaceActions(state,actions,{now:NOW}),/选项不受支持/);
    assert.throws(()=>apply(state,actions),/选项不受支持/);
    assert.deepEqual(state,before);
  }
});
