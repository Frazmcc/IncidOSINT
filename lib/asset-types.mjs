// Physical type comes from the recorded model/class, never the operator alone.
// Aircraft designators/model families: the watchlist's tar1090-db reference.
// RNLI class groups: https://rnli.org/what-we-do/lifeboats-and-stations/our-lifeboat-fleet
const AIRCRAFT = {
  A169:["helicopter","AW169"], A109:["helicopter","AW109"],
  EC35:["helicopter","EC135 / H135"], EC45:["helicopter","EC145 / H145"],
  AS65:["helicopter","AS365 Dauphin"], B429:["helicopter","Bell 429"],
  S92:["helicopter","S-92"], A189:["helicopter","AW189"],
  A149:["helicopter","AW149"], A139:["helicopter","AW139"],
  BE20:["plane","King Air 200"], BE30:["plane","King Air 300"],
  B350:["plane","King Air 350"], DA62:["plane","DA62"],
  C295:["plane","C295"], PC12:["plane","PC-12"],
  DHC6:["plane","DHC-6 Twin Otter"], P68:["plane","P68"],
  BN2T:["plane","BN-2T Islander"], LJ45:["jet","Learjet 45"],
  FA6X:["jet","Falcon 6X"],
};

export const ASSET_TYPES = [
  {id:"plane",kind:"aircraft",label:"Propeller plane"},
  {id:"jet",kind:"aircraft",label:"Jet plane"},
  {id:"helicopter",kind:"aircraft",label:"Helicopter"},
  {id:"aircraft-unknown",kind:"aircraft",label:"Aircraft · type unconfirmed"},
  {id:"all-weather-lifeboat",kind:"vessel",label:"All-weather lifeboat"},
  {id:"inshore-lifeboat",kind:"vessel",label:"Inshore lifeboat"},
  {id:"rib",kind:"vessel",label:"RIB / RHIB"},
  {id:"inflatable-boat",kind:"vessel",label:"Inflatable rescue boat"},
  {id:"patrol-launch",kind:"vessel",label:"Patrol launch"},
  {id:"fire-rescue-boat",kind:"vessel",label:"Fire / rescue boat"},
  {id:"tug",kind:"vessel",label:"Emergency towing vessel"},
  {id:"hovercraft",kind:"vessel",label:"Rescue hovercraft"},
  {id:"rescue-boat",kind:"vessel",label:"Rescue boat"},
  {id:"vessel-unknown",kind:"vessel",label:"Vessel · type unconfirmed"},
];
const TYPES = new Map(ASSET_TYPES.map(t=>[t.id,t]));

export function assetType(record = {}) {
  const kind = record.kind || (record.icao_hex ? "aircraft" : "vessel");
  const code = String(record.typeCode || record.type_code || record.class_or_type || "").trim();
  let id, detail=code;
  if (kind === "aircraft") {
    const known=AIRCRAFT[code.toUpperCase()];
    id=known?.[0] || "aircraft-unknown";
    detail=known ? `${known[1]} · ${code.toUpperCase()}` : code || "Model not confirmed";
  } else {
    const t=code.toLowerCase();
    // A police launch must not become an all-weather lifeboat, and a D-class
    // inflatable must not be described as a rigid-hull boat.
    if (/hovercraft/.test(t)) id="hovercraft";
    else if (/towing|\btug\b/.test(t)) id="tug";
    else if (/\b(severn|shannon|tamar|trent|mersey|tyne)\b|all[ -]weather lifeboat/.test(t)) id="all-weather-lifeboat";
    else if (/^(?:[abdeyx]|xp)[ -]?class\b|^d$|\batlantic (?:21|75|85)\b|inshore lifeboat/.test(t)) id="inshore-lifeboat";
    else if (/\brhib\b|\brib\b|rigid[ -]?(?:hull[ -]?)?inflatable|ribcraft/.test(t)) id="rib";
    else if (/inflatable/.test(t)) id="inflatable-boat";
    else if (/fire/.test(t)) id="fire-rescue-boat";
    else if (/\blaunch\b|patrol vessel/.test(t)) id="patrol-launch";
    else if (/rescue boat/.test(t)) id="rescue-boat";
    else id="vessel-unknown";
    if (!detail) detail="Class not confirmed";
  }
  return {id:id || (kind === "aircraft" ? "aircraft-unknown" : "vessel-unknown"),kind,label:TYPES.get(id)?.label || "Type unconfirmed",detail};
}

