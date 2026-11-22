import handler from "vinext/server/fetch-handler";
import { runWithConnectorBinding } from "../lib/connector-context";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import {refreshIncidentFeeds} from "../lib/incident-store";

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext<{ CONNECTORS?: ConnectorBinding }>) {
    // Reuse existing authenticated collector check-ins without delaying leases.
    const controlToken=(env as Cloudflare.Env&{VESSEL_INGEST_TOKEN?:string}).VESSEL_INGEST_TOKEN;
    if(request.method==="POST"&&new URL(request.url).pathname==="/api/collector/aircraft"&&controlToken&&request.headers.get("Authorization")===`Bearer ${controlToken}`&&env.DB){
      ctx.waitUntil(refreshIncidentFeeds(env.DB).catch(()=>{console.warn("Background incident sources temporarily unavailable");}));
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    return runWithConnectorBinding(binding, () => handler.fetch(request, env, ctx));
  },
};

export default worker;
