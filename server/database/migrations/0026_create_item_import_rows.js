// CSV 匯入嘅逐列結果（Phase 3）。設計說明見
// docs/items_management/design_spec.md §5.13。
//
// 純新增，不動任何既有表。一句 DDL，CREATE TABLE IF NOT EXISTS，重跑本身就是
// 安全的。

export async function up(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS item_import_rows (
      job_id                BIGINT UNSIGNED NOT NULL,
      -- CSV 第幾行（1-based data row，唔計 header），同 job_id 組成 PK。
      \`row_number\`          INT UNSIGNED    NOT NULL,
      -- create | update | skip。
      operation             VARCHAR(20)     NOT NULL,
      -- Update 用嚟配對嘅穩定 ID。刻意冇 FK：呢個是 design_spec 明確要求嘅
      -- 決定——歷史匯入結果唔應該因為對應嘅 Draft SKU 之後被永久刪除（見
      -- item_skus 嘅 delete 語意）就跟住憑空消失，同 item_import_rows 本身
      -- 就係一份「當時發生過咩事」嘅記錄呢個定位一致。
      match_sku_id          BIGINT UNSIGNED NULL,
      -- 執行時用嚟防止：預檢之後、確認執行之前，呢粒 SKU 被第三者搶先改咗。
      expected_sku_version  INT UNSIGNED    NULL,
      -- 已經白名單化、大小受限嘅正規化命令，唔保存任意未知欄。
      normalized_payload    JSON            NOT NULL,
      -- valid | warning | invalid | applied | skipped | failed。
      status                VARCHAR(20)     NOT NULL,
      -- {field,code,message} 陣列；每列數量及字數上限由 service 驗證。
      errors                JSON            NULL,
      warnings              JSON            NULL,
      created_at            BIGINT UNSIGNED NOT NULL,
      updated_at            BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY (job_id, \`row_number\`),
      KEY idx_item_import_rows_job_status (job_id, status),
      -- CASCADE：row 純粹是它所屬 job 嘅從屬資料，job 被刪除時一併消失
      -- （job 本身依 DEC-023 保留 7 年，唔會被隨便刪）。
      CONSTRAINT fk_item_import_rows_job FOREIGN KEY (job_id)
        REFERENCES item_import_jobs (id) ON DELETE CASCADE
    )
  `);
}
