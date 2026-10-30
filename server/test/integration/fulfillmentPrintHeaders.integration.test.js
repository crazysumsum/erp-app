import assert from "node:assert/strict";
import test from "node:test";
import {cancellationFixture} from "../fulfillment/p1CancellationFixture.js";
import {startP1Http} from "../fulfillment/p1Fixture.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
nativeTest("Pick List actual strict JSON response preserves the approved private,no-store header",async t=>{
 const f=await cancellationFixture(t,{picked:null}),http=await startP1Http(t,f),result=await http("GET",`/api/v1/fulfillments/${f.created.outcome.id}/pick-list`);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.headers.cacheControl,"private, no-store");assert.equal(result.headers.pragma,"no-cache");assert.equal(result.body.success,true);assert.equal(result.body.data.rows.length,1);
});
