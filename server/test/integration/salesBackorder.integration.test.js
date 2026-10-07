import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setup,stock } from "../sales/phase2/fixtures.js";
import { InventoryReservationService } from "../../src/modules/inventory/InventoryReservationService.js";

const it=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip,name="sales.backorderAllocate";
async function prepareLease(f){
 const [[original]]=await f.db.query("SELECT * FROM fr_job_leases WHERE job_name=?",[name]);
 f.beforeParents.push(async()=>{if(original)await f.db.execute("UPDATE fr_job_leases SET owner=?,acquired_at=?,expires_at=? WHERE job_name=?",[original.owner,original.acquired_at,original.expires_at,name]);else await f.db.execute("DELETE FROM fr_job_leases WHERE job_name=?",[name]);});
 const owner=`sales-test-${randomUUID()}`;
 await f.db.execute("INSERT INTO fr_job_leases (job_name,owner,acquired_at,expires_at) VALUES (?,?,UNIX_TIMESTAMP(),UNIX_TIMESTAMP()+60) ON DUPLICATE KEY UPDATE owner=VALUES(owner),acquired_at=VALUES(acquired_at),expires_at=VALUES(expires_at)",[name,owner]);
 return owner;
}
it("TC-031 Inventory worker native partial membership replay and fresh lease remain inside the caller rollback",async t=>{
 const f=await setup(t);await stock(f,4);const owner=await prepareLease(f),signal=new AbortController().signal;let enabled=true;
 // Exercise Inventory authority in a caller-owned transaction; the real Scheduler registration is tested by the job integration below.
 const s=new InventoryReservationService({...f,authorizeSalesBackorder:()=>enabled?{leaseOwner:owner,signal}:null});
 const [[line]]=await f.db.query("SELECT id FROM sales_order_lines WHERE sales_order_id=?",[f.request.id]);
 const eventId=randomUUID(),command={actor:{userId:null,serviceName:name,claimedRoles:[],claimedPermissions:[name]},source:{documentId:String(f.request.id),eventId},correlationId:eventId,payload:{warehouseId:f.warehouseId,expectedOrderVersion:1,lines:[{sourceLineId:Number(line.id),skuId:f.skuId,orderedBaseQuantity:10,minimumRemainingDays:0}]}};
 const rollback=Error("intentional caller rollback");
 await assert.rejects(()=>f.database.withTransaction(async tx=>{
  const result=await s.reserveAvailableForSalesBackorderInTransaction(tx,command);assert.equal(result.lines[0].reservedBaseQuantity,4);assert.equal(result.lines[0].uncoveredBaseQuantity,6);
  const [operations]=await tx.query("SELECT command_type,actor_user_id,actor_label FROM inventory_operation_requests WHERE source_event_id=? ORDER BY id",[eventId]);assert.deepEqual(operations.map(o=>o.command_type),["SALES_BACKORDER_BATCH_RESERVE","SALES_BACKORDER_LINE_RESERVE"]);assert.ok(operations.every(o=>o.actor_user_id===null&&o.actor_label===name));
  await tx.execute("UPDATE item_skus SET status='inactive' WHERE id=?",[f.skuId]);assert.deepEqual(await s.reserveAvailableForSalesBackorderInTransaction(tx,command),result);
  enabled=false;await assert.rejects(()=>s.reserveAvailableForSalesBackorderInTransaction(tx,command),{code:"PERMISSION_STALE"});enabled=true;
  await tx.execute("UPDATE fr_job_leases SET expires_at=UNIX_TIMESTAMP() WHERE job_name=?",[name]);await assert.rejects(()=>s.reserveAvailableForSalesBackorderInTransaction(tx,command),{code:"PERMISSION_STALE"});throw rollback;
 }),error=>(error.cause??error)===rollback);
 const [[count]]=await f.db.query("SELECT COUNT(*) AS n FROM inventory_operation_requests WHERE source_event_id=?",[eventId]);assert.equal(count.n,0);assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_reservations WHERE warehouse_id=?",[f.warehouseId]))[0][0].n,0);assert.equal((await f.db.query("SELECT status FROM item_skus WHERE id=?",[f.skuId]))[0][0].status,"active");
});
