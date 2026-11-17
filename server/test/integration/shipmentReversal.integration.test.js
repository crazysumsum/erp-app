import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { reversalFixture,startReversal,completeReversal,facts,sequence,supportFacts,nativeActor,inventoryTables,removeReversePermission,observeReverseClaim,renewedRow,observeCommittedInputs,assertRolledBack,assertCommittedReversal,mapperData } from "../fulfillment/shipmentReversalFixture.js";
import { inventoryNativeFixture } from "../fulfillment/inventoryNativeFixture.js";
import { ShipmentReversalService } from "../../src/modules/fulfillment/ShipmentReversalService.js";
import { ShipmentConfirmationService } from "../../src/modules/fulfillment/ShipmentConfirmationService.js";
import { FulfillmentOperationService } from "../../src/modules/fulfillment/FulfillmentOperationService.js";
import { mapShipmentReversalSources } from "../../src/modules/fulfillment/shipmentReversalMapping.js";
import { readShipmentReversalSnapshot } from "../../src/modules/fulfillment/shipmentReversalSnapshot.js";
import { getTransactionOutcome,getActiveTransactionIsolation } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
import { up as operationsUp } from "../../database/migrations/0092_create_fulfillment_operations_and_sequences.js";

// Sam call_fc8cb538f28f4de2bf7f702129daa20b: exact six frozen groups plus four writer groups; no capacity workload.
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const nativeOptions={timeout:120000,concurrency:false};

nativeTest("REVERSE-INTERNAL preparation and genuine started identity",nativeOptions,async t=>{
 const f=await reversalFixture(t,{twoLines:true,archives:true,noDownstream:true}),started=await startReversal(f),before=await facts(f),numbers=await sequence(f);
 assert.ok(await f.execute(()=>f.reversal.readStartedReversal(started))===started);
 assert.equal(await f.execute(()=>f.reversal.readStartedReversal(structuredClone(started))),null);
 const prepared=await f.execute(()=>f.reversal.prepareReversalReadOnly(f.shipmentId,f.command,started));
 assert.equal(prepared.outcome,"REVERSING");assert.equal(prepared.operationId,started.operationId);assert.ok(Object.isFrozen(prepared.preparation));
 const lines=prepared.preparation.inventoryPayload.lines;assert.equal(lines.length,2);assert.equal(lines.filter(row=>row.baseQuantity==="0"&&row.reservations.length===0).length,1);
 assert.equal(lines.flatMap(row=>row.reservations).length,1);assert.equal(lines.flatMap(row=>row.reservations.flatMap(member=>member.allocations)).length,2);assert.deepEqual(await facts(f),before);
 const replay=await startReversal(f);assert.deepEqual(replay,started);assert.equal(await f.execute(()=>f.reversal.readStartedReversal(replay)),null);assert.deepEqual(await facts(f),before);
 const later=await sequence(f),oldNumber=numbers.find(row=>row.document_type==="REVERSAL");assert.ok(oldNumber);assert.equal(Number(later.find(row=>row.id===oldNumber.id).next_value),Number(oldNumber.next_value)+1);
 const row=before.fulfillment_operation_requests.find(row=>String(row.id)===started.operationId);
 const [changed]=await f.db.execute("UPDATE fulfillment_operation_requests SET lease_expires_at=1 WHERE id=? AND event_id=? AND status='IN_PROGRESS' AND lease_owner=? AND attempt_count=? AND payload_hash=? AND lease_expires_at=?",[row.id,f.command.eventId,row.lease_owner,row.attempt_count,row.payload_hash,row.lease_expires_at]);assert.equal(changed.affectedRows,1);
 const [[clock]]=await f.db.query("SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) AS now_ms");assert.ok(Number(clock.now_ms)>1);
 assert.equal(await f.execute(()=>f.reversal.readStartedReversal(started)),null);
 const expected=structuredClone(before);expected.fulfillment_operation_requests.find(op=>String(op.id)===started.operationId).lease_expires_at=1;assert.deepEqual(await facts(f),expected);assert.equal(f.startCalls,2);
});

