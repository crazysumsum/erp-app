import assert from "node:assert/strict";
import test from "node:test";
import { p1Fixture,ownerQuantities } from "../fulfillment/p1Fixture.js";
import { FulfillmentAllocationService } from "../../src/modules/fulfillment/FulfillmentAllocationService.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
nativeTest("P1 batch default-prefix candidates distinguish an accepted manual swapped-prefix selection",async t=>{
 const {inventoryNativeFixture}=await import("../fulfillment/inventoryNativeFixture.js"),{InventoryLookupService}=await import("../../src/modules/inventory/InventoryLookupService.js"),{InventoryFulfillmentService}=await import("../../src/modules/inventory/InventoryFulfillmentService.js");
 const f=await inventoryNativeFixture(t),r1=await f.reservation("5"),r2=await f.reservation("6");await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=4 WHERE id=?",[f.balanceId]);
 const bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,'B','b',1,1)",[f.warehouseId]),second=await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',4,'2026-10-02',1,1)",[f.warehouseId,bin,f.skuId]);
 const lookup=new InventoryLookupService({...f}),result=await f.withActor(tx=>lookup.listFulfillmentBatchAllocationCandidates(tx,{warehouseId:f.warehouseId,asOf:f.time.nowMs(),demands:[r1,r2].map((inventoryReservationId,index)=>({fulfillmentLineId:String(index+3),claimId:String(index+7),inventoryReservationId,skuId:f.skuId,requestedQuantity:"4"}))}),{isolationLevel:"READ COMMITTED"});
 assert.equal(result.demands[1].candidates.some(row=>row.inventoryBalanceId===f.balanceId),false);
 const member=(claimId,inventoryReservationId,balance,overrideReason="")=>({claimId,inventoryReservationId,expectedVersion:1,baseQuantity:"4",overrideReason,allocations:[{inventoryBalanceId:balance,baseQuantity:"4",expectedBalanceVersion:1}]}),command={actor:f.actor,source:{documentId:"1",eventId:crypto.randomUUID()},correlationId:"",payload:{fulfillmentId:"1",lines:[{fulfillmentLineId:"3",salesOrderLineId:"5",baseQuantity:"4",reservations:[member("7",r1,second,"指定另一庫位揀貨")]},{fulfillmentLineId:"4",salesOrderLineId:"6",baseQuantity:"4",reservations:[member("8",r2,f.balanceId)]}]}},writer=new InventoryFulfillmentService(f);
 const posted=await f.withActor(async tx=>{const proof=await writer.claimFulfillmentBatchInTransaction(tx,{action:"ALLOCATE",command});return writer.allocateForFulfillmentBatchInTransaction(tx,command,proof);},{isolationLevel:"READ COMMITTED"});assert.equal(posted.lines.length,2);assert.deepEqual((await f.db.query("SELECT allocated_quantity FROM inventory_stock_balances ORDER BY id"))[0].map(row=>Number(row.allocated_quantity)),[4,4]);
 t.diagnostic("Default-prefix candidate omission is real while the swapped-prefix writer selection succeeds; UI must not invent per-Claim eligibility or silently restrict the approved manual workflow.");
});
nativeTest("P1 Draft candidates derive owner IDs from persisted Claims and preserve all quantities",async t=>{
 const f=await p1Fixture(t,5),created=await f.create(f.body("5"));
 const binId=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"CANDIDATE",normalized_code:"candidate",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
 const balanceId=await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:binId,sku_id:f.s.skuId,stock_status:"AVAILABLE",on_hand_quantity:10,allocated_quantity:0,fifo_anchor_date:"2023-11-13",created_at:f.s.now,updated_at:f.s.now});
 const before=await ownerQuantities(f),service=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}});
 const result=await f.execute(()=>service.candidates(created.outcome.id,{version:1}));
 assert.equal(result.fulfillmentId,created.outcome.id);assert.equal(result.version,1);assert.equal(result.demands.length,1);
 const member=result.demands[0];assert.equal(member.requestedQuantity,"5");assert.equal(member.inventoryReservationId,String(f.reservationId));assert.equal(member.expectedReservationVersion,1);
 assert.equal(member.candidates[0].inventoryBalanceId,String(balanceId));assert.equal(member.candidates[0].rank,1);assert.equal(member.candidates[0].selectionStrategy,"FIFO");assert.equal(member.candidates[0].recommendedQuantity,"5");
 assert.deepEqual(await ownerQuantities(f),before);
 await assert.rejects(()=>f.execute(()=>service.candidates(created.outcome.id,{version:2})),{code:"VERSION_CONFLICT"});
 await assert.rejects(()=>f.execute(()=>service.candidates(created.outcome.id,{version:1,warehouseId:"999"})),{code:"FULFILLMENT_INPUT_INVALID"});
});

