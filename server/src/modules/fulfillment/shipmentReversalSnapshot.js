import { assertActorFresh } from "../authorization/directoryLookups.js";
import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";
import { fulfillmentInteger } from "./fulfillmentValidation.js";
import { fulfillmentError } from "./fulfillmentErrors.js";
import { assertShipmentConfirmationHistory } from "./shipmentConfirmationWitness.js";
import { assertFulfillmentTransaction } from "./FulfillmentTransactionService.js";
import { lockFulfillmentRowsInTransaction } from "./FulfillmentLockService.js";
import { assertClaimQuantities,assertFulfillmentQuantities } from "./fulfillmentQuantityMath.js";

const conflict=()=>{throw fulfillmentError("FULFILLMENT_SOURCE_CONFLICT");};
const unavailable=()=>{throw fulfillmentError("FULFILLMENT_DEPENDENCY_UNAVAILABLE");};
const uuid=value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value);
function integer(value,positive=false){
 try{return fulfillmentInteger(String(value),{positive});}catch(error){if(error.code==="FULFILLMENT_QUANTITY_INVALID")unavailable();throw error;}
}
const id=value=>integer(value,true).toString();
function indexed(rows,column){
 const result=new Map();for(const row of rows){const key=id(row[column]);if(result.has(key))unavailable();result.set(key,row);}return result;
}
function summary(value,required,optional=[]){
 let result=value;if(typeof value==="string"){try{result=JSON.parse(value);}catch{unavailable();}}
 if(!result||Object.getPrototypeOf(result)!==Object.prototype||Object.getOwnPropertySymbols(result).length||required.some(key=>!Object.hasOwn(result,key))||Object.keys(result).some(key=>![...required,...optional].includes(key)))unavailable();
 return result;
}
function assertOriginalIssueSet(snapshot){
 const {root,shipment,lines,shipmentLines,claims,allocations,issues}=snapshot,rootId=id(root.id),shipmentId=id(shipment.id);
 const byLine=indexed(lines,"id"),byChild=indexed(shipmentLines,"id"),byClaim=indexed(claims,"id"),byAllocation=indexed(allocations,"id");
 indexed(lines,"sales_order_line_id");indexed(shipmentLines,"fulfillment_line_id");indexed(allocations,"inventory_allocation_id");indexed(issues,"id");indexed(issues,"inventory_movement_id");indexed(issues,"inventory_allocation_id");
 const usedAllocations=new Set(),lineTotals=new Map(),claimTotals=new Map(),claimMembers=new Map(),memberClaims=new Map(),reservationClaims=new Map();
 for(const issue of issues){
  const child=byChild.get(id(issue.shipment_line_id)),allocation=byAllocation.get(id(issue.fulfillment_allocation_id)),claim=allocation&&byClaim.get(id(allocation.claim_id));
  if(!child||!allocation||!claim||id(issue.shipment_id)!==shipmentId||id(allocation.fulfillment_id)!==rootId||id(allocation.fulfillment_line_id)!==id(child.fulfillment_line_id)||
     id(claim.fulfillment_id)!==rootId||id(claim.fulfillment_line_id)!==id(child.fulfillment_line_id)||id(claim.inventory_reservation_id)!==id(issue.inventory_reservation_id)||id(allocation.inventory_reservation_id)!==id(issue.inventory_reservation_id)||
     id(allocation.inventory_allocation_id)!==id(issue.inventory_allocation_id)||id(allocation.inventory_balance_id)!==id(issue.inventory_balance_id)||usedAllocations.has(id(allocation.id)))unavailable();
  for(const field of ["warehouse_id","bin_id"])if(id(issue[field])!==id(allocation[field]))unavailable();
  if(id(issue.warehouse_id)!==id(root.warehouse_id)||(issue.lot_id===null?null:id(issue.lot_id))!==(allocation.lot_id===null?null:id(allocation.lot_id))||issue.stock_status_snapshot!=="AVAILABLE"||allocation.stock_status_snapshot!=="AVAILABLE"||
     issue.sku_code_snapshot!==child.sku_code_snapshot||issue.base_uom_code_snapshot!==child.base_uom_code_snapshot)unavailable();
  const q=integer(issue.issued_base_quantity,true),claimId=id(claim.id),member=id(issue.inventory_operation_id),reservation=id(issue.inventory_reservation_id);
  if(q!==integer(allocation.picked_base_quantity,true)||claimMembers.has(claimId)&&claimMembers.get(claimId)!==member||memberClaims.has(member)&&memberClaims.get(member)!==claimId||reservationClaims.has(reservation)&&reservationClaims.get(reservation)!==claimId)unavailable();
  claimMembers.set(claimId,member);memberClaims.set(member,claimId);reservationClaims.set(reservation,claimId);usedAllocations.add(id(allocation.id));
  lineTotals.set(id(child.id),(lineTotals.get(id(child.id))??0n)+q);claimTotals.set(claimId,(claimTotals.get(claimId)??0n)+q);
 }
 if(usedAllocations.size!==allocations.length)unavailable();
 for(const child of shipmentLines){
  const line=byLine.get(id(child.fulfillment_line_id));
  if(!line||id(line.fulfillment_id)!==rootId||id(line.sales_order_id)!==id(root.sales_order_id)||id(child.shipment_id)!==shipmentId||id(child.fulfillment_id)!==rootId||
     ["sales_order_line_id","sku_id","base_uom_id"].some(field=>id(child[field])!==id(line[field]))||(lineTotals.get(id(child.id))??0n)!==integer(child.shipped_base_quantity)||integer(child.shipped_base_quantity)!==integer(line.shipped_base_quantity))unavailable();
 }
 for(const claim of claims)if((claimTotals.get(id(claim.id))??0n)!==integer(claim.consumed_quantity))unavailable();
}
function assertOriginalShip(snapshot,operations,history,audits){
 const {root,shipment,issues}=snapshot,eventId=shipment.confirmation_event_id,operation=operations.length===1?operations[0]:null;
 if(!operation||operation.event_id!==eventId||operation.operation_type!=="SHIP"||operation.target_type!=="SHIPMENT"||id(operation.target_id)!==id(shipment.id)||operation.status!=="SUCCEEDED"||
    typeof operation.payload_hash!=="string"||!/^[a-f0-9]{64}$/u.test(operation.payload_hash)||!uuid(operation.correlation_id)||operation.lease_owner!==""||operation.lease_expires_at!==null||
    operation.next_attempt_at!==null||operation.public_error_code!==""||operation.public_error_details!==null)unavailable();
 id(operation.id);integer(operation.completed_at);const actorId=id(operation.initiated_by),attempt=integer(operation.attempt_count,true);
 if(attempt>4294967295n)unavailable();
 const result=summary(operation.result_json,["id","status","version"],["number"]);
 if(typeof result.id!=="string"||result.id!==id(shipment.id)||result.status!=="SHIPPED"||!Number.isSafeInteger(result.version)||result.version<3||result.version>4294967295||
    result.number!==undefined&&(typeof result.number!=="string"||!/^SHP-[0-9]{6}-[0-9]{6,13}$/u.test(result.number)||result.number.length>24))unavailable();
 const starts=history.filter(row=>row.action==="CONFIRM_START"),ends=history.filter(row=>row.action==="CONFIRM"),end=ends[0];
 if(history.length!==2||starts.length!==1||ends.length!==1)unavailable();
 const after=assertShipmentConfirmationHistory(starts,{shipmentId:id(shipment.id),eventId,actorId,version:result.version-2});
 if(id(end.shipment_id)!==id(shipment.id)||end.event_id!==eventId||end.from_status!=="SHIPPING"||end.to_status!=="SHIPPED"||id(end.actor_user_id)!==actorId||integer(end.version_after,true)!==BigInt(after+1)||
    integer(end.version_after,true)!==BigInt(result.version)||integer(end.sequence_no,true)<=integer(starts[0].sequence_no,true))unavailable();
 const audit=audits.length===1?audits[0]:null;
 if(!audit||audit.action!=="SHIP"||audit.event_id!==eventId||audit.target_type!=="SHIPMENT"||id(audit.target_id)!==id(shipment.id)||audit.correlation_id!==operation.correlation_id||id(audit.actor_user_id)!==actorId)unavailable();
 const saved=summary(audit.after_summary,["shipmentId","fulfillmentId","status","version","rowCount"]);
 if(saved.shipmentId!==id(shipment.id)||saved.fulfillmentId!==id(root.id)||saved.status!=="SHIPPED"||saved.version!==result.version||!issues.length||saved.rowCount!==issues.length)unavailable();
 // The immutable journal hash is bound to this historical source; no current logistics payload is reconstructed.
 assertOriginalIssueSet(snapshot);
}

