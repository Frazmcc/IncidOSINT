import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,WebSocketPair,Response as WorkerResponse} from 'miniflare';

test('The actual shared worker subscribes once per MMSI chunk, decodes binary AIS frames and forwards vessel positions without a map viewer',async()=>{
 const bundle=JSON.parse(await readFile(new URL('../data/collector-bundle.json',import.meta.url)));
 const subscriptions=[],snapshots=[],upstream=[];
 const mf=new Miniflare({modules:true,script:bundle.source,compatibilityDate:'2026-05-22',bindings:{AISSTREAM_API_KEY:'synthetic-ais-key',VESSEL_INGEST_TOKEN:'synthetic-control-token',SITE_SERVICE_TOKEN:'synthetic-site-token',SITE_URL:'https://private-site.test'},durableObjects:{AIS_COLLECTOR:{className:'RescueAIS',useSQLite:true}},outboundService:async request=>{
  const url=new URL(request.url);upstream.push(url.hostname);
  if(url.hostname==='stream.aisstream.io'){
   const pair=new WebSocketPair(),server=pair[1];server.accept();
   server.addEventListener('message',event=>{
    const subscription=JSON.parse(event.data);subscriptions.push(subscription);
    server.send(new TextEncoder().encode(JSON.stringify({MessageType:'SubscriptionConfirmation',Message:{CompressionEnabled:true}})).buffer);
    const mmsi=Number(subscription.FiltersShipMMSI[0]);
    server.send(new TextEncoder().encode(JSON.stringify({MessageType:'StandardClassBPositionReport',MetaData:{MMSI:mmsi,time_utc:new Date().toISOString()},Message:{StandardClassBPositionReport:{Valid:true,Latitude:55.8,Longitude:-4.2,Sog:5,Cog:90}}})).buffer);
   });
   return new WorkerResponse(null,{status:101,webSocket:pair[0]});
  }
  assert.equal(url.hostname,'private-site.test');
  assert.equal(request.headers.get('OAI-Sites-Authorization'),'Bearer synthetic-site-token');
  const body=await request.json();
  if(url.pathname==='/api/ingest/vessels'){snapshots.push(body);return new Response(JSON.stringify({accepted:body.positions.length}),{headers:{'Content-Type':'application/json'}});}
  assert.equal(url.pathname,'/api/collector/aircraft');assert.equal(body.action,'lease');
  return new Response(JSON.stringify({acquired:false,nextPollAt:Date.now()+180000}),{headers:{'Content-Type':'application/json'}});
 }});
 const headers={Authorization:'Bearer synthetic-control-token'};
 try{
  assert.equal((await mf.dispatchFetch('https://collector.test/start',{method:'POST',headers})).status,200);
  let status;
  for(let i=0;i<60;i++){
   status=await (await mf.dispatchFetch('https://collector.test/status',{headers})).json();
   if(status.vessels===3&&snapshots.some(s=>s.positions.length===3))break;
   await new Promise(resolve=>setTimeout(resolve,50));
  }
  assert.equal(subscriptions.length,3);assert.equal(status.subscriptionsAccepted,3);assert.equal(status.vessels,3);assert.equal(status.decodeErrors,0);assert.ok(status.binaryMessages>=6);
  assert.ok(snapshots.some(s=>s.positions.length===3),'The alarm must forward real decoded positions without a map request.');
  assert.equal(new Set(subscriptions.flatMap(s=>s.FiltersShipMMSI)).size,bundle.mmsis);
  for(const s of subscriptions){assert.equal(s.APIKey,'synthetic-ais-key');assert.ok(s.FiltersShipMMSI.length<=200);assert.deepEqual(s.BoundingBoxes,[[[48,-14],[63.5,6]]]);}
  for(let i=0;i<5;i++)await mf.dispatchFetch('https://collector.test/status',{headers});
  assert.equal(subscriptions.length,3);
 }finally{await mf.dispatchFetch('https://collector.test/stop',{method:'POST',headers});await mf.dispose();}
});
