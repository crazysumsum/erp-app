import { randomUUID } from "node:crypto";
import { inventoryError } from "./inventoryErrors.js";
import { meetsMinimumRemainingLife } from "./inventoryValidation.js";
import { readFulfillmentInventoryBatch,readOriginalFulfillmentIssueBatch } from "./inventoryFulfillmentReceipts.js";

const fail=(code="ALLOCATION_STATE_CONFLICT")=>{throw inventoryError(code);};
const placeholders=values=>values.map(()=>"?").join(",");
export function number(value) {
  const n=Number(value);
  if (!Number.isSafeInteger(n)||n<0) fail("INVENTORY_QUANTITY_INVALID");
  return n;
}
export async function cas(tx,sql,args) {
  const [result]=await tx.execute(sql,args);
  if (Number(result.affectedRows)!==1) fail("CONCURRENT_OPERATION");
}
export const memberOrder=(a,b)=>Number(a.line.fulfillmentLineId)-Number(b.line.fulfillmentLineId)||Number(a.input.inventoryReservationId)-Number(b.input.inventoryReservationId);

export async function proveOwnedAllocations(tx,batch,allocations) {
  const ids=[...new Set(allocations.map(a=>String(a.create_operation_id)))];
  const [rows]=ids.length?await tx.query(`SELECT * FROM inventory_operation_requests WHERE id IN (${placeholders(ids)}) ORDER BY id`,ids):[[]];
  const byId=new Map(rows.map(row=>[String(row.id),row])),roots=new Map(),owned=new Map();
  for (const allocation of allocations) {
    const operation=byId.get(String(allocation.create_operation_id));
    if (!operation||operation.source_module!=="FULFILLMENT"||operation.source_document_type!=="PICK"||operation.source_document_id!==batch.payload.fulfillmentId) continue;
    const action=operation.command_type==="ALLOCATION_CREATE"&&operation.result_type==="FULFILLMENT_ALLOCATE_MEMBER"?"ALLOCATE"
      :operation.command_type==="ALLOCATION_REALLOCATE"&&operation.result_type==="FULFILLMENT_REALLOCATE_MEMBER"?"REALLOCATE":null;
    if (!action||operation.completed_at===null) continue;
    let summary;
    try {summary=typeof operation.result_summary==="string"?JSON.parse(operation.result_summary):operation.result_summary;} catch {fail();}
    if (!summary?.rootOperationId||!summary.rootRequestHash) fail();
    let root=roots.get(summary.rootOperationId);
    if (!root) {
      const decoded=await readFulfillmentInventoryBatch(tx,{action,operationId:summary.rootOperationId,documentId:batch.payload.fulfillmentId,
        eventId:operation.source_event_id,requestHash:summary.rootRequestHash,locking:false});
      root=new Map(decoded.result.lines.flatMap(line=>line.reservations.map(member=>[member.inventoryOperationId,
        {line,member,legs:new Map(member.allocations.map(leg=>[leg.inventoryAllocationId,leg]))}])));
      roots.set(summary.rootOperationId,root);
    }
    const entry=root.get(String(operation.id)),member=entry?.member,line=entry?.line,leg=entry?.legs.get(String(allocation.id));
    if (!leg||member.claimId!==operation.source_line_id||member.inventoryReservationId!==String(allocation.reservation_id)||leg.inventoryBalanceId!==String(allocation.stock_balance_id)) fail();
    owned.set(String(allocation.id),{allocation,claimId:member.claimId,fulfillmentLineId:line.fulfillmentLineId,salesOrderLineId:line.salesOrderLineId});
  }
  return owned;
}

async function liveFulfillmentAllocations(tx,fulfillmentId) {
  const [rows]=await tx.query(`SELECT a.* FROM inventory_allocations a
    JOIN inventory_operation_requests o ON o.id=a.create_operation_id
    WHERE o.source_module='FULFILLMENT' AND o.source_document_type='PICK' AND o.source_document_id=?
      AND o.completed_at IS NOT NULL AND a.outstanding_quantity>0
      AND ((o.command_type='ALLOCATION_CREATE' AND o.result_type='FULFILLMENT_ALLOCATE_MEMBER')
        OR (o.command_type='ALLOCATION_REALLOCATE' AND o.result_type='FULFILLMENT_REALLOCATE_MEMBER'))
    ORDER BY a.id`,[fulfillmentId]);
  return rows;
}

