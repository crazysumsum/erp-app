import {getActiveTransactionIsolation} from "../../services/mysqldatabase/MySqlDatabaseService.js";
import {SALES_ARCHIVE_COLUMNS,hashSalesArchiveRow,hashSalesArchiveRows} from "./salesArchiveHash.js";
import {validateFulfillmentArchiveManifest} from "../fulfillment/fulfillmentArchiveContract.js";

const FINALIZED_STATUSES = new Set(["COMPLETED", "CLOSED", "CANCELLED"]);

export function evaluateSalesArchiveEligibility(facts) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)
    || !Number.isSafeInteger(facts.lastBusinessUpdatedAt) || facts.lastBusinessUpdatedAt < 0
    || !Number.isSafeInteger(facts.cutoffMs) || facts.cutoffMs <= 0
    || typeof facts.hasBackorder !== "boolean"
    || !Number.isSafeInteger(facts.outstandingReservationCount) || facts.outstandingReservationCount < 0
    || !Number.isSafeInteger(facts.inProgressOperationCount) || facts.inProgressOperationCount < 0) {
    return { eligible: false, reasonCodes: ["ARCHIVE_FACTS_INVALID"] };
  }
  const reasonCodes = [];
  if (!FINALIZED_STATUSES.has(facts.status)) reasonCodes.push("ORDER_NOT_FINALIZED");
  if (facts.lastBusinessUpdatedAt >= facts.cutoffMs) reasonCodes.push("RETENTION_NOT_MET");
  if (facts.hasBackorder) reasonCodes.push("BACKORDER_OPEN");
  if (facts.outstandingReservationCount > 0) reasonCodes.push("RESERVATION_OPEN");
  if (facts.inProgressOperationCount > 0) reasonCodes.push("OPERATION_IN_PROGRESS");
  if (facts.fulfillment?.status === "OPEN") reasonCodes.push("FULFILLMENT_OPEN");
  else if (facts.fulfillment?.status !== "CLOSED" || !Array.isArray(facts.fulfillment.reasonCodes)
    || facts.fulfillment.reasonCodes.length !== 0) reasonCodes.push("FULFILLMENT_UNKNOWN");
  return { eligible: reasonCodes.length === 0, reasonCodes };
}

