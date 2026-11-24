import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {aircraftPolicy} from "../lib/tracking-core.mjs";
import {aircraftBudget,aircraftReservationArgs,RESERVE_AIRCRAFT_SQL} from "../lib/aircraft-budget.mjs";
const day=Date.UTC(2026,10,24),DAY=86_400_000,policy=aircraftPolicy("adsblol",true,"anonymous");
function database(start=day,requests=0){const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE feed_state(id TEXT PRIMARY KEY,next_poll_at INTEGER,window_start INTEGER,requests INTEGER,blocked_until INTEGER)");db.prepare("INSERT INTO feed_state VALUES('aircraft-adsblol',0,?,?,0)").run(start,requests);return db;}
test("aircraft migration preserves overlapping rolling-window spending and resets at the following UTC midnight",()=>{
 for(const start of [day+3_600_000,day-3_600_000]){
  const db=database(start,372),now=day+60_000;
  const reserved=db.prepare(RESERVE_AIRCRAFT_SQL).get(...aircraftReservationArgs(policy,now));assert.equal(reserved.requests,373);assert.equal(reserved.window_start,day);
  assert.equal(aircraftBudget(policy,reserved,now).remaining,122);
  const next=db.prepare(RESERVE_AIRCRAFT_SQL).get(...aircraftReservationArgs(policy,day+DAY));assert.equal(next.requests,1);assert.equal(next.window_start,day+DAY);db.close();
 }
 const db=database(day-DAY,495);assert.ok(db.prepare(RESERVE_AIRCRAFT_SQL).get(...aircraftReservationArgs(policy,day+1000)));db.close();
});
test("all aircraft callers, including failed key tests, share an atomic hard cap and a provider backoff",()=>{
 const db=database(),reserve=db.prepare(RESERVE_AIRCRAFT_SQL),now=day+1000;
 let calls=0;for(let i=0;i<10000;i++)if(reserve.get(...aircraftReservationArgs(policy,now)))calls++;assert.equal(calls,1);
 for(let i=0;i<10000;i++)if(reserve.get(...aircraftReservationArgs(policy,now,true)))calls++;
 assert.equal(calls,495);assert.equal(db.prepare("SELECT requests FROM feed_state").get().requests,495);
 db.prepare("UPDATE feed_state SET blocked_until=?,requests=0,next_poll_at=0").run(day+DAY+1000);
 assert.equal(reserve.get(...aircraftReservationArgs(policy,day+DAY,true)),undefined);db.close();
});
test("adaptive pacing uses unused allowance while keeping reserves and sustaining a whole UTC day",()=>{
 const baseline=aircraftBudget(policy,{window_start:day,requests:0},day),later=aircraftBudget(policy,{window_start:day,requests:370},day+20*3_600_000);
 assert.ok(later.intervalMs<baseline.intervalMs);assert.ok(later.intervalMs>=30_000);assert.equal(policy.limit,495);assert.equal(aircraftPolicy("adsblol",true,"adhoc").limit,990);
 const db=database(),reserve=db.prepare(RESERVE_AIRCRAFT_SQL);let calls=0;
 for(let time=day;time<day+DAY;time+=30_000)if(reserve.get(...aircraftReservationArgs(policy,time)))calls++;
 assert.ok(calls>=490&&calls<=495,`Used ${calls} of 495 calls`);db.close();
 const exhausted=aircraftBudget(policy,{window_start:day,requests:495},day+1000);assert.equal(exhausted.nextPollAt,day+DAY);
});
