import { assertFulfillmentTransaction } from "./FulfillmentTransactionService.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentOperationHash } from "./fulfillmentOperationHash.js";
import { normalizeShipmentReversal } from "./shipmentReversalCommand.js";
import { freezeShipmentIntent } from "./shipmentConfirmationScope.js";

const unavailable=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};
const id=value=>{const text=String(value);fulfillmentInteger(text);return text;};
const quantity=value=>fulfillmentInteger(String(value),{positive:false}).toString();
const ordered=rows=>[...rows].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
function summary(value){
 const parsed=typeof value==="string"?JSON.parse(value):value;
 if(!parsed||Object.getPrototypeOf(parsed)!==Object.prototype)unavailable();
 return parsed;
}

// Durable facts reconstruct the original command; they do not reconstruct an old executor or capability.
export async function readDurableShipmentReversal(database,tx,eventId,operation){
 assertFulfillmentTransaction(database,tx);
 if(!operation){const [rows]=await tx.query("SELECT * FROM fulfillment_operation_requests WHERE event_id=? LIMIT 2",[eventId]);if(rows.length!==1)unavailable();operation=rows[0];}
 if(operation.event_id!==eventId||operation.operation_type!=="REVERSE"||operation.target_type!=="SHIPMENT"||Number(operation.is_document_archived)!==0)unavailable();
 const uuid=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
 id(operation.id);
 if(!uuid(eventId)||!uuid(operation.correlation_id)||operation.status==="IN_PROGRESS"&&!uuid(operation.lease_owner))unavailable();
 const shipmentId=id(operation.target_id),actorId=id(operation.initiated_by);
 const [rows]=await tx.query("SELECT * FROM shipment_reversals WHERE event_id=? LIMIT 2",[eventId]);
 if(rows.length!==1)unavailable();const reversal=rows[0],before=summary(reversal.before_summary);
 if(Object.keys(before).sort().join(",")!=="fulfillmentId,registryVersion,shipmentId,status,version"||before.shipmentId!==shipmentId||before.status!=="SHIPPED"||typeof before.registryVersion!=="string"||!before.registryVersion||
    id(reversal.shipment_id)!==shipmentId||id(reversal.created_by)!==actorId||reversal.correlation_id!==operation.correlation_id||Number(reversal.goods_under_company_control)!==1||Number(reversal.goods_returned_to_original_bins)!==1)unavailable();
 id(before.fulfillmentId);id(reversal.id);
 const command=normalizeShipmentReversal({eventId,version:before.version,reason:reversal.reason,goodsUnderCompanyControl:true,goodsReturnedToOriginalBins:true});
 const request=freezeShipmentIntent({eventId,operationType:"REVERSE",target:{type:"SHIPMENT",id:shipmentId},payload:command,leaseOwner:operation.lease_owner,correlationId:operation.correlation_id});
 if(fulfillmentOperationHash(request)!==operation.payload_hash)unavailable();
 const [history]=await tx.query("SELECT * FROM shipment_status_history WHERE shipment_id=? AND event_id=? AND action='REVERSE_START' LIMIT 2",[shipmentId,eventId]);
 const [audits]=await tx.query("SELECT * FROM fulfillment_audit_logs WHERE event_id=? AND action='REVERSE' AND JSON_UNQUOTE(JSON_EXTRACT(after_summary,'$.status'))='REVERSING' LIMIT 2",[eventId]);
 if(history.length!==1||audits.length!==1)unavailable();const start=history[0],audit=audits[0],after=summary(audit.after_summary);
 if(start.from_status!=="SHIPPED"||start.to_status!=="REVERSING"||Number(start.version_after)!==command.version+1||id(start.actor_user_id)!==actorId||start.reason!==command.reason||
    audit.target_type!=="SHIPMENT"||id(audit.target_id)!==shipmentId||id(audit.actor_user_id)!==actorId||audit.correlation_id!==request.correlationId||
    Object.keys(after).sort().join(",")!=="fulfillmentId,reversalId,shipmentId,status,version"||after.shipmentId!==shipmentId||after.fulfillmentId!==before.fulfillmentId||after.reversalId!==id(reversal.id)||after.status!=="REVERSING"||after.version!==command.version+1)unavailable();
 return {operation,reversal,request,actorId,fulfillmentId:before.fulfillmentId};
}

export function shipmentReversalZeroEffectSource(snapshot,durable){
 const {request,actorId}=durable,{root,shipment,lines,claims,allocations,issues}=snapshot;
 if(id(root.id)!==durable.fulfillmentId||id(shipment.id)!==request.target.id||id(shipment.fulfillment_id)!==id(root.id))unavailable();
 const pickedLines=ordered(lines).map(line=>({fulfillmentLineId:id(line.id),salesOrderLineId:id(line.sales_order_line_id),skuId:id(line.sku_id),baseQuantity:quantity(line.shipped_base_quantity),
  reservations:ordered(claims.filter(claim=>id(claim.fulfillment_line_id)===id(line.id)&&quantity(claim.consumed_quantity)!=="0")).map(claim=>({claimId:id(claim.id),inventoryReservationId:id(claim.inventory_reservation_id),baseQuantity:quantity(claim.consumed_quantity),
   allocations:ordered(allocations.filter(allocation=>id(allocation.claim_id)===id(claim.id))).map(allocation=>({inventoryAllocationId:id(allocation.inventory_allocation_id),inventoryBalanceId:id(allocation.inventory_balance_id),baseQuantity:quantity(allocation.picked_base_quantity)}))}))}));
 return freezeShipmentIntent({purpose:"SHIPMENT_REVERSAL_ZERO_EFFECT",fulfillmentId:id(root.id),shipmentId:id(shipment.id),salesOrderId:id(root.sales_order_id),customerId:id(root.customer_id),warehouseId:id(root.warehouse_id),eventId:request.eventId,actorId,scopeHash:fulfillmentOperationHash(request),correlationId:request.correlationId,pickedLines,
  originalIssue:{eventId:shipment.confirmation_event_id,references:ordered(issues).map(issue=>({shipmentIssueId:id(issue.id),originalMovementId:id(issue.inventory_movement_id),originalInventoryOperationId:id(issue.inventory_operation_id),inventoryAllocationId:id(issue.inventory_allocation_id)}))}});
}

export async function assertLocalShipmentReversalZeroEffect(tx,snapshot,durable){
 const {root,shipment,reversal,claims}=snapshot,{request}=durable;
 if(root.status!=="SHIPPED"||id(root.active_shipment_id)!==id(shipment.id)||root.reversed_at!==null||root.reversed_by!==null||shipment.reversed_at!==null||shipment.reversed_by!==null||
    reversal.completed_at!==null||reversal.completed_by!==null||reversal.after_summary!==null||reversal.failure_code!==""||claims.some(claim=>quantity(claim.reversed_quantity)!=="0"))unavailable();
 const [history]=await tx.query("SELECT id FROM fulfillment_status_history WHERE event_id=? LIMIT 1",[request.eventId]);
 const [shipmentHistory]=await tx.query("SELECT id,action FROM shipment_status_history WHERE event_id=? LIMIT 2",[request.eventId]);
 const [audits]=await tx.query("SELECT id FROM fulfillment_audit_logs WHERE event_id=? LIMIT 2",[request.eventId]);
 if(history.length||shipmentHistory.length!==1||shipmentHistory[0].action!=="REVERSE_START"||audits.length!==1)unavailable();
}
