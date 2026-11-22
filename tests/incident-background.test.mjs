import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";

test("existing authenticated collector check-ins schedule incidents without delaying or consuming the aircraft request",async()=>{
 const compiled=await build({stdin:{contents:'import worker from "./worker/index.ts";export {calls,release} from "incident-background-test";export default worker;',resolveDir:process.cwd()},bundle:true,format:"esm",platform:"node",define:{"import.meta.env.DEV":"false"},external:["node:async_hooks"],write:false,plugins:[{name:"worker-harness",setup(build){
  build.onResolve({filter:/^vinext\/server\/fetch-handler$/},()=>({path:"handler",namespace:"incident-test"}));
  build.onResolve({filter:/^(?:incident-background-test|.*lib\/incident-store)$/},()=>({path:"incident",namespace:"incident-test"}));
  build.onLoad({filter:/.*/,namespace:"incident-test"},args=>({contents:args.path==="handler"?'export default {async fetch(request){return new Response(await request.text());}};':'export const calls=[];const releases=[];export function release(){for(const done of releases.splice(0))done();}export function refreshIncidentFeeds(db){calls.push(db);return new Promise(resolve=>releases.push(resolve));}',loader:"js"}));
 }}]});
 const module=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
 const db={name:"synthetic-db"},env={DB:db,VESSEL_INGEST_TOKEN:"synthetic-control-token"},pending=[],ctx={props:{},waitUntil:promise=>pending.push(promise)};
 const request=(url,auth,method="POST")=>new Request(url,{method,headers:auth?{Authorization:"Bearer synthetic-control-token"}:{},...(method==="POST"?{body:'{"action":"lease"}'}:{})});
 await module.default.fetch(request("https://site.test/api/collector/aircraft",false),env,ctx);assert.equal(module.calls.length,0);
 await module.default.fetch(request("https://site.test/other",true),env,ctx);assert.equal(module.calls.length,0);
 const response=await module.default.fetch(request("https://site.test/api/collector/aircraft",true),env,ctx);
 assert.equal(await response.text(),'{"action":"lease"}');assert.equal(module.calls.length,1);assert.equal(module.calls[0],db);assert.equal(pending.length,1);
 module.release();await Promise.all(pending);
});
