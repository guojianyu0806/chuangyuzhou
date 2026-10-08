import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ensureCanvas,zoomAt,canvasBounds,canvasCardFill} from '../src/canvas.js';

const fixture={spaces:Array.from({length:9},(_,i)=>({id:`space-${i}`,color:'#63e6dc'}))};
ensureCanvas(fixture);
assert.equal(fixture.canvas.cards.length,16);
const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
for(let i=0;i<fixture.canvas.cards.length;i++)for(let j=i+1;j<fixture.canvas.cards.length;j++)assert.ok(!overlap(fixture.canvas.cards[i],fixture.canvas.cards[j]),`Initial overlap: ${fixture.canvas.cards[i].id} / ${fixture.canvas.cards[j].id}`);
fixture.canvas.cards[0].x=-95;ensureCanvas(fixture);assert.equal(fixture.canvas.cards[0].x,-95);
const upgraded={spaces:[],canvas:{cards:[{id:'courses',x:958,y:730,w:320,h:272,color:'#AE88FF'}]}};
ensureCanvas(upgraded);
const preserved=upgraded.canvas.cards.find(card=>card.id==='courses');
assert.equal(preserved.x,958);assert.equal(preserved.y,730);
assert.ok(!overlap(preserved,upgraded.canvas.cards.find(card=>card.id==='ledger')),'New ledger card must avoid the existing user layout');
const original={x:130,y:64,zoom:.8},point={x:320,y:450},zoomed=zoomAt(original,1.2,point);
assert.ok(Math.abs((point.x-original.x)/original.zoom-(point.x-zoomed.x)/zoomed.zoom)<1e-9);
assert.ok(Math.abs((point.y-original.y)/original.zoom-(point.y-zoomed.y)/zoomed.zoom)<1e-9);
assert.deepEqual(canvasBounds([{x:-200,y:-300,w:100,h:100},{x:100,y:200,w:200,h:150}]),{x:-200,y:-300,w:500,h:650});
const luminance=hex=>hex.slice(1).match(/../g).map(c=>parseInt(c,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
for(const source of ['#000000','#ffffff','#7900ff','#003300','#ff0080','#040020'])assert.ok((luminance(canvasCardFill(source))+.05)/(luminance('#4c3d5b')+.05)>=4.5,`Unreadable card theme ${source}`);

const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/g2806/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:4397';
const errors=[];
const readState=page=>page.evaluate(()=>JSON.parse(localStorage.getItem('czb-yuzhou-workspace-v1-demo')));
const cardFrom=async(page,id)=>(await readState(page)).canvas.cards.find(c=>c.id===id);
const pointerDrag=async(page,locator,dx,dy)=>{
  const rect=await locator.boundingBox();assert.ok(rect);
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.down();
  await page.mouse.move(rect.x+rect.width/2+dx,rect.y+rect.height/2+dy,{steps:8});await page.mouse.up();
};
const assertContentVisible=async page=>{
  const clipped=await page.evaluate(()=>[...document.querySelectorAll('.cv-card')].flatMap(el=>{
    const body=el.querySelector('.cv-card-body').getBoundingClientRect();
    return [...el.querySelectorAll('.cv-card-detail,.cv-english-actions button,.cv-space-counts')]
      .filter(n=>n.getClientRects().length&&n.getBoundingClientRect().bottom>body.bottom+1)
      .map(n=>({id:el.dataset.card,overflow:n.getBoundingClientRect().bottom-body.bottom}));
  }));
  assert.deepEqual(clipped,[]);
};

try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},hasTouch:true});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base,{waitUntil:'networkidle'});
  assert.ok(await page.locator('.cv-card').count()>=6);
  await assertContentVisible(page);

  const before=await cardFrom(page,'courses');
  await pointerDrag(page,page.locator('[data-card=courses] .cv-drag'),64,35);
  const moved=await cardFrom(page,'courses');assert.notEqual(moved.x,before.x);assert.notEqual(moved.y,before.y);
  assert.ok(!page.url().includes('#/courses'));
  await page.reload({waitUntil:'networkidle'});assert.equal((await cardFrom(page,'courses')).x,moved.x);
  await page.locator('[data-card=courses] .cv-drag').focus();await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);assert.equal((await cardFrom(page,'courses')).x,moved.x+8);

  const priorResize=await cardFrom(page,'courses');
  await pointerDrag(page,page.locator('[data-card=courses] .cv-resize'),35,35);
  const resized=await cardFrom(page,'courses');assert.ok(resized.w>priorResize.w);assert.ok(resized.h>priorResize.h);
  await page.waitForTimeout(400);
  const handle=await page.locator('[data-card=courses] .cv-drag').boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+80,handle.y+60,{steps:5});
  await page.locator('.cv-viewport').dispatchEvent('pointercancel',{pointerId:1,bubbles:true});await page.mouse.up();
  assert.equal((await cardFrom(page,'courses')).x,resized.x);assert.equal(await page.locator('.is-positioned').count(),0);
  await page.waitForTimeout(400);

  await page.locator('[data-card=courses] [data-cv=card-menu]').click();
  await page.locator('[name=width]').fill('355');await page.locator('[name=color]').fill('#000000');
  await page.locator('#modal button[type=submit]').click();
  assert.equal((await cardFrom(page,'courses')).w,355);assert.equal((await cardFrom(page,'courses')).color,'#000000');
  const painted=await page.locator('[data-card=courses]').evaluate(el=>getComputedStyle(el).backgroundColor);
  assert.equal(painted,'rgb(186, 186, 186)');

  const viewBefore=(await readState(page)).canvas.view;
  await page.locator('[data-cv=zoom-out]').click();await page.waitForTimeout(300);
  assert.ok((await readState(page)).canvas.view.zoom<viewBefore.zoom);
  await page.locator('[data-cv=fit]').click();
  const viewport=await page.locator('.cv-viewport').boundingBox();
  await page.mouse.move(viewport.x+viewport.width-10,viewport.y+viewport.height-30);await page.mouse.down();await page.mouse.move(viewport.x+viewport.width-75,viewport.y+viewport.height-55,{steps:5});await page.mouse.up();
  const panned=(await readState(page)).canvas.view;await page.reload({waitUntil:'networkidle'});
  assert.deepEqual((await readState(page)).canvas.view,panned);

  await page.evaluate(()=>document.querySelectorAll('.cv-card:not(.cv-card-ai)').forEach(el=>{el.style.height='220px';el.style.width='220px';el.classList.add('cv-compact','cv-short');}));
  await assertContentVisible(page);await page.reload({waitUntil:'networkidle'});
  await page.locator('[data-cv=list]').click();
  for(const width of [320,375,414,768]){
    await page.setViewportSize({width,height:960});
    const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,cards:[...document.querySelectorAll('.cv-card')].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right};})}));
    assert.ok(result.scroll<=width,JSON.stringify(result));assert.ok(result.cards.every(c=>c.left>=0&&c.right<=width),JSON.stringify(result));
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-card=english] [data-cv=vocabulary]').click();await page.waitForURL('**/#/english/vocabulary');
  await page.goto(`${base}/#/home`,{waitUntil:'networkidle'});
  const spaceId=(await readState(page)).spaces[0]?.id;
  assert.ok(spaceId,'Demo workspace must contain a custom space for archive coverage.');
  await page.evaluate(id=>{const k='czb-yuzhou-workspace-v1-demo',s=JSON.parse(localStorage.getItem(k));s.spaces.find(x=>x.id===id).archived=true;localStorage.setItem(k,JSON.stringify(s));},spaceId);
  await page.reload({waitUntil:'networkidle'});await page.locator('[data-cv=archives]').click();
  await page.locator(`[data-archive-space="${spaceId}"]`).click();await page.waitForURL(`**/#/space/${spaceId}`);

  const mobile=await browser.newPage({viewport:{width:414,height:1000},hasTouch:true,isMobile:true});
  mobile.on('pageerror',error=>errors.push(error.message));await mobile.goto(base,{waitUntil:'networkidle'});
  assert.equal(await mobile.locator('.cv-viewport.is-list').count(),1);await mobile.locator('[data-cv=canvas]').click();
  const touchBefore=(await readState(mobile)).canvas.view,r=await mobile.locator('.cv-viewport').boundingBox();
  const client=await mobile.context().newCDPSession(mobile),y=r.y+r.height-55;
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:r.x+80,y,id:1},{x:r.x+200,y,id:2}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:r.x+45,y:y-5,id:1},{x:r.x+245,y:y+5,id:2}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.ok((await readState(mobile)).canvas.view.zoom>touchBefore.zoom);
  await mobile.locator('[data-cv=home]').click();await mobile.locator('[data-card=ai] .cv-space-symbol').tap();await mobile.waitForURL('**/#/ai');
  assert.deepEqual(errors,[]);
  console.log('PASS canvas: migration, no initial overlaps, anchored zoom, theme contrast, drag/resize, keyboard, pointercancel, persistence, minimum cards, four mobile widths, archive access, pinch zoom, touch entry, CET6 shortcut.');
} finally {await browser.close();}
