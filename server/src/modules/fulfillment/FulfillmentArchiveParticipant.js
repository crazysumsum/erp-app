import {getActiveTransactionIsolation} from "../../services/mysqldatabase/MySqlDatabaseService.js";
import {validateFulfillmentArchivePrepare,validateFulfillmentArchiveCommand,validateFulfillmentArchiveManifest} from "./fulfillmentArchiveContract.js";
import {inspectFulfillmentArchiveReadiness} from "./fulfillmentArchiveReadiness.js";
import {FULFILLMENT_ARCHIVE_CONTRACTS,hashFulfillmentArchiveRow,hashFulfillmentArchiveTable} from "./fulfillmentArchiveSchema.js";
import {readFulfillmentArchiveState,archiveStateFacts} from "./fulfillmentArchiveState.js";
import {evaluateFulfillmentOpenMatter} from "./FulfillmentOpenMatterService.js";
const fail=code=>{throw Object.assign(new Error(code),{code});};
const marks=rows=>rows.map(()=>"?").join(",");
const scopeOf=value=>Object.freeze({orderId:value.orderId,archiveBatchId:value.archiveBatchId,cutoffMs:value.cutoffMs});
const json=value=>typeof value==="string"?JSON.parse(value):value;
function manifestFor(scope,state){
 const tableCounts={},hashSummary={};for(const {table}of FULFILLMENT_ARCHIVE_CONTRACTS){const digest=hashFulfillmentArchiveTable(table,state[table]);tableCounts[table]=digest.count;hashSummary[table]=digest.hash;}
 return {version:"1",...scope,tableCounts,hashSummary};
}
function sameManifest(actual,expected){
 return ["version","orderId","archiveBatchId","cutoffMs"].every(key=>actual[key]===expected[key])&&FULFILLMENT_ARCHIVE_CONTRACTS.every(({table})=>actual.tableCounts[table]===expected.tableCounts[table]&&actual.hashSummary[table]===expected.hashSummary[table]);
}
// Internal owner participant only. The real singleton adapter must supply a fixed read-only private job authorizer.
// It never starts/commits a transaction, acquires a connection, takes Sales locks or calls Inventory writes.
export class FulfillmentArchiveParticipant{
 #authorizeArchive;
 constructor({database,time,authorizeArchive}={}){this.database=database;this.time=time??{nowMs:()=>Date.now()};this.#authorizeArchive=authorizeArchive;}
 async #authorize(tx,scope){
  if(this.database?.context?.get()?.databaseTransaction!==tx||getActiveTransactionIsolation(tx)!=="REPEATABLE READ"||typeof this.#authorizeArchive!=="function"||await this.#authorizeArchive(tx,scope)!==true)fail("FULFILLMENT_ARCHIVE_FORBIDDEN");
 }
 async #ready(tx){const ready=await inspectFulfillmentArchiveReadiness(tx);if(!ready.ready)fail("FULFILLMENT_ARCHIVE_NOT_ELIGIBLE");}
 async #active(tx,scope){
  const state=await readFulfillmentArchiveState(tx,scope.orderId,{lock:true}),now=this.time.nowMs();
  if(!Number.isSafeInteger(now)||now<0||evaluateFulfillmentOpenMatter(archiveStateFacts(state,now)).status!=="CLOSED"||[...state.fulfillments,...state.shipments].some(row=>BigInt(row.last_business_updated_at)>=BigInt(scope.cutoffMs)))fail("FULFILLMENT_ARCHIVE_NOT_ELIGIBLE");return state;
 }
 async prepareOrderInTransaction(tx,input){
  validateFulfillmentArchivePrepare(input);const scope=scopeOf(input);await this.#authorize(tx,scope);await this.#ready(tx);
  return manifestFor(scope,await this.#active(tx,scope));
 }
 async archiveOrderInTransaction(tx,input){
  validateFulfillmentArchiveCommand(input);const command=structuredClone(input),scope=scopeOf(command),expected=command.expectedManifest;
  await this.#authorize(tx,scope);await this.#ready(tx);
  const active=await this.#active(tx,scope),archived=await readFulfillmentArchiveState(tx,scope.orderId,{archived:true});
  const [[durable]]=await tx.query("SELECT archive_batch_id,fulfillment_table_counts,fulfillment_hash_summary,participant_versions,archived_at FROM sales_archive_order_manifests WHERE sales_order_id=? LIMIT 1",[scope.orderId]);
  if(durable){
   const counts=json(durable.fulfillment_table_counts),hashes=json(durable.fulfillment_hash_summary),versions=json(durable.participant_versions);
   try{validateFulfillmentArchiveManifest({version:"1",...scope,tableCounts:counts,hashSummary:hashes});}catch{fail("ARCHIVE_DATA_CONFLICT");}
   if(String(durable.archive_batch_id)!==scope.archiveBatchId||versions?.fulfillment!=="1"||FULFILLMENT_ARCHIVE_CONTRACTS.some(({table})=>active[table].length||counts?.[table]!==expected.tableCounts[table]||hashes?.[table]!==expected.hashSummary[table])||active.operations.some(row=>Number(row.is_document_archived)!==1)||!sameManifest(manifestFor(scope,archived),expected))fail("ARCHIVE_DATA_CONFLICT");
   this.#verifyMirrorRows(archived,scope,Number(durable.archived_at));await this.#assertReplayAbsence(tx,archived);await this.#authorize(tx,scope);return this.#result(scope,expected,"REPLAYED");
  }
  if(!sameManifest(manifestFor(scope,active),expected))fail("ARCHIVE_DATA_CONFLICT");
  this.#verifyMirrorRows(archived,scope,command.archivedAtMs);
  // Resume only a complete, revalidated Active source. Existing same-scope mirrors are immutable evidence, never repair inputs.
  for(const {table}of FULFILLMENT_ARCHIVE_CONTRACTS){const source=new Map(active[table].map(row=>[String(row.id),row]));for(const row of archived[table])if(!source.has(String(row.id))||hashFulfillmentArchiveRow(table,row)!==hashFulfillmentArchiveRow(table,source.get(String(row.id))))fail("ARCHIVE_DATA_CONFLICT");}
  await this.#authorize(tx,scope);
  for(const {table,columns}of FULFILLMENT_ARCHIVE_CONTRACTS){
   const names=Object.keys(columns).join(",");
   const copied=new Set(archived[table].map(row=>String(row.id))),missing=active[table].filter(row=>!copied.has(String(row.id)));
   for(let offset=0;offset<missing.length;offset+=500){
    const rows=missing.slice(offset,offset+500),ids=rows.map(row=>String(row.id)),cases=rows.map(()=>"WHEN ? THEN ?").join(" "),hashes=rows.flatMap(row=>[String(row.id),hashFulfillmentArchiveRow(table,row)]);
    let inserted;
    try{[inserted]=await tx.execute(`INSERT INTO ${table}_archive (${names},archive_batch_id,archived_at,row_hash) SELECT ${names},?,?,CASE id ${cases} END FROM ${table} FORCE INDEX (PRIMARY) WHERE id IN (${marks(ids)}) ORDER BY id`,[scope.archiveBatchId,command.archivedAtMs,...hashes,...ids]);}
    catch(error){if((error.cause?.code??error.code)==="ER_DUP_ENTRY")fail("ARCHIVE_DATA_CONFLICT");throw error;}
    if(Number(inserted.affectedRows)!==rows.length)fail("ARCHIVE_DATA_CONFLICT");
   }
  }
  const verified=await readFulfillmentArchiveState(tx,scope.orderId,{archived:true});
  if(!sameManifest(manifestFor(scope,verified),expected))fail("ARCHIVE_DATA_CONFLICT");this.#verifyMirrorRows(verified,scope,command.archivedAtMs);
  // This exact technical pointer clear preserves business bytes/version and requires the verified original mirror.
  await this.#authorize(tx,scope);
  for(const row of active.fulfillments)if(row.active_shipment_id!==null){const [updated]=await tx.execute("UPDATE fulfillments SET active_shipment_id=NULL WHERE id=? AND active_shipment_id=?",[row.id,row.active_shipment_id]);if(Number(updated.affectedRows)!==1)fail("ARCHIVE_DATA_CONFLICT");}
  for(let offset=0;offset<active.operations.length;offset+=500){const ids=active.operations.slice(offset,offset+500).map(row=>String(row.id));const [updated]=await tx.execute(`UPDATE fulfillment_operation_requests SET is_document_archived=1 WHERE sales_order_id=? AND id IN (${marks(ids)})`,[scope.orderId,...ids]);if(Number(updated.affectedRows)!==ids.length)fail("ARCHIVE_DATA_CONFLICT");}
  for(const {table}of [...FULFILLMENT_ARCHIVE_CONTRACTS].reverse())for(let offset=0;offset<active[table].length;offset+=500){const ids=active[table].slice(offset,offset+500).map(row=>String(row.id)),[deleted]=await tx.execute(`DELETE FROM ${table} WHERE id IN (${marks(ids)})`,ids);if(Number(deleted.affectedRows)!==ids.length)fail("ARCHIVE_DATA_CONFLICT");}
  const remaining=await readFulfillmentArchiveState(tx,scope.orderId);
  if(FULFILLMENT_ARCHIVE_CONTRACTS.some(({table})=>remaining[table].length)||remaining.operations.some(row=>Number(row.is_document_archived)!==1))fail("ARCHIVE_DATA_CONFLICT");
  await this.#authorize(tx,scope);return this.#result(scope,expected,"ARCHIVED");
 }
 async #assertReplayAbsence(tx,archived){
  for(const {table}of FULFILLMENT_ARCHIVE_CONTRACTS)for(let offset=0;offset<archived[table].length;offset+=500){const ids=archived[table].slice(offset,offset+500).map(row=>String(row.id)),[rows]=await tx.query(`SELECT id FROM ${table} FORCE INDEX (PRIMARY) WHERE id IN (${marks(ids)}) LIMIT 1`,ids);if(rows.length)fail("ARCHIVE_DATA_CONFLICT");}
  // Audit targets are polymorphic and have no parent FK: vanished Active roots do not prove absence of residue.
  for(const [type,table]of [["FULFILLMENT","fulfillments"],["SHIPMENT","shipments"],["REVERSAL","shipment_reversals"]])for(let offset=0;offset<archived[table].length;offset+=500){const ids=archived[table].slice(offset,offset+500).map(row=>String(row.id)),[rows]=await tx.query(`SELECT id FROM fulfillment_audit_logs FORCE INDEX (idx_ful_audit_target) WHERE target_type=? AND target_id IN (${marks(ids)}) LIMIT 1`,[type,...ids]);if(rows.length)fail("ARCHIVE_DATA_CONFLICT");}
 }
 #verifyMirrorRows(state,scope,archivedAtMs){
  for(const {table}of FULFILLMENT_ARCHIVE_CONTRACTS)for(const row of state[table])if(String(row.archive_batch_id)!==scope.archiveBatchId||Number(row.archived_at)!==archivedAtMs||row.row_hash!==hashFulfillmentArchiveRow(table,row))fail("ARCHIVE_DATA_CONFLICT");
 }
 #result(scope,manifest,outcome){return {version:"1",orderId:scope.orderId,archiveBatchId:scope.archiveBatchId,outcome,tableCounts:structuredClone(manifest.tableCounts),hashSummary:structuredClone(manifest.hashSummary),routing:{isDocumentArchived:true}};}
}
