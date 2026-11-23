import {assetSvg} from "../lib/asset-types.mjs";
import {useId} from "react";

export function AssetSymbol({typeId,className="",coastguard=false}:{typeId:string;className?:string;coastguard?:boolean}) {
 const uid=useId();
 return <span className={`asset-icon ${className}`} aria-hidden="true" dangerouslySetInnerHTML={{__html:assetSvg(typeId,coastguard,uid)}}/>;
}
