/** Probe-process preloader. Observes native requests without rewriting their model or reasoning. */
import {readFileSync,writeFileSync} from 'node:fs';
import {assertLunaWire,safeRequestSummary,readResponsesStream,pickUsage,errorDiagnostic,redactDiagnostic} from './luna-responses.mjs';
import {createLunaBudget} from './luna-budget.mjs';
const config=JSON.parse(readFileSync(process.env.ALPHA_LUNA_GUARD_CONFIG,'utf8'));
const realFetch=globalThis.fetch.bind(globalThis);
const requests=[],pending=[];
const budget=createLunaBudget({...config.budget,maxRequests:2});
const guard={verified:false,async flush(){await Promise.all(pending);}};
globalThis[Symbol.for('dsh.alpha.luna.guard')]=guard;
globalThis.fetch=async(input,options)=>{
  const request=new Request(input,options);const body=JSON.parse(await request.clone().text());
  assertLunaWire(request.url,body,config.settings);budget.options.beforeInference(body);
  const entry={request:safeRequestSummary(body),path:'/responses',method:request.method};requests.push(entry);
  const started=Date.now();
  try {
    let response;
    if(config.fixture){
      const {nativeFixtureResponse}=await import('./tests/luna-sse-fixture.mjs');response=nativeFixtureResponse(body,config.nonce);
    }else{
      if(!process.env.ALPHA_SMOKE_API_KEY)throw Error('CREDENTIAL_REQUIRED');
      response=await realFetch(request,{redirect:'manual',signal:AbortSignal.any([request.signal,AbortSignal.timeout(90000)])});
    }
    entry.httpStatus=response.status;entry.contentType=redactDiagnostic(response.headers.get('content-type')??'',[process.env.ALPHA_SMOKE_API_KEY]).slice(0,256);
    if(!response.ok){
      entry.diagnostic=await errorDiagnostic(response,[process.env.ALPHA_SMOKE_API_KEY]);
      throw Error('HTTP_'+response.status);
    }
    const [sdk,monitor]=response.body.tee();
    pending.push((async()=>{
      try {
        const value=await readResponsesStream(new Response(monitor,{headers:response.headers}));
        entry.usage=pickUsage(value.usage);entry.responseModel=redactDiagnostic(value.model??'',[process.env.ALPHA_SMOKE_API_KEY]).slice(0,256);entry.completed=value.model===config.settings.model;if(!entry.completed)entry.error='RESPONSE_MODEL_MISMATCH';
      }catch{entry.streamFailed=true;}
      finally{entry.durationMs=Date.now()-started;budget.options.afterInference(entry);}
    })());
    return new Response(sdk,{status:response.status,headers:response.headers});
  }catch(error){entry.durationMs=Date.now()-started;entry.error=/^(HTTP_[0-9]+|[A-Z_]+)$/.test(error.message)?error.message:'TRANSPORT_ERROR';throw Error(entry.error);}
};
process.once('exit',()=>{
  const output={kind:config.fixture?'native_wire_fixture':'native_live_probe',controller:'deterministic-test-driver',
    nativeSubagent:true,verified:guard.verified&&requests.length===2&&requests.every(x=>x.completed===true),model:'gpt-6-luna',reasoningEffort:'max',
    inferenceRequests:config.fixture?0:requests.length,fixtureRequests:config.fixture?requests.length:0,
    successfulInferenceRequests:config.fixture?0:requests.filter(x=>x.completed).length,
    requests,budget:{...budget.report(),synthetic:config.fixture===true},teamRun:false,qualityAcceptanceGranted:false};
  writeFileSync(config.report,JSON.stringify(output,null,2)+'\n',{mode:0o600});
});
