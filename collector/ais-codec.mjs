import { inRegion } from "../lib/tracking-core.mjs";
export const AIS_MESSAGE_TYPES = ["PositionReport","StandardClassBPositionReport","ExtendedClassBPositionReport","LongRangeAisBroadcastMessage"];
export async function decodeStreamMessage(data){
  const text=typeof data==="string"?data:data instanceof Blob?await data.text():new TextDecoder().decode(data);
  return JSON.parse(text);
}
export function decodePosition(event, allowed, receivedAt = Date.now()) {
  if (!AIS_MESSAGE_TYPES.includes(event?.MessageType)) return null;
  const meta = event.MetaData || {}, report = event.Message?.[event.MessageType] || {};
  if(report.Valid===false)return null;
  const mmsi = String(meta.MMSI ?? report.UserID ?? "");
  if (!allowed.has(mmsi)) return null;
  const lat = report.Latitude ?? meta.latitude ?? meta.Latitude;
  const lon = report.Longitude ?? meta.longitude ?? meta.Longitude;
  if (!inRegion(lat,lon)) return null;
  const stamp = String(meta.time_utc || "").trim().replace(/ UTC$/, "Z").replace(/\+0000Z$/, "Z");
  const parsed = Date.parse(stamp), validTime = Number.isFinite(parsed);
  if (validTime && (parsed > receivedAt + 60_000 || parsed < receivedAt - 900_000)) return null;
  const unavailableSpeed = event.MessageType === "LongRangeAisBroadcastMessage" ? 63 : 102.3;
  return {mmsi,lat,lon,observedAt:validTime?parsed:receivedAt,timeBasis:validTime?"position report":"received",speed:typeof report.Sog==="number"&&report.Sog>=0&&report.Sog<unavailableSpeed?report.Sog:null,heading:report.TrueHeading < 360 ? report.TrueHeading : report.Cog < 360 ? report.Cog : null};
}
export function subscription(key, mmsis) {
  if (mmsis.length > 200) throw new Error("Each AISStream subscription is limited to 200 MMSIs.");
  return {APIKey:key,BoundingBoxes:[[[48,-14],[63.5,6]]],FiltersShipMMSI:mmsis,FilterMessageTypes:AIS_MESSAGE_TYPES};
}