const archiveFailure=code=>{throw Object.assign(new Error(code),{code});};
const marks=ids=>ids.map(()=>"?").join(",");
const parseJson=value=>typeof value==="string"?JSON.parse(value):value;
function archiveCommand(input){
 const keys=["orderId","archiveBatchId","cutoffMs","archivedAtMs"];
 if(!input||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Reflect.ownKeys(input).length!==keys.length||Reflect.ownKeys(input).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(Object.getOwnPropertyDescriptor(input,k)??{},"value")))throw new TypeError("Invalid Sales Archive command");
 const command=Object.fromEntries(keys.map(k=>[k,input[k]]));
 for(const key of ["orderId","archiveBatchId"])if(typeof command[key]!=="string"||command[key].length>16||!/^[1-9][0-9]*$/u.test(command[key])||BigInt(command[key])>9007199254740991n)throw new TypeError("Invalid Sales Archive identity");
 if(!Number.isSafeInteger(command.cutoffMs)||command.cutoffMs<1||!Number.isSafeInteger(command.archivedAtMs)||command.archivedAtMs<command.cutoffMs||command.archivedAtMs>8640000000000000)throw new TypeError("Invalid Sales Archive timestamp");
 return Object.freeze(command);
}
// Fixed Sales-owned aggregate only. The runtime supplies a read-only private-scope lookup;
// this component never begins/commits a transaction or grants authority from caller fields.
export class SalesArchiveService{
 #authorizeArchive;#openMatter;#participant;#getArchiveReadTime;
 constructor({database,authorizeArchive,openMatter,participant,getArchiveReadTime}={}){this.database=database;this.#authorizeArchive=authorizeArchive;this.#openMatter=openMatter;this.#participant=participant;this.#getArchiveReadTime=getArchiveReadTime;}
 async #authorize(tx,command){
  if(this.database?.context?.get()?.databaseTransaction!==tx||getActiveTransactionIsolation(tx)!=="REPEATABLE READ"||typeof this.#authorizeArchive!=="function"||await this.#authorizeArchive(tx,{orderId:command.orderId,archiveBatchId:command.archiveBatchId,cutoffMs:command.cutoffMs})!==true)archiveFailure("SALES_ARCHIVE_FORBIDDEN");
 }
 async #read(tx,orderId,{archived=false,lock=false}={}){
  const state={};
  for(const [table,columns]of Object.entries(SALES_ARCHIVE_COLUMNS)){
   const physical=table+(archived?"_archive":""),lines="sales_order_lines"+(archived?"_archive":"");
   const projection=columns.map(name=>["order_date","requested_delivery_date"].includes(name)?`DATE_FORMAT(${name},'%Y-%m-%d') AS ${name}`:name).join(",")+(archived?",archive_batch_id,archived_at,row_hash":"");
   const where=table==="sales_orders"?"id=?":table==="sales_audit_logs"?"target_type='ORDER' AND target_id=?":table==="sales_order_line_reservations"?archived?"sales_order_line_id IN (SELECT id FROM sales_order_lines_archive WHERE sales_order_id=? UNION SELECT id FROM sales_order_lines WHERE sales_order_id=?)":`sales_order_line_id IN (SELECT id FROM ${lines} WHERE sales_order_id=?)`:"sales_order_id=?";
   const rows=[];let after="0";
   for(;;){
    const [page]=await tx.query(`SELECT ${projection} FROM ${physical} WHERE ${where} AND id>? ORDER BY id LIMIT 500`,[orderId,...(archived&&table==="sales_order_line_reservations"?[orderId]:[]),after]);
    if(page.some((row,i)=>BigInt(row.id)<=BigInt(i?page[i-1].id:after)))archiveFailure("ARCHIVE_DATA_CONFLICT");
    if(lock&&page.length){const [current]=await tx.query(`SELECT ${projection} FROM ${physical} FORCE INDEX (PRIMARY) WHERE id IN (${marks(page)}) ORDER BY id FOR UPDATE`,page.map(r=>String(r.id)));if(current.length!==page.length||current.some((row,i)=>hashSalesArchiveRow(table,row)!==hashSalesArchiveRow(table,page[i])))archiveFailure("ARCHIVE_DATA_CONFLICT");}
    rows.push(...page);if(page.length<500)break;after=String(page.at(-1).id);
   }
   state[table]=rows;
  }
  return state;
 }
 async #digest(state){const tableCounts={},hashSummary={};for(const table of Object.keys(SALES_ARCHIVE_COLUMNS)){const digest=await hashSalesArchiveRows(table,state[table]);tableCounts[table]=digest.count;hashSummary[table]=digest.hash;}return {tableCounts,hashSummary};}
 #verifyMirrors(state,command){for(const [table,rows]of Object.entries(state))for(const row of rows)if(String(row.archive_batch_id)!==command.archiveBatchId||Number(row.archived_at)!==command.archivedAtMs||row.row_hash!==hashSalesArchiveRow(table,row))archiveFailure("ARCHIVE_DATA_CONFLICT");}
 async #copy(tx,source,mirrors,command){
  this.#verifyMirrors(mirrors,command);
  for(const [table,columns]of Object.entries(SALES_ARCHIVE_COLUMNS)){
   const original=new Map(source[table].map(row=>[String(row.id),row]));
   for(const row of mirrors[table])if(!original.has(String(row.id))||hashSalesArchiveRow(table,row)!==hashSalesArchiveRow(table,original.get(String(row.id))))archiveFailure("ARCHIVE_DATA_CONFLICT");
   const existing=new Set(mirrors[table].map(r=>String(r.id))),missing=source[table].filter(r=>!existing.has(String(r.id)));
   for(let offset=0;offset<missing.length;offset+=500){
    const batch=missing.slice(offset,offset+500),ids=batch.map(r=>String(r.id)),names=columns.join(","),cases=batch.map(()=>"WHEN ? THEN ?").join(" ");let inserted;
    try{[inserted]=await tx.execute(`INSERT INTO ${table}_archive (${names},archive_batch_id,archived_at,row_hash) SELECT ${names},?,?,CASE id ${cases} END FROM ${table} FORCE INDEX (PRIMARY) WHERE id IN (${marks(ids)}) ORDER BY id`,[command.archiveBatchId,command.archivedAtMs,...batch.flatMap(r=>[String(r.id),hashSalesArchiveRow(table,r)]),...ids]);}catch(error){if((error.cause?.code??error.code)==="ER_DUP_ENTRY")archiveFailure("ARCHIVE_DATA_CONFLICT");throw error;}
    if(Number(inserted.affectedRows)!==batch.length)archiveFailure("ARCHIVE_DATA_CONFLICT");
   }
  }
 }
 async #route(tx,command,header,{verifyOnly=false}={}){
  const [keys]=await tx.query("SELECT id,status,sales_order_number,is_order_archived FROM sales_external_order_keys WHERE sales_order_id=?",[command.orderId]);
  if(keys.length!==(header.external_order_key_id===null?0:1)||keys.some(row=>String(row.id)!==String(header.external_order_key_id)||row.status!=="SUCCEEDED"||row.sales_order_number!==header.sales_order_number||verifyOnly&&Number(row.is_order_archived)!==1))archiveFailure("ARCHIVE_DATA_CONFLICT");
  if(!verifyOnly&&keys.length)await tx.execute("UPDATE sales_external_order_keys SET is_order_archived=1 WHERE id=? AND sales_order_id=?",[String(keys[0].id),command.orderId]);
  const [conversions]=await tx.query("SELECT id,quotation_id,sales_order_number_snapshot,is_order_archived FROM sales_quotation_conversions WHERE sales_order_id=?",[command.orderId]);
  if(conversions.length!==(header.source_quotation_id===null?0:1)||conversions.some(row=>String(row.quotation_id)!==String(header.source_quotation_id)||row.sales_order_number_snapshot!==header.sales_order_number||verifyOnly&&Number(row.is_order_archived)!==1))archiveFailure("ARCHIVE_DATA_CONFLICT");
  if(!verifyOnly&&conversions.length)await tx.execute("UPDATE sales_quotation_conversions SET is_order_archived=1 WHERE id=? AND sales_order_id=?",[String(conversions[0].id),command.orderId]);
 }
 async archiveOrderInTransaction(tx,input){
  let command=archiveCommand(input);await this.#authorize(tx,command);
  const [[durable]]=await tx.query("SELECT * FROM sales_archive_order_manifests WHERE sales_order_id=? FOR UPDATE",[command.orderId]);
  if(durable){
   if(String(durable.archive_batch_id)!==command.archiveBatchId)archiveFailure("ARCHIVE_DATA_CONFLICT");command=Object.freeze({...command,archivedAtMs:Number(durable.archived_at)});
   const mirrors=await this.#read(tx,command.orderId,{archived:true}),source=await this.#read(tx,command.orderId),digest=await this.#digest(mirrors),versions=parseJson(durable.participant_versions);
   if(versions?.sales!=="1"||versions?.fulfillment!=="1"||mirrors.sales_orders.length!==1||Object.keys(SALES_ARCHIVE_COLUMNS).some(table=>source[table].length||parseJson(durable.sales_table_counts)?.[table]!==digest.tableCounts[table]||parseJson(durable.sales_hash_summary)?.[table]!==digest.hashSummary[table]))archiveFailure("ARCHIVE_DATA_CONFLICT");
   if(durable.sales_order_number!==mirrors.sales_orders[0].sales_order_number)archiveFailure("ARCHIVE_DATA_CONFLICT");
   this.#verifyMirrors(mirrors,command);await this.#route(tx,command,mirrors.sales_orders[0],{verifyOnly:true});
   for(const [table,rows]of Object.entries(mirrors))for(let offset=0;offset<rows.length;offset+=500){const [remaining]=await tx.query(`SELECT id FROM ${table} FORCE INDEX (PRIMARY) WHERE id IN (${marks(rows.slice(offset,offset+500))}) LIMIT 1`,rows.slice(offset,offset+500).map(r=>String(r.id)));if(remaining.length)archiveFailure("ARCHIVE_DATA_CONFLICT");}
   const expectedManifest={version:"1",orderId:command.orderId,archiveBatchId:command.archiveBatchId,cutoffMs:command.cutoffMs,tableCounts:parseJson(durable.fulfillment_table_counts),hashSummary:parseJson(durable.fulfillment_hash_summary)};validateFulfillmentArchiveManifest(expectedManifest);
   await this.#participant.archiveOrderInTransaction(tx,{...command,expectedManifest});await this.#authorize(tx,command);return {outcome:"REPLAYED",...digest,totalAmount:mirrors.sales_orders[0].total_amount,fulfillmentTableCounts:expectedManifest.tableCounts,fulfillmentHashSummary:expectedManifest.hashSummary};
  }
  const source=await this.#read(tx,command.orderId,{lock:true}),header=source.sales_orders[0];
  if(source.sales_orders.length!==1||source.sales_order_lines.length!==Number(header.line_count))archiveFailure("ARCHIVE_DATA_CONFLICT");
  const [[operation]]=await tx.query("SELECT COUNT(*) AS n FROM sales_operation_requests WHERE target_type='SALES_ORDER' AND target_id=? AND status='IN_PROGRESS'",[command.orderId]);
  const readAtMs=await this.#getArchiveReadTime?.(tx);
  if(!Number.isSafeInteger(readAtMs)||readAtMs<command.archivedAtMs)archiveFailure("SALES_ARCHIVE_FORBIDDEN");
  const fulfillment=await this.#openMatter.getOrderArchiveStatusInTransaction(tx,{orderId:command.orderId,atMs:readAtMs});
  if(fulfillment?.version!=="1"||fulfillment.status==="UNKNOWN")archiveFailure("OPEN_MATTER_UNKNOWN");
  const eligibility=evaluateSalesArchiveEligibility({status:header.status,lastBusinessUpdatedAt:Number(header.last_business_updated_at),cutoffMs:command.cutoffMs,hasBackorder:Number(header.has_backorder)!==0||source.sales_backorder_entries.some(row=>row.status==="OPEN"||BigInt(row.outstanding_base_quantity)>0n)||source.sales_order_lines.some(row=>BigInt(row.backordered_base_quantity)>0n),outstandingReservationCount:source.sales_order_line_reservations.filter(row=>BigInt(row.outstanding_base_quantity)>0n).length,inProgressOperationCount:Number(operation.n),fulfillment});
  if(!eligibility.eligible)archiveFailure(eligibility.reasonCodes[0]);
  const expectedManifest=await this.#participant.prepareOrderInTransaction(tx,{orderId:command.orderId,archiveBatchId:command.archiveBatchId,cutoffMs:command.cutoffMs});validateFulfillmentArchiveManifest(expectedManifest);
  const expected=await this.#digest(source);await this.#copy(tx,source,await this.#read(tx,command.orderId,{archived:true}),command);
  const copied=await this.#read(tx,command.orderId,{archived:true}),actual=await this.#digest(copied);this.#verifyMirrors(copied,command);
  if(Object.keys(SALES_ARCHIVE_COLUMNS).some(table=>actual.tableCounts[table]!==expected.tableCounts[table]||actual.hashSummary[table]!==expected.hashSummary[table]))archiveFailure("ARCHIVE_DATA_CONFLICT");
  await this.#authorize(tx,command);await this.#participant.archiveOrderInTransaction(tx,{...command,expectedManifest});await this.#route(tx,command,header);
  for(const table of Object.keys(SALES_ARCHIVE_COLUMNS).reverse())for(let offset=0;offset<source[table].length;offset+=500){const batch=source[table].slice(offset,offset+500),[deleted]=await tx.execute(`DELETE FROM ${table} WHERE id IN (${marks(batch)})`,batch.map(r=>String(r.id)));if(Number(deleted.affectedRows)!==batch.length)archiveFailure("ARCHIVE_DATA_CONFLICT");}
  if(Object.values(await this.#read(tx,command.orderId)).some(rows=>rows.length))archiveFailure("ARCHIVE_DATA_CONFLICT");
  await tx.execute("INSERT INTO sales_archive_order_manifests(archive_batch_id,sales_order_id,sales_order_number,sales_table_counts,sales_hash_summary,fulfillment_table_counts,fulfillment_hash_summary,participant_versions,archived_at) VALUES (?,?,?,?,?,?,?,?,?)",[command.archiveBatchId,command.orderId,header.sales_order_number,JSON.stringify(expected.tableCounts),JSON.stringify(expected.hashSummary),JSON.stringify(expectedManifest.tableCounts),JSON.stringify(expectedManifest.hashSummary),JSON.stringify({sales:"1",fulfillment:"1"}),command.archivedAtMs]);
  await this.#authorize(tx,command);return {outcome:"ARCHIVED",...expected,totalAmount:header.total_amount,fulfillmentTableCounts:expectedManifest.tableCounts,fulfillmentHashSummary:expectedManifest.hashSummary};
 }
}
