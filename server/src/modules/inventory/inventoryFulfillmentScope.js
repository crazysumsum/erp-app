import { inventoryError } from "./inventoryErrors.js";

const fail=()=>{throw inventoryError("INVENTORY_SOURCE_CONFLICT");};

// This stable operation row serializes every event for one Fulfillment, before domain locks.
export async function claimFulfillmentInventoryScope(tx,{operations,payload,actor,actorLabel,timestamp,correlationId}) {
  const members=payload.lines.flatMap(line=>line.reservations.map(member=>({line,member})));
  const ids=members.map(entry=>entry.member.inventoryReservationId);
  const [rows]=await tx.query(`SELECT r.id,r.warehouse_id,r.purpose,o.source_module,o.source_document_type,
    o.source_document_id,o.source_line_id FROM inventory_reservations r
    JOIN inventory_operation_requests o ON o.id=r.create_operation_id
    WHERE r.id IN (${ids.map(()=>"?").join(",")}) ORDER BY r.id`,ids);
  if (rows.length!==ids.length) fail();
  const byId=new Map(rows.map(row=>[String(row.id),row]));
  let scope=null;
  for (const {line,member} of members) {
    const row=byId.get(member.inventoryReservationId);
    if (!row||row.purpose!=="SALE"||row.source_module!=="SALES"||row.source_document_type!=="SALES_ORDER"||row.source_line_id!==line.salesOrderLineId) fail();
    const next={warehouseId:String(row.warehouse_id),salesOrderId:row.source_document_id};
    if (scope&&(scope.warehouseId!==next.warehouseId||scope.salesOrderId!==next.salesOrderId)) fail();
    scope=next;
  }
  const claim=await operations.claim(tx,{commandType:"FULFILLMENT_SCOPE_LOCK",
    source:{module:"FULFILLMENT",documentType:"PICK_SCOPE",documentId:payload.fulfillmentId,lineId:"",eventId:"scope-v1"},
    payload:{fulfillmentId:payload.fulfillmentId},actorUserId:actor.userId,actorLabel,
    requestId:correlationId,correlationId,createdAt:timestamp});
  if (claim.replay) {
    if (claim.replay.resultType!=="FULFILLMENT_SCOPE"||claim.replay.resultId!==payload.fulfillmentId||
        claim.replay.resultSummary?.warehouseId!==scope.warehouseId||claim.replay.resultSummary?.salesOrderId!==scope.salesOrderId) fail();
  } else {
    await operations.complete(tx,{operationId:claim.operationId,resultType:"FULFILLMENT_SCOPE",resultId:payload.fulfillmentId,
      resultSummary:scope,completedAt:timestamp});
  }
  return scope;
}
