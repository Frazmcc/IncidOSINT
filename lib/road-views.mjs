// Published, provider-supported views. No raw incident or vehicle feed is
// scraped, copied into our database, or represented as an approved API.
export const GRITTER_VIEW_URL="https://experience.arcgis.com/experience/ba7dbd0ddf304ec7871c809ef6c81999";
export const GRITTER_SOURCE_URL="https://www.traffic.gov.scot/gritter-tracker";
export const ROAD_AREAS=Object.freeze([
  {id:"scotland",name:"Scotland",lat:56.8,lon:-4.1,zoom:7},
  {id:"glasgow",name:"Glasgow & the west",lat:55.8642,lon:-4.2518,zoom:10},
  {id:"edinburgh",name:"Edinburgh & the east",lat:55.9533,lon:-3.1883,zoom:10},
  {id:"aberdeen",name:"Aberdeen",lat:57.1497,lon:-2.0943,zoom:10},
  {id:"highlands",name:"Inverness & the Highlands",lat:57.4778,lon:-4.2247,zoom:8},
  {id:"uk-ireland",name:"UK & Ireland",lat:54.9,lon:-4.4,zoom:6},
]);
export function wazeViewUrl(areaId="scotland",embedded=true){
  const area=ROAD_AREAS.find(a=>a.id===areaId)||ROAD_AREAS[0];
  const url=new URL(embedded?"https://embed.waze.com/iframe":"https://www.waze.com/live-map");
  url.searchParams.set("lat",String(area.lat));url.searchParams.set("lon",String(area.lon));url.searchParams.set("zoom",String(area.zoom));
  return url.href;
}
