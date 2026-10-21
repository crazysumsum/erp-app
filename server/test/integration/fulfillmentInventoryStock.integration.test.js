import assert from "node:assert/strict";
import test from "node:test";
import { inventoryNativeFixture } from "../fulfillment/inventoryNativeFixture.js";
import { assertOwnedOperationWait,gate } from "../fulfillment/inventoryConcurrency.js";
import { InventoryFulfillmentService } from "../../src/modules/inventory/InventoryFulfillmentService.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const EVENT="00000000-0000-4000-8000-000000000002",REVERSE="00000000-0000-4000-8000-000000000003";
const reverseInput=issued=>({fulfillmentId:"1",shipmentId:"2",lines:issued.lines.map(line=>({...line,reservations:line.reservations.map(member=>({claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,expectedVersion:3,baseQuantity:member.baseQuantity,originalInventoryOperationId:member.inventoryOperationId,
  allocations:member.allocations.map(a=>({shipmentIssueId:String(Number(a.movementId)+100),originalMovementId:a.movementId,inventoryAllocationId:a.inventoryAllocationId,expectedBalanceVersion:5,baseQuantity:a.baseQuantity}))}))}))});
async function fixture(t) {
  const f=await inventoryNativeFixture(t),members=[];
  for(let index=0;index<2;index++)members.push({claimId:String(index+1),inventoryReservationId:await f.reservation(String(index+4)),expectedVersion:1,baseQuantity:"5",overrideReason:"",allocations:[{inventoryBalanceId:f.balanceId,expectedBalanceVersion:1,baseQuantity:"5"}]});
  const lines=members.map((member,index)=>({fulfillmentLineId:String(index+3),salesOrderLineId:String(index+4),baseQuantity:"5",reservations:[member]}));
  const service=new InventoryFulfillmentService({database:f.database,time:f.time,logger:f.logger});
  const allocationCommand={actor:f.actor,source:{documentId:"1",eventId:"00000000-0000-4000-8000-000000000001"},correlationId:"",payload:{fulfillmentId:"1",lines}};
  const allocationResult=await f.withActor(async tx=>{
    const proof=await service.claimFulfillmentBatchInTransaction(tx,{action:"ALLOCATE",command:allocationCommand});
    return service.allocateForFulfillmentBatchInTransaction(tx,allocationCommand,proof);
  },{isolationLevel:"READ COMMITTED"});
  const allocated=allocationResult.lines.map(l=>l.reservations[0].allocations[0].inventoryAllocationId);
  const issue={fulfillmentId:"1",shipmentId:"2",lines:lines.map((line,index)=>({...line,reservations:[{claimId:line.reservations[0].claimId,inventoryReservationId:line.reservations[0].inventoryReservationId,expectedVersion:2,baseQuantity:"5",allocations:[{inventoryAllocationId:allocated[index],inventoryBalanceId:f.balanceId,expectedVersion:1,expectedBalanceVersion:3,baseQuantity:"5"}]}]}))};
  issue.lines.push({fulfillmentLineId:"9",salesOrderLineId:"10",baseQuantity:"0",reservations:[]});
  const command=(payload,eventId=EVENT)=>({actor:f.actor,source:{documentId:"2",eventId},correlationId:"",payload});
  const invoke=async(tx,input,action="ISSUE")=>{
    const prepared=await service.claimFulfillmentBatchInTransaction(tx,{action,command:input});
    return action==="ISSUE"?service.postFulfillmentIssueBatchInTransaction(tx,input,prepared):service.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction(tx,input,prepared);
  };
  return {...f,issue,service,command,allocated,invoke};
}

