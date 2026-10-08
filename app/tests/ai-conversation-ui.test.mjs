import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationFrom,continuationProblem,proposalCanConfirm,savedSelectionId,buildPlanRequest,requestPlan} from '../frontend/sandbox/ai-conversation.js';

const now=Date.parse('2026-10-08T09:00:00Z');
const metadata={contextId:'server-turn-1',contextWorkspaceId:'w',contextBaseRevision:4,contextExpiresAt:'2026-10-08T09:30:00Z'};
const input={message:'  改成周五  ',baseRevision:4,workspaceId:'w',context:conversationFrom(metadata),now};

test('continuation sends the server handle and current selection without invented chat history',()=>{
 assert.deepEqual(buildPlanRequest({...input,selectedComponentId:'new-selection'}),{baseRevision:4,message:'改成周五',workspaceId:'w',selectedComponentId:'new-selection',contextId:'server-turn-1'});
 assert.deepEqual(buildPlanRequest({...input,context:null}),{baseRevision:4,message:'改成周五',workspaceId:'w'});
 assert.equal(conversationFrom({message:'untrusted display text'}),null);
});

test('workspace changes, edits, expired and remotely closed conversations cannot continue',()=>{
 for(const [change,expected] of [[{workspaceId:'other'},/切换空间/],[{baseRevision:5},/内容已变化/],[{now:now+31*60*1000},/过期/]])assert.throws(()=>buildPlanRequest({...input,...change}),expected);
 assert.match(continuationProblem({...input.context,error:'话题已结束'},{baseRevision:4,workspaceId:'w',now}),/已结束/);
 assert.match(continuationProblem({...input.context,expiresAt:'invalid'},{baseRevision:4,workspaceId:'w',now}),/过期/);
});

test('failed planning never cancels or mutates the existing proposal and context',async()=>{
 const proposal={id:'proposal-1',status:'pending',baseRevision:4};
 const state={...input,proposal},before=structuredClone(state),calls=[];
 await assert.rejects(requestPlan(state,async(path,options)=>{calls.push({path,options});throw Error('模型超时');}),/模型超时/);
 assert.deepEqual(state,before);
 assert.equal(calls.length,1);
 assert.equal(calls[0].path,'/api/ai/plan');
});

test('a successful clarification rotates the context and retains no executable draft',async()=>{
 const next={...metadata,contextId:'server-turn-2'};
 const result=await requestPlan(input,async()=>({...next,proposal:null,message:'周五几点？',clarification:true}));
 assert.equal(result.proposal,null);
 assert.equal(result.conversation.id,'server-turn-2');
 assert.equal(buildPlanRequest({...input,context:result.conversation,message:'下午三点'}).contextId,'server-turn-2');
 assert.equal(input.context.id,'server-turn-1');
});

test('confirmation recovers when revision text is cleared but stale or closed drafts remain blocked',()=>{
 const proposal={id:'proposal-1',baseRevision:4,status:'pending'};
 assert.equal(proposalCanConfirm(proposal,{baseRevision:4,message:'改到周五'}),false);
 assert.equal(proposalCanConfirm(proposal,{baseRevision:4,message:'  '}),true);
 assert.equal(proposalCanConfirm(proposal,{baseRevision:5}),false);
 assert.equal(proposalCanConfirm(proposal,{baseRevision:4,busy:true}),false);
 for(const status of ['stale','superseded','cancelled','applied'])assert.equal(proposalCanConfirm({...proposal,status},{baseRevision:4}),false);
 assert.equal(proposalCanConfirm({...proposal,origin:'manual'},{baseRevision:4,message:'不相关输入'}),true);
});

test('a draft which creates a new space continues using the original request space',()=>{
 const proposal={id:'proposal-new-space',workspaceId:'created-only-in-preview',...metadata};
 assert.equal(conversationFrom(proposal).workspaceId,'w');
 const emptyContext=conversationFrom({...metadata,contextWorkspaceId:''});
 assert.deepEqual(buildPlanRequest({...input,workspaceId:'',context:emptyContext}),{baseRevision:4,message:'改成周五',contextId:'server-turn-1'});
});

test('selecting a new preview module does not claim it exists in the saved space',()=>{
 const state={components:[{id:'saved-module',workspaceId:'w'},{id:'other-module',workspaceId:'other'},{id:'archived-module',workspaceId:'w',archived:true}]};
 assert.equal(savedSelectionId(state,'saved-module','w'),'saved-module');
 for(const id of ['preview-only-module','other-module','archived-module','']){
  const selectedComponentId=savedSelectionId(state,id,'w');
  assert.equal(selectedComponentId,'');
  assert.equal('selectedComponentId' in buildPlanRequest({...input,selectedComponentId}),false);
 }
 assert.equal(savedSelectionId(state,'saved-module',''),'');
});
