import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { p1Fixture } from "../fulfillment/p1Fixture.js";
import { FulfillmentAllocationService } from "../../src/modules/fulfillment/FulfillmentAllocationService.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function fixture(t,quantity=5){
 const f=await p1Fixture(t,quantity),created=await f.create(f.body(String(quantity))),bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"ALLOCATE",normalized_code:"allocate",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
 const balance=await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:bin,sku_id:f.s.skuId,stock_status:"AVAILABLE",on_hand_quantity:quantity,allocated_quantity:0,fifo_anchor_date:"2023-11-13",created_at:f.s.now,updated_at:f.s.now}),allocations=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}});
 const body=()=>({eventId:randomUUID(),version:1,lines:[{fulfillmentLineId:Number(created.fulfillment.lines[0].id),allocations:[{inventoryReservationId:Number(f.reservationId),inventoryBalanceId:Number(balance),balanceVersion:1,baseQuantity:String(quantity)}],overrideReason:""}]});
 return {...f,created,balance,allocations,allocate:input=>f.execute(()=>allocations.allocate(created.outcome.id,input)),allocationBody:body};
}
nativeTest("P1 Allocate atomically posts the complete native batch and projections, then replays the original outcome",async t=>{
 const f=await fixture(t),body=f.allocationBody(),before={};for(const table of ["sales_orders","sales_order_lines","sales_order_line_reservations"])before[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
 const result=await f.allocate(body);assert.deepEqual(result.outcome,{id:f.created.outcome.id,number:f.created.outcome.number,status:"PICKING",version:2});assert.equal(result.fulfillment.status,"PICKING");assert.equal(result.fulfillment.lines[0].allocatedBaseQuantity,"5");assert.equal(result.fulfillment.allocations.items.length,1);
 const [[reservation]]=await f.db.query("SELECT original_quantity,consumed_quantity,released_quantity,outstanding_quantity,version FROM inventory_reservations WHERE id=?",[f.reservationId]);assert.deepEqual(Object.values(reservation).map(Number),[5,0,0,5,2]);
 const [[balance]]=await f.db.query("SELECT on_hand_quantity,allocated_quantity FROM inventory_stock_balances WHERE id=?",[f.balance]);assert.deepEqual(Object.values(balance).map(Number),[5,5]);
 for(const [table,rows]of Object.entries(before))assert.deepEqual((await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0],rows);
 const count=async()=>Object.fromEntries(await Promise.all(["fulfillment_operation_requests","fulfillment_allocations","fulfillment_status_history","fulfillment_audit_logs","inventory_operation_requests","inventory_allocations","inventory_audit_logs"].map(async table=>[table,Number((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n)]))),counts=await count();
 assert.deepEqual((await f.allocate(body)).outcome,result.outcome);assert.deepEqual(await count(),counts);
});

nativeTest("P1 Inventory preparation derives per-member reasons from one Line reason without early domain locks",async t=>{
 const {inventoryNativeFixture}=await import("../fulfillment/inventoryNativeFixture.js"),{InventoryFulfillmentService}=await import("../../src/modules/inventory/InventoryFulfillmentService.js"),{InventoryLookupService}=await import("../../src/modules/inventory/InventoryLookupService.js"),f=await inventoryNativeFixture(t);
 const r1=await f.reservation("5","5","first"),r2=await f.reservation("5","5","second"),bin=await f.insert("INSERT INTO inventory_bins(warehouse_id,bin_code,normalized_code,created_at,updated_at) VALUES(?,'B','b',1,1)",[f.warehouseId]),second=await f.insert("INSERT INTO inventory_stock_balances(warehouse_id,bin_id,sku_id,stock_status,on_hand_quantity,fifo_anchor_date,created_at,updated_at) VALUES(?,?,?,'AVAILABLE',20,'2026-10-02',1,1)",[f.warehouseId,bin,f.skuId]);
 const reason="Choose alternate pick bucket",member=(claimId,inventoryReservationId,inventoryBalanceId)=>({claimId,inventoryReservationId,expectedVersion:1,baseQuantity:"4",overrideReason:reason,allocations:[{inventoryBalanceId,expectedBalanceVersion:1,baseQuantity:"4"}]}),naive={actor:f.actor,source:{documentId:"1",eventId:randomUUID()},correlationId:"",payload:{fulfillmentId:"1",lines:[{fulfillmentLineId:"3",salesOrderLineId:"5",baseQuantity:"8",reservations:[member("7",r1,f.balanceId),member("8",r2,second)]}]}};
 const service=new InventoryFulfillmentService(f),lookup=new InventoryLookupService({...f,fulfillment:service});
 await assert.rejects(()=>f.withActor(async tx=>{const proof=await service.claimFulfillmentBatchInTransaction(tx,{action:"ALLOCATE",command:naive});return service.allocateForFulfillmentBatchInTransaction(tx,naive,proof);},{isolationLevel:"READ COMMITTED"}),{code:"INVENTORY_INPUT_INVALID"});
 const query={fulfillmentId:"1",salesOrderId:"1",warehouseId:f.warehouseId,lines:[{fulfillmentLineId:"3",salesOrderLineId:"5",skuId:f.skuId,baseQuantity:"8",overrideReason:reason,reservations:naive.payload.lines[0].reservations.map(({expectedVersion:_expectedVersion,overrideReason:_overrideReason,...member})=>member)}]};
 await f.withActor(async tx=>{
  const statements=[],read=tx.query.bind(tx),write=tx.execute.bind(tx);tx.query=(sql,args)=>{statements.push(sql);return read(sql,args);};tx.execute=(sql,args)=>{statements.push(sql);return write(sql,args);};
  const prepared=await lookup.prepareFulfillmentAllocationInTransaction(tx,query);assert.deepEqual(prepared.payload.lines[0].reservations.map(row=>row.overrideReason),["",reason]);
  assert.equal(statements.some(sql=>/FOR\s+(?:UPDATE|SHARE)|^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/iu.test(sql)),false);
  const command={...naive,source:{...naive.source,eventId:randomUUID()},payload:prepared.payload},proof=await service.claimFulfillmentBatchInTransaction(tx,{action:"ALLOCATE",command}),result=await service.allocateForFulfillmentBatchInTransaction(tx,command,proof);
  assert.deepEqual(result.lines[0].reservations.map(row=>row.allocations[0].isSequenceOverride),[false,true]);
 },{isolationLevel:"READ COMMITTED"});
});

async function mixedFixture(t,{expiry=false,overridePermission=false}={}){
 const f=await p1Fixture(t,4),event=randomUUID();
 await f.db.execute("UPDATE sales_orders SET total_amount=8 WHERE id=?",[f.s.orderId]);await f.db.execute("UPDATE sales_order_lines SET ordered_quantity=8,ordered_base_quantity=8,reserved_outstanding_base_quantity=8,line_amount=8 WHERE id=?",[f.s.lineId]);await f.db.execute("UPDATE inventory_stock_controls SET reserved_quantity=8,version=version+1 WHERE warehouse_id=? AND sku_id=?",[f.s.warehouseId,f.s.skuId]);
 const root=await f.s.insert("inventory_operation_requests",{command_type:"SALES_BACKORDER_BATCH_RESERVE",source_module:"SALES",source_document_type:"SALES_ORDER",source_document_id:String(f.s.orderId),source_event_id:event,request_hash:"a".repeat(64),actor_label:f.label,created_at:f.s.now}),child=await f.s.insert("inventory_operation_requests",{command_type:"SALES_BACKORDER_LINE_RESERVE",source_module:"SALES",source_document_type:"SALES_ORDER",source_document_id:String(f.s.orderId),source_line_id:String(f.s.lineId),source_event_id:event,request_hash:"a".repeat(64),actor_label:f.label,created_at:f.s.now}),secondReservation=await f.s.insert("inventory_reservations",{create_operation_id:child,warehouse_id:f.s.warehouseId,sku_id:f.s.skuId,original_quantity:4,outstanding_quantity:4,purpose:"SALE",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});
 await f.s.insert("sales_order_line_reservations",{sales_order_line_id:f.s.lineId,inventory_reservation_id:secondReservation,inventory_operation_id:root,source_event_id:event,original_base_quantity:4,outstanding_base_quantity:4,status:"ACTIVE",inventory_version:1,created_at:f.s.now,updated_at:f.s.now});
 if(expiry)await f.db.execute("UPDATE item_skus SET tracking_policy='batch_expiry' WHERE id=?",[f.s.skuId]);
 if(overridePermission){await f.db.execute("INSERT INTO role_permissions(role_id,permission_id) SELECT ?,id FROM permissions WHERE name='inventory.fefo.override'",[f.roleId]);f.claims.permissions.push("inventory.fefo.override");}
 const balances=[];for(const [code,date]of [["A","2023-11-20"],["B","2023-12-20"]]){
  const bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:code,normalized_code:code.toLowerCase(),status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});let lot=null;
  if(expiry)lot=await f.s.insert("inventory_lots",{sku_id:f.s.skuId,lot_number:code,normalized_lot_number:code.toLowerCase(),expiry_date:date,first_receipt_date:"2023-11-01",sku_code_snapshot:"SYN",created_at:f.s.now});
  balances.push(await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:bin,sku_id:f.s.skuId,lot_id:lot,stock_status:"AVAILABLE",on_hand_quantity:8,allocated_quantity:0,fifo_anchor_date:expiry?null:code==="A"?"2023-11-12":"2023-11-13",created_at:f.s.now,updated_at:f.s.now}));
 }
 const created=await f.create(f.body("8")),allocations=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}}),body={eventId:randomUUID(),version:1,lines:[{fulfillmentLineId:Number(created.fulfillment.lines[0].id),allocations:[{inventoryReservationId:Number(f.reservationId),inventoryBalanceId:Number(balances[0]),balanceVersion:1,baseQuantity:"4"},{inventoryReservationId:Number(secondReservation),inventoryBalanceId:Number(balances[1]),balanceVersion:1,baseQuantity:"4"}],overrideReason:"Use the alternate pick bucket"}]};
 return {...f,created,body,balances,secondReservation,allocations,allocate:()=>f.execute(()=>allocations.allocate(created.outcome.id,body))};
}
nativeTest("P1 Allocate accepts a mixed normal/FIFO override Line without attaching its reason to the normal Claim",async t=>{
 const f=await mixedFixture(t),result=await f.allocate();assert.equal(result.outcome.status,"PICKING");const [rows]=await f.db.query("SELECT inventory_reservation_id,is_sequence_override,override_reason FROM fulfillment_allocations ORDER BY inventory_reservation_id");assert.deepEqual(rows.map(row=>[String(row.inventory_reservation_id),Number(row.is_sequence_override),row.override_reason]),[[String(f.reservationId),0,""],[String(f.secondReservation),1,f.body.lines[0].overrideReason]]);
});
nativeTest("P1 Allocate FEFO override needs fresh specialist permission as well as the single Line reason",async t=>{
 for(const allowed of [false,true])await t.test(String(allowed),async t=>{const f=await mixedFixture(t,{expiry:true,overridePermission:allowed});if(allowed){const result=await f.allocate();assert.equal(result.outcome.status,"PICKING");const [rows]=await f.db.query("SELECT selection_strategy,is_sequence_override,override_reason FROM fulfillment_allocations ORDER BY inventory_reservation_id");assert.deepEqual(rows.map(row=>[row.selection_strategy,Number(row.is_sequence_override),row.override_reason]),[["FEFO",0,""],["FEFO",1,f.body.lines[0].overrideReason]]);}else{await assert.rejects(f.allocate,{code:"FEFO_OVERRIDE_DENIED"});assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM inventory_allocations"))[0][0].n),0);assert.equal((await f.db.query("SELECT status FROM fulfillments WHERE id=?",[f.created.outcome.id]))[0][0].status,"DRAFT");}});
});

nativeTest("P1 sequence audit never attributes the selected quantity to a smaller recommended bucket",async t=>{
 const f=await fixture(t,8);await f.db.execute("UPDATE inventory_stock_balances SET on_hand_quantity=5 WHERE id=?",[f.balance]);
 const bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"ALTERNATE",normalized_code:"alternate",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now}),balance=await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:bin,sku_id:f.s.skuId,stock_status:"AVAILABLE",on_hand_quantity:8,allocated_quantity:0,fifo_anchor_date:"2023-11-14",created_at:f.s.now,updated_at:f.s.now}),body=f.allocationBody();body.lines[0].allocations[0].inventoryBalanceId=Number(balance);body.lines[0].overrideReason="Use a single alternate bucket";
 await f.allocate(body);const [[audit]]=await f.db.query("SELECT before_summary,after_summary FROM fulfillment_audit_logs WHERE action='SEQUENCE_OVERRIDE'"),before=typeof audit.before_summary==="string"?JSON.parse(audit.before_summary):audit.before_summary,after=typeof audit.after_summary==="string"?JSON.parse(audit.after_summary):audit.after_summary;
 assert.equal(before.inventoryBalanceId,String(f.balance));assert.equal(Object.hasOwn(before,"allocatedQuantity"),false);assert.equal(after.inventoryBalanceId,String(balance));assert.equal(after.allocatedQuantity,"8");
});

