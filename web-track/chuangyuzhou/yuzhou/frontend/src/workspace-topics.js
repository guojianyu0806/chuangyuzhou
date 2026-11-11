import {icon} from './icons.js';
import {escapeHTML as esc} from './services.js';
import {isWorkspaceTopicCandidateId, normalizeTopicName, TOPIC_CARD_LIMIT, TOPIC_NAME_LIMIT} from './workspace-topics-model.js';
import {canvasCardFill, homeCanvasCardAppearance} from './canvas.js';
import {getCustomBlocks} from './custom-blocks-model.js';
import {getSpaceIconMap} from './space-icons.js';

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
  const shared = viewSession(session, loadDraft);
  const view = shared.view;
  const connected = typeof request === 'function' && typeof mutate === 'function';
  const emit = () => shared.listeners.forEach(listener => listener());
  let active = true;
  let pollTimer;
  let scrollTimer;
  let attemptedRecovery = null;
  let scrollRestored = false;
  const restoreTop = view.scrollTop;
  const rendered = new WeakMap();

  root.innerHTML = [
    '<div class="wt-page">',
    '  <header class="wt-header">',
    '    <div><p class="wt-eyebrow">工作台 · 主题视图</p><h1>按主题查看</h1>',
    '    <p>把相关卡片放在同一个主题里，随时打开原卡片。</p></div>',
    '    <button type="button" class="btn" data-topics-action="canvas">'+icon('arrow-left', 16)+'返回画布</button>',
    '  </header>',
    '  <section class="wt-toolbar" aria-label="查找与归类">',
    '    <label class="wt-search"><span class="sr-only">搜索卡片或主题</span>'+icon('search', 17),
    '      <input type="search" placeholder="搜索卡片或主题" maxlength="100" data-topics-search></label>',
    '    <div class="wt-tools"><span data-topics-count></span>',
    '      <button type="button" class="btn primary" data-topics-action="suggest">'+icon('sparkles', 17)+'AI 归类</button></div>',
    '    <p class="wt-hint" data-topics-hint></p>',
    '  </section>',
    '  <p class="wt-status" data-topics-status role="status" aria-live="polite" hidden></p>',
    '  <div data-topics-review></div>',
    '  <div data-topics-receipt></div>',
    '  <section class="wt-groups" aria-label="主题分组" data-topics-groups></section>',
    '</div>'
  ].join('\n');

  const page = root.querySelector('.wt-page');
  const $ = selector => page.querySelector(selector);
  const search = $('[data-topics-search]');
  const status = $('[data-topics-status]');
  const reviewHost = $('[data-topics-review]');
  const groupsHost = $('[data-topics-groups]');
  const receiptHost = $('[data-topics-receipt]');
  search.value = view.query;

  function paint(host, markup) {
    if (rendered.get(host) === markup) return;
    rendered.set(host, markup);
    host.innerHTML = markup;
  }

  const currentCards = () => get(cards) || [];
  const currentTopics = () => get(state)?.workspaceTopics || {};
  const selectedCards = () => {
    const allowed = new Set(currentCards().map(card => card.id));
    return view.selected.filter(id => allowed.has(id));
  };
  const busy = () => shared.generation || shared.writing;
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

  function drawGroups() {
    const topics = groupedCards(currentCards(), currentTopics().assignments || [], view.query);
    const selected = new Set(view.selected);
    const closed = new Set(view.closed);
    const locked = !connected || Boolean(view.review || view.operation) || busy();
    const workspace = get(state);
    const layouts = new Map((workspace?.canvas?.cards || []).map(card => [card.id, card]));
    const records = new Map([...(workspace?.spaces || []), ...getCustomBlocks(workspace).items].map(card => [card.id, card]));
    const spaceIcons = getSpaceIconMap(workspace);
    paint(groupsHost, topics.map(([topic, entries]) => {
      const key = topicKey(topic);
      return '<details class="wt-group" data-topics-group="'+esc(key)+'"'+(closed.has(key) ? '' : ' open')+'>'+
        '<summary><span class="wt-group-dot" aria-hidden="true"></span><strong>'+esc(topic || '未归类')+
        '</strong><span class="wt-count">'+entries.length+' 张</span></summary>'+
        '<ul class="wt-cards">'+entries.map(card => {
          const appearance = homeCanvasCardAppearance(layouts.get(card.id) || card, records.get(card.id), spaceIcons.get(card.id));
          return '<li class="wt-card" style="--wt-card-color:'+appearance.color+';--wt-card-fill:'+canvasCardFill(appearance.color)+'">'+
            '<button type="button" class="wt-card-link" data-topics-open="'+esc(card.id)+'">'+
            '<span class="wt-card-mark" aria-hidden="true">'+icon(appearance.icon, 18)+'</span>'+
            '<span class="wt-card-label"><small>'+esc(kinds[card.kind] || '')+'</small><strong>'+esc(card.title)+'</strong></span>'+
            '</button>'+
            '<label class="wt-select"><input type="checkbox" data-topics-select="'+esc(card.id)+'" aria-label="选择'+esc(card.title)+'"'+
            (selected.has(card.id) ? ' checked' : '')+(locked ? ' disabled' : '')+'></label></li>';
        }).join('')+'</ul></details>';
    }).join('') || '<p class="wt-empty">'+(view.query.trim() ? '没有符合搜索条件的卡片。' : '工作台还没有可查看的卡片。')+'</p>');
  }

  function drawActions() {
    const count = selectedCards().length;
    $('[data-topics-count]').textContent = '已选 '+count+' 张';
    $('[data-topics-action="suggest"]').disabled = !connected || !count || Boolean(view.review || view.operation) || busy();
    $('[data-topics-hint]').textContent = connected
      ? '勾选要整理的卡片。AI 会查看选中卡片的名称、类型和简介。'
      : '连接个人工作台后可使用 AI 归类。';
    const confirm = $('[data-topics-action="confirm"]');
    if (confirm) {
      const changes = chosenChanges();
      confirm.disabled = !changes.length || busy() || Boolean(view.operation || view.review?.stale);
    }
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
    if (view.operation) {
      paint(receiptHost, '<div class="wt-receipt"><span>'+
        (shared.writing ? '正在核对保存结果…' : '保存结果待核对。')+'</span>'+
        '<button type="button" class="btn" data-topics-action="retry"'+(shared.writing || !connected ? ' disabled' : '')+
        '>查询并重试</button></div>');
      return;
    }
    const receipts = (currentTopics().receipts || []).filter(receipt => receipt.changes.some(isCandidate));
    const receipt = receipts.find(item => item.batchId === view.lastBatchId) || receipts.at(-1);
    if (!receipt) {
      paint(receiptHost, '');
      return;
    }
    const undone = receipt.status === 'undone';
    const count = receipt.changes.filter(isCandidate).length;
    const skipped = receipt.skipped?.filter(isWorkspaceTopicCandidateId).length || 0;
    const text = undone ? '已恢复 '+(count - skipped)+' 张卡片的原分组'+(skipped ? '，保留了 '+skipped+' 张卡片后续调整' : '')+'。'
      : '本批已归类 '+count+' 张卡片。';
    paint(receiptHost, '<div class="wt-receipt"><span>'+text+'</span>'+
      (undone ? '' : '<button type="button" class="btn" data-topics-action="undo" data-batch="'+esc(receipt.batchId)+
        '"'+(!connected || busy() || view.review ? ' disabled' : '')+'>撤销此批归类</button>')+'</div>');
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

  async function runOperation(mode) {
    const operation = view.operation;
    if (!connected || !operation || busy()) return;
    const {kind, batchId} = operation;
    const endpoint = kind === 'confirm' ? '/confirm' : '/undo';
    const expected = kind === 'confirm' ? 'confirmed' : 'undone';
    const lookup = () => request(API+'/receipt?batchId='+encodeURIComponent(batchId));
    const matches = receipt => receipt?.batchId === batchId &&
      (receipt.status === expected || (kind === 'confirm' && receipt.status === 'undone'));
    const matchesReview = receipt => kind !== 'confirm' || (receipt.changes.length === operation.changes.length &&
      receipt.changes.every(change => operation.changes.some(row => row.id === change.id && row.topic === change.topic)));
    shared.writing = true;
    shared.notice = '';
    emit();
    try {
      if (!await persist()) return;
      const known = mode === 'new' ? null : (await lookup()).receipt;
      if (mode === 'check' && !matches(known)) return;
      if (matches(known) && !matchesReview(known)) {
        const conflict = new Error('本批已按其他审核内容保存，请查看当前分组后重新生成建议。');
        conflict.code = 'TOPIC_BATCH_CONFLICT';
        throw conflict;
      }
      let result, applied;
      if (matches(known)) {
        // A receipt is durable even if a newer edit prevents adopting the remote snapshot.
        try { ({result, applied} = await mutate(async () => ({receipt: known}))); }
        catch { result = {receipt: known}; applied = false; }
      } else {
        ({result, applied} = await mutate(() => request(API+endpoint, {method: 'POST', body: kind === 'confirm'
          ? {draftId: batchId, changes: operation.changes} : {batchId}})));
      }
      if (!matches(result.receipt)) throw new Error('尚未取得保存回执。');
      view.lastBatchId = batchId;
      view.operation = null;
      if (kind === 'confirm') {
        view.review = null;
        view.selected = [];
      }
      shared.notice = applied === false ? '云端已保存。请处理当前页面的同步提示，再查看最新分组。'
        : kind === 'confirm' ? '主题归类已保存。' : '已核对并保存撤销结果。';
      await persist();
    } catch (error) {
      if (['TOPIC_DRAFT_STALE', 'TOPIC_DRAFT_MISSING', 'TOPIC_DRAFT_NOT_READY', 'TOPIC_BATCH_CONFLICT'].includes(error.code)) {
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

  function captureScroll() {
    view.scrollTop = scrollTarget === window ? window.scrollY : scrollTarget.scrollTop;
  }

  function saveScroll() {
    captureScroll();
    void persist();
  }

  function click(event) {
    const control = event.target.closest('button');
    if (!control || control.disabled) return;
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
        if (!busy() && !view.operation && !view.review) {
          view.operation = {kind: 'undo', batchId: control.dataset.batch};
          void runOperation('new');
        }
        break;
      case 'retry': void runOperation('retry'); break;
    }
  }

  function input(event) {
    const target = event.target;
    if (target === search) {
      view.query = search.value;
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
    void persist();
  }

  const onScroll = () => {
    if (!scrollRestored) return;
    captureScroll();
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
  scrollTarget.addEventListener('scroll', onScroll, {passive: true});
  shared.listeners.add(draw);
  draw();
  const restoreFrame = requestAnimationFrame(() => {
    if (!active) return;
    if (scrollTarget === window) window.scrollTo({top: restoreTop, behavior: 'instant'});
    else scrollTarget.scrollTop = restoreTop;
    scrollRestored = true;
    recover();
  });

  return () => {
    active = false;
    cancelAnimationFrame(restoreFrame);
    clearTimeout(pollTimer);
    clearTimeout(scrollTimer);
    shared.listeners.delete(draw);
    page.removeEventListener('click', click);
    page.removeEventListener('input', input);
    page.removeEventListener('change', change);
    page.removeEventListener('toggle', toggle, true);
    scrollTarget.removeEventListener('scroll', onScroll);
    void persist();
  };
}
