import test from 'node:test';
import assert from 'node:assert/strict';
import {mountWelcomeLayout} from '../src/welcome-layout-view.js';
import {getWelcomeLayouts, interpolateWelcomeLayout} from '../src/welcome-layout.js';

function nearPositions(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((position, index) => {
    for (const key of ['x', 'y', 'w', 'h', 'angle']) assert.ok(Math.abs(position[key] - expected[index][key]) < 1e-8, `card ${index} ${key} follows the interpolated geometry`);
  });
}

class Surface {
  constructor() {
    this.listeners = new Map(); this.attributes = {}; this.dataset = {}; this.textContent = '';
    const custom = new Map();
    this.style = {setProperty: (key, value) => custom.set(key, value), getPropertyValue: key => custom.get(key) || '', removeProperty: key => custom.delete(key)};
    this.width = 1280; this.contentHeight = 260; this.reads = 0;
  }
  get clientWidth() {this.reads++; return this.width;}
  get scrollHeight() {this.reads++; return this.contentHeight;}
  addEventListener(type, fn) {if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn);}
  removeEventListener(type, fn) {this.listeners.get(type)?.delete(fn);}
  setAttribute(name, value) {this.attributes[name] = String(value);}
  getAttribute(name) {return this.attributes[name] ?? null;}
  removeAttribute(name) {delete this.attributes[name];}
  closest() {return null;}
  fire(type, properties = {}) {
    const event = {target: this, button: 0, prevented: false, preventDefault() {this.prevented = true;}, ...properties};
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
    return event;
  }
  listenerCount() {return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0);}
}

function fixture(t, {width = 1280, height = 900, dpr = 1, pinch = 1, reduced = true, count = 20, withViewport = true, observers = true, initialFloatStrength} = {}) {
  const root = new Surface(), stage = new Surface(), center = new Surface(), content = new Surface(), status = new Surface();
  const cards = Array.from({length: count}, () => new Surface());
  const win = new Surface(), doc = new Surface(), viewport = new Surface(), preference = new Surface();
  stage.width = width; win.innerHeight = height; win.devicePixelRatio = dpr; viewport.scale = pinch; preference.matches = reduced;
  if (initialFloatStrength !== undefined) stage.style.setProperty('--welcome-float-strength', initialFloatStrength);
  if (withViewport) win.visualViewport = viewport;
  const queries = [];
  win.matchMedia = query => {
    if (query.includes('prefers-reduced-motion')) return preference;
    const media = new Surface(); media.query = query; media.matches = true; queries.push(media); return media;
  };
  const frames = new Map(); let time = 0, nextFrame = 0;
  win.performance = {now: () => time};
  win.requestAnimationFrame = fn => {frames.set(++nextFrame, fn); return nextFrame;};
  win.cancelAnimationFrame = id => frames.delete(id);
  const observersCreated = [];
  if (observers) win.ResizeObserver = class {
    constructor(callback) {this.callback = callback; this.disconnected = false; observersCreated.push(this);}
    observe(target) {this.target = target;}
    disconnect() {this.disconnected = true;}
  };
  const surfaces = {'.welcome-stage': stage, '.welcome-center-float': center, '.welcome-center-content': content, '[data-welcome-layout-status]': status};
  root.querySelector = selector => surfaces[selector] || null;
  root.querySelectorAll = selector => selector === '.welcome-constellation .welcome-float' ? cards : [];
  const painted = [];
  const motion = {setLayoutPositions: positions => painted.push(structuredClone(positions))};
  const cleanup = mountWelcomeLayout({root, motion, win, doc}); t.after(cleanup);
  const step = (milliseconds = 30) => {time += milliseconds; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn(time));};
  const settle = () => {let iterations = 0; while (frames.size && iterations++ < 100) step(); assert.equal(frames.size, 0);};
  const progress = () => Number(root.dataset.layoutProgress);
  const zoom = value => {win.devicePixelRatio = value; win.fire('resize');};
  return {root, stage, center, content, status, cards, win, doc, viewport, preference, frames, queries, observersCreated, painted,
    cleanup, step, settle, progress, zoom};
}

test('initial layout paints the actual card set and floating center in scattered form without state writes', t => {
  const f = fixture(t);
  const expected = getWelcomeLayouts({width: 1280, height: 744, count: 20, centerHeight: 310});
  assert.equal(f.progress(), 0); assert.equal(f.status.textContent, '形式 1 · 散落');
  assert.equal(f.stage.style.height, `${expected.height}px`);
  assert.deepEqual(f.painted.at(-1), [...expected.scatter.cards, expected.scatter.center]);
  assert.equal(f.cards[0].style.width, `${expected.scatter.cards[0].w}px`);
  assert.equal(f.center.style.getPropertyValue('--tile-angle'), `${expected.scatter.center.angle}deg`);
  assert.equal(f.frames.size, 0);
});

