/** Explicit, bounded Luna diagnostic. Secrets come from environment, never configuration or logs. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadTeam,preflight} from './core.mjs';

export async function configureLuna(directory, settings) {
 const {team}=await loadTeam();
 const url=new URL(settings.baseURL);
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('INVALID_GATEWAY');
 if(url.protocol==='http:'&&settings.allowInsecureHttp!==true)throw Error('HTTP_ACK_REQUIRED');
 if(!settings.model||settings.api!=='openai-responses')throw Error('INVALID_MODEL_CONFIG');
 const model={id:'luna-smoke',provider:'alpha-smoke-gateway',model:settings.model,canonicalModelId:'unverified-gateway:'+settings.model,family:'gateway-unverified',maxTokens:4096};
 const config={schemaVersion:1,liveEnabled:true,executionPurpose:'single-model-smoke',acknowledgeNoIndependentReview:true,subagentProvider:'spawn',models:[model],bindings:Object.fromEntries(team.roles.map(r=>[r.id,{primary:model.id,shadow:model.id}]))};
 const check=preflight(team,config);if(!check.ready)throw Error('PREFLIGHT:'+check.issues.join(','));
 await mkdir(directory,{mode:0o700});
 const configPath=join(directory,'models.json');const overlayPath=join(directory,'overlay.json');
 const overlay=[{id:'llm-deepseek',disabled:true},{id:'llm-deepseek-account',disabled:true},{id:'web-search-deepseek',disabled:true},{id:'agent-default-model',config:{provider:model.provider,model:model.model}},{id:'llm-pi-ai',config:{providers:{[model.provider]:{api:settings.api,baseURL:settings.baseURL,apiKeyEnv:'ALPHA_SMOKE_API_KEY',timeoutMs:90000,retryPolicy:{mode:'normal',maxRetries:0},models:[{id:model.model,input:['text'],contextWindow:262144,maxTokens:4096}]}}}},{insert:[{id:'alpha-team',name:fileURLToPath(new URL('dsh-plugin.mjs',import.meta.url)),config:{modelConfigPath:configPath,stateDirectory:join(directory,'runs')}}]}];
 for(const [path,value]of[[configPath,config],[overlayPath,overlay]])await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});
 return {logicalActors:14,config,configPath,overlayPath};
}
export async function probeLuna(settings,apiKey,{fetchImpl=fetch,timeoutMs=90000}={}){
 const report={schemaVersion:1,at:new Date().toISOString(),baseURL:settings.baseURL,requestedModel:settings.model,api:settings.api,credentialAvailable:Boolean(apiKey),requests:[],inferenceRequests:0,status:'running',independentReview:false,qualityAcceptanceGranted:false,teamRun:false};
 const root=settings.baseURL.replace(/\/+$/,'');
 async function request(path,body,authenticated=true){
  const entry={method:body?'POST':'GET',path,authenticated};report.requests.push(entry);if(body)report.inferenceRequests++;
  const start=Date.now();
  try{
   const r=await fetchImpl(root+path,{method:entry.method,redirect:'manual',headers:{...(authenticated?{Authorization:'Bearer '+apiKey}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeoutMs)});
   entry.httpStatus=r.status;
   if(!authenticated){await r.body?.cancel();return {status:r.status};}
   if(r.status>=300&&r.status<400){await r.body?.cancel();throw Error('REDIRECT_REFUSED');}
   if(!r.ok){await r.body?.cancel();throw Error('HTTP_'+r.status);}
   const chunks=[];let bytes=0;
   for await(const chunk of r.body){bytes+=chunk.length;if(bytes>2*1024*1024)throw Error('RESPONSE_LIMIT');chunks.push(chunk);}
   const value=JSON.parse(Buffer.concat(chunks).toString());
   if(value.usage)entry.usage=Object.fromEntries(['input_tokens','output_tokens','total_tokens'].filter(k=>Number.isFinite(value.usage[k])).map(k=>[k,value.usage[k]]));
   entry.responseModel=value.model;return value;
  }finally{entry.durationMs=Date.now()-start;}
 }
 const output=v=>(v.output??[]).filter(i=>i.type==='message').flatMap(i=>i.content??[]).filter(i=>i.type==='output_text').map(i=>i.text).join('');
 try{
  await request('/models',undefined,false);
  if(!apiKey){report.status='credential_required';return report;}
  const nonce='ALPHA_'+randomUUID().replaceAll('-','');
  const base={model:settings.model,store:false,max_output_tokens:4096};
  const a=await request('/responses',{...base,input:'Connectivity test only. Reply with exactly '+nonce+' and nothing else.'});
  if(a.status!=='completed'||output(a).trim()!==nonce)throw Error('PLAIN_REPLY_NOT_VERIFIED');report.plainReply=true;
  const input=[{role:'user',content:'Call alpha_echo with nonce '+nonce+'. Then output exactly the nonce returned by the tool.'}];
  const tool={type:'function',name:'alpha_echo',description:'Return the nonce without external effects.',strict:true,parameters:{type:'object',properties:{nonce:{type:'string'}},required:['nonce'],additionalProperties:false}};
  const b=await request('/responses',{...base,input,tools:[tool],tool_choice:{type:'function',name:'alpha_echo'},parallel_tool_calls:false});
  const calls=(b.output??[]).filter(i=>i.type==='function_call');
  if(b.status!=='completed'||calls.length!==1||calls[0].name!=='alpha_echo'||JSON.parse(calls[0].arguments).nonce!==nonce)throw Error('TOOL_CALL_NOT_VERIFIED');report.functionCall=true;
  const c=await request('/responses',{...base,input:[...input,...b.output,{type:'function_call_output',call_id:calls[0].call_id,output:JSON.stringify({nonce})}],tools:[tool],tool_choice:'none'});
  if(c.status!=='completed'||output(c).trim()!==nonce)throw Error('TOOL_CONTINUATION_NOT_VERIFIED');
  report.toolContinuation=true;report.status='model_probe_passed';
 }catch(error){
  const code=String(error.cause?.code??error.code??error.message??error.name);
  report.status=report.requests.some(r=>r.httpStatus)?'model_probe_blocked':'transport_blocked';
  report.error=/^[A-Z][A-Z0-9_]+$/.test(code)?code:'PROBE_ERROR';
 }
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const folder=resolve(process.argv[2]??'.artifacts/luna-smoke');await mkdir(folder,{recursive:true,mode:0o700});
  const settings=JSON.parse(await readFile(new URL('luna.gateway.json',import.meta.url),'utf8'));
  const setup=await configureLuna(join(folder,'private'),settings);
  const report=await probeLuna(settings,process.env.ALPHA_SMOKE_API_KEY);
  report.configuration='passed';report.logicalActors=setup.logicalActors;
  await writeFile(join(folder,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='model_probe_passed'?0:2;
 }catch(error){console.error(JSON.stringify({status:'blocked',code:typeof error.code==='string'?error.code:'CONFIG_ERROR'}));process.exitCode=2;}
}
