import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {SalesOrderConfirmationService} from "../../../src/modules/sales/SalesOrderConfirmationService.js";
test("TC-037 manual operation lookup hides Import events without dereferencing a null result",async()=>{
 const claims={actorId:1,claimedRoles:["sales"],claimedPermissions:["sales.view","sales.mgmt"]},tx={async query(sql){if(sql.startsWith("SELECT username FROM users"))return [[{username:"Synthetic"}]];if(sql.includes("SELECT r.name"))return [[{name:"sales"}]];if(sql.includes("SELECT DISTINCT p.name"))return [claims.claimedPermissions.map(name=>({name}))];if(sql.startsWith("SELECT id FROM sales_operation_requests"))return [sql.includes("target_type IN ('SALES_ORDER','QUOTATION')")?[]:[{id:1}]];throw Error("unexpected query");}},service=new SalesOrderConfirmationService({database:{withTransaction:work=>work(tx)}});service.operations.getForActor=async()=>null;
 await assert.rejects(()=>service.lookup({claims,eventId:randomUUID()}),{code:"SALES_ORDER_NOT_FOUND"});
});