nativeTest("P0 real Inventory batch Issue/Restore shares one Balance, replays immutable versions and restores only Reservation",async t=>{
  const f=await fixture(t);
  let issued;
  await f.withActor(async tx=>{
    issued=await f.invoke(tx,f.command(f.issue));
    const verification=await f.service.verifyFulfillmentBatchReceiptInTransaction(tx,{action:"SHIPMENT_CONFIRMED",operationId:issued.operationId,shipmentId:"2",eventId:EVENT,requestHash:(await tx.query("SELECT request_hash FROM inventory_operation_requests WHERE id=?",[issued.operationId]))[0][0].request_hash});
    assert.deepEqual(verification.result,issued);assert.ok(verification.reservationStates.every(r=>r.consumedQuantity==="5"&&r.outstandingQuantity==="0"&&r.status==="CONSUMED"&&r.version===3));
  },{isolationLevel:"READ COMMITTED"});
  assert.deepEqual(issued.lines.slice(0,2).map(l=>l.reservations[0].allocations[0].balanceVersion),[4,5]);
  assert.equal(issued.lines[2].baseQuantity,"0");
  await f.withActor(async tx=>assert.deepEqual(await f.invoke(tx,f.command(f.issue)),issued),{isolationLevel:"READ COMMITTED"});
  const reverse={fulfillmentId:"1",shipmentId:"2",lines:issued.lines.map(line=>({...line,reservations:line.reservations.map(member=>({claimId:member.claimId,inventoryReservationId:member.inventoryReservationId,expectedVersion:3,baseQuantity:member.baseQuantity,originalInventoryOperationId:member.inventoryOperationId,allocations:member.allocations.map(a=>({shipmentIssueId:String(Number(a.movementId)+100),originalMovementId:a.movementId,inventoryAllocationId:a.inventoryAllocationId,expectedBalanceVersion:5,baseQuantity:a.baseQuantity}))}))}))};
  let restored;
  await f.withActor(async tx=>{restored=await f.invoke(tx,f.command(reverse,REVERSE),"REVERSE");},{isolationLevel:"READ COMMITTED"});
  assert.deepEqual(restored.lines.slice(0,2).map(l=>l.reservations[0].allocations[0].balanceVersion),[6,7]);
  await f.withActor(async tx=>assert.deepEqual(await f.invoke(tx,f.command(reverse,REVERSE),"REVERSE"),restored),{isolationLevel:"READ COMMITTED"});
  const [[balance]]=await f.db.query("SELECT on_hand_quantity,allocated_quantity FROM inventory_stock_balances WHERE id=?",[f.balanceId]);
  assert.deepEqual([Number(balance.on_hand_quantity),Number(balance.allocated_quantity)],[20,0]);
  const [allocations]=await f.db.query("SELECT status,consumed_quantity,outstanding_quantity,version FROM inventory_allocations ORDER BY id");
  assert.ok(allocations.every(a=>a.status==="CONSUMED"&&Number(a.consumed_quantity)===5&&Number(a.outstanding_quantity)===0&&Number(a.version)===2));
  const [reservations]=await f.db.query("SELECT status,consumed_quantity,outstanding_quantity,version FROM inventory_reservations ORDER BY id");
  assert.ok(reservations.every(r=>r.status==="ACTIVE"&&Number(r.consumed_quantity)===0&&Number(r.outstanding_quantity)===5&&Number(r.version)===4));
  await assert.rejects(f.withActor(tx=>f.invoke(tx,f.command({...reverse,lines:reverse.lines.map(line=>({...line,reservations:line.reservations.map(m=>({...m,expectedVersion:4}))}))},"00000000-0000-4000-8000-000000000004"),"REVERSE"),{isolationLevel:"READ COMMITTED"}));
});

nativeTest("P0 Inventory batch rejects RR/fake context and rolls back every preceding effect on a later member conflict",async t=>{
  const f=await fixture(t);
  await assert.rejects(f.withActor(tx=>f.invoke(tx,f.command(f.issue))),e=>e.cause instanceof TypeError);
  const before=(await f.db.query("SELECT COUNT(*) AS n FROM inventory_operation_requests"))[0][0].n;
  const bad=structuredClone(f.issue);bad.lines[1].reservations[0].allocations[0].expectedVersion=2;
  await assert.rejects(f.withActor(tx=>f.invoke(tx,f.command(bad)),{isolationLevel:"READ COMMITTED"}));
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_operation_requests"))[0][0].n,before);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_movements"))[0][0].n,0);
  const [[balance]]=await f.db.query("SELECT on_hand_quantity,allocated_quantity,version FROM inventory_stock_balances WHERE id=?",[f.balanceId]);
  assert.deepEqual([Number(balance.on_hand_quantity),Number(balance.allocated_quantity),Number(balance.version)],[20,10,3]);
});

