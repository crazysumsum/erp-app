import assert from "node:assert/strict";
import test from "node:test";
import { inventoryNativeFixture } from "../fulfillment/inventoryNativeFixture.js";
import { InventoryFulfillmentService } from "../../src/modules/inventory/InventoryFulfillmentService.js";
import { loadInventoryCandidates } from "../../src/modules/inventory/InventoryPickSequenceService.js";
import { InventoryLookupService } from "../../src/modules/inventory/InventoryLookupService.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;

async function fixture(t) {
  const f=await inventoryNativeFixture(t),service=new InventoryFulfillmentService({database:f.database,time:f.time,logger:f.logger}),lines=[];
  for(let i=0;i<2;i++)lines.push({fulfillmentLineId:String(i+3),salesOrderLineId:String(i+5),baseQuantity:"5",reservations:[{claimId:String(i+7),inventoryReservationId:await f.reservation(String(i+5)),expectedVersion:1,baseQuantity:"5",overrideReason:"",allocations:[{inventoryBalanceId:f.balanceId,expectedBalanceVersion:1,baseQuantity:"5"}]}]});
  const methods={ALLOCATE:"allocateForFulfillmentBatchInTransaction",RELEASE:"releaseFulfillmentAllocationsInTransaction",REALLOCATE:"reallocateFulfillmentBatchInTransaction"};
  const invoke=(action,payload,event,before)=>f.withActor(async tx=>{
    await before?.(tx);
    const command={actor:f.actor,source:{documentId:"1",eventId:`00000000-0000-4000-8000-${String(event).padStart(12,"0")}`},correlationId:"",payload};
    const proof=await service.claimFulfillmentBatchInTransaction(tx,{action,command});
    return service[methods[action]](tx,command,proof);
  },{isolationLevel:"READ COMMITTED"});
  return {...f,service,lines,invoke};
}

nativeTest("P0 native allocate, partial release and atomic reallocate retain owner snapshots and exact versions",async t=>{
  const f=await fixture(t),payload={fulfillmentId:"1",lines:f.lines};
  const allocated=await f.invoke("ALLOCATE",payload,1);
  assert.deepEqual(allocated.lines.map(l=>l.reservations[0].allocations[0].balanceVersion),[2,3]);
  assert.ok(allocated.lines.every(l=>{const a=l.reservations[0].allocations[0];return a.selectionStrategy==="FIFO"&&a.recommendedRank===1&&!a.isSequenceOverride&&a.bucketSnapshot.baseUomId===f.uomId;}));
  assert.deepEqual(await f.invoke("ALLOCATE",payload,1),allocated);
  const release={fulfillmentId:"1",lines:allocated.lines.map(line=>({...line,baseQuantity:"2",reservations:line.reservations.map(m=>({claimId:m.claimId,inventoryReservationId:m.inventoryReservationId,expectedVersion:2,baseQuantity:"2",allocations:m.allocations.map(a=>({inventoryAllocationId:a.inventoryAllocationId,inventoryBalanceId:a.inventoryBalanceId,expectedVersion:1,expectedBalanceVersion:3,baseQuantity:"2"}))}))}))};
  const released=await f.invoke("RELEASE",release,2);
  assert.deepEqual(released.lines.map(l=>l.reservations[0].allocations[0].balanceVersion),[4,5]);
  assert.ok(released.lines.every(l=>l.reservations[0].version===3&&l.reservations[0].allocations[0].outstandingQuantity==="3"));
  const bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,'B','b',1,1)",[f.warehouseId]);
  const balance=await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',20,'2026-10-02',1,1)",[f.warehouseId,bin,f.skuId]);
  const reallocate={fulfillmentId:"1",lines:released.lines.map(line=>({...line,baseQuantity:"3",reservations:line.reservations.map(m=>({claimId:m.claimId,inventoryReservationId:m.inventoryReservationId,expectedVersion:3,baseQuantity:"3",overrideReason:"Move pick location",releases:m.allocations.map(a=>({inventoryAllocationId:a.inventoryAllocationId,inventoryBalanceId:a.inventoryBalanceId,expectedVersion:2,expectedBalanceVersion:5,baseQuantity:"3"})),allocations:[{inventoryBalanceId:balance,expectedBalanceVersion:1,baseQuantity:"3"}]}))}))};
  const moved=await f.invoke("REALLOCATE",reallocate,3);
  assert.deepEqual(moved.lines.map(l=>l.reservations[0].releases[0].balanceVersion),[6,7]);
  assert.deepEqual(moved.lines.map(l=>l.reservations[0].allocations[0].balanceVersion),[2,3]);
  assert.ok(moved.lines.every(l=>l.reservations[0].version===4&&l.reservations[0].allocations[0].isSequenceOverride));
  await f.db.execute("UPDATE inventory_bins SET bin_code='RENAMED' WHERE id=?",[bin]);
  assert.deepEqual(await f.invoke("REALLOCATE",reallocate,3),moved);
  const [balances]=await f.db.query("SELECT id,on_hand_quantity,allocated_quantity FROM inventory_stock_balances ORDER BY id");
  assert.deepEqual(balances.map(b=>[Number(b.on_hand_quantity),Number(b.allocated_quantity)]),[[20,0],[20,6]]);
});

