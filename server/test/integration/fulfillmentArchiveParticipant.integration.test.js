import assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {seedFulfillmentSalesOrder} from "../sales/phase4/fulfillmentOwnerFixtures.js";
import {archiveFactsFixture} from "../fulfillment/archiveFactsFixture.js";
import {FulfillmentArchiveParticipant} from "../../src/modules/fulfillment/FulfillmentArchiveParticipant.js";
import {FulfillmentArchiveLockService} from "../../src/modules/fulfillment/FulfillmentArchiveLockService.js";
import {SalesArchiveLockService} from "../../src/modules/sales/SalesArchiveLockService.js";
import {SALES_ARCHIVE_COLUMNS,hashSalesArchiveRow,hashSalesArchiveRows} from "../../src/modules/sales/salesArchiveHash.js";
import {FULFILLMENT_ARCHIVE_CONTRACTS,hashFulfillmentArchiveTable,hashFulfillmentArchiveRow} from "../../src/modules/fulfillment/fulfillmentArchiveSchema.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function fixture(t,options={}){
 const f=await archiveFactsFixture(t,options),file=fileURLToPath(new URL("../../scripts/migrate.js",import.meta.url));await promisify(execFile)(process.execPath,[file],{env:{...process.env,DB_NAME:f.f.name,DB_USER:f.f.connectionOptions.user,DB_PASSWORD:f.f.connectionOptions.password},timeout:180000,maxBuffer:1024*1024});
 const now=Date.now(),cutoff=now-86400000,batch=await f.s.insert("sales_archive_batches",{batch_number:"SYNTHETIC-PARTICIPANT",period_key:"202610",cutoff_at:cutoff,status:"RUNNING",started_at:now,updated_at:now});
 for(const [type,target,operation]of [["FULFILLMENT",f.doc.id,"UPDATE"],["SHIPMENT",f.shipment,"SHIP"],["FULFILLMENT",null,"CREATE"]])await f.s.insert("fulfillment_operation_requests",{event_id:randomUUID(),operation_type:operation,target_type:type,target_id:target,sales_order_id:f.s.orderId,payload_hash:"a".repeat(64),status:"FAILED",public_error_code:"VERSION_CONFLICT",attempt_count:1,completed_at:f.s.now,correlation_id:randomUUID(),created_at:f.s.now,updated_at:f.s.now});
 const scope={orderId:String(f.s.orderId),archiveBatchId:String(batch),cutoffMs:cutoff},ownerLocks=new FulfillmentArchiveLockService({database:f.database}),salesLocks=new SalesArchiveLockService({database:f.database});
 const hints=await ownerLocks.discoverOrder(scope.orderId);
 const run=work=>f.run(null,async tx=>{await ownerLocks.lockOrderOperationsInTransaction(tx,scope.orderId);await salesLocks.lockOrderOperationsInTransaction(tx,{orderId:scope.orderId,shipmentIds:hints.shipments.map(s=>s.id)});await salesLocks.lockOrderRowsInTransaction(tx,scope.orderId);return work(tx);},{isolationLevel:"REPEATABLE READ"});
 // Test-only private dependency: proves the participant ABI/effect after real owner locks, never the production scheduler capability.
 const participant=new FulfillmentArchiveParticipant({database:f.database,time:{nowMs:()=>now},authorizeArchive:(tx,c)=>f.context.get()?.databaseTransaction===tx&&["orderId","archiveBatchId","cutoffMs"].every(k=>c[k]===scope[k])});
 return {...f,scope,now,run,rawRun:f.run,participant};
}
async function snapshot(f){const rows={};for(const {table}of FULFILLMENT_ARCHIVE_CONTRACTS)for(const suffix of ["","_archive"])rows[table+suffix]=(await f.db.query(`SELECT * FROM ${table+suffix} ORDER BY id`))[0];rows.operations=(await f.db.query("SELECT * FROM fulfillment_operation_requests ORDER BY id"))[0];rows.inventory=(await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0];return rows;}
test("Archive participant rejects bad shape or absent actual private scope before SQL",async()=>{
 let calls=0;const tx={query(){calls++;}},participant=new FulfillmentArchiveParticipant();
 await assert.rejects(()=>participant.prepareOrderInTransaction(tx,{orderId:1,archiveBatchId:"1",cutoffMs:1}),TypeError);
 await assert.rejects(()=>participant.prepareOrderInTransaction(tx,{orderId:"1",archiveBatchId:"1",cutoffMs:1}),{code:"FULFILLMENT_ARCHIVE_FORBIDDEN"});assert.equal(calls,0);
});
nativeTest("DEC029 prepare manifests all12 real owner classes without mutation or Inventory writes",async t=>{
 const f=await fixture(t),before=await snapshot(f);await f.run(async tx=>{
  const manifest=await f.participant.prepareOrderInTransaction(tx,f.scope);assert.equal(manifest.version,"1");assert.deepEqual(Object.keys(manifest.tableCounts),FULFILLMENT_ARCHIVE_CONTRACTS.map(c=>c.table));
  for(const {table}of FULFILLMENT_ARCHIVE_CONTRACTS){const expected=hashFulfillmentArchiveTable(table,before[table]);assert.equal(manifest.tableCounts[table],expected.count);assert.equal(manifest.hashSummary[table],expected.hash);assert.ok(expected.count>0,table);}
 });assert.deepEqual(await snapshot(f),before);
});
nativeTest("DEC029 all12 copy/readback/route/delete and pointer clearing roll back on a late caller failure",async t=>{
 const f=await fixture(t),before=await snapshot(f);await assert.rejects(()=>f.run(async tx=>{
  const expectedManifest=await f.participant.prepareOrderInTransaction(tx,f.scope),result=await f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest});assert.equal(result.outcome,"ARCHIVED");
  for(const {table}of FULFILLMENT_ARCHIVE_CONTRACTS){assert.equal(Number((await tx.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n),0,table);const [rows]=await tx.query(`SELECT * FROM ${table}_archive ORDER BY id`);assert.equal(rows.length,before[table].length);assert.equal(hashFulfillmentArchiveTable(table,rows).hash,expectedManifest.hashSummary[table]);for(const row of rows)assert.equal(row.row_hash,hashFulfillmentArchiveRow(table,row));}
  assert.deepEqual((await tx.query("SELECT * FROM fulfillment_operation_requests ORDER BY id"))[0],before.operations.map(row=>({...row,is_document_archived:1})));
  assert.equal((await tx.query("SELECT COUNT(*) AS n FROM sales_orders WHERE id=?",[f.s.orderId]))[0][0].n,1);throw new Error("Synthetic late Sales manifest/lease failure");
 }),error=>error.cause?.message==="Synthetic late Sales manifest/lease failure");assert.deepEqual(await snapshot(f),before);
});
nativeTest("DEC029 changed complete manifest refuses before owner writes",async t=>{
 const f=await fixture(t),before=await snapshot(f);await assert.rejects(()=>f.run(async tx=>{const expectedManifest=await f.participant.prepareOrderInTransaction(tx,f.scope);expectedManifest.hashSummary.fulfillments="a".repeat(64);await f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest});}),error=>error.cause?.code==="ARCHIVE_DATA_CONFLICT");assert.deepEqual(await snapshot(f),before);
});
nativeTest("DEC029 late mirror insert failure restores every earlier mirror and active class",async t=>{
 const f=await fixture(t),before=await snapshot(f);await f.db.query("CREATE TRIGGER test_archive_last_table BEFORE INSERT ON fulfillment_audit_logs_archive FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic late owner copy failure'");
 await assert.rejects(()=>f.run(async tx=>{const expectedManifest=await f.participant.prepareOrderInTransaction(tx,f.scope);await f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest});}));assert.deepEqual(await snapshot(f),before);
});

