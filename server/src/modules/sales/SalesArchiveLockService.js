import {lockSalesOrderLines} from "./SalesOrderService.js";
import {getActiveTransactionIsolation} from "../../services/mysqldatabase/MySqlDatabaseService.js";

function integer(value,positive=true){
 if(typeof value!=="string"||value.length>16||!/^(0|[1-9][0-9]*)$/u.test(value)||BigInt(value)>9007199254740991n||positive&&value==="0")throw new TypeError("Invalid Sales Archive operation scope");
 return value;
}
// Internal fixed coordinator support only. Locks neither certify a fresh read view nor grant Archive authority.
export class SalesArchiveLockService{
 constructor({database}){this.database=database;}
 #transaction(tx){if(this.database.context?.get()?.databaseTransaction!==tx||getActiveTransactionIsolation(tx)!=="REPEATABLE READ")throw new TypeError("Actual Sales Archive RR transaction required");}
 async discoverOrderRouting(orderId){
  orderId=integer(orderId);if(this.database.context?.get()?.databaseTransaction)throw new TypeError("Archive routing discovery must precede mutation");
  const [[active]]=await this.database.query("SELECT external_order_key_id,source_quotation_id FROM sales_orders WHERE id=?",[orderId]),[[archived]]=await this.database.query("SELECT external_order_key_id,source_quotation_id FROM sales_orders_archive WHERE id=?",[orderId]),header=active??archived;
  if(!header||active&&archived&&["external_order_key_id","source_quotation_id"].some(k=>String(active[k])!==String(archived[k])))throw new TypeError("Inconsistent Archive route hints");
  const [conversions]=await this.database.query("SELECT id,quotation_id FROM sales_quotation_conversions WHERE sales_order_id=?",[orderId]);
  if(conversions.length!==(header.source_quotation_id===null?0:1)||conversions.some(row=>String(row.quotation_id)!==String(header.source_quotation_id)))throw new TypeError("Inconsistent Archive conversion hints");
  return Object.freeze({orderId,externalKeyId:header.external_order_key_id===null?null:integer(String(header.external_order_key_id)),quotationId:header.source_quotation_id===null?null:integer(String(header.source_quotation_id)),conversionId:conversions.length?integer(String(conversions[0].id)):null});
 }
 async lockOrderRoutingInTransaction(tx,hints){
  this.#transaction(tx);
  const keys=["orderId","externalKeyId","quotationId","conversionId"];
  if(!hints||Reflect.ownKeys(hints).sort().join(",")!==keys.sort().join(",")||keys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(hints,k)??{},"value")))throw new TypeError("Invalid Archive route hints");
  integer(hints.orderId);if((hints.quotationId===null)!==(hints.conversionId===null))throw new TypeError("Invalid Archive conversion hints");
  for(const key of keys)if(hints[key]!==null)integer(hints[key]);
  // Earlier route ranks precede Sales Order even on replay. Never discover and acquire them after its root lock.
  if(hints.externalKeyId!==null){const [[row]]=await tx.query("SELECT id,sales_order_id FROM sales_external_order_keys WHERE id=? FOR UPDATE",[hints.externalKeyId]);if(String(row?.sales_order_id)!==hints.orderId)throw new TypeError("Archive external route changed");}
  if(hints.quotationId!==null){const [[quote]]=await tx.query("SELECT id FROM sales_quotations WHERE id=? FOR UPDATE",[hints.quotationId]),[[conversion]]=await tx.query("SELECT quotation_id,sales_order_id FROM sales_quotation_conversions WHERE id=? FOR UPDATE",[hints.conversionId]);if(!quote||String(conversion?.quotation_id)!==hints.quotationId||String(conversion?.sales_order_id)!==hints.orderId)throw new TypeError("Archive conversion changed");}
 }
 assertOrderRouting(header,hints){if(String(header.id)!==hints.orderId||String(header.external_order_key_id)!==String(hints.externalKeyId)||String(header.source_quotation_id)!==String(hints.quotationId))throw new TypeError("Archive routing membership changed");}
 async lockOrderOperationsInTransaction(tx,scope){
  this.#transaction(tx);
  if(!scope||![Object.prototype,null].includes(Object.getPrototypeOf(scope))||Reflect.ownKeys(scope).sort().join(",")!=="orderId,shipmentIds"||!Array.isArray(scope.shipmentIds))throw new TypeError("Invalid Sales Archive operation scope");
  const orderId=integer(scope.orderId),shipmentIds=scope.shipmentIds.map(id=>integer(id));
  if(shipmentIds.some((id,i)=>i>0&&BigInt(id)<=BigInt(shipmentIds[i-1])))throw new TypeError("Invalid Sales Archive Shipment order");
  let operationCount=0,hasInProgress=false;
  // FULFILLMENT_SOURCE targets Shipment IDs, not the SO stored in its result_id.
  // All callers use this same table/prefix order before any domain root locks.
  for(const [type,target]of [...shipmentIds.map(id=>["FULFILLMENT_SOURCE",id]),["SALES_ORDER",orderId]]){
   let created="0",after="0";
   for(;;){
    const [rows]=await tx.query("SELECT id,created_at,status,target_type,target_id FROM sales_operation_requests FORCE INDEX (idx_sales_operations_target) WHERE target_type=? AND target_id=? AND (created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT 500 FOR UPDATE",[type,target,created,created,after]);
    for(const row of rows){
     const id=integer(String(row.id)),stamp=integer(String(row.created_at),false);
     if(row.target_type!==type||String(row.target_id)!==target||!["FAILED","IN_PROGRESS","SUCCEEDED"].includes(row.status)||BigInt(stamp)<BigInt(created)||stamp===created&&BigInt(id)<=BigInt(after))throw new TypeError("Inconsistent Sales Archive operation prefix");
     created=stamp;after=id;operationCount++;hasInProgress ||=row.status==="IN_PROGRESS";
     if(!Number.isSafeInteger(operationCount))throw new TypeError("Sales Archive operation count overflow");
    }
    if(rows.length<500)break;
   }
  }
  return {operationCount,hasInProgress};
 }
 async lockOrderRowsInTransaction(tx,orderId){
  this.#transaction(tx);orderId=integer(orderId);
  const [[header]]=await tx.query("SELECT * FROM sales_orders WHERE id=? FOR UPDATE",[orderId]);
  const count=Number(header?.line_count);
  if(!header||!Number.isSafeInteger(count)||count<1||count>100)throw new TypeError("Invalid Sales Archive root");
  const [identities]=await lockSalesOrderLines(tx,orderId,count),ids=identities.map(row=>integer(String(row.id)));
  if(ids.length!==count||new Set(ids).size!==count)throw new TypeError("Incomplete Sales Archive lines");
  const marks=values=>values.map(()=>"?").join(",");
  // First consistent read requires the fixed coordinator's new controlled RR transaction.
  // Refuse undiscovered extra lines; never repair a stale plan by taking late line locks.
  const [membership]=await tx.query("SELECT id,line_no FROM sales_order_lines FORCE INDEX (uq_sales_order_line_number) WHERE sales_order_id=? ORDER BY line_no LIMIT 101",[orderId]);
  if(membership.length!==count||membership.some((row,i)=>Number(row.line_no)!==i+1||!ids.includes(String(row.id))))throw new TypeError("Incomplete Sales Archive line membership");
  const [lines]=await tx.query(`SELECT * FROM sales_order_lines FORCE INDEX (PRIMARY) WHERE id IN (${marks(ids)}) ORDER BY id FOR UPDATE`,ids);
  if(lines.length!==count||lines.some((row,i)=>String(row.id)!==ids[i]||String(row.sales_order_id)!==orderId||!Number.isInteger(Number(row.line_no))||Number(row.line_no)<1||Number(row.line_no)>count)||new Set(lines.map(row=>Number(row.line_no))).size!==count)throw new TypeError("Inconsistent Sales Archive lines");
  const mappings=[];let after="0";
  // Mapping discovery uses that controlled view and current PRIMARY point locks.
  // This helper returns data, never a snapshot-freshness or Archive authority certificate.
  for(;;){
   const [found]=await tx.query(`SELECT id,sales_order_line_id FROM sales_order_line_reservations WHERE sales_order_line_id IN (${marks(ids)}) AND id>? ORDER BY id LIMIT 500`,[...ids,after]);
   const keys=found.map(row=>integer(String(row.id)));
   if(keys.some((id,i)=>BigInt(id)<=BigInt(i?keys[i-1]:after)))throw new TypeError("Invalid Sales Archive mapping order");
   if(keys.length){
    const [rows]=await tx.query(`SELECT * FROM sales_order_line_reservations FORCE INDEX (PRIMARY) WHERE id IN (${marks(keys)}) ORDER BY id FOR UPDATE`,keys);
    if(rows.length!==keys.length||rows.some((row,i)=>String(row.id)!==keys[i]||String(row.sales_order_line_id)!==String(found[i].sales_order_line_id)||!ids.includes(String(row.sales_order_line_id))))throw new TypeError("Inconsistent Sales Archive mappings");
    mappings.push(...rows);after=keys.at(-1);
   }
   if(found.length<500)break;
  }
  const quantity=value=>{
   if(typeof value==="number"&&!Number.isSafeInteger(value)||!["number","string"].includes(typeof value)||!/^(0|[1-9][0-9]*)$/u.test(String(value))||BigInt(value)>18446744073709551615n)throw new TypeError("Invalid Sales Archive quantity");
   return BigInt(value);
  };
  for(const line of lines){
   let outstanding=0n,consumed=0n;
   for(const row of mappings.filter(m=>String(m.sales_order_line_id)===String(line.id))){
    const o=quantity(row.original_base_quantity),c=quantity(row.consumed_base_quantity),r=quantity(row.released_base_quantity),left=quantity(row.outstanding_base_quantity);
    if(o!==c+r+left)throw new TypeError("Inconsistent Sales Archive mapping quantities");outstanding+=left;consumed+=c;
   }
   if(outstanding!==quantity(line.reserved_outstanding_base_quantity)||consumed!==quantity(line.fulfilled_base_quantity)||quantity(line.ordered_base_quantity)!==outstanding+quantity(line.backordered_base_quantity)+consumed+quantity(line.cancelled_base_quantity))throw new TypeError("Inconsistent Sales Archive line quantities");
  }
  return {header,lines,mappings};
 }
}
