import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { up as jobsUp, inspectSalesImportJobSchema } from "../../database/migrations/0080_create_sales_import_jobs.js";
import { up as ordersUp, inspectSalesIntakeSchema } from "../../database/migrations/0081_create_sales_intake_orders.js";
import { up as errorsUp, inspectSalesIntakeErrorSchema } from "../../database/migrations/0082_create_sales_intake_errors.js";
import { up as orderUp } from "../../database/migrations/0073_create_sales_orders.js";
import { up as linesUp } from "../../database/migrations/0074_create_sales_order_lines.js";
import { up as mappingUp } from "../../database/migrations/0078_create_sales_order_line_reservations.js";
import { up as projectionUp } from "../../database/migrations/0083_extend_sales_reservation_intake_projection.js";
import { up as keyUp } from "../../database/migrations/0072_create_sales_external_order_keys.js";

const integrationTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function setup(t,extra=[]) {
  const f=await migrationFixture(t,["sales_import_jobs","sales_intake_orders","sales_intake_errors",...extra]);
  // Keep nonce-prefixed FK identifiers below MySQL's64-character limit.
  const original=f.scoped;
  f.scoped={async query(sql,args) {
    const result=await original.query(sql.replaceAll("fk_sales_intake_orders_","fk_sales_intake_").replaceAll("fk_sales_intake_errors_","fk_sales_error_").replaceAll("fk_sales_order_line_reservations_","fk_sales_mapping_"),args);
    if(Array.isArray(result[0]))for(const row of result[0])for(const [source,target] of Object.entries(f.names)) {
      if(typeof row.statement==="string")row.statement=row.statement.replaceAll(target,source);
      if(row.referenced_table_name===target)row.referenced_table_name=source;
    }
    return result;
  }};
  await jobsUp(f.scoped);await ordersUp(f.scoped);await errorsUp(f.scoped);
  f.job={batch_number:"SI-"+randomUUID().slice(0,16),template_version:"1.0",original_file_name:"synthetic.csv",file_sha256:Buffer.alloc(32,1),file_size_bytes:1,status:"UPLOADED",created_at:f.now,updated_at:f.now};
  const [job]=await f.db.query(`INSERT INTO ${f.names.sales_import_jobs} SET ?`,f.job);f.jobId=Number(job.insertId);
  f.order={import_job_id:f.jobId,source_type:"CSV",source_order_key:"Synthetic",source_order_key_hash:Buffer.alloc(32,2),channel_code:"SYNTHETIC",external_order_id:"Synthetic",external_order_id_hash:Buffer.alloc(32,3),schema_version:"1.0",payload_hash:"a".repeat(64),first_row_no:2,last_row_no:2,line_count:1,status:"RECEIVED",processing_event_id:randomUUID(),created_at:f.now,updated_at:f.now};
  return f;
}

