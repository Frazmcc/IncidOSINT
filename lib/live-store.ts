import { env } from "cloudflare:workers";
import aircraft from "../data/aircraft.json";
import vessels from "../data/vessels.json";
import { aircraftPolicy, DAY_MS, normalizeAircraft, normalizeVessels, mergeAircraftSnapshots, mergeVesselSnapshots, RESERVE_POLL_SQL, retryDelay } from "./tracking-core.mjs";
import { captureAircraftTrails } from "./trail-store";
import { captureVesselTrails } from "./vessel-trail-store";
import { readAircraftKey } from "./aircraft-key.mjs";
import { fetchWithoutRedirect } from "./edge-fetch.mjs";
import {captureAssetActivity} from "./incident-store";
import {combineAircraftSnapshots} from "./aircraft-fusion.mjs";

export const runtimeEnv = () => env as Cloudflare.Env & {
  ADSB_PROVIDER?: string; ADSB_LOL_FREE_KEY?: string; MAPTILER_BROWSER_KEY?: string;
  VESSEL_INGEST_TOKEN?: string; AIRCRAFT_KEY_SECRET?:string; ADSB_FI_ENABLED?:string;
};
type FeedRow = { id:string; snapshot:string; fetched_at:number; next_poll_at:number; window_start:number; requests:number; blocked_until:number; last_error:string|null };
const EMPTY = JSON.stringify({ records:[], rejected:[] });

async function ensureFeed(id:string) {
  const db = runtimeEnv().DB;
  if (!db) throw new Error("Shared tracking storage is unavailable. Upstream requests are paused.");
  await db.prepare("INSERT INTO feed_state (id, snapshot, fetched_at, next_poll_at, window_start, requests, blocked_until) VALUES (?, ?, 0, 0, 0, 0, 0) ON CONFLICT(id) DO NOTHING").bind(id, EMPTY).run();
  return db;
}
const readFeed = (db:D1Database,id:string) => db.prepare("SELECT * FROM feed_state WHERE id = ?").bind(id).first<FeedRow>();

export async function recordAircraftPayload(payload:unknown,provider="adsblol"){
  const db=await ensureFeed(`aircraft-${provider}`),received=normalizeAircraft(payload,aircraft);
  received.records=received.records.map(r=>({...r,feedProvider:provider==="adsbfi"?"adsb.fi":"adsb.lol"}));
  const previous=await readFeed(db,`aircraft-${provider}`),prior=JSON.parse(previous?.snapshot||EMPTY);
  const other=await readFeed(db,provider==="adsbfi"?"aircraft-adsblol":"aircraft-adsbfi");
  const otherSaved=JSON.parse(other?.snapshot||EMPTY);
  const result=mergeAircraftSnapshots(received,prior,Date.now(),aircraft);
  await db.prepare("UPDATE feed_state SET snapshot=?,fetched_at=?,blocked_until=0,last_error=NULL WHERE id=?").bind(JSON.stringify(result),Date.now(),`aircraft-${provider}`).run();
  const before=combineAircraftSnapshots([prior,otherSaved],Date.now(),aircraft),combined=combineAircraftSnapshots([result,otherSaved],Date.now(),aircraft);
  const trusted=received.records.filter(r=>combined.records.some((c:any)=>c.id===r.id&&c.observedAt===r.observedAt&&c.lat===r.lat&&c.lon===r.lon));
  try{await captureAircraftTrails([...(before.records||[]),...trusted]);}catch{console.warn("Aircraft trail capture temporarily unavailable");}
  try{await captureAssetActivity(db,trusted);}catch{console.warn("Aircraft activity capture temporarily unavailable");}
  return result;
}

