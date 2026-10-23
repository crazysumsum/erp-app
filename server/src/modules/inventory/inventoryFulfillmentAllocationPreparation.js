import { loadInventoryCandidates } from "./InventoryPickSequenceService.js";
import { assessFulfillmentAllocationSelection } from "./inventoryFulfillmentAllocation.js";
import { fulfillmentInventoryFields,fulfillmentInventoryId,normalizeFulfillmentInventoryBatch } from "./inventoryFulfillmentValidation.js";
import { inventoryError } from "./inventoryErrors.js";
import { number } from "./inventoryFulfillmentStock.js";
const fail=(code="INVENTORY_INPUT_INVALID")=>{throw inventoryError(code);};
function freeze(value){if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
// Inventory-owned virtual availability follows actual selections, not suggested ones.
function virtualPages(used,cache){return async(tx,query)=>{
 const result=[],seen=new Set();let physicalOffset=0,rank=0;
 while(result.length<query.limit){
  const key=JSON.stringify([query.warehouseId,query.skuId,query.currentDate,query.minimumRemainingDays,query.trackingPolicy,physicalOffset]);
  let rows=cache.get(key);if(!rows){rows=await loadInventoryCandidates(tx,{...query,limit:100,offset:physicalOffset});cache.set(key,rows);}
  for(const row of rows){
   const id=String(row.id);if(seen.has(id))fail("INVENTORY_DEPENDENCY_UNAVAILABLE");seen.add(id);
   const freeQuantity=row.freeQuantity-(used.get(id)??0);if(freeQuantity<0)fail("VERSION_CONFLICT");if(freeQuantity===0)continue;
   if(rank++>=query.offset&&result.length<query.limit)result.push({...row,freeQuantity});
  }
  if(rows.length<100)break;physicalOffset+=rows.length;if(!Number.isSafeInteger(physicalOffset))fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
 }
 return result;
};}
export async function prepareFulfillmentAllocation(tx,query,{inventory,time,actor}) {
 fulfillmentInventoryFields(query,["fulfillmentId","salesOrderId","warehouseId","lines"]);
 const fulfillmentId=fulfillmentInventoryId(query.fulfillmentId),salesOrderId=fulfillmentInventoryId(query.salesOrderId),warehouseId=fulfillmentInventoryId(query.warehouseId);
 if(!Array.isArray(query.lines)||!query.lines.length||query.lines.length>100)fail();
 const selected=[];
 for(const line of query.lines){
  fulfillmentInventoryFields(line,["fulfillmentLineId","salesOrderLineId","skuId","baseQuantity","overrideReason","reservations"]);
  for(const key of ["fulfillmentLineId","salesOrderLineId","skuId","baseQuantity"])fulfillmentInventoryId(line[key]);
  if(typeof line.overrideReason!=="string"||[...line.overrideReason].length>500||/[\p{Cc}\p{Cf}]/u.test(line.overrideReason)||!Array.isArray(line.reservations)||!line.reservations.length||line.reservations.length>50)fail();
  for(const member of line.reservations){fulfillmentInventoryFields(member,["claimId","inventoryReservationId","baseQuantity","allocations"]);for(const key of ["claimId","inventoryReservationId","baseQuantity"])fulfillmentInventoryId(member[key]);selected.push({line,member});}
 }
 if(selected.length>5000||new Set(selected.map(entry=>entry.member.inventoryReservationId)).size!==selected.length)fail();
 const ids=selected.map(entry=>entry.member.inventoryReservationId),[rows]=await tx.query(`SELECT r.*,o.source_module,o.source_document_type,o.source_document_id,o.source_line_id,o.source_event_id FROM inventory_reservations r JOIN inventory_operation_requests o ON o.id=r.create_operation_id WHERE r.id IN (${ids.map(()=>"?").join(",")}) ORDER BY r.id`,ids);
 const reservations=new Map(rows.map(row=>[String(row.id),row]));if(rows.length!==ids.length||reservations.size!==ids.length)fail("INVENTORY_RESOURCE_NOT_FOUND");
 for(const {line,member}of selected){
  const row=reservations.get(member.inventoryReservationId);
  if(!row||String(row.warehouse_id)!==warehouseId||String(row.sku_id)!==line.skuId||row.purpose!=="SALE"||row.source_module!=="SALES"||row.source_document_type!=="SALES_ORDER"||row.source_document_id!==salesOrderId||row.source_line_id!==line.salesOrderLineId)fail("INVENTORY_SOURCE_CONFLICT");
  for(const key of ["original_quantity","consumed_quantity","released_quantity","outstanding_quantity"])number(row[key]);
  if(!["ACTIVE","PARTIALLY_CONSUMED"].includes(row.status)||BigInt(row.original_quantity)!==BigInt(row.consumed_quantity)+BigInt(row.released_quantity)+BigInt(row.outstanding_quantity)||BigInt(row.outstanding_quantity)<BigInt(member.baseQuantity))fail("RESERVATION_STATE_CONFLICT");
 }
 const profiles=await inventory.itemLookup.findManyByIds([...new Set(rows.map(row=>Number(row.sku_id)))],{purpose:"inventory",atMs:time.nowMs()});
 for(const row of rows){const profile=profiles.get(Number(row.sku_id));if(!profile||!profile.usable||!profile.inventoryTracked)fail("INVENTORY_RESOURCE_NOT_FOUND");if(profile.trackingPolicy==="serial")fail("SERIAL_TRACKING_UNSUPPORTED");}
 const payload=normalizeFulfillmentInventoryBatch("ALLOCATE",{fulfillmentId,lines:query.lines.map(line=>({fulfillmentLineId:line.fulfillmentLineId,salesOrderLineId:line.salesOrderLineId,baseQuantity:line.baseQuantity,reservations:line.reservations.map(member=>({...member,expectedVersion:number(reservations.get(member.inventoryReservationId).version),overrideReason:""})).sort((a,b)=>Number(a.inventoryReservationId)-Number(b.inventoryReservationId))})).sort((a,b)=>Number(a.salesOrderLineId)-Number(b.salesOrderLineId))});
 const used=new Map(),cache=new Map(),readPage=virtualPages(used,cache),lineOverrides=new Set();
 const members=payload.lines.flatMap(line=>line.reservations.map(input=>({line,input,reservation:reservations.get(input.inventoryReservationId)}))).sort((a,b)=>Number(a.line.fulfillmentLineId)-Number(b.line.fulfillmentLineId)||Number(a.input.inventoryReservationId)-Number(b.input.inventoryReservationId));
 for(const member of members){
  member.legs=member.input.allocations.map(input=>({kind:"ALLOCATE",input}));
  const recommendation=await assessFulfillmentAllocationSelection(tx,{time},member,profiles.get(Number(member.reservation.sku_id)),readPage),reason=query.lines.find(line=>line.fulfillmentLineId===member.line.fulfillmentLineId).overrideReason.trim();
  if(recommendation.differs){if([...reason].length<5)fail(recommendation.fefo?"FEFO_OVERRIDE_REQUIRED":"PICK_SEQUENCE_REASON_REQUIRED");if(recommendation.fefo&&!actor.permissions.includes("inventory.fefo.override"))fail("FEFO_OVERRIDE_DENIED");member.input.overrideReason=reason;lineOverrides.add(member.line.fulfillmentLineId);}
  for(const leg of member.input.allocations){const candidate=recommendation.selected.get(leg.inventoryBalanceId)?.candidate;if(!candidate||candidate.version!==leg.expectedBalanceVersion)fail("VERSION_CONFLICT");if(number(leg.baseQuantity)>candidate.freeQuantity)fail("ALLOCATION_INSUFFICIENT");used.set(leg.inventoryBalanceId,(used.get(leg.inventoryBalanceId)??0)+number(leg.baseQuantity));}
 }
 if(query.lines.some(line=>line.overrideReason.trim()!==""&&!lineOverrides.has(line.fulfillmentLineId)))fail();
 return freeze({payload,reservationFacts:rows.map(row=>({inventoryReservationId:String(row.id),warehouseId,skuId:String(row.sku_id),salesOrderId,salesOrderLineId:row.source_line_id,originalSourceEventId:row.source_event_id,originalQuantity:String(row.original_quantity),consumedQuantity:String(row.consumed_quantity),releasedQuantity:String(row.released_quantity),outstandingQuantity:String(row.outstanding_quantity),version:number(row.version)}))});
}
