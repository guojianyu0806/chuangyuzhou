import test from 'node:test';
import assert from 'node:assert/strict';
import {previewOrganizedContent,applyOrganizedContent} from '../src/ai-organizer.js';
const proposal={title:'活动准备',summary:'活动分工',destinationId:'tasks',notes:[],tasks:[{title:'联系场地',description:'确认容量',date:'2026-09-23',priority:'high'}],reason:'用户要求',warnings:[]};
const state=()=>({ui:{lastCreatedColor:'#ae88ff'},aiRequests:[{id:'r',targetId:'auto',status:'waiting_model',files:[{id:'f',name:'会议.txt',blobId:'blob',type:'text/plain'}]}],spaces:[{id:'union',title:'学生会',notes:[],files:[]}],courses:[],captures:[],tasks:[]});
test('review lists fallback summary, original attachment and task with actual destinations without mutations',()=>{
 const s=state(),before=structuredClone(s),actions=previewOrganizedContent(s,'r',proposal);assert.deepEqual(s,before);
 assert.equal(actions.length,3);assert.deepEqual(actions.map(a=>a.destination),['收集箱','收集箱','备忘与待办']);
 assert.equal(actions[0].content,'活动准备\n\n活动分工');assert.equal(actions[1].fileName,'会议.txt');assert.equal(actions[2].date,'2026-09-23');assert.equal(actions[2].priority,'重要');
 let index=0;const receipt=applyOrganizedContent(s,'r',proposal,{uid:()=>String(++index)});assert.equal(receipt.items.length,actions.length);assert.equal(s.captures.length,2);assert.equal(s.tasks.length,1);
});
test('workspace review includes full note content and keeps tasks in task module',()=>{
 const s=state(),p={...proposal,destinationId:'space:union',notes:[{title:'详细笔记',content:'完整正文\n附加事项',sourceIds:['input']}]};
 const actions=previewOrganizedContent(s,'r',p);assert.deepEqual(actions.map(a=>a.destination),['学生会','学生会','备忘与待办']);assert.equal(actions[0].content,p.notes[0].content);assert.equal(s.spaces[0].notes.length,0);
 s.spaces[0].archived=true;assert.throws(()=>previewOrganizedContent(s,'r',p),/不存在/);
});
