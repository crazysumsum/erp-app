import {getActiveTransactionIsolation} from "../../services/mysqldatabase/MySqlDatabaseService.js";
import {requireSalesWriteActor} from "../sales/salesAuthorization.js";
import {salesEventId} from "../sales/salesValidation.js";
import {lockFulfillmentRowsInTransaction,sortedFulfillmentIds} from "./FulfillmentLockService.js";
import {inspectFulfillmentArchiveReadiness} from "./fulfillmentArchiveReadiness.js";
import {readFulfillmentArchiveState,archiveStateFacts} from "./fulfillmentArchiveState.js";
const marks=ids=>ids.map(()=>"?").join(",");
const unknown=()=>({status:"UNKNOWN"});
async function lockChildren(tx,table,column,owners){
  const columns={fulfillment_lines:"id,fulfillment_id",fulfillment_line_reservation_claims:"id,fulfillment_id,status,active_claimed_quantity",fulfillment_allocations:"id,fulfillment_id,status",shipments:"id,fulfillment_id,status",shipment_lines:"id,shipment_id",shipment_reversals:"id,shipment_id,status"};
  await tx.query(`SELECT ${columns[table]} FROM ${table} LIMIT 0`);
  if(!owners.length)return [];
  const [ids]=await tx.query(`SELECT id,${column} FROM ${table} WHERE ${column} IN (${marks(owners)}) ORDER BY id`,owners);
  const rows=await lockFulfillmentRowsInTransaction(tx,table,ids.map(row=>row.id));
  if(rows.some((row,i)=>String(row[column])!==String(ids[i][column])))throw new TypeError("Fulfillment membership changed");
  return rows;
}
// HD013: active RC and held direct parents make membership discovery current and stable.
// Discovery is nonlocking; sorted primary-key current locks avoid cross-order range gaps.
export class FulfillmentOpenMatterService {
  #authorizeArchiveRead;
  constructor({database,authorizeArchiveRead}={}){this.database=database;this.#authorizeArchiveRead=authorizeArchiveRead;}
  async getOrderArchiveStatus(orderId,options){
    if(!ownArchiveData(options,["atMs"]))throw new TypeError("Invalid Archive read options");
    const scope=Object.freeze({orderId,atMs:options.atMs});archiveReadCommand(scope);
    const context=this.database?.context;
    // Advisory inspection owns a fresh read view. Never reuse an outer transaction's older snapshot.
    if(context?.get()?.databaseTransaction)return archiveUnknown("PROVIDER_UNAVAILABLE");
    if(!context?.storage?.run||typeof this.database?.withTransaction!=="function")return archiveUnknown("PROVIDER_UNAVAILABLE");
    const inspect=()=>this.database.withTransaction(async tx=>{
      const readiness=await inspectFulfillmentArchiveReadiness(tx);
      if(!readiness.ready)return archiveUnknown(readiness.reasonCode);
      return evaluateFulfillmentOpenMatter(archiveStateFacts(await readFulfillmentArchiveState(tx,scope.orderId),scope.atMs));
    });
    try{return await context.storage.run({databaseTransaction:null,auth:null,signal:null,startedAt:Date.now()},inspect);}
    catch{return archiveUnknown("PROVIDER_UNAVAILABLE");}
  }
  async getOrderArchiveStatusInTransaction(tx,command){
    archiveReadCommand(command);
    const scope=Object.freeze({orderId:command.orderId,atMs:command.atMs});
    if(this.database?.context?.get()?.databaseTransaction!==tx||getActiveTransactionIsolation(tx)!=="REPEATABLE READ")throw new TypeError("Actual Archive RR transaction required");
    // Only the real fixed job adapter may attest its private live scope; context equality alone proves no fresh read view.
    try{
      if(typeof this.#authorizeArchiveRead!=="function"||await this.#authorizeArchiveRead(tx,scope)!==true)return archiveUnknown("PROVIDER_UNAVAILABLE");
      const readiness=await inspectFulfillmentArchiveReadiness(tx);
      if(!readiness.ready)return archiveUnknown(readiness.reasonCode);
      return evaluateFulfillmentOpenMatter(archiveStateFacts(await readFulfillmentArchiveState(tx,scope.orderId,{lock:true}),scope.atMs));
    }catch{return archiveUnknown("PROVIDER_UNAVAILABLE");}
  }
  async assertSalesLifecycleAllowedInTransaction(tx,command){
    try{
      if(this.database.context?.get()?.databaseTransaction!==tx||getActiveTransactionIsolation(tx)!=="READ COMMITTED")return unknown();
      if(!command||Object.keys(command).sort().join(",")!=="action,eventId,expectedVersion,orderId"||!["WITHDRAW","CANCEL","CLOSE_REMAINING"].includes(command.action)||![command.orderId,command.expectedVersion].every(n=>Number.isSafeInteger(n)&&n>0))return unknown();
      salesEventId(command.eventId);
      const jwt=this.database.context.get()?.auth?.claims;
      if(typeof jwt?.sub!=="string"||!/^[1-9][0-9]*$/u.test(jwt.sub)||!Number.isSafeInteger(Number(jwt.sub)))return unknown();
      await requireSalesWriteActor(tx,{actorId:Number(jwt.sub),claimedRoles:jwt.roles,claimedPermissions:jwt.permissions});
      const [[sales]]=await tx.query("SELECT id,version FROM sales_orders WHERE id=? FOR UPDATE",[command.orderId]);
      if(!sales||Number(sales.version)!==command.expectedVersion)return unknown();
      const [rootIds]=await tx.query("SELECT id FROM fulfillments WHERE sales_order_id=? ORDER BY id",[command.orderId]);
      const keys=sortedFulfillmentIds(rootIds.map(row=>row.id));
      const roots=await lockFulfillmentRowsInTransaction(tx,"fulfillments",keys);
      if(roots.some(row=>Number(row.sales_order_id)!==command.orderId))return unknown();
      await tx.query("SELECT id,status,line_count FROM fulfillments LIMIT 0");
      const lines=await lockChildren(tx,"fulfillment_lines","fulfillment_id",keys);
      const claims=await lockChildren(tx,"fulfillment_line_reservation_claims","fulfillment_id",keys);
      const allocations=await lockChildren(tx,"fulfillment_allocations","fulfillment_id",keys);
      const shipments=await lockChildren(tx,"shipments","fulfillment_id",keys);
      const shipmentIds=sortedFulfillmentIds(shipments.map(row=>row.id));
      const shipmentLines=await lockChildren(tx,"shipment_lines","shipment_id",shipmentIds);
      const reversals=await lockChildren(tx,"shipment_reversals","shipment_id",shipmentIds);
      await tx.query("SELECT id,shipment_id,shipment_line_id FROM shipment_issue_details LIMIT 0");
      await tx.query("SELECT id,shipment_id,reversal_id FROM shipment_reversal_details LIMIT 0");
      if(roots.some(row=>lines.filter(line=>String(line.fulfillment_id)===String(row.id)).length!==Number(row.line_count))||shipments.some(row=>shipmentLines.filter(line=>String(line.shipment_id)===String(row.id)).length!==Number(row.line_count)))return unknown();
      let hasHistory=keys.length>0;
      if(command.action==="WITHDRAW"){
        const [archived]=await tx.query("SELECT id FROM fulfillments_archive WHERE sales_order_id=? LIMIT 1",[command.orderId]);hasHistory ||=archived.length>0;
      }
      const known=status=>command.action==="WITHDRAW"&&hasHistory?{status,reasonCodes:["FULFILLMENT_HISTORY_BLOCKS_WITHDRAWAL"]}:{status};
      // HD012: discover without range locks, then inspect actual primary rows NOWAIT.
      // An index-only shared read need not conflict with a writer's primary-row lock.
      const operationIds=[],targets=new Set();
      for(const [type,ids] of [["FULFILLMENT",keys],["SHIPMENT",shipmentIds]]){
        for(const target of ids){targets.add(`${type}:${target}`);const [found]=await tx.query("SELECT id FROM fulfillment_operation_requests WHERE target_type=? AND target_id=?",[type,target]);operationIds.push(...found.map(row=>row.id));}
      }
      await tx.query("SELECT id,status,target_type,target_id FROM fulfillment_operation_requests LIMIT 0");
      const sortedOperations=sortedFulfillmentIds(operationIds),operations=[];
      for(let offset=0;offset<sortedOperations.length;offset+=500){const batch=sortedOperations.slice(offset,offset+500),[rows]=await tx.query(`SELECT id,status,target_type,target_id FROM fulfillment_operation_requests FORCE INDEX (PRIMARY) WHERE id IN (${marks(batch)}) ORDER BY id FOR SHARE NOWAIT`,batch);if(rows.length!==batch.length||rows.some(row=>!targets.has(`${row.target_type}:${row.target_id}`)))return unknown();operations.push(...rows);}
      if(operations.some(row=>row.status==="IN_PROGRESS"))return known("OPEN");
      if(roots.some(row=>!["CANCELLED","SHIPPED","REVERSED"].includes(row.status))||shipments.some(row=>!["CANCELLED","SHIPPED","REVERSED"].includes(row.status))||claims.some(row=>BigInt(row.active_claimed_quantity)>0n)||allocations.some(row=>!["RELEASED","CONSUMED"].includes(row.status))||reversals.some(row=>row.status==="REVERSING"))return known("OPEN");
      return known("CLOSED");
    }catch{return unknown();}
  }
}

const openReasons=Object.freeze({nonterminalFulfillments:"FULFILLMENT_NONTERMINAL",nonterminalShipments:"SHIPMENT_NONTERMINAL",reversing:"REVERSAL_IN_PROGRESS",activeClaims:"CLAIM_ACTIVE",outstandingAllocations:"ALLOCATION_OUTSTANDING",inProgressOperations:"OPERATION_IN_PROGRESS"});
const archiveUnknown=reason=>({version:"1",status:"UNKNOWN",reasonCodes:[reason]});
const ownArchiveData=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Reflect.ownKeys(value).length===keys.length&&keys.every(key=>{const d=Object.getOwnPropertyDescriptor(value,key);return d&&Object.hasOwn(d,"value")&&d.enumerable;});
function archiveReadCommand(command){
  if(!ownArchiveData(command,["orderId","atMs"])||typeof command.orderId!=="string"||!/^[1-9][0-9]{0,15}$/u.test(command.orderId)||BigInt(command.orderId)>9007199254740991n||!Number.isSafeInteger(command.atMs)||command.atMs<0||command.atMs>8640000000000000)throw new TypeError("Invalid Archive read scope");
}
export function evaluateFulfillmentOpenMatter(facts){
  const keys=["inconsistent",...Object.keys(openReasons)];
  if(!facts||typeof facts!=="object"||Array.isArray(facts)||Object.keys(facts).length!==keys.length||keys.some(key=>typeof facts[key]!=="boolean")||facts.inconsistent)return archiveUnknown("OWNER_STATE_INCONSISTENT");
  const reasonCodes=Object.entries(openReasons).filter(([key])=>facts[key]).map(([,reason])=>reason);
  return {version:"1",status:reasonCodes.length?"OPEN":"CLOSED",reasonCodes};
}
