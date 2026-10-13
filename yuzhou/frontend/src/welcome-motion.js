const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const axes = ['x', 'y', 'rx', 'ry'];
const zero = () => ({x: 0, y: 0, rx: 0, ry: 0});

// Presentation-only pointer motion. CSS owns the independent idle float on the
// inner tile; this controller never changes a canvas card or its saved geometry.
export function mountWelcomeMotion({root, win = window, doc = document}) {
  const stage = root.querySelector('.welcome-stage');
  if (!stage) return () => {};
  const button = root.querySelector('[data-welcome-motion]');
  const label = button?.querySelector('[data-welcome-motion-label]') || button;
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const cards = [...root.querySelectorAll('.welcome-float')].map((node, index) => {
    const motion = node.querySelector('.welcome-float-motion');
    const rawDepth = Number(node.dataset.depth);
    const rawPhase = Number(node.dataset.phase);
    return {node, motion, depth: clamp(Number.isFinite(rawDepth) ? rawDepth : 1, .6, 1.4),
      phase: Number.isFinite(rawPhase) ? rawPhase : index, center: {x: 0, y: 0},
      current: zero(), velocity: zero(), target: zero(), previousTransform: motion?.style.transform || ''};
  }).filter(card => card.motion);
  const previous = {paused: root.classList.contains('welcome-paused'), state: root.dataset.motionState,
    text: label?.textContent, pressed: button?.getAttribute('aria-pressed'),
    ariaLabel: button?.getAttribute('aria-label'), disabled: button?.disabled};
  let disposed = false, manualPaused = false, visible = true, pointer = null;
  let scene = null, frame = null, lastTime = null;
  const paused = () => manualPaused || !!reduced?.matches || !!doc.hidden || !visible;

  function stop() {
    if (frame !== null) win.cancelAnimationFrame?.(frame);
    frame = null; lastTime = null;
  }
  function paint(card) {
    const {x, y, rx, ry} = card.current;
    card.motion.style.transform = `translate3d(${x.toFixed(3)}px, ${y.toFixed(3)}px, 0) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)`;
  }
  function unsettled(card) {
    return axes.some(axis => Math.abs(card.target[axis] - card.current[axis]) > .025 || Math.abs(card.velocity[axis]) > .025);
  }
  function tick(time) {
    frame = null;
    if (disposed || paused()) return;
    const dt = lastTime === null ? 1 / 60 : clamp((time - lastTime) / 1000, .001, .032);
    lastTime = time;
    let moving = false;
    for (const card of cards) {
      for (const axis of axes) {
        card.velocity[axis] += ((card.target[axis] - card.current[axis]) * 180 - card.velocity[axis] * 25) * dt;
        card.current[axis] += card.velocity[axis] * dt;
      }
      if (unsettled(card)) moving = true;
      else {card.current = {...card.target}; card.velocity = zero();}
      paint(card);
    }
    if (moving) frame = win.requestAnimationFrame(tick);
    else lastTime = null;
  }
  function schedule() {
    if (disposed || paused() || frame !== null || !cards.some(unsettled)) return;
    if (win.requestAnimationFrame) frame = win.requestAnimationFrame(tick);
    else for (const card of cards) {card.current = {...card.target}; card.velocity = zero(); paint(card);}
  }
  function targets() {
    const active = pointer && scene && scene.width > 0 && scene.height > 0;
    const nx = active ? clamp((pointer.x - scene.left) / scene.width * 2 - 1, -1, 1) : 0;
    const ny = active ? clamp((pointer.y - scene.top) / scene.height * 2 - 1, -1, 1) : 0;
    for (const card of cards) {
      const amplitude = 18 + (card.depth - .6) / .8 * 17;
      let pushX = 0, pushY = 0;
      if (active) {
        const dx = card.center.x - pointer.x, dy = card.center.y - pointer.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 180) {
          const force = 30 * (1 - distance / 180) ** 2;
          const angle = card.phase * 2.3999632297;
          pushX = (distance > .01 ? dx / distance : Math.cos(angle)) * force;
          pushY = (distance > .01 ? dy / distance : Math.sin(angle)) * force;
        }
      }
      card.target = {x: nx * amplitude + pushX, y: ny * amplitude + pushY,
        rx: clamp(-ny * card.depth * 2.15, -3, 3), ry: clamp(nx * card.depth * 2.15, -3, 3)};
    }
    schedule();
  }
  function measure() {
    if (disposed) return;
    scene = stage.getBoundingClientRect();
    for (const card of cards) {
      const rect = card.node.getBoundingClientRect();
      card.center = {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
    }
    targets();
  }
  function move(event) {
    if (disposed || paused() || event.pointerType === 'touch' || event.isPrimary === false || event.buttons > 0 ||
      !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    pointer = {x: event.clientX, y: event.clientY};
    targets();
  }
  function leave() {
    if (disposed) return;
    pointer = null; targets();
  }
  function syncPause() {
    if (disposed) return;
    const inactive = paused(), lessMotion = !!reduced?.matches;
    root.classList.toggle('welcome-paused', inactive);
    root.dataset.motionState = lessMotion ? 'reduced' : inactive ? 'paused' : 'running';
    if (button) {
      button.disabled = lessMotion;
      button.setAttribute('aria-pressed', String(inactive));
      const text = lessMotion ? '已减少动态效果' : manualPaused ? '继续浮动' : '暂停浮动';
      button.setAttribute('aria-label', text);
      label.textContent = text;
    }
    if (inactive) {
      stop(); pointer = null;
      for (const card of cards) {
        card.target = zero(); card.velocity = zero();
        if (lessMotion) {card.current = zero(); paint(card);}
      }
    } else schedule();
  }
  function toggle() {if (!disposed && !reduced?.matches) {manualPaused = !manualPaused; syncPause();}}
  const resizeObserver = win.ResizeObserver ? new win.ResizeObserver(measure) : null;
  resizeObserver?.observe(stage);
  const intersection = win.IntersectionObserver ? new win.IntersectionObserver(entries => {
    if (disposed) return;
    const entry = entries.find(item => item.target === stage);
    if (entry) {visible = entry.isIntersecting; syncPause();}
  }, {threshold: 0}) : null;
  intersection?.observe(stage);
  root.addEventListener('pointermove', move, {passive: true});
  root.addEventListener('pointerleave', leave);
  root.addEventListener('pointercancel', leave);
  button?.addEventListener('click', toggle);
  win.addEventListener('blur', leave);
  win.addEventListener('resize', measure);
  win.addEventListener('scroll', measure, {passive: true, capture: true});
  doc.addEventListener('visibilitychange', syncPause);
  reduced?.addEventListener?.('change', syncPause);
  measure(); syncPause();
  return () => {
    if (disposed) return;
    disposed = true; stop();
    resizeObserver?.disconnect(); intersection?.disconnect();
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerleave', leave);
    root.removeEventListener('pointercancel', leave);
    button?.removeEventListener('click', toggle);
    win.removeEventListener('blur', leave);
    win.removeEventListener('resize', measure);
    win.removeEventListener('scroll', measure, true);
    doc.removeEventListener('visibilitychange', syncPause);
    reduced?.removeEventListener?.('change', syncPause);
    for (const card of cards) card.motion.style.transform = card.previousTransform;
    root.classList.toggle('welcome-paused', previous.paused);
    if (previous.state === undefined) delete root.dataset.motionState;
    else root.dataset.motionState = previous.state;
    if (button) {
      button.disabled = previous.disabled;
      label.textContent = previous.text;
      for (const [name, value] of [['aria-pressed', previous.pressed], ['aria-label', previous.ariaLabel]]) {
        if (value === null) button.removeAttribute(name); else button.setAttribute(name, value);
      }
    }
  };
}