nativeTest("DEC029 private authorization lost after final owner delete still rolls back all owner effects",async t=>{
 const f=await fixture(t),before=await snapshot(f);let revoked=false;
 const participant=new FulfillmentArchiveParticipant({database:f.database,time:{nowMs:()=>f.now},authorizeArchive:(tx,c)=>!revoked&&f.context.get()?.databaseTransaction===tx&&c.orderId===f.scope.orderId&&c.archiveBatchId===f.scope.archiveBatchId&&c.cutoffMs===f.scope.cutoffMs});
 await assert.rejects(()=>f.run(async tx=>{const expectedManifest=await participant.prepareOrderInTransaction(tx,f.scope),execute=tx.execute.bind(tx);tx.execute=async(sql,args)=>{const result=await execute(sql,args);if(sql.startsWith("DELETE FROM fulfillments WHERE"))revoked=true;return result;};await participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest});}),error=>error.cause?.code==="FULFILLMENT_ARCHIVE_FORBIDDEN");assert.equal(revoked,true);assert.deepEqual(await snapshot(f),before);
});

async function fixtureCopySalesAndManifest(tx,f,owner){
 // Native fixture coordinator only: exercise full persisted replay facts, not a claim that the real scheduled coordinator exists.
 const counts={},hashes={},rowsByTable={};
 for(const [table,columns]of Object.entries(SALES_ARCHIVE_COLUMNS)){
  const select=columns.map(name=>["order_date","requested_delivery_date"].includes(name)?`DATE_FORMAT(${name},'%Y-%m-%d') AS ${name}`:name).join(",");
  const where=table==="sales_orders"?"id=?":table==="sales_audit_logs"?"target_type='SALES_ORDER' AND target_id=?":table==="sales_order_line_reservations"?"sales_order_line_id IN (SELECT id FROM sales_order_lines WHERE sales_order_id=?)":"sales_order_id=?";
  const [rows]=await tx.query(`SELECT ${select} FROM ${table} WHERE ${where} ORDER BY id LIMIT 500`,[f.s.orderId]);rowsByTable[table]=rows;const digest=await hashSalesArchiveRows(table,rows);counts[table]=digest.count;hashes[table]=digest.hash;
  for(const row of rows)await tx.execute(`INSERT INTO ${table}_archive (${columns.join(",")},archive_batch_id,archived_at,row_hash) SELECT ${columns.join(",")},?,?,? FROM ${table} WHERE id=?`,[f.scope.archiveBatchId,f.now,hashSalesArchiveRow(table,row),row.id]);
 }
 for(const table of Object.keys(SALES_ARCHIVE_COLUMNS).reverse())for(const row of rowsByTable[table])await tx.execute(`DELETE FROM ${table} WHERE id=?`,[row.id]);
 await tx.execute("INSERT INTO sales_archive_order_manifests(archive_batch_id,sales_order_id,sales_order_number,sales_table_counts,sales_hash_summary,fulfillment_table_counts,fulfillment_hash_summary,participant_versions,archived_at) VALUES (?,?,?,?,?,?,?,?,?)",[f.scope.archiveBatchId,f.s.orderId,rowsByTable.sales_orders[0].sales_order_number,JSON.stringify(counts),JSON.stringify(hashes),JSON.stringify(owner.tableCounts),JSON.stringify(owner.hashSummary),JSON.stringify({sales:"1",fulfillment:"1"}),f.now]);
}
nativeTest("DEC029 complete owner and Sales persisted facts replay without another write or Inventory effect",async t=>{
 const f=await fixture(t),inventory=(await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0];let expected;
 await f.run(async tx=>{expected=await f.participant.prepareOrderInTransaction(tx,f.scope);await f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest:expected});await fixtureCopySalesAndManifest(tx,f,expected);});
 const before=await snapshot(f);
 // Replay cannot acquire a deleted Active Sales row. This fresh actual RR is fixture-only; production private replay authorization remains to be integrated.
 await f.rawRun(null,async tx=>{const result=await f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest:expected});assert.equal(result.outcome,"REPLAYED");},{isolationLevel:"REPEATABLE READ"});
 assert.deepEqual(await snapshot(f),before);assert.deepEqual((await f.db.query("SELECT * FROM inventory_reservations ORDER BY id"))[0],inventory);
});

