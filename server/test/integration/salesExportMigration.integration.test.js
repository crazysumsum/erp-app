import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { migrationFixture } from "../sales/phase1/fixtures.js";
import { createFulfillmentArchiveDatabase } from "../sales/phase4/fulfillmentArchiveFixtures.js";
import { up, inspectSalesExportJobSchema } from "../../database/migrations/0090_create_sales_export_jobs.js";

const integrationTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
async function setup(t) {
 const f=await migrationFixture(t,["sales_export_jobs"]);await up(f.scoped);
 f.table=f.names.sales_export_jobs;
 f.job={scope:"ACTIVE",filters:JSON.stringify({status:["COMPLETED"]}),filters_hash:"a".repeat(64),status:"QUEUED",created_at:f.now};
 return f;
}
integrationTest("TC-045 Export migration creates indexed persistence and reruns without changing rows",async t=>{
 const f=await setup(t);const [result]=await f.db.query(`INSERT INTO ${f.table} SET ?`,f.job);
 await up(f.scoped);assert.equal(await inspectSalesExportJobSchema(f.scoped),true);
 const [[row]]=await f.db.query(`SELECT * FROM ${f.table} WHERE id=?`,[result.insertId]);
 assert.equal(row.status,"QUEUED");assert.equal(row.row_count,0);assert.equal(row.file_path,"");assert.equal(row.error_code,"");
 for(const key of ["created_by","lease_owner","lease_until","started_at","completed_at","expires_at"])assert.equal(row[key],null);
 const [indexes]=await f.db.query(`SHOW INDEX FROM ${f.table}`);
 for(const name of ["idx_sales_export_status","idx_sales_export_actor","idx_sales_export_expiry","idx_sales_export_lease"])assert.ok(indexes.some(row=>row.Key_name===name));
});
integrationTest("TC-045 Export persistence validates scope, states and paired leases",async t=>{
 const f=await setup(t);
 for(const scope of ["ACTIVE","ARCHIVE","IMPORT_RESULT"])await f.db.query(`INSERT INTO ${f.table} SET ?`,{...f.job,scope});
 for(const patch of [{scope:"OTHER"},{status:"UNKNOWN"},{lease_owner:randomUUID()},{lease_until:f.now+1000}])await assert.rejects(()=>f.db.query(`INSERT INTO ${f.table} SET ?`,{...f.job,...patch}),{code:"ER_CHECK_CONSTRAINT_VIOLATED"});
 await f.db.query(`INSERT INTO ${f.table} SET ?`,{...f.job,status:"PROCESSING",lease_owner:randomUUID(),lease_until:f.now+1000,started_at:f.now});
});
integrationTest("TC-045 Export filter JSON is object-only and bounded in UTF-8 bytes",async t=>{
 const f=await setup(t);
 for(const filters of ["[]","null",JSON.stringify("text"),JSON.stringify({q:"界".repeat(6000)})])await assert.rejects(()=>f.db.query(`INSERT INTO ${f.table} SET ?`,{...f.job,filters}),{code:"ER_CHECK_CONSTRAINT_VIOLATED"});
 await assert.rejects(()=>f.db.query(`INSERT INTO ${f.table} SET ?`,{...f.job,filters:"{invalid"}),{code:"ER_INVALID_JSON_TEXT"});
 await f.db.query(`INSERT INTO ${f.table} SET ?`,{...f.job,filters:"{}"});
});
integrationTest("TC-045 Export owner SET NULL preserves progress, file metadata and expiry",async t=>{
 const f=await setup(t),user=await f.insert("users",{username:"export-"+randomUUID(),password_hash:"synthetic-only",display_name:"Synthetic Exporter",created_at:f.now,updated_at:f.now});
 const [result]=await f.db.query(`INSERT INTO ${f.table} SET ?`,{...f.job,created_by:user,status:"COMPLETED",row_count:3,file_path:"owned/file.csv",started_at:f.now,completed_at:f.now+1,expires_at:f.now+604800000});
 await f.db.execute("DELETE FROM users WHERE id=?",[user]);
 const [[row]]=await f.db.query(`SELECT created_by,row_count,file_path,expires_at FROM ${f.table} WHERE id=?`,[result.insertId]);
 assert.equal(row.created_by,null);assert.equal(row.row_count,3);assert.equal(row.file_path,"owned/file.csv");assert.equal(Number(row.expires_at),f.now+604800000);
 await assert.rejects(()=>f.db.query(`INSERT INTO ${f.table} SET ?`,{...f.job,created_by:user}),{code:"ER_NO_REFERENCED_ROW_2"});
});
integrationTest("TC-045 Export migration rejects schema/index/check drift without rewriting facts",async t=>{
 for(const [ddl,expected] of [["MODIFY filters_hash CHAR(65) CHARACTER SET ascii COLLATE ascii_bin NOT NULL",/column filters_hash/u],["DROP INDEX idx_sales_export_lease",/index idx_sales_export_lease/u],["DROP CHECK chk_sales_export_filters",/checks/u]])await t.test(ddl,async t=>{
  const f=await setup(t);await f.db.query(`INSERT INTO ${f.table} SET ?`,f.job);
  await f.scoped.query(`ALTER TABLE sales_export_jobs ${ddl}`);await assert.rejects(()=>up(f.scoped),expected);
  assert.equal((await f.db.query(`SELECT COUNT(*) AS n FROM ${f.table}`))[0][0].n,1);
 });
});

