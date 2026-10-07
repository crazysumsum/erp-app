import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import mysql from "mysql2/promise";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { up as jobsUp, inspectSalesImportJobSchema } from "../../database/migrations/0080_create_sales_import_jobs.js";
import { up as ordersUp, inspectSalesIntakeSchema } from "../../database/migrations/0081_create_sales_intake_orders.js";
import { up as errorsUp, inspectSalesIntakeErrorSchema } from "../../database/migrations/0082_create_sales_intake_errors.js";
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
