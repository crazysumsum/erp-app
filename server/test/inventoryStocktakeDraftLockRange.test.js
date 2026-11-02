import assert from "node:assert/strict";
import test from "node:test";
import { InventoryLockService } from "../src/modules/inventory/InventoryLockService.js";
import { InventoryStocktakeService } from "../src/modules/inventory/InventoryStocktakeService.js";
import { createFakeInventoryDatabase } from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

const time = { nowMs: () => 1791763200000 };
const header = { id: 41, warehouse_id: 1, stocktake_number: "ST-21", status: "DRAFT", version: 1, reason: "" };
const scope = { id: 101, stocktake_id: 41, bin_id: 1, bin_code_snapshot: "BIN-1" };
function command(action = "create", payload = { warehouseId: 1, binIds: [1, 2] }, changes = {}) {
  return inventoryCommandFixture({ actor: { claimedPermissions: ["inventory.operation"] },
    authorization: { purpose: `stocktake.${action}`, requiredCallerPermission: "inventory.operation" },
    source: { module: "INVENTORY", documentType: "STOCKTAKE", eventId: action }, payload, ...changes });
}
function fixture(initial = {}, overrides = {}) {
  const database = createFakeInventoryDatabase({ initialState: { headers: [], scopes: [], lines: [], locks: [], audits: [], ...initial },
    query: async ({ sql, params, state }) => {
      if (sql.includes("FROM inventory_warehouses")) return [overrides.warehouseRows??[{id:1,status:overrides.warehouseStatus??"ACTIVE"}]];
      if (sql.includes("FROM inventory_bins")) return [overrides.binRows??params.map(id=>({id,warehouse_id:1,bin_code:`BIN-${id}`,status:overrides.binStatus??"ACTIVE"}))];
      if (sql.includes("FROM inventory_bin_locks")) { await overrides.onBinRead?.(); return [overrides.activeLocks??[]]; }
      if (sql.includes("FROM inventory_stocktakes")) return [state.headers.filter(row => sql.includes("FOR UPDATE")
        ? row.warehouse_id === params[0] && (["DRAFT", "COUNTING", "READY_TO_POST"].includes(row.status) || row.id === params[1])
        : row.id === params[0])];
      if (sql.includes("FROM inventory_stocktake_bins")) return [state.scopes.filter(row => params.includes(row.stocktake_id))];
      if (sql.includes("FROM inventory_stock_balances")) return [initial.balances ?? []];
      return [[]];
    }, execute: async ({ sql, params, state }) => {
      await overrides.beforeWrite?.(sql,params,state);
      if (overrides.failSql?.test(sql)) throw new Error("synthetic write failure");
      if (sql.includes("INSERT INTO inventory_stocktakes")) {
        state.headers.push({ ...header, stocktake_number: params[0], warehouse_id: params[1], reason: params[3] });
        return [{ insertId: 41, affectedRows: 1 }];
      }
      if (sql.includes("DELETE FROM inventory_stocktake_bins")) state.scopes = state.scopes.filter(row => row.stocktake_id !== params[0]);
      if (sql.includes("INSERT INTO inventory_stocktake_bins")) state.scopes.push({ id: 101 + state.scopes.length,
        stocktake_id: params[0], bin_id: params[1], bin_code_snapshot: params[2] });
      if (sql.includes("INSERT INTO inventory_bin_locks")) state.locks.push(params);
      if (sql.includes("INSERT INTO inventory_stocktake_lines")) state.lines.push(params);
      if (sql.includes("UPDATE inventory_stocktakes")) {
        const row = state.headers.find(value => value.id === params.at(-2));
        if (row) { row.version += 1; row.status = sql.includes("'COUNTING'") ? "COUNTING" : sql.includes("'CANCELLED'") ? "CANCELLED" : "DRAFT"; }
      }
      return [{ affectedRows: 1 }];
    } });
  const lockCalls = [];
  const options = { database, time, logger: { error() {} }, authorize: async () => ({ username: "synthetic", permissions: ["inventory.operation"] }),
    audit: { recordSucceeded: async (tx, record) => tx.state.audits.push(record) },
    operations: { claim: async () => ({ operationId: 21 }), complete: async () => {} },
    locks: new InventoryLockService(), ...overrides };
  return { database, lockCalls, service: new InventoryStocktakeService(options) };
}

