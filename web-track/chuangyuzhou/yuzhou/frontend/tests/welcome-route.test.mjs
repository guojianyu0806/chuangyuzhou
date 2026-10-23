import test from 'node:test';
import assert from 'node:assert/strict';
import {createWelcomeEntryRoute} from '../src/welcome-route.js';

test('a fresh document opens the entrance from default and canvas URLs', () => {
  for (const hash of ['', '#', '#/', '#home', '#/home', '#/home/']) {
    assert.equal(createWelcomeEntryRoute()(hash), '#/welcome', hash);
  }
});

test('entering or returning to the canvas within a document does not reopen the entrance', () => {
  const resolve = createWelcomeEntryRoute();
  assert.equal(resolve('#/home'), '#/welcome');
  for (const hash of ['#/home', '#/builder', '#/home', '#/welcome', '#/home']) {
    assert.equal(resolve(hash), hash);
  }
});

test('a new document presents the entrance again without a persisted visited flag', () => {
  const firstDocument = createWelcomeEntryRoute();
  assert.equal(firstDocument('#/home'), '#/welcome');
  assert.equal(firstDocument('#/home'), '#/home');
  assert.equal(createWelcomeEntryRoute()('#/home'), '#/welcome');
});

test('explicit deep links and layout-fit commands remain intact on first load', () => {
  for (const hash of ['#/builder', '#/space/project%20one', '#/block/custom-one', '#/ai/space%3Aone', '#/settings', '#/inbox', '#/home/layout', '#/welcome']) {
    assert.equal(createWelcomeEntryRoute()(hash), hash);
  }
});

test('a document first opened at a deep link may later navigate to the canvas normally', () => {
  const resolve = createWelcomeEntryRoute();
  assert.equal(resolve('#/space/project-one'), '#/space/project-one');
  assert.equal(resolve('#/home'), '#/home');
});

