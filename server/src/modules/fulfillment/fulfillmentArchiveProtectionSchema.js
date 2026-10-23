import {inspectFulfillmentTable} from "./fulfillmentMigrationSchema.js";
import {FULFILLMENT_DOCUMENT_TABLES} from "../../../database/migrations/0093_create_fulfillment_documents.js";
import {FULFILLMENT_ALLOCATION_TABLE} from "../../../database/migrations/0095_create_fulfillment_allocations.js";
import {SHIPMENT_TABLES} from "../../../database/migrations/0096_create_shipments.js";
import {SHIPMENT_FACT_TABLES} from "../../../database/migrations/0097_create_shipment_issues_and_reversals.js";
import {FULFILLMENT_AUDIT_EXPORT_TABLES} from "../../../database/migrations/0098_create_fulfillment_audit_and_exports.js";
import {FULFILLMENT_ARCHIVE_TABLES} from "../../../database/migrations/0099_create_fulfillment_archives.js";
const sources=[...FULFILLMENT_DOCUMENT_TABLES,FULFILLMENT_ALLOCATION_TABLE,...SHIPMENT_TABLES,...SHIPMENT_FACT_TABLES,FULFILLMENT_AUDIT_EXPORT_TABLES[0]];
const same=(left,right,name,type)=>/^(?:var)?char\(|^json$/u.test(type)?`(CAST(${left}.${name} AS BINARY)<=>CAST(${right}.${name} AS BINARY))`:`(${left}.${name}<=>${right}.${name})`;
function mirrorMatch(c,{clearedPointer=false}={}){
 return Object.entries(c.columns).map(([name,[type]])=>{
  const equal=same("a","OLD",name,type);
  if(c.table!=="fulfillments"||name!=="active_shipment_id"||!clearedPointer)return equal;
  return `(${equal} OR (OLD.active_shipment_id IS NULL AND EXISTS (SELECT 1 FROM shipments_archive s WHERE s.id=a.active_shipment_id AND s.fulfillment_id=OLD.id AND s.archive_batch_id=a.archive_batch_id)))`;
 }).join(" AND ");
}
function deleteGuard(c){
 const children=sources.flatMap(child=>Object.values(child.foreignKeys).filter(fk=>fk[1]===c.table&&fk[3]==="CASCADE").map(fk=>({table:child.table,where:fk[0].split(",").map((name,i)=>`child.${name}=OLD.${fk[2].split(",")[i]}`).join(" AND ")})));
 // The lock belongs to each actual child SELECT; an old RR snapshot cannot conceal a CASCADE victim.
 const currentChildren=children.map(child=>`SET child_id=NULL; SELECT child.id INTO child_id FROM ${child.table} child WHERE ${child.where} ORDER BY child.id LIMIT 1 FOR SHARE; IF child_id IS NOT NULL THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Archive must delete protected children explicitly'; END IF;`).join(" ");
 return `BEGIN DECLARE child_id BIGINT UNSIGNED DEFAULT NULL; DECLARE CONTINUE HANDLER FOR NOT FOUND SET child_id=NULL; ${currentChildren}
 IF NOT EXISTS (SELECT 1 FROM ${c.table}_archive a WHERE ${mirrorMatch(c,{clearedPointer:true})}) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Archive requires identical immutable snapshot'; END IF; END`;
}
function pointerGuard(c){
 const unchanged=Object.entries(c.columns).filter(([name])=>name!=="active_shipment_id").map(([name,[type]])=>same("NEW","OLD",name,type)).join(" AND ");
 const technical=`OLD.active_shipment_id IS NOT NULL AND NEW.active_shipment_id IS NULL AND ${unchanged} AND EXISTS (SELECT 1 FROM fulfillments_archive a JOIN shipments_archive s ON s.id=a.active_shipment_id AND s.fulfillment_id=a.id AND s.archive_batch_id=a.archive_batch_id WHERE ${mirrorMatch(c)})`;
 return `BEGIN IF NOT (${technical}) THEN ${c.triggers.trg_ful_header_update[1]}; END IF; END`;
}
export const FULFILLMENT_ARCHIVE_PROTECTION_ACTIVE=Object.freeze(sources.map(base=>{
 const addedTriggers={['trg_archive_'+base.table+'_delete']:["DELETE",deleteGuard(base)]};
 const retiredTriggers=Object.fromEntries(Object.entries(base.triggers??{}).filter(([name,[event]])=>event==="DELETE"||name==="trg_ful_header_update"));
 if(base.table==="fulfillments")addedTriggers.trg_ful_archive_pointer_update=["UPDATE",pointerGuard(base)];
 const retained=Object.fromEntries(Object.entries(base.triggers??{}).filter(([name])=>!Object.hasOwn(retiredTriggers,name)));
 const contract={...base,foreignKeys:{...base.foreignKeys,...base.deferredForeignKeys},triggers:{...retained,...addedTriggers}};
 return {base,contract,addedTriggers,retiredTriggers};
}));
export const FULFILLMENT_ARCHIVE_PROTECTION_MIRRORS=Object.freeze(FULFILLMENT_ARCHIVE_TABLES.map(base=>{
 const active=sources.find(c=>c.table+"_archive"===base.table);
 // The deferred circular active Shipment pointer stays a preserved value, not an immediate circular mirror FK.
 const additionalForeignKeys=Object.fromEntries(Object.entries(active.foreignKeys).filter(([,fk])=>sources.some(c=>c.table===fk[1])).map(([name,[fields,target,refs]])=>[name+"_ar",[fields,target+"_archive",refs,"RESTRICT"]]));
 return {base,additionalForeignKeys,contract:{...base,foreignKeys:{...base.foreignKeys,...additionalForeignKeys}}};
}));
export async function inspectFulfillmentArchiveProtection(tx){
 for(const {contract}of [...FULFILLMENT_ARCHIVE_PROTECTION_ACTIVE,...FULFILLMENT_ARCHIVE_PROTECTION_MIRRORS])if(!await inspectFulfillmentTable(tx,contract))return false;
 return true;
}
