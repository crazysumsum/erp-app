import assert from "node:assert/strict";
import test from "node:test";
import { fixture, document } from "../fulfillment/aggregateFixture.js";
import { FulfillmentLockService } from "../../src/modules/fulfillment/FulfillmentLockService.js";
import { ItemLookupService } from "../../src/modules/item/ItemLookupService.js";
import { InventoryFulfillmentService } from "../../src/modules/inventory/InventoryFulfillmentService.js";
import { InventoryLookupService } from "../../src/modules/inventory/InventoryLookupService.js";
const nativeTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
async function setup(t) {
  const f = await fixture(t);
  await f.db.execute("UPDATE item_skus SET inventory_tracked=1 WHERE id=?", [f.s.skuId]);
  await f.s.insert("inventory_stock_controls", { warehouse_id: f.s.warehouseId, sku_id: f.s.skuId, reserved_quantity: 1, created_at: f.s.now, updated_at: f.s.now });
  const item = new ItemLookupService({ database: f.database, time: f.time, logger: {} });
  const inventory = new InventoryFulfillmentService({ database: f.database, time: f.time, logger: { error(){} } });
  const locks = new FulfillmentLockService({ database: f.database, sales: f.service, itemLookup: item, inventoryLookup: new InventoryLookupService({ fulfillment: inventory, time: f.time }), time: f.time });
  const intent = f.command(); intent.purpose = "CLAIM"; intent.claimMode = "PENDING_CREATE";
  for (const key of ["eventId", "shipmentId", "inventoryRequestHash"]) delete intent[key];
  intent.lines[0].reservations[0].claimId = null;
  return { ...f, locks, intent };
}
const lock = f => f.run({ claims: f.claims }, tx => f.locks.lockPendingClaimCapacityInTransaction(tx, { salesIntent: f.intent }));
async function firstFullyClaimedAndSecondAvailable(f) {
  const doc = await document(f);
  await f.s.insert("fulfillment_line_reservation_claims", { fulfillment_id: doc.id, fulfillment_line_id: doc.line, sales_order_line_reservation_id: f.mappingId, inventory_reservation_id: f.reservationId, original_claimed_quantity: 1, active_claimed_quantity: 1, status: "ACTIVE", inventory_version: 1, created_at: f.s.now, updated_at: f.s.now });
  const event = crypto.randomUUID();
  const root = await f.s.insert("inventory_operation_requests", { command_type: "SALES_BACKORDER_BATCH_RESERVE", source_module: "SALES", source_document_type: "SALES_ORDER", source_document_id: String(f.s.orderId), source_event_id: event, request_hash: "a".repeat(64), actor_label: f.label, created_at: f.s.now });
  const child = await f.s.insert("inventory_operation_requests", { command_type: "SALES_BACKORDER_LINE_RESERVE", source_module: "SALES", source_document_type: "SALES_ORDER", source_document_id: String(f.s.orderId), source_line_id: String(f.s.lineId), source_event_id: event, request_hash: "a".repeat(64), actor_label: f.label, created_at: f.s.now });
  const reservation = await f.s.insert("inventory_reservations", { create_operation_id: child, warehouse_id: f.s.warehouseId, sku_id: f.s.skuId, original_quantity: 1, outstanding_quantity: 1, purpose: "SALE", status: "ACTIVE", created_at: f.s.now, updated_at: f.s.now });
  const mapping = await f.s.insert("sales_order_line_reservations", { sales_order_line_id: f.s.lineId, inventory_reservation_id: reservation, inventory_operation_id: root, source_event_id: event, original_base_quantity: 1, outstanding_base_quantity: 1, status: "ACTIVE", inventory_version: 1, created_at: f.s.now, updated_at: f.s.now });
  await f.db.execute("UPDATE sales_order_lines SET ordered_quantity=2,ordered_base_quantity=2,reserved_outstanding_base_quantity=2,line_amount=2,version=version+1 WHERE id=?", [f.s.lineId]);
  await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=2,version=version+1 WHERE warehouse_id=? AND sku_id=?", [f.s.warehouseId, f.s.skuId]);
  f.intent.lines[0].expectedVersion++;
  return { reservation: String(reservation), mapping: String(mapping) };
}
nativeTest("HD016 pending capacity proves current owners without persisting a placeholder Claim or document", async t => {
  const f = await setup(t), result = await lock(f);
  assert.equal(result.sales.orderId, String(f.s.orderId));
  assert.equal(result.lines[0].claims[0].salesReservationMappingId, String(f.mappingId));
  assert.equal(result.lines[0].claims[0].baseQuantity, "1");
  assert.equal(result.lines[0].claims[0].inventoryVersion, 1);
  assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fulfillments"))[0][0].n), 0);
  assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_line_reservation_claims"))[0][0].n), 0);
});
nativeTest("HD016 final mapping-ID distribution uses locked Claims instead of the preflight tentative member", async t => {
  const f = await setup(t), second = await firstFullyClaimedAndSecondAvailable(f), result = await lock(f);
  assert.equal(f.intent.lines[0].reservations[0].inventoryReservationId, String(f.reservationId));
  assert.equal(result.lines[0].claims[0].inventoryReservationId, second.reservation);
  assert.equal(result.lines[0].claims[0].salesReservationMappingId, second.mapping);
});
nativeTest("HD016 fully claimed first mapping with native drift is not hidden by available later mappings", async t => {
  const f = await setup(t); await firstFullyClaimedAndSecondAvailable(f);
  await f.db.execute("UPDATE inventory_reservations SET outstanding_quantity=0,released_quantity=1,version=version+1 WHERE id=?", [f.reservationId]);
  await assert.rejects(() => lock(f), { code: "FULFILLABLE_QUANTITY_CHANGED" });
});
nativeTest("HD016 pending capacity preserves last-sync/current separation and rejects stale order/line or persisted-mode calls", async t => {
  const f = await setup(t);
  await f.db.execute("UPDATE inventory_reservations SET version=version+1 WHERE id=?", [f.reservationId]);
  assert.equal((await lock(f)).lines[0].claims[0].inventoryVersion, 2);
  f.intent.expectedOrderVersion++; await assert.rejects(() => lock(f), { code: "SALES_FULFILLMENT_CONTRACT_MISMATCH" }); f.intent.expectedOrderVersion--;
  f.intent.lines[0].expectedVersion++; await assert.rejects(() => lock(f), { code: "SALES_FULFILLMENT_CONTRACT_MISMATCH" }); f.intent.lines[0].expectedVersion--;
  delete f.intent.claimMode; f.intent.lines[0].reservations[0].claimId = "1"; await assert.rejects(() => lock(f), error => error.cause instanceof TypeError);
});

