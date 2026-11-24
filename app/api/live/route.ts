import { aircraftSnapshot, vesselSnapshot } from "../../../lib/live-store";
export const dynamic = "force-dynamic";

export async function GET(request:Request) {
  try {
    const cache=(globalThis.caches as CacheStorage & {default?: Cache})?.default;
    const cacheKey=new Request(new URL("/api/live",request.url));
    let cached=null;try{if(cache)cached=await cache.match(cacheKey);}catch{}
    if(cached)return cached;
    // One database lease coordinates all visitors and edge locations.
    const [aircraft,vessels] = await Promise.all([aircraftSnapshot(),vesselSnapshot()]);
    const response=Response.json({servedAt:Date.now(),aircraft,vessels},{headers:{"Cache-Control":"public, max-age=5, s-maxage=5"}});
    try{if(cache)await cache.put(cacheKey,response.clone());}catch{}
    return response;
  } catch {
    return Response.json({servedAt:Date.now(),error:"Shared tracking storage is unavailable. Collection is paused to preserve the free request limits."},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
