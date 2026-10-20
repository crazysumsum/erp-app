import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { hashFulfillmentArchiveRow, hashFulfillmentArchiveTable, FULFILLMENT_ARCHIVE_CONTRACTS } from "../src/modules/fulfillment/fulfillmentArchiveSchema.js";

const table = "fulfillment_status_history";
const history = () => ({ id: "1", fulfillment_id: "2", sequence_no: 1, from_status: null, to_status: "SHIPPED",
  action: "SHIP", reason: "Synthetic", event_id: "11111111-1111-4111-8111-111111111111", version_after: 2,
  actor_user_id: null, actor_label: "Synthetic operator", occurred_at: 1700000000000 });
const audit = () => ({ id: "1", target_type: "FULFILLMENT", target_id: "2", action: "ARCHIVE", event_id: null,
  correlation_id: "11111111-1111-4111-8111-111111111111", actor_user_id: null, actor_label: "Synthetic operator",
  before_summary: { quantity: "9007199254740992", version: 1 }, after_summary: null, details: null,
  ip_address: "", is_archived: 0, occurred_at: 1700000000000 });
function shipment() {
  const columns=FULFILLMENT_ARCHIVE_CONTRACTS.find(contract=>contract.table==="shipments").columns;
  const row=Object.fromEntries(Object.entries(columns).map(([name, column])=>[name, column.nullable ? null
    : column.type.startsWith("varchar") || column.type.startsWith("char") ? ""
    : column.type === "date" ? "2020-01-02" : column.type === "json" ? {} : "1"]));
  row.total_weight="1.000000";return row;
}
test("TC-048 canonical owner row hash is independent of object insertion order",()=>{
 const row=history();assert.equal(hashFulfillmentArchiveRow(table,row),hashFulfillmentArchiveRow(table,Object.fromEntries(Object.entries(row).reverse())));
});
test("TC-048 historical UTF-8 snapshot bytes affect the digest",()=>{
 assert.notEqual(hashFulfillmentArchiveRow(table,history()),hashFulfillmentArchiveRow(table,{...history(),reason:"合成測試"}));
});
test("TC-048 null and empty historical snapshot remain distinct",()=>{
 assert.notEqual(hashFulfillmentArchiveRow(table,history()),hashFulfillmentArchiveRow(table,{...history(),from_status:""}));
});
test("TC-048 safe integer values normalize to exact decimal strings",()=>{
 assert.equal(hashFulfillmentArchiveRow(table,history()),hashFulfillmentArchiveRow(table,{...history(),id:1,sequence_no:"1"}));
});
test("TC-048 unsafe numeric historical quantities are rejected before hashing",()=>{
 assert.throws(()=>hashFulfillmentArchiveRow(table,{...history(),occurred_at:Number.MAX_SAFE_INTEGER+1}),TypeError);
});
test("TC-048 malformed and out-of-range unsigned values cannot acquire a digest",()=>{
 for(const value of ["01","-1","1e3","18446744073709551616",0.5])assert.throws(()=>hashFulfillmentArchiveRow(table,{...history(),id:value}),TypeError);
});
test("TC-048 fixed-scale decimal normalization avoids floating-point conversion",()=>{
 const row=shipment();assert.equal(hashFulfillmentArchiveRow("shipments",row),hashFulfillmentArchiveRow("shipments",{...row,total_weight:"1.0"}));
});
test("TC-048 decimal overflow, excess scale and Number inputs are rejected",()=>{
 for(const value of ["1.0000001","100000000000000.000000",1.2,"1e3"])assert.throws(()=>hashFulfillmentArchiveRow("shipments",{...shipment(),total_weight:value}),TypeError);
});
test("TC-048 canonical JSON sorts object keys while preserving exact quantity strings",()=>{
 const row=audit();assert.equal(hashFulfillmentArchiveRow("fulfillment_audit_logs",row),hashFulfillmentArchiveRow("fulfillment_audit_logs",{...row,before_summary:{version:1,quantity:"9007199254740992"}}));
});
test("TC-048 JSON array order is business data and changes the digest",()=>{
 const row=audit();assert.notEqual(hashFulfillmentArchiveRow("fulfillment_audit_logs",{...row,details:[1,2]}),hashFulfillmentArchiveRow("fulfillment_audit_logs",{...row,details:[2,1]}));
});
test("TC-048 unsafe or non-finite JSON numbers fail closed",()=>{
 for(const value of [Number.MAX_SAFE_INTEGER+1,NaN,Infinity])assert.throws(()=>hashFulfillmentArchiveRow("fulfillment_audit_logs",{...audit(),details:{value}}),TypeError);
});
test("TC-048 DATE normalization rejects invalid dates and Date objects",()=>{
 for(const value of ["2024-02-30","2024-2-01",new Date("2024-01-01")])assert.throws(()=>hashFulfillmentArchiveRow("shipments",{...shipment(),shipment_date:value}),TypeError);
});
test("TC-048 archive metadata never changes a business-row digest",()=>{
 assert.equal(hashFulfillmentArchiveRow(table,history()),hashFulfillmentArchiveRow(table,{...history(),archive_batch_id:"9",archived_at:1700000000001,row_hash:"a".repeat(64)}));
});
test("TC-048 missing or unexpected business fields are rejected",()=>{
 const row=history();delete row.reason;assert.throws(()=>hashFulfillmentArchiveRow(table,row),TypeError);
 assert.throws(()=>hashFulfillmentArchiveRow(table,{...history(),unknown:true}),TypeError);
});
test("TC-049 an empty owner table has the SHA256 empty digest",()=>{
 assert.deepEqual(hashFulfillmentArchiveTable(table,[]),{count:0,hash:createHash("sha256").update("").digest("hex")});
});
test("TC-049 table digest binds row identities and row content in numeric ID order",()=>{
 const first=history(),second={...history(),id:"2"};const expected=createHash("sha256").update(`1:${hashFulfillmentArchiveRow(table,first)}\n2:${hashFulfillmentArchiveRow(table,second)}\n`).digest("hex");
 assert.deepEqual(hashFulfillmentArchiveTable(table,[first,second]),{count:2,hash:expected});
});
test("TC-049 unordered or duplicate row identities cannot produce a manifest",()=>{
 for(const rows of [[{...history(),id:"2"},history()],[history(),history()]])assert.throws(()=>hashFulfillmentArchiveTable(table,rows),TypeError);
});

test("TC-048 finite fractional JSON values retain their value",()=>{
 const row={...audit(),details:{durationMs:1.5}};
 assert.match(hashFulfillmentArchiveRow("fulfillment_audit_logs",row),/^[0-9a-f]{64}$/u);
});
