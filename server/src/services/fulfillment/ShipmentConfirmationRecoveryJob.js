import { BaseService } from "../../framework/services/BaseService.js";
import { ShipmentConfirmationService } from "../../modules/fulfillment/ShipmentConfirmationService.js";
import { assertFulfillmentTransaction } from "../../modules/fulfillment/FulfillmentTransactionService.js";
import { shipmentTransactionBudget } from "../../modules/fulfillment/shipmentOperationLease.js";
import { fulfillmentError } from "../../modules/fulfillment/fulfillmentErrors.js";

const name="fulfillment.confirmationRecovery",serviceName="job.fulfillmentConfirmationRecovery";
const unavailable=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};

export class ShipmentConfirmationRecoveryJob extends BaseService {
 static service=Object.freeze({name:serviceName,lifecycle:"singleton",dependencies:["scheduler","mysqldatabase","time","logging"],eager:true});
 static jobs=Object.freeze([{name,method:"run",scope:"cluster",intervalMs:60000,timeoutMs:120000,runOnStart:false}]);
 #job;
 #invocations=new WeakMap();
 #active=false;
 #confirmation;
 constructor(input={}){
  super(input);this.scheduler=this.services.require("scheduler");this.database=this.services.require("mysqldatabase");this.time=this.services.require("time");this.logger=this.services.require("logging").logger;
  this.#confirmation=new ShipmentConfirmationService({database:this.database,time:this.time,logger:this.logger,operationLeaseMs:this.config.fulfillment.operationLeaseMs,recoveryVerifier:(tx,token)=>tx===null?this.#admit(token):this.#verify(tx,token)});
 }
 async initialize(){this.scheduler.register(this);this.#job=this.scheduler.jobs.get(name);}
 #runtime(token){
  const record=this.#invocations.get(token),scheduler=this.scheduler,job=this.#job;
  if(!record||scheduler.owner!==record.owner||scheduler.started!==true||scheduler.stopped!==false||scheduler.schedulerConfig.enabled!==true||scheduler.jobs.get(name)!==job||job?.serviceName!==serviceName||job.method!=="run"||job.scope!=="cluster"||job.enabled!==true||scheduler.running.get(name)?.controller.signal!==record.signal||record.signal.aborted||performance.now()>=record.deadline)unavailable();
  return record;
 }
 async #admit(token){
  const record=this.#runtime(token);if(await this.services.resolve(serviceName)!==this)unavailable();this.#runtime(token);
  const budget=shipmentTransactionBudget(this.database)+this.database.config.acquireTimeoutMs;
  if(!Number.isSafeInteger(budget)||record.deadline-performance.now()<budget)unavailable();return record;
 }
 async #verify(tx,token){
  assertFulfillmentTransaction(this.database,tx);const record=await this.#admit(token);
  // Framework lease seconds are distinct from the original operation's millisecond nonce/lease.
  const [[lease]]=await tx.query("SELECT owner,expires_at FROM fr_job_leases WHERE job_name=? FOR SHARE",[name]),[[clock]]=await tx.query("SELECT UNIX_TIMESTAMP() AS now");
  const expires=Number(lease?.expires_at),now=Number(clock?.now);
  if(!lease||lease.owner!==record.owner||!Number.isSafeInteger(expires)||!Number.isFinite(now)||expires*1000-now*1000<shipmentTransactionBudget(this.database)+this.database.config.acquireTimeoutMs)unavailable();
  this.#runtime(token);return record.signal;
 }
 async run(signal){
  if(this.#active||!(signal instanceof AbortSignal)||signal.aborted)unavailable();
  // Reserve the existing bounded cluster-acquire TX/acquisition cost; never restart the Scheduler timeout.
  const token=Object.freeze({});this.#active=true;this.#invocations.set(token,{signal,owner:this.scheduler.owner,deadline:performance.now()+Math.min(120000,this.#job.timeoutMs)-shipmentTransactionBudget(this.database)-this.database.config.acquireTimeoutMs});
  let processed=0,failed=0,deferred=0;
  try{
   const context=this.database.context;if(typeof context?.storage?.run!=="function")unavailable();
   return await context.storage.run({signal,auth:null,databaseTransaction:null},async()=>{
   await this.#admit(token);
   const events=await this.database.withTransaction(async tx=>{
    await this.#verify(tx,token);
    const [rows]=await tx.query("SELECT event_id FROM fulfillment_operation_requests WHERE operation_type='SHIP' AND target_type='SHIPMENT' AND status='IN_PROGRESS' AND is_document_archived=0 AND lease_expires_at<=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AND (next_attempt_at IS NULL OR next_attempt_at<=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)) ORDER BY lease_expires_at,id LIMIT ?",[this.config.fulfillment.recoveryBatchSize]);return rows;
   },{isolationLevel:"READ COMMITTED",signal});
   for(const event of events){
    await this.#admit(token);
    try{const result=await this.#confirmation.recoverExpiredConfirmation(event.event_id,token,{signal});if(result.state==="SUCCEEDED"||result.state==="FAILED"){processed++;if(result.state==="FAILED")failed++;}else{deferred++;if(result.state==="EXHAUSTED")await this.logger.error("fulfillment.confirmation_recovery_exhausted","Shipment confirmation technical retries exhausted; original event remains pending",{code:"FULFILLMENT_RECOVERY_EXHAUSTED",correlationId:result.correlationId,attemptCount:result.attemptCount});}}
    catch{deferred++;this.#runtime(token);}
   }
   await this.logger.info("fulfillment.confirmation_recovery_completed","Shipment confirmation recovery batch completed",{processed,failed,deferred});
   if(deferred)throw new Error("Shipment confirmation recovery remains pending");
   return {processed,failed,deferred};
   });
  }finally{this.#invocations.delete(token);this.#active=false;}
 }
}
