/** Offline request/stream regressions for the user's Luna + max configuration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configureLuna, probeLuna} from '../luna-smoke.mjs';

const settings = {
  baseURL: 'https://sub2api.154.89.153.24.sslip.io/v1',
  api: 'openai-responses', model: 'gpt-6-luna', reasoningEffort: 'max',
  stream: true, maxOutputTokens: 4096,
};
const usage = {input_tokens: 11, output_tokens: 3, total_tokens: 14,
  output_tokens_details: {reasoning_tokens: 2}, input_tokens_details: {cached_tokens: 0}};
function completed(output) { return {id: 'resp_test', object: 'response', status: 'completed', model: 'gpt-6-luna', output, usage}; }
function message(text) { return {id: 'msg_test', type: 'message', role: 'assistant', status: 'completed', content: [{type: 'output_text', text, annotations: []}]}; }
function eventResponse(value, {fragment = 7, crlf = true} = {}) {
  const newline = crlf ? '\r\n' : '\n';
  const bytes = Buffer.from(': keepalive' + newline + newline + 'event: response.completed' + newline
    + 'data: ' + JSON.stringify({type: 'response.completed', response: value}) + newline + newline + 'data: [DONE]' + newline + newline);
  return new Response(new ReadableStream({start(c) {
    for (let i = 0; i < bytes.length; i += fragment) c.enqueue(bytes.subarray(i, i + fragment));
    c.close();
  }}), {headers: {'content-type': 'text/event-stream; charset=utf-8'}});
}
const inputText = input => typeof input === 'string' ? input : JSON.stringify(input);

test('Luna overlay binds every actor and native provider to model + explicit max, not slash alias', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'luna-encoding-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const setup = await configureLuna(join(dir, 'private'), settings);
  assert.equal(setup.config.models[0].model, 'gpt-6-luna');
  assert.equal(setup.config.models[0].reasoningEffort, 'max');
  const overlay = JSON.parse(await readFile(setup.overlayPath, 'utf8'));
  const provider = overlay.find(x => x.id === 'llm-pi-ai').config.providers['alpha-smoke-gateway'];
  assert.equal(provider.baseURL, settings.baseURL);
  assert.equal(provider.reasoning, 'max'); assert.equal(provider.transport, 'sse');
  assert.deepEqual(provider.models[0].reasoningEfforts, {max: 'max'});
  assert.equal(overlay.find(x => x.id === 'agent-default-model').config.reasoningEffort, 'max');
  assert.equal(provider.retryPolicy.maxRetries, 0);
  assert.equal(JSON.stringify(overlay).includes('gpt-6-luna/max'), false);
});

test('all three Responses requests preserve URL, Luna, max, stream and tool reasoning replay', async () => {
  const seen = []; let encrypted;
  const report = await probeLuna(settings, 'fixture-credential', {fetchImpl: async (url, options) => {
    if (options.method === 'GET') return new Response('', {status: 401});
    const body = JSON.parse(options.body); seen.push(body);
    assert.equal(url, settings.baseURL + '/responses');
    assert.equal(body.model, 'gpt-6-luna'); assert.equal(body.reasoning.effort, 'max');
    assert.equal(body.stream, true); assert.equal(body.store, false); assert.equal(body.max_output_tokens, 4096);
    assert.ok(Array.isArray(body.input)); assert.equal(options.redirect, 'manual');
    const nonce = /ALPHA_[a-f0-9]+/.exec(inputText(body.input))?.[0]; assert.ok(nonce);
    if (seen.length === 2) {
      encrypted = {id: 'rs_test', type: 'reasoning', summary: [], encrypted_content: 'opaque-test-replay'};
      return eventResponse(completed([encrypted, {id: 'fc_test', type: 'function_call', name: 'alpha_echo',
        call_id: 'call_test', arguments: JSON.stringify({nonce}), status: 'completed'}]));
    }
    if (seen.length === 3) {
      assert.ok(body.input.some(x => x.encrypted_content === encrypted.encrypted_content));
      assert.ok(body.input.some(x => x.type === 'function_call_output' && x.call_id === 'call_test'));
      assert.equal(body.tool_choice, 'none');
    }
    return eventResponse(completed([message(nonce)]), {fragment: 1});
  }});
  assert.equal(report.status, 'model_probe_passed', JSON.stringify(report));
  assert.equal(seen.length, 3); assert.equal(report.inferenceRequests, 3);
  assert.equal(report.successfulInferenceRequests, 3);
  assert.deepEqual(report.requests.filter(r => r.method === 'POST').map(r => r.usage.total_tokens), [14,14,14]);
  assert.equal(JSON.stringify(report).includes('opaque-test-replay'), false);
  assert.equal(JSON.stringify(report).includes('fixture-credential'), false);
});

test('404 captures content type and bounded redacted diagnostic; makes no speculative retry', async () => {
  let calls = 0;
  const report = await probeLuna(settings, 'fixture-credential', {fetchImpl: async (_url, options) => {
    if (options.method === 'GET') return new Response('', {status: 401});
    calls++;
    return new Response(JSON.stringify({error: {message: 'missing route; Bearer fixture-credential', type: 'not_found', code: 'not_found'}}),
      {status: 404, headers: {'content-type': 'application/json', 'x-request-id': 'req_fixture'}});
  }});
  const entry = report.requests.find(x => x.method === 'POST');
  assert.equal(calls, 1); assert.equal(report.error, 'HTTP_404');
  assert.equal(entry.contentType, 'application/json'); assert.ok(entry.diagnostic);
  assert.equal(JSON.stringify(report).includes('fixture-credential'), false);
  assert.equal(report.successfulInferenceRequests, 0);
  assert.equal(entry.usage, undefined);
});

test('truncated SSE is not a successful reply even with text deltas', async () => {
  const report = await probeLuna(settings, 'fixture-credential', {fetchImpl: async (_url, options) =>
    options.method === 'GET' ? new Response('', {status:401}) : new Response('data: {"type":"response.output_text.delta","delta":"hello"}\n\ndata: [DONE]\n\n', {headers:{'content-type':'text/event-stream'}})});
  assert.equal(report.error, 'STREAM_INCOMPLETE'); assert.equal(report.inferenceRequests,1);
});

test('no credentials means zero inference and no silent model fallback', async () => {
  let posts = 0;
  const report = await probeLuna(settings, undefined, {fetchImpl:async (_url, options) => {
    if (options.method === 'POST') posts++; return new Response('', {status:401});
  }});
  assert.equal(posts,0); assert.equal(report.status,'credential_required');
});
