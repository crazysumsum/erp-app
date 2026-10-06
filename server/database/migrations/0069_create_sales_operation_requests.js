import { inspectSalesFoundationTable } from "./0068_create_sales_document_sequences.js";

const COLUMNS = Object.freeze({
  id: ["bigint unsigned", "NO", null, null, "auto_increment"],
  event_id: ["char(36)", "NO", null, "ascii_bin"],
  command_type: ["varchar(50)", "NO", null, "ascii_bin"],
  target_type: ["varchar(30)", "NO", null, "ascii_bin"],
  target_id: ["bigint unsigned", "YES", null],
  request_hash: ["char(64)", "NO", null, "ascii_bin"],
  recovery_payload: ["json", "YES", null],
  status: ["varchar(20)", "NO", null, "ascii_bin"],
  result_type: ["varchar(30)", "NO", "", "ascii_bin"],
  result_id: ["bigint unsigned", "YES", null],
  result_summary: ["json", "YES", null],
  error_code: ["varchar(80)", "NO", "", "ascii_bin"],
  lease_owner: ["char(36)", "YES", null, "ascii_bin"],
  lease_until: ["bigint unsigned", "YES", null],
  actor_user_id: ["bigint unsigned", "YES", null],
  actor_label: ["varchar(190)", "NO", null, "utf8mb4_unicode_ci"],
  request_id: ["varchar(64)", "NO", "", "ascii_bin"],
  correlation_id: ["varchar(64)", "NO", "", "ascii_bin"],
  created_at: ["bigint unsigned", "NO", null],
  updated_at: ["bigint unsigned", "NO", null],
  completed_at: ["bigint unsigned", "YES", null]
});
const INDEXES = { PRIMARY: [0, "id"], uq_sales_operation_event: [0, "event_id"],
  idx_sales_operations_lease: [1, "status,lease_until,id"],
  idx_sales_operations_target: [1, "target_type,target_id,created_at,id"] };

export function inspectSalesOperationSchema(connection, { table = "sales_operation_requests" } = {}) {
  return inspectSalesFoundationTable(connection, { table, columns: COLUMNS, indexes: INDEXES, actor: true });
}

export async function up(connection) {
  if (await inspectSalesOperationSchema(connection)) return;
  await connection.query(`CREATE TABLE IF NOT EXISTS sales_operation_requests (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    command_type VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    target_type VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    target_id BIGINT UNSIGNED NULL,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    recovery_payload JSON NULL,
    status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    result_type VARCHAR(30) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
    result_id BIGINT UNSIGNED NULL,
    result_summary JSON NULL,
    error_code VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
    lease_owner CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    lease_until BIGINT UNSIGNED NULL,
    actor_user_id BIGINT UNSIGNED NULL,
    actor_label VARCHAR(190) NOT NULL,
    request_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
    correlation_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
    created_at BIGINT UNSIGNED NOT NULL,
    updated_at BIGINT UNSIGNED NOT NULL,
    completed_at BIGINT UNSIGNED NULL,
    PRIMARY KEY (id), UNIQUE KEY uq_sales_operation_event (event_id),
    KEY idx_sales_operations_lease (status, lease_until, id),
    KEY idx_sales_operations_target (target_type, target_id, created_at, id),
    CONSTRAINT fk_sales_operation_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  if (!await inspectSalesOperationSchema(connection)) throw new Error("Sales operation schema was not created");
}
