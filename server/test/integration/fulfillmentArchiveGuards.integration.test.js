import assert from "node:assert/strict";
import test from "node:test";
import mysql from "mysql2/promise";
import {randomUUID} from "node:crypto";
import {fixture,document} from "../fulfillment/aggregateFixture.js";
import {up as shipmentUp} from "../../database/migrations/0096_create_shipments.js";
import {up as factsUp} from "../../database/migrations/0097_create_shipment_issues_and_reversals.js";
import {up as auditUp} from "../../database/migrations/0098_create_fulfillment_audit_and_exports.js";
import {up as archiveUp,FULFILLMENT_ARCHIVE_TABLES} from "../../database/migrations/0099_create_fulfillment_archives.js";
import {up as guardsUp} from "../../database/migrations/0102_protect_fulfillment_archive_contracts.js";
import {inspectFulfillmentArchiveProtection} from "../../src/modules/fulfillment/fulfillmentArchiveProtectionSchema.js";
import {hashFulfillmentArchiveRow} from "../../src/modules/fulfillment/fulfillmentArchiveSchema.js";
const native=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function setup(t){const f=await fixture(t);for(const up of [shipmentUp,factsUp,auditUp,archiveUp])await up(f.db);return f;}
async function batch(f,period="202610"){return f.s.insert("sales_archive_batches",{batch_number:"GUARD-"+randomUUID().slice(0,12),period_key:period,cutoff_at:f.s.now,status:"RUNNING",started_at:f.s.now,updated_at:f.s.now});}
async function copy(f,table,id,batchId){const [[row]]=await f.db.query(`SELECT * FROM ${table} WHERE id=?`,[id]),columns=Object.keys(FULFILLMENT_ARCHIVE_TABLES.find(c=>c.table===table+"_archive").columns).filter(name=>!["archive_batch_id","archived_at","row_hash"].includes(name));await f.db.execute(`INSERT INTO ${table}_archive (${columns.join(",")},archive_batch_id,archived_at,row_hash) SELECT ${columns.join(",")},?,?,? FROM ${table} WHERE id=?`,[batchId,f.s.now,hashFulfillmentArchiveRow(table,row),id]);return row;}
const signalled=e=>(e.cause?.code??e.code)==="ER_SIGNAL_EXCEPTION";
native("DEC029 forward storage upgrade reruns and requires exact mirrors before explicit leaf deletes",async t=>{
 const f=await setup(t),doc=await document(f);await guardsUp(f.db);await guardsUp(f.db);assert.equal(await inspectFulfillmentArchiveProtection(f.db),true);
 await assert.rejects(f.db.execute("DELETE FROM fulfillment_lines WHERE id=?",[doc.line]),signalled);const b=await batch(f);await copy(f,"fulfillments",doc.id,b);await copy(f,"fulfillment_lines",doc.line,b);
 await assert.rejects(f.db.execute("DELETE FROM fulfillments WHERE id=?",[doc.id]),signalled);await f.db.execute("DELETE FROM fulfillment_lines WHERE id=?",[doc.line]);await f.db.execute("DELETE FROM fulfillments WHERE id=?",[doc.id]);
 assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM fulfillments_archive"))[0][0].n,1);
});
native("DEC029 byte-sensitive snapshot mismatch refuses deletion despite case-insensitive business collation",async t=>{
 const f=await setup(t),doc=await document(f),b=await batch(f);await guardsUp(f.db);await copy(f,"fulfillments",doc.id,b);const [[row]]=await f.db.query("SELECT * FROM fulfillment_lines WHERE id=?",[doc.line]);const changed={...row,sku_name_snapshot:row.sku_name_snapshot.toLowerCase()};assert.notEqual(changed.sku_name_snapshot,row.sku_name_snapshot);await f.s.insert("fulfillment_lines_archive",{...changed,archive_batch_id:b,archived_at:f.s.now,row_hash:hashFulfillmentArchiveRow("fulfillment_lines",changed)});await assert.rejects(f.db.execute("DELETE FROM fulfillment_lines WHERE id=?",[doc.line]),signalled);
});
native("DEC029 a real older RR snapshot cannot hide a committed CASCADE child from parent DELETE",async t=>{
 const f=await setup(t),doc=await document(f),b=await batch(f);await guardsUp(f.db);await copy(f,"fulfillments",doc.id,b);const original=await copy(f,"fulfillment_lines",doc.line,b);await f.db.execute("DELETE FROM fulfillment_lines WHERE id=?",[doc.line]);
 const reader=await mysql.createConnection({...f.f.connectionOptions,database:f.f.name});try{await reader.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");await reader.beginTransaction();assert.equal((await reader.query("SELECT COUNT(*) AS n FROM fulfillment_lines"))[0][0].n,0);const {id:_id,...child}=original;const inserted=await f.s.insert("fulfillment_lines",child);await assert.rejects(reader.execute("DELETE FROM fulfillments WHERE id=?",[doc.id]),signalled);assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM fulfillment_lines WHERE id=?",[inserted]))[0][0].n,1);await reader.rollback();}finally{await reader.end();}
});
native("DEC029 missing original append-only guard never creates an unprotected replacement window",async t=>{
 const f=await setup(t),doc=await document(f),history=await f.s.insert("fulfillment_status_history",{fulfillment_id:doc.id,sequence_no:1,to_status:"DRAFT",action:"CREATE",event_id:randomUUID(),version_after:1,actor_label:"Synthetic",occurred_at:f.s.now});
 let injected=false;const tx={query:async(sql,args)=>{if(!injected&&sql==="DROP TRIGGER trg_ful_history_delete"){injected=true;throw new Error("Synthetic replacement interruption");}return f.db.query(sql,args);},execute:(...args)=>f.db.execute(...args)};
 await assert.rejects(guardsUp(tx),/Synthetic replacement interruption/u);assert.equal(injected,true);await assert.rejects(f.db.execute("DELETE FROM fulfillment_status_history WHERE id=?",[history]),signalled);await guardsUp(f.db);assert.equal(await inspectFulfillmentArchiveProtection(f.db),true);
});
native("DEC029 all twelve mirrors retain UPDATE and DELETE guards after owner FK upgrade",async t=>{
 const f=await setup(t);await guardsUp(f.db);const b=await batch(f),order=["fulfillments","fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_allocations","fulfillment_status_history","shipments","shipment_lines","shipment_issue_details","shipment_status_history","shipment_reversals","shipment_reversal_details","fulfillment_audit_logs"];
 // Typed synthetic mirror rows exercise storage immutability only; no genuine Archive outcome or eligibility is claimed.
 for(const name of order){const c=FULFILLMENT_ARCHIVE_TABLES.find(v=>v.table===name+"_archive"),row={};for(const [column,[type,nullable=false]]of Object.entries(c.columns))row[column]=nullable?null:type==="json"?JSON.stringify({}):type==="date"?"2020-01-01":/^(?:var)?char\(/u.test(type)?"S":"1";Object.assign(row,{archive_batch_id:b,archived_at:f.s.now,row_hash:"a".repeat(64)});await f.s.insert(c.table,row);}
 for(const c of FULFILLMENT_ARCHIVE_TABLES){await assert.rejects(f.db.execute(`UPDATE ${c.table} SET row_hash=? WHERE id=1`,["b".repeat(64)]),signalled);await assert.rejects(f.db.execute(`DELETE FROM ${c.table} WHERE id=1`),signalled);assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${c.table}`))[0][0].n,1);}
});
async function pickedShipment(f){
 const doc=await document(f);await f.db.execute("UPDATE fulfillment_lines SET allocated_base_quantity=1,picked_base_quantity=1,version=version+1 WHERE id=?",[doc.line]);for(const status of ["PICKING","PICKED"])await f.db.execute("UPDATE fulfillments SET status=?,version=version+1 WHERE id=?",[status,doc.id]);
 const shipment=await f.s.insert("shipments",{shipment_number:"SHP-202610-000001",fulfillment_id:doc.id,sales_order_id:f.s.orderId,customer_id:f.s.customerId,warehouse_id:f.s.warehouseId,shipping_address_id:f.s.addressId,shipping_address_version:1,line_count:1,last_business_updated_at:f.s.now,created_at:f.s.now,updated_at:f.s.now});
 const line=await f.s.insert("shipment_lines",{shipment_id:shipment,fulfillment_id:doc.id,fulfillment_line_id:doc.line,line_no:1,sales_order_line_id:f.s.lineId,sku_id:f.s.skuId,base_uom_id:f.s.uomId,sku_code_snapshot:"SYN",sku_name_snapshot:"Synthetic",base_uom_code_snapshot:"EA",shipped_base_quantity:1,created_at:f.s.now,updated_at:f.s.now});
 await f.db.execute("UPDATE fulfillments SET active_shipment_id=?,version=version+1 WHERE id=?",[shipment,doc.id]);return {...doc,shipment,shipmentLine:line};
}
async function snapshots(f,d,b){await copy(f,"fulfillments",d.id,b);await copy(f,"fulfillment_lines",d.line,b);await copy(f,"shipments",d.shipment,b);await copy(f,"shipment_lines",d.shipmentLine,b);}
async function deleteStorageTree(f,d){await f.db.execute("UPDATE fulfillments SET active_shipment_id=NULL WHERE id=?",[d.id]);for(const [table,id]of [["shipment_lines",d.shipmentLine],["shipments",d.shipment],["fulfillment_lines",d.line],["fulfillments",d.id]])await f.db.execute(`DELETE FROM ${table} WHERE id=?`,[id]);}
native("DEC029 exact technical pointer clear preserves original pointer/version and permits explicit reverse-topology storage deletion",async t=>{
 const f=await setup(t);await guardsUp(f.db);const d=await pickedShipment(f),b=await batch(f),[[before]]=await f.db.query("SELECT * FROM fulfillments WHERE id=?",[d.id]);await snapshots(f,d,b);
 await f.db.execute("UPDATE fulfillments SET active_shipment_id=NULL WHERE id=?",[d.id]);const [[after]]=await f.db.query("SELECT * FROM fulfillments WHERE id=?",[d.id]);assert.deepEqual(after,{...before,active_shipment_id:null});assert.equal(String((await f.db.query("SELECT active_shipment_id FROM fulfillments_archive WHERE id=?",[d.id]))[0][0].active_shipment_id),String(d.shipment));
 for(const [table,id]of [["shipment_lines",d.shipmentLine],["shipments",d.shipment],["fulfillment_lines",d.line],["fulfillments",d.id]])await f.db.execute(`DELETE FROM ${table} WHERE id=?`,[id]);assert.equal(await inspectFulfillmentArchiveProtection(f.db),true);
});
native("DEC029 pointer exception rejects absent snapshots, other field changes and cross-batch pointer proof",async t=>{
 const f=await setup(t);await guardsUp(f.db);const d=await pickedShipment(f);await assert.rejects(f.db.execute("UPDATE fulfillments SET active_shipment_id=NULL WHERE id=?",[d.id]),signalled);
 const b=await batch(f);await snapshots(f,d,b);
 for(const change of ["notes='Changed'","last_business_updated_at=last_business_updated_at+1","version=version-1","status='CANCELLED'"])await assert.rejects(f.db.execute(`UPDATE fulfillments SET active_shipment_id=NULL,${change} WHERE id=?`,[d.id]),signalled);
 const f2=await setup(t);await guardsUp(f2.db);const d2=await pickedShipment(f2),a=await batch(f2),other=await batch(f2,"202611");await copy(f2,"fulfillments",d2.id,a);await copy(f2,"shipments",d2.shipment,other);await assert.rejects(f2.db.execute("UPDATE fulfillments SET active_shipment_id=NULL WHERE id=?",[d2.id]),signalled);
});
native("DEC029 ordinary business updates retain the complete original version and transition rules",async t=>{
 const f=await setup(t);await guardsUp(f.db);const d=await pickedShipment(f),[[before]]=await f.db.query("SELECT version FROM fulfillments WHERE id=?",[d.id]);
 // The original business path may clear its pointer with a real version increment; this is not the technical Archive exception.
 await f.db.execute("UPDATE fulfillments SET active_shipment_id=NULL,version=version+1 WHERE id=?",[d.id]);assert.equal(Number((await f.db.query("SELECT version FROM fulfillments WHERE id=?",[d.id]))[0][0].version),Number(before.version)+1);
 await assert.rejects(f.db.execute("UPDATE fulfillments SET notes='No version change' WHERE id=?",[d.id]),signalled);await assert.rejects(f.db.execute("UPDATE fulfillments SET status='DRAFT',version=version+1 WHERE id=?",[d.id]),signalled);
});
native("DEC029 late storage transaction failure restores copied mirrors, pointer and explicitly deleted Active rows",async t=>{
 const f=await setup(t);await guardsUp(f.db);const d=await pickedShipment(f),b=await batch(f),tables=["fulfillments","fulfillment_lines","shipments","shipment_lines",...FULFILLMENT_ARCHIVE_TABLES.map(c=>c.table)],state=async()=>{const rows={};for(const table of tables)rows[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];return rows;},before=await state();
 await f.db.beginTransaction();try{await snapshots(f,d,b);await deleteStorageTree(f,d);throw new Error("Synthetic late storage failure");}catch(error){await f.db.rollback();assert.equal(error.message,"Synthetic late storage failure");}
 assert.deepEqual(await state(),before);
});
for(const stage of ["new-trigger-created","mirror-fk-created"])native(`DEC029 exact forward guard installation resumes after ${stage} implicit-commit fault`,async t=>{
 const f=await setup(t);let injected=false;const tx={query:async(sql,args)=>{const result=await f.db.query(sql,args);if(!injected&&(stage==="new-trigger-created"?sql.startsWith("CREATE TRIGGER trg_archive_fulfillment_status_history_delete"):sql.startsWith("ALTER TABLE fulfillment_lines_archive ADD CONSTRAINT"))){injected=true;throw new Error("Synthetic forward DDL interruption");}return result;},execute:(...args)=>f.db.execute(...args)};
 await assert.rejects(guardsUp(tx),/Synthetic forward DDL interruption/u);assert.equal(injected,true);const [guards]=await f.db.query("SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table='fulfillment_status_history' AND event_manipulation='DELETE'");assert.ok(guards.some(r=>r.name==="trg_ful_history_delete"));assert.ok(guards.some(r=>r.name==="trg_archive_fulfillment_status_history_delete"));await guardsUp(f.db);assert.equal(await inspectFulfillmentArchiveProtection(f.db),true);
});
native("DEC029 all twelve real native owner tables copy/read back/delete without mutating Inventory facts",async t=>{
 const {archiveFactsFixture}=await import("../fulfillment/archiveFactsFixture.js"),{hashFulfillmentArchiveTable}=await import("../../src/modules/fulfillment/fulfillmentArchiveSchema.js"),f=await archiveFactsFixture(t);await guardsUp(f.db);const b=await batch(f),inventoryTables=["inventory_operation_requests","inventory_reservations","inventory_allocations","inventory_stock_balances","inventory_movements","inventory_audit_logs"],before={};for(const table of inventoryTables)before[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
 const order=["fulfillments","fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_allocations","fulfillment_status_history","shipments","shipment_lines","shipment_issue_details","shipment_status_history","shipment_reversals","shipment_reversal_details","fulfillment_audit_logs"];
 await f.db.beginTransaction();try{
  for(const table of order){const [rows]=await f.db.query(`SELECT * FROM ${table} ORDER BY id`);assert.ok(rows.length>0,table+" has real native facts");await assert.rejects(f.db.execute(`DELETE FROM ${table} WHERE id=?`,[rows[0].id]),signalled);for(const row of rows)await copy(f,table,row.id,b);const [mirror]=await f.db.query(`SELECT * FROM ${table}_archive ORDER BY id`);assert.deepEqual(hashFulfillmentArchiveTable(table,mirror),hashFulfillmentArchiveTable(table,rows));}
  for(const table of ["fulfillments","fulfillment_lines","shipments","shipment_lines","shipment_reversals"]){const [[row]]=await f.db.query(`SELECT id FROM ${table} ORDER BY id LIMIT 1`);const refusal=["shipment_lines","shipment_reversals"].includes(table)?e=>e.code==="ER_ROW_IS_REFERENCED_2"&&e.errno===1451:signalled;await assert.rejects(f.db.execute(`DELETE FROM ${table} WHERE id=?`,[row.id]),refusal);}
  await f.db.execute("UPDATE fulfillments SET active_shipment_id=NULL WHERE id=?",[f.doc.id]);
  for(const table of ["shipment_reversal_details","shipment_reversals","shipment_issue_details","shipment_status_history","shipment_lines","shipments","fulfillment_allocations","fulfillment_line_reservation_claims","fulfillment_status_history","fulfillment_lines","fulfillment_audit_logs","fulfillments"]){const [rows]=await f.db.query(`SELECT id FROM ${table} ORDER BY id`);for(const row of rows)await f.db.execute(`DELETE FROM ${table} WHERE id=?`,[row.id]);}
  await f.db.commit();
 }catch(error){await f.db.rollback();throw error;}
 for(const table of order)assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n,0);
 for(const table of inventoryTables)assert.deepEqual((await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0],before[table]);
});
native("DEC029 every real owner table refuses a changed snapshot; JSON, DATE and DECIMAL remain typed",async t=>{
 const {archiveFactsFixture}=await import("../fulfillment/archiveFactsFixture.js"),f=await archiveFactsFixture(t);await guardsUp(f.db);const b=await batch(f),copyOrder=["fulfillments","fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_allocations","fulfillment_status_history","shipments","shipment_lines","shipment_issue_details","shipment_status_history","shipment_reversals","shipment_reversal_details","fulfillment_audit_logs"],deleteOrder=["shipment_reversal_details","shipment_reversals","shipment_issue_details","shipment_status_history","shipment_lines","shipments","fulfillment_allocations","fulfillment_line_reservation_claims","fulfillment_status_history","fulfillment_lines","fulfillment_audit_logs","fulfillments"],original={};
 for(const table of copyOrder)original[table]=(await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0];
 const negatives=[...copyOrder.map(table=>({table,field:Object.hasOwn(original[table][0],"created_at")?"created_at":"occurred_at",change:value=>Number(value)+1})),{table:"shipments",field:"total_weight",change:()=>"1.000000"},{table:"shipment_issue_details",field:"expiry_date_snapshot",change:()=>"2020-01-01"},{table:"shipment_reversal_details",field:"reservation_before_summary",change:()=>({version:3,consumedQuantity:"2"})}];
 for(const negative of negatives){await f.db.beginTransaction();try{
  for(const table of copyOrder)for(const row of original[table]){
   if(table!==negative.table){await copy(f,table,row.id,b);continue;}
   const changed={...row,[negative.field]:negative.change(row[negative.field])},c=FULFILLMENT_ARCHIVE_TABLES.find(c=>c.table===table+"_archive"),stored={...changed,archive_batch_id:b,archived_at:f.s.now,row_hash:hashFulfillmentArchiveRow(table,changed)};
   for(const [name,[type]]of Object.entries(c.columns))if(type==="json"&&stored[name]!==null)stored[name]=JSON.stringify(stored[name]);await f.s.insert(c.table,stored);
  }
  if(negative.table==="fulfillments")await assert.rejects(f.db.execute("UPDATE fulfillments SET active_shipment_id=NULL WHERE id=?",[f.doc.id]),signalled);
  else{await f.db.execute("UPDATE fulfillments SET active_shipment_id=NULL WHERE id=?",[f.doc.id]);for(const table of deleteOrder){const [rows]=await f.db.query(`SELECT id FROM ${table} ORDER BY id`);if(table===negative.table){for(const row of rows)await assert.rejects(f.db.execute(`DELETE FROM ${table} WHERE id=?`,[row.id]),signalled);break;}for(const row of rows)await f.db.execute(`DELETE FROM ${table} WHERE id=?`,[row.id]);}}
 }finally{await f.db.rollback();}for(const table of copyOrder)assert.deepEqual((await f.db.query(`SELECT * FROM ${table} ORDER BY id`))[0],original[table],negative.table+"/"+negative.field);}
});
native("DEC029 mirror composite owner FKs reject a real other-line and other-root combination",async t=>{
 const f=await setup(t);await guardsUp(f.db);const d=await pickedShipment(f),other=await document(f,"FUL-202610-000002"),b=await batch(f);await snapshots(f,d,b);await copy(f,"fulfillments",other.id,b);await copy(f,"fulfillment_lines",other.line,b);const [[row]]=await f.db.query("SELECT * FROM shipment_lines WHERE id=?",[d.shipmentLine]);
 for(const fulfillment_id of [d.id,other.id])await assert.rejects(f.s.insert("shipment_lines_archive",{...row,id:9999,line_no:2,fulfillment_id,fulfillment_line_id:other.line,archive_batch_id:b,archived_at:f.s.now,row_hash:"a".repeat(64)}),error=>error.code==="ER_NO_REFERENCED_ROW_2"&&error.errno===1452);
});
native("DEC029 unknown forward trigger drift fails without replacing the altered definition",async t=>{
 const f=await setup(t);await guardsUp(f.db);await f.db.query("DROP TRIGGER trg_archive_fulfillment_status_history_delete");const weakened="SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Different definition'";await f.db.query("CREATE TRIGGER trg_archive_fulfillment_status_history_delete BEFORE DELETE ON fulfillment_status_history FOR EACH ROW "+weakened);await assert.rejects(guardsUp(f.db),/Incompatible Fulfillment schema/u);const [[saved]]=await f.db.query("SELECT action_statement AS body FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name='trg_archive_fulfillment_status_history_delete'");assert.equal(saved.body,weakened);
});
