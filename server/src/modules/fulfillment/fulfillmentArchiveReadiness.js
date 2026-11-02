import {inspectSalesTable} from "../../../database/migrations/0070_create_sales_quotations.js";
import {inspectFulfillmentTable} from "./fulfillmentMigrationSchema.js";
import {inspectFulfillmentArchiveProtection,FULFILLMENT_ARCHIVE_PROTECTION_ACTIVE,FULFILLMENT_ARCHIVE_PROTECTION_MIRRORS} from "./fulfillmentArchiveProtectionSchema.js";
import {FULFILLMENT_AUDIT_EXPORT_TABLES} from "../../../database/migrations/0098_create_fulfillment_audit_and_exports.js";

// Version1 metadata snapshots the published P0 operation/sequence contracts without rewriting them.
// This read-only probe grants no writer fencing, business CLOSED state or Archive authority.
const sequence={table:"fulfillment_document_sequences",columns:{
  id:["bigint unsigned",false,null,null,"auto_increment"],document_type:["varchar(20)",false,null,"ascii_bin"],period_key:["char(6)",false,null,"ascii_bin"],
  next_value:["bigint unsigned",false,"1"],version:["int unsigned",false,"1"],updated_at:["bigint unsigned"]},
  indexes:{PRIMARY:[0,"id"],uq_ful_sequence:[0,"document_type,period_key"]},foreignKeys:{},checks:{chk_ful_sequence:"document_type IN ('FULFILLMENT','SHIPMENT','REVERSAL') AND next_value >= 1 AND version >= 1"},
  triggers:{trg_ful_sequence_update:["UPDATE",`BEGIN IF NOT (NEW.id=OLD.id AND NEW.document_type=OLD.document_type AND NEW.period_key=OLD.period_key AND ((NEW.next_value=OLD.next_value AND NEW.version=OLD.version AND NEW.updated_at=OLD.updated_at) OR (NEW.next_value>OLD.next_value AND NEW.version=OLD.version+1 AND NEW.updated_at>=OLD.updated_at))) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment sequence must be monotonic'; END IF; END`],
    trg_ful_sequence_delete:["DELETE","SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment sequence cannot be reused'"]}};
