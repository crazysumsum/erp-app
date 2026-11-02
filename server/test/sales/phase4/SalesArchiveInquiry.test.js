import assert from "node:assert/strict";
import test from "node:test";
import {SalesArchiveInquiryService,validateSalesArchiveQuery} from "../../../src/modules/sales/SalesArchiveInquiryService.js";
import {ListArchivedSalesOrdersHandler,GetArchivedSalesOrderHandler,ListArchivedSalesOrderAuditHandler} from "../../../src/handlers/archived-sales-orders/archivedSalesOrderHandlers.js";
import {ListSalesArchiveBatchesHandler} from "../../../src/handlers/sales-archive-batches/listSalesArchiveBatchesHandler.js";
const claims={actorId:1,claimedRoles:["reader"],claimedPermissions:["sales.view"]};
function database(read){const calls=[];const tx={async query(sql,args){calls.push({sql,args});if(sql.includes("SELECT username FROM users"))return [[{username:"reader"}]];if(sql.includes("FROM roles r JOIN user_roles"))return [[{name:"reader"}]];if(sql.includes("SELECT DISTINCT p.name"))return [[{name:"sales.view"}]];return read(sql,args);},execute(){throw Error("Archive inquiry must never write");}};return {calls,query:tx.query,withTransaction:work=>work(tx)};}
test("TC-050 Archive query rejects empty/unbounded/partial/oversized dates before SQL",async()=>{
 for(const input of [{},{q:"customer"},{status:"CANCELLED"},{number:""},{orderDateFrom:"2023-01-01"},{orderDateTo:"2023-01-01"},{orderDateFrom:"2023-01-01",orderDateTo:"2024-01-02"},{customerId:0},{number:"SO-202310-000001",pageSize:101},{number:"SO-202310-000001",sortBy:"id DESC;"}])assert.throws(()=>validateSalesArchiveQuery(input),{code:"SALES_INPUT_INVALID"});
 for(const input of [{number:"SO-202310-000001"},{externalOrderId:"exact"},{customerId:1},{orderDateFrom:"2024-01-01",orderDateTo:"2024-12-31"}])assert.equal(validateSalesArchiveQuery(input).pageSize,20);
});
test("TC-050 all four Archive APIs are GET-only and require current sales.view",()=>{
 const handlers=[ListArchivedSalesOrdersHandler,GetArchivedSalesOrderHandler,ListArchivedSalesOrderAuditHandler,ListSalesArchiveBatchesHandler];assert.equal(new Set(handlers.map(h=>h.api.path)).size,4);
 for(const H of handlers){assert.equal(H.api.method,"GET");assert.deepEqual(H.api.authorizationPolicies,[{name:"hasPermission",options:{permissions:["sales.view"]}}]);assert.equal(H.api.requestSchema.body.additionalProperties,false);}
 assert.equal(ListArchivedSalesOrdersHandler.api.path,"/api/v1/archived-sales-orders");assert.equal(GetArchivedSalesOrderHandler.api.path,"/api/v1/archived-sales-orders/:id");assert.equal(ListArchivedSalesOrderAuditHandler.api.path,"/api/v1/archived-sales-orders/:id/audit");assert.equal(ListSalesArchiveBatchesHandler.api.path,"/api/v1/sales-archive-batches");
});
test("TC-050 Active External Key never falls through to Archive or Active business tables",async()=>{
 const db=database(sql=>{assert.match(sql,/FROM sales_external_order_keys/u);return [[{id:8,sales_order_id:17,is_order_archived:0}]];});
 assert.deepEqual(await new SalesArchiveInquiryService({database:db}).list({claims,input:{externalOrderId:"exact",channelCode:"one"}}),{items:[],total:0,page:1,pageSize:20});
 assert.ok(db.calls.some(c=>c.sql.includes("external_order_id_hash")));assert.ok(db.calls.every(c=>!c.sql.includes("FROM sales_orders")));
});
test("TC-050 missing Archive detail and Audit never read Active or current masters",async()=>{
 const db=database(sql=>{assert.match(sql,/FROM sales_orders_archive/u);return [[]];}),service=new SalesArchiveInquiryService({database:db});
 await assert.rejects(()=>service.get({claims,id:5}),{code:"SALES_ORDER_NOT_FOUND"});await assert.rejects(()=>service.listAudit({claims,id:5,input:{}}),{code:"SALES_ORDER_NOT_FOUND"});
 assert.ok(db.calls.every(c=>! /FROM sales_orders(?:\s|$)|FROM customers|FROM items/u.test(c.sql)));
});
test("TC-050 batch metrics whitelist never exposes cursor/pending order IDs or leases",async()=>{
 const row={id:2,batch_number:"SA-202610-000001",period_key:"202610",cutoff_at:1,status:"PARTIAL",candidate_count:1,archived_count:0,skipped_count:0,failed_count:1,started_at:2,updated_at:4,completed_at:null,lease_owner:"SECRET_OWNER",last_scanned_order_id:777,checksum_summary:{cursor:{id:"777"},pending:[{candidate:{id:"777"},code:"ARCHIVE_DATA_CONFLICT",outcome:"FAILED"}],amountTotal:"0",amountHash:"a".repeat(64),manifestHash:"b".repeat(64),salesTableCounts:{sales_orders:0},fulfillmentTableCounts:{fulfillments:0}}};
 const db=database(sql=>sql.includes("COUNT(*)")?[[{total:1}]]:[[row]]),result=await new SalesArchiveInquiryService({database:db}).listBatches({claims,input:{}}),serialized=JSON.stringify(result);
 assert.equal(result.items[0].candidateCount,1);assert.deepEqual(result.items[0].errors,[{code:"ARCHIVE_DATA_CONFLICT",count:1}]);for(const secret of ["777","SECRET_OWNER","cursor","pending","lease_owner","last_scanned"])assert.ok(!serialized.includes(secret),secret);
});
test("TC-050 Archive service rechecks revoked permissions before business queries",async()=>{
 const db=database(()=>{throw Error("Business query before permission check");});await assert.rejects(()=>new SalesArchiveInquiryService({database:db}).list({claims:{...claims,claimedPermissions:["sales.view","sales.mgmt"]},input:{customerId:1}}),{code:"PERMISSION_STALE"});
});
