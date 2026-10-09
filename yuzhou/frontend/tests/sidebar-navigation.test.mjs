import test from 'node:test';
import assert from 'node:assert/strict';
import {createSidebarNavigation} from '../src/sidebar-navigation.js';

function click(href,{detail=1,...options}={}) {
  const link={target:'',isConnected:true,getAttribute:key=>key==='href'?href:null,hasAttribute:()=>false};
  const event={button:0,detail,defaultPrevented:false,target:{closest:selector=>selector==='.sidebar a[href^="#/"]'?link:null},preventDefault(){this.defaultPrevented=true;},...options};
  return {event,link};
}

test('ordinary sidebar navigation commits the captured destination without depending on anchor default activation',()=>{
  const item=click('#/space/project-one'),destinations=[];
  const handler=createSidebarNavigation({navigate:href=>{destinations.push(href);item.link.isConnected=false;},togglePinned:()=>assert.fail('single click must not toggle'),now:()=>1000});
  handler(item.event);
  assert.equal(item.event.defaultPrevented,true);
  assert.deepEqual(destinations,['#/space/project-one']);
  assert.equal(item.link.isConnected,false,'a render may replace the original clicked anchor');
});

test('double click still navigates before pin persistence can remove a recreated space link',()=>{
  const calls=[];let time=1000,current;
  const handler=createSidebarNavigation({navigate:href=>calls.push(['navigate',href]),togglePinned:()=>{current.link.isConnected=false;calls.push(['save-pin']);},now:()=>time});
  current=click('#/space/project-one');handler(current.event);
  time+=120;current=click('#/space/project-one',{detail:2});handler(current.event);
  assert.deepEqual(calls,[['navigate','#/space/project-one'],['navigate','#/space/project-one'],['save-pin']]);
  assert.equal(current.link.isConnected,false);assert.equal(current.event.defaultPrevented,true);
});

test('keyboard activation and mobile taps navigate without changing the sidebar pin preference',()=>{
  const calls=[];
  const mobile=createSidebarNavigation({navigate:href=>calls.push(href),togglePinned:()=>assert.fail('mobile must not pin'),isMobile:()=>true,now:()=>1000});
  mobile(click('#/space/touch',{detail:1}).event);mobile(click('#/space/touch',{detail:2}).event);
  const keyboard=createSidebarNavigation({navigate:href=>calls.push(href),togglePinned:()=>assert.fail('keyboard must not pin'),now:()=>1000});
  keyboard(click('#/builder',{detail:0}).event);keyboard(click('#/builder',{detail:0}).event);
  assert.deepEqual(calls,['#/space/touch','#/space/touch','#/builder','#/builder']);
});

test('modified clicks, downloads, new windows and already-handled events retain native navigation semantics',()=>{
  const handler=createSidebarNavigation({navigate:()=>assert.fail('must retain native behavior'),togglePinned:()=>assert.fail('must not pin')});
  for(const options of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{button:2},{defaultPrevented:true}]){
    const {event}=click('#/space/one',options);const original=event.defaultPrevented;handler(event);assert.equal(event.defaultPrevented,original);
  }
  const newWindow=click('#/space/one');newWindow.link.target='_blank';handler(newWindow.event);assert.equal(newWindow.event.defaultPrevented,false);
  const download=click('#/space/one');download.link.hasAttribute=key=>key==='download';handler(download.event);assert.equal(download.event.defaultPrevented,false);
  handler({target:{closest:()=>null}});
});

test('rapid clicks on different destinations do not toggle the pin',()=>{
  const calls=[];let time=1000;
  const handler=createSidebarNavigation({navigate:href=>calls.push(href),togglePinned:()=>assert.fail('different routes are not a double click'),now:()=>time});
  handler(click('#/tasks').event);time+=100;handler(click('#/space/two').event);
  assert.deepEqual(calls,['#/tasks','#/space/two']);
});
