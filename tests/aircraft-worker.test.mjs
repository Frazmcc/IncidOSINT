import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';

test('Background aircraft polling obtains a central lease, keeps site credentials off the provider request and reports success or retry limits',async()=>{
 const compiled=await build({stdin:{contents:'import {pollSharedAircraft} from "./collector/aircraft-poll.mjs";export default {async fetch(r,env){return Response.json(await pollSharedAircraft(env));}}',resolveDir:process.cwd()},bundle:true,format:'esm',platform:'neutral',write:false});
 let mode='success',providerCalls=0;const reports=[],hosts=[];
 const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-05-22',bindings:{SITE_URL:'https://private-site.test',SITE_SERVICE_TOKEN:'synthetic-site-secret',VESSEL_INGEST_TOKEN:'synthetic-control-secret'},outboundService:async request=>{
  const url=new URL(request.url);hosts.push(url.hostname);
  if(url.hostname==='private-site.test'){
   assert.equal(request.headers.get('Authorization'),'Bearer synthetic-control-secret');assert.equal(request.headers.get('OAI-Sites-Authorization'),'Bearer synthetic-site-secret');
   const body=await request.json();
   if(body.action==='lease')return Response.json(mode==='waiting'?{acquired:false,nextPollAt:Date.now()+180000,requestsUsed:480,requestLimit:480}:{acquired:true,pollId:'synthetic-lease',url:'https://api.adsb.lol/v2/icao/4077c7',apiKey:'synthetic-free-provider-key',intervalMs:180000});
   assert.equal(body.action,'report');reports.push(body);return Response.json({accepted:body.statusCode===200,positions:body.statusCode===200?1:0,nextPollAt:Date.now()+3600000});
  }
  assert.equal(url.hostname,'api.adsb.lol');providerCalls++;
  assert.equal(request.headers.get('x-api-key'),'synthetic-free-provider-key');assert.equal(request.headers.get('Authorization'),null);assert.equal(request.headers.get('OAI-Sites-Authorization'),null);
  if(mode==='rate')return new Response('Rate limited',{status:429,headers:{'Retry-After':'3600'}});
  if(mode==='redirect')return new Response(null,{status:302,headers:{Location:'https://unexpected.test/capture'}});
  return Response.json({now:Date.now(),ac:[{hex:'4077c7',lat:55,lon:-4,seen_pos:1}]});
 }});
 try{
  const poll=async()=>await (await mf.dispatchFetch('https://worker.test/poll')).json();
  assert.equal((await poll()).state,'receiving');assert.equal(reports[0].payload.ac[0].hex,'4077c7');
  mode='waiting';assert.equal((await poll()).state,'waiting');assert.equal(providerCalls,1);assert.equal(reports.length,1);
  mode='rate';assert.equal((await poll()).state,'paused');assert.equal(reports[1].statusCode,429);assert.equal(reports[1].retryAfter,'3600');
  mode='redirect';assert.equal((await poll()).state,'paused');assert.equal(reports[2].statusCode,502);
  assert.ok(!hosts.includes('unexpected.test'));assert.equal(providerCalls,3);
 }finally{await mf.dispose();}
});
