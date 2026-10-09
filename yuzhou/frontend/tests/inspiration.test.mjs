import test from 'node:test';
import assert from 'node:assert/strict';
import {inspirationAppearance,selectInspirations,renderInspirationCards,mountInspirationWall} from '../src/inspiration.js';

const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const icon=()=>'';
const stamp='2026-10-09T08:00:00.000Z';
const idea=(id,values={})=>({id,text:`想法 ${id}`,category:'备忘',tags:'',archived:false,createdAt:stamp,...values});
const ids=items=>items.map(item=>item.id);
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

test('search matches body, tags, category and attachment names while category and archive filters remain isolated',()=>{
  const items=freeze([
    idea('body',{text:'Sketch a BLUE bird'}),
    idea('tag',{category:'学习灵感',tags:'BLUE, 想象'}),
    idea('file',{category:'链接',fileName:'Blue-notes.txt'}),
    idea('archived',{text:'BLUE bird draft',category:'学习灵感',archived:true}),
    idea('english',{category:'英语',text:'练习表达'}),
  ]);
  assert.deepEqual(ids(selectInspirations(items,'all','  bLuE  ')),['body','tag','file']);
  assert.deepEqual(ids(selectInspirations(items,'学习灵感','BLUE')),['tag']);
  assert.deepEqual(ids(selectInspirations(items,'链接','notes.txt')),['file']);
  assert.deepEqual(ids(selectInspirations(items,'all','英语')),['english']);
  assert.deepEqual(ids(selectInspirations(items,'archived','blue')),['archived']);
  assert.deepEqual(ids(selectInspirations(items,'archived','不存在')),[]);
  assert.deepEqual(ids(selectInspirations(items,'all','   ')),['body','tag','file','english']);
  assert.deepEqual(ids(selectInspirations(items,'未注册分类')),[]);
});

test('display ordering is newest first, stable for equal dates, and never mutates captures',()=>{
  const items=freeze([
    idea('older',{createdAt:'2026-10-01T00:00:00Z'}),
    idea('same-a'),idea('same-b'),idea('invalid-a',{createdAt:'invalid'}),idea('invalid-b',{createdAt:''}),
  ]);
  const before=structuredClone(items),selected=selectInspirations(items);
  assert.deepEqual(ids(selected),['same-a','same-b','older','invalid-a','invalid-b']);
  assert.deepEqual(items,before);assert.notEqual(selected,items);
  assert.equal(selected[0],items[1],'selection retains the real capture rather than creating a disconnected copy');
  assert.deepEqual(ids(selectInspirations(items)),ids(selected));
});

