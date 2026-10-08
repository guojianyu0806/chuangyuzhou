import test from 'node:test';
import assert from 'node:assert/strict';
import {applyWorkspaceActions,previewWorkspaceActions,undoWorkspaceActions,validateWorkspaceActions,listWorkspaceRecords,validateWorkspaceActionSnapshot} from '../src/workspace-actions.js';
import {validateCompetitions} from '../src/competitions-model.js';

const NOW='2026-10-08T08:00:00.000Z';
const fixture=()=>({spaces:[],courses:[],tasks:[],captures:[],competitions:{version:1,items:[],milestones:[],tasks:[]},aiRequests:[{id:'contest-chat',text:'创建软件设计大赛，2026-10-15截止提交，分配材料任务。',status:'waiting_model',files:[]}],ui:{lastCreatedColor:'#AE88FF'}});
const options=(start=0)=>{let serial=start;return {uid:()=>`contest-record-${++serial}`,now:NOW};};
const create=(entity,data,extra={})=>({entity,operation:'create',data,...extra});
const linked=()=>[
  create('competition',{title:'软件设计大赛',status:'preparing',requirements:'提交源代码与作品说明'},{ref:'contest'}),
  create('competitionMilestone',{title:'提交作品',date:'2026-10-15'},{containerId:'$contest',ref:'deadline'}),
  create('competitionTask',{title:'整理作品材料',notes:'打包源代码'},{containerId:'$contest',ref:'prepare'}),
];

test('reviewed competition actions create linked records and preserve the source conversation',async()=>{
  const state=fixture(),requests=state.aiRequests;const receipt=applyWorkspaceActions(state,'contest-chat',linked(),options());
  const data=state.competitions;assert.equal(state.aiRequests,requests);assert.equal(data.items.length,1);assert.equal(data.milestones[0].competitionId,data.items[0].id);assert.equal(data.tasks[0].competitionId,data.items[0].id);
  assert.equal(data.milestones[0].time,'');assert.equal(data.tasks[0].date,'');assert.equal(data.items[0].sourceRequestId,'contest-chat');assert.notEqual(data.items[0].color,'#AE88FF');
  assert.equal(data.milestones[0].sourceRequestId,'contest-chat');assert.equal(data.tasks[0].sourceRequestId,'contest-chat');
  assert.equal(state.tasks.length,0);assert.equal(state.calendar,undefined);assert.equal(new Set(receipt.items.map(item=>item.id)).size,3);
  for(const item of receipt.items)assert.doesNotThrow(()=>validateWorkspaceActionSnapshot(JSON.parse(item.snapshot)));
  const rows=listWorkspaceRecords(state).filter(row=>row.entity.startsWith('competition'));assert.equal(rows.length,3);assert.equal(rows.find(row=>row.entity==='competitionTask').containerId,data.items[0].id);
  const result=await undoWorkspaceActions({state,save:()=>{}},receipt,'contest-chat');assert.deepEqual(result,{removed:3,retained:0});assert.equal(state.competitions.items.length,0);
});

test('preview exposes every changed competition field and never mutates real state',()=>{
  const state=fixture(),before=JSON.stringify(state),preview=previewWorkspaceActions(state,linked(),{requestId:'contest-chat',now:NOW});
  assert.equal(JSON.stringify(state),before);assert.equal(preview.length,3);
  assert.ok(preview[0].fields.some(field=>field.label==='比赛状态'&&field.after==='准备中'));
  assert.ok(preview[1].fields.some(field=>field.label==='节点日期（北京时间）'&&field.after==='2026-10-15'));
  assert.ok(preview[1].fields.some(field=>field.label==='所属比赛'&&field.after==='软件设计大赛'));
  assert.equal(preview[1].destination,'软件设计大赛');assert.equal(preview[2].destination,'软件设计大赛');
});

