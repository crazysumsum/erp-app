import { up as mappingUp, inspectSalesReservationMappingSchema } from "./0078_create_sales_order_line_reservations.js";
import { inspectSalesOrderSchema } from "./0073_create_sales_orders.js";

const intakePair=" OR (root.command_type='SALES_INTAKE_BATCH_RESERVE' AND child.command_type='SALES_INTAKE_LINE_RESERVE')";
const existingPair="(root.command_type='SALES_BACKORDER_BATCH_RESERVE' AND child.command_type='SALES_BACKORDER_LINE_RESERVE')";
const indexName="uq_sales_order_source_intake",foreignName="fk_sales_orders_source_intake_order_id";

// Reuse the immutable historical inspectors, removing only this migration's known additions.
function historical(connection) {
  return {async query(sql,args) {
    const result=await connection.query(sql,args);
    if(!Array.isArray(result[0]))return result;
    if(sql.includes("information_schema.triggers"))for(const row of result[0])if(typeof row.statement==="string")
      row.statement=row.statement.replace(existingPair+intakePair,existingPair);
    if(sql.includes("information_schema.statistics"))result[0]=result[0].filter(row=>row.name!==indexName);
    if(sql.includes("information_schema.key_column_usage"))result[0]=result[0].filter(row=>row.name!=="source_intake_order_id");
    return result;
  }};
}

async function additions(connection) {
  const [indexes]=await connection.query(`SELECT non_unique AS non_unique,column_name AS column_name,seq_in_index AS seq_in_index,sub_part AS sub_part FROM information_schema.statistics
    WHERE table_schema=DATABASE() AND table_name='sales_orders' AND index_name=? ORDER BY seq_in_index`,[indexName]);
  if(indexes.length&&(indexes.length!==1||Number(indexes[0].non_unique)!==0||indexes[0].column_name!=="source_intake_order_id"||indexes[0].sub_part!==null))
    throw new Error("Incompatible Sales Intake unique index");
  const [foreignKeys]=await connection.query(`SELECT k.constraint_name AS constraint_name,k.referenced_table_name AS referenced_table_name,k.referenced_column_name AS referenced_column_name,
    k.referenced_table_schema AS referenced_table_schema,r.delete_rule AS delete_rule,r.update_rule AS update_rule
    FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r
    ON r.constraint_schema=k.constraint_schema AND r.table_name=k.table_name AND r.constraint_name=k.constraint_name
    WHERE k.table_schema=DATABASE() AND k.table_name='sales_orders' AND k.column_name='source_intake_order_id'`);
  const [[schema]]=await connection.query("SELECT DATABASE() AS name");
  if(foreignKeys.length&&(foreignKeys.length!==1||foreignKeys[0].referenced_table_name!=="sales_intake_orders"||foreignKeys[0].referenced_column_name!=="id"||foreignKeys[0].referenced_table_schema!==schema.name||foreignKeys[0].delete_rule!=="RESTRICT"||!["RESTRICT","NO ACTION"].includes(foreignKeys[0].update_rule)))
    throw new Error("Incompatible Sales Intake source foreign key");
  return {hasIndex:indexes.length===1,hasForeignKey:foreignKeys.length===1};
}

export async function up(connection) {
  const old=historical(connection);
  if(!await inspectSalesOrderSchema(old))throw new Error("Sales Order parent schema missing");
  const {hasIndex,hasForeignKey}=await additions(connection);
  const [duplicates]=await connection.query(`SELECT source_intake_order_id FROM sales_orders WHERE source_intake_order_id IS NOT NULL
    GROUP BY source_intake_order_id HAVING COUNT(*)>1 LIMIT 1`);
  const [orphans]=await connection.query(`SELECT o.id FROM sales_orders o LEFT JOIN sales_intake_orders i ON i.id=o.source_intake_order_id
    WHERE o.source_intake_order_id IS NOT NULL AND i.id IS NULL LIMIT 1`);
  if(duplicates.length||orphans.length)throw new Error("Sales Intake source drift requires reviewed recovery");
  // DDL commits separately. Missing original guards are repaired by the original migration;
  // changed guards are rejected before any replacement. An interrupted replacement resumes safely.
  await mappingUp(old);
  if(!hasIndex)await connection.query(`ALTER TABLE sales_orders ADD UNIQUE KEY ${indexName} (source_intake_order_id)`);
  if(!hasForeignKey)await connection.query(`ALTER TABLE sales_orders ADD CONSTRAINT ${foreignName} FOREIGN KEY (source_intake_order_id) REFERENCES sales_intake_orders(id) ON DELETE RESTRICT`);
  const [triggers]=await connection.query(`SELECT trigger_name AS name,event_manipulation AS event,action_statement AS statement
    FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table='sales_order_line_reservations'`);
  for(const row of triggers) {
    if(!["trg_sales_mapping_insert","trg_sales_mapping_update"].includes(row.name)||!row.statement.includes(existingPair))throw new Error("Sales reservation projection guard drift");
    if(row.statement.includes(intakePair))continue;
    const body=row.statement.replace(existingPair,existingPair+intakePair);
    await connection.query(`DROP TRIGGER ${row.name}`);
    await connection.query(`CREATE TRIGGER ${row.name} BEFORE ${row.event} ON sales_order_line_reservations FOR EACH ROW ${body}`);
  }
  await inspectSalesReservationMappingSchema(old);
  const [updated]=await connection.query("SELECT action_statement AS statement FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table='sales_order_line_reservations'");
  if(updated.length!==2||updated.some(row=>row.statement.split(intakePair).length!==2))throw new Error("Sales Intake projection guards missing");
  const final=await additions(connection);if(!final.hasIndex||!final.hasForeignKey)throw new Error("Sales Intake source constraints missing");
}
