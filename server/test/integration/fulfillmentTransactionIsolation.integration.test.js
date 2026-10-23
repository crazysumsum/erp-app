import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import { inventoryNativeFixture } from "../fulfillment/inventoryNativeFixture.js";
import { FulfillmentTransactionService,assertFulfillmentTransaction } from "../../src/modules/fulfillment/FulfillmentTransactionService.js";
import { getActiveTransactionIsolation } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { loadInventoryCandidates } from "../../src/modules/inventory/InventoryPickSequenceService.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
nativeTest("HD010 owned production executor uses localized RC and sees fresh serialized candidates after an earlier plain read",async t=>{
  const f=await inventoryNativeFixture(t),transactions=new FulfillmentTransactionService({database:f.database});
  let transaction;
  await f.context.storage.run({databaseTransaction:null},()=>transactions.withTransaction(async tx=>{
    transaction=tx;assert.equal(getActiveTransactionIsolation(tx),"READ COMMITTED");
    const [[session]]=await tx.query("SELECT @@session.transaction_isolation AS isolation");
    assert.equal(session.isolation,"REPEATABLE-READ","localized next-transaction policy must not modify session defaults");
    await tx.query("SELECT on_hand_quantity FROM inventory_stock_balances WHERE id=?",[f.balanceId]);
    const writer=await mysql.createConnection({...f.options,database:f.name});
    try {
      await writer.beginTransaction();
      await writer.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE",[f.warehouseId]);
      await writer.execute("UPDATE inventory_stock_balances SET on_hand_quantity=30,version=version+1 WHERE id=?",[f.balanceId]);
      await writer.commit();
    } finally { await writer.end(); }
    await tx.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE",[f.warehouseId]);
    const candidates=await loadInventoryCandidates(tx,{warehouseId:Number(f.warehouseId),skuId:Number(f.skuId),currentDate:f.time.fileDate(),minimumRemainingDays:0,trackingPolicy:"none",limit:101});
    assert.equal(candidates[0].freeQuantity,30);
    assert.equal(candidates[0].version,2);
    assert.equal(assertFulfillmentTransaction(f.database,tx),tx);
    assert.throws(()=>assertFulfillmentTransaction(f.database,{...tx}),TypeError);
  }));
  assert.equal(getActiveTransactionIsolation(transaction),null);
  assert.throws(()=>assertFulfillmentTransaction(f.database,transaction),TypeError);
  await f.withActor(async tx=>{assert.equal(getActiveTransactionIsolation(tx),"REPEATABLE READ");assert.throws(()=>assertFulfillmentTransaction(f.database,tx),TypeError);});
});
