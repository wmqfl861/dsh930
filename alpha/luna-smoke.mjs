/** Explicit, bounded Luna diagnostic. Credentials only enter the intended HTTPS process request. */
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadTeam, preflight} from './core.mjs';
import {validateLunaSettings, lunaRequest, userInput, outputText, readResponsesStream,
  pickUsage, errorDiagnostic, assertLunaWire, safeRequestSummary, redactDiagnostic} from './luna-responses.mjs';

export async function configureLuna(directory, rawSettings) {
  const settings = validateLunaSettings(rawSettings); const {team} = await loadTeam();
  const model = {id: 'luna-smoke', provider: 'alpha-smoke-gateway', model: settings.model,
    reasoningEffort: settings.reasoningEffort, canonicalModelId: 'unverified-gateway:' + settings.model,
    family: 'gateway-unverified', maxTokens: settings.maxOutputTokens};
  const config = {schemaVersion: 1, liveEnabled: true, executionPurpose: 'single-model-smoke',
    acknowledgeNoIndependentReview: true, subagentProvider: 'spawn', models: [model],
    bindings: Object.fromEntries(team.roles.map(r => [r.id, {primary: model.id, shadow: model.id}]))};
  const check = preflight(team, config); if (!check.ready) throw Error('PREFLIGHT_CONFIG');
  await mkdir(directory, {mode: 0o700});
  const configPath = join(directory, 'models.json'), overlayPath = join(directory, 'overlay.json');
  const overlay = [
    {id: 'llm-deepseek', disabled: true}, {id: 'llm-deepseek-account', disabled: true},
    {id: 'web-search-deepseek', disabled: true},
    {id: 'agent-default-model', config: {provider: model.provider, model: model.model, reasoningEffort: 'max'}},
    {id: 'llm-pi-ai', config: {providers: {[model.provider]: {
      api: settings.api, baseURL: settings.baseURL, apiKeyEnv: 'ALPHA_SMOKE_API_KEY',
      reasoning: 'max', transport: 'sse', cacheRetention: 'none', timeoutMs: 90000,
      retryPolicy: {mode: 'normal', maxRetries: 0},
      models: [{id: model.model, input: ['text'], contextWindow: 262144,
        maxTokens: settings.maxOutputTokens, reasoningEfforts: {max: 'max'}}],
    }}}},
    {insert: [{id: 'alpha-team', name: fileURLToPath(new URL('dsh-plugin.mjs', import.meta.url)),
      config: {modelConfigPath: configPath, stateDirectory: join(directory, 'runs')}}]},
  ];
  for (const [path,value] of [[configPath,config],[overlayPath,overlay]]) {
    await writeFile(path, JSON.stringify(value,null,2) + '\n', {mode: 0o600, flag: 'wx'});
  }
  return {logicalActors: 14, config, configPath, overlayPath};
}

