import assert from "node:assert/strict";
import test from "node:test";
import { InventoryFulfillmentService } from "../../src/modules/inventory/InventoryFulfillmentService.js";
const payload={fulfillmentId:"1",shipmentId:"2",lines:[{fulfillmentLineId:"3",salesOrderLineId:"4",baseQuantity:"1",reservations:[{claimId:"5",inventoryReservationId:"6",expectedVersion:1,baseQuantity:"1",allocations:[{inventoryAllocationId:"7",inventoryBalanceId:"8",expectedVersion:1,expectedBalanceVersion:1,baseQuantity:"1"}]}]}]};
test("Inventory batch rejects missing and counterfeit transaction executors before querying",async()=>{
  let queries=0;const tx={query(){queries++;},execute(){queries++;}},context={get:()=>({databaseTransaction:tx,auth:{claims:{sub:"1",roles:[],permissions:["fulfillment.view","fulfillment.operation"]}}})};
  const service=new InventoryFulfillmentService({database:{context,withTransaction(){}},time:{nowMs:()=>100,fileDate:()=>"2026-10-21"},logger:{error(){}}});
  const command={actor:{userId:1,serviceName:"",claimedRoles:[],claimedPermissions:["fulfillment.view","fulfillment.operation"]},source:{documentId:"2",eventId:"00000000-0000-4000-8000-000000000001"},correlationId:"",payload};
  await assert.rejects(service.postFulfillmentIssueBatchInTransaction(null,command));
  for(const changed of [{...command,purpose:"fulfillment.issue"},{...command,authorization:{purpose:"fulfillment.issue",requiredCallerPermission:"inventory.operation"}}, {...command,actor:{...command.actor,userId:2}},{...command,actor:{...command.actor,serviceName:"trusted"}},{...command,source:{...command.source,documentId:"3"}}])await assert.rejects(service.postFulfillmentIssueBatchInTransaction(tx,changed));
  assert.equal(queries,0);
  await assert.rejects(service.verifyFulfillmentBatchReceiptInTransaction(tx,{action:"ISSUE",operationId:"1",shipmentId:"2",eventId:command.source.eventId,requestHash:"a".repeat(64)}));
});
