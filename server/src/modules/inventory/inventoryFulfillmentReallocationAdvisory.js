import {fulfillmentInventoryFields,fulfillmentInventoryId,fulfillmentInventoryVersion} from "./inventoryFulfillmentValidation.js";
import {lockFulfillmentPickScope} from "./inventoryFulfillmentAllocationPreparation.js";
import {loadFulfillmentReallocationCandidates} from "./InventoryPickSequenceService.js";
import {readFulfillmentBatchCandidates} from "./inventoryFulfillmentCandidateAdvisory.js";
import {inventoryError} from "./inventoryErrors.js";
import {number} from "./inventoryFulfillmentStock.js";
const fail=(code="INVENTORY_INPUT_INVALID")=>{throw inventoryError(code);};
const freeze=value=>{if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

export function normalizeReallocationAdvisoryQuery(input){
 fulfillmentInventoryFields(input,["fulfillmentId","salesOrderId","warehouseId","lines","page","asOf"]);
 const fulfillmentId=fulfillmentInventoryId(input.fulfillmentId),salesOrderId=fulfillmentInventoryId(input.salesOrderId),warehouseId=fulfillmentInventoryId(input.warehouseId),page=input.page,asOf=input.asOf;
 if(!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(page*100)||!Number.isSafeInteger(asOf)||asOf<0||!Array.isArray(input.lines)||!input.lines.length||input.lines.length>100)fail();
 const lineIds=new Set(),salesLineIds=new Set(),claimIds=new Set(),reservationIds=new Set(),allocationIds=new Set();
 const lines=input.lines.map(line=>{
  fulfillmentInventoryFields(line,["fulfillmentLineId","salesOrderLineId","skuId","baseQuantity","reservations"]);
  const result=Object.fromEntries(["fulfillmentLineId","salesOrderLineId","skuId","baseQuantity"].map(key=>[key,fulfillmentInventoryId(line[key])]));
  if(lineIds.has(result.fulfillmentLineId)||salesLineIds.has(result.salesOrderLineId)||!Array.isArray(line.reservations)||!line.reservations.length||line.reservations.length>50)fail();lineIds.add(result.fulfillmentLineId);salesLineIds.add(result.salesOrderLineId);let oldCount=0;
  const reservations=line.reservations.map(member=>{
   fulfillmentInventoryFields(member,["claimId","inventoryReservationId","baseQuantity","releases"]);
   const normalized=Object.fromEntries(["claimId","inventoryReservationId","baseQuantity"].map(key=>[key,fulfillmentInventoryId(member[key])]));
   if(claimIds.has(normalized.claimId)||reservationIds.has(normalized.inventoryReservationId)||!Array.isArray(member.releases)||!member.releases.length||member.releases.length>50)fail();claimIds.add(normalized.claimId);reservationIds.add(normalized.inventoryReservationId);oldCount+=member.releases.length;
   const releases=member.releases.map(release=>{fulfillmentInventoryFields(release,["inventoryAllocationId","expectedVersion","baseQuantity"]);const id=fulfillmentInventoryId(release.inventoryAllocationId);if(allocationIds.has(id))fail();allocationIds.add(id);return {inventoryAllocationId:id,expectedVersion:fulfillmentInventoryVersion(release.expectedVersion),baseQuantity:fulfillmentInventoryId(release.baseQuantity)};}).sort((a,b)=>Number(a.inventoryAllocationId)-Number(b.inventoryAllocationId));
   if(releases.reduce((sum,row)=>sum+BigInt(row.baseQuantity),0n)!==BigInt(normalized.baseQuantity))fail();return {...normalized,releases};
  }).sort((a,b)=>Number(a.inventoryReservationId)-Number(b.inventoryReservationId));
  if(oldCount>50||reservations.reduce((sum,row)=>sum+BigInt(row.baseQuantity),0n)!==BigInt(result.baseQuantity))fail();return {...result,reservations};
 }).sort((a,b)=>Number(a.fulfillmentLineId)-Number(b.fulfillmentLineId));
 if(claimIds.size>5000||allocationIds.size>5000)fail();return freeze({fulfillmentId,salesOrderId,warehouseId,lines,page,asOf});
}

export async function lockReallocationAdvisoryScope(tx,query,{inventory,time}){
 const selected=new Map(query.lines.flatMap(line=>line.reservations.flatMap(member=>member.releases.map(release=>[release.inventoryAllocationId,{line,member,release}])))),ids=[...selected.keys()].sort((a,b)=>Number(a)-Number(b));
 // Bound discovery before the existing complete owner proof; include every positive own effect.
 const [discovered]=await tx.query("SELECT a.id FROM inventory_allocations a JOIN inventory_operation_requests o ON o.id=a.create_operation_id WHERE o.source_module='FULFILLMENT' AND o.source_document_type='PICK' AND o.source_document_id=? AND a.outstanding_quantity>0 ORDER BY a.id LIMIT 5001",[query.fulfillmentId]);
 if(discovered.length!==ids.length||discovered.some(row=>!selected.has(String(row.id))))fail("ALLOCATION_STATE_CONFLICT");
 const scope=await lockFulfillmentPickScope(tx,{fulfillmentId:query.fulfillmentId,inventoryAllocationIds:ids},{inventory,time}),credits=new Map(),releaseCounts=new Map();
 for(const fact of scope.allocations){
  const expected=selected.get(fact.inventoryAllocationId);if(!expected)fail("ALLOCATION_STATE_CONFLICT");const {line,member,release}=expected;
  if(fact.fulfillmentLineId!==line.fulfillmentLineId||fact.salesOrderLineId!==line.salesOrderLineId||fact.claimId!==member.claimId||fact.inventoryReservationId!==member.inventoryReservationId||fact.warehouseId!==query.warehouseId||fact.skuId!==line.skuId)fail("INVENTORY_SOURCE_CONFLICT");
  if(!["ACTIVE","PARTIALLY_CONSUMED"].includes(fact.status)||fact.consumedQuantity!=="0"||fact.outstandingQuantity!==release.baseQuantity)fail("ALLOCATION_STATE_CONFLICT");
  if(fact.version!==release.expectedVersion||fact.version>=4294967295)fail("VERSION_CONFLICT");
  credits.set(fact.inventoryBalanceId,(credits.get(fact.inventoryBalanceId)??0n)+BigInt(fact.outstandingQuantity));releaseCounts.set(fact.inventoryBalanceId,(releaseCounts.get(fact.inventoryBalanceId)??0)+1);
 }
 const reservationFacts=new Map(scope.reservationFacts.map(row=>[row.inventoryReservationId,row]));
 for(const line of query.lines)for(const member of line.reservations){const fact=reservationFacts.get(member.inventoryReservationId);if(!fact||fact.salesOrderId!==query.salesOrderId||fact.salesOrderLineId!==line.salesOrderLineId||fact.warehouseId!==query.warehouseId||fact.skuId!==line.skuId||BigInt(fact.outstandingQuantity)<BigInt(member.baseQuantity))fail("INVENTORY_SOURCE_CONFLICT");}
 if(reservationFacts.size!==query.lines.reduce((sum,line)=>sum+line.reservations.length,0))fail("INVENTORY_SOURCE_CONFLICT");
 const {warehouses}=await inventory.locks.lockForCommand(tx,{warehouseIds:[Number(query.warehouseId)]});if(warehouses.length!==1||warehouses[0].status!=="ACTIVE")fail("WAREHOUSE_INVALID");
 const balanceIds=[...credits.keys()],[balances]=await tx.query(`SELECT id,warehouse_id,sku_id,on_hand_quantity,allocated_quantity,version FROM inventory_stock_balances WHERE id IN (${balanceIds.map(()=>"?").join(",")}) ORDER BY id`,balanceIds),bySku=new Map();if(balances.length!==balanceIds.length)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
 for(const balance of balances){const id=String(balance.id),credit=credits.get(id);number(balance.on_hand_quantity);number(balance.allocated_quantity);if(!credit||String(balance.warehouse_id)!==query.warehouseId||BigInt(balance.allocated_quantity)>BigInt(balance.on_hand_quantity)||credit>BigInt(balance.allocated_quantity)||scope.allocations.some(row=>row.inventoryBalanceId===id&&row.skuId!==String(balance.sku_id)))fail("INVENTORY_DEPENDENCY_UNAVAILABLE");if(scope.allocations.some(row=>row.inventoryBalanceId===id&&row.balanceVersion!==number(balance.version))||number(balance.version)+(releaseCounts.get(id)??0)>4294967295)fail("VERSION_CONFLICT");const map=bySku.get(String(balance.sku_id))??new Map();map.set(id,Number(credit));bySku.set(String(balance.sku_id),map);}
 const skuIds=[...new Set(query.lines.map(row=>row.skuId))],profiles=await inventory.itemLookup.getFulfillmentInventoryProfilesInTransaction(tx,skuIds,{atMs:time.nowMs()}),byProfile=new Map(profiles.map(row=>[row.skuId,row]));
 if(profiles.length!==skuIds.length||byProfile.size!==skuIds.length||skuIds.some(id=>!byProfile.has(id))||profiles.some(row=>!row.usable||!row.inventoryTracked))fail("INVENTORY_RESOURCE_NOT_FOUND");if(profiles.some(row=>row.trackingPolicy==="serial"))fail("SERIAL_TRACKING_UNSUPPORTED");
 const reservationIds=[...reservationFacts.keys()],[rows]=await tx.query(`SELECT id,version,minimum_remaining_days FROM inventory_reservations WHERE id IN (${reservationIds.map(()=>"?").join(",")}) ORDER BY id`,reservationIds),reservations=new Map(rows.map(row=>[String(row.id),row]));if(rows.length!==reservationIds.length)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
 for(const row of rows)if(!Number.isSafeInteger(Number(row.minimum_remaining_days))||Number(row.minimum_remaining_days)<0||Number(row.minimum_remaining_days)>36500||Number(row.version)!==reservationFacts.get(String(row.id))?.version)fail("INVENTORY_DEPENDENCY_UNAVAILABLE");
 return {scope,credits,releaseCounts,bySku,byProfile,reservations};
}

export async function readReallocationAdvisory(tx,query,{inventory,time}){
 const {scope,credits,bySku,byProfile,reservations}=await lockReallocationAdvisoryScope(tx,query,{inventory,time});
 const demands=query.lines.flatMap(line=>line.reservations.map(member=>({fulfillmentLineId:line.fulfillmentLineId,claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,skuId:line.skuId,requestedQuantity:member.baseQuantity,page:query.page}))),load=(executor,options)=>loadFulfillmentReallocationCandidates(executor,options,bySku.get(String(options.skuId))??new Map());
 const batch=await readFulfillmentBatchCandidates(tx,{warehouseId:query.warehouseId,demands,profiles:byProfile,reservations,time,loadCandidates:load});
 return freeze({...batch,scope,demands:batch.demands.map(member=>({...member,candidates:member.candidates.map(candidate=>{const {freeQuantity,...rest}=candidate,credit=credits.get(candidate.inventoryBalanceId)??0n;return {...rest,physicalFreeQuantity:(BigInt(freeQuantity)-credit).toString(),ownReleaseCredit:credit.toString(),availableAfterOwnRelease:freeQuantity};})}))});
}
