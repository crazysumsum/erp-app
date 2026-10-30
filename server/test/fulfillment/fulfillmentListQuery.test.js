import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFulfillmentListQuery, encodeFulfillmentListCursor, fulfillmentListPageQuery } from "../../src/modules/fulfillment/fulfillmentListQuery.js";
test("Fulfillment list normalizes only bounded exact filters and validates cursor binding/page",()=>{
  const first=normalizeFulfillmentListQuery({view:"active",pageSize:2,warehouseId:4}),cursor=encodeFulfillmentListCursor(first,{id:"12",last_business_updated_at:20});
  assert.deepEqual(normalizeFulfillmentListQuery({view:"active",pageSize:2,warehouseId:4,page:2,cursor}).after,{id:"12",value:20});
  for(const input of [{page:2},{pageSize:101},{view:"other"},{status:"SHIPPING"},{createdFrom:20,createdTo:10},{warehouseId:"4"},{hasShortPick:"false"},{unknown:"x"},{page:2,pageSize:2,warehouseId:5,cursor},{page:3,pageSize:2,warehouseId:4,cursor},{pageSize:2,warehouseId:4,cursor}])assert.throws(()=>normalizeFulfillmentListQuery(input),{code:"FULFILLMENT_INPUT_INVALID"});
});
test("List SQL binds actor and filters, seeks both sort keys, and has no OFFSET or unbounded search",()=>{
  const first=normalizeFulfillmentListQuery({view:"myRecent",q:"FUL-202610-000001",hasShortPick:false,createdFrom:1,pickedTo:9}),cursor=encodeFulfillmentListCursor(first,{id:"12",last_business_updated_at:20});
  const {sql,values}=fulfillmentListPageQuery(normalizeFulfillmentListQuery({view:"myRecent",q:"FUL-202610-000001",hasShortPick:false,createdFrom:1,pickedTo:9,page:2,cursor}),7);
  assert.match(sql,/created_by=\?/u);assert.match(sql,/last_business_updated_at<\?/u);assert.match(sql,/ORDER BY f.last_business_updated_at DESC,f.id DESC LIMIT \?/u);assert.doesNotMatch(sql,/OFFSET|LIKE|FUL-202610-000001/u);assert.ok(values.includes(7));
});

test("Common list sortBy/descending are allowlisted and bound into every seek cursor",()=>{
 for(const sortBy of ["lastBusinessUpdatedAt","createdAt","updatedAt","fulfillmentNumber","id"])for(const descending of [false,true]){
  const query=normalizeFulfillmentListQuery({sortBy,descending,pageSize:1}),last={id:"12",last_business_updated_at:20,created_at:20,updated_at:20,fulfillment_number:"FUL-202610-000012"},cursor=encodeFulfillmentListCursor(query,last);
  const next=normalizeFulfillmentListQuery({sortBy,descending,pageSize:1,page:2,cursor}),{sql}=fulfillmentListPageQuery(next,7);
  assert.match(sql,new RegExp(descending?" DESC":" ASC","u"));assert.equal(next.after.id,"12");
  assert.throws(()=>normalizeFulfillmentListQuery({sortBy,descending:!descending,pageSize:1,page:2,cursor}),{code:"FULFILLMENT_INPUT_INVALID"});
 }
 assert.throws(()=>normalizeFulfillmentListQuery({sortBy:"id;DROP"}),{code:"FULFILLMENT_INPUT_INVALID"});
});
