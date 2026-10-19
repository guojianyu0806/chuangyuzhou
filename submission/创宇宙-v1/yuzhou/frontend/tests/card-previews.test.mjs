import test from 'node:test';
import assert from 'node:assert/strict';
import {blockCardPreview,spaceCardPreview,mountCardPreviewFit} from '../src/card-previews.js';

test('previews escape user text and bound long note/table output',()=>{
  const note=blockCardPreview({kind:'note',config:{text:'<script>alert(1)</script>'+('字'.repeat(5000))}});
  assert.ok(note.includes('&lt;script&gt;'));assert.ok(!note.includes('<script>'));assert.ok(note.length<1600);assert.ok(note.includes('…'));
  const table=blockCardPreview({kind:'table',config:{columns:Array.from({length:5},(_,i)=>({label:'列'+i})),rows:Array.from({length:20},(_,i)=>({cells:['记录'+i,'<img src=x onerror=alert(1)>','C','隐藏列']}))}});
  assert.equal((table.match(/<td>/g)||[]).length,12);assert.ok(!table.includes('记录4'));assert.ok(!table.includes('隐藏列'));assert.ok(table.includes('&lt;img'));assert.ok(table.includes('部分内容'));
});
test('preview generation does not mutate config, data or run miniapp code',()=>{
  const block={kind:'miniapp',description:'计算<工具>',config:{code:'throw Error("must never run")'},data:{secret:'not a preview field'}};
  const before=structuredClone(block),html=blockCardPreview(block);
  assert.deepEqual(block,before);assert.ok(html.includes('计算&lt;工具&gt;'));assert.ok(!html.includes('secret'));assert.ok(!html.includes('throw Error'));
});
test('checklists and links remain read-only, with bounded items and no live URL',()=>{
  const items=Array.from({length:7},(_,i)=>({label:'事项'+i,done:i===0,url:'javascript:alert(1)'}));
  const checklist=blockCardPreview({kind:'checklist',config:{items}}),links=blockCardPreview({kind:'links',config:{items}});
  assert.ok(checklist.includes('is-done'));assert.equal((checklist.match(/<li/g)||[]).length,5);assert.ok(checklist.includes('另有 2 项'));assert.ok(!checklist.includes('<input'));assert.ok(!links.includes('javascript:'));assert.ok(!links.includes('href='));
});
test('metrics handle overflow, date boundaries and invalid dates',()=>{
  assert.ok(blockCardPreview({kind:'progress',config:{value:200,target:100}}).includes('value="100"'));
  const today=new Date(2026,9,17,22);
  assert.ok(blockCardPreview({kind:'countdown',config:{date:'2026-10-18'}},{today}).includes('>1<small>天'));
  assert.ok(blockCardPreview({kind:'countdown',config:{date:'2026-10-16'}},{today}).includes('已过去'));
  assert.ok(blockCardPreview({kind:'countdown',config:{date:''}},{today}).includes('设置日期'));
});
test('space previews exclude archived records and unrelated tasks; empty remains empty',()=>{
  const space={id:'s1',notes:[{title:'归档不可见',archived:true},{title:'当前笔记',content:'正文'}]},before=structuredClone(space);
  assert.ok(!spaceCardPreview(space).includes('归档不可见'));assert.ok(spaceCardPreview(space).includes('当前笔记'));assert.deepEqual(space,before);
  const pending=spaceCardPreview({id:'s1'},[{title:'有关',spaceId:'s1'},{title:'无关',spaceId:'s2'},{title:'已完成',spaceId:'s1',done:true}]);
  assert.ok(pending.includes('有关'));assert.ok(!pending.includes('无关'));assert.ok(!pending.includes('已完成'));assert.equal(spaceCardPreview({id:'s1'}),'');
});

test('preview fitting keeps whole lines and rows across zoom, resize and disposal',t=>{
  const originalObserver=globalThis.ResizeObserver,originalStyle=globalThis.getComputedStyle;
  t.after(()=>{globalThis.ResizeObserver=originalObserver;globalThis.getComputedStyle=originalStyle;});
  let notify,disconnected=false,scale=.5,height=100,lines;
  const paragraph={getBoundingClientRect:()=>({top:20*scale}),style:{setProperty:(_key,value)=>lines=Number(value)}};
  const rows=[60,90,120].map(bottom=>({hidden:false,getBoundingClientRect:()=>({bottom:bottom*scale})}));
  const preview={isConnected:true,get offsetHeight(){return height;},getBoundingClientRect:()=>({height:height*scale,bottom:height*scale}),querySelector:()=>paragraph,querySelectorAll:()=>rows};
  globalThis.getComputedStyle=element=>element===preview?{paddingBottom:'10px'}:{lineHeight:'20px'};
  globalThis.ResizeObserver=class{constructor(callback){notify=callback;}observe(){}disconnect(){disconnected=true;}};
  const dispose=mountCardPreviewFit({querySelectorAll:()=>[preview]});
  assert.equal(lines,3);assert.deepEqual(rows.map(r=>r.hidden),[false,false,true]);
  scale=2;notify([{target:preview}]);assert.equal(lines,3);
  height=160;notify([{target:preview}]);assert.equal(lines,6);assert.ok(rows.every(r=>!r.hidden));
  dispose();height=60;notify([{target:preview}]);assert.equal(lines,6);assert.equal(disconnected,true);
});