integrationTest("TC-037 Intake tables clean-create/upgrade/rerun preserve exact schemas and stored rows",async t=>{
  const f=await setup(t);await f.db.query(`INSERT INTO ${f.names.sales_intake_orders} SET ?`,f.order);
  await jobsUp(f.scoped);await ordersUp(f.scoped);await errorsUp(f.scoped);
  assert.equal(await inspectSalesImportJobSchema(f.scoped),true);assert.equal(await inspectSalesIntakeSchema(f.scoped),true);assert.equal(await inspectSalesIntakeErrorSchema(f.scoped),true);
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${f.names.sales_intake_orders}`))[0][0].n,1);
});

async function projectionFixture(t) {
  const f=await setup(t,["sales_orders","sales_order_lines","sales_order_line_reservations"]);
  await orderUp(f.scoped);await linesUp(f.scoped);await mappingUp(f.scoped);
  f.salesOrder={sales_order_number:"SO-"+randomUUID().slice(0,16),status:"DRAFT",source_type:"MANUAL",customer_id:f.customerId,customer_code_snapshot:"Synthetic",customer_name_snapshot:"Synthetic",currency_code:f.currency,
    fulfillment_warehouse_id:f.warehouseId,warehouse_code_snapshot:"Synthetic",warehouse_name_snapshot:"Synthetic",order_date:"2026-10-07",line_count:1,total_amount:"0.0000",created_at:f.now,updated_at:f.now,last_business_updated_at:f.now};
  return f;
}

integrationTest("TC-037 forward migration preserves manual NULL rows and enforces one Intake-to-SO FK/unique on rerun",async t=>{
  const f=await projectionFixture(t),table=f.names.sales_orders;
  await f.db.query(`INSERT INTO ${table} SET ?`,f.salesOrder);
  await projectionUp(f.scoped);await projectionUp(f.scoped);
  const [intake]=await f.db.query(`INSERT INTO ${f.names.sales_intake_orders} SET ?`,f.order),intakeId=Number(intake.insertId);
  await f.db.query(`INSERT INTO ${table} SET ?`,{...f.salesOrder,sales_order_number:"SO-"+randomUUID().slice(0,16),source_type:"CSV",source_intake_order_id:intakeId});
  await assert.rejects(()=>f.db.query(`INSERT INTO ${table} SET ?`,{...f.salesOrder,sales_order_number:"SO-"+randomUUID().slice(0,16),source_intake_order_id:intakeId}),{code:"ER_DUP_ENTRY"});
  await assert.rejects(()=>f.db.query(`INSERT INTO ${table} SET ?`,{...f.salesOrder,sales_order_number:"SO-"+randomUUID().slice(0,16),source_intake_order_id:intakeId+99999}),{code:"ER_NO_REFERENCED_ROW_2"});
  await assert.rejects(()=>f.db.execute(`DELETE FROM ${f.names.sales_intake_orders} WHERE id=?`,[intakeId]),{code:"ER_ROW_IS_REFERENCED_2"});
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE source_intake_order_id IS NULL`))[0][0].n,1);
});

integrationTest("TC-037 forward migration refuses orphan and duplicate source facts without repairing data",async t=>{
  const f=await projectionFixture(t),table=f.names.sales_orders;
  await f.db.query(`INSERT INTO ${table} SET ?`,{...f.salesOrder,source_intake_order_id:99999});
  await assert.rejects(()=>projectionUp(f.scoped),/source drift/u);
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n,1);
  await f.db.execute(`DELETE FROM ${table}`);
  const [intake]=await f.db.query(`INSERT INTO ${f.names.sales_intake_orders} SET ?`,f.order);
  for(let i=0;i<2;i++)await f.db.query(`INSERT INTO ${table} SET ?`,{...f.salesOrder,sales_order_number:"SO-"+randomUUID().slice(0,16),source_intake_order_id:Number(intake.insertId)});
  await assert.rejects(()=>projectionUp(f.scoped),/source drift/u);
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n,2);
});

integrationTest("TC-037 interrupted projection guard replacement resumes without losing either guard",async t=>{
  const f=await projectionFixture(t);let interrupted=false;
  await assert.rejects(()=>projectionUp({async query(sql,args){
    if(!interrupted&&sql.startsWith("CREATE TRIGGER trg_sales_mapping_update")) {interrupted=true;throw new Error("Synthetic DDL interruption");}
    return f.scoped.query(sql,args);
  }}),/Synthetic DDL interruption/u);
  assert.equal(interrupted,true);
  await projectionUp(f.scoped);await projectionUp(f.scoped);
  const [guards]=await f.scoped.query("SELECT trigger_name AS name,action_statement AS statement FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table='sales_order_line_reservations'");
  assert.equal(guards.length,2);
  for(const guard of guards)assert.match(guard.statement,/SALES_INTAKE_BATCH_RESERVE/u);
});