test('native desktop zoom moves the layout, while ordinary window resizing only adapts geometry', t => {
  const f = fixture(t);
  f.zoom(.8); assert.ok(Math.abs(f.progress() - .4) < 1e-10);
  f.stage.width = 800; f.win.innerHeight = 1000; f.win.fire('resize');
  assert.ok(Math.abs(f.progress() - .4) < 1e-10);
  const expected = interpolateWelcomeLayout(getWelcomeLayouts({width: 800, height: 844, count: 20, centerHeight: 310}), .4);
  nearPositions(f.painted.at(-1), [...expected.cards, expected.center]);
  f.zoom(1); assert.equal(f.progress(), 0);
});

test('DPR and viewport event duplicates do not apply the same browser zoom multiple times', t => {
  const f = fixture(t, {dpr: 1.5});
  const initialQuery = f.queries[0];
  f.win.devicePixelRatio = 1.2; initialQuery.fire('change');
  const progress = f.progress(), paints = f.painted.length;
  f.win.fire('resize'); f.viewport.fire('resize'); initialQuery.fire('change');
  assert.ok(Math.abs(progress - .4) < 1e-10);
  assert.equal(f.progress(), progress); assert.equal(f.painted.length, paints);
  assert.equal(initialQuery.listenerCount(), 0);
  assert.equal(f.queries.at(-1).query, '(resolution: 1.2dppx)');
  assert.equal(f.queries.at(-1).listenerCount(), 1);
});

test('visual viewport native pinch and desktop page zoom share the initial effective scale baseline', t => {
  const f = fixture(t, {dpr: 2, pinch: 1.2});
  f.viewport.scale = 1; f.viewport.fire('resize');
  assert.ok(Math.abs(f.progress() - 1 / 3) < 1e-10);
  f.viewport.scale = 1.2; f.viewport.fire('resize'); assert.equal(f.progress(), 0);
  f.zoom(1.5); assert.ok(Math.abs(f.progress() - .5) < 1e-10);
});

test('rapid native zoom steps use the zoom anchor without dropping in-flight changes', t => {
  const f = fixture(t, {reduced: false});
  f.zoom(.9); assert.equal(f.progress(), 0);
  f.zoom(.8); assert.equal(f.progress(), 0);
  f.step(45); assert.ok(f.progress() > 0 && f.progress() < .4);
  f.zoom(.7); f.settle();
  assert.ok(Math.abs(f.progress() - .6) < 1e-10);
  f.zoom(.4); f.settle(); assert.equal(f.progress(), 1);
  f.zoom(.6); f.settle(); assert.ok(Math.abs(f.progress() - .8) < 1e-10);
});

test('zooming beyond the scattered endpoint and back restores the same layout at the same zoom', t => {
  const f = fixture(t);
  f.zoom(2); assert.equal(f.progress(), 0);
  f.zoom(1); assert.equal(f.progress(), 0);
  f.zoom(.8); assert.ok(Math.abs(f.progress() - .4) < 1e-10);
  f.zoom(3); assert.equal(f.progress(), 0);
  f.zoom(.8); assert.ok(Math.abs(f.progress() - .4) < 1e-10);
});

test('zooming beyond the grid endpoint does not shift the return path', t => {
  const f = fixture(t);
  f.zoom(.25); assert.equal(f.progress(), 1);
  f.zoom(.5); assert.equal(f.progress(), 1);
  f.zoom(.75); assert.equal(f.progress(), .5);
  f.zoom(1); assert.equal(f.progress(), 0);
});

test('double clicking an intermediate form anchors its chosen endpoint for later zoom round trips', t => {
  const f = fixture(t);
  f.zoom(.8); assert.ok(Math.abs(f.progress() - .4) < 1e-10);
  assert.equal(f.stage.fire('dblclick').prevented, true);
  assert.equal(f.progress(), 0);
  f.zoom(.7); assert.ok(Math.abs(f.progress() - .2) < 1e-10);
  f.zoom(2); assert.equal(f.progress(), 0);
  f.zoom(.8); assert.equal(f.progress(), 0);
  f.stage.fire('dblclick'); assert.equal(f.progress(), 1);
  f.zoom(1); assert.ok(Math.abs(f.progress() - .6) < 1e-10);
  f.zoom(.25); assert.equal(f.progress(), 1);
  f.zoom(.8); assert.equal(f.progress(), 1);
});

