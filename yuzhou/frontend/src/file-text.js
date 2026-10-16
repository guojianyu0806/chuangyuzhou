import {escapeHTML} from './services.js';

const FORMATS = new Set(['txt', 'md', 'csv', 'docx', 'pptx', 'pdf']);
export const supportsFileText = file => FORMATS.has(String(file?.name || '').split('.').pop().toLowerCase());

export async function requestFileText(ctx, file) {
  if (!ctx.cloud?.enabled || ctx.state.mode !== 'personal') throw new Error('请在本机工作台的个人空间中提取正文，请先登录后操作。');
  if (!supportsFileText(file)) throw new Error('此格式暂不支持正文提取，原件仍可下载。');
  if (!file.blobId) throw new Error('没有找到文件记录，请重新添加原件。');
  // Reuse the attachment sync queue so a newly selected file is available.
  await ctx.cloud.flush();
  const result = await ctx.cloud.request(`/api/files/${encodeURIComponent(file.blobId)}/text`);
  if (!Array.isArray(result?.units) || result.units.some(unit => typeof unit?.text !== 'string' || typeof unit?.label !== 'string') || !Array.isArray(result.warnings) || result.warnings.some(warning => typeof warning !== 'string')) {
    throw new Error('正文提取结果格式异常，请重试；原件仍保留。');
  }
  return result;
}

export function fileTextResultHTML(result) {
  const warnings = result.warnings.length ? `<div class="file-text-warnings" role="status"><strong>提取说明</strong><ul>${result.warnings.map(warning => `<li>${escapeHTML(warning)}</li>`).join('')}</ul></div>` : '';
  const units = result.units.filter(unit => unit.text.trim());
  return warnings + (units.length
    ? `<details open class="file-text-result"><summary>查看正文 · ${units.length} 段</summary>${units.map(unit => `<section><h3>${escapeHTML(unit.label || '正文')}</h3><pre>${escapeHTML(unit.text)}</pre></section>`).join('')}</details>`
    : '<p class="muted">没有提取到可读正文。文件可能只有扫描图片或没有文字，原件仍可下载。</p>');
}

/** Adds a local extraction view without replacing the existing original preview. */
export function mountFileText(ctx, host, file) {
  if (!host?.isConnected || !supportsFileText(file)) return;
  const panel = document.createElement('section');
  panel.className = 'file-text-panel';
  panel.innerHTML = '<div class="file-text-heading"><strong>资料正文</strong><button type="button" class="btn" data-file-text>提取正文</button></div><p class="small muted">在本机工作台解析文件，不调用模型；原件和现有预览保留。</p><div data-file-text-result aria-live="polite"></div>';
  host.append(panel);
  const button = panel.querySelector('[data-file-text]');
  const resultHost = panel.querySelector('[data-file-text-result]');
  button.onclick = async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = '正在提取…';
    resultHost.textContent = '正在同步原件并提取正文…';
    try {
      const result = await requestFileText(ctx, file);
      if (!panel.isConnected) return;
      resultHost.innerHTML = fileTextResultHTML(result);
      button.textContent = '重新提取';
    } catch (error) {
      if (!panel.isConnected) return;
      resultHost.textContent = `提取未完成：${error.message || '请稍后重试。'} 原件不会被删除。`;
      button.textContent = '重试提取';
    } finally {
      if (panel.isConnected) button.disabled = false;
    }
  };
}
