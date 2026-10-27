import assert from "node:assert/strict";
import test from "node:test";
import { capacityDiagnostics,isInjectedCapacityFailure } from "./p1CapacityDiagnostics.js";

test("Capacity diagnostics preserve executor, callback signal, options, values and rejection identity without logging input",async()=>{
 const after=[],messages=[],calls=[],tx={query(...args){calls.push(args);return Promise.resolve("query-result");},execute(...args){calls.push(args);return Promise.resolve("execute-result");}},query=tx.query,execute=tx.execute,signal=new AbortController().signal,options={timeoutMs:20000,isolationLevel:"READ COMMITTED"};
 const database={config:{transactionTimeoutMs:20000},withTransaction(work,received){assert.equal(this,database);assert.equal(received,options);return work(tx,{signal});}},original=database.withTransaction;
 const profile=capacityDiagnostics({after:fn=>after.push(fn),diagnostic:line=>messages.push(JSON.parse(line))},database),result={saved:true};
 assert.equal(await profile.phase("ALLOCATE",()=>database.withTransaction(async(actual,context)=>{assert.equal(actual,tx);assert.equal(context.signal,signal);assert.equal(await actual.query("SELECT private_payload FROM inventory_reservations WHERE id=?",["must-not-log-this"]),"query-result");await actual.execute("UPDATE inventory_allocations SET version=version+1 WHERE id=?",[1]);return result;},options)),result);
 assert.equal(tx.query,query);assert.equal(tx.execute,execute);const error=Object.assign(new Error("must-not-log-this-error"),{code:"DATABASE_TRANSACTION_TIMEOUT"});
 await assert.rejects(()=>profile.phase("PICK",()=>database.withTransaction(()=>{throw error;},options)),actual=>actual===error);
 after.forEach(fn=>fn());assert.equal(database.withTransaction,original);const report=messages.at(-1);assert.equal(report.transactions.length,2);assert.equal(report.transactions[0].queries,1);assert.equal(report.transactions[0].executes,1);assert.equal(report.transactions[0].timeoutMs,20000);assert.equal(report.transactions[1].errorCode,"DATABASE_TRANSACTION_TIMEOUT");assert.equal(report.transactions[1].callbackSettled,true);assert.equal(report.phases.PICK.failed,1);assert.equal(JSON.stringify(report).includes("must-not-log"),false);assert.equal(JSON.stringify(report).includes("private_payload"),false);assert.equal(calls.length,2);
});

test("Capacity provider timings preserve method this, argument and failure identity",async()=>{
 const after=[],messages=[],proof={},error=Object.assign(new Error("private failure text"),{code:"ALLOCATION_STATE_CONFLICT"}),owner={value:proof,async read(value){assert.equal(this,owner);assert.equal(value,proof);return value;},async fail(){throw error;}},original=owner.read,database={config:{transactionTimeoutMs:20000},withTransaction(){}};
 const profile=capacityDiagnostics({after:fn=>after.push(fn),diagnostic:line=>messages.push(JSON.parse(line))},database);profile.provider(owner,"read","ownerRead");profile.provider(owner,"fail","ownerFail");
 assert.equal(await profile.phase("PREVIEW",()=>owner.read(proof)),proof);await assert.rejects(()=>profile.phase("PREVIEW",()=>owner.fail()),actual=>actual===error);after.forEach(fn=>fn());assert.equal(owner.read,original);assert.equal(messages[0].providers["PREVIEW:ownerRead"].completed,1);assert.equal(messages[0].providers["PREVIEW:ownerFail"].failed,1);assert.equal(JSON.stringify(messages).includes("private failure text"),false);
});

test("Capacity fault proof accepts only the exact native synthetic45000 failure, never timeout or another guard",()=>{
 const marker="Synthetic final Pick projection batch failure",native={sqlState:"45000",code:"ER_SIGNAL_EXCEPTION",errno:1644,sqlMessage:marker};
 assert.equal(isInjectedCapacityFailure({code:"DATABASE_OPERATION_FAILED",cause:native},marker),true);
 assert.equal(isInjectedCapacityFailure({code:"DATABASE_TRANSACTION_TIMEOUT",cause:native},marker),false);
 assert.equal(isInjectedCapacityFailure({code:"DATABASE_OPERATION_FAILED",cause:{...native,sqlMessage:"Different immutable business guard"}},marker),false);
 assert.equal(isInjectedCapacityFailure({code:"DATABASE_OPERATION_FAILED",cause:{...native,sqlState:"HY000"}},marker),false);
 assert.equal(isInjectedCapacityFailure(new Error(marker),marker),false);
});

test("Capacity timeout diagnostics distinguish a rejected transaction from a callback still unwinding",async()=>{
 const after=[],messages=[],entered=Promise.withResolvers(),unwind=Promise.withResolvers(),error=Object.assign(new Error("private timeout"),{code:"DATABASE_TRANSACTION_TIMEOUT"}),tx={query(){},execute(){}};
 let callback;const database={config:{transactionTimeoutMs:20000},withTransaction(work){callback=work(tx,{signal:new AbortController().signal});return entered.promise.then(()=>{throw error;});}};
 const profile=capacityDiagnostics({after:fn=>after.push(fn),diagnostic:line=>messages.push(JSON.parse(line))},database);await assert.rejects(()=>profile.phase("CANCEL",()=>database.withTransaction(async()=>{entered.resolve();await unwind.promise;})),actual=>actual===error);after.forEach(fn=>fn());assert.equal(messages[0].transactions[0].callbackSettled,false);assert.equal(messages[0].transactions[0].promiseSettled,true);unwind.resolve();await callback;
});

test("Capacity provider statement totals are inclusive client calls without adding SQL",async()=>{
 const after=[],messages=[],tx={query(){return Promise.resolve([]);},execute(){return Promise.resolve([]);}},database={config:{transactionTimeoutMs:20000},withTransaction(work){return work(tx);}},owner={async read(actual){await actual.query("SELECT 1");await actual.execute("UPDATE inventory_allocations SET version=version+1");}};
 const profile=capacityDiagnostics({after:fn=>after.push(fn),diagnostic:line=>messages.push(JSON.parse(line))},database);profile.provider(owner,"read","ownerRead");assert.throws(()=>profile.provider(owner,"read","ownerRead"),/Duplicate capacity provider diagnostic/u);await profile.phase("ALLOCATE",()=>database.withTransaction(actual=>owner.read(actual)));after.forEach(fn=>fn());assert.equal(messages[0].providers["ALLOCATE:ownerRead"].queries,1);assert.equal(messages[0].providers["ALLOCATE:ownerRead"].executes,1);assert.deepEqual(messages[0].transactions[0].families,{SELECT:1,UPDATE:1});
});
