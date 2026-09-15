const SHAPES = Object.freeze({
  customer_addresses: { id: ["bigint unsigned", "NO", "auto_increment"], customer_id: ["bigint unsigned", "NO"], label: ["varchar(100)", "NO"], status: ["varchar(20)", "NO"], version: ["int unsigned", "NO"] },
  customer_address_purposes: { address_id: ["bigint unsigned", "NO"], customer_id: ["bigint unsigned", "NO"], purpose_code: ["varchar(30)", "NO"], is_default: ["tinyint(1)", "NO"], default_slot: ["tinyint(1)", "YES", "STORED GENERATED"] },
  customer_contacts: { id: ["bigint unsigned", "NO", "auto_increment"], customer_id: ["bigint unsigned", "NO"], name: ["varchar(190)", "NO"], status: ["varchar(20)", "NO"], version: ["int unsigned", "NO"] },
  customer_contact_purposes: { contact_id: ["bigint unsigned", "NO"], customer_id: ["bigint unsigned", "NO"], purpose_code: ["varchar(30)", "NO"], is_default: ["tinyint(1)", "NO"], default_slot: ["tinyint(1)", "YES", "STORED GENERATED"] }
});

const INDEXES = Object.freeze({
  customer_addresses: ["PRIMARY:0:id", "uq_customer_addresses_owner:0:id,customer_id", "idx_customer_addresses_owner_status:1:customer_id,status,sort_order,id", "idx_customer_addresses_country:1:country_code"],
  customer_address_purposes: ["PRIMARY:0:address_id,purpose_code", "uq_customer_address_default:0:customer_id,purpose_code,default_slot", "idx_customer_address_purpose:1:customer_id,purpose_code,is_default,address_id"],
  customer_contacts: ["PRIMARY:0:id", "uq_customer_contacts_owner:0:id,customer_id", "idx_customer_contacts_owner_status:1:customer_id,status,sort_order,id", "idx_customer_contacts_owner_name:1:customer_id,name", "idx_customer_contacts_email:1:email"],
  customer_contact_purposes: ["PRIMARY:0:contact_id,purpose_code", "uq_customer_contact_default:0:customer_id,purpose_code,default_slot", "idx_customer_contact_purpose:1:customer_id,purpose_code,is_default,contact_id"]
});

export async function inspectCustomerPartySchema(connection) {
  const [tables] = await connection.query("SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('customer_addresses','customer_address_purposes','customer_contacts','customer_contact_purposes')");
  if (tables.length === 0) return false;
  const existing = new Set(tables.map((row) => row.tableName));
  for (const [table, shapes] of Object.entries(SHAPES)) {
    if (!existing.has(table)) throw new Error(`Incompatible existing Customer party schema: missing ${table}`);
    const [rows] = await connection.query("SELECT column_name AS columnName, column_type AS columnType, is_nullable AS isNullable, extra AS extraValue FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?", [table]);
    const found = new Map(rows.map((row) => [row.columnName, row]));
    for (const [column, [type, nullable, extra]] of Object.entries(shapes)) {
      const row = found.get(column);
      if (!row || String(row.columnType).toLowerCase() !== type || row.isNullable !== nullable || (extra && String(row.extraValue).toLowerCase() !== extra.toLowerCase())) throw new Error(`Incompatible existing Customer party schema: ${table}.${column}`);
    }
    const [indexRows] = await connection.query("SELECT index_name AS indexName, non_unique AS nonUnique, seq_in_index AS sequence, column_name AS columnName FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? ORDER BY index_name, seq_in_index", [table]);
    const grouped = new Map();
    for (const row of indexRows) { const key = `${row.indexName}:${Number(row.nonUnique)}`; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row.columnName); }
    const actual = new Set([...grouped].map(([key, columns]) => `${key}:${columns.join(",")}`));
    for (const expected of INDEXES[table]) if (!actual.has(expected)) throw new Error(`Incompatible existing Customer party index: ${table}.${expected}`);
  }
  return true;
}