async function assertOriginalShipInTransaction(tx,snapshot){
 const shipmentId=id(snapshot.shipment.id),eventId=snapshot.shipment.confirmation_event_id;
 const [operations]=await tx.query("SELECT id,event_id,operation_type,target_type,target_id,payload_hash,status,result_json,lease_owner,lease_expires_at,next_attempt_at,attempt_count,correlation_id,completed_at,initiated_by,public_error_code,public_error_details FROM fulfillment_operation_requests WHERE event_id=? LIMIT 2",[eventId]);
 const [history]=await tx.query("SELECT shipment_id,sequence_no,from_status,to_status,action,event_id,version_after,actor_user_id FROM shipment_status_history WHERE shipment_id=? AND event_id=? AND action IN ('CONFIRM_START','CONFIRM') ORDER BY sequence_no LIMIT 3",[shipmentId,eventId]);
 const [audits]=await tx.query("SELECT target_type,target_id,action,event_id,correlation_id,actor_user_id,after_summary FROM fulfillment_audit_logs WHERE target_type='SHIPMENT' AND target_id=? AND action='SHIP' AND event_id=? AND JSON_UNQUOTE(JSON_EXTRACT(after_summary,'$.status'))='SHIPPED' ORDER BY id LIMIT 2",[shipmentId,eventId]);
 assertOriginalShip(snapshot,operations,history,audits);
}

