// Proposed exact75B functional publication: twelve finite case families; original fixture/attempt ceilings retained.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import process from 'node:process';
import {shipmentDraftFixture} from '../../test/fulfillment/p1CancellationFixture.js';
import {up as issueSchema} from '../../database/migrations/0097_create_shipment_issues_and_reversals.js';
import {ShipmentConfirmationService} from '../../src/modules/fulfillment/ShipmentConfirmationService.js';
import {getTransactionOutcome,getActiveTransactionIsolation} from '../../src/services/mysqldatabase/MySqlDatabaseService.js';
import {ownerQuantities} from '../../test/fulfillment/p1Fixture.js';
import {shipmentTwoLineFixture} from '../../test/fulfillment/p1CancellationFixture.js';
import {FulfillmentPickingService} from '../../src/modules/fulfillment/FulfillmentPickingService.js';
import {up as shipmentFactsUp} from '../../database/migrations/0097_create_shipment_issues_and_reversals.js';
import {InventoryFulfillmentService} from '../../src/modules/inventory/InventoryFulfillmentService.js';
import {createHash} from 'node:crypto';
import {InventoryPostingService} from '../../src/modules/inventory/InventoryPostingService.js';
import {normalizeAdjustmentCommand} from '../../src/modules/inventory/inventoryAdjustmentPosting.js';
import {issueInventoryHighRiskContext} from '../../src/modules/inventory/inventoryHighRiskContext.js';
import {startP1Http} from '../../test/fulfillment/p1Fixture.js';
import {ShipmentShippingLookupService} from '../../src/modules/fulfillment/ShipmentShippingLookupService.js';
import {readdir} from 'node:fs/promises';
import {cancellationFixture} from '../../test/fulfillment/p1CancellationFixture.js';
import {ShipmentService} from '../../src/modules/fulfillment/ShipmentService.js';
import {createApplication} from '../../src/framework/application/createApplication.js';
import {defaultConfigurationSource} from '../../src/framework/configuration/applicationConfiguration.js';
import {createMySqlDatabasePool} from '../../src/services/mysqldatabase/connection.js';
const nativeTest=process.env.DB_INTEGRATION_TESTS==='1'?test:test.skip;
async function ownedScenario(t,run,timeoutMs=null){
 const cleanup=[],errors=[],signal=timeoutMs===null?t.signal:AbortSignal.any([t.signal,AbortSignal.timeout(timeoutMs)]);
 try{await run({signal,after:close=>cleanup.push(close),diagnostic:value=>t.diagnostic(value)});signal.throwIfAborted();}catch(error){errors.push(error);}
 for(const close of cleanup)try{await close();}catch(error){errors.push(error);}
 if(signal.aborted&&!errors.includes(signal.reason))errors.push(signal.reason);
 if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'Confirmation scenario and owned cleanup failed');
}
const intent=(()=>{
// Approved75B CONFIRM-INTENT two small fixtures, four PhaseA calls; outside CI discovery.

const tables=['sales_orders','sales_order_lines','sales_order_line_reservations','sales_operation_requests','sales_order_status_history','sales_audit_logs','inventory_reservations','inventory_stock_controls','inventory_stock_balances','inventory_allocations','inventory_movements','inventory_operation_requests','inventory_audit_logs','fulfillments','fulfillment_lines','fulfillment_line_reservation_claims','fulfillment_allocations','fulfillment_status_history','fulfillment_audit_logs','fulfillment_operation_requests','shipments','shipment_lines','shipment_issue_details','shipment_status_history'];
async function facts(f){const output={};for(const table of tables)output[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return output;}

function latch(){let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};}
function without(row,keys){return Object.fromEntries(Object.entries(row).filter(([key])=>!keys.includes(key)));}
function prefixUnchanged(before,after){for(const table of ['shipment_status_history','fulfillment_operation_requests','fulfillment_audit_logs'])assert.deepEqual(after[table].filter(row=>before[table].some(prior=>String(prior.id)===String(row.id))),before[table],table);}
function shipmentStable(before,after){assert.deepEqual(without(after,['status','confirmation_event_id','correlation_id','version','updated_at','last_business_updated_at','updated_by','cancelled_at','cancelled_by','cancel_reason']),without(before,['status','confirmation_event_id','correlation_id','version','updated_at','last_business_updated_at','updated_by','cancelled_at','cancelled_by','cancel_reason']));}
async function gateOrFailure(gate,call){await Promise.race([gate.promise,call.then(()=>{throw new Error('Call settled before required barrier');})]);}
async function scenario(name){
 const cleanup=[],errors=[],calls=[],release=latch();let evidence,firstClaimRow=null;
 const track=call=>{call.catch(()=>{});calls.push(call);return call;};
 try{
  const f=await shipmentDraftFixture({after:fn=>cleanup.push(fn)});await issueSchema(f.db);const draft=await f.create(f.body()),service=new ShipmentConfirmationService(f.options),before=await facts(f),eventId=randomUUID();let confirmations=0,cancels=0;
  const firstClaimed=latch(),secondEntered=latch(),transactions=[];const original=service.operations.claimInTransaction.bind(service.operations);
  service.operations.claimInTransaction=async(tx,...args)=>{transactions.push(tx);assert.equal(getActiveTransactionIsolation(tx),'READ COMMITTED');const result=await original(tx,...args);if(result.created){[[firstClaimRow]]=await tx.query('SELECT * FROM fulfillment_operation_requests WHERE event_id=?',[eventId]);firstClaimed.release();await release.promise;}return result;};
  if(name==='same-event-double-start'){
   const read=service.operations.getShipmentConfirmationReplayInTransaction.bind(service.operations);let entries=0,secondTx=null;
   service.operations.getShipmentConfirmationReplayInTransaction=async(tx,...args)=>{entries++;assert.equal(getActiveTransactionIsolation(tx),'READ COMMITTED');if(entries===2){secondTx=tx;secondEntered.release();}return read(tx,...args);};
   const first=track(f.execute(()=>{confirmations++;return service.startConfirmation(draft.outcome.id,{eventId,version:1});}));await gateOrFailure(firstClaimed,first);
   const second=track(f.execute(()=>{confirmations++;return service.startConfirmation(draft.outcome.id,{eventId,version:1});}));
   await assert.rejects(second,{code:'DATABASE_EVENT_ADMISSION_UNAVAILABLE',statusCode:503});assert.equal(entries,1,'Contending caller never entered the transaction callback');assert.equal(transactions.length,1);release.release();
   const a=await first,b=await track(f.execute(()=>{confirmations++;return service.startConfirmation(draft.outcome.id,{eventId,version:1});}));assert.equal(confirmations,3);assert.equal(entries,2);
   assert.equal(a.outcome,'SHIPPING');assert.deepEqual(b,a);assert.equal(service.ownsStartedConfirmation(a),true);assert.equal(service.ownsStartedConfirmation(b),false);assert.equal(transactions.length,2);assert.notEqual(transactions[0],secondTx);assert.equal(transactions[1],secondTx);assert.equal(getTransactionOutcome(transactions[0])?.state,'COMMITTED');assert.equal(getTransactionOutcome(secondTx)?.state,'COMMITTED');
   const after=await facts(f),changed=['shipments','shipment_status_history','fulfillment_operation_requests','fulfillment_audit_logs'];for(const table of tables)if(!changed.includes(table))assert.deepEqual(after[table],before[table],table);
   assert.equal(after.shipments.length,1);assert.equal(after.shipments[0].status,'SHIPPING');assert.equal(Number(after.shipments[0].version),2);assert.equal(after.shipments[0].confirmation_event_id,eventId);
   assert.equal(after.shipment_status_history.length,before.shipment_status_history.length+1);const history=after.shipment_status_history.at(-1);assert.equal(history.action,'CONFIRM_START');assert.equal(history.event_id,eventId);assert.equal(Number(history.version_after),2);assert.equal(String(history.actor_user_id),String(f.userId));
   assert.equal(after.fulfillment_operation_requests.length,before.fulfillment_operation_requests.length+1);const op=after.fulfillment_operation_requests.find(row=>row.event_id===eventId);assert.equal(op.status,'IN_PROGRESS');assert.equal(String(op.id),a.operationId);assert.equal(op.correlation_id,a.correlationId);assert.equal(String(op.initiated_by),String(f.userId));assert.equal(op.result_json,null);assert.equal(Number(firstClaimRow.attempt_count),1);assert.deepEqual(op,firstClaimRow);prefixUnchanged(before,after);shipmentStable(before.shipments[0],after.shipments[0]);
   assert.equal(after.fulfillment_audit_logs.length,before.fulfillment_audit_logs.length+1);const audit=after.fulfillment_audit_logs.at(-1);assert.equal(audit.action,'SHIP');assert.equal(audit.event_id,eventId);assert.equal(audit.correlation_id,a.correlationId);assert.equal(String(audit.actor_user_id),String(f.userId));
   evidence={scenario:name,confirmations,cancels,concurrentCallers:2,committedTransactions:2,contentionRefusedBeforeBegin:true,oneOwnedStart:true,oneOperation:true,oneStartHistory:true,inventoryEffects:0,result:'PASS'};
  }else{
   assert.equal(name,'confirm-vs-cancel');const cancelEvent=randomUUID(),cancelClaimed=latch(),cancelClaim=f.service.operations.claimInTransaction.bind(f.service.operations);let cancelTx=null;
   f.service.operations.claimInTransaction=async(tx,...args)=>{cancelTx=tx;assert.equal(getActiveTransactionIsolation(tx),'READ COMMITTED');const result=await cancelClaim(tx,...args);assert.equal(result.created,true);cancelClaimed.release();await release.promise;return result;};
   const confirm=track(f.execute(()=>{confirmations++;return service.startConfirmation(draft.outcome.id,{eventId,version:1});}));await gateOrFailure(firstClaimed,confirm);
   const cancel=track(f.execute(()=>{cancels++;return f.service.cancelDraft(draft.outcome.id,{eventId:cancelEvent,version:1,reason:'Synthetic intent race'});}));await gateOrFailure(cancelClaimed,cancel);assert.notEqual(transactions[0],cancelTx);release.release();const results=await Promise.allSettled([confirm,cancel]);assert.equal(results.filter(row=>row.status==='fulfilled').length,1);assert.equal(results.filter(row=>row.status==='rejected').length,1);const winner=results[0].status==='fulfilled'?'CONFIRM':'CANCEL',loser=results.find(row=>row.status==='rejected').reason;assert.ok(['SHIPMENT_STATE_CONFLICT','FULFILLMENT_STATE_CONFLICT'].includes(loser.code));assert.equal(getTransactionOutcome(transactions[0])?.state,winner==='CONFIRM'?'COMMITTED':'ROLLED_BACK');assert.equal(getTransactionOutcome(cancelTx)?.state,winner==='CANCEL'?'COMMITTED':'ROLLED_BACK');
   const after=await facts(f),changed=['shipments','fulfillments','shipment_status_history','fulfillment_operation_requests','fulfillment_audit_logs'];for(const table of tables)if(!changed.includes(table))assert.deepEqual(after[table],before[table],table);
   const row=after.shipments[0],root=after.fulfillments[0],winnerEvent=winner==='CONFIRM'?eventId:cancelEvent,loserEvent=winner==='CONFIRM'?cancelEvent:eventId;assert.equal(after.shipments.length,1);assert.equal(row.status,winner==='CONFIRM'?'SHIPPING':'CANCELLED');assert.equal(Number(row.version),2);assert.equal(row.confirmation_event_id,winner==='CONFIRM'?eventId:null);assert.equal(root.status,'PICKED');assert.equal(root.active_shipment_id===null?null:String(root.active_shipment_id),winner==='CONFIRM'?draft.outcome.id:null);assert.equal(Number(root.version),Number(before.fulfillments[0].version)+(winner==='CANCEL'?1:0));
   assert.equal(after.shipment_status_history.length,before.shipment_status_history.length+1);const history=after.shipment_status_history.at(-1);assert.equal(history.event_id,winnerEvent);assert.equal(history.action,winner==='CONFIRM'?'CONFIRM_START':'CANCEL');assert.equal(Number(history.version_after),2);assert.equal(String(history.actor_user_id),String(f.userId));
   assert.equal(after.fulfillment_operation_requests.length,before.fulfillment_operation_requests.length+1);const op=after.fulfillment_operation_requests.find(row=>row.event_id===winnerEvent);assert.ok(op);assert.equal(String(op.initiated_by),String(f.userId));assert.equal(op.status,winner==='CONFIRM'?'IN_PROGRESS':'SUCCEEDED');assert.equal(after.fulfillment_operation_requests.filter(row=>row.event_id===loserEvent).length,0);prefixUnchanged(before,after);shipmentStable(before.shipments[0],row);assert.deepEqual(without(root,['active_shipment_id','version','updated_at','last_business_updated_at','updated_by']),without(before.fulfillments[0],['active_shipment_id','version','updated_at','last_business_updated_at','updated_by']));if(winner==='CONFIRM')assert.deepEqual(root,before.fulfillments[0]);
   assert.equal(after.fulfillment_audit_logs.length,before.fulfillment_audit_logs.length+1);const audit=after.fulfillment_audit_logs.at(-1);assert.equal(audit.event_id,winnerEvent);assert.equal(audit.action,winner==='CONFIRM'?'SHIP':'CANCEL');assert.equal(audit.correlation_id,op.correlation_id);assert.equal(String(audit.actor_user_id),String(f.userId));
   evidence={scenario:name,confirmations,cancels,concurrentTransactions:2,winner,loserCode:loser.code,oneOperation:true,oneStateTransition:true,inventoryEffects:0,result:'PASS'};
  }
 }catch(error){errors.push(error);}finally{release.release();await Promise.allSettled(calls);for(const close of cleanup.reverse())try{await close();}catch(error){errors.push(error);}}
 if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'Intent race and owned cleanup failed');return evidence;
}

return async function(t){
 for(const name of ['same-event-double-start','confirm-vs-cancel'])t.diagnostic(JSON.stringify(await scenario(name)));
};
})();

