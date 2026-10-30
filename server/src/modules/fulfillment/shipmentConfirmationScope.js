import { lockFulfillmentRowsInTransaction } from "./FulfillmentLockService.js";
import { assertClaimQuantities,assertFulfillmentQuantities } from "./fulfillmentQuantityMath.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";

const fail=()=>{throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");};
const key=value=>String(value);
const compare=(a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0;
const sum=(rows,column)=>rows.reduce((total,row)=>total+fulfillmentInteger(key(row[column]),{positive:false}),0n);
export function freezeShipmentIntent(value){if(value&&typeof value==="object"){for(const child of Object.values(value))freezeShipmentIntent(child);Object.freeze(value);}return value;}
function index(rows,column="id"){const result=new Map(rows.map(row=>[key(row[column]),row]));if(result.size!==rows.length)fail();return result;}

export async function readShipmentConfirmationSnapshot(tx,shipmentId,{locked=false,order=null}={}){
 const [[route]]=await tx.query("SELECT * FROM shipments WHERE id=?",[shipmentId]);if(!route)throw fulfillmentError("SHIPMENT_NOT_FOUND");
 const fulfillmentId=key(route.fulfillment_id);let root,lines,claims,allClaims;
 if(locked){
  if(!order||order.orderId!==key(route.sales_order_id))fail();
  [root]=await lockFulfillmentRowsInTransaction(tx,"fulfillments",[fulfillmentId]);if(key(root.sales_order_id)!==order.orderId)fail();
  const [lineIds]=await tx.query("SELECT id FROM fulfillment_lines WHERE fulfillment_id=? ORDER BY id",[fulfillmentId]);lines=await lockFulfillmentRowsInTransaction(tx,"fulfillment_lines",lineIds.map(row=>row.id));
  const [claimIds]=await tx.query("SELECT id FROM fulfillment_line_reservation_claims WHERE fulfillment_id=? ORDER BY id",[fulfillmentId]);claims=await lockFulfillmentRowsInTransaction(tx,"fulfillment_line_reservation_claims",claimIds.map(row=>row.id));
  // All Claim writers take this held Sales root first; sibling Draft Shipment inserts must retain their own root.
  [allClaims]=await tx.query("SELECT c.* FROM fulfillment_line_reservation_claims c JOIN fulfillments f ON f.id=c.fulfillment_id WHERE f.sales_order_id=? ORDER BY c.id",[order.orderId]);
 }else{
  [[root]]=await tx.query("SELECT * FROM fulfillments WHERE id=?",[fulfillmentId]);
  [lines]=await tx.query("SELECT * FROM fulfillment_lines WHERE fulfillment_id=? ORDER BY id",[fulfillmentId]);
  [claims]=await tx.query("SELECT * FROM fulfillment_line_reservation_claims WHERE fulfillment_id=? ORDER BY id",[fulfillmentId]);allClaims=claims;
 }
 const [active]=await tx.query("SELECT * FROM fulfillment_allocations WHERE fulfillment_id=? AND allocated_base_quantity>released_base_quantity ORDER BY id LIMIT 5001",[fulfillmentId]);if(active.length>5000)fail();
 const allocations=locked?await lockFulfillmentRowsInTransaction(tx,"fulfillment_allocations",active.map(row=>row.id)):active;
 const shipment=locked?(await lockFulfillmentRowsInTransaction(tx,"shipments",[shipmentId]))[0]:route;
 const [childIds]=await tx.query("SELECT id FROM shipment_lines WHERE shipment_id=? ORDER BY id",[shipmentId]);
 const shipmentLines=locked?await lockFulfillmentRowsInTransaction(tx,"shipment_lines",childIds.map(row=>row.id)):(await tx.query("SELECT * FROM shipment_lines WHERE shipment_id=? ORDER BY id",[shipmentId]))[0];
 const [totals]=await tx.query("SELECT fulfillment_line_id,SUM(allocated_base_quantity) AS allocated,SUM(released_base_quantity) AS released,SUM(picked_base_quantity) AS picked FROM fulfillment_allocations WHERE fulfillment_id=? GROUP BY fulfillment_line_id",[fulfillmentId]);
 return {root,lines,claims,allocations,shipment,shipmentLines,totals,allClaims};
}

export function assertShipmentConfirmationSnapshot(snapshot,eventId){
 const {root,lines,claims,allocations,shipment,shipmentLines,totals}=snapshot;
 if(!root||root.status!=="PICKED"||shipment.status!=="SHIPPING"||shipment.confirmation_event_id!==eventId||key(root.active_shipment_id)!==key(shipment.id)||key(shipment.fulfillment_id)!==key(root.id)||key(shipment.sales_order_id)!==key(root.sales_order_id)||key(shipment.customer_id)!==key(root.customer_id)||key(shipment.warehouse_id)!==key(root.warehouse_id))fail();
 if(!lines.length||lines.length>100||lines.length!==Number(root.line_count)||lines.length!==Number(shipment.line_count)||shipmentLines.length!==lines.length||totals.length!==lines.length||!claims.length||claims.length>5000||!allocations.length||allocations.length>5000)fail();
 const byLine=index(lines),byClaim=index(claims),byShipmentLine=index(shipmentLines,"fulfillment_line_id"),byTotal=index(totals,"fulfillment_line_id");index(claims,"inventory_reservation_id");index(allocations,"inventory_allocation_id");
 for(const claim of claims){if(key(claim.fulfillment_id)!==key(root.id)||!byLine.has(key(claim.fulfillment_line_id))||BigInt(claim.consumed_quantity)!==0n||BigInt(claim.reversed_quantity)!==0n)fail();assertClaimQuantities({original:key(claim.original_claimed_quantity),active:key(claim.active_claimed_quantity),released:key(claim.released_quantity),consumed:key(claim.consumed_quantity),reversed:key(claim.reversed_quantity)});if((BigInt(claim.active_claimed_quantity)>0n?"ACTIVE":"RELEASED")!==claim.status)fail();}
 for(const allocation of allocations){const claim=byClaim.get(key(allocation.claim_id));if(!claim||key(allocation.fulfillment_id)!==key(root.id)||key(allocation.fulfillment_line_id)!==key(claim.fulfillment_line_id)||key(allocation.inventory_reservation_id)!==key(claim.inventory_reservation_id)||key(allocation.warehouse_id)!==key(root.warehouse_id)||!["ACTIVE","PARTIALLY_RELEASED"].includes(allocation.status)||BigInt(allocation.picked_base_quantity)<=0n||BigInt(allocation.allocated_base_quantity)-BigInt(allocation.released_base_quantity)!==BigInt(allocation.picked_base_quantity))fail();}
 assertFulfillmentQuantities("PICKED",lines.map(line=>{
  const id=key(line.id),child=byShipmentLine.get(id),members=claims.filter(row=>key(row.fulfillment_line_id)===id),legs=allocations.filter(row=>key(row.fulfillment_line_id)===id),total=byTotal.get(id);
  if(!child||!total||!members.length||members.length>50||legs.length>50||key(line.fulfillment_id)!==key(root.id)||key(line.sales_order_id)!==key(root.sales_order_id)||key(child.shipment_id)!==key(shipment.id)||key(child.fulfillment_id)!==key(root.id)||key(child.sales_order_line_id)!==key(line.sales_order_line_id)||key(child.sku_id)!==key(line.sku_id)||key(child.base_uom_id)!==key(line.base_uom_id)||key(child.shipped_base_quantity)!==key(line.picked_base_quantity)||BigInt(child.reversed_base_quantity)!==0n||key(total.allocated)!==key(line.allocated_base_quantity)||key(total.picked)!==key(line.picked_base_quantity)||sum(members,"original_claimed_quantity")!==BigInt(line.planned_base_quantity)||sum(members,"active_claimed_quantity")!==BigInt(line.picked_base_quantity)||sum(members,"released_quantity")!==BigInt(line.short_base_quantity)||sum(legs,"picked_base_quantity")!==BigInt(line.picked_base_quantity))fail();
  for(const member of members)if(sum(legs.filter(row=>key(row.claim_id)===key(member.id)),"picked_base_quantity")!==BigInt(member.active_claimed_quantity))fail();
  return {planned:key(line.planned_base_quantity),allocated:key(line.allocated_base_quantity),released:key(total.released),picked:key(line.picked_base_quantity),short:key(line.short_base_quantity),shipped:key(line.shipped_base_quantity),reversed:key(line.reversed_base_quantity)};
 }));return snapshot;
}

export function shipmentConfirmationSnapshotIdentity(snapshot){const {allClaims:_allClaims,...own}=snapshot;return JSON.stringify(own);}
export function shipmentIssuePayload(snapshot,owner){
 const {root,lines,claims,allocations}=snapshot;if(owner?.fulfillmentId!==key(root.id)||!Array.isArray(owner.allocations)||owner.allocations.length!==allocations.length||!Array.isArray(owner.reservationFacts))fail();
 const actual=index(owner.allocations,"inventoryAllocationId"),reservations=index(owner.reservationFacts,"inventoryReservationId"),used=new Set();
 const output=lines.map(line=>({fulfillmentLineId:key(line.id),salesOrderLineId:key(line.sales_order_line_id),baseQuantity:key(line.picked_base_quantity),reservations:claims.filter(claim=>key(claim.fulfillment_line_id)===key(line.id)&&BigInt(claim.active_claimed_quantity)>0n).map(claim=>{
  const reservation=reservations.get(key(claim.inventory_reservation_id));if(!reservation||used.has(reservation.inventoryReservationId)||reservation.salesOrderId!==key(root.sales_order_id)||reservation.salesOrderLineId!==key(line.sales_order_line_id)||reservation.skuId!==key(line.sku_id)||reservation.warehouseId!==key(root.warehouse_id)||reservation.version<Number(claim.inventory_version)||BigInt(reservation.outstandingQuantity)<BigInt(claim.active_claimed_quantity))fail();used.add(reservation.inventoryReservationId);
  return {claimId:key(claim.id),inventoryReservationId:reservation.inventoryReservationId,expectedVersion:reservation.version,baseQuantity:key(claim.active_claimed_quantity),allocations:allocations.filter(row=>key(row.claim_id)===key(claim.id)).map(row=>{
   const member=actual.get(key(row.inventory_allocation_id));if(!member||member.claimId!==key(claim.id)||member.fulfillmentLineId!==key(line.id)||member.salesOrderLineId!==key(line.sales_order_line_id)||member.inventoryReservationId!==reservation.inventoryReservationId||member.inventoryBalanceId!==key(row.inventory_balance_id)||member.warehouseId!==key(root.warehouse_id)||member.skuId!==key(line.sku_id)||!["ACTIVE","PARTIALLY_CONSUMED"].includes(member.status)||member.version!==Number(row.inventory_version)||member.balanceVersion<Number(row.balance_version)||member.outstandingQuantity!==key(row.picked_base_quantity)||member.allocatedQuantity!==key(row.allocated_base_quantity)||member.releasedQuantity!==key(row.released_base_quantity)||member.consumedQuantity!=="0")fail();
   return {inventoryAllocationId:member.inventoryAllocationId,inventoryBalanceId:member.inventoryBalanceId,expectedVersion:member.version,expectedBalanceVersion:member.balanceVersion,baseQuantity:member.outstandingQuantity};
  }).sort((a,b)=>compare(a.inventoryAllocationId,b.inventoryAllocationId))};
 }).sort((a,b)=>compare(a.inventoryReservationId,b.inventoryReservationId))})).sort((a,b)=>compare(a.salesOrderLineId,b.salesOrderLineId));
 if(used.size!==reservations.size)fail();
 return freezeShipmentIntent({fulfillmentId:key(root.id),shipmentId:key(snapshot.shipment.id),lines:output});
}

export function shipmentSalesIntent(snapshot,order,command,proof){
 if(order.orderId!==key(snapshot.root.sales_order_id)||order.customer.id!==key(snapshot.root.customer_id)||order.warehouse.id!==key(snapshot.root.warehouse_id))fail();
 return freezeShipmentIntent({actor:{...command.actor,userId:String(command.actor.userId)},purpose:"SHIPMENT_CONFIRMED",salesOrderId:order.orderId,expectedOrderVersion:order.version,eventId:command.source.eventId,shipmentId:key(snapshot.shipment.id),inventoryRequestHash:proof.requestHash,lines:command.payload.lines.map(line=>{
  const source=order.lines.find(row=>row.lineId===line.salesOrderLineId),local=snapshot.lines.find(row=>key(row.id)===line.fulfillmentLineId);if(!source||source.skuId!==key(local.sku_id)||source.baseUomId!==key(local.base_uom_id))fail();
  return {salesOrderLineId:source.lineId,expectedVersion:source.version,baseQuantity:line.baseQuantity,reservations:line.reservations.map(member=>{const claim=snapshot.claims.find(row=>key(row.id)===member.claimId),mapping=source.reservationMappings.find(row=>row.inventoryReservationId===member.inventoryReservationId);if(!mapping||mapping.salesReservationMappingId!==key(claim.sales_order_line_reservation_id)||mapping.inventoryVersion>member.expectedVersion||BigInt(mapping.outstandingBaseQuantity)<BigInt(member.baseQuantity))fail();return {claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,expectedVersion:member.expectedVersion,baseQuantity:member.baseQuantity};})};
 })});
}
