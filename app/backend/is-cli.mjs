import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Node resolves imported modules through deployment symlinks; argv keeps the invoked path. */
export function isCliEntry(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try { return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry); }
  catch { return false; }
}

if (isCliEntry(import.meta.url)) {
  console.error('此文件仅为宇宙原后端的来源辅助模块，不能作为创宇宙启动入口。请从副本根目录运行 node start.mjs。');
  process.exitCode = 1;
}
