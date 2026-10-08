(function installYuzhouDownloads() {
  'use strict';

  const TRUSTED_ORIGIN = 'https://203.195.191.239';
  const MAX_BYTES = 256 * 1024 * 1024;
  const CHUNK_BYTES = 256 * 1024;
  const PORT_TIMEOUT = 3000;
  const CHUNK_TIMEOUT = 120000;
  const PICKER_TIMEOUT = 10 * 60 * 1000;
  if (window !== window.top || window.location.origin !== TRUSTED_ORIGIN || window.__yuzhouDownloads) return;

  let port = null;
  let active = null;
  const portWaiters = new Set();
  const originalClick = HTMLAnchorElement.prototype.click;
  const DATA_MIME = /^(?:application\/(?:octet-stream|json|pdf|zip|x-zip-compressed)|text\/(?:plain|csv|markdown)|image\/(?:png|jpeg|gif|webp)|audio\/(?:mpeg|wav|ogg)|video\/mp4)$/i;

  function notice(message) {
    if (!document.body) { window.alert(message); return; }
    let container = document.getElementById('toasts') || document.getElementById('yuzhou-native-toasts');
    if (!container) {
      container = document.createElement('div');
      container.id = 'yuzhou-native-toasts';
      container.className = 'toasts';
      container.style.cssText = 'position:fixed;z-index:2147483647;bottom:calc(90px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);max-width:calc(100vw - 32px);pointer-events:none';
      document.body.appendChild(container);
    }
    const element = document.createElement('div');
    element.className = 'toast';
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    element.textContent = message;
    container.appendChild(element);
    setTimeout(() => element.remove(), 6000);
  }

  function approvedUrl(value) {
    try {
      const url = new URL(String(value), window.location.href);
      if (url.protocol === 'blob:') return url.origin === TRUSTED_ORIGIN ? url.href : null;
      if (url.protocol === 'data:') {
        const comma = url.href.indexOf(',');
        const mime = url.href.slice(5, comma).split(';')[0] || 'text/plain';
        return comma >= 5 && DATA_MIME.test(mime) ? url.href : null;
      }
      return url.protocol === 'https:' && url.origin === TRUSTED_ORIGIN && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  }

  function filename(value) {
    const cleaned = String(value || '宇宙导出文件').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim().replace(/^\.+/, '');
    return Array.from(cleaned || '宇宙导出文件').slice(0, 160).join('');
  }

  function nativeError(message) {
    return new Error(String(message || '保存失败，请重试。').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 256));
  }

  function post(message) {
    if (!port) throw nativeError('保存连接已断开，请刷新后重试。');
    port.postMessage(JSON.stringify(message));
  }

  function waitForPort(task) {
    if (port) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        portWaiters.delete(finish);
        task.controller.signal.removeEventListener('abort', aborted);
        error ? reject(error) : resolve();
      };
      const aborted = () => finish(nativeError(task.cancelMessage || '已取消保存。'));
      const timer = setTimeout(() => finish(nativeError('保存功能尚未就绪，请刷新页面后重试。')), PORT_TIMEOUT);
      portWaiters.add(finish);
      task.controller.signal.addEventListener('abort', aborted, { once: true });
      if (task.controller.signal.aborted) aborted();
    });
  }

  function exchange(task, message, expectedType, timeout, sequence) {
    if (task.controller.signal.aborted) return Promise.reject(nativeError(task.cancelMessage || '已取消保存。'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(nativeError('保存等待超时，请重新导出。')), timeout);
      const finish = (error, response) => {
        clearTimeout(timer);
        if (task.pending && task.pending.finish === finish) task.pending = null;
        error ? reject(error) : resolve(response);
      };
      task.pending = { type: expectedType, sequence, finish };
      try { post(message); } catch (error) { finish(error); }
    });
  }

  function base64(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode.apply(null, bytes.subarray(index, index + 32768));
    return btoa(binary);
  }

  function cancel(message, silent) {
    const task = active;
    if (!task) return false;
    task.silent = !!silent;
    task.cancelMessage = message || '已取消保存。';
    task.controller.abort();
    if (task.pending) task.pending.finish(nativeError(task.cancelMessage));
    if (task.begun) { try { post({ type: 'cancel', id: task.id }); } catch {} }
    return true;
  }

  async function transfer(task, mime) {
    try {
      // Fetch starts before waiting for the Android picker: the webpage may revoke
      // its object URL after ten seconds, while a user chooses the destination.
      const response = await fetch(task.url, { credentials: 'same-origin', redirect: 'error', signal: task.controller.signal });
      if (!response.ok) throw nativeError('无法读取导出文件，请重试。');
      const declaredSize = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredSize) && declaredSize > MAX_BYTES) throw nativeError('文件超过 256 MB，请分批导出。');
      const blob = await response.blob();
      if (blob.size > MAX_BYTES) throw nativeError('文件超过 256 MB，请分批导出。');
      if (task.controller.signal.aborted) throw nativeError(task.cancelMessage || '已取消保存。');
      await waitForPort(task);
      const type = String(blob.type || mime || 'application/octet-stream').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 127);
      task.begun = true;
      await exchange(task, { type: 'begin', id: task.id, name: task.name, mime: type, size: blob.size }, 'ready', PICKER_TIMEOUT);
      let sequence = 0;
      for (let offset = 0; offset < blob.size; offset += CHUNK_BYTES) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
        await exchange(task, { type: 'chunk', id: task.id, sequence, data: base64(bytes) }, 'ack', CHUNK_TIMEOUT, sequence);
        sequence++;
      }
      await exchange(task, { type: 'end', id: task.id }, 'complete', CHUNK_TIMEOUT);
      if (!task.silent) notice('文件已保存。');
      return true;
    } catch (error) {
      if (task.begun) { try { post({ type: 'cancel', id: task.id }); } catch {} }
      if (!task.silent) notice(task.cancelMessage || (error && error.name === 'AbortError' ? '已取消保存。' : error.message || '保存失败，请重试。'));
      return false;
    } finally {
      if (task.pending) task.pending.finish(nativeError('保存已结束。'));
      if (active === task) active = null;
    }
  }

  function downloadUrl(value, name, mime) {
    const url = approvedUrl(value);
    if (!url) { notice('此文件地址不能在应用内保存。'); return Promise.resolve(false); }
    if (active) {
      if (active.url === url) return active.promise;
      notice('请先完成当前文件的保存。');
      return Promise.resolve(false);
    }
    const task = {
      id: window.crypto && typeof window.crypto.randomUUID === 'function' ? window.crypto.randomUUID() : 'download-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      url, name: filename(name), controller: new AbortController(), begun: false, pending: null, promise: null, silent: false,
    };
    active = task;
    task.promise = transfer(task, mime);
    return task.promise;
  }

  function intercept(anchor) {
    if (!anchor || !anchor.hasAttribute('download') || !approvedUrl(anchor.href)) return false;
    void downloadUrl(anchor.href, anchor.download);
    return true;
  }

  HTMLAnchorElement.prototype.click = function nativeDownloadClick() {
    if (!intercept(this)) return originalClick.apply(this, arguments);
  };
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const target = event.target && event.target.closest ? event.target.closest('a[download]') : null;
    if (intercept(target)) event.preventDefault();
  }, true);

  window.addEventListener('message', event => {
    if (event.data !== 'yuzhou-download-port-v1' || !event.ports || event.ports.length !== 1) return;
    if (event.source && event.source !== window) return;
    // Android's native postWebMessage source can be null with an empty origin.
    // The native sender restricts delivery to TRUSTED_ORIGIN and the main frame.
    if (event.origin && event.origin !== 'null' && event.origin !== TRUSTED_ORIGIN) return;
    const incoming = event.ports[0];
    if (port) { if (incoming !== port) incoming.close(); return; }
    port = incoming;
    port.onmessage = event => {
      let message;
      try {
        if (typeof event.data !== 'string' || event.data.length > 8192) return;
        message = JSON.parse(event.data);
      } catch { return; }
      const task = active;
      if (!message || !task || message.id !== task.id || !task.pending) return;
      if (message.type === 'error') { task.pending.finish(nativeError(message.message)); return; }
      if (message.type !== task.pending.type) return;
      if (message.type === 'ack' && message.sequence !== task.pending.sequence) {
        task.pending.finish(nativeError('文件传输顺序异常，请重新导出。'));
        return;
      }
      task.pending.finish(null, message);
    };
    port.onmessageerror = () => { cancel('保存连接异常，请刷新后重试。'); try { port.close(); } catch {} port = null; };
    if (typeof port.start === 'function') port.start();
    for (const ready of Array.from(portWaiters)) ready();
  });

  window.addEventListener('pagehide', () => {
    cancel('页面已离开，保存已取消。', true);
    if (port) { try { port.close(); } catch {} port = null; }
  });
  const api = Object.freeze({ downloadUrl, cancel: () => cancel(), get ready() { return !!port; }, maxBytes: MAX_BYTES });
  Object.defineProperty(window, '__yuzhouDownloads', { value: api, configurable: false });
  Object.defineProperty(window, 'YuzhouDownloads', { value: api, configurable: false });
})();
