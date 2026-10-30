import assert from "node:assert/strict";
import test from "node:test";
import { InventoryStocktakeService } from "../src/modules/inventory/InventoryStocktakeService.js";
import { InventoryInquiryService } from "../src/modules/inventory/InventoryInquiryService.js";
import { InventoryOperationService } from "../src/modules/inventory/InventoryOperationService.js";
import { createFakeInventoryDatabase } from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

const time = { nowMs: () => 1791763200000, fileDate: () => "2026-10-12" }, logger = { error() {} };
const header = { id:41,warehouse_id:1,stocktake_number:"ST-41",status:"COUNTING",version:2,reason:"" };
const scope = { id:101,stocktake_id:41,bin_id:1 };
const line = { id:201,stocktake_id:41,stocktake_bin_id:101,bin_id:1,sku_id:12,lot_id:null,lot_scope:0,stock_status:"AVAILABLE",
  snapshot_quantity:4,snapshot_balance_version:1,counted_quantity:null,is_not_found:0,variance_quantity:null,version:1,counted_at:null,counted_by:null };
let event = 0;
function command(action, payload) {
  return inventoryCommandFixture({actor:{claimedPermissions:["inventory.operation"]},authorization:{purpose:`stocktake.${action}`,requiredCallerPermission:"inventory.operation"},
    source:{module:"INVENTORY",documentType:"STOCKTAKE",documentId:"synthetic-unit037",eventId:`event-${++event}`},payload});
}
function save(lines=[{lineId:201,expectedVersion:1,countedQuantity:0}]) { return command("count",{stocktakeId:41,lines}); }
function add(changes={}) { return command("add_line",{stocktakeId:41,binId:1,skuId:12,lotId:null,stockStatus:"QUARANTINED",...changes}); }
function fixture(initial={}, options={}) {
  const database=createFakeInventoryDatabase({initialState:{headers:[header],scopes:[scope],lines:[line,{...line,id:202,stock_status:"DAMAGED"}],
    operations:[],audits:[],balances:[],lots:[{id:1,sku_id:13,expiry_date:"2020-01-01",manufacture_date:null}],...initial},
    failAt:options.failAt,
    query:async({sql,params,state})=>{
      if(sql.includes("FROM inventory_operation_requests")) return [state.operations.filter(row=>row.source===JSON.stringify(params))];
      if(sql.includes("FROM inventory_stocktakes")) return [state.headers.filter(row=>row.id===params[0]).map(row=>sql.includes("FOR UPDATE")&&options.currentHeader ? {...row,...options.currentHeader}:row)];
      if(sql.includes("FROM inventory_stocktake_bins")) return [state.scopes.filter(row=>row.stocktake_id===params[0]&&(params.length===1||params.slice(1).includes(row.bin_id)))];
      if(sql.includes("FROM inventory_lots")) return [state.lots.filter(row=>row.id===params[0])];
      if(sql.includes("FROM inventory_stock_balances")) return [state.balances.filter(row=>row.warehouse_id===params[0]&&row.bin_id===params[1]&&row.sku_id===params[2]&&row.lot_scope===params[3]&&row.stock_status===params[4])];
      if(sql.includes("FROM inventory_stocktake_lines")) {
        let rows=state.lines.filter(row=>row.stocktake_id===params[0]).sort((a,b)=>a.id-b.id);
        if(sql.includes("COUNT(*)")) return [[{totalLines:rows.length,countedLines:rows.filter(row=>row.counted_quantity!==null&&!row.is_not_found).length,
          notFoundLines:rows.filter(row=>row.is_not_found).length,uncountedLines:rows.filter(row=>row.counted_quantity===null&&!row.is_not_found).length}]];
        if(sql.includes("id IN")) rows=rows.filter(row=>params.slice(1).includes(row.id));
        else if(sql.includes("lot_scope =")) rows=rows.filter(row=>row.bin_id===params[1]&&row.sku_id===params[2]&&row.lot_scope===params[3]&&row.stock_status===params[4]);
        if(sql.includes("LIMIT")) {
          if(sql.includes("counted_quantity IS NULL AND is_not_found = 0")) rows=rows.filter(row=>row.counted_quantity===null&&!row.is_not_found);
          if(sql.includes("counted_quantity IS NOT NULL AND is_not_found = 0")) rows=rows.filter(row=>row.counted_quantity!==null&&!row.is_not_found);
          if(sql.includes("AND is_not_found = 1")) rows=rows.filter(row=>row.is_not_found);
          rows=rows.slice(params.at(-1),params.at(-1)+params.at(-2));
        }
        return [rows];
      }
      throw new Error(`unexpected unit read: ${sql}`);
    },execute:async({sql,params,state})=>{
      if(options.failSql?.test(sql)) throw new Error("intended storage fault");
      if(sql.includes("INSERT INTO inventory_operation_requests")) {
        const source=JSON.stringify(params.slice(1,6));
        if(state.operations.some(row=>row.source===source)) throw Object.assign(new Error("duplicate source"),{code:"ER_DUP_ENTRY"});
        const id=state.operations.length+21; state.operations.push({id,source,request_hash:params[6],completed_at:null}); return [{insertId:id,affectedRows:1}];
      }
      if(sql.includes("UPDATE inventory_operation_requests")) {
        const row=state.operations.find(row=>row.id===params[4]); Object.assign(row,{result_type:params[0],result_id:params[1],result_summary:params[2],completed_at:params[3]}); return [{affectedRows:1}];
      }
      if(sql.includes("INSERT INTO inventory_audit_logs")) {state.audits.push(params);return [{affectedRows:1}];}
      if(sql.includes("UPDATE inventory_stocktake_lines")) {
        const row=state.lines.find(row=>row.id===params.at(-3)&&row.stocktake_id===params.at(-2)&&row.version===params.at(-1));
        if(!row) return [{affectedRows:0}]; Object.assign(row,{counted_quantity:params[0],is_not_found:params[1],counted_at:params[2],counted_by:params[3],version:row.version+1}); return [{affectedRows:1}];
      }
      if(sql.includes("UPDATE inventory_stocktakes")) {Object.assign(state.headers.find(row=>row.id===params[2]),{updated_at:params[0],updated_by:params[1]});return [{affectedRows:1}];}
      if(sql.includes("INSERT INTO inventory_stocktake_lines")) {
        const id=Math.max(200,...state.lines.map(row=>row.id))+1;
        state.lines.push({...line,id,stocktake_id:params[0],stocktake_bin_id:params[1],bin_id:params[2],sku_id:params[3],lot_id:params[4],lot_scope:params[4]??0,
          stock_status:params[5],stock_balance_id:null,snapshot_quantity:0,snapshot_balance_version:0}); return [{insertId:id,affectedRows:1}];
      }
      throw new Error(`unexpected unit write: ${sql}`);
    }});
  database.query=(sql,params)=>database.withTransaction(tx=>tx.query(sql,params));
  const locks={lockForCommand:async(_tx,input)=>({warehouses:[{id:1,status:"ACTIVE"}],bins:(input.binIds??[]).map(id=>({id,warehouse_id:1,status:"ACTIVE"})),
    binLocks:options.binLocks??[{id:81,stocktake_id:41,stocktake_bin_id:101,bin_id:1,lock_type:"STOCKTAKE",released_at:null}]})};
  const itemLookup={getInventoryProfileInTransaction:async(_tx,skuId)=>options.profile??{skuId,inventoryTracked:true,usable:true,trackingPolicy:skuId===12?"none":"batch_expiry",baseUom:{uomId:1,uomCode:"EA"}}};
  const service=new InventoryStocktakeService({database,time,logger,locks,itemLookup,authorize:options.authorize??(async()=>({username:"synthetic",permissions:["inventory.operation"]}))});
  return {database,service,inquiry:new InventoryInquiryService({database,time})};
}
const code=error=>["STOCKTAKE_STATE_CONFLICT","STOCKTAKE_SNAPSHOT_MISMATCH","INVENTORY_RESOURCE_NOT_FOUND"].includes(error.code);
test("ST037-U01 numeric zero and notFound persist distinct real scalar audit states and receipts",async()=>{
  const f=fixture(); const result=await f.service.saveCounts(save([{lineId:202,expectedVersion:1,notFound:true},{lineId:201,expectedVersion:1,countedQuantity:0}]));
  assert.deepEqual(result,{id:41,operationId:21,status:"COUNTING",version:2,rowCount:2});
  assert.deepEqual(f.database.state.lines.map(row=>[row.counted_quantity,row.is_not_found,row.version,row.counted_by]),[[0,0,2,7],[null,1,2,7]]);
  assert.deepEqual(f.database.state.audits.map(row=>JSON.parse(row[11]).status),["COUNTED","NOT_FOUND"]);
  assert.ok(f.database.state.audits.every(row=>JSON.parse(row[10]).status==="UNCOUNTED"&&row[12]===21));
  assert.deepEqual(JSON.parse(f.database.state.operations[0].result_summary),result);
  assert.ok(f.database.calls.every(row=>!/(INSERT|UPDATE|DELETE).*inventory_(lots|stock_balances|stock_controls|movements|bin_locks)/su.test(row.sql)));
});
test("ST037-U02 invalid quantity, forms, fields, collection limits and duplicate lines reject before effects",async()=>{
  for(const lines of [[],Array.from({length:101},(_,i)=>({lineId:i+1,expectedVersion:1,countedQuantity:0})),
    [{lineId:201,expectedVersion:1,countedQuantity:0},{lineId:201,expectedVersion:1,countedQuantity:1}],
    ...[null,"0",-1,0.5,Number.MAX_SAFE_INTEGER+1].map(countedQuantity=>[{lineId:201,expectedVersion:1,countedQuantity}]),
    [{lineId:201,expectedVersion:1}],[{lineId:201,expectedVersion:1,notFound:false}],[{lineId:201,expectedVersion:1,countedQuantity:0,notFound:true}],
    [{lineId:201,expectedVersion:1,countedQuantity:0,snapshotQuantity:1}], [null]]) {
    const f=fixture(),before=f.database.state; await assert.rejects(f.service.saveCounts(save(lines)),error=>["INVENTORY_INPUT_INVALID","INVENTORY_QUANTITY_INVALID"].includes(error.code)); assert.deepEqual(f.database.state,before);
  }
});
test("ST037-U03 whole-batch stale or ceiling versions reject and valid maximum-safe count preserves workflow version",async()=>{
  for(const version of [2,4294967295]) {
    const f=fixture({lines:[line,{...line,id:202,version}]});const before=f.database.state;
    await assert.rejects(f.service.saveCounts(save([{lineId:201,expectedVersion:1,countedQuantity:9},{lineId:202,expectedVersion:version===2?1:version,countedQuantity:1}])),{code:"VERSION_CONFLICT"}); assert.deepEqual(f.database.state,before);
  }
  const max=Number.MAX_SAFE_INTEGER;
  const f=fixture({headers:[{...header,id:max,version:4294967295}],scopes:[{...scope,stocktake_id:max}],
    lines:[{...line,id:max,stocktake_id:max,version:4294967294}]},
    {binLocks:[{stocktake_id:max,stocktake_bin_id:101,bin_id:1,lock_type:"STOCKTAKE",released_at:null}]});
  const receipt=await f.service.saveCounts(command("count",{stocktakeId:max,lines:[{lineId:max,expectedVersion:4294967294,countedQuantity:max}]}));
  assert.equal(f.database.state.lines[0].counted_quantity,max);assert.equal(f.database.state.lines[0].version,4294967295);assert.equal(f.database.state.headers[0].version,4294967295);
  assert.deepEqual(receipt,{id:max,operationId:21,status:"COUNTING",version:4294967295,rowCount:1});
  const after=JSON.parse(f.database.state.audits[0][11]);assert.deepEqual(after,{id:max,stocktakeId:max,quantity:max,version:4294967295,status:"COUNTED"});
  assert.ok(Buffer.byteLength(JSON.stringify(after))<=8192);assert.deepEqual(JSON.parse(f.database.state.operations[0].result_summary),receipt);
});
test("ST037-U04 counted and notFound replace each other without carrying stale flags or variance",async()=>{
  const f=fixture();await f.service.saveCounts(save());await f.service.saveCounts(save([{lineId:201,expectedVersion:2,notFound:true}]));await f.service.saveCounts(save([{lineId:201,expectedVersion:3,countedQuantity:8}]));
  const row=f.database.state.lines[0];assert.equal(row.counted_quantity,8);assert.equal(row.is_not_found,0);assert.equal(row.variance_quantity,null);assert.equal(row.version,4);
});
test("ST037-U05 nonCOUNTING, foreign lines and absent or foreign semantic owners reject both writes",async()=>{
  for(const status of ["DRAFT","READY_TO_POST","POSTED","CANCELLED"]) {
    const f=fixture({headers:[{...header,status}]});await assert.rejects(f.service.saveCounts(save()),code);await assert.rejects(f.service.addLine(add()),code);assert.equal(f.database.state.operations.length,0);
  }
  for(const options of [{binLocks:[]},{binLocks:[{stocktake_id:42,stocktake_bin_id:101,bin_id:1,lock_type:"STOCKTAKE",released_at:null}]}]) {
    const f=fixture({},options),before=f.database.state;await assert.rejects(f.service.saveCounts(save()),code);await assert.rejects(f.service.addLine(add()),code);assert.deepEqual(f.database.state,before);
  }
  const f=fixture({lines:[{...line,stocktake_id:42}]});await assert.rejects(f.service.saveCounts(save()),{code:"INVENTORY_RESOURCE_NOT_FOUND"});
});
test("ST037-U06 current root read after discovery dominates and child locking remains after root",async()=>{
  const f=fixture({}, {currentHeader:{status:"READY_TO_POST"}}),before=f.database.state;await assert.rejects(f.service.saveCounts(save()),{code:"STOCKTAKE_STATE_CONFLICT"});assert.deepEqual(f.database.state,before);
  const g=fixture();await g.service.saveCounts(save());const calls=g.database.calls.filter(row=>row.sql.includes("FOR UPDATE"));
  assert.ok(calls.findIndex(row=>row.sql.includes("inventory_stocktakes"))<calls.findIndex(row=>row.sql.includes("inventory_stocktake_lines")));
});
test("ST037-U07 real scalar Operation completion and replay retain original results after later changes",async()=>{
  const f=fixture(),request=save(),original=await f.service.saveCounts(request);await f.service.saveCounts(save([{lineId:201,expectedVersion:2,countedQuantity:9}]));const before=f.database.state;
  assert.deepEqual(await f.service.saveCounts(request),original);assert.deepEqual(f.database.state,before);
  await assert.rejects(f.service.saveCounts({...request,payload:{...request.payload,lines:[{lineId:201,expectedVersion:1,countedQuantity:1}]}}),{code:"INVENTORY_SOURCE_CONFLICT"});
  const added=add(),receipt=await f.service.addLine(added),after=f.database.state;assert.deepEqual(await f.service.addLine(added),receipt);assert.deepEqual(f.database.state,after);
  await assert.rejects(new InventoryOperationService().complete({execute:async()=>{throw new Error("must not execute");}},{operationId:21,resultType:"STOCKTAKE",resultId:"41",resultSummary:{...original,lines:[]},completedAt:time.nowMs()}),/Unsupported.*lines/u);
});
test("ST037-U08 fixed fresh permission is rechecked after waits and before successful replay",async()=>{
  let checks=0;const f=fixture({}, {authorize:async()=>({permissions:++checks===1?["inventory.operation"]:[]})}),before=f.database.state;
  await assert.rejects(f.service.saveCounts(save()),{code:"PERMISSION_STALE"});assert.deepEqual(f.database.state,before);
  const g=fixture(),request=save();await g.service.saveCounts(request);g.service.authorize=async()=>({permissions:[]});await assert.rejects(g.service.saveCounts(request),{code:"PERMISSION_STALE"});
  await assert.rejects(g.service.saveCounts({...save(),authorization:{purpose:"stocktake.count",requiredCallerPermission:"sales.operation"}}),/authorization contract mismatch/u);
});
test("ST037-U09 real Audit, Operation completion, row and commit faults roll back every prior effect",async()=>{
  for(const options of [{failSql:/INSERT INTO inventory_audit_logs/u},{failSql:/UPDATE inventory_operation_requests/u},{failSql:/UPDATE inventory_stocktake_lines/u},{failAt:"commit"}]) {
    const f=fixture({},options),before=f.database.state;await assert.rejects(f.service.saveCounts(save([{lineId:201,expectedVersion:1,countedQuantity:3},{lineId:202,expectedVersion:1,notFound:true}])),/fault|failure/u);assert.deepEqual(f.database.state,before);
  }
});
test("ST037-U10 none and registered expired Lot add only uncounted zero snapshots with flattened line receipt",async()=>{
  for(const changes of [{},{skuId:13,lotId:1}]) {
    const f=fixture(),receipt=await f.service.addLine(add(changes)),row=f.database.state.lines.at(-1);
    assert.deepEqual(receipt,{id:203,stocktakeId:41,operationId:21,status:"COUNTING",version:1,rowCount:1});assert.equal(row.snapshot_quantity,0);assert.equal(row.stock_balance_id,null);assert.equal(row.counted_quantity,null);
    assert.equal(JSON.parse(f.database.state.audits[0][11]).status,"UNCOUNTED");assert.equal(f.database.state.operations[0].result_id,"41");assert.equal(f.database.state.balances.length,0);assert.equal(f.database.state.lots.length,1);
  }
});
test("ST037-U11 Item tracking and immutable Lot rules reject unknown identity and forged fields",async()=>{
  for(const changes of [{lotId:1},{skuId:13,lotId:null},{skuId:13,lotId:999},{skuId:14,lotId:1},{lotNumber:"new"},{expiryDate:"2030-01-01"},{stockStatus:"INVALID"}]) {
    const f=fixture(),before=f.database.state;await assert.rejects(f.service.addLine(add(changes)),error=>["INVENTORY_INPUT_INVALID","LOT_REQUIRED","LOT_DATA_CONFLICT","INVENTORY_RESOURCE_NOT_FOUND"].includes(error.code));assert.deepEqual(f.database.state,before);
  }
  for(const profile of [{inventoryTracked:false},{inventoryTracked:true,trackingPolicy:"serial"},{inventoryTracked:true,usable:false}]) {
    const f=fixture({}, {profile}),before=f.database.state;await assert.rejects(f.service.addLine(add()),error=>["SKU_NOT_INVENTORY_TRACKED","SERIAL_TRACKING_UNSUPPORTED","INVENTORY_INPUT_INVALID"].includes(error.code));assert.deepEqual(f.database.state,before);
  }
});
test("ST037-U12 duplicate count dimensions and an unexpected existing Balance are not invented as zero",async()=>{
  const f=fixture();await assert.rejects(f.service.addLine(add({stockStatus:"AVAILABLE"})),{code:"STOCKTAKE_STATE_CONFLICT"});
  const g=fixture({balances:[{id:3,warehouse_id:1,bin_id:1,sku_id:12,lot_scope:0,stock_status:"QUARANTINED"}]}),before=g.database.state;
  await assert.rejects(g.service.addLine(add()),{code:"STOCKTAKE_SNAPSHOT_MISMATCH"});assert.deepEqual(g.database.state,before);
});
test("ST037-U13 bounded progress pages and disjoint filters return exact totals without writes",async()=>{
  const f=fixture({lines:[line,{...line,id:202,counted_quantity:0},{...line,id:203,is_not_found:1}]}),before=f.database.state;
  const result=await f.inquiry.listStocktakeCountLines({stocktakeId:41,page:2,pageSize:2});assert.deepEqual(result.items.map(row=>row.id),[203]);assert.equal(result.total,3);
  assert.deepEqual(result.summary,{totalLines:3,countedLines:1,notFoundLines:1,uncountedLines:1});
  for(const [progress,actual] of [["UNCOUNTED",null],["COUNTED",0],["NOT_FOUND",0]]) {
    const page=await f.inquiry.listStocktakeCountLines({stocktakeId:41,progress});assert.equal(page.items.length,1);assert.equal(page.items[0].actualQuantity,actual);assert.equal(page.total,1);
  }
  assert.deepEqual(f.database.state,before);assert.ok(f.database.calls.filter(row=>row.sql.includes("FROM inventory_stocktake_lines")&&!row.sql.includes("COUNT(*)")).every(row=>row.sql.includes("LIMIT ? OFFSET ?")));
});
test("ST037-U14 inquiry rejects unknown fields, filters and unsafe pages and returns truthful empty pages",async()=>{
  const f=fixture();for(const changes of [{page:0},{pageSize:101},{page:Number.MAX_SAFE_INTEGER,pageSize:100},{progress:"ALL OR 1=1"},{progress:["ALL"]},{warehouseId:1}]) await assert.rejects(f.inquiry.listStocktakeCountLines({stocktakeId:41,...changes}),{code:"INVENTORY_INPUT_INVALID"});
  assert.deepEqual((await f.inquiry.listStocktakeCountLines({stocktakeId:41,page:99})).items,[]);await assert.rejects(f.inquiry.listStocktakeCountLines({stocktakeId:999}),{code:"INVENTORY_RESOURCE_NOT_FOUND"});
  assert.equal(f.database.state.operations.length,0);assert.equal(f.database.state.audits.length,0);
});
