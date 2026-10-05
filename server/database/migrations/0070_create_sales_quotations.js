// These two aggregate migrations use the same schema contract for creation and drift checks.
// Column tuples: SQL type, nullable, default, explicit collation, extra.
export async function inspectSalesTable(connection, { table, columns, indexes, foreignKeys, checks }) {
  const fail = detail => { throw new Error(`Incompatible existing Sales schema: ${table} ${detail}`); };
  const [found] = await connection.query(`SELECT column_name AS name,column_type AS type,is_nullable AS nullable,
    column_default AS default_value,collation_name AS collation,extra AS extra FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`, [table]);
  if (!found.length) return false;
  if (found.length !== Object.keys(columns).length) fail("columns");
  for (const row of found) {
    const expected = columns[row.name];
    if (!expected) fail(`column ${row.name}`);
    const [type, nullable = false, defaultValue = null, collation, extra = ""] = expected;
    const expectedCollation = collation ?? (/^(?:var)?char\(/u.test(type) ? "utf8mb4_unicode_ci" : null);
    if (row.type !== type || row.nullable !== (nullable ? "YES" : "NO") || (row.default_value ?? null) !== defaultValue ||
        row.collation !== expectedCollation || row.extra !== extra) fail(`column ${row.name}`);
  }
  const [[meta]] = await connection.query("SELECT engine AS engine,table_collation AS collation,table_schema AS schema_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [table]);
  if (meta.engine !== "InnoDB" || meta.collation !== "utf8mb4_unicode_ci") fail("engine/collation");
  const [indexRows] = await connection.query(`SELECT index_name AS name,non_unique AS non_unique,column_name AS column_name,sub_part AS sub_part
    FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? ORDER BY index_name,seq_in_index`, [table]);
  const actualIndexes = new Map();
  for (const row of indexRows) {
    if (indexes[row.name] && row.sub_part !== null) fail(`index prefix ${row.name}`);
    if (!actualIndexes.has(row.name)) actualIndexes.set(row.name, [Number(row.non_unique), []]);
    actualIndexes.get(row.name)[1].push(row.column_name);
    if (Number(row.non_unique) === 0 && !indexes[row.name]) fail(`unexpected unique index ${row.name}`);
  }
  for (const [name, [nonUnique, fields]] of Object.entries(indexes)) {
    const actual = actualIndexes.get(name);
    if (!actual || actual[0] !== nonUnique || actual[1].join(",") !== fields) fail(`index ${name}`);
  }
  const [fkRows] = await connection.query(`SELECT k.column_name AS name,k.referenced_table_name AS target,k.referenced_column_name AS field,
    k.referenced_table_schema AS schema_name,r.delete_rule AS delete_rule,r.update_rule AS update_rule
    FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r
    ON r.constraint_schema=k.constraint_schema AND r.table_name=k.table_name AND r.constraint_name=k.constraint_name
    WHERE k.table_schema=DATABASE() AND k.table_name=?`, [table]);
  if (fkRows.length !== Object.keys(foreignKeys).length) fail("foreign keys");
  for (const row of fkRows) {
    const expected = foreignKeys[row.name];
    if (!expected || row.target !== expected[0] || row.field !== expected[1] || row.delete_rule !== expected[2] ||
        row.schema_name !== meta.schema_name || !["RESTRICT", "NO ACTION"].includes(row.update_rule)) fail(`foreign key ${row.name}`);
  }
  const [checkRows] = await connection.query(`SELECT tc.constraint_name AS name,tc.enforced AS enforced,cc.check_clause AS clause
    FROM information_schema.table_constraints tc JOIN information_schema.check_constraints cc
    ON cc.constraint_schema=tc.constraint_schema AND cc.constraint_name=tc.constraint_name
    WHERE tc.constraint_schema=DATABASE() AND tc.table_name=? AND tc.constraint_type='CHECK'`, [table]);
  // Contracts below contain only associative AND comparisons/BETWEEN/IN; MySQL adds parentheses and charset introducers.
  const normalized = value => value.replace(/\\'/gu, "'").split(/('(?:[^']|'')*')/u).map((part, index, parts) => {
    if (index % 2) return part;
    if (index < parts.length - 1) part = part.replace(/_[a-z0-9]+$/u, "");
    return part.replace(/[`()\s]/gu, "").toLowerCase();
  }).join("");
  const requiredClauses = new Set(Object.values(checks).map(normalized));
  if (checkRows.length !== requiredClauses.size) fail("checks");
  for (const row of checkRows) {
    // Probe names are nonce-prefixed, so compare clauses rather than global constraint names.
    if (row.enforced !== "YES" || !requiredClauses.delete(normalized(row.clause))) fail("check clause");
  }
  const [triggers] = await connection.query("SELECT trigger_name FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table=?", [table]);
  if (triggers.length) fail("unexpected triggers");
  return true;
}

export async function createSalesTable(connection, contract) {
  if (await inspectSalesTable(connection, contract)) return;
  const { table, columns, indexes, foreignKeys, checks } = contract;
  const definitions = Object.entries(columns).map(([name, [type, nullable = false, defaultValue = null, collation, extra = ""]]) =>
    `${name} ${type}${collation ? ` CHARACTER SET ${collation.split("_")[0]} COLLATE ${collation}` : ""} ${nullable ? "NULL" : "NOT NULL"}${defaultValue === null ? "" : ` DEFAULT '${defaultValue}'`}${extra ? ` ${extra}` : ""}`);
  for (const [name, [nonUnique, fields]] of Object.entries(indexes)) definitions.push(name === "PRIMARY" ? `PRIMARY KEY (${fields})` : `${nonUnique ? "KEY" : "UNIQUE KEY"} ${name} (${fields})`);
  for (const [field, [target, key, rule]] of Object.entries(foreignKeys)) definitions.push(`CONSTRAINT fk_${table}_${field} FOREIGN KEY (${field}) REFERENCES ${target} (${key}) ON DELETE ${rule}`);
  for (const [name, clause] of Object.entries(checks)) definitions.push(`CONSTRAINT ${name} CHECK (${clause})`);
  await connection.query(`CREATE TABLE IF NOT EXISTS ${table} (${definitions.join(",\n")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  if (!await inspectSalesTable(connection, contract)) throw new Error(`Sales schema was not created: ${table}`);
}

const COLUMNS = {
  id: ["bigint unsigned", false, null, null, "auto_increment"],
  quotation_number: ["varchar(20)", false, null, "ascii_bin"], status: ["varchar(20)", false, null, "ascii_bin"],
  customer_id: ["bigint unsigned"], customer_code_snapshot: ["varchar(100)"], customer_name_snapshot: ["varchar(190)"],
  currency_code: ["char(3)", false, null, "ascii_bin"], payment_term_id: ["bigint unsigned", true],
  payment_term_code_snapshot: ["varchar(50)", false, ""], payment_term_name_snapshot: ["varchar(190)", false, ""],
  quotation_date: ["date"], valid_until: ["date"], external_reference: ["varchar(190)", false, ""], notes: ["varchar(2000)", false, ""],
  line_count: ["int unsigned"], total_amount: ["decimal(19,4)"], version: ["int unsigned", false, "1"],
  issued_at: ["bigint unsigned", true], cancelled_at: ["bigint unsigned", true],
  issued_by: ["bigint unsigned", true], cancelled_by: ["bigint unsigned", true], cancel_reason: ["varchar(500)", false, ""],
  created_at: ["bigint unsigned"], updated_at: ["bigint unsigned"], last_business_updated_at: ["bigint unsigned"],
  created_by: ["bigint unsigned", true], updated_by: ["bigint unsigned", true]
};
const CONTRACT = {
  table: "sales_quotations", columns: COLUMNS,
  indexes: { PRIMARY: [0, "id"], uq_sales_quotation_number: [0, "quotation_number"],
    idx_sales_quotations_status_date: [1, "status,quotation_date,id"], idx_sales_quotations_customer: [1, "customer_id,quotation_date,id"],
    idx_sales_quotations_expiry: [1, "status,valid_until,id"] },
  foreignKeys: { customer_id: ["customers", "id", "RESTRICT"], currency_code: ["currencies", "code", "RESTRICT"],
    payment_term_id: ["payment_terms", "id", "RESTRICT"], issued_by: ["users", "id", "SET NULL"], cancelled_by: ["users", "id", "SET NULL"],
    created_by: ["users", "id", "SET NULL"], updated_by: ["users", "id", "SET NULL"] },
  checks: { chk_sales_quotation_values: "line_count BETWEEN 1 AND 100 AND version >= 1 AND total_amount >= 0 AND valid_until >= quotation_date",
    chk_sales_quotation_status: "status IN ('DRAFT','ISSUED','EXPIRED','CONVERTED','CANCELLED')" }
};
export const inspectSalesQuotationSchema = connection => inspectSalesTable(connection, CONTRACT);
export const up = connection => createSalesTable(connection, CONTRACT);
