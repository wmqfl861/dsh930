/** Test-only Responses wire fixture. Never used as a live fallback. */
export function fixtureSse(output) {
  const response = {id:'resp_fixture',object:'response',status:'completed',model:'gpt-6-luna',output,
    usage:{input_tokens:20,output_tokens:10,total_tokens:30,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:3}}};
  const events = [{type:'response.created',response:{...response,status:'in_progress',output:[]}}];
  output.forEach((item, index) => {
    events.push({type:'response.output_item.added',output_index:index,item});
    if (item.type === 'message') events.push({type:'response.output_text.delta',output_index:index,content_index:0,item_id:item.id,delta:item.content[0].text});
    events.push({type:'response.output_item.done',output_index:index,item});
  });
  events.push({type:'response.completed',response});
  const bytes=Buffer.from(events.map(e=>'event: '+e.type+'\r\ndata: '+JSON.stringify(e)+'\r\n\r\n').join(''));
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=11)c.enqueue(bytes.subarray(i,i+11));c.close();}}),{headers:{'content-type':'text/event-stream'}});
}
export function nativeFixtureResponse(body, nonce) {
  if (!body.input.some(x=>x.type==='function_call_output')) return fixtureSse([
    {id:'rs_fixture',type:'reasoning',summary:[],encrypted_content:'opaque-fixture-reasoning'},
    {id:'fc_fixture',type:'function_call',name:'alpha_echo',call_id:'call_fixture',arguments:JSON.stringify({nonce}),status:'completed'},
  ]);
  if (!body.input.some(x=>x.encrypted_content==='opaque-fixture-reasoning')) throw Error('NATIVE_REASONING_REPLAY_MISSING');
  if (!body.input.some(x=>x.type==='function_call_output'&&x.call_id==='call_fixture')) throw Error('NATIVE_CALL_ID_CHANGED');
  return fixtureSse([{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:nonce,annotations:[]}]}]);
}
