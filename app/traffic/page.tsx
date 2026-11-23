import type {Metadata} from "next";
import {ProviderMap} from "../../components/provider-map";
export const metadata:Metadata={title:"Road traffic — IncidOSINT"};
export default function TrafficPage(){return <ProviderMap provider="waze"/>;}
