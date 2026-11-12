import {isWorkspaceTopicCandidateId} from './workspace-topics-model.js';

const CARD_GAP = 18;
const REGION_GAP = 28;
const REGION_PADDING = 18;
const HEADER_HEIGHT = 68;
const COLLAPSED_WIDTH = 288;
const CANVAS_PADDING = 18;
const VIEW_ASPECT = 1.4;

function displayCard(card) {
  const ai = card.id === 'ai';
  return {
    ...card,
    w: Math.max(ai ? 390 : 240, Math.min(ai ? 480 : 300, card.w)),
    h: Math.max(ai ? 350 : 220, Math.min(ai ? 380 : 260, card.h)),
  };
}

function layoutRegion(topic, members, closed) {
  const key = JSON.stringify(topic);
  const count = members.length;
  const collapsed = closed.has(key);
  const region = {key, topic, count, collapsed, w: COLLAPSED_WIDTH, h: HEADER_HEIGHT};
  if (collapsed) return {region, cards: []};

  const columns = count === 1 ? 1 : count <= 4 ? 2 : 3;
  const cards = [];
  let contentWidth = 0;
  let y = HEADER_HEIGHT;
  for (let start = 0; start < count; start += columns) {
    const row = members.slice(start, start + columns);
    let x = REGION_PADDING;
    let height = 0;
    for (const card of row) {
      cards.push({...card, x, y});
      x += card.w + CARD_GAP;
      height = Math.max(height, card.h);
    }
    contentWidth = Math.max(contentWidth, x - REGION_PADDING - CARD_GAP);
    y += height + CARD_GAP;
  }
  region.w = Math.max(COLLAPSED_WIDTH, contentWidth + 2 * REGION_PADDING);
  region.h = count ? y - CARD_GAP + REGION_PADDING : HEADER_HEIGHT + REGION_PADDING;
  return {region, cards};
}

function placeInRows(items, maxWidth) {
  const positions = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const item of items) {
    if (x && x + item.w > maxWidth) {
      y += rowHeight + REGION_GAP;
      x = 0;
      rowHeight = 0;
    }
    positions.push({x: x + CANVAS_PADDING, y: y + CANVAS_PADDING});
    width = Math.max(width, x + item.w);
    rowHeight = Math.max(rowHeight, item.h);
    x += item.w + REGION_GAP;
  }
  return {positions, span: Math.max(width / VIEW_ASPECT, y + rowHeight)};
}

function packRegions(items) {
  const width = items.reduce((max, item) => Math.max(max, item.w), 0);
  const area = items.reduce((sum, item) => sum + (item.w + REGION_GAP) * (item.h + REGION_GAP), 0);
  const idealWidth = Math.sqrt(area * VIEW_ASPECT);
  let best;
  for (const ratio of [1, 0.8, 1.2, 1.4, 1.65]) {
    const packing = placeInRows(items, Math.max(width, idealWidth * ratio));
    if (!best || packing.span < best.span) best = packing;
  }
  return best.positions;
}

/** Project the home cards into topic regions without changing saved canvas geometry. */
export function layoutCanvasTopicStorage(cards, assignments, closed = new Set()) {
  const topicsByCard = new Map(assignments.map(({id, topic}) => [id, topic]));
  const topics = new Map();
  const loose = [];
  for (const source of cards) {
    const card = displayCard(source);
    if (!isWorkspaceTopicCandidateId(card.id)) {
      loose.push(card);
      continue;
    }
    const topic = topicsByCard.get(card.id) ?? null;
    if (!topics.has(topic)) topics.set(topic, []);
    topics.get(topic).push(card);
  }
  if (topics.size && !topics.has(null)) topics.set(null, []);

  const names = [...topics.keys()].filter(topic => topic !== null).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  if (topics.has(null)) names.push(null);
  const groups = names.map(topic => layoutRegion(topic, topics.get(topic), closed));
  const items = [...groups.map(({region}) => region), ...loose];
  const positions = packRegions(items);
  const regions = [];
  const projected = [];
  const bounds = [];
  groups.forEach(({region, cards}, index) => {
    const {x, y} = positions[index];
    const placed = {...region, x, y};
    regions.push(placed);
    bounds.push({x, y, w: region.w, h: region.h});
    for (const card of cards) projected.push({...card, x: x + card.x, y: y + card.y});
  });
  loose.forEach((card, index) => {
    const {x, y} = positions[groups.length + index];
    projected.push({...card, x, y});
    bounds.push({x, y, w: card.w, h: card.h});
  });
  return {regions, cards: projected, bounds};
}
