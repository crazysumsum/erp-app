import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { p1Fixture,ownerQuantities } from "../fulfillment/p1Fixture.js";
import { seedMaxClaimOrder } from "../fulfillment/p1CapacityFixture.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
nativeTest("Maximum100-line/5000-member Create and Update retain all Claims and roll back the last failed Claim batch",{timeout:120000},async t=>{
 const f=await p1Fixture(t),sources=await seedMaxClaimOrder(f),lines=sources.map(line=>({salesOrderLineId:line.id,plannedBaseQuantity:"50"})),before=await ownerQuantities(f),samples={};
 let start=performance.now();const created=await f.create({...f.body(),lines});samples.createMs=performance.now()-start;
 assert.equal(created.fulfillment.lines.length,100);assert.ok(created.fulfillment.lines.every(line=>line.claims.activeBaseQuantity==="50"));
 const [[count]]=await f.db.query("SELECT COUNT(*) AS n,SUM(active_claimed_quantity) AS active FROM fulfillment_line_reservation_claims");assert.equal(Number(count.n),5000);assert.equal(String(count.active),"5000");
 const snapshot=async()=>{const rows={};for(const table of ["fulfillments","fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_audit_logs","fulfillment_operation_requests"])rows[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return rows;};
 const original=await snapshot(),request={eventId:randomUUID(),version:1,lines},last=Number((await f.db.query("SELECT MAX(id) AS id FROM inventory_reservations"))[0][0].id);assert.ok(Number.isSafeInteger(last)&&last>0);
 await f.db.query(`CREATE TRIGGER test_last_claim_batch BEFORE INSERT ON fulfillment_line_reservation_claims FOR EACH ROW BEGIN IF NEW.inventory_reservation_id=${last} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic final Claim batch failure'; END IF; END`);
 await assert.rejects(()=>f.execute(()=>f.fulfillments.update(created.outcome.id,request)));assert.deepEqual(await snapshot(),original);assert.deepEqual(await ownerQuantities(f),before);await f.db.query("DROP TRIGGER test_last_claim_batch");
 start=performance.now();const updated=await f.execute(()=>f.fulfillments.update(created.outcome.id,request));samples.updateMs=performance.now()-start;
 assert.equal(updated.outcome.version,2);const [[after]]=await f.db.query("SELECT COUNT(*) AS n,SUM(active_claimed_quantity) AS active FROM fulfillment_line_reservation_claims");assert.equal(Number(after.n),5000);assert.equal(String(after.active),"5000");assert.deepEqual(await ownerQuantities(f),before);
 t.diagnostic(JSON.stringify({scenario:"100-lines/50-native-Reservations-per-line",...samples,transactionLimitUnchanged:true,claimCount:5000}));
});
