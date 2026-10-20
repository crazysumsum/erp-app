import assert from "node:assert/strict";
import test from "node:test";
import { createFulfillmentArchiveDatabase } from "../sales/phase4/fulfillmentArchiveFixtures.js";
import { seedFulfillmentSalesOrder } from "../sales/phase4/fulfillmentOwnerFixtures.js";
import { FULFILLMENT_ARCHIVE_CONTRACTS, hashFulfillmentArchiveRow } from "../../src/modules/fulfillment/fulfillmentArchiveSchema.js";
import { inspectFulfillmentArchiveSchemas } from "../../src/modules/fulfillment/fulfillmentArchiveDatabaseSchema.js";
import { up as prerequisites } from "../../database/migrations/0091_create_fulfillment_archive_prerequisites.js";
import { up as mirrors } from "../../database/migrations/0092_create_fulfillment_archive_mirrors.js";
import { up as protections } from "../../database/migrations/0093_protect_fulfillment_archive_contracts.js";

const integrationTest = process.env.DB_INTEGRATION_TESTS === "1" ? test : test.skip;
  const snapshot = c => Object.fromEntries(Object.entries(c.columns).map(([name,column]) => {
    let value = column.nullable ? null : column.defaultValue ?? (/int/u.test(column.type) ? 1 : column.type === "json" ? {} : column.type === "date" ? "2024-01-01" : column.type.startsWith("decimal") ? "1.250000" : column.type === "char(36)" ? "00000000-0000-4000-8000-000000000001" : "Snapshot");
    if(name === "id")value=1;
    return [name,value];
  }));
  const overrides = {
    fulfillments:{status:"CANCELLED",active_shipment_id:1},
    fulfillment_lines:{tracking_policy_snapshot:"none",planned_base_quantity:1},
    fulfillment_line_reservation_claims:{status:"RELEASED",original_claimed_quantity:1,active_claimed_quantity:0,released_quantity:1},
    fulfillment_allocations:{status:"RELEASED",stock_status_snapshot:"AVAILABLE",selection_strategy:"FIFO",allocated_base_quantity:1,released_base_quantity:1},
    fulfillment_status_history:{from_status:null,to_status:"CANCELLED",action:"CANCEL"},
    shipments:{status:"CANCELLED",effective_fulfillment_id:null},
    shipment_status_history:{from_status:null,to_status:"CANCELLED",action:"CANCEL"},
    shipment_reversals:{status:"FAILED",effective_shipment_id:null,reason:"Synthetic reversal",goods_under_company_control:1,goods_returned_to_original_bins:1},
    fulfillment_audit_logs:{target_type:"FULFILLMENT"}
  };
