import {runtimeEnv} from "../../../lib/live-store";
import {incidentSnapshot,refreshIncidentFeeds} from "../../../lib/incident-store";
export const dynamic="force-dynamic";
export async function GET(){
 try{const db=runtimeEnv().DB;if(!db)throw Error();await refreshIncidentFeeds(db);return Response.json(await incidentSnapshot(db),{headers:{"Cache-Control":"no-store"}});}
 catch{return Response.json({error:"The incident layer is temporarily unavailable. Aircraft and vessel tracking continue separately."},{status:503,headers:{"Cache-Control":"no-store"}});}
}
