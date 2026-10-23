import { inventoryError } from "./inventoryErrors.js";
import { loadInventoryCandidates } from "./InventoryPickSequenceService.js";
import { cas,memberOrder,number,proveOwnedAllocations } from "./inventoryFulfillmentStock.js";

const fail=(code="ALLOCATION_STATE_CONFLICT")=>{throw inventoryError(code);};
const marks=values=>values.map(()=>"?").join(",");
const keyed=rows=>new Map(rows.map(row=>[String(row.id),row]));

export async function assessFulfillmentAllocationSelection(tx,service,member,profile,readPage=loadInventoryCandidates) {
  const requested=new Map(member.legs.filter(leg=>leg.kind==="ALLOCATE").map(leg=>[leg.input.inventoryBalanceId,number(leg.input.baseQuantity)]));
  const selected=new Map();let remaining=number(member.input.baseQuantity),offset=0,rank=0,first=null,differs=false,fefo=false;
  while (true) {
    const page=await readPage(tx,{warehouseId:number(member.reservation.warehouse_id),skuId:number(member.reservation.sku_id),
      currentDate:service.time.fileDate(),minimumRemainingDays:number(member.reservation.minimum_remaining_days),trackingPolicy:profile.trackingPolicy,limit:100,offset});
    for (const candidate of page) {
      rank++;
      const quantity=Math.min(remaining,candidate.freeQuantity),id=String(candidate.id),chosen=requested.get(id)??0;
      if (quantity>0&&!first) first=candidate;
      if (quantity!==chosen) {differs=true;if(quantity>0&&candidate.expiryDate)fefo=true;}
      if (requested.has(id)) selected.set(id,{candidate,rank});
      remaining-=quantity;
    }
    if (remaining===0&&selected.size===requested.size) break;
    if (page.length<100) fail("ALLOCATION_INSUFFICIENT");
    offset+=page.length;
    if(!Number.isSafeInteger(offset))fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
  }
  return {selected,first,differs,fefo};
}

async function selection(tx,service,member,profile) {
  const recommendation=await assessFulfillmentAllocationSelection(tx,service,member,profile);
  const {differs,fefo}=recommendation;
  const reason=member.input.overrideReason;
  if(differs) {
    if([...reason].length<5)fail(fefo?"FEFO_OVERRIDE_REQUIRED":"PICK_SEQUENCE_REASON_REQUIRED");
    if(fefo&&!member.permissions.includes("inventory.fefo.override"))fail("FEFO_OVERRIDE_DENIED");
  } else if(reason!=="")fail("INVENTORY_INPUT_INVALID");
  return recommendation;
}

