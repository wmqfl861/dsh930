/** Luna Responses wire contract. Model identity and reasoning are separate and immutable. */
import {createHash} from 'node:crypto';

export const LUNA_MODEL = 'gpt-6-luna';
export const LUNA_EFFORT = 'max';
export const RESPONSE_LIMIT = 2 * 1024 * 1024;
export const DIAGNOSTIC_LIMIT = 4096;

export function validateLunaSettings(settings) {
  let url;
  try { url = new URL(settings.baseURL); } catch { throw Error('INVALID_GATEWAY'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || !/^\/v1\/*$/.test(url.pathname)) throw Error('HTTPS_V1_REQUIRED');
  if (settings.api !== 'openai-responses' || settings.model !== LUNA_MODEL
    || settings.reasoningEffort !== LUNA_EFFORT || settings.stream !== true) throw Error('LUNA_MAX_REQUIRED');
  const maxOutputTokens = settings.maxOutputTokens ?? 4096;
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 16 || maxOutputTokens > 4096) throw Error('OUTPUT_BUDGET_INVALID');
  return {...settings, baseURL: url.origin + '/v1', maxOutputTokens};
}

/** A single request builder for text, function-call and stateless tool-result continuation. */
export function lunaRequest(settings, input, options = {}) {
  const validated = validateLunaSettings(settings);
  if (!Array.isArray(input) || input.length === 0) throw Error('INPUT_ARRAY_REQUIRED');
  const permitted = new Set(['tools', 'tool_choice', 'parallel_tool_calls']);
  if (Object.keys(options).some(key => !permitted.has(key))) throw Error('REQUEST_OVERRIDE_REFUSED');
  return {model: LUNA_MODEL, reasoning: {effort: LUNA_EFFORT}, stream: true, store: false,
    max_output_tokens: validated.maxOutputTokens, include: ['reasoning.encrypted_content'], input, ...options};
}

export const userInput = text => [{role: 'user', content: [{type: 'input_text', text}]}];
export const outputText = value => (value.output ?? []).filter(x => x.type === 'message')
  .flatMap(x => x.content ?? []).filter(x => x.type === 'output_text').map(x => x.text).join('');

/** Only report actual numeric usage supplied by the endpoint, never manufacture zero usage. */
export function pickUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const result = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
    if (Number.isSafeInteger(usage[key]) && usage[key] >= 0) result[key] = usage[key];
  }
  for (const [parent, key] of [['input_tokens_details', 'cached_tokens'], ['output_tokens_details', 'reasoning_tokens']]) {
    if (Number.isSafeInteger(usage[parent]?.[key]) && usage[parent][key] >= 0) result[parent] = {[key]: usage[parent][key]};
  }
  return Object.keys(result).length ? result : undefined;
}

/** Redact exact credentials and common credential forms BEFORE limiting/printing provider text. */
export function redactDiagnostic(text, secrets = []) {
  let value = String(text);
  for (const secret of secrets.filter(Boolean)) {
    for (const form of new Set([secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')])) {
      value = value.replaceAll(form, '[REDACTED]');
    }
  }
  return value.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|authorization|password|access[_-]?token)["']?\s*[:=]\s*["']?)[^\s"'<>]+/gi, '$1[REDACTED]');
}

/** Bounded diagnostic; intentionally excludes request headers and successful generated content. */
export async function errorDiagnostic(response, secrets = []) {
  if (!response.body) return {bodyExcerpt: '', bodyTruncated: false};
  const reader = response.body.getReader(); const chunks = []; let size = 0; let truncated = false;
  try {
    while (size <= DIAGNOSTIC_LIMIT * 2) {
      const {done, value} = await reader.read(); if (done) break;
      const take = value.subarray(0, DIAGNOSTIC_LIMIT * 2 + 1 - size);
      chunks.push(take); size += take.length;
      if (take.length !== value.length || size > DIAGNOSTIC_LIMIT * 2) { truncated = true; break; }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const raw = Buffer.concat(chunks).toString('utf8');
  const clean = redactDiagnostic(raw, secrets);
  const diagnostic = {bodyExcerpt: clean.slice(0, DIAGNOSTIC_LIMIT), bodyTruncated: truncated || clean.length > DIAGNOSTIC_LIMIT};
  // A possibly partial echoed secret cannot safely be redacted; suppress the incomplete last line.
  if (truncated) diagnostic.bodyExcerpt = '[oversized provider body withheld]';
  if (!truncated) {
    try {
      const value = JSON.parse(clean); const e = value.error;
      if (e && typeof e === 'object') diagnostic.providerError = Object.fromEntries(
        ['type','code','message','param'].filter(k => typeof e[k] === 'string').map(k => [k, e[k].slice(0,1024)]));
    } catch { /* Non-JSON diagnostics, including HTML 404 pages, remain explicitly text. */ }
  }
  return diagnostic;
}

/** Incremental SSE decoder: CR/LF, split UTF-8, multiline data, terminal events and byte cap. */
export async function readResponsesStream(response, {maxBytes = RESPONSE_LIMIT, onEvent = () => {}} = {}) {
  if (!/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw Error('UNEXPECTED_CONTENT_TYPE');
  if (!response.body) throw Error('EMPTY_STREAM');
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', {fatal: true});
  let buffer = '', data = [], bytes = 0, terminal;
  function dispatch() {
    if (!data.length) return;
    const payload = data.join('\n'); data = [];
    if (payload === '[DONE]') { if (!terminal) throw Error('STREAM_INCOMPLETE'); return; }
    let event;
    try { event = JSON.parse(payload); } catch { throw Error('INVALID_SSE_JSON'); }
    if (!event || typeof event.type !== 'string') throw Error('INVALID_SSE_EVENT');
    onEvent(event);
    if (event.type === 'error' || ['response.failed','response.incomplete'].includes(event.type)) {
      const error = Error(event.type === 'response.incomplete' ? 'RESPONSE_INCOMPLETE' : 'RESPONSE_FAILED');
      error.usage = pickUsage(event.response?.usage); throw error;
    }
    if (event.type === 'response.completed') {
      if (terminal) throw Error('DUPLICATE_COMPLETION');
      if (event.response?.status !== 'completed' || !Array.isArray(event.response.output)) throw Error('INVALID_COMPLETION');
      terminal = event.response;
    }
  }
  function lines(final = false) {
    while (buffer.length) {
      const at = buffer.search(/[\r\n]/); if (at < 0) break;
      if (!final && buffer[at] === '\r' && at === buffer.length - 1) break;
      const line = buffer.slice(0,at);
      buffer = buffer.slice(at + (buffer[at] === '\r' && buffer[at + 1] === '\n' ? 2 : 1));
      if (line === '') dispatch();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > maxBytes) throw Error('RESPONSE_LIMIT');
      buffer += decoder.decode(value, {stream: true}); lines();
      // Completion is authoritative; do not wait forever for a gateway to close its keepalive.
      if (terminal) return terminal;
    }
    buffer += decoder.decode(); lines(true);
    if (!terminal) throw Error('STREAM_INCOMPLETE');
    return terminal;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Fail closed on model/effort/transport changes; used by native request observers too. */
export function assertLunaWire(url, body, settings) {
  const expected = validateLunaSettings(settings);
  if (url !== expected.baseURL + '/responses') throw Error('REQUEST_URL_MISMATCH');
  if (body.model !== LUNA_MODEL || body.reasoning?.effort !== LUNA_EFFORT || body.stream !== true
    || body.store !== false || !Array.isArray(body.input)) throw Error('REQUEST_CONTRACT_MISMATCH');
  if (!Number.isSafeInteger(body.max_output_tokens) || body.max_output_tokens > expected.maxOutputTokens
    || body.max_output_tokens < 16) throw Error('REQUEST_OUTPUT_BUDGET');
}

export function safeRequestSummary(body) {
  return {model: body.model, reasoning: body.reasoning, stream: body.stream, store: body.store,
    inputType: Array.isArray(body.input) ? 'array' : typeof body.input, inputItems: body.input?.length,
    maxOutputTokens: body.max_output_tokens, bodySha256: createHash('sha256').update(JSON.stringify(body)).digest('hex')};
}