nativeTest("REVERSE-INTERNAL ambiguous original terminal audit",nativeOptions,async t=>{
 const f=await reversalFixture(t),before=await facts(f),terminal=before.fulfillment_audit_logs.filter(row=>row.action==="SHIP"&&row.event_id===f.originalEventId&&(typeof row.after_summary==="string"?JSON.parse(row.after_summary):row.after_summary)?.status==="SHIPPED");assert.equal(terminal.length,2);
 const copy={...terminal.find(row=>row.target_type==="SHIPMENT")};delete copy.id;
 for(const field of ["before_summary","after_summary","details"])if(copy[field]!==null&&typeof copy[field]==="object")copy[field]=JSON.stringify(copy[field]);
 const columns=Object.keys(copy);await f.db.execute(`INSERT INTO fulfillment_audit_logs (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`,Object.values(copy));
 const seeded=await facts(f);assert.equal(seeded.fulfillment_audit_logs.length,before.fulfillment_audit_logs.length+1);
 await assert.rejects(f.execute(()=>readShipmentReversalSnapshot(f.database,f.shipmentId)),{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});assert.deepEqual(await facts(f),seeded);assert.equal(f.startCalls,0);
});

test("REVERSE-INTERNAL mapper rejects three misbound source copies",{timeout:10000,concurrency:false},()=>{
 const original=mapperData();assert.equal(mapShipmentReversalSources(original.snapshot,original.sales,original.inventory).inventoryPayload.lines[0].baseQuantity,"3");
 const missing=structuredClone(original);missing.snapshot.issues.pop();
 const operation=structuredClone(original);operation.snapshot.issues[0].inventory_operation_id="999";
 const mapping=structuredClone(original);mapping.sales.lines[0].reservations[0].salesReservationMappingId="999";
 for(const candidate of [missing,operation,mapping]){const before=structuredClone(candidate);assert.throws(()=>mapShipmentReversalSources(candidate.snapshot,candidate.sales,candidate.inventory),{code:"FULFILLMENT_SOURCE_CONFLICT"});assert.deepEqual(candidate,before);}
 assert.deepEqual(original,mapperData());
});

nativeTest("REVERSE-INTERNAL terminal lookup binds exact command and actor",nativeOptions,async t=>{
 const f=await inventoryNativeFixture(t);await operationsUp(f.db);
 const operations=new FulfillmentOperationService({database:f.database,time:f.time}),reversal=new ShipmentReversalService({database:f.database,time:f.time,logger:f.logger});
 const command=eventId=>({eventId,version:3,reason:"Synthetic original dispatch under company control",goodsUnderCompanyControl:true,goodsReturnedToOriginalBins:true});
 const success=command(randomUUID()),failure=command(randomUUID()),request=payload=>({eventId:payload.eventId,operationType:"REVERSE",target:{type:"SHIPMENT",id:"1"},payload,leaseOwner:randomUUID(),correlationId:randomUUID()}),a=request(success),b=request(failure),result={id:"1",status:"REVERSED",version:5,number:"SHP-202611-000001"};
 await f.withActor(tx=>operations.claimInTransaction(tx,a),{isolationLevel:"READ COMMITTED"});
 await f.withActor(tx=>operations.succeedInTransaction(tx,{request:a,result}),{isolationLevel:"READ COMMITTED"});
 await f.withActor(tx=>operations.claimInTransaction(tx,b),{isolationLevel:"READ COMMITTED"});
 await f.withActor(tx=>operations.failKnownRolledBackInTransaction(tx,{request:b,publicErrorCode:"VERSION_CONFLICT",publicErrorDetails:{currentVersion:4}}),{isolationLevel:"READ COMMITTED"});
 const rows=()=>f.db.query("SELECT * FROM fulfillment_operation_requests ORDER BY id"),before=(await rows())[0];assert.equal(before.length,2);
 assert.deepEqual(await nativeActor(f,()=>reversal.readReversalTerminal("1",success)),{outcome:"REVERSED",shipment:result});
 await assert.rejects(nativeActor(f,()=>reversal.readReversalTerminal("1",failure)),{code:"VERSION_CONFLICT"});
 await assert.rejects(nativeActor(f,()=>reversal.readReversalTerminal("1",{...success,reason:"Different synthetic reason under the same event"})),{code:"FULFILLMENT_SOURCE_CONFLICT"});
 let restore;try{restore=await removeReversePermission(f,f.actor.userId);await assert.rejects(nativeActor(f,()=>reversal.readReversalTerminal("1",success)),error=>error.code==="PERMISSION_STALE"&&error.statusCode===403);}finally{await restore?.();}
 assert.deepEqual((await rows())[0],before);
});

