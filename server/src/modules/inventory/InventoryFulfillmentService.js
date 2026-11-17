import { assertActorFresh } from "../authorization/directoryLookups.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { InventoryAuditService } from "./InventoryAuditService.js";
import { InventoryLockService } from "./InventoryLockService.js";
import { InventoryOperationService, inventoryOperationHash } from "./InventoryOperationService.js";
import { inventoryError } from "./inventoryErrors.js";
import { providerInventoryCommand, validateInventoryCommandContext } from "./inventoryValidation.js";
import { fulfillmentInventoryFields, fulfillmentInventoryId, normalizeFulfillmentInventoryBatch } from "./inventoryFulfillmentValidation.js";
import { claimFulfillmentInventoryBatch, completeFulfillmentInventoryBatch, readFulfillmentInventoryBatch } from "./inventoryFulfillmentReceipts.js";
import { postFulfillmentStockBatch } from "./inventoryFulfillmentStock.js";
import { getActiveTransactionIsolation, hasTransactionEventAdmission } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { assertShipmentEventAdmissionInTransaction } from "../fulfillment/shipmentEventAdmission.js";
import { claimFulfillmentInventoryScope } from "./inventoryFulfillmentScope.js";
import { FULFILLMENT_INVENTORY_COMMANDS } from "./inventoryFulfillmentConstants.js";
import { postFulfillmentAllocationBatch } from "./inventoryFulfillmentAllocation.js";
import { prepareFulfillmentIssueOutcome,finishFulfillmentIssueOutcome,markFulfillmentReconciliationRead,enterFulfillmentWriteMode,finishFulfillmentReversalOutcome,readFulfillmentShipmentEventAdmission,finishFulfillmentReversalZeroEffect } from "./inventoryFulfillmentOutcome.js";

