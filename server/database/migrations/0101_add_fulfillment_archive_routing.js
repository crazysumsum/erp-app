// DEC-029: forward-only routing; stop writers before installing/resuming this migration.
// Routing is not a parent-lock receipt. Business writers still verify the real Sales/domain scope before committing an intent.
const table = "fulfillment_operation_requests";
const index = "idx_ful_operation_order";
const fenceIndex = "idx_ful_operation_archive_order";
const check = "chk_ful_operation_order";
const trigger = "trg_ful_operation_order_update";
const clause = "(if((target_type = 'EXPORT'),(sales_order_id is null),(coalesce(sales_order_id,0) > 0)) = 1)";
const body = "BEGIN IF NOT (NEW.sales_order_id<=>OLD.sales_order_id) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Fulfillment operation order route is immutable'; END IF; END";
const normalize = sql => String(sql).replace(/\\'/gu, "'").split(/('(?:[^']|'')*')/u)
  .map((part,i,parts) => i%2 ? part : part.replace(i<parts.length-1 ? /_[a-z0-9]+$/u : /$^/u, "").replace(/[`\s]/gu, "").toLowerCase()).join("");
const incompatible = () => { throw new Error("Incompatible Fulfillment operation order routing"); };
const joins = `FROM fulfillment_operation_requests o
 LEFT JOIN fulfillments f ON o.target_type='FULFILLMENT' AND f.id=o.target_id
 LEFT JOIN fulfillments_archive fa ON o.target_type='FULFILLMENT' AND fa.id=o.target_id
 LEFT JOIN shipments s ON o.target_type='SHIPMENT' AND s.id=o.target_id
 LEFT JOIN shipments_archive sa ON o.target_type='SHIPMENT' AND sa.id=o.target_id`;
const matchCount = "((f.id IS NOT NULL)+(fa.id IS NOT NULL)+(s.id IS NOT NULL)+(sa.id IS NOT NULL))";
const derived = "COALESCE(f.sales_order_id,fa.sales_order_id,s.sales_order_id,sa.sales_order_id)";

async function metadata(tx) {
  const [columns] = await tx.query("SELECT column_type AS type,is_nullable AS nullable,column_default AS def,extra AS extra FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name='sales_order_id'",[table]);
  if(columns.length && (columns.length!==1 || columns[0].type!=="bigint unsigned" || columns[0].nullable!=="YES" || columns[0].def!==null || columns[0].extra!=="")) incompatible();
  const [indexes] = await tx.query("SELECT column_name AS name,non_unique AS non_unique,sub_part AS sub_part FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=? ORDER BY seq_in_index",[table,index]);
  if(indexes.length && (indexes.map(row=>row.name).join(",")!=="sales_order_id,status,id" || indexes.some(row=>Number(row.non_unique)!==1 || row.sub_part!==null))) incompatible();
  const [fences] = await tx.query("SELECT column_name AS name,non_unique AS non_unique,sub_part AS sub_part FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? AND index_name=? ORDER BY seq_in_index",[table,fenceIndex]);
  if(fences.length && (fences.map(row=>row.name).join(",")!=="sales_order_id,id" || fences.some(row=>Number(row.non_unique)!==1 || row.sub_part!==null))) incompatible();
  const [checks] = await tx.query(`SELECT cc.check_clause AS clause,tc.enforced AS enforced FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.constraint_schema=tc.constraint_schema AND cc.constraint_name=tc.constraint_name
   WHERE tc.table_schema=DATABASE() AND tc.table_name=? AND tc.constraint_name=? AND tc.constraint_type='CHECK'`,[table,check]);
  if(checks.length && (checks.length!==1 || checks[0].enforced!=="YES" || normalize(checks[0].clause)!==normalize(clause))) incompatible();
  const [triggers] = await tx.query("SELECT event_manipulation AS event,action_timing AS timing,event_object_table AS owner,action_statement AS statement FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name=?",[trigger]);
  if(triggers.length && (triggers.length!==1 || triggers[0].event!=="UPDATE" || triggers[0].timing!=="BEFORE" || triggers[0].owner!==table || normalize(triggers[0].statement)!==normalize(body))) incompatible();
  return {column:columns.length===1,index:indexes.length>0,fenceIndex:fences.length>0,check:checks.length===1,trigger:triggers.length===1};
}
export async function up(tx) {
  const found = await metadata(tx);
  if(found.column && found.index && found.check && found.trigger) {
    // An already guarded route may legitimately contain a new NULL-target intent. It needs no legacy backfill.
    if(!found.fenceIndex) await tx.query(`ALTER TABLE ${table} ADD INDEX ${fenceIndex} (sales_order_id,id)`);
    if(!Object.values(await metadata(tx)).every(Boolean)) incompatible();
    return;
  }
  // Never infer a new-document owner from an opaque payload hash or silently overwrite a saved route.
  const [unresolved] = await tx.query(`SELECT o.id ${joins} WHERE o.target_type<>'EXPORT' AND
   (o.target_id IS NULL OR ${matchCount}<>1 OR COALESCE(${derived},0)<=0) LIMIT 1`);
  if(unresolved.length) throw new Error("Unresolved Fulfillment operation order route; preserve history and resolve with authoritative evidence before migration");
  if(found.column) {
    const [conflicts] = await tx.query(`SELECT o.id ${joins} WHERE (o.target_type='EXPORT' AND o.sales_order_id IS NOT NULL) OR
     (o.target_type<>'EXPORT' AND o.sales_order_id IS NOT NULL AND (o.sales_order_id=0 OR (o.target_id IS NOT NULL AND o.sales_order_id<>${derived}))) LIMIT 1`);
    if(conflicts.length) throw new Error("Conflicting Fulfillment operation order route");
  }
  if(!found.column) await tx.query(`ALTER TABLE ${table} ADD COLUMN sales_order_id BIGINT UNSIGNED NULL`);
  // DDL has implicit commits. Resume only missing compatible parts; never replace drifted guards.
  for(;;) {
    const [rows] = await tx.query(`SELECT o.id,${derived} AS order_id ${joins} WHERE o.target_type<>'EXPORT' AND o.sales_order_id IS NULL ORDER BY o.id LIMIT 500`);
    if(!rows.length) break;
    for(const row of rows) await tx.execute(`UPDATE ${table} SET sales_order_id=? WHERE id=? AND sales_order_id IS NULL`,[row.order_id,row.id]);
  }
  if(!found.index) await tx.query(`ALTER TABLE ${table} ADD INDEX ${index} (sales_order_id,status,id)`);
  // Archive locks an immutable order/id traversal; status transitions must not move a writer behind a held gap.
  if(!found.fenceIndex) await tx.query(`ALTER TABLE ${table} ADD INDEX ${fenceIndex} (sales_order_id,id)`);
  if(!found.check) await tx.query(`ALTER TABLE ${table} ADD CONSTRAINT ${check} CHECK (${clause})`);
  if(!found.trigger) await tx.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON ${table} FOR EACH ROW ${body}`);
  const final = await metadata(tx);
  if(!Object.values(final).every(Boolean)) incompatible();
}
