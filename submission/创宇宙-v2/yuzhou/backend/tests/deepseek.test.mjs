import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekRunner } from '../deepseek.mjs';

const settings = { provider: 'deepseek', model: 'deepseek-flash', apiKey: 'synthetic-private-key', baseUrl: 'https://api.deepseek.com' };
const input = { system: 'Return one JSON object.', user: 'Synthetic test input.', settings };
const reply = JSON.stringify({ reply: '请补充日期。', proposal: null });
const envelope = (content = reply, finish_reason = 'stop', extras = {}) => ({ choices: [{ finish_reason, message: { role: 'assistant', content, ...extras } }] });

test('runner construction is offline and each supported model uses the fixed official request contract', async () => {
  let calls = 0;
  const runner = createDeepSeekRunner({ fetch: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-private-key');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.deepEqual(body.messages, [{ role: 'system', content: input.system }, { role: 'user', content: input.user }]);
    assert.deepEqual(body.thinking, { type: 'disabled' }); assert.equal(body.max_tokens, 8192);
    assert.deepEqual(body.response_format, { type: 'json_object' }); assert.equal(body.stream, false);
    assert.equal(Object.hasOwn(body, 'tools'), false);
    return Response.json(envelope());
  } });
  assert.equal(calls, 0);
  for (const model of ['deepseek-flash', 'deepseek-v4-pro', 'deepseek-chat', 'deepseek-reasoner']) assert.deepEqual(await runner({ ...input, settings: { ...settings, model } }), { ok: true, output: reply });
  assert.equal(calls, 4);
});

test('missing or unapproved model configuration and pre-cancelled work never reach the network', async () => {
  let calls = 0; const runner = createDeepSeekRunner({ fetch: async () => { calls++; throw Error('must not call'); } });
  for (const changes of [{ provider: 'other' }, { model: 'arbitrary' }, { apiKey: '' }, { baseUrl: 'https://unapproved.example' }]) assert.deepEqual(await runner({ ...input, settings: { ...settings, ...changes } }), { ok: false, code: 'MODEL_NOT_CONFIGURED' });
  assert.deepEqual(await runner({ ...input, system: null }), { ok: false, code: 'INVALID_PROPOSAL' });
  assert.deepEqual(await runner({ ...input, signal: AbortSignal.abort() }), { ok: false, code: 'AI_INTERRUPTED' });
  assert.equal(calls, 0);
});

test('HTTP errors return fixed classifications without retaining provider diagnostics', async () => {
  for (const [status, code] of [[401, 'MODEL_AUTH_FAILED'], [403, 'MODEL_AUTH_FAILED'], [402, 'MODEL_RATE_LIMIT'], [429, 'MODEL_RATE_LIMIT'], [400, 'MODEL_UNAVAILABLE'], [500, 'MODEL_UNAVAILABLE'], [302, 'MODEL_UNAVAILABLE']]) {
    const runner = createDeepSeekRunner({ fetch: async () => new Response('private provider diagnostic ' + settings.apiKey, { status }) });
    assert.deepEqual(await runner(input), { ok: false, code });
  }
  const runner = createDeepSeekRunner({ fetch: async () => { throw new Error('request contained ' + settings.apiKey); } });
  assert.deepEqual(await runner(input), { ok: false, code: 'MODEL_UNAVAILABLE' });
});

test('redirected responses are refused even if a transport returns one', async () => {
  const runner = createDeepSeekRunner({ fetch: async () => { const response = Response.json(envelope()); Object.defineProperty(response, 'redirected', { value: true }); return response; } });
  assert.deepEqual(await runner(input), { ok: false, code: 'MODEL_UNAVAILABLE' });
});

test('truncated, unfinished and unsolicited tool responses never become a proposal', async () => {
  for (const [body, code] of [[envelope(reply, 'length'), 'MODEL_OUTPUT_TRUNCATED'], [envelope(reply, 'content_filter'), 'MODEL_INCOMPLETE'], [envelope(reply, null), 'MODEL_INCOMPLETE'], [envelope(reply, 'stop', { tool_calls: [{ id: 'unexpected' }] }), 'MODEL_INCOMPLETE'], [envelope(reply, 'stop', { function_call: { name: 'unexpected' } }), 'MODEL_INCOMPLETE'], [envelope(''), 'INVALID_PROPOSAL'], [envelope(null), 'INVALID_PROPOSAL'], [{}, 'MODEL_INCOMPLETE']]) {
    const runner = createDeepSeekRunner({ fetch: async () => Response.json(body) });
    assert.deepEqual(await runner(input), { ok: false, code });
  }
  assert.deepEqual(await createDeepSeekRunner({ fetch: async () => new Response('not JSON') })(input), { ok: false, code: 'INVALID_PROPOSAL' });
});

test('response limit covers both declared length and unannounced streamed bytes', async () => {
  let cancelled = 0;
  const declared = createDeepSeekRunner({ fetch: async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-length': String(1024 * 1024 + 1) } }) });
  assert.deepEqual(await declared(input), { ok: false, code: 'MODEL_OUTPUT_TRUNCATED' }); assert.equal(cancelled, 1);
  const streamed = createDeepSeekRunner({ fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(700000)); controller.enqueue(new Uint8Array(400000)); }, cancel() { cancelled++; } })) });
  assert.deepEqual(await streamed(input), { ok: false, code: 'MODEL_OUTPUT_TRUNCATED' }); assert.equal(cancelled, 2);
});

test('timeout interrupts transport and returns a safe retryable result', async () => {
  let requestSignal;
  const runner = createDeepSeekRunner({ timeoutMs: 10, fetch: async (_url, { signal }) => { requestSignal = signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private timeout diagnostic')))); } });
  assert.deepEqual(await runner(input), { ok: false, code: 'AI_TIMEOUT' }); assert.equal(requestSignal.aborted, true);
});

test('caller cancellation aborts an in-flight request without exposing its reason', async () => {
  const controller = new AbortController(); let started; const entered = new Promise(resolve => { started = resolve; }); let requestSignal;
  const runner = createDeepSeekRunner({ fetch: async (_url, { signal }) => { requestSignal = signal; started(); return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private abort diagnostic')))); } });
  const pending = runner({ ...input, signal: controller.signal }); await entered; controller.abort('private cancellation reason');
  assert.deepEqual(await pending, { ok: false, code: 'AI_INTERRUPTED' }); assert.equal(requestSignal.aborted, true);
});

test('cancellation while reading a response body cannot return partial model content', async () => {
  const controller = new AbortController(); let reading; const entered = new Promise(resolve => { reading = resolve; });
  const runner = createDeepSeekRunner({ fetch: async (_url, { signal }) => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new TextEncoder().encode('{"choices":'));
      signal.addEventListener('abort', () => stream.error(new Error('private body failure')), { once: true });
    },
    pull() { reading(); },
  })) });
  const pending = runner({ ...input, signal: controller.signal }); await entered; controller.abort();
  assert.deepEqual(await pending, { ok: false, code: 'AI_INTERRUPTED' });
});
