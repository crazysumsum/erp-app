import assert from "node:assert/strict";
import test from "node:test";
import {salesArchiveTransactionFixture,snapshotSalesArchiveTransaction} from "./salesArchiveTransaction.integration.test.js";
import {SALES_ARCHIVE_COLUMNS} from "../../src/modules/sales/salesArchiveHash.js";
import {FULFILLMENT_ARCHIVE_CONTRACTS} from "../../src/modules/fulfillment/fulfillmentArchiveSchema.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
const tables=[...Object.keys(SALES_ARCHIVE_COLUMNS),...FULFILLMENT_ARCHIVE_CONTRACTS.map(c=>c.table)];
for(const stage of ["COPY","VERIFY","REMOVE"])for(const table of tables)nativeTest(`TC-048 real18-class joint transaction ${stage} failure at ${table} preserves the complete aggregate`,async t=>{
 const f=await salesArchiveTransactionFixture(t);
 // Keep the formal schema byte-identical: readiness correctly rejects foreign owner triggers before business effects.
 // Inject each fault on the real bound connection after all earlier native statements, never replace the database with a fake.
 const before=await snapshotSalesArchiveTransaction(f);for(const original of tables)assert.ok(before[original].length,original);let reached=false,verifiedCorruption=false;
 await assert.rejects(()=>f.run(async(tx,sales)=>{
  const execute=tx.execute.bind(tx);tx.execute=async(sql,args)=>{const target=stage==="REMOVE"?`DELETE FROM ${table} WHERE`:`INSERT INTO ${table}_archive `;if(sql.startsWith(target)){reached=true;if(stage!=="VERIFY")await tx.query("SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic isolated joint failure'");else{args=[...args];const count=(args.length-2)/3;assert.ok(Number.isInteger(count)&&count>0);for(let i=3;i<2+2*count;i+=2)args[i]="b".repeat(64);}}const result=await execute(sql,args);if(stage==="VERIFY"&&sql.startsWith(target)){const [[copied]]=await tx.query(`SELECT row_hash FROM ${table}_archive ORDER BY id LIMIT 1`);assert.equal(copied.row_hash,"b".repeat(64));verifiedCorruption=true;}return result;};
  await sales.archiveOrderInTransaction(tx,f.command);
 }),error=>stage==="VERIFY"?error.cause?.code==="ARCHIVE_DATA_CONFLICT":error.cause?.cause?.code==="ER_SIGNAL_EXCEPTION"||error.cause?.code==="ER_SIGNAL_EXCEPTION");
 assert.equal(reached,true,"The exact real native copy/delete statement must be reached");if(stage==="VERIFY")assert.equal(verifiedCorruption,true,"The incorrect stored mirror hash must be read back before failure");assert.deepEqual(await snapshotSalesArchiveTransaction(f),before);
});