nativeTest("P0 Inventory second Movement failure rolls back the first member's stock, reservation, receipt and audit effects",async t=>{
  const f=await fixture(t);
  const [[before]]=await f.db.query("SELECT (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,(SELECT COUNT(*) FROM inventory_audit_logs) AS audits");
  let movements=0;
  await assert.rejects(f.withActor(async tx=>{
    const execute=tx.execute.bind(tx);
    tx.execute=async(sql,args)=>{
      if(sql.startsWith("INSERT INTO inventory_movements")&&++movements===2)throw new Error("synthetic second Movement failure");
      return execute(sql,args);
    };
    await f.invoke(tx,f.command(f.issue));
  },{isolationLevel:"READ COMMITTED"}));
  assert.equal(movements,2);
  const [[after]]=await f.db.query("SELECT (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,(SELECT COUNT(*) FROM inventory_audit_logs) AS audits");
  assert.deepEqual(after,before);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_movements"))[0][0].n,0);
  const [[balance]]=await f.db.query("SELECT on_hand_quantity,allocated_quantity,version FROM inventory_stock_balances WHERE id=?",[f.balanceId]);
  assert.deepEqual([Number(balance.on_hand_quantity),Number(balance.allocated_quantity),Number(balance.version)],[20,10,3]);
  const [reservations]=await f.db.query("SELECT consumed_quantity,outstanding_quantity,version FROM inventory_reservations ORDER BY id");
  assert.ok(reservations.every(r=>Number(r.consumed_quantity)===0&&Number(r.outstanding_quantity)===5&&Number(r.version)===2));
});

for (const [name,change] of [
  ["omitted owned line",input=>input.lines.splice(1,1)],
  ["owned line replaced with zero",input=>Object.assign(input.lines[1],{baseQuantity:"0",reservations:[]})],
  ["substituted Fulfillment line",input=>{input.lines[0].fulfillmentLineId="999";}]
]) nativeTest(`P0 Issue rejects ${name} without committing any owner effect`,async t=>{
  const f=await fixture(t),input=structuredClone(f.issue);
  change(input);
  const [[before]]=await f.db.query("SELECT (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,(SELECT COUNT(*) FROM inventory_audit_logs) AS audits");
  await assert.rejects(f.withActor(tx=>f.invoke(tx,f.command(input)),{isolationLevel:"READ COMMITTED"}));
  const [[after]]=await f.db.query("SELECT (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,(SELECT COUNT(*) FROM inventory_audit_logs) AS audits");
  assert.deepEqual(after,before);
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_movements"))[0][0].n,0);
  const [[balance]]=await f.db.query("SELECT on_hand_quantity,allocated_quantity,version FROM inventory_stock_balances WHERE id=?",[f.balanceId]);
  assert.deepEqual([Number(balance.on_hand_quantity),Number(balance.allocated_quantity),Number(balance.version)],[20,10,3]);
});

nativeTest("P0 active RC batch rejects forged actor, purpose, source and stale permissions before claims",async t=>{
  const f=await fixture(t),command=f.command(f.issue);
  const invalid=[
    {...command,purpose:"fulfillment.issue"},
    {...command,authorization:{purpose:"fulfillment.issue",requiredCallerPermission:"inventory.operation"}},
    {...command,actor:{...command.actor,userId:f.actor.userId+1}},
    {...command,actor:{...command.actor,serviceName:"trusted"}},
    {...command,source:{...command.source,documentId:"999"}},
    {...command,source:{...command.source,module:"SALES"}},
    {...command,source:{...command.source,lineId:"1"}},
    {...command,actor:{...command.actor,claimedPermissions:[]}}
  ];
  const [[before]]=await f.db.query("SELECT COUNT(*) AS n FROM inventory_operation_requests");
  for (const input of invalid) await assert.rejects(f.withActor(tx=>f.service.claimFulfillmentBatchInTransaction(tx,{action:"ISSUE",command:input}),{isolationLevel:"READ COMMITTED"}));
  await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE p.name='fulfillment.operation'");
  await assert.rejects(f.withActor(tx=>f.service.claimFulfillmentBatchInTransaction(tx,{action:"ISSUE",command}),{isolationLevel:"READ COMMITTED"}));
  assert.deepEqual((await f.db.query("SELECT COUNT(*) AS n FROM inventory_operation_requests"))[0][0],before);
});

nativeTest("P0 preclaim proof cannot be cloned, substituted, or reused by another active transaction",async t=>{
  const f=await fixture(t),command=f.command(f.issue);let proof,closed;
  await assert.rejects(f.withActor(async tx=>{
    closed=tx;proof=await f.service.claimFulfillmentBatchInTransaction(tx,{action:"ISSUE",command});
    await assert.rejects(f.service.postFulfillmentIssueBatchInTransaction(tx,command,{...proof}));
    await assert.rejects(f.service.postFulfillmentIssueBatchInTransaction(tx,command));
    const changed=structuredClone(command);changed.payload.lines[0].fulfillmentLineId="999";
    await assert.rejects(f.service.postFulfillmentIssueBatchInTransaction(tx,changed,proof));
    throw new Error("synthetic rollback of prepared transaction");
  },{isolationLevel:"READ COMMITTED"}));
  await assert.rejects(f.service.postFulfillmentIssueBatchInTransaction(closed,command,proof));
  await assert.rejects(f.withActor(tx=>f.service.postFulfillmentIssueBatchInTransaction(tx,command,proof),{isolationLevel:"READ COMMITTED"}));
  assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM inventory_movements"))[0][0].n,0);
});