// Shared constant-only SVG paths keep the map, results, cards and key identical.
// Every moving symbol faces north before its reported course is applied.
const PATHS = {
  plane:'<path d="M16 2c2 0 2 3 2 7v6l12 7v4l-12-4v10l5 3v3l-7-2-7 2v-3l5-3V22L2 26v-4l12-7V9c0-4 0-7 2-7Z"/><path class="symbol-line" d="M7 17v8m-4-4h8m14-4v8m-4-4h8"/>',
  jet:'<path d="m16 2 2 8v6l12 10v3l-12-5v8l5 4v2l-7-2-7 2v-2l5-4v-8L2 29v-3l12-10v-6Z"/><path class="symbol-cut" d="M11 29v4m10-4v4"/>',
  // Small original plan-view silhouette, with the nose pointing north.
  helicopter:'<path d="M16 5c-2.5 0-4 3-4 6.5v8.2c0 2.8 1.1 4.8 3 5.7L15.4 35H12v1.5h3.4V39h1.2v-2.5H20V35h-3.4l.4-9.6c1.9-.9 3-2.9 3-5.7v-8.2C20 8 18.5 5 16 5Z"/><path class="symbol-line" d="M3 5 29 29M3 29 29 5"/>',
  'aircraft-unknown':'<path d="m16 3 12 16-12 17L4 19Z"/><path class="symbol-cut" d="M13 14c0-4 7-4 7 0 0 3-4 3-4 6m0 5h.01"/>',
  'all-weather-lifeboat':'<path d="M16 2C7 7 6 15 6 26l3 10h14l3-10C26 15 25 7 16 2Z"/><path class="symbol-cut" d="M11 15h10v13H11Zm2-5h6m-8 22h10"/>',
  'inshore-lifeboat':'<path d="M16 3C5 8 4 21 7 33l3 4h12l3-4C28 21 27 8 16 3Z"/><path class="symbol-cut" d="M16 8C9 13 9 25 11 30h10c2-5 2-17-5-22Zm-3 26h6m-3-20v7"/>',
  rib:'<path d="M16 2C5 7 2 22 6 34l4 3h12l4-3C30 22 27 7 16 2Z"/><path class="symbol-cut" d="M16 8c-7 5-8 16-6 23h12c2-7 1-18-6-23Zm-3 13h6v6h-6Z"/>',
  'inflatable-boat':'<path d="M16 5C5 5 3 17 4 27c0 7 5 10 12 10s12-3 12-10C29 17 27 5 16 5Z"/><path class="symbol-cut" d="M16 11c-6 0-7 9-7 15 0 4 2 5 7 5s7-1 7-5c0-6-1-15-7-15Zm-5 10h10"/>',
  'patrol-launch':'<path d="M16 2C8 7 5 17 6 29l4 8h12l4-8C27 17 24 7 16 2Z"/><path class="symbol-cut" d="m11 13 5-4 5 4v14H11Zm0 18h10m-5-14v6"/>',
  'fire-rescue-boat':'<path d="M16 2C7 9 5 17 6 29l4 8h12l4-8C27 17 25 9 16 2Z"/><path class="symbol-cut" d="M11 21h10v10H11Zm5-14v10m-5-5h10m-5 15h.01"/>',
  tug:'<path d="M16 2C6 7 3 14 4 29l5 8h14l5-8C29 14 26 7 16 2Z"/><path class="symbol-cut" d="M10 10h12v11H10Zm-2 17h16m-13 5h10M16 23v10"/>',
  hovercraft:'<path d="M16 3C6 3 2 13 2 25c0 8 4 12 14 12s14-4 14-12C30 13 26 3 16 3Z"/><path class="symbol-cut" d="M10 11h12v10H10Zm0 15 4 6m0-6-4 6m9-6 4 6m0-6-4 6"/>',
  'rescue-boat':'<path d="M16 3C8 9 6 18 7 28l4 9h10l4-9C26 18 24 9 16 3Z"/><path class="symbol-cut" d="M12 15h8v14h-8Zm4-7v4"/>',
  'vessel-unknown':'<path d="m16 3 11 12-3 17-8 5-8-5-3-17Z"/><path class="symbol-cut" d="M13 15c0-4 7-4 7 0 0 3-4 3-4 6m0 5h.01"/>',
};
export function assetSvg(id,coastguard=false,namespace="map") {
  const paths=PATHS[id] || PATHS['vessel-unknown'];
  const uid=`coastguard-${String(namespace).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,90)}`;
  const graphic=coastguard?`<defs><linearGradient id="${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e94752"/><stop offset="32%" stop-color="#e94752"/><stop offset="32%" stop-color="#f8fafc"/><stop offset="64%" stop-color="#f8fafc"/><stop offset="64%" stop-color="#e94752"/><stop offset="100%" stop-color="#e94752"/></linearGradient></defs><g fill="url(#${uid})">${paths}</g>`:paths;
  return `<svg viewBox="0 0 32 40" class="${id==='helicopter'?'helicopter-silhouette':''}" aria-hidden="true" focusable="false">${graphic}</svg>`;
}
