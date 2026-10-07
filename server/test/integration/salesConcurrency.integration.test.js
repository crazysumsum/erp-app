import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {setup,stock} from "../sales/phase2/fixtures.js";
import {createTestCurrency} from "../sales/phase1/fixtures.js";
import {reconcileCommitments} from "../sales/phase2/commitmentReconciliation.js";
import {SalesOrderService} from "../../src/modules/sales/SalesOrderService.js";
import {InventoryReservationService} from "../../src/modules/inventory/InventoryReservationService.js";
const it=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip,zero={conservation:0,mappings:0,queue:0,flags:0,reservations:0,controls:0};
for(const count of [20,100])it(`TC-021 ${count} true concurrent SOs conserve one Warehouse/SKU ATP and reconcile without repair`,async t=>{
 const f=await setup(t);await stock(f,count*5);const order=new SalesOrderService(f),requests=[f.request];f.customerIds=[f.customerId];
 // Different real Customers/currencies reach the shared stock lock concurrently; their existing master locks otherwise serialize calls before Inventory.
 for(let i=1;i<count;i++){const code=`concurrent-${randomUUID()}`,currencyCode=await createTestCurrency(f.db,f.cleanup,f.now);await f.db.execute("UPDATE currencies SET status='ACTIVE' WHERE code=?",[currencyCode]);const customerId=await f.insert("customers",{customer_code:code,customer_code_key:code,legal_name:code,legal_name_key:code,default_currency_code:currencyCode,status:"active",version:1,created_at:f.now,updated_at:f.now});f.customerIds.push(customerId);f.beforeParents.push(()=>f.db.execute("DELETE FROM sales_orders WHERE customer_id=?",[customerId]));const created=await order.create({claims:f.claims,input:{eventId:randomUUID(),customerId,currencyCode,fulfillmentWarehouseId:f.warehouseId,orderDate:f.time.fileDate(),lines:[{skuId:f.skuId,skuUomId:f.skuUomId,quantity:"10.000000",unitSellingPrice:"1.0000"}]}});requests.push({claims:f.claims,id:created.salesOrder.id,input:{eventId:randomUUID(),version:1}});}
 const intents=await Promise.all(requests.map(request=>f.service().startConfirmation(request))),provider=new InventoryReservationService(f);let active=0,peak=0;
 const inventory={async reserveAvailableForSalesBatchInTransaction(...args){active++;peak=Math.max(peak,active);try{return await provider.reserveAvailableForSalesBatchInTransaction(...args);}finally{active--;}}};
 const results=await Promise.all(intents.map(intent=>f.service({inventory}).completeConfirmation({eventId:intent.eventId,claims:f.claims,leaseOwner:intent.leaseOwner})));assert.equal(results.length,count);assert.ok(peak>1,"real concurrent provider calls must overlap");assert.ok(results.every(result=>result.salesOrder.status==="CONFIRMED"));
 const [[quantities]]=await f.db.query("SELECT SUM(l.ordered_base_quantity) AS ordered,SUM(l.reserved_outstanding_base_quantity) AS reserved,SUM(l.backordered_base_quantity) AS backordered FROM sales_order_lines l JOIN sales_orders o ON o.id=l.sales_order_id WHERE o.fulfillment_warehouse_id=?",[f.warehouseId]);assert.equal(Number(quantities.ordered),count*10);assert.equal(Number(quantities.reserved),count*5);assert.equal(Number(quantities.backordered),count*5);
 const [[balance]]=await f.db.query("SELECT MIN(on_hand_quantity-allocated_quantity) AS available FROM inventory_stock_balances WHERE warehouse_id=?",[f.warehouseId]);assert.ok(Number(balance.available)>=0);const [[control]]=await f.db.query("SELECT reserved_quantity FROM inventory_stock_controls WHERE warehouse_id=? AND sku_id=?",[f.warehouseId,f.skuId]);assert.equal(control.reserved_quantity,count*5);
 const report=await reconcileCommitments(f);assert.equal(report.orders,count);assert.equal(report.lines,count);assert.deepEqual(report.mismatches,zero);t.diagnostic(`synthetic concurrentOrders=${count} peakProviderCalls=${peak} reconciliationMismatches=0`);
});

it("TC-031 read-only reconciliation detects every seeded projection mismatch and leaves its facts untouched",async t=>{
 const f=await setup(t);await stock(f,4);const intent=await f.service().startConfirmation(f.request);await f.service().completeConfirmation({eventId:intent.eventId,claims:f.claims,leaseOwner:intent.leaseOwner});
 const zero={conservation:0,mappings:0,queue:0,flags:0,reservations:0,controls:0};assert.deepEqual((await reconcileCommitments(f)).mismatches,zero);
 const [[line]]=await f.db.query("SELECT id FROM sales_order_lines WHERE sales_order_id=?",[f.request.id]);
 const faults={conservation:["UPDATE sales_order_lines SET ordered_base_quantity=11 WHERE id=?",line.id],mappings:["UPDATE sales_order_lines SET reserved_outstanding_base_quantity=3,backordered_base_quantity=7 WHERE id=?",line.id],queue:["UPDATE sales_backorder_entries SET outstanding_base_quantity=5 WHERE sales_order_id=?",f.request.id],flags:["UPDATE sales_orders SET has_backorder=0,backorder_line_count=0 WHERE id=?",f.request.id],reservations:["UPDATE inventory_reservations SET consumed_quantity=1,outstanding_quantity=3,status='PARTIALLY_CONSUMED' WHERE warehouse_id=?",f.warehouseId],controls:["UPDATE inventory_stock_controls SET reserved_quantity=3 WHERE warehouse_id=?",f.warehouseId]};
 for(const [category,[sql,id]] of Object.entries(faults)){
  const rollback=Error(`rollback owned ${category} detector fixture`);
  await assert.rejects(()=>f.database.withTransaction(async tx=>{
   await tx.execute(sql,[id]);const readOnly={...f,db:{query(statement,params){assert.match(statement,/^SELECT\s/u,"The checker must never repair its fixture");return tx.query(statement,params);}}};
   const before=await reconcileCommitments(readOnly);assert.ok(before.mismatches[category]>0,`${category} mismatch must be detected`);assert.deepEqual(await reconcileCommitments(readOnly),before);throw rollback;
  }),error=>(error.cause??error)===rollback);
  assert.deepEqual((await reconcileCommitments(f)).mismatches,zero,`${category} fixture must be rolled back`);
 }
});
