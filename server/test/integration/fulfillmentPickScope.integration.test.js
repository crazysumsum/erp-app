import assert from "node:assert/strict";
import test from "node:test";
import { p1Fixture,allocateWithInventoryOwner } from "../fulfillment/p1Fixture.js";
import { FulfillmentAllocationService } from "../../src/modules/fulfillment/FulfillmentAllocationService.js";
import { InventoryLookupService } from "../../src/modules/inventory/InventoryLookupService.js";
import { lockFulfillmentRowsInTransaction } from "../../src/modules/fulfillment/FulfillmentLockService.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function fixture(t,quantity=1){
 const f=await p1Fixture(t,quantity),document=await f.create(f.body()),posted=await allocateWithInventoryOwner(f,document,{projected:true}),lookup=new InventoryLookupService({database:f.database,time:f.time,logger:{error(){}}}),[[projection]]=await f.db.query("SELECT * FROM fulfillment_allocations WHERE fulfillment_id=?",[document.outcome.id]);
 return {...f,document,posted,lookup,projection,query:{fulfillmentId:document.outcome.id,inventoryAllocationIds:[String(projection.inventory_allocation_id)]}};
}
async function lockParents(f,tx){
 const intent=f.command();intent.purpose="CLAIM";for(const key of ["eventId","shipmentId","inventoryRequestHash"])delete intent[key];intent.lines[0].reservations[0].claimId=String(f.projection.claim_id);await f.service.lockLinesForFulfillmentInTransaction(tx,intent);
 for(const [table,ids]of [["fulfillments",[f.document.outcome.id]],["fulfillment_lines",[String(f.projection.fulfillment_line_id)]],["fulfillment_line_reservation_claims",[String(f.projection.claim_id)]],["fulfillment_allocations",[String(f.projection.id)]]])await lockFulfillmentRowsInTransaction(tx,table,ids);
}
nativeTest("P1 Pick owner facts prove the full persisted Allocation and original Reservation without writes or early locks",async t=>{
 const f=await fixture(t);await f.execute(()=>f.database.withTransaction(async tx=>{
  const statements=[];for(const method of ["query","execute"]){const original=tx[method].bind(tx);tx[method]=(...args)=>{statements.push(args[0]);return original(...args);};}
  const facts=await f.lookup.readFulfillmentAllocationScopeInTransaction(tx,f.query);assert.equal(facts.allocations.length,1);assert.equal(facts.allocations[0].inventoryAllocationId,f.query.inventoryAllocationIds[0]);assert.equal(facts.allocations[0].version,1);assert.equal(facts.reservationFacts[0].version,2);assert.equal(facts.reservationFacts[0].outstandingQuantity,"1");assert.equal(facts.reservationFacts[0].originalSourceEventId,f.reserveEvent);assert.equal(Object.isFrozen(facts.reservationFacts[0]),true);assert.ok(statements.every(sql=>! /\b(?:INSERT|UPDATE|DELETE|REPLACE|FOR\s+SHARE)\b/iu.test(sql)),statements.filter(sql=>/\b(?:INSERT|UPDATE|DELETE|REPLACE|FOR\s+SHARE)\b/iu.test(sql)).length);
 },{isolationLevel:"READ COMMITTED"}));
});
nativeTest("P1 Pick complete owner guard locks existing full scope in owner order and performs zero Inventory DML",async t=>{
 const f=await fixture(t);await f.execute(()=>f.database.withTransaction(async tx=>{
  await lockParents(f,tx);const statements=[];for(const method of ["query","execute"]){const original=tx[method].bind(tx);tx[method]=(...args)=>{statements.push(args[0]);return original(...args);};}
  const facts=await f.lookup.lockFulfillmentPickScopeInTransaction(tx,f.query);assert.equal(facts.allocations.length,1);assert.equal(facts.reservationFacts[0].version,2);assert.ok(statements.every(sql=>! /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu.test(sql)));
  const positions=["inventory_warehouses","inventory_stock_controls","inventory_bins","inventory_stock_balances","inventory_reservations","inventory_allocations"].map(table=>statements.findIndex(sql=>sql.includes("FROM "+table)&&/FOR UPDATE/iu.test(sql)));assert.ok(positions.every(position=>position>=0));assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
 },{isolationLevel:"READ COMMITTED"}));
});

nativeTest("P1 Pick guard freezes its original scope across an actual await-time switch to another legitimate same-Balance Fulfillment",async t=>{
 const f=await fixture(t,2),other=await f.create(f.body()),allocator=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}}),allocated=await f.execute(()=>allocator.allocate(other.outcome.id,{eventId:"00000000-0000-4000-8000-000000000019",version:1,lines:[{fulfillmentLineId:Number(other.fulfillment.lines[0].id),overrideReason:"",allocations:[{inventoryReservationId:Number(f.reservationId),inventoryBalanceId:Number(f.projection.inventory_balance_id),balanceVersion:2,baseQuantity:"1"}]}]}));
 const query=structuredClone(f.query),original=f.lookup.fulfillment.itemLookup.getFulfillmentInventoryProfilesInTransaction.bind(f.lookup.fulfillment.itemLookup);f.lookup.fulfillment.itemLookup.getFulfillmentInventoryProfilesInTransaction=async(...args)=>{const result=await original(...args);query.fulfillmentId=other.outcome.id;query.inventoryAllocationIds.splice(0,1,allocated.fulfillment.allocations.items[0].inventoryAllocationId);return result;};
 await f.execute(()=>f.database.withTransaction(async tx=>{await lockParents(f,tx);const facts=await f.lookup.lockFulfillmentPickScopeInTransaction(tx,query);assert.equal(facts.fulfillmentId,f.document.outcome.id);assert.deepEqual(facts.allocations.map(row=>row.inventoryAllocationId),f.query.inventoryAllocationIds);},{isolationLevel:"READ COMMITTED"}));
});
