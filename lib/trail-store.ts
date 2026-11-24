import type {Track} from "./tracking-types";
import { env } from "cloudflare:workers";
import { advanceTrailBatch, budgetedTrailUpdates, selectedTrail, TRAIL_SAMPLE_LIMIT, TRAIL_RETENTION_MS, RESERVE_TRAIL_BUDGET_SQL } from "./flight-trails.mjs";

type TrailRow={icao:string;state:string;updated_at:number};
const db=()=> (env as Cloudflare.Env).DB;

export async function captureAircraftTrails(records:Track[],now=Date.now()) {
 if(!records.length)return;
 const database=db();if(!database)throw Error("Trail storage unavailable");
 const existing=new Map<string,unknown>(),identifiers=[...new Set(records.map(r=>r.identifier))];
 for(let i=0;i<identifiers.length;i+=80){
  const ids=identifiers.slice(i,i+80);
  const result=await database.prepare(`SELECT icao,state,updated_at FROM aircraft_trails WHERE icao IN (${ids.map(()=>"?").join(",")})`).bind(...ids).all<TrailRow>();
  for(const row of result.results || [])try{existing.set(row.icao,JSON.parse(row.state));}catch{}
 }
 await database.prepare("INSERT INTO trail_budget (id,window_start,samples) VALUES ('aircraft',?,0) ON CONFLICT(id) DO NOTHING").bind(now).run();
 const budget=await database.prepare("SELECT window_start,samples FROM trail_budget WHERE id='aircraft'").first<{window_start:number;samples:number}>();
 const next=budgetedTrailUpdates(advanceTrailBatch(records,existing,now),existing,records,budget,now);
 if(!next.length)return;
 const reserved=await database.prepare(RESERVE_TRAIL_BUDGET_SQL).bind(now-86_400_000,now,next.length,TRAIL_SAMPLE_LIMIT).first();
 if(!reserved)return;
 for(let i=0;i<next.length;i+=40)await database.batch(next.slice(i,i+40).map(({record,state})=>database.prepare("INSERT INTO aircraft_trails (icao,state,updated_at) VALUES (?,?,?) ON CONFLICT(icao) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at WHERE aircraft_trails.updated_at<excluded.updated_at").bind(record.identifier,JSON.stringify(state),record.observedAt)));
}

export async function aircraftTrail(hex:string) {
 const database=db();if(!database)throw Error("Trail storage unavailable");
 const row=await database.prepare("SELECT icao,state,updated_at FROM aircraft_trails WHERE icao=?").bind(hex).first<TrailRow>();
 let state:unknown=null;try{state=row?JSON.parse(row.state):null;}catch{}
 const flight=selectedTrail(state);
 const budget=await database.prepare("SELECT window_start,samples FROM trail_budget WHERE id='aircraft'").first<{window_start:number;samples:number}>();
 const captureBudgetPaused=Boolean(budget&&budget.samples>=TRAIL_SAMPLE_LIMIT&&Date.now()-budget.window_start<86_400_000);
 return {identifier:hex,flight,capturedAt:row?.updated_at || null,captureBudgetPaused,retentionHours:TRAIL_RETENTION_MS/3_600_000,message:flight?(flight.departureObserved?"Observed departure recorded":"Partial track: take-off was not observed") : "No flight track recorded yet. Positions are saved as the shared feed updates."};
}
