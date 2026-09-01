/**
 * 用戶與角色管理的變更紀錄。設計說明見 docs/user-management.md §2.2、§3.2。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——與 UserService 同一個
 * 理由（見那個檔案開頭的說明）。
 */

// detail 序列化後的長度上限。稽核記錄不該因為某次塞了一個巨大的 payload而
// 讓整個交易失敗，超過就截成一個 {"truncated":true} 的摘要。
const MAX_DETAIL_BYTES = 4096;

export class AuditLogService {
  constructor({ database, logger, time } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("AuditLogService requires database, logger and time");
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
   * 來源的改動，那正是稽核要防的事。
   *
   * 密碼、雜湊、token、Authorization header 永遠不該出現在 detail 裡；呼叫端
   * 負責不把那些塞進來，這裡不做內容過濾——過濾規則會漏，不放進去才不會漏。
   */
  async record(connection, {
    actorUserId,
    actorUsername,
    action,
    targetType,
    targetId,
    targetLabel,
    reason = "",
    detail = null
  }) {
    const nowMs = this.time.nowMs();
    const serializedDetailValue = this.#truncatedDetail(detail, action);

    await connection.execute(
      `INSERT INTO user_audit_logs
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
        "",
        ""
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
      "audit.detail_truncated",
      "An audit log detail payload exceeded the size cap and was truncated",
      { action, bytes: Buffer.byteLength(serialized, "utf8") }
    );

    return JSON.stringify({ truncated: true });
  }
}