function assertLockedReversalQuantities(snapshot,totals){
 const {root,lines,claims,allocations}=snapshot,byLine=indexed(lines,"id"),byTotal=indexed(totals,"fulfillment_line_id"),sum=(rows,field)=>rows.reduce((total,row)=>total+integer(row[field]),0n);
 if(byTotal.size!==byLine.size)conflict();
 for(const claim of claims){
  assertClaimQuantities({original:id(claim.original_claimed_quantity),active:integer(claim.active_claimed_quantity).toString(),released:integer(claim.released_quantity).toString(),consumed:integer(claim.consumed_quantity).toString(),reversed:integer(claim.reversed_quantity).toString()});
  if(id(claim.fulfillment_id)!==id(root.id)||!byLine.has(id(claim.fulfillment_line_id))||integer(claim.active_claimed_quantity)!==0n||integer(claim.reversed_quantity)!==0n||claim.status!==(integer(claim.consumed_quantity)>0n?"CONSUMED":"RELEASED"))conflict();
 }
 assertFulfillmentQuantities("SHIPPED",lines.map(line=>{
  const members=claims.filter(row=>id(row.fulfillment_line_id)===id(line.id)),legs=allocations.filter(row=>id(row.fulfillment_line_id)===id(line.id)),total=byTotal.get(id(line.id));
  if(!total||integer(total.invalid)!==0n||!members.length||members.length>50||legs.length>50||
     integer(total.allocated)!==integer(line.allocated_base_quantity)||integer(total.picked)!==integer(line.picked_base_quantity)||sum(members,"original_claimed_quantity")!==integer(line.planned_base_quantity)||sum(members,"consumed_quantity")!==integer(line.shipped_base_quantity)||sum(members,"released_quantity")!==integer(line.short_base_quantity))conflict();
  return {planned:id(line.planned_base_quantity),allocated:integer(line.allocated_base_quantity).toString(),released:integer(total.released).toString(),picked:integer(line.picked_base_quantity).toString(),short:integer(line.short_base_quantity).toString(),shipped:integer(line.shipped_base_quantity).toString(),reversed:integer(line.reversed_base_quantity).toString()};
 }));
}

