import {distanceMetres} from "./flight-trails.mjs";

export function vesselRouteView(history) {
 const points=history?.points||[],segments=history?.segments||[];
 const visibleSegments=segments.filter(segment=>segment.length>1&&segment.some(point=>distanceMetres(segment[0],point)>5));
 const route=visibleSegments.length>0;
 const separated=points.length>1&&points.some(point=>distanceMetres(points[0],point)>5);
 const state=route?"route":points.length===0?"empty":points.length===1?"single":separated?"gaps":"location";
 return {points,segments:visibleSegments,state,first:points[0]||null,last:points.at(-1)||null,
  message:state==="single"?"Only one AIS position is recorded for this period. A route needs more received positions.":state==="location"?"The recorded positions cover the same location; no distinct route is visible.":state==="gaps"?"Positions are recorded, but reception gaps prevent a continuous route.":state==="route"?"The highlighted route shows the selected period. Start and Latest mark its recorded endpoints.":"No AIS history received in this time window yet."};
}

export function vesselRouteDirections(segments) {
 const arrows=[];
 for(const segment of segments){
  const step=Math.max(1,Math.ceil(segment.length/8));
  for(let i=step;i<segment.length&&arrows.length<16;i+=step){
   const prior=segment[i-step],point=segment[i];if(distanceMetres(prior,point)<30)continue;
   const rad=Math.PI/180,dlon=(point.lon-prior.lon)*rad;
   const y=Math.sin(dlon)*Math.cos(point.lat*rad),x=Math.cos(prior.lat*rad)*Math.sin(point.lat*rad)-Math.sin(prior.lat*rad)*Math.cos(point.lat*rad)*Math.cos(dlon);
   arrows.push({...point,bearing:(Math.atan2(y,x)/rad+360)%360});
  }
 }
 return arrows;
}