async function allocationFacts(f){
 const facts={};for(const table of ["fulfillments","fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_allocations","fulfillment_status_history","fulfillment_audit_logs","fulfillment_operation_requests","inventory_reservations","inventory_stock_controls","inventory_stock_balances","inventory_allocations","inventory_operation_requests","inventory_audit_logs"])facts[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return facts;
}
nativeTest("P1 Allocate late projection, Header and audit failures roll back every owner and public effect",async t=>{
 for(const [table,verb]of [["fulfillment_allocations","INSERT"],["fulfillments","UPDATE"],["fulfillment_audit_logs","INSERT"]])await t.test(table,async t=>{
  const f=await fixture(t),before=await allocationFacts(f),body=f.allocationBody();await f.db.query(`CREATE TRIGGER test_allocate_late_failure BEFORE ${verb} ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic late Allocate failure'`);
  await assert.rejects(()=>f.allocate(body));assert.deepEqual(await allocationFacts(f),before);await f.db.query("DROP TRIGGER test_allocate_late_failure");assert.equal((await f.allocate(body)).outcome.status,"PICKING");
 });
});
nativeTest("P1 Allocate shared Balance advances each actual leg CAS and replays after the versions advance",async t=>{
 const f=await mixedFixture(t);f.body.lines[0].overrideReason="";f.body.lines[0].allocations[1].inventoryBalanceId=Number(f.balances[0]);
 const first=await f.allocate(),[rows]=await f.db.query("SELECT inventory_balance_id,balance_version FROM fulfillment_allocations ORDER BY inventory_reservation_id");assert.deepEqual(rows.map(row=>[String(row.inventory_balance_id),Number(row.balance_version)]),[[String(f.balances[0]),2],[String(f.balances[0]),3]]);const before=await allocationFacts(f);assert.deepEqual((await f.allocate()).outcome,first.outcome);assert.deepEqual(await allocationFacts(f),before);
});
nativeTest("P1 Allocate preparation follows actual alternate selection when recommending the next Claim",async t=>{
 const f=await mixedFixture(t);f.body.lines[0].allocations[0].inventoryBalanceId=Number(f.balances[1]);f.body.lines[0].allocations[1].inventoryBalanceId=Number(f.balances[0]);
 await f.allocate();const [rows]=await f.db.query("SELECT inventory_reservation_id,is_sequence_override,override_reason FROM fulfillment_allocations ORDER BY inventory_reservation_id");assert.deepEqual(rows.map(row=>[String(row.inventory_reservation_id),Number(row.is_sequence_override),row.override_reason]),[[String(f.reservationId),1,f.body.lines[0].overrideReason],[String(f.secondReservation),0,""]]);
});
nativeTest("P1 Allocate rejects hidden counter drift with equal outstanding, but accepts quantity-neutral current CAS",async t=>{
 for(const drift of [false,true])await t.test(String(drift),async t=>{
  const f=await fixture(t),body=f.allocationBody();if(drift)await f.db.execute("UPDATE inventory_reservations SET original_quantity=6,consumed_quantity=1,version=version+1 WHERE id=?",[f.reservationId]);else await f.db.execute("UPDATE inventory_reservations SET version=version+1 WHERE id=?",[f.reservationId]);
  if(drift){const before=await allocationFacts(f);await assert.rejects(()=>f.allocate(body),{code:"FULFILLABLE_QUANTITY_CHANGED"});assert.deepEqual(await allocationFacts(f),before);}else{assert.equal((await f.allocate(body)).outcome.status,"PICKING");assert.equal(Number((await f.db.query("SELECT version FROM inventory_reservations WHERE id=?",[f.reservationId]))[0][0].version),3);}
 });
});
nativeTest("P1 Allocate current-read failure preserves the committed operation for same-event recovery",async t=>{
 const f=await fixture(t),body=f.allocationBody(),original=f.allocations.inquiry.detail.bind(f.allocations.inquiry);f.allocations.inquiry.detail=async()=>{throw new Error("Synthetic postcommit projection failure");};
 await assert.rejects(()=>f.allocate(body),error=>error.code==="FULFILLMENT_DEPENDENCY_UNAVAILABLE"&&typeof error.publicDetails.correlationId==="string"&&!Object.hasOwn(error.publicDetails,"statusUrl"));
 const [[operation]]=await f.db.query("SELECT status FROM fulfillment_operation_requests WHERE event_id=?",[body.eventId]);assert.equal(operation.status,"SUCCEEDED");const before=await allocationFacts(f);f.allocations.inquiry.detail=original;assert.equal((await f.allocate(body)).outcome.status,"PICKING");assert.deepEqual(await allocationFacts(f),before);
});
nativeTest("P1 Allocate discovered HTTP route enforces exact intent, original outcome replay and fresh permission before cached replay",async t=>{
 const f=await fixture(t),{startP1Http}=await import("../fulfillment/p1Fixture.js"),http=await startP1Http(t,f),path=`/api/v1/fulfillments/${f.created.outcome.id}/allocate`,body=f.allocationBody(),post=(input,options)=>http("POST",path,input,options);
 assert.equal((await post(body,{auth:false})).status,401);assert.equal((await post(body,{auth:"denied"})).status,403);
 for(const mutate of [b=>{b.selectionStrategy="FIFO";},b=>{b.lines=[];},b=>{b.lines[0].allocations[0].claimId=1;},b=>{b.lines[0].allocations[0].inventoryReservationId++;}]){const input=structuredClone(body);mutate(input);assert.equal((await post(input)).status,400);}
 const key=randomUUID(),first=await post(body,{key});assert.equal(first.status,200,JSON.stringify(first.body));assert.equal(first.body.data.outcome.status,"PICKING");assert.deepEqual((await post(body,{key})).body.data,first.body.data);assert.deepEqual((await post(body)).body.data,first.body.data);
 assert.equal((await post({...body,version:2})).status,409);await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='fulfillment.operation'",[f.roleId]);const stale=await post(body,{key});assert.equal(stale.status,403);assert.equal(stale.body.error.code,"PERMISSION_STALE");
});

nativeTest("P1 Allocate second-connection Reservation or candidate changes after preparation cause complete rollback",async t=>{
 for(const change of ["reservationVersion","normalToOverride","overrideToNormal"])await t.test(change,async t=>{
  const f=await fixture(t),body=f.allocationBody();let alternative;
  if(change!=="reservationVersion"){
   const bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"RACE",normalized_code:"race",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now});alternative=await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:bin,sku_id:f.s.skuId,stock_status:"AVAILABLE",on_hand_quantity:5,allocated_quantity:0,fifo_anchor_date:"2023-11-14",created_at:f.s.now,updated_at:f.s.now});
   if(change==="overrideToNormal"){body.lines[0].allocations[0].inventoryBalanceId=Number(alternative);body.lines[0].overrideReason="Use alternate stock";}
  }
  let before;const original=f.allocations.inventoryLookup.prepareFulfillmentAllocationInTransaction.bind(f.allocations.inventoryLookup);f.allocations.inventoryLookup.prepareFulfillmentAllocationInTransaction=async(tx,query)=>{
   const result=await original(tx,query);if(change==="reservationVersion")await f.db.execute("UPDATE inventory_reservations SET version=version+1 WHERE id=?",[f.reservationId]);else await f.db.execute("UPDATE inventory_stock_balances SET fifo_anchor_date='2023-11-12' WHERE id=?",[alternative]);before=await allocationFacts(f);return result;
  };
  await assert.rejects(()=>f.allocate(body),{code:"ALLOCATION_CANDIDATE_CHANGED"});assert.deepEqual(await allocationFacts(f),before);
 });
});
nativeTest("P1 Allocate specialist permission revoked on a second connection after preparation cannot post",async t=>{
 const f=await mixedFixture(t,{expiry:true,overridePermission:true});let before;const original=f.allocations.inventoryLookup.prepareFulfillmentAllocationInTransaction.bind(f.allocations.inventoryLookup);f.allocations.inventoryLookup.prepareFulfillmentAllocationInTransaction=async(tx,query)=>{const result=await original(tx,query);await f.db.execute("DELETE rp FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=? AND p.name='inventory.fefo.override'",[f.roleId]);before=await allocationFacts(f);return result;};
 await assert.rejects(f.allocate,{code:"PERMISSION_STALE"});assert.deepEqual(await allocationFacts(f),before);
});
nativeTest("P1 Allocate malformed preparation never reaches Inventory preclaim",async t=>{
 const f=await fixture(t),body=f.allocationBody(),before=await allocationFacts(f),logs=[];f.allocations.logger={error:(...entry)=>logs.push(entry)};let claimed=false;f.allocations.inventoryLookup.prepareFulfillmentAllocationInTransaction=async()=>({payload:{},reservationFacts:[]});f.allocations.inventory.claimFulfillmentBatchInTransaction=async()=>{claimed=true;throw new Error("must not claim malformed owner payload");};await assert.rejects(()=>f.allocate(body),{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});assert.equal(claimed,false);assert.deepEqual(await allocationFacts(f),before);assertCriticalContractLog(logs);
});