integrationTest("TC-037 projection drift is refused before replacing a changed guard or incompatible index",async t=>{
  const f=await projectionFixture(t);
  await f.scoped.query("ALTER TABLE sales_orders ADD KEY uq_sales_order_source_intake (source_intake_order_id)");
  await assert.rejects(()=>projectionUp(f.scoped),/Incompatible Sales Intake unique index/u);
  await f.scoped.query("ALTER TABLE sales_orders DROP INDEX uq_sales_order_source_intake");
  await f.scoped.query("DROP TRIGGER trg_sales_mapping_insert");
  await f.scoped.query("CREATE TRIGGER trg_sales_mapping_insert BEFORE INSERT ON sales_order_line_reservations FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic drift'; END");
  await assert.rejects(()=>projectionUp(f.scoped),/trigger/u);
  const [guards]=await f.scoped.query("SELECT action_statement AS statement FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name=?",["trg_sales_mapping_insert"]);
  assert.match(guards[0].statement,/Synthetic drift/u);
});

integrationTest("TC-037 an Intake OR relocated outside the command pair cannot bypass owner/projection predicates",async t=>{
  const f=await projectionFixture(t);
  const [guards]=await f.scoped.query("SELECT action_statement AS statement FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name=?",["trg_sales_mapping_insert"]);
  const pair=" OR (root.command_type='SALES_INTAKE_BATCH_RESERVE' AND child.command_type='SALES_INTAKE_LINE_RESERVE')";
  const end="r.status=NEW.status AND r.version=NEW.inventory_version)";
  assert.ok(guards[0].statement.includes(end));
  const drift=guards[0].statement.replace(end,end.slice(0,-1)+pair+")");
  await f.scoped.query("DROP TRIGGER trg_sales_mapping_insert");
  await f.scoped.query("CREATE TRIGGER trg_sales_mapping_insert BEFORE INSERT ON sales_order_line_reservations FOR EACH ROW "+drift);
  await assert.rejects(()=>projectionUp(f.scoped),/trigger/u);
});

integrationTest("TC-037 projection guards accept exact manual/backorder/Intake pairs and reject mixed pairs/current truth drift",async t=>{
  const f=await projectionFixture(t);await projectionUp(f.scoped);
  const [order]=await f.db.query(`INSERT INTO ${f.names.sales_orders} SET ?`,f.salesOrder),orderId=Number(order.insertId);
  const [line]=await f.db.query(`INSERT INTO ${f.names.sales_order_lines} SET ?`,{sales_order_id:orderId,line_no:1,sku_id:f.skuId,item_name_snapshot:"Synthetic",sku_code_snapshot:"Synthetic",sku_name_snapshot:"Synthetic",sku_uom_id:f.skuUomId,uom_code_snapshot:"EA",uom_name_snapshot:"Each",to_base_factor_snapshot:1,tracking_policy_snapshot:"none",ordered_quantity:"10.000000",ordered_base_quantity:10,unit_selling_price:"0.0000",price_source:"MANUAL",line_amount:"0.0000",created_at:f.now,updated_at:f.now}),lineId=Number(line.insertId);
  async function mapping(rootType,childType) {
    const event=randomUUID(),operation=type=>({command_type:type,source_module:"SALES",source_document_type:"SALES_ORDER",source_document_id:String(orderId),source_line_id:type===rootType?"":String(lineId),source_event_id:event,request_hash:"a".repeat(64),actor_label:"Synthetic",created_at:f.now});
    const rootId=await f.insert("inventory_operation_requests",operation(rootType)),childId=await f.insert("inventory_operation_requests",operation(childType));
    const reservationId=await f.insert("inventory_reservations",{create_operation_id:childId,warehouse_id:f.warehouseId,sku_id:f.skuId,original_quantity:4,outstanding_quantity:4,purpose:"SALE",status:"ACTIVE",created_at:f.now,updated_at:f.now});
    return {sales_order_line_id:lineId,inventory_reservation_id:reservationId,inventory_operation_id:rootId,source_event_id:event,original_base_quantity:4,outstanding_base_quantity:4,status:"ACTIVE",inventory_version:1,created_at:f.now,updated_at:f.now};
  }
  const table=f.names.sales_order_line_reservations;
  for(const prefix of ["SALES","SALES_BACKORDER","SALES_INTAKE"])await f.db.query(`INSERT INTO ${table} SET ?`,await mapping(prefix+"_BATCH_RESERVE",prefix+"_LINE_RESERVE"));
  for(const [root,child] of [["SALES_BATCH_RESERVE","SALES_INTAKE_LINE_RESERVE"],["SALES_INTAKE_BATCH_RESERVE","SALES_BACKORDER_LINE_RESERVE"]])
    await assert.rejects(()=>mapping(root,child).then(row=>f.db.query(`INSERT INTO ${table} SET ?`,row)),{code:"ER_SIGNAL_EXCEPTION"});
  const [stored]=await f.db.query(`SELECT id FROM ${table} LIMIT 1`);
  await assert.rejects(()=>f.db.execute(`UPDATE ${table} SET outstanding_base_quantity=3,consumed_base_quantity=1 WHERE id=?`,[stored[0].id]),{code:"ER_SIGNAL_EXCEPTION"});
  await assert.rejects(()=>f.db.execute(`UPDATE ${table} SET source_event_id=? WHERE id=?`,[randomUUID(),stored[0].id]),{code:"ER_SIGNAL_EXCEPTION"});
});

