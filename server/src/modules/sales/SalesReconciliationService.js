import {randomUUID,createHash} from "node:crypto";
import {requireSalesWriteActor} from "./salesAuthorization.js";
import {SALES_ARCHIVE_COLUMNS,hashSalesArchiveRow,hashSalesArchiveRows} from "./salesArchiveHash.js";
import {readFulfillmentArchiveIntegrity} from "../fulfillment/fulfillmentArchiveIntegrity.js";
import {INVENTORY_RESERVATION_STATUSES} from "../inventory/inventoryConstants.js";
import {InventoryReservationService} from "../inventory/InventoryReservationService.js";
import {getActiveTransactionIsolation} from "../../services/mysqldatabase/MySqlDatabaseService.js";

const quantity=value=>{
 if(typeof value==="number"&&!Number.isSafeInteger(value)||!["number","string"].includes(typeof value)||!/^(0|[1-9][0-9]*)$/u.test(String(value))||BigInt(value)>18446744073709551615n)throw new TypeError("Invalid reconciliation quantity");
 return BigInt(value);
};
const identity=value=>{const n=quantity(value);if(n<1n||n>9007199254740991n)throw new TypeError("Invalid reconciliation identity");return String(n);};
function byId(rows){const map=new Map(rows.map(row=>[identity(row.id),row]));if(map.size!==rows.length)throw new TypeError("Duplicate reconciliation identity");return map;}
export function compareSalesCommitments({header,lines,mappings,backorders,inventoryRows}){
 if(!["DRAFT","CONFIRMING","CONFIRMED","PARTIALLY_FULFILLED","COMPLETED","CLOSED","CANCELLED"].includes(header.status))throw new TypeError("Invalid reconciliation status");
 const issues=[],add=(code,id)=>issues.push({code,id:identity(id)}),orderId=identity(header.id),lineMap=byId(lines),inventory=byId(inventoryRows);byId(mappings);byId(backorders);
 const totals=new Map(lines.map(line=>[identity(line.id),{mapped:0n,consumed:0n,inventory:0n,backorder:0n}])),mappedIds=new Set();
 const lineNumbers=lines.map(line=>Number(quantity(line.line_no))).sort((a,b)=>a-b);
 if(Number(header.line_count)!==lines.length||lines.length<1||lines.length>100||lineNumbers.some((n,i)=>n!==i+1)||lines.some(line=>identity(line.sales_order_id)!==orderId))add("LINE_MEMBERSHIP_MISMATCH",orderId);
 for(const row of mappings){
  identity(row.inventory_version);
  const lineId=identity(row.sales_order_line_id),reservationId=identity(row.inventory_reservation_id),original=quantity(row.original_base_quantity),consumed=quantity(row.consumed_base_quantity),released=quantity(row.released_base_quantity),outstanding=quantity(row.outstanding_base_quantity);
  if(mappedIds.has(reservationId))throw new TypeError("Duplicate Inventory reconciliation membership");mappedIds.add(reservationId);
  if(original===0n||original!==consumed+released+outstanding)add("MAPPING_EQUATION_MISMATCH",row.id);
  if(!INVENTORY_RESERVATION_STATUSES.includes(row.status))add("MAPPING_STATUS_MISMATCH",row.id);
  const sum=totals.get(lineId);if(!sum)add("MAPPING_LINE_MISSING",row.id);else{sum.mapped+=outstanding;sum.consumed+=consumed;}
  const actual=inventory.get(reservationId);if(!actual){add("INVENTORY_RESERVATION_MISSING",row.id);continue;}
  if(actual.status!==row.status)add("INVENTORY_STATUS_MISMATCH",row.id);
  if(identity(actual.source_line_id)!==lineId||quantity(actual.version)<quantity(row.inventory_version)||identity(actual.warehouse_id)!==identity(header.fulfillment_warehouse_id)||lineMap.has(lineId)&&identity(actual.sku_id)!==identity(lineMap.get(lineId).sku_id))add("INVENTORY_IDENTITY_MISMATCH",row.id);
  if([original,consumed,released,outstanding].some((value,index)=>value!==quantity(actual[["original_quantity","consumed_quantity","released_quantity","outstanding_quantity"][index]])))add("INVENTORY_QUANTITY_MISMATCH",row.id);
 }
 for(const row of inventoryRows){
  identity(row.version);
  const original=quantity(row.original_quantity),consumed=quantity(row.consumed_quantity),released=quantity(row.released_quantity),outstanding=quantity(row.outstanding_quantity),lineId=identity(row.source_line_id);
  if(original===0n||original!==consumed+released+outstanding)add("INVENTORY_EQUATION_MISMATCH",row.id);
  const statusFits=outstanding>0n?row.status===(consumed>0n?"PARTIALLY_CONSUMED":"ACTIVE"):["CONSUMED","RELEASED","CANCELLED"].includes(row.status)&&(row.status==="CONSUMED"?consumed>0n:released>0n);
  if(!INVENTORY_RESERVATION_STATUSES.includes(row.status)||!statusFits)add("INVENTORY_STATUS_MISMATCH",row.id);
  if(outstanding>0n&&!mappedIds.has(identity(row.id)))add("INVENTORY_RESERVATION_UNMAPPED",row.id);
  if(totals.has(lineId))totals.get(lineId).inventory+=outstanding;else if(outstanding>0n)add("INVENTORY_LINE_MISSING",row.id);
 }
 for(const row of backorders){
  const amount=quantity(row.outstanding_base_quantity),lineId=identity(row.sales_order_line_id);
  if(!["OPEN","FULFILLED","CANCELLED"].includes(row.status)||(row.status==="OPEN")!==(amount>0n))add("BACKORDER_STATE_MISMATCH",row.id);
  if(!totals.has(lineId))add("BACKORDER_LINE_MISSING",row.id);else totals.get(lineId).backorder+=amount;
  const line=lineMap.get(lineId);if(line&&(identity(row.sales_order_id)!==orderId||quantity(row.line_no)!==quantity(line.line_no)||identity(row.sku_id)!==identity(line.sku_id)||identity(row.warehouse_id)!==identity(header.fulfillment_warehouse_id)))add("BACKORDER_IDENTITY_MISMATCH",row.id);
 }
 let backorderCount=0;
 for(const [id,line]of lineMap){
  const sum=totals.get(id),ordered=quantity(line.ordered_base_quantity),reserved=quantity(line.reserved_outstanding_base_quantity),backordered=quantity(line.backordered_base_quantity),fulfilled=quantity(line.fulfilled_base_quantity),cancelled=quantity(line.cancelled_base_quantity),committed=reserved+backordered+fulfilled+cancelled;
  if(header.status==="DRAFT"?committed!==0n:ordered!==committed)add("LINE_DEMAND_MISMATCH",id);
  if(sum.mapped!==reserved||sum.inventory!==reserved)add("LINE_RESERVATION_MISMATCH",id);
  if(sum.consumed!==fulfilled)add("LINE_FULFILLED_MISMATCH",id);
  if(sum.backorder!==backordered)add("BACKORDER_QUANTITY_MISMATCH",id);
  if(backordered>0n)backorderCount++;
 }
 if(![0,1].includes(Number(header.has_backorder))||Boolean(Number(header.has_backorder))!==(backorderCount>0)||quantity(header.backorder_line_count)!==BigInt(backorderCount))add("HEADER_BACKORDER_MISMATCH",orderId);
 return issues;
}

