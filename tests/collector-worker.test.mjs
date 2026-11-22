import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

test('The real SQLite Durable Object authenticates controls and stays stopped without opening upstream sockets',async()=>{
  const bundle=JSON.parse(await readFile(new URL('../data/collector-bundle.json',import.meta.url)));
  let upstream=0;
  const mf=new Miniflare({modules:true,script:bundle.source,compatibilityDate:'2026-05-22',
    bindings:{AISSTREAM_API_KEY:'synthetic-key-never-sent',VESSEL_INGEST_TOKEN:'synthetic-control-token'},
    durableObjects:{AIS_COLLECTOR:{className:'RescueAIS',useSQLite:true}},
    outboundService:()=>{upstream++;throw Error('No upstream network is allowed in this test.');},
  });
  const headers={Authorization:'Bearer synthetic-control-token'};
  try {
    assert.equal((await mf.dispatchFetch('https://collector.test/status')).status,401);
    const initial=await (await mf.dispatchFetch('https://collector.test/status',{headers})).json();
    assert.equal(initial.active,false);assert.equal(initial.connections,0);
    assert.equal((await mf.dispatchFetch('https://collector.test/start',{headers})).status,405);
    assert.equal((await mf.dispatchFetch('https://collector.test/unknown',{headers})).status,404);
    const stopped=await (await mf.dispatchFetch('https://collector.test/stop',{method:'POST',headers})).json();
    assert.equal(stopped.active,false);assert.equal(stopped.status,'stopped');
    assert.equal((await (await mf.dispatchFetch('https://collector.test/status',{headers})).json()).active,false);
    assert.equal(upstream,0);
  } finally {await mf.dispose();}
});
