import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {fixture,document} from "../fulfillment/aggregateFixture.js";
import {up as shipmentUp} from "../../database/migrations/0096_create_shipments.js";
import {up as factsUp} from "../../database/migrations/0097_create_shipment_issues_and_reversals.js";
import {up as auditUp} from "../../database/migrations/0098_create_fulfillment_audit_and_exports.js";
import {up as archiveUp,FULFILLMENT_ARCHIVE_TABLES} from "../../database/migrations/0099_create_fulfillment_archives.js";
import {up as routingUp} from "../../database/migrations/0101_add_fulfillment_archive_routing.js";
const native=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function setup(t){const f=await fixture(t);for(const up of [shipmentUp,factsUp,auditUp,archiveUp])await up(f.db);return f;}
function operation(f,extra={}){return {event_id:randomUUID(),operation_type:"CREATE",target_type:"FULFILLMENT",target_id:null,payload_hash:"a".repeat(64),status:"IN_PROGRESS",lease_owner:"owned-route-test",lease_expires_at:f.s.now+60000,attempt_count:1,correlation_id:randomUUID(),created_at:f.s.now,updated_at:f.s.now,...extra};}
async function hasColumn(db){return (await db.query("SELECT column_name FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='fulfillment_operation_requests' AND column_name='sales_order_id'"))[0].length;}
native("DEC029 forward routing installs idempotently with exact order index, CHECK and no Active SO FK",async t=>{
 const f=await setup(t);await routingUp(f.db);await routingUp(f.db);
 const [rows]=await f.db.query("SELECT column_name AS name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='fulfillment_operation_requests' AND index_name='idx_ful_operation_order' ORDER BY seq_in_index");assert.deepEqual(rows.map(r=>r.name),["sales_order_id","status","id"]);
 const [refs]=await f.db.query("SELECT referenced_table_name FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name='fulfillment_operation_requests' AND column_name='sales_order_id' AND referenced_table_name IS NOT NULL");assert.equal(refs.length,0);
 for(const value of [undefined,null,0])await assert.rejects(f.s.insert("fulfillment_operation_requests",operation(f,value===undefined?{}:{sales_order_id:value})));
 const id=await f.s.insert("fulfillment_operation_requests",operation(f,{sales_order_id:f.s.orderId}));assert.ok(id);
 await f.s.insert("fulfillment_operation_requests",operation(f,{operation_type:"EXPORT",target_type:"EXPORT"}));
 await assert.rejects(f.s.insert("fulfillment_operation_requests",operation(f,{operation_type:"EXPORT",target_type:"EXPORT",sales_order_id:f.s.orderId})));
});
native("DEC029 uniquely proven legacy target route is backfilled without changing receipt bytes",async t=>{
 const f=await setup(t),doc=await document(f),id=await f.s.insert("fulfillment_operation_requests",operation(f,{operation_type:"CANCEL",target_id:doc.id,status:"FAILED",lease_owner:"",lease_expires_at:null,completed_at:f.s.now,public_error_code:"VERSION_CONFLICT",public_error_details:JSON.stringify({})}));
 const [[before]]=await f.db.query("SELECT * FROM fulfillment_operation_requests WHERE id=?",[id]);await routingUp(f.db);const [[after]]=await f.db.query("SELECT * FROM fulfillment_operation_requests WHERE id=?",[id]);assert.equal(String(after.sales_order_id),String(f.s.orderId));delete after.sales_order_id;assert.deepEqual(after,before);
 await assert.rejects(f.db.execute("UPDATE fulfillment_operation_requests SET sales_order_id=sales_order_id+1 WHERE id=?",[id]));
 await f.db.execute("UPDATE fulfillment_operation_requests SET is_document_archived=1 WHERE id=?",[id]);
});
for(const target_id of [null,9007199254740991])native(`DEC029 unresolved legacy target ${target_id} refuses before DDL and preserves history`,async t=>{
 const f=await setup(t),id=await f.s.insert("fulfillment_operation_requests",operation(f,{target_id})),[[before]]=await f.db.query("SELECT * FROM fulfillment_operation_requests WHERE id=?",[id]);await assert.rejects(routingUp(f.db),/Unresolved Fulfillment operation order route/u);assert.equal(await hasColumn(f.db),0);assert.deepEqual((await f.db.query("SELECT * FROM fulfillment_operation_requests WHERE id=?",[id]))[0][0],before);
});
native("DEC029 partial compatible column resumes; contradictory route is never overwritten",async t=>{
 const f=await setup(t),doc=await document(f),id=await f.s.insert("fulfillment_operation_requests",operation(f,{operation_type:"CANCEL",target_id:doc.id}));await f.db.query("ALTER TABLE fulfillment_operation_requests ADD COLUMN sales_order_id BIGINT UNSIGNED NULL");
 await f.db.execute("UPDATE fulfillment_operation_requests SET sales_order_id=? WHERE id=?",[f.s.orderId+1,id]);await assert.rejects(routingUp(f.db),/Conflicting Fulfillment operation order route/u);assert.equal(String((await f.db.query("SELECT sales_order_id FROM fulfillment_operation_requests WHERE id=?",[id]))[0][0].sales_order_id),String(f.s.orderId+1));
 await f.db.execute("UPDATE fulfillment_operation_requests SET sales_order_id=NULL WHERE id=?",[id]);await routingUp(f.db);assert.equal(String((await f.db.query("SELECT sales_order_id FROM fulfillment_operation_requests WHERE id=?",[id]))[0][0].sales_order_id),String(f.s.orderId));
});
native("DEC029 forward guard drift is rejected and missing guard resumes without weakening",async t=>{
 const f=await setup(t);await routingUp(f.db);await f.db.query("DROP TRIGGER trg_ful_operation_order_update");await routingUp(f.db);
 await f.db.query("DROP TRIGGER trg_ful_operation_order_update");await f.db.query("CREATE TRIGGER trg_ful_operation_order_update BEFORE UPDATE ON fulfillment_operation_requests FOR EACH ROW SET @synthetic_noop=1");await assert.rejects(routingUp(f.db),/Incompatible Fulfillment operation order routing/u);
});
native("DEC029 a positive partial NULL-target hint never authenticates a legacy route",async t=>{
 const f=await setup(t);await f.db.query("ALTER TABLE fulfillment_operation_requests ADD COLUMN sales_order_id BIGINT UNSIGNED NULL");const id=await f.s.insert("fulfillment_operation_requests",operation(f,{sales_order_id:f.s.orderId}));await assert.rejects(routingUp(f.db),/Unresolved Fulfillment operation order route/u);
 assert.equal((await f.db.query("SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='fulfillment_operation_requests' AND index_name='idx_ful_operation_order'"))[0][0].n,0);assert.equal(String((await f.db.query("SELECT sales_order_id FROM fulfillment_operation_requests WHERE id=?",[id]))[0][0].sales_order_id),String(f.s.orderId));
});
native("DEC029 a grouping-weakened route trigger is rejected even when token text matches",async t=>{
 const f=await setup(t);await routingUp(f.db);const id=await f.s.insert("fulfillment_operation_requests",operation(f,{sales_order_id:f.s.orderId}));await f.db.query("DROP TRIGGER trg_ful_operation_order_update");
 await f.db.query("CREATE TRIGGER trg_ful_operation_order_update BEFORE UPDATE ON fulfillment_operation_requests FOR EACH ROW BEGIN IF (NOT NEW.sales_order_id)<=>OLD.sales_order_id THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment operation order route is immutable'; END IF; END");
 await f.db.execute("UPDATE fulfillment_operation_requests SET sales_order_id=sales_order_id+1 WHERE id=?",[id]);await assert.rejects(routingUp(f.db),/Incompatible Fulfillment operation order routing/u);
});
async function mirrorForRoutingOnly(f,table,id){
 const mirror=FULFILLMENT_ARCHIVE_TABLES.find(c=>c.table===table+"_archive"),columns=Object.keys(mirror.columns).filter(name=>!["archive_batch_id","archived_at","row_hash"].includes(name));
 const batch=await f.s.insert("sales_archive_batches",{batch_number:"ROUTE-"+randomUUID().slice(0,12),period_key:"202610",cutoff_at:f.s.now,status:"RUNNING",started_at:f.s.now,updated_at:f.s.now});
 // Synthetic ownership fixture only: this dummy digest is not a verified Archive manifest or business move.
 await f.db.execute(`INSERT INTO ${mirror.table} (${columns.join(",")},archive_batch_id,archived_at,row_hash) SELECT ${columns.join(",")},?,?,? FROM ${table} WHERE id=?`,[batch,f.s.now,"a".repeat(64),id]);
}
async function targetFixture(f,type){const doc=await document(f);if(type==="FULFILLMENT")return {table:"fulfillments",id:doc.id};await f.db.execute("UPDATE fulfillments SET status='PICKING',version=version+1 WHERE id=?",[doc.id]);await f.db.execute("UPDATE fulfillment_lines SET allocated_base_quantity=1,picked_base_quantity=1,version=version+1 WHERE id=?",[doc.line]);await f.db.execute("UPDATE fulfillments SET status='PICKED',version=version+1 WHERE id=?",[doc.id]);const id=await f.s.insert("shipments",{shipment_number:"SHP-202610-000001",fulfillment_id:doc.id,sales_order_id:f.s.orderId,customer_id:f.s.customerId,warehouse_id:f.s.warehouseId,status:"DRAFT",shipping_address_id:f.s.addressId,shipping_address_version:1,line_count:1,last_business_updated_at:f.s.now,created_at:f.s.now,updated_at:f.s.now});return {table:"shipments",id};}
for(const type of ["FULFILLMENT","SHIPMENT"]) {
 native(`DEC029 ${type} archive-only legacy identity resolves without recreating an Active document`,async t=>{
  const f=await setup(t),target=await targetFixture(f,type);await mirrorForRoutingOnly(f,target.table,target.id);await f.db.execute(`DELETE FROM ${target.table} WHERE id=?`,[target.id]);const id=await f.s.insert("fulfillment_operation_requests",operation(f,{operation_type:type==="SHIPMENT"?"SHIPMENT_CANCEL":"CANCEL",target_type:type,target_id:target.id}));await routingUp(f.db);
  assert.equal(String((await f.db.query("SELECT sales_order_id FROM fulfillment_operation_requests WHERE id=?",[id]))[0][0].sales_order_id),String(f.s.orderId));assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${target.table} WHERE id=?`,[target.id]))[0][0].n,0);
 });
 native(`DEC029 ambiguous Active and Archive ${type} ownership refuses before DDL`,async t=>{
  const f=await setup(t),target=await targetFixture(f,type);await mirrorForRoutingOnly(f,target.table,target.id);await f.s.insert("fulfillment_operation_requests",operation(f,{operation_type:type==="SHIPMENT"?"SHIPMENT_CANCEL":"CANCEL",target_type:type,target_id:target.id}));await assert.rejects(routingUp(f.db),/Unresolved Fulfillment operation order route/u);assert.equal(await hasColumn(f.db),0);
 });
}
native("DEC029 current Shipment target routes to its actual persisted Sales order",async t=>{
 const f=await setup(t),target=await targetFixture(f,"SHIPMENT"),id=await f.s.insert("fulfillment_operation_requests",operation(f,{operation_type:"SHIPMENT_CANCEL",target_type:"SHIPMENT",target_id:target.id}));await routingUp(f.db);assert.equal(String((await f.db.query("SELECT sales_order_id FROM fulfillment_operation_requests WHERE id=?",[id]))[0][0].sales_order_id),String(f.s.orderId));
});
for(const stage of ["column-index","column-index-check"])native(`DEC029 natural implicit-commit stage ${stage} resumes compatible remaining guards`,async t=>{
 const f=await setup(t),doc=await document(f),id=await f.s.insert("fulfillment_operation_requests",operation(f,{operation_type:"CANCEL",target_id:doc.id}));await f.db.query("ALTER TABLE fulfillment_operation_requests ADD COLUMN sales_order_id BIGINT UNSIGNED NULL");await f.db.query("ALTER TABLE fulfillment_operation_requests ADD INDEX idx_ful_operation_order (sales_order_id,status,id)");
 if(stage==="column-index-check"){await f.db.execute("UPDATE fulfillment_operation_requests SET sales_order_id=? WHERE id=?",[f.s.orderId,id]);await f.db.query("ALTER TABLE fulfillment_operation_requests ADD CONSTRAINT chk_ful_operation_order CHECK (IF(target_type='EXPORT',sales_order_id IS NULL,COALESCE(sales_order_id,0)>0)=1)");}
 await routingUp(f.db);await routingUp(f.db);assert.equal(String((await f.db.query("SELECT sales_order_id FROM fulfillment_operation_requests WHERE id=?",[id]))[0][0].sales_order_id),String(f.s.orderId));
});

native("DEC029 immutable Archive index resumes an already guarded route with a legitimate NULL target",async t=>{
 const f=await setup(t);await routingUp(f.db);await f.db.query("ALTER TABLE fulfillment_operation_requests DROP INDEX idx_ful_operation_archive_order");const id=await f.s.insert("fulfillment_operation_requests",operation(f,{sales_order_id:f.s.orderId})),[[before]]=await f.db.query("SELECT * FROM fulfillment_operation_requests WHERE id=?",[id]);await routingUp(f.db);assert.deepEqual((await f.db.query("SELECT * FROM fulfillment_operation_requests WHERE id=?",[id]))[0][0],before);const [columns]=await f.db.query("SELECT column_name AS name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='fulfillment_operation_requests' AND index_name='idx_ful_operation_archive_order' ORDER BY seq_in_index");assert.deepEqual(columns.map(r=>r.name),["sales_order_id","id"]);await routingUp(f.db);
});
native("DEC029 immutable Archive index drift is refused without overwriting its existing definition",async t=>{
 const f=await setup(t);await routingUp(f.db);await f.db.query("ALTER TABLE fulfillment_operation_requests DROP INDEX idx_ful_operation_archive_order,ADD INDEX idx_ful_operation_archive_order(sales_order_id,status,id)");await assert.rejects(routingUp(f.db),/Incompatible Fulfillment operation order routing/u);const [columns]=await f.db.query("SELECT column_name AS name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='fulfillment_operation_requests' AND index_name='idx_ful_operation_archive_order' ORDER BY seq_in_index");assert.deepEqual(columns.map(r=>r.name),["sales_order_id","status","id"]);
});
