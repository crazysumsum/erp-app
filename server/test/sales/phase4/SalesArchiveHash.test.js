import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SALES_ARCHIVE_COLUMNS, hashSalesArchiveRow, hashSalesArchiveRows } from "../../../src/modules/sales/salesArchiveHash.js";

const history = {id:2,sales_order_id:1,sequence_no:1,from_status:null,to_status:"CANCELLED",action:"cancelled",reason:"Synthetic",order_version_after:2,event_id:"00000000-0000-4000-8000-000000000001",actor_user_id:null,actor_label:"測試",occurred_at:1700000000000};
const table="sales_order_status_history";
const line={id:2,sales_order_id:1,line_no:1,sku_id:1,item_name_snapshot:"Item",sku_code_snapshot:"SKU",sku_name_snapshot:"SKU",sku_uom_id:1,uom_code_snapshot:"EA",uom_name_snapshot:"Each",to_base_factor_snapshot:1,tracking_policy_snapshot:"none",minimum_sale_life_days_snapshot:0,ordered_quantity:"1",ordered_base_quantity:1,unit_selling_price:"2.5",price_source:"MANUAL",line_amount:"2.5",reserved_outstanding_base_quantity:0,backordered_base_quantity:0,fulfilled_base_quantity:0,cancelled_base_quantity:1,line_note:"",version:1,created_at:1700000000000,updated_at:1700000000000};
test("TC-048 history hash uses fixed business-column order with an independently fixed UTF-8 vector",()=>{
  assert.equal(hashSalesArchiveRow(table,history),"0df4848247d873bf531ed5066d96320e45a391e7329f00d96d3b3986e2277f2d");
  assert.equal(hashSalesArchiveRow(table,Object.fromEntries(Object.entries(history).reverse())),hashSalesArchiveRow(table,history));
});
test("TC-048 metadata is excluded while every original business value participates",()=>{
  assert.equal(hashSalesArchiveRow(table,{...history,archive_batch_id:9,archived_at:1800000000000,row_hash:"f".repeat(64)}),hashSalesArchiveRow(table,history));
  for(const [field,value]of [["actor_label","測試2"],["occurred_at",1700000000001],["reason","synthetic"],["from_status",""]])assert.notEqual(hashSalesArchiveRow(table,{...history,[field]:value}),hashSalesArchiveRow(table,history));
});
test("TC-048 canonical integer strings and safe Numbers identify the same values",()=>{
  assert.equal(hashSalesArchiveRow(table,{...history,id:"2",sales_order_id:"1",occurred_at:"1700000000000"}),hashSalesArchiveRow(table,history));
});
test("TC-048 exact decimal strings normalize declared scale without floating-point conversion",()=>{
  assert.equal(hashSalesArchiveRow("sales_order_lines",line),hashSalesArchiveRow("sales_order_lines",{...line,ordered_quantity:"1.000000",unit_selling_price:"2.5000",line_amount:"2.5000"}));
  assert.notEqual(hashSalesArchiveRow("sales_order_lines",line),hashSalesArchiveRow("sales_order_lines",{...line,line_amount:"2.5001"}));
  for(const value of [2.5,"2e0","02.50","2.50001","1000000000000000.0000"])assert.throws(()=>hashSalesArchiveRow("sales_order_lines",{...line,line_amount:value}),TypeError);
});
test("TC-048 missing/extra fields and unknown table identities fail before producing a hash",()=>{
  const {reason: _reason,...missing}=history;
  for(const row of [missing,{...history,typo:"x"},null,[]])assert.throws(()=>hashSalesArchiveRow(table,row),TypeError);
  assert.throws(()=>hashSalesArchiveRow("sales_orders;DROP TABLE users",history),TypeError);
});
test("TC-048 unsafe identities and malformed integer representations fail closed",()=>{
  for(const value of [0,-1,1.2,Number.MAX_SAFE_INTEGER+1,"9007199254740992","02","2.0",null,undefined])assert.throws(()=>hashSalesArchiveRow(table,{...history,id:value}),TypeError);
  for(const value of [-1,"18446744073709551616",1.1])assert.throws(()=>hashSalesArchiveRow(table,{...history,occurred_at:value}),TypeError);
});
test("TC-048 nullable and empty snapshots remain distinct; no Unicode case normalization",()=>{
  assert.notEqual(hashSalesArchiveRow(table,history),hashSalesArchiveRow(table,{...history,from_status:""}));
  assert.notEqual(hashSalesArchiveRow(table,{...history,actor_label:"A"}),hashSalesArchiveRow(table,{...history,actor_label:"a"}));
  assert.throws(()=>hashSalesArchiveRow(table,{...history,actor_label:null}),TypeError);
});
test("TC-049 empty table digest is explicit and does not depend on metadata",async()=>{
  assert.deepEqual(await hashSalesArchiveRows(table,[]),{count:0,hash:createHash("sha256").digest("hex")});
});
test("TC-049 streamed table digest is ascending numeric ID plus original-row hash and LF",async()=>{
  const rows=[history,{...history,id:10,sequence_no:2}],expected=createHash("sha256").update(`2:${hashSalesArchiveRow(table,rows[0])}\n10:${hashSalesArchiveRow(table,rows[1])}\n`).digest("hex");
  async function* stream(){yield rows[0];yield rows[1];}
  assert.deepEqual(await hashSalesArchiveRows(table,stream()),{count:2,hash:expected});
});
test("TC-049 duplicate or unordered IDs are rejected rather than silently sorted",async()=>{
  for(const rows of [[history,history],[{...history,id:10},history]])await assert.rejects(()=>hashSalesArchiveRows(table,rows),TypeError);
});
test("TC-049 iterator failures propagate without returning a partial successful manifest",async()=>{
  async function* broken(){yield history;throw new Error("Synthetic read failure");}
  await assert.rejects(()=>hashSalesArchiveRows(table,broken()),/Synthetic read failure/u);
});
test("TC-048 exact six-table column catalog is immutable",()=>{
  assert.equal(Object.keys(SALES_ARCHIVE_COLUMNS).length,6);
  assert.ok(Object.isFrozen(SALES_ARCHIVE_COLUMNS));for(const columns of Object.values(SALES_ARCHIVE_COLUMNS)){assert.ok(Object.isFrozen(columns));assert.ok(!columns.includes("row_hash"));}
});
