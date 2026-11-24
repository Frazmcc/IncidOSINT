import {combineAircraftSnapshots} from "./aircraft-fusion.mjs";

// A slower archive refresh never replaces a newer received fast-feed fix.
export function blendAircraftLive(archive, fast, now=Date.now()){
 if(!fast?.enabled)return archive;
 const merged=combineAircraftSnapshots([archive,fast],now);
 const receiving=fast.status==="receiving"&&fast.fetchedAt&&now-fast.fetchedAt<15_000;
 const source={name:"adsb.fi",status:receiving?"receiving":fast.status==="receiving"?"waiting":fast.status||"waiting",fetchedAt:fast.fetchedAt||null,message:fast.message||"",nextPollAt:fast.nextPollAt||null};
 return {...archive,...merged,provider:fast.fetchedAt?"adsb.lol + adsb.fi":archive.provider,fetchedAt:Math.max(archive.fetchedAt||0,fast.fetchedAt||0)||null,
  intervalSeconds:receiving?2.1:archive.intervalSeconds,status:receiving?"receiving":archive.status,
  sources:[...(archive.sources||[]).filter(s=>s.name!=="adsb.fi"),source]};
}
