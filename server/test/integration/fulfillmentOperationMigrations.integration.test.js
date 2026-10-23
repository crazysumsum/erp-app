import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { inventoryNativeFixture } from "../fulfillment/inventoryNativeFixture.js";
import { FulfillmentOperationService } from "../../src/modules/fulfillment/FulfillmentOperationService.js";
import { FulfillmentSequenceService } from "../../src/modules/fulfillment/FulfillmentSequenceService.js";
import { up } from "../../database/migrations/0092_create_fulfillment_operations_and_sequences.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function fixture(t){
  const f=await inventoryNativeFixture(t);await up(f.db);
  const operations=new FulfillmentOperationService({database:f.database,time:f.time,leaseMs:60000});
  const sequence=new FulfillmentSequenceService({database:f.database,time:{...f.time,timeZone:"Asia/Hong_Kong"}});
  const request={eventId:randomUUID(),operationType:"ALLOCATE",target:{type:"FULFILLMENT",id:"1"},payload:{fulfillmentId:"1",quantity:"5"},leaseOwner:"worker-A",correlationId:randomUUID()};
  const run=work=>f.withActor(work,{isolationLevel:"READ COMMITTED"});
  const reserve=options=>f.context.storage.run({databaseTransaction:null,auth:{claims:{sub:String(f.actor.userId),roles:f.actor.claimedRoles,permissions:f.actor.claimedPermissions}}},()=>sequence.reserveNumber(options));
  return {...f,operations,sequence,request,run,reserve};
}
nativeTest("P0 operation migration reruns and resumes partial tables while rejecting schema drift",async t=>{
  const f=await fixture(t);await up(f.db);
  await f.db.query("DROP TABLE fulfillment_operation_requests");await up(f.db);
  await f.db.query("DROP TRIGGER trg_ful_operation_update");await up(f.db);
  const [[original]]=await f.db.query("SELECT check_clause AS clause FROM information_schema.check_constraints WHERE constraint_schema=DATABASE() AND constraint_name='chk_ful_operation_progress'");
  await f.db.query("ALTER TABLE fulfillment_operation_requests DROP CHECK chk_ful_operation_progress");
  const regrouped="(((status <> 'IN_PROGRESS') OR (lease_owner <> '')) AND (lease_expires_at IS NOT NULL) AND (result_json IS NULL) AND (completed_at IS NULL) AND (public_error_code = '') AND (public_error_details IS NULL))";
  assert.notEqual(regrouped,original.clause);
  await f.db.query(`ALTER TABLE fulfillment_operation_requests ADD CONSTRAINT chk_ful_operation_progress CHECK (${regrouped})`);
  await assert.rejects(up(f.db),/state guard/u);
  await f.db.query("ALTER TABLE fulfillment_operation_requests DROP CHECK chk_ful_operation_progress");
  await f.db.query(`ALTER TABLE fulfillment_operation_requests ADD CONSTRAINT chk_ful_operation_progress CHECK (${original.clause.replace(/\\'/gu,"'")})`);
  await f.db.query("ALTER TABLE fulfillment_operation_requests MODIFY payload_hash CHAR(63) CHARACTER SET ascii COLLATE ascii_bin NOT NULL");
  await assert.rejects(up(f.db),/Incompatible/u);
});
nativeTest("P0 durable operation claims, bounded replay and event/hash/actor conflict use actual owner context",async t=>{
  const f=await fixture(t),claim=()=>f.run(tx=>f.operations.claimInTransaction(tx,f.request));
  assert.equal((await claim()).status,"IN_PROGRESS");assert.equal((await claim()).replay,false);
  await assert.rejects(f.run(tx=>f.operations.claimInTransaction(tx,{...f.request,payload:{quantity:"6"}})),{code:"FULFILLMENT_SOURCE_CONFLICT"});
  const result={id:"1",number:"FUL-202610-000001",status:"PICKING",version:2};
  await f.run(tx=>f.operations.succeedInTransaction(tx,{request:f.request,result}));
  assert.deepEqual((await claim()).result,result);
  await assert.rejects(f.run(tx=>f.operations.succeedInTransaction(tx,{request:f.request,result:{...result,address:"Synthetic"}})),e=>e instanceof TypeError||e.cause instanceof TypeError);
  assert.deepEqual((await f.run(tx=>f.operations.getForActorInTransaction(tx,f.request.eventId))).result,result);
  await assert.rejects(f.operations.claimInTransaction(f.db,f.request),TypeError);
  await assert.rejects(f.withActor(tx=>f.operations.claimInTransaction(tx,f.request)),e=>e instanceof TypeError||e.cause instanceof TypeError);
});
nativeTest("P0 operation lease takeover matches expired original event/hash/target and old owner with no resurrection",async t=>{
  const f=await fixture(t);await f.run(tx=>f.operations.claimInTransaction(tx,f.request));
  const takeover=()=>f.run(tx=>f.operations.takeOverInTransaction(tx,{request:{...f.request,leaseOwner:"worker-B"},expectedLeaseOwner:"worker-A"}));
  await assert.rejects(takeover(),{code:"CONCURRENT_OPERATION"});
  await f.db.execute("UPDATE fulfillment_operation_requests SET lease_expires_at=1 WHERE event_id=?",[f.request.eventId]);
  assert.equal((await takeover()).leaseOwner,"worker-B");
  await assert.rejects(f.run(tx=>f.operations.succeedInTransaction(tx,{request:f.request,result:{id:"1",status:"PICKING",version:2}})),{code:"CONCURRENT_OPERATION"});
  const request={...f.request,leaseOwner:"worker-B"};
  await f.run(tx=>f.operations.failKnownRolledBackInTransaction(tx,{request,publicErrorCode:"VERSION_CONFLICT",publicErrorDetails:{currentVersion:3}}));
  const replay=await f.run(tx=>f.operations.claimInTransaction(tx,request));assert.equal(replay.status,"FAILED");assert.equal(replay.publicErrorCode,"VERSION_CONFLICT");
  await assert.rejects(takeover(),{code:"CONCURRENT_OPERATION"});
});
nativeTest("P0 four real transactions claim one event winner and exactly replay its committed outcome",async t=>{
  const f=await fixture(t);let entered,release;const started=new Promise(r=>{entered=r;}),barrier=new Promise(r=>{release=r;});
  const winner=f.run(async tx=>{await f.operations.claimInTransaction(tx,f.request);entered();await barrier;return f.operations.succeedInTransaction(tx,{request:f.request,result:{id:"1",status:"PICKING",version:2}});});
  await started;const waiters=Array.from({length:3},()=>f.run(tx=>f.operations.claimInTransaction(tx,f.request)));release();
  const outcomes=await Promise.allSettled([winner,...waiters]);const errors=outcomes.filter(r=>r.status==="rejected");if(errors.length)throw new AggregateError(errors.map(r=>r.reason),"Operation claim workers failed");
  const [a,...replays]=outcomes.map(r=>r.value);for(const b of replays){assert.deepEqual(b.result,a);assert.equal(b.replay,true);assert.equal(b.created,false);}
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_operation_requests"))[0][0].n,1);
});
nativeTest("P0 sequence numbers serialize cold-start allocation, use APP_TIME_ZONE and remain consumed after later business rollback",async t=>{
  const f=await fixture(t),nowMs=Date.parse("2026-09-30T16:00:00Z");
  const workers=await Promise.allSettled(Array.from({length:4},async()=>{const values=[];for(let i=0;i<5;i++)values.push(await f.reserve({documentType:"FULFILLMENT",nowMs}));return values;}));
  const failures=workers.filter(r=>r.status==="rejected");if(failures.length)throw new AggregateError(failures.map(r=>r.reason),"Sequence workers failed");
  const numbers=workers.flatMap(r=>r.value);
  assert.equal(new Set(numbers).size,20);assert.ok(numbers.every(n=>/^FUL-202610-\d{6}$/u.test(n)));
  assert.equal(await f.reserve({documentType:"FULFILLMENT",nowMs:nowMs-1}),"FUL-202609-000001");
  const used=await f.reserve({documentType:"SHIPMENT",nowMs});await assert.rejects(f.run(async()=>{throw new Error("later business rollback");}),e=>e.cause?.message==="later business rollback");
  assert.equal(used,"SHP-202610-000001");assert.equal(await f.reserve({documentType:"SHIPMENT",nowMs}),"SHP-202610-000002");
  await assert.rejects(f.run(()=>f.sequence.reserveNumber({documentType:"FULFILLMENT",nowMs})),e=>e instanceof TypeError||e.cause instanceof TypeError);
  await assert.rejects(f.db.execute("UPDATE fulfillment_document_sequences SET next_value=1 WHERE document_type='SHIPMENT'"),/monotonic/u);
  await f.db.execute("UPDATE fulfillment_document_sequences SET next_value=9999999,version=version+1 WHERE document_type='SHIPMENT'");
  assert.equal(await f.reserve({documentType:"SHIPMENT",nowMs}),"SHP-202610-9999999");
});

