import { FULFILLMENT_ARCHIVE_CONTRACTS } from "./fulfillmentArchiveSchema.js";

const fk = (name, columns, target, fields = "id", rule = "RESTRICT") => ({ name:"fk_ful_"+name, columns, target, fields, rule });
const spec = (indexes, foreignKeys, checks = {}) => ({ indexes:{PRIMARY:[0,"id"],...indexes}, foreignKeys, checks });
const actors = (prefix, names) => names.map(name=>fk(prefix+"_"+name,name,"users","id","SET NULL"));
const positive = (...names) => names.map(name=>`(${name} > 0)`).join(" AND ");
const states = (column, values) => `${column} IN (${values.split("/").map(value=>`'${value}'`).join(",")})`;
const shapes = {
  fulfillments:spec({uq_ful_number:[0,"fulfillment_number"],uq_ful_owner:[0,"id,sales_order_id"],uq_ful_active:[0,"active_shipment_id"],
    idx_ful_work:[1,"status,warehouse_id,last_business_updated_at,id"],idx_ful_order:[1,"sales_order_id,status,id"],idx_ful_customer:[1,"customer_id,created_at,id"],
    idx_ful_actor:[1,"created_by,status,updated_at,id"],idx_ful_cutoff:[1,"last_business_updated_at,status,id"]},
  [fk("order","sales_order_id","sales_orders"),fk("customer","customer_id","customers"),fk("warehouse","warehouse_id","inventory_warehouses"),...actors("root",["picked_by","shipped_by","cancelled_by","reversed_by","created_by","updated_by"])],
  {chk_ful_status:states("status","DRAFT/PICKING/PICKED/SHIPPED/CANCELLED/REVERSED"),chk_ful_values:"line_count BETWEEN 1 AND 100 AND version > 0 AND has_short_pick IN (0,1)"}),
  fulfillment_lines:spec({uq_ful_line_no:[0,"fulfillment_id,line_no"],uq_ful_line_sales:[0,"fulfillment_id,sales_order_line_id"],uq_ful_line_owner:[0,"id,fulfillment_id"],
    idx_ful_line_sales:[1,"sales_order_line_id,fulfillment_id,id"],idx_ful_line_sku:[1,"sku_id,fulfillment_id,id"]},
  [fk("line_root","fulfillment_id,sales_order_id","fulfillments","id,sales_order_id","CASCADE"),fk("line_sales","sales_order_line_id,sales_order_id","sales_order_lines","id,sales_order_id"),fk("line_sku","sku_id","item_skus"),fk("line_uom","base_uom_id","item_uoms")],
  {chk_ful_line_values:"line_no BETWEEN 1 AND 100 AND sales_order_line_no BETWEEN 1 AND 100 AND version > 0 AND planned_base_quantity > 0",
    chk_ful_line_tracking:states("tracking_policy_snapshot","none/batch/batch_expiry"),
    chk_ful_line_quantity:"allocated_base_quantity <= planned_base_quantity AND picked_base_quantity <= allocated_base_quantity AND short_base_quantity <= planned_base_quantity AND picked_base_quantity + short_base_quantity <= planned_base_quantity AND shipped_base_quantity <= picked_base_quantity AND reversed_base_quantity <= shipped_base_quantity"}),
  fulfillment_line_reservation_claims:spec({uq_ful_claim:[0,"fulfillment_line_id,inventory_reservation_id"],idx_ful_claim_inventory:[1,"inventory_reservation_id,status,id"]},
  [fk("claim_owner","fulfillment_line_id,fulfillment_id","fulfillment_lines","id,fulfillment_id","CASCADE"),fk("claim_sales","sales_order_line_reservation_id","sales_order_line_reservations"),fk("claim_inventory","inventory_reservation_id","inventory_reservations")],
  {chk_ful_claim_status:states("status","ACTIVE/RELEASED/CONSUMED/CANCELLED/REVERSED"),chk_ful_claim_quantity:"original_claimed_quantity > 0 AND original_claimed_quantity = active_claimed_quantity + released_quantity + consumed_quantity AND reversed_quantity <= consumed_quantity AND inventory_version > 0",
    chk_ful_claim_terminal:"(status = 'ACTIVE') OR (active_claimed_quantity = 0)"}),
  fulfillment_allocations:spec({uq_ful_allocation:[0,"inventory_allocation_id"],uq_ful_allocation_line:[0,"fulfillment_line_id,inventory_allocation_id"],idx_ful_alloc_root:[1,"fulfillment_id,status,id"],idx_ful_alloc_res:[1,"inventory_reservation_id,status,id"],idx_ful_alloc_balance:[1,"inventory_balance_id,status,id"]},
  [fk("alloc_owner","fulfillment_line_id,fulfillment_id","fulfillment_lines","id,fulfillment_id","CASCADE"),fk("alloc_claim","claim_id","fulfillment_line_reservation_claims"),
    fk("alloc_reservation","inventory_reservation_id","inventory_reservations"),fk("alloc_inventory","inventory_allocation_id","inventory_allocations"),fk("alloc_balance","inventory_balance_id","inventory_stock_balances"),fk("alloc_warehouse","warehouse_id","inventory_warehouses"),fk("alloc_bin","bin_id","inventory_bins"),fk("alloc_lot","lot_id","inventory_lots")],
  {chk_ful_alloc_status:states("status","ACTIVE/PARTIALLY_RELEASED/RELEASED/CONSUMED"),chk_ful_alloc_stock:"stock_status_snapshot = 'AVAILABLE' AND selection_strategy IN ('FEFO','FIFO')",
    chk_ful_alloc_quantity:"allocated_base_quantity > 0 AND picked_base_quantity + released_base_quantity <= allocated_base_quantity AND inventory_version > 0 AND balance_version > 0 AND recommended_rank_snapshot > 0",
    chk_ful_alloc_override:"is_sequence_override IN (0,1) AND ((is_sequence_override = 0) OR (CHAR_LENGTH(override_reason) BETWEEN 5 AND 500))"}),
  fulfillment_status_history:spec({uq_ful_history_sequence:[0,"fulfillment_id,sequence_no"],uq_ful_history_event:[0,"fulfillment_id,event_id,action"],idx_ful_history_time:[1,"fulfillment_id,occurred_at,id"]},[fk("history_root","fulfillment_id","fulfillments","id","CASCADE")],
  {chk_ful_history_values:positive("sequence_no","version_after"),chk_ful_history_action:states("action","CREATE/ALLOCATE/PICK/CANCEL/SHIP/REVERSE"),chk_ful_history_status:states("to_status","DRAFT/PICKING/PICKED/SHIPPED/CANCELLED/REVERSED")}),
  shipments:spec({uq_ful_shipment_number:[0,"shipment_number"],uq_ful_shipment_owner:[0,"id,fulfillment_id"],uq_ful_shipment_effective:[0,"effective_fulfillment_id"],uq_ful_shipment_confirm:[0,"confirmation_event_id"],uq_ful_shipment_reverse:[0,"reversal_event_id"],
    idx_ful_shipment_root:[1,"fulfillment_id,status,id"],idx_ful_shipment_order:[1,"sales_order_id,status,id"],idx_ful_shipment_customer:[1,"customer_id,shipped_at,id"],idx_ful_shipment_warehouse:[1,"warehouse_id,status,shipped_at,id"],idx_ful_shipment_tracking:[1,"tracking_number,shipped_at,id"],idx_ful_shipment_cutoff:[1,"status,last_business_updated_at,id"]},
  [fk("shipment_root","fulfillment_id,sales_order_id","fulfillments","id,sales_order_id"),fk("shipment_order","sales_order_id","sales_orders"),fk("shipment_customer","customer_id","customers"),fk("shipment_warehouse","warehouse_id","inventory_warehouses"),fk("shipment_address","shipping_address_id","customer_addresses"),fk("shipment_contact","shipping_contact_id","customer_contacts"),...actors("shipment",["shipped_by","cancelled_by","reversed_by","created_by","updated_by"])],
  {chk_ful_shipment_status:states("status","DRAFT/SHIPPING/SHIPPED/CANCELLED/REVERSING/REVERSED"),chk_ful_shipment_values:"line_count BETWEEN 1 AND 100 AND version > 0 AND shipping_address_version > 0 AND package_count > 0 AND total_weight > 0",
    chk_ful_shipment_contact:"((shipping_contact_id IS NULL) AND (shipping_contact_version IS NULL)) OR ((shipping_contact_id IS NOT NULL) AND (shipping_contact_version IS NOT NULL) AND (shipping_contact_version > 0))"}),
  shipment_lines:spec({uq_ful_ship_line_no:[0,"shipment_id,line_no"],uq_ful_ship_line_root:[0,"shipment_id,fulfillment_line_id"],uq_ful_ship_line_owner:[0,"id,shipment_id"],idx_ful_ship_line_sales:[1,"sales_order_line_id,shipment_id,id"],idx_ful_ship_line_sku:[1,"sku_id,shipment_id,id"]},
  [fk("ship_line_shipment","shipment_id,fulfillment_id","shipments","id,fulfillment_id","CASCADE"),fk("ship_line_root","fulfillment_line_id,fulfillment_id","fulfillment_lines","id,fulfillment_id"),fk("ship_line_sales","sales_order_line_id","sales_order_lines"),fk("ship_line_sku","sku_id","item_skus"),fk("ship_line_uom","base_uom_id","item_uoms")],
  {chk_ful_ship_line_values:"line_no BETWEEN 1 AND 100 AND shipped_base_quantity > 0 AND reversed_base_quantity <= shipped_base_quantity"}),
  shipment_issue_details:spec({uq_ful_issue_movement:[0,"inventory_movement_id"],uq_ful_issue_allocation:[0,"inventory_allocation_id"],uq_ful_issue_reverse:[0,"reversal_movement_id"],idx_ful_issue_shipment:[1,"shipment_id,shipment_line_id,id"]},
  [fk("issue_owner","shipment_line_id,shipment_id","shipment_lines","id,shipment_id","CASCADE"),fk("issue_projection","fulfillment_allocation_id","fulfillment_allocations"),fk("issue_operation","inventory_operation_id","inventory_operation_requests"),fk("issue_movement","inventory_movement_id","inventory_movements"),fk("issue_reservation","inventory_reservation_id","inventory_reservations"),fk("issue_allocation","inventory_allocation_id","inventory_allocations"),fk("issue_balance","inventory_balance_id","inventory_stock_balances"),fk("issue_warehouse","warehouse_id","inventory_warehouses"),fk("issue_bin","bin_id","inventory_bins"),fk("issue_lot","lot_id","inventory_lots"),fk("issue_reverse","reversal_movement_id","inventory_movements")],
  {chk_ful_issue_quantity:"issued_base_quantity > 0"}),
  shipment_status_history:spec({uq_ful_ship_history_sequence:[0,"shipment_id,sequence_no"],uq_ful_ship_history_event:[0,"shipment_id,event_id,action"],idx_ful_ship_history_time:[1,"shipment_id,occurred_at,id"]},[fk("ship_history_root","shipment_id","shipments","id","CASCADE")],
  {chk_ful_ship_history_values:positive("sequence_no","version_after"),chk_ful_ship_history_action:states("action","CREATE/UPDATE/CANCEL/CONFIRM_START/CONFIRM/CONFIRM_FAIL/REVERSE_START/REVERSE/REVERSE_FAIL"),chk_ful_ship_history_status:states("to_status","DRAFT/SHIPPING/SHIPPED/CANCELLED/REVERSING/REVERSED")}),
  shipment_reversals:spec({uq_ful_reversal_number:[0,"reversal_number"],uq_ful_reversal_event:[0,"event_id"],uq_ful_reversal_effective:[0,"effective_shipment_id"],idx_ful_reversal_shipment:[1,"shipment_id,created_at,id"]},
  [fk("reversal_shipment","shipment_id","shipments"),...actors("reversal",["created_by","completed_by"])],
  {chk_ful_reversal_status:states("status","REVERSING/REVERSED/FAILED"),chk_ful_reversal_values:"version > 0 AND CHAR_LENGTH(reason) BETWEEN 5 AND 500 AND goods_under_company_control = 1 AND goods_returned_to_original_bins = 1"}),
  shipment_reversal_details:spec({uq_ful_reverse_issue:[0,"shipment_issue_detail_id"],uq_ful_reverse_movement:[0,"inventory_reversal_movement_id"],idx_ful_reverse_detail:[1,"reversal_id,id"]},
  [fk("reverse_detail_root","reversal_id","shipment_reversals","id","CASCADE"),fk("reverse_detail_shipment","shipment_id","shipments"),fk("reverse_detail_issue","shipment_issue_detail_id","shipment_issue_details"),fk("reverse_detail_operation","inventory_reversal_operation_id","inventory_operation_requests"),fk("reverse_detail_movement","inventory_reversal_movement_id","inventory_movements"),fk("reverse_detail_reservation","inventory_reservation_id","inventory_reservations"),fk("reverse_detail_warehouse","warehouse_id","inventory_warehouses"),fk("reverse_detail_bin","bin_id","inventory_bins"),fk("reverse_detail_lot","lot_id","inventory_lots")],
  {chk_ful_reverse_detail_quantity:"reversed_base_quantity > 0"}),
  fulfillment_audit_logs:spec({idx_ful_audit_target:[1,"target_type,target_id,occurred_at,id"],idx_ful_audit_action:[1,"action,occurred_at,id"],idx_ful_audit_event:[1,"event_id,id"]},[],
  {chk_ful_audit_target:states("target_type","FULFILLMENT/SHIPMENT/REVERSAL/EXPORT"),chk_ful_audit_archive:"is_archived IN (0,1)"})
};
const operationColumns = {
  id:{type:"bigint unsigned"},event_id:{type:"char(36)",collation:"ascii_bin"},operation_type:{type:"varchar(50)",collation:"ascii_bin"},
  target_type:{type:"varchar(30)",collation:"ascii_bin"},target_id:{type:"bigint unsigned",nullable:true},sales_order_id:{type:"bigint unsigned",nullable:true},
  payload_hash:{type:"char(64)",collation:"ascii_bin"},status:{type:"varchar(20)",collation:"ascii_bin"},result_json:{type:"json",nullable:true},
  public_error_code:{type:"varchar(80)",collation:"ascii_bin",defaultValue:""},public_error_details:{type:"json",nullable:true},lease_owner:{type:"varchar(190)",collation:"ascii_bin",defaultValue:""},
  lease_expires_at:{type:"bigint unsigned",nullable:true},next_attempt_at:{type:"bigint unsigned",nullable:true},attempt_count:{type:"int unsigned",defaultValue:"0"},correlation_id:{type:"char(36)",collation:"ascii_bin"},
  is_document_archived:{type:"tinyint(1)",defaultValue:"0"},created_at:{type:"bigint unsigned"},updated_at:{type:"bigint unsigned"},completed_at:{type:"bigint unsigned",nullable:true},initiated_by:{type:"bigint unsigned",nullable:true}
};
const operationSpec = spec({uq_ful_ops_event:[0,"event_id"],idx_ful_ops_recovery:[1,"status,lease_expires_at,next_attempt_at,id"],idx_ful_ops_target:[1,"target_type,target_id,status,id"],idx_ful_ops_archive:[1,"is_document_archived,updated_at,id"],idx_ful_ops_order:[1,"sales_order_id,status,id"]},actors("ops",["initiated_by"]),
  {chk_ful_ops_status:states("status","IN_PROGRESS/SUCCEEDED/FAILED"),chk_ful_ops_archive:"is_document_archived IN (0,1)",
    chk_ful_ops_route:"((target_type IN ('FULFILLMENT','SHIPMENT')) AND (sales_order_id IS NOT NULL) AND (sales_order_id > 0)) OR ((target_type = 'EXPORT') AND (sales_order_id IS NULL))"});
