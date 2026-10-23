import assert from "node:assert/strict";
import test from "node:test";
import { inventoryNativeFixture } from "../fulfillment/inventoryNativeFixture.js";
import { loadInventoryCandidates } from "../../src/modules/inventory/InventoryPickSequenceService.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const input=f=>({warehouseId:Number(f.warehouseId),skuId:Number(f.skuId),currentDate:f.time.fileDate(),minimumRemainingDays:0,trackingPolicy:"none",limit:100});
function countQueries(tx) {
  const counts={checks:0,lockQueries:0},query=tx.query.bind(tx);
  tx.query=(sql,...args)=>{if(sql.includes("information_schema.tables"))counts.checks++;if(sql.includes("NOT EXISTS"))counts.lockQueries++;return query(sql,...args);};
  return counts;
}
nativeTest("P0 candidate schema absence is reused only within one real transaction while quantities stay current",async t=>{
  const f=await inventoryNativeFixture(t);
  for(let i=0;i<2;i++)await f.withActor(async tx=>{
    const counts=countQueries(tx),first=await loadInventoryCandidates(tx,input(f));
    assert.equal(first[0].freeQuantity,20-i);
    await tx.execute("UPDATE inventory_stock_balances SET allocated_quantity=allocated_quantity+1,version=version+1 WHERE id=?",[f.balanceId]);
    const second=await loadInventoryCandidates(tx,input(f));assert.equal(second[0].freeQuantity,19-i);assert.equal(second[0].version,2+i);
    assert.deepEqual(counts,{checks:1,lockQueries:1});
  },{isolationLevel:"READ COMMITTED"});
});
nativeTest("P0 candidate schema proof is not reusable through autocommit or forged transaction metadata",async t=>{
  const f=await inventoryNativeFixture(t),fake={isolationLevel:"READ COMMITTED",query:f.db.query.bind(f.db)},counts=countQueries(fake);
  await loadInventoryCandidates(fake,input(f));await loadInventoryCandidates(fake,input(f));
  assert.deepEqual(counts,{checks:2,lockQueries:2});
});
nativeTest("P0 a new transaction rejects either partial Stocktake schema after an earlier absence proof",async t=>{
  const f=await inventoryNativeFixture(t);
  await f.withActor(tx=>loadInventoryCandidates(tx,input(f)),{isolationLevel:"READ COMMITTED"});
  for(const table of ["inventory_stocktakes","inventory_bin_locks"]) {
    await f.db.execute(`CREATE TABLE ${table}(id BIGINT PRIMARY KEY)`);
    try{await assert.rejects(f.withActor(tx=>loadInventoryCandidates(tx,input(f)),{isolationLevel:"READ COMMITTED"}),error=>["ER_NO_SUCH_TABLE","ER_BAD_FIELD_ERROR"].includes(error.cause?.code));}
    finally{await f.db.execute(`DROP TABLE ${table}`);}
  }
});
nativeTest("P0 candidate schema checks do not hide unknown errors or cache failed absence inspection",async t=>{
  const f=await inventoryNativeFixture(t);
  await f.withActor(async tx=>{
    const query=tx.query.bind(tx);let inspectionFails=true,checks=0;
    tx.query=(sql,...args)=>{if(sql.includes("information_schema.tables")){checks++;if(inspectionFails)throw Object.assign(new Error("synthetic inspection failure"),{code:"ER_TABLEACCESS_DENIED_ERROR"});}return query(sql,...args);};
    await assert.rejects(loadInventoryCandidates(tx,input(f)),{code:"ER_TABLEACCESS_DENIED_ERROR"});
    inspectionFails=false;await loadInventoryCandidates(tx,input(f));await loadInventoryCandidates(tx,input(f));assert.equal(checks,2);
  },{isolationLevel:"READ COMMITTED"});
});
nativeTest("P0 present Stocktake tables always apply fresh active Bin lock eligibility",async t=>{
  const f=await inventoryNativeFixture(t);
  await f.withActor(tx=>loadInventoryCandidates(tx,input(f)),{isolationLevel:"READ COMMITTED"});
  await f.db.execute("CREATE TABLE inventory_stocktakes(id BIGINT PRIMARY KEY)");
  await f.db.execute("CREATE TABLE inventory_bin_locks(id BIGINT PRIMARY KEY,bin_id BIGINT NOT NULL,released_at BIGINT NULL)");
  await f.withActor(async tx=>{
    const counts=countQueries(tx);assert.equal((await loadInventoryCandidates(tx,input(f))).length,1);
    await tx.execute("INSERT INTO inventory_bin_locks(id,bin_id) VALUES(1,?)",[f.binId]);
    assert.deepEqual(await loadInventoryCandidates(tx,input(f)),[]);assert.deepEqual(counts,{checks:0,lockQueries:2});
  },{isolationLevel:"READ COMMITTED"});
});
nativeTest("P0 unsuccessful candidate fallback never creates a reusable absence proof",async t=>{
  const f=await inventoryNativeFixture(t);
  await f.withActor(async tx=>{
    const query=tx.query.bind(tx);let fail=true,checks=0;
    tx.query=(sql,...args)=>{if(sql.includes("information_schema.tables"))checks++;if(fail&&sql.includes("SELECT b.id")&&!sql.includes("NOT EXISTS"))throw Object.assign(new Error("synthetic fallback failure"),{code:"ER_LOCK_DEADLOCK"});return query(sql,...args);};
    await assert.rejects(loadInventoryCandidates(tx,input(f)),{code:"ER_LOCK_DEADLOCK"});fail=false;
    await loadInventoryCandidates(tx,input(f));await loadInventoryCandidates(tx,input(f));assert.equal(checks,2);
  },{isolationLevel:"READ COMMITTED"});
});
nativeTest("P0 closed transaction metadata cannot reuse an earlier candidate absence proof",async t=>{
  const f=await inventoryNativeFixture(t);let closed;
  await f.withActor(async tx=>{await loadInventoryCandidates(tx,input(f));closed=tx;},{isolationLevel:"READ COMMITTED"});
  const error=new Error("closed transaction rechecked original query");
  closed.query=async sql=>{assert.match(sql,/NOT EXISTS/u);throw error;};
  await assert.rejects(loadInventoryCandidates(closed,input(f)),error);
});