integrationTest("TC-037 Intake source/event/transport uniqueness and parent FK are actual DB guards",async t=>{
  const f=await setup(t),table=f.names.sales_intake_orders;
  await f.db.query(`INSERT INTO ${table} SET ?`,f.order);
  await assert.rejects(()=>f.db.query(`INSERT INTO ${table} SET ?`,{...f.order,processing_event_id:randomUUID()}),{code:"ER_DUP_ENTRY"});
  await assert.rejects(()=>f.db.query(`INSERT INTO ${table} SET ?`,{...f.order,source_order_key_hash:Buffer.alloc(32,9)}),{code:"ER_DUP_ENTRY"});
  await assert.rejects(()=>f.db.query(`INSERT INTO ${table} SET ?`,{...f.order,import_job_id:f.jobId+99999,processing_event_id:randomUUID()}),{code:"ER_NO_REFERENCED_ROW_2"});
  const channel={...f.order,import_job_id:null,source_type:"CHANNEL",transport_idempotency_key_hash:Buffer.alloc(32,4),processing_event_id:randomUUID()};
  await f.db.query(`INSERT INTO ${table} SET ?`,channel);
  await assert.rejects(()=>f.db.query(`INSERT INTO ${table} SET ?`,{...channel,processing_event_id:randomUUID()}),{code:"ER_DUP_ENTRY"});
  await f.db.query(`INSERT INTO ${table} SET ?`,{...channel,channel_code:"SYNTHETIC_B",processing_event_id:randomUUID()});
});

