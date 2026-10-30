import {getActiveTransactionIsolation} from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import {postingDiagnostics,markPostingTailStart,tracePostingAsync} from "./p1PostingDiagnostics.js";

export function callerDiagnostics(t,database,parentOf){
 const profile=postingDiagnostics(t,database,parentOf,{rootLabel:"CALLER_TRANSACTION",scope:"Actual RC Reallocate callback with post-Inventory marker; excludes transaction-control and RR Inquiry"});
 const run={async work(tx,work,context){return tracePostingAsync("CALLER_TRANSACTION",()=>work(tx,...context));}};
 profile.provider(run,"work");
 let selectionFailures=0;
 t.after(()=>t.diagnostic(JSON.stringify({callerSelectionDiagnostics:true,selectionFailures})));
 const original=database.withTransaction;
 const wrapped=function(work,...options){return original.call(this,function(tx,...context){
  let selected;
  try{selected=["REALLOCATE_ROLLBACK","REALLOCATE"].includes(parentOf(tx)?.phase)&&getActiveTransactionIsolation(tx)==="READ COMMITTED";}catch{selectionFailures++;return work(tx,...context);}
  if(selected)return run.work(tx,work,context);
  return work(tx,...context);
 },...options);};
 database.withTransaction=wrapped;
 t.after(()=>{if(database.withTransaction===wrapped)database.withTransaction=original;});
 return {inventory(owner,method){
  const original=owner[method];
  const wrapped=function(...args){const result=original.apply(this,args);if(!(result instanceof Promise))return result;return result.then(value=>{markPostingTailStart(args[0]);return value;});};
  owner[method]=wrapped;
  t.after(()=>{if(owner[method]===wrapped)owner[method]=original;});
 }};
}
