import test from 'node:test';
import assert from 'node:assert/strict';
import {homeCanvasTopicLabels,visibleCanvasCards} from '../src/canvas.js';
import {validateCanvasTopicLabels,visibleWorkspaceTopicCards} from '../src/workspace-topics-model.js';
import {validateBackup,mergeBackup} from '../src/backup.js';
import {createWorkbench} from '../src/workbench-model.js';
import {createCustomBlock} from '../src/custom-blocks-model.js';
import {seedEnglish} from '../src/english-state.js';

const stamp='2026-11-11T00:00:00.000Z';
const card=(id,x=20,y=40)=>({id,x,y,w:280,h:270,color:'#7950f2'});
const label=(id,offsetX=8,offsetY=-32)=>({id,offsetX,offsetY});
const space=(id,extra={})=>({
  id,title:id,type:'project',description:'',color:'#7950f2',icon:'folder',
  archived:false,createdAt:stamp,updatedAt:stamp,files:[],notes:[],...extra,
});
function workspace(){
  return {
    schema:1,mode:'personal',profile:{name:'标签测试',major:'',provider:'deepseek'},
    workbench:createWorkbench('blank'),
    courses:[],tasks:[],captures:[],english:seedEnglish(false),spaces:[space('project')],
    canvas:{cards:[card('ai'),card('project',410,70)],snap:true,initialized:true,
      presentation:'canvas',customized:true,modifiedAt:stamp,view:{x:26,y:42,zoom:.48}},
    updatedAt:stamp,
  };
}
const backup=state=>({format:'lumi-backup',version:1,exportedAt:stamp,state,files:[]});

test('canvas labels are opt-in and reading old or empty layouts leaves state untouched',()=>{
  const state=workspace();
  const before=structuredClone(state);
  assert.deepEqual(homeCanvasTopicLabels(state),[]);
  assert.deepEqual(state,before);
  state.canvas.topicLabels=[];
  const empty=structuredClone(state);
  assert.deepEqual(homeCanvasTopicLabels(state),[]);
  assert.deepEqual(state,empty);
  assert.deepEqual(homeCanvasTopicLabels({...state,canvas:undefined}),[]);
  state.canvas.topicLabels={id:'project'};
  assert.deepEqual(homeCanvasTopicLabels(state),[],'malformed labels cannot break the existing canvas');
});

test('canvas labels derive current theme text and follow their original card geometry',()=>{
  const state=workspace();
  state.canvas.topicLabels=[label('project')];
  state.workspaceTopics={assignments:[{id:'project',topic:'课程复习'}],receipts:[]};
  const before=structuredClone(state);
  assert.deepEqual(homeCanvasTopicLabels(state),[{
    id:'project',offsetX:8,offsetY:-32,text:'课程复习',x:418,y:38,
  }]);
  assert.deepEqual(state,before,'labels do not rewrite layout or classifications');

  state.canvas.cards.find(row=>row.id==='project').x+=91;
  state.canvas.cards.find(row=>row.id==='project').y-=17;
  state.workspaceTopics.assignments[0].topic='小组项目';
  const moved=homeCanvasTopicLabels(state)[0];
  assert.equal(moved.x,509);
  assert.equal(moved.y,21);
  assert.equal(moved.text,'小组项目');

  state.workspaceTopics.assignments[0].topic=null;
  assert.equal(homeCanvasTopicLabels(state)[0].text,'未归类','undo to null is reflected immediately');
  state.workspaceTopics.assignments=[];
  assert.equal(homeCanvasTopicLabels(state)[0].text,'未归类');
});

test('multiple anchors in one current theme produce one group label',()=>{
  const state=workspace();
  state.spaces.push(space('second'),space('ungrouped'));
  state.canvas.cards.push(card('second',700,50),card('ungrouped',1000,80));
  state.canvas.topicLabels=[label('project'),label('second'),label('ai'),label('ungrouped')];
  state.workspaceTopics={assignments:[
    {id:'project',topic:'同一主题'},{id:'second',topic:'同一主题'},
  ],receipts:[]};
  const labels=homeCanvasTopicLabels(state);
  assert.deepEqual(labels.map(row=>[row.id,row.text]),[['project','同一主题'],['ungrouped','未归类']]);
  assert.equal(state.canvas.cards.length,4,'labels do not become extra cards');
});