integrationTest("TC-037 concurrent Intake and existing External Key claims admit only one durable winner",async t=>{
  const f=await setup(t,["sales_external_order_keys"]);await keyUp(f.scoped);await keyUp(f.scoped);
  const other=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),socketPath:process.env.DB_SOCKET_PATH,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  try {
    const key={channel_code:"SYNTHETIC",external_order_id:"Exact-ID",external_order_id_hash:Buffer.alloc(32,7),source_type:"CSV",payload_hash:"a".repeat(64),status:"PROCESSING",claimed_at:f.now,updated_at:f.now};
    for(const [table,row] of [[f.names.sales_intake_orders,f.order],[f.names.sales_external_order_keys,key]]) {
      const contender="processing_event_id" in row?{...row,processing_event_id:randomUUID()}:row;
      const results=await Promise.allSettled([f.db.query(`INSERT INTO ${table} SET ?`,row),other.query(`INSERT INTO ${table} SET ?`,contender)]);
      assert.equal(results.filter(result=>result.status==="fulfilled").length,1);
      assert.equal(results.find(result=>result.status==="rejected").reason.code,"ER_DUP_ENTRY");
      assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`))[0][0].n,1);
    }
  } finally {await other.end();}
});

integrationTest("TC-035 Job/Intake reject unknown states, invalid counts/leases and oversized safe payload",async t=>{
  const f=await setup(t);
  for(const change of [{status:"UNKNOWN"},{version:0},{file_size_bytes:52428801},{source_order_count:10001},{total_row_count:100001},{valid_count:1},{lease_owner:randomUUID()}])
    await assert.rejects(()=>f.db.query(`INSERT INTO ${f.names.sales_import_jobs} SET ?`,{...f.job,batch_number:randomUUID().slice(0,25),...change}));
  for(const change of [{status:"UNKNOWN"},{line_count:101},{first_row_no:3},{safe_payload:JSON.stringify({notes:"x".repeat(131072)})},{source_type:"MANUAL"},{import_job_id:null}])
    await assert.rejects(()=>f.db.query(`INSERT INTO ${f.names.sales_intake_orders} SET ?`,{...f.order,processing_event_id:randomUUID(),...change}));
});

integrationTest("TC-035 errors have mandatory owner FK and bounded200 rows, then cascade with their owner",async t=>{
  const f=await setup(t);const [inserted]=await f.db.query(`INSERT INTO ${f.names.sales_intake_orders} SET ?`,f.order),id=Number(inserted.insertId);
  const error={intake_order_id:id,row_no:2,error_code:"SYNTHETIC_INVALID",safe_message:"Synthetic",created_at:f.now};
  await assert.rejects(()=>f.db.query(`INSERT INTO ${f.names.sales_intake_errors} SET ?`,{...error,intake_order_id:id+99999}));
  for(let i=0;i<200;i++)await f.db.query(`INSERT INTO ${f.names.sales_intake_errors} SET ?`,error);
  await assert.rejects(()=>f.db.query(`INSERT INTO ${f.names.sales_intake_errors} SET ?`,error),{code:"ER_SIGNAL_EXCEPTION"});
  await f.db.execute(`DELETE FROM ${f.names.sales_intake_orders} WHERE id=?`,[id]);
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${f.names.sales_intake_errors}`))[0][0].n,0);
});

integrationTest("TC-037 Intake schema drift is rejected without rewriting existing columns",async t=>{
  const f=await setup(t);await f.db.query(`ALTER TABLE ${f.names.sales_intake_orders} MODIFY line_count BIGINT UNSIGNED NOT NULL`);
  await assert.rejects(()=>ordersUp(f.scoped),/column line_count/u);
});

integrationTest("TC-037 lease/source CHECK grouping drift is rejected even when flattened tokens match",async t=>{
  const f=await setup(t);await f.db.execute(`DELETE FROM ${f.names.sales_import_jobs}`);
  for(const [table,field,drift,up] of [
    ["sales_import_jobs","lease_owner","lease_owner IS NULL AND (lease_until IS NULL OR lease_owner IS NOT NULL) AND lease_until IS NOT NULL",jobsUp],
    ["sales_intake_orders","source_type","source_type='CSV' AND import_job_id IS NOT NULL AND (transport_idempotency_key_hash IS NULL OR source_type='CHANNEL') AND import_job_id IS NULL AND transport_idempotency_key_hash IS NOT NULL",ordersUp]
  ]) {
    const [checks]=await f.db.query("SELECT tc.constraint_name AS name,cc.check_clause AS clause FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.constraint_schema=tc.constraint_schema AND cc.constraint_name=tc.constraint_name WHERE tc.constraint_schema=DATABASE() AND tc.table_name=? AND tc.constraint_type='CHECK'",[f.names[table]]);
    const check=checks.find(row=>row.clause.includes(field));assert.match(check.name,/^[a-z0-9_]+$/u);
    await f.db.query(`ALTER TABLE ${f.names[table]} DROP CHECK ${check.name}, ADD CONSTRAINT ${check.name} CHECK (${drift})`);
    await assert.rejects(()=>up(f.scoped),/check/u);
  }
});