nativeTest("REVERSE-INTERNAL preparation rejects permission revoked after snapshot",nativeOptions,async t=>{
 const f=await reversalFixture(t,{archives:true,noDownstream:true}),started=await startReversal(f),before=await facts(f),sales=f.reversal.sales,lookup=f.reversal.inventoryLookup,original=sales.getShipmentReversalScope,originalInventory=lookup.getFulfillmentReversalPreparationInTransaction;
 let restore,entered=0,inventoryCalls=0;
 sales.getShipmentReversalScope=async function(...args){entered++;assert.ok(f.database.context.get()?.databaseTransaction===null,"Snapshot transaction has completed");restore=await removeReversePermission(f,f.userId);return original.apply(this,args);};
 lookup.getFulfillmentReversalPreparationInTransaction=function(...args){inventoryCalls++;return originalInventory.apply(this,args);};
 try{await assert.rejects(f.execute(()=>f.reversal.prepareReversalReadOnly(f.shipmentId,f.command,started)),error=>error.code==="PERMISSION_STALE"&&error.statusCode===403);assert.equal(entered,1);assert.equal(inventoryCalls,0);assert.deepEqual(await facts(f),before);assert.equal(f.startCalls,1);}
 finally{sales.getShipmentReversalScope=original;lookup.getFulfillmentReversalPreparationInTransaction=originalInventory;await restore?.();}
});

nativeTest("REVERSE-INTERNAL current SHIP verifier rejects untrusted REVERSE inputs",nativeOptions,async t=>{
 const f=await inventoryNativeFixture(t),confirmation=new ShipmentConfirmationService({database:f.database,time:f.time,logger:f.logger}),inventory=confirmation.inventoryLookup,sales=confirmation.sales,before=await facts(f,inventoryTables);let dml=0;
 const run=work=>f.withActor(async tx=>{const execute=tx.execute;tx.execute=function(...args){dml++;return execute.apply(this,args);};try{return await work(tx);}finally{tx.execute=execute;}},{isolationLevel:"READ COMMITTED"});
 await assert.rejects(run(tx=>inventory.prepareShipmentReversalOutcomeReadInTransaction(tx,{})),{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});
 await assert.rejects(run(tx=>sales.readShipmentReversalOutcomeInTransaction(tx,{})),{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});
 await assert.rejects(run(tx=>inventory.verifyShipmentReversalOutcomeProofInTransaction(tx,{},{state:"SUCCEEDED"})),{code:"INVENTORY_SOURCE_CONFLICT"});
 await assert.rejects(run(tx=>sales.verifyShipmentReversalOutcomeProofInTransaction(tx,{},{state:"SUCCEEDED"})),{code:"SALES_FULFILLMENT_CONTRACT_MISMATCH"});
 assert.equal(dml,0);assert.deepEqual(await facts(f,inventoryTables),before);
});

nativeTest("REVERSE-PHASEB atomic two-leg restore and genuine ownership",nativeOptions,async t=>{
 const f=await reversalFixture(t,{twoLines:true,archives:true,noDownstream:true});await startReversal(f);const before=await facts(f),numbers=await sequence(f),support=await supportFacts(f);
 await assert.rejects(completeReversal(f,structuredClone(f.started)),{code:"FULFILLMENT_SOURCE_CONFLICT"});assert.deepEqual(await facts(f),before);
 const evidence=observeCommittedInputs(f),inventory=f.reversal.inventoryLookup.fulfillment,original=inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction,reached=Promise.withResolvers(),release=Promise.withResolvers(),controller=new AbortController(),originalTransaction=f.database.withTransaction,previousShutdown=f.f.cleanup.shutdown;
 const callbacks=[];let calls=0,transactions=0,genuine,overlap,settled=false,cleanupPromise,rejectWait;
 const stopWait=()=>rejectWait?.(t.signal.reason);
 const abort=()=>{release.resolve();controller.abort(t.signal.reason);};t.signal.addEventListener("abort",abort,{once:true});
 f.database.withTransaction=function(work,...args){transactions++;return originalTransaction.call(this,function(...inputs){let pending;try{pending=Promise.resolve(work.apply(this,inputs));}catch(error){pending=Promise.reject(error);}callbacks.push(pending);void pending.catch(()=>{});return pending;},...args);};
 inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction=async function(tx,command,proof){calls++;assert.equal(command.source.eventId,f.command.eventId);assert.ok(tx===f.database.context.get()?.databaseTransaction,"Actual writer executor");assert.equal(getActiveTransactionIsolation(tx),"READ COMMITTED");reached.resolve();await release.promise;return original.call(this,tx,command,proof);};
 const cleanup=()=>cleanupPromise??=(async()=>{
  release.resolve();if(genuine&&!settled)controller.abort(new Error("Owned reversal case cleanup"));await Promise.allSettled([genuine,overlap].filter(Boolean));
  const errors=[];let drained=0;try{while(drained<callbacks.length){const pending=callbacks.slice(drained);drained=callbacks.length;for(const result of await Promise.allSettled(pending))if(result.status==="rejected")errors.push(result.reason);}}
  finally{inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction=original;f.database.withTransaction=originalTransaction;evidence.restore();t.signal.removeEventListener("abort",abort);t.signal.removeEventListener("abort",stopWait);}
  if(errors.length)throw new AggregateError(errors,"Owned actual transaction callbacks rejected during drain");
 })();
 f.f.cleanup.shutdown=async()=>{try{await cleanup();}finally{await previousShutdown();}};
 try{
  genuine=completeReversal(f,f.started,{signal:controller.signal}).then(value=>{settled=true;return value;},error=>{settled=true;throw error;});void genuine.catch(()=>{});
  await Promise.race([reached.promise,genuine.then(()=>{throw new Error("Expected actual PhaseB barrier was not reached");}),new Promise((_,reject)=>{rejectWait=reject;if(t.signal.aborted)stopWait();else t.signal.addEventListener("abort",stopWait,{once:true});})]);t.signal.removeEventListener("abort",stopWait);
  const count=transactions;overlap=completeReversal(f);await assert.rejects(overlap,{code:"CONCURRENT_OPERATION"});assert.equal(transactions,count,"Same-object overlap does not open a second DB transaction");release.resolve();
  const result=await genuine;assert.equal(result.outcome,"REVERSED");assert.equal(calls,1);const after=await facts(f);assertCommittedReversal(before,after,f);
  assert.deepEqual(await completeReversal(f),result);assert.deepEqual(await facts(f),after);assert.deepEqual(await sequence(f),numbers);assert.deepEqual(await supportFacts(f),support);assert.equal(f.startCalls,1);assert.equal(f.completionCalls,4);
 }finally{await cleanup();}
});

