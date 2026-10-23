import {FULFILLMENT_ARCHIVE_CONTRACTS,hashFulfillmentArchiveRow} from "./fulfillmentArchiveSchema.js";
const marks=ids=>ids.map(()=>"?").join(",");
const sorted=rows=>rows.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
const ids=rows=>rows.map(row=>String(row.id));
// Fixed owner catalogue only. Each statement and each primary-key lock batch is bounded to 500 rows.
// Locking use requires the coordinator's earlier complete operation fences and fresh view; this helper grants neither.
export async function readFulfillmentArchiveState(tx,orderId,{lock=false}={}){
 const state=Object.fromEntries(FULFILLMENT_ARCHIVE_CONTRACTS.map(c=>[c.table,[]]));
 async function lockRows(table,rows){
  const columns=Object.keys(FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table===table).columns).join(",");
  for(let start=0;start<rows.length;start+=500){
   const batch=rows.slice(start,start+500),[current]=await tx.query(`SELECT ${columns} FROM ${table} FORCE INDEX (PRIMARY) WHERE id IN (${marks(batch)}) ORDER BY id FOR UPDATE`,ids(batch));
   if(current.length!==batch.length||current.some((row,i)=>hashFulfillmentArchiveRow(table,row)!==hashFulfillmentArchiveRow(table,batch[i])))throw new TypeError("Archive membership changed");
  }
 }
 async function read(table,column,parents,extra="",extraArgs=[]){
  const contract=FULFILLMENT_ARCHIVE_CONTRACTS.find(c=>c.table===table),columns=Object.keys(contract.columns).join(","),rows=[];
  for(let start=0;start<parents.length;start+=500){
   const batch=parents.slice(start,start+500);let after="0";
   for(;;){
    const [page]=await tx.query(`SELECT ${columns} FROM ${table} WHERE ${column} IN (${marks(batch)})${extra} AND id>? ORDER BY id LIMIT 500`,[...batch,...extraArgs,after]);
    for(const row of page){if(BigInt(row.id)<=BigInt(after))throw new TypeError("Invalid Archive row ordering");after=String(row.id);rows.push(row);}
    if(page.length<500)break;
   }
  }
  sorted(rows);
  if(new Set(ids(rows)).size!==rows.length)throw new TypeError("Duplicate Archive membership");
  if(lock&&table!=="fulfillment_audit_logs")await lockRows(table,rows);
  state[table].push(...rows);return rows;
 }
 const roots=await read("fulfillments","sales_order_id",[orderId]),rootIds=ids(roots);
 await read("fulfillment_lines","fulfillment_id",rootIds);
 await read("fulfillment_line_reservation_claims","fulfillment_id",rootIds);
 await read("fulfillment_allocations","fulfillment_id",rootIds);
 await read("fulfillment_status_history","fulfillment_id",rootIds);
 const shipments=await read("shipments","sales_order_id",[orderId]),shipmentIds=ids(shipments);
 await read("shipment_lines","shipment_id",shipmentIds);
 await read("shipment_issue_details","shipment_id",shipmentIds);
 await read("shipment_status_history","shipment_id",shipmentIds);
 const reversals=await read("shipment_reversals","shipment_id",shipmentIds);
 await read("shipment_reversal_details","reversal_id",ids(reversals));
 for(const [type,parents]of [["FULFILLMENT",rootIds],["SHIPMENT",shipmentIds],["REVERSAL",ids(reversals)]])await read("fulfillment_audit_logs","target_id",parents," AND target_type=?",[type]);
 sorted(state.fulfillment_audit_logs);
 if(lock)await lockRows("fulfillment_audit_logs",state.fulfillment_audit_logs);
 state.operations=[];let after="0";
 for(;;){const [page]=await tx.query("SELECT id,sales_order_id,status,target_type,target_id,is_document_archived FROM fulfillment_operation_requests FORCE INDEX (idx_ful_operation_archive_order) WHERE sales_order_id=? AND id>? ORDER BY id LIMIT 500",[orderId,after]);for(const row of page){if(BigInt(row.id)<=BigInt(after)||String(row.sales_order_id)!==orderId)throw new TypeError("Invalid Archive operation route");after=String(row.id);state.operations.push(row);}if(page.length<500)break;}
 state.archivedOperationTargets=[];
 for(const [type,table]of [["FULFILLMENT","fulfillments_archive"],["SHIPMENT","shipments_archive"]]){
  const targets=[...new Set(state.operations.filter(row=>row.target_type===type&&Number(row.is_document_archived)===1&&row.target_id!==null).map(row=>String(row.target_id)))];
  for(let offset=0;offset<targets.length;offset+=500){const batch=targets.slice(offset,offset+500),[rows]=await tx.query(`SELECT id,sales_order_id FROM ${table} WHERE id IN (${marks(batch)}) ORDER BY id`,batch);state.archivedOperationTargets.push(...rows.map(row=>({...row,target_type:type})));}
 }
 state.orderId=orderId;return state;
}
export function archiveStateFacts(state,atMs){
 const facts={inconsistent:false,nonterminalFulfillments:false,nonterminalShipments:false,reversing:false,activeClaims:false,outstandingAllocations:false,inProgressOperations:false};
 try{
  for(const {table}of FULFILLMENT_ARCHIVE_CONTRACTS)for(const row of state[table]){
   hashFulfillmentArchiveRow(table,row);
   for(const [key,value]of Object.entries(row))if(key.endsWith("_at")&&value!==null&&BigInt(value)>BigInt(atMs))facts.inconsistent=true;
  }
  const roots=new Set(ids(state.fulfillments)),shipments=new Set(ids(state.shipments));
  for(const row of state.fulfillments){
   if(String(row.sales_order_id)!==state.orderId||Number(row.line_count)<1||Number(row.line_count)>100||state.fulfillment_lines.filter(line=>String(line.fulfillment_id)===String(row.id)).length!==Number(row.line_count))facts.inconsistent=true;
   facts.nonterminalFulfillments ||= !["SHIPPED","CANCELLED","REVERSED"].includes(row.status);
   if(row.active_shipment_id!==null&&!state.shipments.some(s=>String(s.id)===String(row.active_shipment_id)&&String(s.fulfillment_id)===String(row.id)))facts.inconsistent=true;
  }
  for(const row of state.shipments){
   if(String(row.sales_order_id)!==state.orderId||!roots.has(String(row.fulfillment_id))||Number(row.line_count)<1||Number(row.line_count)>100||state.shipment_lines.filter(line=>String(line.shipment_id)===String(row.id)).length!==Number(row.line_count))facts.inconsistent=true;
   facts.nonterminalShipments ||= !["SHIPPED","CANCELLED","REVERSED"].includes(row.status);
  }
  for(const row of state.fulfillment_lines)if(String(row.sales_order_id)!==state.orderId||!roots.has(String(row.fulfillment_id)))facts.inconsistent=true;
  for(const row of state.shipment_reversals){if(!shipments.has(String(row.shipment_id)))facts.inconsistent=true;facts.reversing ||=row.status==="REVERSING";}
  facts.activeClaims=state.fulfillment_line_reservation_claims.some(row=>BigInt(row.active_claimed_quantity)>0n);
  facts.outstandingAllocations=state.fulfillment_allocations.some(row=>!["RELEASED","CONSUMED"].includes(row.status));
  facts.inProgressOperations=state.operations.some(row=>row.status==="IN_PROGRESS");
  for(const row of state.operations){
   if(![0,1].includes(Number(row.is_document_archived))){facts.inconsistent=true;continue;}
   if(row.target_id===null)continue;
   const active=row.target_type==="FULFILLMENT"?roots:shipments;
   if(Number(row.is_document_archived)===0){if(!active.has(String(row.target_id)))facts.inconsistent=true;}
   else if(active.has(String(row.target_id))||!state.archivedOperationTargets.some(target=>target.target_type===row.target_type&&String(target.id)===String(row.target_id)&&String(target.sales_order_id)===state.orderId))facts.inconsistent=true;
  }
  if(state.operations.some(row=>!["FAILED","SUCCEEDED","IN_PROGRESS"].includes(row.status)||!["FULFILLMENT","SHIPMENT"].includes(row.target_type)))facts.inconsistent=true;
 }catch{facts.inconsistent=true;}
 return facts;
}
