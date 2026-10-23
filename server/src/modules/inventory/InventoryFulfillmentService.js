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
import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { claimFulfillmentInventoryScope } from "./inventoryFulfillmentScope.js";
import { FULFILLMENT_INVENTORY_COMMANDS } from "./inventoryFulfillmentConstants.js";
import { postFulfillmentAllocationBatch } from "./inventoryFulfillmentAllocation.js";

export class InventoryFulfillmentService {
  #receipts=new WeakMap();
  #preparations=new WeakMap();
  constructor({database,time,logger,itemLookup,operations,locks,audit}={}) {
    this.database=database;this.context=database?.context;this.time=time;
    this.itemLookup=itemLookup??new ItemLookupService({database,time,logger});
    this.operations=operations??new InventoryOperationService();this.locks=locks??new InventoryLockService();
    this.audit=audit??new InventoryAuditService({database,time,logger});
  }
  assertTransaction(tx) {
    if (!tx||typeof tx.query!=="function"||typeof tx.execute!=="function"||this.context?.get()?.databaseTransaction!==tx||getActiveTransactionIsolation(tx)!=="READ COMMITTED") throw new TypeError("Fulfillment Inventory requires the current active READ COMMITTED caller transaction");
    return this.context.get();
  }
  async #command(tx,command,action) {
    if (!FULFILLMENT_INVENTORY_COMMANDS[action]) throw inventoryError("INVENTORY_INPUT_INVALID");
    const current=this.assertTransaction(tx),permission=action==="REVERSE"?"fulfillment.reverse":"fulfillment.operation";
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
    return {...context,payload,actorLabel:actor.username,permissions:actor.permissions};
  }
  async claimFulfillmentBatchInTransaction(tx,{action,command}) {
    const context=await this.#command(tx,command,action),timestamp=this.time.nowMs();
    await claimFulfillmentInventoryScope(tx,{...context,timestamp,operations:this.operations});
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
