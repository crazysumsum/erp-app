const COLUMNS = Object.freeze([
  "id", "supplier_id", "requested_by", "assigned_approver_id", "supplier_version", "summary",
  "status", "pending_slot", "request_note", "decision_reason", "requested_at", "decided_at",
  "decided_by", "version"
]);
const INDEXES = new Set([
  "PRIMARY", "uq_supplier_activation_pending", "idx_supplier_activation_approver", "idx_supplier_activation_supplier"
]);
const FOREIGN_KEYS = new Set([
  "fk_supplier_activation_supplier", "fk_supplier_activation_requested_by",
  "fk_supplier_activation_approver", "fk_supplier_activation_decided_by"
]);

function value(row, lower, upper) {
  return row[lower] ?? row[upper];
}

// Four rounds of independent review found a defect in three of them, all in one
// attempt to infer this behaviour from the text of GENERATION_EXPRESSION. That
// approach validates a string to conclude something about a behaviour, so every
// rendering variation is a new false reject and every normalization step is a new
// false accept, and the two pressures push against each other: each fix created the
// next defect. Measured on real MySQL, the text check accepted a literal containing
// a backslash (which enforces nothing) and rejected CASE WHEN, <=> and BINARY forms
// (which all enforce correctly, and would have made up() throw on a sound schema).
//
// So ask the database the actual question instead. Rendering, charset, sql_mode,
// engine and escaping cannot defeat this, because it is the invariant itself.
async function assertPendingSlotEnforces(connection) {
  const [[candidate]] = await connection.query(
    `SELECT s.id AS id FROM suppliers s
      WHERE NOT EXISTS (SELECT 1 FROM supplier_activation_requests r
                         WHERE r.supplier_id = s.id AND r.status = 'pending')
      LIMIT 1`
  );
  // A database with no Supplier cannot be probed, and has no divergent table to
  // probe: on that path this migration created the table a few statements ago.
  if (!candidate) return;
  const supplierId = value(candidate, "id", "ID");

  const insert = (status) => connection.execute(
    `INSERT INTO supplier_activation_requests (supplier_id, supplier_version, summary, requested_at, status)
     VALUES (?, 1, JSON_OBJECT(), ?, ?)`,
    [supplierId, Date.now(), status]
  );
  const duplicate = async (status) => {
    try {
      await insert(status);
      return false;
    } catch (error) {
      if ((error?.cause?.code ?? error?.code) === "ER_DUP_ENTRY") return true;
      throw error;
    }
  };

  await connection.beginTransaction();
  try {
    await insert("pending");
    // Both halves are needed. Without the first, a slot that is never NULL passes;
    // without the second, IF(status = 'pending', 1, 1) passes while it also blocks
    // the decided history the table exists to keep.
    const secondPendingBlocked = await duplicate("pending");
    await insert("approved");
    const secondDecidedBlocked = await duplicate("approved");
    if (!secondPendingBlocked || secondDecidedBlocked) {
      throw new Error(
        "Incompatible existing Supplier activation request table: it does not enforce exactly one pending request " +
        `per Supplier (second pending blocked: ${secondPendingBlocked}, second decided blocked: ${secondDecidedBlocked})`
      );
    }
  } finally {
    await connection.rollback();
  }
}

