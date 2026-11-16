const CARD_BUTTON = 'button[data-topics-open]';
const DROP_TARGET = '[data-topics-drop]';
const HOLD_MS = 350;
const MOVE_TOLERANCE = 8;
const SCROLL_EDGE = 72;

/** Long press moves a card; a short press keeps its ordinary button behavior. */
export function mountWorkspaceTopicDrag({page, scrollTarget, canMove, onStart, onDrop}) {
  const document = page.ownerDocument;
  const window = document.defaultView;
  let gesture = null;
  let suppressNextClick = false;
  let frame = null;

  function markTarget() {
    const {x, y, origin, target} = gesture;
    const hit = document.elementFromPoint(x, y)?.closest(DROP_TARGET);
    const next = hit && page.contains(hit) && hit.dataset.topicsDrop !== origin ? hit : null;
    if (next === target) return;
    target?.classList.remove('wt-drop-target');
    next?.classList.add('wt-drop-target');
    gesture.target = next;
  }

  function positionPreview() {
    const {x, y, preview, width, height} = gesture;
    const left = x + width + 22 < window.innerWidth ? x + 14 : x - width - 14;
    const top = y + height + 24 < window.innerHeight ? y + 16 : y - height - 16;
    preview.style.left = Math.max(8, left) + 'px';
    preview.style.top = Math.max(8, top) + 'px';
  }

  function scrollStep() {
    frame = null;
    if (!gesture?.preview) return;
    const bounds = scrollTarget === window
      ? {top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth}
      : scrollTarget.getBoundingClientRect();
    const {x, y} = gesture;
    if (x < bounds.left || x > bounds.right) return;
    const fromTop = y - Math.max(0, bounds.top);
    const fromBottom = Math.min(window.innerHeight, bounds.bottom) - y;
    const distance = Math.min(fromTop, fromBottom);
    if (distance >= SCROLL_EDGE) return;
    const speed = Math.ceil(18 * (1 - Math.max(0, distance) / SCROLL_EDGE));
    const scrollPosition = () => scrollTarget === window ? window.scrollY : scrollTarget.scrollTop;
    const before = scrollPosition();
    scrollTarget.scrollBy({top: fromTop < fromBottom ? -speed : speed, behavior: 'instant'});
    if (scrollPosition() !== before) {
      markTarget();
      frame = window.requestAnimationFrame(scrollStep);
    }
  }

  function cancel(suppressClick = Boolean(gesture?.preview)) {
    if (!gesture) return;
    const {timer, pointerId, source, preview, target} = gesture;
    gesture = null;
    window.clearTimeout(timer);
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = null;
    if (suppressClick) suppressNextClick = true;
    if (!preview) return;
    page.classList.remove('wt-dragging');
    source.closest('.wt-card')?.classList.remove('wt-card-held');
    target?.classList.remove('wt-drop-target');
    preview.remove();
    if (page.hasPointerCapture(pointerId)) page.releasePointerCapture(pointerId);
  }

  function activate(current) {
    if (current !== gesture) return;
    const {source, cardId, pointerId} = current;
    const hit = document.elementFromPoint(current.x, current.y);
    if (!source.isConnected || !source.contains(hit) || !canMove(cardId)) {
      cancel();
      return;
    }
    current.snapshot = onStart?.(cardId);
    const preview = document.createElement('div');
    preview.className = 'wt-drag-preview';
    preview.setAttribute('aria-hidden', 'true');
    preview.textContent = source.querySelector('.wt-card-label strong')?.textContent ?? source.textContent;
    page.append(preview);
    current.preview = preview;
    const {width, height} = preview.getBoundingClientRect();
    current.width = width;
    current.height = height;
    page.classList.add('wt-dragging');
    source.closest('.wt-card')?.classList.add('wt-card-held');
    page.setPointerCapture(pointerId);
    positionPreview();
    markTarget();
  }

  function pointerDown(event) {
    if (gesture) {
      if (event.pointerId !== gesture.pointerId) cancel();
      return;
    }
    suppressNextClick = false;
    if (!event.isPrimary || event.button !== 0) return;
    const source = event.target.closest?.(CARD_BUTTON);
    if (!source || !page.contains(source) || source.disabled) return;
    const cardId = source.dataset.topicsOpen;
    if (!canMove(cardId)) return;
    const current = {
      source, cardId, pointerId: event.pointerId, pointerType: event.pointerType,
      x: event.clientX, y: event.clientY,
      origin: source.closest(DROP_TARGET)?.dataset.topicsDrop
    };
    gesture = current;
    current.timer = window.setTimeout(() => activate(current), HOLD_MS);
  }

  function pointerMove(event) {
    if (event.pointerId !== gesture?.pointerId) return;
    if (!gesture.preview) {
      if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > MOVE_TOLERANCE) cancel(true);
      return;
    }
    if (!gesture.source.isConnected) {
      cancel();
      return;
    }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    positionPreview();
    markTarget();
    if (frame === null) frame = window.requestAnimationFrame(scrollStep);
  }

  function pointerUp(event) {
    if (event.pointerId !== gesture?.pointerId) return;
    if (!gesture.preview || !gesture.source.isConnected) {
      cancel();
      return;
    }
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    markTarget();
    const {target, cardId, snapshot} = gesture;
    cancel();
    if (!target || !canMove(cardId)) return;
    let topic;
    try { topic = JSON.parse(target.dataset.topicsDrop); } catch { return; }
    if (topic === null || typeof topic === 'string') onDrop(cardId, topic, snapshot);
  }

  function pointerCancel(event) {
    if (event.pointerId === gesture?.pointerId) cancel();
  }
  function lostCapture(event) {
    if (event.target === page) pointerCancel(event);
  }
  function keyDown(event) {
    if (event.key === 'Escape' && gesture) {
      event.preventDefault();
      cancel(true);
    }
  }
  function click(event) {
    if (!event.detail || !suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function contextMenu(event) {
    if (gesture?.preview || gesture?.pointerType === 'touch') event.preventDefault();
  }
  function touchMove(event) {
    // Leave native scrolling available until the hold activates.
    if (gesture?.preview && gesture.pointerType === 'touch' && event.cancelable) event.preventDefault();
  }
  function scroll() {
    if (gesture?.preview) markTarget();
  }
  const listeners = [
    [window, 'pointerdown', pointerDown, true], [window, 'pointermove', pointerMove],
    [window, 'pointerup', pointerUp], [window, 'pointercancel', pointerCancel],
    [window, 'keydown', keyDown], [window, 'blur', () => cancel()],
    [page, 'lostpointercapture', lostCapture], [page, 'click', click, true],
    [page, 'contextmenu', contextMenu], [page, 'touchmove', touchMove, {passive: false}],
    [scrollTarget, 'scroll', scroll, {passive: true}]
  ];
  for (const [target, type, listener, options] of listeners) target.addEventListener(type, listener, options);
  return () => {
    cancel();
    for (const [target, type, listener, options] of listeners) target.removeEventListener(type, listener, options);
  };
}
