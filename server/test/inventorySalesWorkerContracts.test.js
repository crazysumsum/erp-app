import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { InventoryReservationService } from "../src/modules/inventory/InventoryReservationService.js";
import { inventoryOperationHash } from "../src/modules/inventory/InventoryOperationService.js";

const name="sales.backorderAllocate",signal=new AbortController().signal;
const line={sourceLineId:1,skuId:12,orderedBaseQuantity:5,minimumRemainingDays:0};
const command={actor:{userId:null,serviceName:name,claimedRoles:[],claimedPermissions:[name]},source:{documentId:"42",eventId:"worker-event"},correlationId:"worker-event",payload:{warehouseId:2,expectedOrderVersion:3,lines:[line]}};
function fixture({principal={leaseOwner:"owner",signal},lease={owner:"owner",expires_at:101}}={}){
 const calls=[];
 const tx={async query(sql){calls.push(sql);if(sql.includes("fr_job_leases"))return [lease?[lease]:[]];if(sql.includes("UNIX_TIMESTAMP"))return [[{now:100}]];throw Error("Unexpected SQL");},async execute(){throw Error("Unexpected effect");}};
 const s=new InventoryReservationService({database:{withTransaction(){throw Error("Caller owns transaction");}},time:{nowMs:()=>100000,fileDate:()=>"2026-10-07"},authorize:()=>{throw Error("Worker must not impersonate a human");},authorizeSalesBackorder:principal===null?undefined:()=>principal,itemLookup:{},audit:{},locks:{},operations:{claim(){calls.push("claim");throw Error("claim reached");}}});
 return {s,tx,calls};
}
test("Backorder worker requires live fixed registration and DB-clock lease before any claim, including replay",async()=>{
 for(const options of [{principal:null},{principal:{}},{principal:{leaseOwner:"owner",signal:AbortSignal.abort()}},{lease:null},{lease:{owner:"other",expires_at:101}},{lease:{owner:"owner",expires_at:100}}]){
  const f=fixture(options);await assert.rejects(()=>f.s.reserveAvailableForSalesBackorderInTransaction(f.tx,command),{code:"PERMISSION_STALE"});assert.ok(!f.calls.includes("claim"));
 }
 const f=fixture();await assert.rejects(()=>f.s.reserveAvailableForSalesBackorderInTransaction(f.tx,command),/claim reached/u);assert.match(f.calls[0],/fr_job_leases.*FOR UPDATE/u);assert.match(f.calls[1],/UNIX_TIMESTAMP/u);
});
test("Backorder worker rejects human/arbitrary identity, extra authority and source input",async()=>{
 for(const change of [{actor:{...command.actor,userId:7}},{actor:{...command.actor,serviceName:"other"}},{actor:{...command.actor,claimedRoles:["admin"]}},{actor:{...command.actor,claimedPermissions:[name,"inventory.operation"]}},{source:{...command.source,module:"OTHER"}},{leaseOwner:"owner"}]){
  const f=fixture();await assert.rejects(()=>f.s.reserveAvailableForSalesBackorderInTransaction(f.tx,{...command,...change}));assert.ok(!f.calls.includes("claim"));
 }
});
test("Backorder completed replay uses distinct worker hashes and exact original members without mutable ATP reads",async()=>{
 const f=fixture(),rootHash=inventoryOperationHash({commandType:"SALES_BACKORDER_BATCH_RESERVE",payload:command.payload}),childHash=inventoryOperationHash({commandType:"SALES_BACKORDER_LINE_RESERVE",payload:{rootOperationId:8,rootRequestHash:rootHash,...line}});
 const member={operationId:9,commandType:"SALES_BACKORDER_LINE_RESERVE",sourceLineId:"1",requestHash:childHash,completedAt:100000,resultSummary:{...line,rootOperationId:8,rootRequestHash:rootHash,reservedBaseQuantity:3,uncoveredBaseQuantity:2,reservationId:10,version:1}};
 const summary={operationId:8,warehouseId:2,expectedOrderVersion:3,lineCount:1,membershipDigest:createHash("sha256").update(`1:${childHash}\n`).digest("hex")};let checks=0;
 f.s.authorizeSalesBackorder=()=>{checks++;return {leaseOwner:"owner",signal};};
 f.s.operations={async claim(_tx,input){assert.equal(input.commandType,"SALES_BACKORDER_BATCH_RESERVE");assert.equal(input.actorUserId,null);assert.equal(input.actorLabel,name);return {operationId:8,replay:{resultType:"SALES_RESERVATION_BATCH",resultId:"42",resultSummary:summary}};},async listSalesBatchMembers(_tx,{afterId}){return afterId?[]:[member];}};
 const result=await f.s.reserveAvailableForSalesBackorderInTransaction(f.tx,command);assert.deepEqual(result.lines,[member.resultSummary]);assert.equal(checks,2);
 member.commandType="SALES_LINE_RESERVE";await assert.rejects(()=>f.s.reserveAvailableForSalesBackorderInTransaction(f.tx,command),{code:"INVENTORY_SOURCE_CONFLICT"});assert.equal(checks,4);
 f.s.authorizeSalesBackorder=()=>null;await assert.rejects(()=>f.s.reserveAvailableForSalesBackorderInTransaction(f.tx,command),{code:"PERMISSION_STALE"});
});