function assertCompleteIssueSet(batch,owned) {
  const submitted=new Map(batch.members.flatMap(member=>member.legs.map(leg=>[leg.input.inventoryAllocationId,{member,leg}])));
  if (owned.size!==submitted.size) fail();
  for (const [id,owner] of owned) {
    const entry=submitted.get(id);
    if (!entry||owner.claimId!==entry.member.input.claimId||owner.fulfillmentLineId!==entry.member.line.fulfillmentLineId||
        owner.salesOrderLineId!==entry.member.line.salesOrderLineId||String(owner.allocation.reservation_id)!==entry.member.input.inventoryReservationId||
        String(owner.allocation.stock_balance_id)!==entry.leg.input.inventoryBalanceId||
        String(owner.allocation.outstanding_quantity)!==entry.leg.input.baseQuantity) fail();
  }
}

async function originalIssue(tx,batch) {
  const original=await readOriginalFulfillmentIssueBatch(tx,{shipmentId:batch.payload.shipmentId,members:batch.members.map(m=>m.input)});
  if (original.fulfillmentId!==batch.payload.fulfillmentId||original.result.lines.length!==batch.payload.lines.length) fail("REVERSAL_NOT_ALLOWED");
  for (const line of batch.payload.lines) {
    const old=original.result.lines.find(l=>l.fulfillmentLineId===line.fulfillmentLineId&&l.salesOrderLineId===line.salesOrderLineId);
    if (!old||old.baseQuantity!==line.baseQuantity||old.reservations.length!==line.reservations.length) fail("REVERSAL_NOT_ALLOWED");
  }
  for (const member of batch.members) {
    const old=original.result.lines.flatMap(line=>line.reservations).find(m=>m.claimId===member.input.claimId&&m.inventoryReservationId===member.input.inventoryReservationId);
    if (!old||old.inventoryOperationId!==member.input.originalInventoryOperationId||old.baseQuantity!==member.input.baseQuantity||old.allocations.length!==member.legs.length) fail("REVERSAL_NOT_ALLOWED");
    for (const leg of member.legs) {
      const previous=old.allocations.find(a=>a.inventoryAllocationId===leg.input.inventoryAllocationId&&a.movementId===leg.input.originalMovementId&&a.baseQuantity===leg.input.baseQuantity);
      if (!previous) fail("REVERSAL_NOT_ALLOWED");
      leg.original=previous;
    }
  }
}