nativeTest("HD018 batch advisory does not recommend the same free stock twice across Reservations",async t=>{
 const {inventoryNativeFixture}=await import("../fulfillment/inventoryNativeFixture.js"),{InventoryLookupService}=await import("../../src/modules/inventory/InventoryLookupService.js");
 const f=await inventoryNativeFixture(t),r1=await f.reservation("5"),r2=await f.reservation("6");
 await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=5 WHERE id=?",[f.balanceId]);
 const bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,'B','b',1,1)",[f.warehouseId]);
 const second=await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',3,'2026-10-02',1,1)",[f.warehouseId,bin,f.skuId]);
 const lookup=new InventoryLookupService({...f});
 const result=await f.withActor(tx=>lookup.listFulfillmentBatchAllocationCandidates(tx,{warehouseId:f.warehouseId,asOf:f.time.nowMs(),demands:[r1,r2].map((inventoryReservationId,index)=>({fulfillmentLineId:String(index+3),claimId:String(index+7),inventoryReservationId,skuId:f.skuId,requestedQuantity:"4"}))}),{isolationLevel:"READ COMMITTED"});
 const recommendation=member=>member.candidates.filter(row=>BigInt(row.recommendedQuantity)>0n).map(row=>[row.inventoryBalanceId,row.recommendedQuantity]);
 assert.deepEqual(recommendation(result.demands[0]),[[f.balanceId,"4"]]);
 assert.deepEqual(recommendation(result.demands[1]),[[f.balanceId,"1"],[second,"3"]]);
});

nativeTest("P1 actual Inventory writer shares stock across members without a sequence override",async t=>{
 const {inventoryNativeFixture}=await import("../fulfillment/inventoryNativeFixture.js"),{InventoryFulfillmentService}=await import("../../src/modules/inventory/InventoryFulfillmentService.js");
 const f=await inventoryNativeFixture(t),r1=await f.reservation("5"),r2=await f.reservation("6");
 await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=5 WHERE id=?",[f.balanceId]);
 const bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,'B','b',1,1)",[f.warehouseId]);
 const second=await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',3,'2026-10-02',1,1)",[f.warehouseId,bin,f.skuId]);
 const leg=(inventoryBalanceId,baseQuantity)=>({inventoryBalanceId,baseQuantity,expectedBalanceVersion:1});
 const member=(claimId,inventoryReservationId,allocations)=>({claimId,inventoryReservationId,expectedVersion:1,baseQuantity:"4",overrideReason:"",allocations});
 const command={actor:f.actor,source:{documentId:"1",eventId:"00000000-0000-4000-8000-000000000018"},correlationId:"",payload:{fulfillmentId:"1",lines:[{fulfillmentLineId:"3",salesOrderLineId:"5",baseQuantity:"4",reservations:[member("7",r1,[leg(f.balanceId,"4")])]},{fulfillmentLineId:"4",salesOrderLineId:"6",baseQuantity:"4",reservations:[member("8",r2,[leg(f.balanceId,"1"),leg(second,"3")])]}]}};
 const service=new InventoryFulfillmentService(f),result=await f.withActor(async tx=>{const proof=await service.claimFulfillmentBatchInTransaction(tx,{action:"ALLOCATE",command});return service.allocateForFulfillmentBatchInTransaction(tx,command,proof);},{isolationLevel:"READ COMMITTED"});
 assert.equal(result.lines.flatMap(line=>line.reservations.flatMap(member=>member.allocations)).every(leg=>!leg.isSequenceOverride),true);
 assert.deepEqual((await f.db.query("SELECT allocated_quantity FROM inventory_stock_balances ORDER BY id"))[0].map(row=>Number(row.allocated_quantity)),[5,3]);
});