nativeTest("P1 full Allocate 100-line/5000-Reservation capacity retains the original20-second transaction limit",{timeout:120000},async t=>{
 const f=await p1Fixture(t),{seedMaxClaimOrder}=await import("../fulfillment/p1CapacityFixture.js"),sources=await seedMaxClaimOrder(f);
 // This capacity lane uses the approved production budget; ordinary P1 fixtures use a stricter10s.
 f.database.config={...f.database.config,transactionTimeoutMs:20000};assert.equal(f.database.config.transactionTimeoutMs,20000);
 const created=await f.create({...f.body(),lines:sources.map(line=>({salesOrderLineId:line.id,plannedBaseQuantity:"50"}))}),bin=await f.s.insert("inventory_bins",{warehouse_id:f.s.warehouseId,bin_code:"CAPACITY",normalized_code:"capacity",status:"ACTIVE",created_at:f.s.now,updated_at:f.s.now}),balances=new Map();
 for(const source of sources)balances.set(String(source.sku),await f.s.insert("inventory_stock_balances",{warehouse_id:f.s.warehouseId,bin_id:bin,sku_id:source.sku,stock_status:"AVAILABLE",on_hand_quantity:50,allocated_quantity:0,fifo_anchor_date:"2023-11-13",created_at:f.s.now,updated_at:f.s.now}));
 const [members]=await f.db.query("SELECT c.inventory_reservation_id,c.fulfillment_line_id,l.sku_id FROM fulfillment_line_reservation_claims c JOIN fulfillment_lines l ON l.id=c.fulfillment_line_id WHERE c.fulfillment_id=? ORDER BY c.fulfillment_line_id,c.inventory_reservation_id",[created.outcome.id]),lines=new Map();
 for(const member of members){const id=Number(member.fulfillment_line_id);if(!lines.has(id))lines.set(id,{fulfillmentLineId:id,overrideReason:"",allocations:[]});lines.get(id).allocations.push({inventoryReservationId:Number(member.inventory_reservation_id),inventoryBalanceId:Number(balances.get(String(member.sku_id))),balanceVersion:1,baseQuantity:"1"});}
 const service=new FulfillmentAllocationService({database:f.database,time:{...f.time,fileDate:()=>"2023-11-14"},logger:{error(){}}}),body={eventId:randomUUID(),version:1,lines:[...lines.values()]},stages={},metrics={queries:0,executes:0,projectionBatches:0};
 for(const [object,name,label]of [[service.inventoryLookup,"prepareFulfillmentAllocationInTransaction","prepare"],[service.inventory,"claimFulfillmentBatchInTransaction","preclaim"],[service.sales,"lockLinesForFulfillmentInTransaction","salesLocks"],[service.inventory,"allocateForFulfillmentBatchInTransaction","inventoryPost"],[service.inventoryLookup,"lockFulfillmentReservationStatesInTransaction","postRead"]]){const original=object[name].bind(object);object[name]=async(...args)=>{const start=performance.now();try{return await original(...args);}finally{stages[label]=(stages[label]??0)+performance.now()-start;}};}
 const original=f.database.withTransaction.bind(f.database);f.database.withTransaction=(work,options)=>original(async tx=>{for(const key of ["query","execute"]){const method=tx[key].bind(tx);tx[key]=(...args)=>{metrics[key==="query"?"queries":"executes"]++;if(args[0].startsWith("INSERT INTO fulfillment_allocations ("))metrics.projectionBatches++;return method(...args);};}return work(tx);},options);
 const before=await allocationFacts(f),last=Math.max(...members.map(member=>Number(member.inventory_reservation_id)));assert.ok(Number.isSafeInteger(last));
 await f.db.query(`CREATE TRIGGER test_last_allocate_projection_batch BEFORE INSERT ON fulfillment_allocations FOR EACH ROW BEGIN IF NEW.inventory_reservation_id=${last} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic final Allocation projection batch failure'; END IF; END`);
 await assert.rejects(()=>f.execute(()=>service.allocate(created.outcome.id,body)));assert.equal(metrics.projectionBatches,50);assert.deepEqual(await allocationFacts(f),before);await f.db.query("DROP TRIGGER test_last_allocate_projection_batch");for(const key of Object.keys(metrics))metrics[key]=0;for(const key of Object.keys(stages))delete stages[key];
 const start=performance.now(),result=await f.execute(()=>service.allocate(created.outcome.id,body)),elapsedMs=performance.now()-start;assert.equal(result.outcome.status,"PICKING");assert.equal(result.fulfillment.lines.length,100);assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_allocations WHERE fulfillment_id=?",[created.outcome.id]))[0][0].n),5000);assert.ok(elapsedMs<20000,JSON.stringify({elapsedMs,stages,metrics}));
 const [[totals]]=await f.db.query("SELECT SUM(outstanding_quantity) AS outstanding,SUM(consumed_quantity) AS consumed,SUM(released_quantity) AS released,MIN(version) AS minVersion,MAX(version) AS maxVersion FROM inventory_reservations");assert.deepEqual(Object.values(totals).map(Number),[5000,0,0,2,2]);
 t.diagnostic(JSON.stringify({scenario:"full-P1-Allocate-100-SKU-lines/50-Reservations-per-line/5000-Claims",elapsedMs,stages,metrics,transactionTimeoutMs:f.database.config.transactionTimeoutMs,singleLocalSample:true}));
});

