import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOrganizedProposal,applyOrganizedContent,previewOrganizedContent} from '../src/ai-organizer.js';
import {selectEntries,summarizeEntries,validateLedger} from '../src/ledger-model.js';
import {validateBackup} from '../src/backup.js';
import {seedEnglish} from '../src/english.js';
import {undoRoute} from '../src/workspace-model.js';
const stamp='2026-09-21T00:00:00.000Z';
const row=(type='expense',amount='128.50')=>({type,amount,date:'2026-10-01',category:'交通',note:'高铁票',sourceIds:['input']});
const plan=()=>({title:'国庆出游账单',summary:'确认后记入项目',destinationId:'ledger:trip',notes:[],tasks:[],reason:'用户指定',warnings:[],ledgerEntries:[row(),{...row('expense','399.99'),category:'住宿',note:'酒店'},row('income','30')]});
const state=()=>({schema:1,mode:'personal',profile:{name:'测试',major:'软件工程',provider:'deepseek'},courses:[],spaces:[],tasks:[],captures:[],english:seedEnglish(false),updatedAt:stamp,ledger:{version:1,currency:'CNY',projects:[{id:'trip',title:'国庆出游',includeInTotal:false,color:'#00b8b0',archived:false,createdAt:stamp,updatedAt:stamp}],entries:[]},aiRequests:[{id:'r',text:'账单',targetId:'auto',status:'waiting_model',files:[{id:'f',blobId:'blob',name:'账单.txt',type:'text/plain',size:10,createdAt:stamp}],createdAt:stamp,updatedAt:stamp}]});
let count=0;const options={uid:()=>`entry-${++count}`,now:stamp};
test('ledger proposals validate exact yuan amounts, real dates, source evidence and separate action types',()=>{
 assert.equal(validateOrganizedProposal({...plan(),ledgerEntries:[row('expense','1.2')]}).ledgerEntries[0].amount,'1.20');
 for(const amount of [1.2,0,NaN,'0','-1','1.001','1e3','1,000','10000000'])assert.throws(()=>validateOrganizedProposal({...plan(),ledgerEntries:[row('expense',amount)]}));
 for(const invalid of [{date:'2026-02-30'},{date:''},{type:'transfer'},{category:''},{sourceIds:[]},{sourceIds:undefined},{sourceIds:['']},{note:'a'.repeat(2001)}])assert.throws(()=>validateOrganizedProposal({...plan(),ledgerEntries:[{...row(),...invalid}]}));
 for(const invalid of [{ledgerEntries:[]},{ledgerEntries:undefined},{destinationId:'inbox'},{tasks:[{title:'待办'}]},{notes:[{title:'笔记',content:'内容'}]}])assert.throws(()=>validateOrganizedProposal({...plan(),...invalid}));
});
test('ledger preview matches committed fen and preserves independent project accounting and attachments',()=>{
 const s=state(),before=structuredClone(s),p=plan(),preview=previewOrganizedContent(s,'r',p);assert.deepEqual(s,before);
 assert.deepEqual(preview.map(a=>a.amountCents),[12850,39999,3000]);assert.ok(preview.every(a=>a.ledger&&a.includeInTotal===false&&a.destination==='记账 · 国庆出游'));
 const receipt=applyOrganizedContent(s,'r',p,options);assert.equal(receipt.items.length,3);assert.equal(s.captures.length,0);assert.equal(s.tasks.length,0);assert.deepEqual(s.aiRequests[0].files,before.aiRequests[0].files);
 assert.deepEqual(summarizeEntries(s.ledger.entries),{incomeCents:3000,expenseCents:52849,netCents:-49849,count:3});assert.equal(selectEntries(s.ledger,{scope:'total'}).length,0);
 assert.ok(s.ledger.entries.every(e=>e.projectId==='trip'&&e.sourceRequestId==='r'));
 receipt.items.forEach((item,i)=>assert.deepEqual(JSON.parse(item.snapshot),s.ledger.entries[i]));
 assert.equal(applyOrganizedContent(s,'r',p,options),receipt);assert.equal(s.ledger.entries.length,3);
 assert.deepEqual(validateLedger(s.ledger),s.ledger);
});
test('daily ledger keeps project records separate; invalid or archived destinations and sources write nothing',()=>{
 const s=state(),p={...plan(),destinationId:'ledger'};applyOrganizedContent(s,'r',p,options);assert.ok(s.ledger.entries.every(e=>e.projectId===''));assert.equal(selectEntries(s.ledger,{scope:'daily'}).length,3);assert.equal(selectEntries(s.ledger,{scope:'total'}).length,3);
 for(const scenario of ['missing','archived','wrong-target','missing-source','invalid-last','duplicate-id']){
  const value=state(),proposal=plan();let opts=options;
  if(scenario==='missing')proposal.destinationId='ledger:missing';if(scenario==='archived')value.ledger.projects[0].archived=true;
  if(scenario==='wrong-target')value.aiRequests[0].targetId='ledger';if(scenario==='missing-source')proposal.ledgerEntries[2].sourceIds=['unknown'];
  if(scenario==='invalid-last')proposal.ledgerEntries[2].amount='3.1415';if(scenario==='duplicate-id')opts={...options,uid:()=>'duplicate'};
  const before=structuredClone(value);assert.throws(()=>applyOrganizedContent(value,'r',proposal,opts),scenario);assert.deepEqual(value,before,scenario);
 }
});
test('backup round-trip preserves ledger proposals and exact undo receipts; edited rows are retained',async()=>{
 const s=state();applyOrganizedContent(s,'r',plan(),options);
 const restored=validateBackup({format:'lumi-backup',version:1,exportedAt:stamp,state:s,files:[]}).state;
 assert.deepEqual(restored.ledger,s.ledger);assert.deepEqual(restored.aiRequests[0].receipt,s.aiRequests[0].receipt);assert.deepEqual(restored.aiRequests[0].aiProposal,s.aiRequests[0].aiProposal);
 restored.ledger.entries[0].note='手动修改，保留';const ctx={state:restored,save(){}};
 const result=await undoRoute(ctx,restored.aiRequests[0].receipt,'r');assert.deepEqual(result,{removed:2,retained:1});assert.equal(restored.ledger.entries[0].note,'手动修改，保留');assert.equal(restored.aiRequests[0].files.length,1);
 const original=state();const receipt=applyOrganizedContent(original,'r',plan(),options),before=structuredClone(original);
 await assert.rejects(undoRoute({state:original,save(){throw Error('conflict');}},receipt,'r'),/conflict/);assert.deepEqual(original,before);
});
