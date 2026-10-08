import {SalesOrderService} from "./SalesOrderService.js";
import {SalesOrderConfirmationService} from "./SalesOrderConfirmationService.js";
import {SalesOperationService} from "./SalesOperationService.js";
import {requireSalesImportActorById} from "./salesAuthorization.js";
import {salesError} from "./salesErrors.js";
import {salesEventId} from "./salesValidation.js";
import {salesSourceHash} from "./salesImportPrecheck.js";
import defaults from "../../../config/sales.js";
const json=value=>typeof value==="string"?JSON.parse(value):value;
const terminal=["SUCCEEDED","DUPLICATE","FAILED"];
const businessErrors=["CUSTOMER_NOT_SALEABLE","CUSTOMER_CREDIT_ON_HOLD","SKU_NOT_SALEABLE","SKU_UOM_INVALID","SALES_UOM_CONVERSION_INVALID","SALES_QUANTITY_INVALID","SALES_PRICE_INVALID","SALES_INPUT_INVALID","WAREHOUSE_INVALID","SALES_IMPORT_ORDER_INVALID","SALES_LINE_MERGE_CONFLICT"];
export class SalesIntakeService {
 constructor({database,time,logger,config=defaults,authorizeSalesImport,channelVerifier,orderService,confirmationService}={}){
  this.database=database;this.time=time;this.logger=logger;this.config=config;this.authorize=authorizeSalesImport;this.channelVerifier=channelVerifier;this.operations=new SalesOperationService();
  this.orders=orderService??new SalesOrderService({database,time,logger});this.confirmation=confirmationService??new SalesOrderConfirmationService({database,time,logger,config,authorizeSalesIntake:authorizeSalesImport});
 }
 async #fence(tx,signal,previous){
  const principal=await this.authorize?.();if(!principal||principal.signal!==signal||signal?.aborted!==false||typeof principal.leaseOwner!=="string"||!principal.leaseOwner||previous&&principal.leaseOwner!==previous.leaseOwner)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
  const [[lease]]=await tx.query("SELECT owner,expires_at FROM fr_job_leases WHERE job_name='sales.importWorker' FOR UPDATE"),[[clock]]=await tx.query("SELECT UNIX_TIMESTAMP() AS now,CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms"),fresh=await this.authorize?.();
  if(!lease||lease.owner!==principal.leaseOwner||![Number(lease.expires_at),Number(clock.now),Number(clock.now_ms)].every(Number.isSafeInteger)||Number(lease.expires_at)<=Number(clock.now)||fresh?.leaseOwner!==principal.leaseOwner||fresh.signal!==signal||signal.aborted)throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
  return {...principal,nowMs:Number(clock.now_ms)};
 }
 async #actor(tx,intake){
  if(intake.source_type==="CSV"){
   const [[job]]=await tx.query("SELECT confirmed_by FROM sales_import_jobs WHERE id=?",[intake.import_job_id]);if(!job)throw salesError("SALES_IMPORT_NOT_FOUND");return requireSalesImportActorById(tx,Number(job.confirmed_by));
  }
  const identity=json(intake.safe_payload)?.channelIdentity,verified=await this.channelVerifier?.(identity);
  if(!verified||verified.active!==true||verified.code!==intake.channel_code||verified.serviceId!==identity?.serviceId||typeof verified.serviceId!=="string"||!verified.serviceId||[...verified.serviceId].length>180||/[\p{Cc}\p{Cf}]/u.test(verified.serviceId))throw salesError("SALES_DEPENDENCY_UNAVAILABLE");
  return {id:null,username:`service:${verified.serviceId}`,roles:[],permissions:[]};
 }
 async #job(tx,intake,token,actor){
  if(intake.source_type!=="CSV")return;
  salesEventId(token);const [[job]]=await tx.query("SELECT status,lease_owner,lease_until,confirmed_by FROM sales_import_jobs WHERE id=? FOR UPDATE",[intake.import_job_id]);
  const [[clock]]=await tx.query("SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms");
  if(!job||job.status!=="PROCESSING"||job.lease_owner!==token||![Number(job.lease_until),Number(clock.now_ms)].every(Number.isSafeInteger)||Number(job.lease_until)<=Number(clock.now_ms)||Number(job.confirmed_by)!==actor.id)throw salesError("CONCURRENT_OPERATION");
  return Number(job.lease_until);
 }
 async #endEffect(tx,intake,token,actor,signal,fence){
  const expiresAt=await this.#job(tx,intake,token,actor),fresh=await this.#fence(tx,signal,fence);
  if(expiresAt!==undefined&&expiresAt<=fresh.nowMs)throw salesError("CONCURRENT_OPERATION");
 }
 async #operation(tx,intake,actor,nowMs){
  try{const [row]=await tx.execute(`INSERT INTO sales_operation_requests (event_id,command_type,target_type,target_id,request_hash,status,actor_user_id,actor_label,created_at,updated_at)
   VALUES (?,'PROCESS_INTAKE','INTAKE_ORDER',?,?,'IN_PROGRESS',?,?,?,?)`,[intake.processing_event_id,intake.id,intake.payload_hash,actor.id,actor.username,nowMs,nowMs]);return {id:Number(row.insertId)};}
  catch(error){if((error.cause?.code??error.code)!=="ER_DUP_ENTRY")throw error;const [[row]]=await tx.query("SELECT * FROM sales_operation_requests WHERE event_id=? FOR UPDATE",[intake.processing_event_id]);
   return {id:Number(row?.id),replay:this.#replay(row,intake,actor)};
  }
 }
 #replay(row,intake,actor){
  if(!row||row.command_type!=="PROCESS_INTAKE"||row.target_type!=="INTAKE_ORDER"||Number(row.target_id)!==Number(intake.id)||row.request_hash!==intake.payload_hash||(row.actor_user_id===null?null:Number(row.actor_user_id))!==actor.id||actor.id===null&&row.actor_label!==actor.username)throw salesError("SALES_EVENT_CONFLICT");
  if(row.status!=="SUCCEEDED")throw salesError("CONCURRENT_OPERATION");
  const result=json(row.result_summary);
  if(row.result_type!=="INTAKE_RESULT"||!result||!["SUCCEEDED","DUPLICATE"].includes(result.status)||!(result.salesOrderId===null||Number.isSafeInteger(result.salesOrderId)&&result.salesOrderId>0)||typeof result.salesOrderNumber!=="string"||!/^SO-\d{6}-\d{6}$/u.test(result.salesOrderNumber)||typeof result.isArchived!=="boolean"||!Array.isArray(result.warnings)||result.warnings.length>20||result.warnings.some(code=>typeof code!=="string"||!/^[A-Z_]{1,80}$/u.test(code)))throw salesError("SALES_EVENT_CONFLICT");
  return {status:result.status,salesOrderId:result.salesOrderId,salesOrderNumber:result.salesOrderNumber,isArchived:result.isArchived,warnings:result.warnings};
 }
 #result(intake,warnings=[]){return {status:intake.status,salesOrderId:intake.sales_order_id===null?null:Number(intake.sales_order_id),salesOrderNumber:intake.sales_order_number,isArchived:false,warnings};}
 async #complete(tx,intake,operation,result,nowMs){
  const [op]=await tx.execute("UPDATE sales_operation_requests SET status='SUCCEEDED',result_type='INTAKE_RESULT',result_id=?,result_summary=?,completed_at=?,updated_at=? WHERE id=? AND status='IN_PROGRESS'",[result.salesOrderId,JSON.stringify(result),nowMs,nowMs,operation.id]);
  const [child]=await tx.execute("UPDATE sales_intake_orders SET status=?,sales_order_id=?,sales_order_number=?,completed_at=?,updated_at=? WHERE id=? AND status IN ('QUEUED','PROCESSING')",[result.status,result.salesOrderId,result.salesOrderNumber,nowMs,nowMs,intake.id]);
  if(op.affectedRows!==1||child.affectedRows!==1)throw salesError("CONCURRENT_OPERATION");
 }
 async process(request){
  if(!request||Object.keys(request).some(key=>!["intakeOrderId","jobClaimToken","signal"].includes(key))||!Number.isSafeInteger(request.intakeOrderId)||request.intakeOrderId<1)throw salesError("SALES_INPUT_INVALID");
  const {intakeOrderId,jobClaimToken,signal}=request;if(jobClaimToken!==undefined)salesEventId(jobClaimToken);let original;
  try{return await this.operations.run(this.database,async tx=>{
   const fence=await this.#fence(tx,signal),[[initial]]=await tx.query("SELECT * FROM sales_intake_orders WHERE id=?",[intakeOrderId]);if(!initial)throw salesError("SALES_IMPORT_NOT_FOUND");salesEventId(initial.processing_event_id);
   const actor=await this.#actor(tx,initial);original={intake:initial,actor};
   if(terminal.includes(initial.status)){let result=this.#result(initial);if(initial.status!=="FAILED"){const [[operation]]=await tx.query("SELECT * FROM sales_operation_requests WHERE event_id=?",[initial.processing_event_id]);result=this.#replay(operation,initial,actor);if(result.status!==initial.status||result.salesOrderId!==(initial.sales_order_id===null?null:Number(initial.sales_order_id))||result.salesOrderNumber!==initial.sales_order_number)throw salesError("SALES_EVENT_CONFLICT");}await this.#fence(tx,signal,fence);return result;}
   const operation=await this.#operation(tx,initial,actor,fence.nowMs);await this.#job(tx,initial,jobClaimToken,actor);const [[intake]]=await tx.query("SELECT * FROM sales_intake_orders WHERE id=? FOR UPDATE",[intakeOrderId]);
   if(!intake||intake.processing_event_id!==initial.processing_event_id||intake.payload_hash!==initial.payload_hash||!["QUEUED","PROCESSING"].includes(intake.status))throw salesError("SALES_EVENT_CONFLICT");if(operation.replay){await this.#fence(tx,signal,fence);return operation.replay;}
   if(intake.source_type==="CSV"&&!this.config.importChannelCodes.includes(intake.channel_code))throw salesError("SALES_IMPORT_ORDER_INVALID");
   const hash=salesSourceHash(intake.external_order_id);if(!hash.equals(Buffer.from(intake.external_order_id_hash))){await this.logger?.error("sales.source_hash_collision","Source identity collision",{intakeOrderId,severity:"critical"});throw salesError("SALES_SOURCE_HASH_COLLISION");}
   const [[existing]]=await tx.query("SELECT * FROM sales_external_order_keys WHERE channel_code=? AND external_order_id_hash=?",[intake.channel_code,hash]);
   if(existing){if(existing.external_order_id!==intake.external_order_id){await this.logger?.error("sales.source_hash_collision","Source identity collision",{intakeOrderId,severity:"critical"});throw salesError("SALES_SOURCE_HASH_COLLISION");}if(existing.status!=="SUCCEEDED")throw salesError("CONCURRENT_OPERATION");
    const result={status:"DUPLICATE",salesOrderId:existing.sales_order_id===null?null:Number(existing.sales_order_id),salesOrderNumber:existing.sales_order_number,isArchived:Boolean(existing.is_order_archived),warnings:existing.payload_hash===intake.payload_hash?[]:["EXTERNAL_ORDER_PAYLOAD_CONFLICT"]};await tx.execute("UPDATE sales_intake_orders SET external_order_key_id=?,safe_payload=?,result_code=? WHERE id=?",[existing.id,JSON.stringify({warnings:result.warnings,...(intake.source_type==="CHANNEL"?{channelIdentity:json(intake.safe_payload).channelIdentity}:{})}),result.warnings[0]??"",intakeOrderId]);await this.#complete(tx,intake,operation,result,fence.nowMs);await this.#endEffect(tx,intake,jobClaimToken,actor,signal,fence);return result;
   }
   const stored=json(intake.safe_payload);if(!stored||stored.channelCode!==intake.channel_code||stored.externalOrderId!==intake.external_order_id||stored.document?.eventId!==intake.processing_event_id)throw salesError("SALES_IMPORT_ORDER_INVALID");
   const number=await this.orders.sequence.nextNumberInTransaction(tx,{documentType:"SALES_ORDER",nowMs:fence.nowMs});
   const [key]=await tx.execute("INSERT INTO sales_external_order_keys (channel_code,external_order_id,external_order_id_hash,source_type,payload_hash,status,claimed_at,updated_at) VALUES (?,?,?,?,?,'PROCESSING',?,?)",[intake.channel_code,intake.external_order_id,hash,intake.source_type,intake.payload_hash,fence.nowMs,fence.nowMs]);
   await tx.execute("UPDATE sales_intake_orders SET status='PROCESSING',external_order_key_id=? WHERE id=?",[key.insertId,intakeOrderId]);
   const draft=await this.orders.createIntakeDraftInTransaction(tx,{document:stored.document,actor,eventId:intake.processing_event_id,nowMs:fence.nowMs,number,source:{type:intake.source_type,intakeOrderId,externalOrderKeyId:Number(key.insertId),channelCode:intake.channel_code,externalOrderId:intake.external_order_id}});
   await tx.execute("UPDATE sales_intake_orders SET sales_order_id=?,sales_order_number=? WHERE id=?",[draft.salesOrder.id,number,intakeOrderId]);
   const confirmed=await this.confirmation.confirmIntakeDraftInTransaction(tx,{order:draft.salesOrder,actor,eventId:intake.processing_event_id,nowMs:fence.nowMs}),result={status:"SUCCEEDED",salesOrderId:confirmed.salesOrder.id,salesOrderNumber:number,isArchived:false,warnings:[...new Set([...draft.warnings,...confirmed.warnings].map(w=>w.code))]};
   await tx.execute("UPDATE sales_external_order_keys SET status='SUCCEEDED',sales_order_id=?,sales_order_number=?,updated_at=? WHERE id=? AND status='PROCESSING'",[result.salesOrderId,number,fence.nowMs,key.insertId]);await this.#complete(tx,intake,operation,result,fence.nowMs);await this.#endEffect(tx,intake,jobClaimToken,actor,signal,fence);return result;
  },{signal,timeoutMs:this.config.transactionTimeoutMs});}
  catch(error){if(!original||!businessErrors.includes(error.code))throw error;
   return this.operations.run(this.database,async tx=>{
    const fence=await this.#fence(tx,signal),actor=await this.#actor(tx,original.intake);if(actor.id!==original.actor.id||actor.id===null&&actor.username!==original.actor.username)throw salesError("SALES_EVENT_CONFLICT");await this.#job(tx,original.intake,jobClaimToken,actor);const [[intake]]=await tx.query("SELECT * FROM sales_intake_orders WHERE id=? FOR UPDATE",[intakeOrderId]);
    if(!intake||intake.processing_event_id!==original.intake.processing_event_id||intake.payload_hash!==original.intake.payload_hash||!["QUEUED","PROCESSING"].includes(intake.status))throw salesError("CONCURRENT_OPERATION");
    await tx.execute("UPDATE sales_intake_orders SET status='FAILED',result_code=?,completed_at=?,updated_at=? WHERE id=?",[error.code,fence.nowMs,fence.nowMs,intakeOrderId]);await tx.execute("INSERT INTO sales_intake_errors (intake_order_id,row_no,field_path,error_code,safe_message,created_at) VALUES (?,?,?,?,?,?)",[intakeOrderId,intake.first_row_no,error.publicDetails?.field??"order",error.code,"來源訂單未能建立，請檢查指定欄位",fence.nowMs]);
    await this.#endEffect(tx,intake,jobClaimToken,actor,signal,fence);return this.#result({...intake,status:"FAILED"});
   },{signal,timeoutMs:this.config.transactionTimeoutMs});
  }
 }
}
