/**
 * Item Management 的變更紀錄——append-only，寫入 `item_audit_logs`（不是
 * `user_audit_logs`；分表理由見 0024_create_item_audit_logs.js 的開頭說明）。
 * 設計說明見 docs/items_management/design_spec.md §5.12、§8.7。
 *
 * 目前只提供 `record()`。查詢 API（`GET /api/v1/item-audit/logs` 與對應的
 * `list()`）留到 T11 一起做——那時才會有 handler／schema／頁面一起接上，現在
 * 提前做一個沒有呼叫端的查詢方法只是沒人用得到的程式碼。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——與 AuditLogService
 * 同一個理由：它只是被 ItemCatalogService／ItemAdminService 等模組直接
 * `new` 出來使用的協作物件，不需要框架的生命週期管理。
 */

// detail 序列化後的長度上限，跟 AuditLogService 同一個值：稽核記錄不該因為
// 某次塞了一個巨大的 payload 而讓整個交易失敗，超過就截成一個
// {"truncated":true} 的摘要。
const MAX_DETAIL_BYTES = 4096;

export class ItemAuditLogService {
  constructor({ database, logger, time } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("ItemAuditLogService requires database, logger and time");
    }

    this.database = database;
    this.logger = logger;
    this.time = time;
  }

  /**
   * 寫一列稽核記錄。
   *
   * `connection` 是呼叫端已經開好的交易（`withTransaction` 給的那個物件），
   * 不是自己拿一條——分開兩個交易的話，變更成功而稽核失敗會留下一筆查不到
   * 來源的改動，那正是稽核要防的事（design_spec.md §2.5）。
   *
   * 密碼、雜湊、token、Authorization header、檔案內容、整份 CSV 永遠不該出現
   * 在 detail 裡；呼叫端負責不把那些塞進來，這裡不做內容過濾——過濾規則會漏，
   * 不放進去才不會漏。
   */
  async record(connection, {
    actorUserId,
    actorUsername,
    action,
    targetType,
    targetId,
    targetLabel,
    reason = "",
    detail = null,
    requestId = "",
    ip = ""
  }) {
    const nowMs = this.time.nowMs();
    const serializedDetailValue = this.#truncatedDetail(detail, action);

    await connection.execute(
      `INSERT INTO item_audit_logs
         (occurred_at, actor_user_id, actor_username, action, target_type,
          target_id, target_label, reason, detail, request_id, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nowMs,
        actorUserId === null || actorUserId === undefined ? null : Number(actorUserId),
        String(actorUsername ?? ""),
        String(action),
        String(targetType),
        targetId === null || targetId === undefined ? null : Number(targetId),
        String(targetLabel ?? ""),
        String(reason ?? ""),
        serializedDetailValue,
        String(requestId ?? ""),
        String(ip ?? "")
      ]
    );
  }

  /**
   * 序列化 detail 並套用 4KB 上限。null 保持 null（沒有可記的變更前後值）。
   */
  #truncatedDetail(detail, action) {
    if (detail === null || detail === undefined) {
      return null;
    }

    const serialized = JSON.stringify(detail);

    if (Buffer.byteLength(serialized, "utf8") <= MAX_DETAIL_BYTES) {
      return serialized;
    }

    void this.logger.warn(
      "item.audit_detail_truncated",
      "An item audit log detail payload exceeded the size cap and was truncated",
      { action, bytes: Buffer.byteLength(serialized, "utf8") }
    );

    return JSON.stringify({ truncated: true });
  }
}
