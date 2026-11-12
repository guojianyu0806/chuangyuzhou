import {icon} from './icons.js';
import {escapeHTML as esc} from './services.js';
import {isWorkspaceTopicCandidateId, normalizeTopicName, TOPIC_CARD_LIMIT, TOPIC_NAME_LIMIT} from './workspace-topics-model.js';
import {canvasCardFill, homeCanvasCardAppearance} from './canvas.js';
import {getCustomBlocks} from './custom-blocks-model.js';
import {getSpaceIconMap} from './space-icons.js';
import {mountWorkspaceTopicDrag} from './workspace-topic-drag.js';

const API = '/api/workspace/topics';
const sessions = new WeakMap();
const kinds = {module: '模块', space: '空间', block: '方块'};
const topicKey = topic => JSON.stringify(topic);
const get = value => typeof value === 'function' ? value() : value;
const isCandidate = ({id}) => isWorkspaceTopicCandidateId(id);

function viewSession(key, loadDraft) {
  if (!sessions.has(key)) {
    let saved;
    try { saved = loadDraft?.(); } catch { /* Keep the view usable when local storage is unavailable. */ }
    const restored = saved?.version === 1 ? saved : null;
    sessions.set(key, {
      view: {
        version: 1,
        selected: restored?.selected || [],
        closed: restored?.closed || [],
        query: restored?.query || '',
        scrollTop: restored?.scrollTop || 0,
        review: restored?.review || null,
        operation: restored?.operation || null,
        lastBatchId: restored?.lastBatchId || null
      },
      listeners: new Set(),
      generation: false,
      writing: false,
      notice: '',
      storageError: '',
      saveVersion: 0
    });
  }
  return sessions.get(key);
}

