import assert from "node:assert/strict";
import test from "node:test";
import { inventoryNativeFixture } from "../fulfillment/inventoryNativeFixture.js";
import { assertOwnedOperationWait } from "../fulfillment/inventoryConcurrency.js";
import { claimFulfillmentInventoryBatch,completeFulfillmentInventoryBatch,readFulfillmentInventoryBatch } from "../../src/modules/inventory/inventoryFulfillmentReceipts.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const EVENT="00000000-0000-4000-8000-000000000002";

nativeTest("P0 receipt delayed commit duplicate replays current immutable Movements despite an older RR read view",async t=>{
  const f=await inventoryNativeFixture(t),reservationId=await f.reservation("4");
  const allocate=await f.operations.claim(f.db,{commandType:"ALLOCATION_CREATE",source:{module:"FULFILLMENT",documentType:"PICK",documentId:"1",lineId:"5",eventId:"seed-allocate"},payload:{reservationId},actorUserId:f.actor.userId,actorLabel:"Synthetic",createdAt:1});
  const allocationId=await f.insert("INSERT INTO inventory_allocations(create_operation_id,reservation_id,stock_balance_id,allocated_quantity,consumed_quantity,outstanding_quantity,selection_strategy,status,created_at,updated_at) VALUES(?,?,?,5,5,0,'FIFO','CONSUMED',1,1)",[allocate.operationId,reservationId,f.balanceId]);
  await f.operations.complete(f.db,{operationId:allocate.operationId,resultType:"ALLOCATION",resultId:allocationId,resultSummary:{allocationId},completedAt:1});
  const payload={fulfillmentId:"1",shipmentId:"2",lines:[{fulfillmentLineId:"3",salesOrderLineId:"4",baseQuantity:"5",reservations:[{claimId:"5",inventoryReservationId:reservationId,expectedVersion:1,baseQuantity:"5",allocations:[{inventoryAllocationId:allocationId,inventoryBalanceId:f.balanceId,expectedVersion:1,expectedBalanceVersion:1,baseQuantity:"5"}]}]},{fulfillmentLineId:"6",salesOrderLineId:"7",baseQuantity:"0",reservations:[]}]};
  let startedResolve,releaseResolve,waiterResolve;
  const started=new Promise(resolve=>{startedResolve=resolve;}),release=new Promise(resolve=>{releaseResolve=resolve;}),waiterReady=new Promise(resolve=>{waiterResolve=resolve;});
  const input={action:"ISSUE",payload,source:{eventId:EVENT},actor:f.actor,actorLabel:"Synthetic",timestamp:f.time.nowMs(),correlationId:"",operations:f.operations};
  let rootId,hash,waiterId;
  const waiter=f.withActor(async tx=>{
    waiterId=(await tx.query("SELECT CONNECTION_ID() AS id"))[0][0].id;
    await tx.query("SELECT COUNT(*) FROM inventory_movements"); // Establish the pre-commit RR view.
    waiterResolve();await started;
    const batch=await claimFulfillmentInventoryBatch(tx,input);
    assert.ok(batch.replay);
    const decoded=await readFulfillmentInventoryBatch(tx,{action:"ISSUE",operationId:String(batch.operationId),documentId:"2",eventId:EVENT,requestHash:batch.requestHash});
    assert.equal(decoded.result.lines[0].reservations[0].allocations[0].movementId,rootId);
    assert.equal(decoded.result.lines[1].baseQuantity,"0");
    return decoded.result;
  });
  const waiterOutcome=Promise.allSettled([waiter]);
  waiter.then(waiterResolve,waiterResolve);
  await waiterReady;
  const winner=f.withActor(async tx=>{
    const batch=await claimFulfillmentInventoryBatch(tx,input),member=batch.members[0];hash=batch.requestHash;
    const [move]=await tx.execute(`INSERT INTO inventory_movements(movement_group_id,operation_request_id,movement_type,location_kind,warehouse_id,bin_id,sku_id,stock_status,direction,quantity,balance_before,balance_after,balance_version_after,reservation_id,allocation_id,sku_code_snapshot,sku_name_snapshot,warehouse_code_snapshot,bin_code_snapshot,posted_at,posted_by,posted_by_label)
      VALUES('00000000-0000-4000-8000-000000000099',?,'ISSUE','BIN',?,?,?,'AVAILABLE','OUT',5,20,15,2,?,?,'SYN','Synthetic','SYN','A',?,?,'Synthetic')`,[member.operationId,f.warehouseId,f.binId,f.skuId,reservationId,allocationId,f.time.nowMs(),f.actor.userId]);
    rootId=String(move.insertId);member.version=2;
    member.legs[0].result={inventoryAllocationId:allocationId,inventoryBalanceId:f.balanceId,movementId:rootId,baseQuantity:"5",allocationVersion:2,balanceVersion:2,baseUomId:f.uomId,baseUomCode:"EA"};
    await completeFulfillmentInventoryBatch(tx,batch);
    startedResolve();await release;
  });
  const winnerOutcome=Promise.allSettled([winner]);
  winner.then(startedResolve,startedResolve);
  let failure;
  try {
    await started;
    await assertOwnedOperationWait(f,waiterId);
  } catch(error) {failure=error;} finally { releaseResolve();startedResolve(); }
  const outcomes=[...(await winnerOutcome),...(await waiterOutcome)];
  const errors=[...(failure?[failure]:[]),...outcomes.filter(r=>r.status==="rejected").map(r=>r.reason)];
  if(errors.length)throw new AggregateError(errors,"owned receipt concurrency failed");
  const result=outcomes[1].value;
  assert.match(hash,/^[a-f0-9]{64}$/);assert.equal(result.lines.length,2);
});