test('double clicking an intermediate form nearer the grid preserves the chosen grid anchor', t => {
  const f = fixture(t);
  f.zoom(.6); assert.ok(Math.abs(f.progress() - .8) < 1e-10);
  f.stage.fire('dblclick'); assert.equal(f.progress(), 1);
  f.zoom(.8); assert.ok(Math.abs(f.progress() - .6) < 1e-10);
  f.zoom(.6); assert.equal(f.progress(), 1);
  f.zoom(.25); assert.equal(f.progress(), 1);
  f.zoom(.6); assert.equal(f.progress(), 1);
});

test('native zoom interrupting a manual transition keeps its anchor and continues from the displayed position', t => {
  const f = fixture(t, {reduced: false});
  f.stage.fire('dblclick'); f.step(90);
  assert.ok(Math.abs(f.progress() - .2) < 1e-10);
  f.zoom(1.1); assert.ok(Math.abs(f.progress() - .2) < 1e-10);
  f.step(45); assert.ok(Math.abs(f.progress() - .3) < 1e-10);
  f.settle(); assert.ok(Math.abs(f.progress() - .8) < 1e-10);
  f.zoom(1); f.settle(); assert.ok(Math.abs(f.progress() - 1) < 1e-10);
});

test('linear progress paints cached geometry without reading layout dimensions per animation frame', t => {
  const f = fixture(t, {reduced: false});
  f.zoom(.5);
  const reads = [f.stage.reads, f.content.reads];
  f.step(225); assert.equal(f.progress(), .5);
  const expected = interpolateWelcomeLayout(getWelcomeLayouts({width: 1280, height: 744, count: 20, centerHeight: 310}), .5);
  assert.deepEqual(f.painted.at(-1), [...expected.cards, expected.center]);
  f.step(225); assert.equal(f.progress(), 1);
  assert.deepEqual([f.stage.reads, f.content.reads], reads);
});

test('autonomous float strength follows the displayed layout continuously through both forms', t => {
  const f = fixture(t, {reduced: false});
  const strength = () => Number(f.stage.style.getPropertyValue('--welcome-float-strength'));
  const layouts = getWelcomeLayouts({width: 1280, height: 744, count: 20, centerHeight: 310});
  assert.equal(f.progress(), 0); assert.equal(strength(), 1);
  f.stage.fire('dblclick');
  assert.equal(strength(), 1, 'requesting the grid must not change floating strength before the first frame');
  f.step(225);
  assert.equal(f.progress(), .5); assert.ok(Math.abs(strength() - .725) < 1e-10);
  const halfway = interpolateWelcomeLayout(layouts, .5);
  nearPositions(f.painted.at(-1), [...halfway.cards, halfway.center]);
  f.step(225);
  assert.equal(f.progress(), 1); assert.ok(Math.abs(strength() - .45) < 1e-10);
  nearPositions(f.painted.at(-1), [...layouts.grid.cards, layouts.grid.center]);
  f.stage.fire('dblclick'); f.step(225);
  assert.equal(f.progress(), .5); assert.ok(Math.abs(strength() - .725) < 1e-10);
  f.step(225); assert.equal(f.progress(), 0); assert.equal(strength(), 1);
});

test('ordinary window and observed size changes preserve the current floating strength', t => {
  const f = fixture(t); f.zoom(.75);
  const strength = f.stage.style.getPropertyValue('--welcome-float-strength');
  assert.ok(Math.abs(Number(strength) - .725) < 1e-10);
  f.stage.width = 800; f.win.innerHeight = 1000; f.win.fire('resize');
  assert.equal(f.progress(), .5); assert.equal(f.stage.style.getPropertyValue('--welcome-float-strength'), strength);
  f.stage.width = 390; f.observersCreated[0].callback(); f.step();
  assert.equal(f.progress(), .5); assert.equal(f.stage.style.getPropertyValue('--welcome-float-strength'), strength);
  const expected = interpolateWelcomeLayout(getWelcomeLayouts({width: 390, height: 844, count: 20, centerHeight: 310}), .5);
  nearPositions(f.painted.at(-1), [...expected.cards, expected.center]);
});