nativeTest("P1 candidate Sales intent canonical order is independent of Fulfillment Line IDs",async t=>{
 const {addSourceLine}=await import("../fulfillment/p1Fixture.js"),f=await p1Fixture(t),second=await addSourceLine(f);
 await f.db.execute("UPDATE sales_order_lines SET line_no=99 WHERE id=?",[f.s.lineId]);
 await f.db.execute("UPDATE sales_order_lines SET line_no=1 WHERE id=?",[second.lineId]);
 await f.db.execute("UPDATE sales_order_lines SET line_no=2 WHERE id=?",[f.s.lineId]);
 const created=await f.create({...f.body(),salesOrderVersion:2,lines:[{salesOrderLineId:f.s.lineId,plannedBaseQuantity:"1"},{salesOrderLineId:second.lineId,plannedBaseQuantity:"1"}]});
 const service=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}});
 const result=await f.execute(()=>service.candidates(created.outcome.id,{version:1}));assert.equal(result.demands.length,2);
});

nativeTest("HD018 candidate refuses hidden counter or original-event drift with unchanged outstanding",async t=>{
 for(const kind of ["counter","event"]){await t.test(kind,async t=>{
  const f=await p1Fixture(t,5),created=await f.create(f.body("5")),service=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}});
  if(kind==="counter")await f.db.execute("UPDATE inventory_reservations SET original_quantity=6,released_quantity=1,version=version+1 WHERE id=?",[f.reservationId]);
  else await f.db.execute("UPDATE inventory_operation_requests SET source_event_id='changed-original-reserve-event' WHERE id=(SELECT create_operation_id FROM inventory_reservations WHERE id=?)",[f.reservationId]);
  await assert.rejects(()=>f.execute(()=>service.candidates(created.outcome.id,{version:1})),{code:"FULFILLABLE_QUANTITY_CHANGED"});
 });}
});

nativeTest("HD018 candidate HTTP requires fresh operation permission and rejects replaced owner identities",async t=>{
 const {startP1Http}=await import("../fulfillment/p1Fixture.js"),f=await p1Fixture(t),created=await f.create(f.body()),request=await startP1Http(t,f),path=`/api/v1/fulfillments/${created.outcome.id}/allocation-candidates?version=1`;
 const result=await request("GET",path);assert.equal(result.status,200);assert.equal(result.body.data.demands[0].summary.insufficientStock,true);
 for(const suffix of ["&warehouseId=999","&claimId=999","&inventoryReservationId=999","&minimumRemainingDays=0","&page=01","&page=0"])assert.equal((await request("GET",path+suffix)).status,400);
 assert.equal((await request("GET",path,undefined,{auth:false})).status,401);assert.equal((await request("GET",path,undefined,{auth:"denied"})).status,403);
 assert.equal((await request("GET",`/api/v1/fulfillments/999999999/allocation-candidates?version=1`)).status,404);
 await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='fulfillment.operation'",[f.roleId]);assert.equal((await request("GET",path)).status,403);
});

nativeTest("HD018 candidate permits quantity-neutral current CAS and derives minimum-days from Inventory owner",async t=>{
 const f=await p1Fixture(t),created=await f.create(f.body());await f.db.execute("UPDATE inventory_reservations SET version=version+1,minimum_remaining_days=7 WHERE id=?",[f.reservationId]);
 const service=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}}),result=await f.execute(()=>service.candidates(created.outcome.id,{version:1}));
 assert.equal(result.demands[0].expectedReservationVersion,2);assert.equal(result.demands[0].minimumRemainingDays,7);
});

nativeTest("HD018 missing, duplicate, wrong-owner and unknown provider results fail closed",async t=>{
 const f=await p1Fixture(t,2),created=await f.create(f.body()),service=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}}),lookup=service.inventoryLookup.listFulfillmentBatchAllocationCandidates.bind(service.inventoryLookup);
 for(const mutate of [result=>{result.demands=[];},result=>{result.demands.push(result.demands[0]);},result=>{result.demands[0].claimId="999";},result=>{result.demands[0].unknown="unexpected";},result=>{result.demands[0].summary.quantityComplete=true;}]){
  service.inventoryLookup.listFulfillmentBatchAllocationCandidates=async(...args)=>{const result=await lookup(...args);mutate(result);return result;};
  await assert.rejects(()=>f.execute(()=>service.candidates(created.outcome.id,{version:1})),{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});
 }
});

