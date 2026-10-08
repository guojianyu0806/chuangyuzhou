import test from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkspaceActions,previewWorkspaceActions,undoWorkspaceActions,validateWorkspaceActions,listWorkspaceRecords,validateWorkspaceActionSnapshot} from '../src/workspace-actions.js';
import {validateBackup} from '../src/backup.js';
import {seedEnglish} from '../src/english.js';

const NOW='2026-09-22T09:00:00.000Z';
const original='2026年9月21日我实际跑步30分钟，手表显示距离5.2公里、消耗260千卡。';
const fixture=()=>({schema:1,mode:'personal',profile:{name:'测试',major:'软件工程',provider:'deepseek'},spaces:[{id:'fitness-space',title:'运动健身',type:'blank',description:'',icon:'folder',color:'#AE88FF',archived:false,example:false,createdAt:NOW,updatedAt:NOW,notes:[],files:[]}],courses:[],tasks:[],captures:[],english:seedEnglish(false),fitness:{version:1,entries:[]},aiRequests:[{id:'fitness-chat',text:original,status:'waiting_model',files:[],createdAt:NOW,updatedAt:NOW}],ui:{sidebarPinned:false,lastCreatedColor:'#AE88FF'},updatedAt:NOW});
const options=()=>{let serial=0;return {now:NOW,uid:()=>`fitness-${++serial}`};};
const activity=(data={})=>({entity:'fitnessEntry',operation:'create',data:{spaceId:'fitness-space',date:'2026-09-21',activity:'跑步',minutes:30,evidence:'我实际跑步30分钟',...data}});

test('confirmed actions create grounded fitness rows with unknown measurements kept null',()=>{
  const state=fixture(),source=state.aiRequests;
  const receipt=applyWorkspaceActions(state,'fitness-chat',[activity()],options());
  assert.equal(state.aiRequests,source);assert.equal(state.fitness.entries.length,1);
  const entry=state.fitness.entries[0];assert.equal(entry.distanceKm,null);assert.equal(entry.caloriesKcal,null);assert.equal(entry.minutes,30);
  assert.equal(entry.source,'manual');assert.equal(entry.sourceRequestId,'fitness-chat');assert.equal(entry.spaceId,'fitness-space');
  assert.notEqual(entry.color,'#AE88FF');assert.equal(Object.hasOwn(entry,'evidence'),false);
  assert.doesNotThrow(()=>validateWorkspaceActionSnapshot(JSON.parse(receipt.items[0].snapshot)));
  assert.ok(listWorkspaceRecords(state).some(row=>row.entity==='fitnessEntry'&&row.containerId==='space:fitness-space'));
});

test('new fitness template can be referenced by later entry and undo removes both safely',async()=>{
  const state=fixture();
  const receipt=applyWorkspaceActions(state,'fitness-chat',[{entity:'space',operation:'create',ref:'gym',data:{title:'我的训练',type:'fitness'}},activity({spaceId:'$gym',distanceKm:5.2,caloriesKcal:260,source:'device'})],options());
  assert.equal(state.spaces[0].fitnessEnabled,true);assert.equal(state.fitness.entries[0].spaceId,state.spaces[0].id);
  assert.equal(state.fitness.entries[0].distanceKm,5.2);assert.equal(state.fitness.entries[0].caloriesKcal,260);
  const result=await undoWorkspaceActions({state,save:()=>{}},receipt,'fitness-chat');assert.equal(result.removed,2);assert.equal(result.retained,0);
  assert.equal(state.fitness.entries.length,0);assert.equal(state.spaces.length,1);
});

