import test from 'node:test';
import assert from 'node:assert/strict';
import {sidebarNavigationHTML,renderSidebarNavigation} from '../src/navigation-shell.js';

const entries=[
  {id:'home',kind:'core',title:'我的工作台',icon:'orbit',href:'#/home',placement:'primary'},
  {id:'tasks',kind:'module',title:'待办',icon:'check-circle',href:'#/tasks',placement:'more'},
  {id:'inbox',kind:'module',title:'灵感',icon:'inbox',href:'#/inbox',placement:'hidden'},
  {id:'space:one',kind:'space',title:'项目',icon:'layers',color:'#123456',href:'#/space/one',placement:'primary'},
];

test('sidebar partitions visible and folded links, retaining counts and space route identity',()=>{
  const html=sidebarNavigationHTML(entries,{route:'space',subroute:'one'});
  assert.ok(html.indexOf('data-sidebar-id="home"')<html.indexOf('data-sidebar-id="space:one"'));
  assert.ok(html.indexOf('data-sidebar-id="space:one"')<html.indexOf('<details'));
  assert.ok(html.indexOf('data-sidebar-id="tasks"')>html.indexOf('<details'));
  assert.doesNotMatch(html,/data-sidebar-id="inbox"/);
  assert.match(html,/data-count="tasks"/);
  assert.match(html,/href="#\/space\/one"[^>]*aria-current="page"/);
  assert.doesNotMatch(html,/data-nav="space/);
});

test('sidebar titles and attributes escape source text and reject untrusted color CSS',()=>{
  const html=sidebarNavigationHTML([{...entries[3],title:'"><img src=x>',color:'red;display:none'}],{route:'home'});
  assert.doesNotMatch(html,/<img|display:none/);
  assert.match(html,/&lt;img/);
  assert.match(html,/--space-color:#7950f2/);
});

test('empty folded group has no disclosure, explicitly opened group uses native details',()=>{
  assert.doesNotMatch(sidebarNavigationHTML([entries[0]],{route:'home'}),/<details/);
  assert.match(sidebarNavigationHTML(entries,{route:'tasks',moreOpen:true}),/<details class="rail-more" open>/);
});

function shellFixture(){
  const more={open:false,classList:{toggle(){}}};
  const links=entries.filter(x=>x.placement!=='hidden').map(item=>({dataset:{sidebarId:item.id},attributes:{},classList:{toggle(name,on){this[name]=on;}},getAttribute:key=>key==='href'?item.href:null,setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}}));
  let writes=0;
  const holder={dataset:{signature:JSON.stringify(entries),route:'#/home'},contains:()=>false,querySelector:()=>more,querySelectorAll:()=>links,set innerHTML(v){writes++;},get writes(){return writes;}};
  return {holder,more,links};
}

test('route into folded destination opens it once; ordinary saves respect a user collapse',()=>{
  const f=shellFixture();
  renderSidebarNavigation(f.holder,entries,{route:'tasks'});
  assert.equal(f.more.open,true);assert.equal(f.links[1].attributes['aria-current'],'page');
  f.more.open=false;
  renderSidebarNavigation(f.holder,entries,{route:'tasks'});
  assert.equal(f.more.open,false);assert.equal(f.holder.writes,0);
  renderSidebarNavigation(f.holder,entries,{route:'space',subroute:'one'});
  assert.equal(f.links[2].attributes['aria-current'],'page');
  assert.equal(f.links[1].attributes['aria-current'],undefined);
});
