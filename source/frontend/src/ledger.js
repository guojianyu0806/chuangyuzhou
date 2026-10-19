import { initializeLedger, parseAmount, formatMoney, localDate, isValidDate, selectEntries, summarizeEntries } from './ledger-model.js';
import { createColorDraft } from './creation-colors.js';

const views = new WeakMap();
const categories = {
  expense: ['餐饮', '交通', '学习', '购物', '活动', '住房', '其他支出'],
  income: ['生活费', '兼职', '报销', '奖学金', '其他收入']
};
const colors = ['#FFBD82', '#63E6DC', '#AE88FF', '#FF9CCE', '#D5F542', '#82BDFF'];
const stamp = () => new Date().toISOString();
const safeColor = value => /^#[\da-f]{6}$/i.test(value || '') ? value : colors[0];
function monthRange() {
  const date = new Date(), start = `${localDate(date).slice(0, 7)}-01`;
  return { start, end: localDate(new Date(date.getFullYear(), date.getMonth() + 1, 0, 12)) };
}
function initialView() { return { ...monthRange(), projectId: 'all', type: 'all', archived: false, query: '', group: 'date', limit: 80 }; }

export function mountLedger(ctx) {
  initializeLedger(ctx.state);
  const { root, state, esc, icon } = ctx;
  const viewOwner = ctx.cloud || state;
  if (!views.has(viewOwner)) views.set(viewOwner, new Map());
  const ownerViews = views.get(viewOwner);
  if (!ownerViews.has(state.mode)) ownerViews.set(state.mode, initialView());
  const view = ownerViews.get(state.mode);
  let mounted = true;
  if (view.projectId !== 'all' && view.projectId && !state.ledger.projects.some(p => p.id === view.projectId)) view.projectId = 'all';
  const money = cents => `¥${formatMoney(cents)}`;
  const projectTitle = id => state.ledger.projects.find(p => p.id === id)?.title || '未分项目';
  const projectColor = id => safeColor(state.ledger.projects.find(p => p.id === id)?.color);
  const periodLabel = () => !view.start && !view.end ? '全部日期' : view.start === view.end ? view.start : `${view.start || '最早'} → ${view.end || '至今'}`;
  const dateHeading = date => {
    const weekday = new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'short' });
    return `${date} · ${weekday}${date === localDate() ? ' · 今天' : ''}`;
  };
  const invalidRange = () => (view.start && !isValidDate(view.start)) || (view.end && !isValidDate(view.end)) || (view.start && view.end && view.start > view.end);
  const selected = () => invalidRange() ? [] : selectEntries(state.ledger, view).slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  function commit(change) {
    const previous = structuredClone(state.ledger), previousUpdatedAt = state.updatedAt, previousColor = state.ui?.lastCreatedColor;
    try { change(); ctx.save(); }
    catch (error) { state.ledger = previous; state.updatedAt = previousUpdatedAt;if(state.ui){if(previousColor===undefined)delete state.ui.lastCreatedColor;else state.ui.lastCreatedColor=previousColor;}throw error; }
  }
  function refreshed() { if (mounted) ctx.refresh(); }
  function run(action) { try { action(); } catch (error) { ctx.toast(error.message || '保存失败，请重试。'); } }
  function projectOptions(selectedId, includeAll = false) {
    return `${includeAll ? `<option value="all" ${selectedId === 'all' ? 'selected' : ''}>全部项目</option>` : ''}<option value="" ${selectedId === '' ? 'selected' : ''}>未分项目</option>${state.ledger.projects.filter(p => includeAll || !p.archived || p.id === selectedId).map(p => `<option value="${esc(p.id)}" ${selectedId === p.id ? 'selected' : ''}>${esc(p.title)}${p.archived ? '（已归档）' : ''}</option>`).join('')}`;
  }
  function openEntry(entry) {
    const type = entry?.type || 'expense';
    const defaultProject = state.ledger.projects.some(p => p.id === view.projectId && !p.archived) ? view.projectId : '';
    ctx.modal({ title: entry ? '编辑账目' : '记一笔', submitLabel: entry ? '保存修改' : '保存账目', body: `
      <div class="ledger-form">
        <div class="ledger-form-grid"><label class="field">收支类型<select name="type"><option value="expense" ${type === 'expense' ? 'selected' : ''}>支出</option><option value="income" ${type === 'income' ? 'selected' : ''}>收入</option></select></label>
        <label class="field">金额 · 人民币（元）<input name="amount" type="text" inputmode="decimal" autocomplete="off" maxlength="12" placeholder="0.00" value="${entry ? formatMoney(entry.amountCents).replaceAll(',', '') : ''}" required aria-describedby="ledger-amount-hint"><small id="ledger-amount-hint">大于 0，最多两位小数</small></label></div>
        <div class="ledger-form-grid"><label class="field">日期<input name="date" type="date" value="${esc(entry?.date || localDate())}" required min="1900-01-01" max="9999-12-31"></label>
        <label class="field">分类<input name="category" list="ledger-category-options" maxlength="80" value="${esc(entry?.category || categories[type][0])}" required placeholder="选择或输入分类"><datalist id="ledger-category-options">${categories[type].map(c => `<option value="${c}"></option>`).join('')}</datalist></label></div>
        <label class="field">项目<select name="projectId">${projectOptions(entry?.projectId ?? defaultProject)}</select><small>学习、学生会活动、个人计划，都可以各记各的。</small></label>
        <label class="field">备注<textarea name="note" maxlength="2000" rows="3" placeholder="记下用途、活动名称或其他细节">${esc(entry?.note || '')}</textarea></label>
        ${entry?.example ? '<p class="ledger-form-note">这是一条示例账目，保存在示例工作区。</p>' : ''}
      </div>`, onSubmit(data) {
      const values = { type: String(data.get('type')), amountCents: parseAmount(String(data.get('amount')).trim()), date: String(data.get('date')), category: String(data.get('category')).trim(), projectId: String(data.get('projectId')), note: String(data.get('note')).trim() };
      if (!['income', 'expense'].includes(values.type)) throw new Error('请选择收入或支出。');
      if (!isValidDate(values.date)) throw new Error('请选择有效的日期。');
      if (!values.category || values.category.length > 80) throw new Error('请填写分类，最多 80 个字。');
      if (values.note.length > 2000) throw new Error('备注最多 2000 个字。');
      if (values.projectId && !state.ledger.projects.some(p => p.id === values.projectId && (!p.archived || p.id === entry?.projectId))) throw new Error('这个项目已归档，请选择其他项目。');
      commit(() => {
        if (entry) {
          const target = state.ledger.entries.find(e => e.id === entry.id);
          if (!target) throw new Error('这条账目已不存在，请刷新后重试。');
          Object.assign(target, values, { updatedAt: stamp() });
        } else {
          state.ledger.entries.unshift({ id: ctx.uid(), ...values, archived: false, createdAt: stamp(), updatedAt: stamp() });
        }
      });
      const visible = selected().some(e => entry ? e.id === entry.id : e.date === values.date && e.amountCents === values.amountCents && e.projectId === values.projectId);
      ctx.toast(`${entry ? '账目已修改' : '账目已保存'}${visible ? '。' : '，可调整筛选查看。'}`);
      refreshed();
    } });
    const form = document.querySelector('#modal form');
    form?.querySelector('[name=type]')?.addEventListener('change', event => {
      const next = event.target.value, field = form.querySelector('[name=category]');
      if (Object.values(categories).flat().includes(field.value)) field.value = categories[next][0];
      form.querySelector('#ledger-category-options').innerHTML = categories[next].map(c => `<option value="${c}"></option>`).join('');
    });
  }
  function openProject(project) {
    const colorDraft = project ? null : createColorDraft(state);
    ctx.modal({ title: project ? '编辑记账项目' : '新建记账项目', submitLabel: project ? '保存项目' : '创建项目', body: `
      <div class="ledger-form"><label class="field">项目名称<input name="title" required maxlength="80" value="${esc(project?.title || '')}" placeholder="例如：学生会迎新、考研准备、日常生活"></label>
      <label class="field">卡片颜色<input name="color" type="color" value="${project ? safeColor(project.color) : colorDraft.color}" aria-label="项目卡片颜色">${project?'':'<small>自动配色，也可以手动选择。</small>'}</label>
      <p class="ledger-form-note">每笔收支都可以选择所属项目，之后按项目汇总。</p></div>`, onSubmit(data) {
      const title = String(data.get('title')).trim(), color = String(data.get('color'));
      if (!title || title.length > 80) throw new Error('请填写项目名称，最多 80 个字。');
      if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('请选择有效的卡片颜色。');
      if (state.ledger.projects.some(p => p.id !== project?.id && p.title.toLocaleLowerCase() === title.toLocaleLowerCase())) throw new Error('已有同名项目，请换一个名称或恢复已归档项目。');
      commit(() => {
        if (project) {
          const target = state.ledger.projects.find(p => p.id === project.id);
          if (!target) throw new Error('这个项目已不存在，请刷新后重试。');
          Object.assign(target, { title, color, updatedAt: stamp() });
        } else state.ledger.projects.push({ id: ctx.uid(), title, color:colorDraft.commit(color), archived: false, createdAt: stamp(), updatedAt: stamp() });
      });
      ctx.toast(project ? '项目已修改。' : '项目已创建，现在可以给它记账。');
      refreshed();
    } });
    colorDraft?.bind(document.querySelector('#modal form'));
  }
  function toggleEntry(id, archived) {
    const entry = state.ledger.entries.find(e => e.id === id);
    if (!entry) return;
    commit(() => Object.assign(entry, { archived, updatedAt: stamp() }));
    refreshed();
    ctx.toast(archived ? '账目已归档，不再计入收支汇总。' : '账目已恢复。', archived ? () => run(() => {
      const current = state.ledger.entries.find(e => e.id === id);
      if (!current?.archived) return;
      commit(() => Object.assign(current, { archived: false, updatedAt: stamp() }));
      ctx.refresh(); ctx.toast('账目已恢复。');
    }) : undefined);
  }
  function toggleProject(id, archived) {
    const project = state.ledger.projects.find(p => p.id === id);
    if (!project) return;
    commit(() => Object.assign(project, { archived, updatedAt: stamp() }));
    ctx.closeModal(); refreshed();
    ctx.toast(archived ? '项目已归档，历史账目仍保留并计入汇总。' : '项目已恢复。');
  }
  function manageProjects() {
    ctx.modal({ title: '管理记账项目', body: `<div class="ledger-project-manager">${state.ledger.projects.length ? state.ledger.projects.map(p => `<div class="ledger-project-manage-row" data-ledger-project-row="${esc(p.id)}"><span class="ledger-project-dot" style="--project-color:${safeColor(p.color)}"></span><div><strong>${esc(p.title)}</strong><small>${p.archived ? '已归档 · 历史账目保留' : `${state.ledger.entries.filter(e => !e.archived && e.projectId === p.id).length} 笔账目`}</small></div><button type="button" class="btn" data-ledger-action="edit-project" data-id="${esc(p.id)}" aria-label="编辑项目：${esc(p.title)}">编辑</button><button type="button" class="btn" data-ledger-action="${p.archived ? 'restore-project' : 'archive-project'}" data-id="${esc(p.id)}" aria-label="${p.archived ? '恢复' : '归档'}项目：${esc(p.title)}">${p.archived ? '恢复' : '归档'}</button></div>`).join('') : '<p class="ledger-form-note">还没有项目。可以先创建「日常生活」或「学生会活动」。</p>'}<button type="button" class="btn primary" data-ledger-action="add-project">${icon('plus', 16)}新建项目</button></div>` });
    document.querySelector('#modal .ledger-project-manager')?.addEventListener('click', handleAction);
  }
  function handleAction(event) {
    const button = event.target.closest('[data-ledger-action]');
    if (!button) return;
    const { ledgerAction: action, id } = button.dataset;
    run(() => {
      if (action === 'add-entry') openEntry();
      if (action === 'add-project') openProject();
      if (action === 'manage-projects') manageProjects();
      if (action === 'edit-entry') openEntry(state.ledger.entries.find(e => e.id === id));
      if (action === 'archive-entry') toggleEntry(id, true);
      if (action === 'restore-entry') toggleEntry(id, false);
      if (action === 'edit-project') openProject(state.ledger.projects.find(p => p.id === id));
      if (action === 'archive-project') toggleProject(id, true);
      if (action === 'restore-project') toggleProject(id, false);
      if (action === 'more') { view.limit += 80; drawContent(); }
    });
  }
  function entryMarkup(entry) {
    return `<article class="ledger-entry ${entry.type === 'income' ? 'is-income' : 'is-expense'}" data-entry-id="${esc(entry.id)}"><span class="ledger-entry-type" aria-label="${entry.type === 'income' ? '收入' : '支出'}">${entry.type === 'income' ? '+' : '−'}</span><button class="ledger-entry-main" data-ledger-action="edit-entry" data-id="${esc(entry.id)}" aria-label="编辑账目：${esc(entry.category)} ${money(entry.amountCents)}"><strong>${esc(entry.category)}${entry.example ? '<span class="ledger-example">示例</span>' : ''}</strong><span>${esc(projectTitle(entry.projectId))}${view.group === 'project' ? ` · ${esc(entry.date)}` : ''}</span>${entry.note ? `<p>${esc(entry.note)}</p>` : ''}</button><div class="ledger-entry-tail"><strong class="ledger-amount">${entry.type === 'income' ? '+' : '−'}${money(entry.amountCents)}</strong><button class="ledger-entry-archive" data-ledger-action="${entry.archived ? 'restore-entry' : 'archive-entry'}" data-id="${esc(entry.id)}" aria-label="${entry.archived ? '恢复' : '归档'}账目：${esc(entry.category)} ${money(entry.amountCents)}">${entry.archived ? '恢复' : '归档'}</button></div></article>`;
  }
  function groupMarkup(key, entries, allEntries) {
    const total = summarizeEntries(allEntries), project = view.group === 'project';
    return `<section class="ledger-group" data-group-key="${esc(key)}" style="--group-color:${project ? projectColor(key) : '#AE88FF'}"><header><h3>${project ? esc(projectTitle(key)) : esc(dateHeading(key))}</h3><span>${total.count} 笔${entries.length < total.count ? `（已显示 ${entries.length} 笔）` : ''} · 收 ${money(total.incomeCents)} / 支 ${money(total.expenseCents)}</span></header>${entries.map(entryMarkup).join('')}</section>`;
  }
  function drawContent() {
    const entries = selected(), total = summarizeEntries(entries), content = root.querySelector('[data-ledger-content]');
    root.querySelector('[data-ledger-range-error]').textContent = invalidRange() ? '请填写有效日期，开始日期不能晚于结束日期。' : '';
    const groupEntries = new Map(), allGroupEntries = new Map();
    for (const entry of entries) {
      const key = view.group === 'project' ? entry.projectId : entry.date;
      if (!allGroupEntries.has(key)) allGroupEntries.set(key, []);
      allGroupEntries.get(key).push(entry);
    }
    for (const entry of entries.slice(0, view.limit)) {
      const key = view.group === 'project' ? entry.projectId : entry.date;
      if (!groupEntries.has(key)) groupEntries.set(key, []);
      groupEntries.get(key).push(entry);
    }
    const allProjects = state.ledger.projects.filter(p => !p.archived || p.id === view.projectId);
    const projectEntries = invalidRange() ? [] : selectEntries(state.ledger, { ...view, projectId: 'all' });
    const projectCards = [{ id: '', title: '未分项目', color: '#FFBD82' }, ...allProjects].map(p => {
      const sums = summarizeEntries(projectEntries.filter(e => e.projectId === p.id));
      return `<button class="ledger-project-card ${view.projectId === p.id ? 'is-selected' : ''}" data-project-id="${esc(p.id)}" data-ledger-project="${esc(p.id)}" style="--project-color:${safeColor(p.color)}" aria-pressed="${view.projectId === p.id}"><span class="ledger-project-card-title">${icon('layers', 18)}<strong>${esc(p.title)}</strong>${p.archived ? '<small>已归档</small>' : ''}</span><span class="ledger-project-expense"><small>支出</small><strong>${money(sums.expenseCents)}</strong></span><span class="ledger-project-foot"><span>收入 ${money(sums.incomeCents)}</span><span>${sums.count} 笔 ${icon('arrow-right', 13)}</span></span></button>`;
    }).join('');
    content.innerHTML = `<div class="ledger-summary" aria-label="筛选范围内的收支汇总"><section class="ledger-total expense"><span>支出</span><strong data-ledger-total="expense">${money(total.expenseCents)}</strong></section><section class="ledger-total income"><span>收入</span><strong data-ledger-total="income">${money(total.incomeCents)}</strong></section><section class="ledger-total net"><span>收支结余</span><strong data-ledger-total="net">${money(total.netCents)}</strong></section></div>
      <div class="ledger-scope"><span>${esc(periodLabel())} · ${entries.length} 笔${view.archived ? '归档账目 · 不计入正常收支' : '账目'}${view.projectId !== 'all' ? ` · ${esc(projectTitle(view.projectId))}` : ''}</span><span>人民币 CNY</span></div>
      <section class="ledger-projects" aria-label="项目账本"><div class="ledger-section-head"><h2>项目账本</h2><button class="ledger-text-button" data-ledger-action="manage-projects">管理项目 ${icon('arrow-right', 14)}</button></div><div class="ledger-project-track">${projectCards}</div></section>
      <section class="ledger-journal" aria-label="账目明细"><div class="ledger-section-head"><h2>${view.archived ? '已归档账目' : '账目明细'}</h2><div class="ledger-segments" role="group" aria-label="账目排列方式"><button data-ledger-group="date" aria-pressed="${view.group === 'date'}">按日期</button><button data-ledger-group="project" aria-pressed="${view.group === 'project'}">按项目</button></div></div>
      ${entries.length ? [...groupEntries].map(([key, items]) => groupMarkup(key, items, allGroupEntries.get(key))).join('') : `<div class="ledger-empty">${icon('wallet', 30)}<h3>${view.archived ? '没有符合筛选的归档账目' : '这里还没有账目'}</h3><p>${state.ledger.entries.length ? '可以调整日期、项目或收支筛选。' : '从今天的一顿饭，或一个新项目开始。'}</p>${view.archived ? '' : `<button class="btn primary" data-ledger-action="add-entry">${icon('plus', 16)}记一笔</button>`}</div>`}
      ${entries.length > view.limit ? `<button class="btn ledger-more" data-ledger-action="more">再显示 ${Math.min(80, entries.length - view.limit)} 笔 · 共 ${entries.length} 笔</button>` : ''}</section>`;
  }
  root.innerHTML = `<div class="ledger-page interior-page"><header class="ledger-head"><div><h1>${icon('wallet', 25)}记账</h1><p>每一笔有日期，每个项目有自己的账本。</p></div><div class="ledger-head-actions"><button class="btn" data-ledger-action="add-project">${icon('layers', 16)}新建项目</button><button class="btn primary" data-ledger-action="add-entry">${icon('plus', 17)}记一笔</button></div></header>
    <section class="ledger-filters" aria-label="账目筛选"><div class="ledger-filter-top"><div class="ledger-quick-dates" role="group" aria-label="快捷日期"><button data-ledger-period="month">本月</button><button data-ledger-period="today">今天</button><button data-ledger-period="all">全部日期</button></div><label class="ledger-archived"><input type="checkbox" data-ledger-filter="archived" ${view.archived ? 'checked' : ''}>查看归档账目</label></div>
    <div class="ledger-filter-fields"><label>开始日期<input type="date" data-ledger-filter="start" aria-label="开始日期" value="${esc(view.start)}" min="1900-01-01" max="9999-12-31"></label><label>结束日期<input type="date" data-ledger-filter="end" aria-label="结束日期" value="${esc(view.end)}" min="1900-01-01" max="9999-12-31"></label><label>项目<select data-ledger-filter="projectId" aria-label="筛选项目">${projectOptions(view.projectId, true)}</select></label><label>收支<select data-ledger-filter="type" aria-label="筛选收支"><option value="all" ${view.type === 'all' ? 'selected' : ''}>全部收支</option><option value="expense" ${view.type === 'expense' ? 'selected' : ''}>支出</option><option value="income" ${view.type === 'income' ? 'selected' : ''}>收入</option></select></label><label class="ledger-query">搜索<input type="search" data-ledger-filter="query" aria-label="搜索分类或备注" placeholder="分类或备注" maxlength="200" value="${esc(view.query)}"></label></div><p class="ledger-range-error" data-ledger-range-error role="status"></p></section><div data-ledger-content aria-live="polite"></div></div>`;
  function updateFilter(event) {
    const field = event.target.closest('[data-ledger-filter]');
    if (!field) return;
    view[field.dataset.ledgerFilter] = field.type === 'checkbox' ? field.checked : field.value;
    view.limit = 80; drawContent(); markPeriod();
  }
  function markPeriod() {
    const current = monthRange();
    root.querySelectorAll('[data-ledger-period]').forEach(button => {
      const active = button.dataset.ledgerPeriod === 'month' ? view.start === current.start && view.end === current.end : button.dataset.ledgerPeriod === 'today' ? view.start === localDate() && view.end === localDate() : !view.start && !view.end;
      button.setAttribute('aria-pressed', String(active));
    });
  }
  function click(event) {
    handleAction(event);
    const period = event.target.closest('[data-ledger-period]');
    if (period) {
      Object.assign(view, period.dataset.ledgerPeriod === 'month' ? monthRange() : period.dataset.ledgerPeriod === 'today' ? { start: localDate(), end: localDate() } : { start: '', end: '' });
      root.querySelector('[data-ledger-filter=start]').value = view.start; root.querySelector('[data-ledger-filter=end]').value = view.end;
      view.limit = 80; drawContent(); markPeriod();
    }
    const group = event.target.closest('[data-ledger-group]');
    if (group) { view.group = group.dataset.ledgerGroup; view.limit = 80; drawContent(); }
    const project = event.target.closest('[data-ledger-project]');
    if (project) {
      view.projectId = view.projectId === project.dataset.ledgerProject ? 'all' : project.dataset.ledgerProject;
      root.querySelector('[data-ledger-filter=projectId]').value = view.projectId;
      view.limit = 80; drawContent();
    }
  }
  root.addEventListener('click', click); root.addEventListener('input', updateFilter); root.addEventListener('change', updateFilter);
  drawContent(); markPeriod();
  return () => { mounted = false; root.removeEventListener('click', click); root.removeEventListener('input', updateFilter); root.removeEventListener('change', updateFilter); };
}