test('the built-in AI partner stays on the canvas but cannot carry a topic, even in older layouts',()=>{
  const state=workspace();
  state.canvas.topicLabels=[label('ai'),label('project')];
  state.workspaceTopics={assignments:[{id:'ai',topic:'旧主题'}],receipts:[]};
  createCustomBlock(state,{kind:'note',title:'AI伙伴'},{id:'block:same-name',now:stamp});
  const before=structuredClone(state);
  assert.deepEqual(visibleCanvasCards(state).map(row=>row.id),['ai','project']);
  assert.deepEqual(visibleWorkspaceTopicCards(state).map(row=>row.id),['block:same-name','project']);
  assert.deepEqual(homeCanvasTopicLabels(state).map(row=>[row.id,row.text]),[['project','未归类']]);
  assert.deepEqual(state,before);
});

test('labels exclude hidden modules, archived records, nested records and missing anchors',()=>{
  const state=workspace();
  state.spaces.push(space('archived',{archived:true}),space('child',{parentId:'project'}));
  createCustomBlock(state,{kind:'note',title:'顶层方块'},{id:'block:root',now:stamp});
  createCustomBlock(state,{kind:'note',title:'归档方块'},{id:'block:archived',now:stamp});
  createCustomBlock(state,{kind:'note',title:'子空间方块',spaceId:'project'},{id:'block:nested',now:stamp});
  state.customBlocks.items.find(row=>row.id==='block:archived').archived=true;
  const extraIds=['courses','archived','child','block:root','block:archived','block:nested','missing'];
  state.canvas.cards.push(...extraIds.map((id,index)=>card(id,600+index*300,90)));
  state.canvas.topicLabels=extraIds.map(id=>label(id));
  state.workspaceTopics={assignments:extraIds.map(id=>({id,topic:'主题 '+id})),receipts:[]};
  const before=structuredClone(state);
  assert.deepEqual(homeCanvasTopicLabels(state).map(row=>row.id),['block:root']);
  assert.deepEqual(state,before);
});

test('label configuration validates anchors, finite offsets, uniqueness and exact fields',()=>{
  const valid=[label('project',-100000,100000),label('block:root',.5,-28.25)];
  const copy=validateCanvasTopicLabels(valid);
  assert.deepEqual(copy,valid);
  assert.notEqual(copy,valid);
  assert.notEqual(copy[0],valid[0]);
  assert.deepEqual(validateCanvasTopicLabels([]),[]);
  const invalid=[
    undefined,null,{},'labels',
    [null],[{id:'project',offsetX:0}],
    [label('')],[label('__proto__')],[label('constructor')],[label('bad\nid')],
    [label('x'.repeat(161))],
    [label('project','8',0)],[label('project',NaN,0)],
    [label('project',0,Infinity)],[label('project',-Infinity,0)],
    [label('project',100001,0)],[label('project',0,-100001)],
    [{...label('project'),text:'stale copied theme'}],
    [label('project'),label('project',80,90)],
  ];
  invalid.forEach((value,index)=>assert.throws(
    ()=>validateCanvasTopicLabels(value),undefined,'invalid label case '+index,
  ));
});

test('backup roundtrip retains label anchors and card geometry while legacy canvases stay opt-in',()=>{
  const source=workspace();
  source.canvas.topicLabels=[label('project',-14,-28),label('ai',0,-30)];
  const before=structuredClone(source);
  const checked=validateBackup(JSON.parse(JSON.stringify(backup(source))));
  assert.deepEqual(checked.state.canvas,source.canvas);
  assert.deepEqual(source,before);

  const empty=workspace();
  delete empty.canvas;
  const restored=mergeBackup(empty,checked);
  assert.deepEqual(restored.state.canvas,source.canvas);
  assert.equal(restored.state.canvas.cards.length,2);
  assert.equal(homeCanvasTopicLabels(restored.state).length,1,'unassigned anchors still share one current theme');

  const legacy=workspace();
  const oldBackup=validateBackup(backup(legacy));
  assert.equal(Object.hasOwn(oldBackup.state.canvas,'topicLabels'),false);
  assert.deepEqual(homeCanvasTopicLabels(oldBackup.state),[]);
  const invalid=structuredClone(source);
  invalid.canvas.topicLabels=[label('project',0,Infinity)];
  assert.throws(()=>validateBackup(backup(invalid)));

  const explicitlyEmpty=workspace();
  explicitlyEmpty.canvas.topicLabels=[];
  assert.deepEqual(validateBackup(backup(explicitlyEmpty)).state.canvas.topicLabels,[]);
});
