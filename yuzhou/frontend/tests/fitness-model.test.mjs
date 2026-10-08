import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFitnessEntry,validateFitness,mergeFitness,isFitnessSpace,fitnessRange,shiftFitnessDate,selectFitnessEntries,summarizeFitness,fitnessSeries} from '../src/fitness-model.js';
const stamp='2026-09-22T00:00:00.000Z';
const entry=(patch={})=>({id:'run-1',spaceId:'sport',date:'2026-09-22',activity:'跑步',minutes:30,distanceKm:null,caloriesKcal:null,note:'',source:'manual',archived:false,color:'#7950f2',createdAt:stamp,updatedAt:stamp,...patch});

test('fitness validates real dates, precise non-negative recorded quantities, and distinct unknown versus zero',()=>{
 const unknown=validateFitnessEntry(entry()),zero=validateFitnessEntry(entry({caloriesKcal:0,distanceKm:0}));assert.equal(unknown.caloriesKcal,null);assert.equal(zero.caloriesKcal,0);
 for(const patch of [{minutes:0},{minutes:1441},{minutes:'30'},{minutes:NaN},{minutes:1.001},{distanceKm:-1},{distanceKm:1001},{distanceKm:.0001},{caloriesKcal:-1},{caloriesKcal:20001},{caloriesKcal:Infinity},{caloriesKcal:1.001},{date:'2026-02-29'},{source:'automatic-sync'},{activity:''},{color:'red'},{id:'__proto__'},{updatedAt:'yesterday'},{extra:'unsupported'}])assert.throws(()=>validateFitnessEntry(entry(patch)),JSON.stringify(patch));
 assert.equal(validateFitnessEntry(entry({date:'2028-02-29',distanceKm:5.123,minutes:.1,caloriesKcal:100.25})).distanceKm,5.123);
 assert.throws(()=>validateFitness({version:1,entries:[entry(),entry()]}));
});
test('week boundaries are Monday to Sunday and month/day navigation handles leap years and year boundaries',()=>{
 assert.deepEqual(fitnessRange('2026-10-01','week').days,['2026-09-28','2026-09-29','2026-09-30','2026-10-01','2026-10-02','2026-10-03','2026-10-04']);
 assert.equal(fitnessRange('2026-09-27','week').start,'2026-09-21');assert.equal(fitnessRange('2026-12-31','week').end,'2027-01-03');
 assert.equal(fitnessRange('2028-02-10','month').days.length,29);assert.equal(fitnessRange('2026-02-10','month').days.length,28);
 assert.equal(shiftFitnessDate('2026-01-31','month',1),'2026-02-28');assert.equal(shiftFitnessDate('2028-01-31','month',1),'2028-02-29');assert.equal(shiftFitnessDate('2026-01-01','day',-1),'2025-12-31');assert.equal(shiftFitnessDate('2026-12-31','week',1),'2027-01-07');
 assert.equal(fitnessRange('2026-09-22','day').start,fitnessRange('2026-09-22','day').end);assert.throws(()=>fitnessRange('2026-02-30','month'));assert.throws(()=>shiftFitnessDate('2026-01-31','month',0));
});
test('selection isolates each fitness space and excludes archives while totals show partial recording coverage',()=>{
 const fitness={version:1,entries:[entry({id:'a',minutes:20.1,distanceKm:1.1,caloriesKcal:100.1}),entry({id:'b',minutes:10.2,caloriesKcal:100.2}),entry({id:'c',spaceId:'other',minutes:100,caloriesKcal:500}),entry({id:'d',archived:true,minutes:200}),entry({id:'e',date:'2026-09-21',caloriesKcal:0,distanceKm:0})]};
 const before=JSON.stringify(fitness),rows=selectFitnessEntries(fitness,{spaceId:'sport',start:'2026-09-22',end:'2026-09-22'}),totals=summarizeFitness(rows);
 assert.equal(totals.count,2);assert.equal(totals.minutes,30.3);assert.equal(totals.caloriesKcal,200.3);assert.equal(totals.distanceKm,1.1);assert.equal(totals.distanceCount,1);assert.equal(totals.missingDistanceCount,1);
 assert.equal(selectFitnessEntries(fitness,{spaceId:'sport',archived:true}).length,1);assert.equal(selectFitnessEntries(fitness,{spaceId:'sport',archived:'all'}).length,4);
 const week=summarizeFitness(selectFitnessEntries(fitness,{spaceId:'sport'}));assert.equal(week.activeDays,2);assert.equal(week.caloriesCount,3);assert.equal(JSON.stringify(fitness),before);
 assert.throws(()=>selectFitnessEntries(fitness,{}));assert.throws(()=>selectFitnessEntries(fitness,{spaceId:'sport',start:'2026-10-01',end:'2026-09-01'}));
});
test('time series never estimates missing calories; day details and weekly/monthly points stay consistent with totals',()=>{
 const rows=[entry({id:'a',caloriesKcal:null}),entry({id:'b',caloriesKcal:200}),entry({id:'c',date:'2026-09-23',caloriesKcal:0}),entry({id:'d',archived:true,caloriesKcal:10000})];
 const daily=fitnessSeries(rows,{date:'2026-09-22',period:'day',metric:'caloriesKcal'});assert.equal(daily.length,2);assert.equal(daily[0].value,null);assert.equal(daily[1].value,200);
 const week=fitnessSeries(rows,{date:'2026-09-22',period:'week',metric:'caloriesKcal'});assert.equal(week.length,7);assert.equal(week[0].value,null);assert.equal(week[1].value,200);assert.equal(week[1].count,2);assert.equal(week[1].missingCount,1);assert.equal(week[2].value,0);
 const month=fitnessSeries(rows,{date:'2026-09-22',period:'month',metric:'minutes'});assert.equal(month.length,30);assert.equal(month.reduce((n,p)=>n+p.value,0),90);
 const empty=summarizeFitness([]);assert.equal(empty.minutes,0);assert.equal(empty.caloriesKcal,null);assert.equal(empty.distanceKm,null);
 assert.throws(()=>fitnessSeries(rows,{date:'2026-09-22',metric:'steps'}));
});
test('existing named fitness spaces work without rewriting metadata; disabling and renaming preserve saved data',()=>{
 const space={id:'sport',title:'运动健身',type:'blank'},state={fitness:{version:1,entries:[entry()]}};assert.equal(isFitnessSpace(space),true);
 assert.equal(isFitnessSpace({...space,title:'我的训练'},state),true);assert.equal(isFitnessSpace({...space,fitnessEnabled:false},state),false);
 assert.equal(isFitnessSpace({id:'other',title:'读书',type:'fitness'}),true);assert.equal(isFitnessSpace({id:'other',title:'读书',type:'blank'}),false);assert.equal(Object.hasOwn(space,'fitnessEnabled'),false);
});
test('additive fitness imports are idempotent and never overwrite an edited current record',()=>{
 const current={version:1,entries:[entry({minutes:40})]},imported={version:1,entries:[entry(),entry({id:'run-2'})]};
 const merged=mergeFitness(current,imported);assert.equal(merged.entries.length,2);assert.equal(merged.entries[0].minutes,40);assert.deepEqual(mergeFitness(merged,imported),merged);assert.equal(current.entries.length,1);assert.equal(mergeFitness(undefined,imported).entries.length,2);
});