function topicOperationSession({session, state, cards, loadDraft, saveDraft, request, mutate}) {
  const shared = viewSession(session, loadDraft);
  const view = shared.view;
  const connected = typeof request === 'function' && typeof mutate === 'function';
  const currentCards = () => get(cards) || [];
  const currentTopics = () => get(state)?.workspaceTopics || {};
  const busy = () => shared.generation || shared.writing;
  const moveLocked = () => !connected || Boolean(view.operation || view.review) || busy();
  const emit = () => shared.listeners.forEach(listener => listener());

  function lastReceipt() {
    const receipts = (currentTopics().receipts || []).filter(receipt => receipt.changes.some(isCandidate));
    return receipts.find(item => item.batchId === view.lastBatchId) || receipts.at(-1);
  }

  function move(cardId, topic, expected) {
    if (moveLocked() || topic === (expected?.topic ?? null) || !currentCards().some(card => card.id === cardId)) return;
    view.operation = {kind: 'move', batchId: crypto.randomUUID(), cardId, topic, expected};
    return runOperation('new');
  }

  function undo(batchId) {
    if (moveLocked() || !batchId) return;
    view.operation = {kind: 'undo', batchId};
    return runOperation('new');
  }

  async function persist() {
    if (!saveDraft) return true;
    const version = ++shared.saveVersion;
    try {
      await saveDraft(structuredClone(view));
      if (version === shared.saveVersion && shared.storageError) {
        shared.storageError = '';
        emit();
      }
      return true;
    } catch {
      if (version === shared.saveVersion) {
        shared.storageError = '本机草稿尚未保存，请保留此页面并重试。';
        emit();
      }
      return false;
    }
  }

  async function runOperation(mode) {
    const operation = view.operation;
    if (!connected || !operation || busy()) return;
    const {kind, batchId} = operation;
    const endpoint = '/'+kind;
    const expectedStatus = kind === 'undo' ? 'undone' : 'confirmed';
    const body = kind === 'confirm' ? {draftId: batchId, changes: operation.changes}
      : kind === 'move' ? {batchId, cardId: operation.cardId, topic: operation.topic, expected: operation.expected}
      : {batchId};
    const lookup = () => request(API+'/receipt?batchId='+encodeURIComponent(batchId));
    const matches = receipt => receipt?.batchId === batchId &&
      (receipt.status === expectedStatus || (kind !== 'undo' && receipt.status === 'undone'));
    const matchesOperation = receipt => {
      if (kind === 'undo') return true;
      if (kind === 'confirm') {
        return receipt.kind !== 'move' && receipt.changes.length === operation.changes.length &&
          receipt.changes.every(change => operation.changes.some(row => row.id === change.id && row.topic === change.topic));
      }
      const change = receipt.changes[0];
      return receipt.kind === 'move' && receipt.changes.length === 1 && change.id === operation.cardId && change.topic === operation.topic &&
        change.previous?.topic === operation.expected?.topic && change.previous?.batchId === operation.expected?.batchId;
    };
    shared.writing = true;
    shared.notice = '';
    emit();
    try {
      if (!await persist()) return;
      const known = mode === 'new' ? null : (await lookup()).receipt;
      if (mode === 'check' && !matches(known)) return;
      if (matches(known) && !matchesOperation(known)) {
        const conflict = new Error('该操作已保存其他内容，请查看当前分组后重试。');
        conflict.code = 'TOPIC_BATCH_CONFLICT';
        throw conflict;
      }
      let result, applied;
      if (matches(known)) {
        // A receipt is durable even if a newer edit prevents adopting the remote snapshot.
        try { ({result, applied} = await mutate(async () => ({receipt: known}))); }
        catch { result = {receipt: known}; applied = false; }
      } else {
        ({result, applied} = await mutate(() => request(API+endpoint, {method: 'POST', body})));
      }
      if (!matches(result.receipt)) throw new Error('尚未取得保存回执。');
      view.lastBatchId = batchId;
      view.operation = null;
      if (kind === 'confirm') {
        view.review = null;
        view.selected = [];
      }
      if (kind === 'move' && result.receipt.status === 'confirmed') {
        view.closed = view.closed.filter(key => key !== topicKey(operation.topic));
      }
      const skipped = result.receipt.skipped?.filter(isWorkspaceTopicCandidateId).length ?? 0;
      shared.notice = applied === false ? '云端已保存。请处理当前页面的同步提示，再查看最新分组。'
        : kind === 'confirm' ? '主题归类已保存。'
        : kind === 'undo' ? (skipped ? '已撤销可恢复的分组，保留了 '+skipped+' 张卡片的后续调整。' : '已撤销上次归类调整。')
        : result.receipt.status === 'undone' ? '这次移动已撤销。' : '已移至「'+(operation.topic ?? '未归类')+'」。';
      await persist();
      return {receipt: result.receipt, applied};
    } catch (error) {
      if (kind === 'move' && ['TOPIC_MOVE_STALE', 'TOPIC_BATCH_CONFLICT'].includes(error.code)) {
        view.operation = null;
        try { await mutate(async () => null); } catch { /* Cloud sync reports whether the current state could be refreshed. */ }
        shared.notice = error.message || '卡片分组已有变化，请查看最新结果后再移动。';
      } else if (['TOPIC_DRAFT_STALE', 'TOPIC_DRAFT_MISSING', 'TOPIC_DRAFT_NOT_READY', 'TOPIC_BATCH_CONFLICT'].includes(error.code)) {
        view.operation = null;
        if (view.review) {
          view.review.stale = true;
          view.review.error = error.message || '卡片或主题已有变化，请重新审核。';
        }
        shared.notice = '';
      } else if (['TOPIC_NO_CHANGES', 'TOPIC_INVALID_INPUT', 'TOPIC_BATCH_MISSING', 'TOPIC_HISTORY_LIMIT'].includes(error.code)) {
        view.operation = null;
        shared.notice = error.message;
      } else {
        shared.notice = error.status ? error.message : '连接暂时中断。草稿已保留，可查询并重试。';
      }
      await persist();
    } finally {
      shared.writing = false;
      emit();
    }
  }

  return {shared, view, connected, currentCards, currentTopics, busy, moveLocked, emit, lastReceipt, move, undo, persist, runOperation};
}

export function createWorkspaceTopicActions(options) {
  const actions = topicOperationSession(options);
  const {shared, view, busy, moveLocked, lastReceipt, runOperation} = actions;
  const pending = () => view.operation?.kind === 'move' || view.operation?.kind === 'undo';
  let attemptedRecovery;
  function undoableMove() {
    const receipt = lastReceipt();
    return receipt?.status === 'confirmed' && receipt.kind === 'move' ? receipt : null;
  }
  function snapshot() {
    return {
      blocked: moveLocked(),
      busy: busy(),
      pending: pending(),
      canUndo: !moveLocked() && Boolean(undoableMove()),
      notice: [shared.storageError, shared.notice].filter(Boolean).join(' ')
    };
  }
  return {
    snapshot,
    subscribe(listener) {
      const notify = () => listener(snapshot());
      shared.listeners.add(notify);
      return () => shared.listeners.delete(notify);
    },
    move: actions.move,
    retry: () => pending() && runOperation('retry'),
    undo: () => actions.undo(undoableMove()?.batchId),
    recover() {
      if (pending() && !busy() && attemptedRecovery !== view.operation) {
        attemptedRecovery = view.operation;
        return runOperation('check');
      }
    }
  };
}

