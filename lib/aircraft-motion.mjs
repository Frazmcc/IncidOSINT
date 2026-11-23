import {inRegion} from "./tracking-core.mjs";
import {distanceMetres} from "./flight-trails.mjs";

export const AIRCRAFT_ANIMATION_MAX_MS=20_000;
export const AIRCRAFT_ANIMATION_GAP_MS=360_000;
const FRESH_POSITION_MS=180_000;
const heading=value=>Number.isFinite(value)?((value%360)+360)%360:0;

// Visual interpolation only: never project beyond a received fix, invent a
// take-off/landing, bridge a reception gap, or write animation frames to history.
export function createAircraftMotion(previous,next,displayed,now=Date.now()) {
  if(previous?.kind!=="aircraft" || next?.kind!=="aircraft" || previous.id!==next.id
    || previous.onGround!==false || next.onGround!==false
    || !inRegion(previous.lat,previous.lon) || !inRegion(next.lat,next.lon)
    || !inRegion(displayed?.lat,displayed?.lon)
    || !Number.isFinite(previous.observedAt) || !Number.isFinite(next.observedAt)
    || next.observedAt>now || now-next.observedAt>FRESH_POSITION_MS)return null;
  const gap=next.observedAt-previous.observedAt;
  if(gap<=0 || gap>AIRCRAFT_ANIMATION_GAP_MS || distanceMetres(previous,next)/(gap/1000)>450)return null;
  const startHeading=heading(displayed.heading),endHeading=Number.isFinite(next.heading)?heading(next.heading):startHeading;
  return {
    from:{lat:displayed.lat,lon:displayed.lon,heading:startHeading},
    to:{lat:next.lat,lon:next.lon,heading:endHeading},
    turn:((endHeading-startHeading+540)%360)-180,
    startedAt:now,durationMs:Math.min(AIRCRAFT_ANIMATION_MAX_MS,Math.max(1000,gap)),
  };
}

export function sampleAircraftMotion(motion,now=Date.now()) {
  const t=Math.max(0,Math.min(1,(now-motion.startedAt)/motion.durationMs));
  if(t===1)return {...motion.to,done:true};
  return {
    lat:motion.from.lat+(motion.to.lat-motion.from.lat)*t,
    lon:motion.from.lon+(motion.to.lon-motion.from.lon)*t,
    heading:((motion.from.heading+motion.turn*t)%360+360)%360,done:false,
  };
}
