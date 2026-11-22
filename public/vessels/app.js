"use strict";
(() => {
  const data = window.VESSEL_REGISTER || {records:[],coverage_notes:[]};
  const records = data.records;
  const byId = new Map(records.map(r => [r.id,r]));
  const $ = id => document.getElementById(id);
  const state = {service:"",search:"",area:"",identity:"",page:1};
  const pageSize = 80;
  const esc = value => String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const usable = r => /^\d{9}$/.test(r.mmsi || "") && !r.identity_conflict;
  const uniqueMmsis = rows => [...new Set(rows.filter(usable).map(r=>r.mmsi))];
  const dateFormat = new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
  const linkHtml = (url,label) => {try{const u=new URL(url);return u.protocol==="https:" ? `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : "";}catch{return "";}};
  const sourceList = value => (Array.isArray(value) ? value : String(value||"").split(/\s*\|\s*|\n/)).filter(Boolean);
  const sourceHtml = value => sourceList(value).map((s,i)=>linkHtml(s,`Source ${i+1}`)).filter(Boolean).join(" · ") || "No link recorded";
  $("total-count").textContent=records.length.toLocaleString("en-GB");
  $("verified-count").textContent=uniqueMmsis(records).length.toLocaleString("en-GB");
  $("checked-date").textContent=data.checked_date ? dateFormat.format(new Date(data.checked_date+"T00:00:00Z")) : "Not recorded";
  const services=["","Lifeboat","Coastguard","Police","Fire"];
  $("service-tabs").innerHTML=services.map(s=>`<button type="button" data-service="${esc(s)}" aria-pressed="${s===""}">${esc(s||"All vessels")}<b>${records.filter(r=>!s||r.category===s).length}</b></button>`).join("");
  const areas=[...new Set(records.map(r=>r.area).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  for(const area of areas){const opt=document.createElement("option");opt.value=area;opt.textContent=area;$("area").append(opt);}
  const coverage=data.coverage_notes || [];
  const list=document.createElement("ul");
  for(const note of coverage){const li=document.createElement("li");li.textContent=typeof note==="string"?note:note.text;list.append(li);}
  $("coverage-notes").append(list);
  function filtered(){
    const q=state.search.trim().toLocaleLowerCase();
    return records.filter(r=>{
      if(state.service&&r.category!==state.service)return false;
      if(state.area&&r.area!==state.area)return false;
      if(state.identity==="usable"&&!usable(r))return false;
      if(state.identity==="ais"&&(!usable(r)||!r.ais_profile))return false;
      if(state.identity==="missing"&&(r.mmsi||r.identity_conflict))return false;
      if(state.identity==="conflict"&&!r.identity_conflict)return false;
      if(q&&!String(r.search_text).includes(q))return false;
      return true;
    });
  }
  function rowHtml(r){
    let mmsi;
    if(r.identity_conflict){mmsi=`<span class="id-status review">Needs review</span><span class="subline">Conflicting source records</span>`;}
    else if(usable(r)){mmsi=`<span class="mmsi">${esc(r.mmsi)}</span><button class="mmsi-copy" data-copy="${esc(r.mmsi)}" aria-label="Copy MMSI ${esc(r.mmsi)}" title="Copy MMSI">⧉</button><span class="subline">${esc(r.ais_profile?"Public AIS reference":"Radio identity reference")}</span>`;}
    else{mmsi=`<span class="id-status">Not verified</span><span class="subline">No MMSI in supplied sources</span>`;}
    const lookup=usable(r) ? `<a class="lookup" href="https://www.vesselfinder.com/vessels/details/${esc(r.mmsi)}" target="_blank" rel="noopener noreferrer">Look up AIS</a>` : `<button class="text-button" data-detail="${esc(r.id)}" type="button">View record</button>`;
    return `<tr><td><button type="button" class="vessel-name" data-detail="${esc(r.id)}">${esc(r.vessel_name)}</button><span class="subline">${esc([r.hull_number,r.class_or_type].filter(Boolean).join(" · "))}</span></td><td><span class="service-pill ${esc(r.category.toLowerCase())}">${esc(r.category)}</span><span class="subline">${esc(r.service)}</span></td><td>${esc(r.station_or_area||"Allocation not recorded")}<span class="subline">${esc(r.area)}</span></td><td>${mmsi}</td><td>${lookup}</td></tr>`;
  }
  function render(){
    const result=filtered();const pages=Math.max(1,Math.ceil(result.length/pageSize));state.page=Math.min(state.page,pages);
    const start=(state.page-1)*pageSize;const slice=result.slice(start,start+pageSize);const ids=uniqueMmsis(result);
    $("vessel-rows").innerHTML=slice.map(rowHtml).join("");
    $("result-count").innerHTML=`<strong>${result.length.toLocaleString("en-GB")}</strong> vessels · <strong>${ids.length.toLocaleString("en-GB")}</strong> usable MMSIs`;
    $("page-label").textContent=result.length?`${start+1}–${Math.min(start+pageSize,result.length)} of ${result.length} records`:"0 records";
    $("empty").hidden=result.length>0;$("previous").disabled=state.page<=1;$("next").disabled=state.page>=pages;
    $("copy").disabled=!ids.length;$("export").disabled=!result.length;
    document.querySelectorAll("[data-service]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.service===state.service)));
    const params=new URLSearchParams();for(const k of ["service","search","area","identity"]){if(state[k])params.set(k,state[k]);}
    history.replaceState(null,"",location.pathname+(params.size?"?"+params.toString():"")+location.hash);
  }
  function update(key,value){state[key]=value;state.page=1;$("message").textContent="";$("copy-fallback").hidden=true;render();}
  function reset(){state.service="";state.search="";state.area="";state.identity="";state.page=1;$("search").value="";$("area").value="";$("identity").value="";$("message").textContent="";$("copy-fallback").hidden=true;render();}
  async function copy(text,count){try{if(!navigator.clipboard)throw Error("Clipboard unavailable");await navigator.clipboard.writeText(text);$("message").textContent=count===1?"MMSI copied.":`${count} unique MMSIs copied. Missing and conflicting identifiers were excluded.`;}catch{$("copy-fallback").hidden=false;$("copy-text").value=text;$("copy-text").focus();$("copy-text").select();$("message").textContent="Your browser requires manual copying. The identifiers are selected below the filters.";}}
  function exportCsv(){
    const headers=["vessel_name","mmsi","category","service","station_or_area","area","hull_number","class_or_type","status","identity_basis","identity_conflict","notes","identity_source","fleet_source"];
    const cell=value=>{let v=Array.isArray(value)?value.join(" | "):String(value??"");if(/^[=+@]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
    const lines=[headers.map(cell).join(","),...filtered().map(r=>headers.map(k=>cell(k==="mmsi"&&r.identity_conflict?"":r[k])).join(","))];
    const blob=new Blob(["\uFEFF"+lines.join("\r\n")+"\r\n"],{type:"text/csv;charset=utf-8"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="Emergency-Vessels-Filtered.csv";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);$("message").textContent=`Exported ${filtered().length} vessel records. Unresolved MMSIs are blank in the export.`;
  }
  function openRecord(id){
    const r=byId.get(id);if(!r)return;
    $("dialog-content").innerHTML=`<h2>${esc(r.vessel_name)}</h2><dl><dt>Service</dt><dd>${esc(r.service)}</dd><dt>Area</dt><dd>${esc(r.station_or_area)} · ${esc(r.area)}</dd><dt>Hull / class</dt><dd>${esc([r.hull_number,r.class_or_type].filter(Boolean).join(" · ")||"Not recorded")}</dd><dt>MMSI</dt><dd>${r.identity_conflict?"Needs review — excluded from copied watchlists":esc(r.mmsi||"Not publicly verified")}</dd><dt>Identity basis</dt><dd>${esc(r.identity_basis||"Not verified")}</dd><dt>Fleet status</dt><dd>${esc(r.status||"Not confirmed")}</dd><dt>Identity source</dt><dd>${sourceHtml(r.identity_source)}</dd><dt>Fleet source</dt><dd>${sourceHtml(r.fleet_source)}</dd></dl><p>${esc(r.notes||"No additional notes recorded.")}</p>${r.source_mmsi?`<p><strong>Original source MMSI:</strong> ${esc(r.source_mmsi)}. Original source data is retained in the downloadable data pack.</p>`:""}`;
    $("vessel-dialog").showModal();
  }
  $("search").addEventListener("input",e=>update("search",e.target.value));$("area").addEventListener("change",e=>update("area",e.target.value));$("identity").addEventListener("change",e=>update("identity",e.target.value));
  $("service-tabs").addEventListener("click",e=>{const b=e.target.closest("[data-service]");if(b)update("service",b.dataset.service);});
  $("copy").addEventListener("click",()=>{const ids=uniqueMmsis(filtered());copy(ids.join(","),ids.length);});
  $("vessel-rows").addEventListener("click",e=>{const c=e.target.closest("[data-copy]");if(c){copy(c.dataset.copy,1);return;}const b=e.target.closest("[data-detail]");if(b)openRecord(b.dataset.detail);});
  $("clear").addEventListener("click",reset);$("empty-reset").addEventListener("click",reset);$("export").addEventListener("click",exportCsv);
  $("previous").addEventListener("click",()=>{state.page--;render();});$("next").addEventListener("click",()=>{state.page++;render();});
  $("close-dialog").addEventListener("click",()=>$("vessel-dialog").close());$("vessel-dialog").addEventListener("click",e=>{if(e.target===$("vessel-dialog")){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  const params=new URLSearchParams(location.search);for(const k of ["service","search","area","identity"]){if(params.has(k))state[k]=params.get(k);}
  if(!services.includes(state.service))state.service="";if(state.area&&!areas.includes(state.area))state.area="";if(!["","usable","ais","missing","conflict"].includes(state.identity))state.identity="";
  $("search").value=state.search;$("area").value=state.area;$("identity").value=state.identity;
  render();
})();
