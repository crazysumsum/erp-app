import { fulfillmentOperationHash } from "./fulfillmentOperationHash.js";
import { FULFILLMENT_OPERATION_TYPES,FULFILLMENT_STATUSES,SHIPMENT_STATUSES } from "./fulfillmentConstants.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError,FULFILLMENT_ERROR_STATUS } from "./fulfillmentErrors.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
const uuid=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
const successfulStatus=Object.freeze({CREATE:"DRAFT",UPDATE:"DRAFT",ALLOCATE:"PICKING",REALLOCATE:"PICKING",PICK:"PICKED",CANCEL:"CANCELLED",SHIPMENT_CREATE:"DRAFT",SHIPMENT_UPDATE:"DRAFT",SHIPMENT_CANCEL:"CANCELLED",SHIP:"SHIPPED",REVERSE:"REVERSED",EXPORT:"QUEUED"});
const createTypes=new Set(["CREATE","SHIPMENT_CREATE","EXPORT"]);
const permission=type=>type==="REVERSE"?"fulfillment.reverse":type==="EXPORT"?"fulfillment.view":"fulfillment.operation";
const targetType=type=>type==="EXPORT"?"EXPORT":["SHIPMENT_CREATE","SHIPMENT_UPDATE","SHIPMENT_CANCEL","SHIP","REVERSE"].includes(type)?"SHIPMENT":"FULFILLMENT";
function fields(value,required,optional=[]){
  if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).some(k=>![...required,...optional].includes(k))||required.some(k=>!Object.hasOwn(value,k)))throw new TypeError("Invalid Fulfillment operation fields");
}
function normalize(input){
  fields(input,["eventId","operationType","target","payload","leaseOwner","correlationId"]);fields(input.target,["type","id"]);
  const request={eventId:input.eventId,operationType:input.operationType,target:{type:input.target.type,id:input.target.id},leaseOwner:input.leaseOwner,correlationId:input.correlationId};
  if(!uuid(request.eventId)||!uuid(request.correlationId)||!FULFILLMENT_OPERATION_TYPES.includes(request.operationType)||request.target.type!==targetType(request.operationType)||
    typeof request.leaseOwner!=="string"||!/^[\x21-\x7e]{1,190}$/u.test(request.leaseOwner))throw new TypeError("Invalid Fulfillment operation identity");
  if(createTypes.has(request.operationType)?request.target.id!==null:request.target.id===null)throw new TypeError("Invalid Fulfillment operation target");
  if(request.target.id!==null)fulfillmentInteger(request.target.id);
  return {...request,hash:fulfillmentOperationHash({operationType:request.operationType,target:request.target,payload:input.payload})};
}

