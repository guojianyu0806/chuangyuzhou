// Immersive surfaces keep their original DOM, input drafts, and global dialogs.
let activeSurface = null;

export function mountSurfaceFullscreen({element, onChange = () => {}, label = '画布', native = true}) {
  if (!element?.ownerDocument) throw new Error('A connected fullscreen surface is required.');
  const doc = element.ownerDocument, win = doc.defaultView, html = doc.documentElement;
  let active = false, destroyed = false, nativeOwned = false, nativePending = false;
  let previousFocus = null, scroll = null, observer = null, frame = 0, enteredUrl = '';
  const ancestors = [], inertNodes = [];
  const exitButton = doc.createElement('button');
  exitButton.type = 'button'; exitButton.className = 'surface-fullscreen-exit'; exitButton.hidden = true;
  exitButton.setAttribute('aria-label', `退出${label}全屏`);
  exitButton.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 9h5V4m6 0v5h5M4 15h5v5m6 0v-5h5"/></svg><span>退出全屏</span>';
  element.append(exitButton);

  const resize = () => {
    if (!active) return;
    win.cancelAnimationFrame(frame);
    frame = win.requestAnimationFrame(() => {
      if (!active) return;
      element.style.setProperty('--surface-vv-height', `${win.visualViewport?.height || win.innerHeight}px`);
      element.style.setProperty('--surface-vv-top', `${win.visualViewport?.offsetTop || 0}px`);
    });
  };
  const restore = restoreFocus => {
    if (!active) return false;
    active = false;
    if (activeSurface === api) activeSurface = null;
    observer?.disconnect(); observer = null;
    win.cancelAnimationFrame(frame);
    element.classList.remove('surface-is-fullscreen');
    element.style.removeProperty('--surface-vv-height'); element.style.removeProperty('--surface-vv-top');
    exitButton.hidden = true;
    for (const ancestor of ancestors.splice(0)) ancestor.classList.remove('surface-fullscreen-ancestor');
    for (const node of inertNodes.splice(0)) node.inert = false;
    if (!activeSurface) html.classList.remove('surface-fullscreen-active');
    onChange(false);
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus?.({preventScroll:true});
    if (restoreFocus && scroll) win.scrollTo(scroll.x, scroll.y);
    previousFocus = null; scroll = null;
    return true;
  };
  async function exit({restoreFocus = true} = {}) {
    restore(restoreFocus);
    const ownsFullscreen = nativeOwned;
    nativeOwned = false;
    if (ownsFullscreen && doc.fullscreenElement === html && typeof doc.exitFullscreen === 'function') {
      try { await doc.exitFullscreen(); } catch { /* CSS fallback has already exited. */ }
    }
    return active;
  }
  async function enter() {
    if (destroyed || active || !element.isConnected) return active;
    if (activeSurface && activeSurface !== api) await activeSurface.exit({restoreFocus:false});
    if (destroyed || !element.isConnected) return false;
    previousFocus = doc.activeElement; scroll = {x:win.scrollX, y:win.scrollY}; enteredUrl = win.location.href;
    active = true; activeSurface = api;
    html.classList.add('surface-fullscreen-active'); element.classList.add('surface-is-fullscreen');
    exitButton.hidden = false;
    for (let branch = element; branch.parentElement; branch = branch.parentElement) {
      const parent = branch.parentElement;
      if (!parent.classList.contains('surface-fullscreen-ancestor')) { parent.classList.add('surface-fullscreen-ancestor'); ancestors.push(parent); }
      for (const sibling of parent.children) {
        // Root overlays must remain usable while the surface is fullscreen.
        if (sibling === branch || sibling.matches('head,script,style,link,#modal,#ai-drawer,#toasts') || sibling.inert) continue;
        sibling.inert = true; inertNodes.push(sibling);
      }
      if (parent === html) break;
    }
    resize(); onChange(true);
    exitButton.focus({preventScroll:true});
    observer = new win.MutationObserver(() => { if (!element.isConnected) destroy(); });
    observer.observe(doc.body, {childList:true, subtree:true});
    // Fullscreen the document so dialogs outside this surface stay in the same top-layer tree.
    if (native && !doc.fullscreenElement && doc.fullscreenEnabled !== false && typeof html.requestFullscreen === 'function') {
      nativePending = true;
      try {
        await html.requestFullscreen();
        if (active) nativeOwned = doc.fullscreenElement === html;
        else if (!activeSurface && doc.fullscreenElement === html) await doc.exitFullscreen?.();
      } catch { /* WebViews and browsers that reject native fullscreen still use the CSS surface. */ }
      finally { nativePending = false; }
    }
    return active;
  }
  const toggle = () => active ? exit() : enter();
  const fullscreenChange = () => {
    if (active && doc.fullscreenElement === html && nativePending) nativeOwned = true;
    else if (active && nativeOwned && !doc.fullscreenElement) { nativeOwned = false; restore(true); }
    resize();
  };
  const keydown = event => {
    if (!active || event.key !== 'Escape' || event.defaultPrevented || doc.querySelector('dialog[open],#ai-drawer:not([hidden]),[data-surface-overlay="open"]')) return;
    event.preventDefault(); exit();
  };
  const routeChange = () => { if (active && win.location.href !== enteredUrl) exit({restoreFocus:false}); };
  function destroy() {
    if (destroyed) return;
    destroyed = true; exit({restoreFocus:false}); observer?.disconnect();
    exitButton.removeEventListener('click', toggle); exitButton.remove();
    doc.removeEventListener('keydown', keydown); doc.removeEventListener('fullscreenchange', fullscreenChange);
    win.removeEventListener('resize', resize); win.removeEventListener('hashchange', routeChange); win.removeEventListener('popstate', routeChange);
    win.visualViewport?.removeEventListener('resize', resize); win.visualViewport?.removeEventListener('scroll', resize);
  }
  const api = {enter, exit, toggle, destroy, get active() { return active; }};
  exitButton.addEventListener('click', toggle);
  doc.addEventListener('keydown', keydown); doc.addEventListener('fullscreenchange', fullscreenChange);
  win.addEventListener('resize', resize); win.addEventListener('hashchange', routeChange); win.addEventListener('popstate', routeChange);
  win.visualViewport?.addEventListener('resize', resize); win.visualViewport?.addEventListener('scroll', resize);
  return api;
}