const marks=rows=>rows.map(()=>"?").join(",");
const projection=(table,archived=false)=>SALES_ARCHIVE_COLUMNS[table].map(name=>["order_date","requested_delivery_date"].includes(name)?`DATE_FORMAT(${name},'%Y-%m-%d') AS ${name}`:name).join(",")+(archived?",archive_batch_id,archived_at,row_hash":"");
const report=(reference,status,issues=[])=>({...reference,status,issues:issues.slice(0,100),issueCount:issues.length,truncated:issues.length>100});
async function readSalesState(tx,orderId,archived){
 const state={},suffix=archived?"_archive":"";
 for(const table of Object.keys(SALES_ARCHIVE_COLUMNS)){
  const where=table==="sales_orders"?"id=?":table==="sales_audit_logs"?"target_type='ORDER' AND target_id=?":table==="sales_order_line_reservations"?`sales_order_line_id IN (SELECT id FROM sales_order_lines${suffix} WHERE sales_order_id=?)`:"sales_order_id=?";
  const rows=[];let after="0";
  for(;;){const [page]=await tx.query(`SELECT ${projection(table,archived)} FROM ${table}${suffix} WHERE ${where} AND id>? ORDER BY id LIMIT 500`,[orderId,after]);
   for(const row of page){const id=identity(row.id);if(BigInt(id)<=BigInt(after))throw new TypeError("Invalid reconciliation page");after=id;rows.push(row);}if(page.length<500)break;
  }state[table]=rows;
 }return state;
}
export class SalesReconciliationService{
 constructor({database,inventory,time,logger}={}){this.database=database;this.inventory=inventory??new InventoryReservationService({database,time,logger});}
 async #routingIssues(tx,header,archived){
  const id=identity(header.id),issues=[],[keys]=await tx.query("SELECT id,status,sales_order_id,sales_order_number,is_order_archived FROM sales_external_order_keys WHERE sales_order_id=?",[id]);
  if(keys.length!==(header.external_order_key_id===null?0:1)||keys.some(row=>identity(row.id)!==String(header.external_order_key_id)||row.status!=="SUCCEEDED"||row.sales_order_number!==header.sales_order_number||Number(row.is_order_archived)!==Number(archived)))issues.push({code:"EXTERNAL_ROUTING_MISMATCH",id});
  const [conversions]=await tx.query("SELECT id,quotation_id,sales_order_number_snapshot,is_order_archived FROM sales_quotation_conversions WHERE sales_order_id=?",[id]);
  if(conversions.length!==(header.source_quotation_id===null?0:1)||conversions.some(row=>String(row.quotation_id)!==String(header.source_quotation_id)||row.sales_order_number_snapshot!==header.sales_order_number||Number(row.is_order_archived)!==Number(archived)))issues.push({code:"CONVERSION_ROUTING_MISMATCH",id});
  return issues;
 }
 async #archive(tx,header,manifest,actor){
  const id=identity(header.id),state=await readSalesState(tx,id,true),issues=compareSalesCommitments({header,lines:state.sales_order_lines,mappings:state.sales_order_line_reservations,backorders:state.sales_backorder_entries,inventoryRows:await this.#inventoryRows(tx,header,actor)}),parse=value=>typeof value==="string"?JSON.parse(value):value,versions=parse(manifest.participant_versions),counts=parse(manifest.sales_table_counts),hashes=parse(manifest.sales_hash_summary),tables=Object.keys(SALES_ARCHIVE_COLUMNS);
  if(manifest.sales_order_number!==header.sales_order_number||versions?.sales!=="1"||versions?.fulfillment!=="1"||Object.keys(versions??{}).sort().join(",")!=="fulfillment,sales"||Object.keys(counts??{}).sort().join(",")!==tables.slice().sort().join(",")||Object.keys(hashes??{}).sort().join(",")!==tables.slice().sort().join(","))issues.push({code:"ARCHIVE_MANIFEST_MISMATCH",id});
  for(const table of tables){
   const rows=state[table],digest=await hashSalesArchiveRows(table,rows),code="ARCHIVE_"+table.toUpperCase();
   if(counts?.[table]!==digest.count)issues.push({code:code+"_COUNT_MISMATCH",id});if(hashes?.[table]!==digest.hash)issues.push({code:code+"_HASH_MISMATCH",id});
   for(const row of rows)if(row.row_hash!==hashSalesArchiveRow(table,row)||String(row.archive_batch_id)!==String(manifest.archive_batch_id)||String(row.archived_at)!==String(manifest.archived_at))issues.push({code:code+"_ROW_HASH_MISMATCH",id:identity(row.id)});
   for(let start=0;start<rows.length;start+=500){const keys=rows.slice(start,start+500).map(row=>identity(row.id)),[active]=await tx.query(`SELECT id FROM ${table} FORCE INDEX (PRIMARY) WHERE id IN (${marks(keys)}) LIMIT 1`,keys);if(active.length)issues.push({code:code+"_ACTIVE_RESIDUE",id:identity(active[0].id)});}
  }
  const [auditResidue]=await tx.query("SELECT id FROM sales_audit_logs WHERE target_type='ORDER' AND target_id=? LIMIT 1",[id]);if(auditResidue.length)issues.push({code:"ARCHIVE_AUDIT_ACTIVE_RESIDUE",id:identity(auditResidue[0].id)});
  issues.push(...await readFulfillmentArchiveIntegrity(tx,id,{archiveBatchId:String(manifest.archive_batch_id),archivedAtMs:String(manifest.archived_at),tableCounts:parse(manifest.fulfillment_table_counts),hashSummary:parse(manifest.fulfillment_hash_summary)}),...await this.#routingIssues(tx,header,true));return report({orderId:id},issues.length?"MISMATCH":"CONSISTENT",issues);
 }
 async #inventoryRows(tx,header,actor){
  const rows=[];let after=0;
  for(;;){const page=await this.inventory.getSalesReservationStatesInTransaction(tx,{actor:{userId:actor.id,serviceName:"",claimedRoles:actor.roles,claimedPermissions:actor.permissions},source:{documentId:identity(header.id),lineId:"",eventId:randomUUID()},correlationId:"",payload:{warehouseId:Number(header.fulfillment_warehouse_id),afterId:after}});
   if(!page||!Array.isArray(page.rows)||page.rows.length>100)throw new TypeError("Invalid Inventory reconciliation page");
   for(const row of page.rows){const id=Number(identity(row.id));if(id<=after)throw new TypeError("Invalid Inventory reconciliation cursor");after=id;rows.push(row);}
   if(page.nextCursor!==(page.rows.length===100?after:null))throw new TypeError("Incomplete Inventory reconciliation page");if(page.nextCursor===null)break;
  }return rows;
 }
 async reconcileExternalKey({claims,keyId}){
  keyId=identity(keyId);if(this.database.context?.get()?.databaseTransaction)throw new TypeError("Reconciliation requires its own transaction");
  return this.database.withTransaction(async tx=>{
   if(getActiveTransactionIsolation(tx)!=="REPEATABLE READ")throw new TypeError("Reconciliation requires actual RR");await requireSalesWriteActor(tx,claims);
   try{
    const [[key]]=await tx.query("SELECT * FROM sales_external_order_keys WHERE id=?",[keyId]);if(!key)return report({keyId},"NOT_FOUND");
    const issues=[];
    if(typeof key.external_order_id!=="string"||!Buffer.isBuffer(key.external_order_id_hash)||!key.external_order_id_hash.equals(createHash("sha256").update(key.external_order_id).digest()))issues.push({code:"EXTERNAL_HASH_MISMATCH",id:keyId});
    if(key.status==="PROCESSING")return report({keyId},issues.length?"MISMATCH":"INCONCLUSIVE",issues.length?issues:[{code:"SOURCE_IN_PROGRESS",id:keyId}]);
    if(key.status!=="SUCCEEDED"||key.sales_order_id===null||![0,1].includes(Number(key.is_order_archived)))issues.push({code:"EXTERNAL_ROUTING_MISMATCH",id:keyId});
    else{
     const orderId=identity(key.sales_order_id),[[active]]=await tx.query("SELECT id,sales_order_number,external_order_key_id,source_type,channel_code_snapshot,external_order_id_snapshot FROM sales_orders WHERE id=?",[orderId]),[[archived]]=await tx.query("SELECT id,sales_order_number,external_order_key_id,source_type,channel_code_snapshot,external_order_id_snapshot,archive_batch_id FROM sales_orders_archive WHERE id=?",[orderId]),[[manifest]]=await tx.query("SELECT archive_batch_id FROM sales_archive_order_manifests WHERE sales_order_id=?",[orderId]);
     if(archived&&!manifest)return report({keyId},issues.length?"MISMATCH":"INCONCLUSIVE",[...issues,{code:"ARCHIVE_INCOMPLETE",id:keyId}]);
     const header=Number(key.is_order_archived)===1?archived:active;
     if(!header||active&&archived||manifest&&active||Number(key.is_order_archived)===1&&(!manifest||String(archived.archive_batch_id)!==String(manifest.archive_batch_id))||String(header.external_order_key_id)!==keyId||header.sales_order_number!==key.sales_order_number||header.source_type!==key.source_type||header.channel_code_snapshot!==key.channel_code||header.external_order_id_snapshot!==key.external_order_id)issues.push({code:"EXTERNAL_ROUTING_MISMATCH",id:keyId});
    }
    return report({keyId},issues.length?"MISMATCH":"CONSISTENT",issues);
   }catch(error){if([401,403].includes(error.statusCode)||["FORBIDDEN","PERMISSION_STALE"].includes(error.code))throw error;return report({keyId},"INCONCLUSIVE",[{code:"RECONCILIATION_UNAVAILABLE",id:keyId}]);}
  },{isolationLevel:"REPEATABLE READ"});
 }
 async reconcileOrder({claims,orderId}){
  orderId=identity(orderId);if(this.database.context?.get()?.databaseTransaction)throw new TypeError("Reconciliation requires its own transaction");
  return this.database.withTransaction(async tx=>{
   if(getActiveTransactionIsolation(tx)!=="REPEATABLE READ")throw new TypeError("Reconciliation requires actual RR");
   const actor=await requireSalesWriteActor(tx,claims);
   try{
    const [[active]]=await tx.query(`SELECT ${projection("sales_orders")} FROM sales_orders WHERE id=?`,[orderId]),[[archived]]=await tx.query(`SELECT ${projection("sales_orders",true)} FROM sales_orders_archive WHERE id=?`,[orderId]),[[manifest]]=await tx.query("SELECT * FROM sales_archive_order_manifests WHERE sales_order_id=?",[orderId]);
    if(active&&archived||archived&&!manifest||manifest&&!archived)return report({orderId},"INCONCLUSIVE",[{code:"ARCHIVE_INCOMPLETE",id:orderId}]);
    if(!active&&!archived){const [[key]]=await tx.query("SELECT id FROM sales_external_order_keys WHERE sales_order_id=? LIMIT 1",[orderId]),[[conversion]]=await tx.query("SELECT id FROM sales_quotation_conversions WHERE sales_order_id=? LIMIT 1",[orderId]);return report({orderId},key||conversion?"MISMATCH":"NOT_FOUND",key||conversion?[{code:key?"EXTERNAL_ROUTING_MISMATCH":"CONVERSION_ROUTING_MISMATCH",id:orderId}]:[]);}
    if(archived)return await this.#archive(tx,archived,manifest,actor);
    if(active.status==="CONFIRMING")return report({orderId},"INCONCLUSIVE",[{code:"CONFIRMATION_IN_PROGRESS",id:orderId}]);
    const [[current]]=await tx.query(`SELECT ${projection("sales_orders")} FROM sales_orders WHERE id=? FOR SHARE`,[orderId]);
    if(!current||hashSalesArchiveRow("sales_orders",active)!==hashSalesArchiveRow("sales_orders",current))return report({orderId},"INCONCLUSIVE",[{code:"CONCURRENT_CHANGE",id:orderId}]);
    const state=await readSalesState(tx,orderId,false),queue=[];
    // Stale queue cleanup can change quantities without changing the header; read its known PKs current under the root fence.
    for(let start=0;start<state.sales_backorder_entries.length;start+=500){const keys=state.sales_backorder_entries.slice(start,start+500).map(row=>identity(row.id)),[rows]=await tx.query(`SELECT * FROM sales_backorder_entries FORCE INDEX (PRIMARY) WHERE id IN (${marks(keys)}) ORDER BY id FOR SHARE`,keys);if(rows.length!==keys.length)throw new TypeError("Backorder membership changed");queue.push(...rows);}
    const issues=compareSalesCommitments({header:active,lines:state.sales_order_lines,mappings:state.sales_order_line_reservations,backorders:queue,inventoryRows:await this.#inventoryRows(tx,active,actor)});
    if(Number(active.line_count)<1||Number(active.line_count)>100||state.sales_order_lines.length!==Number(active.line_count))issues.push({code:"LINE_MEMBERSHIP_MISMATCH",id:orderId});
    issues.push(...await this.#routingIssues(tx,active,false));
    return report({orderId},issues.length?"MISMATCH":"CONSISTENT",issues);
   }catch(error){if([401,403].includes(error.statusCode)||["FORBIDDEN","PERMISSION_STALE"].includes(error.code))throw error;return report({orderId},"INCONCLUSIVE",[{code:"RECONCILIATION_UNAVAILABLE",id:orderId}]);}
  },{isolationLevel:"REPEATABLE READ"});
 }
}
