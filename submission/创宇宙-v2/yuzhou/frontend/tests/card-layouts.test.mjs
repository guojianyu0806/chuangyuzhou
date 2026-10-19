import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_PRESENTATIONS, normalizePresentation, normalizeStackPointer, stackMetrics, stackLayout } from '../src/card-layouts.js';

const near = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);
const fixture = (overrides = {}) => ({ width: 390, height: 640, count: 9, pointer: .5, ...overrides });
const atCard = (index, options = fixture()) => {
  const m = stackMetrics(options);
  return stackLayout({ ...options, scrollTop: m.padding + index * m.step - m.pointerY });
};

test('only known presentations survive; invalid persisted preferences have useful fallbacks', () => {
  assert.deepEqual(CARD_PRESENTATIONS, ['canvas', 'list', 'grid-2', 'grid-3', 'stack']);
  for (const value of CARD_PRESENTATIONS) assert.equal(normalizePresentation(value), value);
  assert.equal(normalizePresentation('unknown'), 'canvas');
  assert.equal(normalizePresentation(null, 'grid-2'), 'grid-2');
  assert.equal(normalizePresentation(undefined, 'unknown'), 'canvas');
  assert.equal(normalizeStackPointer(undefined), .5);
  assert.equal(normalizeStackPointer(null), .5);
  assert.equal(normalizeStackPointer(''), .5);
  assert.equal(normalizeStackPointer('0.25'), .25);
  assert.equal(normalizeStackPointer(-10), 0);
  assert.equal(normalizeStackPointer(10), 1);
  assert.equal(normalizeStackPointer(NaN), .5);
});

test('the first and last card can meet every pointer position without overscrolling', () => {
  for (const width of [180, 390, 800, 1440]) for (const height of [240, 640, 1200]) {
    for (const count of [1, 2, 19]) for (const pointer of [0, .25, .5, 1]) {
      const options = fixture({ width, height, count, pointer });
      const m = stackMetrics(options);
      near(m.pointerY, 24 + pointer * (height - 48));
      near(m.railY, pointer * (height - 48));
      for (const index of [0, count - 1]) {
        const requestedScroll = m.padding + index * m.step - m.pointerY;
        assert.ok(requestedScroll >= 0);
        assert.ok(requestedScroll <= m.worldHeight - height + 1e-7);
        const layout = atCard(index, options);
        assert.equal(layout.activeIndex, index);
        near(layout.cards[index].y + m.cardHeight / 2 - layout.scrollTop, m.pointerY);
        assert.ok(layout.cards[0].y >= 0);
        assert.ok(layout.cards.at(-1).y + m.cardHeight <= m.worldHeight);
      }
    }
  }
});

test('scrolling moves focus by anchor distance; moving the pointer selects the card passing it', () => {
  const options = fixture();
  const initial = atCard(3, options);
  const scrolled = stackLayout({ ...options, scrollTop: initial.scrollTop + initial.step * 1.25 });
  near(scrolled.focus, 4.25);
  assert.equal(scrolled.activeIndex, 4);
  const moved = stackLayout({ ...options, scrollTop: initial.scrollTop, pointer: .5 + initial.step / (options.height - 48) });
  near(moved.focus, 4);
  assert.equal(moved.activeIndex, 4);
});

test('the selected card forms a partial fan with overlap and preserves ordered card centers', () => {
  const layout = atCard(4, fixture({ count: 15 }));
  const selected = layout.cards[4];
  near(selected.openness, 1);
  near(selected.scale, 1);
  near(selected.rotate, 0);
  const focusedGap = layout.cards[5].y - selected.y;
  assert.ok(focusedGap > layout.step);
  assert.ok(focusedGap < layout.cardHeight * .55);
  assert.ok(layout.cards.at(-1).y - layout.cards.at(-2).y < layout.step + .01);
  for (const [index, card] of layout.cards.entries()) {
    assert.ok(card.scale >= .93 && card.scale <= 1);
    assert.ok(card.rotate >= -2 && card.rotate <= 2);
    assert.ok(card.x >= (layout.width - layout.cardWidth) / 2);
    assert.ok(card.x + layout.cardWidth <= layout.width);
    if (index !== layout.activeIndex) assert.ok(selected.z > card.z);
    if (index) assert.ok(card.y > layout.cards[index - 1].y);
  }
});

test('a 433px phone viewport shows overlapping neighbors above and below the active card', () => {
  const layout = atCard(4, fixture({ width: 390, height: 433 }));
  const top = index => layout.cards[index].y - layout.scrollTop;
  assert.equal(layout.cardHeight, 300);
  assert.ok(layout.step >= 58 && layout.step <= 64);
  assert.ok(top(4) > 0 && top(4) + layout.cardHeight < layout.height);
  // The previous card remains visible above the selection and the next card below it.
  assert.ok(top(3) < top(4) && top(3) + layout.cardHeight > top(4));
  assert.ok(top(5) > top(4) && top(5) < top(4) + layout.cardHeight);
  assert.ok(top(3) + layout.cardHeight > 0);
  assert.ok(top(5) < layout.height);
});

test('all geometry stays continuous when active card selection crosses its midpoint', () => {
  const initial = atCard(3, fixture());
  const midpoint = initial.scrollTop + initial.step / 2;
  const before = stackLayout({ ...fixture(), scrollTop: midpoint - .0001 });
  const after = stackLayout({ ...fixture(), scrollTop: midpoint + .0001 });
  assert.equal(before.activeIndex, 3);
  assert.equal(after.activeIndex, 4);
  for (let index = 0; index < before.cards.length; index++) {
    for (const key of ['x', 'y', 'scale', 'rotate', 'openness']) {
      near(before.cards[index][key], after.cards[index][key], .005);
    }
  }
});

test('empty data, invalid dimensions and elastic scroll boundaries return finite safe geometry', () => {
  const empty = stackLayout({ width: 0, height: -10, count: 0, pointer: Infinity, scrollTop: -100 });
  assert.deepEqual(empty.cards, []);
  assert.equal(empty.activeIndex, -1);
  assert.equal(empty.focus, 0);
  for (const value of Object.values(empty)) if (typeof value === 'number') assert.ok(Number.isFinite(value));
  for (const options of [
    { width: NaN, height: Infinity, count: 1, pointer: NaN, scrollTop: Infinity },
    { width: -99, height: 0, count: 2.9, pointer: -10, scrollTop: -1e9 },
    { width: 1e20, height: 1e20, count: 2, pointer: 10, scrollTop: 1e20 },
    { count: -1 }, { count: NaN }, { count: Infinity },
  ]) {
    const layout = stackLayout(options);
    for (const card of layout.cards) for (const value of Object.values(card)) assert.ok(Number.isFinite(value));
    assert.ok(layout.scrollTop >= 0 && layout.scrollTop <= layout.worldHeight - layout.height);
    assert.ok(layout.focus >= 0 && layout.focus <= Math.max(0, layout.count - 1));
  }
  assert.equal(stackLayout({ count: 1e100 }).cards.length, 10000);
});

test('layout calculations never write presentation positions into caller data', () => {
  const options = Object.freeze({ ...fixture(), scrollTop: 100, cards: Object.freeze([{ x: 99, y: 120 }]) });
  const layout = stackLayout(options);
  assert.equal(options.cards[0].x, 99);
  assert.equal(options.cards[0].y, 120);
  assert.notEqual(layout.cards, options.cards);
});
