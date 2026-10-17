import { mountCanvas, canvasCardFill } from './canvas.js';
import { assignRecordColor, createColorDraft } from './creation-colors.js';
import { openAIConversation } from './ai.js';
import { mountFileText } from './file-text.js';

const DEFAULT_PROMPT = `你是我的软件工程课程助教。请以我上传的课程资料和课堂笔记为依据，按章节整理：
1. 核心概念、概念关系与适用条件。
2. 算法、代码、公式和例题的逐步解释。
3. 易混淆点、边界情况和我提出的疑问。
4. 复习问题与下一步学习建议。
主要结论标注真实文件与位置；找不到依据时明确说明。区分老师明确强调的内容、我的记录和你的补充解释。不编造页码，不把未运行的代码标为验证通过。`;

export function seedCourses() {
  const stamp = new Date().toISOString();
  return [
    { id: 'course-data-structures', title: '数据结构', subtitle: '让数据的组织方式，成为解题思路。', color: '#7950f2', icon: 'code', example: true, prompt: DEFAULT_PROMPT, updatedAt: stamp, files: [], notes: [
      { id: 'note-linear-list', title: '线性表：顺序存储与链式存储', chapter: '线性表', example: true, source: '工作台参考资料，用于展示笔记版式；未引用你的课件。', content: '# 从一个问题开始\n为什么数组读取很快，却不适合频繁地在中间插入元素？\n\n## 两种组织方式\n顺序表把元素放在连续的存储空间中，可以根据下标计算地址。链表用结点之间的链接表示逻辑上的先后关系，存储位置不必连续。\n\n## 把操作放回场景\n- 按下标读取：顺序表通常为 O(1)，单链表通常需要从头遍历，最坏为 O(n)。\n- 中间插入：顺序表通常需要移动后续元素。\n- 链表插入：已知前驱结点时可以在 O(1) 时间修改链接；寻找插入位置仍可能需要 O(n)。\n\n## 容易忽略的条件\n“链表插入是 O(1)”有一个前提：已经找到相应位置。分析完整操作时，要把查找位置的时间算进去。\n\n## 试着自己回答\n1. 频繁随机读取、较少修改的数据，适合哪种结构？\n2. 空链表、头部插入、尾部删除分别要注意什么？\n3. 为什么链表不必移动后续元素？', updatedAt: stamp, revisions: [] },
      { id: 'note-stack-queue', title: '栈与队列：两种访问秩序', chapter: '栈与队列', example: true, source: '工作台参考资料；不代表老师划定的考试重点。', content: '# 先想清楚访问顺序\n栈遵循后进先出，队列遵循先进先出。它们约束的是元素进入和离开的顺序。\n\n## 对应到熟悉的场景\n- 栈：函数调用、括号匹配、撤销操作。\n- 队列：按到达顺序处理任务、广度优先遍历的待访问结点。\n\n## 自查问题\n用数组实现循环队列时，如何区分队空与队满？请先写出你使用的 front、rear 定义，再推导判断条件。', updatedAt: stamp, revisions: [] }
    ] },
    { id: 'course-operating-systems', title: '操作系统', subtitle: '理解程序背后的资源与秩序。', color: '#008f99', icon: 'layers', example: true, prompt: DEFAULT_PROMPT, updatedAt: stamp, files: [], notes: [
      { id: 'note-process-thread', title: '进程与线程：资源和执行', chapter: '进程管理', example: true, source: '工作台参考资料，未关联教材或课堂资料。', content: '# 同一个程序，两个观察角度\n进程是资源分配和管理的重要单位；线程是进程中的执行流。同一进程内的线程通常共享地址空间和部分资源，各自保留执行所需的栈与寄存器状态。\n\n## 共享带来的问题\n多个线程可以方便地访问共同的数据，同时也需要处理竞态条件。共享计数器的“加一”不应在没有进一步分析时被当成不可分割的一步。\n\n## 建立一条理解链\n共享数据 → 可能交错的读写 → 竞态条件 → 临界区 → 同步机制。\n\n## 留给自己的问题\n互斥锁保护的是什么？如果临界区太大，会怎样影响并发？', updatedAt: stamp, revisions: [] }
    ] },
    { id: 'course-networks', title: '计算机网络', subtitle: '跟随一条消息，理解网络如何连接。', color: '#df438f', icon: 'globe', example: true, prompt: DEFAULT_PROMPT, updatedAt: stamp, files: [], notes: [
      { id: 'note-network-layers', title: '网络分层：一次请求的旅程', chapter: '网络体系结构', example: true, source: '工作台参考资料；分层口径应以你的课程教材为准。', content: '# 浏览器请求发出之后\n分层让不同职责可以分别讨论：应用表达要交换的内容，传输层提供端到端的数据传输服务，网络层处理跨网络的寻址与转发，链路层处理相邻结点之间的数据传递。\n\n## 用问题区分职责\n- 应用层：交换什么数据，如何解释？\n- 传输层：交给目标主机上的哪个应用？\n- 网络层：目标在哪里，如何转发？\n- 链路层：如何传到下一跳？\n\n## 对照自己的教材\n不同教材可能使用五层模型、TCP/IP 模型或 OSI 七层模型。整理时要先确定课程采用的口径。\n\n## 复习提问\nIP 地址与端口号分别解决什么问题？为什么到达目标主机还不等于到达目标应用？', updatedAt: stamp, revisions: [] }
    ] }
  ];
}