const immutable=["id","event_id","operation_type","target_type","payload_hash","correlation_id","initiated_by","created_at"].map(k=>`NEW.${k}<=>OLD.${k}`).join(" AND ");
const terminal=["target_id","status","result_json","public_error_code","public_error_details","lease_owner","lease_expires_at","next_attempt_at","attempt_count","completed_at"].map(k=>`NEW.${k}<=>OLD.${k}`).join(" AND ");
const stateChecks={
  chk_ful_operation_progress:"((status <> 'IN_PROGRESS') OR ((lease_owner <> '') AND (lease_expires_at IS NOT NULL) AND (result_json IS NULL) AND (completed_at IS NULL) AND (public_error_code = '') AND (public_error_details IS NULL)))",
  chk_ful_operation_success:"((status <> 'SUCCEEDED') OR ((target_id IS NOT NULL) AND (result_json IS NOT NULL) AND (completed_at IS NOT NULL) AND (lease_owner = '') AND (lease_expires_at IS NULL) AND (next_attempt_at IS NULL) AND (public_error_code = '') AND (public_error_details IS NULL)))",
  chk_ful_operation_failure:"((status <> 'FAILED') OR ((result_json IS NULL) AND (completed_at IS NOT NULL) AND (lease_owner = '') AND (lease_expires_at IS NULL) AND (next_attempt_at IS NULL) AND (public_error_code <> '') AND (public_error_code <> 'DATABASE_TRANSACTION_INDETERMINATE')))"
};
const operations={table:"fulfillment_operation_requests",columns:{
  id:["bigint unsigned",false,null,null,"auto_increment"],event_id:["char(36)",false,null,"ascii_bin"],operation_type:["varchar(50)",false,null,"ascii_bin"],
  target_type:["varchar(30)",false,null,"ascii_bin"],target_id:["bigint unsigned",true],payload_hash:["char(64)",false,null,"ascii_bin"],status:["varchar(20)",false,null,"ascii_bin"],
  result_json:["json",true],public_error_code:["varchar(80)",false,"","ascii_bin"],public_error_details:["json",true],lease_owner:["varchar(190)",false,"","ascii_bin"],
  lease_expires_at:["bigint unsigned",true],next_attempt_at:["bigint unsigned",true],attempt_count:["int unsigned",false,"0"],correlation_id:["char(36)",false,null,"ascii_bin"],
  is_document_archived:["tinyint(1)",false,"0"],created_at:["bigint unsigned"],updated_at:["bigint unsigned"],completed_at:["bigint unsigned",true],initiated_by:["bigint unsigned",true]},
  indexes:{PRIMARY:[0,"id"],uq_ful_operation_event:[0,"event_id"],idx_ful_operation_lease:[1,"status,lease_expires_at,next_attempt_at,id"],idx_ful_operation_target:[1,"target_type,target_id,status,id"],idx_ful_operation_archive:[1,"is_document_archived,updated_at,id"]},
  foreignKeys:{initiated_by:["users","id","SET NULL"]},checks:{...stateChecks,
    chk_ful_operation_type:"operation_type IN ('CREATE','UPDATE','ALLOCATE','REALLOCATE','PICK','CANCEL','SHIPMENT_CREATE','SHIPMENT_UPDATE','SHIPMENT_CANCEL','SHIP','REVERSE','EXPORT')",
    chk_ful_operation_status:"status IN ('IN_PROGRESS','SUCCEEDED','FAILED')",chk_ful_operation_target:"target_type IN ('FULFILLMENT','SHIPMENT','EXPORT')",
    chk_ful_operation_bounds:"attempt_count >= 1 AND is_document_archived IN (0,1) AND LENGTH(CAST(result_json AS CHAR CHARSET utf8mb4)) <= 2048 AND LENGTH(CAST(public_error_details AS CHAR CHARSET utf8mb4)) <= 1024"},
  triggers:{trg_ful_operation_update:["UPDATE",`BEGIN IF NOT (${immutable}) OR (OLD.target_id IS NOT NULL AND NOT (NEW.target_id<=>OLD.target_id)) OR (OLD.status<>'IN_PROGRESS' AND NOT (${terminal})) OR NEW.is_document_archived<OLD.is_document_archived THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment operation identity or outcome is immutable'; END IF; END`],
    trg_ful_operation_delete:["DELETE","SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment operation retention is required'"]}};

