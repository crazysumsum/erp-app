import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { claimFulfillmentInventoryBatch, fulfillmentInventoryDigest, completeFulfillmentInventoryBatch, readFulfillmentInventoryBatch } from "../../src/modules/inventory/inventoryFulfillmentReceipts.js";
import { InventoryOperationService } from "../../src/modules/inventory/InventoryOperationService.js";
const payload={fulfillmentId:"1",shipmentId:"2",lines:[{fulfillmentLineId:"3",salesOrderLineId:"4",baseQuantity:"5",reservations:[{claimId:"5",inventoryReservationId:"6",expectedVersion:1,baseQuantity:"5",allocations:[{inventoryAllocationId:"7",inventoryBalanceId:"8",expectedVersion:1,expectedBalanceVersion:1,baseQuantity:"5"}]}]},{fulfillmentLineId:"9",salesOrderLineId:"10",baseQuantity:"0",reservations:[]}]};
test("Inventory batch preclaims root/member/all legs before effects with exact source/digest identities",async()=>{
  const inputs=[],done=[];
  const operations={async claim(tx,input){inputs.push(input);return {operationId:inputs.length,replay:null};},async complete(tx,input){done.push(input);}};
  const batch=await claimFulfillmentInventoryBatch({}, {operations,action:"ISSUE",payload,source:{eventId:"event"},actor:{userId:1},actorLabel:"Synthetic",timestamp:100,correlationId:""});
  assert.deepEqual(inputs.map(i=>[i.commandType,i.source.documentType,i.source.lineId]),[["FULFILLMENT_BATCH_ISSUE","SHIPMENT",""],["ISSUE_POST","SHIPMENT","5"],["FULFILLMENT_BATCH_LEG","SHIPMENT_LEG","5:1"]]);
  assert.equal(batch.members[0].legs[0].ordinal,1);
  assert.equal(fulfillmentInventoryDigest(["1:2:abc","3:4:def"]),createHash("sha256").update("1:2:abc\n3:4:def","utf8").digest("hex"));
  batch.members[0].version=2;batch.members[0].legs[0].result={inventoryAllocationId:"7",inventoryBalanceId:"8",movementId:"11",baseQuantity:"5",allocationVersion:2,balanceVersion:2,baseUomId:"12",baseUomCode:"EA"};
  await completeFulfillmentInventoryBatch({},batch);
  assert.deepEqual(done.map(x=>x.resultType),["FULFILLMENT_LEG","FULFILLMENT_ISSUE_MEMBER","FULFILLMENT_BATCH_ISSUE"]);
  assert.equal(done[2].resultSummary.memberCount,1);
  assert.equal(JSON.parse(done[2].resultSummary.lineSnapshot).length,2,"root retains explicit zero-line identity for original replay");
});
test("Inventory root/member receipt bounds retain all100 max-safe line tuples under existing8192bytes",async()=>{
  const service=new InventoryOperationService(), statements=[];
  const tx={async execute(sql,args){statements.push({sql,args});return [{affectedRows:1}];}};
  const lineSnapshot=JSON.stringify(Array.from({length:100},()=>["9007199254740991","9007199254740991","9007199254740991"]));
  await service.complete(tx,{operationId:1,resultType:"FULFILLMENT_BATCH_ISSUE",resultId:"2",completedAt:100,resultSummary:{memberCount:5000,membershipDigest:"a".repeat(64),lineSnapshot,fulfillmentId:"1"}});
  assert.ok(Buffer.byteLength(statements[0].args[2])<8192);
  await assert.rejects(service.complete(tx,{operationId:1,resultType:"FULFILLMENT_BATCH_ISSUE",resultId:"2",completedAt:100,resultSummary:{lineSnapshot:"x".repeat(8192)}}),/8192/);
});

test("Inventory receipt decoder preserves original versions/snapshots and rejects broken native proof links",async()=>{
  const requests=[],completed=new Map();
  const operations={async claim(tx,input){requests.push(input);return {operationId:requests.length,replay:null};},async complete(tx,input){completed.set(String(input.operationId),input);}};
  const batch=await claimFulfillmentInventoryBatch({}, {operations,action:"ISSUE",payload,source:{eventId:"event"},actor:{userId:1},actorLabel:"Synthetic",timestamp:100,correlationId:""});
  batch.members[0].version=2;
  batch.members[0].legs[0].result={inventoryAllocationId:"7",inventoryBalanceId:"8",movementId:"11",baseQuantity:"5",allocationVersion:2,balanceVersion:2,baseUomId:"12",baseUomCode:"EA"};
  await completeFulfillmentInventoryBatch({},batch);
  const rows=requests.map((input,index)=>{const done=completed.get(String(index+1));return {id:index+1,command_type:input.commandType,source_module:"FULFILLMENT",source_document_type:input.source.documentType,source_document_id:input.source.documentId,source_event_id:input.source.eventId,source_line_id:input.source.lineId,request_hash:input.commandType===batch.contract.root?batch.requestHash:index===1?batch.members[0].requestHash:batch.members[0].legs[0].requestHash,result_type:done.resultType,result_id:done.resultId,completed_at:done.completedAt,result_summary:done.resultSummary};});
  const movement={id:11,operation_request_id:2,reservation_id:6,allocation_id:7,balance_id:8,quantity:5,balance_version_after:2,movement_type:"ISSUE",location_kind:"BIN",direction:"OUT",balance_before:10,balance_after:5,reversal_of_movement_id:null,warehouse_id:1,warehouse_code_snapshot:"WH",bin_id:2,bin_code_snapshot:"A",lot_id:null,lot_number_snapshot:"",expiry_date_snapshot:null,stock_status:"AVAILABLE",sku_id:3,sku_code_snapshot:"SYN",sku_name_snapshot:"Synthetic",posted_at:100};
  const tx={async query(sql,args){
    if(sql.includes("inventory_movements"))return [[movement]];
    if(sql.includes("WHERE id=?"))return [[rows[0]]];
    return [rows.filter(r=>r.source_document_type===args[0]&&r.command_type===args[3]&&r.result_type===args[4]&&r.source_line_id!==""&&r.completed_at!==null)];
  }};
  const read=()=>readFulfillmentInventoryBatch(tx,{action:"ISSUE",operationId:"1",documentId:"2",eventId:"event",requestHash:batch.requestHash});
  const result=(await read()).result;
  assert.equal(result.lines[0].reservations[0].allocations[0].bucketSnapshot.baseUomId,"12");
  assert.equal(result.lines[1].baseQuantity,"0");
  rows.push({...rows[1],id:4,source_line_id:"99",result_type:"MOVEMENT_GROUP",result_summary:{status:"POSTED"}});
  assert.deepEqual((await read()).result,result,"generic caller-labelled Issue is excluded from trusted complete members");
  for(const mutate of [()=>rows[0].result_summary.membershipDigest="bad",()=>rows[1].result_summary.rootRequestHash="bad",()=>rows[2].result_summary.legOrdinal=2,()=>rows[2].result_summary.baseQuantity="6",()=>movement.balance_version_after=3,()=>movement.direction="IN",()=>movement.location_kind="IN_TRANSIT",()=>movement.balance_after=6,()=>rows[1].completed_at=null]){
    const saved=structuredClone(rows),savedMovement=structuredClone(movement);mutate();
    await assert.rejects(read,{code:"INVENTORY_SOURCE_CONFLICT"});
    rows.splice(0,rows.length,...saved);Object.assign(movement,savedMovement);
  }
});
