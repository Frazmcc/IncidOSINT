"use client";
import {useCallback,useSyncExternalStore} from "react";

const updates="incidosint-preferences";
const fallback=new Map<string,boolean>();
function subscribe(notify:()=>void){
  window.addEventListener("storage",notify);
  window.addEventListener(updates,notify);
  return()=>{window.removeEventListener("storage",notify);window.removeEventListener(updates,notify);};
}
const serverSnapshot=()=>true;

export function useStoredFlag(key:string){
  const read=useCallback(()=>{const saved=fallback.get(key);if(saved!==undefined)return saved;try{return localStorage.getItem(key)!=="0";}catch{return true;}},[key]);
  const value=useSyncExternalStore(subscribe,read,serverSnapshot);
  const set=useCallback((next:boolean)=>{
    try{localStorage.setItem(key,next?"1":"0");fallback.delete(key);}catch{fallback.set(key,next);}
    window.dispatchEvent(new Event(updates));
  },[key]);
  return [value,set] as const;
}