// Called only by an authenticated collector check-in. Visitors read the shared
// snapshots and cannot multiply upstream requests or override this allowance.
export async function pollSupplementalAircraft(now=Date.now()) {
  if(runtimeEnv().ADSB_FI_ENABLED==="false")return;
  const policy=aircraftPolicy("adsbfi"),id="aircraft-adsbfi",db=await ensureFeed(id);
  const reserved=await db.prepare(RESERVE_POLL_SQL).bind(now+policy.intervalMs,now-DAY_MS,now,id,policy.limit).first();
  if(!reserved)return;
  try {
    const hexes=[...new Set(aircraft.map(r=>r.icao_hex))].join(",");
    const response=await fetchWithoutRedirect(policy.url+hexes,{headers:{"User-Agent":"IncidOSINT/3.0 (personal non-commercial; https://incidosint.com/)"},signal:AbortSignal.timeout(5_000)});
    if(!response.ok){await db.prepare("UPDATE feed_state SET blocked_until=?,last_error=? WHERE id=?").bind(Date.now()+retryDelay(response),`adsb.fi returned HTTP ${response.status}; supplementary collection paused.`,id).run();return;}
    const payload=await response.text();if(payload.length>1_400_000)throw Error("Aircraft response too large");
    await recordAircraftPayload(JSON.parse(payload),"adsbfi");
  } catch {
    await db.prepare("UPDATE feed_state SET blocked_until=?,last_error=? WHERE id=?").bind(Date.now()+180_000,"adsb.fi is temporarily unavailable; the existing feed remains available.",id).run();
  }
}

export async function aircraftSnapshot() {
  const config = runtimeEnv();
  const storedKey=await readAircraftKey(config.DB,config.AIRCRAFT_KEY_SECRET);
  const key=storedKey?.value||config.ADSB_LOL_FREE_KEY;
  const policy = aircraftPolicy("adsblol", Boolean(key),storedKey?.tier||"adhoc");
  const id = `aircraft-${policy.provider}`;
  const db = await ensureFeed(id);
  const heartbeat=await readFeed(db,"aircraft-worker");
  const now = Date.now();
  const acquired = heartbeat?null:await db.prepare(RESERVE_POLL_SQL).bind(now + policy.intervalMs, now - DAY_MS, now, id, policy.limit).first();
  if (acquired) {
    try {
      const headers:Record<string,string> = { "User-Agent":"Logic-Emergency-Air-Sea/1.0 (+https://logic-uk-ireland-rescue-vessels.starrycapybara8.chatgpt.site/)" };
      if (policy.provider === "adsblol" && key) headers["x-api-key"] = key;
      const hexes = [...new Set(aircraft.map(r => r.icao_hex))].join(",");
      const response = await fetchWithoutRedirect(policy.url + hexes, { headers, signal:AbortSignal.timeout(20_000) });
      if (!response.ok) {
        await db.prepare("UPDATE feed_state SET blocked_until = ?, last_error = ? WHERE id = ?").bind(Date.now() + retryDelay(response), `Provider returned HTTP ${response.status}; collection paused.`, id).run();
      } else {
        await recordAircraftPayload(await response.json(),policy.provider);
      }
    } catch (error) {
      console.warn("Aircraft provider poll failed",policy.name,error instanceof Error?error.message:"Unknown fetch failure");
      await db.prepare("UPDATE feed_state SET blocked_until = ?, last_error = ? WHERE id = ?").bind(Date.now() + 180_000, "Aircraft feed is temporarily unavailable; retaining the last received positions.", id).run();
    }
  }
  const row = await readFeed(db,id);
  const saved=JSON.parse(row?.snapshot || EMPTY);
  const extra=await readFeed(db,"aircraft-adsbfi"),extraSaved=JSON.parse(extra?.snapshot||EMPTY);
  const result=combineAircraftSnapshots([saved,extraSaved],now,aircraft);
  const supplementaryFresh=Boolean(extra?.fetched_at&&!extra.last_error&&now-extra.fetched_at<180_000);
  const hasSupplementary=Boolean(extra?.fetched_at);
  const quotaReset=row&&row.requests>=policy.limit?row.window_start+DAY_MS:0;
  const primaryNext=Math.max(row?.next_poll_at||0,row?.blocked_until||0,quotaReset);
  const extraQuota=extra&&extra.requests>=2880?extra.window_start+DAY_MS:0;
  const extraNext=Math.max(extra?.next_poll_at||0,extra?.blocked_until||0,extraQuota);
  const nextPollAt=[primaryNext,extraNext].filter(t=>t>now).sort((a,b)=>a-b)[0]||null;
  const rateLimited=Boolean(row?.last_error?.includes("HTTP 429"));
  const workerStale=Boolean(heartbeat&&now-heartbeat.fetched_at>180_000);
  const sourceStatus=(state:FeedRow|null,interval:number)=>state?.last_error?"paused":!state?.fetched_at?"waiting":workerStale||now-state.fetched_at>Math.max(180_000,interval*2)?"paused":"receiving";
  return { ...result, unpositioned:(result.unpositioned||[]).filter((r:any)=>now-r.lastSeenAt<=120_000),fetchedAt:Math.max(row?.fetched_at||0,extra?.fetched_at||0)||null, nextPollAt,
    provider:hasSupplementary?"adsb.lol + adsb.fi":policy.name, licence:hasSupplementary?"ODbL 1.0; adsb.fi personal non-commercial terms":policy.licence, intervalSeconds:supplementaryFresh?30:policy.intervalMs / 1000,
    sources:[{name:"adsb.lol",fetchedAt:row?.fetched_at||null,status:sourceStatus(row,policy.intervalMs),message:row?.last_error||"",requestsUsed:row?.requests||0,requestLimit:policy.limit},{name:"adsb.fi",fetchedAt:extra?.fetched_at||null,status:sourceStatus(extra,30_000),message:extra?.last_error||"",requestsUsed:extra?.requests||0,requestLimit:2880}],
    requestsUsed:row?.requests || 0, requestLimit:policy.limit,keyConfigured:Boolean(key),collectionMode:heartbeat?"background":"on-demand",workerLastSeenAt:heartbeat?.fetched_at||null,
    apiKeyConfigured:Boolean(key),keyTier:storedKey?.tier||(key?"adhoc":null),rateLimited,
    status:supplementaryFresh&&!workerStale?"receiving":row?.last_error||workerStale||quotaReset>now ? "paused" : row?.fetched_at ? "receiving" : "waiting",
    message:rateLimited?"adsb.lol is rate-limiting the aircraft feed (HTTP 429). Collection will retry automatically when the pause ends.":workerStale?"The background aircraft collector has not checked in recently. Saved flight tracks remain available.":quotaReset>now?"The shared aircraft feed has reached its free daily request budget.":row?.last_error || "", blockedUntil:row?.blocked_until || null };
}

