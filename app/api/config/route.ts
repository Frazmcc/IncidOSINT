import { runtimeEnv } from "../../../lib/live-store";
export const dynamic = "force-dynamic";
export async function GET() {
  // A MapTiler browser key is intentionally public and must be restricted to
  // this site's domains in MapTiler. AIS and ingest secrets are never returned.
  const key = runtimeEnv().MAPTILER_BROWSER_KEY || "";
  return Response.json({maptilerBrowserKey:key,marineConfigured:Boolean(runtimeEnv().VESSEL_INGEST_TOKEN)},{headers:{"Cache-Control":"no-store"}});
}
