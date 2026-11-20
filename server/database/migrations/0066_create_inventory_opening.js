export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_control (
      id TINYINT UNSIGNED NOT NULL,
      lifecycle_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      go_live_at BIGINT UNSIGNED NULL,
      go_live_by BIGINT UNSIGNED NULL,
      go_live_reason VARCHAR(500) NOT NULL DEFAULT '',
      PRIMARY KEY (id),
      CONSTRAINT chk_inventory_control_singleton CHECK (id = 1),
      CONSTRAINT chk_inventory_control_state CHECK (
        (lifecycle_status = 'PRE_GO_LIVE' AND go_live_at IS NULL)
        OR (lifecycle_status = 'LIVE' AND go_live_at IS NOT NULL)
      ),
      CONSTRAINT fk_inventory_control_go_live_actor FOREIGN KEY (go_live_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_opening_jobs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      template_version VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'v1',
      source_file_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_file_size INT UNSIGNED NOT NULL,
      precheck_snapshot_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
      ready_rows INT UNSIGNED NOT NULL,
      diagnostics JSON NOT NULL,
      version INT UNSIGNED NOT NULL DEFAULT 1,
      created_at BIGINT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NULL,
      completed_at BIGINT UNSIGNED NULL,
      confirm_operation_id BIGINT UNSIGNED NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_inventory_opening_confirm_operation (confirm_operation_id),
      CONSTRAINT chk_inventory_opening_job_state CHECK (status IN ('INVALID', 'READY', 'COMPLETED', 'CANCELLED')),
      CONSTRAINT chk_inventory_opening_ready CHECK (
        (status = 'INVALID' AND ready_rows = 0 AND precheck_snapshot_hash IS NULL)
        OR (status <> 'INVALID' AND ready_rows > 0 AND precheck_snapshot_hash IS NOT NULL)
      ),
      CONSTRAINT chk_inventory_opening_completion CHECK (
        (status = 'COMPLETED' AND completed_at IS NOT NULL AND confirm_operation_id IS NOT NULL)
        OR (status <> 'COMPLETED' AND completed_at IS NULL AND confirm_operation_id IS NULL)
      ),
      CONSTRAINT fk_inventory_opening_actor FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
      CONSTRAINT fk_inventory_opening_operation FOREIGN KEY (confirm_operation_id)
        REFERENCES inventory_operation_requests(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS inventory_opening_rows (
      job_id BIGINT UNSIGNED NOT NULL,
      csv_row_number INT UNSIGNED NOT NULL,
      normalized_input JSON NOT NULL,
      movement_id BIGINT UNSIGNED NULL,
      PRIMARY KEY (job_id, csv_row_number),
      UNIQUE KEY uq_inventory_opening_movement (movement_id),
      CONSTRAINT fk_inventory_opening_row_job FOREIGN KEY (job_id) REFERENCES inventory_opening_jobs(id) ON DELETE RESTRICT,
      CONSTRAINT fk_inventory_opening_row_movement FOREIGN KEY (movement_id)
        REFERENCES inventory_movements(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await connection.query(`
    INSERT INTO inventory_control (id, lifecycle_status) VALUES (1, 'PRE_GO_LIVE')
    ON DUPLICATE KEY UPDATE id = id
  `);
}