integrationTest("TC-047 TC-048 real owner Archive schema contracts", async t => {
  const f = await createFulfillmentArchiveDatabase(t), db = f.db;
  const install = async () => { await prerequisites(db); await mirrors(db); await protections(db); };
  await install();
  const columns = async table => (await db.query(`SELECT COLUMN_NAME AS name,COLUMN_TYPE AS type,IS_NULLABLE AS nullable,
    COLUMN_DEFAULT AS defaultValue,COLLATION_NAME AS collation,EXTRA AS extra,GENERATION_EXPRESSION AS expression
    FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position`, [table]))[0];
  await t.test("all12 active and mirror tables retain full declared business columns and physical generated snapshots", async () => {
    for (const contract of FULFILLMENT_ARCHIVE_CONTRACTS) {
      const active = await columns(contract.table), copy = await columns(contract.table + "_archive");
      assert.deepEqual(active.map(row => row.name), Object.keys(contract.columns));
      assert.deepEqual(copy.slice(0, active.length), active.map(row => ({ ...row, extra: "", expression: "" })));
      assert.deepEqual(copy.slice(active.length).map(row => row.name), ["archive_batch_id", "archived_at", "row_hash"]);
    }
    assert.equal(await inspectFulfillmentArchiveSchemas(db), true);
  });
  const operation = { event_id:"00000000-0000-4000-8000-000000000001", operation_type:"CREATE", target_type:"FULFILLMENT",
    sales_order_id:1, payload_hash:"a".repeat(64), status:"IN_PROGRESS", correlation_id:"00000000-0000-4000-8000-000000000002", created_at:1, updated_at:1 };
  await t.test("business intent without target_id still requires authoritative Sales routing", async () => {
    await assert.rejects(() => db.query("INSERT INTO fulfillment_operation_requests SET ?", {...operation,sales_order_id:null}), {code:"ER_CHECK_CONSTRAINT_VIOLATED"});
    await assert.rejects(() => db.query("INSERT INTO fulfillment_operation_requests SET ?", {...operation,sales_order_id:0}), {code:"ER_CHECK_CONSTRAINT_VIOLATED"});
    await db.query("INSERT INTO fulfillment_operation_requests SET ?", operation);
  });
  await t.test("read-only multi-order Export intent accepts null Sales routing only", async () => {
    const row = {...operation,event_id:"00000000-0000-4000-8000-000000000003",target_type:"EXPORT",operation_type:"EXPORT",sales_order_id:null};
    await db.query("INSERT INTO fulfillment_operation_requests SET ?", row);
    await assert.rejects(() => db.query("INSERT INTO fulfillment_operation_requests SET ?", {...row,event_id:"00000000-0000-4000-8000-000000000004",sales_order_id:1}), {code:"ER_CHECK_CONSTRAINT_VIOLATED"});
  });
  await t.test("intent routing is immutable and operation statuses use the enforced allowlist", async () => {
    await assert.rejects(() => db.query("UPDATE fulfillment_operation_requests SET sales_order_id=2 WHERE sales_order_id=1"), {code:"ER_SIGNAL_EXCEPTION"});
    await assert.rejects(() => db.query("UPDATE fulfillment_operation_requests SET status='UNKNOWN' WHERE sales_order_id=1"), {code:"ER_CHECK_CONSTRAINT_VIOLATED"});
  });
  await t.test("idempotent DDL preserves real retained intents", async () => {
    const [before] = await db.query("SELECT * FROM fulfillment_operation_requests ORDER BY id"); await install();
    assert.deepEqual((await db.query("SELECT * FROM fulfillment_operation_requests ORDER BY id"))[0], before);
  });
  await t.test("bounded order/status indexes and circular composite ownership are real", async () => {
    const [keys] = await db.query(`SELECT table_name AS tableName,index_name AS name,GROUP_CONCAT(column_name ORDER BY seq_in_index) AS fields
      FROM information_schema.statistics WHERE table_schema=DATABASE() GROUP BY table_name,index_name`);
    for (const table of ["fulfillments","shipments","fulfillment_operation_requests"]) assert.ok(keys.some(row => row.tableName===table && row.fields==="sales_order_id,status,id"));
    const [fk] = await db.query(`SELECT column_name AS name,referenced_table_name AS target,referenced_column_name AS field
      FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name='fulfillments' AND constraint_name='fk_ful_active_shipment' ORDER BY ordinal_position`);
    assert.deepEqual(fk,[{name:"active_shipment_id",target:"shipments",field:"id"},{name:"id",target:"shipments",field:"fulfillment_id"}]);
  });
  await t.test("mirrors retain no deletable master/Inventory/Active foreign keys", async () => {
    const [keys] = await db.query(`SELECT referenced_table_name AS target FROM information_schema.key_column_usage
      WHERE table_schema=DATABASE() AND table_name IN (?) AND referenced_table_name IS NOT NULL`, [FULFILLMENT_ARCHIVE_CONTRACTS.map(c=>c.table+"_archive")]);
    assert.ok(keys.length>=12); assert.ok(keys.every(row=>row.target==="sales_archive_batches" || row.target.endsWith("_archive")));
  });
  const archivedRows = new Map();
  await t.test("native mirrors preserve complete historical rows and original IDs without live masters", async () => {
    await db.query("INSERT INTO sales_archive_batches(batch_number,period_key,cutoff_at,status,started_at,updated_at) VALUES ('SA-TEST','202401',1,'RUNNING',2,2)");
    for (const c of FULFILLMENT_ARCHIVE_CONTRACTS) {
      const row={...snapshot(c),...overrides[c.table]},hash=hashFulfillmentArchiveRow(c.table,row);
      const stored={...row,archive_batch_id:1,archived_at:2,row_hash:hash};
      for(const [name,column]of Object.entries(c.columns))if(column.type==="json"&&stored[name]!==null)stored[name]=JSON.stringify(stored[name]);
      await db.query(`INSERT INTO ${c.table}_archive SET ?`,stored);
      const [[readback]]=await db.query(`SELECT * FROM ${c.table}_archive WHERE id=1`);
      assert.equal(hashFulfillmentArchiveRow(c.table,readback),hash);archivedRows.set(c.table,readback);
    }
    assert.equal((await db.query("SELECT COUNT(*) AS n FROM fulfillments"))[0][0].n,0);
    assert.equal((await db.query("SELECT active_shipment_id FROM fulfillments_archive"))[0][0].active_shipment_id,1);
  });
  await t.test("all12 mirrors refuse UPDATE/DELETE even with a caller session-variable claim", async () => {
    await db.query("SET @fulfillment_archive_maintenance=1");
    const [triggers] = await db.query(`SELECT event_object_table AS tableName,event_manipulation AS event FROM information_schema.triggers
      WHERE trigger_schema=DATABASE() AND event_object_table IN (?)`, [FULFILLMENT_ARCHIVE_CONTRACTS.map(c=>c.table+"_archive")]);
    assert.equal(triggers.length,24);
    for (const c of FULFILLMENT_ARCHIVE_CONTRACTS) assert.deepEqual(triggers.filter(row=>row.tableName===c.table+"_archive").map(row=>row.event).sort(),["DELETE","UPDATE"]);
    for (const c of FULFILLMENT_ARCHIVE_CONTRACTS) {
      await assert.rejects(()=>db.query(`UPDATE ${c.table}_archive SET row_hash=row_hash WHERE id=1`),{code:"ER_SIGNAL_EXCEPTION"});
      await assert.rejects(()=>db.query(`DELETE FROM ${c.table}_archive WHERE id=1`),{code:"ER_SIGNAL_EXCEPTION"});
      assert.deepEqual((await db.query(`SELECT * FROM ${c.table}_archive WHERE id=1`))[0][0],archivedRows.get(c.table));
    }
    await db.query("SET @fulfillment_archive_maintenance=NULL");
  });
  await t.test("native quantity triggers reject invalid bounds and unsupported Serial before owner FK evaluation", async () => {
    const c=FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table==="fulfillment_lines"),base={...snapshot(c),...overrides.fulfillment_lines};
    for(const patch of [{planned_base_quantity:0},{picked_base_quantity:2},{tracking_policy_snapshot:"serial"},{reversed_base_quantity:2}])
      await assert.rejects(()=>db.query("INSERT INTO fulfillment_lines SET ?",{...base,...patch}),{code:"ER_SIGNAL_EXCEPTION"});
    await assert.rejects(()=>db.query("INSERT INTO fulfillment_lines SET ?",base),{code:"ER_NO_REFERENCED_ROW_2"});
  });
  await t.test("real Sales-line ownership and active Shipment circular ownership reject other aggregates", async () => {
    const a=await seedFulfillmentSalesOrder(db),b=await seedFulfillmentSalesOrder(db);
    const root=FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table==="fulfillments"),line=FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table==="fulfillment_lines"),shipment=FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table==="shipments");
    const rootRow={...snapshot(root),id:101,status:"CANCELLED",fulfillment_number:"FUL-101",sales_order_id:a.orderId,customer_id:a.customerId,warehouse_id:a.warehouseId,active_shipment_id:null};
    await db.query("INSERT INTO fulfillments SET ?",rootRow);
    const lineRow={...snapshot(line),...overrides.fulfillment_lines,id:101,fulfillment_id:101,sales_order_id:a.orderId,sales_order_line_id:a.lineId,sku_id:a.skuId,base_uom_id:a.uomId};
    await assert.rejects(()=>db.query("INSERT INTO fulfillment_lines SET ?",{...lineRow,sales_order_line_id:b.lineId}),{code:"ER_NO_REFERENCED_ROW_2"});
    await db.query("INSERT INTO fulfillment_lines SET ?",lineRow);
    const shipmentRow={...snapshot(shipment),status:"CANCELLED",id:101,shipment_number:"SHP-101",fulfillment_id:101,sales_order_id:a.orderId,customer_id:a.customerId,warehouse_id:a.warehouseId,shipping_address_id:a.addressId};
    delete shipmentRow.effective_fulfillment_id;
    await db.query("INSERT INTO shipments SET ?",shipmentRow);
    await db.query("INSERT INTO fulfillments SET ?",{...rootRow,id:102,fulfillment_number:"FUL-102",sales_order_id:b.orderId,customer_id:b.customerId,warehouse_id:b.warehouseId});
    await assert.rejects(()=>db.query("UPDATE fulfillments SET active_shipment_id=101 WHERE id=102"),{code:"ER_NO_REFERENCED_ROW_2"});
    await db.query("UPDATE fulfillments SET active_shipment_id=101 WHERE id=101");
    await assert.rejects(()=>db.query("DELETE FROM fulfillments WHERE id=101"),{code:"ER_SIGNAL_EXCEPTION"});
    // An identical immutable root alone cannot authorize cascading deletion of unarchived children.
    const [[savedRoot]]=await db.query("SELECT * FROM fulfillments WHERE id=101");
    await db.query("INSERT INTO fulfillments_archive SET ?",{...savedRoot,archive_batch_id:1,archived_at:2,row_hash:hashFulfillmentArchiveRow("fulfillments",savedRoot)});
    await assert.rejects(()=>db.query("DELETE FROM fulfillments WHERE id=101"),{code:"ER_SIGNAL_EXCEPTION"});
    await assert.rejects(()=>db.query("DELETE FROM fulfillment_lines WHERE id=101"),{code:"ER_SIGNAL_EXCEPTION"});
    // Case-insensitive table collation must never hide a different archived snapshot.
    const [[savedLine]]=await db.query("SELECT * FROM fulfillment_lines WHERE id=101");
    await db.query("INSERT INTO fulfillment_lines_archive SET ?",{...savedLine,sku_name_snapshot:savedLine.sku_name_snapshot.toLowerCase(),archive_batch_id:1,archived_at:2,row_hash:"f".repeat(64)});
    await assert.rejects(()=>db.query("DELETE FROM fulfillment_lines WHERE id=101"),{code:"ER_SIGNAL_EXCEPTION"});
  });
  await t.test("nonnull Contact requires a positive nonnull version; both null and valid pair are accepted", async () => {
    const a=await seedFulfillmentSalesOrder(db),c=FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table==="fulfillments"),shipment=FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table==="shipments");
    const root={...snapshot(c),id:201,status:"CANCELLED",fulfillment_number:"FUL-201",sales_order_id:a.orderId,customer_id:a.customerId,warehouse_id:a.warehouseId,active_shipment_id:null};
    await db.query("INSERT INTO fulfillments SET ?",root);
    const contactId=await a.insert("customer_contacts",{customer_id:a.customerId,name:"Synthetic",created_at:a.now,updated_at:a.now});
    const row={...snapshot(shipment),id:201,status:"CANCELLED",shipment_number:"SHP-201",fulfillment_id:201,sales_order_id:a.orderId,customer_id:a.customerId,warehouse_id:a.warehouseId,shipping_address_id:a.addressId};delete row.effective_fulfillment_id;
    await assert.rejects(()=>db.query("INSERT INTO shipments SET ?",{...row,shipping_contact_id:contactId,shipping_contact_version:null}),{code:"ER_CHECK_CONSTRAINT_VIOLATED"});
    await db.query("INSERT INTO shipments SET ?",row);
    await db.query("INSERT INTO shipments SET ?",{...row,id:202,shipment_number:"SHP-202",shipping_contact_id:contactId,shipping_contact_version:1});
  });
  await t.test("retained operation DELETE is rejected without changing the original intent", async () => {
    const [before]=await db.query("SELECT * FROM fulfillment_operation_requests ORDER BY id");
    await assert.rejects(()=>db.query("DELETE FROM fulfillment_operation_requests WHERE id=?",[before[0].id]),{code:"ER_SIGNAL_EXCEPTION"});
    assert.deepEqual((await db.query("SELECT * FROM fulfillment_operation_requests ORDER BY id"))[0],before);
  });
  await t.test("storage copy guard permits exact leaf-to-root deletion after circular pointer clear", async () => {
    const a=await seedFulfillmentSalesOrder(db),root=FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table==="fulfillments"),line=FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table==="fulfillment_lines"),ship=FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table==="shipments"),history=FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table==="fulfillment_status_history");
    const rootRow={...snapshot(root),id:301,status:"SHIPPED",fulfillment_number:"FUL-301",sales_order_id:a.orderId,customer_id:a.customerId,warehouse_id:a.warehouseId,active_shipment_id:null};
    await db.query("INSERT INTO fulfillments SET ?",rootRow);
    await db.query("INSERT INTO fulfillment_lines SET ?",{...snapshot(line),...overrides.fulfillment_lines,id:301,fulfillment_id:301,sales_order_id:a.orderId,sales_order_line_id:a.lineId,sku_id:a.skuId,base_uom_id:a.uomId,allocated_base_quantity:1,picked_base_quantity:1,shipped_base_quantity:1});
    const shipmentRow={...snapshot(ship),status:"SHIPPED",id:301,shipment_number:"SHP-301",fulfillment_id:301,sales_order_id:a.orderId,customer_id:a.customerId,warehouse_id:a.warehouseId,shipping_address_id:a.addressId};delete shipmentRow.effective_fulfillment_id;
    await db.query("INSERT INTO shipments SET ?",shipmentRow);await db.query("UPDATE fulfillments SET active_shipment_id=301 WHERE id=301");
    await db.query("INSERT INTO fulfillment_status_history SET ?",{...snapshot(history),id:301,fulfillment_id:301,from_status:"PICKED",to_status:"SHIPPED",action:"SHIP"});
    // This exercises storage ordering only, not business eligibility or participant authority.
    for(const table of ["fulfillments","fulfillment_lines","fulfillment_status_history","shipments"]) {
      const [[row]]=await db.query(`SELECT * FROM ${table} WHERE id=301`);
      await db.query(`INSERT INTO ${table}_archive SET ?`,{...row,archive_batch_id:1,archived_at:2,row_hash:hashFulfillmentArchiveRow(table,row)});
    }
    await assert.rejects(()=>db.query("UPDATE fulfillment_status_history SET reason='Changed' WHERE id=301"),{code:"ER_SIGNAL_EXCEPTION"});
    await db.query("UPDATE fulfillments SET active_shipment_id=NULL WHERE id=301");
    for(const table of ["fulfillment_status_history","shipments","fulfillment_lines","fulfillments"]) {
      assert.equal((await db.query(`DELETE FROM ${table} WHERE id=301`))[0].affectedRows,1);
      assert.equal((await db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE id=301`))[0][0].n,0);
      assert.equal((await db.query(`SELECT COUNT(*) AS n FROM ${table}_archive WHERE id=301`))[0][0].n,1);
    }
    assert.equal((await db.query("SELECT active_shipment_id FROM fulfillments_archive WHERE id=301"))[0][0].active_shipment_id,301);
  });
  await t.test("CHECK drift that changes arithmetic/comparison grouping is rejected", async () => {
    await db.query("ALTER TABLE fulfillment_allocations DROP CHECK chk_ful_alloc_quantity");
    await db.query("ALTER TABLE fulfillment_allocations ADD CONSTRAINT chk_ful_alloc_quantity CHECK (allocated_base_quantity > 0 AND (picked_base_quantity + (released_base_quantity <= allocated_base_quantity)) AND inventory_version > 0 AND balance_version > 0 AND recommended_rank_snapshot > 0)");
    await assert.rejects(()=>prerequisites(db),/Incompatible.*checks/u);
    await db.query("ALTER TABLE fulfillment_allocations DROP CHECK chk_ful_alloc_quantity");
    await db.query("ALTER TABLE fulfillment_allocations ADD CONSTRAINT chk_ful_alloc_quantity CHECK (allocated_base_quantity > 0 AND picked_base_quantity + released_base_quantity <= allocated_base_quantity AND inventory_version > 0 AND balance_version > 0 AND recommended_rank_snapshot > 0)");
  });
  await t.test("column drift fails closed before creating further objects", async () => {
    await db.query("ALTER TABLE fulfillment_operation_requests MODIFY public_error_code VARCHAR(81) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''");
    await assert.rejects(()=>prerequisites(db),/Incompatible.*column public_error_code/u);
    await db.query("ALTER TABLE fulfillment_operation_requests MODIFY public_error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT ''");
  });
  await t.test("generated expression drift fails closed", async () => {
    await db.query("ALTER TABLE shipment_reversals DROP INDEX uq_ful_reversal_effective, DROP COLUMN effective_shipment_id");
    await db.query("ALTER TABLE shipment_reversals ADD effective_shipment_id BIGINT UNSIGNED GENERATED ALWAYS AS (IF(status='REVERSED',shipment_id,NULL)) STORED AFTER shipment_id, ADD UNIQUE KEY uq_ful_reversal_effective(effective_shipment_id)");
    await assert.rejects(()=>prerequisites(db),/Incompatible.*generated/u);
    await db.query("ALTER TABLE shipment_reversals DROP INDEX uq_ful_reversal_effective, DROP COLUMN effective_shipment_id");
    await db.query("ALTER TABLE shipment_reversals ADD effective_shipment_id BIGINT UNSIGNED GENERATED ALWAYS AS (IF(status IN ('REVERSING','REVERSED'),shipment_id,NULL)) STORED AFTER shipment_id, ADD UNIQUE KEY uq_ful_reversal_effective(effective_shipment_id)");
  });
  await t.test("missing enforced constraint is rejected rather than silently weakened", async () => {
    await db.query("ALTER TABLE fulfillment_operation_requests DROP CHECK chk_ful_ops_route");
    await assert.rejects(()=>prerequisites(db),/Incompatible.*checks/u);
    await db.query("ALTER TABLE fulfillment_operation_requests ADD CONSTRAINT chk_ful_ops_route CHECK (((target_type IN ('FULFILLMENT','SHIPMENT')) AND (sales_order_id IS NOT NULL) AND (sales_order_id > 0)) OR ((target_type = 'EXPORT') AND (sales_order_id IS NULL)))");
  });
  await t.test("changed trigger body is rejected rather than replaced", async () => {
    await db.query("DROP TRIGGER trg_ful_shipments_archive_update");
    await db.query("CREATE TRIGGER trg_ful_shipments_archive_update BEFORE UPDATE ON shipments_archive FOR EACH ROW SET NEW.row_hash=OLD.row_hash");
    await assert.rejects(()=>protections(db),/Incompatible.*trigger/u);
    await db.query("DROP TRIGGER trg_ful_shipments_archive_update"); await protections(db);
  });
  await t.test("missing protection can resume after implicit-commit interruption", async () => {
    await db.query("DROP TRIGGER trg_ful_shipments_archive_delete"); await protections(db);
    assert.equal(await inspectFulfillmentArchiveSchemas(db),true);
  });
  await t.test("normal migration runner records all three new identities and is repeatable", async () => {
    const result = await f.migrate();assert.equal(result.code,0,result.stderr);
    const [ledger]=await db.query("SELECT name FROM fr_schema_migrations WHERE name LIKE 'migrations/009%fulfillment%' ORDER BY name");
    assert.equal(ledger.length,3);assert.equal((await f.migrate()).code,0);
  });
});

integrationTest("TC-048 forward migrations resume real implicit-commit partial installs", async t => {
  const f=await createFulfillmentArchiveDatabase(t),db=f.db;
  await assert.rejects(()=>prerequisites({query(sql,args){if(sql.startsWith("CREATE TABLE shipments "))throw new Error("Injected0091 interruption");return db.query(sql,args);}}),/Injected0091/u);
  const a=await seedFulfillmentSalesOrder(db),c=FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table==="fulfillments");
  const root={...snapshot(c),id:501,status:"CANCELLED",fulfillment_number:"FUL-501",sales_order_id:a.orderId,customer_id:a.customerId,warehouse_id:a.warehouseId,active_shipment_id:null};
  await db.query("INSERT INTO fulfillments SET ?",root);const [before]=await db.query("SELECT * FROM fulfillments");
  await prerequisites(db);assert.deepEqual((await db.query("SELECT * FROM fulfillments"))[0],before);
  await db.query("ALTER TABLE fulfillments DROP FOREIGN KEY fk_ful_active_shipment");await prerequisites(db);
  assert.deepEqual((await db.query("SELECT * FROM fulfillments"))[0],before);
  await assert.rejects(()=>mirrors({query(sql,args){if(sql.startsWith("CREATE TABLE shipment_lines_archive "))throw new Error("Injected0092 interruption");return db.query(sql,args);}}),/Injected0092/u);
  await db.query("INSERT INTO sales_archive_batches(batch_number,period_key,cutoff_at,status,started_at,updated_at) VALUES ('SA-PARTIAL','202401',1,'RUNNING',2,2)");
  await db.query("INSERT INTO fulfillments_archive SET ?",{...before[0],archive_batch_id:1,archived_at:2,row_hash:hashFulfillmentArchiveRow("fulfillments",before[0])});
  const [saved]=await db.query("SELECT * FROM fulfillments_archive");await mirrors(db);await protections(db);
  assert.deepEqual((await db.query("SELECT * FROM fulfillments_archive"))[0],saved);
  assert.deepEqual((await db.query("SELECT * FROM fulfillments"))[0],before);
  assert.equal(await inspectFulfillmentArchiveSchemas(db),true);
});
