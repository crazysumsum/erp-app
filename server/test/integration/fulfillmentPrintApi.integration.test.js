import assert from "node:assert/strict";
import test from "node:test";
import {cancellationFixture,cancellationFacts} from "../fulfillment/p1CancellationFixture.js";
import {p1Fixture,startP1Http} from "../fulfillment/p1Fixture.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
nativeTest("Pick List real HTTP enforces strict view authorization, ownership-derived query and safe response",async t=>{
 const f=await cancellationFixture(t,{picked:null}),http=await startP1Http(t,f),path=`/api/v1/fulfillments/${f.created.outcome.id}/pick-list`,before=await cancellationFacts(f);assert.equal((await http("GET",path,undefined,{auth:false})).status,401);assert.equal((await http("GET",path,undefined,{auth:"denied"})).status,403);assert.equal((await http("GET",path+"?warehouseId=1")).status,400);assert.equal((await http("GET","/api/v1/fulfillments/999999/pick-list")).status,404);const denied=await cancellationFacts(f);assert.deepEqual(denied,before);
 const result=await http("GET",path);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.data.rows.length,1);assert.equal(result.body.data.isPickingInstruction,true);assert.equal(result.body.data.version,2);assert.doesNotMatch(JSON.stringify(result.body.data),/price|tax|bank|address|inventoryBalanceId/iu);assert.equal(result.headers.pragma,"no-cache");const after=await cancellationFacts(f);for(const table of Object.keys(before).filter(name=>name!=="fulfillment_audit_logs"))assert.deepEqual(after[table],before[table]);assert.equal(after.fulfillment_audit_logs.length,before.fulfillment_audit_logs.length+1);
});
nativeTest("Pick List refuses unallocated Draft and Draft cancellation rather than manufacturing Bin instructions",async t=>{
 const f=await p1Fixture(t),created=await f.create(f.body()),http=await startP1Http(t,f),path=`/api/v1/fulfillments/${created.outcome.id}/pick-list`;assert.equal((await http("GET",path)).status,409);const cancelled=await http("POST",`/api/v1/fulfillments/${created.outcome.id}/cancel`,{eventId:crypto.randomUUID(),version:1});assert.equal(cancelled.status,200);assert.equal((await http("GET",path)).status,409);assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_audit_logs WHERE action='PRINT'"))[0][0].n,0);
});
