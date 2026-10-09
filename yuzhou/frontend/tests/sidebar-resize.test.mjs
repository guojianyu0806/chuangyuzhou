import test from 'node:test';
import assert from 'node:assert/strict';
import {mountSidebarResize,sidebarMaxWidth,sidebarStoredWidth,RAIL_COLLAPSED,RAIL_LABELS_AT,RAIL_DEFAULT,RAIL_MAX} from '../src/sidebar-resize.js';

class Surface {
  constructor(){
    this.listeners=new Map();this.attributes={};this.captures=new Set();this.style={setProperty(name,value){this[name]=value;}};
    const classes=new Set();this.classList={toggle:(name,on)=>on?classes.add(name):classes.delete(name),add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)};
  }
  addEventListener(name,listener){if(!this.listeners.has(name))this.listeners.set(name,new Set());this.listeners.get(name).add(listener);}
  removeEventListener(name,listener){this.listeners.get(name)?.delete(listener);}
  setAttribute(name,value){this.attributes[name]=value;}
  querySelector(){return this.span;}
  focus(){this.focused=true;}
  setPointerCapture(id){this.captures.add(id);}
  hasPointerCapture(id){return this.captures.has(id);}
  releasePointerCapture(id){this.captures.delete(id);}
  fire(type,properties={}){
    const event={type,target:this,pointerId:1,button:0,clientX:100,prevented:false,preventDefault(){this.prevented=true;},...properties};
    for(const listener of this.listeners.get(type)||[])listener(event);
    return event;
  }
}
function fixture(t,{expanded=false,width=null,viewport=1200,readFailure=false}={}){
  const body=new Surface(),sidebar=new Surface(),handle=new Surface(),pinButton=new Surface(),win=new Surface();
  pinButton.span={textContent:''};win.innerWidth=viewport;
  const state={ui:{sidebarPinned:expanded},tasks:[{id:'existing',title:'kept'}]},writes=[],errors=[],faults={expanded:false,width:false};
  let stored=width,controller;
  controller=mountSidebarResize({body,sidebar,handle,pinButton,win,
    readExpanded:()=>state.ui.sidebarPinned,
    writeExpanded:value=>{writes.push(['expanded',value]);if(faults.expanded)throw new Error('synthetic workspace persistence failure');state.ui.sidebarPinned=value;controller?.sync();},
    readWidth:()=>{if(readFailure)throw new Error('synthetic local preference read failure');return stored;},
    writeWidth:value=>{writes.push(['width',value]);if(faults.width)throw new Error('synthetic local preference write failure');stored=value;},
    onError:error=>errors.push(error.message)});
  t.after(()=>controller.destroy());
  const paintWidth=()=>parseFloat(body.style['--rail-width']);
  const key=(key,extra={})=>win.fire('keydown',{target:handle,key,...extra});
  const drag=(delta,{end=true,id=1}={})=>{handle.fire('pointerdown',{pointerId:id});handle.fire('pointermove',{pointerId:id,clientX:100+delta});if(end)handle.fire('pointerup',{pointerId:id,clientX:100+delta});};
  return {body,sidebar,handle,pinButton,win,state,writes,errors,faults,controller,paintWidth,key,drag,stored:()=>stored};
}

test('stored widths fall back safely and the desktop maximum reserves 480 pixels for content',()=>{
  assert.deepEqual([RAIL_COLLAPSED,RAIL_LABELS_AT,RAIL_DEFAULT,RAIL_MAX],[80,180,254,380]);
  for(const value of [undefined,null,'',0,79,80,NaN,Infinity,'invalid'])assert.equal(sidebarStoredWidth(value),254);
  for(const value of [81,140,149.625,179])assert.equal(sidebarStoredWidth(String(value)),value);
  assert.equal(sidebarStoredWidth('320'),320);assert.equal(sidebarStoredWidth(1000),380);
  for(const viewport of [560,620,660,761,800,860,1200]){const maximum=sidebarMaxWidth(viewport);assert.ok(maximum>=80&&maximum<=380);assert.ok(viewport-maximum>=480);}
});

