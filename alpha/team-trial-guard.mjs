/** Live-only, fail-closed four-request boundary for the explicitly uncapped team trial. */
import {readFileSync,writeFileSync} from 'node:fs';
import {assertLunaWire,readResponsesStream,pickUsage} from './luna-responses.mjs';
const config=JSON.parse(readFileSync(process.env.ALPHA_TEAM_TRIAL_GUARD_CONFIG,'utf8'));
if(config.wireFixture===true&&globalThis[Symbol.for('dsh.alpha.team-trial.wire-fixture')]!==true)throw Error('WIRE_FIXTURE_TRANSPORT_REQUIRED');
if(process.env.ALPHA_TEAM_TRIAL_ALLOW_LIVE!=='1'||process.env.ALPHA_TEAM_TRIAL_COST_AUTHORIZATION!=='uncapped')throw Error('TRIAL_LIVE_AUTHORIZATION_REQUIRED');
if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw Error('TLS_VERIFICATION_REQUIRED');
const actualFetch=globalThis.fetch.bind(globalThis),requests=[],pending=[];
globalThis[Symbol.for('dsh.alpha.team-trial.guard')]={async flush(){await Promise.all(pending);},verified(){return requests.length===4&&requests.every(r=>r.completed===true);}};
globalThis.fetch=async(input,options)=>{
 const request=new Request(input,options),raw=await request.clone().text();
 if(Buffer.byteLength(raw)>65536)throw Error('TRIAL_INPUT_LIMIT');
 const body=JSON.parse(raw);assertLunaWire(request.url,body,config.settings);
 const allowedKeys=new Set(['model','input','instructions','reasoning','stream','store','max_output_tokens','include','temperature','top_p','parallel_tool_calls','tool_choice','tools','service_tier','metadata','stream_options','text','prompt_cache_key','prompt_cache_retention','safety_identifier','user','background','truncation']);
 const textInput=body.input.every(item=>item&&(!item.type||item.type==='message')&&['system','developer','user','assistant'].includes(item.role)&&(typeof item.content==='string'||Array.isArray(item.content)&&item.content.every(block=>block&&['input_text','output_text'].includes(block.type)&&typeof block.text==='string')));
 if(request.method!=='POST'||(body.tools??[]).length||!textInput||Object.keys(body).some(key=>!allowedKeys.has(key)))throw Error('TRIAL_TEXT_ONLY');
 if(requests.length>=4)throw Error('TRIAL_REQUEST_LIMIT');
 const entry={request:requests.length+1,completed:false};requests.push(entry);
 try{
  const response=await actualFetch(request,{redirect:'manual',signal:AbortSignal.any([request.signal,AbortSignal.timeout(180000)])});
  entry.httpStatus=response.status;
  if(!response.ok){await response.body?.cancel();throw Error('TRIAL_HTTP_ERROR');}
  const [sdk,monitor]=response.body.tee();
  pending.push((async()=>{try{const result=await readResponsesStream(new Response(monitor,{headers:response.headers}));entry.completed=result.model===config.settings.model;entry.usage=pickUsage(result.usage);}catch(error){entry.streamFailed=true;entry.usage=pickUsage(error.usage);}})());
  return new Response(sdk,{status:response.status,headers:response.headers});
 }catch{entry.failed=true;throw Error('TRIAL_TRANSPORT_ERROR');}
};
process.once('exit',()=>writeFileSync(config.reportPath,JSON.stringify({costAuthorization:config.wireFixture?'synthetic-no-spend':'uncapped',synthetic:config.wireFixture===true,maxInferenceRequests:4,inferenceRequests:config.wireFixture?0:requests.length,fixtureRequests:config.wireFixture?requests.length:0,maxRetries:0,maxOutputTokens:config.settings.maxOutputTokens,monetaryCostUsd:null,rateSource:null,requests})+'\n',{mode:0o600}));
