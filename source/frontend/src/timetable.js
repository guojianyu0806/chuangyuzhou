import { initializeTimetable, validateTimetable, weekForDate, dateForWeek, entriesForWeek, parseWeeks, formatWeeks } from './timetable-model.js';
import { createColorDraft } from './creation-colors.js';

const views = new WeakMap();
const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const colors = ['#AE88FF', '#63E6DC', '#FFBD82', '#FF9CCE', '#D5F542', '#82BDFF'];
const DEFAULT_PERIODS = ['08:30-09:15', '09:25-10:10', '10:30-11:15', '11:25-12:10', '14:00-14:45', '14:55-15:40', '16:00-16:45', '16:55-17:40', '19:00-19:45', '19:55-20:40', '20:50-21:35', '21:45-22:30'].map((value, index) => ({ id: index + 1, start: value.slice(0, 5), end: value.slice(6) }));
const safeColor = value => /^#[\da-f]{6}$/i.test(value || '') ? value : colors[0];
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const monday = () => { const d = new Date(); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const shortDate = value => `${Number(value.slice(5, 7))}.${Number(value.slice(8, 10))}`;
const clampWeek = (term, week) => Math.max(1, Math.min(term.totalWeeks, Number.isFinite(week) ? week : 1));

// Assign overlapping periods to separate lanes; connected groups share one lane count.
function dayLayout(entries) {
  const sorted = entries.slice().sort((a, b) => a.startPeriod - b.startPeriod || a.endPeriod - b.endPeriod || a.title.localeCompare(b.title));
  const result = []; let group = [], groupEnd = -1;
  function flush() {
    if (!group.length) return;
    const laneEnds = [], positioned = group.map(entry => {
      let lane = laneEnds.findIndex(end => end < entry.startPeriod);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = entry.endPeriod;
      return { entry, lane };
    });
    result.push(...positioned.map(item => ({ ...item, lanes: laneEnds.length })));
    group = [];
  }
  for (const entry of sorted) {
    if (entry.startPeriod > groupEnd) { flush(); groupEnd = -1; }
    group.push(entry); groupEnd = Math.max(groupEnd, entry.endPeriod);
  }
  flush(); return result;
}

export function mountTimetable(ctx) {
  initializeTimetable(ctx.state);
  const { root, state, esc, icon } = ctx;
  const owner = ctx.cloud || state;
  if (!views.has(owner)) views.set(owner, new Map());
  const ownerViews = views.get(owner), viewKey = state.mode || 'personal';
  if (!ownerViews.has(viewKey)) ownerViews.set(viewKey, { mode: 'grid', termWeeks: {}, showArchived: false, allWeeks: false, query: '' });
  const view = ownerViews.get(viewKey);
  const events = new AbortController();
  let mounted = true;
  const term = () => state.timetable.terms.find(t => t.id === state.timetable.activeTermId) || state.timetable.terms[0];
  const selectedWeek = t => clampWeek(t, view.termWeeks[t.id] ?? weekForDate(t, today()));
  const timeLabel = (t, entry) => `${t.periods.find(p => p.id === entry.startPeriod)?.start || ''}–${t.periods.find(p => p.id === entry.endPeriod)?.end || ''}`;
  const periodLabel = entry => entry.startPeriod === entry.endPeriod ? `第 ${entry.startPeriod} 节` : `${entry.startPeriod}–${entry.endPeriod} 节`;
  function commit(change) {
    const previous = structuredClone(state.timetable), updatedAt = state.updatedAt, previousColor = state.ui?.lastCreatedColor;
    try { change(); state.timetable = validateTimetable(state.timetable); ctx.save(); }
    catch (error) { state.timetable = previous; state.updatedAt = updatedAt;if(state.ui){if(previousColor===undefined)delete state.ui.lastCreatedColor;else state.ui.lastCreatedColor=previousColor;}throw error; }
  }
  function redraw() { if (mounted) draw(); }
  function run(action) { try { action(); } catch (error) { ctx.toast(error.message || '保存失败，请重试。'); } }
  function targetTerm(id) {
    const target = state.timetable.terms.find(t => t.id === id);
    if (!target) throw new Error('这个学期已不存在，请刷新后重试。');
    return target;
  }
  function entryDialog(entryId) {
    const t = term(), entry = t?.entries.find(e => e.id === entryId);
    if (!entry) return;
    const conflicts = t.entries.filter(e => !e.archived && e.id !== entry.id && e.weekday === entry.weekday && e.startPeriod <= entry.endPeriod && e.endPeriod >= entry.startPeriod && e.weeks.some(w => entry.weeks.includes(w)));
    ctx.modal({ title: entry.title, body: `<div class="tt-detail" style="--tt-course:${safeColor(entry.color)}"><div class="tt-detail-heading"><span>${esc(weekdays[entry.weekday - 1])} · ${periodLabel(entry)}</span><strong>${esc(timeLabel(t, entry))}</strong></div><dl><div><dt>上课周次</dt><dd>${esc(formatWeeks(entry.weeks))}</dd></div><div><dt>上课地点</dt><dd>${esc(entry.location || '暂未填写')}</dd></div><div><dt>授课教师</dt><dd>${esc(entry.teacher || '暂未填写')}</dd></div><div><dt>所属学期</dt><dd>${esc(t.title)}${t.campus ? ` · ${esc(t.campus)}` : ''}</dd></div></dl>${entry.archived ? '<p class="tt-message">已归档，不显示在每周课表中。</p>' : ''}${conflicts.length ? `<div class="tt-conflict-note" role="status">${icon('info', 16)}<span>部分周次与 ${conflicts.map(e => `「${esc(e.title)}」`).join('、')} 时间重叠，请核对上课安排。</span></div>` : ''}<div class="tt-detail-actions"><button type="button" class="btn primary" data-tt-modal="edit">${icon('edit', 16)}编辑课程</button><button type="button" class="btn" data-tt-modal="archive">${icon(entry.archived ? 'refresh' : 'archive', 16)}${entry.archived ? '恢复课程' : '归档课程'}</button></div></div>` });
    const detail = document.querySelector('#modal .tt-detail');
    detail?.addEventListener('click', event => {
      const button = event.target.closest('[data-tt-modal]'); if (!button) return;
      run(() => {
        const currentTerm = targetTerm(t.id), current = currentTerm.entries.find(e => e.id === entry.id);
        if (!current) throw new Error('这门课程已不存在，请刷新后重试。');
        if (button.dataset.ttModal === 'edit') return editEntry(currentTerm, current);
        const archived = !current.archived;
        commit(() => { current.archived = archived; });
        ctx.closeModal(); redraw(); ctx.toast(archived ? '课程已归档，历史信息保留。' : '课程已恢复到课表。');
      });
    }, { signal: events.signal });
  }
  function editEntry(t = term(), entry) {
    if (!t) return editTerm();
    const colorDraft = entry ? null : createColorDraft(state);
    const options = selected => t.periods.map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>第 ${p.id} 节 · ${p.start}–${p.end}</option>`).join('');
    ctx.modal({ title: entry ? '编辑课表课程' : '新增课表课程', submitLabel: entry ? '保存修改' : '加入课表', body: `<div class="tt-form"><label class="field">课程名称<input name="title" required maxlength="120" value="${esc(entry?.title || '')}" placeholder="填写课程名称"></label><div class="tt-form-grid"><label class="field">教师<input name="teacher" maxlength="100" value="${esc(entry?.teacher || '')}" placeholder="可稍后填写"></label><label class="field">地点<input name="location" maxlength="200" value="${esc(entry?.location || '')}" placeholder="教学楼 / 教室"></label></div><div class="tt-form-grid"><label class="field">星期<select name="weekday">${weekdays.map((day, index) => `<option value="${index + 1}" ${entry?.weekday === index + 1 ? 'selected' : ''}>${day}</option>`).join('')}</select></label><label class="field">卡片颜色<input name="color" type="color" value="${entry ? safeColor(entry.color) : colorDraft.color}">${entry?'':'<small>自动配色，也可以手动选择。</small>'}</label></div><div class="tt-form-grid"><label class="field">开始节次<select name="startPeriod">${options(entry?.startPeriod || t.periods[0].id)}</select></label><label class="field">结束节次<select name="endPeriod">${options(entry?.endPeriod || t.periods[Math.min(1, t.periods.length - 1)].id)}</select></label></div><label class="field">上课周次<input name="weeks" required maxlength="500" value="${esc(entry ? formatWeeks(entry.weeks) : `1-${Math.max(1, t.teachingWeeks)}`)}" aria-describedby="tt-week-help" placeholder="例如：1-18 或 1-17(单)"><small id="tt-week-help">支持 1-18、1-17(单)、6-8(双)；不连续周次用逗号隔开，例如 1-5,7,9。</small></label><p class="tt-form-note">${esc(t.title)} · 第 1–${t.totalWeeks} 周。课程只保存在学期课表。</p></div>`, onSubmit(data) {
      const currentTerm = targetTerm(t.id);
      const values = { title: String(data.get('title')).trim(), teacher: String(data.get('teacher')).trim(), location: String(data.get('location')).trim(), weekday: Number(data.get('weekday')), startPeriod: Number(data.get('startPeriod')), endPeriod: Number(data.get('endPeriod')), weeks: parseWeeks(String(data.get('weeks')), currentTerm.totalWeeks), color: String(data.get('color')) };
      if (!values.title || values.title.length > 120) throw new Error('请填写课程名称，最多 120 个字。');
      if (values.startPeriod > values.endPeriod) throw new Error('结束节次不能早于开始节次。');
      if (currentTerm.entries.some(e => e.id !== entry?.id && !e.archived && e.title === values.title && e.weekday === values.weekday && e.startPeriod === values.startPeriod && e.endPeriod === values.endPeriod && e.weeks.join(',') === values.weeks.join(','))) throw new Error('这门课程的时间和周次已在课表中，请直接编辑原课程。');
      commit(() => {
        if (entry) {
          const target = currentTerm.entries.find(e => e.id === entry.id);
          if (!target) throw new Error('这门课程已不存在，请刷新后重试。');
          Object.assign(target, values);
        } else currentTerm.entries.push({ id: ctx.uid(), ...values, color:colorDraft.commit(values.color), archived: false });
      });
      ctx.toast(entry ? '课表课程已修改。' : '课程已加入学期课表。'); redraw();
    } });
    colorDraft?.bind(document.querySelector('#modal form'));
  }
  function editTerm(existing) {
    const periods = existing?.periods || DEFAULT_PERIODS;
    ctx.modal({ title: existing ? '学期与作息设置' : '新建学期', submitLabel: existing ? '保存学期' : '创建学期', body: `<div class="tt-form"><label class="field">学期名称<input name="title" required maxlength="120" value="${esc(existing?.title || '')}" placeholder="例如：2026–2027 秋季学期"></label><label class="field">校区<input name="campus" maxlength="100" value="${esc(existing?.campus || '')}" placeholder="填写上课校区"></label><label class="field">第 1 周的周一<input name="weekOne" type="date" required min="1900-01-01" max="2099-12-31" value="${esc(existing?.weekOne || monday())}"><small>按校历的第 1 周填写，单周 / 双周都以此计算。</small></label><div class="tt-form-grid"><label class="field">学期总周数<input name="totalWeeks" type="number" min="1" max="53" step="1" required value="${existing?.totalWeeks || 20}"></label><label class="field">教学周数<input name="teachingWeeks" type="number" min="0" max="53" step="1" required value="${existing?.teachingWeeks ?? 18}"></label></div><details class="tt-period-settings"><summary>每日作息 · ${periods.length} 节</summary><label class="field">每行一个节次，按从早到晚排列<textarea name="periods" rows="${Math.min(12, periods.length)}" required spellcheck="false" aria-describedby="tt-period-help">${esc(periods.map(p => `${p.start}-${p.end}`).join('\n'))}</textarea><small id="tt-period-help">格式：08:30-09:15。第一行是第 1 节，最多 24 节；已有课程引用的节次需要保留。</small></label></details><label class="field">学期备注<textarea name="notes" rows="3" maxlength="4000" placeholder="调课、考试周等说明">${esc(existing?.notes || '')}</textarea></label><p class="tt-form-note">调整学期起始日会重新计算日期与周次。课表不会自动写入日历。</p></div>`, onSubmit(data) {
      const lines = String(data.get('periods')).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!lines.length || lines.length > 24) throw new Error('请填写 1–24 个节次，每行一个。');
      const parsedPeriods = lines.map((line, index) => {
        const match = /^(\d{2}:\d{2})\s*[-–—~～]\s*(\d{2}:\d{2})$/.exec(line);
        if (!match) throw new Error(`第 ${index + 1} 节格式不正确，请使用 08:30-09:15。`);
        return { id: existing?.periods[index]?.id ?? ((existing?.periods.at(-1)?.id || 0) + index - (existing?.periods.length || 0) + 1), start: match[1], end: match[2] };
      });
      const values = { title: String(data.get('title')).trim(), campus: String(data.get('campus')).trim(), weekOne: String(data.get('weekOne')), totalWeeks: Number(data.get('totalWeeks')), teachingWeeks: Number(data.get('teachingWeeks')), notes: String(data.get('notes')).trim(), periods: parsedPeriods };
      if (!values.title || values.title.length > 120) throw new Error('请填写学期名称，最多 120 个字。');
      if (state.timetable.terms.some(t => t.id !== existing?.id && t.title === values.title)) throw new Error('已有同名学期，请换一个名称。');
      const id = existing?.id || ctx.uid();
      commit(() => {
        if (existing) Object.assign(targetTerm(id), values);
        else state.timetable.terms.push({ id, ...values, entries: [] });
        state.timetable.activeTermId = id;
      });
      const updated = targetTerm(id);
      view.termWeeks[id] = clampWeek(updated, weekForDate(updated, today()));
      ctx.toast(existing ? '学期与作息已保存。' : '学期已创建，可以添加课程。'); redraw();
    } });
  }
  function gridMarkup(t, week, entries) {
    const layouts = weekdays.map((_, index) => dayLayout(entries.filter(e => e.weekday === index + 1)));
    const conflictCount = layouts.flat().filter(item => item.lanes > 1).length;
    const dates = weekdays.map((_, index) => dateForWeek(t, week, index + 1));
    return `<div class="tt-grid-help"><span>${icon('info', 14)}点击课程查看详情；左右滑动查看整周</span>${conflictCount ? `<strong>${conflictCount} 个安排存在时间重叠，已并列显示</strong>` : `<span>${entries.length} 个上课安排</span>`}</div><div class="tt-grid-scroll" tabindex="0" role="region" aria-label="第 ${week} 周课表，可以横向与纵向滚动"><div class="tt-grid" style="--tt-periods:${t.periods.length}"><div class="tt-grid-corner">节次</div>${weekdays.map((day, index) => `<div class="tt-grid-day ${dates[index] === today() ? 'is-today' : ''}"><strong>${day}${dates[index] === today() ? '<b>今天</b>' : ''}</strong><span>${shortDate(dates[index])}</span></div>`).join('')}<div class="tt-times">${t.periods.map(p => `<div><strong>${p.id}</strong><time>${esc(p.start)}<br>${esc(p.end)}</time></div>`).join('')}</div>${layouts.map((items, day) => `<div class="tt-day-column ${dates[day] === today() ? 'is-today' : ''}">${items.map(({ entry, lane, lanes }) => `<button type="button" class="tt-course ${lanes > 1 ? 'has-conflict' : ''}" data-tt-action="detail" data-tt-entry="${esc(entry.id)}" data-id="${esc(entry.id)}" style="--tt-course:${safeColor(entry.color)};--tt-start:${t.periods.findIndex(p => p.id === entry.startPeriod)};--tt-span:${t.periods.findIndex(p => p.id === entry.endPeriod) - t.periods.findIndex(p => p.id === entry.startPeriod) + 1};--tt-lane:${lane};--tt-lanes:${lanes}" aria-label="${esc(entry.title)}，${weekdays[entry.weekday - 1]}，${periodLabel(entry)}，${esc(entry.location || '地点未填')}，${lanes > 1 ? '与其他课程时间重叠，' : ''}查看详情"><strong>${esc(entry.title)}</strong><span>${esc(entry.location || '地点待补充')}</span><small>${esc(entry.teacher)}</small>${lanes > 1 ? '<em>时间重叠</em>' : ''}</button>`).join('')}</div>`).join('')}</div></div>${!entries.length ? `<div class="tt-week-empty">${icon('coffee', 20)}<span>第 ${week} 周没有课程安排${week > t.teachingWeeks ? '，可在学期备注中查看考试安排' : ''}。</span></div>` : ''}`;
  }
  function listMarkup(t, week) {
    const query = view.query.trim().toLocaleLowerCase();
    const entries = t.entries.filter(e => e.archived === view.showArchived && (view.allWeeks || e.weeks.includes(week)) && (!query || [e.title, e.teacher, e.location].join(' ').toLocaleLowerCase().includes(query))).sort((a, b) => a.weekday - b.weekday || a.startPeriod - b.startPeriod || a.title.localeCompare(b.title));
    return `<div class="tt-list-filters"><label class="tt-search">${icon('search', 16)}<input type="search" data-timetable-view data-tt-filter="query" value="${esc(view.query)}" aria-label="搜索课程、教师或地点" maxlength="200" placeholder="搜索课程、教师或地点"></label><label class="tt-check"><input type="checkbox" data-timetable-view data-tt-filter="allWeeks" ${view.allWeeks ? 'checked' : ''}>整个学期</label><label class="tt-check"><input type="checkbox" data-timetable-view data-tt-filter="showArchived" ${view.showArchived ? 'checked' : ''}>已归档</label></div><div class="tt-list-results" data-tt-list-results>${listResults(entries, t, week)}</div>`;
  }
  function listResults(entries, t, week) {
    if (!entries.length) return `<div class="tt-empty compact">${icon('book', 26)}<h3>${view.showArchived ? '没有符合条件的归档课程' : '这里暂时没有课程'}</h3><p>${view.query ? '试试课程名、教师名或教室。' : view.allWeeks ? '添加课程后，就能按周次查看上课安排。' : `第 ${week} 周没有符合条件的课程，可勾选「整个学期」查看。`}</p>${!view.showArchived && !view.query ? '<button class="btn" data-tt-action="add-entry">新增课程</button>' : ''}</div>`;
    return weekdays.map((day, index) => {
      const daily = entries.filter(e => e.weekday === index + 1); if (!daily.length) return '';
      return `<section class="tt-list-day"><header><h3>${day}</h3><span>${view.allWeeks ? '整个学期' : shortDate(dateForWeek(t, week, index + 1))} · ${daily.length} 个安排</span></header><div>${daily.map(entry => `<button class="tt-list-course ${entry.archived ? 'is-archived' : ''}" data-tt-action="detail" data-tt-entry="${esc(entry.id)}" data-id="${esc(entry.id)}" style="--tt-course:${safeColor(entry.color)}"><span class="tt-list-time"><strong>${periodLabel(entry)}</strong><small>${esc(timeLabel(t, entry))}</small></span><span class="tt-list-main"><strong>${esc(entry.title)}</strong><span>${esc(entry.location || '地点待补充')}${entry.teacher ? ` · ${esc(entry.teacher)}` : ''}</span><small>${esc(formatWeeks(entry.weeks))}${entry.archived ? ' · 已归档' : ''}</small></span>${icon('chevron-right', 17)}</button>`).join('')}</div></section>`;
    }).join('');
  }
  function updateListResults(t, week) {
    const query = view.query.trim().toLocaleLowerCase();
    const entries = t.entries.filter(e => e.archived === view.showArchived && (view.allWeeks || e.weeks.includes(week)) && (!query || [e.title, e.teacher, e.location].join(' ').toLocaleLowerCase().includes(query))).sort((a, b) => a.weekday - b.weekday || a.startPeriod - b.startPeriod || a.title.localeCompare(b.title));
    root.querySelector('[data-tt-list-results]').innerHTML = listResults(entries, t, week);
  }
  function draw() {
    const t = term();
    if (!t) {
      root.innerHTML = `<section class="tt-page interior-page"><header class="tt-head"><div><h1>${icon('timetable', 25)}学期课表</h1><p>每周的课程，在这里单独安排。</p></div></header><div class="tt-empty">${icon('timetable', 38)}<h2>从一个学期开始</h2><p>创建学期，设置上课周次与作息，再把课程加入这张课表。</p><button class="btn primary" data-tt-action="add-term">${icon('plus', 17)}新建学期</button></div></section>`;
      return;
    }
    const week = selectedWeek(t), currentWeek = weekForDate(t, today()), inTerm = currentWeek >= 1 && currentWeek <= t.totalWeeks;
    const entries = entriesForWeek(t, week);
    view.termWeeks[t.id] = week;
    root.innerHTML = `<section class="tt-page interior-page"><header class="tt-head"><div><h1>${icon('timetable', 25)}学期课表</h1><p>${esc(t.campus || '我的课程')} · ${inTerm ? `当前第 ${currentWeek} 周` : currentWeek < 1 ? '学期尚未开始' : '本学期已结束'}</p></div><div class="tt-head-actions"><button class="btn" data-tt-action="settings">${icon('settings', 16)}学期设置</button><button class="btn primary" data-tt-action="add-entry">${icon('plus', 17)}新增课程</button></div></header><div class="tt-toolbar"><div class="tt-term-select"><label class="sr-only" for="tt-term">选择学期</label><select id="tt-term" data-timetable-view data-tt-filter="term">${state.timetable.terms.map(item => `<option value="${esc(item.id)}" ${item.id === t.id ? 'selected' : ''}>${esc(item.title)}</option>`).join('')}</select><button type="button" class="tt-icon-btn" data-tt-action="add-term" aria-label="新建学期" title="新建学期">${icon('plus', 18)}</button></div><div class="tt-view-tabs" role="group" aria-label="课表显示方式"><button type="button" data-tt-action="grid" aria-pressed="${view.mode === 'grid'}">${icon('timetable', 16)}周课表</button><button type="button" data-tt-action="list" aria-pressed="${view.mode === 'list'}">${icon('list', 16)}课程清单</button></div></div><div class="tt-weekbar"><div class="tt-week-step"><button class="tt-icon-btn" data-tt-action="prev" aria-label="上一周" ${week <= 1 ? 'disabled' : ''}>${icon('arrow-left', 17)}</button><label class="sr-only" for="tt-week">选择周次</label><select id="tt-week" aria-label="教学周" data-timetable-view data-tt-filter="week">${Array.from({ length: t.totalWeeks }, (_, i) => `<option value="${i + 1}" ${week === i + 1 ? 'selected' : ''}>第 ${i + 1} 周${inTerm && currentWeek === i + 1 ? ' · 本周' : ''}</option>`).join('')}</select><button class="tt-icon-btn" data-tt-action="next" aria-label="下一周" ${week >= t.totalWeeks ? 'disabled' : ''}>${icon('arrow-right', 17)}</button></div><span class="tt-week-dates">${dateForWeek(t, week, 1)} — ${shortDate(dateForWeek(t, week, 7))}</span><button class="btn tt-today" data-tt-action="today" ${!inTerm ? 'disabled' : ''} title="${inTerm ? '跳回当前教学周' : '今天不在这个学期内'}">回到本周</button></div>${week > t.teachingWeeks ? `<div class="tt-exam-note">${icon('info', 17)}<span>第 ${week} 周已超出教学周，具体考试或其他安排以学期备注与学校通知为准。</span></div>` : ''}<div class="tt-content">${view.mode === 'grid' ? gridMarkup(t, week, entries) : listMarkup(t, week)}</div>${t.notes ? `<details class="tt-notes"><summary>${icon('file', 16)}学期备注</summary><p>${esc(t.notes)}</p></details>` : ''}</section>`;
  }
  function click(event) {
    const button = event.target.closest('[data-tt-action]'); if (!button || button.disabled) return;
    const action = button.dataset.ttAction;
    run(() => {
      const t = term();
      if (action === 'add-term') return editTerm();
      if (action === 'add-entry') return editEntry(t);
      if (action === 'settings') return editTerm(t);
      if (action === 'detail') return entryDialog(button.dataset.id);
      if (action === 'grid' || action === 'list') view.mode = action;
      if (t && ['prev', 'next', 'today'].includes(action)) view.termWeeks[t.id] = action === 'today' ? clampWeek(t, weekForDate(t, today())) : clampWeek(t, selectedWeek(t) + (action === 'prev' ? -1 : 1));
      redraw();
    });
  }
  function change(event) {
    const field = event.target.closest('[data-tt-filter]'); if (!field) return;
    if (field.dataset.ttFilter === 'query' && event.type !== 'input') return;
    if (field.dataset.ttFilter !== 'query' && event.type !== 'change') return;
    run(() => {
      const filter = field.dataset.ttFilter, t = term();
      if (filter === 'term') {
        const previous = t.id;
        try { commit(() => { targetTerm(field.value); state.timetable.activeTermId = field.value; }); }
        catch (error) { field.value = previous; throw error; }
        return redraw();
      }
      if (filter === 'week') { view.termWeeks[t.id] = clampWeek(t, Number(field.value)); return redraw(); }
      view[filter] = field.type === 'checkbox' ? field.checked : field.value;
      updateListResults(t, selectedWeek(t));
    });
  }
  root.addEventListener('click', click, { signal: events.signal });
  root.addEventListener('change', change, { signal: events.signal });
  root.addEventListener('input', change, { signal: events.signal });
  draw();
  return () => { mounted = false; events.abort(); };
}
