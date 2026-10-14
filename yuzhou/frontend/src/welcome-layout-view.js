import {getWelcomeLayouts, interpolateWelcomeLayout} from './welcome-layout.js';
import {mountWelcomeLayoutControls} from './welcome-layout-controls.js';

const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback;
const layoutProperties = ['left', 'top', 'width', 'height', 'transform'];

// Browser zoom changes presentation only. Its native gestures and shortcuts
// remain owned by the browser; normal window resizing only recomputes geometry.
export function mountWelcomeLayout({root, motion, win = window, doc = document}) {
  const stage = root.querySelector('.welcome-stage');
  const center = root.querySelector('.welcome-center-float');
  if (!stage || !center) return () => {};
  const cards = [...root.querySelectorAll('.welcome-constellation .welcome-float')];
  const content = root.querySelector('.welcome-center-content');
  const status = root.querySelector('[data-welcome-layout-status]');
  const nodes = [...cards, center];
  const previous = nodes.map(node => ({values: Object.fromEntries(layoutProperties.map(key => [key, node.style[key] || ''])),
    angle: node.style.getPropertyValue('--tile-angle')}));
  const previousHeight = stage.style.height || '';
  const previousProgress = root.dataset.layoutProgress, previousStatus = status?.textContent;
  const viewport = win.visualViewport;
  const effectiveScale = () => positive(win.devicePixelRatio, 1) * positive(viewport?.scale, 1);
  const initialScale = effectiveScale();
  let lastScale = initialScale, disposed = false, layouts = null, signature = '', horizontalScale = 1;
  let anchorScale = initialScale, anchorProgress = 0;
  let progress = 0, controls = null, dprQuery = null, watchedDpr = null;
  let measureFrame = null;

  function paint(value) {
    if (disposed) return;
    progress = value;
    root.dataset.layoutProgress = String(progress);
    if (status) status.textContent = progress <= 1e-7 ? '形式 1 · 散落' : progress >= 1 - 1e-7 ? '形式 2 · 整齐' : `两种形式之间 · ${Math.round(progress * 100)}%`;
    if (!layouts) return;
    const layout = interpolateWelcomeLayout(layouts, progress);
    const positions = [...layout.cards, layout.center].map(position => horizontalScale === 1 ? position :
      {...position, x: position.x * horizontalScale, w: position.w * horizontalScale});
    if (stage.style.height !== `${layout.height}px`) stage.style.height = `${layout.height}px`;
    positions.forEach((position, index) => {
      const node = nodes[index];
      node.style.left = '0px'; node.style.top = '0px';
      node.style.width = `${position.w}px`; node.style.height = `${position.h}px`;
      node.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
      node.style.setProperty('--tile-angle', `${position.angle}deg`);
    });
    motion?.setLayoutPositions?.(positions);
  }

  function measure() {
    if (disposed) return;
    const width = stage.clientWidth;
    if (!Number.isFinite(width) || width <= 0) return;
    const height = Math.max(540, positive(win.innerHeight, 720) - 156);
    const centerHeight = Math.max(310, positive(content?.scrollHeight, 270) + 40);
    const nextSignature = `${width}:${height}:${centerHeight}:${cards.length}`;
    if (nextSignature === signature) return;
    // Very high browser zoom can make the CSS viewport narrower than 240px.
    // Compress only the horizontal geometry instead of rejecting the resize.
    const logicalWidth = Math.max(240, width);
    horizontalScale = width / logicalWidth;
    layouts = getWelcomeLayouts({width: logicalWidth, height, count: cards.length, centerHeight});
    signature = nextSignature;
    paint(progress);
  }

  function detachDprQuery() {
    if (!dprQuery) return;
    if (dprQuery.removeEventListener) dprQuery.removeEventListener('change', onViewportChange);
    else dprQuery.removeListener?.(onViewportChange);
    dprQuery = null;
  }
  function watchDpr() {
    const current = positive(win.devicePixelRatio, 1);
    if (!win.matchMedia || watchedDpr === current) return;
    detachDprQuery(); watchedDpr = current;
    dprQuery = win.matchMedia(`(resolution: ${current}dppx)`);
    if (dprQuery.addEventListener) dprQuery.addEventListener('change', onViewportChange);
    else dprQuery.addListener?.(onViewportChange);
  }
  function onViewportChange() {
    if (disposed) return;
    const nextScale = effectiveScale();
    if (Math.abs(nextScale - lastScale) > 1e-7) {
      lastScale = nextScale;
      // Keep the zoom mapping independent of its clamped display. Otherwise
      // zooming past an endpoint and back changes the layout at the same scale.
      controls.setProgress(anchorProgress + 2 * (anchorScale - nextScale) / initialScale, {animate: true});
    }
    watchDpr();
    measure();
  }

  measure();
  controls = mountWelcomeLayoutControls({root, win, doc, onProgress: paint, onManualTarget: target => {
    // A deliberate double click establishes a new layout at the current zoom.
    anchorScale = effectiveScale(); anchorProgress = target; lastScale = anchorScale;
  }});
  function queueMeasure() {
    if (disposed || measureFrame !== null) return;
    // Height can change after narrow text wraps. Write in the next frame rather
    // than synchronously resizing the same element inside its observer delivery.
    if (!win.requestAnimationFrame) {measure(); return;}
    measureFrame = win.requestAnimationFrame(() => {measureFrame = null; measure();});
  }
  const observer = win.ResizeObserver ? new win.ResizeObserver(queueMeasure) : null;
  observer?.observe(stage);
  win.addEventListener('resize', onViewportChange);
  viewport?.addEventListener('resize', onViewportChange);
  watchDpr();

  return () => {
    if (disposed) return;
    disposed = true;
    if (measureFrame !== null) win.cancelAnimationFrame?.(measureFrame);
    measureFrame = null;
    observer?.disconnect(); detachDprQuery(); controls.dispose();
    win.removeEventListener('resize', onViewportChange);
    viewport?.removeEventListener('resize', onViewportChange);
    stage.style.height = previousHeight;
    if (previousProgress === undefined) delete root.dataset.layoutProgress;
    else root.dataset.layoutProgress = previousProgress;
    if (status) status.textContent = previousStatus;
    nodes.forEach((node, index) => {
      Object.assign(node.style, previous[index].values);
      if (previous[index].angle) node.style.setProperty('--tile-angle', previous[index].angle);
      else node.style.removeProperty('--tile-angle');
    });
  };
}