export const FULFILLMENT_ACTIVE_SCHEMAS = FULFILLMENT_ARCHIVE_CONTRACTS.map(c=>({...c,...shapes[c.table]}));
export const FULFILLMENT_OPERATION_SCHEMA = {table:"fulfillment_operation_requests",columns:operationColumns,...operationSpec};
const circular = fk("active_shipment","active_shipment_id,id","shipments","id,fulfillment_id");
export const FULFILLMENT_MIRROR_SCHEMAS = FULFILLMENT_ACTIVE_SCHEMAS.map(c=>({
  table:c.table+"_archive",columns:{...Object.fromEntries(Object.entries(c.columns).map(([name,column])=>[name,{...column,generated:null}])),
    archive_batch_id:{type:"bigint unsigned"},archived_at:{type:"bigint unsigned"},row_hash:{type:"char(64)",collation:"ascii_bin"}},
  indexes:{...Object.fromEntries(Object.entries(c.indexes).map(([name,value])=>[name==="PRIMARY"?name:name+"_ar",value])),["idx_ful_ar_"+c.table.slice(0,35)]:[1,"archive_batch_id,id"]},
  foreignKeys:[fk("ar_"+c.table.slice(0,32)+"_batch","archive_batch_id","sales_archive_batches"),
    ...c.foreignKeys.filter(key=>shapes[key.target] && !key.columns.includes("sales_order") && key.rule==="CASCADE").map(key=>({...key,name:key.name+"_ar",target:key.target+"_archive",rule:"RESTRICT"}))],
  checks:Object.fromEntries(Object.entries(c.checks).map(([name,value])=>[name+"_ar",value]))
}));
// Preserve every aggregate owner FK, including composite ownership, without coupling a snapshot to Active masters.
for (const c of FULFILLMENT_MIRROR_SCHEMAS) {
  const original = FULFILLMENT_ACTIVE_SCHEMAS.find(active=>active.table+"_archive"===c.table);
  for (const key of original.foreignKeys.filter(key=>shapes[key.target] && !c.foreignKeys.some(existing=>existing.name===key.name+"_ar"))) {
    c.foreignKeys.push({...key,name:key.name+"_ar",target:key.target+"_archive",rule:"RESTRICT"});
  }
}
for (const c of FULFILLMENT_MIRROR_SCHEMAS) {
  if(c.table==="fulfillments_archive")c.indexes.idx_ful_ar_warehouse_date=[1,"warehouse_id,created_at,id"];
  if(c.table==="shipments_archive")c.indexes.idx_ful_ar_ship_warehouse_date=[1,"warehouse_id,shipped_at,id"];
}
const allActive = [...FULFILLMENT_ACTIVE_SCHEMAS,FULFILLMENT_OPERATION_SCHEMA];
const quote = value => "'"+value.replaceAll("'","''")+"'";
// Keep expression grouping; removing parentheses could hide a materially changed CHECK.
function normalize(sql) {
  return sql.replaceAll("\\'", "'").split(/('(?:[^'\\]|\\.|'')*')/u).map((part,index)=>index%2?part.replaceAll("\\'","'"):part.replace(/_[a-z0-9]+(?=')/gu,"").replace(/[`\s]/gu,"").toLowerCase()).join("");
}
function columnSQL(name, c, archived) {
  return `${name} ${c.type}${c.collation?` CHARACTER SET ${c.collation.split("_")[0]} COLLATE ${c.collation}`:""}${c.generated?` GENERATED ALWAYS AS (${c.generated}) STORED`:` ${c.nullable?"NULL":"NOT NULL"}${c.defaultValue==null?"":` DEFAULT ${quote(c.defaultValue)}`}${name==="id"&&!archived?" AUTO_INCREMENT":""}`}`;
}
const fkSQL = key => `CONSTRAINT ${key.name} FOREIGN KEY (${key.columns}) REFERENCES ${key.target} (${key.fields}) ON DELETE ${key.rule}`;
function definitions(c) {
  return [...Object.entries(c.columns).map(([name,column])=>columnSQL(name,column,c.table.endsWith("_archive"))),
    ...Object.entries(c.indexes).map(([name,[nonUnique,fields]])=>name==="PRIMARY"?`PRIMARY KEY (${fields})`:`${nonUnique?"KEY":"UNIQUE KEY"} ${name} (${fields})`),
    ...c.foreignKeys.map(fkSQL),...Object.entries(c.checks).map(([name,clause])=>`CONSTRAINT ${name} CHECK (${clause})`)];
}
async function inspect(connection,c,{allowMissingCircular=false,allowMissingProtections=false,requireProtections=false}={}) {
  const fail = detail=>{throw new Error(`Incompatible Fulfillment schema: ${c.table} ${detail}`);};
  const [rows]=await connection.query(`SELECT column_name AS name,column_type AS type,is_nullable AS nullable,column_default AS value,
    collation_name AS collation,extra AS extra,generation_expression AS expression FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? ORDER BY ordinal_position`,[c.table]);
  if(!rows.length)return false;
  if(rows.length!==Object.keys(c.columns).length)fail("columns");
  for(const [i,row] of rows.entries()) {
    const name=Object.keys(c.columns)[i],column=c.columns[name],generated=Boolean(column.generated),archived=c.table.endsWith("_archive");
    if(row.name!==name||row.type!==column.type||row.nullable!==(column.nullable||generated?"YES":"NO")||
      (row.value??null)!==(column.defaultValue??null)||row.collation!==(column.collation??(/^(?:var)?char\(/u.test(column.type)?"utf8mb4_unicode_ci":null))||
      row.extra!==(generated?"STORED GENERATED":name==="id"&&!archived?"auto_increment":""))fail("column "+name);
    if((row.expression?checkExpression(row.expression):"")!==(column.generated?checkExpression(column.generated):""))fail("generated "+name);
  }
  const [[meta]]=await connection.query("SELECT engine AS engine,table_collation AS collation,table_schema AS schemaName FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?",[c.table]);
  if(meta.engine!=="InnoDB"||meta.collation!=="utf8mb4_unicode_ci")fail("engine/collation");
  const [indexes]=await connection.query("SELECT index_name AS name,non_unique AS nonUnique,column_name AS field,sub_part AS prefix FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? ORDER BY index_name,seq_in_index",[c.table]);
  const found=new Map();
  for(const row of indexes){if(c.indexes[row.name]&&row.prefix!==null)fail("index prefix");if(!found.has(row.name))found.set(row.name,[Number(row.nonUnique),[]]);found.get(row.name)[1].push(row.field);if(!row.nonUnique&&!c.indexes[row.name])fail("unexpected unique index");}
  for(const [name,[nonUnique,fields]]of Object.entries(c.indexes)){const value=found.get(name);if(!value||value[0]!==nonUnique||value[1].join(",")!==fields)fail("index "+name);}
  const [keys]=await connection.query(`SELECT k.constraint_name AS name,k.column_name AS field,k.referenced_table_name AS target,k.referenced_column_name AS targetField,k.referenced_table_schema AS targetSchema,r.delete_rule AS deleteRule,r.update_rule AS updateRule
    FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_schema=k.constraint_schema AND r.table_name=k.table_name AND r.constraint_name=k.constraint_name
    WHERE k.table_schema=DATABASE() AND k.table_name=? ORDER BY k.constraint_name,k.ordinal_position`,[c.table]);
  const actual=new Map();for(const key of keys){if(!actual.has(key.name))actual.set(key.name,[]);actual.get(key.name).push(key);}
  const expected=[...c.foreignKeys,...(c.table==="fulfillments"?[circular]:[])];
  for(const key of expected){const value=actual.get(key.name);if(!value&&key===circular&&allowMissingCircular)continue;
    if(!value||value.map(row=>row.field).join(",")!==key.columns||value.map(row=>row.targetField).join(",")!==key.fields||value.some(row=>row.target!==key.target||row.targetSchema!==meta.schemaName||row.deleteRule!==key.rule||!["RESTRICT","NO ACTION"].includes(row.updateRule)))fail("foreign key "+key.name);
    actual.delete(key.name);}
  if(actual.size)fail("unexpected foreign keys");
  const [checks]=await connection.query(`SELECT tc.constraint_name AS name,tc.enforced AS enforced,cc.check_clause AS clause FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc ON cc.constraint_schema=tc.constraint_schema AND cc.constraint_name=tc.constraint_name
    WHERE tc.constraint_schema=DATABASE() AND tc.table_name=? AND tc.constraint_type='CHECK'`,[c.table]);
  if(checks.length!==Object.keys(c.checks).length)fail("checks");
  for(const row of checks)if(row.enforced!=="YES"||!Object.hasOwn(c.checks,row.name)||checkExpression(row.clause)!==checkExpression(c.checks[row.name]))fail("checks "+row.name);
  const [triggers]=await connection.query("SELECT trigger_name AS name,event_manipulation AS event,action_timing AS timing,action_statement AS statement FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table=?",[c.table]);
  const expectedTriggers=protections(c);
  for(const row of triggers){const expected=expectedTriggers[row.name];if(!expected||row.event!==expected[0]||row.timing!=="BEFORE"||normalize(row.statement)!==normalize(expected[1]))fail("trigger "+row.name);}
  if(requireProtections&&!allowMissingProtections&&triggers.length!==Object.keys(expectedTriggers).length)fail("missing triggers");
  return true;
}
// Parse the small CHECK expression grammar instead of erasing parentheses: AND/OR grouping remains authoritative.
function checkExpression(sql) {
  const tokens = sql.replaceAll("\\'", "'").replace(/`/gu,"").replace(/\b_[a-z0-9]+(?=')/giu,"").match(/'(?:[^'\\]|\\.|'')*'|<=>|<=|>=|<>|!=|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[(),=<>+*/-]/gu) || [];
  let index=0;
  const peek=()=>tokens[index]?.toLowerCase(), take=()=>tokens[index++];
  function primary(){const token=take();if(!token)throw new Error("Invalid schema expression");
    if(token==="("){const value=expression(0);if(take()!==")")throw new Error("Invalid schema grouping");return value;}
    if(token.toLowerCase()==="not")return ["not",primary()];
    if(peek()==="("){take();const values=[];if(peek()!==")"){do{values.push(expression(0));if(peek()!==",")break;take();}while(index<tokens.length);}if(take()!==")")throw new Error("Invalid schema function");return [token.toLowerCase(),...values];}
    return token.startsWith("'")?token.replaceAll("\\'","'"):token.toLowerCase();
  }
  function expression(min){let left=primary();while(true){const op=peek(),rank=({or:1,and:2,in:3,between:3,is:3,"=":3,"<>":3,"!=":3,"<":3,">":3,"<=":3,">=":3,"<=>":3,"+":4,"-":4,"*":5,"/":5})[op];if(rank===undefined||rank<min)break;take();
      if(op==="in"){if(take()!=="(")throw new Error("Invalid schema IN");const values=[];do{values.push(expression(4));if(peek()!==",")break;take();}while(index<tokens.length);if(take()!==")")throw new Error("Invalid schema IN list: "+sql+" tokens "+JSON.stringify(tokens));left=[op,left,values];}
      else if(op==="between"){const low=expression(4);if(peek()!=="and")throw new Error("Invalid schema BETWEEN");take();left=[op,left,low,expression(4)];}
      else if(op==="is"){const negated=peek()==="not";if(negated)take();if(peek()!=="null")throw new Error("Invalid schema IS");take();left=[negated?"is not null":"is null",left];}
      else left=[op,left,expression(rank+1)];
    }return left;}
  const parsed=expression(0);if(index!==tokens.length)throw new Error("Unsupported schema expression");return JSON.stringify(parsed);
}
const immutable = "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='FULFILLMENT_IMMUTABLE'";
function protections(c) {
  const prefix="trg_ful_"+c.table, result={};
  if(c.table.endsWith("_archive"))return {[prefix+"_update"]:["UPDATE",immutable],[prefix+"_delete"]:["DELETE",immutable]};
  if(c.table==="fulfillment_operation_requests") {
    const equal=["event_id","operation_type","target_type","sales_order_id","payload_hash","correlation_id","created_at"].map(name=>`(NEW.${name} <=> OLD.${name})`).join(" AND ");
    result.trg_ful_ops_update=["UPDATE",`BEGIN IF NOT (${equal}) OR (OLD.target_id IS NOT NULL AND NOT (NEW.target_id <=> OLD.target_id)) OR (OLD.is_document_archived = 1 AND NEW.is_document_archived <> 1) THEN ${immutable}; END IF; END`];
    result.trg_ful_ops_delete=["DELETE",immutable];
    return result;
  }
  if(["fulfillment_lines","fulfillment_line_reservation_claims","fulfillment_allocations","shipment_lines","shipment_reversal_details"].includes(c.table)) {
    const condition=Object.values(c.checks).map(value=>`(${value.replace(/\b[a-z][a-z_0-9]*\b/gu,name=>Object.hasOwn(c.columns,name)?"NEW."+name:name)})`).join(" AND ");
    for(const event of ["INSERT","UPDATE"])result[prefix+"_quantity_"+event.toLowerCase()]=[event,`BEGIN IF NOT (${condition}) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='FULFILLMENT_QUANTITY_INVALID'; END IF; END`];
  }
  if(["fulfillment_status_history","shipment_status_history","shipment_reversal_details","fulfillment_audit_logs"].includes(c.table))result[prefix+"_update"]=["UPDATE",immutable];
  if(c.table==="shipment_issue_details") {
    const equal=Object.keys(c.columns).filter(name=>name!=="reversal_movement_id").map(name=>`(NEW.${name} <=> OLD.${name})`).join(" AND ");
    result[prefix+"_update"]=["UPDATE",`BEGIN IF NOT (${equal}) OR OLD.reversal_movement_id IS NOT NULL OR NEW.reversal_movement_id IS NULL THEN ${immutable}; END IF; END`];
  }
  // No session variable grants maintenance authority. An identical immutable copy must already exist.
  const equal=Object.entries(c.columns).map(([name,column])=>{
    if(c.table==="fulfillments"&&name==="active_shipment_id")return "((a.active_shipment_id <=> OLD.active_shipment_id) OR (OLD.active_shipment_id IS NULL AND EXISTS (SELECT 1 FROM shipments_archive s WHERE s.id = a.active_shipment_id AND s.fulfillment_id = OLD.id AND s.archive_batch_id = a.archive_batch_id)))";
    return /^(?:var)?char\(|^json$/u.test(column.type)?`(CAST(a.${name} AS BINARY) <=> CAST(OLD.${name} AS BINARY))`:`(a.${name} <=> OLD.${name})`;
  }).join(" AND ");
  const children=FULFILLMENT_ACTIVE_SCHEMAS.flatMap(child=>child.foreignKeys.filter(key=>key.target===c.table&&key.rule==="CASCADE").map(key=>
    `EXISTS (SELECT 1 FROM ${child.table} child WHERE ${key.columns.split(",").map((name,i)=>`child.${name} = OLD.${key.fields.split(",")[i]}`).join(" AND ")})`));
  result[prefix+"_delete"]=["DELETE",`BEGIN IF NOT EXISTS (SELECT 1 FROM ${c.table}_archive a WHERE ${equal})${children.length?` OR ${children.join(" OR ")}`:""} THEN ${immutable}; END IF; END`];
  return result;
}
export async function createFulfillmentArchivePrerequisites(connection) {
  // Validate every preexisting object before any implicit-commit DDL. Resume absent objects only.
  for(const c of allActive)await inspect(connection,c,{allowMissingCircular:true});
  for(const c of allActive)if(!await inspect(connection,c,{allowMissingCircular:true}))await connection.query(`CREATE TABLE ${c.table} (${definitions(c).join(",\n")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const [keys]=await connection.query("SELECT constraint_name FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND table_name='fulfillments' AND constraint_name=?",[circular.name]);
  if(!keys.length)await connection.query(`ALTER TABLE fulfillments ADD ${fkSQL(circular)}`);
  for(const c of allActive)await inspect(connection,c);
}
export async function createFulfillmentArchiveMirrors(connection) {
  for(const c of allActive)if(!await inspect(connection,c))throw new Error("Fulfillment prerequisites missing");
  for(const c of FULFILLMENT_MIRROR_SCHEMAS)await inspect(connection,c);
  // Topological FK order: projection before issue; reversal before its details; no Active pointer FK in mirrors.
  for(const c of FULFILLMENT_MIRROR_SCHEMAS)if(!await inspect(connection,c))await connection.query(`CREATE TABLE ${c.table} (${definitions(c).join(",\n")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  for(const c of FULFILLMENT_MIRROR_SCHEMAS)await inspect(connection,c);
}
export async function protectFulfillmentArchiveContracts(connection) {
  const contracts=[...allActive,...FULFILLMENT_MIRROR_SCHEMAS];
  for(const c of contracts)if(!await inspect(connection,c,{allowMissingProtections:true,requireProtections:true}))throw new Error("Fulfillment schema missing before protection");
  for(const c of contracts)for(const [name,[event,body]]of Object.entries(protections(c))){
    const [found]=await connection.query("SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name=?",[name]);
    if(!found.length)await connection.query(`CREATE TRIGGER ${name} BEFORE ${event} ON ${c.table} FOR EACH ROW ${body}`);
  }
  if(!await inspectFulfillmentArchiveSchemas(connection))throw new Error("Fulfillment protections incomplete");
}
export async function inspectFulfillmentArchiveSchemas(connection) {
  const found=[];for(const c of [...allActive,...FULFILLMENT_MIRROR_SCHEMAS])found.push(await inspect(connection,c,{requireProtections:true}));return found.every(Boolean);
}