async function lockAllocationSet(service,tx,batch,context) {
  const reservationIds=batch.members.map(member=>member.input.inventoryReservationId);
  const [scopes]=await tx.query(`SELECT * FROM inventory_reservations WHERE id IN (${marks(reservationIds)}) ORDER BY id`,reservationIds);
  if(scopes.length!==reservationIds.length)fail();
  const create=batch.action!=="RELEASE",profiles=create?await service.itemLookup.getFulfillmentInventoryProfilesInTransaction(tx,[...new Set(scopes.map(r=>String(r.sku_id)))],{atMs:batch.timestamp}):[];
  for(const profile of profiles) {
    if(!profile.inventoryTracked)fail("SKU_NOT_INVENTORY_TRACKED");
    if(profile.trackingPolicy==="serial")fail("SERIAL_TRACKING_UNSUPPORTED");
    if(!profile.usable)fail("INVENTORY_RESOURCE_NOT_FOUND");
  }
  const anchor={warehouseIds:scopes.map(r=>number(r.warehouse_id)),stockControls:scopes.map(r=>({warehouseId:number(r.warehouse_id),skuId:number(r.sku_id)})),now:batch.timestamp};
  const first=await service.locks.lockForCommand(tx,anchor);
  if(first.warehouses.some(w=>w.status!=="ACTIVE"))fail("WAREHOUSE_INVALID");
  const balanceIds=[...new Set(batch.members.flatMap(m=>m.legs.map(leg=>leg.input.inventoryBalanceId)))];
  const [references]=await tx.query(`SELECT b.*,l.normalized_lot_number FROM inventory_stock_balances b
    LEFT JOIN inventory_lots l ON l.id=b.lot_id WHERE b.id IN (${marks(balanceIds)}) ORDER BY b.id`,balanceIds);
  if(references.length!==balanceIds.length)fail();
  const referenceById=keyed(references),scopeById=keyed(scopes);
  for(const member of batch.members)for(const leg of member.legs) {
    const b=referenceById.get(leg.input.inventoryBalanceId),r=scopeById.get(member.input.inventoryReservationId);
    if(!b||String(b.warehouse_id)!==String(r.warehouse_id)||String(b.sku_id)!==String(r.sku_id))fail();
  }
  const locked=await service.locks.lockForCommand(tx,{...anchor,binIds:references.map(b=>number(b.bin_id)),
    lots:references.filter(b=>b.lot_id!==null).map(b=>({skuId:number(b.sku_id),normalizedLotNumber:b.normalized_lot_number})),
    balances:references.map(b=>({warehouseId:number(b.warehouse_id),skuId:number(b.sku_id),binId:number(b.bin_id),lotId:b.lot_id===null?null:number(b.lot_id),stockStatus:b.stock_status})),
    reservationIds:reservationIds.map(Number)});
  if(locked.binLocks.length)fail("BIN_LOCKED_BY_STOCKTAKE");
  const oldIds=batch.members.flatMap(m=>m.legs.filter(l=>l.kind==="RELEASE").map(l=>l.input.inventoryAllocationId));
  const [old]=oldIds.length?await tx.query(`SELECT * FROM inventory_allocations WHERE id IN (${marks(oldIds)}) ORDER BY id FOR UPDATE`,oldIds):[[]];
  const owned=await proveOwnedAllocations(tx,batch,old),allocations=keyed(old),reservations=keyed(locked.reservations),balances=keyed(locked.balances),bins=keyed(locked.bins),warehouses=keyed(locked.warehouses);
  if(owned.size!==oldIds.length)fail();
  const [totals]=await tx.query(`SELECT reservation_id,SUM(outstanding_quantity) AS outstanding FROM inventory_allocations
    WHERE reservation_id IN (${marks(reservationIds)}) GROUP BY reservation_id`,reservationIds);
  const allocated=new Map(totals.map(row=>[String(row.reservation_id),number(row.outstanding)]));
  const [lotRows]=await tx.query(`SELECT l.id,l.sku_id,l.lot_number,DATE_FORMAT(l.expiry_date,'%Y-%m-%d') AS expiry_date
    FROM inventory_lots l WHERE l.id IN (SELECT lot_id FROM inventory_stock_balances WHERE id IN (${marks(balanceIds)}))`,balanceIds);
  const lots=keyed(lotRows),controlTotals=new Map();
  for(const member of batch.members) {
    const r=reservations.get(member.input.inventoryReservationId),scope=scopeById.get(member.input.inventoryReservationId);
    if(!r||String(r.warehouse_id)!==String(scope.warehouse_id)||String(r.sku_id)!==String(scope.sku_id)||number(r.version)!==member.input.expectedVersion)fail("VERSION_CONFLICT");
    for(const key of ["original_quantity","consumed_quantity","released_quantity","outstanding_quantity"])number(r[key]);
    if(!["ACTIVE","PARTIALLY_CONSUMED"].includes(r.status)||BigInt(r.original_quantity)!==BigInt(r.consumed_quantity)+BigInt(r.released_quantity)+BigInt(r.outstanding_quantity))fail("RESERVATION_STATE_CONFLICT");
    const released=member.legs.filter(l=>l.kind==="RELEASE").reduce((sum,l)=>sum+BigInt(l.input.baseQuantity),0n);
    if(create&&BigInt(r.outstanding_quantity)-BigInt(allocated.get(String(r.id))??0)+released<BigInt(member.input.baseQuantity))fail("ALLOCATION_INSUFFICIENT");
    member.reservation=r;member.permissions=context.permissions;member.profile=profiles.find(p=>p.skuId===String(r.sku_id));
    const control=locked.stockControls.find(c=>String(c.warehouse_id)===String(r.warehouse_id)&&String(c.sku_id)===String(r.sku_id));
    if(!control)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
    const total=(controlTotals.get(String(control.id))??0n)+BigInt(r.outstanding_quantity);controlTotals.set(String(control.id),total);
    if(BigInt(number(control.reserved_quantity))<total)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
    for(const leg of member.legs) {
      const b=balances.get(leg.input.inventoryBalanceId),bin=b&&bins.get(String(b.bin_id)),warehouse=warehouses.get(String(r.warehouse_id));
      if(!b||!bin||!warehouse||String(b.warehouse_id)!==String(r.warehouse_id)||String(b.sku_id)!==String(r.sku_id)||String(bin.warehouse_id)!==String(r.warehouse_id))fail();
      if(number(b.version)!==leg.input.expectedBalanceVersion)fail("VERSION_CONFLICT");
      number(b.on_hand_quantity);number(b.allocated_quantity);
      leg.balance=b;leg.bin=bin;leg.warehouse=warehouse;leg.lot=b.lot_id===null?null:lots.get(String(b.lot_id));
      if(b.lot_id!==null&&(!leg.lot||String(leg.lot.sku_id)!==String(r.sku_id)))fail();
      if(leg.kind==="RELEASE") {
        const a=allocations.get(leg.input.inventoryAllocationId),proof=owned.get(leg.input.inventoryAllocationId);
        if(!a||!proof||proof.claimId!==member.input.claimId||proof.fulfillmentLineId!==member.line.fulfillmentLineId||proof.salesOrderLineId!==member.line.salesOrderLineId||
            String(a.reservation_id)!==String(r.id)||String(a.stock_balance_id)!==String(b.id))fail();
        for(const key of ["allocated_quantity","consumed_quantity","released_quantity","outstanding_quantity"])number(a[key]);
        if(number(a.version)!==leg.input.expectedVersion)fail("VERSION_CONFLICT");
        if(!["ACTIVE","PARTIALLY_CONSUMED"].includes(a.status)||BigInt(a.allocated_quantity)!==BigInt(a.consumed_quantity)+BigInt(a.released_quantity)+BigInt(a.outstanding_quantity)||BigInt(a.outstanding_quantity)<BigInt(leg.input.baseQuantity))fail();
        leg.allocation=a;
      }
    }
  }
}

