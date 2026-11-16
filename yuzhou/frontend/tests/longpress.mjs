// Historical browser script: review only; use documented isolated tests.
throw new Error('SUBMISSION_LEGACY_BROWSER_DISABLED: configure an isolated browser test explicitly before reuse.');
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const base='http://127.0.0.1:4397',errors=[];
const stored=p=>p.evaluate(()=>JSON.parse(localStorage.getItem('czb-yuzhou-workspace-v1-demo')));
const position=async(p,id)=>(await stored(p)).canvas.cards.find(c=>c.id===id);
const center=async locator=>{const r=await locator.boundingBox();assert.ok(r);return {x:r.x+r.width/2,y:r.y+r.height/2};};
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  page.on('pageerror',e=>errors.push(e.message));
  const home=async()=>{await page.goto(base+'/#/home');await page.locator('.cv-card').first().waitFor();};
  await home();
  const title=page.locator('[data-card=courses] h2');
  const before=await position(page,'courses'),at=await center(title);
  await page.mouse.move(at.x,at.y);await page.mouse.down();await page.waitForTimeout(180);
  assert.equal(await page.locator('.is-longpress-lifted').count(),0);
  await page.waitForTimeout(320);assert.equal(await page.locator('[data-card=courses].is-longpress-lifted').count(),1);
  assert.equal(await page.locator('[data-card=courses]').evaluate(e=>getComputedStyle(e).animationName),'cv-pickup');
  await page.mouse.move(at.x+85,at.y+55,{steps:8});await page.mouse.up();
  const moved=await position(page,'courses');assert.notEqual(moved.x,before.x);assert.notEqual(moved.y,before.y);
  assert.equal(new URL(page.url()).hash,'#/home');assert.equal(await page.locator('.is-longpress-lifted').count(),0);
  await page.reload();await page.locator('.cv-card').first().waitFor();assert.equal((await position(page,'courses')).x,moved.x);
  console.log('PASS hold feedback, body drag, no accidental navigation, release/reload persistence');

  const hold=await center(title);await page.mouse.move(hold.x,hold.y);await page.mouse.down();await page.waitForTimeout(520);await page.mouse.up();await page.waitForTimeout(400);
  assert.equal(new URL(page.url()).hash,'#/home');assert.equal((await position(page,'courses')).x,moved.x);
  await title.click();await page.waitForURL('**/#/courses');
  console.log('PASS stationary long hold does not open; short click still opens');
  await home();
  const swipeBefore=await position(page,'courses'),viewBefore=(await stored(page)).canvas.view,swipe=await center(title);
  await page.mouse.move(swipe.x,swipe.y);await page.mouse.down();await page.waitForTimeout(80);await page.mouse.move(swipe.x+65,swipe.y+30,{steps:5});await page.waitForTimeout(520);
  assert.equal(await page.locator('.is-longpress-lifted').count(),0);await page.mouse.up();
  assert.deepEqual(await position(page,'courses'),swipeBefore);assert.notEqual((await stored(page)).canvas.view.x,viewBefore.x);
  console.log('PASS swipe before hold pans canvas and cancels pending pickup');

  await page.locator('[data-cv=home]').click();const cancel=await center(title),cancelBefore=await position(page,'courses');
  await page.mouse.move(cancel.x,cancel.y);await page.mouse.down();await page.waitForTimeout(520);await page.mouse.move(cancel.x-65,cancel.y+30,{steps:5});
  await page.locator('.cv-viewport').dispatchEvent('pointercancel',{pointerId:1,bubbles:true});await page.mouse.up();
  assert.deepEqual(await position(page,'courses'),cancelBefore);assert.equal(await page.locator('.is-longpress-lifted,.is-pressing').count(),0);
  const input=await center(page.locator('[data-card=ai] textarea'));await page.mouse.move(input.x,input.y);await page.mouse.down();await page.waitForTimeout(550);assert.equal(await page.locator('.is-longpress-lifted,.is-pressing').count(),0);await page.mouse.up();
  await page.locator('[data-card=ai] textarea').fill('长按不影响输入');
  assert.equal((await stored(page)).aiDraft.text,'长按不影响输入');
  console.log('PASS cancellation restores position; composer remains editable');

  const mobile=await browser.newPage({viewport:{width:414,height:1000},hasTouch:true,isMobile:true,reducedMotion:'reduce'});
  mobile.on('pageerror',e=>errors.push(e.message));await mobile.goto(base+'/#/home');await mobile.locator('[data-cv=canvas]').click();
  const client=await mobile.context().newCDPSession(mobile),touch=await center(mobile.locator('[data-card=ai] .cv-space-symbol')),touchBefore=await position(mobile,'ai');
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...touch,id:1}]});await mobile.waitForTimeout(530);
  assert.equal(await mobile.locator('[data-card=ai].is-longpress-lifted').count(),1);
  assert.equal(await mobile.locator('[data-card=ai]').evaluate(el=>getComputedStyle(el).animationName),'none');
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x+45,y:touch.y+40,id:1}]});await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.notEqual((await position(mobile,'ai')).x,touchBefore.x);assert.equal(new URL(mobile.url()).hash,'#/home');
  console.log('PASS real touch hold/drag, reduced-motion preference, no accidental open');
  await mobile.locator('.cv-viewport').focus();
  const viewport=await mobile.locator('.cv-viewport').boundingBox(),y=viewport.y+viewport.height-25;
  const transform=await mobile.locator('.cv-world').evaluate(el=>el.style.transform);
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:viewport.x+70,y,id:1},{x:viewport.x+200,y,id:2}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:viewport.x+40,y,id:1},{x:viewport.x+245,y,id:2}]});
  await mobile.keyboard.press('Escape');
  assert.equal(await mobile.locator('.cv-world').evaluate(el=>el.style.transform),transform);
  assert.equal(await mobile.locator('.is-panning,.is-positioning').count(),0);
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  console.log('PASS Escape cancels pinch and releases both touch pointers');
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
