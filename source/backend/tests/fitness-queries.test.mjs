import test from 'node:test';
import assert from 'node:assert/strict';
import {validateWorkspaceQueries,runWorkspaceQuery,workspaceFingerprint} from '../workspace-queries.mjs';
import {buildPrompt} from '../hermes.mjs';
const stamp='2026-09-22T09:00:00.000Z';
const entry=(id,patch={})=>({id,spaceId:'fitness-a',date:'2026-09-21',activity:'步行',minutes:10,distanceKm:null,caloriesKcal:null,note:'',source:'manual',archived:false,color:'#AE88FF',createdAt:stamp,updatedAt:stamp,...patch});
const fixture=()=>({spaces:[{id:'fitness-a',title:'健身A'},{id:'fitness-b',title:'健身B'}],fitness:{version:1,entries:[entry('one',{minutes:20,distanceKm:3.2,caloriesKcal:120}),entry('two',{minutes:30}),entry('other',{spaceId:'fitness-b',minutes:100,caloriesKcal:999}),entry('archived',{archived:true,caloriesKcal:500}),entry('outside',{date:'2026-08-01',caloriesKcal:600})]}});
const query=partial=>validateWorkspaceQueries([{kind:'fitness.summary',spaceId:'fitness-a',start:'2026-09-01',end:'2026-09-30',...partial}])[0];

test('fitness summaries calculate all matching records in one space and disclose missing measurements',async()=>{
  const state=fixture(),before=JSON.stringify(state),result=await runWorkspaceQuery(state,query());
  assert.equal(result.totals.count,2);assert.equal(result.totals.minutes,50);assert.equal(result.totals.caloriesKcal,120);assert.equal(result.totals.distanceKm,3.2);
  assert.equal(result.totals.missingCaloriesCount,1);assert.equal(result.totals.missingDistanceCount,1);assert.equal(result.computedFromAllMatchingEntries,true);
  assert.equal(JSON.stringify(state),before);assert.match(result.notice,/缺失/);
  for(let i=0;i<120;i++)state.fitness.entries.push(entry(`many-${i}`,{minutes:1}));
  const all=await runWorkspaceQuery(state,query());assert.equal(all.totals.count,122);assert.equal(all.totals.minutes,170);assert.equal(all.totals.missingCaloriesCount,121);
});

test('empty calorie/distance stays null and recorded zero remains a known measurement',async()=>{
  const state=fixture();state.fitness.entries=[entry('unknown')];
  const unknown=await runWorkspaceQuery(state,query());assert.equal(unknown.totals.caloriesKcal,null);assert.equal(unknown.totals.distanceKm,null);assert.equal(unknown.totals.caloriesCount,0);
  state.fitness.entries.push(entry('zero',{caloriesKcal:0,distanceKm:0}));
  const mixed=await runWorkspaceQuery(state,query());assert.equal(mixed.totals.caloriesKcal,0);assert.equal(mixed.totals.caloriesCount,1);assert.equal(mixed.totals.missingCaloriesCount,1);
});

test('fitness query requires explicit scope and supports exact week/month boundaries',async()=>{
  for(const q of [{kind:'fitness.summary'},{kind:'fitness.summary',spaceId:'a',date:'2026-09-22'}, {kind:'fitness.summary',spaceId:'a',period:'week'}, {kind:'fitness.summary',spaceId:'a',period:'year',date:'2026-09-22'}, {kind:'fitness.summary',spaceId:'a',period:'week',date:'2026-09-22',start:'2026-09-01'}])assert.throws(()=>validateWorkspaceQueries([q]));
  const [q]=validateWorkspaceQueries([{kind:'fitness.summary',spaceId:'fitness-a',date:'2026-09-22',period:'week'}]);
  const result=await runWorkspaceQuery(fixture(),q);assert.equal(result.start,'2026-09-21');assert.equal(result.end,'2026-09-27');assert.equal(result.totals.count,2);
  await assert.rejects(()=>runWorkspaceQuery(fixture(),query({spaceId:'missing'})),/不存在/);
  const archived=await runWorkspaceQuery(fixture(),query({archived:true}));assert.equal(archived.totals.count,1);assert.equal(archived.totals.caloriesKcal,500);
});

test('fitness mutations invalidate reviewed workspace fingerprint and prompt describes real-data limits',()=>{
  const state=fixture(),first=workspaceFingerprint(state);state.fitness.entries[0].minutes=21;assert.notEqual(workspaceFingerprint(state),first);
  const prompt=buildPrompt({text:'记录运动',sources:[],destinations:[],destinationId:'auto',kind:'conversation'});
  assert.match(prompt.system,/未知距离或热量填null/);assert.match(prompt.system,/不能伪造为实际训练/);
  const payload=JSON.parse(prompt.user);assert.ok(payload.workspaceActionCapabilities.some(item=>item.entity==='fitnessEntry'));
  assert.ok(payload.workspaceQueryCapabilities.some(item=>item.kind==='fitness.summary'));
});