test('resizing an expanded sidebar previews continuously and persists only the local width on release',t=>{
  const f=fixture(t,{expanded:true,width:'254'}),before=structuredClone(f.state);
  f.handle.fire('pointerdown');f.handle.fire('pointermove',{clientX:146});
  assert.equal(f.paintWidth(),300);assert.deepEqual(f.writes,[]);assert.deepEqual(f.state,before);assert.equal(f.body.classList.contains('rail-resizing'),true);
  f.controller.sync();assert.equal(f.paintWidth(),300,'a render sync must not discard the active preview');
  f.handle.fire('pointerup',{clientX:146});assert.deepEqual(f.writes,[['width',300]]);assert.equal(f.stored(),300);assert.deepEqual(f.state,before);
  assert.equal(f.body.classList.contains('rail-resizing'),false);assert.equal(f.handle.hasPointerCapture(1),false);
});

test('opening by drag reveals labels at 180 pixels but commits the expanded state only after release',t=>{
  const f=fixture(t),before=structuredClone(f.state);f.handle.fire('pointerdown');
  f.handle.fire('pointermove',{clientX:199});assert.equal(f.paintWidth(),179);assert.equal(f.sidebar.classList.contains('rail-pinned'),false);
  f.handle.fire('pointermove',{clientX:200});assert.equal(f.paintWidth(),180);assert.equal(f.sidebar.classList.contains('rail-pinned'),true);assert.deepEqual(f.state,before);assert.deepEqual(f.writes,[]);
  f.handle.fire('pointermove',{clientX:240});f.handle.fire('pointerup',{clientX:240});
  assert.equal(f.paintWidth(),220);assert.deepEqual(f.writes,[['expanded',true],['width',220]]);assert.equal(f.state.ui.sidebarPinned,true);assert.deepEqual(f.state.tasks,before.tasks);
  assert.equal(f.pinButton.attributes['aria-pressed'],'true');assert.equal(f.handle.attributes['aria-valuenow'],'220');
  f.drag(10000);assert.equal(f.paintWidth(),380);assert.deepEqual(f.writes.slice(2),[['width',380]]);
});

test('dragging down to the 80-pixel boundary collapses while reopening retains the last custom width',t=>{
  const f=fixture(t,{expanded:true,width:'310'});f.drag(-230);
  assert.equal(f.paintWidth(),80);assert.deepEqual(f.writes,[['expanded',false]]);assert.equal(f.stored(),'310');assert.equal(f.pinButton.span.textContent,'展开侧边栏');
  f.key('Enter');assert.equal(f.paintWidth(),310);assert.deepEqual(f.writes.slice(1),[['expanded',true],['width',310]]);
});

test('every intermediate width, including subpixel values, persists and restores without snapping on remount',t=>{
  for(const width of [81,140,179,149.625,180.25]){
    const f=fixture(t,{expanded:true,width:254}),before=structuredClone(f.state);f.drag(width-254);
    assert.equal(f.paintWidth(),width);assert.equal(f.stored(),width);assert.deepEqual(f.writes,[['width',width]]);assert.deepEqual(f.state,before);
    assert.equal(f.sidebar.classList.contains('rail-pinned'),width>=180);assert.equal(f.pinButton.attributes['aria-pressed'],'true');
    f.controller.destroy();
    const restored=fixture(t,{expanded:f.state.ui.sidebarPinned,width:String(f.stored())});
    assert.equal(restored.paintWidth(),width);assert.equal(restored.sidebar.classList.contains('rail-pinned'),width>=180);assert.deepEqual(restored.writes,[]);
  }
});

test('a one-pixel drag can expand to 81 pixels and collapse can restore that narrow width',t=>{
  const f=fixture(t);f.handle.fire('pointerdown');f.handle.fire('pointermove',{clientX:101});
  assert.equal(f.paintWidth(),81);assert.deepEqual(f.writes,[]);assert.equal(f.state.ui.sidebarPinned,false);
  f.handle.fire('pointerup',{clientX:101});assert.equal(f.paintWidth(),81);assert.deepEqual(f.writes,[['expanded',true],['width',81]]);assert.equal(f.sidebar.classList.contains('rail-pinned'),false);
  f.key('Home');assert.equal(f.paintWidth(),80);assert.equal(f.stored(),81);assert.equal(f.state.ui.sidebarPinned,false);
  f.key('Enter');assert.equal(f.paintWidth(),81);assert.equal(f.state.ui.sidebarPinned,true);assert.equal(f.sidebar.classList.contains('rail-pinned'),false);
});