function audit(audits,batch,context,member,leg,action,beforeSummary,afterSummary,reasonText="") {
  return audits.record({actorUserId:context.actor.userId,actorLabel:context.actorLabel,action,targetType:"allocation",targetId:leg.result.inventoryAllocationId,targetLabel:leg.result.inventoryAllocationId,
    beforeSummary,afterSummary,reasonText,operationRequestId:member.operationId,requestId:context.correlationId,correlationId:context.correlationId,ip:""});
}

export async function postFulfillmentAllocationBatch(service,tx,batch,context) {
  await lockAllocationSet(service,tx,batch,context);
  const members=[...batch.members].sort(memberOrder),audits=service.audit.createSucceededBatch(tx);
  for(const member of members)for(const leg of member.legs.filter(l=>l.kind==="RELEASE")) {
    const b=leg.balance,a=leg.allocation,q=number(leg.input.baseQuantity),before=number(b.allocated_quantity),after=before-q;
    if(after<0)fail("ALLOCATION_INSUFFICIENT");
    const released=number(a.released_quantity)+q,outstanding=number(a.outstanding_quantity)-q,status=outstanding===0?"RELEASED":number(a.consumed_quantity)>0?"PARTIALLY_CONSUMED":"ACTIVE";
    await cas(tx,"UPDATE inventory_stock_balances SET allocated_quantity=?,version=version+1,updated_at=? WHERE id=? AND version=?",[after,batch.timestamp,b.id,b.version]);
    await cas(tx,"UPDATE inventory_allocations SET released_quantity=?,outstanding_quantity=?,status=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?",[released,outstanding,status,batch.timestamp,context.actor.userId,a.id,a.version]);
    leg.result={inventoryAllocationId:String(a.id),inventoryBalanceId:String(b.id),baseQuantity:leg.input.baseQuantity,allocationVersion:number(a.version)+1,balanceVersion:number(b.version)+1,status,releasedQuantity:String(released),outstandingQuantity:String(outstanding)};
    Object.assign(b,{allocated_quantity:after,version:number(b.version)+1});Object.assign(a,{released_quantity:released,outstanding_quantity:outstanding,status,version:number(a.version)+1});
    await audit(audits,batch,context,member,leg,batch.action==="REALLOCATE"?"allocation.reallocate":"allocation.release",{allocatedQuantity:before},{allocatedQuantity:after,releasedQuantity:released,outstandingQuantity:outstanding,status,version:number(a.version)});
  }
  for(const member of members) {
    if(batch.action!=="RELEASE") {
      const recommendation=await selection(tx,service,member,member.profile);
      for(const leg of member.legs.filter(l=>l.kind==="ALLOCATE")) {
        const {candidate,rank}=recommendation.selected.get(leg.input.inventoryBalanceId),b=leg.balance,q=number(leg.input.baseQuantity),before=number(b.allocated_quantity),after=before+q;
        if(!Number.isSafeInteger(after)||after>number(b.on_hand_quantity)||String(candidate.binId)!==String(b.bin_id)||String(candidate.lotId)!==String(b.lot_id)||b.stock_status!=="AVAILABLE"||leg.bin.status!=="ACTIVE")fail("ALLOCATION_INSUFFICIENT");
        const summary=recommendation.differs?{recommendedBalanceId:String(recommendation.first.id),recommendedExpiryDate:recommendation.first.expiryDate,selectedBalanceId:String(b.id),selectedExpiryDate:candidate.expiryDate}:null;
        await cas(tx,"UPDATE inventory_stock_balances SET allocated_quantity=?,version=version+1,updated_at=? WHERE id=? AND version=?",[after,batch.timestamp,b.id,b.version]);
        const strategy=candidate.expiryDate?"FEFO":"FIFO";
        const [inserted]=await tx.execute(`INSERT INTO inventory_allocations(create_operation_id,reservation_id,stock_balance_id,allocated_quantity,outstanding_quantity,selection_strategy,is_sequence_override,recommended_rank_snapshot,recommended_summary,override_reason,status,created_at,updated_at,created_by,updated_by)
          VALUES(?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,?,?)`,[member.operationId,member.reservation.id,b.id,q,q,strategy,recommendation.differs?1:0,rank,summary?JSON.stringify(summary):null,member.input.overrideReason,batch.timestamp,batch.timestamp,context.actor.userId,context.actor.userId]);
        const profile=member.profile;
        const bucket={warehouseId:String(leg.warehouse.id),warehouseCode:leg.warehouse.warehouse_code,binId:String(leg.bin.id),binCode:leg.bin.bin_code,
          lotId:leg.lot?String(leg.lot.id):null,lotNumber:leg.lot?.lot_number??null,expiryDate:leg.lot?.expiry_date??null,stockStatus:b.stock_status,
          skuId:String(b.sku_id),skuCode:profile.skuCode,skuName:profile.skuName,baseUomId:profile.baseUom.uomId,baseUomCode:profile.baseUom.uomCode,postedAt:batch.timestamp};
        leg.result={inventoryAllocationId:String(inserted.insertId),inventoryBalanceId:String(b.id),baseQuantity:leg.input.baseQuantity,allocationVersion:1,balanceVersion:number(b.version)+1,
          selectionStrategy:strategy,isSequenceOverride:recommendation.differs,recommendedRank:rank,bucketSnapshot:JSON.stringify(bucket),recommendedSummary:summary?JSON.stringify(summary):null};
        Object.assign(b,{allocated_quantity:after,version:number(b.version)+1});
        await audit(audits,batch,context,member,leg,batch.action==="REALLOCATE"?"allocation.reallocate":"allocation.create",{allocatedQuantity:before},{allocatedQuantity:after,selectionStrategy:strategy,isSequenceOverride:recommendation.differs,...(summary??{})},member.input.overrideReason);
        if(recommendation.fefo)await audit(audits,batch,context,member,leg,"fefo.override",{recommendedBalanceId:summary.recommendedBalanceId},{...summary,quantity:q},member.input.overrideReason);
      }
    }
    await cas(tx,"UPDATE inventory_reservations SET version=version+1,updated_at=?,updated_by=? WHERE id=? AND version=?",[batch.timestamp,context.actor.userId,member.reservation.id,member.reservation.version]);
    member.version=number(member.reservation.version)+1;
  }
  await audits.flush();
}