function groupedCards(cards, assignments, query) {
  const topics = new Map(assignments.map(({id, topic}) => [id, topic]));
  const groups = new Map();
  const search = query.trim().toLocaleLowerCase();
  for (const card of cards) {
    const topic = topics.get(card.id) || null;
    if (search && ![card.title, topic || '未归类', card.description, kinds[card.kind]]
      .some(value => String(value || '').toLocaleLowerCase().includes(search))) continue;
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(card);
  }
  return [...groups].sort(([a], [b]) => a === null ? 1 : b === null ? -1 : a.localeCompare(b, 'zh-CN'));
}

export function mountWorkspaceTopics({
  root, state, cards, openCard, showCanvas, loadDraft, saveDraft, request, mutate, sync,
  session = root, scrollTarget = window
}) {
  const operations = topicOperationSession({session, state, cards, loadDraft, saveDraft, request, mutate});
  const {shared, view, connected, currentCards, currentTopics, busy, moveLocked, emit, lastReceipt, persist, runOperation} = operations;
  let active = true;
  let pollTimer;
  let scrollTimer;
  let indexFrame;
  let indexJump;
  let moveDraft;
  let attemptedRecovery = null;
  let scrollRestored = false;
  const restoreTop = view.scrollTop;
  const rendered = new WeakMap();

  root.innerHTML = [
    '<div class="wt-page" data-topics-view>',
    '  <header class="wt-header">',
    '    <h1>按主题查看</h1>',
    '    <button type="button" class="btn" data-topics-action="canvas">'+icon('arrow-left', 16)+'返回画布</button>',
    '  </header>',
    '  <section class="wt-toolbar" aria-label="查找与归类">',
    '    <label class="wt-search"><span class="sr-only">搜索卡片或主题</span>'+icon('search', 17),
    '      <input type="search" placeholder="搜索卡片或主题" maxlength="100" data-topics-search></label>',
    '    <div class="wt-tools"><span data-topics-count></span>',
    '      <button type="button" class="btn primary" data-topics-action="suggest" title="AI 会读取所选卡片的名称、类型和简介">'+icon('sparkles', 17)+'AI 归类</button>',
    '      <button type="button" class="btn wt-undo" data-topics-action="undo" aria-label="撤销此批归类" title="撤销上次归类调整" hidden>'+icon('arrow-left', 16)+'<span>撤销</span></button></div>',
    '    <p class="wt-hint" data-topics-hint></p>',
    '  </section>',
    '  <p class="wt-status" data-topics-status role="status" aria-live="polite" hidden></p>',
    '  <div data-topics-review></div>',
    '  <div data-topics-recovery></div>',
    '  <div class="wt-content">',
    '    <section class="wt-groups" aria-label="主题分组" data-topics-groups></section>',
    '    <nav class="wt-index" aria-label="主题目录" hidden><span class="wt-index-heading">主题</span>',
    '      <div class="wt-index-track" aria-hidden="true"></div><div class="wt-index-list"></div></nav>',
    '  </div>',
    '  <dialog class="wt-move" data-topics-move-dialog aria-labelledby="wt-move-title">',
    '    <form data-topics-move-form>',
    '      <h2 id="wt-move-title">移动卡片</h2><p data-topics-move-card></p>',
    '      <label>目标主题<select data-topics-move-target required></select></label>',
    '      <label data-topics-new-label hidden>新主题名称<input data-topics-new-topic maxlength="'+TOPIC_NAME_LIMIT+'" autocomplete="off" disabled></label>',
    '      <p data-topics-move-error role="alert" hidden></p>',
    '      <div class="wt-move-actions"><button type="button" class="btn" data-topics-action="cancel-move">取消</button>',
    '        <button type="submit" class="btn primary" data-topics-move-submit>移动</button></div>',
    '    </form>',
    '  </dialog>',
    '</div>'
  ].join('\n');

  const page = root.querySelector('.wt-page');
  const $ = selector => page.querySelector(selector);
  const search = $('[data-topics-search]');
  const status = $('[data-topics-status]');
  const reviewHost = $('[data-topics-review]');
  const groupsHost = $('[data-topics-groups]');
  const recoveryHost = $('[data-topics-recovery]');
  const index = $('.wt-index');
  const indexList = $('.wt-index-list');
  const moveDialog = $('[data-topics-move-dialog]');
  const moveForm = $('[data-topics-move-form]');
  const moveTarget = $('[data-topics-move-target]');
  const newTopic = $('[data-topics-new-topic]');
  const moveError = $('[data-topics-move-error]');
  search.value = view.query;

  function paint(host, markup) {
    if (rendered.get(host) === markup) return;
    rendered.set(host, markup);
    host.innerHTML = markup;
  }

  const selectedCards = () => {
    const allowed = new Set(currentCards().map(card => card.id));
    return view.selected.filter(id => allowed.has(id));
  };
  const canMove = id => !moveLocked() && !moveDialog.open && currentCards().some(card => card.id === id);
  const assignmentFor = id => {
    const row = currentTopics().assignments?.find(item => item.id === id);
    return row ? {topic: row.topic, batchId: row.batchId} : null;
  };
  const reviewCards = () => (view.review?.cards || []).filter(isCandidate);
  function chosenChanges() {
    try {
      return reviewCards().filter(card => !card.skip)
        .map(card => ({id: card.id, topic: normalizeTopicName(card.topic), currentTopic: card.currentTopic}))
        .filter(card => card.topic !== card.currentTopic)
        .map(({id, topic}) => ({id, topic}));
    } catch {
      return [];
    }
  }

  function drawStatus() {
    const message = [shared.storageError, shared.notice].filter(Boolean).join(' ');
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('wt-status-error', Boolean(shared.storageError || view.review?.stale));
  }

  function drawGroups() {
    const topics = groupedCards(currentCards(), currentTopics().assignments || [], view.query);
    const selected = new Set(view.selected);
    const closed = new Set(view.closed);
    const locked = moveLocked();
    if (connected && topics.length && !view.query.trim() && !topics.some(([topic]) => topic === null)) {
      topics.push([null, []]);
    }
    const workspace = get(state);
    const layouts = new Map((workspace?.canvas?.cards || []).map(card => [card.id, card]));
    const records = new Map([...(workspace?.spaces || []), ...getCustomBlocks(workspace).items].map(card => [card.id, card]));
    const spaceIcons = getSpaceIconMap(workspace);
    paint(groupsHost, topics.map(([topic, entries]) => {
      const key = topicKey(topic);
      return '<details class="wt-group" data-topics-group="'+esc(key)+'" data-topics-drop="'+esc(key)+'"'+(closed.has(key) ? '' : ' open')+'>'+
        '<summary><span class="wt-group-dot" aria-hidden="true"></span><strong>'+esc(topic || '未归类')+
        '</strong><span class="wt-count">'+entries.length+' 张</span></summary>'+
        (entries.length ? '<ul class="wt-cards">'+entries.map(card => {
          const appearance = homeCanvasCardAppearance(layouts.get(card.id) || card, records.get(card.id), spaceIcons.get(card.id));
          return '<li class="wt-card" style="--wt-card-color:'+appearance.color+';--wt-card-fill:'+canvasCardFill(appearance.color)+'">'+
            '<button type="button" class="wt-card-link" data-topics-open="'+esc(card.id)+'">'+
            '<span class="wt-card-mark" aria-hidden="true">'+icon(appearance.icon, 18)+'</span>'+
            '<span class="wt-card-label"><small>'+esc(kinds[card.kind] || '')+'</small><strong>'+esc(card.title)+'</strong></span>'+
            '</button>'+
            '<button type="button" class="wt-card-move" data-topics-move="'+esc(card.id)+'" aria-label="移动'+esc(card.title)+'到其他主题" title="移动到其他主题"'+
            (locked ? ' disabled' : '')+'>'+icon('more', 17)+'</button>'+
            '<label class="wt-select"><input type="checkbox" data-topics-select="'+esc(card.id)+'" aria-label="选择'+esc(card.title)+'"'+
            (selected.has(card.id) ? ' checked' : '')+(locked ? ' disabled' : '')+'></label></li>';
        }).join('')+'</ul>' : '<p class="wt-group-empty">拖到这里可移出主题</p>')+'</details>';
    }).join('') || '<p class="wt-empty">'+(view.query.trim() ? '没有符合搜索条件的卡片。' : '工作台还没有可查看的卡片。')+'</p>');
    index.hidden = !topics.length;
    paint(indexList, topics.map(([topic]) => {
      const key = esc(topicKey(topic));
      const name = esc(topic ?? '未归类');
      return '<button type="button" class="wt-index-link" data-topics-jump="'+key+'" data-topics-drop="'+key+'" title="'+name+'">'+name+'</button>';
    }).join(''));
    scheduleIndex();
  }

  function drawActions() {
    const count = selectedCards().length;
    $('[data-topics-count]').textContent = '已选 '+count+' 张';
    $('[data-topics-action="suggest"]').disabled = !connected || !count || Boolean(view.review || view.operation) || busy();
    $('[data-topics-hint]').textContent = connected
      ? '勾选卡片交给 AI 归类，长按可拖到其他主题。'
      : '连接个人工作台后可使用 AI 归类。';
    const confirm = $('[data-topics-action="confirm"]');
    if (confirm) {
      const changes = chosenChanges();
      confirm.disabled = !changes.length || busy() || Boolean(view.operation || view.review?.stale);
    }
  }

  function scheduleIndex() {
    if (indexFrame !== undefined) return;
    indexFrame = requestAnimationFrame(() => {
      indexFrame = undefined;
      const groups = Array.from(groupsHost.querySelectorAll('[data-topics-group]'));
      if (!groups.length) return;
      const bounds = scrollTarget === window
        ? {top: 0, bottom: window.innerHeight}
        : scrollTarget.getBoundingClientRect();
      const start = groups[0].getBoundingClientRect().top;
      const end = groups.at(-1).getBoundingClientRect().bottom;
      const indexStyle = getComputedStyle(index);
      const stickyTop = parseFloat(indexStyle.top) || 0;
      const offset = bounds.top + stickyTop + (indexStyle.gridRowStart === '1' ? index.offsetHeight : 0) + 10;
      const scrollDistance = Math.max(1, end - start - (bounds.bottom - offset));
      const progress = Math.max(0, Math.min(1, (offset - start) / scrollDistance));
      index.style.setProperty('--wt-progress', String(progress));
      const current = groups.find(group => group.dataset.topicsGroup === indexJump?.key)
        ?? (progress === 1 ? groups.at(-1) : groups.findLast(group => group.getBoundingClientRect().top <= offset)) ?? groups[0];
      for (const button of indexList.querySelectorAll('[data-topics-jump]')) {
        if (button.dataset.topicsJump === current.dataset.topicsGroup) {
          button.setAttribute('aria-current', 'location');
          if (!page.classList.contains('wt-dragging')) {
            const list = indexList.getBoundingClientRect();
            const link = button.getBoundingClientRect();
            const top = link.top < list.top ? link.top - list.top : Math.max(0, link.bottom - list.bottom);
            const left = link.left < list.left ? link.left - list.left : Math.max(0, link.right - list.right);
            if (top || left) indexList.scrollBy({top, left, behavior: 'instant'});
          }
        } else button.removeAttribute('aria-current');
      }
    });
  }

  function jumpToTopic(key) {
    const group = Array.from(groupsHost.querySelectorAll('[data-topics-group]')).find(item => item.dataset.topicsGroup === key);
    if (!group) return;
    group.open = true;
    group.scrollIntoView({block: 'start', behavior: 'instant'});
    group.querySelector('summary').focus({preventScroll: true});
    indexJump = {key, top: scrollPosition()};
    scheduleIndex();
  }

  function openMove(id) {
    if (!canMove(id)) return;
    const cards = currentCards();
    const expected = assignmentFor(id);
    const topics = groupedCards(cards, currentTopics().assignments || [], '').map(([topic]) => topic);
    if (!topics.includes(null)) topics.push(null);
    moveDraft = {id, expected, topics};
    $('[data-topics-move-card]').textContent = cards.find(card => card.id === id).title;
    moveTarget.replaceChildren(...topics.map((topic, position) => new Option(topic ?? '未归类', String(position))),
      new Option('＋ 新建主题', 'new'));
    moveTarget.value = String(topics.indexOf(expected?.topic ?? null));
    newTopic.value = '';
    updateMoveForm();
    moveDialog.showModal();
  }

  function updateMoveForm() {
    const creating = moveTarget.value === 'new';
    $('[data-topics-new-label]').hidden = !creating;
    newTopic.disabled = !creating;
    newTopic.required = creating;
    moveError.hidden = true;
    $('[data-topics-move-submit]').disabled = creating ? !newTopic.value.trim()
      : moveDraft.topics[Number(moveTarget.value)] === (moveDraft.expected?.topic ?? null);
  }

  function submitMove(event) {
    event.preventDefault();
    if (!moveDraft) return;
    const {id, expected, topics} = moveDraft;
    let topic = topics[Number(moveTarget.value)];
    if (moveTarget.value === 'new') {
      try { topic = normalizeTopicName(newTopic.value); }
      catch {
        moveError.textContent = '请输入有效的主题名称，最多 '+TOPIC_NAME_LIMIT+' 字。';
        moveError.hidden = false;
        newTopic.focus();
        return;
      }
      if (topic === '未归类' || topics.includes(topic)) {
        moveError.textContent = '这个主题已在列表中，请直接选择。';
        moveError.hidden = false;
        return;
      }
    }
    if (topic === undefined || topic === (expected?.topic ?? null)) return;
    moveDialog.close();
    startMove(id, topic, expected);
  }

  function startMove(cardId, topic, expected) {
    if (!canMove(cardId) || topic === (expected?.topic ?? null)) return;
    captureScroll();
    void operations.move(cardId, topic, expected);
  }

  function drawReview() {
    const review = view.review;
    if (!review) {
      paint(reviewHost, '');
      return;
    }
    const locked = busy() || Boolean(view.operation || review.stale);
    const reset = '<button type="button" class="btn" data-topics-action="discard"'+(shared.writing || view.operation ? ' disabled' : '')+'>放弃草稿</button>';
    if (review.status !== 'ready') {
      const generating = ['starting', 'pending'].includes(review.status);
      const retry = review.status === 'failed' ? 'regenerate' : 'resume-suggest';
      const hint = generating ? '正在生成建议。切换页面后可以回来继续查看。'
        : (review.error || '暂未取得建议。可以用同一任务继续查询。');
      paint(reviewHost, '<section class="wt-review" aria-label="AI 归类进度"><h2>AI 归类进度</h2>'+
        '<p>'+esc(hint)+'</p><div class="wt-review-actions">'+
        (generating ? '' : '<button type="button" class="btn primary" data-topics-action="'+retry+'">'+
          (retry === 'regenerate' ? '重新生成建议' : '重试获取建议')+'</button>')+reset+'</div></section>');
      return;
    }
    const cards = reviewCards();
    if (!cards.length) {
      paint(reviewHost, '<section class="wt-review" aria-label="AI 归类草稿">'+
        '<p>草稿中没有可归类的卡片。</p><div class="wt-review-actions">'+reset+'</div></section>');
      return;
    }
    const topicNames = [...new Set([...(currentTopics().assignments || []).filter(isCandidate).map(item => item.topic),
      ...cards.map(item => item.suggestedTopic)].filter(Boolean))];
    const visible = new Set(currentCards().map(card => card.id));
    paint(reviewHost, '<section class="wt-review" aria-labelledby="wt-review-title">'+
      '<h2 id="wt-review-title">审核归类建议</h2><p>'+esc(review.stale
        ? (review.error || '工作台已有变化。重新生成后，请核对保留的人工调整。')
        : '可以修改主题或跳过卡片，确认后生效。')+'</p>'+
      '<datalist id="wt-known-topics">'+topicNames.map(topic => '<option value="'+esc(topic)+'"></option>').join('')+'</datalist>'+
      '<ul class="wt-review-list">'+cards.map(card =>
        '<li class="wt-review-card"><div class="wt-review-copy"><strong>'+esc(card.title)+'</strong><small>'+
        esc(card.currentTopic ? '当前主题 · '+card.currentTopic : '当前未归类')+
        (visible.has(card.id) ? '' : ' · 当前不可见')+'</small>'+
        (card.reason ? '<p>'+esc(card.reason)+'</p>' : '')+'</div>'+
        '<label class="wt-topic-input"><span class="sr-only">'+esc(card.title)+'的主题</span>'+
        '<input type="text" maxlength="'+TOPIC_NAME_LIMIT+'" list="wt-known-topics" placeholder="待确认" value="'+esc(card.topic)+
        '" data-topics-topic="'+esc(card.id)+'"'+(locked ? ' disabled' : '')+'></label>'+
        '<label class="wt-skip"><input type="checkbox" data-topics-skip="'+esc(card.id)+'" aria-label="跳过'+esc(card.title)+'"'+
        (card.skip ? ' checked' : '')+(locked ? ' disabled' : '')+'>跳过</label></li>'
      ).join('')+'</ul><div class="wt-review-actions">'+
      (review.stale && !view.operation
        ? '<button type="button" class="btn primary" data-topics-action="regenerate">重新生成建议</button>'
        : '<button type="button" class="btn primary" data-topics-action="confirm">确认归类</button>')+
      reset+'</div></section>');
  }

  function drawReceipt() {
    const receipt = lastReceipt();
    const undo = $('[data-topics-action="undo"]');
    undo.hidden = receipt?.status !== 'confirmed';
    undo.disabled = moveLocked();
    undo.dataset.batch = receipt?.batchId ?? '';
    paint(recoveryHost, view.operation && !shared.writing
      ? '<div class="wt-recovery"><span>保存结果待核对。</span>'+
        '<button type="button" class="btn" data-topics-action="retry"'+(!connected ? ' disabled' : '')+
        '>查询并重试</button></div>' : '');
  }

  function draw() {
    if (!active) return;
    drawReview();
    drawGroups();
    drawReceipt();
    drawActions();
    drawStatus();
    schedulePoll();
  }

  async function submitSuggestion(method) {
    const review = view.review;
    if (!connected || !review || busy() || view.operation) return;
    const draftId = review.id;
    shared.generation = true;
    if (method === 'POST') review.status = 'starting';
    shared.notice = '';
    emit();
    try {
      if (method === 'POST') {
        if (!await persist()) return;
        await sync?.();
        if (view.review?.id !== draftId) return;
      }
      const result = method === 'POST'
        ? await request(API+'/suggest', {method, body: {draftId, cardIds: review.cardIds}})
        : await request(API+'/draft?draftId='+encodeURIComponent(draftId));
      if (view.review?.id !== draftId) return;
      if (result.status === 'ready' && result.draft?.id === draftId && Array.isArray(result.draft.cards)) {
        const overrides = new Map((review.overrides || []).map(card => [card.id, card]));
        view.review = {id: draftId, cardIds: review.cardIds, status: 'ready', cards: result.draft.cards.map(card => {
          const edited = overrides.get(card.id);
          return {...card, suggestedTopic: card.topic, topic: edited?.topic ?? (card.topic || ''),
            skip: edited?.skip ?? (card.topic === null), edited: Boolean(edited)};
        })};
      } else {
        review.status = result.status === 'pending' ? 'pending' : result.status === 'failed' ? 'failed' : 'interrupted';
        review.error = result.error?.message;
      }
      await persist();
    } catch (error) {
      if (view.review?.id === draftId) {
        review.status = error.status === 409 && error.code === 'TOPIC_DRAFT_STALE' ? 'failed' : 'interrupted';
        review.error = error.status ? error.message : '连接暂时中断，可继续查询同一任务。';
        await persist();
      }
    } finally {
      shared.generation = false;
      emit();
    }
  }

  function startSuggestion() {
    if (!connected || busy() || view.operation) return;
    const cardIds = selectedCards();
    if (!cardIds.length) {
      shared.notice = '请重新选择当前工作台中的卡片。';
      drawStatus();
      return;
    }
    const overrides = (view.review?.cards || view.review?.overrides || []).filter(card => card.edited)
      .map(({id, topic, skip}) => ({id, topic, skip, edited: true}));
    view.review = {id: crypto.randomUUID(), cardIds, status: 'starting', overrides};
    void submitSuggestion('POST');
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (connected && !busy() && ['starting', 'pending'].includes(view.review?.status)) {
      pollTimer = setTimeout(() => { if (active) void submitSuggestion('GET'); }, 1000);
    }
  }

  const scrollPosition = () => scrollTarget === window ? window.scrollY : scrollTarget.scrollTop;
  function captureScroll() { view.scrollTop = scrollPosition(); }

  function saveScroll() {
    captureScroll();
    void persist();
  }

  function click(event) {
    const control = event.target.closest('button');
    if (!control || control.disabled) return;
    if (control.hasAttribute('data-topics-jump')) {
      jumpToTopic(control.dataset.topicsJump);
      return;
    }
    if (control.hasAttribute('data-topics-move')) {
      openMove(control.dataset.topicsMove);
      return;
    }
    if (control.hasAttribute('data-topics-open')) {
      const id = control.dataset.topicsOpen;
      if (currentCards().some(card => card.id === id)) {
        saveScroll();
        openCard(id);
      } else {
        shared.notice = '这张卡片已不在当前工作台。';
        draw();
      }
      return;
    }
    switch (control.dataset.topicsAction) {
      case 'canvas': saveScroll(); showCanvas(); break;
      case 'suggest':
      case 'regenerate': startSuggestion(); break;
      case 'resume-suggest': void submitSuggestion('POST'); break;
      case 'discard':
        if (!view.operation && !shared.writing) {
          view.review = null;
          shared.notice = '已放弃本次建议。';
          void persist();
          emit();
        }
        break;
      case 'confirm': {
        const changes = chosenChanges();
        if (!view.review || view.review.stale || !changes.length || changes.some(item => !item.topic) || busy() || view.operation) return;
        view.operation = {kind: 'confirm', batchId: view.review.id, changes};
        void runOperation('new');
        break;
      }
      case 'undo':
        void operations.undo(control.dataset.batch); break;
      case 'retry': void runOperation('retry'); break;
      case 'cancel-move': moveDialog.close(); break;
    }
  }

  function input(event) {
    const target = event.target;
    if (target === newTopic && moveDraft) {
      updateMoveForm();
      return;
    }
    if (target === search) {
      view.query = search.value;
      indexJump = null;
      drawGroups();
      void persist();
      return;
    }
    const card = view.review?.cards?.find(item => item.id === target.dataset.topicsTopic);
    if (!card || busy() || view.operation || view.review.stale) return;
    card.topic = target.value;
    card.edited = true;
    if (card.topic.trim()) {
      card.skip = false;
      target.closest('li').querySelector('[data-topics-skip]').checked = false;
    }
    drawActions();
    void persist();
  }

  function change(event) {
    const target = event.target;
    if (target === moveTarget && moveDraft) {
      updateMoveForm();
      if (moveTarget.value === 'new') newTopic.focus();
      return;
    }
    if (target.hasAttribute('data-topics-select') && !view.review && !view.operation && !busy()) {
      const id = target.dataset.topicsSelect;
      if (!currentCards().some(card => card.id === id)) return;
      if (target.checked && !view.selected.includes(id)) {
        const selected = selectedCards();
        if (selected.length >= TOPIC_CARD_LIMIT) {
          target.checked = false;
          shared.notice = '每次最多选择 '+TOPIC_CARD_LIMIT+' 张卡片。';
          drawStatus();
          return;
        }
        view.selected = [...selected, id];
      } else view.selected = view.selected.filter(item => item !== id);
    } else if (target.hasAttribute('data-topics-skip') && !busy() && !view.operation && !view.review?.stale) {
      const card = view.review?.cards?.find(item => item.id === target.dataset.topicsSkip);
      if (card) {
        card.skip = target.checked;
        card.edited = true;
      }
    } else return;
    drawActions();
    void persist();
  }

  function toggle(event) {
    const group = event.target;
    if (!group.hasAttribute('data-topics-group') || !group.isConnected) return;
    const key = group.dataset.topicsGroup;
    const wasClosed = view.closed.includes(key);
    if (wasClosed === !group.open) return;
    view.closed = group.open ? view.closed.filter(item => item !== key) : [...view.closed, key];
    scheduleIndex();
    void persist();
  }

  const onScroll = () => {
    if (!scrollRestored) return;
    captureScroll();
    if (indexJump && view.scrollTop !== indexJump.top) indexJump = null;
    scheduleIndex();
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => void persist(), 150);
  };
  const recover = () => {
    if (connected && view.operation && attemptedRecovery !== view.operation) {
      attemptedRecovery = view.operation;
      void runOperation('check');
    }
  };

  page.addEventListener('click', click);
  page.addEventListener('input', input);
  page.addEventListener('change', change);
  page.addEventListener('toggle', toggle, true);
  moveForm.addEventListener('submit', submitMove);
  const stopDrag = mountWorkspaceTopicDrag({page, scrollTarget, canMove, onStart: assignmentFor, onDrop: startMove});
  const indexResize = new ResizeObserver(scheduleIndex);
  indexResize.observe(groupsHost);
  scrollTarget.addEventListener('scroll', onScroll, {passive: true});
  window.addEventListener('resize', scheduleIndex);
  shared.listeners.add(draw);
  draw();
  const restoreFrame = requestAnimationFrame(() => {
    if (!active) return;
    if (scrollTarget === window) window.scrollTo({top: restoreTop, behavior: 'instant'});
    else scrollTarget.scrollTop = restoreTop;
    scrollRestored = true;
    scheduleIndex();
    recover();
  });

  return () => {
    active = false;
    cancelAnimationFrame(restoreFrame);
    cancelAnimationFrame(indexFrame);
    clearTimeout(pollTimer);
    clearTimeout(scrollTimer);
    shared.listeners.delete(draw);
    page.removeEventListener('click', click);
    page.removeEventListener('input', input);
    page.removeEventListener('change', change);
    page.removeEventListener('toggle', toggle, true);
    moveForm.removeEventListener('submit', submitMove);
    if (moveDialog.open) moveDialog.close();
    stopDrag();
    indexResize.disconnect();
    scrollTarget.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', scheduleIndex);
    void persist();
  };
}
