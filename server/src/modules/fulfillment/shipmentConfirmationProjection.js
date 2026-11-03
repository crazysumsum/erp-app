import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

const fail=()=>{throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");},key=value=>String(value);
const positive=value=>{fulfillmentInteger(value);return value;};
const version=value=>{if(!Number.isSafeInteger(value)||value<1||value>4294967295)fail();return value;};
function fields(value,names){const allowed=names.split(",");if(!value||Object.getPrototypeOf(value)!==Object.prototype||Object.getOwnPropertySymbols(value).length||Object.keys(value).length!==allowed.length||Object.keys(value).some(name=>!allowed.includes(name)))fail();}
export function shipmentIssueProjection(result,payload,proof,snapshot,profiles,at){
 fields(result,"operationId,lines");
 if(!result||result.operationId!==proof.operationId||!Array.isArray(result.lines)||result.lines.length!==payload.lines.length)fail();
 const byAllocation=new Map(snapshot.allocations.map(row=>[key(row.inventory_allocation_id),row])),byLine=new Map(snapshot.shipmentLines.map(row=>[key(row.fulfillment_line_id),row]));
 const members=new Map(),legs=new Map(),movements=new Set(),operationIds=new Set(),balances=new Map(),issues=[];
 for(const [i,line]of payload.lines.entries()){
  const actual=result.lines[i];fields(actual,"fulfillmentLineId,salesOrderLineId,baseQuantity,reservations");if(actual.fulfillmentLineId!==line.fulfillmentLineId||actual.salesOrderLineId!==line.salesOrderLineId||actual.baseQuantity!==line.baseQuantity||!Array.isArray(actual.reservations)||actual.reservations.length!==line.reservations.length)fail();
  for(const [j,member]of line.reservations.entries()){
   const current=actual.reservations[j];fields(current,"claimId,inventoryReservationId,expectedVersion,version,baseQuantity,inventoryOperationId,allocations");if(current.claimId!==member.claimId||current.inventoryReservationId!==member.inventoryReservationId||current.expectedVersion!==member.expectedVersion||version(current.version)!==member.expectedVersion+1||current.baseQuantity!==member.baseQuantity||!Array.isArray(current.allocations)||current.allocations.length!==member.allocations.length||members.has(member.claimId))fail();
   positive(current.inventoryOperationId);if(operationIds.has(current.inventoryOperationId))fail();operationIds.add(current.inventoryOperationId);members.set(member.claimId,current);
   for(const [k,leg]of member.allocations.entries()){
    const output=current.allocations[k],local=byAllocation.get(leg.inventoryAllocationId),bucket=output?.bucketSnapshot,saved=snapshot.lines.find(row=>key(row.id)===line.fulfillmentLineId),profile=profiles.find(row=>row.skuId===key(saved?.sku_id));
    fields(output,"inventoryAllocationId,inventoryBalanceId,baseQuantity,allocationVersion,balanceVersion,movementId,bucketSnapshot");fields(bucket,"warehouseId,warehouseCode,binId,binCode,lotId,lotNumber,expiryDate,stockStatus,skuId,skuCode,skuName,baseUomId,baseUomCode,postedAt");
    if(!local||legs.has(leg.inventoryAllocationId)||output.inventoryAllocationId!==leg.inventoryAllocationId||output.inventoryBalanceId!==leg.inventoryBalanceId||output.baseQuantity!==leg.baseQuantity||version(output.allocationVersion)!==leg.expectedVersion+1||bucket.skuId!==key(saved?.sku_id)||bucket.baseUomId!==key(saved?.base_uom_id)||bucket.warehouseId!==key(snapshot.root.warehouse_id)||bucket.binId!==key(local.bin_id)||bucket.lotId!==(local.lot_id===null?null:key(local.lot_id))||bucket.stockStatus!=="AVAILABLE"||!profile||profile.baseUom.uomId!==bucket.baseUomId||profile.baseUom.uomCode!==bucket.baseUomCode||profile.skuCode!==bucket.skuCode||profile.skuName!==bucket.skuName)fail();
    positive(output.movementId);if(movements.has(output.movementId))fail();movements.add(output.movementId);legs.set(leg.inventoryAllocationId,output);
    const last=balances.get(leg.inventoryBalanceId);if(last!==undefined&&last!==leg.expectedBalanceVersion)fail();balances.set(leg.inventoryBalanceId,leg.expectedBalanceVersion);
    issues.push({shipment_id:key(snapshot.shipment.id),shipment_line_id:key(byLine.get(line.fulfillmentLineId).id),fulfillment_allocation_id:key(local.id),inventory_operation_id:current.inventoryOperationId,inventory_movement_id:output.movementId,inventory_reservation_id:member.inventoryReservationId,inventory_allocation_id:leg.inventoryAllocationId,inventory_balance_id:leg.inventoryBalanceId,warehouse_id:bucket.warehouseId,bin_id:bucket.binId,lot_id:bucket.lotId,warehouse_code_snapshot:bucket.warehouseCode,bin_code_snapshot:bucket.binCode,lot_number_snapshot:bucket.lotNumber??"",expiry_date_snapshot:bucket.expiryDate,stock_status_snapshot:bucket.stockStatus,sku_code_snapshot:bucket.skuCode,base_uom_code_snapshot:bucket.baseUomCode,issued_base_quantity:leg.baseQuantity,created_at:at});
   }
  }
 }
 // Inventory posts by Fulfillment Line, Reservation, then the exact saved leg order.
 const ordered=payload.lines.flatMap(line=>line.reservations.map(member=>({line,member}))).sort((a,b)=>Number(a.line.fulfillmentLineId)-Number(b.line.fulfillmentLineId)||Number(a.member.inventoryReservationId)-Number(b.member.inventoryReservationId));
 for(const {member}of ordered)for(const input of member.allocations){const next=version(balances.get(input.inventoryBalanceId)+1),output=legs.get(input.inventoryAllocationId);if(output.balanceVersion!==next)fail();balances.set(input.inventoryBalanceId,next);}
 if(legs.size!==snapshot.allocations.length||!issues.length||issues.length>5000)fail();return {issues,members,legs,balances};
}

export function assertShipmentSalesProjection(result,intent,before){
 fields(result,"orderId,status,version,lines");
 if(!result||result.orderId!==intent.salesOrderId||result.version!==intent.expectedOrderVersion+1||!["PARTIALLY_FULFILLED","COMPLETED"].includes(result.status)||!Array.isArray(result.lines)||result.lines.length!==intent.lines.length)fail();
 for(const [i,line]of intent.lines.entries()){
  const actual=result.lines[i],source=before.lines.find(row=>row.lineId===line.salesOrderLineId),q=BigInt(line.baseQuantity);fields(actual,"salesOrderLineId,version,orderedBaseQuantity,reservedOutstandingBaseQuantity,backorderedBaseQuantity,fulfilledBaseQuantity,cancelledBaseQuantity");
  if(!actual||!source||actual.salesOrderLineId!==line.salesOrderLineId||actual.version!==line.expectedVersion+(q>0n?1:0)||actual.reservedOutstandingBaseQuantity!==(BigInt(source.reservedOutstandingBaseQuantity)-q).toString()||actual.fulfilledBaseQuantity!==(BigInt(source.fulfilledBaseQuantity)+q).toString()||["orderedBaseQuantity","backorderedBaseQuantity","cancelledBaseQuantity"].some(field=>actual[field]!==source[field]))fail();
 }
}

export async function saveShipmentIssueProjection(tx,snapshot,projection,profiles,at){
 const {root,shipment,claims,allocations,lines,shipmentLines}=snapshot;
 for(let start=0;start<projection.issues.length;start+=100){const rows=projection.issues.slice(start,start+100),columns=Object.keys(rows[0]);await tx.execute(`INSERT INTO shipment_issue_details (${columns.join(",")}) VALUES ${rows.map(()=>`(${columns.map(()=>"?").join(",")})`).join(",")}`,rows.flatMap(row=>columns.map(column=>row[column])));}
 for(let start=0;start<allocations.length;start+=100){const rows=allocations.slice(start,start+100),[changed]=await tx.execute(`UPDATE fulfillment_allocations SET status='CONSUMED',inventory_version=CASE id ${rows.map(()=>"WHEN ? THEN ?").join(" ")} END,balance_version=CASE id ${rows.map(()=>"WHEN ? THEN ?").join(" ")} END,updated_at=? WHERE id IN (${rows.map(()=>"?").join(",")}) AND fulfillment_id=? AND (${rows.map(()=>"(id=? AND inventory_version=? AND balance_version=? AND status=? AND picked_base_quantity=? AND released_base_quantity=?)").join(" OR ")})`,[...rows.flatMap(row=>[row.id,projection.legs.get(key(row.inventory_allocation_id)).allocationVersion]),...rows.flatMap(row=>[row.id,projection.balances.get(key(row.inventory_balance_id))]),at,...rows.map(row=>row.id),root.id,...rows.flatMap(row=>[row.id,Number(row.inventory_version),Number(row.balance_version),row.status,key(row.picked_base_quantity),key(row.released_base_quantity)])]);if(changed.affectedRows!==rows.length)fail();}
 const active=claims.filter(row=>BigInt(row.active_claimed_quantity)>0n);
 for(let start=0;start<active.length;start+=100){const rows=active.slice(start,start+100),[changed]=await tx.execute(`UPDATE fulfillment_line_reservation_claims SET consumed_quantity=active_claimed_quantity,active_claimed_quantity=0,status='CONSUMED',inventory_version=CASE id ${rows.map(()=>"WHEN ? THEN ?").join(" ")} END,updated_at=? WHERE id IN (${rows.map(()=>"?").join(",")}) AND fulfillment_id=? AND (${rows.map(()=>"(id=? AND status='ACTIVE' AND inventory_version=? AND active_claimed_quantity=? AND released_quantity=? AND consumed_quantity=0 AND reversed_quantity=0)").join(" OR ")})`,[...rows.flatMap(row=>[row.id,projection.members.get(key(row.id)).version]),at,...rows.map(row=>row.id),root.id,...rows.flatMap(row=>[row.id,Number(row.inventory_version),key(row.active_claimed_quantity),key(row.released_quantity)])]);if(changed.affectedRows!==rows.length)fail();}
 for(const line of lines){const child=shipmentLines.find(row=>key(row.fulfillment_line_id)===key(line.id)),profile=profiles.find(row=>row.skuId===key(line.sku_id));
  const [changed]=await tx.execute("UPDATE shipment_lines SET sku_code_snapshot=?,sku_name_snapshot=?,base_uom_code_snapshot=?,updated_at=? WHERE id=? AND shipment_id=? AND shipped_base_quantity=? AND reversed_base_quantity=0 AND sku_code_snapshot='' AND sku_name_snapshot='' AND base_uom_code_snapshot=''",[profile.skuCode,profile.skuName,profile.baseUom.uomCode,at,child.id,shipment.id,key(line.picked_base_quantity)]);if(changed.affectedRows!==1)fail();
  const [updated]=await tx.execute("UPDATE fulfillment_lines SET shipped_base_quantity=picked_base_quantity,version=version+1,updated_at=? WHERE id=? AND fulfillment_id=? AND version=? AND picked_base_quantity=? AND shipped_base_quantity=0 AND reversed_base_quantity=0",[at,line.id,root.id,line.version,key(line.picked_base_quantity)]);if(updated.affectedRows!==1)fail();
 }
}
