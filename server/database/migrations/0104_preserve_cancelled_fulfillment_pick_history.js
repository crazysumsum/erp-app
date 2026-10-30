import { FULFILLMENT_ALLOCATION_TABLE as legacy } from "./0095_create_fulfillment_allocations.js";
import { inspectFulfillmentTable,normalizeFulfillmentSchemaSql as normalize } from "../../src/modules/fulfillment/fulfillmentMigrationSchema.js";
import { cancelledAllocationSchema,CANCELLED_ALLOCATION_GUARDS } from "../../src/modules/fulfillment/fulfillmentCancelledAllocationSchema.js";
const next=cancelledAllocationSchema(legacy),quantityName="chk_ful_allocation_quantity";
const incompatible=()=>{throw new Error("Incompatible Fulfillment schema: Allocation cancellation history revision");};
async function state(tx){
 const [checks]=await tx.query("SELECT constraint_name AS name,check_clause AS clause FROM information_schema.check_constraints WHERE constraint_schema=DATABASE() AND constraint_name=?",[quantityName]);
 const [triggers]=await tx.query("SELECT trigger_name AS name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table='fulfillment_allocations'");
 if(checks.length!==1)incompatible();return {quantity:normalize(checks[0].clause),triggers:new Set(triggers.map(row=>row.name))};
}
function legacyPartial(current){const present=Object.entries(CANCELLED_ALLOCATION_GUARDS).filter(([name])=>current.triggers.has(name));return {...legacy,triggers:{...Object.fromEntries(Object.entries(legacy.triggers).map(([name,definition])=>[name,[...definition,present.some(([,guard])=>guard[0]===definition[0])?2:1]])),...Object.fromEntries(present.map(([name,definition])=>[name,[...definition,1]]))}};}
async function inspectLegacyPartial(tx,current){if(current.quantity!==normalize(legacy.checks[quantityName]))incompatible();await inspectFulfillmentTable(tx,legacyPartial(current));}
async function replaceCheck(tx,clause){await tx.query(`ALTER TABLE fulfillment_allocations DROP CHECK ${quantityName}, ADD CONSTRAINT ${quantityName} CHECK (${clause})`);}
export async function up(tx){
 const current=await state(tx);
 if(current.quantity===normalize(next.checks[quantityName])){await inspectFulfillmentTable(tx,next);return;}
 await inspectLegacyPartial(tx,current);
 // All terminal-proof guards precede the atomic CHECK replacement; only these partial states may resume.
 for(const [name,[event,body]]of Object.entries(CANCELLED_ALLOCATION_GUARDS))if(!current.triggers.has(name))await tx.query(`CREATE TRIGGER ${name} BEFORE ${event} ON fulfillment_allocations FOR EACH ROW PRECEDES ${event==="INSERT"?"trg_ful_allocation_insert":"trg_ful_allocation_update"} ${body}`);
 await replaceCheck(tx,next.checks[quantityName]);await inspectFulfillmentTable(tx,next);
}
export async function down(tx){
 const current=await state(tx);
 if(current.quantity===normalize(next.checks[quantityName])){
  await inspectFulfillmentTable(tx,next);
  const [overlap]=await tx.query("SELECT id FROM fulfillment_allocations WHERE picked_base_quantity+released_base_quantity>allocated_base_quantity LIMIT 1");
  if(overlap.length)throw new Error("Cancelled Pick history requires forward repair; rollback would lose history");
  await replaceCheck(tx,legacy.checks[quantityName]);
 }else await inspectLegacyPartial(tx,current);
 for(const name of Object.keys(CANCELLED_ALLOCATION_GUARDS))if(current.triggers.has(name))await tx.query(`DROP TRIGGER ${name}`);
 await inspectFulfillmentTable(tx,legacy);
}
