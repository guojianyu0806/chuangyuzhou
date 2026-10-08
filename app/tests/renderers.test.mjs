import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRenderers} from '../frontend/renderers.js';

const collection={id:'c',fields:[{id:'title',type:'text'},{id:'n',type:'number'},{id:'date',type:'date'},{id:'status',type:'select',options:[{id:'z-todo',label:'待办'},{id:'a-done',label:'完成'}]}],semanticBindings:{title:'title'}};
const state={collections:[collection],records:[
 {id:'ten',collectionId:'c',values:{title:'十',n:10,date:'2026-10-10',status:'a-done'}},
 {id:'empty',collectionId:'c',values:{title:'空',n:null,date:null,status:null}},
 {id:'two',collectionId:'c',values:{title:'二',n:2,date:'2026-10-02',status:'z-todo'}},
 {id:'zero',collectionId:'c',values:{title:'零',n:0,date:'2026-10-01',status:'z-todo'}},
 {id:'archived',collectionId:'c',values:{n:1},archived:true}
],assets:[]};
const renderer=createRenderers({state:()=>state,esc:String,icon:()=>'',preview:()=>false,month:()=> '2026-10'});
const ids=props=>renderer.records({props,binding:{collectionId:'c'}},collection).map(r=>r.id);

test('number ordering uses numeric values and keeps null last in both directions',()=>{
 assert.deepEqual(ids({sort:{fieldId:'n',direction:'asc'}}),['zero','two','ten','empty']);
 assert.deepEqual(ids({sort:{fieldId:'n',direction:'desc'}}),['ten','two','zero','empty']);
});
test('numeric before/after never treats empty values as zero',()=>{
 assert.deepEqual(ids({filter:{fieldId:'n',operator:'before',value:3}}),['two','zero']);
 assert.deepEqual(ids({filter:{fieldId:'n',operator:'after',value:3}}),['ten']);
 assert.deepEqual(ids({filter:{fieldId:'n',operator:'before',value:0}}),[]);
 assert.deepEqual(ids({filter:{fieldId:'n',operator:'eq',value:0}}),['zero']);
});
test('select ordering follows declared options rather than opaque identifiers',()=>{
 assert.deepEqual(ids({sort:{fieldId:'status',direction:'asc'}}),['two','zero','ten','empty']);
 assert.deepEqual(ids({sort:{fieldId:'status',direction:'desc'}}),['ten','two','zero','empty']);
 assert.equal(renderer.valueText('z-todo',collection.fields[3]),'待办');
});
test('normalized dates compare chronologically while excluding missing dates',()=>{
 assert.deepEqual(ids({sort:{fieldId:'date',direction:'asc'}}),['zero','two','ten','empty']);
 assert.deepEqual(ids({filter:{fieldId:'date',operator:'after',value:'2026-10-02'}}),['ten']);
});

test('list displays all selected fields beyond five and excludes unselected fields',()=>{
 const fields=Array.from({length:7},(_,i)=>({id:'f'+i,name:'Field '+i,type:'text'}));
 const wideCollection={id:'wide',fields,semanticBindings:{title:'f0'}};
 const wideState={collections:[wideCollection],records:[{id:'wide-record',collectionId:'wide',values:Object.fromEntries(fields.map(f=>[f.id,'Value '+f.id]))}],assets:[]};
 const wideRenderer=createRenderers({state:()=>wideState,esc:String,icon:()=>'',preview:()=>false,month:()=> '2026-10'});
 const component={type:'list',binding:{collectionId:'wide'},props:{visibleFieldIds:fields.slice(0,6).map(f=>f.id)}};
 const selected=wideRenderer.body(component);
 assert.equal((selected.match(/<th>/g)||[]).length,6);
 assert.match(selected,/<th>Field 5<\/th>/);
 assert.match(selected,/>Value f5<\/button>/);
 assert.doesNotMatch(selected,/Field 6|Value f6/);
 assert.match(selected,/class="data-scroll"/);
 const all=wideRenderer.body({...component,props:{visibleFieldIds:[]}});
 assert.equal((all.match(/<th>/g)||[]).length,7);
 assert.match(all,/<th>Field 6<\/th>/);
 assert.match(all,/>Value f6<\/button>/);
});