nativeTest("DEC029 non-null original Shipment DATE survives exact mirror hashing and native copy",async t=>{
 const f=await fixture(t,{shipmentDate:"2023-11-14"});await assert.rejects(()=>f.run(async tx=>{
  const expectedManifest=await f.participant.prepareOrderInTransaction(tx,f.scope);await f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest});const [[row]]=await tx.query("SELECT DATE_FORMAT(shipment_date,'%Y-%m-%d') AS shipment_date,row_hash FROM shipments_archive WHERE id=?",[f.shipment]);assert.equal(row.shipment_date,"2023-11-14");assert.match(row.row_hash,/^[0-9a-f]{64}$/u);throw new Error("Synthetic DATE rollback");
 }),error=>error.cause?.message==="Synthetic DATE rollback");
});

nativeTest("DEC029 actual bound RR without the private authorizer cannot mutate despite correct scope",async t=>{
 const f=await fixture(t),before=await snapshot(f),participant=new FulfillmentArchiveParticipant({database:f.database,time:{nowMs:()=>f.now}});await assert.rejects(()=>f.run(tx=>participant.prepareOrderInTransaction(tx,f.scope)),error=>error.cause?.code==="FULFILLMENT_ARCHIVE_FORBIDDEN");assert.deepEqual(await snapshot(f),before);
});
nativeTest("DEC029 unassigned in-progress business intent refuses owner Archive without writes",async t=>{
 const f=await fixture(t);await f.s.insert("fulfillment_operation_requests",{event_id:randomUUID(),operation_type:"CREATE",target_type:"FULFILLMENT",sales_order_id:f.s.orderId,payload_hash:"a".repeat(64),status:"IN_PROGRESS",lease_owner:"synthetic-owner",lease_expires_at:Date.now()+60000,attempt_count:1,correlation_id:randomUUID(),created_at:f.s.now,updated_at:f.s.now});const before=await snapshot(f);
 await assert.rejects(()=>f.run(tx=>f.participant.prepareOrderInTransaction(tx,f.scope)),error=>error.cause?.code==="FULFILLMENT_ARCHIVE_NOT_ELIGIBLE");assert.deepEqual(await snapshot(f),before);
});
nativeTest("DEC029 native mirror readback rejects a valid-shaped wrong row hash before active deletion",async t=>{
 const f=await fixture(t),before=await snapshot(f);let corrupted=false;
 await assert.rejects(()=>f.run(async tx=>{const expectedManifest=await f.participant.prepareOrderInTransaction(tx,f.scope),execute=tx.execute.bind(tx);tx.execute=(sql,args)=>{if(sql.startsWith("INSERT INTO fulfillments_archive ")){args=[...args];args[3]="b".repeat(64);corrupted=true;}return execute(sql,args);};await f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest});}),error=>error.cause?.code==="ARCHIVE_DATA_CONFLICT");assert.equal(corrupted,true);assert.deepEqual(await snapshot(f),before);
});
nativeTest("DEC029 foreign-batch preexisting mirrors do not imply replay or permit overwrite",async t=>{
 const f=await fixture(t),other=await f.s.insert("sales_archive_batches",{batch_number:"FOREIGN-SYNTHETIC",period_key:"202609",cutoff_at:f.scope.cutoffMs,status:"RUNNING",started_at:f.now,updated_at:f.now}),columns=Object.keys(FULFILLMENT_ARCHIVE_CONTRACTS[0].columns),[[row]]=await f.db.query("SELECT * FROM fulfillments WHERE id=?",[f.doc.id]);await f.db.execute(`INSERT INTO fulfillments_archive (${columns.join(",")},archive_batch_id,archived_at,row_hash) SELECT ${columns.join(",")},?,?,? FROM fulfillments WHERE id=?`,[other,f.now,hashFulfillmentArchiveRow("fulfillments",row),f.doc.id]);const before=await snapshot(f);
 await assert.rejects(()=>f.run(async tx=>{const expectedManifest=await f.participant.prepareOrderInTransaction(tx,f.scope);await f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest});}),error=>error.cause?.code==="ARCHIVE_DATA_CONFLICT");assert.deepEqual(await snapshot(f),before);
});