test('appearance keeps an identity stable, honours saved board colour, and accepts only bounded colour values',()=>{
  const original=idea('stable-id',{color:'#123456',category:'学习灵感'});
  const board=inspirationAppearance(original,'#fedcba');
  assert.deepEqual(board,inspirationAppearance({...original,color:'#FFFFFF'},'#fedcba'));
  assert.deepEqual(board,inspirationAppearance({...original,color:'#fedcba'}));
  assert.equal(board.turn,inspirationAppearance({...original,text:'新正文',tags:'新标签',category:'英语'}).turn);
  assert.deepEqual(inspirationAppearance(original,'red;--spark-turn:999deg'),inspirationAppearance(original));
  const invalid=idea('stable-id',{color:'#fff; background:url(javascript:alert(1))',category:'未知分类'});
  const fallback=inspirationAppearance({...invalid,color:undefined,category:'备忘'});
  assert.deepEqual(inspirationAppearance(invalid),inspirationAppearance({...invalid,color:undefined}));
  assert.equal(inspirationAppearance(invalid).tint,fallback.tint);assert.equal(inspirationAppearance(invalid).edge,fallback.edge);
  for(const id of ['a','b','c','☀','中文',...Array.from({length:50},(_,n)=>String(n))]){
    const visual=inspirationAppearance(idea(id));
    assert.match(visual.tint,/^#[\da-f]{6}$/i);assert.match(visual.edge,/^#[\da-f]{6}$/i);
    assert.ok(Number.isFinite(visual.turn)&&Math.abs(visual.turn)<=1.35);
  }
  assert.equal(inspirationAppearance(idea('short',{text:'一句话'})).size,'brief');
  assert.equal(inspirationAppearance(idea('long',{text:'长段内容'.repeat(100)})).size,'long');
  assert.equal(inspirationAppearance(idea('quote',{category:'消息摘录'})).shape,'bubble');
  assert.equal(inspirationAppearance(idea('attached',{category:'学习灵感',fileName:'附件.txt'})).shape,'paper');
});

test('card content and every user-controlled attribute escape markup while invalid colour cannot inject CSS',()=>{
  const attack='"><script>alert("x")</script>&\' <img src=x onerror=alert(1)>';
  const capture=idea(attack,{text:attack,tags:attack,fileName:attack,category:attack,createdAt:attack,color:'red;position:fixed;inset:0'});
  const html=renderInspirationCards([capture],{esc,icon,boardColors:new Map([[attack,'#fff;display:none']])});
  assert.ok(!html.includes('<script'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('position:fixed'));assert.ok(!html.includes('display:none'));
  assert.ok(html.includes(`<p>${esc(attack)}</p>`));assert.ok(html.includes(`<span>${esc(attack)}</span>`));
  assert.ok(html.includes(`<p class="inspiration-tags"># ${esc(attack)}</p>`));
  assert.ok(html.includes(`aria-label="编辑灵感：${esc(attack.slice(0,70))}"`));
  assert.equal((html.match(new RegExp(`data-id="${esc(attack).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"`,'g'))||[]).length,4);
  assert.ok(!html.includes('datetime='),'invalid dates are not emitted as time attributes');
});

test('cards expose real edit, linked-task, attachment and archive/restore actions by capture ID',()=>{
  const active=renderInspirationCards([idea('linked',{fileName:'草稿.txt'})],{esc,icon,taskCaptureIds:new Set(['linked'])});
  for(const action of ['edit-capture','capture-task','download-capture','archive-capture'])assert.ok(active.includes(`data-action="${action}" data-id="linked"`));
  assert.ok(active.includes('查看待办'));assert.ok(active.includes('归档灵感：'));assert.ok(!active.includes('变成行动'));
  const archived=renderInspirationCards([idea('archived',{archived:true})],{esc,icon});
  assert.ok(archived.includes('已归档'));assert.ok(archived.includes('恢复灵感：'));assert.ok(archived.includes('变成行动'));
  assert.ok(!archived.includes('download-capture'));assert.equal(renderInspirationCards([],{esc,icon}),'');
});

function mounted(state,options={}){
  let focused=0,saves=0;
  const elements={input:{value:options.query||'',focus:()=>focused++},grid:{innerHTML:'',hidden:false},empty:{innerHTML:'',hidden:true},count:{textContent:''}};
  const selectors={'[data-inspiration-view]':elements.input,'.inspiration-scatter':elements.grid,'.inspiration-empty':elements.empty,'[data-inspiration-count]':elements.count};
  const listeners=new Map();
  const root={innerHTML:'',querySelector:selector=>selectors[selector],addEventListener(type,listener){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(listener);},removeEventListener(type,listener){listeners.get(type)?.delete(listener);}};
  const emit=(type,event)=>{for(const listener of [...(listeners.get(type)||[])])listener(event);};
  const queries=[],cleanup=mountInspirationWall({root,state,esc,icon,save:()=>{saves++;throw new Error('view must never save');}},{...options,onQuery:value=>queries.push(value)});
  return {root,elements,listeners,queries,cleanup,emit,input(value){elements.input.value=value;emit('input',{target:elements.input});},get focused(){return focused;},get saves(){return saves;}};
}

test('mounted live search and clear change only the view, keep original layout, and remove handlers on cleanup',()=>{
  const state=freeze({captures:[idea('one',{text:'接住想法',tags:'蓝色'}),idea('two',{text:'保留余地',fileName:'Notes.txt'}),idea('old',{text:'接住旧想法',archived:true})],tasks:[],boards:{inbox:{cards:[{id:'one',x:136,y:92,w:360,h:280,color:'#123456'}],view:{x:28,y:-16,zoom:.8}}},ui:{inboxView:'cards'},updatedAt:stamp});
  const before=structuredClone(state),ui=mounted(state);
  assert.equal(ui.elements.count.textContent,'2 个想法');assert.ok(!ui.elements.grid.innerHTML.includes('旧想法'));
  ui.input('蓝色');assert.equal(ui.elements.count.textContent,'1 个匹配的想法');assert.ok(ui.elements.grid.innerHTML.includes('接住想法'));assert.ok(!ui.elements.grid.innerHTML.includes('保留余地'));
  ui.input('unknown');assert.equal(ui.elements.grid.hidden,true);assert.equal(ui.elements.empty.hidden,false);assert.ok(ui.elements.empty.innerHTML.includes('清空搜索'));
  ui.emit('click',{target:{closest:()=>null}});assert.equal(ui.elements.count.textContent,'0 个匹配的想法');
  ui.emit('click',{target:{closest:selector=>selector==='[data-inspiration-clear]'?{}:null}});
  assert.equal(ui.elements.count.textContent,'2 个想法');assert.equal(ui.elements.input.value,'');assert.equal(ui.focused,1);assert.equal(ui.elements.empty.hidden,true);
  ui.emit('input',{target:{value:'not the search field'}});assert.deepEqual(ui.queries,['蓝色','unknown','']);
  assert.deepEqual(state,before);assert.equal(ui.saves,0);
  ui.cleanup();assert.equal(ui.listeners.get('input').size,0);assert.equal(ui.listeners.get('click').size,0);
  const html=ui.elements.grid.innerHTML;ui.input('保留');assert.equal(ui.elements.grid.innerHTML,html);assert.deepEqual(ui.queries,['蓝色','unknown','']);assert.deepEqual(state,before);
});

test('mount derives linked-task actions only from non-archived tasks and keeps archive search scoped',()=>{
  const state=freeze({captures:[idea('active-task'),idea('archived-task'),idea('archived-capture',{text:'存档想法',archived:true})],tasks:[{id:'t1',captureId:'active-task',done:true},{id:'t2',captureId:'archived-task',archived:true}]});
  const ui=mounted(state);
  assert.equal((ui.elements.grid.innerHTML.match(/查看待办/g)||[]).length,1);assert.equal((ui.elements.grid.innerHTML.match(/变成行动/g)||[]).length,1);
  ui.cleanup();const archived=mounted(state,{filter:'archived',query:'存档'});
  assert.equal(archived.elements.count.textContent,'1 个已归档的想法');assert.ok(archived.elements.grid.innerHTML.includes('恢复灵感：'));assert.ok(!archived.elements.grid.innerHTML.includes('data-id="active-task"'));
  archived.input('想法 active-task');assert.equal(archived.elements.grid.hidden,true);assert.equal(archived.saves,0);archived.cleanup();
});