test('crossing the label threshold changes only label visibility and cancelling restores an exact fractional width',t=>{
  const f=fixture(t,{expanded:true,width:190}),before=structuredClone(f.state);
  for(const width of [179,180,179.75]){
    f.drag(width-f.paintWidth());assert.equal(f.paintWidth(),width);assert.equal(f.sidebar.classList.contains('rail-pinned'),width>=180);
  }
  assert.ok(f.writes.every(([type])=>type==='width'));assert.deepEqual(f.state,before);
  const committed=f.stored(),count=f.writes.length;f.drag(30,{end:false});assert.equal(f.sidebar.classList.contains('rail-pinned'),true);f.key('Escape');
  assert.equal(f.paintWidth(),179.75);assert.equal(f.sidebar.classList.contains('rail-pinned'),false);assert.equal(f.stored(),committed);assert.equal(f.writes.length,count);
});

test('a single quarter-pixel movement is committed exactly and restored by a new controller',t=>{
  const f=fixture(t,{expanded:true,width:140}),before=structuredClone(f.state);f.drag(0.25);
  assert.equal(f.paintWidth(),140.25);assert.equal(f.stored(),140.25);assert.deepEqual(f.writes,[['width',140.25]]);assert.deepEqual(f.state,before);
  f.controller.destroy();const restored=fixture(t,{expanded:true,width:String(f.stored())});assert.equal(restored.paintWidth(),140.25);assert.deepEqual(restored.writes,[]);
});

test('secondary pointers, non-left buttons and invalid pointer positions cannot replace or finish a drag',t=>{
  const f=fixture(t,{expanded:true,width:254});f.handle.fire('pointerdown',{button:2});assert.equal(f.handle.hasPointerCapture(1),false);
  f.handle.fire('pointerdown',{clientX:NaN});assert.equal(f.handle.hasPointerCapture(1),false);
  f.handle.fire('pointerdown',{pointerId:1});f.handle.fire('pointermove',{pointerId:1,clientX:146});
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])f.handle.fire(type,{pointerId:2,clientX:1000});
  assert.equal(f.paintWidth(),300);assert.equal(f.handle.hasPointerCapture(1),true);assert.deepEqual(f.writes,[]);
  f.handle.fire('pointermove',{pointerId:1,clientX:Infinity});assert.equal(f.paintWidth(),300);
  f.handle.fire('pointerup',{pointerId:1});assert.deepEqual(f.writes,[['width',300]]);
});

test('pointer cancel, lost capture, window blur and Escape roll back previews without persisting',t=>{
  for(const cancellation of ['pointercancel','lostpointercapture','blur','Escape']){
    const f=fixture(t,{expanded:true,width:310}),before=structuredClone(f.state);f.drag(-180,{end:false});assert.equal(f.paintWidth(),130);
    if(cancellation==='Escape')assert.equal(f.key('Escape').prevented,true);else if(cancellation==='blur')f.win.fire('blur');else f.handle.fire(cancellation);
    assert.equal(f.paintWidth(),310,cancellation);assert.equal(f.sidebar.classList.contains('rail-pinned'),true);assert.deepEqual(f.state,before);assert.deepEqual(f.writes,[]);
    assert.equal(f.handle.hasPointerCapture(1),false);assert.equal(f.body.classList.contains('rail-resizing'),false);
    f.handle.fire('pointerup');assert.deepEqual(f.writes,[],'late pointerup must not commit a cancelled drag');
  }
});

test('keyboard controls offer small and large steps, collapse, maximum and toggle without changing content',t=>{
  const f=fixture(t),tasks=structuredClone(f.state.tasks);
  for(const [key,extra,width] of [['ArrowRight',{},100],['ArrowRight',{},120],['ArrowRight',{shiftKey:true},160],['ArrowLeft',{shiftKey:true},120],['ArrowLeft',{},100],['ArrowLeft',{},80],['End',{},380],['Home',{},80],['Enter',{},380]]){
    assert.equal(f.key(key,extra).prevented,true);assert.equal(f.paintWidth(),width);
  }
  assert.deepEqual(f.state.tasks,tasks);assert.deepEqual(f.writes.filter(([type])=>type==='expanded'),[['expanded',true],['expanded',false],['expanded',true],['expanded',false],['expanded',true]]);
  const writes=f.writes.length;
  for(const modifiers of [{ctrlKey:true},{metaKey:true},{altKey:true},{target:f.body}])assert.equal(f.key('ArrowRight',modifiers).prevented,false);
  assert.equal(f.writes.length,writes);
});

