import assert from "node:assert/strict";
import test from "node:test";
import { p1Fixture } from "../fulfillment/p1Fixture.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
nativeTest("HD017 desired update capacity excludes only the target's existing active Claims under the same current proof",async t=>{
  const f=await p1Fixture(t),created=await f.create(f.body());
  const result=await f.run({claims:f.claims},tx=>f.locks.lockPendingUpdateCapacityInTransaction(tx,{salesIntent:f.pending(),fulfillmentId:created.outcome.id,expectedVersion:1}));
  assert.equal(result.lines[0].claims[0].baseQuantity,"1");assert.equal(result.fulfillmentId,created.outcome.id);
  assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_lines"))[0][0].n),1);
});
nativeTest("HD017 keeps other documents' Claims in capacity and rejects stale target before replacement effects",async t=>{
  const f=await p1Fixture(t,2),created=await f.create(f.body()),other=await f.create(f.body());
  const lock=(quantity,version=1)=>f.run({claims:f.claims},tx=>f.locks.lockPendingUpdateCapacityInTransaction(tx,{salesIntent:f.pending(quantity),fulfillmentId:created.outcome.id,expectedVersion:version}));
  await assert.rejects(()=>lock("2"),{code:"RESERVATION_CLAIM_CONFLICT"});await assert.rejects(()=>lock("1",2),{code:"VERSION_CONFLICT"});
  assert.equal((await lock("1")).lines[0].claims[0].baseQuantity,"1");assert.notEqual(other.outcome.id,created.outcome.id);
});

nativeTest("HD017 bound pending-update proof grants no Shipment apply authority and refuses mode aliases",async t=>{
 const f=await p1Fixture(t),created=await f.create(f.body()),intent=f.pending();
 await f.run({claims:f.claims},async tx=>{
  await f.locks.lockPendingUpdateCapacityInTransaction(tx,{salesIntent:intent,fulfillmentId:created.outcome.id,expectedVersion:1});
  await assert.rejects(()=>f.service.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult:{lines:[]}}),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
 });
 await assert.rejects(()=>f.run({claims:f.claims},tx=>f.locks.lockPendingClaimCapacityInTransaction(tx,{salesIntent:intent})),error=>error.cause instanceof TypeError);
 const create={...intent,claimMode:"PENDING_CREATE"};await assert.rejects(()=>f.run({claims:f.claims},tx=>f.locks.lockPendingUpdateCapacityInTransaction(tx,{salesIntent:create,fulfillmentId:created.outcome.id,expectedVersion:1})),error=>error.cause instanceof TypeError);
});
