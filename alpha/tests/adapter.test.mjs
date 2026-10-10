import test from 'node:test';
import assert from 'node:assert/strict';
import {createDshExecutor} from '../dsh-adapter.mjs';
import {loadTeam} from '../core.mjs';
import {fixtureConfig} from '../fixtures.mjs';
const {team}=await loadTeam();
function host(change={}){
 let disposed=0,calls=[],routes=[];
 const backend={inheritsParentContext:false,capabilities:{agentOptions:true,persona:true,toolFilter:true,depthLimit:true}};
 const ctx={on:()=>()=>{},tools:{schemas:()=>[{name:'web_search'},{name:'web_fetch'}]},llm:{resolveCallConfig:async x=>{routes.push(x);return x;}},subagents:{getProvider:()=>backend,start:async(name,request)=>{calls.push({name,request});return {id:'child',result:Promise.resolve({stopReason:'completed',output:[{type:'text',text:'{"sources":[]}'}]}),dispose:async()=>disposed++};}}};
 Object.assign(ctx,change);return {ctx,backend,calls,routes,get disposed(){return disposed;}};
}
const request={actor:'research-shadow',role:team.roles.find(r=>r.id==='architect'),phase:'prepare',model:fixtureConfig(team).models[1],input:{brief:{goal:'x'}},persona:'independent research',signal:new AbortController().signal};
test('native adapter preflights the real DSH provider and routes',async()=>{const h=host();await createDshExecutor(h.ctx,{}).preflight(team,fixtureConfig(team),request.signal);assert.equal(h.routes.length,2);});
test('fork backend cannot leak the lead context into shadow preparation',async()=>{const h=host();h.backend.inheritsParentContext=true;await assert.rejects(createDshExecutor(h.ctx,{}).preflight(team,fixtureConfig(team),request.signal),{code:'DSH_FRESH_PROVIDER'});});
test('missing tool restriction support fails before a child is created',async()=>{const h=host();h.backend.capabilities.toolFilter=false;await assert.rejects(createDshExecutor(h.ctx,{}).preflight(team,fixtureConfig(team),request.signal),{code:'DSH_CAPABILITY'});assert.equal(h.calls.length,0);});
test('missing web backend tool is not reported as available',async()=>{const h=host({tools:{schemas:()=>[]}});await assert.rejects(createDshExecutor(h.ctx,{}).preflight(team,fixtureConfig(team),request.signal),{code:'DSH_TOOL_MISSING'});});
test('model metadata failure propagates before any child',async()=>{const h=host({llm:{resolveCallConfig:async()=>{throw new Error('unavailable model');}}});await assert.rejects(createDshExecutor(h.ctx,{}).preflight(team,fixtureConfig(team),request.signal),/unavailable model/);assert.equal(h.calls.length,0);});
test('model override, read-only allowlist and persona reach native start and handle is disposed',async()=>{const h=host();await createDshExecutor(h.ctx,{id:'parent'}).execute(request);const r=h.calls[0].request;assert.equal(r.agentOptions.model,'b');assert.deepEqual(r.toolFilter,{allow:['web_search','web_fetch']});assert.equal(r.maxDepth,1);assert.equal(h.disposed,1);});
test('malformed output is an error and still disposes the child',async()=>{const h=host();h.ctx.subagents.start=async()=>({result:Promise.resolve({stopReason:'completed',output:[{type:'text',text:'not json'}]}),dispose:async()=>h.calls.push('disposed')});await assert.rejects(createDshExecutor(h.ctx,{}).execute(request),{code:'DSH_JSON'});assert.ok(h.calls.includes('disposed'));});
test('abnormal child completion cannot be normalized to success',async()=>{const h=host();h.ctx.subagents.start=async()=>({result:Promise.resolve({stopReason:'max-tokens',output:[]}),dispose:async()=>h.calls.push('disposed')});await assert.rejects(createDshExecutor(h.ctx,{}).execute(request),{code:'DSH_CHILD_FAILED'});assert.ok(h.calls.includes('disposed'));});
test('observer and child asynchronous disposers are awaited before adapter completion',async()=>{
 const h=host();let observerClosed=false,childClosed=false;
 h.ctx.on=()=>async()=>{await new Promise(r=>setTimeout(r,5));observerClosed=true;};
 h.ctx.subagents.start=async()=>({id:'child',localAgent:{id:'child'},result:Promise.resolve({stopReason:'completed',output:[{type:'text',text:'{"sources":[]}'}]}),dispose:async()=>{assert.equal(observerClosed,true);await new Promise(r=>setTimeout(r,5));childClosed=true;}});
 await createDshExecutor(h.ctx,{}).execute(request);assert.equal(observerClosed,true);assert.equal(childClosed,true);
});
test('abort interrupts a waiting result and disposal is awaited',async()=>{
 const h=host(),ctl=new AbortController();let closed=false;
 h.ctx.subagents.start=async()=>({result:new Promise(()=>{}),dispose:async()=>{await new Promise(r=>setTimeout(r,5));closed=true;}});
 const pending=createDshExecutor(h.ctx,{}).execute({...request,signal:ctl.signal});setTimeout(()=>ctl.abort(new Error('cancelled')),10);
 await assert.rejects(pending,/cancelled/);assert.ok(closed);
});

