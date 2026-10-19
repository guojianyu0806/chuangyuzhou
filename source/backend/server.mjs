import { createServer } from 'node:http';
import { createReadStream, createWriteStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ApiError, createStore, digest, secretEqual, hashPassword, verifyPassword, validateCredentials, FILE_ID, MAX_FILE_BYTES, MAX_STATE_BYTES } from './store.mjs';
import { isCliEntry } from './is-cli.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
export const VERSION = '0.7.0';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json' };
const writeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const localHostnames = new Set(['127.0.0.1', 'localhost', '[::1]']);
export function json(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  const encoded = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(encoded) });
  res.end(encoded);
}
export async function readJson(req, maxBytes = 64 * 1024) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new ApiError(415, 'json_required');
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new ApiError(415, 'content_encoding_not_supported');
  if (Number(req.headers['content-length']) > maxBytes) { req.resume(); throw new ApiError(413, 'request_too_large'); }
  let bytes = 0; const chunks = [];
  for await (const chunk of req) { bytes += chunk.length; if (bytes > maxBytes) throw new ApiError(413, 'request_too_large'); chunks.push(chunk); }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, 'invalid_json'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'json_object_required');
  return value;
}
function cookieValue(req, key) {
  const entries = (req.headers.cookie || '').split(';').map(part => part.trim().split('='));
  return entries.find(([name]) => name === key)?.[1] || '';
}
function normalizeOrigin(value) {
  if (!value) return '';
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('PUBLIC_ORIGIN must be one http(s) origin');
  return parsed.origin;
}
export async function createWorkbenchServer(options = {}) {
  const secureCookie = options.secureCookie ?? true;
  const dataDir = options.dataDir || resolve(here, '../.private-cloud');
  const frontendDir = realpathSync(options.frontendDir || resolve(here, '../frontend'));
  const publicOrigin = normalizeOrigin(options.publicOrigin || '');
  if (!secureCookie && publicOrigin && !localHostnames.has(new URL(publicOrigin).hostname)) throw new Error('Insecure cookies are allowed only on localhost');
  const setupToken = options.setupToken || '';
  const cookieName = secureCookie ? '__Host-shiguang_session' : 'shiguang_session';
  const store = createStore(dataDir, options.storeOptions);
  const modelService = options.modelService || (options.modelFactory ? await options.modelFactory({ dataDir: store.directory, store }) : null);
  const fileUploadCounts = new Map();
  function securityHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (secureCookie && publicOrigin.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  function allowedOrigin(req) {
    if (publicOrigin) return publicOrigin;
    // Development fallback never trusts a remote Host or forwarded header.
    let target;
    try { target = new URL(`http://${req.headers.host}`); } catch { throw new ApiError(403, 'origin_forbidden'); }
    if (!localHostnames.has(target.hostname)) throw new ApiError(403, 'origin_forbidden');
    return target.origin;
  }
  function checkOrigin(req) {
    if (typeof req.headers.origin !== 'string' || req.headers.origin !== allowedOrigin(req)) throw new ApiError(403, 'origin_forbidden');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'origin_forbidden');
  }
  function setSessionCookie(res, session) {
    const age = Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000));
    res.setHeader('Set-Cookie', `${cookieName}=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secureCookie ? '; Secure' : ''}`);
  }
  function clientKey(req) {
    // Do not trust X-Forwarded-For: direct callers must not bypass throttling.
    // One personal server can safely share limits across its reverse proxy.
    return digest(req.socket.remoteAddress || 'unknown');
  }
  async function uploadFile(req, res, id, session) {
    if (!FILE_ID.test(id)) throw new ApiError(400, 'invalid_file_id');
    if (Number(req.headers['content-length']) > MAX_FILE_BYTES) { req.resume(); throw new ApiError(413, 'file_too_large'); }
    if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw new ApiError(415, 'content_encoding_not_supported');
    let name;
    try { name = decodeURIComponent(req.headers['x-file-name'] || id); } catch { throw new ApiError(400, 'invalid_file_name'); }
    if (name.length > 512 || /[\u0000-\u001f\u007f]/.test(name)) throw new ApiError(400, 'invalid_file_name');
    name = name.replace(/[\\/]/g, '_') || id;
    const type = req.headers['content-type'] || 'application/octet-stream';
    if (typeof type !== 'string' || type.length > 200 || !/^[\w.+-]+\/[\w.+-]+(?:;[\x20-\x7e]*)?$/.test(type)) throw new ApiError(400, 'invalid_file_type');
    const count = fileUploadCounts.get(session.username) || 0;
    if (count >= 3) throw new ApiError(429, 'too_many_uploads');
    fileUploadCounts.set(session.username, count + 1);
    const temporaryPath = join(store.tempDir, `${randomBytes(24).toString('hex')}.part`);
    const sha = createHash('sha256'); let size = 0;
    const meter = new Transform({ transform(chunk, encoding, callback) { size += chunk.length; if (size > MAX_FILE_BYTES) callback(new ApiError(413, 'file_too_large')); else { sha.update(chunk); callback(null, chunk); } } });
    try {
      await pipeline(req, meter, createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 }));
      const info = store.commitFile(id, temporaryPath, { name, type, size, sha256: sha.digest('hex') });
      json(res, info.existed ? 200 : 201, { id, size: info.size, sha256: info.sha256, existed: info.existed });
    } finally {
      fileUploadCounts.set(session.username, (fileUploadCounts.get(session.username) || 1) - 1);
      await unlink(temporaryPath).catch(() => {});
    }
  }
  function sendFile(req, res, id) {
    if (!FILE_ID.test(id)) throw new ApiError(400, 'invalid_file_id');
    const info = store.fileInfo(id);
    if (!info || !existsSync(store.filePath(id))) throw new ApiError(404, 'file_not_found');
    res.setHeader('Content-Type', info.type);
    res.setHeader('Content-Length', info.size);
    res.setHeader('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(info.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16))}`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('ETag', `"${info.sha256}"`);
    res.setHeader('X-File-Name', encodeURIComponent(info.name));
    if (req.method === 'HEAD') { res.writeHead(200); res.end(); return; }
    res.writeHead(200);
    createReadStream(store.filePath(id)).on('error', () => res.destroy()).pipe(res);
  }
  async function handle(req, res) {
    securityHeaders(res);
    // API paths do not use URL normalization, so traversal cannot become another endpoint.
    const rawPath = (req.url || '/').split('?')[0];
    let path;
    try { path = decodeURIComponent(rawPath); } catch { throw new ApiError(400, 'invalid_path'); }
    if (path.includes('\\') || path.includes('\0') || path.split('/').some(part => part === '..' || part === '.')) throw new ApiError(400, 'invalid_path');
    const url = new URL(req.url || '/', 'http://localhost');
    if (path === '/api/health' && req.method === 'GET') { json(res, 200, { ok: true, mode: 'cloud', version: VERSION }); return; }
    if (path === '/version.json') {
      if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError(405, 'method_not_allowed');
      json(res, 200, { version: VERSION, mode: 'cloud', edition: 'private-cloud' }); return;
    }
    if (path.startsWith('/api/')) {
      const session = store.getSession(cookieValue(req, cookieName));
      const user = store.account();
      if (path === '/api/auth/session' && req.method === 'GET') {
        json(res, 200, { authenticated: !!session, username: session?.username || null, ...(session ? { csrfToken: session.csrfToken } : {}), setupRequired: !user }); return;
      }
      if (writeMethods.has(req.method)) checkOrigin(req);
      if (path === '/api/auth/setup' && req.method === 'POST') {
        if (user) throw new ApiError(409, 'setup_closed');
        const key = `setup:${clientKey(req)}`; store.authAttempt(key, 10);
        const body = await readJson(req);
        if (!setupToken || typeof body.setupToken !== 'string' || body.setupToken.length > 256 || !secretEqual(body.setupToken, setupToken)) throw new ApiError(403, 'setup_token_invalid');
        validateCredentials(body.username, body.password);
        const passwordHash = await hashPassword(body.password);
        store.createAccount(body.username, passwordHash);
        const created = store.createSession(); setSessionCookie(res, created);
        json(res, 201, { authenticated: true, username: body.username, csrfToken: created.csrfToken, setupRequired: false }); return;
      }
      if (path === '/api/auth/login' && req.method === 'POST') {
        store.authAttempt(`login:${clientKey(req)}`); store.authAttempt('login:global', 40);
        const body = await readJson(req);
        const valid = typeof body.username === 'string' && body.username.length <= 64 && typeof body.password === 'string' && body.password.length <= 256;
        const matches = await verifyPassword(valid ? body.password : '', user?.password_hash);
        if (!valid || !user || body.username !== user.username || !matches) throw new ApiError(401, 'invalid_credentials');
        store.clearAttempts(`login:${clientKey(req)}`);
        // Rotate any existing session token on successful authentication.
        if (session) store.revokeSession(session.token);
        const created = store.createSession(); setSessionCookie(res, created);
        json(res, 200, { authenticated: true, username: user.username, csrfToken: created.csrfToken, setupRequired: false }); return;
      }
      if (!session) throw new ApiError(401, 'authentication_required');
      if (writeMethods.has(req.method) && (typeof req.headers['x-csrf-token'] !== 'string' || !secretEqual(req.headers['x-csrf-token'], session.csrfToken))) throw new ApiError(403, 'csrf_invalid');
      if (path === '/api/auth/logout' && req.method === 'POST') {
        store.revokeSession(session.token);
        res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie ? '; Secure' : ''}`);
        json(res, 200, { authenticated: false }); return;
      }
      if (path === '/api/workspace' && req.method === 'GET') {
        const since = url.searchParams.get('since');
        if (since !== null && (!/^\d{1,16}$/.test(since) || !Number.isSafeInteger(Number(since)))) throw new ApiError(400, 'invalid_since_revision');
        json(res, 200, store.getWorkspace(since === null ? undefined : Number(since))); return;
      }
      if (path === '/api/workspace' && req.method === 'PUT') {
        const body = await readJson(req, MAX_STATE_BYTES + 1024);
        json(res, 200, store.saveWorkspace(body.baseRevision, body.state)); return;
      }
      const fileMatch = path.match(/^\/api\/files\/([^/]+)$/);
      if (fileMatch && req.method === 'PUT') { await uploadFile(req, res, fileMatch[1], session); return; }
      if (fileMatch && ['GET', 'HEAD'].includes(req.method)) { sendFile(req, res, fileMatch[1]); return; }
      if (/^\/api\/(?:model|ai)(?:\/|$)/.test(path)) {
        if (modelService && await modelService.handle(req, res, { url, session, readJson, json })) return;
        if (path === '/api/model/status' && req.method === 'GET') { json(res, 200, { configured: false, provider: 'deepseek', hermesAvailable: false }); return; }
      }
      throw new ApiError(404, 'api_not_found');
    }
    if (!['GET', 'HEAD'].includes(req.method)) throw new ApiError(405, 'method_not_allowed');
    const asset = path === '/' ? '/index.html' : path;
    const permitted = ['/index.html', '/icon.svg', '/manifest.webmanifest'].includes(asset) || /^\/src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:js|css|svg|png|jpg|woff2)$/.test(asset);
    if (!permitted) throw new ApiError(404, 'not_found');
    const candidate = join(frontendDir, asset.slice(1));
    let real;
    try { real = realpathSync(candidate); if (!real.startsWith(frontendDir + sep) || !statSync(real).isFile()) throw new Error(); } catch { throw new ApiError(404, 'not_found'); }
    res.setHeader('Content-Type', mime[extname(real)] || 'application/octet-stream');
    res.setHeader('Content-Length', statSync(real).size);
    res.writeHead(200);
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(real).on('error', () => res.destroy()).pipe(res);
  }
  const server = createServer((req, res) => {
    handle(req, res).catch(error => {
      if (res.headersSent) { res.destroy(); return; }
      const known = error instanceof ApiError;
      if (known && error.status === 429) res.setHeader('Retry-After', error.detail.retryAfter || 5);
      json(res, known ? error.status : 500, { error: known ? error.code : 'internal_error', ...(known ? error.detail : {}) });
      // Never log user content, authentication fields, raw URLs, or model responses.
      if (!known && options.onError) options.onError({ code: 'internal_error' });
    });
  });
  server.requestTimeout = 120000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000; server.maxRequestsPerSocket = 100;
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  let closed = false;
  return { server, store, async close() { if (closed) return; closed = true; await modelService?.close?.(); if (server.listening) await new Promise(resolveClose => { server.close(resolveClose); server.closeIdleConnections(); }); store.close(); } };
}

if (isCliEntry(import.meta.url)) {
  const env = process.env;
  let setupToken = env.SETUP_TOKEN || '';
  if (env.SETUP_TOKEN_FILE) {
    const mode = statSync(env.SETUP_TOKEN_FILE).mode;
    if (process.platform !== 'win32' && (mode & 0o077)) throw new Error('SETUP_TOKEN_FILE must have private permissions');
    setupToken = readFileSync(env.SETUP_TOKEN_FILE, 'utf8').trim();
  }
  let modelFactory;
  const hermesPath = new URL('./hermes.mjs', import.meta.url);
  if (existsSync(hermesPath)) modelFactory = (await import(hermesPath.href)).createHermesService;
  const app = await createWorkbenchServer({ dataDir: env.DATA_DIR, frontendDir: env.FRONTEND_DIR, publicOrigin: env.PUBLIC_ORIGIN, secureCookie: env.SECURE_COOKIE !== 'false', setupToken, modelFactory, onError: value => console.error(JSON.stringify(value)) });
  const host = env.HOST || '127.0.0.1'; const port = Number(env.PORT || 4180);
  app.server.listen(port, host, () => console.log(`Yuzhou ${VERSION} listening on ${host}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
}