nativeTest("HD016 a bound pending Sales lock can never be used as a Shipment apply receipt", async t => {
  const f = await setup(t);
  await f.run({ claims: f.claims }, async tx => {
    await f.locks.lockPendingClaimCapacityInTransaction(tx, { salesIntent: f.intent });
    await assert.rejects(() => f.service.applyFulfillmentResultInTransaction(tx, { intent: f.intent, inventoryResult: { lines: [] } }), { code: "SALES_FULFILLMENT_CONTRACT_MISMATCH" });
  });
});

nativeTest("HD016 equal outstanding does not conceal changed original/released counters or original source event", async t => {
  const f = await setup(t);
  await f.db.execute("UPDATE inventory_reservations SET original_quantity=2,released_quantity=1,version=version+1 WHERE id=?", [f.reservationId]);
  await assert.rejects(() => lock(f), { code: "FULFILLABLE_QUANTITY_CHANGED" });
  await f.db.execute("UPDATE inventory_reservations SET original_quantity=1,released_quantity=0,version=version+1 WHERE id=?", [f.reservationId]);
  const [[reservation]] = await f.db.query("SELECT create_operation_id FROM inventory_reservations WHERE id=?", [f.reservationId]);
  await f.db.execute("UPDATE inventory_operation_requests SET source_event_id=? WHERE id=?", [crypto.randomUUID(), reservation.create_operation_id]);
  await assert.rejects(() => lock(f), { code: "FULFILLABLE_QUANTITY_CHANGED" });
});
nativeTest("HD016 5001 source mappings support planned one and fully claimed earlier 5000 without shrinking the command limit", { timeout: 120000 }, async t => {
  const f = await setup(t), operations = [], reservations = [], mappings = [];
  let op = Number((await f.db.query("SELECT MAX(id) AS id FROM inventory_operation_requests"))[0][0].id) + 1;
  let res = Number((await f.db.query("SELECT MAX(id) AS id FROM inventory_reservations"))[0][0].id) + 1;
  for (let i = 0; i < 5000; i++) {
    const root = op++, child = op++, id = res++, event = crypto.randomUUID();
    operations.push([root,"SALES_BACKORDER_BATCH_RESERVE","SALES","SALES_ORDER",String(f.s.orderId),"",event,"a".repeat(64),f.label,f.s.now],[child,"SALES_BACKORDER_LINE_RESERVE","SALES","SALES_ORDER",String(f.s.orderId),String(f.s.lineId),event,"a".repeat(64),f.label,f.s.now]);
    reservations.push([id,child,f.s.warehouseId,f.s.skuId,1,1,"SALE","ACTIVE",f.s.now,f.s.now]);
    mappings.push([f.s.lineId,id,root,event,1,1,"ACTIVE",1,f.s.now,f.s.now]);
  }
  for(let i=0;i<operations.length;i+=100)await f.db.query("INSERT INTO inventory_operation_requests(id,command_type,source_module,source_document_type,source_document_id,source_line_id,source_event_id,request_hash,actor_label,created_at) VALUES ?",[operations.slice(i,i+100)]);
  for(let i=0;i<reservations.length;i+=100)await f.db.query("INSERT INTO inventory_reservations(id,create_operation_id,warehouse_id,sku_id,original_quantity,outstanding_quantity,purpose,status,created_at,updated_at) VALUES ?",[reservations.slice(i,i+100)]);
  for(let i=0;i<mappings.length;i+=100)await f.db.query("INSERT INTO sales_order_line_reservations(sales_order_line_id,inventory_reservation_id,inventory_operation_id,source_event_id,original_base_quantity,outstanding_base_quantity,status,inventory_version,created_at,updated_at) VALUES ?",[mappings.slice(i,i+100)]);
  await f.db.execute("UPDATE sales_order_lines SET ordered_quantity=5001,ordered_base_quantity=5001,reserved_outstanding_base_quantity=5001,line_amount=5001,version=version+1 WHERE id=?",[f.s.lineId]);f.intent.lines[0].expectedVersion++;
  await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=5001,version=version+1 WHERE warehouse_id=? AND sku_id=?",[f.s.warehouseId,f.s.skuId]);
  assert.equal((await lock(f)).lines[0].claims[0].inventoryReservationId,String(f.reservationId));
  const [all] = await f.db.query("SELECT id,inventory_reservation_id FROM sales_order_line_reservations ORDER BY id");
  const scope={warehouseId:String(f.s.warehouseId),salesOrderId:String(f.s.orderId),members:all.map(mapping=>({inventoryReservationId:String(mapping.inventory_reservation_id),salesOrderLineId:String(f.s.lineId),skuId:String(f.s.skuId)}))};
  await f.run({claims:f.claims},async tx=>{
    await assert.rejects(()=>f.locks.inventoryLookup.lockFulfillmentReservationStatesInTransaction(tx,scope),{code:"INVENTORY_INPUT_INVALID"});
    await assert.rejects(()=>f.locks.inventoryLookup.lockFulfillmentReservationScopeInTransaction(tx,{...scope,completeScope:true}),{code:"INVENTORY_INPUT_INVALID"});
  });

  for(let group=0;group<100;group++){
    const doc=await document(f,`FUL-202610-${String(group+1).padStart(6,"0")}`);
    await f.db.execute("UPDATE fulfillment_lines SET planned_base_quantity=50,version=version+1 WHERE id=?",[doc.line]);
    const rows=all.slice(group*50,group*50+50).map(mapping=>[doc.id,doc.line,mapping.id,mapping.inventory_reservation_id,1,1,"ACTIVE",1,f.s.now,f.s.now]);
    await f.db.query("INSERT INTO fulfillment_line_reservation_claims(fulfillment_id,fulfillment_line_id,sales_order_line_reservation_id,inventory_reservation_id,original_claimed_quantity,active_claimed_quantity,status,inventory_version,created_at,updated_at) VALUES ?",[rows]);
  }
  const statements=[];
  const result=await f.run({claims:f.claims},async tx=>{
    const query=tx.query.bind(tx);tx.query=(sql,args)=>{statements.push({sql,args});return query(sql,args);};
    return f.locks.lockPendingClaimCapacityInTransaction(tx,{salesIntent:f.intent});
  });
  assert.equal(result.lines[0].claims[0].inventoryReservationId,String(all.at(-1).inventory_reservation_id));
  const locks=statements.filter(({sql})=>/FROM inventory_reservations WHERE id IN.*FOR UPDATE/u.test(sql));
  assert.equal(locks.length,11);assert.ok(locks.every(({args})=>args.length<=500));
  const ids=locks.flatMap(({args})=>args);assert.deepEqual(ids,[...ids].sort((a,b)=>a-b));
  const first=statements.findIndex(({sql})=>/FROM inventory_reservations WHERE id IN.*FOR UPDATE/u.test(sql));
  assert.ok(first>0);assert.ok(statements.slice(0,first).some(({sql})=>/FROM inventory_warehouses.*FOR UPDATE/u.test(sql)));
  assert.ok(!statements.slice(first+1).some(({sql})=>/FROM inventory_warehouses.*FOR UPDATE|FROM inventory_stock_controls.*FOR UPDATE/u.test(sql.replaceAll("\n"," "))));
});
