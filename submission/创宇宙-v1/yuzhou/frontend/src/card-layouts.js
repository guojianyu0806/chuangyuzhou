/** Pure presentation geometry; these coordinates never replace saved canvas positions. */
export const CARD_PRESENTATIONS = Object.freeze(['canvas', 'list', 'grid-2', 'grid-3', 'stack']);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finiteNumber = (value, fallback) => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const normalizeCount = value => Math.trunc(clamp(finiteNumber(value, 0), 0, 10000));
const STACK_STEP = 62;
// A partial fan keeps neighboring cards overlapping like a deck, even at the pointer.
const expansion = cardHeight => .3 * (cardHeight + 12 - STACK_STEP) / Math.tanh(1 / .85);

export function normalizePresentation(value, fallback = 'canvas') {
  return CARD_PRESENTATIONS.includes(value) ? value : CARD_PRESENTATIONS.includes(fallback) ? fallback : 'canvas';
}

export function normalizeStackPointer(value) {
  return clamp(finiteNumber(value, .5), 0, 1);
}

export function stackMetrics({ width = 390, height = 640, count = 0, pointer = .5 } = {}) {
  width = clamp(finiteNumber(width, 390), 148, 100000);
  height = clamp(finiteNumber(height, 640), 48, 100000);
  count = normalizeCount(count);
  pointer = normalizeStackPointer(pointer);
  const cardWidth = Math.min(620, Math.max(148, width - 96));
  const cardHeight = clamp(height * .66, 300, 390);
  const step = STACK_STEP;
  // Leave enough scroll runway for either end card at either end of the pointer rail.
  // The second term also contains the deformed cards inside the scroll world.
  const padding = Math.max(height, cardHeight / 2 + expansion(cardHeight) + 24);
  const worldHeight = 2 * padding + Math.max(0, count - 1) * step;
  const railY = pointer * (height - 48);
  return { width, height, count, pointer, cardWidth, cardHeight, step, padding, worldHeight, pointerY: 24 + railY, railY };
}

export function stackLayout(options = {}) {
  const metrics = stackMetrics(options);
  const { width, height, count, cardWidth, cardHeight, step, padding, worldHeight, pointerY } = metrics;
  const scrollTop = clamp(finiteNumber(options.scrollTop, 0), 0, Math.max(0, worldHeight - height));
  // Focus is derived only from the untransformed anchors, never from measured card DOM.
  const focus = count ? clamp((scrollTop + pointerY - padding) / step, 0, count - 1) : 0;
  const activeIndex = count ? Math.round(focus) : -1;
  const extra = expansion(cardHeight);
  const baseX = (width - cardWidth) / 2;
  const bulge = Math.min(12, Math.max(0, baseX - 6));
  const cards = Array.from({ length: count }, (_, index) => {
    const distance = index - focus;
    const openness = Math.exp(-(distance * distance) / (2 * .85 * .85));
    return {
      x: baseX + bulge * openness,
      y: padding + index * step + extra * Math.tanh(distance / .85) - cardHeight / 2,
      scale: .93 + .07 * openness,
      rotate: 2 * Math.tanh(distance / 1.5),
      z: count - Math.abs(index - activeIndex),
      openness,
    };
  });
  return { ...metrics, scrollTop, focus, activeIndex, cards };
}