nativeTest("P0 candidate pages match the complete owner rank beyond100 same-Lot buckets",async t=>{
  const f=await fixture(t);
  await f.db.execute("UPDATE item_skus SET tracking_policy='batch' WHERE id=?",[f.skuId]);
  const lot=await f.insert("INSERT INTO inventory_lots(sku_id,lot_number,normalized_lot_number,first_receipt_date,sku_code_snapshot,created_at) VALUES(?,'LOT','lot','2026-10-01','SYN',1)",[f.skuId]);
  await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=0,fifo_anchor_date=NULL WHERE id=?",[f.balanceId]);
  let first;
  for(let i=0;i<101;i++) {
    const code=String(i).padStart(3,"0"),bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,?,?,1,1)",[f.warehouseId,code,code]);
    const id=await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,?,'AVAILABLE',20,?,1,1)",[f.warehouseId,bin,f.skuId,lot,i===0?"2026-10-20":"2026-10-01"]);
    if(i===0)first=id;
  }
  await f.withActor(async tx=>{
    const query={warehouseId:Number(f.warehouseId),skuId:Number(f.skuId),currentDate:f.time.fileDate(),minimumRemainingDays:0,trackingPolicy:"batch"};
    const full=await loadInventoryCandidates(tx,query),page1=await loadInventoryCandidates(tx,{...query,limit:100}),page2=await loadInventoryCandidates(tx,{...query,limit:100,offset:100});
    assert.deepEqual([...page1,...page2].map(c=>c.id),full.map(c=>c.id));
    assert.equal(String(full[0].id),first);
    const lookup=new InventoryLookupService({...f,fulfillment:f.service});
    const result=await lookup.listAllocationCandidates(tx,{warehouseId:f.warehouseId,asOf:f.time.nowMs(),demands:[{inventoryReservationId:f.lines[0].reservations[0].inventoryReservationId,skuId:f.skuId,minimumRemainingDays:0,requestedQuantity:"5"}]});
    assert.equal(result.demands[0].hasMore,true);assert.equal(result.demands[0].candidates.length,100);
    assert.equal(result.demands[0].candidates[0].inventoryBalanceId,first);
    assert.equal(result.demands[0].candidates[0].recommendedQuantity,"5");
  },{isolationLevel:"READ COMMITTED"});
  const selected=structuredClone(f.lines.slice(0,1));selected[0].reservations[0].allocations[0].inventoryBalanceId=first;
  const result=await f.invoke("ALLOCATE",{fulfillmentId:"1",lines:selected},4);
  assert.equal(result.lines[0].reservations[0].allocations[0].isSequenceOverride,false);
});

nativeTest("P0 binary Unicode Bin ordering agrees between complete owner rank and SQL candidate pages",async t=>{
  const f=await fixture(t);await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=0,fifo_anchor_date=NULL WHERE id=?",[f.balanceId]);
  for(let i=0;i<101;i++) {
    const code=(i===100?"\u{10000}":"\uE000")+String(i).padStart(3,"0");
    const bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,?,?,1,1)",[f.warehouseId,code,code]);
    await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',20,'2026-10-01',1,1)",[f.warehouseId,bin,f.skuId]);
  }
  await f.withActor(async tx=>{
    const query={warehouseId:Number(f.warehouseId),skuId:Number(f.skuId),currentDate:f.time.fileDate(),minimumRemainingDays:0,trackingPolicy:"none"};
    const full=await loadInventoryCandidates(tx,query),a=await loadInventoryCandidates(tx,{...query,limit:100}),b=await loadInventoryCandidates(tx,{...query,limit:100,offset:100});
    assert.deepEqual([...a,...b].map(c=>c.id),full.map(c=>c.id));
    assert.ok(full[0].binCode.startsWith("\uE000"));assert.ok(full[100].binCode.startsWith("\u{10000}"));
  },{isolationLevel:"READ COMMITTED"});
});