for (const crossWarehouse of [false,true]) nativeTest(`P0 stable owner guard serializes a new ${crossWarehouse?"foreign Warehouse":"same Warehouse Reservation"} before owner-set discovery`,async t=>{
  const f=await fixture(t),reservationId=await f.reservation("11"),started=gate(),release=gate(),ready=gate();
  if(crossWarehouse) {
    const warehouse=await f.insert("INSERT INTO inventory_warehouses(warehouse_code,normalized_code,warehouse_name,created_at,updated_at) VALUES('OTHER','other','Other',1,1)");
    await f.db.execute("UPDATE inventory_reservations SET warehouse_id=? WHERE id=?",[warehouse,reservationId]);
  }
  const input={actor:f.actor,source:{documentId:"1",eventId:"00000000-0000-4000-8000-000000000004"},correlationId:"",payload:{fulfillmentId:"1",lines:[{fulfillmentLineId:"12",salesOrderLineId:"11",baseQuantity:"5",reservations:[{claimId:"13",inventoryReservationId:reservationId,expectedVersion:1,baseQuantity:"5",overrideReason:"",allocations:[{inventoryBalanceId:f.balanceId,expectedBalanceVersion:5,baseQuantity:"5"}]}]}]}};
  let waiterId,acquired=false;
  const rollback=new Error("synthetic rollback of the second preparation");
  const waiter=f.withActor(async tx=>{
    waiterId=(await tx.query("SELECT CONNECTION_ID() AS id"))[0][0].id;ready.release();await started.promise;
    await f.service.claimFulfillmentBatchInTransaction(tx,{action:"ALLOCATE",command:input});
    acquired=true;throw rollback;
  },{isolationLevel:"READ COMMITTED"});
  const waiterOutcome=Promise.allSettled([waiter]);waiter.then(ready.release,ready.release);
  await ready.promise;
  const winner=f.withActor(async tx=>{
    const command=f.command(f.issue),proof=await f.service.claimFulfillmentBatchInTransaction(tx,{action:"ISSUE",command});
    started.release();await release.promise;
    return f.service.postFulfillmentIssueBatchInTransaction(tx,command,proof);
  },{isolationLevel:"READ COMMITTED"});
  const winnerOutcome=Promise.allSettled([winner]);winner.then(started.release,started.release);
  let failure;
  try {await started.promise;await assertOwnedOperationWait(f,waiterId);assert.equal(acquired,false);}
  catch(error){failure=error;}finally{release.release();started.release();}
  const [won]=await winnerOutcome,[waited]=await waiterOutcome;
  const errors=[...(failure?[failure]:[]),...(won.status==="rejected"?[won.reason]:[])];
  if(errors.length)throw new AggregateError(errors,"owned guard concurrency failed");
  assert.equal(waited.status,"rejected");assert.equal(acquired,!crossWarehouse,waited.reason?.cause?.code);
  if(!crossWarehouse)assert.equal(waited.reason.cause,rollback);
  else assert.equal(waited.reason.code??waited.reason.cause?.code,"INVENTORY_SOURCE_CONFLICT");
  const [[scope]]=await f.db.query("SELECT result_summary FROM inventory_operation_requests WHERE command_type='FULFILLMENT_SCOPE_LOCK'");
  assert.deepEqual(typeof scope.result_summary==="string"?JSON.parse(scope.result_summary):scope.result_summary,{warehouseId:f.warehouseId,salesOrderId:"1"});
});