nativeTest("DEC029 participant copies and explicitly deletes504 mixed owner Audit rows across500 batches before caller rollback",async t=>{
 const f=await fixture(t),[[reversal]]=await f.db.query("SELECT id FROM shipment_reversals WHERE shipment_id=?",[f.shipment]);const rows=[["SHIPMENT",f.shipment],["REVERSAL",reversal.id],...Array.from({length:501},()=>["FULFILLMENT",f.doc.id])].map(([type,id])=>[type,id,"RECONCILE",randomUUID(),"Synthetic",f.s.now]);await f.db.query("INSERT INTO fulfillment_audit_logs(target_type,target_id,action,correlation_id,actor_label,occurred_at) VALUES ?",[rows]);const before=await snapshot(f),copied=[],deleted=[];
 await assert.rejects(()=>f.run(async tx=>{const execute=tx.execute.bind(tx);tx.execute=async(sql,args)=>{const result=await execute(sql,args);if(sql.startsWith("INSERT INTO fulfillment_audit_logs_archive "))copied.push(Number(result[0].affectedRows));if(sql.startsWith("DELETE FROM fulfillment_audit_logs WHERE"))deleted.push(Number(result[0].affectedRows));return result;};const expectedManifest=await f.participant.prepareOrderInTransaction(tx,f.scope);assert.equal(expectedManifest.tableCounts.fulfillment_audit_logs,504);await f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest});assert.deepEqual(copied,[500,4]);assert.deepEqual(deleted,[500,4]);throw new Error("Synthetic paged owner rollback");}),error=>error.cause?.message==="Synthetic paged owner rollback");assert.deepEqual(await snapshot(f),before);
});

