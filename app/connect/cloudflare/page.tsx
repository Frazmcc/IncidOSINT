"use client";
import { useEffect, useState } from "react";
import { Check, KeyRound, LockKeyhole, Radio, ShieldCheck, Ship, Plane } from "lucide-react";

export default function CloudflareConnection() {
  const [accountId,setAccountId]=useState("");
  const [cloudflareToken,setCloudflareToken]=useState("");
  const [aisKey,setAisKey]=useState("");
  const [freeConfirmed,setFreeConfirmed]=useState(false);
  const [state,setState]=useState<any>(null);
  const [status,setStatus]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{fetch("/api/setup/cloudflare",{cache:"no-store"}).then(r=>r.json()).then((v:any)=>{setState(v);if(v.collector?.accountId)setAccountId(v.collector.accountId);if(v.error)setError(v.error);}).catch(()=>setError("The setup page could not load. Refresh and try again."));},[]);
  async function run(action:string) {
    setBusy(true);setError("");setMessage("");
    try {
      const r=await fetch("/api/setup/cloudflare",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(action==="deploy"?{action,accountId,cloudflareToken,aisKey,freeConfirmed}:{action})});
      const v:any=await r.json();
      if(v.collector){setState((old:any)=>({...old,collector:v.collector}));if(action==="deploy"){setCloudflareToken("");setAisKey("");}}
      if(v.status)setStatus(v.status);
      if(v.error)setError(v.error);else setMessage(v.message||"Connection updated.");
    } catch {setError("The request did not finish. Use Check status before retrying deployment.");}
    finally {setBusy(false);}
  }
  const connected=Boolean(state?.collector);
  useEffect(()=>{if(!connected||busy)return;let active=true;async function check(){try{const r=await fetch("/api/setup/cloudflare",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"status"})});const v:any=await r.json();if(active&&v.status)setStatus(v.status);}catch{}}void check();const timer=setInterval(()=>void check(),15000);return()=>{active=false;clearInterval(timer);};},[connected,busy]);
  return <main className="connection-page">
    <header className="connection-top"><a href="/">Emergency <b>Air & Sea</b><small>UK & IRELAND</small></a><a className="connection-back" href="/">Back to map</a></header>
    <div className="connection-content"><span className="connection-kicker"><LockKeyhole size={15}/> PRIVATE OWNER SETUP</span><h1>Connect the aircraft & boat collector</h1><p className="connection-lead">One background collector keeps aircraft and AIS updating while the map is closed. Your PC can stay switched off.</p>
      <div className="connection-layout"><section className="connection-form-card"><div className="connection-card-title"><Radio size={22}/><div><h2>Cloudflare Free connection</h2><p>{connected?"Enter a temporary Cloudflare token to update the deployed collector.":"Enter the account details and keys here."}</p></div></div>
        {state?.error&&<p className="connection-alert" role="alert">{state.error} <a href="/signin-with-chatgpt?return_to=%2Fconnect%2Fcloudflare" target="_top">Sign in</a></p>}
        {connected&&status?.version!==2&&<p className="connection-alert">Update this collector to enable binary AIS decoding and background aircraft polling. Your existing AIS key can stay in place.</p>}{connected&&<div className="connection-deployed"><Check size={20}/><div><strong>Collector deployed</strong><small>{state.collector.url}</small></div></div>}
        {!state&&<p>Checking your private connection…</p>}
        {state&&!state.ready&&!state.error&&<p className="connection-alert">The website’s private connection is not ready yet. Your keys have not been requested.</p>}
        <form onSubmit={e=>{e.preventDefault();run("deploy");}} autoComplete="off">
          <label htmlFor="cf-account">Cloudflare account ID</label><input disabled={busy||!state?.ready} id="cf-account" name="account-id" value={accountId} onChange={e=>setAccountId(e.target.value.trim())} spellCheck={false} autoCapitalize="none" pattern="[a-fA-F0-9]{32}" required placeholder="32-character account ID"/>
          <p className="connection-hint">On your Cloudflare account overview, choose <strong>Copy account ID</strong>.</p>
          <label htmlFor="cf-token">Cloudflare deployment token</label><input disabled={busy||!state?.ready} id="cf-token" type="password" name="cloudflare-deployment-token" value={cloudflareToken} onChange={e=>setCloudflareToken(e.target.value.trim())} required minLength={30} autoComplete="new-password" placeholder="Paste your scoped Cloudflare token"/>
          <p className="connection-hint">Create it using the permissions below. The token is used for this deployment and is not saved.</p>
          <label htmlFor="ais-key">AISStream API key</label><input disabled={busy||!state?.ready} id="ais-key" type="password" name="aisstream-private-key" value={aisKey} onChange={e=>setAisKey(e.target.value.trim())} required={!connected} minLength={8} autoComplete="new-password" placeholder={connected?"Leave blank to keep the existing AIS key":"Paste your AISStream key"}/>
          <p className="connection-hint">An existing AIS key is kept when this field is blank. New keys are stored as encrypted Cloudflare Worker secrets.</p>
          <label className="connection-confirm"><input disabled={busy||!state?.ready} type="checkbox" checked={freeConfirmed} onChange={e=>setFreeConfirmed(e.target.checked)} required/><span>This account uses <strong>Workers Free</strong>. I will keep it on Free.</span></label>
          <button className="connection-primary" type="submit" disabled={busy||!state?.ready}>{busy?"Connecting…":connected?"Update shared collector":"Connect on Cloudflare Free"}</button>
        </form>
        {connected&&<div className="connection-controls"><button disabled={busy} onClick={()=>run("status")}>Check status</button><button disabled={busy} onClick={()=>run("start")}>Start collector</button><button disabled={busy} onClick={()=>run("stop")}>Stop collector</button></div>}
        {message&&<p className="connection-success" role="status">{message}</p>}{error&&!state?.error&&<p className="connection-alert" role="alert">{error}</p>}
        {status&&<div className="connection-status" aria-live="polite"><h3>Latest collector status</h3><dl><div><dt>Collection</dt><dd>{status.active?"Running":"Stopped"}</dd></div><div><dt>AIS connections</dt><dd>{status.connections??0} / 3</dd></div><div><dt>Accepted AIS subscriptions</dt><dd>{status.subscriptionsAccepted??"Awaiting upgraded collector"} / 3</dd></div><div><dt>Decoded AIS frames</dt><dd>{status.decodedMessages??"Awaiting upgrade"}</dd></div><div><dt>Decode errors</dt><dd>{status.decodeErrors??"—"}</dd></div><div><dt>Aircraft collection</dt><dd>{status.version===2?status.aircraft?.state||"Starting":"Update required"}</dd></div><div><dt>Recent boat reports</dt><dd>{status.vessels??0}</dd></div><div><dt>Last website update</dt><dd>{status.lastPublishedAt?new Date(status.lastPublishedAt).toLocaleTimeString("en-GB"):"Waiting for first update"}</dd></div></dl>{status.error&&<p className="connection-alert">{status.error}</p>}<p>Positions appear only when received. A rising decoded-frame count confirms that AIS frames are being processed. Aircraft use the same background worker with a central request budget.</p></div>}
      </section><aside className="connection-instructions"><div className="connection-instruction-card"><KeyRound size={22}/><h2>Create the Cloudflare token</h2><p>Open <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">Cloudflare API Tokens</a> and choose <strong>Create Token → Create Custom Token</strong>.</p><p>Name it <strong>Emergency Air & Sea setup</strong>. Add these permissions:</p><table><thead><tr><th>Scope</th><th>Permission</th><th>Access</th></tr></thead><tbody><tr><td>Account</td><td>Workers Scripts</td><td>Edit</td></tr><tr><td>Account</td><td>Account Settings</td><td>Read</td></tr><tr><td>Account</td><td>Billing</td><td>Read</td></tr></tbody></table><p>Under <strong>Account Resources</strong>, include only the account you will use. Create the token, then paste it into the form. You may revoke it after a successful connection.</p><p>If you have not used Workers before, open <a href="https://dash.cloudflare.com/" target="_blank" rel="noreferrer">Workers & Pages</a> first and choose your free <strong>workers.dev</strong> address.</p></div><div className="connection-instruction-card"><Plane size={22}/><h2>Free aircraft key</h2><p>If adsb.lol is rate-limiting keyless requests, add a <a href="/connect/aircraft">free aircraft API key privately</a>. The background worker receives it securely from this website. No Cloudflare redeployment is needed when you renew that key.</p></div><div className="connection-instruction-card connection-budget"><ShieldCheck size={22}/><h2>Designed for a £0 budget</h2><p>The setup checks account subscriptions before writing anything. Paid, unknown or unreadable plans block deployment.</p><p>One collector serves every viewer, using up to three filtered AIS connections for {state?.trackedMmsis||497} verified vessel identifiers. Cloudflare Free limits can pause collection.</p><p>This setup never adds payment details, upgrades a plan or enables a paid fallback.</p><a href="https://developers.cloudflare.com/workers/platform/pricing/" target="_blank" rel="noreferrer">Cloudflare plan details</a></div></aside></div>
      <footer className="connection-footer"><Ship size={17}/><p>Fresh marine positions update the map about every 30 seconds. Aircraft poll in the background after the collector update. Saved boat positions remain on the map with their original report times.</p></footer>
    </div>
  </main>;
}
