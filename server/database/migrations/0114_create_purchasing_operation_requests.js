// Purchasing domain operation（設計 §4.14；TASK-012；HD-014）：跨 HTTP idempotency TTL 嘅永久冪等正本，保留 7 年。
//
// UNIQUE(source_document_type, source_document_id, source_line_id, event_id) 係冪等核心；command_type 只入 hash，
// 同一 event 換 command 都唔會有第二個效果。同設計原文嘅分別（Sam 2026-11-02 批准）：trigger 拒絕 DELETE、
// 識別欄位一律唔准改、結果只可以由未完成寫入一次——事後改 hash 或結果，重送就會攞返被改過嘅結果。
// 代碼欄用 ascii_bin，CHECK 分大小寫；event_id 同 purchasingValidation.eventId() 一樣只收小寫。
//
// 純新增。Trigger 喺 binlog 開咗嘅 server 要 migration 帳號先建得到（CI 用 root migrate）；已存在就驗證定義，
// 唔同就停，唔會靜靜跳過。

const normalize = (sql) => String(sql).replace(/[`\s]/gu, "").toLowerCase();

/** 冇就建；有就要逐字（忽略空白同 backtick）一樣，否則當 schema drift 停低。 */
export async function ensureTriggers(connection, table, triggers) {
  const [rows] = await connection.query(
    `SELECT trigger_name AS name, event_manipulation AS event, action_timing AS timing, action_statement AS statement
       FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND event_object_table = ?`, [table]);
  const found = new Map(rows.map((row) => [row.name, row]));
  for (const [name, [event, body]] of Object.entries(triggers)) {
    const existing = found.get(name);
    if (existing) {
      if (existing.event !== event || existing.timing !== "BEFORE" || normalize(existing.statement) !== normalize(body)) {
        throw new Error(`Incompatible existing Purchasing trigger: ${name}`);
      }
      continue;
    }
    await connection.query(`CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW ${body}`);
  }
}

const IDENTITY = ["id", "command_type", "source_document_type", "source_document_id", "source_line_id", "event_id",
  "request_hash", "actor_user_id", "actor_label", "request_id", "correlation_id", "created_at"];
const RESULT = ["result_type", "result_id", "result_summary", "completed_at"];
const same = (columns) => columns.map((column) => `NEW.${column} <=> OLD.${column}`).join(" AND ");

export const OPERATION_TRIGGERS = Object.freeze({
  trg_purchasing_operation_update: ["UPDATE", `BEGIN
    IF NOT (${same(IDENTITY)}) OR (OLD.completed_at IS NOT NULL AND NOT (${same(RESULT)})) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchasing operation identity and outcome are immutable';
    END IF;
  END`],
  trg_purchasing_operation_delete: ["DELETE",
    "SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Purchasing operation retention is required'"]
});

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS purchasing_operation_requests (
      id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      command_type         VARCHAR(60)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_document_type VARCHAR(40)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_document_id   VARCHAR(100)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      source_line_id       VARCHAR(100)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT '',
      event_id             CHAR(36)        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash         CHAR(64)        CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      result_type          VARCHAR(40)     CHARACTER SET ascii COLLATE ascii_bin NULL,
      result_id            VARCHAR(100)    CHARACTER SET ascii COLLATE ascii_bin NULL,
      result_summary       JSON            NULL,
      completed_at         BIGINT UNSIGNED NULL,
      actor_user_id        BIGINT UNSIGNED NULL,
      actor_label          VARCHAR(190)    NOT NULL,
      request_id           VARCHAR(64)     NOT NULL DEFAULT '',
      correlation_id       VARCHAR(64)     NOT NULL DEFAULT '',
      created_at           BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY uq_purchasing_operation_event (source_document_type, source_document_id, source_line_id, event_id),
      KEY idx_purchasing_operation_event (event_id, id),
      KEY idx_purchasing_operation_document (source_document_type, source_document_id, id),
      CONSTRAINT chk_purchasing_operation_source CHECK (source_document_type IN ('PURCHASE_ORDER', 'GOODS_RECEIPT', 'SETTING', 'REVERSAL')),
      CONSTRAINT chk_purchasing_operation_event CHECK (event_id REGEXP '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
      CONSTRAINT chk_purchasing_operation_hash CHECK (request_hash REGEXP '^[0-9a-f]{64}$'),
      CONSTRAINT chk_purchasing_operation_result CHECK ((completed_at IS NULL AND result_type IS NULL AND result_id IS NULL
        AND result_summary IS NULL) OR (completed_at IS NOT NULL AND result_type IS NOT NULL)),
      CONSTRAINT chk_purchasing_operation_summary CHECK (result_summary IS NULL
        OR LENGTH(CAST(result_summary AS CHAR CHARSET utf8mb4)) <= 8192),
      CONSTRAINT fk_purchasing_operation_actor FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await ensureTriggers(connection, "purchasing_operation_requests", OPERATION_TRIGGERS);
}
