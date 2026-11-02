import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {postingDiagnostics,tracePostingAsync} from "./p1PostingDiagnostics.js";

function fixture(){const after=[],messages=[],database={config:{transactionTimeoutMs:20000}};return {database,messages,profile:postingDiagnostics({after:fn=>after.push(fn),diagnostic:text=>messages.push(JSON.parse(text))},database),finish(){after.forEach(fn=>fn());return messages[0];}};}



















test("Original native absent-Stocktake guard is classified without accepting partial schema or timeout",async()=>{
 const source=await readFile(new URL("../../src/modules/inventory/InventoryLockService.js",import.meta.url),"utf8"),{parse}=createRequire(import.meta.url)("acorn"),ast=parse(source,{ecmaVersion:"latest",sourceType:"module"}),fn=ast.body.find(node=>node.type==="FunctionDeclaration"&&node.id.name==="lockActiveBinLocks"),AsyncFunction=Object.getPrototypeOf(async()=>{}).constructor;
 const originalGuard=new AsyncFunction("connection","binIds",source.slice(fn.body.start+1,fn.body.end-1));
 for(const tableCount of [0,1,2]){
  const f=fixture(),error={code:"DATABASE_OPERATION_FAILED",cause:{code:"ER_NO_SUCH_TABLE"}},tx={async query(sql){if(sql.includes("information_schema.tables"))return [Array.from({length:tableCount},()=>({table_name:"private-name"}))];throw error;},execute(){}},owner={post(actual){return tracePostingAsync("POST_BATCH",()=>originalGuard(actual,[1]));}};f.profile.provider(owner,"post");
  if(tableCount===0)assert.deepEqual(await owner.post(tx),[]);else await assert.rejects(()=>owner.post(tx),actual=>actual===error);
  const record=f.finish().records[0];assert.equal(record.sql.STOCKTAKE_LOCK_PROBE.failed,1);assert.deepEqual(record.sql.STOCKTAKE_LOCK_PROBE.errorCodes,["DATABASE_OPERATION_FAILED","ER_NO_SUCH_TABLE"]);assert.equal(record.sql.STOCKTAKE_SCHEMA_PROOF.returnedRows,tableCount);assert.equal(JSON.stringify(record).includes("private-name"),false);
 }
 const timeout={code:"DATABASE_TRANSACTION_TIMEOUT"};let calls=0;await assert.rejects(()=>originalGuard({async query(){calls++;throw timeout;}},[1]),actual=>actual===timeout);assert.equal(calls,1);
});
