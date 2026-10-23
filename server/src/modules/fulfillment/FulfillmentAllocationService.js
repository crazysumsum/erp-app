import { assertFulfillmentCandidateResult } from "./fulfillmentCandidateResult.js";
import { FulfillmentTransactionService } from "./FulfillmentTransactionService.js";
import { FulfillmentLockService } from "./FulfillmentLockService.js";
import { requireFulfillmentActor } from "./fulfillmentAuthorization.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { SalesFulfillmentService } from "../sales/SalesFulfillmentService.js";
import { InventoryLookupService } from "../inventory/InventoryLookupService.js";
import { ItemLookupService } from "../item/ItemLookupService.js";

export function normalizeFulfillmentCandidateQuery(input) {
  if(!input||Object.getPrototypeOf(input)!==Object.prototype||Object.keys(input).some(key=>!["version","page"].includes(key))||!Number.isSafeInteger(input.version)||input.version<1||input.version>4294967295||input.page!==undefined&&(!Number.isSafeInteger(input.page)||input.page<1||!Number.isSafeInteger(input.page*100)))throw fulfillmentError("FULFILLMENT_INPUT_INVALID");
  return {version:input.version,page:input.page??1};
}
export class FulfillmentAllocationService {
  constructor({database,time,logger}) {
    Object.assign(this,{database,time,logger});this.transactions=new FulfillmentTransactionService({database});
    this.sales=new SalesFulfillmentService({database,time,logger});this.inventoryLookup=new InventoryLookupService({database,time,logger});
    this.locks=new FulfillmentLockService({database,time,sales:this.sales,inventoryLookup:this.inventoryLookup,itemLookup:new ItemLookupService({database,time,logger})});
  }
  async candidates(fulfillmentId,input) {
    const query=normalizeFulfillmentCandidateQuery(input);fulfillmentInteger(fulfillmentId);
    return this.transactions.withTransaction(async tx=>{
      const actor=await requireFulfillmentActor(this.database,tx,"fulfillment.operation");
      const [[header]]=await tx.query("SELECT sales_order_id FROM fulfillments WHERE id=?",[fulfillmentId]);
      if(!header)throw fulfillmentError("FULFILLMENT_NOT_FOUND");
      const order=await this.sales.getOrderForFulfillment(String(header.sales_order_id),{atMs:this.time.nowMs()});
      const [lines]=await tx.query("SELECT * FROM fulfillment_lines WHERE fulfillment_id=? ORDER BY id",[fulfillmentId]);
      const [claims]=await tx.query("SELECT * FROM fulfillment_line_reservation_claims WHERE fulfillment_id=? ORDER BY id",[fulfillmentId]);
      if(!lines.length||lines.length>100||!claims.length||claims.length>5000)throw fulfillmentError("RESERVATION_CLAIM_CONFLICT");
      const scope=lines.map(line=>{
        const members=claims.filter(claim=>String(claim.fulfillment_line_id)===String(line.id));
        if(!members.length||members.length>50||members.some(claim=>claim.status!=="ACTIVE"||String(claim.original_claimed_quantity)!==String(claim.active_claimed_quantity)||BigInt(claim.released_quantity)!==0n||BigInt(claim.consumed_quantity)!==0n||BigInt(claim.reversed_quantity)!==0n)||members.reduce((sum,claim)=>sum+fulfillmentInteger(String(claim.active_claimed_quantity)),0n)!==BigInt(line.planned_base_quantity))throw fulfillmentError("RESERVATION_CLAIM_CONFLICT");
        return {fulfillmentLineId:String(line.id),salesOrderLineId:String(line.sales_order_line_id),baseQuantity:String(line.planned_base_quantity),reservations:members.map(claim=>({inventoryReservationId:String(claim.inventory_reservation_id),baseQuantity:String(claim.active_claimed_quantity)}))};
      });
      if(claims.some(claim=>!lines.some(line=>String(line.id)===String(claim.fulfillment_line_id))))throw fulfillmentError("RESERVATION_CLAIM_CONFLICT");
      const intent={actor:{userId:String(actor.id),serviceName:"",claimedRoles:actor.roles,claimedPermissions:actor.permissions},purpose:"CLAIM",salesOrderId:order.orderId,expectedOrderVersion:order.version,lines:scope.map(line=>{
        const source=order.lines.find(row=>row.lineId===line.salesOrderLineId);if(!source)throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
        return {salesOrderLineId:source.lineId,expectedVersion:source.version,baseQuantity:line.baseQuantity,reservations:line.reservations.map(member=>{
          const mapping=source.reservationMappings.find(row=>row.inventoryReservationId===member.inventoryReservationId),claim=claims.find(row=>String(row.inventory_reservation_id)===member.inventoryReservationId);if(!mapping||!claim)throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");
          return {...member,claimId:String(claim.id),expectedVersion:mapping.inventoryVersion};
        })};
      })};
      intent.lines.sort((a,b)=>BigInt(a.salesOrderLineId)<BigInt(b.salesOrderLineId)?-1:1);
      for(const line of intent.lines)line.reservations.sort((a,b)=>BigInt(a.inventoryReservationId)<BigInt(b.inventoryReservationId)?-1:1);
      const proof=await this.locks.lockClaimCapacityInTransaction(tx,{salesIntent:intent,fulfillmentId,expectedVersion:query.version,lines:scope});
      const demands=proof.claims.map(member=>({fulfillmentLineId:member.fulfillmentLineId,claimId:String(claims.find(claim=>String(claim.inventory_reservation_id)===member.inventoryReservationId).id),inventoryReservationId:member.inventoryReservationId,skuId:member.skuId,requestedQuantity:member.baseQuantity,page:query.page}));
      let result;
      try{result=await this.inventoryLookup.listFulfillmentBatchAllocationCandidates(tx,{warehouseId:proof.sales.warehouse.id,demands,asOf:this.time.nowMs()});}
      catch(error){if(["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error.cause?.code??error.code))throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");throw error;}
      assertFulfillmentCandidateResult(result,demands,proof.claims,proof.sales.warehouse.id,new Map(lines.map(line=>[String(line.id),String(line.base_uom_id)])));
      return {fulfillmentId,version:query.version,...result};
    });
  }
}
