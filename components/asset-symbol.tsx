import {assetSvg} from "../lib/asset-types.mjs";

export function AssetSymbol({typeId,className=""}:{typeId:string;className?:string}) {
 return <span className={`asset-icon ${className}`} aria-hidden="true" dangerouslySetInnerHTML={{__html:assetSvg(typeId)}}/>;
}