// Called after the actual Inventory preclaim and Sales locks, never inside the RR advisory.
export async function readLockedShipmentReversalSnapshot(database,tx,{request,reversalId,fulfillmentId,actorId}){
 assertFulfillmentTransaction(database,tx);
 const [root]=await lockFulfillmentRowsInTransaction(tx,"fulfillments",[fulfillmentId]);
 const children=async(table,column,parent,maximum)=>{
  const [rows]=await tx.query(`SELECT id FROM ${table} WHERE ${column}=? ORDER BY id LIMIT ${maximum+1}`,[parent]);
  if(rows.length>maximum)conflict();
  return lockFulfillmentRowsInTransaction(tx,table,rows.map(row=>row.id));
 };
 const lines=await children("fulfillment_lines","fulfillment_id",root.id,100);
 const claims=await children("fulfillment_line_reservation_claims","fulfillment_id",root.id,5000);
 const [allocationIds]=await tx.query("SELECT id FROM fulfillment_allocations WHERE fulfillment_id=? AND picked_base_quantity>0 ORDER BY id LIMIT 5001",[root.id]);
 if(allocationIds.length>5000)conflict();
 const allocations=await lockFulfillmentRowsInTransaction(tx,"fulfillment_allocations",allocationIds.map(row=>row.id));
 const [shipment]=await lockFulfillmentRowsInTransaction(tx,"shipments",[request.target.id]);
 const shipmentLines=await children("shipment_lines","shipment_id",shipment.id,100);
 const [reversal]=await lockFulfillmentRowsInTransaction(tx,"shipment_reversals",[reversalId]);
 const [issues]=await tx.query("SELECT *,DATE_FORMAT(expiry_date_snapshot,'%Y-%m-%d') AS expiry_date_snapshot FROM shipment_issue_details WHERE shipment_id=? ORDER BY id LIMIT 5001 FOR UPDATE",[shipment.id]);
 if(root.status!=="SHIPPED"||id(root.active_shipment_id)!==id(shipment.id)||shipment.status!=="REVERSING"||Number(shipment.version)!==request.payload.version+1||
    id(shipment.fulfillment_id)!==id(root.id)||["sales_order_id","customer_id","warehouse_id"].some(field=>id(shipment[field])!==id(root[field]))||
    shipment.reversal_event_id!==request.eventId||shipment.correlation_id!==request.correlationId||reversal.event_id!==request.eventId||id(reversal.shipment_id)!==id(shipment.id)||
    reversal.status!=="REVERSING"||Number(reversal.version)!==1||reversal.correlation_id!==request.correlationId||id(reversal.created_by)!==actorId||
    reversal.reason!==request.payload.reason||Number(reversal.goods_under_company_control)!==1||Number(reversal.goods_returned_to_original_bins)!==1||
    reversal.completed_at!==null||reversal.failure_code!==""||!lines.length||lines.length!==Number(root.line_count)||shipmentLines.length!==Number(shipment.line_count)||lines.length!==shipmentLines.length||issues.length>5000)conflict();
 const [archivedRoot]=await tx.query("SELECT id FROM fulfillments_archive WHERE id=? LIMIT 1",[root.id]);
 const [archivedShipment]=await tx.query("SELECT id FROM shipments_archive WHERE id=? LIMIT 1",[shipment.id]);
 const [details]=await tx.query("SELECT id FROM shipment_reversal_details WHERE shipment_id=? LIMIT 1",[shipment.id]);
 const [effective]=await tx.query("SELECT id FROM shipment_reversals WHERE effective_shipment_id=? ORDER BY id LIMIT 2",[shipment.id]);
 const [history]=await tx.query("SELECT actor_user_id,from_status,to_status,version_after,reason FROM shipment_status_history WHERE shipment_id=? AND event_id=? AND action='REVERSE_START' LIMIT 2",[shipment.id,request.eventId]);
 if(archivedRoot.length||archivedShipment.length||details.length||effective.length!==1||id(effective[0].id)!==id(reversal.id)||
    history.length!==1||id(history[0].actor_user_id)!==actorId||history[0].from_status!=="SHIPPED"||history[0].to_status!=="REVERSING"||Number(history[0].version_after)!==request.payload.version+1||history[0].reason!==request.payload.reason||
    issues.some(row=>row.reversal_movement_id!==null)||lines.some(row=>integer(row.reversed_base_quantity)!==0n)||shipmentLines.some(row=>integer(row.reversed_base_quantity)!==0n))conflict();
 const snapshot={root,shipment,reversal,lines,shipmentLines,claims,allocations,issues};
 if(!uuid(shipment.confirmation_event_id))unavailable();
 // Held root/children fence their writers; aggregate all released history without imposing the active-leg cap on it.
 const [totals]=await tx.query("SELECT fulfillment_line_id,SUM(allocated_base_quantity) AS allocated,SUM(released_base_quantity) AS released,SUM(picked_base_quantity) AS picked,SUM(CASE WHEN allocated_base_quantity<>released_base_quantity+picked_base_quantity OR (picked_base_quantity>0 AND status<>'CONSUMED') OR (picked_base_quantity=0 AND status<>'RELEASED') THEN 1 ELSE 0 END) AS invalid FROM fulfillment_allocations WHERE fulfillment_id=? GROUP BY fulfillment_line_id ORDER BY fulfillment_line_id",[root.id]);
 assertLockedReversalQuantities(snapshot,totals);
 await assertOriginalShipInTransaction(tx,snapshot);
 return snapshot;
}

