import assert from "node:assert/strict";
import test from "node:test";
import {fixture,document} from "../fulfillment/aggregateFixture.js";
import {FulfillmentTransactionService} from "../../src/modules/fulfillment/FulfillmentTransactionService.js";
import {getActiveTransactionIsolation} from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
nativeTest("P0 caller transaction refuses nested context before borrowing a connection",async t=>{
  const f=await fixture(t),transactions=new FulfillmentTransactionService({database:f.database});let nested=false;
  await f.run({claims:f.claims},async tx=>{await assert.rejects(async()=>transactions.withTransaction(async()=>{nested=true;}),TypeError);assert.equal(nested,false);assert.equal(f.context.get().databaseTransaction,tx);assert.equal(getActiveTransactionIsolation(tx),"READ COMMITTED");await tx.query("SELECT 1");});
});
nativeTest("P0 owned caller transaction keeps default Sales RR unchanged and rolls back a late Fulfillment write",async t=>{
  const f=await fixture(t),doc=await document(f),transactions=new FulfillmentTransactionService({database:f.database});let closed;
  const run=work=>f.context.storage.run({databaseTransaction:null,signal:null,auth:{claims:f.claims}},()=>transactions.withTransaction(work));
  await assert.rejects(run(async tx=>{closed=tx;assert.equal(getActiveTransactionIsolation(tx),"READ COMMITTED");await tx.execute("UPDATE fulfillments SET notes='Synthetic pending',version=version+1 WHERE id=?",[doc.id]);throw new Error("late Fulfillment caller failure");}),e=>e.cause?.message==="late Fulfillment caller failure");assert.equal(getActiveTransactionIsolation(closed),null);assert.equal((await f.db.query("SELECT notes,version FROM fulfillments WHERE id=?",[doc.id]))[0][0].notes,"");await f.run({claims:f.claims},async tx=>{assert.equal(getActiveTransactionIsolation(tx),"REPEATABLE READ");},{isolationLevel:"REPEATABLE READ"});
});
nativeTest("P0 primary-row lock context rejects reverse rank and new lower ID before requesting the conflicting lock",async t=>{
  const {lockFulfillmentRowsInTransaction:lock}=await import("../../src/modules/fulfillment/FulfillmentLockService.js"),f=await fixture(t),first=await document(f),second=await document(f,"FUL-202610-000002"),third=await document(f,"FUL-202610-000003");let closed;
  await f.run({claims:f.claims},async tx=>{closed=tx;const rows=await lock(tx,"fulfillments",[String(third.id),first.id,String(first.id)]);assert.deepEqual(rows.map(row=>Number(row.id)),[first.id,third.id]);await lock(tx,"fulfillments",[first.id]);await assert.rejects(lock(tx,"fulfillments",[second.id]),TypeError);await lock(tx,"fulfillment_lines",[first.line,third.line]);await assert.rejects(lock(tx,"fulfillments",[first.id]),TypeError);await assert.rejects(lock(tx,"users",[f.userId]),TypeError);await tx.query("SELECT 1");});
  await assert.rejects(lock(closed,"fulfillments",[first.id]),TypeError);
});
nativeTest("P0 a true active executor borrowed across async request contexts is rejected before SQL",async t=>{
  const {lockFulfillmentRowsInTransaction:lock}=await import("../../src/modules/fulfillment/FulfillmentLockService.js"),f=await fixture(t),doc=await document(f);
  await f.run({claims:f.claims},async tx=>{let queries=0;const query=tx.query.bind(tx);tx.query=(...args)=>{queries++;return query(...args);};await f.context.storage.run({databaseTransaction:null,signal:null,auth:{claims:f.claims}},()=>assert.rejects(lock(tx,"fulfillments",[doc.id]),TypeError));assert.equal(queries,0);assert.equal((await lock(tx,"fulfillments",[doc.id])).length,1);});
});
