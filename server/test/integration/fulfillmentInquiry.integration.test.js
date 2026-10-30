import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { p1Fixture } from "../fulfillment/p1Fixture.js";
import { FulfillmentInquiryService } from "../../src/modules/fulfillment/FulfillmentInquiryService.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const inquiry=f=>new FulfillmentInquiryService({database:f.database});
const list=(f,input={})=>f.execute(()=>inquiry(f).list(input));
nativeTest("P1 current list keyset is complete across tied business timestamps, exact filters and read-only snapshots",async t=>{
 const f=await p1Fixture(t,4),created=[];
 for(let i=0;i<4;i++)created.push(await f.create(f.body()));
 const before=(await f.db.query("SELECT * FROM fulfillments ORDER BY id"))[0];
 const first=await list(f,{pageSize:2}),second=await list(f,{pageSize:2,page:2,cursor:first.nextCursor});
 assert.deepEqual([...first.items,...second.items].map(row=>row.id),created.map(row=>row.outcome.id).reverse());assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);
 const selected=await list(f,{q:created[0].outcome.number,salesOrderId:f.s.orderId,customerId:f.s.customerId,warehouseId:f.s.warehouseId,status:"DRAFT",hasShortPick:false,createdFrom:f.s.now,createdTo:f.s.now+1});assert.equal(selected.items.length,1);
 assert.deepEqual((await list(f,{pickedFrom:0})).items,[]);assert.deepEqual((await list(f,{q:"not-an-exact-number"})).items,[]);
 assert.deepEqual((await f.db.query("SELECT * FROM fulfillments ORDER BY id"))[0],before);
});
nativeTest("My Recent is bound to the fresh actor, finalized/active/exceptions views have independent filters",async t=>{
 const f=await p1Fixture(t,2),mine=await f.create(f.body()),otherId=await f.s.insert("users",{username:"other_"+randomUUID().slice(0,8),password_hash:"synthetic-only",display_name:"Synthetic",created_at:f.s.now,updated_at:f.s.now});
 await f.db.execute("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)",[otherId,f.roleId]);
 const other=await f.context.storage.run({databaseTransaction:null,signal:null,auth:{claims:{...f.claims,sub:String(otherId)}},startedAt:f.time.nowMs()},()=>f.fulfillments.create(f.body()));
 assert.deepEqual((await list(f,{view:"myRecent"})).items.map(row=>row.id),[mine.outcome.id]);
 await f.db.execute("UPDATE fulfillments SET status='CANCELLED',version=version+1 WHERE id=?",[mine.outcome.id]);
 assert.deepEqual((await list(f)).items.map(row=>row.id),[other.outcome.id]);assert.deepEqual((await list(f,{view:"finalized"})).items.map(row=>row.id),[mine.outcome.id]);
 const request={eventId:randomUUID(),operationType:"UPDATE",target:{type:"FULFILLMENT",id:other.outcome.id},payload:{version:1},leaseOwner:randomUUID(),correlationId:randomUUID()};
 await f.run({claims:f.claims},async tx=>{await f.fulfillments.operations.claimInTransaction(tx,request);await f.fulfillments.operations.failKnownRolledBackInTransaction(tx,{request,publicErrorCode:"FULFILLMENT_STATE_CONFLICT"});});
 assert.deepEqual((await list(f,{view:"exceptions"})).items.map(row=>row.id),[other.outcome.id]);
 await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='fulfillment.view'",[f.roleId]);await assert.rejects(()=>list(f),{code:"PERMISSION_STALE"});
});

nativeTest("Every common list sort pages tied values in both directions and exact-number EXPLAIN uses indexed owners",async t=>{
 const f=await p1Fixture(t,4),created=[];for(let index=0;index<4;index++)created.push(await f.create(f.body()));
 for(const sortBy of ["createdAt","updatedAt","lastBusinessUpdatedAt","fulfillmentNumber","id"])for(const descending of [false,true]){
  const first=await list(f,{sortBy,descending,pageSize:2}),second=await list(f,{sortBy,descending,pageSize:2,page:2,cursor:first.nextCursor});
  assert.deepEqual([...first.items,...second.items].map(row=>row.id),descending?created.map(row=>row.outcome.id).reverse():created.map(row=>row.outcome.id));assert.equal(second.hasMore,false);
 }
 const {normalizeFulfillmentListQuery,fulfillmentListPageQuery}=await import("../../src/modules/fulfillment/fulfillmentListQuery.js");
 const exact=fulfillmentListPageQuery(normalizeFulfillmentListQuery({q:created[0].outcome.number}),f.userId),[numberPlan]=await f.db.query("EXPLAIN FORMAT=TRADITIONAL "+exact.sql,exact.values);
 assert.match(JSON.stringify(numberPlan),/uq_ful_number/u);assert.ok(numberPlan.some(row=>row.type==="const"));assert.doesNotMatch(exact.sql,/OR f.sales_order_number_snapshot/u);
 const [[source]]=await f.db.query("SELECT id FROM sales_orders WHERE sales_order_number=?",[f.before.order.sales_order_number]);
 const bySales=fulfillmentListPageQuery(normalizeFulfillmentListQuery({q:f.before.order.sales_order_number}),f.userId,String(source.id)),[salesPlan]=await f.db.query("EXPLAIN FORMAT=TRADITIONAL "+bySales.sql,bySales.values);
 assert.match(bySales.sql,/sales_order_id=\?/u);assert.match(JSON.stringify(salesPlan),/idx_ful_order|fk_ful_order/u);t.diagnostic(JSON.stringify({numberExactExplain:numberPlan,salesNumberExplain:salesPlan}));assert.equal((await list(f,{q:f.before.order.sales_order_number})).items.length,4);
});
