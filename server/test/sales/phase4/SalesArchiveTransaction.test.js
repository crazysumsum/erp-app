import assert from "node:assert/strict";
import test from "node:test";
import {SalesArchiveService} from "../../../src/modules/sales/SalesArchiveService.js";
test("Sales Archive cannot start a transaction or accept forged authority",async()=>{
 let calls=0;const tx={query(){calls++;},execute(){calls++;}},service=new SalesArchiveService({database:{context:{get:()=>({databaseTransaction:tx})}}});
 await assert.rejects(()=>service.archiveOrderInTransaction(tx,{orderId:"1",archiveBatchId:"1",cutoffMs:1,archivedAtMs:2}),{code:"SALES_ARCHIVE_FORBIDDEN"});assert.equal(calls,0);
});
test("Sales Archive validates own data scope before any SQL or authorizer",async()=>{
 let calls=0;const service=new SalesArchiveService({authorizeArchive(){calls++;return true;}}),input={orderId:"1",archiveBatchId:"1",cutoffMs:1,archivedAtMs:2};
 for(const value of [{...input,actor:"sales.archive"},{...input,orderId:1},{...input,archivedAtMs:0},Object.defineProperty({...input},"cutoffMs",{get(){throw new Error("Getter ran");}})])await assert.rejects(()=>service.archiveOrderInTransaction({},value),TypeError);
 assert.equal(calls,0);
});
