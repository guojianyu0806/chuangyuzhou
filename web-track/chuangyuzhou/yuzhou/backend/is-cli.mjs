import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Node resolves imported modules through deployment symlinks; argv keeps the invoked path. */
export function isCliEntry(moduleUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try { return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry); }
  catch { return false; }
}