nativeTest("P0 native100x50 allocation and old/new5000 reallocation complete within the configured transaction budget",{timeout:60000},async t=>{
  const f=await fixture(t),balanceIds=[];
  await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=0,fifo_anchor_date=NULL WHERE id=?",[f.balanceId]);
  for(let i=0;i<50;i++) {
    const code=`CAP${String(i).padStart(2,"0")}`,bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,?,?,1,1)",[f.warehouseId,code,code.toLowerCase()]);
    balanceIds.push(await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',100,'2026-10-01',1,1)",[f.warehouseId,bin,f.skuId]));
  }
  const lines=[];
  for(let i=0;i<100;i++)lines.push({fulfillmentLineId:String(100+i),salesOrderLineId:String(200+i),baseQuantity:"50",reservations:[{claimId:String(300+i),inventoryReservationId:await f.reservation(String(200+i),"50"),expectedVersion:1,baseQuantity:"50",overrideReason:i===99?"":"Spread pick bins",allocations:balanceIds.map(id=>({inventoryBalanceId:id,expectedBalanceVersion:1,baseQuantity:"1"}))}]});
  const start=performance.now(),allocated=await f.invoke("ALLOCATE",{fulfillmentId:"1",lines},5),allocatedMs=performance.now()-start;
  assert.equal(allocated.lines.reduce((n,l)=>n+l.reservations[0].allocations.length,0),5000);
  const moved={fulfillmentId:"1",lines:allocated.lines.map((line,index)=>({...line,reservations:line.reservations.map(m=>({claimId:m.claimId,inventoryReservationId:m.inventoryReservationId,expectedVersion:2,baseQuantity:"50",overrideReason:index===99?"":"Spread pick bins",
    releases:m.allocations.map(a=>({inventoryAllocationId:a.inventoryAllocationId,inventoryBalanceId:a.inventoryBalanceId,expectedVersion:1,expectedBalanceVersion:101,baseQuantity:"1"})),
    allocations:balanceIds.map(id=>({inventoryBalanceId:id,expectedBalanceVersion:101,baseQuantity:"1"}))}))}))};
  let completedLegs=0;
  await assert.rejects(f.invoke("REALLOCATE",moved,6,tx=>{
    const execute=tx.execute.bind(tx);tx.execute=(sql,args)=>{
      if(sql.includes("UPDATE inventory_operation_requests")&&args[0]==="FULFILLMENT_LEG"&&++completedLegs===10000)throw new Error("synthetic last full-capacity receipt failure");
      return execute(sql,args);
    };
  }));
  assert.equal(completedLegs,10000);
  const [[rolledBack]]=await f.db.query("SELECT (SELECT COUNT(*) FROM inventory_allocations) AS allocations,(SELECT COUNT(*) FROM inventory_audit_logs) AS audits,(SELECT COUNT(*) FROM inventory_operation_requests WHERE command_type='FULFILLMENT_BATCH_REALLOCATE') AS reallocate");
  assert.deepEqual([Number(rolledBack.allocations),Number(rolledBack.audits),Number(rolledBack.reallocate)],[5000,5000,0]);
  const [originalBalances]=await f.db.query("SELECT allocated_quantity,version FROM inventory_stock_balances WHERE id<>?",[f.balanceId]);
  assert.ok(originalBalances.every(b=>Number(b.allocated_quantity)===100&&Number(b.version)===101));
  const before=performance.now(),result=await f.invoke("REALLOCATE",moved,6),reallocatedMs=performance.now()-before;
  assert.equal(result.lines.reduce((n,l)=>n+l.reservations[0].allocations.length+l.reservations[0].releases.length,0),10000);
  assert.deepEqual(result.lines[99].reservations[0].allocations.map(a=>a.balanceVersion),Array(50).fill(301));
  const [[counts]]=await f.db.query("SELECT (SELECT COUNT(*) FROM inventory_operation_requests WHERE source_document_type='PICK_LEG') AS legs,(SELECT COUNT(*) FROM inventory_allocations WHERE status='ACTIVE') AS active,(SELECT COUNT(*) FROM inventory_allocations WHERE status='RELEASED') AS released");
  assert.deepEqual([Number(counts.legs),Number(counts.active),Number(counts.released)],[15000,5000,5000]);
  t.diagnostic(`configured transactionTimeoutMs=20000; allocate=${Math.round(allocatedMs)}ms, reallocate=${Math.round(reallocatedMs)}ms; actual auxiliary legs=15000, zero skips`);
});

