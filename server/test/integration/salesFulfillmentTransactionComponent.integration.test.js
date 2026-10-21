import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { salesPayloadHash } from "../../src/modules/sales/salesCanonicalHash.js";
import { salesFulfillmentFixture } from "../sales/phase4/salesFulfillmentFixtures.js";

const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
// Sales SQL/codec component only: the Inventory verification boundary is a test double, not owner/joint Gate evidence.
nativeTest("Sales transaction component with Inventory verifier test double: atomic apply, original replay and reversal codec",async t=>{
  const f=await salesFulfillmentFixture(t),{db,s,run,claims,command,createService,reservationId,mappingId}=f;
  let intent=command(),dto={operationId:"91",lines:[{fulfillmentLineId:"11",salesOrderLineId:String(s.lineId),baseQuantity:"1",reservations:[{claimId:"1",inventoryReservationId:String(reservationId),expectedVersion:1,version:2,baseQuantity:"1",inventoryOperationId:"92",allocations:[]}]}]};
  const inventoryFulfillment={async verifyFulfillmentBatchReceiptInTransaction(tx,input){
    assert.deepEqual(input,{action:intent.purpose,operationId:dto.operationId,shipmentId:intent.shipmentId,eventId:intent.eventId,requestHash:intent.inventoryRequestHash});
    const [[r]]=await tx.query("SELECT * FROM inventory_reservations WHERE id=?",[reservationId]);
    return {result:structuredClone(dto),reservationStates:[{inventoryReservationId:String(reservationId),originalQuantity:String(r.original_quantity),consumedQuantity:String(r.consumed_quantity),releasedQuantity:String(r.released_quantity),outstandingQuantity:String(r.outstanding_quantity),status:r.status,version:Number(r.version)}]};
  }};
  const service=createService({inventoryFulfillment}),confirm=structuredClone(intent),confirmDTO=structuredClone(dto);
  const arrangeIssued=tx=>tx.execute("UPDATE inventory_reservations SET consumed_quantity=1,outstanding_quantity=0,status='CONSUMED',version=2 WHERE id=?",[reservationId]);
  await t.test("late injected audit failure rolls back actual Inventory postcondition, Sales, history and source journal",async()=>{
    const failing=createService({inventoryFulfillment,audit:{async record(){throw new Error("Synthetic audit failure");}}});
    await assert.rejects(()=>run({claims},async tx=>{await failing.lockLinesForFulfillmentInTransaction(tx,intent);await arrangeIssued(tx);await failing.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult:dto});}),error=>error.cause?.message==="Synthetic audit failure");
    const [[r]]=await db.query("SELECT consumed_quantity,outstanding_quantity,version FROM inventory_reservations WHERE id=?",[reservationId]);assert.deepEqual(r,{consumed_quantity:0,outstanding_quantity:1,version:1});
    assert.equal((await db.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE event_id=?",[intent.eventId]))[0][0].n,0);assert.equal((await db.query("SELECT COUNT(*) AS n FROM sales_order_status_history WHERE sales_order_id=?",[s.orderId]))[0][0].n,0);
  });
  let first;
  await t.test("Sales applies exact real Inventory postcondition and preserves original reserve identity",async()=>{
    first=await run({claims},async tx=>{await service.lockLinesForFulfillmentInTransaction(tx,intent);await arrangeIssued(tx);return service.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult:dto});});
    assert.equal(first.status,"COMPLETED");assert.equal(first.version,2);assert.equal(first.lines[0].fulfilledBaseQuantity,"1");
    const [[m]]=await db.query("SELECT inventory_operation_id,source_event_id,consumed_base_quantity,outstanding_base_quantity,inventory_version FROM sales_order_line_reservations WHERE id=?",[mappingId]);assert.equal(m.inventory_operation_id,f.root);assert.equal(m.source_event_id,f.reserveEvent);assert.equal(m.consumed_base_quantity,1);assert.equal(m.outstanding_base_quantity,0);assert.equal(m.inventory_version,2);
    assert.equal((await db.query("SELECT action FROM sales_audit_logs WHERE event_id=?",[intent.eventId]))[0][0].action,"sales_order.fulfillment_confirmed");
  });
  await t.test("completed source replay returns original result and rejects a different final receipt",async()=>{
    await run({claims},async tx=>{assert.deepEqual(await service.lockLinesForFulfillmentInTransaction(tx,intent),{replay:true,result:first});assert.deepEqual(await service.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult:dto}),first);});
    await assert.rejects(()=>run({claims},async tx=>{await service.lockLinesForFulfillmentInTransaction(tx,intent);return service.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult:{...dto,operationId:"999"}});}),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
    assert.equal((await db.query("SELECT COUNT(*) AS n FROM sales_order_status_history WHERE event_id=?",[intent.eventId]))[0][0].n,1);
  });
  await t.test("same global event with another shipment cannot replay a different source",async()=>{
    await assert.rejects(()=>run({claims},tx=>service.lockLinesForFulfillmentInTransaction(tx,{...intent,shipmentId:"2"})),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
  });
  await t.test("self-consistent hashes cannot admit malformed stored completed-result shape or versions",async()=>{
    const [[stored]]=await db.query("SELECT result_summary,recovery_payload FROM sales_operation_requests WHERE event_id=?",[confirm.eventId]),decode=value=>typeof value==="string"?JSON.parse(value):value;
    for(const mutate of [r=>r.extra="forbidden",r=>r.version=99,r=>r.status="DRAFT",r=>r.lines=[],r=>r.lines[0].version=1,r=>r.lines[0].fulfilledBaseQuantity="0"]){
      const result=structuredClone(decode(stored.result_summary)),payload=structuredClone(decode(stored.recovery_payload));mutate(result);payload.resultHash=salesPayloadHash(result);
      await db.execute("UPDATE sales_operation_requests SET result_summary=?,recovery_payload=? WHERE event_id=?",[JSON.stringify(result),JSON.stringify(payload),confirm.eventId]);
      try{await assert.rejects(()=>run({claims},tx=>service.lockLinesForFulfillmentInTransaction(tx,confirm)),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});}finally{await db.execute("UPDATE sales_operation_requests SET result_summary=?,recovery_payload=? WHERE event_id=?",[JSON.stringify(decode(stored.result_summary)),JSON.stringify(decode(stored.recovery_payload)),confirm.eventId]);}
    }
  });
  await t.test("Reversal by another fresh actor still accepts the original confirmer FK tombstone",async()=>{
    const newUser=await s.insert("users",{username:"reverse_"+randomUUID().slice(0,12),password_hash:"synthetic-only",display_name:"Synthetic",created_at:s.now,updated_at:s.now});await db.query("INSERT INTO user_roles(user_id,role_id) VALUES (?,?)",[newUser,f.roleId]);
    await db.query("DELETE FROM users WHERE id=?",[f.userId]);assert.equal((await db.query("SELECT actor_user_id FROM sales_operation_requests WHERE event_id=?",[confirm.eventId]))[0][0].actor_user_id,null);
    intent={...structuredClone(confirm),actor:{...confirm.actor,userId:String(newUser)},purpose:"SHIPMENT_REVERSED",expectedOrderVersion:2,eventId:randomUUID(),originalConfirmationEventId:confirm.eventId,inventoryRequestHash:"c".repeat(64),lines:[{salesOrderLineId:String(s.lineId),expectedVersion:2,baseQuantity:"1",reservations:[{claimId:"1",inventoryReservationId:String(reservationId),expectedVersion:2,baseQuantity:"1",originalInventoryOperationId:confirmDTO.lines[0].reservations[0].inventoryOperationId}]}]};
    dto={operationId:"93",lines:[{fulfillmentLineId:"11",salesOrderLineId:String(s.lineId),baseQuantity:"1",reservations:[{claimId:"1",inventoryReservationId:String(reservationId),expectedVersion:2,version:3,baseQuantity:"1",inventoryOperationId:"94",originalInventoryOperationId:"92",allocations:[]}]}]};
    const reversed=await run({claims:{...claims,sub:String(newUser)}},async tx=>{await service.lockLinesForFulfillmentInTransaction(tx,intent);await tx.execute("UPDATE inventory_reservations SET consumed_quantity=0,outstanding_quantity=1,status='ACTIVE',version=3 WHERE id=?",[reservationId]);return service.applyFulfillmentResultInTransaction(tx,{intent,inventoryResult:dto});});
    assert.equal(reversed.status,"CONFIRMED");assert.equal(reversed.version,3);assert.equal(reversed.lines[0].fulfilledBaseQuantity,"0");assert.equal(reversed.lines[0].reservedOutstandingBaseQuantity,"1");
    const [[m]]=await db.query("SELECT inventory_operation_id,source_event_id,consumed_base_quantity,outstanding_base_quantity FROM sales_order_line_reservations WHERE id=?",[mappingId]);assert.equal(m.inventory_operation_id,f.root);assert.equal(m.source_event_id,f.reserveEvent);assert.equal(m.consumed_base_quantity,0);assert.equal(m.outstanding_base_quantity,1);
    assert.deepEqual((await db.query("SELECT action FROM sales_order_status_history WHERE sales_order_id=? ORDER BY sequence_no",[s.orderId]))[0].map(r=>r.action),["FULFILLMENT_CONFIRM","FULFILLMENT_REVERSE_REOPEN"]);
  });
});
