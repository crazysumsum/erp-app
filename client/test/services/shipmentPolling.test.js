// The two approved75B pure polling/error cases; finite schedules and no command submission.
import {it,expect,vi} from "vitest";
import {effectScope,ref} from "vue";
vi.mock("@/framework/http/HttpClient.js",()=>({httpClient:{get:vi.fn(),post:vi.fn()}}));
import {httpClient} from "@/framework/http/HttpClient.js";
import * as client from "@/services/shipment.js";
const modules=import.meta.glob("../../src/components/fulfillment/useShipmentOperationPolling.js",{eager:true});
const eventId="c2e7f6b5-5b56-46f9-83cc-0ce21382bd8c",correlationId="b5e03d47-e9fc-4b17-9d78-d19f06897a6e",statusUrl=`/api/v1/fulfillment-operations/by-event/${eventId}`;
const reference=Object.freeze({eventId,correlationId,statusUrl}),pending={operationId:"77",eventId,correlationId,status:"IN_PROGRESS",result:null,publicErrorCode:null,publicErrorDetails:null};

it("CLIENT-POLL-LIFECYCLE: three finite original-event schedules stop on success, failure and owner/unmount abort",async()=>{
 const module=modules["../../src/components/fulfillment/useShipmentOperationPolling.js"];expect(module,"Approved Shipment polling helper must exist").toBeDefined();
 vi.useFakeTimers();
 try{
  for(const schedule of ["success","failure","unmount"]){
   httpClient.get.mockReset();httpClient.post.mockReset();const scope=effectScope(),actorId=ref("1");let polling,resolveLate,resumedScope;
   if(schedule==="unmount")httpClient.get.mockImplementationOnce(()=>new Promise(resolve=>{resolveLate=resolve;}));
   else httpClient.get.mockResolvedValueOnce(pending).mockResolvedValueOnce(schedule==="success"?{...pending,status:"SUCCEEDED",result:{id:"9",number:"SHP-261103-000001",status:"SHIPPED",version:3}}:{...pending,status:"FAILED",publicErrorCode:"SHIPPING_ADDRESS_CHANGED",publicErrorDetails:{correlationId,statusUrl}});
   try{
    scope.run(()=>{polling=module.useShipmentOperationPolling({reference:ref(reference),shipmentId:ref("9"),actorId});});
    await vi.advanceTimersByTimeAsync(0);expect(httpClient.get).toHaveBeenCalledTimes(1);expect(httpClient.get.mock.lastCall[0]).toBe(statusUrl);const originalSignal=httpClient.get.mock.lastCall[1].signal;expect(originalSignal).toBeInstanceOf(AbortSignal);
    if(schedule==="unmount"){
     scope.stop();expect(originalSignal.aborted).toBe(true);resolveLate({...pending,status:"SUCCEEDED",result:{id:"9",status:"SHIPPED",version:3}});await vi.advanceTimersByTimeAsync(0);expect(polling.operation.value).toBe(null);expect(polling.loading.value).toBe(false);
     // The same navigation/abort schedule mounts a fresh scope, then changes owner; no additional business event.
     let resolveOwner,ownerPolling;httpClient.get.mockImplementationOnce(()=>new Promise(resolve=>{resolveOwner=resolve;}));resumedScope=effectScope();resumedScope.run(()=>{ownerPolling=module.useShipmentOperationPolling({reference:ref(reference),shipmentId:ref("9"),actorId});});await vi.advanceTimersByTimeAsync(0);const ownerSignal=httpClient.get.mock.lastCall[1].signal;actorId.value="2";await vi.advanceTimersByTimeAsync(0);expect(ownerSignal.aborted).toBe(true);resolveOwner({...pending,status:"SUCCEEDED",result:{id:"9",status:"SHIPPED",version:3}});await vi.advanceTimersByTimeAsync(20000);expect(ownerPolling.operation.value).toBe(null);expect(ownerPolling.loading.value).toBe(false);expect(httpClient.get).toHaveBeenCalledTimes(2);
    }else{
     expect(polling.operation.value.status).toBe("IN_PROGRESS");await vi.advanceTimersByTimeAsync(2000);expect(httpClient.get).toHaveBeenCalledTimes(2);expect(polling.operation.value.status).toBe(schedule==="success"?"SUCCEEDED":"FAILED");expect(polling.polling.value).toBe(false);if(schedule==="failure")expect(polling.error.value).toMatchObject({action:"address",preserveInput:true});await vi.advanceTimersByTimeAsync(20000);expect(httpClient.get).toHaveBeenCalledTimes(2);
    }
    expect(httpClient.get.mock.calls.length).toBeLessThanOrEqual(4);expect(httpClient.get.mock.calls.every(([path])=>path===statusUrl)).toBe(true);expect(httpClient.post).not.toHaveBeenCalled();expect(reference).toEqual({eventId,correlationId,statusUrl});
   }finally{scope.stop();resumedScope?.stop();}
  }
 }finally{vi.useRealTimers();}
});

it("CLIENT-ERROR-RECOVERY: finite202/409/403/503 safe outcomes retain the original input without automatic submission",()=>{
 expect(client.shipmentFailure,"Approved Shipment error mapping must exist").toBeTypeOf("function");httpClient.get.mockReset();httpClient.post.mockReset();
 const input=Object.freeze({eventId,version:1,totalWeight:"1.250000",weightUom:"KG",notes:"Synthetic retained input"}),before={...input};
 for(const [status,code,action]of [[202,"IN_PROGRESS","recover"],[409,"SHIPPING_ADDRESS_CHANGED","address"],[409,"ALLOCATION_CANDIDATE_CHANGED","allocation"],[403,"PERMISSION_STALE","none"],[503,"DATABASE_TRANSACTION_INDETERMINATE","recover"]]){
  const outcome=client.shipmentFailure({status,code,message:"SQL secret <script>bad()</script>",details:{statusUrl,correlationId}});expect(outcome).toMatchObject({action,preserveInput:true});expect(outcome.message).toBeTypeOf("string");expect(outcome.message).not.toMatch(/SQL|secret|<script>/u);expect(input).toEqual(before);
 }
 const unknown=client.shipmentOriginalReference(eventId);expect(unknown).toEqual({eventId,correlationId:null,statusUrl});expect(Object.isFrozen(unknown)).toBe(true);expect(()=>client.shipmentOperationReference(unknown)).toThrow();expect(client.shipmentOriginalReference(eventId,correlationId)).toEqual(reference);
 expect(httpClient.get).not.toHaveBeenCalled();expect(httpClient.post).not.toHaveBeenCalled();
});
