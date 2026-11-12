import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasBounds} from '../src/canvas.js';
import {layoutCanvasTopicStorage} from '../src/canvas-topic-storage.js';

const card = (id, index = 0) => ({id, x: 73 * index - 340, y: 112 * index - 530, w: 405, h: 480, color: '#7950f2'});
const intersects = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (region, member) => region.x < member.x && region.y < member.y
  && region.x + region.w > member.x + member.w && region.y + region.h > member.y + member.h;

test('a dense home-canvas projection groups real cards without touching stored coordinates or assignments', () => {
  const topicNames = ['个人阅读与书单', '课程复习', '小组项目', '校园创作展筹备', '周末生活'];
  const groupSizes = [1, 3, 3, 2, 3];
  const cards = Array.from({length: 16}, (_, i) => card('card-'+i, i)).concat(card('ai', 16));
  const assigned = topicNames.flatMap((topic, i) => Array(groupSizes[i]).fill(topic));
  const assignments = assigned.map((topic, i) => ({id: cards[i].id, topic})).concat({id: 'ai', topic: '旧分组'});
  const original = structuredClone({cards, assignments});
  const result = layoutCanvasTopicStorage(cards, assignments, new Set());
  assert.deepEqual({cards, assignments}, original);
  assert.deepEqual(result.regions.map(({topic}) => topic), [...topicNames.slice().sort((a, b) => a.localeCompare(b, 'zh-CN')), null]);
  assert.equal(result.cards.length, 17);

  const topicByCard = new Map(assignments.map(({id, topic}) => [id, topic]));
  for (const member of result.cards) {
    const containers = result.regions.filter(region => contains(region, member));
    if (member.id === 'ai') assert.deepEqual(containers, []);
    else assert.deepEqual(containers.map(region => region.topic), [topicByCard.get(member.id) ?? null]);
  }
  for (const boxes of [result.bounds, result.cards]) {
    boxes.forEach((box, index) => {
      assert.ok(boxes.slice(index + 1).every(other => !intersects(box, other)));
    });
  }
  const {w, h} = canvasBounds(result.bounds);
  assert.ok(w * 0.3 <= 630 && h * 0.3 <= 540, 'demo-sized groups fit a 700×612 canvas with inset');
});

test('collapsed regions keep a drop target and count while their original cards can be restored', () => {
  const cards = [card('project'), card('block:notes', 1), card('ai', 2)];
  const assignments = cards.slice(0, 2).map(({id}) => ({id, topic: '同一主题'}));
  const expanded = layoutCanvasTopicStorage(cards, assignments, new Set());
  const closed = new Set([JSON.stringify('同一主题')]);
  const collapsed = layoutCanvasTopicStorage(cards, assignments, closed);

  assert.equal(collapsed.regions[0].count, 2);
  assert.equal(collapsed.regions[0].collapsed, true);
  assert.ok(collapsed.regions[0].h < expanded.regions[0].h);
  assert.deepEqual(collapsed.cards.map(({id}) => id), ['ai']);
  assert.equal(collapsed.regions[1].topic, null);
  assert.equal(collapsed.regions[1].count, 0);
  assert.deepEqual(layoutCanvasTopicStorage(cards, assignments, new Set()), expanded);
  assert.deepEqual(closed, new Set([JSON.stringify('同一主题')]));
});

test('an empty or AI-only canvas has no empty topic region', () => {
  assert.deepEqual(layoutCanvasTopicStorage([], []), {regions: [], cards: [], bounds: []});
  const aiOnly = layoutCanvasTopicStorage([card('ai')], [{id: 'ai', topic: '旧分组'}]);
  assert.deepEqual(aiOnly.regions, []);
  assert.equal(aiOnly.cards[0].id, 'ai');
  assert.equal(aiOnly.bounds.length, 1);
});