integrationTest("TC-037 payload CHECK arithmetic/grouping drift is refused",async t=>{
  const f=await setup(t);await f.db.execute(`DELETE FROM ${f.names.sales_import_jobs}`);
  const table=f.names.sales_intake_orders;
  const [checks]=await f.db.query("SELECT tc.constraint_name AS name,cc.check_clause AS clause FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.constraint_schema=tc.constraint_schema AND cc.constraint_name=tc.constraint_name WHERE tc.constraint_schema=DATABASE() AND tc.table_name=? AND tc.constraint_type='CHECK'",[table]);
  const check=checks.find(row=>row.clause.includes("safe_payload"));assert.match(check.name,/^[a-z0-9_]+$/u);
  await f.db.query(`ALTER TABLE ${table} DROP CHECK ${check.name}, ADD CONSTRAINT ${check.name} CHECK ((safe_payload IS NULL OR LENGTH(CAST(safe_payload AS CHAR CHARSET utf8mb4))) <= 131072)`);
  await assert.rejects(()=>ordersUp(f.scoped),/check/u);
});

integrationTest("TC-035 an old REPEATABLE READ snapshot cannot insert error201 after another transaction fills owner",async t=>{
  const f=await setup(t);const [inserted]=await f.db.query(`INSERT INTO ${f.names.sales_intake_orders} SET ?`,f.order),id=Number(inserted.insertId);
  const error={intake_order_id:id,row_no:2,error_code:"SYNTHETIC_INVALID",safe_message:"Synthetic",created_at:f.now};
  for(let i=0;i<199;i++)await f.db.query(`INSERT INTO ${f.names.sales_intake_errors} SET ?`,error);
  const stale=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),socketPath:process.env.DB_SOCKET_PATH,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  try {
    await stale.beginTransaction();
    assert.equal((await stale.query(`SELECT COUNT(*) AS n FROM ${f.names.sales_intake_errors} WHERE intake_order_id=?`,[id]))[0][0].n,199);
    await f.db.query(`INSERT INTO ${f.names.sales_intake_errors} SET ?`,error);
    await assert.rejects(()=>stale.query(`INSERT INTO ${f.names.sales_intake_errors} SET ?`,error),{code:"ER_SIGNAL_EXCEPTION"});
    await stale.rollback();
    assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${f.names.sales_intake_errors} WHERE intake_order_id=?`,[id]))[0][0].n,200);
  } finally {await stale.rollback();await stale.end();}
});

integrationTest("TC-035 errors cannot change owners to bypass the bounded error guard",async t=>{
  const f=await setup(t),table=f.names.sales_intake_orders;
  const [one]=await f.db.query(`INSERT INTO ${table} SET ?`,f.order);
  const [two]=await f.db.query(`INSERT INTO ${table} SET ?`,{...f.order,source_order_key_hash:Buffer.alloc(32,8),processing_event_id:randomUUID()});
  const error={intake_order_id:Number(one.insertId),row_no:2,error_code:"SYNTHETIC_INVALID",safe_message:"Synthetic",created_at:f.now};
  const [saved]=await f.db.query(`INSERT INTO ${f.names.sales_intake_errors} SET ?`,error);
  await assert.rejects(()=>f.db.execute(`UPDATE ${f.names.sales_intake_errors} SET intake_order_id=? WHERE id=?`,[Number(two.insertId),Number(saved.insertId)]),{code:"ER_SIGNAL_EXCEPTION"});
});
