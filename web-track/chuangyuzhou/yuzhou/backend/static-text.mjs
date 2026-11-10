import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { ApiError } from './store.mjs';

const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const encodings = ['br', 'gzip', 'identity'];
const compress = {
  br: promisify(brotliCompress),
  gzip: promisify(gzip),
};
const brotliOptions = { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } };

function preferredEncoding(header) {
  if (!header?.trim()) return 'identity';

  const quality = new Map();
  for (const member of header.split(',')) {
    const [coding, ...parameters] = member.trim().toLowerCase().split(';');
    if (!coding) continue;
    const weight = parameters.map(part => part.trim()).find(part => /^q\s*=/.test(part));
    const value = weight?.slice(weight.indexOf('=') + 1).trim();
    quality.set(coding.trim(), value === undefined ? 1 : /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(value) ? Number(value) : 0);
  }

  const wildcard = quality.get('*');
  let selected;
  let bestWeight = 0;
  for (const encoding of encodings) {
    const weight = quality.get(encoding) ?? (encoding === 'identity' ? (wildcard === 0 ? 0 : 1) : wildcard ?? 0);
    if (weight > bestWeight) {
      selected = encoding;
      bestWeight = weight;
    }
  }
  return selected;
}

function matchesValidator(header, tag) {
  return header?.split(',').some(candidate => {
    const value = candidate.trim();
    return value === '*' || value === tag || value === 'W/' + tag;
  });
}

/** Keep source bytes and compressed variants together for each file revision. */
export function createStaticTextSender() {
  const files = new Map();
  let cacheBytes = 0;
  function discard(path) {
    const file = files.get(path);
    if (!file) return;
    files.delete(path);
    cacheBytes -= file.weight;
  }

  function getFile(path, stat) {
    const revision = [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
    const cached = files.get(path);
    if (cached?.revision === revision) {
      // The first entry is always the least recently used revision.
      files.delete(path);
      files.set(path, cached);
      return cached;
    }

    discard(path);
    // Reserve for identity, gzip and Brotli, with room for compression overhead.
    const weight = Number(stat.size) * 3 + 512;
    const file = { revision, weight, source: readFile(path), variants: new Map() };
    if (weight <= MAX_CACHE_BYTES) {
      while (cacheBytes + weight > MAX_CACHE_BYTES) discard(files.keys().next().value);
      files.set(path, file);
      cacheBytes += weight;
    }
    file.source.catch(() => { if (files.get(path) === file) discard(path); });
    return file;
  }

  function getVariant(file, encoding) {
    const existing = file.variants.get(encoding);
    if (existing) return existing;

    const pending = file.source.then(async source => {
      const body = encoding === 'identity' ? source : await compress[encoding](source, encoding === 'br' ? brotliOptions : {});
      const etag = '"' + encoding + '-' + createHash('sha256').update(body).digest('base64url') + '"';
      return { body, etag };
    });
    file.variants.set(encoding, pending);
    pending.catch(() => file.variants.delete(encoding));
    return pending;
  }

  return async (req, res, path, stat, contentType) => {
    const encoding = preferredEncoding(req.headers['accept-encoding']);
    if (!encoding) {
      res.setHeader('Vary', 'Accept-Encoding');
      throw new ApiError(406, 'asset_encoding_not_acceptable');
    }
    const { body, etag } = await getVariant(getFile(path, stat), encoding);
    if (res.destroyed) return;

    // Stable URLs must revalidate so changes on disk appear on the next load.
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('ETag', etag);
    if (matchesValidator(req.headers['if-none-match'], etag)) {
      res.writeHead(304);
      res.end();
      return;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', body.length);
    if (encoding !== 'identity') res.setHeader('Content-Encoding', encoding);
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}
