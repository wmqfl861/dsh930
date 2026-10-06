import test from 'node:test';
import assert from 'node:assert/strict';
import {readResponsesStream,validateLunaSettings,lunaRequest,redactDiagnostic,errorDiagnostic,assertLunaWire} from '../luna-responses.mjs';
import {createLunaBudget,liveBudgetFromEnv} from '../luna-budget.mjs';
const settings={baseURL:'https://gateway.example/v1/',model:'gpt-6-luna',reasoningEffort:'max',stream:true,api:'openai-responses'};
const input=[{role:'user',content:[{type:'input_text',text:'hi'}]}];
const response=payload=>new Response(payload,{headers:{'content-type':'text/event-stream'}});
for(const invalid of [
  {...settings,model:'gpt-6-luna/max'}, {...settings,reasoningEffort:'high'}, {...settings,stream:false},
  {...settings,baseURL:'http://gateway.example/v1',allowInsecureHttp:true},
  {...settings,baseURL:'https://gateway.example/v1/responses'}, {...settings,baseURL:'https://user:pass@gateway.example/v1'},
  {...settings,baseURL:'https://gateway.example/v1?key=x'}, {...settings,baseURL:'https://gateway.example/v1。'},
]) test('rejects invalid identity or transport: '+JSON.stringify({model:invalid.model,effort:invalid.reasoningEffort,url:invalid.baseURL,stream:invalid.stream}),()=>assert.throws(()=>validateLunaSettings(invalid)));
test('trailing slash normalizes to exactly /v1/responses',()=>{
 const s=validateLunaSettings(settings); assert.equal(s.baseURL,'https://gateway.example/v1');
 assertLunaWire(s.baseURL+'/responses',lunaRequest(s,input),s);
 assert.throws(()=>assertLunaWire(s.baseURL+'/v1/responses',lunaRequest(s,input),s),/REQUEST_URL_MISMATCH/);
});
test('callers cannot overwrite pinned fields with options',()=>assert.throws(()=>lunaRequest(settings,input,{model:'other'}),/REQUEST_OVERRIDE_REFUSED/));
test('SSE preserves split Unicode, multiline data and ignores keepalive',async()=>{
 const text=': ping\r\nevent: response.completed\r\ndata: {"type":"response.completed",\r\ndata: "response":{"status":"completed","output":[{"text":"中文"}]}}\r\n\r\n';
 const b=Buffer.from(text);const r=new Response(new ReadableStream({start(c){for(const byte of b)c.enqueue(Uint8Array.of(byte));c.close();}}),{headers:{'content-type':'text/event-stream'}});
 assert.equal((await readResponsesStream(r)).output[0].text,'中文');
});
for(const [payload,code] of [
 ['data: not-json\n\n','INVALID_SSE_JSON'], ['data: {}\n\n','INVALID_SSE_EVENT'],
 ['data: {"type":"response.failed","response":{"usage":{"input_tokens":3}}}\n\n','RESPONSE_FAILED'],
 ['data: {"type":"error","message":"server failure"}\n\n','RESPONSE_FAILED'],
 ['data: {"type":"response.incomplete"}\n\n','RESPONSE_INCOMPLETE'],
 ['data: [DONE]\n\n','STREAM_INCOMPLETE'],
 ['data: {"type":"response.completed","response":{"status":"incomplete","output":[]}}\n\n','INVALID_COMPLETION'],
]) test('SSE fails closed: '+code,async()=>assert.rejects(readResponsesStream(response(payload)),new RegExp(code)));
test('SSE requires content type and bounded input',async()=>{
 await assert.rejects(readResponsesStream(new Response('{}')),/UNEXPECTED_CONTENT_TYPE/);
 await assert.rejects(readResponsesStream(response('x'.repeat(100)),{maxBytes:50}),/RESPONSE_LIMIT/);
});
test('reader is cancelled after authoritative completion even when connection stays open',async()=>{
 let cancelled=false;
 const r=new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('data: {"type":"response.completed","response":{"status":"completed","output":[]}}\n\n'));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
 await readResponsesStream(r);assert.equal(cancelled,true);
});
test('redaction happens before display truncation and handles encoded credentials',()=>{
 const key='dummy-secret-123';const s=redactDiagnostic(key+' '+encodeURIComponent(key)+' '+Buffer.from(key).toString('base64')+' Bearer abc',['dummy-secret-123']);
 assert.ok(!s.includes(key)); assert.ok(!s.includes('Bearer abc'));
});
test('oversize provider errors are bounded and do not expose partial secrets',async()=>{
 const d=await errorDiagnostic(new Response('x'.repeat(10000)+'sk-private'),['sk-private']);
 assert.equal(d.bodyTruncated,true);assert.equal(d.bodyExcerpt,'[oversized provider body withheld]');
});
test('missing opt-in or prices blocks spending before any model request',()=>{
 assert.equal(liveBudgetFromEnv({}).ready,false);
 assert.equal(liveBudgetFromEnv({ALPHA_SMOKE_ALLOW_LIVE:'1'}).reason,'GATEWAY_RATES_REQUIRED');
});
test('budget reserves before request and fails closed on count, USD or oversized input',()=>{
 const body=lunaRequest(settings,input);
 const b=createLunaBudget({maxRequests:1,maxUsd:0.25,inputRate:1,outputRate:1});
 b.options.beforeInference(body);assert.throws(()=>b.options.beforeInference(body),/REQUEST_BUDGET_EXHAUSTED/);
 const low=createLunaBudget({maxUsd:0.00001,inputRate:1,outputRate:1});assert.throws(()=>low.options.beforeInference(body),/USD_RESERVATION_EXHAUSTED/);
 const size=createLunaBudget({inputRate:1,outputRate:1});assert.throws(()=>size.options.beforeInference({...body,input:['a'.repeat(33000)]}),/INPUT_BUDGET_EXHAUSTED/);
});
test('unreported usage is unknown, not zero; reported usage is recorded separately from reservations',()=>{
 const b=createLunaBudget({inputRate:1,outputRate:2});b.options.beforeInference(lunaRequest(settings,input));b.options.afterInference({});
 assert.equal(b.report().observedUsagePriceEstimateUsd,null);assert.equal(b.report().unreportedUsageRequests,1);
 b.options.beforeInference(lunaRequest(settings,input));b.options.afterInference({usage:{input_tokens:10,output_tokens:5}});
 assert.equal(b.report().usageReports,1);assert.equal(b.report().observedUsagePriceEstimateUsd,0.00002);
});