test('mobile input does not resize; narrowing and widening the desktop retain the local preferred width',t=>{
  const mobile=fixture(t,{expanded:true,width:360,viewport:390}),mobileState=structuredClone(mobile.state);
  mobile.drag(100);mobile.key('Home');mobile.handle.fire('dblclick');assert.deepEqual(mobile.writes,[]);assert.deepEqual(mobile.state,mobileState);assert.equal(mobile.handle.hasPointerCapture(1),false);
  const desktop=fixture(t,{expanded:true,width:360,viewport:1200});desktop.win.innerWidth=800;desktop.win.fire('resize');assert.equal(desktop.paintWidth(),320);assert.equal(desktop.handle.attributes['aria-valuemax'],'320');
  desktop.win.innerWidth=1200;desktop.win.fire('resize');assert.equal(desktop.paintWidth(),360);assert.deepEqual(desktop.writes,[]);
  desktop.drag(-70,{end:false});desktop.win.innerWidth=390;desktop.win.fire('resize');assert.equal(desktop.handle.hasPointerCapture(1),false);assert.deepEqual(desktop.writes,[]);
});

test('a local preference write failure preserves the usable in-session width and reports that it was not remembered',t=>{
  const f=fixture(t,{expanded:true,width:254}),before=structuredClone(f.state);f.faults.width=true;f.drag(46);
  assert.equal(f.paintWidth(),300);assert.equal(f.stored(),254);assert.deepEqual(f.state,before);assert.equal(f.errors.length,1);assert.match(f.errors[0],/本机未能记住/);
  f.controller.sync();assert.equal(f.paintWidth(),300);f.drag(30,{end:false});f.key('Escape');assert.equal(f.paintWidth(),300);
});

test('an expanded-state persistence failure rolls the appearance back and never saves the preview width',t=>{
  for(const expanded of [false,true]){
    const f=fixture(t,{expanded,width:300}),before=structuredClone(f.state);f.faults.expanded=true;f.drag(expanded?-220:150);
    assert.equal(f.paintWidth(),expanded?300:80);assert.deepEqual(f.state,before);assert.deepEqual(f.writes,[['expanded',!expanded]]);assert.equal(f.stored(),300);
    assert.equal(f.errors.length,1);assert.match(f.errors[0],/persistence failure/);assert.equal(f.sidebar.classList.contains('rail-pinned'),expanded);
  }
});

test('an unreadable width preference falls back to default and double-click resets an active preview',t=>{
  const f=fixture(t,{expanded:true,width:360,readFailure:true});assert.equal(f.paintWidth(),254);assert.deepEqual(f.writes,[]);
  f.drag(90,{end:false});assert.equal(f.paintWidth(),344);f.handle.fire('dblclick');assert.equal(f.paintWidth(),254);assert.equal(f.handle.hasPointerCapture(1),false);assert.deepEqual(f.writes,[['width',254]]);
  f.handle.fire('pointerup');assert.deepEqual(f.writes,[['width',254]]);
});

test('a pointer that never moves does not persist, and destroy releases capture and all listeners',t=>{
  const f=fixture(t,{expanded:true,width:300}),before=structuredClone(f.state);f.handle.fire('pointerdown');f.handle.fire('pointermove',{clientX:100});f.handle.fire('pointerup');assert.deepEqual(f.writes,[]);
  f.drag(-80,{end:false});f.controller.destroy();assert.equal(f.paintWidth(),300);assert.equal(f.handle.hasPointerCapture(1),false);assert.equal(f.body.classList.contains('rail-resizing'),false);
  for(const listeners of [...f.handle.listeners.values(),...f.win.listeners.values()])assert.equal(listeners.size,0);
  f.drag(50);f.key('Home');f.win.innerWidth=800;f.win.fire('resize');f.controller.sync();assert.equal(f.paintWidth(),300);assert.deepEqual(f.writes,[]);assert.deepEqual(f.state,before);
});
