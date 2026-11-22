const encoder=new TextEncoder(),decoder=new TextDecoder();
const toBase64=bytes=>btoa(String.fromCharCode(...bytes));
const fromBase64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
async function encryptionKey(secret) {
  if(typeof secret!=="string"||secret.length<32)throw Error("Private aircraft key storage is unavailable.");
  const digest=await crypto.subtle.digest("SHA-256",encoder.encode(secret));
  return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
export async function encryptAircraftKey(value,secret,tier,now=Date.now()) {
  if(!["anonymous","adhoc"].includes(tier))throw Error("Choose a free key type.");
  const metadata={version:1,tier,configuredAt:now};
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:encoder.encode(JSON.stringify(metadata))},await encryptionKey(secret),encoder.encode(value));
  return {...metadata,iv:toBase64(iv),ciphertext:toBase64(new Uint8Array(encrypted))};
}
export async function decryptAircraftKey(record,secret) {
  const {version,tier,configuredAt}=record;
  if(version!==1||!["anonymous","adhoc"].includes(tier))throw Error("Saved aircraft key format is invalid.");
  const plaintext=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromBase64(record.iv),additionalData:encoder.encode(JSON.stringify({version,tier,configuredAt}))},await encryptionKey(secret),fromBase64(record.ciphertext));
  return {value:decoder.decode(plaintext),tier,configuredAt};
}
export async function readAircraftKey(db,secret) {
  if(!db||!secret)return null;
  const row=await db.prepare("SELECT snapshot FROM feed_state WHERE id='aircraft-api-key'").first();
  if(!row)return null;
  try{return await decryptAircraftKey(JSON.parse(row.snapshot),secret);}catch{return null;}
}