const OUTCOME_UNKNOWN_SOURCE_CODES=new Set(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR","ER_KEY_DOES_NOT_EXITS","INVENTORY_SOURCE_CONFLICT","INVENTORY_INPUT_INVALID","INVENTORY_QUANTITY_INVALID","INVENTORY_DEPENDENCY_UNAVAILABLE","ALLOCATION_STATE_CONFLICT"]);
function unknownOutcomeSource(error){return OUTCOME_UNKNOWN_SOURCE_CODES.has(error?.cause?.code??error?.code);}

export class InventoryFulfillmentService {
  #receipts=new WeakMap();
  #preparations=new WeakMap();
  #reconciliationVerifier;
  #outcomeContexts=new WeakMap();
  #outcomeProofs=new WeakMap();
  #reversalOutcomeContexts=new WeakMap();
  #reversalOutcomeProofs=new WeakMap();
  #zeroContexts=new WeakMap();
  #zeroProofs=new WeakMap();
  #eventAdmissionVerifier;
  constructor({database,time,logger,itemLookup,operations,locks,audit,reconciliationVerifier,eventAdmissionVerifier}={}) {
    this.database=database;this.context=database?.context;this.time=time;
    this.itemLookup=itemLookup??new ItemLookupService({database,time,logger});
    this.operations=operations??new InventoryOperationService({database,eventAdmissionVerifier});this.locks=locks??new InventoryLockService();
    this.audit=audit??new InventoryAuditService({database,time,logger});
    if(reconciliationVerifier!==undefined&&typeof reconciliationVerifier!=="function")throw new TypeError("Trusted reconciliation verifier required");
    this.#reconciliationVerifier=reconciliationVerifier;
    if(eventAdmissionVerifier!==undefined&&typeof eventAdmissionVerifier!=="function")throw new TypeError("Trusted event admission verifier required");
    this.#eventAdmissionVerifier=eventAdmissionVerifier;
  }
  assertTransaction(tx) {
    if (!tx||typeof tx.query!=="function"||typeof tx.execute!=="function"||this.context?.get()?.databaseTransaction!==tx||getActiveTransactionIsolation(tx)!=="READ COMMITTED") throw new TypeError("Fulfillment Inventory requires the current active READ COMMITTED caller transaction");
    return this.context.get();
  }
  async #command(tx,command,action) {
    if (!FULFILLMENT_INVENTORY_COMMANDS[action]) throw inventoryError("INVENTORY_INPUT_INVALID");
    const current=this.assertTransaction(tx),permission=action==="REVERSE"?"fulfillment.reverse":"fulfillment.operation";
    enterFulfillmentWriteMode(tx);
    const authorization={purpose:`fulfillment.${action.toLowerCase()}`,requiredCallerPermission:permission};
    const documentType=["ISSUE","REVERSE"].includes(action)?"SHIPMENT":"PICK";
    const normalized=providerInventoryCommand(tx,command,{authorization,module:"FULFILLMENT",documentType});
    const context=validateInventoryCommandContext(tx,normalized,authorization);
    const payload=normalizeFulfillmentInventoryBatch(action,context.payload);
    if (context.actor.userId===null||context.actor.serviceName!==""||String(context.actor.userId)!==String(current.auth?.claims?.sub)||
        context.source.lineId!==""||context.source.documentId!==(payload.shipmentId??payload.fulfillmentId)||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(context.source.eventId)) throw inventoryError("INVENTORY_INPUT_INVALID");
    const actual=current.auth.claims;
    for (const [name,values] of [["roles",context.actor.claimedRoles],["permissions",context.actor.claimedPermissions]]) {
      if (!Array.isArray(actual[name])||JSON.stringify([...values].sort())!==JSON.stringify([...actual[name]].sort())) throw inventoryError("PERMISSION_STALE");
    }
    const actor=await assertActorFresh(tx,{actorId:context.actor.userId,claimedRoles:context.actor.claimedRoles,claimedPermissions:context.actor.claimedPermissions});
    if (!actor.username||!["fulfillment.view",permission].every(p=>actor.permissions.includes(p))) throw inventoryError("PERMISSION_STALE");
    let managedOwner=null;
    if(["ISSUE","REVERSE"].includes(action)){
      const input={eventId:context.source.eventId,shipmentId:payload.shipmentId,action};
      const owner=this.#eventAdmissionVerifier?await this.#eventAdmissionVerifier(tx,input):await assertShipmentEventAdmissionInTransaction(this.database,tx,input);
      if(action==="REVERSE"&&(owner?.state!=="MANAGED"||owner.eventId!==context.source.eventId||owner.shipmentId!==payload.shipmentId||
          owner.fulfillmentId!==payload.fulfillmentId||owner.actorId!==String(context.actor.userId)))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
      if(action==="REVERSE"){
        for(const field of ["salesOrderId","customerId","warehouseId"])fulfillmentInventoryId(owner[field]);
        managedOwner=owner;
      }
      if(action==="ISSUE"&&owner?.state!=="UNMANAGED")throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    }
    return {...context,payload,actorLabel:actor.username,permissions:actor.permissions,managedOwner};
  }
  async #outcomeBinding(tx,session,phase){
    this.assertTransaction(tx);
    if(!this.#reconciliationVerifier)throw new TypeError("Trusted reconciliation verifier required");
    const source=await this.#reconciliationVerifier(tx,session,phase);
    fulfillmentInventoryFields(source,["fulfillmentId","shipmentId","salesOrderId","customerId","warehouseId","eventId","actorId","scopeHash","correlationId","inventoryRequestHash","salesRequestHash","pickedLines"]);
    if(!Object.isFrozen(source)||!Array.isArray(source.pickedLines)||!Object.isFrozen(source.pickedLines))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    for(const field of ["fulfillmentId","shipmentId","salesOrderId","customerId","warehouseId","actorId"])fulfillmentInventoryId(source[field]);
    if(typeof source.scopeHash!=="string"||!/^[a-f0-9]{64}$/u.test(source.scopeHash)||source.inventoryRequestHash!==null&&(typeof source.inventoryRequestHash!=="string"||!/^[a-f0-9]{64}$/u.test(source.inventoryRequestHash))||[source.eventId,source.correlationId].some(value=>typeof value!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value)))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    if(source.salesRequestHash!==null&&(typeof source.salesRequestHash!=="string"||!/^[a-f0-9]{64}$/u.test(source.salesRequestHash)))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    return source;
  }
  async prepareShipmentIssueOutcomeReadInTransaction(tx,session){
    const source=await this.#outcomeBinding(tx,session,"inventory.prepare");markFulfillmentReconciliationRead(tx);
    let prepared;try{prepared=await prepareFulfillmentIssueOutcome(tx,source);}catch(error){if(!unknownOutcomeSource(error))throw error;prepared={available:false,rows:[]};}
    if(await this.#outcomeBinding(tx,session,"inventory.prepare")!==source)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const context=Object.freeze({});this.#outcomeContexts.set(context,{tx,session,source,prepared,finished:false});return context;
  }
  async readShipmentIssueOutcomeInTransaction(tx,context){
    const read=this.#outcomeContexts.get(context);
    if(!read||read.tx!==tx||read.finished||await this.#outcomeBinding(tx,read.session,"inventory.finish")!==read.source)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    read.finished=true;let outcome;try{outcome=await finishFulfillmentIssueOutcome(tx,read.prepared,read.source);}catch(error){if(!unknownOutcomeSource(error))throw error;outcome={state:"UNKNOWN"};}
    if(await this.#outcomeBinding(tx,read.session,"inventory.finish")!==read.source)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const proof=Object.freeze({state:outcome.state});this.#outcomeProofs.set(proof,{...read,outcome});return proof;
  }
  async verifyShipmentIssueOutcomeProofInTransaction(tx,session,proof){
    const read=this.#outcomeProofs.get(proof);
    if(!read||read.tx!==tx||read.session!==session||await this.#outcomeBinding(tx,session,"inventory.verify")!==read.source)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    return structuredClone(read.outcome);
  }
  async #reversalOutcomeBinding(tx,session,phase){
    const current=this.assertTransaction(tx);
    if(!this.#reconciliationVerifier)throw new TypeError("Trusted reversal reconciliation verifier required");
    const source=await this.#reconciliationVerifier(tx,session,`reversal.inventory.${phase}`);
    fulfillmentInventoryFields(source,["purpose","fulfillmentId","shipmentId","salesOrderId","customerId","warehouseId","eventId","actorId","scopeHash","correlationId","inventoryRequestHash","salesRequestHash","pickedLines","originalIssue"]);
    const frozen=value=>value===null||typeof value!=="object"||Object.isFrozen(value)&&Object.values(value).every(frozen);
    if(source.purpose!=="SHIPMENT_REVERSED"||!frozen(source)||!Array.isArray(source.pickedLines))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    for(const name of ["fulfillmentId","shipmentId","salesOrderId","customerId","warehouseId","actorId"])fulfillmentInventoryId(source[name]);
    fulfillmentInventoryFields(source.originalIssue,["eventId","references"]);
    const references=source.originalIssue.references;
    if(!Array.isArray(references)||!references.length||references.length>5000)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    for(const reference of references){
      fulfillmentInventoryFields(reference,["shipmentIssueId","originalMovementId","originalInventoryOperationId","inventoryAllocationId"]);
      for(const name of ["shipmentIssueId","originalMovementId","originalInventoryOperationId","inventoryAllocationId"])fulfillmentInventoryId(reference[name]);
    }
    for(const name of ["shipmentIssueId","originalMovementId","inventoryAllocationId"]){
      if(new Set(references.map(reference=>reference[name])).size!==references.length)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    }
    for(const value of [source.scopeHash,source.inventoryRequestHash]){
      if(typeof value!=="string"||!/^[a-f0-9]{64}$/u.test(value))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    }
    for(const value of [source.eventId,source.originalIssue.eventId,source.correlationId]){
      if(typeof value!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    }
    if(source.eventId===source.originalIssue.eventId||source.salesRequestHash!==null&&(typeof source.salesRequestHash!=="string"||!/^[a-f0-9]{64}$/u.test(source.salesRequestHash)))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const claims=current.auth?.claims;
    if(String(claims?.sub)!==source.actorId)throw inventoryError("PERMISSION_STALE");
    const actor=await assertActorFresh(tx,{actorId:claims.sub,claimedRoles:claims.roles,claimedPermissions:claims.permissions});
    if(!actor.username||!["fulfillment.view","fulfillment.reverse"].every(permission=>actor.permissions.includes(permission)))throw inventoryError("PERMISSION_STALE");
    return source;
  }
  async prepareShipmentReversalOutcomeReadInTransaction(tx,session){
    const source=await this.#reversalOutcomeBinding(tx,session,"prepare");markFulfillmentReconciliationRead(tx);
    let prepared;try{prepared=await prepareFulfillmentIssueOutcome(tx,source);}catch(error){if(!unknownOutcomeSource(error))throw error;prepared={available:false,rows:[]};}
    if(await this.#reversalOutcomeBinding(tx,session,"prepare")!==source)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const context=Object.freeze({});this.#reversalOutcomeContexts.set(context,{tx,session,source,prepared,finished:false});return context;
  }
  async readShipmentReversalOutcomeInTransaction(tx,context){
    const read=this.#reversalOutcomeContexts.get(context);
    if(!read||read.tx!==tx)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const source=await this.#reversalOutcomeBinding(tx,read.session,"finish");
    if(source!==read.source||read.finished)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    read.finished=true;let outcome;
    try{outcome=await finishFulfillmentReversalOutcome(tx,read.prepared,read.source);}catch(error){if(!unknownOutcomeSource(error))throw error;outcome={state:"UNKNOWN"};}
    if(await this.#reversalOutcomeBinding(tx,read.session,"finish")!==read.source)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const proof=Object.freeze({state:outcome.state});this.#reversalOutcomeProofs.set(proof,{...read,outcome});return proof;
  }
  async verifyShipmentReversalOutcomeProofInTransaction(tx,session,proof){
    const read=this.#reversalOutcomeProofs.get(proof);
    if(!read||read.tx!==tx||read.session!==session||await this.#reversalOutcomeBinding(tx,session,"verify")!==read.source)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    return structuredClone(read.outcome);
  }
  async readShipmentEventAdmissionInTransaction(tx,{eventId,shipmentId}){
    this.assertTransaction(tx);fulfillmentInventoryId(shipmentId);
    if(!hasTransactionEventAdmission(this.database,tx,eventId))throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
    const claims=this.context.get()?.auth?.claims;
    const actor=await assertActorFresh(tx,{actorId:claims?.sub,claimedRoles:claims?.roles,claimedPermissions:claims?.permissions});
    if(!actor.username||!["fulfillment.view","fulfillment.reverse"].every(permission=>actor.permissions.includes(permission)))throw inventoryError("PERMISSION_STALE");
    try{return await readFulfillmentShipmentEventAdmission(tx,eventId);}
    catch(error){if(!unknownOutcomeSource(error))throw error;return {state:"UNKNOWN"};}
  }
  async #zeroBinding(tx,session,phase){
    const current=this.assertTransaction(tx);
    if(!this.#reconciliationVerifier)throw new TypeError("Trusted reversal reconciliation verifier required");
    const source=await this.#reconciliationVerifier(tx,session,`reversal.zero.inventory.${phase}`);
    fulfillmentInventoryFields(source,["purpose","fulfillmentId","shipmentId","salesOrderId","customerId","warehouseId","eventId","actorId","scopeHash","correlationId","pickedLines","originalIssue"]);
    const frozen=value=>value===null||typeof value!=="object"||Object.isFrozen(value)&&Object.values(value).every(frozen);
    if(source.purpose!=="SHIPMENT_REVERSAL_ZERO_EFFECT"||!frozen(source)||!Array.isArray(source.pickedLines)||
        !hasTransactionEventAdmission(this.database,tx,source.eventId))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    for(const field of ["fulfillmentId","shipmentId","salesOrderId","customerId","warehouseId","actorId"])fulfillmentInventoryId(source[field]);
    if(typeof source.scopeHash!=="string"||!/^[a-f0-9]{64}$/u.test(source.scopeHash))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    fulfillmentInventoryFields(source.originalIssue,["eventId","references"]);
    for(const value of [source.eventId,source.originalIssue.eventId,source.correlationId]){
      if(typeof value!=="string"||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    }
    if(source.eventId===source.originalIssue.eventId)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const references=source.originalIssue.references;
    if(!Array.isArray(references)||!references.length||references.length>5000)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    for(const reference of references){
      fulfillmentInventoryFields(reference,["shipmentIssueId","originalMovementId","originalInventoryOperationId","inventoryAllocationId"]);
      for(const field of Object.keys(reference))fulfillmentInventoryId(reference[field]);
    }
    for(const field of ["shipmentIssueId","originalMovementId","inventoryAllocationId"]){
      if(new Set(references.map(row=>row[field])).size!==references.length)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    }
    const claims=current.auth?.claims;
    if(String(claims?.sub)!==source.actorId)throw inventoryError("PERMISSION_STALE");
    const actor=await assertActorFresh(tx,{actorId:claims.sub,claimedRoles:claims.roles,claimedPermissions:claims.permissions});
    if(!actor.username||!["fulfillment.view","fulfillment.reverse"].every(permission=>actor.permissions.includes(permission)))throw inventoryError("PERMISSION_STALE");
    return source;
  }
  async prepareShipmentReversalZeroEffectReadInTransaction(tx,session){
    const source=await this.#zeroBinding(tx,session,"prepare");markFulfillmentReconciliationRead(tx);
    let prepared;
    try{
      prepared=await prepareFulfillmentIssueOutcome(tx,source);
      if((await readFulfillmentShipmentEventAdmission(tx,source.eventId)).state!=="CLEAR")prepared={available:false,rows:[]};
    }catch(error){if(!unknownOutcomeSource(error))throw error;prepared={available:false,rows:[]};}
    if(await this.#zeroBinding(tx,session,"prepare")!==source)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const context=Object.freeze({});this.#zeroContexts.set(context,{tx,session,source,prepared,finished:false});return context;
  }
  async readShipmentReversalZeroEffectInTransaction(tx,context){
    const read=this.#zeroContexts.get(context);
    if(!read||read.tx!==tx||read.finished||await this.#zeroBinding(tx,read.session,"finish")!==read.source)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    read.finished=true;let outcome;
    try{outcome=await finishFulfillmentReversalZeroEffect(tx,read.prepared,read.source);}
    catch(error){if(!unknownOutcomeSource(error))throw error;outcome={state:"UNKNOWN"};}
    outcome={...outcome,eligibility:outcome.state==="ABSENT"?outcome.eligibility??"UNKNOWN":"UNKNOWN"};
    if(await this.#zeroBinding(tx,read.session,"finish")!==read.source)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const proof=Object.freeze({state:outcome.state});this.#zeroProofs.set(proof,{...read,outcome});return proof;
  }
  async verifyShipmentReversalZeroEffectProofInTransaction(tx,session,proof){
    const read=this.#zeroProofs.get(proof);
    if(!read||read.tx!==tx||read.session!==session||await this.#zeroBinding(tx,session,"verify")!==read.source)throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    return structuredClone(read.outcome);
  }
  async claimFulfillmentBatchInTransaction(tx,{action,command}) {
    const context=await this.#command(tx,command,action),timestamp=this.time.nowMs();
    const scope=await claimFulfillmentInventoryScope(tx,{...context,timestamp,operations:this.operations});
    if(context.managedOwner&&(scope.warehouseId!==context.managedOwner.warehouseId||scope.salesOrderId!==context.managedOwner.salesOrderId))throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const batch=await claimFulfillmentInventoryBatch(tx,{...context,action,timestamp,operations:this.operations});
    const preparation=Object.freeze({operationId:String(batch.operationId),requestHash:batch.requestHash});
    this.#preparations.set(preparation,{tx,context,batch,status:"PREPARED"});
    return preparation;
  }
  postFulfillmentIssueBatchInTransaction(tx,command,preparation) { return this.#post(tx,command,"ISSUE",preparation); }
  reverseFulfillmentIssueAndRestoreReservationBatchInTransaction(tx,command,preparation) { return this.#post(tx,command,"REVERSE",preparation); }
  allocateForFulfillmentBatchInTransaction(tx,command,preparation) { return this.#post(tx,command,"ALLOCATE",preparation); }
  releaseFulfillmentAllocationsInTransaction(tx,command,preparation) { return this.#post(tx,command,"RELEASE",preparation); }
  reallocateFulfillmentBatchInTransaction(tx,command,preparation) { return this.#post(tx,command,"REALLOCATE",preparation); }
  async #post(tx,command,action,preparation) {
    const context=await this.#command(tx,command,action),prepared=this.#preparations.get(preparation);
    if (!prepared||prepared.tx!==tx||prepared.batch.action!==action||prepared.context.actor.userId!==context.actor.userId||
        prepared.context.source.documentId!==context.source.documentId||prepared.context.source.eventId!==context.source.eventId||
        prepared.batch.requestHash!==inventoryOperationHash({commandType:FULFILLMENT_INVENTORY_COMMANDS[action].root,payload:context.payload})) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const batch=prepared.batch;
    if (["EXECUTING","FAILED"].includes(prepared.status)) throw inventoryError("CONCURRENT_OPERATION");
    if (!batch.replay&&prepared.status==="PREPARED") {
      prepared.status="EXECUTING";
      try {
        if(["ISSUE","REVERSE"].includes(action))await postFulfillmentStockBatch(this,tx,batch,context);
        else await postFulfillmentAllocationBatch(this,tx,batch,context);
        await completeFulfillmentInventoryBatch(tx,batch);
        prepared.status="COMPLETED";
      } catch(error) {prepared.status="FAILED";throw error;}
    }
    const decoded=await readFulfillmentInventoryBatch(tx,{action,operationId:String(batch.operationId),documentId:batch.source.documentId,
      eventId:batch.source.eventId,requestHash:batch.requestHash,locking:false});
    const receipts=this.#receipts.get(tx)??new Map();
    receipts.set(String(batch.operationId),{action,eventId:batch.source.eventId,documentId:batch.source.documentId,requestHash:batch.requestHash,actorId:context.actor.userId});
    this.#receipts.set(tx,receipts);
    return decoded.result;
  }
  async verifyFulfillmentBatchReceiptInTransaction(tx,input) {
    const current=this.assertTransaction(tx);
    fulfillmentInventoryFields(input,["action","operationId","shipmentId","eventId","requestHash"]);
    const id=fulfillmentInventoryId(input.operationId),receipt=this.#receipts.get(tx)?.get(id);
    const action={SHIPMENT_CONFIRMED:"ISSUE",SHIPMENT_REVERSED:"REVERSE"}[input.action];
    if (!action||!receipt||receipt.action!==action||receipt.eventId!==input.eventId||receipt.documentId!==input.shipmentId||receipt.requestHash!==input.requestHash||
        String(receipt.actorId)!==String(current.auth?.claims?.sub)) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const decoded=await readFulfillmentInventoryBatch(tx,{action,operationId:id,documentId:input.shipmentId,eventId:input.eventId,requestHash:input.requestHash,locking:false});
    const ids=decoded.result.lines.flatMap(line=>line.reservations.map(member=>member.inventoryReservationId));
    const [rows]=await tx.query(`SELECT * FROM inventory_reservations WHERE id IN (${ids.map(()=>"?").join(",")}) ORDER BY id FOR SHARE`,ids);
    if (rows.length!==ids.length) throw inventoryError("INVENTORY_SOURCE_CONFLICT");
    const quantity=value=>fulfillmentInventoryId(String(value),{zero:true});
    return {result:decoded.result,reservationStates:rows.map(row=>({inventoryReservationId:fulfillmentInventoryId(String(row.id)),
      originalQuantity:quantity(row.original_quantity),consumedQuantity:quantity(row.consumed_quantity),releasedQuantity:quantity(row.released_quantity),
      outstandingQuantity:quantity(row.outstanding_quantity),status:row.status,version:Number(row.version)}))};
  }
}
