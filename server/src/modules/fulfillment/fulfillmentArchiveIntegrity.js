import {FULFILLMENT_ARCHIVE_CONTRACTS,hashFulfillmentArchiveRow,hashFulfillmentArchiveTable} from "./fulfillmentArchiveSchema.js";
import {readFulfillmentArchiveState} from "./fulfillmentArchiveState.js";
const marks=rows=>rows.map(()=>"?").join(",");
const identity=value=>{if(!/^[1-9][0-9]{0,15}$/u.test(String(value))||BigInt(value)>9007199254740991n)throw new TypeError("Invalid Archive integrity identity");return String(value);};
// Fixed owner-only readonly diagnostic. No participant capability, eligibility or mutation authority is granted.
export async function readFulfillmentArchiveIntegrity(tx,orderId,{archiveBatchId,archivedAtMs,tableCounts,hashSummary}){
 orderId=identity(orderId);const state=await readFulfillmentArchiveState(tx,orderId,{archived:true}),issues=[],tables=FULFILLMENT_ARCHIVE_CONTRACTS.map(c=>c.table),add=(code,id)=>issues.push({code,id:identity(id)});
 if(Object.keys(tableCounts??{}).sort().join(",")!==tables.slice().sort().join(",")||Object.keys(hashSummary??{}).sort().join(",")!==tables.slice().sort().join(","))add("ARCHIVE_OWNER_MANIFEST_MISMATCH",orderId);
 for(const table of tables){
  const rows=state[table],digest=hashFulfillmentArchiveTable(table,rows),code="ARCHIVE_"+table.toUpperCase();
  if(tableCounts?.[table]!==digest.count)add(code+"_COUNT_MISMATCH",orderId);if(hashSummary?.[table]!==digest.hash)add(code+"_HASH_MISMATCH",orderId);
  for(const row of rows)if(row.row_hash!==hashFulfillmentArchiveRow(table,row)||String(row.archive_batch_id)!==archiveBatchId||String(row.archived_at)!==archivedAtMs)add(code+"_ROW_HASH_MISMATCH",row.id);
  for(let start=0;start<rows.length;start+=500){const keys=rows.slice(start,start+500).map(row=>identity(row.id)),[active]=await tx.query(`SELECT id FROM ${table} FORCE INDEX (PRIMARY) WHERE id IN (${marks(keys)}) LIMIT 1`,keys);if(active.length)add(code+"_ACTIVE_RESIDUE",active[0].id);}
 }
 // A new audit ID can survive an absent root without being represented among mirror IDs.
 for(const [type,rows]of [["FULFILLMENT",state.fulfillments],["SHIPMENT",state.shipments],["REVERSAL",state.shipment_reversals]])for(let start=0;start<rows.length;start+=500){const keys=rows.slice(start,start+500).map(row=>identity(row.id)),[active]=await tx.query(`SELECT id FROM fulfillment_audit_logs WHERE target_type=? AND target_id IN (${marks(keys)}) LIMIT 1`,[type,...keys]);if(active.length)add("ARCHIVE_AUDIT_ACTIVE_RESIDUE",active[0].id);}
 for(const operation of state.operations){
  if(!["FAILED","SUCCEEDED"].includes(operation.status))add("ARCHIVE_OWNER_OPERATION_STATE_MISMATCH",operation.id);
  const targets=operation.target_type==="FULFILLMENT"?state.fulfillments:operation.target_type==="SHIPMENT"?state.shipments:null;
  if(Number(operation.is_document_archived)!==1||!targets||operation.target_id===null&&operation.status!=="FAILED"||operation.target_id!==null&&!targets.some(row=>String(row.id)===String(operation.target_id)&&String(row.sales_order_id)===orderId))add("ARCHIVE_OWNER_OPERATION_ROUTE_MISMATCH",operation.id);
 }
 return issues;
}
