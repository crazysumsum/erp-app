import assert from "node:assert/strict";
import test from "node:test";
import { InventoryStocktakeService } from "../src/modules/inventory/InventoryStocktakeService.js";
import { createFakeInventoryDatabase } from "../test-support/fakeInventoryDatabase.js";
import { inventoryCommandFixture } from "../test-support/inventoryFixtures.js";

const time={nowMs:()=>1791763200000,fileDate:()=>"2026-10-12"},logger={error(){}};
const header={id:41,warehouse_id:1,stocktake_number:"ST-41",status:"COUNTING",version:2,reason:""};
const scope={id:101,stocktake_id:41,bin_id:1};
const line={id:201,stocktake_id:41,stocktake_bin_id:101,bin_id:1,sku_id:12,lot_id:null,stock_status:"AVAILABLE",
  stock_balance_id:301,snapshot_quantity:4,snapshot_balance_version:1,counted_quantity:7,is_not_found:0,variance_quantity:null,version:2};
let event=0;
function command(action,payload={stocktakeId:41,expectedVersion:2}) {
  return inventoryCommandFixture({actor:{claimedPermissions:["inventory.operation"]},authorization:{purpose:`stocktake.${action}`,requiredCallerPermission:"inventory.operation"},
    source:{module:"INVENTORY",documentType:"STOCKTAKE",documentId:"synthetic-unit038",eventId:`event-${++event}`},payload});
}
function fixture(initial={},options={}) {
  const database=createFakeInventoryDatabase({initialState:{headers:[header],scopes:[scope],lines:[line],operations:[],audits:[],balances:[],controls:[],lots:[],movements:[],...initial},failAt:options.failAt,
    query:async({sql,params,state})=>{
      if(sql.includes("FROM users")) return [[{id:7,username:"synthetic",status:"active"}]];
      if(sql.includes("FROM roles")||sql.includes("FROM user_roles")) return [[{name:"counter",role_id:1}]];
      if(sql.includes("FROM permissions")||sql.includes("FROM role_permissions")) return [(options.permissions??["inventory.view","inventory.operation"]).map(name=>({name}))];
      if(sql.includes("FROM fr_token_versions")) return [[{version:options.tokenVersion??0}]];
      if(sql.includes("FROM user_devices")) return [[{id:5,user_id:7,device_id:"a".repeat(64),public_key:Buffer.from("synthetic-public-key"),status:"approved",...options.device}]];
      if(sql.includes("FROM inventory_lots")) return [state.lots];
      if(sql.includes("FROM inventory_stock_balances")) return [state.balances.filter(row=>row.warehouse_id===params[0]&&(sql.includes("LEFT JOIN inventory_lots")?row.sku_id===params[1]:params.slice(1).includes(row.bin_id)))];
      if(sql.includes("FROM inventory_operation_requests")) return [state.operations.filter(row=>row.source===JSON.stringify(params))];
      if(sql.includes("FROM inventory_stocktakes")) return [state.headers.filter(row=>row.id===params[0]).map(row=>sql.includes("FOR UPDATE")?{...row,...options.currentHeader}:row)];
      if(sql.includes("FROM inventory_stocktake_bins")) return [state.scopes.filter(row=>row.stocktake_id===params[0])];
      if(sql.includes("FROM inventory_stocktake_lines")) return [state.lines.filter(row=>row.stocktake_id===params[0])];
      throw new Error(`unexpected flow unit read: ${sql}`);
    },execute:async({sql,params,state})=>{
      if(options.failSql?.test(sql)) throw new Error("intended flow fault");
      if(sql.includes("INSERT INTO inventory_operation_requests")) {
        const source=JSON.stringify(params.slice(1,6));if(state.operations.some(row=>row.source===source)) throw Object.assign(new Error("duplicate"),{code:"ER_DUP_ENTRY"});
        const id=state.operations.length+21;state.operations.push({id,source,request_hash:params[6],completed_at:null,actor_user_id:params[7]});return [{insertId:id,affectedRows:1}];
      }
      if(sql.includes("UPDATE inventory_operation_requests SET actor_user_id")) {state.operations.find(row=>row.id===params[1]).actor_user_id=params[0];return [{affectedRows:1}];}
      if(sql.includes("UPDATE inventory_operation_requests")) {Object.assign(state.operations.find(row=>row.id===params[4]),{result_type:params[0],result_id:params[1],result_summary:params[2],completed_at:params[3]});return [{affectedRows:1}];}
      if(sql.includes("INSERT INTO inventory_audit_logs")) {state.audits.push(params);return [{affectedRows:1}];}
      if(sql.includes("UPDATE inventory_stocktake_lines SET variance_quantity")) {state.lines.find(row=>row.id===params[1]).variance_quantity=params[0];return [{affectedRows:1}];}
      if(sql.includes("UPDATE inventory_stocktakes SET status = 'READY_TO_POST'")) {Object.assign(state.headers[0],{status:"READY_TO_POST",version:state.headers[0].version+1,ready_operation_id:params[0],ready_at:params[1],ready_by:params[2]});return [{affectedRows:1}];}
      if(sql.includes("UPDATE inventory_stocktakes SET status = 'CANCELLED'")) {Object.assign(state.headers[0],{status:"CANCELLED",version:state.headers[0].version+1,reason:params[0],cancel_operation_id:params[1],cancelled_at:params[2],cancelled_by:params[3]});return [{affectedRows:1}];}
      if(sql.includes("UPDATE inventory_bin_locks")) {state.released??=[];state.released.push(params);return [{affectedRows:1}];}
      if(sql.includes("INSERT INTO inventory_stock_balances")) {const id=500+state.balances.length;state.balances.push({id,warehouse_id:params[0],bin_id:params[1],sku_id:params[2],lot_id:params[3],lot_scope:params[3]??0,stock_status:params[4],on_hand_quantity:0,allocated_quantity:0,version:1,fifo_anchor_date:null});return [{insertId:id,affectedRows:1}];}
      if(sql.includes("UPDATE inventory_stock_balances")) {const row=state.balances.find(row=>row.id===params[3]&&row.version===params[4]);if(!row)return[{affectedRows:0}];Object.assign(row,{on_hand_quantity:params[0],fifo_anchor_date:params[1],version:row.version+1});return [{affectedRows:1}];}
      if(sql.includes("INSERT INTO inventory_movements")) {const id=801+state.movements.length;state.movements.push({id,params});return [{insertId:id,affectedRows:1}];}
      if(sql.includes("UPDATE inventory_stocktake_lines SET movement_id")) {const row=state.lines.find(row=>row.id===params[1]);Object.assign(row,{movement_id:params[0],version:row.version+1});return [{affectedRows:1}];}
      if(sql.includes("UPDATE inventory_stocktakes SET status = 'POSTED'")) {Object.assign(state.headers[0],{status:"POSTED",version:state.headers[0].version+1,reason:params[0],post_operation_id:params[1]});return [{affectedRows:1}];}
      throw new Error(`unexpected flow unit write: ${sql}`);
    }});
  const locks={lockForCommand:async(tx,input)=>({warehouses:[{id:1,warehouse_code:"W1",status:options.warehouseStatus??"ACTIVE"}],bins:input.binIds.map(id=>({id,bin_code:`B${id}`,warehouse_id:1,status:options.binStatus??"ACTIVE"})),stockControls:tx.state.controls,
    binLocks:options.binLocks??[{id:81,stocktake_id:41,stocktake_bin_id:101,bin_id:1,lock_type:"STOCKTAKE",released_at:null}]})};
  const itemLookup={getInventoryProfileInTransaction:async(_tx,skuId)=>options.profile??{skuId,skuCode:`SKU${skuId}`,skuName:"synthetic",inventoryTracked:true,usable:true,trackingPolicy:skuId===12?"none":"batch_expiry",minimumSaleLifeDays:0,baseUom:{uomId:1,uomCode:"EA"}}};
  const service=new InventoryStocktakeService({database,time:options.time??time,logger,locks,itemLookup,authorize:options.authorize??(async()=>({username:"synthetic",permissions:["inventory.operation"]}))});
  return {database,service};
}
test("ST038-U01 Ready freezes positive, zero and notFound signed variances without line-version or stock effects",async()=>{
  const f=fixture({lines:[line,{...line,id:202,counted_quantity:4},{...line,id:203,counted_quantity:null,is_not_found:1}]});
  const result=await f.service.ready(command("ready"));assert.deepEqual(result,{id:41,operationId:21,status:"READY_TO_POST",version:3,rowCount:3});
  assert.deepEqual(f.database.state.lines.map(row=>[row.variance_quantity,row.version]),[[3,2],[0,2],[-4,2]]);
  assert.equal(f.database.state.audits.length,1);assert.equal(f.database.calls.find(row=>row.sql.includes("INSERT INTO inventory_operation_requests")).params[7],null);assert.equal(f.database.state.operations[0].actor_user_id,7);assert.deepEqual(JSON.parse(f.database.state.operations[0].result_summary),result);
  assert.ok(f.database.calls.every(row=>!/(INSERT|UPDATE|DELETE).*inventory_(stock_balances|stock_controls|movements|bin_locks)/su.test(row.sql)));
  const empty=fixture({lines:[]});assert.equal((await empty.service.ready(command("ready"))).rowCount,0);
});
function cancelRequest(payload={stocktakeId:41,expectedVersion:2,reason:"count abandoned"}) {
  const input=command("cancel",payload);input.actor.claimedRoles=["counter"];input.actor.claimedPermissions=["inventory.view","inventory.operation"];return input;
}
async function cancelProof(input,changes={}) {
  const {issueInventoryStocktakeCancelContext}=await import("../src/modules/inventory/inventoryStocktakeCancelContext.js");
  const claims={sub:"7",roles:["counter"],permissions:["inventory.view","inventory.operation"],ver:0,exp:time.nowMs()/1000+900,auth_time:time.nowMs()/1000,...changes.claims};
  const req={method:"POST",apiRoute:{authType:"jwt-password",path:"/api/v1/inventory/stocktakes/:id/cancel"},input:{params:{id:"41"}},auth:{type:"jwt-password",claims},...changes.req};
  return issueInventoryStocktakeCancelContext(req,input,{time:changes.time??time,sessionMaxAgeSeconds:3600,clockToleranceSeconds:0});
}
test("ST038-U05 sealed Cancel rejects forged, altered and reused contexts",async()=>{
  for(const capsule of [undefined,{},true,{passwordVerified:true}]) {const f=fixture(),before=f.database.state;await assert.rejects(f.service.cancel(cancelRequest(),capsule),{code:"PERMISSION_STALE"});assert.deepEqual(f.database.state,before);}
  const f=fixture(),input=cancelRequest(),capsule=await cancelProof(input);await f.service.cancel(input,capsule);
  await assert.rejects(f.service.cancel(input,capsule),{code:"PERMISSION_STALE"});
  const g=fixture(),request=cancelRequest(),proof=await cancelProof(request);await assert.rejects(g.service.cancel({...request,payload:{...request.payload,reason:"different"}},proof),{code:"PERMISSION_STALE"});
});
test("ST038-U06 Cancel actual current JWT, roles and time guard reject before effects",async()=>{
  for(const options of [{tokenVersion:1},{permissions:["inventory.view"]}]) {const f=fixture({},options),input=cancelRequest(),before=f.database.state;await assert.rejects(f.service.cancel(input,await cancelProof(input)),error=>["JWT_INVALID","PERMISSION_STALE"].includes(error.code));assert.deepEqual(f.database.state,before);}
  const input=cancelRequest();await assert.rejects(cancelProof(input,{claims:{exp:time.nowMs()/1000-1}}),{code:"JWT_INVALID"});
  await assert.rejects(cancelProof(input,{claims:{auth_time:time.nowMs()/1000-3601}}),{code:"SESSION_EXPIRED"});
});
test("ST038-U07 Cancel preserves history and exact own locks even for inactive Warehouse/Bin",async()=>{
  for(const status of ["DRAFT","COUNTING","READY_TO_POST"]) {
    const f=fixture({headers:[{...header,status}]},{warehouseStatus:"INACTIVE",binStatus:"INACTIVE",...(status==="DRAFT"?{binLocks:[]}: {})}),input=cancelRequest(),lines=f.database.state.lines;
    const result=await f.service.cancel(input,await cancelProof(input));assert.deepEqual(result,{id:41,operationId:21,status:"CANCELLED",version:3,rowCount:1});assert.deepEqual(f.database.state.lines,lines);
    assert.equal(f.database.state.released?.length??0,status==="DRAFT"?0:1);assert.equal(f.database.state.audits.length,1);
  }
});
test("ST038-U08 Cancel foreign, missing, released or mismatched owners roll back without unlock",async()=>{
  for(const binLocks of [[],[{id:81,stocktake_id:42,stocktake_bin_id:101,bin_id:1,lock_type:"STOCKTAKE",released_at:null}],
    [{id:81,stocktake_id:41,stocktake_bin_id:102,bin_id:1,lock_type:"STOCKTAKE",released_at:null}],
    [{id:81,stocktake_id:41,stocktake_bin_id:101,bin_id:1,lock_type:"STOCKTAKE",released_at:1}]]) {
    const f=fixture({}, {binLocks}),input=cancelRequest(),before=f.database.state;await assert.rejects(f.service.cancel(input,await cancelProof(input)),{code:"STOCKTAKE_STATE_CONFLICT"});assert.deepEqual(f.database.state,before);
  }
});
test("ST038-U09 Cancel current-auth original scalar replay does not release twice; terminal new intents reject",async()=>{
  const f=fixture(),input=cancelRequest(),result=await f.service.cancel(input,await cancelProof(input)),after=f.database.state;
  assert.deepEqual(await f.service.cancel(input,await cancelProof(input)),result);assert.deepEqual(f.database.state,after);
  const next=cancelRequest();await assert.rejects(f.service.cancel(next,await cancelProof(next)),{code:"VERSION_CONFLICT"});assert.deepEqual(f.database.state,after);
});
test("ST038-U02 Ready rejects the whole set for untouched or corrupt count forms",async()=>{
  for(const changes of [{counted_quantity:null},{counted_quantity:2,is_not_found:1},{counted_quantity:-1},{is_not_found:2},{snapshot_quantity:Number.MAX_SAFE_INTEGER+1}]) {
    const f=fixture({lines:[line,{...line,id:202,...changes}]}),before=f.database.state;
    await assert.rejects(f.service.ready(command("ready")),error=>["STOCKTAKE_STATE_CONFLICT","STOCKTAKE_SNAPSHOT_MISMATCH"].includes(error.code));assert.deepEqual(f.database.state,before);
  }
});
test("ST038-U03 workflow input, version ceilings, stale state and unsafe IDs reject with no effects",async()=>{
  for(const payload of [{stocktakeId:0,expectedVersion:2},{stocktakeId:41,expectedVersion:0},{stocktakeId:41,expectedVersion:4294967296},{stocktakeId:41,expectedVersion:1},{stocktakeId:41,expectedVersion:2,variance:0}]) {
    const f=fixture(),before=f.database.state;await assert.rejects(f.service.ready(command("ready",payload)),error=>["INVENTORY_INPUT_INVALID","VERSION_CONFLICT"].includes(error.code));assert.deepEqual(f.database.state,before);
  }
  for(const status of ["DRAFT","READY_TO_POST","POSTED","CANCELLED"]) {const f=fixture({headers:[{...header,status}]});await assert.rejects(f.service.ready(command("ready")),{code:"STOCKTAKE_STATE_CONFLICT"});}
});
test("ST038-U04 Ready rechecks current authority and real source replay returns its original scalar",async()=>{
  let checks=0;const f=fixture({}, {authorize:async()=>({permissions:++checks===1?["inventory.operation"]:[]})}),before=f.database.state;
  await assert.rejects(f.service.ready(command("ready")),{code:"PERMISSION_STALE"});assert.deepEqual(f.database.state,before);
  const g=fixture(),request=command("ready"),result=await g.service.ready(request),after=g.database.state;
  assert.deepEqual(await g.service.ready(request),result);assert.deepEqual(g.database.state,after);
  await assert.rejects(g.service.ready({...request,payload:{stocktakeId:41,expectedVersion:3}}),{code:"INVENTORY_SOURCE_CONFLICT"});
  g.service.authorize=async()=>({permissions:[]});await assert.rejects(g.service.ready(request),{code:"PERMISSION_STALE"});
});
const balance={id:301,warehouse_id:1,bin_id:1,sku_id:12,lot_id:null,lot_scope:0,stock_status:"AVAILABLE",on_hand_quantity:4,allocated_quantity:0,version:1,fifo_anchor_date:"2026-01-01",expiry_date:null};
function postFixture(initial={},options={}) {return fixture({headers:[{...header,status:"READY_TO_POST",version:3}],lines:[{...line,variance_quantity:3}],balances:[balance],controls:[{warehouse_id:1,sku_id:12,reserved_quantity:0}],...initial},{permissions:["inventory.view","inventory.adjust"],...options});}
function postRequest(payload={stocktakeId:41,expectedVersion:3,reason:"physical reconciliation"}) {
  const input=command("post",payload);input.actor.claimedRoles=["counter"];input.actor.claimedPermissions=["inventory.view","inventory.adjust"];input.authorization.requiredCallerPermission="inventory.adjust";return input;
}
async function postProof(input,changes={}) {
  const {issueInventoryHighRiskContext}=await import("../src/modules/inventory/inventoryHighRiskContext.js");
  const binding={id:5,user_id:7,device_id:"a".repeat(64),public_key:Buffer.from("synthetic-public-key"),status:"approved"};
  const req={method:"POST",apiRoute:{authType:"jwt-device-password",path:"/api/v1/inventory/stocktakes/:id/post"},input:{params:{id:String(input.payload.stocktakeId)}},get:()=>String(time.nowMs()),
    auth:{type:"jwt-device-password",claims:{sub:"7",did:binding.device_id,roles:["counter"],permissions:["inventory.view","inventory.adjust"],ver:0,exp:time.nowMs()/1000+900,auth_time:time.nowMs()/1000,...changes.claims},deviceBinding:binding},...changes.req};
  return issueInventoryHighRiskContext(req,input,{time:changes.time??time,signatureMaxSkewSeconds:60,sessionMaxAgeSeconds:3600,clockToleranceSeconds:0});
}
async function post(f,input=postRequest()) {return f.service.post(input,await postProof(input));}
test("ST038-U10 Post proof rejects forged/cross-route/changed intent and one-use reuse",async()=>{
  for(const proof of [undefined,{},true]) {const f=postFixture(),before=f.database.state;await assert.rejects(f.service.post(postRequest(),proof),{code:"PERMISSION_STALE"});assert.deepEqual(f.database.state,before);}
  const input=postRequest();await assert.rejects(postProof(input,{req:{input:{params:{id:"041"}}}}),{code:"PERMISSION_STALE"});
  const f=postFixture(),proof=await postProof(input);await f.service.post(input,proof);await assert.rejects(f.service.post(input,proof),{code:"PERMISSION_STALE"});
});
test("ST038-U11 Post current view/adjust/JWT/device/key remain mandatory",async()=>{
  for(const [options,code] of [[{permissions:["inventory.view","inventory.operation"]},"PERMISSION_STALE"],[{tokenVersion:1},"JWT_INVALID"],[{device:{status:"revoked"}},"DEVICE_REVOKED"],[{device:{public_key:Buffer.from("different")}},"DEVICE_MISMATCH"]]) {
    const f=postFixture({},options),before=f.database.state;await assert.rejects(post(f),{code});assert.deepEqual(f.database.state,before);
  }
});
test("ST038-U12 mixed variances write one Operation/group and only nonzero line Movement/Audit",async()=>{
  const f=postFixture({lines:[{...line,variance_quantity:3},{...line,id:202,stock_status:"DAMAGED",stock_balance_id:302,counted_quantity:1,variance_quantity:-3},{...line,id:203,stock_status:"QUARANTINED",stock_balance_id:303,counted_quantity:4,variance_quantity:0}],
    balances:[balance,{...balance,id:302,stock_status:"DAMAGED"},{...balance,id:303,stock_status:"QUARANTINED"}]});
  const result=await post(f);assert.equal(result.rowCount,2);assert.match(result.movementGroupId,/^[0-9a-f-]{36}$/u);assert.equal(f.database.state.movements.length,2);assert.equal(f.database.state.audits.length,3);
  assert.deepEqual(f.database.state.balances.map(row=>[row.on_hand_quantity,row.version]),[[7,2],[1,2],[4,1]]);assert.deepEqual(f.database.state.lines.map(row=>row.version),[3,3,2]);
  assert.equal(new Set(f.database.state.movements.map(row=>row.params[0])).size,1);assert.equal(f.database.state.operations.length,1);assert.equal(f.database.state.operations[0].actor_user_id,7);
});
test("ST038-U13 existing expired and low-receipt-life Lots physical IN keeps dimensions/dates",async()=>{
  for(const expiry_date of ["2020-01-01","2026-10-13"]) {
    const lot={id:1,sku_id:13,lot_number:"known",normalized_lot_number:"known",expiry_date,manufacture_date:null,first_receipt_date:"2019-01-01"};
    const f=postFixture({lots:[lot],lines:[{...line,sku_id:13,lot_id:1,variance_quantity:3}],balances:[{...balance,sku_id:13,lot_id:1,lot_scope:1,expiry_date}],controls:[{sku_id:13,reserved_quantity:0}]},{profile:{skuId:13,skuCode:"L",skuName:"Lot",usable:true,inventoryTracked:true,trackingPolicy:"batch_expiry",minimumReceiptLifeDays:90,minimumSaleLifeDays:30,baseUom:{uomId:1}}});
    await post(f);assert.deepEqual(f.database.state.lots,[lot]);assert.equal(f.database.state.balances[0].on_hand_quantity,7);
  }
});
test("ST038-U14 current Item and Lot rules reject serial/nontracked/inactive/wrong dimensions",async()=>{
  for(const profile of [{inventoryTracked:false},{inventoryTracked:true,trackingPolicy:"serial"},{inventoryTracked:true,usable:false}]) {
    const f=postFixture({}, {profile}),before=f.database.state;await assert.rejects(post(f),error=>["SKU_NOT_INVENTORY_TRACKED","SERIAL_TRACKING_UNSUPPORTED","INVENTORY_INPUT_INVALID"].includes(error.code));assert.deepEqual(f.database.state,before);
  }
  const f=postFixture({lines:[{...line,lot_id:999,variance_quantity:3}],balances:[{...balance,lot_id:999,lot_scope:999}]});await assert.rejects(post(f),{code:"LOT_DATA_CONFLICT"});
});
test("ST038-U15 snapshot identity/quantity/version and added later Balance are integrity errors",async()=>{
  for(const changes of [{id:302},{on_hand_quantity:5},{version:2}]) {const f=postFixture({balances:[{...balance,...changes}]}),before=f.database.state;await assert.rejects(post(f),{code:"STOCKTAKE_SNAPSHOT_MISMATCH"});assert.deepEqual(f.database.state,before);}
  const f=postFixture({lines:[{...line,stock_balance_id:null,snapshot_quantity:0,snapshot_balance_version:0,variance_quantity:7}]});await assert.rejects(post(f),{code:"STOCKTAKE_SNAPSHOT_MISMATCH"});
});
test("ST038-U16 final perBucket allocation floor cannot be funded by another gain",async()=>{
  const f=postFixture({lines:[{...line,counted_quantity:1,variance_quantity:-3}],balances:[{...balance,allocated_quantity:2}]}),before=f.database.state;
  await assert.rejects(post(f),{code:"INSUFFICIENT_STOCK"});assert.deepEqual(f.database.state,before);
});
test("ST038-U17 final atomic reserved coverage cannot worsen but net gain can offset loss",async()=>{
  const losing=postFixture({lines:[{...line,counted_quantity:1,variance_quantity:-3}],controls:[{sku_id:12,reserved_quantity:4}]}),before=losing.database.state;
  await assert.rejects(post(losing),{code:"INSUFFICIENT_ATP"});assert.deepEqual(losing.database.state,before);
  const f=postFixture({lines:[{...line,counted_quantity:1,variance_quantity:-3},{...line,id:202,stock_balance_id:null,bin_id:2,stocktake_bin_id:102,snapshot_quantity:0,snapshot_balance_version:0,counted_quantity:3,variance_quantity:3}],scopes:[scope,{...scope,id:102,bin_id:2}],controls:[{sku_id:12,reserved_quantity:4}]},
    {binLocks:[{id:81,stocktake_id:41,stocktake_bin_id:101,bin_id:1,lock_type:"STOCKTAKE",released_at:null},{id:82,stocktake_id:41,stocktake_bin_id:102,bin_id:2,lock_type:"STOCKTAKE",released_at:null}]});
  await post(f);assert.deepEqual(f.database.state.balances.map(row=>row.on_hand_quantity),[1,3]);assert.equal(f.database.state.controls[0].reserved_quantity,4);
  const uncovered=postFixture({controls:[{sku_id:12,reserved_quantity:9}]});await post(uncovered);assert.equal(uncovered.database.state.balances[0].on_hand_quantity,7);assert.equal(uncovered.database.state.controls[0].reserved_quantity,9);
});
test("ST038-U18 zero/allzero lines have no stock/control/Movement/group creation but require proof and release",async()=>{
  const f=postFixture({lines:[{...line,counted_quantity:4,variance_quantity:0},{...line,id:202,stock_status:"DAMAGED",stock_balance_id:null,snapshot_quantity:0,snapshot_balance_version:0,counted_quantity:0,variance_quantity:0}],controls:[]}),before=f.database.state;
  const result=await post(f);assert.equal(result.movementGroupId,null);assert.equal(result.rowCount,0);assert.deepEqual(f.database.state.balances,before.balances);assert.deepEqual(f.database.state.controls,[]);assert.deepEqual(f.database.state.movements,[]);assert.equal(f.database.state.audits.length,1);assert.equal(f.database.state.released.length,1);
});
test("ST038-U19 noneLot FIFO preserves positive anchor, initializes zero-to-positive and clears at zero",async()=>{
  for(const [before,actual,anchor] of [[4,7,"2026-01-01"],[0,2,"2026-10-12"],[4,0,null]]) {const f=postFixture({lines:[{...line,snapshot_quantity:before,counted_quantity:actual,variance_quantity:actual-before}],balances:[{...balance,on_hand_quantity:before}]});await post(f);assert.equal(f.database.state.balances[0].fifo_anchor_date,anchor);}
  const lot={id:1,sku_id:13,lot_number:"known",normalized_lot_number:"known",expiry_date:"2020-01-01",manufacture_date:null,first_receipt_date:"2019-01-01"};
  const f=postFixture({lots:[lot],lines:[{...line,sku_id:13,lot_id:1,counted_quantity:0,variance_quantity:-4}],balances:[{...balance,sku_id:13,lot_id:1,lot_scope:1,expiry_date:lot.expiry_date}],controls:[{sku_id:13,reserved_quantity:0}]});await post(f);assert.equal(f.database.state.balances[0].fifo_anchor_date,null);assert.deepEqual(f.database.state.lots,[lot]);
});
test("ST038-U20 unsafe quantities, line/balance/workflow ceilings and date change reject atomically",async()=>{
  for(const initial of [{lines:[{...line,counted_quantity:Number.MAX_SAFE_INTEGER+1,variance_quantity:1}]},{lines:[{...line,version:4294967295,variance_quantity:3}]},{balances:[{...balance,version:4294967295}],lines:[{...line,snapshot_balance_version:4294967295,variance_quantity:3}]}]) {
    const f=postFixture(initial),before=f.database.state;await assert.rejects(post(f),error=>["STOCKTAKE_SNAPSHOT_MISMATCH","CONCURRENT_OPERATION"].includes(error.code));assert.deepEqual(f.database.state,before);
  }
  const max=postFixture({lines:[{...line,snapshot_quantity:0,counted_quantity:Number.MAX_SAFE_INTEGER,variance_quantity:Number.MAX_SAFE_INTEGER}],balances:[{...balance,on_hand_quantity:0}]});await post(max);assert.equal(max.database.state.balances[0].on_hand_quantity,Number.MAX_SAFE_INTEGER);
  let dates=0;const f=postFixture({}, {time:{nowMs:time.nowMs,fileDate:()=>++dates===1?"2026-10-12":"2026-10-13"}}),before=f.database.state;await assert.rejects(post(f),{code:"CONCURRENT_OPERATION"});assert.deepEqual(f.database.state,before);
});
test("ST038-U21 later Movement/Audit/release/complete/commit faults roll back all original READY data",async()=>{
  for(const options of [{failSql:/INSERT INTO inventory_movements/u},{failSql:/INSERT INTO inventory_audit_logs/u},{failSql:/UPDATE inventory_bin_locks/u},{failSql:/SET result_type/u},{failAt:"commit"}]) {const f=postFixture({},options),before=f.database.state;await assert.rejects(post(f),/fault|failure/u);assert.deepEqual(f.database.state,before);}
});
test("ST038-U22 Post real stored scalar replay cannot duplicate stock/audit/unlock or accept altered source intent",async()=>{
  const f=postFixture(),input=postRequest(),result=await post(f,input),after=f.database.state;assert.deepEqual(await post(f,input),result);assert.deepEqual(f.database.state,after);
  const changed={...input,payload:{...input.payload,reason:"changed"}};await assert.rejects(post(f,changed),{code:"INVENTORY_SOURCE_CONFLICT"});assert.deepEqual(f.database.state,after);
});
test("ST038-U23 current workflow/owned scope dominates discovery; Ready audit/completion faults rollback",async()=>{
  const f=fixture({}, {currentHeader:{status:"READY_TO_POST"}}),before=f.database.state;await assert.rejects(f.service.ready(command("ready")),{code:"STOCKTAKE_STATE_CONFLICT"});assert.deepEqual(f.database.state,before);
  for(const options of [{binLocks:[]},{failSql:/INSERT INTO inventory_audit_logs/u},{failSql:/SET result_type/u},{failAt:"commit"}]) {const g=fixture({},options),original=g.database.state;await assert.rejects(g.service.ready(command("ready")));assert.deepEqual(g.database.state,original);}
});
test("ST038-U24 legacy high-risk actions retain strict device proof and cross-action binding",async()=>{
  const {issueInventoryHighRiskContext,consumeInventoryHighRiskContext}=await import("../src/modules/inventory/inventoryHighRiskContext.js");
  for(const [action,path] of [["adjustment.post","/api/v1/inventory/adjustments"],["status_transfer.post","/api/v1/inventory/status-transfers"],["movement.reverse","/api/v1/inventory/movements/:id/reverse"]]) {
    const input=postRequest({movementId:1});input.authorization.purpose=action;
    const binding={id:5,user_id:7,device_id:"a".repeat(64),public_key:Buffer.from("synthetic-public-key"),status:"approved"};
    const req={method:"POST",apiRoute:{authType:"jwt-device-password",path},input:{params:action==="movement.reverse"?{id:"1"}:{}},get:()=>String(time.nowMs()),auth:{type:"jwt-device-password",claims:{sub:"7",did:binding.device_id,roles:["counter"],permissions:["inventory.view","inventory.adjust"],ver:0,exp:time.nowMs()/1000+900,auth_time:time.nowMs()/1000},deviceBinding:binding}};
    const proof=issueInventoryHighRiskContext(req,input,{time,signatureMaxSkewSeconds:60,sessionMaxAgeSeconds:3600,clockToleranceSeconds:0});
    assert.throws(()=>consumeInventoryHighRiskContext(proof,{...input,authorization:{purpose:"stocktake.post",requiredCallerPermission:"inventory.adjust"}}),{code:"PERMISSION_STALE"});
    assert.ok(consumeInventoryHighRiskContext(proof,input));assert.throws(()=>consumeInventoryHighRiskContext(proof,input),{code:"PERMISSION_STALE"});
  }
});