for(const [name,change]of [
  ["inactive Bin",f=>f.db.execute("UPDATE inventory_bins SET status='INACTIVE' WHERE id=?",[f.binId])],
  ["inactive Warehouse",f=>f.db.execute("UPDATE inventory_warehouses SET status='INACTIVE' WHERE id=?",[f.warehouseId])],
  ["changed stock Status",f=>f.db.execute("UPDATE inventory_stock_balances SET stock_status='QUARANTINED' WHERE id=?",[f.balanceId])],
  ["changed original bucket identity",async f=>{const bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,'OTHER','other',1,1)",[f.warehouseId]);await f.db.execute("UPDATE inventory_stock_balances SET bin_id=? WHERE id=?",[bin,f.balanceId]);}],
  ["missing original line",async(f,input)=>{Object.assign(input.lines[1],{baseQuantity:"0",reservations:[]});}],
  ["wrong original member",async(f,input)=>{input.lines[0].reservations[0].originalInventoryOperationId=input.lines[1].reservations[0].originalInventoryOperationId;}],
  ["wrong original Movement",async(f,input)=>{input.lines[0].reservations[0].allocations[0].originalMovementId=input.lines[1].reservations[0].allocations[0].originalMovementId;}]
])nativeTest(`P0 Reverse refuses ${name} and preserves all committed Issue effects`,async t=>{
  const f=await fixture(t);let issued;
  await f.withActor(async tx=>{issued=await f.invoke(tx,f.command(f.issue));},{isolationLevel:"READ COMMITTED"});
  const input=reverseInput(issued);await change(f,input);
  const [[before]]=await f.db.query("SELECT (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,(SELECT COUNT(*) FROM inventory_movements) AS movements,(SELECT COUNT(*) FROM inventory_audit_logs) AS audits");
  await assert.rejects(f.withActor(tx=>f.invoke(tx,f.command(input,REVERSE),"REVERSE"),{isolationLevel:"READ COMMITTED"}));
  const [[after]]=await f.db.query("SELECT (SELECT COUNT(*) FROM inventory_operation_requests) AS operations,(SELECT COUNT(*) FROM inventory_movements) AS movements,(SELECT COUNT(*) FROM inventory_audit_logs) AS audits");
  assert.deepEqual(after,before);
  const [reservations]=await f.db.query("SELECT consumed_quantity,outstanding_quantity,version FROM inventory_reservations ORDER BY id");
  assert.ok(reservations.every(r=>Number(r.consumed_quantity)===5&&Number(r.outstanding_quantity)===0&&Number(r.version)===3));
});

nativeTest("P0 two native connections replay one committed Issue event without duplicate effects",async t=>{
  const f=await fixture(t),started=gate(),release=gate(),ready=gate();let waiterId;
  const waiter=f.withActor(async tx=>{waiterId=(await tx.query("SELECT CONNECTION_ID() AS id"))[0][0].id;ready.release();await started.promise;return f.invoke(tx,f.command(f.issue));},{isolationLevel:"READ COMMITTED"});
  const waiterOutcome=Promise.allSettled([waiter]);waiter.then(ready.release,ready.release);await ready.promise;
  const winner=f.withActor(async tx=>{const command=f.command(f.issue),proof=await f.service.claimFulfillmentBatchInTransaction(tx,{action:"ISSUE",command});started.release();await release.promise;return f.service.postFulfillmentIssueBatchInTransaction(tx,command,proof);},{isolationLevel:"READ COMMITTED"});
  const winnerOutcome=Promise.allSettled([winner]);winner.then(started.release,started.release);let failure;
  try{await started.promise;await assertOwnedOperationWait(f,waiterId);}catch(error){failure=error;}finally{release.release();started.release();}
  const outcomes=[...(await winnerOutcome),...(await waiterOutcome)],errors=[...(failure?[failure]:[]),...outcomes.filter(r=>r.status==="rejected").map(r=>r.reason)];
  if(errors.length)throw new AggregateError(errors,"owned duplicate Issue failed");
  assert.deepEqual(outcomes[0].value,outcomes[1].value);
  const [[count]]=await f.db.query("SELECT COUNT(*) AS n FROM inventory_movements");assert.equal(Number(count.n),2);
});

nativeTest("P0 one private preparation refuses overlapping effect execution but permits completed replay",async t=>{
  const f=await fixture(t),entered=gate(),release=gate(),lock=f.service.locks.lockForCommand.bind(f.service.locks);
  f.service.locks.lockForCommand=async(...args)=>{entered.release();await release.promise;return lock(...args);};
  await f.withActor(async tx=>{
    const command=f.command(f.issue),proof=await f.service.claimFulfillmentBatchInTransaction(tx,{action:"ISSUE",command});
    const first=f.service.postFulfillmentIssueBatchInTransaction(tx,command,proof),outcome=Promise.allSettled([first]);
    try{await entered.promise;await assert.rejects(f.service.postFulfillmentIssueBatchInTransaction(tx,command,proof),{code:"CONCURRENT_OPERATION"});}finally{release.release();}
    const [result]=await outcome;if(result.status==="rejected")throw result.reason;
    assert.deepEqual(await f.service.postFulfillmentIssueBatchInTransaction(tx,command,proof),result.value);
  },{isolationLevel:"READ COMMITTED"});
  assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM inventory_movements"))[0][0].n),2);
});