integrationTest("TC-045 old0087 export schema upgrades through the actual runner with original ledger and data unchanged",async t=>{
 const f=await createFulfillmentArchiveDatabase(t,{legacyExportIdentity:true});
 const [oldLedger]=await f.db.query("SELECT name,applied_at FROM fr_schema_migrations ORDER BY name");assert.equal(oldLedger.length,90);
 await f.db.query("INSERT INTO sales_export_jobs(scope,filters,filters_hash,status,row_count,file_path,created_at) VALUES ('ACTIVE','{}',?,'COMPLETED',3,'synthetic.csv',?)",["a".repeat(64),1700000000000]);
 const [before]=await f.db.query("SELECT * FROM sales_export_jobs");const [[definition]]=await f.db.query("SHOW CREATE TABLE sales_export_jobs");
 const result=await f.migrate();assert.equal(result.code,0,result.stderr);
 const [after]=await f.db.query("SELECT * FROM sales_export_jobs");assert.deepEqual(after,before);
 const [[afterDefinition]]=await f.db.query("SHOW CREATE TABLE sales_export_jobs");assert.deepEqual(afterDefinition,definition);
 const [ledger]=await f.db.query("SELECT name,applied_at FROM fr_schema_migrations ORDER BY name");
 assert.deepEqual(ledger.filter(row=>oldLedger.some(old=>old.name===row.name)),oldLedger);
 assert.ok(ledger.some(row=>row.name===f.legacyExport));assert.ok(ledger.some(row=>row.name==="migrations/0090_create_sales_export_jobs.js"));
 assert.ok(ledger.some(row=>row.name==="migrations/0087_fix_supplier_sku_refs_sku_foreign_key.js"));
});

integrationTest("TC-045 incompatible old0087 schema fails closed without rewriting its old ledger or rows",async t=>{
 const f=await createFulfillmentArchiveDatabase(t,{legacyExportIdentity:true});
 await f.db.query("INSERT INTO sales_export_jobs(scope,filters,filters_hash,status,created_at) VALUES ('ACTIVE','{}',?,'QUEUED',?)",["a".repeat(64),1700000000000]);
 const [oldLedger]=await f.db.query("SELECT name,applied_at FROM fr_schema_migrations ORDER BY name");
 const [before]=await f.db.query("SELECT * FROM sales_export_jobs");
 await f.db.query("ALTER TABLE sales_export_jobs MODIFY file_path VARCHAR(501) NOT NULL DEFAULT ''");
 const result=await f.migrate();assert.notEqual(result.code,0);assert.match(result.stderr,/Incompatible existing Sales schema/u);
 const [after]=await f.db.query("SELECT * FROM sales_export_jobs");assert.deepEqual(after,before);
 const [ledger]=await f.db.query("SELECT name,applied_at FROM fr_schema_migrations ORDER BY name");
 assert.deepEqual(ledger.filter(row=>oldLedger.some(old=>old.name===row.name)),oldLedger);
 assert.ok(!ledger.some(row=>row.name==="migrations/0090_create_sales_export_jobs.js"));
});