function safeResult(value){
  const result=typeof value==="string"?JSON.parse(value):value;fields(result,["id","status","version"],["number"]);fulfillmentInteger(result.id);
  if(![...FULFILLMENT_STATUSES,...SHIPMENT_STATUSES,"QUEUED","PROCESSING","COMPLETED","FAILED"].includes(result.status)||!Number.isSafeInteger(result.version)||result.version<1||result.version>4294967295||
    result.number!==undefined&&(typeof result.number!=="string"||! /^(FUL|SHP|REV)-[0-9]{6}-[0-9]{6,13}$/u.test(result.number)||result.number.length>24))throw new TypeError("Invalid Fulfillment replay result");
  return {...result};
}
function decodeDetails(code,value){
  if(!Object.hasOwn(FULFILLMENT_ERROR_STATUS,code)||code==="DATABASE_TRANSACTION_INDETERMINATE")throw new TypeError("Invalid terminal Fulfillment error");
  const details=value===null?{}:typeof value==="string"?JSON.parse(value):value;
  fulfillmentError(code,details);return {...details};
}
function assertResultTarget(result,type,operationType){
  const statuses=type==="FULFILLMENT"?FULFILLMENT_STATUSES:type==="SHIPMENT"?SHIPMENT_STATUSES:["QUEUED","PROCESSING","COMPLETED","FAILED","CANCELLED"];
  if(result.status!==successfulStatus[operationType]||!statuses.includes(result.status)||result.number!==undefined&&(type==="EXPORT"||!result.number.startsWith(type==="FULFILLMENT"?"FUL-":"SHP-")))conflict();
}
const clock=async tx=>{const [[row]]=await tx.query("SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms");const now=Number(row.now_ms);if(!Number.isSafeInteger(now)||now<0)throw new TypeError("Invalid operation clock");return now;};
const conflict=()=>{throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");};
const concurrent=()=>{throw fulfillmentError("CONCURRENT_OPERATION");};
export class FulfillmentOperationService {
  constructor({database,time,leaseMs=60000}){
    if(!Number.isSafeInteger(leaseMs)||leaseMs<1||leaseMs>2147483647)throw new TypeError("Invalid operation lease");
    this.database=database;this.time=time;this.leaseMs=leaseMs;
  }
  async #actor(tx,type){return requireFulfillmentActor(this.database,tx,permission(type));}
  async #row(tx,request,actor,locking=true){
    const [[row]]=await tx.query(`SELECT * FROM fulfillment_operation_requests WHERE event_id=?${locking?" FOR UPDATE":""}`,[request.eventId]);
    if(!row||row.payload_hash!==request.hash||row.operation_type!==request.operationType||row.target_type!==request.target.type||String(row.initiated_by)!==String(actor.id)||
      (request.target.id!==null&&String(row.target_id)!==request.target.id))conflict();
    return row;
  }
  #decode(row){
    fulfillmentInteger(String(row.id));
    const base={operationId:String(row.id),eventId:row.event_id,status:row.status,created:false,replay:row.status!=="IN_PROGRESS",leaseOwner:row.lease_owner,correlationId:row.correlation_id};
    if(row.status==="SUCCEEDED"){
      const result=safeResult(row.result_json);assertResultTarget(result,row.target_type,row.operation_type);if(String(row.target_id)!==result.id||row.completed_at===null||row.public_error_code!==""||row.lease_owner!==""||row.lease_expires_at!==null)conflict();
      return {...base,result};
    }
    if(row.status==="FAILED"){
      if(row.result_json!==null||row.completed_at===null||row.lease_owner!==""||row.lease_expires_at!==null)conflict();
      return {...base,publicErrorCode:row.public_error_code,publicErrorDetails:decodeDetails(row.public_error_code,row.public_error_details)};
    }
    if(row.status!=="IN_PROGRESS"||row.completed_at!==null||row.result_json!==null||row.public_error_code!==""||!row.lease_owner||row.lease_expires_at===null||row.public_error_details!==null||!Number.isSafeInteger(Number(row.lease_expires_at)))conflict();
    return base;
  }
  async claimInTransaction(tx,input){
    const request=normalize(input),actor=await this.#actor(tx,request.operationType),now=await clock(tx);
    try{
      const [row]=await tx.execute(`INSERT INTO fulfillment_operation_requests(event_id,operation_type,target_type,target_id,payload_hash,status,lease_owner,lease_expires_at,attempt_count,correlation_id,initiated_by,created_at,updated_at)
        VALUES (?,?,?,?,?,'IN_PROGRESS',?,?,1,?,?,?,?)`,[request.eventId,request.operationType,request.target.type,request.target.id,request.hash,request.leaseOwner,now+this.leaseMs,request.correlationId,actor.id,now,now]);
      fulfillmentInteger(String(row.insertId));
      return {operationId:String(row.insertId),eventId:request.eventId,status:"IN_PROGRESS",created:true,replay:false,leaseOwner:request.leaseOwner,correlationId:request.correlationId};
    }catch(error){if((error.cause?.code??error.code)!=="ER_DUP_ENTRY")throw error;}
    // A duplicate INSERT already holds its source lock; completed/processing lookup adds no S→X upgrade.
    return this.#decode(await this.#row(tx,request,actor,false));
  }
  async takeOverInTransaction(tx,{request:input,expectedLeaseOwner}){
    const request=normalize(input),actor=await this.#actor(tx,request.operationType),row=await this.#row(tx,request,actor),now=await clock(tx);
    this.#decode(row);
    if(row.status!=="IN_PROGRESS"||row.lease_owner!==expectedLeaseOwner||Number(row.lease_expires_at)>now||row.attempt_count>=4294967295||request.leaseOwner===expectedLeaseOwner)concurrent();
    const [changed]=await tx.execute(`UPDATE fulfillment_operation_requests SET lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,updated_at=?
      WHERE id=? AND status='IN_PROGRESS' AND lease_owner=? AND lease_expires_at<=? AND payload_hash=? AND target_type=? AND target_id<=>?`,[request.leaseOwner,now+this.leaseMs,now,row.id,expectedLeaseOwner,now,request.hash,request.target.type,row.target_id]);
    if(changed.affectedRows!==1)concurrent();
    return {...this.#decode({...row,lease_owner:request.leaseOwner,lease_expires_at:now+this.leaseMs}),replay:false};
  }
  async #complete(tx,input,result,error){
    const request=normalize(input),actor=await this.#actor(tx,request.operationType),row=await this.#row(tx,request,actor),now=await clock(tx);
    this.#decode(row);
    if(row.status!=="IN_PROGRESS"||row.lease_owner!==request.leaseOwner||Number(row.lease_expires_at)<=now)concurrent();
    if(result){assertResultTarget(result,request.target.type,request.operationType);if(request.target.id!==null&&result.id!==request.target.id)conflict();}
    const [changed]=await tx.execute(`UPDATE fulfillment_operation_requests SET status=?,target_id=?,result_json=?,public_error_code=?,public_error_details=?,lease_owner='',lease_expires_at=NULL,next_attempt_at=NULL,updated_at=?,completed_at=?
      WHERE id=? AND status='IN_PROGRESS' AND lease_owner=? AND payload_hash=? AND lease_expires_at>?`,[result?"SUCCEEDED":"FAILED",result?.id??row.target_id,result?JSON.stringify(result):null,error?.code??"",error?JSON.stringify(error.details):null,now,now,row.id,request.leaseOwner,request.hash,now]);
    if(changed.affectedRows!==1)concurrent();return result??{status:"FAILED",publicErrorCode:error.code,publicErrorDetails:error.details};
  }
  succeedInTransaction(tx,{request,result}){return this.#complete(tx,request,safeResult(result),null);}
  failKnownRolledBackInTransaction(tx,{request,publicErrorCode,publicErrorDetails={}}){return this.#complete(tx,request,null,{code:publicErrorCode,details:decodeDetails(publicErrorCode,publicErrorDetails)});}
  async getForActorInTransaction(tx,eventId){
    if(!uuid(eventId))throw new TypeError("Invalid Fulfillment event");
    const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.view");
    const [[row]]=await tx.query("SELECT * FROM fulfillment_operation_requests WHERE event_id=? AND initiated_by=?",[eventId,actor.id]);
    if(!row)return null;
    const {leaseOwner:_leaseOwner,...safe}=this.#decode(row);return safe;
  }
}
