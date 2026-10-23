import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWelcomeMotion} from '../src/welcome-motion.js';

class Surface {
  constructor() {
    this.listeners = new Map(); this.attributes = {}; this.dataset = {}; this.style = {};
    this.textContent = ''; this.disabled = false; this.reads = 0;
    const classes = new Set();
    this.classList = {contains: name => classes.has(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name)};
  }
  addEventListener(name, fn) {if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn);}
  removeEventListener(name, fn) {this.listeners.get(name)?.delete(fn);}
  setAttribute(name, value) {this.attributes[name] = String(value);}
  getAttribute(name) {return this.attributes[name] ?? null;}
  removeAttribute(name) {delete this.attributes[name];}
  contains(element) {for (let candidate = element; candidate; candidate = candidate.parentNode) if (candidate === this) return true; return false;}
  getBoundingClientRect() {this.reads++; return {...this.rect};}
  fire(name, properties = {}) {
    const event = {type: name, target: this, pointerType: 'mouse', pointerId: 1, button: 0, clientX: 500, clientY: 300, buttons: 0, prevented: false,
      preventDefault() {this.prevented = true;}, ...properties};
    for (const fn of this.listeners.get(name) || []) fn(event);
    return event;
  }
  listenerCount() {return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0);}
}

function fixture(t, {positions = [[100, 100, .6], [200, 100, 1.4]], reducedMotion = false, observers = true} = {}) {
  const root = new Surface(), stage = new Surface(), button = new Surface(), label = new Surface();
  const win = new Surface(), doc = new Surface(), reduced = new Surface();
  stage.rect = {left: 0, top: 0, width: 1000, height: 600};
  button.querySelector = () => label; label.textContent = '暂停浮动';
  const cards = positions.map(([x, y, depth, isCenter], index) => {
    const node = new Surface(), motion = new Surface();
    motion.parentNode = node;
    node.rect = {left: x - 50, top: y - 40, width: 100, height: 80};
    node.dataset = {depth: String(depth), phase: String(index + 1)};
    if (isCenter) node.dataset.welcomeCenter = '';
    node.style.transform = 'translate(-50%, -50%)';
    node.querySelector = selector => selector === '.welcome-float-motion' ? motion : null;
    return {node, motion};
  });
  root.querySelector = selector => selector === '.welcome-stage' ? stage : selector === '[data-welcome-motion]' ? button : null;
  root.querySelectorAll = selector => selector === '.welcome-float' ? cards.map(card => card.node) : [];
  reduced.matches = reducedMotion; win.matchMedia = () => reduced;
  const frames = new Map(); let frameId = 0, time = 0;
  win.requestAnimationFrame = fn => {frames.set(++frameId, fn); return frameId;};
  win.cancelAnimationFrame = id => frames.delete(id);
  const resize = [], intersections = [];
  function observer(records) {
    return class {
      constructor(callback) {this.callback = callback; this.disconnected = false; this.observed = []; records.push(this);}
      observe(target) {this.observed.push(target);}
      disconnect() {this.disconnected = true;}
    };
  }
  if (observers) {win.ResizeObserver = observer(resize); win.IntersectionObserver = observer(intersections);}
  const cleanup = mountWelcomeMotion({root, win, doc}); t.after(cleanup);
  const step = (milliseconds = 1000 / 60) => {time += milliseconds; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(time));};
  const settle = () => {let count = 0; while (frames.size && count++ < 300) step(); assert.equal(frames.size, 0, 'pointer response should become idle');};
  const values = index => {
    const match = cards[index].motion.style.transform?.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) rotateX\(([-\d.]+)deg\) rotateY\(([-\d.]+)deg\)/);
    return match ? match.slice(1).map(Number) : [0, 0, 0, 0];
  };
  const setReduced = value => {reduced.matches = value; reduced.fire('change');};
  const setVisible = value => intersections[0].callback([{target: stage, isIntersecting: value}]);
  const setHidden = value => {doc.hidden = value; doc.fire('visibilitychange');};
  return {root, stage, button, label, win, doc, cards, reduced, frames, resize, intersections,
    cleanup, step, settle, values, setReduced, setVisible, setHidden};
}

test('idle float needs no JavaScript frame and pointer updates are coalesced without layout reads each frame', t => {
  const f = fixture(t);
  assert.equal(f.frames.size, 0); assert.equal(f.root.dataset.motionState, 'running');
  const reads = [f.stage.reads, ...f.cards.map(card => card.node.reads)];
  for (let index = 0; index < 20; index++) f.root.fire('pointermove', {clientX: 800 + index, clientY: 550});
  assert.equal(f.frames.size, 1);
  f.settle();
  assert.deepEqual([f.stage.reads, ...f.cards.map(card => card.node.reads)], reads);
  assert.ok(f.values(0)[0] > 0);
  assert.equal(f.frames.size, 0);
});

