import test from 'node:test';
import assert from 'node:assert/strict';
import {engineAvailable,modelReady,modelStatusLabel,modelEngineDescription} from '../src/model-status.js';
import {startAIJob,jobFor,jobWorking} from '../src/ai-cloud.js';

test('a saved key cannot make an unavailable engine ready, including a stale Hermes flag', () => {
  const status={configured:true,engineAvailable:false,hermesAvailable:true};
  assert.equal(engineAvailable(status),false);
  assert.equal(modelReady(status),false);
  assert.match(modelStatusLabel(status),/密钥已保存.*引擎待配置/);
});

test('direct engine readiness does not require Hermes, while legacy status remains compatible', () => {
  const status={configured:true,engine:'deepseek-direct',engineAvailable:true,hermesAvailable:false};
  assert.equal(modelReady(status),true);
  assert.match(modelEngineDescription(status),/无需安装 Hermes/);
  assert.equal(modelReady({configured:true,hermesAvailable:true}),true);
  assert.equal(modelReady({configured:false,engineAvailable:true}),false);
  assert.equal(modelReady(undefined),false);
});

function fixture(status) {
  const calls=[];
  const request={id:'synthetic-request',text:'整理合成会议记录',files:[{blobId:'synthetic-file'}],targetId:'inbox'};
  const ctx={state:{mode:'personal',aiRequests:[request]},uid:()=> 'synthetic-message',save:()=>calls.push('save'),cloud:{enabled:true,
    flush:async()=>calls.push('flush'),request:async(path,options)=>{
      calls.push(path);
      if(path==='/api/model/status')return status;
      assert.equal(options.body.fileIds[0],'synthetic-file');
      return {job:{id:'synthetic-job',requestId:request.id,status:'queued'}};
    }}};
  return {ctx,request,calls};
}

test('unavailable engine rejects before data flush or job creation and retains source text and files',async()=>{
  const {ctx,request,calls}=fixture({configured:true,engineAvailable:false,hermesAvailable:true});
  const before=structuredClone(request);
  await assert.rejects(startAIJob(ctx,request),/引擎待配置/);
  assert.deepEqual(calls,['/api/model/status']);
  assert.deepEqual(request,before);
  assert.equal(jobFor(ctx.state,request.id).status,'failed');
});

test('direct engine starts the existing job protocol without a Hermes dependency',async()=>{
  const {ctx,request,calls}=fixture({configured:true,engineAvailable:true,hermesAvailable:false,engine:'deepseek-direct'});
  await startAIJob(ctx,request);
  assert.deepEqual(calls,['/api/model/status','save','flush','/api/ai/jobs']);
  assert.equal(jobFor(ctx.state,request.id).id,'synthetic-job');
});

test('status check is not displayed as a running reply and prevents duplicate submissions',async()=>{
  const {ctx,request,calls}=fixture({});
  let resolveStatus;
  ctx.cloud.request=async path=>{calls.push(path);return await new Promise(resolve=>{resolveStatus=resolve;});};
  const starting=startAIJob(ctx,request);
  assert.equal(jobFor(ctx.state,request.id).status,'checking');
  assert.equal(jobWorking(jobFor(ctx.state,request.id)),false);
  await startAIJob(ctx,request);
  assert.equal(calls.length,1);
  resolveStatus({configured:false,engineAvailable:true});
  await assert.rejects(starting,/API Key/);
  assert.equal(jobFor(ctx.state,request.id).status,'failed');
});
