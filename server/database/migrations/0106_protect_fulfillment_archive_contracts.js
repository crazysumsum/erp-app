import {inspectFulfillmentTable,addFulfillmentForeignKey} from "../../src/modules/fulfillment/fulfillmentMigrationSchema.js";
import {FULFILLMENT_ARCHIVE_PROTECTION_ACTIVE as active,FULFILLMENT_ARCHIVE_PROTECTION_MIRRORS as mirrors,inspectFulfillmentArchiveProtection} from "../../src/modules/fulfillment/fulfillmentArchiveProtectionSchema.js";
// Quiesced forward migration. Original installed migration bodies and mirror immutability remain intact.
async function inspectPartial(tx){
 for(const {base,contract,retiredTriggers}of active){
  const combined={...contract,triggers:{...contract.triggers,...retiredTriggers}};
  if(!await inspectFulfillmentTable(tx,combined,{allowMissingTriggers:true}))throw new Error("Missing formal Fulfillment Archive prerequisite");
  const [rows]=await tx.query("SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table=?",[base.table]),names=new Set(rows.map(r=>r.name));
  for(const [name]of Object.entries(base.triggers??{})){
   const replacement=Object.hasOwn(retiredTriggers,name)?name==="trg_ful_header_update"?"trg_ful_archive_pointer_update":"trg_archive_"+base.table+"_delete":null;
   if(!names.has(name)&&(!replacement||!names.has(replacement)))throw new Error("Missing original Fulfillment protection before forward migration");
  }
 }
 for(const {base,additionalForeignKeys}of mirrors)if(!await inspectFulfillmentTable(tx,{...base,deferredForeignKeys:additionalForeignKeys}))throw new Error("Missing formal Fulfillment mirror prerequisite");
}
export async function up(tx){
 await inspectPartial(tx);
 for(const {contract,addedTriggers,retiredTriggers}of active){
  for(const [name,[event,body]]of Object.entries(addedTriggers)){
   const [rows]=await tx.query("SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name=?",[name]);
   if(!rows.length)await tx.query(`CREATE TRIGGER ${name} BEFORE ${event} ON ${contract.table} FOR EACH ROW ${body}`);
  }
  await inspectFulfillmentTable(tx,{...contract,triggers:{...contract.triggers,...retiredTriggers}},{allowMissingTriggers:true});
 }
 for(const {base,additionalForeignKeys}of mirrors)for(const [name,fk]of Object.entries(additionalForeignKeys))await addFulfillmentForeignKey(tx,base.table,name,fk);
 // Every new complete guard is installed and verified before any exact-known old blocker is removed.
 for(const {contract,retiredTriggers}of active)for(const name of Object.keys(retiredTriggers)){
  await inspectFulfillmentTable(tx,{...contract,triggers:{...contract.triggers,...retiredTriggers}},{allowMissingTriggers:true});
  const [rows]=await tx.query("SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name=?",[name]);
  if(rows.length)await tx.query(`DROP TRIGGER ${name}`);
 }
 if(!await inspectFulfillmentArchiveProtection(tx))throw new Error("Incomplete Fulfillment Archive forward protection");
}
