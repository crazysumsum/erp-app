import assert from "node:assert/strict";
import test from "node:test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import {archiveFactsFixture} from "../fulfillment/archiveFactsFixture.js";
const nativeTest=process.env.DB_INTEGRATION_TESTS==="1"?test:test.skip;
for(const mode of ["NORMAL","COMMITTED_ACK_LOST","ROLLED_BACK_ACK_LOST","OMITTED_OVERRIDE","RETRY_FAILED","LEASE_REVOKED","SIGNAL_REVOKED"])nativeTest(`P4 actual registered application Scheduler private Archive native18 state: ${mode}`,async t=>{
 const f=await archiveFactsFixture(t,{shipmentDate:"2023-11-14"});await promisify(execFile)(process.execPath,[fileURLToPath(new URL("../../scripts/migrate.js",import.meta.url))],{env:{...process.env,DB_NAME:f.f.name,DB_USER:f.f.connectionOptions.user,DB_PASSWORD:f.f.connectionOptions.password},timeout:180000,maxBuffer:1024*1024});const now=Date.now();await f.s.insert("sales_archive_batches",{batch_number:"SYNTHETIC-REGISTERED-ARCHIVE",period_key:"202610",cutoff_at:Date.parse("2024-10-01T18:00:00Z"),status:"RUNNING",started_at:now,updated_at:now});
 let result;try{result=await promisify(execFile)(process.execPath,["--import",fileURLToPath(new URL("../../test-support/testEnv.js",import.meta.url)),fileURLToPath(new URL("../sales/phase4/archiveApplicationChild.js",import.meta.url))],{env:{...process.env,DB_NAME:f.f.name,DB_USER:f.f.connectionOptions.user,DB_PASSWORD:f.f.connectionOptions.password,ARCHIVE_TEST_ORDER_ID:String(f.s.orderId),ARCHIVE_TEST_MODE:mode},timeout:90000,maxBuffer:1024*1024});}catch(error){throw new Error("Synthetic registered Archive child failed: "+error.stderr,{cause:error});}assert.match(result.stdout,/Inventory preservation PASS/u);
});
