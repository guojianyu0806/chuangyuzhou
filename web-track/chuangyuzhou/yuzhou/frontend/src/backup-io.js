import { getFile, putFile } from './services.js';

const maxBackupBytes = 512 * 1024 * 1024;

function attachmentIds(state, ids = new Set()) {
  if (!state || typeof state !== 'object') return ids;
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'string' && /blobId|fileId|audioId/i.test(key)) ids.add(value);
    else if (typeof value === 'object') attachmentIds(value, ids);
  }
  return ids;
}

function attachmentData(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function createWorkspaceBackup(state) {
  const files = [];
  for (const id of attachmentIds(state)) {
    const blob = await getFile(id);
    if (!blob) throw new Error('有附件在本机存储中缺失，请重新添加原件后再导出完整备份。');
    files.push({ id, type: blob.type, data: await attachmentData(blob) });
  }
  const contents = { format: 'lumi-backup', version: 1, exportedAt: new Date().toISOString(), state, files };
  const blob = new Blob([JSON.stringify(contents, null, 2)], { type: 'application/json' });
  if (blob.size > maxBackupBytes) throw new Error('完整备份超过本地界面版 512 MB 上限，请先逐份下载附件，并在服务器接入后使用云端备份。');
  return blob;
}

export async function prepareWorkspaceImport(state, file, isCurrent) {
  if (!file?.size || file.size > maxBackupBytes) throw new Error('请选择小于 512 MB 的创宇宙 JSON 备份。');
  let value;
  try { value = JSON.parse(await file.text()); }
  catch { throw new Error('文件不是有效的 JSON 备份。'); }

  const { validateBackup, mergeBackup } = await import('./backup.js');
  if (!isCurrent()) return null;
  const backup = validateBackup(value);
  const available = new Set(backup.files.map(entry => entry.id));
  for (const id of attachmentIds(backup.state)) {
    if (!available.has(id) && !await getFile(id)) throw new Error('备份缺少附件原件，无法完整恢复，请选择完整备份。');
  }
  for (const entry of backup.files) {
    if (await getFile(entry.id)) continue;
    if (!isCurrent()) return null;
    const raw = atob(entry.data.slice(entry.data.indexOf(',') + 1));
    await putFile(new Blob([Uint8Array.from(raw, char => char.charCodeAt(0))], { type: entry.type }), entry.id);
  }
  return isCurrent() ? mergeBackup(state, backup) : null;
}