nativeTest("P0 sequence commit-ack loss returns no number while its committed value is never recycled",async t=>{
  const f=await fixture(t),original=f.database.withTransaction.bind(f.database),nowMs=f.time.nowMs();
  f.database.withTransaction=async(...args)=>{await original(...args);throw Object.assign(new Error("simulated lost acknowledgement after actual commit"),{code:"DATABASE_TRANSACTION_INDETERMINATE"});};
  try{await assert.rejects(f.reserve({documentType:"REVERSAL",nowMs}),{code:"DATABASE_TRANSACTION_INDETERMINATE"});}finally{f.database.withTransaction=original;}
  assert.equal(await f.reserve({documentType:"REVERSAL",nowMs}),"REV-202610-000002");
  await f.db.execute("UPDATE fulfillment_document_sequences SET next_value=9999999999999,version=version+1 WHERE document_type='REVERSAL'");
  assert.equal(await f.reserve({documentType:"REVERSAL",nowMs}),"REV-202610-9999999999999");
  await assert.rejects(f.reserve({documentType:"REVERSAL",nowMs}),e=>(e.cause??e).message==="Fulfillment sequence exhausted");
  await assert.rejects(f.db.execute("DELETE FROM fulfillment_document_sequences WHERE document_type='REVERSAL'"),/cannot be reused/u);
});
nativeTest("P0 operation lookup isolates fresh actors and refuses fake, closed and revoked authority without journal effects",async t=>{
  const f=await fixture(t);await f.run(tx=>f.operations.claimInTransaction(tx,f.request));let closed;
  await f.run(async tx=>{closed=tx;});await assert.rejects(f.operations.claimInTransaction(closed,f.request),TypeError);
  const other=Number(await f.insert("INSERT INTO users(username,password_hash,created_at,updated_at) VALUES ('Other','unused',1,1)"));
  const [[role]]=await f.db.query("SELECT role_id FROM user_roles WHERE user_id=?",[f.actor.userId]);await f.db.execute("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)",[other,role.role_id]);
  const asOther=work=>f.context.storage.run({databaseTransaction:null,auth:{claims:{sub:String(other),roles:f.actor.claimedRoles,permissions:f.actor.claimedPermissions}}},()=>f.database.withTransaction(work,{isolationLevel:"READ COMMITTED"}));
  assert.equal(await asOther(tx=>f.operations.getForActorInTransaction(tx,f.request.eventId)),null);
  await assert.rejects(asOther(tx=>f.operations.claimInTransaction(tx,f.request)),{code:"FULFILLMENT_SOURCE_CONFLICT"});
  const [[before]]=await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_operation_requests");
  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE p.name='fulfillment.operation'");
  await assert.rejects(f.run(tx=>f.operations.claimInTransaction(tx,{...f.request,eventId:randomUUID()})),{code:"PERMISSION_STALE"});
  assert.deepEqual((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_operation_requests"))[0][0],before);
});
nativeTest("P0 durable event binds newly created target, blocks unknown terminalization and protects immutable outcomes",async t=>{
  const f=await fixture(t),request={...f.request,operationType:"CREATE",target:{type:"FULFILLMENT",id:null}},result={id:"27",number:"FUL-202610-000027",status:"DRAFT",version:1};
  assert.equal((await f.run(tx=>f.operations.claimInTransaction(tx,request))).created,true);
  await assert.rejects(f.run(tx=>f.operations.failKnownRolledBackInTransaction(tx,{request,publicErrorCode:"DATABASE_TRANSACTION_INDETERMINATE"})),e=>e.cause instanceof TypeError);
  await f.run(tx=>f.operations.succeedInTransaction(tx,{request,result}));assert.deepEqual((await f.run(tx=>f.operations.claimInTransaction(tx,request))).result,result);
  for(const sql of ["UPDATE fulfillment_operation_requests SET payload_hash=REPEAT('b',64)","UPDATE fulfillment_operation_requests SET status='IN_PROGRESS'","DELETE FROM fulfillment_operation_requests"]){await assert.rejects(f.db.execute(sql),/immutable|retention/u);}
  const [[row]]=await f.db.query("SELECT target_id FROM fulfillment_operation_requests WHERE event_id=?",[request.eventId]);assert.equal(String(row.target_id),"27");
});

nativeTest("P0 view-only actor may journal its own Export but cannot claim fulfillment mutations or Reverse",async t=>{
  const f=await fixture(t),user=Number(await f.insert("INSERT INTO users(username,password_hash,created_at,updated_at) VALUES ('Viewer','unused',1,1)")),role=await f.insert("INSERT INTO roles(name,created_at) VALUES ('viewer-only',1)");
  await f.db.execute("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)",[user,role]);await f.db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name='fulfillment.view'",[role]);
  const run=work=>f.context.storage.run({databaseTransaction:null,auth:{claims:{sub:String(user),roles:["viewer-only"],permissions:["fulfillment.view"]}}},()=>f.database.withTransaction(work,{isolationLevel:"READ COMMITTED"}));
  const request={...f.request,operationType:"EXPORT",target:{type:"EXPORT",id:null}},result={id:"21",status:"QUEUED",version:1};
  assert.equal((await run(tx=>f.operations.claimInTransaction(tx,request))).created,true);await run(tx=>f.operations.succeedInTransaction(tx,{request,result}));
  assert.deepEqual((await run(tx=>f.operations.claimInTransaction(tx,request))).result,result);
  for(const [operationType,target] of [["CREATE",{type:"FULFILLMENT",id:null}],["SHIP",{type:"SHIPMENT",id:"1"}],["REVERSE",{type:"SHIPMENT",id:"1"}]]){
    await assert.rejects(run(tx=>f.operations.claimInTransaction(tx,{...f.request,eventId:randomUUID(),operationType,target})),{code:"FULFILLMENT_PERMISSION_DENIED"});
  }
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_operation_requests"))[0][0].n,1);
});

nativeTest("P0 caller mutation during fresh authorization cannot retarget an already normalized durable intent",async t=>{
  const f=await fixture(t),input=structuredClone(f.request);
  await f.run(async tx=>{const pending=f.operations.claimInTransaction(tx,input);input.target.id="2";await pending;});
  const [[row]]=await f.db.query("SELECT target_id FROM fulfillment_operation_requests WHERE event_id=?",[f.request.eventId]);
  assert.equal(String(row.target_id),"1");
  assert.equal((await f.run(tx=>f.operations.claimInTransaction(tx,f.request))).created,false);
  await assert.rejects(f.run(tx=>f.operations.claimInTransaction(tx,input)),{code:"FULFILLMENT_SOURCE_CONFLICT"});
});

nativeTest("P0 operation state guards reject impossible leases and mismatched successful action outcomes",async t=>{
  const f=await fixture(t);await f.run(tx=>f.operations.claimInTransaction(tx,f.request));
  for(const sql of ["UPDATE fulfillment_operation_requests SET lease_expires_at=NULL","UPDATE fulfillment_operation_requests SET result_json=JSON_OBJECT('id','1')"]){await assert.rejects(f.db.execute(sql),e=>e.code==="ER_CHECK_CONSTRAINT_VIOLATED");}
  await assert.rejects(f.run(tx=>f.operations.succeedInTransaction(tx,{request:f.request,result:{id:"1",status:"DRAFT",version:2}})),{code:"FULFILLMENT_SOURCE_CONFLICT"});
  assert.equal((await f.db.query("SELECT status FROM fulfillment_operation_requests"))[0][0].status,"IN_PROGRESS");
  await f.run(tx=>f.operations.succeedInTransaction(tx,{request:f.request,result:{id:"1",status:"PICKING",version:2}}));
});
nativeTest("P0 durable journal rejects malformed identity and unsafe outcomes before storing a result",async t=>{
  const f=await fixture(t);for(const leaseMs of [0,NaN,2147483648])assert.throws(()=>new FulfillmentOperationService({database:f.database,time:f.time,leaseMs}),TypeError);
  for(const changed of [{leaseOwner:"\nworker"},{leaseOwner:1},{eventId:"invalid"},{correlationId:"invalid"},{operationType:"UNKNOWN"},{target:{type:"FULFILLMENT",id:null}},{operationType:"CREATE",target:{type:"FULFILLMENT",id:"1"}},{target:{type:"SHIPMENT",id:"1"}}])await assert.rejects(f.run(tx=>f.operations.claimInTransaction(tx,{...f.request,...changed})),e=>e.cause instanceof TypeError);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_operation_requests"))[0][0].n,0);await f.run(tx=>f.operations.claimInTransaction(tx,f.request));
  const result={id:"1",status:"PICKING",version:2};for(const changed of [{version:0},{version:4294967296},{version:"2"},{status:"UNKNOWN"},{number:1},{number:"uncontrolled/path"}])await assert.rejects(f.run(tx=>f.operations.succeedInTransaction(tx,{request:f.request,result:{...result,...changed}})),e=>e.cause instanceof TypeError);
  for(const changed of [{id:"2"},{number:"SHP-202610-000001"}])await assert.rejects(f.run(tx=>f.operations.succeedInTransaction(tx,{request:f.request,result:{...result,...changed}})),{code:"FULFILLMENT_SOURCE_CONFLICT"});
  await assert.rejects(f.run(tx=>f.operations.getForActorInTransaction(tx,"invalid-event")),e=>e.cause instanceof TypeError);assert.equal(await f.run(tx=>f.operations.getForActorInTransaction(tx,randomUUID())),null);
  assert.equal((await f.db.query("SELECT status FROM fulfillment_operation_requests"))[0][0].status,"IN_PROGRESS");await f.run(tx=>f.operations.succeedInTransaction(tx,{request:f.request,result:JSON.stringify(result)}));assert.deepEqual((await f.run(tx=>f.operations.claimInTransaction(tx,f.request))).result,result);
});
nativeTest("P0 journal failure summaries and Shipment outcome identities remain bounded and replayable",async t=>{
  const f=await fixture(t);await f.run(tx=>f.operations.claimInTransaction(tx,f.request));await assert.rejects(f.run(tx=>f.operations.failKnownRolledBackInTransaction(tx,{request:f.request,publicErrorCode:"NOT_A_PUBLIC_CODE"})),e=>e.cause instanceof TypeError);
  await f.run(tx=>f.operations.failKnownRolledBackInTransaction(tx,{request:f.request,publicErrorCode:"FULFILLMENT_INPUT_INVALID",publicErrorDetails:JSON.stringify({field:"lines"})}));assert.deepEqual((await f.run(tx=>f.operations.claimInTransaction(tx,f.request))).publicErrorDetails,{field:"lines"});
  const noDetails={...f.request,eventId:randomUUID()};await f.run(tx=>f.operations.claimInTransaction(tx,noDetails));await f.run(tx=>f.operations.failKnownRolledBackInTransaction(tx,{request:noDetails,publicErrorCode:"ALLOCATION_INSUFFICIENT",publicErrorDetails:null}));assert.deepEqual((await f.run(tx=>f.operations.claimInTransaction(tx,noDetails))).publicErrorDetails,{});
  const ship={...f.request,eventId:randomUUID(),operationType:"SHIP",target:{type:"SHIPMENT",id:"2"}},result={id:"2",status:"SHIPPED",version:2,number:"SHP-202610-000002"};await f.run(tx=>f.operations.claimInTransaction(tx,ship));await assert.rejects(f.run(tx=>f.operations.succeedInTransaction(tx,{request:ship,result:{...result,number:"FUL-202610-000002"}})),{code:"FULFILLMENT_SOURCE_CONFLICT"});await f.run(tx=>f.operations.succeedInTransaction(tx,{request:ship,result}));assert.deepEqual((await f.run(tx=>f.operations.claimInTransaction(tx,ship))).result,result);
});
nativeTest("P0 real journal INSERT failure propagates without fake duplicate replay or partial intent",async t=>{
  const f=await fixture(t);await f.db.query("CREATE TRIGGER trg_native_operation_failure BEFORE INSERT ON fulfillment_operation_requests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic journal unavailable'");await assert.rejects(f.run(tx=>f.operations.claimInTransaction(tx,f.request)),e=>(e.cause?.code??e.code)==="ER_SIGNAL_EXCEPTION");assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_operation_requests"))[0][0].n,0);await f.db.query("DROP TRIGGER trg_native_operation_failure");assert.equal((await f.run(tx=>f.operations.claimInTransaction(tx,f.request))).created,true);
});