nativeTest("REVERSE-PHASEB late audit rollback blocks same-object retry",nativeOptions,async t=>{
 const f=await reversalFixture(t,{archives:true,noDownstream:true});await startReversal(f);const before=await facts(f),numbers=await sequence(f),support=await supportFacts(f);let actual,renewal,originalExecute,forwards=0,faults=0;
 const observer=observeReverseClaim(f,async tx=>{assert.ok(actual===undefined,"Exactly one actual business executor");actual=tx;renewal=await renewedRow(tx,f);originalExecute=tx.execute;tx.execute=async function(sql,args,...rest){const result=await originalExecute.call(this,sql,args,...rest);if(sql==="INSERT INTO fulfillment_audit_logs (target_type,target_id,action,event_id,correlation_id,actor_user_id,actor_label,after_summary,occurred_at) VALUES (?,?,'REVERSE',?,?,?,?,?,?)"&&args[0]==="REVERSAL"&&String(args[1])===f.started.reversal.id&&args[2]===f.command.eventId&&args[3]===f.started.correlationId){forwards++;assert.equal(forwards,1);faults++;throw Object.assign(new Error("Synthetic final REVERSAL audit forwarding fault"),{code:"FULFILLMENT_TEST_REVERSAL_AUDIT_AFTER_INSERT"});}return result;};});
 try{
  await assert.rejects(completeReversal(f),error=>error.code==="DATABASE_TRANSACTION_FAILED"&&error.cause?.code==="FULFILLMENT_TEST_REVERSAL_AUDIT_AFTER_INSERT");assert.equal(forwards,1);assert.equal(faults,1);assert.deepEqual(getTransactionOutcome(actual),{state:"ROLLED_BACK"});
  await assertRolledBack(f,before,renewal);assert.deepEqual(await completeReversal(f),f.started);assert.equal(observer.calls,1);await assertRolledBack(f,before,renewal);assert.deepEqual(await sequence(f),numbers);assert.deepEqual(await supportFacts(f),support);assert.equal(f.startCalls,1);assert.equal(f.completionCalls,2);
 }finally{if(actual&&originalExecute)actual.execute=originalExecute;observer.restore();}
});

