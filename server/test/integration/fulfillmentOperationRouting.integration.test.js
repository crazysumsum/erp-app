import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {shipmentFixture} from "../fulfillment/shipmentFixture.js";
import {up as auditUp} from "../../database/migrations/0098_create_fulfillment_audit_and_exports.js";
import {up as archiveUp} from "../../database/migrations/0099_create_fulfillment_archives.js";
import {up as routingUp} from "../../database/migrations/0101_add_fulfillment_archive_routing.js";
import {FulfillmentOperationService} from "../../src/modules/fulfillment/FulfillmentOperationService.js";
import {fulfillmentOperationHash} from "../../src/modules/fulfillment/fulfillmentOperationHash.js";
const native=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function fixture(t){const f=await shipmentFixture(t);for(const up of [auditUp,archiveUp,routingUp])await up(f.db);const operations=new FulfillmentOperationService({database:f.database,time:f.time});const request={eventId:randomUUID(),operationType:"ALLOCATE",target:{type:"FULFILLMENT",id:String(f.doc.id)},payload:{quantity:"1"},salesOrderId:String(f.s.orderId),leaseOwner:"route-worker-A",correlationId:randomUUID()};return {...f,operations,request,run:work=>f.run({claims:f.claims},work),rows:async()=>(await f.db.query("SELECT * FROM fulfillment_operation_requests ORDER BY id"))[0]};}
const conflict={code:"FULFILLMENT_SOURCE_CONFLICT"};
native("DEC029 routed journal binds route separately from unchanged payload hash and rejects cross-order event replay",async t=>{
 const f=await fixture(t),r=f.request;assert.equal((await f.run(tx=>f.operations.claimInTransaction(tx,r))).created,true);const [row]=await f.rows();assert.equal(String(row.sales_order_id),r.salesOrderId);assert.equal(row.payload_hash,fulfillmentOperationHash(r));
 assert.equal((await f.run(tx=>f.operations.claimInTransaction(tx,r))).created,false);const before=await f.rows();await assert.rejects(f.run(tx=>f.operations.claimInTransaction(tx,{...r,salesOrderId:String(f.s.orderId+1)})),conflict);assert.deepEqual(await f.rows(),before);
 const result={id:r.target.id,status:"PICKING",version:2};await f.run(tx=>f.operations.succeedInTransaction(tx,{request:r,result}));assert.deepEqual((await f.run(tx=>f.operations.claimInTransaction(tx,r))).result,result);
});
native("DEC029 new-schema omission cannot take over or terminalize a routed event",async t=>{
 const f=await fixture(t),r=f.request;await f.run(tx=>f.operations.claimInTransaction(tx,r));const {salesOrderId:_route,...omitted}=r,before=await f.rows();
 for(const work of [tx=>f.operations.takeOverInTransaction(tx,{request:{...omitted,leaseOwner:"route-worker-B"},expectedLeaseOwner:r.leaseOwner}),tx=>f.operations.succeedInTransaction(tx,{request:omitted,result:{id:r.target.id,status:"PICKING",version:2}}),tx=>f.operations.failKnownRolledBackInTransaction(tx,{request:omitted,publicErrorCode:"VERSION_CONFLICT",publicErrorDetails:{currentVersion:2}})]){await assert.rejects(f.run(work),conflict);assert.deepEqual(await f.rows(),before);}
 await assert.rejects(f.run(tx=>f.operations.claimInTransaction(tx,omitted)));assert.deepEqual(await f.rows(),before);
});
native("DEC029 expired routed lease takeover retains exact route and rejects stale or cross-order completion",async t=>{
 const f=await fixture(t),r=f.request;await f.run(tx=>f.operations.claimInTransaction(tx,r));await f.db.execute("UPDATE fulfillment_operation_requests SET lease_expires_at=1 WHERE event_id=?",[r.eventId]);const next={...r,leaseOwner:"route-worker-B"},wrong={...next,salesOrderId:String(f.s.orderId+1)},before=await f.rows();
 await assert.rejects(f.run(tx=>f.operations.takeOverInTransaction(tx,{request:wrong,expectedLeaseOwner:r.leaseOwner})),conflict);assert.deepEqual(await f.rows(),before);assert.equal((await f.run(tx=>f.operations.takeOverInTransaction(tx,{request:next,expectedLeaseOwner:r.leaseOwner}))).leaseOwner,next.leaseOwner);
 const result={id:r.target.id,status:"PICKING",version:2};await assert.rejects(f.run(tx=>f.operations.succeedInTransaction(tx,{request:r,result})),{code:"CONCURRENT_OPERATION"});await assert.rejects(f.run(tx=>f.operations.succeedInTransaction(tx,{request:wrong,result})),conflict);await assert.rejects(f.run(tx=>f.operations.failKnownRolledBackInTransaction(tx,{request:wrong,publicErrorCode:"VERSION_CONFLICT",publicErrorDetails:{currentVersion:2}})),conflict);
 await f.run(tx=>f.operations.failKnownRolledBackInTransaction(tx,{request:next,publicErrorCode:"VERSION_CONFLICT",publicErrorDetails:{currentVersion:2}}));assert.equal((await f.run(tx=>f.operations.claimInTransaction(tx,next))).status,"FAILED");
});
native("DEC029 routed null-target creation keeps its Sales scope after binding and replaying actual target identity",async t=>{
 const f=await fixture(t),r={...f.request,operationType:"CREATE",target:{type:"FULFILLMENT",id:null}},result={id:String(f.doc.id),status:"DRAFT",version:1};await f.run(tx=>f.operations.claimInTransaction(tx,r));assert.equal((await f.rows())[0].target_id,null);await f.run(tx=>f.operations.succeedInTransaction(tx,{request:r,result}));assert.equal(String((await f.rows())[0].sales_order_id),r.salesOrderId);assert.deepEqual((await f.run(tx=>f.operations.claimInTransaction(tx,r))).result,result);
 const {salesOrderId:_route,...omitted}=r;await assert.rejects(f.run(tx=>f.operations.claimInTransaction(tx,omitted)));
});
native("DEC029 old and explicit-null Export journal requests remain unscoped under forward schema",async t=>{
 const f=await fixture(t),{salesOrderId:_route,...base}=f.request,r={...base,operationType:"EXPORT",target:{type:"EXPORT",id:null}},result={id:"21",status:"QUEUED",version:1};await f.run(tx=>f.operations.claimInTransaction(tx,r));await f.run(tx=>f.operations.succeedInTransaction(tx,{request:{...r,salesOrderId:null},result}));assert.equal((await f.rows())[0].sales_order_id,null);assert.deepEqual((await f.run(tx=>f.operations.claimInTransaction(tx,r))).result,result);await assert.rejects(f.run(tx=>f.operations.claimInTransaction(tx,{...r,salesOrderId:"1"})));assert.equal((await f.rows())[0].sales_order_id,null);
});
native("DEC029 invalid explicit routes are rejected before journal insertion without getter execution",async t=>{
 const f=await fixture(t);for(const salesOrderId of [null,undefined,0,1,"0","01","-1","9007199254740992"]){await assert.rejects(f.run(tx=>f.operations.claimInTransaction(tx,{...f.request,eventId:randomUUID(),salesOrderId})));assert.deepEqual(await f.rows(),[]);}
 let invoked=0;const input={...f.request};Object.defineProperty(input,"salesOrderId",{enumerable:true,get(){invoked++;return String(f.s.orderId);}});await assert.rejects(f.run(tx=>f.operations.claimInTransaction(tx,input)));assert.equal(invoked,0);assert.deepEqual(await f.rows(),[]);
});
native("DEC029 caller mutation during actor authorization cannot change the snapshotted route",async t=>{
 const f=await fixture(t),input=structuredClone(f.request);await f.run(async tx=>{const claim=f.operations.claimInTransaction(tx,input);input.salesOrderId=String(f.s.orderId+1);await claim;});assert.equal(String((await f.rows())[0].sales_order_id),f.request.salesOrderId);await assert.rejects(f.run(tx=>f.operations.claimInTransaction(tx,input)),conflict);
});
