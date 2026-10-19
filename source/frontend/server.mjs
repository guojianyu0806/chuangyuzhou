import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = await realpath(fileURLToPath(new URL('.', import.meta.url)));
const VERSION = '0.8.0';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);

if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  console.error('PORT must be an integer from 0 to 65535.');
  process.exit(1);
}

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.avif', 'image/avif'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.pdf', 'application/pdf'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

function send(req, res, status, body, contentType = 'application/json; charset=utf-8') {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...(status === 405 ? { Allow: 'GET, HEAD' } : {}),
  });
  res.end(req.method === 'HEAD' ? undefined : data);
}

function json(req, res, status, payload) {
  send(req, res, status, JSON.stringify(payload));
}

function contained(filePath) {
  const relative = path.relative(ROOT, filePath);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

const server = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(req, res, 405, { error: 'method_not_allowed', message: 'Only GET and HEAD are supported.' });
    return;
  }

  // Validate the original pathname before URL normalization can hide traversal.
  let pathname;
  try {
    pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    json(req, res, 400, { error: 'invalid_path' });
    return;
  }
  const parts = pathname.split('/');
  if (!pathname.startsWith('/') || pathname.includes('\\') || /[\u0000-\u001f\u007f]/.test(pathname)
      || parts.some((part) => part.startsWith('.') || part.includes(':'))) {
    json(req, res, 403, { error: 'forbidden_path' });
    return;
  }

  if (pathname === '/api/health') {
    json(req, res, 200, { status: 'ok', version: VERSION, mode: 'local-ui', backendConfigured: false });
    return;
  }
  if (pathname === '/version.json') {
    json(req, res, 200, { version: VERSION, label: '本地界面版' });
    return;
  }
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    json(req, res, 501, {
      error: 'backend_not_configured',
      message: 'Backend not configured. This server only serves the local UI.',
    });
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const contentType = MIME_TYPES.get(path.extname(pathname).toLowerCase());
  // Configuration and server source are not public assets.
  if (!contentType || pathname === '/package.json' || pathname.endsWith('/')) {
    json(req, res, 404, { error: 'not_found' });
    return;
  }

  const candidate = path.resolve(ROOT, `.${pathname}`);
  if (!contained(candidate)) {
    json(req, res, 403, { error: 'forbidden_path' });
    return;
  }
  try {
    const resolved = await realpath(candidate);
    if (!contained(resolved)) {
      json(req, res, 403, { error: 'forbidden_path' });
      return;
    }
    if (!(await stat(resolved)).isFile()) {
      json(req, res, 404, { error: 'not_found' });
      return;
    }
    send(req, res, 200, await readFile(resolved), contentType);
  } catch (error) {
    const status = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code) ? 404 : 500;
    if (status === 500) console.error('Static file request failed:', error.code || error.name);
    json(req, res, status, { error: status === 404 ? 'not_found' : 'server_error' });
  }
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${PORT} is already in use. Close the other server or choose another PORT.`
    : `Server could not start: ${error.code || error.message}`);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const displayHost = HOST.includes(':') ? `[${HOST}]` : HOST;
  console.log(`宇宙工作台 ${VERSION}（本地界面版）: http://${displayHost}:${address.port}`);
  console.log('Keep this window open. Press Ctrl+C to stop.');
});
