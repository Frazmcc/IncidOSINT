import type {Metadata} from "next";
import {OwnerSetup} from "../../../components/owner-setup";
import CloudflareConnection from "../../../components/cloudflare-connection";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Private connection settings — IncidOSINT",robots:{index:false,follow:false}};
export default function ConnectionPage(){return <OwnerSetup returnTo="/connect/cloudflare"><CloudflareConnection/></OwnerSetup>;}
