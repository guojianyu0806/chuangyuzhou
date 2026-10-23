// Public access is explicit; the Node listener and writable paths stay isolated.
export const WEB_ENVIRONMENT_KEYS = Object.freeze(['CZB_YUZHOU_MODE', 'CZB_YUZHOU_PUBLIC_ORIGIN']);

export function resolveWebAccess(mode = 'local', value = '') {
  if (!['local', 'web'].includes(mode)) throw new Error('CZB_YUZHOU_MODE must be local or web.');
  if (typeof value !== 'string') throw new Error('CZB_YUZHOU_PUBLIC_ORIGIN must be an HTTPS origin.');
  if (mode === 'local') {
    if (value !== '') throw new Error('CZB_YUZHOU_PUBLIC_ORIGIN requires CZB_YUZHOU_MODE=web.');
    return { mode, publicOrigin: 'http://127.0.0.1:4396', secureCookie: false };
  }
  // Reject URL repairs (whitespace, backslashes, empty query/fragment) as well as
  // credentials and path prefixes. This value is never inferred from a request.
  const invalid = () => new Error('CZB_YUZHOU_PUBLIC_ORIGIN must be one HTTPS origin without credentials, path, query or fragment.');
  if (!/^https:\/\/[^/?#@\\\s]+\/?$/.test(value) || /[^\x21-\x7e]/.test(value)) throw invalid();
  let parsed;
  try { parsed = new URL(value); } catch { throw invalid(); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw invalid();
  if (['0.0.0.0', '[::]'].includes(parsed.hostname)) throw invalid();
  return { mode, publicOrigin: parsed.origin, secureCookie: true };
}
