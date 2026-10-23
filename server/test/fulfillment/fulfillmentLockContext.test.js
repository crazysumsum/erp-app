import assert from "node:assert/strict";
import test from "node:test";
import {spawnSync} from "node:child_process";
import {sortedFulfillmentIds,lockFulfillmentRowsInTransaction} from "../../src/modules/fulfillment/FulfillmentLockService.js";
test("P0 sorted identifiers deduplicate canonical safe IDs without input mutation",()=>{
  const ids=["12",2,"3","2",1];assert.deepEqual(sortedFulfillmentIds(ids),["1","2","3","12"]);assert.deepEqual(ids,["12",2,"3","2",1]);
  for(const invalid of [null,["0"],["01"],["1e1"],[Number.MAX_SAFE_INTEGER+1],[-1],[{}]])assert.throws(()=>sortedFulfillmentIds(invalid));
});
test("P0 fixed lock scope rejects unsafe table/executor before any SQL",async()=>{
  let called=false;const tx={query(){called=true;}};
  for(const table of ["fulfillments","users","fulfillments; DROP TABLE users"])await assert.rejects(lockFulfillmentRowsInTransaction(tx,table,["1"]),TypeError);assert.equal(called,false);
});
for(const [value,enabled] of [[undefined,false],["false",false],["true",true]])test(`P0 actual discovery activation ${String(value)} is explicit and stable`,()=>{
  const env={...process.env};if(value===undefined)delete env.FULFILLMENT_LIFECYCLE_ENABLED;else env.FULFILLMENT_LIFECYCLE_ENABLED=value;
  const result=spawnSync(process.execPath,["--input-type=module","-e",`import {discoverServiceDefinitions} from './server/src/framework/services/serviceDiscovery.js';const d=(await discoverServiceDefinitions()).find(d=>d.name==='fulfillmentOpenMatter');if(!d||d.enabled!==${enabled}||d.eager!==false||d.lifecycle!=='singleton'||d.dependencies.join(',')!=='mysqldatabase')process.exit(2);`],{cwd:new URL("../../../",import.meta.url),env,encoding:"utf8",timeout:10000});assert.ifError(result.error);assert.equal(result.status,0,result.stderr);
});
test("P0 invalid activation fails actual startup before database access/listen",()=>{
  const result=spawnSync(process.execPath,["server/src/index.js"],{cwd:new URL("../../../",import.meta.url),env:{...process.env,FULFILLMENT_LIFECYCLE_ENABLED:"TRUE",DB_SOCKET_PATH:"/nonexistent-fulfillment-test.sock",PORT:"0"},encoding:"utf8",timeout:10000});assert.ifError(result.error);assert.equal(result.status,1);assert.match(result.stderr,/FULFILLMENT_LIFECYCLE_ENABLED/);assert.doesNotMatch(result.stdout+result.stderr,/API listening|DATABASE_OPERATION_FAILED/);
});
