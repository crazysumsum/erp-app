import { normalizeFulfillmentListQuery, encodeFulfillmentListCursor, fulfillmentListPageQuery } from "./fulfillmentListQuery.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

export function fulfillmentAllowedActions(header, permissions, pending) {
  const actions = [];
  if (permissions.includes("fulfillment.operation") && !pending && header.active_shipment_id === null) {
    if (header.status === "DRAFT") actions.push("update", "allocate", "cancel");
    if (header.status === "PICKING") actions.push("reallocate", "pickConfirm", "cancel");
    if (header.status === "PICKED") actions.push("cancel");
  }
  if (header.allocated_at !== null) actions.push("printPickList");
  return actions;
}
const quantity = value => { const text=String(value); fulfillmentInteger(text,{positive:false}); return text; };
const identifier = value => { const text=String(value); fulfillmentInteger(text); return text; };
export class FulfillmentInquiryService {
  constructor({database}) { this.database=database; }
  async #actor(tx) {
    if(this.database.context?.get()?.databaseTransaction!==tx||!["READ COMMITTED","REPEATABLE READ"].includes(getActiveTransactionIsolation(tx)))throw new TypeError("Current inquiry transaction required");
    const claims=this.database.context.get()?.auth?.claims;
    if(typeof claims?.sub!=="string"||!/^[1-9][0-9]*$/u.test(claims.sub)||!Number.isSafeInteger(Number(claims.sub)))throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");
    const actor=await assertActorFresh(tx,{actorId:Number(claims.sub),claimedRoles:claims.roles,claimedPermissions:claims.permissions});
    if(!actor.permissions.includes("fulfillment.view"))throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");return actor;
  }
  list(input={}) {
    const query=normalizeFulfillmentListQuery(input);
    if(this.database.context?.get()?.databaseTransaction)throw new TypeError("List requires a fresh read transaction");
    return this.database.withTransaction(async tx=>{
      const actor=await this.#actor(tx);
      const [sourceOrders]=query.q?await tx.query("SELECT id FROM sales_orders WHERE sales_order_number=?",[query.q]):[[]];
      const {sql,values}=fulfillmentListPageQuery(query,actor.id,sourceOrders.length?String(sourceOrders[0].id):null),[rows]=await tx.query(sql,values),page=rows.slice(0,query.pageSize),hasMore=rows.length>query.pageSize;
      return {items:page.map(row=>({id:identifier(row.id),number:row.fulfillment_number,status:row.status,version:Number(row.version),salesOrderId:identifier(row.sales_order_id),salesOrderNumber:row.sales_order_number_snapshot,customer:{id:identifier(row.customer_id),code:row.customer_code_snapshot,name:row.customer_name_snapshot},warehouse:{id:identifier(row.warehouse_id),code:row.warehouse_code_snapshot,name:row.warehouse_name_snapshot},lineCount:Number(row.line_count),hasShortPick:Boolean(row.has_short_pick),createdAt:Number(row.created_at),updatedAt:Number(row.updated_at),pickedAt:row.picked_at===null?null:Number(row.picked_at),lastBusinessUpdatedAt:Number(row.last_business_updated_at)})),page:query.page,pageSize:query.pageSize,hasMore,nextCursor:hasMore?encodeFulfillmentListCursor(query,page.at(-1)):null};
    },{isolationLevel:"REPEATABLE READ"});
  }
  detail(id, options = {}) {
    identifier(id);
    if(this.database.context?.get()?.databaseTransaction)throw new TypeError("Detail requires a fresh read transaction");
    return this.database.withTransaction(tx=>this.detailInTransaction(tx,String(id),options),{isolationLevel:"REPEATABLE READ"});
  }
  async detailInTransaction(tx,id,options = {}) {
    if(!options||Object.getPrototypeOf(options)!==Object.prototype||Object.keys(options).some(key=>!["allocationAfterId","historyBeforeSequence"].includes(key)))throw fulfillmentError("FULFILLMENT_INPUT_INVALID");
    const allocationAfterId=options.allocationAfterId??"0",historyBeforeSequence=options.historyBeforeSequence??4294967296;
    quantity(allocationAfterId);
    if(typeof allocationAfterId!=="string"||!Number.isSafeInteger(historyBeforeSequence)||historyBeforeSequence<1||historyBeforeSequence>4294967296)throw fulfillmentError("FULFILLMENT_INPUT_INVALID");
    identifier(id); const actor=await this.#actor(tx);
    const [[header]]=await tx.query("SELECT * FROM fulfillments WHERE id=?",[id]);
    if(!header)throw fulfillmentError("FULFILLMENT_NOT_FOUND");
    const [lines]=await tx.query("SELECT * FROM fulfillment_lines WHERE fulfillment_id=? ORDER BY line_no",[id]);
    if(lines.length!==Number(header.line_count)||!lines.length||lines.length>100)throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
    const [claims]=await tx.query("SELECT fulfillment_line_id,SUM(active_claimed_quantity) AS active,SUM(released_quantity) AS released,SUM(consumed_quantity) AS consumed FROM fulfillment_line_reservation_claims WHERE fulfillment_id=? GROUP BY fulfillment_line_id",[id]);
    const [allocations]=await tx.query("SELECT * FROM fulfillment_allocations WHERE fulfillment_id=? AND id>? ORDER BY id LIMIT 101",[id,allocationAfterId]);
    const [history]=await tx.query("SELECT * FROM fulfillment_status_history WHERE fulfillment_id=? AND sequence_no<? ORDER BY sequence_no DESC LIMIT 101",[id,historyBeforeSequence]);
    const [[pending]]=await tx.query("SELECT EXISTS(SELECT 1 FROM fulfillment_operation_requests WHERE target_type='FULFILLMENT' AND target_id=? AND status='IN_PROGRESS') AS active",[id]);
    const [[order]]=await tx.query("SELECT id,status,version,line_count FROM sales_orders WHERE id=?",[header.sales_order_id]);
    if(!order)throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
    const [salesLines]=await tx.query("SELECT id,reserved_outstanding_base_quantity,backordered_base_quantity,fulfilled_base_quantity,cancelled_base_quantity,ordered_base_quantity FROM sales_order_lines WHERE sales_order_id=? ORDER BY line_no",[header.sales_order_id]);
    if(salesLines.length!==Number(order.line_count)||!salesLines.length||salesLines.length>100)throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");
    return {
      fulfillment: {
        id:identifier(header.id),number:header.fulfillment_number,status:header.status,version:Number(header.version),salesOrderId:identifier(header.sales_order_id),salesOrderNumber:header.sales_order_number_snapshot,
        customer:{id:identifier(header.customer_id),code:header.customer_code_snapshot,name:header.customer_name_snapshot},warehouse:{id:identifier(header.warehouse_id),code:header.warehouse_code_snapshot,name:header.warehouse_name_snapshot},notes:header.notes,hasShortPick:Boolean(header.has_short_pick),createdAt:Number(header.created_at),updatedAt:Number(header.updated_at),
        lines:lines.map(line=>{
          const claim=claims.find(row=>String(row.fulfillment_line_id)===String(line.id));
          return {id:identifier(line.id),salesOrderLineId:identifier(line.sales_order_line_id),lineNo:Number(line.line_no),version:Number(line.version),skuId:identifier(line.sku_id),skuCode:line.sku_code_snapshot,skuName:line.sku_name_snapshot,baseUom:{id:identifier(line.base_uom_id),code:line.base_uom_code_snapshot,name:line.base_uom_name_snapshot},plannedBaseQuantity:quantity(line.planned_base_quantity),allocatedBaseQuantity:quantity(line.allocated_base_quantity),pickedBaseQuantity:quantity(line.picked_base_quantity),shortBaseQuantity:quantity(line.short_base_quantity),shippedBaseQuantity:quantity(line.shipped_base_quantity),reversedBaseQuantity:quantity(line.reversed_base_quantity),shortPickReason:line.short_pick_reason,claims:{activeBaseQuantity:quantity(claim?.active??0),releasedBaseQuantity:quantity(claim?.released??0),consumedBaseQuantity:quantity(claim?.consumed??0)}};
        }),
        allocations:{items:allocations.slice(0,100).map(row=>({id:identifier(row.id),fulfillmentLineId:identifier(row.fulfillment_line_id),claimId:identifier(row.claim_id),inventoryReservationId:identifier(row.inventory_reservation_id),inventoryAllocationId:identifier(row.inventory_allocation_id),inventoryBalanceId:identifier(row.inventory_balance_id),binCode:row.bin_code_snapshot,lotNumber:row.lot_number_snapshot,expiryDate:row.expiry_date_snapshot,status:row.status,allocatedBaseQuantity:quantity(row.allocated_base_quantity),releasedBaseQuantity:quantity(row.released_base_quantity),pickedBaseQuantity:quantity(row.picked_base_quantity),inventoryVersion:Number(row.inventory_version),balanceVersion:Number(row.balance_version)})),hasMore:allocations.length>100,nextCursor:allocations.length>100?identifier(allocations[99].id):null},
        history:{items:history.slice(0,100).map(row=>({sequence:Number(row.sequence_no),fromStatus:row.from_status,toStatus:row.to_status,action:row.action,reason:row.reason,eventId:row.event_id,versionAfter:Number(row.version_after),actorLabel:row.actor_label,occurredAt:Number(row.occurred_at)})),hasMore:history.length>100,nextCursor:history.length>100?Number(history[99].sequence_no):null},
        allowedActions:fulfillmentAllowedActions(header,actor.permissions,Boolean(pending.active))
      },
      salesOrder:{id:identifier(order.id),status:order.status,version:Number(order.version),lines:salesLines.map(line=>({id:identifier(line.id),orderedBaseQuantity:quantity(line.ordered_base_quantity),reservedOutstandingBaseQuantity:quantity(line.reserved_outstanding_base_quantity),backorderedBaseQuantity:quantity(line.backordered_base_quantity),fulfilledBaseQuantity:quantity(line.fulfilled_base_quantity),cancelledBaseQuantity:quantity(line.cancelled_base_quantity)}))}
    };
  }
}