test('actual-data evidence, non-future date, quantities and existing enabled space are enforced atomically',()=>{
  for(const data of [{evidence:'助手建议跑步30分钟'},{evidence:'跑步'},{date:'2026-09-23'}, {minutes:0},{minutes:1441},{minutes:30.001},{caloriesKcal:-1},{caloriesKcal:20001},{distanceKm:1001},{distanceKm:1.0001},{spaceId:'missing'},{source:'automatic'},{estimate:true}]){
    const state=fixture(),before=JSON.stringify(state);assert.throws(()=>applyWorkspaceActions(state,'fitness-chat',[activity(data)],options()),JSON.stringify(data));assert.equal(JSON.stringify(state),before);
  }
  const planned=fixture();planned.aiRequests[0].text='我计划明天跑步30分钟';
  assert.throws(()=>applyWorkspaceActions(planned,'fitness-chat',[activity({evidence:'跑步30分钟'})],options()),/计划/);
  const disabled=fixture();disabled.spaces[0].fitnessEnabled=false;
  assert.throws(()=>applyWorkspaceActions(disabled,'fitness-chat',[activity()],options()),/尚未开启/);
  applyWorkspaceActions(disabled,'fitness-chat',[{entity:'space',operation:'update',id:'fitness-space',data:{fitnessEnabled:true}},activity()],options());
  assert.equal(disabled.fitness.entries.length,1);
  assert.throws(()=>validateWorkspaceActions([{entity:'ledgerProject',operation:'create',ref:'p',data:{title:'钱'}},activity({spaceId:'$missing'})]));
});

test('updates require evidence only for changed actual facts and allow scoped moves, archive and restore',async()=>{
  const state=fixture();let serial=100;
  applyWorkspaceActions(state,'fitness-chat',[activity()],options());const id=state.fitness.entries[0].id;
  const opts={uid:()=>`updated-${++serial}`,now:'2026-09-22T10:00:00.000Z'};
  assert.throws(()=>applyWorkspaceActions(state,'fitness-chat',[{entity:'fitnessEntry',operation:'update',id,data:{minutes:35}}],opts),/文字无效/);
  state.aiRequests[0].text+=' 更正：我实际跑步35分钟。';
  const receipt=applyWorkspaceActions(state,'fitness-chat',[
    {entity:'space',operation:'create',ref:'other',data:{title:'另外训练',fitnessEnabled:true}},
    {entity:'fitnessEntry',operation:'update',id,containerId:'space:fitness-space',data:{spaceId:'$other',minutes:35,evidence:'我实际跑步35分钟'}},
    {entity:'fitnessEntry',operation:'archive',id,data:{}},
    {entity:'fitnessEntry',operation:'restore',id,data:{}},
  ],opts);
  assert.equal(state.fitness.entries[0].minutes,35);assert.equal(state.fitness.entries[0].archived,false);assert.notEqual(state.fitness.entries[0].spaceId,'fitness-space');
  const result=await undoWorkspaceActions({state,save:()=>{}},receipt,'fitness-chat');assert.equal(result.removed,4);assert.equal(state.fitness.entries[0].minutes,30);assert.equal(state.fitness.entries[0].spaceId,'fitness-space');
});

test('backup preserves fitness action undo and edited fitness records protect their parent space',async()=>{
  const state=fixture();
  const receipt=applyWorkspaceActions(state,'fitness-chat',[{entity:'space',operation:'create',ref:'gym',data:{title:'训练',type:'fitness'}},activity({spaceId:'$gym'})],options());
  Object.assign(state.aiRequests[0],{status:'filed',receipt});
  const restored=validateBackup(JSON.parse(JSON.stringify({format:'lumi-backup',version:1,exportedAt:NOW,state,files:[]}))).state;
  const clean=structuredClone(restored);const result=await undoWorkspaceActions({state:clean,save:()=>{}},clean.aiRequests[0].receipt,'fitness-chat');
  assert.equal(result.removed,2);assert.equal(clean.fitness.entries.length,0);
  restored.fitness.entries[0].note='用户增加的训练感受';
  const retained=await undoWorkspaceActions({state:restored,save:()=>{}},restored.aiRequests[0].receipt,'fitness-chat');
  assert.equal(retained.retained,2);assert.equal(restored.spaces.length,2);assert.equal(restored.fitness.entries[0].note,'用户增加的训练感受');
});

