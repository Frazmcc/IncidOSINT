"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {ChevronDown,ExternalLink,Map,Radio,Snowflake} from "lucide-react";
import {GRITTER_SOURCE_URL,GRITTER_VIEW_URL,ROAD_AREAS,wazeViewUrl} from "../lib/road-views.mjs";

export function ProviderMap({provider}:{provider:"waze"|"gritters"}){
 const [area,setArea]=useState("scotland"),[loading,setLoading]=useState(true),[error,setError]=useState(false),[graphics,setGraphics]=useState<boolean|null>(null);
 const gritters=provider==="gritters",url=gritters?GRITTER_VIEW_URL:wazeViewUrl(area),external=gritters?GRITTER_VIEW_URL:wazeViewUrl(area,false);
 useEffect(()=>{
  if(!gritters)return;
  const frame=requestAnimationFrame(()=>{try{const gl=document.createElement("canvas").getContext("webgl2");setGraphics(Boolean(gl));if(!gl)setLoading(false);gl?.getExtension("WEBGL_lose_context")?.loseContext();}
  catch{setGraphics(false);setLoading(false);}});
  return()=>cancelAnimationFrame(frame);
 },[gritters]);
 return <main className={`provider-map-page provider-${provider}`}>
  {(!gritters||graphics===true)&&<iframe key={url} className="provider-map-frame" src={url} title={gritters?"Transport Scotland official gritter tracker":"Waze live road traffic"} referrerPolicy="strict-origin-when-cross-origin" allowFullScreen onLoad={()=>setLoading(false)} onError={()=>{setLoading(false);setError(true);}}/>}
  {gritters&&graphics===false&&<section className="provider-graphics-fallback" role="status"><Snowflake size={34}/><h2>This browser cannot display the gritter map</h2><p>The official viewer needs WebGL 2 graphics support. Use a compatible browser to open Transport Scotland’s tracker.</p><a href={GRITTER_VIEW_URL} target="_blank" rel="noreferrer">Open official gritter tracker<ExternalLink size={15}/></a></section>}
  <Link className="provider-back" href="/"><Map size={16}/>Return to aircraft & boats</Link>
  <aside className="provider-map-card" aria-label={gritters?"Gritter map information":"Traffic map information"}>
   <span className="eyebrow">{gritters?<Snowflake size={15}/>:<Radio size={15}/>} {gritters?"OFFICIAL WINTER MAP":"ROAD TRAFFIC VIEW"}</span>
   <h1>{gritters?"Scottish gritters":"Waze traffic"}</h1>
   <p>{gritters?"Transport Scotland’s trunk-road fleet, with vehicle names and recent routes. Local council roads have separate trackers.":"Explore road closures, congestion and reports from Waze users. Reports may be incomplete, delayed or unconfirmed."}</p>
   {!gritters&&<label className="road-area-label" htmlFor="road-area">Area<div className="road-area-select"><select id="road-area" value={area} onChange={event=>{setLoading(true);setError(false);setArea(event.target.value);}}>{ROAD_AREAS.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={16}/></div></label>}
   <p className="provider-map-note">{gritters?"Check each vehicle’s report time. A vehicle passing does not confirm that the road has been treated. Live tracking is seasonal.":"This is Waze’s own map. Aircraft, boats and detected activity remain on the main tracker."}</p>
   {loading&&<p className="provider-loading" role="status">Opening {gritters?"the gritter tracker":"Waze"}…</p>}
   {error&&<p className="provider-loading" role="status">The embedded map could not load. Use the provider link below.</p>}
   <div className="provider-map-links"><a href={external} target="_blank" rel="noreferrer">Open {gritters?"official tracker":"Waze"}<ExternalLink size={14}/></a>{gritters&&<a href={GRITTER_SOURCE_URL} target="_blank" rel="noreferrer">Source & coverage</a>}</div>
  </aside>
 </main>;
}
