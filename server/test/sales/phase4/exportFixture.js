import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {rm} from "node:fs/promises";
import path from "node:path";
import {setup} from "../phase2/fixtures.js";
import {SalesExportService} from "../../../src/modules/sales/SalesExportService.js";
import {prepareDiskTempDirectory} from "../../../src/framework/upload/normalizeUploadConfig.js";

export async function exportFixture(t){
 const f=await setup(t),{url:httpUrl}=await f.app.start();f.exportStoreKeys=new Set();f.beforeParents.unshift(()=>f.app.shutdown("sales_export_test_complete"));const runtime=f.app.services.require("salesJobs"),scheduler=f.app.services.require("scheduler"),exports=runtime.exports;
 assert.ok(exports instanceof SalesExportService);const root=prepareDiskTempDirectory("storage/sales-export-test-"+randomUUID());exports.root=root;
 f.beforeParents.push(async()=>{for(const key of f.exportStoreKeys??[]){await f.db.execute("DELETE FROM fr_idempotency_keys WHERE store_key=?",[key]);const [[remaining]]=await f.db.query("SELECT COUNT(*) AS n FROM fr_idempotency_keys WHERE store_key=?",[key]);assert.equal(Number(remaining.n),0);}await f.db.execute("DELETE a FROM sales_audit_logs a JOIN sales_export_jobs j ON j.id=a.target_id WHERE j.created_by=? AND a.target_type='EXPORT_JOB' AND a.action='sales_export.expired' AND a.actor_user_id IS NULL AND a.actor_label='sales.fileRetention'",[f.userId]);await f.db.execute("DELETE FROM sales_export_jobs WHERE created_by=?",[f.userId]);assert.match(path.basename(root),/^sales-export-test-[a-f0-9-]+$/u);await rm(root,{recursive:true});});
 async function run(id){await scheduler.execute(scheduler.jobs.get("sales.exportWorker"));const [[row]]=await f.db.query("SELECT * FROM sales_export_jobs WHERE id=?",[id]);return row;}
 return {...f,exports,run,httpUrl};
}