export async function up(connection) {
  await inspectCustomerPartySchema(connection);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_addresses (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      customer_id BIGINT UNSIGNED NOT NULL,
      label VARCHAR(100) NOT NULL,
      recipient_company_department VARCHAR(190) NOT NULL DEFAULT '',
      address_line1 VARCHAR(190) NOT NULL,
      address_line2 VARCHAR(190) NOT NULL DEFAULT '', address_line3 VARCHAR(190) NOT NULL DEFAULT '',
      city VARCHAR(100) NOT NULL DEFAULT '', state_region VARCHAR(100) NOT NULL DEFAULT '',
      postal_code VARCHAR(100) NOT NULL DEFAULT '', country_code CHAR(2) NULL,
      phone VARCHAR(50) NOT NULL DEFAULT '', notes VARCHAR(500) NOT NULL DEFAULT '',
      sort_order INT UNSIGNED NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'active',
      version INT UNSIGNED NOT NULL DEFAULT 1, created_at BIGINT UNSIGNED NOT NULL,
      updated_at BIGINT UNSIGNED NOT NULL, created_by BIGINT UNSIGNED NULL, updated_by BIGINT UNSIGNED NULL,
      PRIMARY KEY (id), UNIQUE KEY uq_customer_addresses_owner (id, customer_id),
      KEY idx_customer_addresses_owner_status (customer_id, status, sort_order, id),
      KEY idx_customer_addresses_country (country_code),
      CONSTRAINT fk_customer_addresses_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
      CONSTRAINT fk_customer_addresses_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_customer_addresses_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_address_purposes (
      address_id BIGINT UNSIGNED NOT NULL, customer_id BIGINT UNSIGNED NOT NULL,
      purpose_code VARCHAR(30) NOT NULL, is_default TINYINT(1) NOT NULL DEFAULT 0,
      default_slot TINYINT(1) GENERATED ALWAYS AS (IF(is_default = 1, 1, NULL)) STORED,
      created_at BIGINT UNSIGNED NOT NULL, updated_at BIGINT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NULL, updated_by BIGINT UNSIGNED NULL,
      PRIMARY KEY (address_id, purpose_code),
      UNIQUE KEY uq_customer_address_default (customer_id, purpose_code, default_slot),
      KEY idx_customer_address_purpose (customer_id, purpose_code, is_default, address_id),
      CONSTRAINT fk_customer_address_purposes_owner FOREIGN KEY (address_id, customer_id) REFERENCES customer_addresses (id, customer_id) ON DELETE CASCADE,
      CONSTRAINT fk_customer_address_purposes_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_customer_address_purposes_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_contacts (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, customer_id BIGINT UNSIGNED NOT NULL,
      name VARCHAR(190) NOT NULL, job_title VARCHAR(100) NOT NULL DEFAULT '', department VARCHAR(100) NOT NULL DEFAULT '',
      email VARCHAR(254) NOT NULL DEFAULT '', phone VARCHAR(50) NOT NULL DEFAULT '', mobile VARCHAR(50) NOT NULL DEFAULT '',
      preferred_language VARCHAR(20) NOT NULL DEFAULT '', notes VARCHAR(500) NOT NULL DEFAULT '',
      sort_order INT UNSIGNED NOT NULL DEFAULT 0, status VARCHAR(20) NOT NULL DEFAULT 'active',
      version INT UNSIGNED NOT NULL DEFAULT 1, created_at BIGINT UNSIGNED NOT NULL,
      updated_at BIGINT UNSIGNED NOT NULL, created_by BIGINT UNSIGNED NULL, updated_by BIGINT UNSIGNED NULL,
      PRIMARY KEY (id), UNIQUE KEY uq_customer_contacts_owner (id, customer_id),
      KEY idx_customer_contacts_owner_status (customer_id, status, sort_order, id),
      KEY idx_customer_contacts_owner_name (customer_id, name), KEY idx_customer_contacts_email (email),
      CONSTRAINT fk_customer_contacts_customer FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE CASCADE,
      CONSTRAINT fk_customer_contacts_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_customer_contacts_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS customer_contact_purposes (
      contact_id BIGINT UNSIGNED NOT NULL, customer_id BIGINT UNSIGNED NOT NULL,
      purpose_code VARCHAR(30) NOT NULL, is_default TINYINT(1) NOT NULL DEFAULT 0,
      default_slot TINYINT(1) GENERATED ALWAYS AS (IF(is_default = 1, 1, NULL)) STORED,
      created_at BIGINT UNSIGNED NOT NULL, updated_at BIGINT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NULL, updated_by BIGINT UNSIGNED NULL,
      PRIMARY KEY (contact_id, purpose_code),
      UNIQUE KEY uq_customer_contact_default (customer_id, purpose_code, default_slot),
      KEY idx_customer_contact_purpose (customer_id, purpose_code, is_default, contact_id),
      CONSTRAINT fk_customer_contact_purposes_owner FOREIGN KEY (contact_id, customer_id) REFERENCES customer_contacts (id, customer_id) ON DELETE CASCADE,
      CONSTRAINT fk_customer_contact_purposes_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_customer_contact_purposes_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}
