import test from 'node:test';
import assert from 'node:assert/strict';
import {applyOrganizedContent} from '../src/ai-organizer.js';
import {undoRoute} from '../src/workspace-model.js';
import {isRecordColor} from '../src/creation-colors.js';

function fixture(target='space:union'){
  return {ui:{lastCreatedColor:'#AE88FF'},spaces:[{id:'union',title:'学生会',notes:[],files:[]}],courses:[],tasks:[],captures:[],
    aiRequests:[{id:'request',targetId:target,status:'waiting_model',files:[{id:'file',blobId:'blob',name:'会议.txt',size:3,type:'text/plain'}]}]};
}
function proposal(destinationId='space:union'){
  return {title:'活动筹备',summary:'活动计划',destinationId,notes:[{title:'活动重点',content:'现场安排',sourceIds:['input']}],tasks:[{title:'确认场地',description:'联系负责人',date:'',priority:'normal'}],reason:'学生会事项',warnings:[]};
}

test('AI notes, original files and tasks receive distinct consecutive colors before receipt snapshots',async()=>{
  const state=fixture();let next=0;
  const receipt=applyOrganizedContent(state,'request',proposal(),{uid:()=>`id-${++next}`});
  const records=[state.spaces[0].notes[0],state.spaces[0].files[0],state.tasks[0]];
  let previous='#AE88FF';
  for(const [index,record]of records.entries()){
    assert.ok(isRecordColor(record.color));assert.notEqual(record.color.toLowerCase(),previous.toLowerCase());previous=record.color;
    assert.deepEqual(JSON.parse(receipt.items[index].snapshot),record);
  }
  assert.equal(state.ui.lastCreatedColor,records.at(-1).color);
  const saved=structuredClone(state);assert.equal(applyOrganizedContent(state,'request',proposal()),receipt);assert.deepEqual(state,saved);
  assert.deepEqual(await undoRoute({state,save(){}},receipt,'request'),{removed:3,retained:0});
});

test('AI captures and tasks use the same cursor across destinations',()=>{
  const state=fixture('inbox');let next=0;
  const receipt=applyOrganizedContent(state,'request',proposal('inbox'),{uid:()=>`id-${++next}`});
  let previous='#AE88FF';
  for(const item of receipt.items){
    const record=state[item.collection].find(record=>record.id===item.id);
    assert.ok(isRecordColor(record.color));assert.notEqual(record.color.toLowerCase(),previous.toLowerCase());previous=record.color;
    assert.deepEqual(JSON.parse(item.snapshot),record);
  }
  assert.equal(state.ui.lastCreatedColor,previous);
});

test('invalid AI output, missing destination, and failed preparation leave colors and content untouched',()=>{
  for(const change of [p=>{p.notes[0].sourceIds=['missing'];},p=>{p.destinationId='space:missing';},p=>{p.notes=[];p.tasks=[];p.summary='';}]){
    const state=fixture();state.aiRequests[0].files=[];const before=structuredClone(state),input=proposal();change(input);
    assert.throws(()=>applyOrganizedContent(state,'request',input));assert.deepEqual(state,before);
  }
  const state=fixture(),before=structuredClone(state);let next=0;
  assert.throws(()=>applyOrganizedContent(state,'request',proposal(),{uid:()=>{if(++next===2)throw new Error('failed preparation');return 'first';}}),/failed preparation/);
  assert.deepEqual(state,before);
});
