import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWelcomeLayoutControls} from '../src/welcome-layout-controls.js';

class Element {
  constructor(tag = 'div') {this.tag = tag; this.attributes = {}; this.listeners = new Map();}
  addEventListener(type, fn) {if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn);}
  removeEventListener(type, fn) {this.listeners.get(type)?.delete(fn);}
  closest(selector) {
    for (let node = this; node; node = node.parentNode) {
      if (selector === '.welcome-float:not(.welcome-center-float)' && node.float && !node.centerFloat) return node;
      if (selector.includes('input') && (['button', 'a', 'input', 'select', 'textarea', 'summary', 'label'].includes(node.tag) ||
        node.editable || ['button', 'link', 'slider'].includes(node.attributes.role))) return node;
    }
    return null;
  }
  fire(type, extra = {}) {
    const event = {type, target: this, button: 0, prevented: false, defaultPrevented: false,
      preventDefault() {this.prevented = true; this.defaultPrevented = true;}, ...extra};
    for (const listener of this.listeners.get(type) || []) listener(event);
    return event;
  }
  countListeners() {return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0);}
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} !== ${expected}`);
function fixture(t, {reducedMotion = false, withoutFrames = false, withoutStage = false} = {}) {
  const root = new Element(), stage = new Element(), centerFloat = new Element(), center = new Element();
  const doc = new Element(), win = new Element(), reduced = new Element();
  const frames = new Map(), changes = []; let now = 0, frameId = 0;
  stage.parentNode = root; centerFloat.parentNode = stage; center.parentNode = centerFloat;
  centerFloat.float = true; centerFloat.centerFloat = true;
  root.querySelector = selector => selector === '.welcome-stage' && !withoutStage ? stage : null;
  win.performance = {now: () => now};
  reduced.matches = reducedMotion; win.matchMedia = () => reduced;
  if (!withoutFrames) win.requestAnimationFrame = callback => {frames.set(++frameId, callback); return frameId;};
  win.cancelAnimationFrame = id => frames.delete(id);
  const controller = mountWelcomeLayoutControls({root, win, doc, onProgress: value => changes.push(value)});
  t.after(() => controller.dispose());
  const step = milliseconds => {now += milliseconds; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now));};
  const setHidden = value => {doc.hidden = value; doc.fire('visibilitychange');};
  const setReduced = value => {reduced.matches = value; reduced.fire('change');};
  const immediate = value => controller.setProgress(value, {animate: false});
  return {root, stage, centerFloat, center, doc, win, reduced, controller, frames, changes, step, setHidden, setReduced, immediate};
}

test('a fresh controller emits scatter once and external immediate progress is finite and clamped', t => {
  const f = fixture(t);
  assert.deepEqual(f.changes, [0]); close(f.controller.getProgress(), 0); close(f.controller.getTarget(), 0);
  f.immediate(.37); close(f.controller.getProgress(), .37); close(f.controller.getTarget(), .37);
  f.immediate(2); close(f.controller.getProgress(), 1);
  f.immediate(-1); close(f.controller.getProgress(), 0);
  const count = f.changes.length;
  for (const value of [NaN, Infinity, -Infinity, '0.5', undefined]) f.controller.setProgress(value);
  assert.equal(f.changes.length, count); assert.equal(f.frames.size, 0);
  assert.deepEqual(f.stage.attributes, {});
});

test('external endpoint movement is linear over 450 milliseconds and exposes its pending target', t => {
  const f = fixture(t);
  f.controller.setProgress(1); close(f.controller.getProgress(), 0); close(f.controller.getTarget(), 1);
  for (const expected of [.25, .5, .75, 1]) {f.step(112.5); close(f.controller.getProgress(), expected);}
  assert.equal(f.frames.size, 0); close(f.controller.getTarget(), 1);
});

test('successive zoom targets accumulate independently and continue from the displayed progress without jumping', t => {
  const f = fixture(t);
  f.controller.setProgress(.4); f.step(45); close(f.controller.getProgress(), .1);
  f.controller.setProgress(f.controller.getTarget() + .3);
  close(f.controller.getTarget(), .7); close(f.controller.getProgress(), .1);
  f.step(90); close(f.controller.getProgress(), .3);
  f.controller.setProgress(.7); // An identical notification must not restart travel.
  f.step(90); close(f.controller.getProgress(), .5);
  f.controller.setProgress(.2); close(f.controller.getProgress(), .5); close(f.controller.getTarget(), .2);
  f.step(90); close(f.controller.getProgress(), .3);
  f.immediate(.85); close(f.controller.getProgress(), .85); close(f.controller.getTarget(), .85);
  assert.equal(f.frames.size, 0); f.step(1000); close(f.controller.getProgress(), .85);
});

test('blank stage and central title or content double clicks toggle endpoints and settle to the nearest form', t => {
  const f = fixture(t), title = new Element('h1'), content = new Element();
  content.parentNode = f.center; title.parentNode = content;
  assert.equal(f.stage.fire('dblclick').prevented, true); f.step(450); close(f.controller.getProgress(), 1);
  assert.equal(f.stage.fire('dblclick', {target: title}).prevented, true); f.step(450); close(f.controller.getProgress(), 0);
  f.immediate(.4); f.stage.fire('dblclick', {target: content}); f.step(180); close(f.controller.getProgress(), 0);
  f.immediate(.6); f.stage.fire('dblclick'); f.step(180); close(f.controller.getProgress(), 1);
  f.immediate(.5); f.stage.fire('dblclick', {target: title}); f.step(225); close(f.controller.getProgress(), 1);
});

test('double clicks on peripheral cards, central CTA descendants and interactive fields retain their own meaning', t => {
  const f = fixture(t), card = new Element(), child = new Element('span');
  card.float = true; card.parentNode = f.stage; child.parentNode = card;
  const targets = [child, ...['button', 'a', 'input', 'select', 'textarea', 'summary', 'label'].map(tag => {
    const node = new Element(tag), descendant = new Element('span'); node.parentNode = f.center; descendant.parentNode = node; return descendant;
  })];
  for (const role of ['button', 'link', 'slider']) {const node = new Element(); node.attributes.role = role; node.parentNode = f.center; targets.push(node);}
  const editing = new Element(); editing.editable = true; editing.parentNode = f.center; targets.push(editing);
  for (const target of targets) assert.equal(f.stage.fire('dblclick', {target}).prevented, false);
  for (const properties of [{ctrlKey: true}, {metaKey: true}, {altKey: true}, {button: 1}, {defaultPrevented: true}]) {
    assert.equal(f.stage.fire('dblclick', properties).prevented, false);
  }
  assert.equal(f.frames.size, 0); assert.deepEqual(f.changes, [0]);
});

test('native browser zoom, ordinary scrolling, touch and page controls are never intercepted at any width', t => {
  const f = fixture(t);
  f.immediate(.5);
  for (const width of [390, 1280]) {
    f.win.innerWidth = width;
    for (const modifiers of [{}, {ctrlKey: true}, {metaKey: true}]) {
      for (const deltaMode of [0, 1, 2]) {
        assert.equal(f.stage.fire('wheel', {deltaY: -120, deltaMode, ...modifiers}).prevented, false);
      }
      for (const key of ['+', '-', '=', '0']) assert.equal(f.stage.fire('keydown', {key, ...modifiers}).prevented, false);
    }
    for (const type of ['pointerdown', 'touchstart', 'touchmove', 'click', 'input']) {
      assert.equal(f.stage.fire(type, {pointerType: 'touch'}).prevented, false);
      assert.equal(f.root.fire(type).prevented, false);
    }
  }
  close(f.controller.getProgress(), .5); assert.equal(f.frames.size, 0);
  assert.deepEqual([...f.stage.listeners.keys()], ['dblclick']); assert.equal(f.root.countListeners(), 0); assert.equal(f.win.countListeners(), 0);
});

test('a hidden document freezes the animation clock and resumes only its remaining travel', t => {
  const f = fixture(t);
  f.controller.setProgress(1); f.step(150); close(f.controller.getProgress(), 1 / 3);
  f.setHidden(true); assert.equal(f.frames.size, 0);
  f.step(30000); close(f.controller.getProgress(), 1 / 3); close(f.controller.getTarget(), 1);
  f.setHidden(false); close(f.controller.getProgress(), 1 / 3);
  f.step(150); close(f.controller.getProgress(), 2 / 3);
  f.step(150); close(f.controller.getProgress(), 1);
});

test('new zoom targets received while hidden resume from the displayed value without a time jump', t => {
  const f = fixture(t);
  f.immediate(.2); f.setHidden(true); f.controller.setProgress(.8);
  f.step(30000); close(f.controller.getProgress(), .2); close(f.controller.getTarget(), .8); assert.equal(f.frames.size, 0);
  f.setHidden(false); f.step(135); close(f.controller.getProgress(), .5);
  f.step(135); close(f.controller.getProgress(), .8);
});

test('reduced motion makes explicit transitions immediate and completes a transition when enabled', t => {
  const f = fixture(t, {reducedMotion: true});
  f.controller.setProgress(.8); close(f.controller.getProgress(), .8); assert.equal(f.frames.size, 0);
  f.stage.fire('dblclick'); close(f.controller.getProgress(), 1); assert.equal(f.frames.size, 0);
  f.setReduced(false); f.controller.setProgress(0); f.step(90); close(f.controller.getProgress(), .8);
  f.setReduced(true); close(f.controller.getProgress(), 0); close(f.controller.getTarget(), 0); assert.equal(f.frames.size, 0);
});

test('dispose removes handlers and pending work and makes retained callbacks or external writes harmless', t => {
  const f = fixture(t);
  f.controller.setProgress(1); f.step(90); const queued = [...f.frames.values()][0], count = f.changes.length;
  f.controller.dispose(); f.controller.dispose();
  assert.equal(f.frames.size, 0);
  for (const node of [f.root, f.stage, f.doc, f.win, f.reduced]) assert.equal(node.countListeners(), 0);
  queued(20000); f.controller.setProgress(.9); f.immediate(.9); f.stage.fire('dblclick');
  close(f.controller.getProgress(), .2); assert.equal(f.changes.length, count);
});

test('missing animation scheduling degrades to an immediate transition and a missing stage is a no-op', t => {
  const noFrames = fixture(t, {withoutFrames: true}); noFrames.controller.setProgress(.6); close(noFrames.controller.getProgress(), .6);
  const noStage = fixture(t, {withoutStage: true}); noStage.controller.setProgress(.6); close(noStage.controller.getProgress(), 0);
  close(noStage.controller.getTarget(), 0); assert.equal(noStage.changes.length, 0); assert.equal(noStage.doc.countListeners(), 0);
});