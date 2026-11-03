import {onScopeDispose,ref,toValue,watch} from "vue";
import shipment,{shipmentDocumentId,shipmentOriginalReference,shipmentOperationReference,shipmentFailure} from "@/services/shipment.js";
import {ApiError} from "@/framework/http/ApiError.js";

const unavailable=()=>{throw new ApiError({code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});};
const waiting=()=>({message:"原確認仍未完成，請保留操作識別碼並繼續查詢原結果。",action:"recover",preserveInput:true});
export function useShipmentOperationPolling({reference,shipmentId,actorId}){
 const operation=ref(null),error=ref(null),loading=ref(false),polling=ref(false),resolvedReference=ref(null);
 let timer,sessionTimer,controller,generation=0,disposed=false,scope=null,knownCorrelation=null,knownOperation=null,deadline=0,reads=0;
 function stop(){generation++;clearTimeout(timer);clearTimeout(sessionTimer);controller?.abort();loading.value=false;polling.value=false;}
 async function read(current){
  if(disposed||current!==generation||!scope)return;
  if(performance.now()>=deadline||reads>=30){stop();error.value=waiting();return;}
  const active=new AbortController();controller=active;loading.value=true;reads++;
  try{
   const value=await shipment.getOperation(scope.eventId,{signal:active.signal});if(disposed||current!==generation||active.signal.aborted)return;
   if(value.eventId!==scope.eventId||knownCorrelation!==null&&value.correlationId!==knownCorrelation||knownOperation!==null&&shipmentDocumentId(value.operationId)!==knownOperation)unavailable();
   if(value.status==="SUCCEEDED"&&(shipmentDocumentId(value.result?.id)!==scope.shipmentId||value.result.status!=="SHIPPED"||value.result.version<3))unavailable();
   if(value.status==="FAILED"&&value.publicErrorCode==="DATABASE_TRANSACTION_INDETERMINATE")unavailable();
   knownCorrelation=value.correlationId;knownOperation=shipmentDocumentId(value.operationId);resolvedReference.value=shipmentOriginalReference(scope.eventId,knownCorrelation);operation.value=value;
   if(value.status!=="IN_PROGRESS"){
    stop();if(value.status==="FAILED"){const failure=shipmentFailure({status:409,code:value.publicErrorCode});error.value=failure.action==="recover"?{message:"這次確認未完成，請重新載入出貨單後核對。",action:"reload",preserveInput:true}:failure;}return;
   }
   timer=setTimeout(()=>read(current),2000);
  }catch(cause){if(current!==generation||active.signal.aborted)return;stop();error.value=cause?.status===404?waiting():shipmentFailure(cause);}
  finally{if(current===generation)loading.value=false;}
 }
 async function synchronize(manual=false){
  if(disposed)return;
  const input=toValue(reference);if(!input){stop();scope=null;knownCorrelation=null;knownOperation=null;operation.value=null;error.value=null;resolvedReference.value=null;return;}
  try{
   const original=input.correlationId===null?shipmentOriginalReference(input.eventId):shipmentOperationReference(input),owner=shipmentDocumentId(toValue(actorId)),id=shipmentDocumentId(toValue(shipmentId));
   if(input.statusUrl!==original.statusUrl)unavailable();
   if(scope&&(scope.actorId!==owner||scope.shipmentId!==id)){stop();operation.value=null;resolvedReference.value=null;error.value={message:"登入身分或出貨單已變更，請重新載入目前資料。",action:"none",preserveInput:true};return;}
   const changed=!scope||scope.eventId!==original.eventId;
   if(changed){stop();scope=Object.freeze({...original,actorId:owner,shipmentId:id});knownCorrelation=original.correlationId;knownOperation=null;operation.value=null;}
   else if(original.correlationId!==null){if(knownCorrelation!==null&&original.correlationId!==knownCorrelation)unavailable();knownCorrelation=original.correlationId;}
   resolvedReference.value=shipmentOriginalReference(scope.eventId,knownCorrelation);
   // Equivalent storage copies and learned metadata cannot restart the bounded session.
   if(!changed&&!manual||operation.value&&operation.value.status!=="IN_PROGRESS")return;
   stop();error.value=null;deadline=performance.now()+60000;reads=0;polling.value=true;const current=generation;
   sessionTimer=setTimeout(()=>{if(current===generation){stop();error.value=waiting();}},60000);return await read(current);
  }catch(cause){stop();operation.value=null;resolvedReference.value=null;error.value=shipmentFailure(cause);}
 }
 const refresh=()=>synchronize(true);
 watch([()=>!!toValue(reference),()=>toValue(reference)?.eventId,()=>toValue(reference)?.correlationId,()=>toValue(reference)?.statusUrl,()=>toValue(shipmentId),()=>toValue(actorId)],()=>synchronize(),{immediate:true,flush:"sync"});
 onScopeDispose(()=>{disposed=true;stop();});
 return {operation,error,loading,polling,resolvedReference,refresh,stop};
}