function recorder({active=[],fail}={}) {const calls=[];const tx={query:async(sql,params)=>{calls.push({sql,params});if(fail)throw fail;if(sql.includes('FROM inventory_warehouses'))return [[{id:1,status:'ACTIVE'}]];if(sql.includes('FROM inventory_bins'))return [params.map(id=>({id,warehouse_id:1,status:'ACTIVE'}))];return [active];},execute:async()=>{throw Error('Lock entry must not write SQL itself');}};return{tx,calls};}
const locks=new InventoryLockService();
const input={warehouseIds:[1],binIds:[2,1]};
test('DL-U01 invalid executor/scope/callback does no SQL',async()=>{for(const value of [{warehouseIds:[],binIds:[1]},{warehouseIds:[1,2],binIds:[1]},{warehouseIds:[1],binIds:[]},{warehouseIds:[0],binIds:[1]},{warehouseIds:[1],binIds:['1']}]){const r=recorder();await assert.rejects(()=>locks.lockForStocktakeDraftCreate(r.tx,value,async()=>({})));assert.equal(r.calls.length,0);}await assert.rejects(()=>locks.lockForStocktakeDraftCreate(null,input,async()=>({})));const r=recorder();await assert.rejects(()=>locks.lockForStocktakeDraftCreate(r.tx,input,null));assert.equal(r.calls.length,0);});
test('DL-U02 exact row order/dedup and callback once before active read',async()=>{const r=recorder();let count=0;const draft={id:99};const value=await locks.lockForStocktakeDraftCreate(r.tx,{warehouseIds:[1,1],binIds:[2,1,2]},async row=>{count++;assert.deepEqual(row.bins.map(x=>x.id),[1,2]);assert.equal(r.calls.length,2);return draft;});assert.equal(count,1);assert.equal(value.draft,draft);assert.deepEqual(r.calls.map(x=>x.params),[[1],[1,2],[1,2]]);assert.match(r.calls[2].sql,/FOR UPDATE/u);});
test('DL-U03 caller executor only; no transaction commit/connection API',async()=>{const r=recorder();await locks.lockForStocktakeDraftCreate(r.tx,input,async()=>({}));assert.equal(r.calls.length,3);});
test('DL-U04 callback error stops active read and preserves identity',async()=>{const r=recorder(),error=new Error('draft write failure');await assert.rejects(()=>locks.lockForStocktakeDraftCreate(r.tx,input,async()=>{throw error;}),x=>x===error);assert.equal(r.calls.length,2);});
test('DL-U05 active lock is rejected after draft callback',async()=>{const r=recorder({active:[{id:1,bin_id:1}]});let written=false;await assert.rejects(()=>locks.lockForStocktakeDraftCreate(r.tx,input,async()=>{written=true;return{id:99};}),{code:'BIN_LOCKED_BY_STOCKTAKE'});assert.ok(written);});
test('DL-U06 SQL failure mapping preserved without retry',async()=>{for(const code of ['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT']){const r=recorder({fail:Object.assign(new Error(code),{code})});await assert.rejects(()=>locks.lockForStocktakeDraftCreate(r.tx,input,async()=>({})),{code:'CONCURRENT_OPERATION'});assert.equal(r.calls.length,1);}});
test('DL-U07 unrelated SQL error is not swallowed',async()=>{const error=Object.assign(new Error('DB transport'),{code:'ECONNRESET'}),r=recorder({fail:error});await assert.rejects(()=>locks.lockForStocktakeDraftCreate(r.tx,input,async()=>({})),x=>x===error);});
test('DL-U08 all scopes then active read then current auth then Audit/completion',async()=>{const finish=[];const f=fixture({}, {authorize:async tx=>{await tx.query('SELECT unit_authorization');return{username:'synthetic',permissions:['inventory.operation']};},audit:{recordSucceeded:async(tx,row)=>{finish.push({kind:'Audit',calls:f.database.calls.length});tx.state.audits.push(row);}},operations:{claim:async()=>({operationId:21}),complete:async()=>finish.push({kind:'complete',calls:f.database.calls.length})}});await f.service.create(command());const calls=f.database.calls,read=calls.findIndex(x=>x.sql.includes('FROM inventory_bin_locks')),write=calls.findIndex(x=>x.sql.includes('INSERT INTO inventory_stocktakes')),auth=calls.map((x,i)=>({x,i})).filter(v=>v.x.sql.includes('unit_authorization'));assert.equal(calls.filter((x,i)=>i<read&&x.sql.includes('INSERT INTO inventory_stocktake_bins')).length,2);assert.equal(auth.length,3);assert.ok(auth[1].i<write);assert.match(auth[1].x.sql,/FOR SHARE$/u);assert.ok(auth[2].i>read);assert.match(auth[2].x.sql,/FOR SHARE$/u);assert.deepEqual(finish.map(x=>x.kind),['Audit','complete']);assert.ok(finish.every(x=>x.calls>auth[2].i));});
test('DL-U09 late active lock rolls back header/all scopes/audit',async()=>{let finish=0;const f=fixture({}, {activeLocks:[{id:1,bin_id:2}],audit:{recordSucceeded:async()=>{finish++;}},operations:{claim:async()=>({operationId:21}),complete:async()=>{finish++;}}});await assert.rejects(()=>f.service.create(command()),{code:'BIN_LOCKED_BY_STOCKTAKE'});assert.deepEqual(f.database.state.headers,[]);assert.deepEqual(f.database.state.scopes,[]);assert.deepEqual(f.database.state.audits,[]);assert.equal(finish,0);});
test('DL-U10 auth failure after final read stops finish; business invalidity stops writes',async()=>{let n=0,finish=0;const f=fixture({}, {authorize:async()=>({username:'synthetic',permissions:++n===3?[]:['inventory.operation']}),audit:{recordSucceeded:async()=>{finish++;}},operations:{claim:async()=>({operationId:21}),complete:async()=>{finish++;}}});await assert.rejects(()=>f.service.create(command()),{code:'PERMISSION_STALE'});assert.equal(n,3);assert.equal(finish,0);assert.deepEqual(f.database.state.headers,[]);assert.deepEqual(f.database.state.scopes,[]);
 for(const [state,options,code] of [[{}, {warehouseRows:[]},'WAREHOUSE_INVALID'],[{}, {binRows:[]},'BIN_INVALID'],[{}, {warehouseStatus:'INACTIVE'},'WAREHOUSE_INVALID'],[{}, {binStatus:'INACTIVE'},'BIN_INVALID'],[{}, {binRows:[{id:1,warehouse_id:2,status:'ACTIVE'},{id:2,warehouse_id:1,status:'ACTIVE'}]},'BIN_WAREHOUSE_MISMATCH'],[{headers:[{...header,id:42}],scopes:[{...scope,stocktake_id:42}]},{},'STOCKTAKE_STATE_CONFLICT']]){let ended=0;const g=fixture(state,{...options,audit:{recordSucceeded:async()=>{ended++;}}});await assert.rejects(()=>g.service.create(command()),{code});assert.equal(ended,0);assert.equal(g.database.calls.some(x=>x.sql.includes('INSERT INTO inventory_stocktakes')||x.sql.includes('INSERT INTO inventory_stocktake_bins')||x.sql.includes('FROM inventory_bin_locks')),false);}
 let a=0;const g=fixture({}, {authorize:async()=>({permissions:++a===2?[]:['inventory.operation']})});await assert.rejects(()=>g.service.create(command()),{code:'PERMISSION_STALE'});assert.equal(g.database.calls.some(x=>x.sql.includes('INSERT INTO inventory_stocktakes')||x.sql.includes('FROM inventory_bin_locks')),false);
});
test('DL-U11 second scope sentinel and finish faults roll back without masking errors',async()=>{for(const point of ['header','secondscope','Audit','complete']){const error=new Error('sentinel '+point);let writes=0,finish=0;const f=fixture({}, {beforeWrite:async sql=>{if(point==='header'&&sql.includes('INSERT INTO inventory_stocktakes'))throw error;if(point==='secondscope'&&sql.includes('INSERT INTO inventory_stocktake_bins')&&++writes===2)throw error;},audit:{recordSucceeded:async(tx,row)=>{finish++;if(point==='Audit')throw error;tx.state.audits.push(row);}},operations:{claim:async()=>({operationId:21}),complete:async()=>{finish++;if(point==='complete')throw error;}}});await assert.rejects(()=>f.service.create(command()),x=>x===error);assert.deepEqual(f.database.state.headers,[]);assert.deepEqual(f.database.state.scopes,[]);assert.deepEqual(f.database.state.audits,[]);if(point==='secondscope'){assert.equal(writes,2);assert.equal(finish,0);assert.equal(f.database.calls.filter(x=>x.sql.includes('INSERT INTO inventory_stocktake_bins')).length,2);assert.equal(f.database.calls.some(x=>x.sql.includes('FROM inventory_bin_locks')),false);}}});
test('DL-U12 replay original scalar rechecks current auth without lock callback/write/finish',async()=>{const result={id:41,operationId:21,status:'DRAFT',version:1,rowCount:2};let finish=0;const f=fixture({}, {authorize:async tx=>{await tx.query('SELECT unit_replay_auth');return{permissions:['inventory.operation']};},operations:{claim:async()=>({replay:{resultSummary:result}}),complete:async()=>{finish++;}},audit:{recordSucceeded:async()=>{finish++;}}});assert.deepEqual(await f.service.create(command()),result);assert.equal(f.database.calls.length,2);assert.match(f.database.calls[1].sql,/FOR SHARE$/u);assert.equal(finish,0);});