const failedAfterEdit=(()=>{
// Private functional/security probes only. Not collected by regular CI.
async function setup(t){const f=await shipmentDraftFixture(t),created=await f.create(f.body()),confirmation=new ShipmentConfirmationService(f.options);return {...f,shipmentId:created.outcome.id,start:body=>f.execute(()=>confirmation.startConfirmation(created.outcome.id,body))};}

return async function(t){
 const f=await setup(t),command={eventId:randomUUID(),version:1};await f.start(command);
 const [[original]]=await f.db.query('SELECT payload_hash FROM fulfillment_operation_requests WHERE event_id=?',[command.eventId]);
 // Seed the already-approved completed rollback outcome; this does not implement PhaseB.
 await f.execute(()=>f.database.withTransaction(async tx=>{
  await tx.query('SELECT id FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE',[command.eventId]);await tx.query('SELECT id FROM fulfillments WHERE id=? FOR UPDATE',[f.created.outcome.id]);
  await tx.execute("UPDATE shipments SET status='DRAFT',confirmation_event_id=NULL,version=version+1 WHERE id=? AND status='SHIPPING' AND confirmation_event_id=?",[f.shipmentId,command.eventId]);
  await tx.execute("UPDATE fulfillment_operation_requests SET status='FAILED',public_error_code='SHIPPING_ADDRESS_CHANGED',public_error_details=NULL,result_json=NULL,lease_owner='',lease_expires_at=NULL,next_attempt_at=NULL,completed_at=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) WHERE event_id=? AND status='IN_PROGRESS'",[command.eventId]);
 },{isolationLevel:'READ COMMITTED'}));
 await f.update(f.shipmentId,{...f.body(),version:3,notes:'Synthetic later Draft change',weightUom:'G'});
 await assert.rejects(()=>f.start(command),{code:'SHIPPING_ADDRESS_CHANGED'});await assert.rejects(()=>f.start({...command,version:4}),{code:'FULFILLMENT_SOURCE_CONFLICT'});
 const [[after]]=await f.db.query('SELECT payload_hash,status FROM fulfillment_operation_requests WHERE event_id=?',[command.eventId]);assert.equal(after.payload_hash,original.payload_hash);assert.equal(after.status,'FAILED');
};
})();

const terminalWitness=(()=>{
// Approved75B TERMINAL-WITNESS remaining two terminal-journal fixtures; no PhaseB or new Issue.

const tables=['sales_orders','sales_order_lines','sales_order_line_reservations','sales_operation_requests','sales_order_status_history','sales_audit_logs','inventory_reservations','inventory_stock_controls','inventory_stock_balances','inventory_allocations','inventory_movements','inventory_operation_requests','inventory_audit_logs','fulfillments','fulfillment_lines','fulfillment_line_reservation_claims','fulfillment_allocations','fulfillment_status_history','fulfillment_audit_logs','fulfillment_operation_requests','shipments','shipment_lines','shipment_issue_details','shipment_status_history'];
async function facts(f){const output={};for(const table of tables)output[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return output;}

const witnessSql="SELECT shipment_id,event_id,action,from_status,to_status,actor_user_id,version_after FROM shipment_status_history WHERE shipment_id=? AND event_id=? AND action='CONFIRM_START' LIMIT 2";
async function terminalSeed(f,service,shipmentId,version,eventId,state){
 const started=await f.execute(()=>service.startConfirmation(shipmentId,{eventId,version}));
 await f.execute(()=>f.database.withTransaction(async tx=>{
  await tx.query('SELECT id FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE',[eventId]);await tx.query('SELECT id FROM fulfillments WHERE id=? FOR UPDATE',[f.created.outcome.id]);
  const status=state==='SUCCEEDED'?'SHIPPED':'DRAFT',[[ship]]=await tx.query('SELECT shipment_number FROM shipments WHERE id=? FOR UPDATE',[shipmentId]);
  const [changed]=await tx.execute("UPDATE shipments SET status=?,confirmation_event_id=?,version=version+1 WHERE id=? AND status='SHIPPING' AND version=?",[status,state==='SUCCEEDED'?eventId:null,shipmentId,version+1]);assert.equal(changed.affectedRows,1);
  const result=state==='SUCCEEDED'?JSON.stringify({id:shipmentId,number:ship.shipment_number,status:'SHIPPED',version:version+2}):null;
  const [operation]=await tx.execute("UPDATE fulfillment_operation_requests SET status=?,result_json=?,public_error_code=?,public_error_details=NULL,lease_owner='',lease_expires_at=NULL,next_attempt_at=NULL,completed_at=CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED) WHERE event_id=? AND status='IN_PROGRESS'",[state,result,state==='SUCCEEDED'?'':'SHIPPING_ADDRESS_CHANGED',eventId]);assert.equal(operation.affectedRows,1);
  await tx.execute("INSERT INTO shipment_status_history (shipment_id,sequence_no,from_status,to_status,action,event_id,version_after,actor_user_id,actor_label,reason,occurred_at) VALUES (?,3,'SHIPPING',?,?,?,?,?,?,?,?)",[shipmentId,status,state==='SUCCEEDED'?'CONFIRM':'CONFIRM_FAIL',eventId,version+2,f.userId,f.label,state==='SUCCEEDED'?'':'SHIPPING_ADDRESS_CHANGED',f.time.nowMs()]);
 },{isolationLevel:'READ COMMITTED'}));return started;
}
async function highVersionDraft(f){
 const [[root]]=await f.db.query('SELECT * FROM fulfillments WHERE id=?',[f.created.outcome.id]),[[line]]=await f.db.query('SELECT * FROM fulfillment_lines WHERE fulfillment_id=?',[root.id]),version=4294967293,number='SHP-202311-999999',id=String(await f.s.insert('shipments',{shipment_number:number,fulfillment_id:root.id,sales_order_id:root.sales_order_id,customer_id:root.customer_id,warehouse_id:root.warehouse_id,status:'DRAFT',shipping_address_id:f.s.addressId,shipping_address_version:1,line_count:1,version,last_business_updated_at:f.time.nowMs(),created_at:f.time.nowMs(),updated_at:f.time.nowMs(),created_by:f.userId,updated_by:f.userId}));
 await f.s.insert('shipment_lines',{shipment_id:id,fulfillment_id:root.id,fulfillment_line_id:line.id,line_no:1,sales_order_line_id:line.sales_order_line_id,sku_id:line.sku_id,base_uom_id:line.base_uom_id,sku_code_snapshot:'',sku_name_snapshot:'',base_uom_code_snapshot:'',shipped_base_quantity:line.picked_base_quantity,created_at:f.time.nowMs(),updated_at:f.time.nowMs()});
 const [pointer]=await f.db.execute('UPDATE fulfillments SET active_shipment_id=?,version=version+1 WHERE id=? AND active_shipment_id IS NULL',[id,root.id]);assert.equal(pointer.affectedRows,1);await f.s.insert('shipment_status_history',{shipment_id:id,sequence_no:1,from_status:null,to_status:'DRAFT',action:'CREATE',event_id:randomUUID(),version_after:version,actor_user_id:f.userId,actor_label:f.label,occurred_at:f.time.nowMs()});return {id,version};
}
async function scenario(name){
 const cleanup=[],errors=[];let evidence;
 try{
  const f=await shipmentDraftFixture({after:fn=>cleanup.push(fn)});await issueSchema(f.db);const service=new ShipmentConfirmationService(f.options),eventId=randomUUID();let postCalls=0;const realPost=service.inventory.postFulfillmentIssueBatchInTransaction.bind(service.inventory);service.inventory.postFulfillmentIssueBatchInTransaction=async(...args)=>{postCalls++;return realPost(...args);};
  if(name==='succeeded-after-later-state'){
   const draft=await f.create(f.body()),started=await terminalSeed(f,service,draft.outcome.id,1,eventId,'SUCCEEDED');const [later]=await f.db.execute("UPDATE shipments SET status='REVERSING',version=version+1 WHERE id=? AND status='SHIPPED' AND version=3",[draft.outcome.id]);assert.equal(later.affectedRows,1);const before=await facts(f),replay=await f.execute(()=>service.startConfirmation(draft.outcome.id,{eventId,version:1}));assert.equal(replay.outcome,'SHIPPED');assert.equal(replay.result.version,3);assert.equal(replay.result.id,draft.outcome.id);assert.equal(replay.eventId,eventId);assert.equal(replay.operationId,started.operationId);assert.equal(replay.correlationId,started.correlationId);assert.deepEqual(await facts(f),before);assert.equal(before.shipments[0].status,'REVERSING');assert.equal(Number(before.shipments[0].version),4);assert.equal(postCalls,0);assert.equal(before.shipment_issue_details.length,0);
   evidence={scenario:name,terminalJournalSeed:'SUCCEEDED',currentHeader:'REVERSING4',originalResult:'SHIPPED3',replayOrRefusalReads:1,newIssueCompletions:0,all24BusinessFactsUnchanged:true,result:'PASS'};
  }else{
   assert.equal(name,'terminal-witness-and-version-headroom');const draft=await highVersionDraft(f);await terminalSeed(f,service,draft.id,draft.version,eventId,'FAILED');const baseline=await facts(f);assert.equal(baseline.shipments[0].status,'DRAFT');assert.equal(Number(baseline.shipments[0].version),4294967295);assert.equal(baseline.fulfillment_operation_requests.find(row=>row.event_id===eventId).status,'FAILED');let mode=null,observed=0,txSeen=null,claims=0;
   const withTransaction=service.transactions.withTransaction.bind(service.transactions);service.transactions.withTransaction=work=>withTransaction(async tx=>{txSeen=tx;const query=tx.query.bind(tx);tx.query=async(sql,args,...rest)=>{const actual=await query(sql,args,...rest);if(mode&&sql===witnessSql){assert.deepEqual(args,[draft.id,eventId]);assert.equal(actual[0].length,1);assert.equal(Number(actual[0][0].version_after),4294967294);assert.equal(String(actual[0][0].actor_user_id),String(f.userId));observed++;return [mode==='missing'?[]:[{...actual[0][0],actor_user_id:String(f.userId+1)}],actual[1]];}return actual;};try{return await work(tx);}finally{tx.query=query;}});
   for(const fault of ['missing','malformed']){mode=fault;await assert.rejects(()=>f.execute(()=>service.startConfirmation(draft.id,{eventId,version:draft.version})),{code:'FULFILLMENT_DEPENDENCY_UNAVAILABLE'});assert.equal(getTransactionOutcome(txSeen)?.state,'ROLLED_BACK');assert.deepEqual(await facts(f),baseline);}mode=null;assert.equal(observed,2);
   const claim=service.operations.claimInTransaction.bind(service.operations);service.operations.claimInTransaction=async(tx,...args)=>{claims++;return claim(tx,...args);};const newEvent=randomUUID();await assert.rejects(()=>f.execute(()=>service.startConfirmation(draft.id,{eventId:newEvent,version:4294967295})),{code:'VERSION_CONFLICT'});assert.equal(claims,1);assert.equal(getTransactionOutcome(txSeen)?.state,'ROLLED_BACK');assert.deepEqual(await facts(f),baseline);assert.equal(postCalls,0);assert.equal(baseline.shipment_issue_details.length,0);
   evidence={scenario:name,terminalJournalSeed:'FAILED',genuineInitialDraftVersion:4294967293,genuineStartVersion:4294967294,currentDraftVersion:4294967295,historyReadResponseFaults:['missing','malformed'],nativeHistoryAcknowledgements:observed,headroomRefusals:1,replayOrRefusalReads:3,newIssueCompletions:0,all24BusinessFactsUnchanged:true,result:'PASS'};
  }
 }catch(error){errors.push(error);}finally{for(const close of cleanup.reverse())try{await close();}catch(error){errors.push(error);}}
 if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'Terminal journal reader and owned cleanup failed');return evidence;
}

return async function(t){
 for(const name of ['succeeded-after-later-state','terminal-witness-and-version-headroom'])t.diagnostic(JSON.stringify(await scenario(name)));
};
})();

const startRollback=(()=>{
// Private functional/security probes only. Not collected by regular CI.
async function setup(t){const f=await shipmentDraftFixture(t),created=await f.create(f.body()),confirmation=new ShipmentConfirmationService(f.options);return {...f,shipmentId:created.outcome.id,start:body=>f.execute(()=>confirmation.startConfirmation(created.outcome.id,body))};}

return async function(t){
 const f=await setup(t),command={eventId:randomUUID(),version:1},before=await ownerQuantities(f);
 await f.db.query("CREATE TRIGGER synthetic_phasea_audit BEFORE INSERT ON fulfillment_audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic PhaseA late audit failure'");
 await assert.rejects(()=>f.start(command),error=>{for(let e=error,i=0;e&&i<10;e=e.cause,i++)if(e.code==='ER_SIGNAL_EXCEPTION'&&e.message?.includes('Synthetic PhaseA late audit failure'))return true;return false;});
 assert.equal(Number((await f.db.query('SELECT COUNT(*) n FROM fulfillment_operation_requests WHERE event_id=?',[command.eventId]))[0][0].n),0);
 const [[row]]=await f.db.query('SELECT status,version FROM shipments WHERE id=?',[f.shipmentId]);assert.equal(row.status,'DRAFT');assert.equal(row.version,1);assert.equal(Number((await f.db.query("SELECT COUNT(*) n FROM shipment_status_history WHERE event_id=? AND action='CONFIRM_START'",[command.eventId]))[0][0].n),0);assert.deepEqual(await ownerQuantities(f),before);
 await f.db.query('DROP TRIGGER synthetic_phasea_audit');assert.equal((await f.start(command)).outcome,'SHIPPING');
};
})();

