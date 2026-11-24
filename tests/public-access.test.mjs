import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import {Miniflare} from "./helpers/miniflare.mjs";
import {ownerAllowed,setupRequestAllowed,PUBLIC_SITE_ORIGIN,HOSTED_SITE_ORIGIN,securityHeaders} from "../lib/site-security.mjs";

test("owner access fails closed for missing configuration, anonymous visitors and other signed-in accounts",()=>{
  const owner={userId:"verified-owner-id",email:"Owner@example.test"};
  assert.equal(ownerAllowed(owner,"owner@example.test"),true);
  for(const user of [null,{}, {...owner,userId:""},{...owner,email:"visitor@example.test"},{email:owner.email}])assert.equal(ownerAllowed(user,"owner@example.test"),false);
  for(const email of [undefined,null,""])assert.equal(ownerAllowed(owner,email),false);
});

test("setup writes accept only explicit website origins and JSON, never an arbitrary matching Host",()=>{
  const request=(origin,type="application/json")=>new Request("https://attacker.test/api/setup/aircraft",{method:"POST",headers:{Origin:origin,"Content-Type":type}});
  for(const origin of [PUBLIC_SITE_ORIGIN,HOSTED_SITE_ORIGIN])assert.equal(setupRequestAllowed(request(origin,"application/json; charset=utf-8")),true);
  for(const origin of ["https://attacker.test","https://incidosint.com.attacker.test","null","http://incidosint.com",""])assert.equal(setupRequestAllowed(request(origin)),false);
  for(const type of ["text/plain","application/json-malformed","application/x-www-form-urlencoded"])assert.equal(setupRequestAllowed(request(PUBLIC_SITE_ORIGIN,type)),false);
  const headers=new Map(securityHeaders().map(h=>[h.key,h.value]));
  assert.match(headers.get("Content-Security-Policy"),/object-src 'none'/);
  assert.ok(!headers.get("Content-Security-Policy").includes("unsafe-eval"));
  assert.match(headers.get("Content-Security-Policy"),/frame-ancestors 'self' https:\/\/chatgpt.com/);
  assert.equal(headers.get("X-Content-Type-Options"),"nosniff");
});

test("real setup pages and APIs protect owner controls while collector endpoints reject unauthenticated access",async()=>{
  const compiled=await build({stdin:{contents:`
    import {GET as aircraftGet,POST as aircraftPost} from './app/api/setup/aircraft/route.ts';
    import {GET as cloudflareGet,POST as cloudflarePost} from './app/api/setup/cloudflare/route.ts';
    import {POST as ingest} from './app/api/ingest/vessels/route.ts';
    import {POST as collector} from './app/api/collector/aircraft/route.ts';
    import {GET as status} from './app/api/collector/status/route.ts';
    import {GET as config} from './app/api/config/route.ts';
    import {OwnerSetup} from './components/owner-setup.tsx';
    export default {async fetch(r){const p=new URL(r.url).pathname;
      if(p==='/owner-page')return Response.json({hasOwnerForm:await OwnerSetup({returnTo:'/connect/aircraft',children:'SYNTHETIC_OWNER_FORM'})==='SYNTHETIC_OWNER_FORM'});
      if(p==='/aircraft')return r.method==='GET'?aircraftGet():aircraftPost(r);
      if(p==='/cloudflare')return r.method==='GET'?cloudflareGet():cloudflarePost(r);
      if(p==='/ingest')return ingest(r);if(p==='/collector')return collector(r);
      if(p==='/status')return status(r);return config();
    }};
  `,resolveDir:process.cwd()},bundle:true,format:"esm",platform:"neutral",mainFields:["module","main"],jsx:"automatic",define:{"process.env.NODE_ENV":'"production"'},external:["cloudflare:workers"],write:false,
    plugins:[{name:"trusted-test-identity",setup(b){b.onLoad({filter:/\/app\/chatgpt-auth\.ts$/},()=>({loader:"ts",contents:`import {env} from 'cloudflare:workers'; export async function getChatGPTUser(){return env.TEST_IDENTITY?JSON.parse(env.TEST_IDENTITY):null;} export function chatGPTSignInPath(path){return '/signin-with-chatgpt?return_to='+encodeURIComponent(path);}`}));}}],
  });
  let upstream=0;
  for(const identity of [null,{userId:"visitor",email:"visitor@example.test"},{userId:"owner",email:"owner@example.test"}]){
    const mf=new Miniflare({modules:true,script:compiled.outputFiles[0].text,compatibilityDate:"2026-05-22",compatibilityFlags:["nodejs_compat"],d1Databases:{DB:"public-access-test"},bindings:{
      TEST_IDENTITY:identity?JSON.stringify(identity):"",COLLECTOR_OWNER_EMAIL:"owner@example.test",
      VESSEL_INGEST_TOKEN:"synthetic-private-ingest-token-long-enough",SITE_SERVICE_TOKEN:"synthetic-private-service-token",
      AIRCRAFT_KEY_SECRET:"synthetic-encryption-secret-long-enough",MAPTILER_BROWSER_KEY:"public-browser-key",
    },outboundService:()=>{upstream++;throw Error("Authorization checks must not contact a provider.");}});
    try{
      const db=await mf.getD1Database("DB");await db.prepare("CREATE TABLE feed_state(id TEXT PRIMARY KEY,snapshot TEXT,fetched_at INTEGER,next_poll_at INTEGER,window_start INTEGER,requests INTEGER,blocked_until INTEGER,last_error TEXT)").run();
      const isOwner=identity?.userId==="owner";
      assert.equal((await (await mf.dispatchFetch("https://site.test/owner-page")).json()).hasOwnerForm,isOwner);
      for(const route of ["aircraft","cloudflare"]){
        const get=await mf.dispatchFetch(`https://site.test/${route}`,{headers:{"oai-authenticated-user-email":"owner@example.test","oai-authenticated-user-id":"forged-id"}});
        assert.equal(get.status,isOwner?200:403);
        for(const origin of [PUBLIC_SITE_ORIGIN,"https://attacker.test"]){
          const response=await mf.dispatchFetch(`https://site.test/${route}`,{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:"{}"});
          assert.equal(response.status,isOwner&&origin===PUBLIC_SITE_ORIGIN?400:403);
        }
      }
      if(isOwner)for(const route of ["aircraft","cloudflare"]){
        for(const body of ["null","[]","42",'{"action":{}}']){
          const response=await mf.dispatchFetch(`https://site.test/${route}`,{method:"POST",headers:{Origin:PUBLIC_SITE_ORIGIN,"Content-Type":"application/json"},body});
          assert.equal(response.status,400,`${route} must reject malformed setup objects without a provider call`);
        }
      }
      for(const [route,method] of [["ingest","POST"],["collector","POST"],["status","GET"]]){
        const response=await mf.dispatchFetch(`https://site.test/${route}`,{method,headers:{Authorization:"Bearer wrong-token"},...(method==="POST"?{body:"{}"}:{})});
        assert.equal(response.status,401);
      }
      const publicConfig=await (await mf.dispatchFetch("https://site.test/config")).json();
      assert.deepEqual(publicConfig,{maptilerBrowserKey:"public-browser-key",marineConfigured:true});
      assert.equal(JSON.stringify(publicConfig).includes("synthetic-private"),false);
    }finally{await mf.dispose();}
  }
  assert.equal(upstream,0);
});
