import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('.', import.meta.url));
const url = 'http://127.0.0.1:4173';
async function ready() {
  try {
    const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    const health = await response.json();
    return response.ok && health.status === 'ok' && health.mode === 'local-ui' && health.backendConfigured === false;
  } catch { return false; }
}

try {
  if (!await ready()) {
    const logs = path.join(root, '.runtime');
    mkdirSync(logs, { recursive: true });
    const stamp = Date.now();
    const outputPath = path.join(logs, `${stamp}.stdout.log`);
    const errorPath = path.join(logs, `${stamp}.stderr.log`);
    const out = openSync(outputPath, 'a');
    const err = openSync(errorPath, 'a');
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: root, detached: true, windowsHide: true,
      stdio: ['ignore', out, err],
      env: { ...process.env, HOST: '127.0.0.1', PORT: '4173' }
    });
    closeSync(out); closeSync(err);
    let failure;
    child.on('error', error => { failure = error; });
    child.unref();
    let started = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (failure) throw failure;
      if (await ready()) { started = true; break; }
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    if (!started) throw new Error(`宇宙工作台启动失败，请查看 ${errorPath}`);
  }
  console.log(`宇宙工作台已就绪: ${url}`);
  console.log('It runs in the background. You may close this launcher.');
  if (!process.argv.includes('--no-open')) {
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => console.error(`Please open ${url} in your browser.`));
    browser.unref();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
