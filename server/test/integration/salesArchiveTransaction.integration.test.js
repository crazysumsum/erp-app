import assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {archiveFactsFixture} from "../fulfillment/archiveFactsFixture.js";
import {SalesArchiveService} from "../../src/modules/sales/SalesArchiveService.js";
import {SalesArchiveLockService} from "../../src/modules/sales/SalesArchiveLockService.js";
import {FulfillmentArchiveLockService} from "../../src/modules/fulfillment/FulfillmentArchiveLockService.js";
import {FulfillmentArchiveParticipant} from "../../src/modules/fulfillment/FulfillmentArchiveParticipant.js";
import {FulfillmentOpenMatterService} from "../../src/modules/fulfillment/FulfillmentOpenMatterService.js";
import {SALES_ARCHIVE_COLUMNS,hashSalesArchiveRow} from "../../src/modules/sales/salesArchiveHash.js";
import {FULFILLMENT_ARCHIVE_CONTRACTS} from "../../src/modules/fulfillment/fulfillmentArchiveSchema.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function fixture(t,{route=null}={}){
 const f=await archiveFactsFixture(t,{shipmentDate:"2023-11-14"});await promisify(execFile)(process.execPath,[fileURLToPath(new URL("../../scripts/migrate.js",import.meta.url))],{env:{...process.env,DB_NAME:f.f.name,DB_USER:f.f.connectionOptions.user,DB_PASSWORD:f.f.connectionOptions.password},timeout:180000,maxBuffer:1024*1024});
 const now=Date.now(),cutoff=now-86400000,batch=await f.s.insert("sales_archive_batches",{batch_number:"SYNTHETIC-SALES-TRANSACTION",period_key:"202610",cutoff_at:cutoff,status:"RUNNING",started_at:now,updated_at:now}),command={orderId:String(f.s.orderId),archiveBatchId:String(batch),cutoffMs:cutoff,archivedAtMs:now};
 const [[line]]=await f.db.query("SELECT * FROM sales_order_lines WHERE sales_order_id=?",[f.s.orderId]);await f.s.insert("sales_backorder_entries",{sales_order_id:f.s.orderId,sales_order_line_id:line.id,line_no:1,warehouse_id:f.s.warehouseId,sku_id:line.sku_id,outstanding_base_quantity:0,status:"CANCELLED",priority_at:f.s.now,next_attempt_at:f.s.now,created_at:f.s.now,updated_at:f.s.now});
 if(route==="CHANNEL"){
  const key=await f.s.insert("sales_external_order_keys",{channel_code:"SYNTHETIC",external_order_id:"synthetic-"+f.s.orderId,external_order_id_hash:Buffer.alloc(32,1),source_type:"CHANNEL",payload_hash:"a".repeat(64),status:"SUCCEEDED",sales_order_id:f.s.orderId,sales_order_number:(await f.db.query("SELECT sales_order_number FROM sales_orders WHERE id=?",[f.s.orderId]))[0][0].sales_order_number,claimed_at:f.s.now,updated_at:f.s.now});await f.db.execute("UPDATE sales_orders SET source_type='CHANNEL',external_order_key_id=? WHERE id=?",[key,f.s.orderId]);f.routeKey=key;
 }
 if(route==="QUOTATION"){
  const [[order]]=await f.db.query("SELECT * FROM sales_orders WHERE id=?",[f.s.orderId]),quotation=await f.s.insert("sales_quotations",{quotation_number:"QT-SYNTHETIC",status:"CONVERTED",customer_id:order.customer_id,customer_code_snapshot:order.customer_code_snapshot,customer_name_snapshot:order.customer_name_snapshot,currency_code:order.currency_code,quotation_date:"2023-11-14",valid_until:"2023-12-14",line_count:1,total_amount:"1.0000",created_at:f.s.now,updated_at:f.s.now,last_business_updated_at:f.s.now});f.conversionId=await f.s.insert("sales_quotation_conversions",{quotation_id:quotation,sales_order_id:f.s.orderId,sales_order_number_snapshot:order.sales_order_number,difference_summary:JSON.stringify({}),difference_hash:"a".repeat(64),event_id:randomUUID(),converted_at:f.s.now});await f.db.execute("UPDATE sales_orders SET source_type='QUOTATION',source_quotation_id=? WHERE id=?",[quotation,f.s.orderId]);f.quotationId=quotation;
 }
 const scopes=new WeakMap(),authorize=(tx,scope)=>scopes.get(tx)===command&&f.context.get()?.databaseTransaction===tx&&scope.orderId===command.orderId&&scope.archiveBatchId===command.archiveBatchId&&scope.cutoffMs===command.cutoffMs;
 const participant=new FulfillmentArchiveParticipant({database:f.database,time:{nowMs:()=>now},authorizeArchive:authorize}),openMatter=new FulfillmentOpenMatterService({database:f.database,authorizeArchiveRead:(tx,s)=>scopes.get(tx)===command&&s.orderId===command.orderId&&s.atMs===now}),sales=new SalesArchiveService({database:f.database,authorizeArchive:authorize,openMatter,participant}),ownerLocks=new FulfillmentArchiveLockService({database:f.database}),salesLocks=new SalesArchiveLockService({database:f.database});
 // Test-only private authorizer. This proves the real Sales/owner transaction, not actual Scheduler admission.
 const run=async(work,{beforeLocks}={})=>{const hints=await ownerLocks.discoverOrder(command.orderId),routing=await salesLocks.discoverOrderRouting(command.orderId);return f.run(null,async tx=>{await beforeLocks?.(tx);await ownerLocks.lockOrderOperationsInTransaction(tx,command.orderId);await salesLocks.lockOrderOperationsInTransaction(tx,{orderId:command.orderId,shipmentIds:hints.shipments.map(s=>s.id)});await salesLocks.lockOrderRoutingInTransaction(tx,routing);const [[active]]=await tx.query("SELECT id FROM sales_orders WHERE id=? FOR UPDATE",[command.orderId]);if(active){const locked=await salesLocks.lockOrderRowsInTransaction(tx,command.orderId);salesLocks.assertOrderRouting(locked.header,routing);}assert.deepEqual(await ownerLocks.readOrderMembershipInTransaction(tx,command.orderId),hints);scopes.set(tx,command);try{return await work(tx,sales);}finally{scopes.delete(tx);}},{isolationLevel:"REPEATABLE READ"});};
 return {...f,command,sales,run,rawRun:f.run};
}
async function snapshot(f){const result={};for(const table of [...Object.keys(SALES_ARCHIVE_COLUMNS),...FULFILLMENT_ARCHIVE_CONTRACTS.map(c=>c.table)])for(const suffix of ["","_archive"])result[table+suffix]=(await f.db.query(`SELECT * FROM ${table+suffix} ORDER BY id`))[0];for(const table of ["sales_archive_order_manifests","fulfillment_operation_requests","inventory_reservations","inventory_stock_balances","inventory_movements"])result[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return result;}
nativeTest("P4 real Sales and Fulfillment all18 table move commits and replays without Inventory effects",async t=>{
 const f=await fixture(t),before=await snapshot(f);const result=await f.run((tx,sales)=>sales.archiveOrderInTransaction(tx,f.command));assert.equal(result.outcome,"ARCHIVED");
 for(const table of [...Object.keys(SALES_ARCHIVE_COLUMNS),...FULFILLMENT_ARCHIVE_CONTRACTS.map(c=>c.table)]){assert.ok(before[table].length,table);assert.equal(Number((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n),0,table);assert.equal(Number((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}_archive`))[0][0].n),before[table].length,table);}
 const after=await snapshot(f);for(const table of ["inventory_reservations","inventory_stock_balances","inventory_movements"])assert.deepEqual(after[table],before[table],table);
 assert.ok(after.sales_audit_logs_archive.every(r=>r.target_type==="ORDER"));assert.equal(after.sales_archive_order_manifests.length,1);const manifest=after.sales_archive_order_manifests[0];assert.deepEqual(manifest.sales_table_counts,result.tableCounts);assert.deepEqual(manifest.sales_hash_summary,result.hashSummary);
 assert.equal((await f.run((tx,sales)=>sales.archiveOrderInTransaction(tx,{...f.command,archivedAtMs:f.command.archivedAtMs+1}))).outcome,"REPLAYED");assert.deepEqual(await snapshot(f),after);
});
nativeTest("P4 late Sales manifest failure rolls back all18 classes and Inventory remains unchanged",async t=>{
 const f=await fixture(t);await f.db.query("CREATE TRIGGER test_sales_manifest_late BEFORE INSERT ON sales_archive_order_manifests FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic late Sales manifest failure'");const before=await snapshot(f);await assert.rejects(()=>f.run((tx,sales)=>sales.archiveOrderInTransaction(tx,f.command)));assert.deepEqual(await snapshot(f),before);
});
nativeTest("P4 real Sales partial identical mirrors recover only complete Active source",async t=>{
 const f=await fixture(t),columns=SALES_ARCHIVE_COLUMNS.sales_orders,[[row]]=await f.db.query("SELECT "+columns.map(c=>["order_date","requested_delivery_date"].includes(c)?`DATE_FORMAT(${c},'%Y-%m-%d') AS ${c}`:c).join(",")+" FROM sales_orders WHERE id=?",[f.s.orderId]);await f.db.execute(`INSERT INTO sales_orders_archive (${columns.join(",")},archive_batch_id,archived_at,row_hash) SELECT ${columns.join(",")},?,?,? FROM sales_orders WHERE id=?`,[f.command.archiveBatchId,f.command.archivedAtMs,hashSalesArchiveRow("sales_orders",row),f.s.orderId]);assert.equal((await f.run((tx,sales)=>sales.archiveOrderInTransaction(tx,f.command))).outcome,"ARCHIVED");
});
nativeTest("P4 Sales conflicting immutable hash leaves all Active and owner bytes intact",async t=>{
 const f=await fixture(t),columns=SALES_ARCHIVE_COLUMNS.sales_orders;await f.db.execute(`INSERT INTO sales_orders_archive (${columns.join(",")},archive_batch_id,archived_at,row_hash) SELECT ${columns.join(",")},?,?,? FROM sales_orders WHERE id=?`,[f.command.archiveBatchId,f.command.archivedAtMs,"b".repeat(64),f.s.orderId]);const before=await snapshot(f);await assert.rejects(()=>f.run((tx,sales)=>sales.archiveOrderInTransaction(tx,f.command)),e=>e.cause?.code==="ARCHIVE_DATA_CONFLICT");assert.deepEqual(await snapshot(f),before);
});

nativeTest("P4 real CHANNEL routing moves atomically and durable replay refuses a reset route flag",async t=>{
 const f=await fixture(t,{route:"CHANNEL"});await f.run((tx,sales)=>sales.archiveOrderInTransaction(tx,f.command));assert.equal(Number((await f.db.query("SELECT is_order_archived FROM sales_external_order_keys WHERE id=?",[f.routeKey]))[0][0].is_order_archived),1);await f.db.execute("UPDATE sales_external_order_keys SET is_order_archived=0 WHERE id=?",[f.routeKey]);const before=await snapshot(f);await assert.rejects(()=>f.run((tx,sales)=>sales.archiveOrderInTransaction(tx,f.command)),e=>e.cause?.code==="ARCHIVE_DATA_CONFLICT");assert.deepEqual(await snapshot(f),before);
});
nativeTest("P4 durable Sales manifest number must match immutable verified archived header",async t=>{
 const f=await fixture(t);await f.run((tx,sales)=>sales.archiveOrderInTransaction(tx,f.command));await f.db.execute("UPDATE sales_archive_order_manifests SET sales_order_number='SO-WRONG-SYNTHETIC' WHERE sales_order_id=?",[f.s.orderId]);await assert.rejects(()=>f.run((tx,sales)=>sales.archiveOrderInTransaction(tx,f.command)),e=>e.cause?.code==="ARCHIVE_DATA_CONFLICT");
});
nativeTest("P4 real QUOTATION conversion archive routing is retained on exact replay",async t=>{
 const f=await fixture(t,{route:"QUOTATION"});await f.run((tx,sales)=>sales.archiveOrderInTransaction(tx,f.command));assert.equal(Number((await f.db.query("SELECT is_order_archived FROM sales_quotation_conversions WHERE id=?",[f.conversionId]))[0][0].is_order_archived),1);assert.equal((await f.run((tx,sales)=>sales.archiveOrderInTransaction(tx,f.command))).outcome,"REPLAYED");
});
nativeTest("P4 Sales Audit501 extra rows copy and delete across500 boundaries and late rollback retains all",async t=>{
 const f=await fixture(t),rows=Array.from({length:501},()=>[f.s.now,"Synthetic","sales_order.read","ORDER",f.s.orderId,"SUCCESS",randomUUID()]);await f.db.query("INSERT INTO sales_audit_logs(occurred_at,actor_label,action,target_type,target_id,outcome,event_id) VALUES ?",[rows]);const before=await snapshot(f),copied=[],deleted=[];await assert.rejects(()=>f.run(async(tx,sales)=>{const execute=tx.execute.bind(tx);tx.execute=async(sql,args)=>{const result=await execute(sql,args);if(sql.startsWith("INSERT INTO sales_audit_logs_archive "))copied.push(Number(result[0].affectedRows));if(sql.startsWith("DELETE FROM sales_audit_logs WHERE"))deleted.push(Number(result[0].affectedRows));return result;};await sales.archiveOrderInTransaction(tx,f.command);assert.equal(copied.length,2);assert.equal(copied[0],500);assert.equal(deleted.length,2);assert.equal(deleted[0],500);throw new Error("Synthetic paged Sales rollback");}),e=>e.cause?.message==="Synthetic paged Sales rollback");assert.deepEqual(await snapshot(f),before);
});

nativeTest("P4 Quotation conversion replay holding its row and Archive finish without a root/routing deadlock",async t=>{
 const f=await fixture(t,{route:"QUOTATION"});let ready,advance,entered;const locked=new Promise(r=>{ready=r;}),resume=new Promise(r=>{advance=r;}),waiting=new Promise(r=>{entered=r;});
 const replay=f.rawRun(null,async tx=>{await tx.query("SELECT sales_order_id FROM sales_quotation_conversions WHERE quotation_id=? FOR UPDATE",[f.quotationId]);ready();await resume;const [[order]]=await tx.query("SELECT id FROM sales_orders WHERE id=? LOCK IN SHARE MODE",[f.s.orderId]);assert.equal(String(order.id),f.command.orderId);});await locked;
 const archive=f.run((tx,sales)=>sales.archiveOrderInTransaction(tx,f.command),{beforeLocks(tx){const query=tx.query.bind(tx);tx.query=(sql,args)=>{if(sql.startsWith("SELECT quotation_id,sales_order_id FROM sales_quotation_conversions WHERE id=? FOR UPDATE"))entered();return query(sql,args);};}});
 await Promise.race([waiting,archive.then(()=>{throw new Error("Archive did not acquire the canonical early conversion lock");})]);advance();await Promise.all([replay,archive]);assert.equal(Number((await f.db.query("SELECT is_order_archived FROM sales_quotation_conversions WHERE id=?",[f.conversionId]))[0][0].is_order_archived),1);
});
