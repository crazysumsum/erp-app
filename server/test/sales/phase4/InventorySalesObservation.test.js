import assert from "node:assert/strict";
import test from "node:test";
import {InventoryReservationService} from "../../../src/modules/inventory/InventoryReservationService.js";
const command={version:"1",observedAtMs:1000,demands:[{warehouseId:1,skuId:2,sourceLineId:3,minimumSaleLifeDays:0}]};
function service(authorizeSalesObservation){return new InventoryReservationService({database:{withTransaction(){throw Error("No implicit transaction");},context:{get:()=>({databaseTransaction:null})}},time:{nowMs:()=>1000,fileDate:()=>"2026-10-28"},authorizeSalesObservation,itemLookup:{},audit:{},operations:{},locks:{},fulfillment:{}});}
test("OBS-F01 Sales metrics cannot borrow arbitrary or human transactions to read Inventory",async()=>{
 for(const authorize of [undefined,()=>null,()=>({leaseOwner:"forged",signal:new AbortController().signal})]){const owner=service(authorize),tx={query(){throw Error("Inventory data must not be read");}};await assert.rejects(()=>owner.readSalesAvailabilityForObservationInTransaction(tx,command),{code:"PERMISSION_STALE"});}
});
test("OBS-F01 owner rejects unbounded, duplicate and invented-authority observation requests",async()=>{
 const owner=service(()=>({leaseOwner:"forged",signal:new AbortController().signal})),tx={query(){throw Error("No read before validation");}};
 for(const input of [{...command,serviceName:"sales.metrics"},{...command,version:"x"},{...command,demands:[]},{...command,demands:Array(501).fill(command.demands[0])},{...command,demands:[command.demands[0],command.demands[0]]},{...command,demands:[{...command.demands[0],minimumSaleLifeDays:-1}]}])await assert.rejects(()=>owner.readSalesAvailabilityForObservationInTransaction(tx,input));
});
