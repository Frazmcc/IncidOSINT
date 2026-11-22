import test from "node:test";
import assert from "node:assert/strict";
import {parseIncidentFeed,mergeIncidentEvents,detectAssetActivity,incidentLink,plainText} from "../lib/incident-core.mjs";
import {INCIDENT_SOURCES} from "../lib/incident-sources.mjs";

const now=Date.parse("2026-11-22T20:00:00Z"),source=INCIDENT_SOURCES[0];
const rss=items=>`<rss version="2.0" xmlns:georss="http://www.georss.org/georss"><channel><title>Official incidents</title><link>https://traffic.wales/</link><pubDate>${new Date(now).toUTCString()}</pubDate>${items}</channel></rss>`;
const item=(extra="",date=new Date(now-60000).toUTCString())=>`<item><title>Collision &amp; closure</title><guid>incident-1</guid><link>https://traffic.wales/incident?a=1&amp;b=2</link><description><![CDATA[<p>Road closed. <a href="https://traffic.wales/details">Details</a></p>]]></description>${date?`<pubDate>${date}</pubDate>`:""}${extra}</item>`;
const report=(kind,at,extra={})=>({id:`${kind}-test`,identifier:"test",name:"TEST",kind,category:kind==="aircraft"?"Medical":"Lifeboat",lat:55.8,lon:-4.2,observedAt:now+at,speed:0,onGround:true,...extra});

test("RSS retains source times, real provider coordinates and functioning source links",()=>{
 const result=parseIncidentFeed(rss(item("<georss:point>52.1 -3.2</georss:point>")),source,now),event=result.events[0];
 assert.equal(event.eventAt,now-60000);assert.equal(event.lat,52.1);assert.equal(event.lon,-3.2);assert.equal(event.confidence,"reported");assert.equal(event.sourceUrl,"https://traffic.wales/incident?a=1&b=2");assert.equal(event.summary,"Road closed. Details");assert.deepEqual(event.relatedLinks,["https://traffic.wales/details"]);
 assert.equal(plainText("&lt;b&gt;Road&lt;/b&gt; &amp; lane"),"Road & lane");assert.equal(incidentLink("javascript:alert(1)"),null);
});
test("a current channel timestamp never makes month-old incident items recent",()=>{
 const old=now-30*86400000,result=parseIncidentFeed(rss(item("",new Date(old).toUTCString())),source,now);
 assert.equal(result.latestSourceAt,old);assert.equal(mergeIncidentEvents(result.events,[],now).length,0);
});
test("missing coordinates stay unlocated; undated reports preserve their first received time",()=>{
 const first=parseIncidentFeed(rss(item("",null)),source,now).events;
 assert.equal(first[0].lat,null);assert.equal(first[0].locationBasis,"unlocated");
 const once=mergeIncidentEvents(first,[],now),later=parseIncidentFeed(rss(item("",null)),source,now+300000).events;
 const twice=mergeIncidentEvents(later,once,now+300000);
 assert.equal(twice[0].eventAt,now);assert.equal(twice[0].firstSeenAt,now);assert.equal(twice.length,1);
});
test("invalid XML, DTD/entity declarations, future dates and impossible positions cannot create current pins",()=>{
 assert.throws(()=>parseIncidentFeed("<rss><channel>",source,now));assert.throws(()=>parseIncidentFeed('<!DOCTYPE rss [<!ENTITY x "text">]>'+rss(item()),source,now));assert.throws(()=>parseIncidentFeed("x".repeat(524289),source,now));
 assert.equal(parseIncidentFeed(rss(item("",new Date(now+3600000).toUTCString())),source,now).events.length,0);
 assert.equal(parseIncidentFeed(rss(item("<georss:point>91 180</georss:point>")),source,now).events[0].lat,null);
});
test("planned works are excluded while incidents involving an emergency remain reports",()=>{
 const works=rss(item().replace("Collision &amp; closure","Scheduled roadworks").replace("Road closed.","Planned maintenance."));assert.equal(parseIncidentFeed(works,source,now).events.length,0);
 assert.equal(parseIncidentFeed(works.replace("Planned maintenance.","Collision within the roadworks."),source,now).events.length,1);
});
test("the 24-hour view is bounded and repeats cannot freshen old reports",()=>{
 const base=mergeIncidentEvents(parseIncidentFeed(rss(item()),source,now).events,[],now);
 assert.equal(mergeIncidentEvents([],base,now+86400000).length,0);
 const many=Array.from({length:400},(_,i)=>({...base[0],id:`i-${i}`,eventAt:now-i*1000}));assert.equal(mergeIncidentEvents(many,[],now).length,250);
});
test("aircraft departures require an observed ground transition without a reception gap",()=>{
 const ground=detectAssetActivity([report("aircraft",0)],{},now);
 const flight=detectAssetActivity([report("aircraft",60000,{onGround:false,speed:80})],ground.state,now+60000);
 assert.equal(flight.events.length,1);assert.equal(flight.events[0].eventType,"departure");assert.equal(flight.events[0].confidence,"inferred");assert.equal(flight.events[0].locationBasis,"asset position");
 assert.equal(detectAssetActivity([report("aircraft",60000,{onGround:false,speed:80})],{},now+60000).events.length,0);
 assert.equal(detectAssetActivity([report("aircraft",1200000,{onGround:false,speed:80})],ground.state,now+1200000).events.length,0);
 assert.equal(detectAssetActivity([report("aircraft",60000,{onGround:false,speed:80})],flight.state,now+90000).events.length,0);
});
test("squawk changes can update a stationary position without duplicating police-code families",()=>{
 const air=report("aircraft",0,{category:"Police",onGround:false,speed:90,territory:"United Kingdom",squawk:"7000",squawkObservedAt:now});
 const baseline=detectAssetActivity([air],{},now),code={...air,squawk:"0032",squawkObservedAt:now+30000};
 const active=detectAssetActivity([code],baseline.state,now+30000);assert.equal(active.events.length,1);assert.equal(active.events[0].eventAt,now+30000);assert.equal(active.state[air.id].at,now);
 assert.equal(detectAssetActivity([{...code,squawk:"0047",squawkObservedAt:now+60000}],active.state,now+60000).events.length,0);
 assert.equal(detectAssetActivity([{...code,territory:"Republic of Ireland"}],baseline.state,now+30000).events.length,0);
 assert.equal(detectAssetActivity([{...code,squawkObservedAt:now-200000}],baseline.state,now).events.length,0);
});
test("vessels require a stationary baseline, real displacement and two fresh moving reports",()=>{
 const dock=detectAssetActivity([report("vessel",0)],{},now);
 const one=detectAssetActivity([report("vessel",30000,{speed:12,lat:55.81})],dock.state,now+30000);assert.equal(one.events.length,0);
 const two=detectAssetActivity([report("vessel",60000,{speed:12,lat:55.82})],one.state,now+60000);assert.equal(two.events.length,1);assert.equal(two.events[0].eventType,"underway");
 assert.equal(detectAssetActivity([report("vessel",60000,{speed:12,lat:55.82})],two.state,now+90000).events.length,0);
 assert.equal(detectAssetActivity([report("vessel",0,{speed:12,lat:55.81})],{},now).events.length,0);
 const drift=detectAssetActivity([report("vessel",30000,{speed:6,lat:55.80001})],dock.state,now+30000);assert.equal(drift.events.length,0);
});
