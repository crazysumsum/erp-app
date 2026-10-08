import assert from "node:assert/strict";
import test from "node:test";
import {migrationFixture} from "../sales/phase1/fixtures.js";
import {CustomerLookupService} from "../../src/modules/customer/CustomerLookupService.js";
import {ItemLookupService} from "../../src/modules/item/ItemLookupService.js";
const integrationTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
integrationTest("TC-035 owner precheck batches resolve actual DB collation and preserve missing/inactive without business writes",async t=>{
 const f=await migrationFixture(t,[]),[[sku]]=await f.db.query("SELECT sku_code FROM item_skus WHERE id=?",[f.skuId]),[[uom]]=await f.db.query("SELECT code FROM item_uoms WHERE id=(SELECT uom_id FROM item_sku_uoms WHERE id=?)",[f.skuUomId]);
 let queries=0;const tx={query(...args){queries++;return f.db.query(...args);}},customers=new CustomerLookupService({database:f.db}),items=new ItemLookupService({database:f.db,time:{nowMs:()=>f.now},logger:{error:async()=>{}}});
 const snapshots=await customers.getSalesPrecheckSnapshotsInTransaction(tx,[f.customerId,Number.MAX_SAFE_INTEGER]);assert.equal(queries,1);assert.equal(snapshots.get(f.customerId).status,"active");assert.equal(snapshots.get(Number.MAX_SAFE_INTEGER),null);
 const codes=[{skuCode:sku.sku_code.toUpperCase(),salesUomCode:uom.code.toUpperCase()},{skuCode:sku.sku_code,salesUomCode:"MISSING"},{skuCode:"MISSING",salesUomCode:uom.code}];
 queries=0;const resolved=await items.resolveSaleCodesInTransaction(tx,codes);assert.equal(queries,1);assert.equal(resolved[0].sku.skuId,f.skuId);assert.equal(resolved[0].salesUom.skuUomId,f.skuUomId);assert.equal(resolved[1].salesUom,null);assert.equal(resolved[2].sku,null);
 await f.db.execute("UPDATE item_skus SET status='discontinued' WHERE id=?",[f.skuId]);await f.db.execute("UPDATE customers SET status='blocked' WHERE id=?",[f.customerId]);
 assert.equal((await items.resolveSaleCodesInTransaction(tx,[codes[0]]))[0].sku.usable,false);assert.equal((await customers.getSalesPrecheckSnapshotsInTransaction(tx,[f.customerId])).get(f.customerId).status,"blocked");
 const [[effects]]=await f.db.query("SELECT (SELECT COUNT(*) FROM sales_orders WHERE customer_id=?) AS orders,(SELECT COUNT(*) FROM inventory_reservations WHERE sku_id=?) AS reservations",[f.customerId,f.skuId]);assert.equal(effects.orders,0);assert.equal(effects.reservations,0);
});
