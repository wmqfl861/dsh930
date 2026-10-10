/** Preload-only synthetic wire transport. No original fetch or network fallback is retained. */
import {readFileSync} from 'node:fs';
import {trialFixtureResponse} from './team-trial-responses.mjs';
import {fixtureSse} from './luna-sse-fixture.mjs';
const config=JSON.parse(readFileSync(process.env.ALPHA_TEAM_TRIAL_GUARD_CONFIG,'utf8'));
if(config.wireFixture!==true||process.env.ALPHA_SMOKE_API_KEY!=='alpha-synthetic-wire-fixture-only')throw Error('WIRE_FIXTURE_REQUIRED');
globalThis[Symbol.for('dsh.alpha.team-trial.wire-fixture')]=true;
globalThis.fetch=async(input,options)=>{
 const request=new Request(input,options);
 if(request.url!==config.settings.baseURL+'/responses'||request.method!=='POST')throw Error('WIRE_FIXTURE_NETWORK_REFUSED');
 if(request.headers.get('authorization')!=='Bearer alpha-synthetic-wire-fixture-only')throw Error('WIRE_FIXTURE_AUTH');
 const body=JSON.parse(await request.text());
 const texts=body.input.flatMap(item=>typeof item.content==='string'?[item.content]:(item.content??[]).filter(block=>typeof block.text==='string').map(block=>block.text));
 const output=trialFixtureResponse(texts);
 if(config.wireFixtureScenario==='incomplete-review'&&output.subjectHash)return new Response('data: '+JSON.stringify({type:'response.incomplete',response:{model:config.settings.model,status:'incomplete',output:[],usage:{input_tokens:12,output_tokens:7}}})+'\n\n',{headers:{'content-type':'text/event-stream'}});
 if(config.wireFixtureScenario==='tool-call-builder'&&output.members)return fixtureSse([{id:'fc_forbidden',type:'function_call',name:'web_fetch',call_id:'forbidden_call',arguments:JSON.stringify({url:'https://fixture.invalid/forbidden'}),status:'completed'}]);
 return fixtureSse([{id:'msg_team_trial_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(output),annotations:[]}]}]);
};
