import assert from "node:assert/strict";
import test from "node:test";
import {inventoryNativeFixture} from "../fulfillment/inventoryNativeFixture.js";
import {InventoryLockService} from "../../src/modules/inventory/InventoryLockService.js";
import {loadInventoryCandidates,hasPreStocktakeCandidateProof} from "../../src/modules/inventory/InventoryPickSequenceService.js";
import {postingCandidatePages} from "../../src/modules/inventory/inventoryFulfillmentCandidatePages.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const args=f=>({warehouseId:Number(f.warehouseId),skuId:Number(f.skuId),currentDate:f.time.fileDate(),minimumRemainingDays:0,trackingPolicy:"none",offset:0,limit:100});
nativeTest("posting reuse is active-executor bound and Warehouse anchor excludes concurrent candidate writers",async t=>{
 const f=await inventoryNativeFixture(t);let closed;
 await f.withActor(async tx=>{
  closed=tx;const locked=await new InventoryLockService().lockForCommand(tx,{warehouseIds:[Number(f.warehouseId)]});assert.equal(locked.warehouses.length,1);
  const [[b]]=await tx.query("SELECT * FROM inventory_stock_balances WHERE id=?",[f.balanceId]);let reads=0;
  const read=postingCandidatePages(new Map([[f.balanceId,b]]),async(...input)=>{reads++;return loadInventoryCandidates(...input);});
  assert.equal(hasPreStocktakeCandidateProof(tx),false);assert.equal((await read(tx,args(f)))[0].freeQuantity,20);assert.equal(hasPreStocktakeCandidateProof(tx),true);
  await f.withActor(async other=>{assert.notEqual(other,tx);await assert.rejects(other.query("SELECT id FROM inventory_warehouses WHERE id=? FOR UPDATE NOWAIT",[f.warehouseId]),error=>(error.cause?.code??error.code)==="ER_LOCK_NOWAIT");},{isolationLevel:"READ COMMITTED"});
  await tx.execute("UPDATE inventory_stock_balances SET allocated_quantity=1,version=version+1 WHERE id=? AND version=1",[f.balanceId]);b.allocated_quantity=1;b.version=2;
  const next=await read(tx,args(f));assert.equal(next[0].freeQuantity,19);assert.equal(next[0].version,2);assert.equal(reads,1);
 },{isolationLevel:"READ COMMITTED"});
 assert.equal(hasPreStocktakeCandidateProof(closed),false);
});
nativeTest("posting preserves present-Stocktake fresh reads and partial-schema rejection",async t=>{
 const f=await inventoryNativeFixture(t);
 await f.db.execute("CREATE TABLE inventory_stocktakes(id BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB");
 await f.db.execute("CREATE TABLE inventory_bin_locks(id BIGINT UNSIGNED PRIMARY KEY,bin_id BIGINT UNSIGNED NOT NULL,released_at BIGINT NULL) ENGINE=InnoDB");
 await f.withActor(async tx=>{let reads=0;const read=postingCandidatePages(new Map(),async(...input)=>{reads++;return loadInventoryCandidates(...input);});await read(tx,args(f));await read(tx,args(f));assert.equal(reads,2);assert.equal(hasPreStocktakeCandidateProof(tx),false);},{isolationLevel:"READ COMMITTED"});
 await f.db.execute("DROP TABLE inventory_bin_locks");
 await f.withActor(async tx=>{const read=postingCandidatePages(new Map());await assert.rejects(read(tx,args(f)),error=>(error.cause?.code??error.code)==="ER_NO_SUCH_TABLE");assert.equal(hasPreStocktakeCandidateProof(tx),false);},{isolationLevel:"READ COMMITTED"});
});