test('layers ease toward depth-dependent parallax while fixed outer positions stay intact', t => {
  const f = fixture(t);
  f.root.fire('pointermove', {clientX: 1000, clientY: 600}); f.step();
  assert.ok(f.values(0)[0] > 0 && f.values(0)[0] < 18, 'first frame must not jump straight to its destination');
  f.settle();
  assert.deepEqual(f.values(0), [18, 18, -1.29, 1.29]);
  assert.deepEqual(f.values(1), [35, 35, -3, 3]);
  for (const card of f.cards) assert.equal(card.node.style.transform, 'translate(-50%, -50%)');
});

test('nearby blocks move away from the pointer and exact-center input remains finite', t => {
  const f = fixture(t, {positions: [[550, 300, 1], [900, 300, 1], [500, 300, 1]]});
  f.root.fire('pointermove'); f.settle();
  assert.ok(f.values(0)[0] > 0 && f.values(0)[0] < 30);
  assert.deepEqual(f.values(1), [0, 0, 0, 0]);
  assert.ok(f.values(2).every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...f.values(2).slice(0, 2)) - 30) < .002);
});

test('pointer leave returns smoothly to rest and then releases the frame loop', t => {
  const f = fixture(t);
  f.root.fire('pointermove', {clientX: 1000, clientY: 600}); f.settle();
  f.root.fire('pointerleave'); assert.equal(f.values(0)[0], 18);
  f.step(); assert.ok(f.values(0)[0] > 0 && f.values(0)[0] < 18);
  f.settle(); assert.deepEqual(f.values(0), [0, 0, 0, 0]);
  f.step(2000); assert.equal(f.frames.size, 0);
});

test('touch, pressed pointers and invalid coordinates never seize scrolling or start pointer motion', t => {
  const f = fixture(t);
  for (const properties of [{pointerType: 'touch'}, {isPrimary: false}, {buttons: 1}, {clientX: NaN}, {clientY: Infinity}]) {
    const event = f.root.fire('pointermove', {clientX: 900, clientY: 550, ...properties});
    assert.equal(event.prevented, false); assert.equal(f.frames.size, 0);
  }
});

