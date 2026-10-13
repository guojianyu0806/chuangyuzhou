const clamp = value => Math.max(0, Math.min(1, value));
const EPSILON = 1e-7;
const FULL_TRAVEL_MS = 450;
const interactive = 'button,a,input,select,textarea,summary,label,[role="button"],[role="link"],[role="slider"],[contenteditable]:not([contenteditable="false"])';

// Browser zoom is observed by the caller. This controller never intercepts wheel
// or keyboard zoom and only owns the transient transition and blank-stage double click.
export function mountWelcomeLayoutControls({root, win = window, doc = document, onProgress = () => {}}) {
  const stage = root.querySelector('.welcome-stage');
  if (!stage) return {dispose() {}, setProgress() {}, getProgress: () => 0, getTarget: () => 0};
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let progress = 0, animation = null, frame = null, disposed = false;
  const time = () => {
    const value = win.performance?.now?.();
    return Number.isFinite(value) ? value : null;
  };
  function cancelFrame() {
    if (frame !== null) win.cancelAnimationFrame?.(frame);
    frame = null;
  }
  function interrupt() {cancelFrame(); animation = null;}
  function paint(value, initial = false) {
    if (disposed) return;
    const next = clamp(value), changed = Math.abs(progress - next) > EPSILON;
    progress = next;
    if (changed || initial) onProgress(progress);
  }
  function tick(stamp) {
    frame = null;
    if (disposed || !animation || doc.hidden) return;
    const run = animation;
    if (run.lastTime !== null) run.elapsed += Math.max(0, stamp - run.lastTime);
    run.lastTime = stamp;
    const fraction = Math.min(1, run.elapsed / run.duration);
    paint(run.from + (run.to - run.from) * fraction);
    if (disposed || animation !== run) return;
    if (fraction >= 1) animation = null;
    else frame = win.requestAnimationFrame(tick);
  }
  function animateTo(value) {
    if (disposed) return;
    const next = clamp(value);
    if (animation && Math.abs(animation.to - next) <= EPSILON) return;
    interrupt();
    if (Math.abs(next - progress) <= EPSILON) return;
    if (reduced?.matches || !win.requestAnimationFrame) {paint(next); return;}
    animation = {from: progress, to: next, duration: FULL_TRAVEL_MS * Math.abs(next - progress), elapsed: 0, lastTime: doc.hidden ? null : time()};
    if (!doc.hidden) frame = win.requestAnimationFrame(tick);
  }
  function setProgress(value, {animate = true} = {}) {
    if (disposed || !Number.isFinite(value)) return;
    if (animate) animateTo(value);
    else {interrupt(); paint(value);}
  }
  function doubleClick(event) {
    if (disposed || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey ||
      event.target.closest?.('.welcome-float:not(.welcome-center-float)') || event.target.closest?.(interactive)) return;
    const endpoint = progress <= EPSILON ? 1 : progress >= 1 - EPSILON ? 0 : progress < .5 ? 0 : 1;
    animateTo(endpoint); event.preventDefault();
  }
  function visibility() {
    if (disposed || !animation) return;
    cancelFrame();
    animation.lastTime = doc.hidden ? null : time();
    if (!doc.hidden) frame = win.requestAnimationFrame(tick);
  }
  function motionPreference() {
    if (disposed || !reduced?.matches || !animation) return;
    const destination = animation.to;
    interrupt(); paint(destination);
  }
  paint(0, true);
  stage.addEventListener('dblclick', doubleClick);
  doc.addEventListener('visibilitychange', visibility);
  reduced?.addEventListener?.('change', motionPreference);
  return {
    setProgress,
    getProgress: () => progress,
    getTarget: () => animation?.to ?? progress,
    dispose() {
      if (disposed) return;
      disposed = true; interrupt();
      stage.removeEventListener('dblclick', doubleClick);
      doc.removeEventListener('visibilitychange', visibility);
      reduced?.removeEventListener?.('change', motionPreference);
    },
  };
}