// Historical SHIP witness only; E_R terminal, eligibility and the writer's lock/fence remain separate.
export async function readShipmentReversalSnapshot(database,shipmentId){
 fulfillmentInteger(shipmentId);
 if(database.context?.get()?.databaseTransaction)throw new TypeError("Independent Shipment reversal read transaction required");
 return database.withTransaction(async tx=>{
  if(database.context?.get()?.databaseTransaction!==tx||getActiveTransactionIsolation(tx)!=="REPEATABLE READ")throw new TypeError("Current consistent Shipment reversal read required");
  const claims=database.context.get()?.auth?.claims;
  if(typeof claims?.sub!=="string"||!/^[1-9][0-9]*$/u.test(claims.sub)||!Number.isSafeInteger(Number(claims.sub)))throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");
  const actor=await assertActorFresh(tx,{actorId:Number(claims.sub),claimedRoles:claims.roles,claimedPermissions:claims.permissions});
  if(!actor.username||!["fulfillment.view","fulfillment.reverse"].every(permission=>actor.permissions.includes(permission)))throw fulfillmentError("FULFILLMENT_PERMISSION_DENIED");

  const [[shipment]]=await tx.query("SELECT id,fulfillment_id,sales_order_id,customer_id,warehouse_id,line_count,confirmation_event_id FROM shipments WHERE id=?",[shipmentId]);
  if(!shipment)throw fulfillmentError("SHIPMENT_NOT_FOUND");
  const [[root]]=await tx.query("SELECT id,sales_order_id,customer_id,warehouse_id,active_shipment_id,line_count FROM fulfillments WHERE id=?",[shipment.fulfillment_id]);
  if(!root||String(root.id)!==String(shipment.fulfillment_id)||["sales_order_id","customer_id","warehouse_id"].some(field=>String(root[field])!==String(shipment[field])))conflict();
  const [lines]=await tx.query("SELECT id,fulfillment_id,sales_order_id,sales_order_line_id,sku_id,base_uom_id,shipped_base_quantity,reversed_base_quantity FROM fulfillment_lines WHERE fulfillment_id=? ORDER BY id LIMIT 101",[root.id]);
  const [shipmentLines]=await tx.query("SELECT id,shipment_id,fulfillment_id,fulfillment_line_id,sales_order_line_id,sku_id,base_uom_id,sku_code_snapshot,base_uom_code_snapshot,shipped_base_quantity,reversed_base_quantity FROM shipment_lines WHERE shipment_id=? ORDER BY id LIMIT 101",[shipmentId]);
  if(!lines.length||lines.length>100||shipmentLines.length>100||lines.length!==Number(root.line_count)||shipmentLines.length!==Number(shipment.line_count)||lines.length!==shipmentLines.length)conflict();
  const [sourceClaims]=await tx.query("SELECT id,fulfillment_id,fulfillment_line_id,sales_order_line_reservation_id,inventory_reservation_id,consumed_quantity,active_claimed_quantity,reversed_quantity,status,inventory_version FROM fulfillment_line_reservation_claims WHERE fulfillment_id=? ORDER BY id LIMIT 5001",[root.id]);
  const [allocations]=await tx.query("SELECT id,fulfillment_id,fulfillment_line_id,claim_id,inventory_reservation_id,inventory_allocation_id,inventory_balance_id,warehouse_id,bin_id,lot_id,stock_status_snapshot,picked_base_quantity,status,balance_version FROM fulfillment_allocations WHERE fulfillment_id=? AND picked_base_quantity>0 ORDER BY id LIMIT 5001",[root.id]);
  // Movement/member IDs are immutable references owned by these Issue rows, not an Inventory outcome read.
  const [issues]=await tx.query("SELECT *,DATE_FORMAT(expiry_date_snapshot,'%Y-%m-%d') AS expiry_date_snapshot FROM shipment_issue_details WHERE shipment_id=? ORDER BY shipment_line_id,id LIMIT 5001",[shipmentId]);
  if(sourceClaims.length>5000||allocations.length>5000||issues.length>5000)conflict();
  if(!uuid(shipment.confirmation_event_id))unavailable();
  const snapshot={root,shipment,lines,shipmentLines,claims:sourceClaims,allocations,issues};
  await assertOriginalShipInTransaction(tx,snapshot);
  return snapshot;
 },{isolationLevel:"REPEATABLE READ"});
}
