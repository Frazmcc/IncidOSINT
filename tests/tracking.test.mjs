import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { aircraftPolicy, normalizeAircraft, normalizeVessels, RESERVE_POLL_SQL, retryDelay, DAY_MS } from "../lib/tracking-core.mjs";
import { decodePosition, subscription } from "../collector/ais-codec.mjs";
import { assetType } from "../lib/asset-types.mjs";
const now=1_800_000_000_000;
const fleet=[{icao_hex:"4077c7",registration:"G-GSAS",category:"Air ambulance / HEMS",service:"Medical service",fleet_status:"Cover status uncertain"}];
test("10,000 visitors acquire one durable upstream lease; interval, cap and blocked-until survive new connections",()=>{
 const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE feed_state(id TEXT PRIMARY KEY,next_poll_at INTEGER,window_start INTEGER,requests INTEGER,blocked_until INTEGER)");db.prepare("INSERT INTO feed_state VALUES(?,0,?,0,0)").run("aircraft",now-1);
 const reserve=db.prepare(RESERVE_POLL_SQL),call=t=>reserve.get(t+180_000,t-DAY_MS,t,"aircraft",480);
 let acquired=0;for(let i=0;i<10_000;i++)if(call(now))acquired++;
 assert.equal(acquired,1);assert.equal(call(now+179_999),undefined);assert.ok(call(now+180_000));
 db.prepare("UPDATE feed_state SET requests=480,next_poll_at=0").run();assert.equal(call(now+360_000),undefined);
 assert.ok(call(now+DAY_MS));assert.equal(db.prepare("SELECT requests FROM feed_state").get().requests,1);
 db.prepare("UPDATE feed_state SET next_poll_at=0,blocked_until=?").run(now+DAY_MS+500_000);assert.equal(call(now+DAY_MS+1),undefined);db.close();
});
test("free aircraft policies cannot exceed documented quotas",()=>{const a=aircraftPolicy();assert.equal(a.limit,480);assert.equal(a.intervalMs,180_000);const b=aircraftPolicy("adsblol",true);assert.ok(b.limit<=1000);assert.ok(b.intervalMs>=90_000);assert.equal(aircraftPolicy("paid-unrecognised").provider,"adsblol");});
test("position freshness uses seen_pos; tower identities, missing coordinates and reused registrations are excluded",()=>{
 const valid={hex:"4077c7",r:"G-GSAS",lat:55.8,lon:-4.2,seen:1,seen_pos:45,gs:100};
 const output=normalizeAircraft({now,ac:[valid,{...valid,r:"TWR",type:"adsb_icao_nt"},{...valid,lat:undefined},{...valid,seen_pos:901}]},fleet,now);
 assert.equal(output.records.length,1);assert.equal(output.records[0].observedAt,now-45_000);assert.equal(output.rejected.length,1);
 assert.throws(()=>normalizeAircraft({now,error:"bad response"},fleet,now));
});
test("marine input accepts only registered, resolved, recent coordinates and never turns a static station into a position",()=>{
 const boats=[{mmsi:"232001234",vessel_name:"Test lifeboat",category:"Lifeboat",service:"RNLI"},{mmsi:"235108838",identity_conflict:true,vessel_name:"Conflicting source",category:"Lifeboat"}];
 const p={mmsi:"232001234",lat:55.8,lon:-4.2,observedAt:now-20_000,speed:102.3};
 const result=normalizeVessels([p,{...p,mmsi:"235108838"},{...p,mmsi:"999999999"},{...p,lat:91},{...p,observedAt:now+90_000}],boats,now);
 assert.equal(result.length,1);assert.equal(result[0].speed,null);assert.equal(result[0].observedAt,now-20_000);
});
test("class B rescue craft are decoded; metadata received time is explicit when report time is absent",()=>{
 const allowed=new Set(["232001234"]),e={MessageType:"StandardClassBPositionReport",MetaData:{MMSI:232001234},Message:{StandardClassBPositionReport:{Latitude:55,Longitude:-4,Sog:12.5,Cog:90}}};
 const p=decodePosition(e,allowed,now);assert.equal(p.timeBasis,"received");assert.equal(p.speed,12.5);assert.equal(p.observedAt,now);
 assert.equal(decodePosition({...e,Message:{StandardClassBPositionReport:{Latitude:91,Longitude:181}}},allowed,now),null);
 assert.equal(decodePosition({...e,MetaData:{MMSI:232001234,time_utc:new Date(now-901_000).toISOString()}},allowed,now),null);
 assert.throws(()=>subscription("not-a-real-key",Array(201).fill("232001234")));
 assert.ok(subscription("not-a-real-key",["232001234"]).FilterMessageTypes.includes("StandardClassBPositionReport"));
});
test("429 respects Retry-After; credential errors stop collection for a day",()=>{assert.equal(retryDelay(new Response(null,{status:429,headers:{"Retry-After":"7200"}}),now),7_200_000);assert.equal(retryDelay(new Response(null,{status:403}),now),DAY_MS);});

test("aircraft shapes follow recorded models, including fixed-wing air ambulances; missing models stay unconfirmed",()=>{
 assert.equal(assetType({kind:"aircraft",typeCode:"BE20",service:"Air ambulance"}).id,"plane");
 assert.equal(assetType({kind:"aircraft",typeCode:"LJ45",service:"Medical"}).id,"jet");
 assert.equal(assetType({kind:"aircraft",typeCode:"EC35",service:"Police"}).id,"helicopter");
 assert.equal(assetType({kind:"aircraft",typeCode:"",service:"Helicopter medical service"}).id,"aircraft-unknown");
 assert.equal(assetType({kind:"aircraft",typeCode:"UNRECOGNISED"}).id,"aircraft-unknown");
 const records=[{...fleet[0],type_code:"BE20"},{...fleet[0],icao_hex:"406de6",registration:"G-TEST",type_code:"A139"}];
 const ac=records.map(r=>({hex:r.icao_hex,r:r.registration,lat:55,lon:-4,seen_pos:2}));
 const result=normalizeAircraft({now,ac},records,now).records;
 assert.deepEqual(result.map(r=>r.assetType.id),["plane","helicopter"]);
 assert.match(result[0].assetType.detail,/King Air 200/);
});

test("vessel classes distinguish hull types without inferring them from police or lifeboat service membership",()=>{
 const type=class_or_type=>assetType({kind:"vessel",class_or_type}).id;
 assert.equal(type("Shannon"),"all-weather-lifeboat");
 assert.equal(type("D-Class"),"inshore-lifeboat");
 assert.equal(type("Atlantic 85"),"inshore-lifeboat");
 assert.equal(type("Police RHIB"),"rib");
 assert.equal(type("42 ft all-weather police launch"),"patrol-launch");
 assert.equal(type("16 m Camarc fire/rescue boat"),"fire-rescue-boat");
 assert.equal(type("Fire/rescue RIB"),"rib");
 assert.equal(type("Emergency towing vessel"),"tug");
 assert.equal(type("Hovercraft"),"hovercraft");
 assert.equal(assetType({kind:"vessel",class_or_type:"Boat",category:"Lifeboat"}).id,"vessel-unknown");
 assert.equal(assetType({kind:"vessel",service:"Police"}).id,"vessel-unknown");
 const boats=[{mmsi:"232001234",vessel_name:"Known hull",class_or_type:"Tamar",category:"Lifeboat"}];
 const [received]=normalizeVessels([{mmsi:"232001234",lat:55,lon:-4,observedAt:now}],boats,now);
 assert.equal(received.assetType.id,"all-weather-lifeboat");
 assert.equal(received.typeCode,"Tamar");
});
