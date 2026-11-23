"use client";
import {useEffect,useState} from "react";

export function useFlightTrack(hex:string|null,paused:boolean,sourceRevision:number|null=null) {
 const [data,setData]=useState<any>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
 useEffect(()=>{
  let active=true,busy=false;const controller=new AbortController();
  setData((previous:any)=>previous?.identifier===hex?previous:null);setError("");setLoading(false);
  if(!hex)return()=>{active=false;controller.abort();};
  async function run(){
   if(busy||document.visibilityState==="hidden")return;busy=true;if(active)setLoading(true);
   try{const r=await fetch(`/api/tracks/aircraft/${hex}`,{signal:controller.signal});const value:any=await r.json();if(!r.ok)throw Error(value.error||"Recorded track is temporarily unavailable.");if(active){setData(value);setError("");}}
   catch(e){if(active&&!controller.signal.aborted)setError(e instanceof Error?e.message:"Recorded track is temporarily unavailable.");}
   finally{busy=false;if(active)setLoading(false);}
  }
  void run();const timer=paused?undefined:setInterval(()=>void run(),30_000);
  return()=>{active=false;controller.abort();if(timer)clearInterval(timer);};
 },[hex,paused,sourceRevision]);
 return {data:data?.identifier===hex?data:null,error,loading};
}

const clock=(at:number)=>new Date(at).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/London"});
export function FlightTrackPanel({data,error,loading,visible,onToggle,onFit}:{data:any;error:string;loading:boolean;visible:boolean;onToggle:()=>void;onFit:()=>void}) {
 const flight=data?.flight;
 const status=flight?.status==="returned"?"Returned to departure area":flight?.status==="landed"?"Landing reported":flight?.status==="grounded"?"Ground position reported":flight?.status==="coverage-gap"?"Reception gap · landing unconfirmed":flight?.stale?"No recent position · track retained":flight?.status==="unconfirmed"?"Recorded positions · flight status unconfirmed":"Flight in progress";
 return <section className="flight-track-panel" aria-label="Selected aircraft flight track"><div className="flight-track-heading"><label><input type="checkbox" checked={visible} onChange={onToggle}/>Flight track</label><button onClick={onFit} disabled={!flight?.points?.length}>Fit track</button></div>{error?<p className="track-warning" role="status">{error}</p>:flight?<><strong className="flight-track-status">{status}</strong><p>{flight.departureObserved?"Ground departure area recorded.":"Partial track: take-off was not observed."}{flight.gaps?" Reception gaps are left open.":""}</p><dl><div><dt>{flight.departureObserved?"Departure report":"First received"}</dt><dd>{clock(flight.startedAt)}</dd></div>{flight.endedAt&&<div><dt>{flight.status==="coverage-gap"?"Last received":"Landing report"}</dt><dd>{clock(flight.endedAt)}</dd></div>}</dl><small>{flight.points.length} received positions · sampled with the shared feed</small></>:<p>{loading?"Loading recorded track…":data?.message||"No flight track recorded yet."}</p>}{data?.captureBudgetPaused&&<p className="track-warning">Route recording is paused at its free daily limit.</p>}<p className="track-explanation">Tracks build from received positions while the shared feed is running. Earlier routes cannot be reconstructed.</p></section>;
}