nativeTest("HD018 Sales source facts stay bound to the exact live legacy CLAIM receipt and grant no apply authority",async t=>{
 const f=await p1Fixture(t),created=await f.create(f.body()),[[claim]]=await f.db.query("SELECT id FROM fulfillment_line_reservation_claims WHERE fulfillment_id=?",[created.outcome.id]);
 const intent=f.command();intent.purpose="CLAIM";for(const key of ["eventId","shipmentId","inventoryRequestHash"])delete intent[key];intent.lines[0].reservations[0].claimId=String(claim.id);
 let expired;
 await f.run({claims:f.claims},async tx=>{
  expired=tx;await assert.rejects(()=>f.service.readLockedFulfillmentClaimSourceFactsInTransaction(tx,intent),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
  await f.service.lockLinesForFulfillmentInTransaction(tx,intent);
  const facts=await f.service.readLockedFulfillmentClaimSourceFactsInTransaction(tx,intent);assert.equal(facts.lines[0].reservations[0].sourceEventId,f.reserveEvent);assert.equal(facts.lines[0].reservations[0].originalBaseQuantity,"1");
  assert.throws(()=>{facts.lines[0].reservations[0].originalBaseQuantity="99";},TypeError);
  const changed=structuredClone(intent);changed.lines[0].reservations[0].claimId="999";await assert.rejects(()=>f.service.readLockedFulfillmentClaimSourceFactsInTransaction(tx,changed),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
  await assert.rejects(()=>f.createService().readLockedFulfillmentClaimSourceFactsInTransaction(tx,intent),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
  await assert.rejects(()=>f.service.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult:{lines:[]}}),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
 });
 await assert.rejects(()=>f.service.readLockedFulfillmentClaimSourceFactsInTransaction(expired,intent),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
 await f.run({claims:f.claims},async tx=>{await f.service.lockLinesForFulfillmentInTransaction(tx,intent);await assert.rejects(()=>f.service.readLockedFulfillmentClaimSourceFactsInTransaction(tx,intent),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});},{isolationLevel:"REPEATABLE READ"});
});

nativeTest("HD018 native expiry eligibility shares physical budget and ranks in writer Line order rather than Reservation order",async t=>{
 const {inventoryNativeFixture}=await import("../fulfillment/inventoryNativeFixture.js"),{InventoryLookupService}=await import("../../src/modules/inventory/InventoryLookupService.js"),f=await inventoryNativeFixture(t);
 await f.db.execute("UPDATE item_skus SET tracking_policy='batch_expiry' WHERE id=?",[f.skuId]);await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=0,fifo_anchor_date=NULL WHERE id=?",[f.balanceId]);
 const balances=[];for(const [code,expiry,quantity]of [["EARLY","2026-10-25",5],["LATE","2026-11-01",3]]){
  const lot=await f.insert("INSERT INTO inventory_lots(sku_id,lot_number,normalized_lot_number,expiry_date,first_receipt_date,sku_code_snapshot,created_at) VALUES(?,?,?,?,?,'SYN',1)",[f.skuId,code,code.toLowerCase(),expiry,"2026-10-01"]);
  balances.push(await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,created_at,updated_at) VALUES(?,?,?,?,'AVAILABLE',?,1,1)",[f.warehouseId,f.binId,f.skuId,lot,quantity]));
 }
 const later=await f.reservation("6","3"),first=await f.reservation("5","6");await f.db.execute("UPDATE inventory_reservations SET minimum_remaining_days=7 WHERE id=?",[later]);
 const lookup=new InventoryLookupService(f),result=await f.withActor(tx=>lookup.listFulfillmentBatchAllocationCandidates(tx,{warehouseId:f.warehouseId,asOf:f.time.nowMs(),demands:[{fulfillmentLineId:"4",claimId:"8",inventoryReservationId:later,skuId:f.skuId,requestedQuantity:"3"},{fulfillmentLineId:"3",claimId:"7",inventoryReservationId:first,skuId:f.skuId,requestedQuantity:"6"}]}),{isolationLevel:"READ COMMITTED"});
 assert.deepEqual(result.demands.map(row=>row.inventoryReservationId),[first,later]);assert.deepEqual(result.demands[0].candidates.map(row=>[row.inventoryBalanceId,row.recommendedQuantity,row.selectionStrategy]),[[balances[0],"5","FEFO"],[balances[1],"1","FEFO"]]);
 const member=result.demands[1];assert.equal(member.candidates[0].inventoryBalanceId,balances[1]);assert.equal(member.candidates[0].rank,1);assert.equal(member.candidates[0].freeQuantity,"3");assert.equal(member.candidates[0].batchAvailableQuantity,"2");assert.equal(member.candidates[0].expectedBalanceVersion,1);assert.equal(member.summary.recommendedBaseQuantity,"2");assert.equal(member.summary.insufficientStock,true);
});

nativeTest("HD018 100-line/5000-Claim advisory shares each SKU budget without changing owner quantities",{timeout:120000},async t=>{
 const {seedMaxClaimOrder}=await import("../fulfillment/p1CapacityFixture.js"),f=await p1Fixture(t),sources=await seedMaxClaimOrder(f),created=await f.create({...f.body(),lines:sources.map(line=>({salesOrderLineId:line.id,plannedBaseQuantity:"50"}))});
 const bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"BATCH",normalized_code:"batch",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
 await f.db.query("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES ?",[sources.map(line=>[f.s.warehouseId,bin,line.sku,"AVAILABLE",50,"2023-11-13",f.s.now,f.s.now])]);
 const before=await ownerQuantities(f),service=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}}),start=performance.now(),result=await f.execute(()=>service.candidates(created.outcome.id,{version:1})),elapsedMs=performance.now()-start;
 assert.equal(result.demands.length,5000);assert.equal(result.demands.every(member=>member.candidates.length===1&&member.summary.quantityComplete&&member.candidates[0].recommendedQuantity==="1"&&member.candidates[0].expectedBalanceVersion===1),true);
 assert.equal(result.demands.reduce((sum,member)=>sum+Number(member.summary.recommendedBaseQuantity),0),5000);assert.deepEqual(await ownerQuantities(f),before);t.diagnostic(JSON.stringify({scenario:"100lines/50Reservations-per-line/5000Claims",elapsedMs,originalTransactionLimitUnchanged:true}));
});