test('fitness preview is read-only and distinguishes missing measurement from measured zero',()=>{
  const state=fixture();state.aiRequests[0].text+=' 设备另显示距离0公里。';const before=JSON.stringify(state);
  const preview=previewWorkspaceActions(state,[activity({distanceKm:0,caloriesKcal:null})],{requestId:'fitness-chat',now:NOW});
  assert.equal(JSON.stringify(state),before);assert.match(preview[0].title,/跑步/);
  assert.ok(preview[0].fields.some(field=>field.label==='消耗热量（千卡）'&&field.after.includes('未提供')));
  assert.ok(preview[0].fields.some(field=>field.label==='距离（公里）'&&field.after==='0'));
});

test('distance and calorie writes must match supplied values, including common unit conversions',()=>{
  const state=fixture();state.aiRequests[0].text='2026年9月21日我实际跑步30分钟。';
  assert.throws(()=>applyWorkspaceActions(state,'fitness-chat',[activity({distanceKm:5})],options()),/未提供可核对的距离/);
  assert.throws(()=>applyWorkspaceActions(state,'fitness-chat',[activity({caloriesKcal:300})],options()),/未提供可核对的消耗热量/);
  for(const [input,distanceKm,caloriesKcal]of [
    ['手表显示5公里，消耗300千卡',5,300],['距离5200米，消耗了300',5.2,300],['5.2 km，260 kcal',5.2,260],['5200 m，260大卡',5.2,260],
  ]){
    const sample=fixture();sample.aiRequests[0].text=`2026年9月21日我实际跑步30分钟，${input}。`;
    applyWorkspaceActions(sample,'fitness-chat',[activity({distanceKm,caloriesKcal,source:'device'})],options());
    assert.equal(sample.fitness.entries[0].distanceKm,distanceKm);assert.equal(sample.fitness.entries[0].caloriesKcal,caloriesKcal);
  }
  const metres=fixture();metres.aiRequests[0].text='2026年9月21日我实际跑步30分钟，距离500米。';
  assert.throws(()=>applyWorkspaceActions(metres,'fitness-chat',[activity({distanceKm:500})],options()),/未提供可核对的距离/);
  const joules=fixture();joules.aiRequests[0].text='2026年9月21日我实际跑步30分钟，消耗300千焦。';
  assert.throws(()=>applyWorkspaceActions(joules,'fitness-chat',[activity({caloriesKcal:300})],options()),/未提供可核对的消耗热量/);
});

test('unchanged measurements need no new proof, clear-to-null is allowed, and changed known values need a matching correction',()=>{
  const state=fixture();applyWorkspaceActions(state,'fitness-chat',[activity({distanceKm:5.2,caloriesKcal:260})],options());
  const id=state.fitness.entries[0].id;let serial=200;const opts={uid:()=>`measurement-${++serial}`,now:NOW};
  state.aiRequests[0].text='仅更新运动备注：状态很好。';
  applyWorkspaceActions(state,'fitness-chat',[{entity:'fitnessEntry',operation:'update',id,data:{note:'状态很好',distanceKm:5.2,caloriesKcal:260}}],opts);
  assert.equal(state.fitness.entries[0].caloriesKcal,260);
  state.aiRequests[0].text='更正我实际跑步30分钟，设备显示距离5500米、消耗280千卡。';
  assert.throws(()=>applyWorkspaceActions(state,'fitness-chat',[{entity:'fitnessEntry',operation:'update',id,data:{caloriesKcal:300,evidence:'我实际跑步30分钟'}}],opts),/未提供可核对的消耗热量/);
  applyWorkspaceActions(state,'fitness-chat',[{entity:'fitnessEntry',operation:'update',id,data:{distanceKm:5.5,caloriesKcal:280,evidence:'我实际跑步30分钟'}}],opts);
  assert.equal(state.fitness.entries[0].distanceKm,5.5);assert.equal(state.fitness.entries[0].caloriesKcal,280);
  applyWorkspaceActions(state,'fitness-chat',[{entity:'fitnessEntry',operation:'update',id,data:{distanceKm:null,caloriesKcal:null}}],opts);
  assert.equal(state.fitness.entries[0].distanceKm,null);assert.equal(state.fitness.entries[0].caloriesKcal,null);
});