export async function vesselSnapshot() {
  const db = await ensureFeed("vessels");
  const row = await readFeed(db,"vessels");
  const result = JSON.parse(row?.snapshot || EMPTY);
  const configured = Boolean(runtimeEnv().VESSEL_INGEST_TOKEN);
  const stale = !row?.fetched_at || Date.now() - row.fetched_at > 120_000;
  const records=mergeVesselSnapshots([],result,vessels.records);
  const freshCount=records.filter((r:any)=>Date.now()-r.observedAt<=180_000).length;
  return { ...result, records,freshCount,lastKnownCount:records.length-freshCount,registeredCount:vessels.records.length,awaitingFirstPosition:vessels.records.length-records.length,fetchedAt:row?.fetched_at || null, provider:"AISStream", intervalSeconds:30,
    status:!configured ? "setup_required" : stale ? "waiting" : "receiving",
    message:!configured ? "Live boat positions await the shared AISStream collector." : stale ? "Waiting for the shared AIS collector. Saved vessel positions remain visible with their original report times." : "" };
}

export async function ingestVessels(input:unknown) {
  const db = await ensureFeed("vessels");
  const records = normalizeVessels(input, vessels.records, Date.now());
  // Compare-and-swap prevents an overlapping collector update from erasing
  // another newly received position, while keeping storage to one bounded row.
  let saved=false;
  for(let attempt=0;attempt<3;attempt++){
    const previous=await readFeed(db,"vessels");
    const merged=mergeVesselSnapshots(records,JSON.parse(previous?.snapshot||EMPTY),vessels.records);
    const write=await db.prepare("UPDATE feed_state SET snapshot = ?, fetched_at = ?, last_error = NULL WHERE id='vessels' AND snapshot = ?").bind(JSON.stringify({records:merged}),Date.now(),previous?.snapshot||EMPTY).run();
    if(write.meta.changes){saved=true;break;}
  }
  if(!saved)throw new Error("A concurrent vessel update is in progress; the collector will retry.");
  try{await captureVesselTrails(records);}catch{console.warn("Vessel history capture temporarily unavailable");}
  try{await captureAssetActivity(db,records);}catch{console.warn("Vessel activity capture temporarily unavailable");}
  return records.length;
}