test('disposing restores a previous floating strength and prevents queued callbacks from replacing it', t => {
  for (const original of [undefined, '.63']) {
    const f = fixture(t, {reduced: false, initialFloatStrength: original});
    assert.equal(f.stage.style.getPropertyValue('--welcome-float-strength'), '1');
    f.zoom(.5); f.step(225); f.observersCreated[0].callback();
    const queued = [...f.frames.values()];
    f.cleanup(); f.cleanup();
    assert.equal(f.stage.style.getPropertyValue('--welcome-float-strength'), original ?? '');
    assert.equal(f.frames.size, 0);
    f.stage.width = 390; f.observersCreated[0].callback();
    queued.forEach(callback => callback(10000));
    f.zoom(.2); f.viewport.fire('resize'); f.stage.fire('dblclick');
    assert.equal(f.stage.style.getPropertyValue('--welcome-float-strength'), original ?? '');
    assert.equal(f.frames.size, 0);
  }
});

test('resize observers batch dimension writes into a later frame and preserve intermediate progress', t => {
  const f = fixture(t); f.zoom(.75); assert.equal(f.progress(), .5);
  const observer = f.observersCreated[0], before = f.painted.length;
  observer.callback(); observer.callback(); assert.equal(f.painted.length, before);
  assert.equal(f.frames.size, 1, 'observer deliveries must coalesce outside the resize notification');
  f.stage.width = 390; observer.callback(); assert.equal(f.progress(), .5);
  assert.equal(f.painted.length, before, 'never write observed dimensions during the callback');
  f.step(); assert.equal(f.frames.size, 0); assert.equal(f.painted.length, before + 1);
  assert.ok(f.painted.at(-1).every(position => position.x >= 0 && position.w > 0));
  const expected = interpolateWelcomeLayout(getWelcomeLayouts({width:390,height:744,count:20,centerHeight:310}), .5);
  nearPositions(f.painted.at(-1), [...expected.cards,expected.center]);
  observer.callback(); f.step(); assert.equal(f.painted.length, before + 1, 'unchanged observations stop without repainting');
  assert.equal(observer.target, f.stage);
});

test('native scrolling and browser zoom shortcuts have no wheel or key handlers to intercept them', t => {
  const f = fixture(t);
  for (const surface of [f.root, f.stage, f.win, f.doc, f.viewport]) {
    assert.equal(surface.listeners.get('wheel')?.size || 0, 0);
    assert.equal(surface.listeners.get('keydown')?.size || 0, 0);
    assert.equal(surface.fire('wheel', {ctrlKey: true, deltaY: -100}).prevented, false);
    assert.equal(surface.fire('keydown', {ctrlKey: true, key: '+'}).prevented, false);
  }
  assert.equal(f.progress(), 0);
});

test('missing optional browser APIs still allow page zoom and extremely narrow CSS viewports', t => {
  const f = fixture(t, {width: 180, withViewport: false, observers: false});
  f.zoom(.8); assert.ok(Math.abs(f.progress() - .4) < 1e-10);
  assert.ok(f.painted.at(-1).every(position => Object.values(position).every(Number.isFinite)));
  assert.ok(parseFloat(f.center.style.width) < 180);
});

test('dispose restores presentation, removes observers and listeners, and makes queued callbacks inert', t => {
  const f = fixture(t, {reduced: false}); f.zoom(.6);
  const observer = f.observersCreated[0]; observer.callback();
  const queued = [...f.frames.values()];
  f.cleanup(); f.cleanup();
  assert.equal(f.frames.size, 0); assert.equal(observer.disconnected, true);
  assert.equal(f.stage.style.height, ''); assert.equal(f.root.dataset.layoutProgress, undefined);
  for (const node of [...f.cards, f.center]) {
    assert.equal(node.style.transform, ''); assert.equal(node.style.width, ''); assert.equal(node.style.getPropertyValue('--tile-angle'), '');
  }
  for (const node of [f.stage, f.win, f.doc, f.viewport, f.preference, ...f.queries]) assert.equal(node.listenerCount(), 0);
  const paints = f.painted.length;
  observer.callback(); queued.forEach(fn => fn(10000)); f.zoom(.2); f.viewport.fire('resize');
  assert.equal(f.painted.length, paints); assert.equal(f.root.dataset.layoutProgress, undefined);
});

test('unavailable welcome markup is harmless for existing view adapters', () => {
  for (const stage of [null, {}]) {
    const root = {querySelector: selector => selector === '.welcome-stage' ? stage : null};
    const cleanup = mountWelcomeLayout({root, win: {}, doc: {}});
    assert.equal(typeof cleanup, 'function'); cleanup();
  }
});
