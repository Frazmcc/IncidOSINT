import type {ReactNode} from "react";
import {LockKeyhole} from "lucide-react";
import {getChatGPTUser,chatGPTSignInPath} from "../app/chatgpt-auth";
import {runtimeEnv} from "../lib/live-store";
import {ownerAllowed} from "../lib/site-security.mjs";

export async function OwnerSetup({returnTo,children}:{returnTo:string;children:ReactNode}) {
  const user=await getChatGPTUser();
  const owner=(runtimeEnv() as ReturnType<typeof runtimeEnv>&{COLLECTOR_OWNER_EMAIL?:string}).COLLECTOR_OWNER_EMAIL;
  if(ownerAllowed(user,owner))return children;
  return <main className="connection-page"><header className="connection-top"><a href="/">Incid<b>OSINT</b></a><a className="connection-back" href="/">Back to map</a></header><div className="connection-content"><span className="connection-kicker"><LockKeyhole size={15}/>OWNER ACCESS</span><h1>Private connection settings</h1><p className="connection-lead">The map is public. Only the website owner can manage API keys and the shared collector.</p><section className="connection-form-card"><p>{user?"This account does not have access to the connection settings.":"Sign in with the website owner’s ChatGPT account to continue."}</p>{!user&&<a className="connection-primary owner-sign-in" href={chatGPTSignInPath(returnTo)} target="_top">Sign in with ChatGPT</a>}<p><a href="/">Return to the public map</a></p></section></div></main>;
}