async function seedIdenticalMirrors(f,full){for(const {table,columns}of FULFILLMENT_ARCHIVE_CONTRACTS.slice(0,full?12:1)){const names=Object.keys(columns),[rows]=await f.db.query(`SELECT ${names.join(",")} FROM ${table} ORDER BY id LIMIT 500`);for(const row of rows)await f.db.execute(`INSERT INTO ${table}_archive (${names.join(",")},archive_batch_id,archived_at,row_hash) SELECT ${names.join(",")},?,?,? FROM ${table} WHERE id=?`,[f.scope.archiveBatchId,f.now,hashFulfillmentArchiveRow(table,row),row.id]);}}
for(const full of [false,true])nativeTest(`DEC029 identical ${full?"full":"partial"} owner mirrors resume missing copy and cleanup without overwrite`,async t=>{
 const f=await fixture(t);await seedIdenticalMirrors(f,full);const before=await snapshot(f);
 await assert.rejects(()=>f.run(async tx=>{const expectedManifest=await f.participant.prepareOrderInTransaction(tx,f.scope),result=await f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest});assert.equal(result.outcome,"ARCHIVED");for(const {table}of FULFILLMENT_ARCHIVE_CONTRACTS){const [rows]=await tx.query(`SELECT * FROM ${table}_archive ORDER BY id`);assert.equal(hashFulfillmentArchiveTable(table,rows).hash,expectedManifest.hashSummary[table]);assert.equal(Number((await tx.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n),0);}throw new Error("Synthetic resumed owner rollback");}),error=>error.cause?.message==="Synthetic resumed owner rollback");assert.deepEqual(await snapshot(f),before);
});
for(const table of ["fulfillments","shipments"])nativeTest(`DEC029 locked ${table} exact owner retention cutoff is not eligible`,async t=>{
 const f=await fixture(t),id=table==="fulfillments"?f.doc.id:f.shipment;await f.db.execute(`UPDATE ${table} SET last_business_updated_at=?,version=version+1 WHERE id=?`,[f.scope.cutoffMs,id]);const before=await snapshot(f);await assert.rejects(()=>f.run(tx=>f.participant.prepareOrderInTransaction(tx,f.scope)),error=>error.cause?.code==="FULFILLMENT_ARCHIVE_NOT_ELIGIBLE");assert.deepEqual(await snapshot(f),before);
});

nativeTest("DEC029 durable replay refuses residual polymorphic Active Audit behind archived roots",async t=>{
 const f=await fixture(t);let expected;
 await f.run(async tx=>{expected=await f.participant.prepareOrderInTransaction(tx,f.scope);await f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest:expected});await fixtureCopySalesAndManifest(tx,f,expected);});
 await f.s.insert("fulfillment_audit_logs",{target_type:"FULFILLMENT",target_id:f.doc.id,action:"RECONCILE",correlation_id:randomUUID(),actor_label:"Synthetic residual audit",occurred_at:f.now});const before=await snapshot(f);
 await assert.rejects(()=>f.rawRun(null,tx=>f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest:expected}),{isolationLevel:"REPEATABLE READ"}),error=>error.cause?.code==="ARCHIVE_DATA_CONFLICT");assert.deepEqual(await snapshot(f),before);
});

nativeTest("DEC029 foreign-order same original mirror ID is an Archive conflict preserving both scopes",async t=>{
 const f=await fixture(t),other=await seedFulfillmentSalesOrder(f.db),columns=Object.keys(FULFILLMENT_ARCHIVE_CONTRACTS[0].columns),[[row]]=await f.db.query("SELECT * FROM fulfillments WHERE id=?",[f.doc.id]);row.sales_order_id=other.orderId;row.customer_id=other.customerId;row.warehouse_id=other.warehouseId;
 const serialized=columns.map(name=>row[name]);await f.db.execute(`INSERT INTO fulfillments_archive (${columns.join(",")},archive_batch_id,archived_at,row_hash) VALUES (${[...columns,"archive_batch_id","archived_at","row_hash"].map(()=>"?").join(",")})`,[...serialized,f.scope.archiveBatchId,f.now,hashFulfillmentArchiveRow("fulfillments",row)]);const before=await snapshot(f);
 await assert.rejects(()=>f.run(async tx=>{const expectedManifest=await f.participant.prepareOrderInTransaction(tx,f.scope);await f.participant.archiveOrderInTransaction(tx,{...f.scope,archivedAtMs:f.now,expectedManifest});}),error=>error.cause?.code==="ARCHIVE_DATA_CONFLICT");assert.deepEqual(await snapshot(f),before);assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM sales_orders WHERE id=?",[other.orderId]))[0][0].n),1);
});