const atomicZero=(()=>{
// Approved75B ISSUE-ATOMIC one two-line/two-bucket fixture and one original-event replay.

const tables=['sales_orders','sales_order_lines','sales_order_line_reservations','sales_operation_requests','sales_order_status_history','sales_audit_logs','inventory_reservations','inventory_stock_controls','inventory_stock_balances','inventory_allocations','inventory_movements','inventory_operation_requests','inventory_audit_logs','fulfillments','fulfillment_lines','fulfillment_line_reservation_claims','fulfillment_allocations','fulfillment_status_history','fulfillment_audit_logs','fulfillment_operation_requests','shipments','shipment_lines','shipment_issue_details','shipment_status_history'];
async function facts(f){const output={};for(const table of tables)output[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return output;}


return async function(t){
 const cleanup=[],errors=[];let evidence;const originalPick=FulfillmentPickingService.prototype.confirmPick;let setupPickCalls=0;
 try{
  FulfillmentPickingService.prototype.confirmPick=function(id,input){setupPickCalls++;assert.equal(setupPickCalls,1);assert.equal(input.lines.length,2);const command=structuredClone(input);command.lines[1].allocations[0].pickedBaseQuantity='0';command.lines[1].shortPickReason='Synthetic complete short pick from second bin';return originalPick.call(this,id,command);};
  let f;try{f=await shipmentTwoLineFixture({after:fn=>cleanup.push(fn)});}finally{FulfillmentPickingService.prototype.confirmPick=originalPick;}
  assert.equal(setupPickCalls,1);const before=await facts(f),zeroSource=f.sources[1],zeroLine=before.fulfillment_lines.find(row=>String(row.sales_order_line_id)===String(zeroSource.salesOrderLineId)),zeroClaim=before.fulfillment_line_reservation_claims.find(row=>String(row.fulfillment_line_id)===String(zeroLine.id)),zeroAllocation=before.fulfillment_allocations.find(row=>String(row.fulfillment_line_id)===String(zeroLine.id));assert.equal(String(zeroLine.picked_base_quantity),'0');assert.equal(zeroClaim.status,'RELEASED');assert.equal(zeroAllocation.status,'RELEASED');assert.equal(before.inventory_stock_balances.length,2);const [skuFacts]=await f.db.query('SELECT id,sku_code,sku_name FROM item_skus ORDER BY id'),[uomFacts]=await f.db.query('SELECT id,code FROM item_uoms ORDER BY id');
  const service=new ShipmentConfirmationService(f.options),eventId=randomUUID(),started=await f.execute(()=>service.startConfirmation(f.draft.outcome.id,{eventId,version:1}));let txSeen=null,postCalls=0,postSucceeded=0,completions=0,replays=0;
  const post=service.inventory.postFulfillmentIssueBatchInTransaction.bind(service.inventory);service.inventory.postFulfillmentIssueBatchInTransaction=async(tx,...args)=>{txSeen=tx;postCalls++;const value=await post(tx,...args);postSucceeded++;return value;};
  completions++;const completed=await f.execute(()=>service.completeConfirmation(started));assert.equal(completed.outcome,'SHIPPED');assert.equal(getTransactionOutcome(txSeen)?.state,'COMMITTED');assert.equal(postCalls,1);assert.equal(postSucceeded,1);const after=await facts(f);assert.equal(after.shipments[0].status,'SHIPPED');assert.equal(Number(after.shipments[0].version),3);assert.equal(after.shipments[0].confirmation_event_id,eventId);assert.equal(after.fulfillments[0].status,'SHIPPED');assert.equal(String(after.fulfillments[0].active_shipment_id),f.draft.outcome.id);
  for(const source of f.sources){const zero=source===zeroSource,q=zero?'0':'3',remaining=zero?'2':'2',line=after.fulfillment_lines.find(row=>String(row.sales_order_line_id)===String(source.salesOrderLineId)),sales=after.sales_order_lines.find(row=>String(row.id)===String(source.salesOrderLineId)),oldSales=before.sales_order_lines.find(row=>String(row.id)===String(source.salesOrderLineId)),reservation=after.inventory_reservations.find(row=>String(row.id)===String(source.reservationId)),balance=after.inventory_stock_balances.find(row=>String(row.id)===String(source.balanceId)),child=after.shipment_lines.find(row=>String(row.fulfillment_line_id)===String(line.id));assert.equal(String(line.shipped_base_quantity),q);assert.equal(String(child.shipped_base_quantity),q);const sku=skuFacts.find(row=>String(row.id)===String(source.skuId)),uom=uomFacts.find(row=>String(row.id)===String(line.base_uom_id));assert.equal(child.sku_code_snapshot,sku.sku_code);assert.equal(child.sku_name_snapshot,sku.sku_name);assert.equal(child.base_uom_code_snapshot,uom.code);assert.equal(String(child.sku_id),String(source.skuId));assert.equal(String(child.sales_order_line_id),String(source.salesOrderLineId));assert.equal(String(reservation.consumed_quantity),q);assert.equal(String(reservation.outstanding_quantity),remaining);assert.equal(String(balance.on_hand_quantity),'2');assert.equal(String(balance.allocated_quantity),'0');assert.equal(String(sales.fulfilled_base_quantity),q);assert.equal(String(sales.reserved_outstanding_base_quantity),remaining);if(zero){assert.deepEqual(sales,oldSales);assert.deepEqual(reservation,before.inventory_reservations.find(row=>String(row.id)===String(source.reservationId)));assert.deepEqual(balance,before.inventory_stock_balances.find(row=>String(row.id)===String(source.balanceId)));}}
  const zeroControl=after.inventory_stock_controls.find(row=>String(row.sku_id)===String(zeroSource.skuId));assert.deepEqual(zeroControl,before.inventory_stock_controls.find(row=>String(row.sku_id)===String(zeroSource.skuId)));const positive=f.sources[0],control=after.inventory_stock_controls.find(row=>String(row.sku_id)===String(positive.skuId)),claim=after.fulfillment_line_reservation_claims.find(row=>String(row.inventory_reservation_id)===String(positive.reservationId)),allocation=after.inventory_allocations.find(row=>String(row.reservation_id)===String(positive.reservationId)),mapping=after.sales_order_line_reservations.find(row=>String(row.inventory_reservation_id)===String(positive.reservationId));assert.equal(String(control.reserved_quantity),'2');assert.equal(claim.status,'CONSUMED');assert.equal(String(claim.consumed_quantity),'3');assert.equal(String(claim.active_claimed_quantity),'0');assert.equal(String(claim.released_quantity),'2');assert.equal(String(allocation.consumed_quantity),'3');assert.equal(String(allocation.outstanding_quantity),'0');assert.equal(String(mapping.consumed_base_quantity),'3');assert.equal(String(mapping.outstanding_base_quantity),'2');
  assert.deepEqual(after.fulfillment_line_reservation_claims.find(row=>String(row.id)===String(zeroClaim.id)),zeroClaim);assert.deepEqual(after.fulfillment_allocations.find(row=>String(row.id)===String(zeroAllocation.id)),zeroAllocation);assert.deepEqual(after.inventory_allocations.find(row=>String(row.reservation_id)===String(zeroSource.reservationId)),before.inventory_allocations.find(row=>String(row.reservation_id)===String(zeroSource.reservationId)));assert.deepEqual(after.sales_order_line_reservations.find(row=>String(row.sales_order_line_id)===String(zeroSource.salesOrderLineId)),before.sales_order_line_reservations.find(row=>String(row.sales_order_line_id)===String(zeroSource.salesOrderLineId)));
  const issues=after.shipment_issue_details,movements=after.inventory_movements.filter(row=>row.movement_type==='ISSUE');assert.equal(issues.length,1);assert.equal(movements.length,1);assert.equal(String(issues[0].issued_base_quantity),'3');assert.equal(String(issues[0].inventory_movement_id),String(movements[0].id));assert.equal(String(issues[0].inventory_reservation_id),String(f.sources[0].reservationId));assert.equal(String(movements[0].quantity),'3');assert.equal(String(movements[0].reservation_id),String(f.sources[0].reservationId));
  const op=after.fulfillment_operation_requests.find(row=>row.event_id===eventId);assert.equal(op.status,'SUCCEEDED');assert.equal(op.lease_owner,'');assert.equal(op.lease_expires_at,null);assert.equal(op.correlation_id,started.correlationId);const history=after.shipment_status_history.filter(row=>row.event_id===eventId);assert.deepEqual(history.map(row=>row.action),['CONFIRM_START','CONFIRM']);assert.ok(history.every(row=>String(row.actor_user_id)===String(f.userId)));
  replays++;const replay=await f.execute(()=>service.startConfirmation(f.draft.outcome.id,{eventId,version:1}));assert.deepEqual(replay,completed);assert.deepEqual(await facts(f),after);assert.equal(postCalls,1);assert.equal(completions,1);assert.equal(replays,1);
  evidence={scenario:'two-line-two-bucket-zero-picked',sourceLines:2,balanceBuckets:2,originalQuantities:[5,2],pickedQuantities:[3,0],completions,replays,actualTransactionOutcome:'COMMITTED',postCalls,postSucceeded,issueDetails:1,issueMovements:1,zeroPickedOwnerRowsUnchanged:true,all24ReplayFactsUnchanged:true,result:'PASS'};
 }catch(error){errors.push(error);}finally{FulfillmentPickingService.prototype.confirmPick=originalPick;for(const close of cleanup.reverse())try{await close();}catch(error){errors.push(error);}}
 if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'Atomic zero-picked and owned cleanup failed');t.diagnostic(JSON.stringify(evidence));

};
})();

const stageRollback=(()=>{
// Remaining approved75B ISSUE-ROLLBACK boundaries; the already-proved late Fulfillment audit case is not rerun.
const tables=['sales_orders','sales_order_lines','sales_order_line_reservations','sales_operation_requests','sales_order_status_history','sales_audit_logs','inventory_reservations','inventory_stock_controls','inventory_stock_balances','inventory_allocations','inventory_movements','inventory_operation_requests','inventory_audit_logs','fulfillments','fulfillment_lines','fulfillment_line_reservation_claims','fulfillment_allocations','fulfillment_status_history','fulfillment_audit_logs','fulfillment_operation_requests','shipments','shipment_lines','shipment_issue_details','shipment_status_history'];
async function facts(f){const result={};for(const table of tables)result[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;}
const tagFor=stage=>'P2_NATIVE_ROLLBACK_'+stage.toUpperCase();
function nativeFault(error,tag){for(let current=error,index=0;current&&index<10;current=current.cause,index++)if(current.code==='ER_SIGNAL_EXCEPTION'&&current.errno===1644&&current.sqlState==='45000'&&current.sqlMessage===tag)return {code:current.code,errno:current.errno,sqlState:current.sqlState,tag};return null;}
function triggerFor(stage,f){
 for(const id of [f.balance,f.reservationId,f.s.lineId])assert.ok(Number.isSafeInteger(Number(id))&&Number(id)>0);
 const tag=tagFor(stage),signal=`SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='${tag}'`,wrong="SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='P2_UNEXPECTED_ROLLBACK_FAULT_POINT'";
 if(stage==='inventory')return `CREATE TRIGGER synthetic_p2_inventory_boundary BEFORE INSERT ON inventory_audit_logs FOR EACH ROW BEGIN IF NEW.action='issue.post' THEN IF (SELECT COUNT(*) FROM inventory_movements WHERE operation_request_id=NEW.operation_request_id AND movement_type='ISSUE' AND quantity=3)=1 AND (SELECT on_hand_quantity=2 AND allocated_quantity=0 FROM inventory_stock_balances WHERE id=${Number(f.balance)}) AND (SELECT consumed_quantity=3 AND outstanding_quantity=2 FROM inventory_reservations WHERE id=${Number(f.reservationId)}) THEN ${signal}; ELSE ${wrong}; END IF; END IF; END`;
 if(stage==='sales')return `CREATE TRIGGER synthetic_p2_sales_boundary BEFORE INSERT ON sales_audit_logs FOR EACH ROW BEGIN IF NEW.action='sales_order.fulfillment_confirmed' THEN IF (SELECT COUNT(*) FROM inventory_movements WHERE movement_type='ISSUE' AND quantity=3)=1 AND (SELECT fulfilled_base_quantity=3 AND reserved_outstanding_base_quantity=2 FROM sales_order_lines WHERE id=${Number(f.s.lineId)}) AND (SELECT COUNT(*) FROM sales_order_status_history WHERE event_id=NEW.event_id AND action='FULFILLMENT_CONFIRM')=1 THEN ${signal}; ELSE ${wrong}; END IF; END IF; END`;
 assert.equal(stage,'snapshot');return `CREATE TRIGGER synthetic_p2_snapshot_boundary BEFORE UPDATE ON shipments FOR EACH ROW BEGIN IF OLD.status='SHIPPING' AND NEW.status='SHIPPED' THEN IF NEW.version=OLD.version+1 AND CHAR_LENGTH(NEW.customer_code_snapshot)>0 AND (SELECT COUNT(*) FROM shipment_issue_details WHERE shipment_id=OLD.id AND issued_base_quantity=3)=1 AND (SELECT COUNT(*) FROM fulfillment_lines WHERE fulfillment_id=OLD.fulfillment_id AND shipped_base_quantity=3)=1 AND (SELECT COUNT(*) FROM fulfillment_allocations WHERE fulfillment_id=OLD.fulfillment_id AND status='CONSUMED')=1 AND (SELECT COUNT(*) FROM fulfillment_line_reservation_claims WHERE fulfillment_id=OLD.fulfillment_id AND status='CONSUMED' AND consumed_quantity=3)=1 AND (SELECT COUNT(*) FROM shipment_lines WHERE shipment_id=OLD.id AND CHAR_LENGTH(sku_code_snapshot)>0)=1 AND (SELECT fulfilled_base_quantity=3 FROM sales_order_lines WHERE id=${Number(f.s.lineId)}) THEN ${signal}; ELSE ${wrong}; END IF; END IF; END`;
}
async function scenario(stage){
 const cleanup=[],errors=[];let evidence;
 try{
  const f=await shipmentDraftFixture({after:fn=>cleanup.push(fn)});await issueSchema(f.db);const draft=await f.create(f.body()),service=new ShipmentConfirmationService(f.options),eventId=randomUUID(),started=await f.execute(()=>service.startConfirmation(draft.outcome.id,{eventId,version:1})),before=await facts(f);
  await f.db.query(triggerFor(stage,f));let txSeen=null,postCalls=0,postSucceeded=0,applyCalls=0,applySucceeded=0,matched=null,attempts=0;
  const post=service.inventory.postFulfillmentIssueBatchInTransaction.bind(service.inventory);service.inventory.postFulfillmentIssueBatchInTransaction=async(tx,...args)=>{txSeen=tx;postCalls++;const value=await post(tx,...args);postSucceeded++;return value;};
  const apply=service.sales.applyFulfillmentResultInTransaction.bind(service.sales);service.sales.applyFulfillmentResultInTransaction=async(tx,...args)=>{assert.equal(tx===txSeen,true);applyCalls++;const value=await apply(tx,...args);applySucceeded++;return value;};
  await assert.rejects(()=>{attempts++;return f.execute(()=>service.completeConfirmation(started));},error=>{matched=nativeFault(error,tagFor(stage));return matched!==null;});
  assert.equal(attempts,1);assert.ok(txSeen);assert.equal(getTransactionOutcome(txSeen)?.state,'ROLLED_BACK');assert.equal(postCalls,1);assert.equal(postSucceeded,stage==='inventory'?0:1);assert.equal(applyCalls,stage==='inventory'?0:1);assert.equal(applySucceeded,stage==='snapshot'?1:0);
  assert.deepEqual(await facts(f),before);const [[shipment]]=await f.db.query('SELECT status,version,confirmation_event_id FROM shipments WHERE id=?',[draft.outcome.id]),[[operation]]=await f.db.query('SELECT status,result_json,event_id FROM fulfillment_operation_requests WHERE event_id=?',[eventId]);assert.equal(shipment.status,'SHIPPING');assert.equal(Number(shipment.version),2);assert.equal(shipment.confirmation_event_id,eventId);assert.equal(operation.status,'IN_PROGRESS');assert.equal(operation.result_json,null);assert.equal(operation.event_id,eventId);
  evidence={scenario:stage,refusedCompletions:attempts,actualRollback:'ROLLED_BACK',nativeFault:matched,postCalls,postSucceeded,applyCalls,applySucceeded,tablesUnchanged:tables.length,result:'PASS'};
 }catch(error){errors.push(error);}
 finally{for(const close of cleanup.reverse())try{await close();}catch(error){errors.push(error);}}
 if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'Stage rollback scenario and owned cleanup failed');return evidence;
}

return async function(t){
 for(const stage of ['inventory','sales','snapshot'])t.diagnostic(JSON.stringify(await scenario(stage)));
};
})();

