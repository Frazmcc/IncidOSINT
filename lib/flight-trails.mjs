export const TRAIL_RETENTION_MS=48*60*60*1000;
export const TRAIL_SAMPLE_LIMIT=8_000;
export const TRAIL_GAP_MS=10*60*1000;
const RESTART_GAP_MS=30*60*1000;
const MAX_POINTS=1_000;
export const RESERVE_TRAIL_BUDGET_SQL="UPDATE trail_budget SET window_start=CASE WHEN window_start<=?1 THEN ?2 ELSE window_start END,samples=CASE WHEN window_start<=?1 THEN ?3 ELSE samples+?3 END WHERE id='aircraft' AND (window_start<=?1 OR samples+?3<=?4) RETURNING id";

export const distanceMetres=(a,b)=>{
 const rad=Math.PI/180,dlat=(b.lat-a.lat)*rad,dlon=(b.lon-a.lon)*rad;
 const q=Math.sin(dlat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;
 return 6_371_000*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));
};

export function trailSegments(points=[]) {
 const segments=[];
 for(const p of points){const last=segments.at(-1),previous=last?.at(-1);if(!previous||p.at-previous.at>TRAIL_GAP_MS||distanceMetres(previous,p)/Math.max(1,(p.at-previous.at)/1000)>450)segments.push([p]);else last.push(p);}
 return segments;
}

export function advanceTrail(previous,record,now=Date.now()) {
 if(!record||record.kind!=="aircraft"||!Number.isFinite(record.observedAt)||!Number.isFinite(record.lat)||!Number.isFinite(record.lon))return null;
 if(record.lat<48||record.lat>63.5||record.lon< -14||record.lon>6)return null;
 if(now-record.observedAt>900_000||record.observedAt>now+60_000)return null;
 const old=previous || {lastAt:0,lastGround:null,active:null,completed:[]};
 if(record.observedAt<=old.lastAt)return null;
 const state=structuredClone(old);
 state.completed=(state.completed || []).filter(t=>now-(t.endedAt || t.lastAt)<TRAIL_RETENTION_MS).slice(-3);
 const point={lat:record.lat,lon:record.lon,at:record.observedAt,ground:record.onGround===true};
 if(state.active&&point.at-state.active.lastAt>RESTART_GAP_MS){
  state.completed.push({...state.active,status:"coverage-gap",endedAt:state.active.lastAt});state.active=null;
 }
 if(record.onGround===true){
  if(state.active){
   state.active.points.push(point);state.active.lastAt=point.at;
   state.active.endedAt=point.at;
   state.active.status=!state.active.everAirborne?"grounded":state.active.departureObserved&&distanceMetres(state.active.points[0],point)<=1_500?"returned":"landed";
   state.completed.push(state.active);state.active=null;
  }
  state.lastGround=point;
 }else if(record.onGround===false||!state.active){
  if(!state.active){
   const ground=state.lastGround,departureObserved=Boolean(record.onGround===false&&ground&&point.at-ground.at<=TRAIL_GAP_MS&&distanceMetres(ground,point)<=25_000);
   state.active={id:`${record.identifier}-${point.at}`,startedAt:departureObserved?ground.at:point.at,lastAt:point.at,departureObserved,everAirborne:record.onGround===false,status:record.onGround===false?"airborne":"unconfirmed",points:departureObserved?[ground,point]:[point],truncated:false};
  }else{state.active.points.push(point);state.active.lastAt=point.at;state.active.everAirborne=true;state.active.status="airborne";}
 }else if(state.active){state.active.points.push(point);state.active.lastAt=point.at;}
 if(state.active&&state.active.points.length>MAX_POINTS){state.active.points=state.active.points.slice(-MAX_POINTS);state.active.departureObserved=false;state.active.truncated=true;}
 state.completed=state.completed.slice(-3);state.lastAt=point.at;
 return state;
}

export function selectedTrail(state,now=Date.now()) {
 const recent=t=>t&&now-t.lastAt<TRAIL_RETENTION_MS;
 const flight=recent(state?.active)?state.active:(state?.completed || []).filter(recent).at(-1);
 if(!flight)return null;
 return {...flight,segments:trailSegments(flight.points),stale:now-flight.lastAt>900_000,gaps:trailSegments(flight.points).length>1};
}

export function advanceTrailBatch(records,existing=new Map(),now=Date.now()) {
 const states=new Map(existing),updates=new Map();
 for(const record of [...records].sort((a,b)=>a.observedAt-b.observedAt)){
  const state=advanceTrail(states.get(record.identifier),record,now);
  if(state){states.set(record.identifier,state);updates.set(record.identifier,{record,state});}
 }
 return [...updates.values()];
}
