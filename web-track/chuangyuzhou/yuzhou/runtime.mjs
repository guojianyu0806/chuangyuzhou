import { lstatSync, realpathSync, readdirSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname, join, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
export const RUNTIME_ROOT = join(PROJECT_ROOT, '.cu-runtime');
export const FRONTEND_ROOT = join(PROJECT_ROOT, 'frontend');
export const DEFAULT_PORT = 4396;
export const COOKIE_NAME = 'czb_web_yuzhou_session';

function within(root, target) {
  const part = relative(resolve(root), resolve(target));
  return !part || (!part.startsWith('..') && !isAbsolute(part));
}

/** Reject links before reading or writing; a lexical prefix alone cannot isolate a copy. */
export function assertOrdinaryPath(value, boundary = PROJECT_ROOT) {
  const target = resolve(value);
  if (!within(boundary, target)) throw new Error('competition_path_outside_copy');
  const pieces = [];
  for (let cursor = target; ; cursor = dirname(cursor)) {
    pieces.unshift(cursor);
    if (cursor === parse(cursor).root) break;
  }
  for (const path of pieces) {
    let info;
    try { info = lstatSync(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1)) throw new Error('competition_links_forbidden');
    if (resolve(realpathSync(path)).toLowerCase() !== resolve(path).toLowerCase()) throw new Error('competition_links_forbidden');
  }
  return target;
}

export function assertRuntimePath(value) { return assertOrdinaryPath(value, RUNTIME_ROOT); }

export function assertOrdinaryTree(value, boundary = PROJECT_ROOT) {
  const root = assertOrdinaryPath(value, boundary);
  if (!existsSync(root)) return root;
  const info = lstatSync(root);
  if (info.isDirectory()) for (const name of readdirSync(root)) assertOrdinaryTree(join(root, name), boundary);
  else if (!info.isFile()) throw new Error('competition_special_file_forbidden');
  return root;
}

export function prepareDataDirectory(value = join(RUNTIME_ROOT, 'data')) {
  const directory = assertRuntimePath(value);
  assertOrdinaryTree(directory, RUNTIME_ROOT);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export function resolveCompetitionOptions(options = {}, env = {}) {
  assertOrdinaryPath(PROJECT_ROOT);
  const host = options.host ?? env.CZB_YUZHOU_HOST ?? env.HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1') throw new Error('competition_localhost_only');
  const port = Number(options.port ?? env.CZB_YUZHOU_PORT ?? env.PORT ?? DEFAULT_PORT);
  if (port !== DEFAULT_PORT) throw new Error('competition_port_must_be_4396');
  const dataDir = assertRuntimePath(options.dataDir ?? env.CZB_YUZHOU_DATA_DIR ?? env.DATA_DIR ?? join(RUNTIME_ROOT, 'data'));
  const frontendDir = assertOrdinaryPath(options.frontendDir ?? env.FRONTEND_DIR ?? FRONTEND_ROOT, FRONTEND_ROOT);
  if (frontendDir !== FRONTEND_ROOT) throw new Error('competition_frontend_must_be_copied_frontend');
  const setupTokenFile = assertRuntimePath(options.setupTokenFile ?? env.SETUP_TOKEN_FILE ?? join(dataDir, 'setup-code.txt'));
  if (env.SETUP_TOKEN) throw new Error('competition_inherited_setup_token_forbidden');
  for (const name of ['SHIGUANG_HERMES_DIR', 'SHIGUANG_HERMES_PYTHON', 'SHIGUANG_EXTRACT_PYTHON']) {
    if (env[name]) assertRuntimePath(env[name]);
  }
  return { host, port, dataDir, frontendDir, setupTokenFile };
}

/** Only this copy's token is read. Its value is never printed or placed in metadata. */
export function loadOrCreateSetupCode(path) {
  assertRuntimePath(path);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
  assertRuntimePath(path);
  const value = readFileSync(path, 'utf8').trim();
  if (value.length < 24 || value.length > 256) throw new Error('competition_setup_code_invalid');
  return value;
}
