import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Miniflare} from "miniflare";

test("Workers accepts authenticated setup requests and blocks every redirect without forwarding credentials", async()=>{
  const helper=await readFile(new URL("../lib/edge-fetch.mjs",import.meta.url),"utf8");
  const calls=[];
  const mf=new Miniflare({modules:true,compatibilityDate:"2026-05-22",script:`${helper}
    export default {async fetch(request){
      try{
        const code=new URL(request.url).pathname.slice(1);
        const upstream=await fetchWithoutRedirect("https://expected-provider.test/"+code,{
          method:"POST",headers:{Authorization:"Bearer synthetic-credential"},
          body:"synthetic-body",redirect:"follow"
        });
        return Response.json({status:upstream.status,body:await upstream.text()});
      }catch(error){return Response.json({error:error.message},{status:502});}
    }};`,
    outboundService:async request=>{
      const url=new URL(request.url);
      calls.push({host:url.hostname,authorization:request.headers.get("Authorization"),body:await request.text()});
      assert.equal(url.hostname,"expected-provider.test","Credentials must never reach the redirect destination.");
      const status=Number(url.pathname.slice(1));
      return status>=300&&status<400
        ? new Response("redirect",{status,headers:{Location:"https://unexpected-destination.test/capture"}})
        : new Response("provider response",{status});
    },
  });
  try {
    for(const status of [200,404]){
      const response=await mf.dispatchFetch(`https://setup.test/${status}`);
      assert.equal(response.status,200);
      assert.deepEqual(await response.json(),{status,body:"provider response"});
    }
    for(const status of [301,302,303,307,308]){
      const response=await mf.dispatchFetch(`https://setup.test/${status}`);
      assert.equal(response.status,502);
      assert.match((await response.json()).error,/unexpected redirect/);
    }
    assert.equal(calls.length,7);
    for(const call of calls){
      assert.equal(call.host,"expected-provider.test");
      assert.equal(call.authorization,"Bearer synthetic-credential");
      assert.equal(call.body,"synthetic-body");
    }
  } finally {await mf.dispose();}
});