export async function inspectSupplierActivationRequestSchema(connection) {
  const [columns] = await connection.query(
    `SELECT column_name AS column_name, extra AS extra
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'supplier_activation_requests'
      ORDER BY ordinal_position`
  );
  if (columns.length === 0) return false;
  const actual = columns.map((row) => value(row, "column_name", "COLUMN_NAME"));
  if (actual.length !== COLUMNS.length || COLUMNS.some((name) => !actual.includes(name))) {
    throw new Error("Incompatible existing Supplier activation request schema: supplier_activation_requests");
  }
  // A plain TINYINT named pending_slot would satisfy the name check above while
  // letting the application write the slot freely, so the one-pending guarantee
  // has to be checked as a property of the column, not of the column list.
  const slot = columns.find((row) => value(row, "column_name", "COLUMN_NAME") === "pending_slot");
  if (!String(value(slot, "extra", "EXTRA") ?? "").toUpperCase().includes("GENERATED")) {
    throw new Error("Incompatible existing Supplier activation request column: pending_slot is not a generated column");
  }
  await assertPendingSlotEnforces(connection);

  const [indexes] = await connection.query(
    `SELECT DISTINCT index_name AS index_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'supplier_activation_requests'`
  );
  const actualIndexes = new Set(indexes.map((row) => value(row, "index_name", "INDEX_NAME")));
  for (const name of INDEXES) {
    if (!actualIndexes.has(name)) throw new Error(`Incompatible existing Supplier activation request index: ${name}`);
  }
  // Likewise, a non-unique index of the same name would enforce nothing.
  const [pendingSlotIndex] = await connection.query(
    `SELECT non_unique AS non_unique, column_name AS column_name
       FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'supplier_activation_requests'
        AND index_name = 'uq_supplier_activation_pending'
      ORDER BY seq_in_index`
  );
  const slotColumns = pendingSlotIndex.map((row) => value(row, "column_name", "COLUMN_NAME"));
  const slotUnique = pendingSlotIndex.every((row) => Number(value(row, "non_unique", "NON_UNIQUE")) === 0);
  if (!slotUnique || slotColumns.join(",") !== "supplier_id,pending_slot") {
    throw new Error("Incompatible existing Supplier activation request index: uq_supplier_activation_pending must be UNIQUE (supplier_id, pending_slot)");
  }

  const [foreignKeys] = await connection.query(
    `SELECT constraint_name AS constraint_name
       FROM information_schema.referential_constraints
      WHERE constraint_schema = DATABASE() AND table_name = 'supplier_activation_requests'`
  );
  const actualForeignKeys = new Set(foreignKeys.map((row) => value(row, "constraint_name", "CONSTRAINT_NAME")));
  for (const name of FOREIGN_KEYS) {
    if (!actualForeignKeys.has(name)) throw new Error(`Incompatible existing Supplier activation request FK: ${name}`);
  }
  return true;
}

export async function up(connection) {
  if (await inspectSupplierActivationRequestSchema(connection)) return;
  // pending_slot is the database-level guarantee of at most one pending request per
  // Supplier. The guard compares status to the exact lowercase 'pending'; status is
  // ascii_bin, so any other casing silently frees the slot. Writers must use the
  // literal value, and a later status rename has to move with this expression.
  // MySQL has no partial index, so the slot is NULL for every non-pending
  // row and a UNIQUE index does not compare NULLs — unlimited history, one pending.
  // Same emulation as primary_slot in 0032 and 0033.
  //
  // supplier_id is RESTRICT, not CASCADE: design 5.9 states approval history counts
  // as a reference, so a Supplier that has ever been submitted cannot be hard-deleted.
  await connection.query(`
    CREATE TABLE IF NOT EXISTS supplier_activation_requests (
      id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      supplier_id          BIGINT UNSIGNED NOT NULL,
      requested_by         BIGINT UNSIGNED NULL,
      assigned_approver_id BIGINT UNSIGNED NULL,
      supplier_version     INT UNSIGNED NOT NULL,
      summary              JSON NOT NULL,
      status               VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'pending',
      pending_slot         TINYINT GENERATED ALWAYS AS (IF(status = 'pending', 1, NULL)) STORED,
      request_note         VARCHAR(500) NOT NULL DEFAULT '',
      decision_reason      VARCHAR(500) NOT NULL DEFAULT '',
      requested_at         BIGINT UNSIGNED NOT NULL,
      decided_at           BIGINT UNSIGNED NULL,
      decided_by           BIGINT UNSIGNED NULL,
      version              INT UNSIGNED NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_supplier_activation_pending (supplier_id, pending_slot),
      KEY idx_supplier_activation_approver (assigned_approver_id, status, requested_at),
      KEY idx_supplier_activation_supplier (supplier_id, requested_at),
      CONSTRAINT fk_supplier_activation_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE RESTRICT,
      CONSTRAINT fk_supplier_activation_requested_by FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_supplier_activation_approver FOREIGN KEY (assigned_approver_id) REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_supplier_activation_decided_by FOREIGN KEY (decided_by) REFERENCES users (id) ON DELETE SET NULL
    )
  `);
  await inspectSupplierActivationRequestSchema(connection);
}