async function lockStock(service,tx,batch) {
  if (batch.action==="ISSUE") {
    const discovered=await liveFulfillmentAllocations(tx,batch.payload.fulfillmentId);
    assertCompleteIssueSet(batch,await proveOwnedAllocations(tx,batch,discovered));
  }
  const reservationIds=batch.members.map(m=>m.input.inventoryReservationId);
  const [scopes]=await tx.query(`SELECT r.*,o.source_module,o.source_document_type,o.source_line_id FROM inventory_reservations r
    JOIN inventory_operation_requests o ON o.id=r.create_operation_id WHERE r.id IN (${placeholders(reservationIds)}) ORDER BY r.id`,reservationIds);
  if (scopes.length!==reservationIds.length) fail("CONCURRENT_OPERATION");
  for (const member of batch.members) {
    const r=scopes.find(row=>String(row.id)===member.input.inventoryReservationId);
    if (!r||r.purpose!=="SALE"||r.source_module!=="SALES"||r.source_document_type!=="SALES_ORDER"||r.source_line_id!==member.line.salesOrderLineId) fail("RESERVATION_STATE_CONFLICT");
  }
  const skuIds=[...new Set(scopes.map(r=>String(r.sku_id)))].sort((a,b)=>Number(a)-Number(b));
  const profiles=batch.action==="REVERSE"?[]:await service.itemLookup.getFulfillmentInventoryProfilesInTransaction(tx,skuIds,{atMs:batch.timestamp});
  for (const profile of profiles) {
    if (!profile.inventoryTracked) fail("SKU_NOT_INVENTORY_TRACKED");
    if (profile.trackingPolicy==="serial") fail("SERIAL_TRACKING_UNSUPPORTED");
    if (!profile.usable) fail("INVENTORY_RESOURCE_NOT_FOUND");
  }
  const balanceIds=[...new Set(batch.members.flatMap(m=>m.legs.map(l=>l.original?.inventoryBalanceId??l.input.inventoryBalanceId)))];
  const [references]=await tx.query(`SELECT b.*,l.normalized_lot_number FROM inventory_stock_balances b
    LEFT JOIN inventory_lots l ON l.id=b.lot_id WHERE b.id IN (${placeholders(balanceIds)}) ORDER BY b.id`,balanceIds);
  if (references.length!==balanceIds.length) fail();
  for(const member of batch.members)for(const leg of member.legs) {
    const balance=references.find(b=>String(b.id)===(leg.original?.inventoryBalanceId??leg.input.inventoryBalanceId)),reservation=scopes.find(r=>String(r.id)===member.input.inventoryReservationId);
    if(!balance||String(balance.warehouse_id)!==String(reservation.warehouse_id)||String(balance.sku_id)!==String(reservation.sku_id))fail();
  }
  const locked=await service.locks.lockForCommand(tx,{
    warehouseIds:scopes.map(r=>number(r.warehouse_id)),stockControls:scopes.map(r=>({warehouseId:number(r.warehouse_id),skuId:number(r.sku_id)})),
    binIds:references.map(b=>number(b.bin_id)),lots:references.filter(b=>b.lot_id!==null).map(b=>({skuId:number(b.sku_id),normalizedLotNumber:b.normalized_lot_number})),
    balances:references.map(b=>({warehouseId:number(b.warehouse_id),skuId:number(b.sku_id),binId:number(b.bin_id),lotId:b.lot_id===null?null:number(b.lot_id),stockStatus:b.stock_status})),
    reservationIds:reservationIds.map(Number),now:batch.timestamp
  });
  if (locked.binLocks.length) fail("BIN_LOCKED_BY_STOCKTAKE");
  const allocationIds=batch.members.flatMap(m=>m.legs.map(l=>l.input.inventoryAllocationId));
  const [allocations]=await tx.query(`SELECT * FROM inventory_allocations WHERE reservation_id IN (${placeholders(reservationIds)})
    AND (outstanding_quantity>0 OR id IN (${placeholders(allocationIds)})) ORDER BY id FOR UPDATE`,[...reservationIds,...allocationIds]);
  const owned=batch.action==="ISSUE"?await proveOwnedAllocations(tx,batch,allocations):null;
  if (owned) {
    // Re-read the complete owner set after Warehouse anchors, independently of caller membership.
    const current=await liveFulfillmentAllocations(tx,batch.payload.fulfillmentId);
    assertCompleteIssueSet(batch,await proveOwnedAllocations(tx,batch,current));
    assertCompleteIssueSet(batch,new Map([...owned].filter(([,owner])=>number(owner.allocation.outstanding_quantity)>0)));
  }
  const lotIds=locked.lots.map(l=>l.id);
  const [lots]=lotIds.length?await tx.query(`SELECT id,sku_id,lot_number,DATE_FORMAT(expiry_date,'%Y-%m-%d') AS expiry_date FROM inventory_lots WHERE id IN (${placeholders(lotIds)})`,lotIds):[[]];
  const expectedBalances=new Map();
  for (const member of batch.members) {
    const reservation=locked.reservations.find(r=>String(r.id)===member.input.inventoryReservationId),scope=scopes.find(r=>String(r.id)===member.input.inventoryReservationId);
    if (!reservation||String(reservation.warehouse_id)!==String(scope.warehouse_id)||String(reservation.sku_id)!==String(scope.sku_id)||number(reservation.version)!==member.input.expectedVersion) fail("VERSION_CONFLICT");
    for (const key of ["original_quantity","consumed_quantity","released_quantity","outstanding_quantity"]) number(reservation[key]);
    const original=BigInt(reservation.original_quantity),consumed=BigInt(reservation.consumed_quantity),released=BigInt(reservation.released_quantity),outstanding=BigInt(reservation.outstanding_quantity),q=BigInt(member.input.baseQuantity);
    if (original!==consumed+released+outstanding||!['ACTIVE','PARTIALLY_CONSUMED','CONSUMED'].includes(reservation.status)||
        (batch.action==="ISSUE"?q>outstanding:q>consumed)) fail("RESERVATION_STATE_CONFLICT");
    for (const leg of member.legs) {
      const id=leg.original?.inventoryBalanceId??leg.input.inventoryBalanceId,balance=locked.balances.find(b=>String(b.id)===id),allocation=allocations.find(a=>String(a.id)===leg.input.inventoryAllocationId);
      const warehouse=locked.warehouses.find(w=>String(w.id)===String(reservation.warehouse_id)),bin=locked.bins.find(b=>String(b.id)===String(balance?.bin_id));
      if (!warehouse||warehouse.status!=="ACTIVE") fail("WAREHOUSE_INVALID");
      if (!balance||String(balance.warehouse_id)!==String(reservation.warehouse_id)||String(balance.sku_id)!==String(reservation.sku_id)||balance.stock_status!=="AVAILABLE"||!bin||bin.status!=="ACTIVE"||String(bin.warehouse_id)!==String(warehouse.id)) fail("BIN_INVALID");
      if (!allocation||String(allocation.reservation_id)!==String(reservation.id)||String(allocation.stock_balance_id)!==id) fail();
      const initial=expectedBalances.get(id);
      if (initial!==undefined&&initial!==leg.input.expectedBalanceVersion) fail("VERSION_CONFLICT");
      expectedBalances.set(id,leg.input.expectedBalanceVersion);
      if (number(balance.version)!==leg.input.expectedBalanceVersion) fail("VERSION_CONFLICT");
      for (const key of ["allocated_quantity","consumed_quantity","released_quantity","outstanding_quantity"]) number(allocation[key]);
      const lot=balance.lot_id===null?null:lots.find(l=>String(l.id)===String(balance.lot_id));
      if (balance.lot_id!==null&&(!lot||String(lot.sku_id)!==String(reservation.sku_id))) fail();
      const profile=profiles.find(p=>p.skuId===String(reservation.sku_id));
      if (batch.action==="ISSUE") {
        if ((profile.trackingPolicy==="none")!==(lot===null)||profile.trackingPolicy==="batch_expiry"&&!lot?.expiry_date) fail();
        if (!meetsMinimumRemainingLife(lot?.expiry_date??null,service.time.fileDate(),number(reservation.minimum_remaining_days))) fail("LOT_MINIMUM_LIFE_FAILED");
        if (number(allocation.version)!==leg.input.expectedVersion||!['ACTIVE','PARTIALLY_CONSUMED'].includes(allocation.status)||
            number(allocation.outstanding_quantity)!==number(leg.input.baseQuantity)||owned.get(String(allocation.id))?.claimId!==member.input.claimId) fail();
      } else {
        const original=leg.original.bucketSnapshot;
        if(String(balance.warehouse_id)!==original.warehouseId||String(balance.bin_id)!==original.binId||
            (balance.lot_id===null?null:String(balance.lot_id))!==original.lotId||String(balance.sku_id)!==original.skuId||balance.stock_status!==original.stockStatus)fail("REVERSAL_NOT_ALLOWED");
        if (allocation.status!=="CONSUMED"||number(allocation.outstanding_quantity)!==0||number(allocation.version)!==leg.original.allocationVersion) fail("REVERSAL_NOT_ALLOWED");
      }
      Object.assign(leg,{balance,allocation,warehouse,bin,lot,profile});
    }
    member.reservation=reservation;
    member.control=locked.stockControls.find(c=>String(c.warehouse_id)===String(reservation.warehouse_id)&&String(c.sku_id)===String(reservation.sku_id));
    if (!member.control) fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
  }
  return locked;
}