nativeTest("P0 native FIFO override preserves5/500 Unicode characters and rejects501 before claims",async t=>{
  const f=await fixture(t),bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,'LATER','later',1,1)",[f.warehouseId]);
  const balance=await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',20,'2026-10-20',1,1)",[f.warehouseId,bin,f.skuId]);
  for(const [index,count]of [5,500].entries()) {
    const line=structuredClone(f.lines[index]);line.reservations[0].overrideReason="原".repeat(count);line.reservations[0].allocations[0]={inventoryBalanceId:balance,expectedBalanceVersion:index+1,baseQuantity:"5"};
    await f.invoke("ALLOCATE",{fulfillmentId:"1",lines:[line]},10+index);
  }
  const [rows]=await f.db.query("SELECT reason_text FROM inventory_audit_logs ORDER BY id");
  assert.deepEqual(rows.map(row=>row.reason_text),["原".repeat(5),"原".repeat(500)]);
  const [[before]]=await f.db.query("SELECT COUNT(*) AS n FROM inventory_operation_requests");
  const bad=structuredClone(f.lines[0]);bad.reservations[0].overrideReason="原".repeat(501);
  await assert.rejects(f.invoke("ALLOCATE",{fulfillmentId:"1",lines:[bad]},12),{code:"INVENTORY_INPUT_INVALID"});
  assert.deepEqual((await f.db.query("SELECT COUNT(*) AS n FROM inventory_operation_requests"))[0][0],before);
});

nativeTest("P0 native FEFO override requires a fresh specialist permission as well as a reason",async t=>{
  const f=await fixture(t),balances=[];
  await f.db.execute("UPDATE item_skus SET tracking_policy='batch_expiry' WHERE id=?",[f.skuId]);
  for(const [index,expiry]of ["2026-11-01","2026-12-01"].entries()) {
    const lot=await f.insert("INSERT INTO inventory_lots(sku_id,lot_number,normalized_lot_number,expiry_date,first_receipt_date,sku_code_snapshot,created_at) VALUES(?,?,?,?, '2026-10-01','SYN',1)",[f.skuId,`LOT${index}`,`lot${index}`,expiry]);
    balances.push(await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,lot_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,?,'AVAILABLE',20,'2026-10-01',1,1)",[f.warehouseId,f.binId,f.skuId,lot]));
  }
  const line=structuredClone(f.lines[0]);line.reservations[0].allocations[0].inventoryBalanceId=balances[1];
  await assert.rejects(f.invoke("ALLOCATE",{fulfillmentId:"1",lines:[line]},13),{code:"FEFO_OVERRIDE_REQUIRED"});
  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE p.name='inventory.fefo.override'");
  f.actor.claimedPermissions.splice(f.actor.claimedPermissions.indexOf("inventory.fefo.override"),1);
  line.reservations[0].overrideReason="Customer batch requirement";
  await assert.rejects(f.invoke("ALLOCATE",{fulfillmentId:"1",lines:[line]},14),{code:"FEFO_OVERRIDE_DENIED"});
  await f.db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ur.role_id,p.id FROM user_roles ur JOIN permissions p ON p.name='inventory.fefo.override' WHERE ur.user_id=?",[f.actor.userId]);
  f.actor.claimedPermissions.push("inventory.fefo.override");
  const result=await f.invoke("ALLOCATE",{fulfillmentId:"1",lines:[line]},15),allocation=result.lines[0].reservations[0].allocations[0];
  assert.equal(allocation.selectionStrategy,"FEFO");assert.equal(allocation.recommendedRank,2);
  assert.deepEqual(allocation.recommendedSummary,{recommendedBalanceId:balances[0],recommendedExpiryDate:"2026-11-01",selectedBalanceId:balances[1],selectedExpiryDate:"2026-12-01"});
  const [[audit]]=await f.db.query("SELECT COUNT(*) AS n FROM inventory_audit_logs WHERE action='fefo.override'");assert.equal(Number(audit.n),1);
});

