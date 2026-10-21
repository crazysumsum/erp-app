import assert from "node:assert/strict";
import test from "node:test";
import { salesFulfillmentFixture } from "../sales/phase4/salesFulfillmentFixtures.js";

const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
nativeTest("Sales provider real transaction rejects unauthorized/stale/uninstalled dependencies without surviving journal or Sales changes",async t=>{
  const {db,s,userId,reservationId,mappingId,service,context,time,claims,run,command,before,createService}=await salesFulfillmentFixture(t);
  await t.test("actual transaction with no authentication rejects before source claim",async()=>{await assert.rejects(()=>run(null,tx=>service.lockLinesForFulfillmentInTransaction(tx,command())),{code:"FORBIDDEN"});});
  await t.test("actor payload cannot impersonate another context principal",async()=>{const c=command();c.actor.userId=String(userId+1);await assert.rejects(()=>run({claims},tx=>service.lockLinesForFulfillmentInTransaction(tx,c)),{code:"FORBIDDEN"});});
  await t.test("stale Sales root version rolls back a real preceding source claim",async()=>{const c=command();c.expectedOrderVersion=2;await assert.rejects(()=>run({claims},tx=>service.lockLinesForFulfillmentInTransaction(tx,c)),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});assert.equal((await db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE event_id=?",[c.eventId]))[0][0].n,0);});
  await t.test("missing actual Inventory receipt verifier remains fail closed and rolls back source claim",async()=>{const c=command();await assert.rejects(()=>run({claims},async tx=>{await service.lockLinesForFulfillmentInTransaction(tx,c);return service.applyFulfillmentResultInTransaction(tx,{intent:c,inventoryResult:{operationId:"1",lines:[]}});} ),{code:"SALES_DEPENDENCY_UNAVAILABLE"});assert.equal((await db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE event_id=?",[c.eventId]))[0][0].n,0);});
  await t.test("real owner Item read returns only purpose-limited Sales projection",async()=>{
    const projection=await context.storage.run({databaseTransaction:null,signal:null,auth:{claims},startedAt:time.nowMs()},()=>service.getOrderForFulfillment(String(s.orderId),{atMs:time.nowMs()}));
    assert.equal(projection.orderId,String(s.orderId));assert.equal(projection.lines[0].baseUomId,String(s.uomId));assert.equal(projection.lines[0].reservationMappings[0].inventoryReservationId,String(reservationId));
    assert.doesNotMatch(JSON.stringify(projection),/unitSellingPrice|totalAmount|notes|paymentTerm|password|source_event_id/);
  });
  await t.test("CLAIM remains compatible with actual default RR and creates no result journal",async()=>{
    const c=command();c.purpose="CLAIM";for(const key of ["eventId","shipmentId","inventoryRequestHash"])delete c[key];
    await run({claims},async tx=>{const result=await service.lockLinesForFulfillmentInTransaction(tx,c);assert.equal(result.replay,false);assert.equal(result.order.version,1);assert.equal((await tx.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE target_type='FULFILLMENT_SOURCE'"))[0][0].n,0);},{});
  });
  await t.test("actual RR Shipment lock is refused before authentication and leaves no source claim",async()=>{
    const c=command();await assert.rejects(()=>run(null,tx=>service.lockLinesForFulfillmentInTransaction(tx,c),{}),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
    assert.equal((await db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE event_id=?",[c.eventId]))[0][0].n,0);
  });
  await t.test("completed RC executor cannot reuse its private lock receipt for apply or a new lock",async()=>{
    const c=command();let closed;
    await assert.rejects(()=>run({claims},async tx=>{closed=tx;await service.lockLinesForFulfillmentInTransaction(tx,c);throw new Error("synthetic scope rollback");}),error=>error.cause?.message==="synthetic scope rollback");
    await context.storage.run({databaseTransaction:closed,signal:null,auth:{claims},startedAt:time.nowMs()},async()=>{
      await assert.rejects(()=>service.applyFulfillmentResultInTransaction(closed,{intent:c,inventoryResult:{operationId:"1",lines:[]}}),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
      await assert.rejects(()=>service.lockLinesForFulfillmentInTransaction(closed,c),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
    });
    assert.equal((await db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE event_id=?",[c.eventId]))[0][0].n,0);
  });
  await t.test("real Shipment lock creates IN_PROGRESS first and caller rollback removes it",async()=>{
    const c=command();await assert.rejects(()=>run({claims},async tx=>{const result=await service.lockLinesForFulfillmentInTransaction(tx,c);assert.equal(result.replay,false);assert.equal((await tx.query("SELECT status FROM sales_operation_requests WHERE event_id=?",[c.eventId]))[0][0].status,"IN_PROGRESS");throw new Error("Synthetic caller rollback");}),error=>error.cause?.message==="Synthetic caller rollback");
    assert.equal((await db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE event_id=?",[c.eventId]))[0][0].n,0);
  });
  await t.test("whole locked mapping totals reject a conserved Line with missing reservation quantities",async()=>{
    await db.query("UPDATE sales_order_lines SET ordered_base_quantity=2,reserved_outstanding_base_quantity=2 WHERE id=?",[s.lineId]);
    try{const c=command();await assert.rejects(()=>run({claims},tx=>service.lockLinesForFulfillmentInTransaction(tx,c)),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});assert.equal((await db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE event_id=?",[c.eventId]))[0][0].n,0);}finally{await db.query("UPDATE sales_order_lines SET ordered_base_quantity=1,reserved_outstanding_base_quantity=1 WHERE id=?",[s.lineId]);}
  });
  await t.test("malformed Item owner UOM shape returns stable contract error and rolls back",async()=>{
    const bad=createService({itemProvider:{findManyByIds:async()=>new Map([[s.skuId,{uoms:{}}]])}}),c=command();
    await assert.rejects(()=>run({claims},tx=>bad.lockLinesForFulfillmentInTransaction(tx,c)),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
  });
  await t.test("malformed Inventory owner state member returns stable contract error and rolls back",async()=>{
    const result={operationId:"1",lines:[{salesOrderLineId:String(s.lineId),baseQuantity:"1",reservations:[]}]},bad=createService({inventoryFulfillment:{verifyFulfillmentBatchReceiptInTransaction:async()=>({result,reservationStates:[null]})}}),c=command();
    await assert.rejects(()=>run({claims},async tx=>{await bad.lockLinesForFulfillmentInTransaction(tx,c);return bad.applyFulfillmentResultInTransaction(tx,{intent:c,inventoryResult:result});}),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
  });
  await t.test("all refusals preserve every original Sales/mapping value and no source journal",async()=>{assert.deepEqual((await db.query("SELECT * FROM sales_orders WHERE id=?",[s.orderId]))[0][0],before.order);assert.deepEqual((await db.query("SELECT * FROM sales_order_lines WHERE id=?",[s.lineId]))[0][0],before.line);assert.deepEqual((await db.query("SELECT * FROM sales_order_line_reservations WHERE id=?",[mappingId]))[0][0],before.mapping);assert.equal((await db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE target_type='FULFILLMENT_SOURCE'"))[0][0].n,0);});
});
