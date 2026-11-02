import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { SALES_ARCHIVE_COLUMNS, hashSalesArchiveRow } from "../../src/modules/sales/salesArchiveHash.js";
import { createFulfillmentArchiveDatabase } from "../sales/phase4/fulfillmentArchiveFixtures.js";
import { seedFulfillmentSalesOrder } from "../sales/phase4/fulfillmentOwnerFixtures.js";

const integrationTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
integrationTest("Sales Archive hash uses real Sales contracts and survives mirror round trips",async t=>{
  const {db}=await createFulfillmentArchiveDatabase(t,{baseOnly:true}),f=await seedFulfillmentSalesOrder(db);
  const read=async(table,where,parameters)=>{
    const [columns]=await db.query("SELECT COLUMN_NAME,DATA_TYPE FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ORDINAL_POSITION",[table]);
    const projection=columns.filter(c=>SALES_ARCHIVE_COLUMNS[table.replace(/_archive$/u,"")].includes(c.COLUMN_NAME)).map(c=>c.DATA_TYPE==="bigint"||c.DATA_TYPE==="date"?`CAST(${c.COLUMN_NAME} AS CHAR) AS ${c.COLUMN_NAME}`:c.COLUMN_NAME).join(",");
    return (await db.query(`SELECT ${projection} FROM ${table} WHERE ${where}`,parameters))[0];
  };
  await t.test("all six live and mirror business columns exactly match the fixed catalog",async()=>{
    for(const [table,expected]of Object.entries(SALES_ARCHIVE_COLUMNS))for(const name of [table,`${table}_archive`]){
      const [columns]=await db.query("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ORDINAL_POSITION",[name]);
      assert.deepEqual(columns.map(c=>c.COLUMN_NAME).filter(c=>!["archive_batch_id","archived_at","row_hash"].includes(c)),expected);
    }
  });
  const batchId=await f.insert("sales_archive_batches",{batch_number:"HASH-SYNTHETIC",period_key:"202311",started_at:f.now,updated_at:f.now,cutoff_at:f.now,status:"RUNNING"});
  await t.test("native DATE, DECIMAL and nullable Sales order values survive copy and readback",async()=>{
    const [row]=await read("sales_orders","id=?",[f.orderId]),hash=hashSalesArchiveRow("sales_orders",row);
    await db.query("INSERT INTO sales_orders_archive SET ?",{...row,archive_batch_id:batchId,archived_at:f.now,row_hash:hash});
    const [copy]=await read("sales_orders_archive","id=?",[f.orderId]);
    assert.equal(hashSalesArchiveRow("sales_orders",copy),hash);
    for(const value of ["2023-02-29","2023-13-01","0000-00-00"])assert.throws(()=>hashSalesArchiveRow("sales_orders",{...row,order_date:value}),TypeError);
  });
  await t.test("native line DECIMAL scale and exact bigint values survive copy and readback",async()=>{
    const [row]=await read("sales_order_lines","id=?",[f.lineId]),hash=hashSalesArchiveRow("sales_order_lines",row);
    await db.query("INSERT INTO sales_order_lines_archive SET ?",{...row,archive_batch_id:batchId,archived_at:f.now,row_hash:hash});
    assert.equal(hashSalesArchiveRow("sales_order_lines",(await read("sales_order_lines_archive","id=?",[f.lineId]))[0]),hash);
  });
  await t.test("native JSON object key order is canonical while numeric fractions and arrays remain exact",async()=>{
    const id=await f.insert("sales_audit_logs",{occurred_at:f.now,actor_label:"Synthetic",action:"sales_order.cancelled",target_type:"ORDER",target_id:f.orderId,outcome:"SUCCESS",details:JSON.stringify({z:1.5,a:[null,true,{b:2,a:1}]}),event_id:randomUUID()});
    const [row]=await read("sales_audit_logs","id=?",[id]),hash=hashSalesArchiveRow("sales_audit_logs",row);
    assert.equal(hashSalesArchiveRow("sales_audit_logs",{...row,details:{a:[null,true,{a:1,b:2}],z:1.5}}),hash);
    assert.notEqual(hashSalesArchiveRow("sales_audit_logs",{...row,details:{a:[null,true,{a:1,b:2}],z:1.6}}),hash);
    await db.query("INSERT INTO sales_audit_logs_archive SET ?",{...row,details:JSON.stringify(row.details),archive_batch_id:batchId,archived_at:f.now,row_hash:hash});
    assert.equal(hashSalesArchiveRow("sales_audit_logs",(await read("sales_audit_logs_archive","id=?",[id]))[0]),hash);
    for(const details of [{bad:Infinity},{bad:Number.MAX_SAFE_INTEGER+1},new Date(),{bad:undefined}])assert.throws(()=>hashSalesArchiveRow("sales_audit_logs",{...row,details}),TypeError);
    const cycle={};cycle.self=cycle;assert.throws(()=>hashSalesArchiveRow("sales_audit_logs",{...row,details:cycle}),TypeError);
  });
});
