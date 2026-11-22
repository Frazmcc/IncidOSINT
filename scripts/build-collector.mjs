import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
const vessels=JSON.parse(await readFile(new URL("../data/vessels.json",import.meta.url),"utf8"));
const ids=[...new Set(vessels.records.filter(r=>/^\d{9}$/.test(r.mmsi||"")&&!r.identity_conflict).map(r=>r.mmsi))].sort();
if(ids.length>600)throw Error("AISStream permits no more than three subscriptions of 200 vessels.");
await writeFile(new URL("../collector/cloudflare/mmsis.json",import.meta.url),JSON.stringify(ids));
const result=await build({entryPoints:["collector/cloudflare/worker.mjs"],bundle:true,format:"esm",platform:"neutral",target:"es2022",external:["cloudflare:workers"],minify:true,write:false});
await writeFile(new URL("../data/collector-bundle.json",import.meta.url),JSON.stringify({source:result.outputFiles[0].text,mmsis:ids.length}));
console.log(`Bundled shared AIS collector: ${ids.length} verified MMSIs, ${result.outputFiles[0].text.length} bytes.`);