nativeTest("HD018 missing candidate owner schema fails closed and is never cached as an empty recommendation",async t=>{
 const f=await p1Fixture(t),created=await f.create(f.body()),service=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}});
 await f.db.query("RENAME TABLE inventory_stock_balances TO test_candidate_missing_balances");
 try{await assert.rejects(()=>f.execute(()=>service.candidates(created.outcome.id,{version:1})),{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});}finally{await f.db.query("RENAME TABLE test_candidate_missing_balances TO inventory_stock_balances");}
 const result=await f.execute(()=>service.candidates(created.outcome.id,{version:1}));assert.equal(result.demands.length,1);assert.equal(result.demands[0].summary.insufficientStock,true);
});

nativeTest("HD018 native candidate page2 retains virtual rank after preceding member stock consumption",async t=>{
 const {inventoryNativeFixture}=await import("../fulfillment/inventoryNativeFixture.js"),{InventoryLookupService}=await import("../../src/modules/inventory/InventoryLookupService.js"),f=await inventoryNativeFixture(t);
 await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=0,fifo_anchor_date=NULL WHERE id=?",[f.balanceId]);const ids=[];
 for(let index=0;index<155;index++){
  const code=String(index).padStart(3,"0"),bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,?,?,1,1)",[f.warehouseId,"P"+code,"p"+code]);
  ids.push(await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',1,'2026-10-01',1,1)",[f.warehouseId,bin,f.skuId]));
 }
 const reservations=[await f.reservation("5","50"),await f.reservation("6","50")],lookup=new InventoryLookupService(f),result=await f.withActor(tx=>lookup.listFulfillmentBatchAllocationCandidates(tx,{warehouseId:f.warehouseId,asOf:f.time.nowMs(),demands:reservations.map((inventoryReservationId,index)=>({fulfillmentLineId:String(index+3),claimId:String(index+7),inventoryReservationId,skuId:f.skuId,requestedQuantity:"50",page:2}))}),{isolationLevel:"READ COMMITTED"});
 assert.equal(result.demands[0].candidates[0].inventoryBalanceId,ids[100]);assert.equal(result.demands[1].candidates[0].inventoryBalanceId,ids[150]);assert.equal(result.demands[1].candidates[0].rank,101);assert.equal(result.demands[1].candidates.length,5);assert.equal(result.demands[1].hasMore,false);assert.equal(result.demands[1].summary.quantityComplete,true);
});