const auditRollback=(()=>{
// Private small functional probes; outside regular CI discovery.
async function setup(t){const f=await shipmentDraftFixture(t);await shipmentFactsUp(f.db);const created=await f.create(f.body()),confirmation=new ShipmentConfirmationService(f.options),command={eventId:randomUUID(),version:1},started=await f.execute(()=>confirmation.startConfirmation(created.outcome.id,command));return {...f,shipmentId:created.outcome.id,confirmation,command,started,complete:()=>f.execute(()=>confirmation.completeConfirmation(started))};}
async function completeFacts(f){
 const facts={};
 for(const table of ['sales_orders','sales_order_lines','sales_order_line_reservations','sales_operation_requests','sales_order_status_history','sales_audit_logs','inventory_reservations','inventory_stock_controls','inventory_stock_balances','inventory_allocations','inventory_movements','inventory_operation_requests','inventory_audit_logs','fulfillments','fulfillment_lines','fulfillment_line_reservation_claims','fulfillment_allocations','fulfillment_status_history','fulfillment_audit_logs','fulfillment_operation_requests','shipments','shipment_lines','shipment_issue_details','shipment_status_history'])facts[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
 return facts;
}

return async function(t){
 const f=await setup(t),before=await completeFacts(f);
 await f.db.query("CREATE TRIGGER synthetic_phaseb_audit BEFORE INSERT ON fulfillment_audit_logs FOR EACH ROW BEGIN IF NEW.action='SHIP' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic PhaseB late audit failure'; END IF; END");
 await assert.rejects(()=>f.complete(),error=>{for(let e=error,i=0;e&&i<10;e=e.cause,i++)if(e.code==='ER_SIGNAL_EXCEPTION'&&e.message?.includes('Synthetic PhaseB late audit failure'))return true;return false;});
 assert.deepEqual(await completeFacts(f),before);const [[row]]=await f.db.query('SELECT status,version FROM shipments WHERE id=?',[f.shipmentId]);assert.equal(row.status,'SHIPPING');assert.equal(row.version,2);assert.equal(Number((await f.db.query('SELECT COUNT(*) n FROM shipment_issue_details WHERE shipment_id=?',[f.shipmentId]))[0][0].n),0);const [[op]]=await f.db.query('SELECT status,result_json FROM fulfillment_operation_requests WHERE event_id=?',[f.command.eventId]);assert.equal(op.status,'IN_PROGRESS');assert.equal(op.result_json,null);
 await f.db.query('DROP TRIGGER synthetic_phaseb_audit');
};
})();

const ownerProof=(()=>{
// Exact approved75B ISSUE-OWNER-PROOF: three serial five-unit fixtures, one refused completion each.

const tables=['sales_orders','sales_order_lines','sales_order_line_reservations','sales_operation_requests','sales_order_status_history','sales_audit_logs','inventory_reservations','inventory_stock_controls','inventory_stock_balances','inventory_allocations','inventory_movements','inventory_operation_requests','inventory_audit_logs','fulfillments','fulfillment_lines','fulfillment_line_reservation_claims','fulfillment_allocations','fulfillment_status_history','fulfillment_audit_logs','fulfillment_operation_requests','shipments','shipment_lines','shipment_issue_details','shipment_status_history'];
async function facts(f){const output={};for(const table of tables)output[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return output;}
function without(row,keys){return Object.fromEntries(Object.entries(row).filter(([key])=>!keys.includes(key)));}
function failedOnly(before,after,f,draft,started,eventId){
 const changed=['shipments','fulfillment_operation_requests','fulfillment_audit_logs','shipment_status_history'];for(const table of tables)if(!changed.includes(table))assert.deepEqual(after[table],before[table],table);
 assert.equal(after.shipments.length,before.shipments.length);const current=after.shipments.find(row=>String(row.id)===draft.outcome.id),prior=before.shipments.find(row=>String(row.id)===draft.outcome.id);
 assert.deepEqual(without(current,['status','confirmation_event_id','version','updated_at','last_business_updated_at','updated_by']),without(prior,['status','confirmation_event_id','version','updated_at','last_business_updated_at','updated_by']));assert.equal(current.status,'DRAFT');assert.equal(Number(current.version),3);assert.equal(current.confirmation_event_id,null);assert.equal(String(current.updated_by),String(f.userId));
 assert.equal(after.fulfillment_operation_requests.length,before.fulfillment_operation_requests.length);
 const oldOperation=before.fulfillment_operation_requests.find(row=>row.event_id===eventId),operation=after.fulfillment_operation_requests.find(row=>row.event_id===eventId),mutable=['status','public_error_code','public_error_details','lease_owner','lease_expires_at','next_attempt_at','completed_at','updated_at'];
 assert.deepEqual(after.fulfillment_operation_requests.filter(row=>row.event_id!==eventId),before.fulfillment_operation_requests.filter(row=>row.event_id!==eventId));assert.deepEqual(without(operation,mutable),without(oldOperation,mutable));assert.equal(operation.status,'FAILED');assert.equal(operation.public_error_code,'FULFILLMENT_SOURCE_CONFLICT');assert.equal(operation.result_json,null);assert.equal(operation.lease_owner,'');assert.equal(operation.lease_expires_at,null);assert.equal(operation.next_attempt_at,null);assert.notEqual(operation.completed_at,null);assert.ok(Number.isSafeInteger(Number(operation.completed_at)));assert.equal(operation.correlation_id,started.correlationId);assert.deepEqual(typeof operation.public_error_details==='string'?JSON.parse(operation.public_error_details):operation.public_error_details,{correlationId:started.correlationId,statusUrl:`/api/v1/fulfillment-operations/by-event/${eventId}`});
 assert.equal(after.shipment_status_history.length,before.shipment_status_history.length+1);assert.deepEqual(after.shipment_status_history.slice(0,-1),before.shipment_status_history);const history=after.shipment_status_history.at(-1);assert.equal(history.action,'CONFIRM_FAIL');assert.equal(history.from_status,'SHIPPING');assert.equal(history.to_status,'DRAFT');assert.equal(history.event_id,eventId);assert.equal(String(history.shipment_id),draft.outcome.id);assert.equal(Number(history.version_after),3);assert.equal(String(history.actor_user_id),String(f.userId));assert.equal(history.reason,'FULFILLMENT_SOURCE_CONFLICT');
 assert.equal(after.fulfillment_audit_logs.length,before.fulfillment_audit_logs.length+1);assert.deepEqual(after.fulfillment_audit_logs.slice(0,-1),before.fulfillment_audit_logs);const audit=after.fulfillment_audit_logs.at(-1);assert.equal(audit.target_type,'SHIPMENT');assert.equal(String(audit.target_id),draft.outcome.id);assert.equal(audit.action,'FAILED');assert.equal(audit.event_id,eventId);assert.equal(audit.correlation_id,started.correlationId);assert.equal(String(audit.actor_user_id),String(f.userId));assert.deepEqual(typeof audit.after_summary==='string'?JSON.parse(audit.after_summary):audit.after_summary,{status:'DRAFT',version:3,code:'FULFILLMENT_SOURCE_CONFLICT',outcome:'FAILED'});
}
async function scenario(name){
 const cleanup=[],errors=[];let evidence;
 try{
  const f=await shipmentDraftFixture({after:fn=>cleanup.push(fn)});await issueSchema(f.db);const draft=await f.create(f.body()),service=new ShipmentConfirmationService(f.options),eventId=randomUUID(),started=await f.execute(()=>service.startConfirmation(draft.outcome.id,{eventId,version:1})),before=await facts(f);
  let txSeen=null,postCalls=0,realPostSucceeded=0,applyCalls=0,scopeCalls=0,receiptCalls=0,postedOperationId=null,issuedRequestHash=null,expected;
  const apply=service.sales.applyFulfillmentResultInTransaction.bind(service.sales);service.sales.applyFulfillmentResultInTransaction=async(...args)=>{applyCalls++;return apply(...args);};
  const post=service.inventory.postFulfillmentIssueBatchInTransaction.bind(service.inventory);service.inventory.postFulfillmentIssueBatchInTransaction=async(tx,command,preparation)=>{txSeen=tx;postCalls++;const original=await post(tx,command,preparation);realPostSucceeded++;postedOperationId=original.operationId;issuedRequestHash=preparation.requestHash;if(name==='exact-member-source-mismatch'){const broken=structuredClone(original);broken.lines[0].reservations[0].inventoryReservationId=String(BigInt(broken.lines[0].reservations[0].inventoryReservationId)+1n);return broken;}return original;};
  if(name==='exact-member-source-mismatch')expected='FULFILLMENT_DEPENDENCY_UNAVAILABLE';
  else if(name==='foreign-receipt-issuer'){
   const foreign=new InventoryFulfillmentService(f.options),verify=foreign.verifyFulfillmentBatchReceiptInTransaction.bind(foreign);assert.equal(foreign===service.inventory,false);foreign.verifyFulfillmentBatchReceiptInTransaction=async(tx,input)=>{receiptCalls++;assert.equal(tx===txSeen,true);assert.deepEqual(input,{action:'SHIPMENT_CONFIRMED',operationId:postedOperationId,shipmentId:draft.outcome.id,eventId,requestHash:issuedRequestHash});return verify(tx,input);};service.sales.inventoryFulfillment=foreign;expected='INVENTORY_SOURCE_CONFLICT';
  }else{
   assert.equal(name,'stale-owner-version');const read=service.inventoryLookup.readFulfillmentAllocationScopeInTransaction.bind(service.inventoryLookup);service.inventoryLookup.readFulfillmentAllocationScopeInTransaction=async(tx,input)=>{txSeen=tx;scopeCalls++;const original=await read(tx,input),broken=structuredClone(original),version=broken.allocations[0].version;assert.ok(Number.isSafeInteger(version)&&version>=2,'Existing short-pick fixture must have a valid earlier allocation version');broken.allocations[0].version=version-1;return broken;};expected='FULFILLMENT_SOURCE_CONFLICT';
  }
  let attempts=0;await assert.rejects(()=>{attempts++;return f.execute(()=>service.completeConfirmation(started));},{code:expected});assert.equal(attempts,1);assert.ok(txSeen);assert.equal(getTransactionOutcome(txSeen)?.state,'ROLLED_BACK');assert.equal(applyCalls,name==='foreign-receipt-issuer'?1:0);assert.equal(receiptCalls,name==='foreign-receipt-issuer'?1:0);
  const after=await facts(f);if(name==='stale-owner-version'){assert.equal(scopeCalls,1);assert.equal(postCalls,0);failedOnly(before,after,f,draft,started,eventId);}else{assert.deepEqual(after,before);assert.equal(postCalls,1);assert.equal(realPostSucceeded,1);const row=after.shipments.find(item=>String(item.id)===draft.outcome.id),operation=after.fulfillment_operation_requests.find(item=>item.event_id===eventId);assert.equal(row.status,'SHIPPING');assert.equal(Number(row.version),2);assert.equal(operation.status,'IN_PROGRESS');assert.equal(operation.result_json,null);}
  evidence={scenario:name,refusedCompletions:attempts,expectedError:expected,actualRollback:'ROLLED_BACK',postCalls,realPostSucceeded,applyCalls,receiptCalls,scopeCalls,result:'PASS'};
 }catch(error){errors.push(error);}
 finally{for(const close of cleanup.reverse())try{await close();}catch(error){errors.push(error);}}
 if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'Owner-proof scenario and owned cleanup failed');return evidence;
}

return async function(t){
 for(const name of ['exact-member-source-mismatch','foreign-receipt-issuer','stale-owner-version'])t.diagnostic(JSON.stringify(await scenario(name)));
};
})();

const freshAddress=(()=>{
// One private small correctness reproduction within approved ISSUE-FRESH-GUARDS.
async function businessFacts(f){const result={};for(const table of ['sales_orders','sales_order_lines','sales_order_line_reservations','sales_operation_requests','sales_order_status_history','sales_audit_logs','inventory_reservations','inventory_stock_controls','inventory_stock_balances','inventory_allocations','inventory_movements','inventory_operation_requests','inventory_audit_logs','fulfillments','fulfillment_lines','fulfillment_line_reservation_claims','fulfillment_allocations','fulfillment_status_history','shipment_lines','shipment_issue_details'])result[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;}

return async function(t){
 const f=await shipmentDraftFixture(t);await shipmentFactsUp(f.db);const draft=await f.create(f.body()),service=new ShipmentConfirmationService(f.options),eventId=randomUUID(),started=await f.execute(()=>service.startConfirmation(draft.outcome.id,{eventId,version:1}));
 await f.db.execute('UPDATE customer_addresses SET version=version+1 WHERE id=?',[f.s.addressId]);const before=await businessFacts(f);
 await assert.rejects(()=>f.execute(()=>service.completeConfirmation(started)),{code:'SHIPPING_ADDRESS_CHANGED'});
 assert.deepEqual(await businessFacts(f),before);
 const [[shipment]]=await f.db.query('SELECT status,version,confirmation_event_id FROM shipments WHERE id=?',[draft.outcome.id]);assert.equal(shipment.status,'DRAFT');assert.equal(Number(shipment.version),3);assert.equal(shipment.confirmation_event_id,null);
 const [[operation]]=await f.db.query('SELECT status,public_error_code,result_json,lease_owner,lease_expires_at FROM fulfillment_operation_requests WHERE event_id=?',[eventId]);assert.equal(operation.status,'FAILED');assert.equal(operation.public_error_code,'SHIPPING_ADDRESS_CHANGED');assert.equal(operation.result_json,null);assert.equal(operation.lease_owner,'');assert.equal(operation.lease_expires_at,null);
 const [history]=await f.db.query("SELECT from_status,to_status,event_id,version_after FROM shipment_status_history WHERE shipment_id=? AND action='CONFIRM_FAIL'",[draft.outcome.id]);assert.equal(history.length,1);assert.equal(history[0].from_status,'SHIPPING');assert.equal(history[0].to_status,'DRAFT');assert.equal(history[0].event_id,eventId);assert.equal(Number(history[0].version_after),3);
 const [audit]=await f.db.query("SELECT action,event_id,correlation_id,actor_user_id,after_summary FROM fulfillment_audit_logs WHERE target_type='SHIPMENT' AND target_id=? AND event_id=? AND action='FAILED'",[draft.outcome.id,eventId]);assert.equal(audit.length,1);assert.equal(audit[0].event_id,eventId);assert.equal(audit[0].correlation_id,started.correlationId);assert.equal(String(audit[0].actor_user_id),String(f.userId));assert.deepEqual(typeof audit[0].after_summary==='string'?JSON.parse(audit[0].after_summary):audit[0].after_summary,{status:'DRAFT',version:3,code:'SHIPPING_ADDRESS_CHANGED',outcome:'FAILED'});
};
})();

const freshSelected=(()=>{
// Three remaining approved75B ISSUE-FRESH-GUARDS variants; no additional fixture/confirmation sweep.

const tables=['sales_orders','sales_order_lines','sales_order_line_reservations','sales_operation_requests','sales_order_status_history','sales_audit_logs','inventory_reservations','inventory_stock_controls','inventory_stock_balances','inventory_allocations','inventory_movements','inventory_operation_requests','inventory_audit_logs','fulfillments','fulfillment_lines','fulfillment_line_reservation_claims','fulfillment_allocations','fulfillment_status_history','fulfillment_audit_logs','fulfillment_operation_requests','shipments','shipment_lines','shipment_issue_details','shipment_status_history'];
async function facts(f){const output={};for(const table of tables)output[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return output;}
function without(row,keys){return Object.fromEntries(Object.entries(row).filter(([key])=>!keys.includes(key)));}
function failedOnly(before,after,f,draft,started,eventId,code){
 const changed=['shipments','fulfillment_operation_requests','fulfillment_audit_logs','shipment_status_history'];for(const table of tables)if(!changed.includes(table))assert.deepEqual(after[table],before[table],table);
 assert.equal(after.shipments.length,before.shipments.length);const current=after.shipments.find(row=>String(row.id)===draft.outcome.id),prior=before.shipments.find(row=>String(row.id)===draft.outcome.id);
 assert.deepEqual(without(current,['status','confirmation_event_id','version','updated_at','last_business_updated_at','updated_by']),without(prior,['status','confirmation_event_id','version','updated_at','last_business_updated_at','updated_by']));assert.equal(current.status,'DRAFT');assert.equal(Number(current.version),3);assert.equal(current.confirmation_event_id,null);assert.equal(String(current.updated_by),String(f.userId));
 assert.equal(after.fulfillment_operation_requests.length,before.fulfillment_operation_requests.length);
 const oldOperation=before.fulfillment_operation_requests.find(row=>row.event_id===eventId),operation=after.fulfillment_operation_requests.find(row=>row.event_id===eventId),mutable=['status','public_error_code','public_error_details','lease_owner','lease_expires_at','next_attempt_at','completed_at','updated_at'];
 assert.deepEqual(after.fulfillment_operation_requests.filter(row=>row.event_id!==eventId),before.fulfillment_operation_requests.filter(row=>row.event_id!==eventId));assert.deepEqual(without(operation,mutable),without(oldOperation,mutable));assert.equal(operation.status,'FAILED');assert.equal(operation.public_error_code,code);assert.equal(operation.result_json,null);assert.equal(operation.lease_owner,'');assert.equal(operation.lease_expires_at,null);assert.equal(operation.next_attempt_at,null);assert.notEqual(operation.completed_at,null);assert.ok(Number.isSafeInteger(Number(operation.completed_at)));assert.equal(operation.correlation_id,started.correlationId);assert.deepEqual(typeof operation.public_error_details==='string'?JSON.parse(operation.public_error_details):operation.public_error_details,{correlationId:started.correlationId,statusUrl:`/api/v1/fulfillment-operations/by-event/${eventId}`});
 assert.equal(after.shipment_status_history.length,before.shipment_status_history.length+1);assert.deepEqual(after.shipment_status_history.slice(0,-1),before.shipment_status_history);const history=after.shipment_status_history.at(-1);assert.equal(history.action,'CONFIRM_FAIL');assert.equal(history.from_status,'SHIPPING');assert.equal(history.to_status,'DRAFT');assert.equal(history.event_id,eventId);assert.equal(String(history.shipment_id),draft.outcome.id);assert.equal(Number(history.version_after),3);assert.equal(String(history.actor_user_id),String(f.userId));assert.equal(history.reason,code);
 assert.equal(after.fulfillment_audit_logs.length,before.fulfillment_audit_logs.length+1);assert.deepEqual(after.fulfillment_audit_logs.slice(0,-1),before.fulfillment_audit_logs);const audit=after.fulfillment_audit_logs.at(-1);assert.equal(audit.target_type,'SHIPMENT');assert.equal(String(audit.target_id),draft.outcome.id);assert.equal(audit.action,'FAILED');assert.equal(audit.event_id,eventId);assert.equal(audit.correlation_id,started.correlationId);assert.equal(String(audit.actor_user_id),String(f.userId));assert.deepEqual(typeof audit.after_summary==='string'?JSON.parse(audit.after_summary):audit.after_summary,{status:'DRAFT',version:3,code:code,outcome:'FAILED'});
}
async function scenario(name){
 const cleanup=[],errors=[];let evidence;
 try{
  const f=await shipmentDraftFixture({after:fn=>cleanup.push(fn)});await issueSchema(f.db);const body=f.body();let contactId=null;
  if(name==='stale-contact'){contactId=await f.s.insert('customer_contacts',{customer_id:f.s.customerId,name:'Synthetic shipping guard',created_at:f.s.now,updated_at:f.s.now});await f.s.insert('customer_contact_purposes',{contact_id:contactId,customer_id:f.s.customerId,purpose_code:'shipping',is_default:1,created_at:f.s.now,updated_at:f.s.now});Object.assign(body,{shippingContactId:contactId,shippingContactVersion:1});}
  const draft=await f.create(body),service=new ShipmentConfirmationService(f.options),eventId=randomUUID(),started=await f.execute(()=>service.startConfirmation(draft.outcome.id,{eventId,version:1}));
  if(name==='stale-contact'){const [changed]=await f.db.execute('UPDATE customer_contacts SET version=version+1 WHERE id=? AND version=1',[contactId]);assert.equal(changed.affectedRows,1);}
  if(name==='serial-item'){const [changed]=await f.db.execute("UPDATE item_skus SET tracking_policy='serial',version=version+1 WHERE id=? AND tracking_policy='none'",[f.s.skuId]);assert.equal(changed.affectedRows,1);}
  const before=await facts(f);let txSeen=null,scopeCalls=0,postCalls=0,postSucceeded=0,confirmations=0;
  const read=service.inventoryLookup.readFulfillmentAllocationScopeInTransaction.bind(service.inventoryLookup);service.inventoryLookup.readFulfillmentAllocationScopeInTransaction=async(tx,...args)=>{txSeen=tx;scopeCalls++;return read(tx,...args);};
  const post=service.inventory.postFulfillmentIssueBatchInTransaction.bind(service.inventory);service.inventory.postFulfillmentIssueBatchInTransaction=async(tx,...args)=>{assert.equal(tx===txSeen,true);postCalls++;const result=await post(tx,...args);postSucceeded++;return result;};
  if(name==='incompatible-reallocate'){
   const allocation=f.current.fulfillment.allocations.items[0],competingEvent=randomUUID(),claim=f.allocator.operations.claimInTransaction.bind(f.allocator.operations);let competingTx=null,competingCalls=0;
   f.allocator.operations.claimInTransaction=async(tx,...args)=>{competingTx=tx;return claim(tx,...args);};
   const command={eventId:competingEvent,version:Number(before.fulfillments.find(row=>String(row.id)===f.created.outcome.id).version),lines:[{fulfillmentLineId:Number(f.created.fulfillment.lines[0].id),overrideReason:'',releases:[{fulfillmentAllocationId:Number(allocation.id),inventoryAllocationVersion:allocation.inventoryVersion}],allocations:[{inventoryReservationId:Number(f.reservationId),inventoryBalanceId:Number(f.balance),balanceVersion:allocation.balanceVersion,baseQuantity:'3'}]}]};
   await assert.rejects(()=>{competingCalls++;return f.execute(()=>f.allocator.reallocate(f.created.outcome.id,command));},{code:'FULFILLMENT_STATE_CONFLICT'});assert.equal(competingCalls,1);assert.ok(competingTx);assert.equal(getTransactionOutcome(competingTx)?.state,'ROLLED_BACK');assert.deepEqual(await facts(f),before);
   confirmations++;const completed=await f.execute(()=>service.completeConfirmation(started));assert.equal(completed.outcome,'SHIPPED');assert.equal(getTransactionOutcome(txSeen)?.state,'COMMITTED');assert.equal(postCalls,1);assert.equal(postSucceeded,1);
   const [[shipment]]=await f.db.query('SELECT status,version,confirmation_event_id FROM shipments WHERE id=?',[draft.outcome.id]),[[reservation]]=await f.db.query('SELECT consumed_quantity,outstanding_quantity FROM inventory_reservations WHERE id=?',[f.reservationId]),[[balance]]=await f.db.query('SELECT on_hand_quantity,allocated_quantity FROM inventory_stock_balances WHERE id=?',[f.balance]),[[sales]]=await f.db.query('SELECT fulfilled_base_quantity,reserved_outstanding_base_quantity FROM sales_order_lines WHERE id=?',[f.s.lineId]);
   assert.equal(shipment.status,'SHIPPED');assert.equal(Number(shipment.version),3);assert.equal(shipment.confirmation_event_id,eventId);assert.equal(String(reservation.consumed_quantity),'3');assert.equal(String(reservation.outstanding_quantity),'2');assert.equal(String(balance.on_hand_quantity),'2');assert.equal(String(balance.allocated_quantity),'0');assert.equal(String(sales.fulfilled_base_quantity),'3');assert.equal(String(sales.reserved_outstanding_base_quantity),'2');assert.equal((await f.db.query('SELECT id FROM shipment_issue_details WHERE shipment_id=?',[draft.outcome.id]))[0].length,1);assert.equal((await f.db.query("SELECT id FROM inventory_movements WHERE movement_type='ISSUE'"))[0].length,1);assert.equal((await f.db.query('SELECT id FROM fulfillment_operation_requests WHERE event_id=?',[competingEvent]))[0].length,0);
   evidence={scenario:name,confirmations,competingCommands:competingCalls,competingOutcome:'ROLLED_BACK',actualTransactionOutcome:'COMMITTED',scopeCalls,postCalls,postSucceeded,result:'PASS'};
  }else{
   assert.ok(['stale-contact','serial-item'].includes(name));const code=name==='stale-contact'?'SHIPPING_ADDRESS_CHANGED':'SERIAL_TRACKING_UNSUPPORTED';await assert.rejects(()=>{confirmations++;return f.execute(()=>service.completeConfirmation(started));},{code});assert.equal(getTransactionOutcome(txSeen)?.state,'ROLLED_BACK');assert.equal(scopeCalls,1);assert.equal(postCalls,0);failedOnly(before,await facts(f),f,draft,started,eventId,code);
   if(contactId){const [[row]]=await f.db.query('SELECT version FROM customer_contacts WHERE id=?',[contactId]);assert.equal(Number(row.version),2);}else{const [[row]]=await f.db.query('SELECT tracking_policy FROM item_skus WHERE id=?',[f.s.skuId]);assert.equal(row.tracking_policy,'serial');}
   evidence={scenario:name,confirmations,competingCommands:0,expectedError:code,actualTransactionOutcome:'ROLLED_BACK',scopeCalls,postCalls,postSucceeded,localFailureOnly:true,result:'PASS'};
  }
  assert.equal(confirmations,1);
 }catch(error){errors.push(error);}
 finally{for(const close of cleanup.reverse())try{await close();}catch(error){errors.push(error);}}
 if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'Fresh guard scenario and owned cleanup failed');return evidence;
}

return async function(t){
 for(const name of ['stale-contact','serial-item','incompatible-reallocate'])t.diagnostic(JSON.stringify(await scenario(name)));
};
})();

const freshAdjustment=(()=>{
// Three remaining approved75B ISSUE-FRESH-GUARDS variants; no additional fixture/confirmation sweep.

const tables=['sales_orders','sales_order_lines','sales_order_line_reservations','sales_operation_requests','sales_order_status_history','sales_audit_logs','inventory_reservations','inventory_stock_controls','inventory_stock_balances','inventory_allocations','inventory_movements','inventory_operation_requests','inventory_audit_logs','fulfillments','fulfillment_lines','fulfillment_line_reservation_claims','fulfillment_allocations','fulfillment_status_history','fulfillment_audit_logs','fulfillment_operation_requests','shipments','shipment_lines','shipment_issue_details','shipment_status_history'];
async function facts(f){const output={};for(const table of tables)output[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return output;}
function without(row,keys){return Object.fromEntries(Object.entries(row).filter(([key])=>!keys.includes(key)));}
function failedOnly(before,after,f,draft,started,eventId,code){
 const changed=['shipments','fulfillment_operation_requests','fulfillment_audit_logs','shipment_status_history'];for(const table of tables)if(!changed.includes(table))assert.deepEqual(after[table],before[table],table);
 assert.equal(after.shipments.length,before.shipments.length);const current=after.shipments.find(row=>String(row.id)===draft.outcome.id),prior=before.shipments.find(row=>String(row.id)===draft.outcome.id);
 assert.deepEqual(without(current,['status','confirmation_event_id','version','updated_at','last_business_updated_at','updated_by']),without(prior,['status','confirmation_event_id','version','updated_at','last_business_updated_at','updated_by']));assert.equal(current.status,'DRAFT');assert.equal(Number(current.version),3);assert.equal(current.confirmation_event_id,null);assert.equal(String(current.updated_by),String(f.userId));
 assert.equal(after.fulfillment_operation_requests.length,before.fulfillment_operation_requests.length);
 const oldOperation=before.fulfillment_operation_requests.find(row=>row.event_id===eventId),operation=after.fulfillment_operation_requests.find(row=>row.event_id===eventId),mutable=['status','public_error_code','public_error_details','lease_owner','lease_expires_at','next_attempt_at','completed_at','updated_at'];
 assert.deepEqual(after.fulfillment_operation_requests.filter(row=>row.event_id!==eventId),before.fulfillment_operation_requests.filter(row=>row.event_id!==eventId));assert.deepEqual(without(operation,mutable),without(oldOperation,mutable));assert.equal(operation.status,'FAILED');assert.equal(operation.public_error_code,code);assert.equal(operation.result_json,null);assert.equal(operation.lease_owner,'');assert.equal(operation.lease_expires_at,null);assert.equal(operation.next_attempt_at,null);assert.notEqual(operation.completed_at,null);assert.ok(Number.isSafeInteger(Number(operation.completed_at)));assert.equal(operation.correlation_id,started.correlationId);assert.deepEqual(typeof operation.public_error_details==='string'?JSON.parse(operation.public_error_details):operation.public_error_details,{correlationId:started.correlationId,statusUrl:`/api/v1/fulfillment-operations/by-event/${eventId}`});
 assert.equal(after.shipment_status_history.length,before.shipment_status_history.length+1);assert.deepEqual(after.shipment_status_history.slice(0,-1),before.shipment_status_history);const history=after.shipment_status_history.at(-1);assert.equal(history.action,'CONFIRM_FAIL');assert.equal(history.from_status,'SHIPPING');assert.equal(history.to_status,'DRAFT');assert.equal(history.event_id,eventId);assert.equal(String(history.shipment_id),draft.outcome.id);assert.equal(Number(history.version_after),3);assert.equal(String(history.actor_user_id),String(f.userId));assert.equal(history.reason,code);
 assert.equal(after.fulfillment_audit_logs.length,before.fulfillment_audit_logs.length+1);assert.deepEqual(after.fulfillment_audit_logs.slice(0,-1),before.fulfillment_audit_logs);const audit=after.fulfillment_audit_logs.at(-1);assert.equal(audit.target_type,'SHIPMENT');assert.equal(String(audit.target_id),draft.outcome.id);assert.equal(audit.action,'FAILED');assert.equal(audit.event_id,eventId);assert.equal(audit.correlation_id,started.correlationId);assert.equal(String(audit.actor_user_id),String(f.userId));assert.deepEqual(typeof audit.after_summary==='string'?JSON.parse(audit.after_summary):audit.after_summary,{status:'DRAFT',version:3,code:code,outcome:'FAILED'});
}


return async function(t){
 const cleanup=[],errors=[];let evidence;
 try{
  const f=await shipmentDraftFixture({after:fn=>cleanup.push(fn)});await issueSchema(f.db);
  for(const name of ['inventory.view','inventory.adjust']){const [[existing]]=await f.db.query('SELECT id FROM permissions WHERE name=?',[name]);const id=existing?.id??await f.s.insert('permissions',{name,created_at:f.s.now});await f.db.execute('INSERT INTO role_permissions(role_id,permission_id) VALUES (?,?)',[f.roleId,id]);f.permissions.push(name);}
  const publicKey=Buffer.from('Synthetic adjustment concurrency device key'),deviceId=createHash('sha256').update(publicKey).digest('hex'),devicePk=await f.s.insert('user_devices',{user_id:f.userId,device_id:deviceId,public_key:publicKey,status:'approved',requested_at:f.time.nowMs()});
  const draft=await f.create(f.body()),service=new ShipmentConfirmationService(f.options),eventId=randomUUID(),started=await f.execute(()=>service.startConfirmation(draft.outcome.id,{eventId,version:1}));
  const initial=await facts(f),oldBalance=initial.inventory_stock_balances.find(row=>String(row.id)===String(f.balance)),adjustmentEvent=randomUUID();
  const raw={actor:{userId:f.userId,serviceName:'',claimedRoles:[...f.claims.roles],claimedPermissions:[...f.permissions]},authorization:{purpose:'adjustment.post',requiredCallerPermission:'inventory.adjust'},source:{module:'INVENTORY',documentType:'ADJUSTMENT',documentId:'synthetic-p2-fresh-guard',lineId:'',eventId:adjustmentEvent},correlationId:adjustmentEvent,payload:{direction:'IN',warehouseId:f.s.warehouseId,binId:Number(f.bin),skuId:f.s.skuId,stockStatus:'AVAILABLE',expectedBalanceVersion:Number(oldBalance.version),quantity:1,uomId:f.s.uomId,reasonCategory:'COUNT_GAIN',reasonText:'Synthetic physical recount'}};
  const command=normalizeAdjustmentCommand({query(){},execute(){}},raw,'adjustment.post'),now=f.options.time.nowMs(),claims={...f.claims,did:deviceId,exp:Math.floor(now/1000)+900,auth_time:Math.floor(now/1000),ver:0};
  const req={method:'POST',apiRoute:{authType:'jwt-device-password',path:'/api/v1/inventory/adjustments'},auth:{type:'jwt-device-password',claims,deviceBinding:{id:devicePk,user_id:f.userId,device_id:deviceId,public_key:publicKey,status:'approved'}},requestTimeout:{signal:new AbortController().signal},get:()=>String(now)};
  const capability=issueInventoryHighRiskContext(req,command,{time:f.options.time,signatureMaxSkewSeconds:60,sessionMaxAgeSeconds:28800,clockToleranceSeconds:5}),posting=new InventoryPostingService(f.options);
  let txSeen=null,adjustmentTx=null,externalBaseline=null,scopeCalls=0,postCalls=0,postSucceeded=0,adjustments=0;
  const ownerClaim=posting.operations.claim.bind(posting.operations);posting.operations.claim=async(tx,...args)=>{adjustmentTx=tx;return ownerClaim(tx,...args);};
  const read=service.inventoryLookup.readFulfillmentAllocationScopeInTransaction.bind(service.inventoryLookup);service.inventoryLookup.readFulfillmentAllocationScopeInTransaction=async(tx,...args)=>{
   txSeen=tx;scopeCalls++;const saved=await read(tx,...args);assert.equal(scopeCalls,1);
   await f.execute(()=>{adjustments++;return posting.postAdjustment(command,capability);});
   assert.notEqual(adjustmentTx,txSeen);assert.equal(getTransactionOutcome(adjustmentTx)?.state,'COMMITTED');
   externalBaseline=await facts(f);const current=externalBaseline.inventory_stock_balances.find(row=>String(row.id)===String(f.balance));assert.equal(Number(current.on_hand_quantity),Number(oldBalance.on_hand_quantity)+1);assert.equal(Number(current.version),Number(oldBalance.version)+1);assert.equal(String(current.allocated_quantity),String(oldBalance.allocated_quantity));
   const movements=externalBaseline.inventory_movements.filter(row=>row.movement_type==='ADJUSTMENT');assert.equal(movements.length,1);assert.equal(String(movements[0].quantity),'1');assert.equal(movements[0].direction,'IN');return saved;
  };
  const post=service.inventory.postFulfillmentIssueBatchInTransaction.bind(service.inventory);service.inventory.postFulfillmentIssueBatchInTransaction=async(tx,...args)=>{assert.equal(tx,txSeen);postCalls++;const result=await post(tx,...args);postSucceeded++;return result;};
  let confirmations=0;await assert.rejects(()=>{confirmations++;return f.execute(()=>service.completeConfirmation(started));},{code:'VERSION_CONFLICT'});
  assert.equal(confirmations,1);assert.equal(adjustments,1);assert.equal(scopeCalls,1);assert.equal(postCalls,1);assert.equal(postSucceeded,0);assert.equal(getTransactionOutcome(txSeen)?.state,'ROLLED_BACK');assert.ok(externalBaseline);failedOnly(externalBaseline,await facts(f),f,draft,started,eventId,'VERSION_CONFLICT');
  assert.equal((await f.db.query("SELECT id FROM inventory_movements WHERE movement_type='ISSUE'"))[0].length,0);
  evidence={scenario:'concurrent-inventory-adjustment',confirmations,competingCommands:adjustments,distinctTransactions:adjustmentTx!==txSeen,competingOutcome:'COMMITTED',actualTransactionOutcome:'ROLLED_BACK',scopeCalls,postCalls,postSucceeded,externalAdjustmentRetained:true,localFailureOnly:true,result:'PASS'};
 }catch(error){errors.push(error);}finally{for(const close of cleanup.reverse())try{await close();}catch(error){errors.push(error);}}
 if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'Adjustment race and owned cleanup failed');
 t.diagnostic(JSON.stringify(evidence));

};
})();

const freshCreate=(()=>{
// One small deterministic native lock regression, outside regular CI discovery.
async function barrier(promise,signal){signal.throwIfAborted();let stop;try{return await Promise.race([promise,new Promise((_,reject)=>{stop=()=>reject(signal.reason);signal.addEventListener('abort',stop,{once:true});})]);}finally{signal.removeEventListener('abort',stop);}}

return async function(t){
 const f=await shipmentDraftFixture(t);await shipmentFactsUp(f.db);
 const first=await f.create(f.body()),confirmation=new ShipmentConfirmationService(f.options),eventId=randomUUID(),started=await f.execute(()=>confirmation.startConfirmation(first.outcome.id,{eventId,version:1}));
 const second=await f.execute(()=>f.fulfillments.create({eventId:randomUUID(),salesOrderId:f.s.orderId,salesOrderVersion:1,lines:[{salesOrderLineId:f.s.lineId,plannedBaseQuantity:'2'}]}));
 const [[balance]]=await f.db.query('SELECT version FROM inventory_stock_balances WHERE id=?',[f.balance]);
 const allocated=await f.execute(()=>f.allocator.allocate(second.outcome.id,{eventId:randomUUID(),version:1,lines:[{fulfillmentLineId:Number(second.fulfillment.lines[0].id),overrideReason:'',allocations:[{inventoryReservationId:Number(f.reservationId),inventoryBalanceId:Number(f.balance),balanceVersion:Number(balance.version),baseQuantity:'2'}]}]}));
 await f.execute(()=>f.picking.confirmPick(second.outcome.id,{eventId:randomUUID(),version:2,lines:[{fulfillmentLineId:Number(allocated.fulfillment.lines[0].id),shortPickReason:'',allocations:[{fulfillmentAllocationId:Number(allocated.fulfillment.allocations.items[0].id),inventoryAllocationVersion:1,pickedBaseQuantity:'2'}]}]}));
 const salesLocked=Promise.withResolvers(),continueConfirmation=Promise.withResolvers(),salesRequested=Promise.withResolvers();
 const originalSales=confirmation.sales.lockLinesForFulfillmentInTransaction.bind(confirmation.sales),originalTransaction=f.database.withTransaction.bind(f.database);let observedParent=false,domainBeforeParent=false,domainWhileBlocked=false;
 confirmation.sales.lockLinesForFulfillmentInTransaction=async(...args)=>{const proof=await originalSales(...args);salesLocked.resolve();await continueConfirmation.promise;return proof;};
 f.database.withTransaction=(work,options)=>originalTransaction(async(tx,context)=>{const originalQuery=tx.query;let parentRequested=false,priorDomain=false;tx.query=function(sql,args,queryOptions){if(/FOR UPDATE/u.test(sql)&&/fulfillments|customer_addresses|customers/u.test(sql)){if(!parentRequested)priorDomain=true;else domainWhileBlocked=true;}const pending=originalQuery.call(this,sql,args,queryOptions);if(sql==='SELECT id FROM sales_orders WHERE id=? FOR SHARE'&&String(args[0])===String(f.s.orderId)){parentRequested=true;observedParent=true;domainBeforeParent=priorDomain;salesRequested.resolve();}return pending;};try{return await work(tx,context);}finally{tx.query=originalQuery;}},options);
 t.after(()=>{continueConfirmation.resolve();f.database.withTransaction=originalTransaction;confirmation.sales.lockLinesForFulfillmentInTransaction=originalSales;});
 let completing,creating;try{
 completing=f.execute(()=>confirmation.completeConfirmation(started));completing.catch(()=>salesLocked.resolve());await barrier(salesLocked.promise,t.signal);
 creating=f.execute(()=>f.service.createDraft(second.outcome.id,f.body()));creating.catch(()=>salesRequested.resolve());await barrier(salesRequested.promise,t.signal);
 assert.equal(observedParent,true,'Real Create must request the actual Sales parent shared lock');assert.equal(domainBeforeParent,false,'Create cannot hold Fulfillment or Customer before Sales parent');assert.equal(domainWhileBlocked,false,'Blocked Create cannot hold later domain locks');continueConfirmation.resolve();
 const [complete,created]=await Promise.all([completing,creating]);assert.equal(complete.outcome,'SHIPPED');assert.equal(created.outcome.status,'DRAFT');
 const [[root]]=await f.db.query('SELECT status,active_shipment_id FROM fulfillments WHERE id=?',[second.outcome.id]);assert.equal(root.status,'PICKED');assert.equal(String(root.active_shipment_id),created.outcome.id);
 const [[reservation]]=await f.db.query('SELECT consumed_quantity,outstanding_quantity FROM inventory_reservations WHERE id=?',[f.reservationId]);assert.equal(String(reservation.consumed_quantity),'3');assert.equal(String(reservation.outstanding_quantity),'2');
 const [[claim]]=await f.db.query('SELECT active_claimed_quantity,consumed_quantity FROM fulfillment_line_reservation_claims WHERE fulfillment_id=?',[second.outcome.id]);assert.equal(String(claim.active_claimed_quantity),'2');assert.equal(String(claim.consumed_quantity),'0');
 }finally{continueConfirmation.resolve();await Promise.allSettled([completing,creating].filter(Boolean));f.database.withTransaction=originalTransaction;confirmation.sales.lockLinesForFulfillmentInTransaction=originalSales;}
};
})();

const lookupChildren=(()=>{
// Two remaining approved75B LOOKUP-CHILD-VERSION variants; stale version evidence retained, not rerun.

const tables=['sales_orders','sales_order_lines','sales_order_line_reservations','sales_operation_requests','sales_order_status_history','sales_audit_logs','inventory_reservations','inventory_stock_controls','inventory_stock_balances','inventory_allocations','inventory_movements','inventory_operation_requests','inventory_audit_logs','fulfillments','fulfillment_lines','fulfillment_line_reservation_claims','fulfillment_allocations','fulfillment_status_history','fulfillment_audit_logs','fulfillment_operation_requests','shipments','shipment_lines','shipment_issue_details','shipment_status_history'];
async function facts(f){const output={};for(const table of tables)output[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return output;}

async function scenario(name){
 const cleanup=[],errors=[];let evidence;
 try{
  const f=await shipmentDraftFixture({after:fn=>cleanup.push(fn)});await issueSchema(f.db);const body=f.body();
  if(name==='wrong-owner'){
   const [[source]]=await f.db.query('SELECT * FROM customers WHERE id=?',[f.s.customerId]),label='foreign_'+randomUUID().slice(0,12);delete source.id;Object.assign(source,{customer_code:label,customer_code_key:label,legal_name:label,legal_name_key:label});const customerId=await f.s.insert('customers',source),addressId=await f.s.insert('customer_addresses',{customer_id:customerId,label:'Synthetic foreign shipping',address_line1:'Synthetic foreign address',created_at:f.s.now,updated_at:f.s.now});await f.s.insert('customer_address_purposes',{address_id:addressId,customer_id:customerId,purpose_code:'shipping',is_default:1,created_at:f.s.now,updated_at:f.s.now});body.shippingAddressId=addressId;
  }else{assert.equal(name,'removed-purpose');const [removed]=await f.db.execute("DELETE FROM customer_address_purposes WHERE address_id=? AND customer_id=? AND purpose_code='shipping'",[f.s.addressId,f.s.customerId]);assert.equal(removed.affectedRows,1);}
  const before=await facts(f),customerBefore={};for(const table of ['customers','customer_addresses','customer_address_purposes'])customerBefore[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY ${table==='customer_address_purposes'?'address_id,purpose_code':'id'}`))[0];let txSeen=null,attempts=0;
  const claim=f.service.operations.claimInTransaction.bind(f.service.operations);f.service.operations.claimInTransaction=async(tx,...args)=>{txSeen=tx;return claim(tx,...args);};
  await assert.rejects(()=>{attempts++;return f.create(body);},{code:'SHIPPING_ADDRESS_UNAVAILABLE'});assert.equal(attempts,1);assert.ok(txSeen);assert.equal(getTransactionOutcome(txSeen)?.state,'ROLLED_BACK');assert.deepEqual(await facts(f),before);for(const table of Object.keys(customerBefore))assert.deepEqual((await f.db.query(`SELECT * FROM ${table} ORDER BY ${table==='customer_address_purposes'?'address_id,purpose_code':'id'}`))[0],customerBefore[table]);
  evidence={scenario:name,refusedDraftAttempts:attempts,confirmations:0,actualTransactionOutcome:'ROLLED_BACK',expectedError:'SHIPPING_ADDRESS_UNAVAILABLE',all24BusinessFactsUnchanged:true,customerSourceUnchanged:true,sequenceReservationOutsideBusinessSnapshot:true,result:'PASS'};
 }catch(error){errors.push(error);}finally{for(const close of cleanup.reverse())try{await close();}catch(error){errors.push(error);}}
 if(errors.length)throw errors.length===1?errors[0]:new AggregateError(errors,'Lookup child refusal and owned cleanup failed');return evidence;
}

return async function(t){
 for(const name of ['wrong-owner','removed-purpose'])t.diagnostic(JSON.stringify(await scenario(name)));
};
})();

const lookupParent=(()=>{
// Private minimal functional probe only; deliberately outside CI discovery.

return async function(t){
 const f=await shipmentDraftFixture(t),service=new ShipmentShippingLookupService(f.options);
 const query=kind=>f.execute(()=>service.list(String(f.s.customerId),String(f.created.outcome.id),kind));
 const addresses=await query('addresses');assert.equal(addresses.items.length,1);assert.equal(addresses.items[0].addressId,String(f.s.addressId));assert.equal(addresses.items[0].isDefault,true);assert.equal(addresses.items[0].countryCode,null);assert.deepEqual((await query('contacts')).items,[]);
 const contactId=await f.s.insert('customer_contacts',{customer_id:f.s.customerId,name:'Synthetic shipping contact',created_at:f.s.now,updated_at:f.s.now});await f.s.insert('customer_contact_purposes',{contact_id:contactId,customer_id:f.s.customerId,purpose_code:'shipping',is_default:1,created_at:f.s.now,updated_at:f.s.now});assert.equal((await query('contacts')).items[0].contactId,String(contactId));
 await assert.rejects(()=>f.execute(()=>service.list('999999',String(f.created.outcome.id),'addresses')),{code:'FULFILLMENT_NOT_FOUND'});
 await f.db.execute("UPDATE customer_addresses SET status='inactive',version=version+1 WHERE id=?",[f.s.addressId]);assert.deepEqual((await query('addresses')).items,[]);

};
})();

const lookupPermission=(()=>{
// Private minimal functional probe only; deliberately outside CI discovery.

return async function(t){
 const f=await shipmentDraftFixture(t),service=new ShipmentShippingLookupService(f.options);
 const query=kind=>f.execute(()=>service.list(String(f.s.customerId),String(f.created.outcome.id),kind));
 const contactId=await f.s.insert('customer_contacts',{customer_id:f.s.customerId,name:'Synthetic shipping contact',created_at:f.s.now,updated_at:f.s.now});await f.s.insert('customer_contact_purposes',{contact_id:contactId,customer_id:f.s.customerId,purpose_code:'shipping',is_default:1,created_at:f.s.now,updated_at:f.s.now});
 await f.db.execute("UPDATE customer_addresses SET status='inactive',version=version+1 WHERE id=?",[f.s.addressId]);
 const request=await startP1Http({after:close=>{const previous=f.f.cleanup.shutdown;f.f.cleanup.shutdown=async()=>{try{await close();}finally{await previous?.();}};}},f),base='/api/v1/fulfillment-lookups/customers/'+f.s.customerId;
 const empty=await request('GET',base+'/shipping-addresses?fulfillmentId='+f.created.outcome.id);assert.equal(empty.status,200);assert.deepEqual(empty.body.data.items,[]);
 const contacts=await request('GET',base+'/shipping-contacts?fulfillmentId='+f.created.outcome.id);assert.equal(contacts.status,200);assert.equal(contacts.body.data.items[0].contactId,String(contactId));
 assert.equal((await request('GET',base+'/shipping-addresses')).status,400);
 assert.equal((await request('GET','/api/v1/fulfillment-lookups/customers/999999/shipping-addresses?fulfillmentId='+f.created.outcome.id)).status,404);
 assert.equal((await request('GET',base+'/shipping-contacts?fulfillmentId='+f.created.outcome.id,undefined,{auth:'denied'})).status,403);
 const current=f.claims.permissions;f.claims.permissions=[];await assert.rejects(()=>query('contacts'),error=>['PERMISSION_STALE','FULFILLMENT_PERMISSION_DENIED'].includes(error.code));f.claims.permissions=current;
};
})();

const httpSuccess=(()=>{
// Exact approved CONFIRM-HTTP-OUTCOME: two small fixtures, four HTTP commands, no load benchmark.


async function startHttp(f,serviceOptions={}){
 const directory=new URL('../../database/migrations/',import.meta.url),installed=new Set([92,93,95,96,98]);
 for(const name of (await readdir(directory)).filter(name=>/^[0-9]{4}_.*\.js$/u.test(name)&&Number(name.slice(0,4))>88&&!installed.has(Number(name.slice(0,4)))).sort())await(await import(new URL(name,directory).href)).up(f.db);
 const source=defaultConfigurationSource(),connection=f.f.connectionOptions,app=await createApplication({serviceOptions,configurationSource:{...source,application:{...source.application,port:0},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,'sales.backorderAllocate':{enabled:false},'sales.importWorker':{enabled:false},'sales.quotationExpire':{enabled:false},'sales.confirmationRecovery':{enabled:false},'fulfillment.confirmationRecovery':{enabled:false}}},database:{...source.database,host:connection.host,port:connection.port,socketPath:connection.socketPath,user:connection.user,password:connection.password,database:f.f.name}}});
 const previous=f.f.cleanup.shutdown;f.f.cleanup.shutdown=async()=>{try{await app.shutdown('private_confirm_http_complete');}finally{await previous?.();}};
 const {url}=await app.start(),subject=String(f.userId),version=await app.services.require('tokenRevocation').currentVersion(subject),token=await app.services.require('jwt').issue({roles:f.claims.roles,permissions:f.claims.permissions},{subject,version,authTime:Math.floor(Date.now()/1000)});
 const request=async(path,body,key)=>{const response=await fetch(new URL(path,url),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 return {app,url,token,request};
}


return async function(t){
 const full=await cancellationFixture(t,{picked:'5'});
 await full.s.insert('customer_address_purposes',{address_id:full.s.addressId,customer_id:full.s.customerId,purpose_code:'shipping',is_default:1,created_at:full.s.now,updated_at:full.s.now});
 const created=await full.execute(()=>new ShipmentService(full.options).createDraft(full.created.outcome.id,{eventId:randomUUID(),shippingAddressId:full.s.addressId,shippingAddressVersion:1,totalWeight:'1.25',weightUom:'KG'}));
 const first=await startHttp(full),request=first.request,path=`/api/v1/shipments/${created.outcome.id}/confirm`,body={eventId:randomUUID(),version:1},key=randomUUID();
 const confirmed=await request(path,body,key);assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
 assert.equal(confirmed.body.data.outcome,'SHIPPED');assert.equal(confirmed.body.data.shipment.status,'SHIPPED');assert.equal(confirmed.body.data.shipment.version,3);assert.equal(confirmed.body.data.shipment.confirmationEventId,body.eventId);
 assert.equal(confirmed.body.data.salesOrder.status,'COMPLETED');assert.equal(confirmed.body.data.salesOrder.lines.length,1);assert.equal(confirmed.body.data.salesOrder.lines[0].fulfilledBaseQuantity,'5');assert.equal(confirmed.body.data.salesOrder.lines[0].reservedOutstandingBaseQuantity,'0');assert.equal(confirmed.body.data.inventoryMovementIds.length,1);
 const replay=await request(path,body,key);assert.equal(replay.status,200,JSON.stringify(replay.body));assert.deepEqual(replay.body.data,confirmed.body.data);
 const conflict=await request(path,{...body,version:2},key);assert.equal(conflict.status,409);assert.equal(conflict.body.error.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await full.db.query('SELECT id FROM shipment_issue_details WHERE shipment_id=?',[created.outcome.id]))[0].length,1);

 await first.app.shutdown('private_confirm_http_first_complete');

};
})();

const httpPending=(()=>{
// Exact approved CONFIRM-HTTP-OUTCOME: two small fixtures, four HTTP commands, no load benchmark.


async function startHttp(f,serviceOptions={}){
 const directory=new URL('../../database/migrations/',import.meta.url),installed=new Set([92,93,95,96,98]);
 for(const name of (await readdir(directory)).filter(name=>/^[0-9]{4}_.*\.js$/u.test(name)&&Number(name.slice(0,4))>88&&!installed.has(Number(name.slice(0,4)))).sort())await(await import(new URL(name,directory).href)).up(f.db);
 const source=defaultConfigurationSource(),connection=f.f.connectionOptions,app=await createApplication({serviceOptions,configurationSource:{...source,application:{...source.application,port:0},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,'sales.backorderAllocate':{enabled:false},'sales.importWorker':{enabled:false},'sales.quotationExpire':{enabled:false},'sales.confirmationRecovery':{enabled:false},'fulfillment.confirmationRecovery':{enabled:false}}},database:{...source.database,host:connection.host,port:connection.port,socketPath:connection.socketPath,user:connection.user,password:connection.password,database:f.f.name}}});
 const previous=f.f.cleanup.shutdown;f.f.cleanup.shutdown=async()=>{try{await app.shutdown('private_confirm_http_complete');}finally{await previous?.();}};
 const {url}=await app.start(),subject=String(f.userId),version=await app.services.require('tokenRevocation').currentVersion(subject),token=await app.services.require('jwt').issue({roles:f.claims.roles,permissions:f.claims.permissions},{subject,version,authTime:Math.floor(Date.now()/1000)});
 const request=async(path,body,key)=>{const response=await fetch(new URL(path,url),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 return {app,url,token,request};
}


return async function(t){
 const f=await shipmentDraftFixture(t),draft=await f.create(f.body()),eventId=randomUUID();
 let releaseGate,reachedGate,finishB,locked=0;const installedConnections=new WeakSet(),gate=new Promise(resolve=>{releaseGate=resolve;}),reached=new Promise(resolve=>{reachedGate=resolve;}),finished=new Promise(resolve=>{finishB=resolve;});
 const poolFactory=config=>{const pool=createMySqlDatabasePool(config),get=pool.getConnection.bind(pool);pool.getConnection=async()=>{
  const connection=await get();if(installedConnections.has(connection))return connection;installedConnections.add(connection);
  const query=connection.query.bind(connection),commit=connection.commit.bind(connection),rollback=connection.rollback.bind(connection),destroy=connection.destroy.bind(connection);let phaseB=false;
  connection.query=async(sql,values)=>{const result=await query(sql,values),text=typeof sql==='string'?sql:sql.sql;if(text==='SELECT id FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE'&&values?.[0]===eventId&&locked===0){locked++;phaseB=true;reachedGate();await gate;}return result;};
  connection.commit=async()=>{const result=await commit();if(phaseB)finishB('COMMITTED');return result;};connection.rollback=async()=>{const result=await rollback();if(phaseB)finishB('ROLLED_BACK');return result;};connection.destroy=()=>{if(phaseB)finishB('DESTROYED');return destroy();};return connection;
 };return pool;};
 const second=await startHttp(f,{mysqldatabase:{poolFactory}}),{app,url,token}=second;
 const previous=f.f.cleanup.shutdown;f.f.cleanup.shutdown=async()=>{releaseGate();await previous?.();};
 try{
  const before=performance.now(),responsePromise=fetch(new URL(`/api/v1/shipments/${draft.outcome.id}/confirm`,url),{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify({eventId,version:1})});
  await Promise.race([reached,responsePromise.then(()=>{throw new Error('Controlled original PhaseB barrier was not reached before HTTP completed');})]);
  const response=await responsePromise,elapsed=performance.now()-before,pending=await response.json();assert.equal(response.status,202,JSON.stringify(pending));assert.ok(elapsed<=3000,`Functional 202 deadline exceeded: ${elapsed}ms`);assert.equal(response.headers.get('retry-after'),'2');assert.equal(pending.data.outcome,'SHIPPING');assert.equal(pending.data.eventId,eventId);assert.equal(pending.data.statusUrl,`/api/v1/fulfillment-operations/by-event/${eventId}`);assert.match(pending.data.correlationId,/^[0-9a-f-]{36}$/u);
  releaseGate();assert.equal(await finished,'COMMITTED');await app.shutdown('private_confirm_http_drained');
  const [[operation]]=await f.db.query('SELECT id,status,attempt_count,lease_owner FROM fulfillment_operation_requests WHERE event_id=?',[eventId]);assert.equal(String(operation.id),pending.data.operationId);assert.equal(operation.status,'SUCCEEDED');assert.equal(Number(operation.attempt_count),1);assert.equal(operation.lease_owner,'');assert.equal((await f.db.query('SELECT id FROM shipment_issue_details WHERE shipment_id=?',[draft.outcome.id]))[0].length,1);
  const [[shipment]]=await f.db.query('SELECT status,version,confirmation_event_id FROM shipments WHERE id=?',[draft.outcome.id]);assert.equal(shipment.status,'SHIPPED');assert.equal(Number(shipment.version),3);assert.equal(shipment.confirmation_event_id,eventId);assert.equal(locked,1);
 }finally{releaseGate();}
};
})();

const operationVisibility=(()=>{
// One approved OPERATION-HTTP-VISIBILITY scenario: one five-unit fixture, six status GETs.

async function startHttp(f,serviceOptions={}){
 const directory=new URL('../../database/migrations/',import.meta.url),installed=new Set([92,93,95,96,98]);
 for(const name of (await readdir(directory)).filter(name=>/^[0-9]{4}_.*\.js$/u.test(name)&&Number(name.slice(0,4))>88&&!installed.has(Number(name.slice(0,4)))).sort())await(await import(new URL(name,directory).href)).up(f.db);
 const source=defaultConfigurationSource(),connection=f.f.connectionOptions,app=await createApplication({serviceOptions,configurationSource:{...source,application:{...source.application,port:0},scheduler:{...source.scheduler,jobs:{...source.scheduler.jobs,'sales.backorderAllocate':{enabled:false},'sales.importWorker':{enabled:false},'sales.quotationExpire':{enabled:false},'sales.confirmationRecovery':{enabled:false},'fulfillment.confirmationRecovery':{enabled:false}}},database:{...source.database,host:connection.host,port:connection.port,socketPath:connection.socketPath,user:connection.user,password:connection.password,database:f.f.name}}});
 const previous=f.f.cleanup.shutdown;f.f.cleanup.shutdown=async()=>{try{await app.shutdown('private_confirm_http_complete');}finally{await previous?.();}};
 const {url}=await app.start(),subject=String(f.userId),version=await app.services.require('tokenRevocation').currentVersion(subject),token=await app.services.require('jwt').issue({roles:f.claims.roles,permissions:f.claims.permissions},{subject,version,authTime:Math.floor(Date.now()/1000)});
 return {app,url,token};
}

async function facts(f){const output={};for(const table of ['sales_orders','sales_order_lines','sales_order_line_reservations','sales_operation_requests','sales_order_status_history','sales_audit_logs','inventory_reservations','inventory_stock_controls','inventory_stock_balances','inventory_allocations','inventory_movements','inventory_operation_requests','inventory_audit_logs','fulfillments','fulfillment_lines','fulfillment_line_reservation_claims','fulfillment_allocations','fulfillment_status_history','fulfillment_audit_logs','fulfillment_operation_requests','shipments','shipment_lines','shipment_issue_details','shipment_status_history'])output[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return output;}

return async function(t){
 const f=await shipmentDraftFixture(t),draft=await f.create(f.body()),confirmation=new ShipmentConfirmationService(f.options),eventId=randomUUID(),started=await f.execute(()=>confirmation.startConfirmation(draft.outcome.id,{eventId,version:1}));
 const foreignId=await f.s.insert('users',{username:'foreign_'+randomUUID().slice(0,8),password_hash:'synthetic-only',display_name:'Synthetic viewer',created_at:f.s.now,updated_at:f.s.now});await f.db.execute('INSERT INTO user_roles(user_id,role_id) VALUES (?,?)',[foreignId,f.roleId]);
 const {app,url,token}=await startHttp(f),subject=String(foreignId),version=await app.services.require('tokenRevocation').currentVersion(subject),foreignToken=await app.services.require('jwt').issue({roles:f.claims.roles,permissions:f.claims.permissions},{subject,version,authTime:Math.floor(Date.now()/1000)});
 let reads=0;const get=async(id,authorization=token)=>{reads++;const response=await fetch(new URL('/api/v1/fulfillment-operations/by-event/'+id,url),{headers:authorization?{Authorization:`Bearer ${authorization}`}:{}});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};};
 const before=await facts(f);await f.db.beginTransaction();
 try{
  await f.db.query('SELECT id FROM fulfillment_operation_requests WHERE event_id=? FOR UPDATE',[eventId]);
  const pending=await get(eventId);assert.equal(pending.status,200,JSON.stringify(pending.body));assert.equal(pending.cache,'no-store');assert.deepEqual(Object.keys(pending.body.data).sort(),['correlationId','eventId','operationId','publicErrorCode','publicErrorDetails','result','status']);assert.equal(pending.body.data.status,'IN_PROGRESS');assert.equal(pending.body.data.eventId,eventId);assert.equal(pending.body.data.operationId,started.operationId);assert.equal(pending.body.data.correlationId,started.correlationId);assert.equal(pending.body.data.result,null);assert.equal(pending.body.data.publicErrorCode,null);assert.equal(pending.body.data.publicErrorDetails,null);
 }finally{await f.db.rollback();}
 assert.deepEqual(await facts(f),before);
 const foreign=await get(eventId,foreignToken),missing=await get(randomUUID());assert.equal(foreign.status,404,JSON.stringify(foreign.body));assert.equal(missing.status,404,JSON.stringify(missing.body));assert.deepEqual(foreign.body.error,missing.body.error);
 assert.equal((await get(eventId,null)).status,401);
 await f.execute(()=>confirmation.completeConfirmation(started));const committed=await facts(f),success=await get(eventId);assert.equal(success.status,200,JSON.stringify(success.body));assert.equal(success.body.data.status,'SUCCEEDED');assert.equal(success.body.data.eventId,eventId);assert.deepEqual(success.body.data.result,{id:draft.outcome.id,number:draft.outcome.number,status:'SHIPPED',version:3});assert.equal(success.body.data.publicErrorCode,null);assert.equal(success.body.data.publicErrorDetails,null);assert.deepEqual(Object.keys(success.body.data).sort(),['correlationId','eventId','operationId','publicErrorCode','publicErrorDetails','result','status']);assert.deepEqual(await facts(f),committed);
 await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='fulfillment.view'",[f.roleId]);const revoked=await get(eventId);assert.equal(revoked.status,403,JSON.stringify(revoked.body));assert.equal(revoked.body.error.code,'PERMISSION_STALE');assert.equal(reads,6);await app.shutdown('private_operation_visibility_drained');
};
})();

async function freshRevoked(t){
 const f=await shipmentDraftFixture(t);await issueSchema(f.db);const draft=await f.create(f.body()),service=new ShipmentConfirmationService(f.options),eventId=randomUUID(),started=await f.execute(()=>service.startConfirmation(draft.outcome.id,{eventId,version:1}));
 await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='fulfillment.operation'",[f.roleId]);
 const tables=['sales_orders','sales_order_lines','sales_order_line_reservations','sales_operation_requests','sales_order_status_history','sales_audit_logs','inventory_reservations','inventory_stock_controls','inventory_stock_balances','inventory_allocations','inventory_movements','inventory_operation_requests','inventory_audit_logs','fulfillments','fulfillment_lines','fulfillment_line_reservation_claims','fulfillment_allocations','fulfillment_status_history','fulfillment_audit_logs','fulfillment_operation_requests','shipments','shipment_lines','shipment_issue_details','shipment_status_history'];
 const facts=async()=>{const result={};for(const table of tables)result[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;},before=await facts(),withTransaction=f.database.withTransaction.bind(f.database),post=service.inventory.postFulfillmentIssueBatchInTransaction.bind(service.inventory);let prepareTx=null,transactions=0,postCalls=0,completions=0;
 f.database.withTransaction=(work,options)=>withTransaction(async(tx,...args)=>{transactions++;prepareTx=tx;return work(tx,...args);},options);service.inventory.postFulfillmentIssueBatchInTransaction=async(...args)=>{postCalls++;return post(...args);};
 try{await assert.rejects(()=>{completions++;return f.execute(()=>service.completeConfirmation(started));},{code:'PERMISSION_STALE'});assert.equal(completions,1);assert.equal(transactions,1);assert.equal(getTransactionOutcome(prepareTx)?.state,'ROLLED_BACK');assert.equal(postCalls,0);assert.deepEqual(await facts(),before);assert.equal(before.shipments[0].status,'SHIPPING');assert.equal(Number(before.shipments[0].version),2);assert.equal(before.fulfillment_operation_requests.find(row=>row.event_id===eventId).status,'IN_PROGRESS');}
 finally{f.database.withTransaction=withTransaction;service.inventory.postFulfillmentIssueBatchInTransaction=post;}
}

nativeTest('LOOKUP-PARENT-ACTIVE: parent-bound active and default shipping choices',async t=>ownedScenario(t,lookupParent));
nativeTest('LOOKUP-CHILD-VERSION: wrong-owner and removed-purpose refusal; original stale-version case retained',async t=>ownedScenario(t,lookupChildren));
nativeTest('LOOKUP-HTTP-PERMISSION: strict parent query, six-read ceiling and fresh permissions',async t=>ownedScenario(t,lookupPermission));
nativeTest('CONFIRM-INTENT: same-event double start and Confirm versus Cancel',async t=>ownedScenario(t,intent));
nativeTest('CONFIRM-TERMINAL-WITNESS: immutable original outcomes, history faults and selected version headroom',async t=>{await ownedScenario(t,failedAfterEdit);await ownedScenario(t,terminalWitness);});
nativeTest('CONFIRM-START-ROLLBACK: late audit rollback then original-event start',async t=>ownedScenario(t,startRollback));
nativeTest('ISSUE-ATOMIC: two-line two-bucket zero-picked preservation and original-event replay',async t=>ownedScenario(t,atomicZero));
nativeTest('ISSUE-ROLLBACK: Inventory, Sales, snapshot and audit faults restore all24 facts',async t=>{await ownedScenario(t,stageRollback);await ownedScenario(t,auditRollback);});
nativeTest('ISSUE-OWNER-PROOF: source mismatch, foreign receipt issuer and stale owner version',async t=>ownedScenario(t,ownerProof));
nativeTest('ISSUE-FRESH-GUARDS: seven finite source, actor, adjustment and incompatible-work guards',async t=>{await ownedScenario(t,freshAddress);await ownedScenario(t,freshSelected);await ownedScenario(t,freshAdjustment);await ownedScenario(t,freshRevoked);await ownedScenario(t,freshCreate,15000);});
nativeTest('CONFIRM-HTTP-OUTCOME: committed200 and original pending202 within3000ms',async t=>{await ownedScenario(t,httpSuccess);await ownedScenario(t,httpPending);});
nativeTest('OPERATION-HTTP-VISIBILITY: original pending and terminal reads with fresh authorization',async t=>ownedScenario(t,operationVisibility));
