// CSV 匯入工作（Phase 3）。設計說明見
// docs/items_management/design_spec.md §5.13。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。呢張表只記工作狀態同統計，真正嘅逐列結果喺 item_import_rows
// （0026）。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_import_jobs (
      id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      -- 伺服器生成，不含路徑；同 item_media.stored_name 同一套慣例，落盤
      -- 路徑由 import 模組依呢個名喺受控 root 下解析。
      file_stored_name     VARCHAR(190)    NOT NULL,
      -- 預檢／執行結果 CSV；未產生時 NULL。UNIQUE key 對 NULL 唔生效，一個
      -- job 冇結果檔完全合法（uploaded／validating 階段）。
      result_stored_name   VARCHAR(190)    NULL,
      file_sha256          CHAR(64)        NOT NULL,
      template_version     VARCHAR(20)     NOT NULL,
      -- create_only | upsert。
      mode                 VARCHAR(20)     NOT NULL,
      -- uploaded | validating | invalid | ready | queued | running |
      -- completed | failed | cancelled。冇用 ENUM，理由同其他狀態欄一致：
      -- 加一種狀態唔使改表結構，合法值同轉換規則由 service 驗證。
      status               VARCHAR(20)     NOT NULL DEFAULT 'uploaded',
      total_count          INT UNSIGNED    NOT NULL DEFAULT 0,
      success_count        INT UNSIGNED    NOT NULL DEFAULT 0,
      failure_count        INT UNSIGNED    NOT NULL DEFAULT 0,
      skipped_count        INT UNSIGNED    NOT NULL DEFAULT 0,
      warning_count        INT UNSIGNED    NOT NULL DEFAULT 0,
      -- 已經清理過嘅 job 層級錯誤訊息，唔含 stack／SQL——同 item_media 嘅
      -- error_summary 一樣，落 DB 之前先喺 service 層過濾。
      error_summary        VARCHAR(1000)   NULL,
      -- 執行緊嘅 worker instance ID，同到期時間——跟 scheduler 框架既有嘅
      -- cluster lease 機制（fr_scheduler_leases）同一套慨念，呢度係 import
      -- 專屬 job 自己嘅 lease，唔係借用嗰張表。
      lease_owner          VARCHAR(100)    NULL,
      lease_until          BIGINT UNSIGNED NULL,
      created_by           BIGINT UNSIGNED NULL,
      confirmed_by         BIGINT UNSIGNED NULL,
      created_at           BIGINT UNSIGNED NOT NULL,
      updated_at           BIGINT UNSIGNED NOT NULL,
      confirmed_at         BIGINT UNSIGNED NULL,
      completed_at         BIGINT UNSIGNED NULL,
      -- 原始檔／結果檔依 1 年期限完成清理嘅時間；唔代表 Job summary 被刪
      -- （summary 依 DEC-023 保留 7 年）。
      files_purged_at      BIGINT UNSIGNED NULL,
      version              INT UNSIGNED    NOT NULL DEFAULT 1,
      PRIMARY KEY (id),
      UNIQUE KEY uq_item_import_jobs_file_stored_name (file_stored_name),
      UNIQUE KEY uq_item_import_jobs_result_stored_name (result_stored_name),
      -- 依狀態查詢／排序嘅主要查詢形狀（列表、worker 揀下一個 job）。
      KEY idx_item_import_jobs_status_created (status, created_at),
      -- Worker 掃過期 lease 用。
      KEY idx_item_import_jobs_lease_until (lease_until),
      KEY idx_item_import_jobs_created_by (created_by, created_at),
      CONSTRAINT fk_item_import_jobs_created_by FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL,
      CONSTRAINT fk_item_import_jobs_confirmed_by FOREIGN KEY (confirmed_by)
        REFERENCES users (id) ON DELETE SET NULL
    )
  `);
}