function researchHost({receipt=true,other=false,error=false,tool='web_fetch'}={}){
 const h=host();let listener;h.ctx.on=(_name,fn)=>{listener=fn;return()=>{listener=undefined;}};
 const own={id:'own'},stranger={id:'other'};
 h.ctx.subagents.start=async()=>{
  if(receipt)listener({agent:other?stranger:own,name:tool,callId:'f1',arguments:{url:'https://example.org/source'}},{isError:error,content:[{type:'text',text:'fixture source body'}]});
  return {id:'own',localAgent:own,result:Promise.resolve({stopReason:'completed',output:[{type:'text',text:JSON.stringify({sources:[{url:'https://example.org/source'}],_host:{childId:'forged'}})}]}),dispose:async()=>{}};
 };return h;
}
const researchRequest={...request,role:team.roles.find(r=>r.id==='research')};
test('research self-report without native fetched-text receipt is refused',async()=>{const h=researchHost({receipt:false});await assert.rejects(createDshExecutor(h.ctx,{}).execute(researchRequest),{code:'RESEARCH_NOT_FETCHED'});});
test('search snippets alone do not satisfy fetched source admission',async()=>{const h=researchHost({tool:'web_search'});await assert.rejects(createDshExecutor(h.ctx,{}).execute(researchRequest),{code:'RESEARCH_NOT_FETCHED'});});
test('another agents fetch cannot satisfy this shadows independent research',async()=>{const h=researchHost({other:true});await assert.rejects(createDshExecutor(h.ctx,{}).execute(researchRequest),{code:'RESEARCH_NOT_FETCHED'});});
test('an errored fetch does not satisfy source admission',async()=>{const h=researchHost({error:true});await assert.rejects(createDshExecutor(h.ctx,{}).execute(researchRequest),{code:'RESEARCH_NOT_FETCHED'});});
test('native receipt binds the actual child and replaces forged host metadata',async()=>{const h=researchHost();const r=await createDshExecutor(h.ctx,{}).execute(researchRequest);assert.equal(r._host.childId,'own');assert.equal(r._host.toolReceipts.length,1);assert.match(r._host.toolReceipts[0].contentHash,/^[a-f0-9]{64}$/);});
test('generated web specialist requires its own fetched source receipt regardless of name',async()=>{
 const call={...request,role:{id:'step:unfamiliar-specialist',tools:['web_fetch'],requiresFetchedSources:true}};
 const missing=researchHost({receipt:false});await assert.rejects(createDshExecutor(missing.ctx,{}).execute(call),{code:'RESEARCH_NOT_FETCHED'});
 const borrowed=researchHost({other:true});await assert.rejects(createDshExecutor(borrowed.ctx,{}).execute(call),{code:'RESEARCH_NOT_FETCHED'});
 const present=researchHost();const result=await createDshExecutor(present.ctx,{}).execute(call);assert.equal(result._host.childId,'own');
});
test('cleanup failures drain both paths and preserve the original child error',async()=>{
 const h=host();let disposed=false;h.ctx.on=()=>async()=>{throw new Error('observer cleanup');};
 h.ctx.subagents.start=async()=>({id:'child',result:Promise.resolve({stopReason:'completed',output:[{type:'text',text:'invalid JSON'}]}),dispose:async()=>{disposed=true;throw new Error('child cleanup');}});
 await assert.rejects(createDshExecutor(h.ctx,{}).execute(request),{code:'DSH_JSON'});assert.equal(disposed,true);
});
test('observer cleanup failure remains visible after successful child output and child disposal',async()=>{
 const h=host();let disposed=false;h.ctx.on=()=>async()=>{throw new Error('observer cleanup');};
 h.ctx.subagents.start=async()=>({id:'child',result:Promise.resolve({stopReason:'completed',output:[{type:'text',text:'{"sources":[]}'}]}),dispose:async()=>{disposed=true;}});
 await assert.rejects(createDshExecutor(h.ctx,{}).execute(request),/observer cleanup/);assert.equal(disposed,true);
});