nativeTest("REVERSE-PHASEB lost commit ACK resolves by original terminal",nativeOptions,async t=>{
 const f=await reversalFixture(t,{archives:true,noDownstream:true});await startReversal(f);const before=await facts(f),numbers=await sequence(f),support=await supportFacts(f);let actual,connection,originalCommit,originalDestroy,originalRelease,commits=0,acks=0,faults=0,destroys=0,releases=0;
 const evidence=observeCommittedInputs(f),observer=observeReverseClaim(f,tx=>{
  assert.ok(actual===undefined,"Exactly one actual business executor");actual=tx;connection=tx.target;assert.ok(connection!==f.db,"Independent fixture observer connection");originalCommit=connection.commit;originalDestroy=connection.destroy;originalRelease=connection.release;
  connection.commit=async function(...args){assert.ok(this===connection&&f.database.context.get()?.databaseTransaction===actual,"Only the selected actual PhaseB connection and executor");assert.equal(getActiveTransactionIsolation(actual),null);commits++;assert.equal(commits,1);await originalCommit.apply(this,args);acks++;faults++;throw Object.assign(new Error("Synthetic PhaseB COMMIT ACK lost after native commit"),{code:"PROTOCOL_CONNECTION_LOST"});};
  connection.destroy=function(...args){destroys++;return originalDestroy.apply(this,args);};connection.release=function(...args){releases++;return originalRelease.apply(this,args);};
 });
 try{
  await assert.rejects(completeReversal(f),error=>error.code==="DATABASE_TRANSACTION_INDETERMINATE"&&error.cause?.code==="PROTOCOL_CONNECTION_LOST");assert.equal(commits,1);assert.equal(acks,1);assert.equal(faults,1);assert.equal(destroys,1);assert.equal(releases,0);assert.deepEqual(getTransactionOutcome(actual),{state:"INDETERMINATE"});
  const persisted=await facts(f);assertCommittedReversal(before,persisted,f);const terminal=await f.execute(()=>f.reversal.readReversalTerminal(f.shipmentId,f.command));assert.equal(terminal.outcome,"REVERSED");assert.deepEqual(await completeReversal(f),terminal);assert.deepEqual(await facts(f),persisted);assert.deepEqual(await sequence(f),numbers);assert.deepEqual(await supportFacts(f),support);assert.equal(observer.calls,1);assert.equal(f.startCalls,1);assert.equal(f.completionCalls,2);
 }finally{if(connection){connection.commit=originalCommit;connection.destroy=originalDestroy;connection.release=originalRelease;}observer.restore();evidence.restore();}
});

nativeTest("REVERSE-PHASEB complete locked source rejects active zero-line Claim",nativeOptions,async t=>{
 const f=await reversalFixture(t,{twoLines:true,archives:true,noDownstream:true});await startReversal(f);const initial=await facts(f),line=initial.fulfillment_lines.find(row=>String(row.shipped_base_quantity)==="0"),claims=initial.fulfillment_line_reservation_claims.filter(row=>String(row.fulfillment_line_id)===String(line.id));assert.equal(claims.length,1);const claim=claims[0];assert.equal(claim.status,"RELEASED");assert.equal(String(claim.original_claimed_quantity),"5");
 const [changed]=await f.db.execute("UPDATE fulfillment_line_reservation_claims SET active_claimed_quantity=5,released_quantity=0,status='ACTIVE' WHERE id=? AND fulfillment_id=? AND fulfillment_line_id=? AND sales_order_line_reservation_id=? AND inventory_reservation_id=? AND original_claimed_quantity=5 AND status='RELEASED' AND active_claimed_quantity=0 AND released_quantity=5 AND consumed_quantity=0 AND reversed_quantity=0 AND inventory_version=? AND updated_at=?",[claim.id,claim.fulfillment_id,claim.fulfillment_line_id,claim.sales_order_line_reservation_id,claim.inventory_reservation_id,claim.inventory_version,claim.updated_at]);assert.equal(changed.affectedRows,1);
 const before=await facts(f),numbers=await sequence(f),support=await supportFacts(f),actualClaim=before.fulfillment_line_reservation_claims.find(row=>String(row.id)===String(claim.id)),omit=row=>Object.fromEntries(Object.entries(row).filter(([key])=>!["active_claimed_quantity","released_quantity","status"].includes(key)));assert.deepEqual(omit(actualClaim),omit(claim));assert.equal(String(actualClaim.active_claimed_quantity),"5");assert.equal(String(actualClaim.released_quantity),"0");assert.equal(actualClaim.status,"ACTIVE");
 const inventory=f.reversal.inventoryLookup.fulfillment,original=inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction;let posts=0,actual,renewal;
 inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction=function(...args){posts++;return original.apply(this,args);};const observer=observeReverseClaim(f,async tx=>{assert.ok(actual===undefined,"Exactly one actual business executor");actual=tx;renewal=await renewedRow(tx,f);});
 try{await assert.rejects(completeReversal(f),{code:"FULFILLMENT_SOURCE_CONFLICT"});assert.equal(posts,0);assert.equal(observer.calls,1);assert.deepEqual(getTransactionOutcome(actual),{state:"ROLLED_BACK"});await assertRolledBack(f,before,renewal);assert.deepEqual(await sequence(f),numbers);assert.deepEqual(await supportFacts(f),support);assert.equal(f.startCalls,1);assert.equal(f.completionCalls,1);}
 finally{inventory.reverseFulfillmentIssueAndRestoreReservationBatchInTransaction=original;observer.restore();}
});
