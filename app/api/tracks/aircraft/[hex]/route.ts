import aircraft from "../../../../../data/aircraft.json";
import {aircraftTrail} from "../../../../../lib/trail-store";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{hex:string}>}) {
 const {hex:raw}=await params,hex=raw.toLowerCase();
 if(!/^[0-9a-f]{6}$/.test(hex)||!aircraft.some(a=>a.icao_hex===hex))return Response.json({error:"Unknown aircraft"},{status:404});
 try{return Response.json(await aircraftTrail(hex),{headers:{"Cache-Control":"private, max-age=15"}});}
 catch{return Response.json({error:"Recorded track is temporarily unavailable."},{status:503});}
}
