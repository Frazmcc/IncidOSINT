import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyFreeAccount,collectorOrigin,validCollectorOrigin,uploadMetadata,SITE_ORIGIN} from '../lib/cloudflare-setup.mjs';

test('Free account verification requires a complete successful response and refuses paid or unknown subscriptions',()=>{
  assert.equal(verifyFreeAccount({success:true,result:[]}),true);
  assert.equal(verifyFreeAccount({success:true,result:[{state:'Provisioned',price:0,rate_plan:{id:'free'}}]}),true);
  for(const payload of [null,{success:false,result:[]},{success:true,result:{}},{success:true,result:[],result_info:{total_pages:2}},
    {success:true,result:[{state:'Paid',price:5,rate_plan:{id:'workers_paid'}}]},
    {success:true,result:[{state:'Trial',price:0,rate_plan:{id:'workers_paid'}}]},
    {success:true,result:[{state:'Paid',price:0,rate_plan:{id:'unknown'}}]},
    {success:true,result:[{state:'Provisioned',rate_plan:{id:'free'}}]},
    {success:true,result:[{state:'Paid',price:0,rate_plan:{id:'free',is_contract:true}}]}])assert.throws(()=>verifyFreeAccount(payload));
});
test('Collector control requests are confined to the generated workers.dev origin',()=>{
  const url=collectorOrigin('logic-free-account');assert.equal(validCollectorOrigin(url),true);
  for(const sub of ['',null,'https://example.com','account.workers.dev','a@evil.com','127.0.0.1','-bad'])assert.throws(()=>collectorOrigin(sub));
  for(const url of ['https://example.com','http://logic-emergency-ais.account.workers.dev','https://logic-emergency-ais.account.workers.dev.evil.com','https://logic-emergency-ais.account.workers.dev/start','https://logic-emergency-ais.account.workers.dev@evil.com'])assert.equal(validCollectorOrigin(url),false);
});
test('Cloudflare upload uses SQLite and encrypted backend secrets, retaining existing namespaces on update',()=>{
  const input={aisKey:'test-ais-key',ingestToken:'test-ingest-token',siteToken:'test-service-token'};
  const meta=uploadMetadata(input);
  assert.deepEqual(meta.migrations,{new_tag:'v1',steps:[{new_sqlite_classes:['RescueAIS']}]});
  assert.deepEqual(meta.bindings.filter(b=>b.type==='secret_text').map(b=>b.name).sort(),['AISSTREAM_API_KEY','SITE_SERVICE_TOKEN','VESSEL_INGEST_TOKEN']);
  assert.equal(meta.bindings.find(b=>b.name==='SITE_URL').text,SITE_ORIGIN);
  assert.equal(meta.observability.enabled,false);
  assert.equal(uploadMetadata({...input,existing:true}).migrations,undefined);
});
test('The deployable collector contains every verified MMSI and no unverified identity',async()=>{
  const fleet=JSON.parse(await readFile(new URL('../data/vessels.json',import.meta.url)));
  const expected=[...new Set(fleet.records.filter(r=>/^\d{9}$/.test(r.mmsi||'')&&!r.identity_conflict).map(r=>r.mmsi))].sort();
  const ids=JSON.parse(await readFile(new URL('../collector/cloudflare/mmsis.json',import.meta.url)));
  const bundle=JSON.parse(await readFile(new URL('../data/collector-bundle.json',import.meta.url)));
  assert.deepEqual(ids,expected);assert.equal(bundle.mmsis,ids.length);assert.ok(ids.length<=600);
  for(const id of ids)assert.ok(bundle.source.includes(id));
  assert.ok(bundle.source.length<100000);
});

test('An existing Worker update preserves the AIS secret when the owner leaves its field blank',()=>{
 const meta=uploadMetadata({aisKey:'',ingestToken:'synthetic-ingest',siteToken:'synthetic-site',existing:true});
 assert.deepEqual(meta.keep_bindings,['secret_text']);
 assert.ok(!meta.bindings.some(b=>b.name==='AISSTREAM_API_KEY'));
 assert.equal(meta.migrations,undefined);
 assert.equal(meta.bindings.find(b=>b.name==='SITE_SERVICE_TOKEN').type,'secret_text');
});
