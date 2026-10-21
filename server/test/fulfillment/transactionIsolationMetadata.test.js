import assert from "node:assert/strict";
import test from "node:test";
import { MySqlDatabaseService,getActiveTransactionIsolation } from "../../src/services/mysqldatabase/MySqlDatabaseService.js";
function fixture(overrides={}) {
  let current={};const context={get:()=>current,update:values=>{current={...current,...values};}};
  const connection={async query(){return [[]];},async execute(){return [{affectedRows:1}];},async beginTransaction(){},async commit(){},async rollback(){},release(){},destroy(){},...overrides};
  const pool={query:connection.query,getConnection:async()=>connection};
  return {database:new MySqlDatabaseService({pool,context,config:{acquireTimeoutMs:1000,queryTimeoutMs:1000,transactionTimeoutMs:1000}}),context};
}
test("DB owner isolation metadata exists only for the actual active executor, never a clone or completed callback",async()=>{
  const f=fixture();let actual;
  assert.equal(getActiveTransactionIsolation(null),null);
  await f.database.withTransaction(async tx=>{
    actual=tx;assert.equal(getActiveTransactionIsolation(tx),"READ COMMITTED");
    assert.equal(f.context.get().databaseTransaction,tx);
    assert.equal(getActiveTransactionIsolation({...tx}),null);
  },{isolationLevel:"read committed"});
  assert.equal(getActiveTransactionIsolation(actual),null);
  await f.database.withTransaction(async tx=>{assert.equal(getActiveTransactionIsolation(tx),"REPEATABLE READ");});
});
test("DB owner isolation metadata is revoked before COMMIT/rollback and when abort fires",async()=>{
  let tx,commitSeen=false,rollbackSeen=false;
  const f=fixture({async commit(){commitSeen=true;assert.equal(getActiveTransactionIsolation(tx),null);},async rollback(){rollbackSeen=true;assert.equal(getActiveTransactionIsolation(tx),null);}});
  await f.database.withTransaction(async value=>{tx=value;});assert.equal(commitSeen,true);
  await assert.rejects(f.database.withTransaction(async value=>{tx=value;throw new Error("synthetic rollback");}));
  assert.equal(rollbackSeen,true);assert.equal(getActiveTransactionIsolation(tx),null);
  const controller=new AbortController();
  await assert.rejects(f.database.withTransaction(async value=>{tx=value;controller.abort(new Error("synthetic abort"));assert.equal(getActiveTransactionIsolation(tx),null);},{signal:controller.signal}));
  assert.equal(getActiveTransactionIsolation(tx),null);
});