nativeTest("HD018 quantity completeness does not waive the writer's 50-leg limit for a single Line",async t=>{
 const {inventoryNativeFixture}=await import("../fulfillment/inventoryNativeFixture.js"),{InventoryLookupService}=await import("../../src/modules/inventory/InventoryLookupService.js"),{InventoryFulfillmentService}=await import("../../src/modules/inventory/InventoryFulfillmentService.js"),f=await inventoryNativeFixture(t);
 await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=0,fifo_anchor_date=NULL WHERE id=?",[f.balanceId]);
 for(let index=0;index<52;index++){
  const code=String(index).padStart(3,"0"),bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,?,?,1,1)",[f.warehouseId,"L"+code,"l"+code]);
  await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',1,'2026-10-01',1,1)",[f.warehouseId,bin,f.skuId]);
 }
 const reservations=[await f.reservation("5","26","first"),await f.reservation("5","26","second")],lookup=new InventoryLookupService(f),result=await f.withActor(tx=>lookup.listFulfillmentBatchAllocationCandidates(tx,{warehouseId:f.warehouseId,asOf:f.time.nowMs(),demands:reservations.map((inventoryReservationId,index)=>({fulfillmentLineId:"3",claimId:String(index+7),inventoryReservationId,skuId:f.skuId,requestedQuantity:"26"}))}),{isolationLevel:"READ COMMITTED"});
 assert.equal(result.demands.every(member=>member.summary.quantityComplete),true);assert.equal(result.demands.flatMap(member=>member.candidates.filter(row=>row.recommendedQuantity!=="0")).length,52);
 const command={actor:f.actor,source:{documentId:"1",eventId:"00000000-0000-4000-8000-000000000019"},correlationId:"",payload:{fulfillmentId:"1",lines:[{fulfillmentLineId:"3",salesOrderLineId:"5",baseQuantity:"52",reservations:result.demands.map(member=>({claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,expectedVersion:1,baseQuantity:"26",overrideReason:"",allocations:member.candidates.filter(row=>row.recommendedQuantity!=="0").map(row=>({inventoryBalanceId:row.inventoryBalanceId,expectedBalanceVersion:row.expectedBalanceVersion,baseQuantity:row.recommendedQuantity})).sort((a,b)=>Number(a.inventoryBalanceId)-Number(b.inventoryBalanceId))}))}]}};
 const service=new InventoryFulfillmentService(f);await assert.rejects(()=>f.withActor(tx=>service.claimFulfillmentBatchInTransaction(tx,{action:"ALLOCATE",command}),{isolationLevel:"READ COMMITTED"}),{code:"INVENTORY_INPUT_INVALID"});
 assert.equal(Number((await f.db.query("SELECT SUM(allocated_quantity) AS allocated FROM inventory_stock_balances"))[0][0].allocated),0);
});

nativeTest("HD018 missing or insufficient StockControl fails closed without repairing owner state",async t=>{
 for(const kind of ["missing","insufficient"]){await t.test(`${t.name}: ${kind}`,async t=>{
  const f=await p1Fixture(t,2),created=await f.create(f.body()),service=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}});
  if(kind==="missing")await f.db.execute("DELETE FROM inventory_stock_controls WHERE warehouse_id=? AND sku_id=?",[f.s.warehouseId,f.s.skuId]);else await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=1 WHERE warehouse_id=? AND sku_id=?",[f.s.warehouseId,f.s.skuId]);
  const before=await ownerQuantities(f);await assert.rejects(()=>f.execute(()=>service.candidates(created.outcome.id,{version:1})),{code:"INVENTORY_DEPENDENCY_UNAVAILABLE"});assert.deepEqual(await ownerQuantities(f),before);
 });}
});
nativeTest("HD018 candidate business read executes zero DML, including no-op StockControl upserts",async t=>{
 const f=await p1Fixture(t),created=await f.create(f.body()),service=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}}),withTransaction=f.database.withTransaction.bind(f.database),statements=[];
 f.database.withTransaction=(work,options)=>withTransaction(tx=>{for(const name of ["query","execute"]){const original=tx[name].bind(tx);tx[name]=(sql,args)=>{statements.push(sql);return original(sql,args);};}return work(tx);},options);
 const result=await f.execute(()=>service.candidates(created.outcome.id,{version:1}));assert.equal(result.demands.length,1);assert.equal(statements.some(sql=>/^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu.test(sql)),false);
});