const routeClause="(if((target_type = 'EXPORT'),(sales_order_id is null),(coalesce(sales_order_id,0) > 0)) = 1)";
operations.columns.sales_order_id=["bigint unsigned",true];
operations.indexes.idx_ful_operation_order=[1,"sales_order_id,status,id"];
operations.indexes.idx_ful_operation_archive_order=[1,"sales_order_id,id"];
operations.checks.chk_ful_operation_order=routeClause;
operations.triggers.trg_ful_operation_order_update=["UPDATE","BEGIN IF NOT (NEW.sales_order_id<=>OLD.sales_order_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment operation order route is immutable'; END IF; END"];
async function inspectOperationStateChecks(tx){
  const [rows]=await tx.query(`SELECT tc.constraint_name AS name,cc.check_clause AS clause FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc
    ON cc.constraint_schema=tc.constraint_schema AND cc.constraint_name=tc.constraint_name WHERE tc.constraint_schema=DATABASE() AND tc.table_name='fulfillment_operation_requests' AND tc.constraint_type='CHECK'`);
  const normalize=value=>value.replace(/\\'/gu,"'").split(/('(?:[^']|'')*')/u).map((part,index,parts)=>index%2?part:part.replace(index<parts.length-1?/_[a-z0-9]+$/u:/$^/u,"").replace(/[`\s]/gu,"").toLowerCase()).join("");
  if(rows.length)for(const [name,clause]of Object.entries({...stateChecks,chk_ful_operation_order:routeClause}))if(!rows.some(row=>row.name===name&&normalize(row.clause)===normalize(clause)))throw new Error("Incompatible existing Fulfillment operation state guard");
}

const requiredVersions=Object.freeze([
 "migrations/0091_seed_fulfillment_permissions.js",
 "migrations/0092_create_fulfillment_operations_and_sequences.js",
 "migrations/0093_create_fulfillment_documents.js",
 "migrations/0095_create_fulfillment_allocations.js",
 "migrations/0096_create_shipments.js",
 "migrations/0097_create_shipment_issues_and_reversals.js",
 "migrations/0098_create_fulfillment_audit_and_exports.js",
 "migrations/0099_create_fulfillment_archives.js",
 "migrations/0105_add_fulfillment_archive_routing.js",
 "migrations/0106_protect_fulfillment_archive_contracts.js"
]);
const refused=reasonCode=>({ready:false,reasonCode});
// One probe only: preserve each existing strict validator while sharing its metadata family across fixed tables.
const readinessMetadataQueries=new Set([
 "SELECT column_name AS name,column_type AS type,is_nullable AS nullable,\n    column_default AS default_value,collation_name AS collation,extra AS extra FROM information_schema.columns\n    WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position",
 "SELECT engine AS engine,table_collation AS collation,table_schema AS schema_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
 "SELECT index_name AS name,non_unique AS non_unique,column_name AS column_name,sub_part AS sub_part\n    FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? ORDER BY index_name,seq_in_index",
 "SELECT k.column_name AS name,k.referenced_table_name AS target,k.referenced_column_name AS field,\n    k.referenced_table_schema AS schema_name,r.delete_rule AS delete_rule,r.update_rule AS update_rule\n    FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r\n    ON r.constraint_schema=k.constraint_schema AND r.table_name=k.table_name AND r.constraint_name=k.constraint_name\n    WHERE k.table_schema=DATABASE() AND k.table_name=?",
 "SELECT tc.constraint_name AS name,tc.enforced AS enforced,cc.check_clause AS clause\n    FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc\n    ON cc.constraint_schema=tc.constraint_schema AND cc.constraint_name=tc.constraint_name\n    WHERE tc.constraint_schema=DATABASE() AND tc.table_name=? AND tc.constraint_type='CHECK'",
 "SELECT trigger_name AS name,event_manipulation AS event,action_timing AS timing,\n    action_orientation AS orientation,action_statement AS statement FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table=?",
 "SELECT column_name AS name,column_type AS type,is_nullable AS nullable,column_default AS def,collation_name AS collation,extra AS extra,generation_expression AS generation\n    FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position",
 "SELECT engine AS engine,table_collation AS collation FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?",
 "SELECT index_name AS name,non_unique AS non_unique,column_name AS field,sub_part AS prefix FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? ORDER BY index_name,seq_in_index",
 "SELECT k.constraint_name AS name,k.column_name AS field,k.referenced_table_name AS target,k.referenced_column_name AS target_field,r.delete_rule AS delete_rule,r.update_rule AS update_rule,\n    k.referenced_table_schema=DATABASE() AS local_scope FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_schema=k.constraint_schema AND r.table_name=k.table_name AND r.constraint_name=k.constraint_name\n    WHERE k.table_schema=DATABASE() AND k.table_name=? ORDER BY k.constraint_name,k.ordinal_position",
 "SELECT tc.constraint_name AS name,tc.enforced AS enforced,cc.check_clause AS clause FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.constraint_schema=tc.constraint_schema AND cc.constraint_name=tc.constraint_name WHERE tc.constraint_schema=DATABASE() AND tc.table_name=? AND tc.constraint_type='CHECK'",
 "SELECT trigger_name AS name,event_manipulation AS event,action_timing AS timing,action_statement AS statement FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table=?",
 "SELECT trigger_name AS name,event_manipulation AS event,action_timing AS timing,action_order AS ordinal,action_statement AS statement FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table=?",
]);
export function readinessMetadata(tx,tables){
 const known=new Set(tables),families=new Map();
 return {async query(sql,args=[]){
  const predicate=/\b((?:[a-z]+\.)?(?:table_name|event_object_table))\s*=\s*\?/u.exec(sql);
  if(args.length!==1||!known.has(args[0])||!predicate||!readinessMetadataQueries.has(sql))return tx.query(sql,args);
  let grouped=families.get(sql);
  if(!grouped){
   // Bound the join order only for the two exact CHECK families; retain every constraint row.
   const lookupSql=sql.includes("information_schema.check_constraints")?sql.replace(" JOIN information_schema.check_constraints cc"," STRAIGHT_JOIN information_schema.check_constraints cc"):sql;
   const batchSql=lookupSql.replace(/^\s*SELECT\s+/u,prefix=>prefix+`${predicate[1]} AS __readiness_table,`).replace(predicate[0],`${predicate[1]} IN (?)`),[rows]=await tx.query(batchSql,[tables]);
   grouped=new Map(tables.map(table=>[table,[]]));
   if(!Array.isArray(rows))throw new TypeError("Invalid readiness metadata grouping");
   for(const row of rows){if(!row||typeof row!=="object"||!grouped.has(row.__readiness_table))throw new TypeError("Invalid readiness metadata grouping");const copy={...row};delete copy.__readiness_table;grouped.get(row.__readiness_table).push(copy);}
   families.set(sql,grouped);
  }
  return [grouped.get(args[0])];
 }};
}
export async function inspectFulfillmentArchiveReadiness(tx){
 try{
  try{
   const sales=readinessMetadata(tx,[sequence.table,operations.table]),owner=readinessMetadata(tx,[FULFILLMENT_AUDIT_EXPORT_TABLES[1].table,...FULFILLMENT_ARCHIVE_PROTECTION_ACTIVE.map(({contract})=>contract.table),...FULFILLMENT_ARCHIVE_PROTECTION_MIRRORS.map(({contract})=>contract.table)]);
   if(!await inspectSalesTable(sales,sequence)||!await inspectSalesTable(sales,operations))return refused("SCHEMA_MISSING");
   // The historical AND-only inspector flattens parentheses; OR/IF routing needs this strict second check.
   await inspectOperationStateChecks(tx);
   if(!await inspectFulfillmentArchiveProtection(owner)||!await inspectFulfillmentTable(owner,FULFILLMENT_AUDIT_EXPORT_TABLES[1]))return refused("SCHEMA_MISSING");
  }catch(error){
   if(/^Incompatible /u.test(error.message??""))return refused("SCHEMA_INCOMPATIBLE");
   if((error.cause?.code??error.code)==="ER_NO_SUCH_TABLE")return refused("SCHEMA_MISSING");
   throw error;
  }
  let versions;
  try{[versions]=await tx.query(`SELECT name FROM fr_schema_migrations WHERE name IN (${requiredVersions.map(()=>"?").join(",")}) LIMIT 11`,requiredVersions);}
  catch(error){if((error.cause?.code??error.code)==="ER_NO_SUCH_TABLE")return refused("SCHEMA_VERSION_UNAVAILABLE");throw error;}
  if(versions.length!==requiredVersions.length||new Set(versions.map(row=>row.name)).size!==requiredVersions.length||versions.some(row=>!requiredVersions.includes(row.name)))return refused("SCHEMA_VERSION_UNAVAILABLE");
  return {ready:true};
 }catch{return refused("PROVIDER_UNAVAILABLE");}
}
