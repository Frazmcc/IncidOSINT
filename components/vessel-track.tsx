"use client";
import {useEffect,useState} from "react";
import {VESSEL_HISTORY_DEFAULT_HOURS,VESSEL_HISTORY_HOURS} from "../lib/vessel-trails.mjs";

export function useVesselTrack(mmsi:string|null, hours:number, paused:boolean) {
 const [data,setData]=useState<any>(null),[error,setError]=useState(""),[loading,setLoading]=useState(false);
 useEffect(()=>{
  let active=true,busy=false; const controller=new AbortController(); setError(""); setLoading(false);
  if(!mmsi)return()=>{active=false;controller.abort();};
  async function run(){
   if(busy||document.visibilityState==="hidden")return;busy=true;if(active)setLoading(true);
   try{const response=await fetch(`/api/tracks/vessels/${mmsi}?hours=${hours}`,{signal:controller.signal});const value:any=await response.json();if(!response.ok)throw Error(value.error||"Vessel history is unavailable.");if(active){setData(value);setError("");}}
   catch(e){if(active&&!controller.signal.aborted)setError(e instanceof Error?e.message:"Vessel history is unavailable.");}
   finally{busy=false;if(active)setLoading(false);}
  }
  void run();const timer=paused?undefined:setInterval(()=>void run(),30_000);
  const resume=()=>{if(!paused)void run();};document.addEventListener("visibilitychange",resume);
  return()=>{active=false;controller.abort();if(timer)clearInterval(timer);document.removeEventListener("visibilitychange",resume);};
 },[mmsi,hours,paused]);
 return {data:data?.identifier===mmsi&&data?.hours===hours?data:null,error,loading};
}
const clock=(at:number)=>new Date(at).toLocaleString("en-GB",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/London"});
export function VesselTrackPanel({data,error,loading,hours,onHoursChange,visible,onToggle,onFit}:{data:any;error:string;loading:boolean;hours:number;onHoursChange:(hours:number)=>void;visible:boolean;onToggle:()=>void;onFit:()=>void}) {
 return <section className="flight-track-panel vessel-track-panel" aria-label="Selected vessel AIS history">
  <div className="flight-track-heading"><label><input type="checkbox" checked={visible} onChange={onToggle}/>Vessel track</label><button onClick={onFit} disabled={!data?.points?.length}>Fit track</button></div>
  <label className="vessel-history-period">Show the last<select value={hours} onChange={e=>onHoursChange(Number(e.target.value)||VESSEL_HISTORY_DEFAULT_HOURS)}>{VESSEL_HISTORY_HOURS.map(value=><option key={value} value={value}>{value===0.5?"30 minutes":`${value} ${value===1?"hour":"hours"}`}</option>)}</select></label>
  {error?<p className="track-warning" role="status">{error}</p>:data?.points?.length?<><strong className="flight-track-status">{data.points.length} received AIS positions</strong><dl><div><dt>First in this view</dt><dd>{clock(data.firstAt)}</dd></div><div><dt>Last received</dt><dd>{clock(data.lastAt)}</dd></div></dl>{data.gaps&&<p>Reception gaps and position jumps are left open.</p>}</>:<p role="status">{loading?"Loading vessel history…":data?.message||"No AIS history received in this time window yet."}</p>}
  {data?.partialWindow&&data?.recordingStartedAt&&<p>History recording started {clock(data.recordingStartedAt)}. Earlier routes are unavailable.</p>}
  {data?.captureBudgetPaused&&<p className="track-warning">History recording is paused at its free daily limit.</p>}
  {data?.points?.length&&data?.message!=="Recorded AIS positions"?<p className="track-warning">{data.message}</p>:null}
  <p className="track-explanation">The blue line joins received AIS reports, sampled up to every 30 seconds. History builds while the shared collector is running and is kept for 48 hours.</p>
 </section>;
}
