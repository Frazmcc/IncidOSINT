export const COLLECTOR_NAME = "logic-emergency-ais";
export const SITE_ORIGIN = "https://logic-uk-ireland-rescue-vessels.starrycapybara8.chatgpt.site";
export const CF_API = "https://api.cloudflare.com/client/v4";

// Cloudflare documents Workers Free as the default account plan. Require the
// complete account subscription list; an unreadable or paid account is refused.
export function verifyFreeAccount(payload) {
  if (payload?.success !== true || !Array.isArray(payload.result))
    throw new Error("Cloudflare plan could not be verified. Add Account / Billing / Read to the token and try again.");
  const info=payload.result_info;
  if (info && ((info.total_pages || 1)>1 || (info.total_count ?? payload.result.length)>payload.result.length))
    throw new Error("The complete Cloudflare plan list could not be verified. Deployment has been blocked.");
  for (const item of payload.result) {
    if (!["free","partners_free"].includes(item.rate_plan?.id) || item.price !== 0 || item.rate_plan?.is_contract)
      throw new Error("This account has a paid or unrecognised subscription. Use a separate Cloudflare Free account; no deployment was made.");
  }
  return true;
}

export function collectorOrigin(subdomain) {
  if (typeof subdomain !== "string" || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain))
    throw new Error("Set up your free workers.dev address in Cloudflare → Workers & Pages, then try again.");
  return `https://${COLLECTOR_NAME}.${subdomain}.workers.dev`;
}

export function validCollectorOrigin(value) {
  try {
    const u=new URL(value);
    return u.origin===value && u.protocol==="https:" && u.hostname.startsWith(`${COLLECTOR_NAME}.`) &&
      /^[a-z0-9][a-z0-9-]*\.workers\.dev$/.test(u.hostname.slice(COLLECTOR_NAME.length+1));
  } catch { return false; }
}

export function uploadMetadata({aisKey,ingestToken,siteToken,existing=false}) {
  const metadata={
    main_module:"collector.mjs", compatibility_date:"2026-05-22",
    logpush:false, observability:{enabled:false},
    bindings:[
      {name:"AIS_COLLECTOR",type:"durable_object_namespace",class_name:"RescueAIS"},
      {name:"SITE_URL",type:"plain_text",text:SITE_ORIGIN},
      ...Object.entries({...aisKey?{AISSTREAM_API_KEY:aisKey}:{},VESSEL_INGEST_TOKEN:ingestToken,SITE_SERVICE_TOKEN:siteToken})
        .map(([name,text])=>({name,type:"secret_text",text})),
    ],
    tags:["logic-emergency-air-sea-collector"],
  };
  if(existing)metadata.keep_bindings=["secret_text"];
  if (!existing) metadata.migrations={new_tag:"v1",steps:[{new_sqlite_classes:["RescueAIS"]}]};
  return metadata;
}
