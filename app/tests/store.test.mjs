import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createStore} from '../src/store.mjs';
import {RUNTIME_ROOT} from '../src/runtime.mjs';
import {propose,applyProposal} from '../src/domain.mjs';

test('SQLite failure after state update rolls back state, receipt, request and proposal status',()=>{
  mkdirSync(RUNTIME_ROOT,{recursive:true});const dataDir=mkdtempSync(resolve(RUNTIME_ROOT,'sql-rollback-'));
  const store=createStore(dataDir),inspector=new DatabaseSync(resolve(dataDir,'cu-workbench.sqlite'));
  try{
    const before=store.getState(),proposal=propose(before,{requestId:'sql-rollback-synthetic',actions:[{op:'workspace.create',name:'不得部分留下',template:'blank'}]});
    store.addProposal(proposal);const result=applyProposal(before,proposal);
    inspector.exec("CREATE TRIGGER synthetic_receipt_failure BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'synthetic_mid_transaction_failure'); END");
    assert.throws(()=>store.commit({expectedRevision:0,...result,requestId:'synthetic-commit',fingerprint:'known-test',proposalId:proposal.id}),/synthetic_mid_transaction_failure/);
    assert.deepEqual(store.getState(),before);assert.equal(store.getReceipt(result.receipt.id),null);assert.equal(store.request('synthetic-commit','known-test'),null);assert.equal(store.getProposal(proposal.id).status,'pending');
    inspector.exec('DROP TRIGGER synthetic_receipt_failure');
    store.commit({expectedRevision:0,...result,requestId:'synthetic-commit',fingerprint:'known-test',proposalId:proposal.id});
    assert.equal(store.getState().workspaces.length,1);assert.equal(store.getProposal(proposal.id).status,'applied');
  }finally{inspector.close();store.close();}
});

test('history merges pending plans and receipts in descending event time',()=>{
  mkdirSync(RUNTIME_ROOT,{recursive:true});const store=createStore(mkdtempSync(resolve(RUNTIME_ROOT,'history-sort-')));
  try{
    const before=store.getState(),proposal=propose(before,{requestId:'history-synthetic',actions:[{op:'workspace.create',name:'历史顺序',template:'blank'}]});
    const result=applyProposal(before,proposal);result.receipt.createdAt='2026-09-30T12:00:00.000Z';
    store.commit({expectedRevision:0,...result,requestId:'history-commit',fingerprint:'known-test'});
    store.addProposal({...proposal,id:'older-pending',createdAt:'2026-09-30T11:00:00.000Z'});
    const history=store.history();assert.equal(history[0].kind,'receipt');assert.equal(history[1].id,'older-pending');
  }finally{store.close();}
});

test('AI replacement persists atomically and a failed context insert preserves its parent draft',()=>{
  mkdirSync(RUNTIME_ROOT,{recursive:true});const dataDir=mkdtempSync(resolve(RUNTIME_ROOT,'context-rollback-'));
  const store=createStore(dataDir),inspector=new DatabaseSync(resolve(dataDir,'cu-workbench.sqlite'));
  try{
    const state=store.getState(),expiresAt=new Date(Date.now()+60000).toISOString();
    const first={...propose(state,{requestId:'context-first',actions:[{op:'workspace.create',name:'原草稿',template:'blank'}]}),contextId:'context-first'};
    const turn={messageId:'message-first',message:'建立空间',selectedComponentId:'',plan:{actions:first.actions,message:'fixture'}};
    store.saveAIResult({id:'context-first',workspaceId:'',baseRevision:0,expiresAt,turns:[turn],proposalId:first.id},first);
    const next={...propose(state,{requestId:'context-next',actions:[{op:'workspace.create',name:'修订草稿',template:'blank'}]}),contextId:'context-next'};
    const context={id:'context-next',parentContextId:'context-first',workspaceId:'',baseRevision:0,expiresAt,turns:[turn,{...turn,messageId:'message-next'}],proposalId:next.id};
    inspector.exec("CREATE TRIGGER synthetic_context_failure BEFORE INSERT ON ai_contexts BEGIN SELECT RAISE(ABORT,'synthetic_context_insert_failure'); END");
    assert.throws(()=>store.saveAIResult(context,next),/synthetic_context_insert_failure/);
    assert.equal(store.getAIContext('context-first').status,'active');assert.equal(store.getProposal(first.id).status,'pending');
    assert.equal(store.getAIContext('context-next'),null);assert.equal(store.getProposal(next.id),null);assert.deepEqual(store.getState(),state);
    inspector.exec('DROP TRIGGER synthetic_context_failure');
    store.saveAIResult(context,next);assert.equal(store.getAIContext('context-first').status,'superseded');assert.equal(store.getProposal(first.id).status,'superseded');
    assert.throws(()=>store.requireAIContext('context-next',{now:Date.parse(expiresAt)+1}),error=>error.code==='ai_context_expired');
    store.cancelAIContext('context-next');assert.equal(store.getProposal(next.id).status,'cancelled');assert.equal(store.getAIContext('context-next').status,'cancelled');
  }finally{inspector.close();store.close();}
});
