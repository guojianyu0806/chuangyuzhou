// Standalone Node process keeps production validators and cloned objects in one realm.
import assert from 'node:assert/strict';
import {parseModelOutput,validateProposal,workspaceDestinations} from '../yuzhou/backend/hermes.mjs';
import {validateWorkspaceActions,previewWorkspaceActions,applyWorkspaceActions} from '../yuzhou/frontend/src/workspace-actions.js';
import {validateCustomBlockReadAccess} from '../yuzhou/backend/workspace-queries.mjs';
import {validateWorkspace} from '../yuzhou/backend/store.mjs';
import {createProbeSession} from './dev026-live-probe.mjs';

const now='2026-10-15T00:00:00.000Z';
const title='连接验收便签';
const texts=['先审阅，再写入','修订验收完成，仍待确认。'];
const emptyState=()=>({schema:1,mode:'personal',profile:{name:'合成验证',major:'',provider:'deepseek'},courses:[],spaces:[],tasks:[],captures:[],english:{},calendar:{version:1,events:[]},ledger:{version:1,currency:'CNY',projects:[],entries:[]},aiRequests:[],aiDraft:{text:'',files:[],targetId:'auto'},updatedAt:now});

function validateBundle(value){
  const state=emptyState(),before=JSON.stringify(state),checks={};
  for(const [index,key] of ['initial','revision'].entries()){
    const parsed=parseModelOutput(JSON.stringify(value[key]));
    const proposal=validateProposal(parsed.proposal,workspaceDestinations(state),new Set(['input']),'workspace');
    validateWorkspaceActions(proposal.actions);
    validateCustomBlockReadAccess(proposal.actions,[]);
    const preview=previewWorkspaceActions(state,proposal.actions,{requestId:'synthetic-dev026',now});
    const action=proposal.actions[0];
    checks[key+'ValidProposal']=proposal.actions.length===1&&action.entity==='customBlock'&&action.operation==='create'&&action.data.kind==='note'&&!action.id;
    checks[key+'RequestedContent']=action.data.title===title&&action.data.config.text===texts[index];
    checks[key+'PreviewOnly']=preview.length===1&&JSON.stringify(state)===before;
    const simulation=structuredClone(state);let sequence=0;
    const receipt=applyWorkspaceActions(simulation,'synthetic-dev026',proposal.actions,{uid:()=>`synthetic-${++sequence}`,now});
    validateWorkspace(simulation);
    checks[key+'InMemoryExecution']=receipt.items.length===1&&simulation.customBlocks.items.length===1&&simulation.customBlocks.items[0].config.text===texts[index];
  }
  checks.originalStateUnchanged=JSON.stringify(state)===before;
  return checks;
}

const fixture=text=>({reply:'方案等待审核。',proposal:{title:'创建便签',summary:'待审核',destinationId:'workspace',reason:'用户要求',warnings:[],actions:[{entity:'customBlock',operation:'create',data:{kind:'note',title,config:{text}}}]}});
if(process.argv.includes('--self-test')){
  const checks=validateBundle({initial:fixture(texts[0]),revision:fixture(texts[1])});
  assert.ok(Object.values(checks).every(Boolean));
  const incorrect={initial:fixture(texts[0]),revision:fixture('错误内容')};
  assert.equal(validateBundle(incorrect).revisionRequestedContent,false);
  console.log(JSON.stringify({offlineChecks:checks,rejectsWrongRevision:true}));
}else if(process.argv.includes('--final-authorized-request')){
  let input='';for await(const chunk of process.stdin)input+=chunk;
  const session=createProbeSession(input.trim(),{resumeLocalValidationFailure:true});input='';
  try{
    const result=await session.run({label:'note-create-and-revision-one-response',maxOutputTokens:512,
      system:'Return JSON only with two keys initial and revision. Each value uses this exact envelope: {"reply":"short Chinese text","proposal":{"title":"short title","summary":"short summary","destinationId":"workspace","reason":"user request","warnings":[],"actions":[{"entity":"customBlock","operation":"create","data":{"kind":"note","title":"requested note title","config":{"text":"requested text"}}}]}}. Each is an UNEXECUTED human-review proposal, exactly one create action, no id, tools or queries. The revision fully replaces the initial proposal; neither has been executed.',
      user:'生成两个待审核方案。initial：创建名为“连接验收便签”的便签，正文严格为“先审阅，再写入”。revision：用户在执行前改变了想法，保留名称，正文严格改为“修订验收完成，仍待确认。”。都只生成方案，不声称已写入。',
      validate:validateBundle});
    console.log(JSON.stringify(result));
  }finally{console.log(JSON.stringify(session.close()));}
}