function readableSize(bytes) {
  if (!bytes) return '0 KB';
  return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

function dateLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '刚刚' : date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
}

function richText(text, esc) {
  let list = false;
  let code = false;
  let result = '';
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('```')) {
      if (list) { result += '</ul>'; list = false; }
      result += code ? '</code></pre>' : '<pre class="course-code"><code>';
      code = !code;
      continue;
    }
    if (code) { result += `${esc(line)}\n`; continue; }
    if (/^[-*]\s/.test(line)) {
      if (!list) { result += '<ul>'; list = true; }
      result += `<li>${esc(line.slice(2))}</li>`;
      continue;
    }
    if (list) { result += '</ul>'; list = false; }
    if (/^###\s/.test(line)) result += `<h3>${esc(line.slice(4))}</h3>`;
    else if (/^##\s/.test(line)) result += `<h2>${esc(line.slice(3))}</h2>`;
    else if (/^#\s/.test(line)) result += `<h2 class="course-note-lead">${esc(line.slice(2))}</h2>`;
    else if (line.trim()) result += `<p>${esc(line)}</p>`;
  }
  if (list) result += '</ul>';
  if (code) result += '</code></pre>';
  return result;
}

export function mountCourses(ctx, courseId) {
  const { root, state, save, esc, icon, toast, modal, go, uid, putFile, getFile, download } = ctx;
  let activeTab = 'notes';
  let selectedNoteId = '';
  let selectedFileId = '';
  let query = '';
  let filter = 'all';
  let objectUrl = '';
  let previewRequest = 0;
  let uploading = false;
  let alive = true;
  let canvasCleanup = null;
  let detailView = 'board';
  const visibleRecords=items=>(items||[]).filter(item=>!item.archived);
  const course = state.courses.find(item => item.id === courseId&&!item.archived);
  if (course) { course.notes ||= []; course.files ||= []; selectedNoteId = visibleRecords(course.notes)[0]?.id || ''; }
  const glyph = (name, size) => icon(name, size);
  const releasePreview = () => { previewRequest++; if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; };
  const touch = () => { course.updatedAt = new Date().toISOString(); save(); };
  const colorOf = item => /^#[\da-f]{6}$/i.test(item.color || '') ? item.color : '#7950f2';

  const matchesCourse = item => !item.archived&&`${item.title} ${item.subtitle || ''}`.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || (filter === 'example' ? item.example : !item.example));

  function courseCard(card, item) {
    return `<div class="course-library-card" style="--course-color:${colorOf(item)}">
      <div class="cv-card-copy"><span class="cv-card-kicker">${item.example ? 'LEARNING / 学习资料' : 'MY CLASSROOM / 我的课程'}</span><h2><button class="course-title-link" data-card-open data-course-action="open-course" data-id="${esc(item.id)}">${esc(item.title)}</button></h2><p>${esc(item.subtitle || '从一份课件，开始建立自己的知识脉络。')}</p></div>
      <div class="course-canvas-chapters">${visibleRecords(item.notes).slice(0, 2).map(note => `<span>${glyph('chevron-right', 13)}<span>${esc(note.chapter || note.title)}</span></span>`).join('') || '<span>课件、笔记和你的理解，都放在这里。</span>'}</div>
      <div class="course-canvas-watermark" aria-hidden="true">${glyph(item.icon || 'book', 72)}</div>
      <div class="cv-space-counts"><span>${visibleRecords(item.files).length} 份资料</span><span>${visibleRecords(item.notes).length} 篇笔记</span></div>
    </div>`;
  }

  function refreshCourseCards() {
    canvasCleanup?.refreshCards?.();
    const count = state.courses.filter(matchesCourse).length;
    const empty = root.querySelector('[data-course-empty]');
    if (empty) {
      empty.hidden = count > 0;
      empty.innerHTML = count ? '' : `${glyph('search', 25)}<strong>${visibleRecords(state.courses).length ? '还没有找到这门课' : '从第一门课程开始'}</strong><span>${visibleRecords(state.courses).length ? '换个关键词或筛选条件，也可以新建课程。' : '点击右上角“新建课程”，为课件和笔记留一个位置。'}</span>`;
    }
  }

  function enterCourse(id, element) {
    if (ctx.enterCard) return ctx.enterCard(id, element);
    go('courses', id);
  }

  function renderIndex() {
    releasePreview();
    canvasCleanup?.();
    root.innerHTML = `<section class="courses-page course-canvas-page"><div data-course-canvas></div><p class="course-example-hint">${glyph('info', 15)} 拖入卡片的资料会保存在对应课程。在课程内选择资料，即可交给 AI 讨论整理。</p></section>`;
    state.courseCanvas ||= {};
    const host = root.querySelector('[data-course-canvas]');
    canvasCleanup = mountCanvas({ ...ctx, root: host, createSpace: newCourse, editSpace: editCourse, enterCard: enterCourse, dropOnCard: async (id, files) => {
      const target = state.courses.find(item => item.id === id);
      if (!target||target.archived) throw new Error('课程已归档或不存在，请刷新后重试。');
      return uploadFiles(files, target);
    } }, {
      layout: state.courseCanvas, items: state.courses, title: '课程空间', eyebrow: 'YOUR KNOWLEDGE, CONNECTED', description: '把每门课铺开，长按卡片就能自由摆放。', createLabel: '新建课程', cardLabel: '课程空间',
      toolbar: `<div class="course-library-toolbar"><div class="tabs" aria-label="课程筛选"><button class="tab ${filter === 'all' ? 'active' : ''}" data-course-action="filter" data-filter="all">全部课程 <span>${visibleRecords(state.courses).length}</span></button><button class="tab ${filter === 'mine' ? 'active' : ''}" data-course-action="filter" data-filter="mine">我创建的</button><button class="tab ${filter === 'example' ? 'active' : ''}" data-course-action="filter" data-filter="example">参考课程</button></div><label class="course-search">${glyph('search', 18)}<input type="search" data-course-search value="${esc(query)}" placeholder="搜索课程…" aria-label="搜索课程"></label></div>`,
      matches: matchesCourse, renderCard: courseCard, emptyHTML: false
    });
    host.querySelector('.cv-viewport')?.insertAdjacentHTML('beforeend', '<div class="course-canvas-empty" data-course-empty role="status" hidden></div>');
    refreshCourseCards();
  }

  function noteReading(note) {
    if (!note) return `<div class="empty-state course-reader-empty">${glyph('book', 38)}<h2>知识从第一篇笔记开始</h2><p>把课堂上的理解、疑问和例题留在这里。</p><button class="btn primary" data-course-action="new-note">${glyph('plus', 17)} 写第一篇笔记</button></div>`;
    return `<header class="course-reading-head"><div class="course-note-overline"><span>${esc(note.chapter || '学习笔记')}</span><span class="badge">${note.example ? '参考笔记' : '手动笔记'}</span></div><h2>${esc(note.title)}</h2><div class="course-note-meta"><span>${dateLabel(note.updatedAt)}</span><span>版本 ${(note.revisions?.length || 0) + 1}</span><span>约 ${Math.max(1, Math.ceil(note.content.length / 450))} 分钟阅读</span></div><div class="course-note-actions"><button class="btn soft" data-course-action="edit-note" data-id="${esc(note.id)}">${glyph('edit', 16)} 编辑笔记</button><button class="btn" data-course-action="export-note" data-id="${esc(note.id)}">${glyph('download', 16)} 导出</button><button class="icon-btn" data-course-action="revisions" data-id="${esc(note.id)}" aria-label="查看笔记修订记录" title="修订记录">${glyph('clock', 18)}</button></div></header><div class="course-source-callout">${glyph('info', 17)}<p>${esc(note.source || '由你手动记录，尚未关联原始资料。')}</p></div><article class="course-note-body">${richText(note.content, esc)}</article><footer class="course-reading-footer">${glyph('check', 16)} ${note.example ? '起始资料 · 编辑时保留历史修订' : '笔记已保存到本机 · 编辑时保留上一版本'}</footer>`;
  }

  function detailCard(card, item) {
    const isNote = activeTab === 'notes';
    const excerpt = isNote ? String(item.content || '').replace(/^#{1,6}\s*/gm, '').replace(/\n+/g, ' ').slice(0, 800) : `${readableSize(item.size)} · 原件完整保存在本机`;
    return `<div class="course-detail-card-copy"><div class="cv-card-copy"><span class="cv-card-kicker">${isNote ? esc(item.chapter || '学习笔记') : esc(item.name?.split('.').pop().toUpperCase() || 'FILE')}</span><h2><button class="course-title-link" data-card-open data-course-action="${isNote ? 'select-note' : 'select-file'}" data-id="${esc(item.id)}">${esc(item.title)}</button></h2><p>${esc(excerpt)}</p></div><div class="course-detail-card-mark" aria-hidden="true">${glyph(isNote ? 'book' : 'file', 64)}</div><div class="course-detail-card-meta"><span>${isNote ? item.example ? '参考资料' : '我的笔记' : '原始资料'}</span><span>${isNote ? `版本 ${(item.revisions?.length || 0) + 1}` : dateLabel(item.createdAt)}</span></div></div>`;
  }

  function showDetailItem(id) {
    if (activeTab === 'notes') selectedNoteId = id; else selectedFileId = id;
    detailView = 'reader'; renderDetail();
    root.querySelector('.course-reader-return')?.focus({ preventScroll: true });
  }

  function renderDetail() {
    releasePreview();
    canvasCleanup?.(); canvasCleanup = null;
    const isNote = activeTab === 'notes';
    const note = visibleRecords(course.notes).find(item => item.id === selectedNoteId) || visibleRecords(course.notes)[0];
    const file = visibleRecords(course.files).find(item => item.id === selectedFileId) || visibleRecords(course.files)[0];
    if (note) selectedNoteId = note.id;
    if (file) selectedFileId = file.id;
    if (!(isNote ? note : file)) detailView = 'board';
    const boardKey = `course:${course.id}:${activeTab}`;
    state.boards ||= {}; state.boards[boardKey] ||= {};
    const selected = isNote ? note : file;
    const selectedColor = state.boards[boardKey].cards?.find(card => card.id === selected?.id)?.color || colorOf(course);
    const fileReader = file ? `<header class="course-file-head"><div><span class="eyebrow">原始资料 · 仅本机</span><h2>${esc(file.name)}</h2><p class="muted">${readableSize(file.size)} · ${dateLabel(file.createdAt)}上传</p></div><button class="btn" data-course-action="download-file" data-id="${esc(file.id)}">${glyph('download', 17)} 下载原件</button></header><div data-course-file-preview class="course-file-preview"><div class="empty-state">正在读取本机文件…</div></div>` : '';
    root.innerHTML = `<section class="courses-page course-detail course-card-workspace" style="--course-color:${colorOf(course)};--course-fill:${canvasCardFill(colorOf(course))}"><button class="course-back" data-course-action="back">${glyph('arrow-left', 17)} 全部课程</button><header class="page-head course-detail-head course-detail-hero"><div class="course-detail-title"><span class="course-symbol">${glyph(course.icon || 'book', 25)}</span><div><div class="eyebrow">${course.example ? '课程资料' : '我的课程空间'}</div><h1>${esc(course.title)}</h1><p>${esc(course.subtitle || '让每一份资料、每一次理解，都有自己的位置。')}</p></div></div><div class="course-head-actions"><button class="btn" data-course-action="preferences">${glyph('settings', 17)} 助教偏好</button><button class="btn primary" data-course-action="upload">${glyph('upload', 17)} 上传资料</button></div></header>
      <div class="course-detail-navigation"><div class="tabs" aria-label="课程内容"><button class="tab ${isNote ? 'active' : ''}" data-course-action="tab" data-tab="notes">学习笔记 <span>${visibleRecords(course.notes).length}</span></button><button class="tab ${!isNote ? 'active' : ''}" data-course-action="tab" data-tab="files">课程资料 <span>${visibleRecords(course.files).length}</span></button></div><div class="course-detail-navigation-actions"><button class="btn course-ai-entry" data-course-action="ai">${glyph('sparkles', 17)} 整理课程资料</button>${isNote ? `<button class="btn primary" data-course-action="new-note">${glyph('plus', 17)} 新建笔记</button>` : ''}</div></div>
      <div class="course-workspace ${detailView === 'board' ? 'course-board-workspace' : 'course-reader-workspace'}">${detailView === 'board' ? '<div data-course-detail-canvas></div>' : `<div class="course-reader-card" style="--reader-color:${colorOf({ color: selectedColor })};--reader-fill:${canvasCardFill(selectedColor)}"><div class="course-reader-top"><button class="course-reader-return" data-course-action="back-board">${glyph('arrow-left', 17)} 返回${isNote ? '笔记' : '资料'}卡片</button><span>${glyph(isNote ? 'book' : 'file', 16)} ${isNote ? '学习笔记' : '课程资料'}</span></div><div class="course-reading-panel ${!isNote ? 'course-file-reader' : ''}">${isNote ? noteReading(note) : fileReader}</div></div>`}</div>
      <p class="course-board-footnote">${glyph('info', 15)} 文件可以拖入这个课程空间。正文提取不调用模型；AI 整理需单独连接模型。</p><input type="file" class="course-file-input" data-course-files multiple accept=".ppt,.pptx,.docx,.pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif" aria-label="选择课程资料"></section>`;
    if (detailView === 'reader') { if (!isNote && file) showFile(file); return; }
    const palette = ['#B3A0FF', '#63E6DC', '#FF9CCE', '#D8F649', '#9DC5FF', '#FFBC7C'];
    const items = (isNote ? course.notes : course.files).map((item, index) => ({ ...item, title: isNote ? item.title : item.name, color: item.color || palette[index % palette.length], icon: isNote ? 'book' : 'file' }));
    const emptyHTML = isNote ? `<div class="course-board-empty">${glyph('book', 37)}<h2>把这门课的理解铺开</h2><p>每篇笔记都是一张可以摆放的卡片。</p><button class="btn primary" data-course-action="new-note">${glyph('plus', 17)} 写第一篇笔记</button></div>` : `<div class="course-board-empty" data-course-dropzone>${glyph('upload', 37)}<h2>把这一门课的资料放进来</h2><p>拖入课件、课堂记录或截图，原件会留在这里。</p><button class="btn primary" data-course-action="upload">选择文件</button><small>PPT / DOCX / PDF / TXT / CSV / 图片 · 单文件不超过 40 MB</small></div>`;
    const host = root.querySelector('[data-course-detail-canvas]');
    canvasCleanup = mountCanvas({ ...ctx, root: host, createSpace: () => isNote ? editNote() : root.querySelector('[data-course-files]').click(), editSpace: id => isNote && editNote(course.notes.find(item => item.id === id)), enterCard: showDetailItem }, {
      layout: state.boards[boardKey], sourceItems: isNote ? course.notes : course.files, items, title: isNote ? '笔记卡片' : '资料卡片', hideHeader: true, createLabel: false, cardLabel: isNote ? '学习笔记' : '原始资料', footLabel: isNote ? '留下自己的理解' : '保留上传原件', enterLabel: isNote ? '阅读笔记' : '打开资料', emptyHTML, canDrop: false, matches:item=>!item.archived, onEdit: isNote ? id => editNote(course.notes.find(item => item.id === id)) : null, manageLabel: '编辑笔记', renderCard: detailCard
    });
  }

  async function showFile(file) {
    const request = ++previewRequest;
    const host = root.querySelector('[data-course-file-preview]');
    try {
      const blob = await getFile(file.blobId);
      if (request !== previewRequest || !host?.isConnected) return;
      if (!blob) throw new Error('not-found');
      const ext = file.name.split('.').pop().toLowerCase();
      if (['txt', 'md', 'csv'].includes(ext)) {
        const text = await blob.slice(0, 500000).text();
        if (request !== previewRequest || !host.isConnected) return;
        host.innerHTML = `<pre class="course-text-preview">${esc(text)}</pre>${blob.size > 500000 ? '<p class="course-preview-note">预览显示前 500 KB，请下载查看完整文件。</p>' : ''}`;
      } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
        objectUrl = URL.createObjectURL(blob);
        host.innerHTML = `<img class="course-image-preview" src="${esc(objectUrl)}" alt="${esc(file.name)}">`;
      } else if (ext === 'pdf') {
        objectUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        host.innerHTML = `<iframe class="course-pdf-preview" src="${esc(objectUrl)}" title="${esc(file.name)}"></iframe><p class="course-preview-note">若浏览器无法显示 PDF，请点击“下载原件”查看。</p>`;
      } else {
        host.innerHTML = `<div class="empty-state course-ppt-empty"><span class="course-ppt-symbol">${ext==='docx'?'W':'P'}</span><h3>文档原件已保存</h3><p>可下载后用对应软件打开。${ext==='ppt'?'旧版 PPT 暂不支持正文提取，可先另存为 PPTX 后重新上传。':'下方可提取正文，不调用模型。'}</p><button class="btn soft" data-course-action="download-file" data-id="${esc(file.id)}">${glyph('download', 17)} 下载原件</button></div>`;
      }
      mountFileText(ctx, host, file);
    } catch {
      if (request === previewRequest && host?.isConnected) host.innerHTML = `<div class="empty-state"><h3>这份文件暂时无法读取</h3><p>本机文件可能已被浏览器清理，请重新上传原件。</p><button class="btn primary" data-course-action="upload">重新上传</button></div>`;
    }
  }

  function newCourse() {
    const colorDraft = createColorDraft(state);
    modal({ title: '新建课程', submitLabel: '创建课程', body: `<div class="stack"><label class="field">课程名称<input name="title" required maxlength="60" placeholder="例如：软件测试与质量保证" autofocus></label><label class="field">一句话描述<input name="subtitle" maxlength="120" placeholder="这门课，你想弄明白什么？"></label><label class="field">课程颜色<input name="color" type="color" value="${colorDraft.color}"><small>自动配色，也可以手动选择。</small></label><p class="muted">每门课都会有独立的资料、笔记和助教偏好。</p></div>`, onSubmit(data) {
      const title = String(data.get('title') || '').trim();
      if (!title) { toast('请填写课程名称'); return false; }
      const id = uid();
      const previousColor = state.ui?.lastCreatedColor, previousUpdatedAt = state.updatedAt;
      const created = { id, title, subtitle: String(data.get('subtitle') || '').trim(), color: colorDraft.commit(String(data.get('color'))), icon: 'book', example: false, prompt: DEFAULT_PROMPT, notes: [], files: [], updatedAt: new Date().toISOString() };
      state.courses.unshift(created);
      try { save(); } catch(error) { state.courses.splice(state.courses.indexOf(created), 1);state.updatedAt=previousUpdatedAt;if(previousColor===undefined)delete state.ui.lastCreatedColor;else state.ui.lastCreatedColor=previousColor;throw error; }
      toast('课程已创建'); go('courses', id);
    } });
    colorDraft.bind(document.querySelector('#modal form'));
  }

  function editCourse(id) {
    const target = state.courses.find(item => item.id === id);
    if (!target) return;
    modal({ title: '修改课程', submitLabel: '保存课程', body: `<div class="stack"><label class="field">课程名称<input name="title" required maxlength="60" value="${esc(target.title)}"></label><label class="field">一句话描述<input name="subtitle" maxlength="120" value="${esc(target.subtitle || '')}" placeholder="这门课，你想弄明白什么？"></label><p class="muted">修改名称不会改变这门课已有的资料、笔记和助教偏好。</p></div>`, onSubmit(data) {
      const title = String(data.get('title') || '').trim();
      if (!title) { toast('请填写课程名称'); return false; }
      const previous = {title:target.title,subtitle:target.subtitle,updatedAt:target.updatedAt}, previousUpdatedAt = state.updatedAt;
      target.title = title; target.subtitle = String(data.get('subtitle') || '').trim(); target.updatedAt = new Date().toISOString();
      try { save(); } catch(error) { Object.assign(target,previous);state.updatedAt=previousUpdatedAt;throw error; }
      if (alive) refreshCourseCards(); toast('课程已更新');
    } });
  }

  function editNote(note) {
    modal({ title: note ? '编辑学习笔记' : '新建学习笔记', submitLabel: note ? '保存修订' : '保存笔记', body: `<div class="stack"><label class="field">笔记标题<input name="title" required maxlength="100" value="${esc(note?.title || '')}" placeholder="给这次理解起个名字" autofocus></label><label class="field">所属章节<input name="chapter" maxlength="60" value="${esc(note?.chapter || '')}" placeholder="例如：第三章 · 栈与队列"></label><label class="field">笔记正文<textarea class="course-note-editor" name="content" required rows="13" placeholder="写下重点、自己的理解和还没弄懂的问题。支持 # 标题、- 列表和代码块。">${esc(note?.content || '')}</textarea></label><label class="field">来源说明<input name="source" maxlength="300" value="${esc(note?.source || '')}" placeholder="例如：课堂记录；或填写你核对过的文件名与页码"></label>${note ? '<p class="muted">保存时保留上一版本，可随时在修订记录中查看。</p>' : ''}</div>`, onSubmit(data) {
      const title = String(data.get('title') || '').trim();
      const content = String(data.get('content') || '').trim();
      if (!title || !content) { toast('请填写笔记标题和正文'); return false; }
      const values = { title, content, chapter: String(data.get('chapter') || '').trim(), source: String(data.get('source') || '').trim(), updatedAt: new Date().toISOString() };
      const previousNotes = structuredClone(course.notes), previousUpdatedAt = course.updatedAt, previousStateUpdatedAt = state.updatedAt, previousColor = state.ui?.lastCreatedColor, previousSelection = selectedNoteId;
      try {
        if (note) {
          note.revisions ||= [];
          note.revisions.push({ title: note.title, content: note.content, chapter: note.chapter, source: note.source, updatedAt: note.updatedAt, savedAt: values.updatedAt });
          Object.assign(note, values);
          selectedNoteId = note.id;
        } else {
          const created = { id: uid(), ...values, color: assignRecordColor(state), example: false, revisions: [] };
          course.notes.unshift(created); selectedNoteId = created.id;
        }
        touch();
      } catch(error) { if(note){const original=previousNotes.find(item=>item.id===note.id);for(const key of Object.keys(note))delete note[key];Object.assign(note,original);course.notes=previousNotes.map(item=>item.id===note.id?note:item);}else course.notes=previousNotes;course.updatedAt=previousUpdatedAt;state.updatedAt=previousStateUpdatedAt;selectedNoteId=previousSelection;if(state.ui){if(previousColor===undefined)delete state.ui.lastCreatedColor;else state.ui.lastCreatedColor=previousColor;}throw error; }
      activeTab = 'notes'; detailView = 'reader'; renderDetail(); toast('笔记已保存到本机');
    } });
  }

  function preferences() {
    modal({ title: `${course.title} · 助教偏好`, submitLabel: '保存偏好', body: `<div class="stack"><div class="course-modal-info">${glyph('sparkles', 20)}<p>这份说明只用于当前课程。进入 AI 对话后，整理这门课时会参考这份偏好。</p></div><label class="field">你希望助教怎样整理<textarea name="prompt" rows="13" required class="course-note-editor">${esc(course.prompt || DEFAULT_PROMPT)}</textarea></label><p class="muted">可以补充教材版本、关注章节、解释深度，以及你习惯的笔记格式。当前仅保存偏好，不会调用模型。</p></div>`, onSubmit(data) { const prompt = String(data.get('prompt') || '').trim(); if (!prompt) { toast('请填写整理偏好'); return false; } course.prompt = prompt; touch(); toast('课程助教偏好已保存'); } });
  }

  function organizeCourse(){
    const targetId=`course:${course.id}`,draft=state.aiDraft;
    if(draft?.text?.trim()||draft?.files?.length)return openAIConversation(ctx,{targetId});
    const files=(course.files||[]).filter(file=>!file.archived&&file.blobId);
    const selected=activeTab==='files'&&selectedFileId?selectedFileId:'';
    modal({title:`整理「${course.title}」`,submitLabel:'带入 AI 对话',body:`<p class="muted">选择本次要整理的资料。进入对话后可以继续补充，审核方案并确认后才会修改课程。</p><label class="field">先告诉助教什么<textarea name="instruction" rows="3" maxlength="30000">请结合本课程助教偏好${files.length?'和我选择的资料':''}，先和我确认整理目标，再生成课程笔记方案。</textarea></label>${files.length?`<fieldset class="course-ai-file-picker"><legend>课程资料 · 每次最多 12 份</legend>${files.map((file,index)=>`<label><input type="checkbox" name="fileId" value="${esc(file.id)}" ${(selected?file.id===selected:index<12)?'checked':''}><span>${esc(file.name)}</span></label>`).join('')}</fieldset>`:'<p class="muted small">还没有上传资料。你可以先聊目标，或在对话中添加附件。</p>'}`,onSubmit:data=>{
      const ids=new Set(data.getAll('fileId').map(String));
      openAIConversation(ctx,{targetId,text:String(data.get('instruction')||'').trim(),files:files.filter(file=>ids.has(file.id))});
    }});
  }

  async function uploadFiles(files, target = course) {
    if (uploading) throw new Error('上一批资料正在保存，请稍候。');
    if (!files.length || !target) return { saved: 0, rejected: 0 };
    uploading = true;
    const originalView = root.querySelector('.courses-page');
    let succeeded = 0;
    let rejected = 0;
    try {
      for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['ppt', 'pptx', 'docx', 'pdf', 'txt', 'md', 'csv', 'png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) || file.size > 40 * 1024 * 1024) { rejected++; continue; }
        try {
          const blobId = await putFile(file);
          const previousColor = state.ui?.lastCreatedColor, previousUpdatedAt = target.updatedAt, previousStateUpdatedAt = state.updatedAt, previousSelection = selectedFileId;
          const entry = { id: uid(), blobId, name: file.name, size: file.size, type: file.type, createdAt: new Date().toISOString(), color: assignRecordColor(state) };
          target.files ||= [];
          target.files.unshift(entry); target.updatedAt = new Date().toISOString();
          try { save(); } catch(error) { target.files.splice(target.files.indexOf(entry),1);target.updatedAt=previousUpdatedAt;state.updatedAt=previousStateUpdatedAt;selectedFileId=previousSelection;if(previousColor===undefined)delete state.ui.lastCreatedColor;else state.ui.lastCreatedColor=previousColor;throw error; }
          if (target === course) selectedFileId = entry.id; succeeded++;
        } catch { rejected++; }
      }
      if (succeeded) {
        if (alive && originalView?.isConnected) {
          if (target === course) { activeTab = 'files'; detailView = 'board'; renderDetail(); }
          else refreshCourseCards();
        }
      }
      toast(succeeded ? `已保存 ${succeeded} 份资料到「${target.title}」${rejected ? `，${rejected} 份未保存，请检查格式、大小或浏览器空间` : ''}` : '文件未保存，请检查格式、40 MB 大小限制或浏览器空间');
      return { saved: succeeded, rejected };
    } finally { uploading = false; }
  }

  root.onclick = async event => {
    const button = event.target.closest('[data-course-action]');
    if (!button || !root.contains(button)) return;
    const action = button.dataset.courseAction;
    const id = button.dataset.id;
    if (action === 'new-course') return newCourse();
    if (action === 'open-course') return enterCourse(id, button.closest('[data-card]'));
    if (action === 'filter') {
      filter = button.dataset.filter;
      root.querySelectorAll('[data-course-action="filter"]').forEach(item => item.classList.toggle('active', item.dataset.filter === filter));
      return refreshCourseCards();
    }
    if (action === 'back') { releasePreview(); return go('courses'); }
    if (!course) return;
    if (action === 'tab') { activeTab = button.dataset.tab; detailView = 'board'; return renderDetail(); }
    if (action === 'back-board') { detailView = 'board'; return renderDetail(); }
    if (action === 'select-note') { activeTab = 'notes'; return showDetailItem(id); }
    if (action === 'select-file') { activeTab = 'files'; return showDetailItem(id); }
    if (action === 'upload') return root.querySelector('[data-course-files]')?.click();
    if (action === 'new-note') return editNote();
    if (action === 'edit-note') return editNote(course.notes.find(item => item.id === id));
    if (action === 'preferences') return preferences();
    if (action === 'ai') return organizeCourse();
    if (action === 'export-note') {
      const note = course.notes.find(item => item.id === id);
      if (note) download(new Blob([`# ${note.title}\n\n${note.example ? '> 参考笔记\n\n' : ''}${note.content}\n\n---\n来源：${note.source || '手动记录'}\n`], { type: 'text/markdown;charset=utf-8' }), `${note.title.replace(/[<>:"/\\|?*]/g, '_')}.md`);
    }
    if (action === 'revisions') {
      const note = course.notes.find(item => item.id === id);
      if (!note) return;
      modal({ title: '笔记修订记录', body: `<div class="course-revisions"><p class="muted">当前为版本 ${(note.revisions?.length || 0) + 1}。每次编辑前的内容都保留在这里。</p>${[...(note.revisions || [])].reverse().map((revision, index) => `<details><summary><strong>版本 ${note.revisions.length - index} · ${esc(revision.title)}</strong><span>${dateLabel(revision.updatedAt)}</span></summary><div class="course-revision-body">${richText(revision.content, esc)}</div></details>`).join('') || '<div class="empty-state"><p>还没有历史修订。下一次编辑保存时，会保留当前版本。</p></div>'}</div>` });
    }
    if (action === 'download-file') {
      const file = course.files.find(item => item.id === id);
      if (!file) return;
      try { const blob = await getFile(file.blobId); if (!blob) throw new Error('missing'); download(blob, file.name); } catch { toast('无法读取原件，请重新上传文件'); }
    }
  };
  root.oninput = event => { if (event.target.matches('[data-course-search]')) { query = event.target.value; refreshCourseCards(); } };
  root.onchange = event => { if (event.target.matches('[data-course-files]')) { const files = [...event.target.files]; event.target.value = ''; uploadFiles(files).catch(error => toast(error.message || '文件未保存，请重试。')); } };
  root.ondragover = event => { if (course && event.dataTransfer?.types?.includes('Files')) { event.preventDefault(); root.querySelector('.course-workspace')?.classList.add('dragging'); } };
  root.ondragleave = event => { if (!root.contains(event.relatedTarget)) root.querySelector('.course-workspace')?.classList.remove('dragging'); };
  root.ondrop = event => { if (!course) return; event.preventDefault(); root.querySelector('.course-workspace')?.classList.remove('dragging'); uploadFiles([...event.dataTransfer.files]).catch(error => toast(error.message || '文件未保存，请重试。')); };
  if (courseId && !course) {
    root.innerHTML = `<div class="empty-state"><h2>这门课程已归档或不存在</h2><p>返回课程空间查看其他课程。</p><button class="btn primary" data-course-action="back">返回课程空间</button></div>`;
  } else if (course) renderDetail(); else renderIndex();
  return () => { alive = false; canvasCleanup?.(); releasePreview(); };
}