test('the pause control freezes both motion layers and resumes without losing the current position', t => {
  const f = fixture(t);
  f.root.fire('pointermove', {clientX: 1000, clientY: 600}); f.step();
  const position = f.values(0);
  f.button.fire('click');
  assert.equal(f.frames.size, 0); assert.equal(f.root.classList.contains('welcome-paused'), true);
  assert.equal(f.button.getAttribute('aria-pressed'), 'true'); assert.equal(f.label.textContent, '继续浮动');
  f.root.fire('pointermove', {clientX: 0, clientY: 0}); f.step(5000);
  assert.deepEqual(f.values(0), position);
  f.button.fire('click');
  assert.equal(f.label.textContent, '暂停浮动'); assert.equal(f.button.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(f.values(0), position, 'unpause should not jump');
  f.settle(); assert.deepEqual(f.values(0), [0, 0, 0, 0]);
});

test('reduced motion starts static and switching it on clears pointer motion immediately', t => {
  const f = fixture(t, {reducedMotion: true});
  assert.equal(f.root.dataset.motionState, 'reduced'); assert.equal(f.button.disabled, true);
  assert.equal(f.label.textContent, '已减少动态效果');
  f.root.fire('pointermove', {clientX: 1000, clientY: 600}); f.button.fire('click');
  assert.equal(f.frames.size, 0);
  f.setReduced(false); assert.equal(f.button.disabled, false);
  f.root.fire('pointermove', {clientX: 1000, clientY: 600}); f.step(); assert.ok(f.values(0)[0] > 0);
  f.setReduced(true); assert.equal(f.frames.size, 0); assert.deepEqual(f.values(0), [0, 0, 0, 0]);
  f.setReduced(false); assert.equal(f.root.dataset.motionState, 'running'); assert.equal(f.frames.size, 0);
});

test('hidden documents and offscreen stages suspend independently while a manual pause survives both', t => {
  const f = fixture(t);
  f.root.fire('pointermove', {clientX: 1000, clientY: 600}); f.step();
  const position = f.values(0);
  f.setHidden(true); f.setVisible(false); f.setHidden(false);
  assert.equal(f.frames.size, 0); assert.equal(f.root.dataset.motionState, 'paused');
  f.step(30000); assert.deepEqual(f.values(0), position);
  f.setVisible(true); assert.equal(f.root.dataset.motionState, 'running'); f.settle();
  f.button.fire('click'); f.setHidden(true); f.setVisible(false); f.setHidden(false); f.setVisible(true);
  assert.equal(f.root.dataset.motionState, 'paused'); assert.equal(f.frames.size, 0);
  assert.equal(f.label.textContent, '继续浮动');
});

test('resize and scroll refresh cached centers without measuring during the animation', t => {
  const f = fixture(t, {positions: [[550, 300, 1]]});
  f.root.fire('pointermove'); f.settle(); assert.ok(f.values(0)[0] > 10);
  f.cards[0].node.rect.left = 850;
  f.resize[0].callback(); f.settle(); assert.deepEqual(f.values(0), [0, 0, 0, 0]);
  const reads = f.stage.reads;
  f.stage.rect.left = -500; f.win.fire('scroll');
  assert.equal(f.stage.reads, reads + 1); f.settle();
  assert.ok(f.values(0)[0] > 20);
});

test('cleanup cancels frames, disconnects observers and makes queued callbacks harmless', t => {
  const f = fixture(t);
  f.root.fire('pointermove', {clientX: 1000, clientY: 600});
  const queuedFrame = [...f.frames.values()][0];
  f.cleanup(); f.cleanup();
  assert.equal(f.frames.size, 0);
  assert.ok(f.resize[0].disconnected && f.intersections[0].disconnected);
  for (const target of [f.root, f.button, f.win, f.doc, f.reduced]) assert.equal(target.listenerCount(), 0);
  assert.equal(f.root.dataset.motionState, undefined); assert.equal(f.root.classList.contains('welcome-paused'), false);
  assert.equal(f.button.getAttribute('aria-pressed'), null);
  for (const card of f.cards) assert.equal(card.motion.style.transform, '');
  queuedFrame(100); f.resize[0].callback(); f.setVisible(false); f.root.fire('pointermove');
  assert.equal(f.frames.size, 0); assert.equal(f.root.dataset.motionState, undefined);
});

test('window resize remains functional without optional observers', t => {
  const f = fixture(t, {observers: false});
  f.root.fire('pointermove', {clientX: 1000, clientY: 600}); f.settle();
  f.stage.rect.width = 2000; f.stage.rect.height = 1200; f.win.fire('resize'); f.settle();
  assert.deepEqual(f.values(0), [0, 0, 0, 0]);
});

test('hover freezes the chosen card at its current pose while other cards continue responding', t => {
  const f = fixture(t), card = f.cards[0];
  f.root.fire('pointermove', {clientX: 1000, clientY: 600}); f.step();
  const pose = f.values(0), other = f.values(1);
  card.node.fire('pointerover', {target: card.motion});
  assert.equal(card.node.classList.contains('welcome-card-held'), true);
  f.root.fire('pointermove', {clientX: 0, clientY: 0}); f.settle();
  assert.deepEqual(f.values(0), pose);
  assert.notDeepEqual(f.values(1), other);
  card.node.fire('pointerout', {relatedTarget: f.stage});
  assert.equal(card.node.classList.contains('welcome-card-held'), false);
  assert.deepEqual(f.values(0), pose, 'releasing hover must not jump');
  f.settle(); assert.ok(f.values(0)[0] < 0);
});

test('internal pointer and focus transitions keep a card held until both hover and focus leave', t => {
  const f = fixture(t), card = f.cards[0];
  const child = new Surface(); child.parentNode = card.node;
  card.node.fire('pointerover'); card.node.fire('focusin', {target: card.motion});
  card.node.fire('pointerout', {relatedTarget: child});
  card.node.fire('focusout', {relatedTarget: child});
  assert.equal(card.node.classList.contains('welcome-card-held'), true);
  card.node.fire('pointerout', {relatedTarget: f.stage});
  assert.equal(card.node.classList.contains('welcome-card-held'), true, 'keyboard focus still protects the card');
  f.root.fire('pointermove', {clientX: 1000, clientY: 600}); f.settle();
  assert.deepEqual(f.values(0), [0, 0, 0, 0]);
  card.node.fire('focusout', {relatedTarget: f.button});
  assert.equal(card.node.classList.contains('welcome-card-held'), false);
  f.settle(); assert.ok(f.values(0)[0] > 0);
});

test('a pressed card stays still through pointer exit and release does not intercept the native click', t => {
  const f = fixture(t), card = f.cards[0];
  f.root.fire('pointermove', {clientX: 1000, clientY: 600}); f.step();
  const pose = f.values(0);
  card.node.fire('pointerover');
  const down = card.node.fire('pointerdown');
  card.node.fire('pointerout', {relatedTarget: f.stage}); f.root.fire('pointerleave');
  f.settle(); assert.deepEqual(f.values(0), pose);
  assert.equal(card.node.classList.contains('welcome-card-held'), true);
  const up = f.win.fire('pointerup');
  assert.equal(down.prevented, false); assert.equal(up.prevented, false);
  assert.deepEqual(f.values(0), pose, 'pointerup must preserve the click target until the next frame');
  assert.equal(card.node.classList.contains('welcome-card-held'), false);
  f.settle(); assert.deepEqual(f.values(0), [0, 0, 0, 0]);
});

test('touch scroll cancellation and window blur release pressed holds without seizing input', t => {
  const f = fixture(t), card = f.cards[0];
  card.node.fire('pointerover', {pointerType: 'touch'});
  assert.equal(card.node.classList.contains('welcome-card-held'), false);
  const down = card.node.fire('pointerdown', {pointerType: 'touch', pointerId: 7});
  assert.equal(card.node.classList.contains('welcome-card-held'), true);
  const move = f.root.fire('pointermove', {pointerType: 'touch', pointerId: 7, clientX: 1000});
  f.win.fire('pointercancel', {pointerType: 'touch', pointerId: 7});
  assert.equal(down.prevented, false); assert.equal(move.prevented, false);
  assert.equal(card.node.classList.contains('welcome-card-held'), false);
  assert.equal(f.frames.size, 0);
  card.node.fire('pointerdown'); card.node.fire('pointerover'); f.win.fire('blur');
  assert.equal(card.node.classList.contains('welcome-card-held'), false);
});

test('held cards remain protected across pause and reduced-motion changes and clean up fully', t => {
  const f = fixture(t), card = f.cards[0];
  f.root.fire('pointermove', {clientX: 1000, clientY: 600}); f.step();
  card.node.fire('focusin'); const pose = f.values(0);
  f.button.fire('click'); f.button.fire('click'); f.settle();
  assert.deepEqual(f.values(0), pose); assert.equal(card.node.classList.contains('welcome-card-held'), true);
  f.setReduced(true); assert.deepEqual(f.values(0), [0, 0, 0, 0]);
  f.setReduced(false); f.root.fire('pointermove', {clientX: 1000, clientY: 600}); f.settle();
  assert.deepEqual(f.values(0), [0, 0, 0, 0]);
  f.cleanup();
  for (const item of f.cards) {
    assert.equal(item.node.classList.contains('welcome-card-held'), false);
    assert.equal(item.node.listenerCount(), 0);
  }
  card.node.fire('focusin'); assert.equal(card.node.classList.contains('welcome-card-held'), false);
});


test('interpolated geometry updates pointer origins without per-frame DOM reads', t => {
  const f = fixture(t, {positions:[[100,100,1]]});
  const reads = [f.stage.reads, f.cards[0].node.reads];
  f.cleanup.setLayoutPositions([{x:500,y:260,w:100,h:80}]);
  f.root.fire('pointermove', {clientX:500,clientY:300}); f.settle();
  assert.ok(f.values(0)[0] > 0, 'the pointer pushes from the supplied card center at x=550');
  assert.deepEqual([f.stage.reads, f.cards[0].node.reads], reads);
  f.cleanup.setLayoutPositions([{x:850,y:260,w:100,h:80}]); f.settle();
  assert.deepEqual(f.values(0), [0,0,0,0], 'the old hit position must not keep repelling');
  f.cleanup(); const transform = f.cards[0].motion.style.transform;
  f.cleanup.setLayoutPositions([{x:450,y:260,w:100,h:80}]);
  assert.equal(f.cards[0].motion.style.transform, transform);
});

test('central entrance moves softly without pointer repulsion and holds still for its CTA', t => {
  const f = fixture(t, {positions:[[550,300,.6,true],[550,300,.6,false]]});
  f.root.fire('pointermove', {clientX:500,clientY:300}); f.settle();
  assert.deepEqual(f.values(0), [0,0,0,0]);
  assert.ok(f.values(1)[0] > 0);
  f.root.fire('pointermove', {clientX:1000,clientY:600}); f.settle();
  assert.deepEqual(f.values(0), [4,4,-.3,.3]);
  f.cards[0].node.fire('pointerover');
  const before=f.values(0);
  f.root.fire('pointermove', {clientX:0,clientY:0}); f.settle();
  assert.deepEqual(f.values(0), before);
});