export async function probeLuna(rawSettings, apiKey, {fetchImpl = fetch, timeoutMs = 90000,
  maxRequests = 3, beforeInference = () => {}, afterInference = () => {}} = {}) {
  const settings = validateLunaSettings(rawSettings);
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('TLS_VERIFICATION_REQUIRED');
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 3) throw Error('REQUEST_BUDGET_INVALID');
  const report = {schemaVersion: 2, at: new Date().toISOString(), baseURL: settings.baseURL,
    requestedModel: settings.model, reasoningEffort: settings.reasoningEffort, stream: true, api: settings.api,
    credentialAvailable: Boolean(apiKey), requests: [], inferenceRequests: 0, successfulInferenceRequests: 0,
    maxInferenceRequests: maxRequests, status: 'running', independentReview: false, qualityAcceptanceGranted: false, teamRun: false};
  async function request(path, body, authenticated = true) {
    if (body && report.inferenceRequests >= maxRequests) throw Error('REQUEST_BUDGET_EXHAUSTED');
    if (body) { assertLunaWire(settings.baseURL + path, body, settings); await beforeInference(body); }
    const entry = {method: body ? 'POST' : 'GET', path, authenticated,
      ...(body ? {request: safeRequestSummary(body)} : {})};
    report.requests.push(entry); if (body) report.inferenceRequests++;
    const start = Date.now();
    try {
      const response = await fetchImpl(settings.baseURL + path, {method: entry.method, redirect: 'manual',
        headers: {...(authenticated ? {Authorization: 'Bearer ' + apiKey} : {}),
          ...(body ? {'Content-Type': 'application/json', Accept: 'text/event-stream'} : {})},
        ...(body ? {body: JSON.stringify(body)} : {}), signal: AbortSignal.timeout(timeoutMs)});
      entry.httpStatus = response.status; entry.contentType = response.headers.get('content-type') === null ? null : redactDiagnostic(response.headers.get('content-type'), [apiKey]).slice(0,256);
      const requestId = response.headers.get('x-request-id');
      if (requestId) entry.requestId = redactDiagnostic(requestId, [apiKey]).slice(0,256);
      if (!authenticated) { await response.body?.cancel(); return; }
      if (!response.ok) {
        entry.diagnostic = await errorDiagnostic(response, [apiKey]);
        throw Error(response.status >= 300 && response.status < 400 ? 'REDIRECT_REFUSED' : 'HTTP_' + response.status);
      }
      if (!/^text\/event-stream(?:;|$)/i.test(entry.contentType ?? '')) {
        entry.diagnostic = await errorDiagnostic(response, [apiKey]); throw Error('UNEXPECTED_CONTENT_TYPE');
      }
      const value = await readResponsesStream(response, {onEvent(event) {
        if (['error','response.failed','response.incomplete'].includes(event.type)) {
          const detail = event.error ?? event.response?.error ?? event.response?.incomplete_details ?? {event: event.type};
          entry.diagnostic = {bodyExcerpt: redactDiagnostic(JSON.stringify(detail), [apiKey]).slice(0,4096), bodyTruncated: false};
        }
      }});
      const usage = pickUsage(value.usage); if (usage) entry.usage = usage;
      if (typeof value.model === 'string') entry.responseModel = redactDiagnostic(value.model, [apiKey]).slice(0,256);
      if (value.model !== settings.model) throw Error('RESPONSE_MODEL_MISMATCH');
      entry.completed = true; report.successfulInferenceRequests++; return value;
    } catch (error) {
      if (error.usage) entry.usage = error.usage;
      throw error;
    } finally {
      entry.durationMs = Date.now() - start;
      if (body) await afterInference(entry);
    }
  }
  try {
    // Authenticated probes do not require /models support. That endpoint can be absent on a working gateway.
    if (!apiKey) { await request('/models', undefined, false); report.status = 'credential_required'; return report; }
    const nonce = 'ALPHA_' + randomUUID().replaceAll('-', '');
    const a = await request('/responses', lunaRequest(settings, userInput('Connectivity test only. Reply with exactly ' + nonce + ' and nothing else.')));
    if (outputText(a).trim() !== nonce) throw Error('PLAIN_REPLY_NOT_VERIFIED'); report.plainReply = true;
    const input = userInput('Call alpha_echo with nonce ' + nonce + '. Then output exactly the nonce returned by the tool.');
    const tool = {type: 'function', name: 'alpha_echo', description: 'Return the nonce without external effects.', strict: true,
      parameters: {type: 'object', properties: {nonce: {type: 'string'}}, required: ['nonce'], additionalProperties: false}};
    const b = await request('/responses', lunaRequest(settings, input, {tools: [tool], tool_choice: {type: 'function', name: 'alpha_echo'}, parallel_tool_calls: false}));
    const calls = b.output.filter(i => i.type === 'function_call');
    if (calls.length !== 1 || calls[0].name !== 'alpha_echo' || !calls[0].call_id
      || JSON.parse(calls[0].arguments).nonce !== nonce) throw Error('TOOL_CALL_NOT_VERIFIED'); report.functionCall = true;
    // Preserve the entire response output, including encrypted reasoning and function-call identities.
    const c = await request('/responses', lunaRequest(settings, [...input, ...b.output,
      {type: 'function_call_output', call_id: calls[0].call_id, output: JSON.stringify({nonce})}], {tools: [tool], tool_choice: 'none'}));
    if (outputText(c).trim() !== nonce) throw Error('TOOL_CONTINUATION_NOT_VERIFIED');
    report.toolContinuation = true; report.status = 'model_probe_passed';
  } catch (error) {
    const code = String(error.cause?.code ?? error.code ?? error.message ?? error.name);
    report.status = report.requests.some(r => r.httpStatus) ? 'model_probe_blocked' : 'transport_blocked';
    report.error = /^[A-Z][A-Z0-9_]+$/.test(code) && ![apiKey].filter(Boolean).some(s => code.includes(s)) ? code : 'PROBE_ERROR';
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const folder = resolve(process.argv[2] ?? '.artifacts/luna-smoke'); await mkdir(folder, {recursive: true, mode: 0o700});
    const settings = JSON.parse(await readFile(new URL('luna.gateway.json', import.meta.url), 'utf8'));
    const setup = await configureLuna(join(folder, 'private'), settings);
    const {liveBudgetFromEnv} = await import('./luna-budget.mjs');
    const budget = liveBudgetFromEnv(process.env);
    let report;
    if (process.env.ALPHA_SMOKE_API_KEY && !budget.ready) {
      report = {status: 'budget_required', reason: budget.reason, credentialAvailable: true, inferenceRequests: 0,
        successfulInferenceRequests: 0, teamRun: false, qualityAcceptanceGranted: false};
    } else {
      report = await probeLuna(settings, process.env.ALPHA_SMOKE_API_KEY, budget.options);
    }
    report.configuration = 'passed'; report.logicalActors = setup.logicalActors; report.budget = budget.report();
    await writeFile(join(folder, 'report.json'), JSON.stringify(report,null,2) + '\n', {mode: 0o600});
    console.log(JSON.stringify(report,null,2)); process.exitCode = report.status === 'model_probe_passed' ? 0 : 2;
  } catch (error) {
    console.error(JSON.stringify({status: 'blocked', code: typeof error.code === 'string' ? error.code : 'CONFIG_ERROR'})); process.exitCode = 2;
  }
}
