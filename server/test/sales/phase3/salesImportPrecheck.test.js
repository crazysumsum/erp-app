import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {precheckSalesOrders,sourceOrderPayloadHash,salesSourceHash} from "../../../src/modules/sales/salesImportPrecheck.js";
function group(changes={}){return {sourceOrderKey:randomUUID(),externalOrderId:randomUUID(),channelCode:"SYNTHETIC",firstRowNo:2,lastRowNo:2,rowCount:1,errors:[],processingEventId:randomUUID(),payload:{customerId:1,channelCode:"SYNTHETIC",currencyCode:"HKD",orderDate:"2026-10-08",requestedDeliveryDate:null,warehouseCode:"WH",paymentTermCode:"NET30",customerPoReference:"",notes:"",lines:[{skuCode:"SKU",salesUomCode:"EA",quantity:"1.000000",unitSellingPrice:"0.0000",lineNote:"",rowNumbers:[2]}]},...changes};}
function fixture(){const queries=[],tx={async query(sql,params){queries.push({sql,params});if(sql.includes("AS bytes"))return [Array.from({length:params.length/2},(_,i)=>({request_index:params[i*2],bytes:Buffer.byteLength(params[i*2+1])}))];if(sql.includes("inventory_warehouses"))return [[{request_index:0,id:3,warehouse_code:"WH",status:"ACTIVE"}]];if(sql.includes("FROM currencies"))return [[{code:"HKD",status:"active"}]];if(sql.includes("FROM payment_terms"))return [[{id:4,code_key:"NET30",status:"active"}]];if(sql.includes("sales_external_order_keys"))return [[]];throw new Error("Unexpected query");}},calls=[],customers={async getSalesPrecheckSnapshotsInTransaction(_tx,ids){calls.push(ids);return new Map(ids.map(id=>[id,id===1?{customerId:id,status:"active",credit:{status:"normal"}}:null]));}},items={async resolveSaleCodesInTransaction(_tx,pairs){calls.push(pairs);return pairs.map(pair=>({...pair,sku:pair.skuCode==="SKU"?{skuId:5,usable:true}:null,salesUom:{skuUomId:6,status:"active",toBaseFactor:1}}));}};return {tx,customers,items,queries,calls,config:{importChannelCodes:["SYNTHETIC"]},nowMs:1};}
test("TC-035 bounded precheck isolates source errors, merges validated lines and produces zero-effect safe results",async()=>{
 const f=fixture(),valid=group(),missing=group();missing.payload.customerId=99;const badLine=group();badLine.payload.lines.push({...badLine.payload.lines[0],skuCode:"MISSING",rowNumbers:[3]});badLine.lastRowNo=3;
 const parserInvalid=group({errors:[{rowNo:2,field:"quantity",code:"SALES_QUANTITY_INVALID"}]}),results=await precheckSalesOrders({...f,groups:[valid,missing,badLine,parserInvalid]});
 assert.deepEqual(results.map(r=>r.status),["VALID","INVALID","INVALID","INVALID"]);assert.equal(results[0].payload.document.fulfillmentWarehouseId,3);assert.equal(results[0].payload.document.lines[0].skuUomId,6);assert.equal(results[0].warnings[0].code,"ZERO_PRICE");assert.equal(results[2].errors[0].rowNo,3);assert.equal(results[1].payload,null);assert.equal(f.calls.length,2);assert.equal(f.queries.length,5);assert.ok(f.queries.every(q=>/^SELECT /u.test(q.sql)));assert.equal(JSON.stringify(results).includes("legalName"),false);
});
test("TC-035 source hash excludes event and row coordinates while preserving exact external identity",()=>{
 const a=group(),b=structuredClone(a);b.processingEventId=randomUUID();b.payload.lines[0].rowNumbers=[999];b.firstRowNo=999;assert.equal(sourceOrderPayloadHash(a),sourceOrderPayloadHash(b));b.externalOrderId+=" ";assert.notEqual(sourceOrderPayloadHash(a),sourceOrderPayloadHash(b));
});
test("TC-035 precheck detects duplicate routing and exact hash collisions without claiming external keys",async()=>{
 const f=fixture(),g=group(),query=f.tx.query;f.tx.query=async(sql,params)=>sql.includes("sales_external_order_keys")?[[{id:7,channel_code:g.channelCode,identity_hash:salesSourceHash(g.externalOrderId).toString("hex"),external_order_id:g.externalOrderId,payload_hash:sourceOrderPayloadHash(g),status:"SUCCEEDED",sales_order_id:8,sales_order_number:"SO26000001",is_order_archived:1}]]:query(sql,params);
 const [result]=await precheckSalesOrders({...f,groups:[g]});assert.equal(result.status,"DUPLICATE");assert.deepEqual(result.duplicate,{externalOrderKeyId:7,salesOrderId:8,salesOrderNumber:"SO26000001",isArchived:true});
 f.tx.query=async(sql,params)=>sql.includes("sales_external_order_keys")?[[{channel_code:g.channelCode,identity_hash:salesSourceHash(g.externalOrderId).toString("hex"),external_order_id:g.externalOrderId+" ",payload_hash:sourceOrderPayloadHash(g)}]]:query(sql,params);await assert.rejects(precheckSalesOrders({...f,groups:[g]}),{code:"SALES_SOURCE_HASH_COLLISION"});
});
test("TC-035 technical provider failure propagates and bounded batch rejects more than100 unique pairs",async()=>{
 const f=fixture();f.items.resolveSaleCodesInTransaction=async()=>{throw new Error("provider offline");};await assert.rejects(precheckSalesOrders({...f,groups:[group()]}),/provider offline/u);
 const g=group();g.payload.lines=Array.from({length:101},(_,i)=>({...g.payload.lines[0],skuCode:"SKU"+i}));await assert.rejects(precheckSalesOrders({...fixture(),groups:[g]}),{code:"SALES_INPUT_INVALID"});
});
test("TC-035 owner aliases with conflicting lines invalidate only their source order",async()=>{
 const f=fixture(),bad=group(),peer=group();bad.payload.lines.push({...bad.payload.lines[0],skuCode:"sku",unitSellingPrice:"1.0000",rowNumbers:[3]});bad.lastRowNo=3;
 f.items.resolveSaleCodesInTransaction=async(_tx,pairs)=>pairs.map(pair=>({...pair,sku:{skuId:5,usable:true},salesUom:{skuUomId:6,status:"active",toBaseFactor:1}}));
 const results=await precheckSalesOrders({...f,groups:[bad,peer]});assert.deepEqual(results.map(r=>r.status),["INVALID","VALID"]);assert.equal(results[0].errors[0].code,"SALES_LINE_MERGE_CONFLICT");
});
test("TC-035 successful key with changed source payload stays duplicate with conflict warning",async()=>{
 const f=fixture(),g=group(),query=f.tx.query;f.tx.query=async(sql,params)=>sql.includes("sales_external_order_keys")?[[{id:7,channel_code:g.channelCode,identity_hash:salesSourceHash(g.externalOrderId).toString("hex"),external_order_id:g.externalOrderId,payload_hash:"0".repeat(64),status:"SUCCEEDED",sales_order_id:8,sales_order_number:"SO26000001",is_order_archived:1}]]:query(sql,params);
 const [result]=await precheckSalesOrders({...f,groups:[g]});assert.equal(result.status,"DUPLICATE");assert.equal(result.duplicate.salesOrderId,8);assert.ok(result.warnings.some(w=>w.code==="EXTERNAL_ORDER_PAYLOAD_CONFLICT"));
});
test("TC-035 explicit invalid UOM outcome preserves its diagnostic",async()=>{
 const f=fixture();f.items.resolveSaleCodesInTransaction=async(_tx,pairs)=>pairs.map(pair=>({...pair,sku:null,salesUom:null,errorCode:"SKU_UOM_INVALID"}));const [result]=await precheckSalesOrders({...f,groups:[group()]});assert.equal(result.errors[0].code,"SKU_UOM_INVALID");
});
test("TC-035 resolved document and warnings must also fit the normalized128KiB cap",async()=>{
 const f=fixture(),g=group();g.payload.lines=Array.from({length:100},(_,i)=>({...g.payload.lines[0],skuCode:"SKU"+i,lineNote:"雪".repeat(382),rowNumbers:[i+2]}));g.payload.notes="雪".repeat(500);g.lastRowNo=101;
 f.items.resolveSaleCodesInTransaction=async(_tx,pairs)=>pairs.map((pair,index)=>({...pair,sku:{skuId:index+5,usable:true},salesUom:{skuUomId:index+6,status:"active",toBaseFactor:1}}));assert.ok(Buffer.byteLength(JSON.stringify(g.payload))<=131072);
 const [result]=await precheckSalesOrders({...f,groups:[g]});assert.equal(result.status,"INVALID");assert.equal(result.payload,null);assert.equal(result.errors[0].field,"payload");
});
test("TC-035 completed external routing precedes changed mutable master validation",async()=>{
 const f=fixture(),g=group(),query=f.tx.query;f.customers.getSalesPrecheckSnapshotsInTransaction=async()=>new Map([[1,{status:"blocked",credit:{status:"normal"}}]]);
 f.tx.query=async(sql,params)=>sql.includes("sales_external_order_keys")?[[{id:7,channel_code:g.channelCode,identity_hash:salesSourceHash(g.externalOrderId).toString("hex"),external_order_id:g.externalOrderId,payload_hash:sourceOrderPayloadHash(g),status:"SUCCEEDED",sales_order_id:8,sales_order_number:"SO26000001",is_order_archived:1}]]:query(sql,params);
 const [result]=await precheckSalesOrders({...f,groups:[g]});assert.equal(result.status,"DUPLICATE");assert.equal(result.duplicate.salesOrderId,8);
});
test("TC-035 database JSON byte cap is checked on final saved payload",async()=>{
 const f=fixture(),g=group(),query=f.tx.query;f.tx.query=async(sql,params)=>sql.includes("AS bytes")?[[{request_index:0,bytes:131073}]]:query(sql,params);
 const [result]=await precheckSalesOrders({...f,groups:[g]});assert.equal(result.status,"INVALID");assert.equal(result.payload,null);assert.equal(result.errors[0].field,"payload");
});
test("TC-035 archived duplicate preserves a null Active SO identity",async()=>{
 const f=fixture(),g=group(),query=f.tx.query;f.tx.query=async(sql,params)=>sql.includes("sales_external_order_keys")?[[{id:7,channel_code:g.channelCode,identity_hash:salesSourceHash(g.externalOrderId).toString("hex"),external_order_id:g.externalOrderId,payload_hash:sourceOrderPayloadHash(g),status:"SUCCEEDED",sales_order_id:null,sales_order_number:"SO26000001",is_order_archived:1}]]:query(sql,params);
 const [result]=await precheckSalesOrders({...f,groups:[g]});assert.deepEqual(result.duplicate,{externalOrderKeyId:7,salesOrderId:null,salesOrderNumber:"SO26000001",isArchived:true});
});
