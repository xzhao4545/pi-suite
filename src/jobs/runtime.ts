import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { JobManager } from './jobs.ts';
import { LIMITS, JobError } from './types.ts';

// Stable v1 surface: shutdown closes admission synchronously before returning its Promise.
export type ControlV1 = {
  version: 1; list: JobManager['list']; get: JobManager['get']; stop: JobManager['stop'];
  shutdown: JobManager['shutdown']; exitSync: JobManager['exitSync']; hasOccupancy?: JobManager['hasOccupancy'];
  occupancyVersion?: 2; // Probe includes pending persistence, not merely live processes.
};
export type RuntimeHandle = {
  runtimeId: string; protocolVersion: number; agentDir: string; manager?: JobManager;
  control?: ControlV1; mode: 'active' | 'control_only' | 'unavailable'; quitDeadline?: number;
  // No Pi context/API retained. Fail-closed pauses survive reload even if session append failed.
  wakePausedSessions?: Set<string>; // Legacy/all-session pauses, including unresolved UI.
  wakePausedJobs?: Map<string,Set<string>>; // Cancellation snapshots per owner session.
};
type Registration = RuntimeHandle & { exitListener?: () => void; quitPromise?: Promise<void> };
const key = Symbol.for('pi-background-jobs.runtime.v1');
const globals = globalThis as typeof globalThis & { [key: symbol]: unknown };
function isControl(value: unknown): value is ControlV1 {
  if (!value || typeof value !== 'object') return false;
  const object = value as Record<string, unknown>;
  return object.version === 1 && ['list','get','stop','shutdown','exitSync'].every(name => typeof object[name] === 'function');
}
function view(raw: Record<string, unknown>, mode: RuntimeHandle['mode']): RuntimeHandle {
  return { runtimeId: typeof raw.runtimeId==='string'?raw.runtimeId:'unavailable', protocolVersion:typeof raw.protocolVersion==='number'?raw.protocolVersion:0,
    agentDir:typeof raw.agentDir==='string'?raw.agentDir:'', mode, control:isControl(raw.control)?raw.control:undefined };
}
export function acquireRuntime(agentDir: string): RuntimeHandle {
  const root=realpathSync(agentDir),existing=globals[key];
  if(existing!==undefined){
    if(!existing||typeof existing!=='object')return {runtimeId:'unavailable',protocolVersion:0,agentDir:root,mode:'unavailable'};
    const raw=existing as Record<string,unknown>;
    if(!isControl(raw.control))return view(raw,'unavailable');
    if(raw.protocolVersion===2&&raw.agentDir===root){
      // Only a compatible protocol is allowed to expose manager internals.
      if(!raw.manager||typeof raw.manager!=='object')return view(raw,'unavailable');
      return existing as RuntimeHandle;
    }
    let empty=false;
    try{empty=raw.control.occupancyVersion===2&&typeof raw.control.hasOccupancy==='function'&&raw.control.hasOccupancy()===false;}catch{}
    if(!empty)return view(raw,'control_only');
    // Atomic retirement: close old admission before publishing a replacement.
    void raw.control.shutdown(Date.now()+LIMITS.quitMs).catch(()=>{});
    if(typeof raw.exitListener==='function')process.removeListener('exit',raw.exitListener as ()=>void);
  }
  const manager=new JobManager({agentDir:root,runtimeId:'run_'+randomUUID().replaceAll('-','')});
  const control:ControlV1={version:1,list:manager.list.bind(manager),get:manager.get.bind(manager),stop:manager.stop.bind(manager),shutdown:manager.shutdown.bind(manager),exitSync:manager.exitSync.bind(manager),hasOccupancy:manager.hasOccupancy.bind(manager),occupancyVersion:2};
  const handle:Registration={runtimeId:manager.runtimeId,protocolVersion:2,agentDir:root,manager,control,mode:'active'};
  handle.exitListener=()=>exitFallback(handle);
  process.on('exit',handle.exitListener);globals[key]=handle;
  return handle;
}
function registration(handle:RuntimeHandle):Registration {
  const existing=globals[key];
  if(existing&&typeof existing==='object'&&(existing as RuntimeHandle).runtimeId===handle.runtimeId)return existing as Registration;
  return handle;
}
export function beginQuit(handle:RuntimeHandle):Promise<void> {
  const target=registration(handle);
  if(!isControl(target.control))return Promise.reject(new JobError('RUNTIME_UNAVAILABLE','Stable control unavailable; restore compatible extension'));
  if(target.quitPromise){handle.quitDeadline=target.quitDeadline;return target.quitPromise;}
  target.quitDeadline??=Date.now()+LIMITS.quitMs;handle.quitDeadline=target.quitDeadline;
  // Invoking shutdown here closes admission in this synchronous turn.
  target.quitPromise=target.control.shutdown(target.quitDeadline);
  return target.quitPromise;
}
export function exitFallback(handle:RuntimeHandle):void {
  const target=registration(handle),now=Date.now();
  const deadline=Math.min(now+LIMITS.exitFallbackMs,target.quitDeadline??Infinity);
  if(target.control&&deadline>now){try{target.control.exitSync(deadline);}catch{}}
}
