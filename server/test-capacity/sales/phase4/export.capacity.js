import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import path from "node:path";
import {exportFixture} from "../../../test/sales/phase4/exportFixture.js";
const integrationTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;

// Existing full-capacity case, manually invoked only after related functional UAT.
integrationTest("TC-045 Export completes its full 250000-row supported cap within the actual worker and transaction budgets",{timeout:180000},async t=>{
 const f=await exportFixture(t),prefix="EX"+randomUUID().replaceAll("-","").slice(0,8);
 const [headerColumns]=await f.db.query("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_orders' AND COLUMN_NAME<>'id' ORDER BY ORDINAL_POSITION"),[lineColumns]=await f.db.query("SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='sales_order_lines' AND COLUMN_NAME<>'id' ORDER BY ORDINAL_POSITION");
 const quote=name=>{assert.match(name,/^[a-z_]+$/u);return "`"+name+"`";},headers=headerColumns.map(x=>quote(x.name)).join(","),headerSelect=headerColumns.map(x=>x.name==="sales_order_number"?"CONCAT(?,LPAD(n.n,6,'0'))":"o."+quote(x.name)).join(",");
 for(let start=1;start<250000;start+=1000){const values=Array.from({length:Math.min(1000,250000-start)},(_,i)=>start+i);await f.db.query(`INSERT INTO sales_orders(${headers}) SELECT ${headerSelect} FROM sales_orders o JOIN JSON_TABLE(?,'$[*]' COLUMNS(n INT PATH '$')) n ON TRUE WHERE o.id=?`,[prefix,JSON.stringify(values),f.request.id]);}
 const lines=lineColumns.map(x=>quote(x.name)).join(","),lineSelect=lineColumns.map(x=>x.name==="sales_order_id"?"o.id":"l."+quote(x.name)).join(",");await f.db.query(`INSERT INTO sales_order_lines(${lines}) SELECT ${lineSelect} FROM sales_orders o JOIN sales_order_lines l ON l.sales_order_id=? WHERE o.customer_id=? AND o.id<>?`,[f.request.id,f.customerId,f.request.id]);
 for(const sortBy of ["orderDate","totalAmount"]){
  const created=await f.exports.create({claims:f.claims,eventId:randomUUID(),input:{scope:"ACTIVE",filters:{customerId:f.customerId,sortBy}}}),started=performance.now();global.gc?.();const memoryBefore=process.memoryUsage(),peak={...memoryBefore},retainedPeak={...memoryBefore},sample=setInterval(()=>{let memory=process.memoryUsage();for(const key of Object.keys(peak))peak[key]=Math.max(peak[key],memory[key]);if(global.gc){global.gc();memory=process.memoryUsage();for(const key of Object.keys(retainedPeak))retainedPeak[key]=Math.max(retainedPeak[key],memory[key]);}},100);let row;try{row=await f.run(created.id);}finally{clearInterval(sample);}const durationMs=performance.now()-started;t.diagnostic(JSON.stringify({sortBy,retainedMemoryGc:typeof global.gc==="function",retainedMemoryDelta:Object.fromEntries(Object.keys(retainedPeak).map(key=>[key,Math.max(0,retainedPeak[key]-memoryBefore[key])])),memoryDelta:Object.fromEntries(Object.keys(peak).map(key=>[key,Math.max(0,peak[key]-memoryBefore[key])])),exportRows:Number(row.row_count),durationMs,transactionTimeoutMs:f.database.config.transactionTimeoutMs,schedulerTimeoutMs:f.app.services.require("scheduler").jobs.get("sales.exportWorker").timeoutMs}));assert.equal(row.status,"COMPLETED");assert.equal(Number(row.row_count),250000);assert.ok(durationMs<30000);
  let rows=0;const {createReadStream}=await import("node:fs"),{parse:streamParser}=await import("csv-parse");for await(const csvRow of createReadStream(path.join(f.exports.root,row.file_path)).pipe(streamParser({bom:true,columns:true}))){assert.equal(csvRow.orderedBaseQuantity,"10");rows++;}assert.equal(rows,250000);
 }
});
