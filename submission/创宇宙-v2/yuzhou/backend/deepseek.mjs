// The transport has no workspace tools, implicit credentials, or configurable host.
const ENDPOINT = 'https://api.deepseek.com/chat/completions';
const BASE_URL = 'https://api.deepseek.com';
const MODELS = new Set(['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']);
const MAX_RESPONSE_BYTES = 1024 * 1024;
const failure = code => ({ ok: false, code });

async function readBoundedJson(response) {
  const declared = Number(response.headers?.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    return failure('MODEL_OUTPUT_TRUNCATED');
  }
  if (!response.body?.getReader) return failure('MODEL_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        return failure('MODEL_OUTPUT_TRUNCATED');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return { ok: true, body: JSON.parse(Buffer.concat(chunks, size).toString('utf8')) }; }
  catch { return failure('INVALID_PROPOSAL'); }
}

/** Constructing the runner never makes a request. Only calling it uses a key. */
export function createDeepSeekRunner({ fetch: fetchImpl = globalThis.fetch, timeoutMs = 180000 } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 180000) throw new RangeError('The request timeout must be between 1 and 180000 milliseconds.');
  return async function runModel({ system, user, settings, signal } = {}) {
    if (signal?.aborted) return failure('AI_INTERRUPTED');
    if (settings?.provider !== 'deepseek' || !MODELS.has(settings.model) || typeof settings.apiKey !== 'string' || !settings.apiKey.trim() || (settings.baseUrl && settings.baseUrl !== BASE_URL)) return failure('MODEL_NOT_CONFIGURED');
    if (typeof system !== 'string' || typeof user !== 'string') return failure('INVALID_PROPOSAL');
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(ENDPOINT, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({ model: settings.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          thinking: { type: 'disabled' }, max_tokens: 8192, response_format: { type: 'json_object' }, stream: false }),
      });
      if (signal?.aborted) return failure('AI_INTERRUPTED');
      if (timedOut) return failure('AI_TIMEOUT');
      if (response.redirected || !response.ok) {
        await response.body?.cancel().catch(() => {});
        return failure([401, 403].includes(response.status) ? 'MODEL_AUTH_FAILED' : [402, 429].includes(response.status) ? 'MODEL_RATE_LIMIT' : 'MODEL_UNAVAILABLE');
      }
      const result = await readBoundedJson(response);
      if (signal?.aborted) return failure('AI_INTERRUPTED');
      if (timedOut) return failure('AI_TIMEOUT');
      if (!result.ok) return result;
      const choice = result.body?.choices?.[0];
      if (choice?.finish_reason === 'length') return failure('MODEL_OUTPUT_TRUNCATED');
      if (choice?.finish_reason !== 'stop' || choice?.message?.tool_calls?.length || choice?.message?.function_call) return failure('MODEL_INCOMPLETE');
      if (typeof choice.message?.content !== 'string' || !choice.message.content.trim()) return failure('INVALID_PROPOSAL');
      return { ok: true, output: choice.message.content };
    } catch {
      // Provider exceptions and response bodies may contain keys or user text.
      return failure(signal?.aborted ? 'AI_INTERRUPTED' : timedOut ? 'AI_TIMEOUT' : 'MODEL_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  };
}