nativeTest("P1 Allocate rejects malformed owner receipts and rolls back real posted Inventory effects",async t=>{
 const f=await fixture(t),body=f.allocationBody(),before=await allocationFacts(f),original=f.allocations.inventory.allocateForFulfillmentBatchInTransaction.bind(f.allocations.inventory),logs=[];f.allocations.logger={error:(...entry)=>logs.push(entry)};
 for(const mutate of [r=>{r.extra=true;},r=>{r.lines[0]=null;},r=>{r.lines[0].reservations[0]=null;},r=>{r.lines[0].reservations[0].allocations[0]=null;},r=>{r.lines[0].reservations[0].version++;},r=>{r.lines[0].reservations[0].allocations[0].baseQuantity="4";},r=>{r.lines[0].reservations[0].allocations[0].bucketSnapshot.warehouseId="99999";},r=>{r.lines[0].reservations[0].allocations[0].bucketSnapshot.baseUomId="99999";},r=>{r.lines[0].reservations[0].allocations[0].selectionStrategy="FEFO";},r=>{r.lines[0].reservations[0].allocations[0].balanceVersion++;}]){
  f.allocations.inventory.allocateForFulfillmentBatchInTransaction=async(...args)=>{const result=structuredClone(await original(...args));mutate(result);return result;};logs.length=0;await assert.rejects(()=>f.allocate(body),{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE"});assert.deepEqual(await allocationFacts(f),before);assertCriticalContractLog(logs);
 }
});

function assertCriticalContractLog(logs){
 assert.equal(logs.length,1);assert.equal(logs[0][0],"fulfillment.inventory_contract_mismatch");assert.equal(logs[0][1],"Critical Inventory owner contract mismatch");const context=logs[0][2];assert.deepEqual(Object.keys(context).sort(),["code","correlationId","severity"]);assert.equal(context.code,"INVENTORY_CONTRACT_MISMATCH");assert.equal(context.severity,"critical");assert.match(context.correlationId,/^[0-9a-f-]{36}$/u);
}

nativeTest("P1 Allocate missing required candidate table or column returns stable dependency503 without caching absence",async t=>{
 const f=await fixture(t),body=f.allocationBody(),before=await allocationFacts(f);
 for(const [remove,restore]of [["RENAME TABLE inventory_bins TO test_missing_inventory_bins","RENAME TABLE test_missing_inventory_bins TO inventory_bins"],["ALTER TABLE inventory_bins RENAME COLUMN bin_code TO test_missing_bin_code","ALTER TABLE inventory_bins RENAME COLUMN test_missing_bin_code TO bin_code"]]){
  await f.db.query(remove);try{await assert.rejects(()=>f.allocate(body),{code:"FULFILLMENT_DEPENDENCY_UNAVAILABLE",statusCode:503});}finally{await f.db.query(restore);}assert.deepEqual(await allocationFacts(f),before);
 }
 assert.equal((await f.allocate(body)).outcome.status,"PICKING");
});
