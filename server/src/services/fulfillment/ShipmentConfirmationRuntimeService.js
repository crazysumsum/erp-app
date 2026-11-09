import { BaseService } from "../../framework/services/BaseService.js";
import { ShipmentConfirmationService,normalizeShipmentConfirmationCommand } from "../../modules/fulfillment/ShipmentConfirmationService.js";
import { ShipmentInquiryService } from "../../modules/fulfillment/ShipmentInquiryService.js";
import { ShipmentReversalService } from "../../modules/fulfillment/ShipmentReversalService.js";
import { FulfillmentTransactionService } from "../../modules/fulfillment/FulfillmentTransactionService.js";
import { requireFulfillmentActor } from "../../modules/fulfillment/fulfillmentAuthorization.js";
import { fulfillmentInteger } from "../../modules/fulfillment/fulfillmentValidation.js";
import { fulfillmentError } from "../../modules/fulfillment/fulfillmentErrors.js";

export class ShipmentConfirmationRuntimeService extends BaseService {
 static service=Object.freeze({name:"fulfillment.shipmentConfirmation",lifecycle:"singleton",dependencies:["mysqldatabase","time","logging"],eager:true});
 #active=new Set();
 #events=new Map();
 #deadlines=new WeakMap();
 #closed=false;
 #confirmation;
 #inquiry;
 #reversal;
 constructor(input={}){
  super(input);this.database=this.services.require("mysqldatabase");
  const options={database:this.database,time:this.services.require("time"),logger:this.services.require("logging").logger};
  this.time=options.time;this.transactions=new FulfillmentTransactionService(options);this.#confirmation=new ShipmentConfirmationService({...options,operationLeaseMs:this.config.fulfillment.operationLeaseMs});this.#inquiry=new ShipmentInquiryService(options);
 }
 #detach(record){clearTimeout(record.timer);record.parentSignal?.removeEventListener("abort",record.abort);}
 #finish(record){this.#detach(record);this.#active.delete(record);if(this.#events.get(record.eventId)===record)this.#events.delete(record.eventId);record.finish();}
 #beginRequest(context){
  if(context?.databaseTransaction||typeof this.database.context?.storage?.run!=="function")throw new TypeError("New Shipment request context required");
  const startedAt=Date.parse(context?.startedAt);
  if(!Number.isSafeInteger(startedAt))throw new TypeError("Original HTTP request start required");
  // Include earlier middleware work and leave transport room inside the unchanged three-second contract.
  const deadline=Math.min(this.#deadlines.get(context)??Infinity,performance.now()+2500-Math.max(0,this.time.nowMs()-startedAt));
  this.#deadlines.set(context,deadline);
  if(this.#closed||context?.signal?.aborted||performance.now()>=deadline||this.#active.size>=this.database.config.connectionLimit)throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
  let finish;const controller=new AbortController(),record={deadline,controller,parentSignal:context?.signal,abort:()=>controller.abort(),done:new Promise(resolve=>{finish=resolve;}),finish:()=>finish()};
  this.#active.add(record);record.parentSignal?.addEventListener("abort",record.abort,{once:true});record.timer=setTimeout(record.abort,Math.max(0,deadline-performance.now()));return record;
 }
 async authorizeRequest(){
  const context=this.database.context?.get(),record=this.#beginRequest(context);
  try{await this.database.context.storage.run({...context,signal:record.controller.signal,databaseTransaction:null},()=>this.transactions.withTransaction(tx=>requireFulfillmentActor(this.database,tx,"fulfillment.operation")));if(this.#closed||record.controller.signal.aborted||performance.now()>=record.deadline)throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");return true;}
  finally{this.#finish(record);}
 }
 #launch(record,started,claims){
  this.#detach(record);record.parentSignal=null;record.started=started;record.controller=new AbortController();
  record.timer=setTimeout(()=>record.controller.abort(),Math.min(this.config.fulfillment.operationLeaseMs,60000));
  const context={auth:{claims},signal:record.controller.signal,databaseTransaction:null};
  record.promise=Promise.resolve().then(()=>this.database.context.storage.run(context,async()=>{
   const terminal=started.outcome==="SHIPPED"?started:await this.#confirmation.completeConfirmation(started,{signal:record.controller.signal});
   return this.#inquiry.confirmationResult(terminal);
  })).then(data=>({data}),error=>({error})).finally(()=>this.#finish(record));
 }
 async #wait(record,deadline,signal){
  let timer,onAbort;
  try{
   const outcome=await Promise.race([record.promise,new Promise(resolve=>{
    onAbort=()=>resolve(null);timer=setTimeout(onAbort,Math.max(0,deadline-performance.now()));
    if(signal?.aborted)resolve(null);else signal?.addEventListener("abort",onAbort,{once:true});
   })]);
   if(outcome?.data)return {statusCode:200,data:outcome.data};
   if(outcome?.error?.statusCode<500&&outcome.error.code!=="CONCURRENT_OPERATION")throw outcome.error;
   if(record.started.outcome!=="SHIPPING")throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE",{correlationId:record.started.correlationId,statusUrl:"/api/v1/fulfillment-operations/by-event/"+record.eventId});
   return {statusCode:202,data:record.started};
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",onAbort);}
 }
 async confirm(shipmentId,input){
  fulfillmentInteger(shipmentId);const intent=normalizeShipmentConfirmationCommand(input),context=this.database.context?.get(),record=this.#beginRequest(context);
  Object.assign(record,{eventId:intent.eventId,shipmentId,version:intent.version});let launched=false;
  const phaseAController=record.controller,deadline=record.deadline;
  try{
   const actor=await this.database.context.storage.run({...context,signal:phaseAController.signal,databaseTransaction:null},()=>this.transactions.withTransaction(tx=>requireFulfillmentActor(this.database,tx,"fulfillment.operation")));
   if(this.#closed||phaseAController.signal.aborted||performance.now()>=deadline)throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
   record.actorId=String(actor.id);const existing=this.#events.get(intent.eventId);
   if(existing){
    if(existing.shipmentId!==shipmentId||existing.version!==intent.version||existing.actorId!==record.actorId)throw fulfillmentError("IDEMPOTENCY_CONFLICT");
    return await this.#wait(existing,deadline,phaseAController.signal);
   }
   const claims={sub:record.actorId,roles:[...actor.roles],permissions:[...actor.permissions]};
   let started;
   try{started=await this.database.context.storage.run({auth:{claims},signal:phaseAController.signal,databaseTransaction:null},()=>this.#confirmation.startConfirmation(shipmentId,intent));}
   catch(error){
    if(error?.statusCode>=400&&error.statusCode<500)throw error;
    const failure=fulfillmentError(error?.code==="DATABASE_TRANSACTION_INDETERMINATE"?"DATABASE_TRANSACTION_INDETERMINATE":"FULFILLMENT_DEPENDENCY_UNAVAILABLE",{statusUrl:"/api/v1/fulfillment-operations/by-event/"+intent.eventId});failure.cause=error;throw failure;
   }
   this.#detach(record);
   if(this.#closed)throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
   if(started.outcome==="SHIPPING"&&!this.#confirmation.ownsStartedConfirmation(started))return {statusCode:202,data:started};
   this.#events.set(intent.eventId,record);this.#launch(record,started,claims);launched=true;
   return await this.#wait(record,deadline,context?.signal);
  }finally{if(!launched)this.#finish(record);}
 }
 async prepareReversalReadOnly(shipmentId,input,started){
  const context=this.database.context?.get(),record=this.#beginRequest(context);
  try{
   // Keep the original-instance capability private; request auth is read afresh through this shared context.
   this.#reversal??=new ShipmentReversalService({database:this.database,time:this.time,operationLeaseMs:this.#confirmation.operations.leaseMs,sales:this.#confirmation.sales,inventoryLookup:this.#confirmation.inventoryLookup});
   const preparation=await this.database.context.storage.run({...context,signal:record.controller.signal,databaseTransaction:null},()=>this.#reversal.prepareReversalReadOnly(shipmentId,input,started));
   if(this.#closed||record.controller.signal.aborted||performance.now()>=record.deadline)throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
   return preparation;
  }finally{this.#finish(record);}
 }
 async shutdown(){this.#closed=true;const active=[...this.#active];for(const record of active)record.controller.abort();await Promise.all(active.map(record=>record.done));}
}
