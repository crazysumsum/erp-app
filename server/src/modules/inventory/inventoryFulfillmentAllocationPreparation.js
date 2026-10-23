import { ItemLookupService } from "../item/ItemLookupService.js";
import { loadInventoryCandidates,loadFulfillmentReallocationCandidates } from "./InventoryPickSequenceService.js";
import { assessFulfillmentAllocationSelection } from "./inventoryFulfillmentAllocation.js";
import { fulfillmentInventoryFields,fulfillmentInventoryId,fulfillmentInventoryVersion,normalizeFulfillmentInventoryBatch } from "./inventoryFulfillmentValidation.js";
import { inventoryError } from "./inventoryErrors.js";
import { number,proveOwnedAllocations } from "./inventoryFulfillmentStock.js";
const fail=(code="INVENTORY_INPUT_INVALID")=>{throw inventoryError(code);};
function freeze(value){if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
// Inventory-owned virtual availability follows actual selections, not suggested ones.
function virtualPages(used,cache,load=loadInventoryCandidates){return async(tx,query)=>{
 const result=[],seen=new Set();let physicalOffset=0,rank=0;
 while(result.length<query.limit){
  const key=JSON.stringify([query.warehouseId,query.skuId,query.currentDate,query.minimumRemainingDays,query.trackingPolicy,physicalOffset]);
  let rows=cache.get(key);if(!rows){rows=await load(tx,{...query,limit:100,offset:physicalOffset});cache.set(key,rows);}
  for(const row of rows){
   const id=String(row.id);if(seen.has(id))fail("INVENTORY_DEPENDENCY_UNAVAILABLE");seen.add(id);
   const freeQuantity=row.freeQuantity-(used.get(id)??0);if(freeQuantity<0)fail("VERSION_CONFLICT");if(freeQuantity===0)continue;
   if(rank++>=query.offset&&result.length<query.limit)result.push({...row,freeQuantity});
  }
  if(rows.length<100)break;physicalOffset+=rows.length;if(!Number.isSafeInteger(physicalOffset))fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
 }
 return result;
};}
async function prepareSelection(tx,query,{inventory,time,actor},releaseContext=null) {
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
 const profiles=await new ItemLookupService({database:tx,time,logger:inventory.itemLookup.logger}).findManyByIds([...new Set(rows.map(row=>Number(row.sku_id)))],{purpose:"inventory",atMs:time.nowMs()});
 for(const row of rows){const profile=profiles.get(Number(row.sku_id));if(!profile||!profile.usable||!profile.inventoryTracked)fail("INVENTORY_RESOURCE_NOT_FOUND");if(profile.trackingPolicy==="serial")fail("SERIAL_TRACKING_UNSUPPORTED");}
 const payload=normalizeFulfillmentInventoryBatch(releaseContext?"REALLOCATE":"ALLOCATE",{fulfillmentId,lines:query.lines.map(line=>({fulfillmentLineId:line.fulfillmentLineId,salesOrderLineId:line.salesOrderLineId,baseQuantity:line.baseQuantity,reservations:line.reservations.map(member=>({...member,expectedVersion:number(reservations.get(member.inventoryReservationId).version),overrideReason:"",...(releaseContext?{releases:releaseContext.byReservation.get(member.inventoryReservationId)}:{})})).sort((a,b)=>Number(a.inventoryReservationId)-Number(b.inventoryReservationId))})).sort((a,b)=>Number(a.salesOrderLineId)-Number(b.salesOrderLineId))});
 const used=new Map(),cache=new Map(),readPage=virtualPages(used,cache,releaseContext?.load??loadInventoryCandidates),lineOverrides=new Set();
 const members=payload.lines.flatMap(line=>line.reservations.map(input=>({line,input,reservation:reservations.get(input.inventoryReservationId)}))).sort((a,b)=>Number(a.line.fulfillmentLineId)-Number(b.line.fulfillmentLineId)||Number(a.input.inventoryReservationId)-Number(b.input.inventoryReservationId));
 for(const member of members){
  member.legs=member.input.allocations.map(input=>({kind:"ALLOCATE",input}));
  const recommendation=await assessFulfillmentAllocationSelection(tx,{time},member,profiles.get(Number(member.reservation.sku_id)),readPage),reason=query.lines.find(line=>line.fulfillmentLineId===member.line.fulfillmentLineId).overrideReason.trim();
  if(recommendation.differs){if([...reason].length<5)fail(recommendation.fefo?"FEFO_OVERRIDE_REQUIRED":"PICK_SEQUENCE_REASON_REQUIRED");if(recommendation.fefo&&!actor.permissions.includes("inventory.fefo.override"))fail("FEFO_OVERRIDE_DENIED");member.input.overrideReason=reason;lineOverrides.add(member.line.fulfillmentLineId);}
  for(const leg of member.input.allocations){const candidate=recommendation.selected.get(leg.inventoryBalanceId)?.candidate;if(!candidate||candidate.version!==leg.expectedBalanceVersion)fail("VERSION_CONFLICT");if(number(leg.baseQuantity)>candidate.freeQuantity)fail("ALLOCATION_INSUFFICIENT");used.set(leg.inventoryBalanceId,(used.get(leg.inventoryBalanceId)??0)+number(leg.baseQuantity));}
 }
 if(query.lines.some(line=>line.overrideReason.trim()!==""&&!lineOverrides.has(line.fulfillmentLineId)))fail();
 return freeze({...(releaseContext?{releaseFacts:releaseContext.facts}:{}),payload,reservationFacts:rows.map(row=>({inventoryReservationId:String(row.id),warehouseId,skuId:String(row.sku_id),salesOrderId,salesOrderLineId:row.source_line_id,originalSourceEventId:row.source_event_id,originalQuantity:String(row.original_quantity),consumedQuantity:String(row.consumed_quantity),releasedQuantity:String(row.released_quantity),outstandingQuantity:String(row.outstanding_quantity),version:number(row.version)}))});
}

export function prepareFulfillmentAllocation(tx,query,dependencies){return prepareSelection(tx,query,dependencies);}

export async function prepareFulfillmentReallocation(tx,query,dependencies){
 fulfillmentInventoryFields(query,["fulfillmentId","salesOrderId","warehouseId","lines"]);const fulfillmentId=fulfillmentInventoryId(query.fulfillmentId),warehouseId=fulfillmentInventoryId(query.warehouseId),submitted=new Map();
 if(!Array.isArray(query.lines)||!query.lines.length||query.lines.length>100)fail();
 const stripped={...query,lines:query.lines.map(line=>{
  fulfillmentInventoryFields(line,["fulfillmentLineId","salesOrderLineId","skuId","baseQuantity","overrideReason","reservations"]);for(const key of ["fulfillmentLineId","salesOrderLineId","skuId"])fulfillmentInventoryId(line[key]);
  if(!Array.isArray(line.reservations)||!line.reservations.length||line.reservations.length>50)fail();let oldCount=0;
  const reservations=line.reservations.map(member=>{
   fulfillmentInventoryFields(member,["claimId","inventoryReservationId","baseQuantity","allocations","releases"]);for(const key of ["claimId","inventoryReservationId","baseQuantity"])fulfillmentInventoryId(member[key]);
   if(!Array.isArray(member.releases)||!member.releases.length||member.releases.length>50)fail();oldCount+=member.releases.length;
   for(const release of member.releases){fulfillmentInventoryFields(release,["inventoryAllocationId","expectedVersion","baseQuantity"]);const id=fulfillmentInventoryId(release.inventoryAllocationId);fulfillmentInventoryVersion(release.expectedVersion);fulfillmentInventoryId(release.baseQuantity);if(submitted.has(id))fail();submitted.set(id,{release,member,line});}
   const {releases:_releases,...selection}=member;return selection;
  });if(oldCount>50)fail();return {...line,reservations};
 })};if(submitted.size>5000)fail();
 // Enumerate positive own effects independently; malformed/uncompleted dedicated sources cannot vanish.
 const [allocations]=await tx.query(`SELECT a.* FROM inventory_allocations a JOIN inventory_operation_requests o ON o.id=a.create_operation_id
   WHERE o.source_module='FULFILLMENT' AND o.source_document_type='PICK' AND o.source_document_id=? AND a.outstanding_quantity>0 ORDER BY a.id`,[fulfillmentId]);
 const owned=await proveOwnedAllocations(tx,{payload:{fulfillmentId}},allocations);if(owned.size!==allocations.length||owned.size!==submitted.size)fail("ALLOCATION_STATE_CONFLICT");
 const ids=[...new Set(allocations.map(row=>String(row.stock_balance_id)))],[balances]=await tx.query(`SELECT * FROM inventory_stock_balances WHERE id IN (${ids.map(()=>"?").join(",")}) ORDER BY id`,ids),byBalance=new Map(balances.map(row=>[String(row.id),row]));if(balances.length!==ids.length||byBalance.size!==ids.length)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
 const credits=new Map(),byReservation=new Map(),facts=[];
 for(const allocation of allocations){
  const entry=submitted.get(String(allocation.id)),owner=owned.get(String(allocation.id));if(!entry||!owner)fail("ALLOCATION_STATE_CONFLICT");const {line,member,release}=entry,balance=byBalance.get(String(allocation.stock_balance_id));
  if(owner.claimId!==member.claimId||owner.fulfillmentLineId!==line.fulfillmentLineId||owner.salesOrderLineId!==line.salesOrderLineId||String(allocation.reservation_id)!==member.inventoryReservationId||!balance||String(balance.warehouse_id)!==warehouseId||String(balance.sku_id)!==line.skuId)fail("INVENTORY_SOURCE_CONFLICT");
  for(const key of ["allocated_quantity","consumed_quantity","released_quantity","outstanding_quantity"])number(allocation[key]);for(const key of ["on_hand_quantity","allocated_quantity"])number(balance[key]);
  if(!["ACTIVE","PARTIALLY_CONSUMED"].includes(allocation.status)||BigInt(allocation.allocated_quantity)!==BigInt(allocation.consumed_quantity)+BigInt(allocation.released_quantity)+BigInt(allocation.outstanding_quantity)||BigInt(allocation.consumed_quantity)!==0n||String(allocation.outstanding_quantity)!==release.baseQuantity)fail("ALLOCATION_STATE_CONFLICT");
  if(number(allocation.version)!==release.expectedVersion||number(allocation.version)>=4294967295)fail("VERSION_CONFLICT");if(BigInt(balance.allocated_quantity)>BigInt(balance.on_hand_quantity))fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
  const id=String(balance.id);credits.set(id,(credits.get(id)??0n)+BigInt(release.baseQuantity));
  const legs=byReservation.get(member.inventoryReservationId)??[];legs.push({inventoryAllocationId:String(allocation.id),inventoryBalanceId:id,expectedVersion:release.expectedVersion,expectedBalanceVersion:fulfillmentInventoryVersion(number(balance.version)),baseQuantity:release.baseQuantity});byReservation.set(member.inventoryReservationId,legs);
  facts.push({inventoryAllocationId:String(allocation.id),inventoryReservationId:member.inventoryReservationId,claimId:member.claimId,fulfillmentLineId:line.fulfillmentLineId,salesOrderLineId:line.salesOrderLineId,inventoryBalanceId:id,warehouseId,skuId:line.skuId,version:number(allocation.version),status:allocation.status,allocatedQuantity:String(allocation.allocated_quantity),consumedQuantity:String(allocation.consumed_quantity),releasedQuantity:String(allocation.released_quantity),outstandingQuantity:String(allocation.outstanding_quantity),balanceVersion:number(balance.version),physicalFreeQuantity:(BigInt(balance.on_hand_quantity)-BigInt(balance.allocated_quantity)).toString()});
 }
 const bySku=new Map();for(const [id,credit]of credits){const balance=byBalance.get(id);if(credit>BigInt(balance.allocated_quantity))fail("INVENTORY_DEPENDENCY_UNAVAILABLE");const budget=bySku.get(String(balance.sku_id))??new Map();budget.set(id,Number(credit));bySku.set(String(balance.sku_id),budget);}
 for(const line of query.lines)for(const member of line.reservations){const legs=byReservation.get(member.inventoryReservationId);if(!legs||legs.reduce((sum,leg)=>sum+BigInt(leg.baseQuantity),0n)!==BigInt(member.baseQuantity))fail("ALLOCATION_STATE_CONFLICT");legs.sort((a,b)=>Number(a.inventoryAllocationId)-Number(b.inventoryAllocationId));for(const leg of member.allocations){const old=byBalance.get(leg.inventoryBalanceId);if(old&&number(old.version)!==leg.expectedBalanceVersion)fail("VERSION_CONFLICT");}}
 for(const fact of facts){fact.ownReleaseCredit=credits.get(fact.inventoryBalanceId).toString();fact.availableAfterOwnRelease=(BigInt(fact.physicalFreeQuantity)+credits.get(fact.inventoryBalanceId)).toString();}
 const load=(tx,options)=>loadFulfillmentReallocationCandidates(tx,options,bySku.get(String(options.skuId))??new Map());
 return prepareSelection(tx,stripped,dependencies,{byReservation,facts,load});
}

// Called after actual posting while its Warehouse/Reservation/Allocation anchors remain held.
// It independently includes every live own effect, plus the complete submitted historical old set.
export async function readFulfillmentReallocationStates(tx,query){
 fulfillmentInventoryFields(query,["fulfillmentId","previousAllocationIds"]);const fulfillmentId=fulfillmentInventoryId(query.fulfillmentId);
 if(!Array.isArray(query.previousAllocationIds)||!query.previousAllocationIds.length||query.previousAllocationIds.length>5000)fail();const ids=query.previousAllocationIds.map(id=>fulfillmentInventoryId(id));if(new Set(ids).size!==ids.length)fail();
 const [rows]=await tx.query(`SELECT a.* FROM inventory_allocations a JOIN inventory_operation_requests o ON o.id=a.create_operation_id
   WHERE o.source_module='FULFILLMENT' AND o.source_document_type='PICK' AND o.source_document_id=?
     AND (a.outstanding_quantity>0 OR a.id IN (${ids.map(()=>"?").join(",")})) ORDER BY a.id`,[fulfillmentId,...ids]);
 const owned=await proveOwnedAllocations(tx,{payload:{fulfillmentId}},rows),byId=new Map(rows.map(row=>[String(row.id),row]));if(owned.size!==rows.length||ids.some(id=>!byId.has(id)))fail("ALLOCATION_STATE_CONFLICT");
 const balanceIds=[...new Set(rows.map(row=>String(row.stock_balance_id)))],[balances]=await tx.query(`SELECT id,warehouse_id,sku_id,version FROM inventory_stock_balances WHERE id IN (${balanceIds.map(()=>"?").join(",")}) ORDER BY id`,balanceIds),byBalance=new Map(balances.map(row=>[String(row.id),row]));if(balances.length!==balanceIds.length)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
 return freeze({fulfillmentId,allocations:rows.map(row=>{
  const owner=owned.get(String(row.id)),balance=byBalance.get(String(row.stock_balance_id));if(!balance)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
  for(const key of ["allocated_quantity","consumed_quantity","released_quantity","outstanding_quantity"])number(row[key]);if(BigInt(row.allocated_quantity)!==BigInt(row.consumed_quantity)+BigInt(row.released_quantity)+BigInt(row.outstanding_quantity))fail("ALLOCATION_STATE_CONFLICT");
  return {inventoryAllocationId:String(row.id),inventoryReservationId:String(row.reservation_id),claimId:owner.claimId,fulfillmentLineId:owner.fulfillmentLineId,salesOrderLineId:owner.salesOrderLineId,inventoryBalanceId:String(row.stock_balance_id),warehouseId:String(balance.warehouse_id),skuId:String(balance.sku_id),version:fulfillmentInventoryVersion(number(row.version)),balanceVersion:fulfillmentInventoryVersion(number(balance.version)),status:row.status,allocatedQuantity:String(row.allocated_quantity),consumedQuantity:String(row.consumed_quantity),releasedQuantity:String(row.released_quantity),outstandingQuantity:String(row.outstanding_quantity)};
 })});
}