nativeTest("P0 locked Inventory current-state projection proves native quantities, original source and current CAS",async t=>{
  const f=await fixture(t),lookup=new InventoryLookupService({...f,fulfillment:f.service}),first=f.lines[0].reservations[0];
  await f.invoke("ALLOCATE",{fulfillmentId:"1",lines:f.lines},18);
  const query={warehouseId:f.warehouseId,salesOrderId:"1",members:[{inventoryReservationId:first.inventoryReservationId,salesOrderLineId:f.lines[0].salesOrderLineId,skuId:f.skuId}]};
  await assert.rejects(f.withActor(tx=>lookup.lockFulfillmentReservationStatesInTransaction(tx,query)));
  await f.withActor(async tx=>{
    const [state]=await lookup.lockFulfillmentReservationStatesInTransaction(tx,query);
    assert.equal(state.version,2);assert.equal(state.outstandingQuantity,"5");assert.equal(state.consumedQuantity,"0");
    assert.equal(state.salesOrderId,"1");assert.equal(state.salesOrderLineId,f.lines[0].salesOrderLineId);
    assert.ok(Object.isFrozen(state));assert.ok(state.originalInventoryOperationId);assert.ok(state.originalSourceEventId);
    for(const bad of [{...query,salesOrderId:"999"},{...query,members:[{...query.members[0],salesOrderLineId:"999"}]},{...query,members:[{...query.members[0],skuId:"999"}]}])await assert.rejects(lookup.lockFulfillmentReservationStatesInTransaction(tx,bad),{code:"INVENTORY_SOURCE_CONFLICT"});
  },{isolationLevel:"READ COMMITTED"});
});

nativeTest("P0 legal5000-Reservation membership does not narrow100-line/5000-leg capacity",{timeout:90000},async t=>{
  const f=await fixture(t),balances=[],lines=[];
  await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=0,fifo_anchor_date=NULL WHERE id=?",[f.balanceId]);
  for(let i=0;i<50;i++) {
    const code=`MEM${String(i).padStart(2,"0")}`,bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,?,?,1,1)",[f.warehouseId,code,code.toLowerCase()]);
    balances.push(await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',100,'2026-10-01',1,1)",[f.warehouseId,bin,f.skuId]));
  }
  for(let i=0;i<100;i++) {
    const line={fulfillmentLineId:String(1000+i),salesOrderLineId:String(2000+i),baseQuantity:"50",reservations:[]};
    for(let j=0;j<50;j++) {
      const ordinal=i*50+j;
      line.reservations.push({claimId:String(10000+ordinal),inventoryReservationId:await f.reservation(line.salesOrderLineId,"1",`seed-${ordinal}`),expectedVersion:1,baseQuantity:"1",overrideReason:"",allocations:[{inventoryBalanceId:balances[Math.floor(ordinal/100)],expectedBalanceVersion:1,baseQuantity:"1"}]});
    }
    lines.push(line);
  }
  const metrics={queries:0,heap:process.memoryUsage().heapUsed};
  const instrument=tx=>{for(const method of ["query","execute"]){const execute=tx[method].bind(tx);tx[method]=(...args)=>{metrics.queries++;if(metrics.queries%100===0)metrics.heap=Math.max(metrics.heap,process.memoryUsage().heapUsed);return execute(...args);};}};
  const start=performance.now(),result=await f.invoke("ALLOCATE",{fulfillmentId:"1",lines},16,instrument),elapsed=performance.now()-start;
  assert.equal(result.lines.flatMap(l=>l.reservations).length,5000);
  assert.ok(result.lines.every(l=>l.reservations.every(m=>m.version===2)));
  const moved={fulfillmentId:"1",lines:result.lines.map(line=>({...line,reservations:line.reservations.map(m=>({claimId:m.claimId,inventoryReservationId:m.inventoryReservationId,expectedVersion:2,baseQuantity:"1",overrideReason:"",
    releases:m.allocations.map(a=>({inventoryAllocationId:a.inventoryAllocationId,inventoryBalanceId:a.inventoryBalanceId,expectedVersion:1,expectedBalanceVersion:101,baseQuantity:"1"})),
    allocations:m.allocations.map(a=>({inventoryBalanceId:a.inventoryBalanceId,expectedBalanceVersion:101,baseQuantity:"1"}))}))}))};
  const before=performance.now(),reallocated=await f.invoke("REALLOCATE",moved,17,instrument),reallocateMs=performance.now()-before;
  assert.equal(reallocated.lines.flatMap(l=>l.reservations).length,5000);
  assert.ok(reallocated.lines.every(l=>l.reservations.every(m=>m.version===3)));
  t.diagnostic(`5000 members: allocate=${Math.round(elapsed)}ms, reallocate=${Math.round(reallocateMs)}ms, txQueries=${metrics.queries}, sampledMaxHeap=${metrics.heap}, configured transactionTimeoutMs=20000`);
});
