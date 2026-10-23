import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { p1Fixture,addSourceLine,ownerQuantities } from "../fulfillment/p1Fixture.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const update=(f,id,body)=>f.execute(()=>f.fulfillments.update(id,body));
const body=(f,version=1,quantity="1")=>({eventId:randomUUID(),version,lines:[{salesOrderLineId:f.s.lineId,plannedBaseQuantity:quantity}]});
async function current(f){const result={};for(const table of ["fulfillments","fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_status_history","fulfillment_audit_logs","fulfillment_operation_requests"])result[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;}
nativeTest("DRAFT update rebuilds only current projections, keeps number/history and atomically records outcome/audit without owner quantity writes",async t=>{
 const f=await p1Fixture(t,3),created=await f.create({...f.body(),notes:"Keep this note"}),before=await ownerQuantities(f),request=body(f,1,"2"),first=await update(f,created.outcome.id,request);
 assert.equal(first.outcome.version,2);assert.equal(first.outcome.number,created.outcome.number);assert.equal(first.fulfillment.notes,"Keep this note");assert.equal(first.fulfillment.lines[0].plannedBaseQuantity,"2");assert.notEqual(first.fulfillment.lines[0].id,created.fulfillment.lines[0].id);assert.deepEqual(await ownerQuantities(f),before);
 let state=await current(f);assert.equal(state.fulfillment_line_reservation_claims.length,1);assert.equal(String(state.fulfillment_line_reservation_claims[0].original_claimed_quantity),"2");assert.equal(state.fulfillment_status_history.length,1);assert.equal(state.fulfillment_audit_logs.length,2);
 const edited=await update(f,created.outcome.id,{...body(f,2),notes:""});assert.equal(edited.fulfillment.notes,"");
 const replay=await update(f,created.outcome.id,request);assert.deepEqual(replay.outcome,first.outcome);assert.equal(replay.fulfillment.version,3);
 await assert.rejects(()=>update(f,created.outcome.id,{...request,notes:"Different intent"}),{code:"FULFILLMENT_SOURCE_CONFLICT"});state=await current(f);assert.equal(state.fulfillment_operation_requests.length,3);
});
nativeTest("Repeated add/drop/replace-all preserves only current rows and proves removed source drift before any deletion",async t=>{
 const f=await p1Fixture(t,3),created=await f.create(f.body()),next=await addSourceLine(f),request={eventId:randomUUID(),version:1,lines:[{salesOrderLineId:next.lineId,plannedBaseQuantity:"1"}]};
 await f.db.execute("UPDATE inventory_reservations SET original_quantity=4,released_quantity=1,version=version+1 WHERE id=?",[f.reservationId]);const before=await current(f);
 await assert.rejects(()=>update(f,created.outcome.id,request),{code:"FULFILLABLE_QUANTITY_CHANGED"});assert.deepEqual(await current(f),before);
 await f.db.execute("UPDATE inventory_reservations SET original_quantity=3,released_quantity=0,version=version+1 WHERE id=?",[f.reservationId]);const quantities=await ownerQuantities(f);
 const replaced=await update(f,created.outcome.id,request);assert.equal(replaced.fulfillment.lines.length,1);assert.equal(replaced.fulfillment.lines[0].salesOrderLineId,String(next.lineId));
 await update(f,created.outcome.id,body(f,2));const state=await current(f);assert.equal(state.fulfillment_lines.length,1);assert.equal(state.fulfillment_line_reservation_claims.length,1);assert.equal(state.fulfillment_status_history.length,1);assert.equal(state.fulfillment_audit_logs.length,3);assert.deepEqual(await ownerQuantities(f),quantities);
});
nativeTest("Concurrent Update/Update has one CAS winner and same-event concurrency replays one change",async t=>{
 const f=await p1Fixture(t,3),created=await f.create(f.body()),results=await Promise.allSettled([update(f,created.outcome.id,body(f,1,"2")),update(f,created.outcome.id,body(f,1,"3"))]);
 assert.equal(results.filter(result=>result.status==="fulfilled").length,1);assert.equal(results.find(result=>result.status==="rejected").reason.code,"VERSION_CONFLICT");
 const request=body(f,2),replays=await Promise.all([update(f,created.outcome.id,request),update(f,created.outcome.id,request)]);assert.deepEqual(replays[0].outcome,replays[1].outcome);assert.equal(replays[0].outcome.version,3);assert.equal((await current(f)).fulfillment_audit_logs.length,3);
});
nativeTest("Concurrent Create/Update never exposes a temporary release window or overclaims",async t=>{
 const f=await p1Fixture(t,3),created=await f.create(f.body()),results=await Promise.allSettled([f.create(f.body("2")),update(f,created.outcome.id,body(f,1,"2"))]);
 assert.equal(results.filter(result=>result.status==="fulfilled").length,1);assert.equal(results.filter(result=>result.status==="rejected").length,1);const [[sum]]=await f.db.query("SELECT SUM(active_claimed_quantity) AS active FROM fulfillment_line_reservation_claims");assert.ok(BigInt(sum.active)<=3n);
});
nativeTest("Late UPDATE audit failure restores original header/Line/Claim identities and same-event retry succeeds",async t=>{
 const f=await p1Fixture(t,3),created=await f.create(f.body()),request=body(f,1,"2"),before=await current(f),quantities=await ownerQuantities(f);
 await f.db.query("CREATE TRIGGER test_update_late_audit BEFORE INSERT ON fulfillment_audit_logs FOR EACH ROW BEGIN IF NEW.action='UPDATE' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic late update failure'; END IF; END");
 await assert.rejects(()=>update(f,created.outcome.id,request));assert.deepEqual(await current(f),before);assert.deepEqual(await ownerQuantities(f),quantities);await f.db.query("DROP TRIGGER test_update_late_audit");assert.equal((await update(f,created.outcome.id,request)).outcome.version,2);
});
nativeTest("Replacing a complete100-line DRAFT then dropping99 leaves correct line_count and no stale Claims",{timeout:120000},async t=>{
 const f=await p1Fixture(t),created=await f.create(f.body()),lines=[{salesOrderLineId:f.s.lineId,plannedBaseQuantity:"1"}];
 for(let index=1;index<100;index++){const next=await addSourceLine(f);lines.push({salesOrderLineId:next.lineId,plannedBaseQuantity:"1"});}
 const before=await ownerQuantities(f);const full=await update(f,created.outcome.id,{eventId:randomUUID(),version:1,lines});assert.equal(full.fulfillment.lines.length,100);
 const single=await update(f,created.outcome.id,{eventId:randomUUID(),version:2,lines:[lines.at(-1)]});assert.equal(single.fulfillment.lines.length,1);const state=await current(f);assert.equal(state.fulfillment_lines.length,1);assert.equal(state.fulfillment_line_reservation_claims.length,1);assert.equal(Number(state.fulfillments[0].line_count),1);assert.deepEqual(await ownerQuantities(f),before);
});

nativeTest("Actual Queue/Create/detail/Update/list HTTP flow has strict input, ownership, replay and fresh permission before cache",async t=>{
 const f=await p1Fixture(t,3),{startP1Http}=await import("../fulfillment/p1Fixture.js"),api=await startP1Http(t,f);
 const queue=await api("GET","/api/v1/fulfillment-queue");assert.equal(queue.status,200);assert.equal(queue.body.data.items[0].lines[0].fulfillableBaseQuantity,"3");
 const created=await api("POST","/api/v1/fulfillments/create",f.body());assert.equal(created.status,201,JSON.stringify(created.body));const id=created.body.data.outcome.id,path=`/api/v1/fulfillments/${id}`;
 const detail=await api("GET",path);assert.equal(detail.status,200);assert.equal(detail.body.data.fulfillment.lines[0].plannedBaseQuantity,"1");
 const request=body(f,1,"2"),key=randomUUID(),updated=await api("POST",path+"/update",request,{key});assert.equal(updated.status,200,JSON.stringify(updated.body));assert.equal(updated.body.data.outcome.version,2);
 assert.deepEqual((await api("POST",path+"/update",request,{key})).body.data,updated.body.data);assert.deepEqual((await api("POST",path+"/update",request)).body.data.outcome,updated.body.data.outcome);
 const available=await api("GET","/api/v1/fulfillment-queue");assert.equal(available.body.data.items[0].lines[0].fulfillableBaseQuantity,"1");
 const list=await api("GET","/api/v1/fulfillments?pageSize=1");assert.equal(list.status,200);assert.equal(list.body.data.items[0].id,id);
 assert.equal((await api("GET",path,undefined,{auth:false})).status,401);assert.equal((await api("POST",path+"/update",body(f,2),{auth:"denied"})).status,403);
 for(const patch of [{version:"2"},{status:"DRAFT"},{lines:[]},{lines:[{salesOrderLineId:f.s.lineId,plannedBaseQuantity:"0"}]}])assert.equal((await api("POST",path+"/update",{...body(f,2),...patch})).status,400);
 assert.equal((await api("GET",path+"?fulfillmentId=999")).status,400);assert.equal((await api("GET","/api/v1/fulfillments/999999")).status,404);
 await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='fulfillment.operation'",[f.roleId]);
 const revoked=await api("POST",path+"/update",request,{key});assert.equal(revoked.status,403);assert.equal(revoked.body.error.code,"PERMISSION_STALE");
});
nativeTest("Late new-Claim insertion failure rolls back projection deletion, Header CAS and operation",async t=>{
 const f=await p1Fixture(t,3),created=await f.create(f.body()),request=body(f,1,"2"),before=await current(f);
 await f.db.query("CREATE TRIGGER test_update_claim_failure BEFORE INSERT ON fulfillment_line_reservation_claims FOR EACH ROW BEGIN IF NEW.original_claimed_quantity=2 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic Claim failure'; END IF; END");
 await assert.rejects(()=>update(f,created.outcome.id,request));assert.deepEqual(await current(f),before);await f.db.query("DROP TRIGGER test_update_claim_failure");assert.equal((await update(f,created.outcome.id,request)).outcome.version,2);
});

nativeTest("A real dedicated Inventory Allocation without its Fulfillment projection blocks DRAFT rebuild",async t=>{
 const f=await p1Fixture(t,3),created=await f.create(f.body()),{allocateWithInventoryOwner}=await import("../fulfillment/p1Fixture.js");
 await allocateWithInventoryOwner(f,created);const before=await current(f),quantities=await ownerQuantities(f);
 await assert.rejects(()=>update(f,created.outcome.id,body(f)),{code:"FULFILLMENT_STATE_CONFLICT"});assert.deepEqual(await current(f),before);assert.deepEqual(await ownerQuantities(f),quantities);
});
nativeTest("Another Fulfillment's legitimate dedicated Allocation on a shared Reservation does not block this DRAFT update",async t=>{
 const f=await p1Fixture(t,3),mine=await f.create(f.body()),other=await f.create(f.body()),{allocateWithInventoryOwner}=await import("../fulfillment/p1Fixture.js");
 await allocateWithInventoryOwner(f,other,{projected:true});const before=await ownerQuantities(f);const result=await update(f,mine.outcome.id,body(f));assert.equal(result.outcome.version,2);assert.deepEqual(await ownerQuantities(f),before);
});

nativeTest("A genuinely PICKING document rejects DRAFT update before any rebuild",async t=>{
 const f=await p1Fixture(t,3),created=await f.create(f.body()),{allocateWithInventoryOwner}=await import("../fulfillment/p1Fixture.js");await allocateWithInventoryOwner(f,created,{projected:true});const before=await current(f),quantities=await ownerQuantities(f);
 await assert.rejects(()=>update(f,created.outcome.id,body(f,2)),{code:"FULFILLMENT_STATE_CONFLICT"});assert.deepEqual(await current(f),before);assert.deepEqual(await ownerQuantities(f),quantities);
});
nativeTest("Missing actual owner-effect schema fails closed and preserves every original projection",async t=>{
 const f=await p1Fixture(t),created=await f.create(f.body()),before=await current(f);
 await f.db.query("RENAME TABLE inventory_allocations TO test_hidden_inventory_allocations");
 try{await assert.rejects(()=>update(f,created.outcome.id,body(f)),{code:"INVENTORY_DEPENDENCY_UNAVAILABLE"});assert.deepEqual(await current(f),before);}
 finally{await f.db.query("RENAME TABLE test_hidden_inventory_allocations TO inventory_allocations");}
});
