import type {Metadata} from "next";
import {ProviderMap} from "../../components/provider-map";
export const metadata:Metadata={title:"Scottish gritters — IncidOSINT"};
export default function GrittersPage(){return <ProviderMap provider="gritters"/>;}