export async function postFulfillmentStockBatch(service,tx,batch,context) {
  if (batch.action==="REVERSE") await originalIssue(tx,batch);
  await lockStock(service,tx,batch);
  for (const member of [...batch.members].sort(memberOrder)) {
    const movementGroupId=randomUUID(),reverse=batch.action==="REVERSE";
    for (const leg of member.legs) {
      const balance=leg.balance,allocation=leg.allocation,q=number(leg.input.baseQuantity),before=number(balance.on_hand_quantity),allocated=number(balance.allocated_quantity);
      const after=reverse?before+q:before-q,nextAllocated=reverse?allocated:allocated-q;
      if (!Number.isSafeInteger(after)||after<0||nextAllocated<0||after<nextAllocated) fail("ALLOCATION_INSUFFICIENT");
      if (reverse) {
        const [[exists]]=await tx.query("SELECT id FROM inventory_movements WHERE reversal_of_movement_id=? LIMIT 1 FOR SHARE",[leg.input.originalMovementId]);
        if (exists) fail("REVERSAL_NOT_ALLOWED");
      }
      await cas(tx,`UPDATE inventory_stock_balances SET on_hand_quantity=?,allocated_quantity=?,
        fifo_anchor_date=CASE WHEN ?=0 THEN NULL WHEN ?=0 THEN ? ELSE fifo_anchor_date END,
        version=version+1,updated_at=? WHERE id=? AND version=?`,[after,nextAllocated,after,before,service.time.fileDate(),batch.timestamp,balance.id,balance.version]);
      const allocationVersion=number(allocation.version)+(reverse?0:1);
      if (!reverse) {
        const nextConsumed=number(allocation.consumed_quantity)+q;
        if (!Number.isSafeInteger(nextConsumed)||BigInt(allocation.allocated_quantity)!==BigInt(nextConsumed)+BigInt(allocation.released_quantity)) fail();
        await cas(tx,"UPDATE inventory_allocations SET consumed_quantity=?,outstanding_quantity=0,status='CONSUMED',version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?",[nextConsumed,batch.timestamp,context.actor.userId,allocation.id,allocation.version]);
      }
      const bucket=reverse?leg.original.bucketSnapshot:{warehouseId:String(leg.warehouse.id),warehouseCode:leg.warehouse.warehouse_code,binId:String(leg.bin.id),binCode:leg.bin.bin_code,
        lotId:leg.lot?String(leg.lot.id):null,lotNumber:leg.lot?.lot_number??null,expiryDate:leg.lot?.expiry_date??null,stockStatus:balance.stock_status,
        skuId:String(balance.sku_id),skuCode:leg.profile.skuCode,skuName:leg.profile.skuName,baseUomId:leg.profile.baseUom.uomId,baseUomCode:leg.profile.baseUom.uomCode};
      const [movement]=await tx.execute(`INSERT INTO inventory_movements(movement_group_id,operation_request_id,movement_type,location_kind,warehouse_id,bin_id,sku_id,lot_id,stock_status,direction,quantity,balance_before,balance_after,balance_version_after,reservation_id,allocation_id,reversal_of_movement_id,reason_category,reason_text,sku_code_snapshot,sku_name_snapshot,warehouse_code_snapshot,bin_code_snapshot,lot_number_snapshot,expiry_date_snapshot,posted_at,posted_by,posted_by_label)
        VALUES(?,?,?,'BIN',?,?,?,?,?,?,?,?,?,?,?,?,?,'','',?,?,?,?,?,?,?,?,?)`,
      [movementGroupId,member.operationId,reverse?"REVERSAL":"ISSUE",balance.warehouse_id,balance.bin_id,balance.sku_id,balance.lot_id,balance.stock_status,reverse?"IN":"OUT",q,before,after,number(balance.version)+1,member.reservation.id,allocation.id,reverse?leg.input.originalMovementId:null,
        bucket.skuCode,bucket.skuName,bucket.warehouseCode,bucket.binCode,bucket.lotNumber??"",bucket.expiryDate,batch.timestamp,context.actor.userId,context.actorLabel]);
      leg.result={inventoryAllocationId:String(allocation.id),inventoryBalanceId:String(balance.id),movementId:String(movement.insertId),baseQuantity:leg.input.baseQuantity,allocationVersion,balanceVersion:number(balance.version)+1,
        baseUomId:bucket.baseUomId,baseUomCode:bucket.baseUomCode,...(reverse?{shipmentIssueId:leg.input.shipmentIssueId,originalMovementId:leg.input.originalMovementId}:{})};
      Object.assign(balance,{on_hand_quantity:after,allocated_quantity:nextAllocated,version:number(balance.version)+1});
    }
    const reservation=member.reservation,control=member.control,q=number(member.input.baseQuantity),consumed=number(reservation.consumed_quantity)+(batch.action==="REVERSE"?-q:q),outstanding=number(reservation.outstanding_quantity)+(batch.action==="REVERSE"?q:-q),reserved=number(control.reserved_quantity)+(batch.action==="REVERSE"?q:-q);
    if (![consumed,outstanding,reserved].every(v=>Number.isSafeInteger(v)&&v>=0)||BigInt(reservation.original_quantity)!==BigInt(consumed)+BigInt(reservation.released_quantity)+BigInt(outstanding)) fail("RESERVATION_STATE_CONFLICT");
    const status=outstanding===0?"CONSUMED":consumed>0?"PARTIALLY_CONSUMED":"ACTIVE";
    await cas(tx,"UPDATE inventory_stock_controls SET reserved_quantity=?,version=version+1,updated_at=? WHERE id=? AND version=?",[reserved,batch.timestamp,control.id,control.version]);
    await cas(tx,"UPDATE inventory_reservations SET consumed_quantity=?,outstanding_quantity=?,status=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?",[consumed,outstanding,status,batch.timestamp,context.actor.userId,reservation.id,reservation.version]);
    control.reserved_quantity=reserved;control.version=number(control.version)+1;
    member.version=number(reservation.version)+1;
    await service.audit.recordSucceeded(tx,{actorUserId:context.actor.userId,actorLabel:context.actorLabel,action:batch.action==="REVERSE"?"movement.reverse":"issue.post",targetType:"reservation",targetId:reservation.id,targetLabel:String(reservation.id),
      beforeSummary:{consumedQuantity:number(reservation.consumed_quantity),outstandingQuantity:number(reservation.outstanding_quantity)},afterSummary:{consumedQuantity:consumed,outstandingQuantity:outstanding,quantity:q,version:member.version,rowCount:member.legs.length},
      operationRequestId:member.operationId,requestId:context.correlationId,correlationId:context.correlationId,ip:""});
  }
}
