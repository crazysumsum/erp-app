import assert from "node:assert/strict";
import test from "node:test";
import {salesArchiveWindow,SalesArchiveBatchService} from "../../../src/modules/sales/SalesArchiveBatchService.js";
test("monthly Archive window and24 calendar month cutoff use HKT with leap-day clamping",()=>{
 assert.deepEqual(salesArchiveWindow(Date.parse("2026-10-01T18:30:00Z"),{archiveDayOfMonth:2,archiveHourHkt:2}),{periodKey:"202610",inWindow:true,cutoffMs:Date.parse("2024-10-01T18:30:00Z")});
 assert.equal(salesArchiveWindow(Date.parse("2024-02-29T18:30:00+08:00"),{}).cutoffMs,Date.parse("2022-02-28T18:30:00+08:00"));
 assert.equal(salesArchiveWindow(Date.parse("2026-10-01T19:00:00Z"),{}).inWindow,false);
});
test("unregistered Archive worker cannot discover or start a mutation transaction",async()=>{
 let calls=0;const service=new SalesArchiveBatchService({database:{query(){calls++;},withTransaction(){calls++;}},authorizeJob:()=>null});await assert.rejects(()=>service.runBatch({signal:new AbortController().signal}),{code:"SALES_ARCHIVE_FORBIDDEN"});assert.equal(calls,0);
});
