import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diffFields,reviewContexts,createReviewRenderer} from '../frontend/review.js';
import {getTodayRecords} from '../frontend/renderers.js';
const esc=value=>String(value??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const state={workspaces:[{id:'w',name:'测试空间',pages:[{id:'p',name:'主页'}]}],components:[],collections:[{id:'c',name:'事项',fields:[{id:'f',name:'截止日期',type:'date'}],semanticBindings:{}}],records:[],assets:[{id:'a',title:'原始资料',text:'请于2026-10-02交稿。',hash:'hash'}]};
test('field diff preserves settings, bindings, preferences, options and nested sources',()=>{
 const before={props:{filter:{fieldId:'f',operator:'eq',value:'old'},sort:{fieldId:'f',direction:'asc'},visibleFieldIds:['a']},binding:{dateFieldId:'f'},preferences:{priorityText:'旧',favoriteComponents:['text']},fields:[{id:'f',options:[{id:'o',label:'旧选项'}]}],sourceRefs:[{assetId:'a',quote:'旧原文'}]};
 const after=structuredClone(before);after.props.filter.value='new';after.props.sort.direction='desc';after.props.visibleFieldIds=['b'];after.binding.dateFieldId='g';after.preferences.priorityText='新';after.preferences.favoriteComponents=[];after.fields[0].options[0].label='新选项';after.sourceRefs[0].quote='新原文';
 const paths=diffFields(before,after).map(d=>d.path.join('.'));
 assert.deepEqual(paths,['props.filter.value','props.sort.direction','props.visibleFieldIds.0','binding.dateFieldId','preferences.priorityText','preferences.favoriteComponents.0','fields.0.options.0.label','sourceRefs.0.quote']);
 assert.equal(diffFields({a:null},{})[0].after,undefined);
});
test('review renders every changed field and includes untruncated JSON fallback safely',()=>{
 const renderer=createReviewRenderer({esc,icon:()=>'',state:()=>state});
 const change={entity:'components',id:'m',description:'筛选变化',before:{id:'m',props:{filter:{fieldId:'f',operator:'eq',value:'a'}}},after:{id:'m',props:{filter:{fieldId:'f',operator:'eq',value:'<script>bad()</script>'}}}};
 const html=renderer.changes({diff:[change]});
 assert.ok(html.includes('data-diff-path="props.filter.value"'));
 assert.ok(html.includes('显示设置 › 筛选 › 筛选值'));
 assert.ok(html.includes('完整原始数据'));assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));assert.ok(!html.includes('<script>'));
 assert.deepEqual(reviewContexts(state,[change]).before.components,[change.before]);
});
test('proposal and saved source evidence show original title, field, quote and semantic limitation',()=>{
 const renderer=createReviewRenderer({esc,icon:()=>'',state:()=>state});
 const html=renderer.evidence({evidence:[{kind:'asset',assetId:'a',fieldId:'f',quote:'2026-10-02',actionIndex:0,verification:'quote_exists_only'},{kind:'user_message',fieldId:'f',quote:'下周交稿',actionIndex:0}],diff:[{entity:'records',id:'r',before:null,after:{id:'r',collectionId:'c',values:{f:'2026-10-02'},sourceRefs:[{assetId:'a',fieldId:'f',quote:'请于2026-10-02交稿。'}]}}]});
 for(const text of ['原始资料','截止日期','2026-10-02','本次用户请求','下周交稿','请于2026-10-02交稿。','逐字存在','核对语义','查看保存的全文'])assert.ok(html.includes(text),text);
});
test('only collections with status and nonempty completion rules contribute to today',()=>{
 const day='2026-10-02',s={collections:[
  {id:'tasks',workspaceId:'w',semanticBindings:{status:'s',doneOptions:['done'],dueDate:'d'}},
  {id:'reference',workspaceId:'w',semanticBindings:{dueDate:'d'}},
  {id:'unmapped',workspaceId:'w',semanticBindings:{status:'s',doneOptions:[],start:'d'}},
  {id:'other',workspaceId:'another',semanticBindings:{status:'s',doneOptions:['done'],dueDate:'d'}}
 ],records:[
  {id:'todo',collectionId:'tasks',values:{s:'todo',d:day+'T12:00'}},
  {id:'done',collectionId:'tasks',values:{s:'done',d:day}},
  {id:'archived',collectionId:'tasks',values:{s:'todo',d:day},archived:true},
  {id:'fact',collectionId:'reference',values:{d:day}},
  {id:'no-rule',collectionId:'unmapped',values:{s:'todo',d:day}},
  {id:'foreign',collectionId:'other',values:{s:'todo',d:day}}
 ]};
 assert.deepEqual(getTodayRecords(s,'w',day).map(r=>r.id),['todo']);
});

test('equal quotes for different actions, records and before/after remain individually reviewable',()=>{
 const s=structuredClone(state);s.collections[0].fields.push({id:'title',name:'标题',type:'text'});s.collections[0].semanticBindings.title='title';
 const renderer=createReviewRenderer({esc,icon:()=>'',state:()=>s});
 const ref={assetId:'a',fieldId:'f',quote:'2026-10-02'},record=(id,title)=>({id,collectionId:'c',values:{title},sourceRefs:[ref]});
 const html=renderer.evidence({evidence:[{...ref,kind:'asset',actionIndex:0},{...ref,kind:'asset',actionIndex:1}],diff:[
  {entity:'records',id:'r1',before:record('r1','甲记录'),after:record('r1','甲记录')},
  {entity:'records',id:'r2',before:null,after:record('r2','乙记录')}
 ]});
 assert.equal((html.match(/class="evidence-item"/g)||[]).length,5);
 for(const label of ['第 1 个动作','第 2 个动作','修改前的引用 · 甲记录','修改后的引用 · 甲记录','修改后的引用 · 乙记录'])assert.ok(html.includes(label),label);
 const change={entity:'records',id:'r1',description:'修改 r1',before:record('r1','甲记录'),after:record('r1','新甲记录')};
 const differences=renderer.changes({diff:[change]});assert.ok(differences.includes('<span>修改 新甲记录</span>'));assert.ok(differences.includes('&quot;id&quot;: &quot;r1&quot;'));
});