test('unknown fields, forged IDs, invalid values and child relocation are rejected',()=>{
  for(const action of [
    create('competition',{title:'比赛',status:'new'}),create('competition',{title:'比赛',milestones:[]}),create('competition',{title:'比赛',url:'javascript:alert(1)'}),
    create('competition',{title:'比赛',url:'https://user:password@example.com'}),create('competition',{title:'比赛',color:'purple'}),create('competition',{title:'x'.repeat(121)}),
    create('competition',{title:'比赛'},{id:'forged'}),create('competitionMilestone',{title:'截止',date:'2026-02-30'},{containerId:'id'}),
    create('competitionMilestone',{title:'截止',date:'2026-10-15',time:'24:00'},{containerId:'id'}),create('competitionTask',{title:'材料',done:'true'},{containerId:'id'}),
    {entity:'competitionTask',operation:'update',id:'task',containerId:'id',data:{competitionId:'other'}},
    {entity:'competition',operation:'archive',id:'id',data:{title:'伪造'}},
  ])assert.throws(()=>validateWorkspaceActions([action]));
  const state=fixture(),before=JSON.stringify(state);
  assert.throws(()=>applyWorkspaceActions(state,'contest-chat',[...linked(),create('competitionTask',{title:'错误关联'},{containerId:'$prepare'})],options()),/类型无效/);
  assert.equal(JSON.stringify(state),before);
  assert.throws(()=>applyWorkspaceActions(state,'contest-chat',[create('competitionTask',{title:'无所属'})],options()),/必须指定/);
  assert.throws(()=>applyWorkspaceActions(state,'contest-chat',[create('competitionTask',{title:'不存在'},{containerId:'missing'})],options()),/不存在/);
});

test('updates require matching parent and restore-before-update without cascading archive',()=>{
  const state=fixture();applyWorkspaceActions(state,'contest-chat',linked(),options());
  const parent=state.competitions.items[0],task=state.competitions.tasks[0];
  applyWorkspaceActions(state,'contest-chat',[create('competition',{title:'另一个比赛'})],options(50));
  const other=state.competitions.items[0];
  assert.throws(()=>applyWorkspaceActions(state,'contest-chat',[{entity:'competitionTask',operation:'update',id:task.id,containerId:other.id,data:{done:true}}],options(60)),/不属于/);
  applyWorkspaceActions(state,'contest-chat',[{entity:'competition',operation:'archive',id:parent.id,data:{}}],options(70));
  assert.equal(state.competitions.tasks[0].archived,false);assert.equal(state.competitions.milestones.length,1);
  assert.throws(()=>applyWorkspaceActions(state,'contest-chat',[{entity:'competitionTask',operation:'update',id:task.id,containerId:parent.id,data:{done:true}}],options(80)),/先恢复/);
  applyWorkspaceActions(state,'contest-chat',[{entity:'competition',operation:'restore',id:parent.id,data:{}},{entity:'competitionTask',operation:'archive',id:task.id,containerId:parent.id,data:{}}],options(90));
  assert.throws(()=>applyWorkspaceActions(state,'contest-chat',[{entity:'competitionTask',operation:'update',id:task.id,containerId:parent.id,data:{done:true}}],options(100)),/先恢复/);
  applyWorkspaceActions(state,'contest-chat',[{entity:'competitionTask',operation:'restore',id:task.id,containerId:parent.id,data:{}},{entity:'competitionTask',operation:'update',id:task.id,containerId:parent.id,data:{done:true}}],options(110));
  assert.equal(state.competitions.tasks[0].done,true);
});

test('undo keeps a newly created parent if a later child or edited child remains',async()=>{
  for(const later of [false,true]){
    const state=fixture();const receipt=applyWorkspaceActions(state,'contest-chat',linked(),options());
    if(later)applyWorkspaceActions(state,'contest-chat',[create('competitionTask',{title:'手动后来新增'},{containerId:state.competitions.items[0].id})],options(50));
    else {state.competitions.tasks[0].notes='用户改过，必须保留';state.competitions.tasks[0].updatedAt='2026-10-08T09:00:00.000Z';}
    const result=await undoWorkspaceActions({state,save:()=>{}},receipt,'contest-chat');
    assert.equal(state.competitions.items.length,1);assert.equal(state.competitions.tasks.length,1);assert.equal(state.competitions.milestones.length,0);assert.equal(result.retained,later?1:2);
  }
});

test('create/update replay unwinds exactly even after record normalization, with save rollback',async()=>{
  const state=fixture(),actions=[...linked(),{entity:'competition',operation:'update',id:'$contest',data:{url:'https://example.com',notes:'新增备注'}},{entity:'competitionMilestone',operation:'update',id:'$deadline',containerId:'$contest',data:{time:'17:00'}}];
  const receipt=applyWorkspaceActions(state,'contest-chat',actions,options());assert.equal(state.competitions.items[0].url,'https://example.com/');
  state.competitions=validateCompetitions(JSON.parse(JSON.stringify(state.competitions)));const before=JSON.stringify(state);
  await assert.rejects(()=>undoWorkspaceActions({state,save:()=>{throw new Error('模拟同步失败');}},receipt,'contest-chat'),/模拟同步失败/);assert.equal(JSON.stringify(state),before);
  const result=await undoWorkspaceActions({state,save:()=>{}},receipt,'contest-chat');assert.equal(result.removed,5);assert.equal(result.retained,0);assert.equal(state.competitions.items.length,0);
});
