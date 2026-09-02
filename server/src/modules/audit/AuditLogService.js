import { assertActorFresh } from "../authorization/directoryLookups.js";

/**
 * 用戶與角色管理的變更紀錄。設計說明見 docs/user-management.md §2.2、§3.2、§3.3、§4.6。
 *
 * 業務模組，不進 service container，依賴由呼叫端傳入——與 UserService 同一個
 * 理由（見那個檔案開頭的說明）。
 */

// detail 序列化後的長度上限。稽核記錄不該因為某次塞了一個巨大的 payload而
// 讓整個交易失敗，超過就截成一個 {"truncated":true} 的摘要。
const MAX_DETAIL_BYTES = 4096;

/** `%`、`_`、`\` 是 LIKE 的萬用字元／跳脫字元，使用者輸入的字面值要先跳脫。
 * 與 UserAdminService 那份是同一個三行函式——這種規模的純函式重複一份，比
 * 為了它另開一個共用檔案划算（見 §3.2 對「多吃一個依賴」的判斷）。 */
function escapeLikeTerm(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

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
   * 分頁查詢稽核記錄，固定照 occurred_at DESC 排（§3.3：這是唯讀清單，接受
   * offset 分頁「翻頁期間新記錄把後面內容往後推」那個已知的取捨，不做
   * cursor 分頁）。跟 UserAdminService.list()／RoleAdminService.list() 一樣，
   * 屬於「管理類端點」，開頭一樣重讀操作者現在的權限（§1.4 第四道）。
   */
  async list({
    actorId,
    claimedRoles,
    claimedPermissions,
    page = 1,
    pageSize = 20,
    from,
    to,
    actor = "",
    target = "",
    action
  }) {
    await assertActorFresh(this.database, { actorId, claimedRoles, claimedPermissions });

    const conditions = [];
    const params = [];

    if (from !== undefined) {
      conditions.push("occurred_at >= ?");
      params.push(from);
    }

    if (to !== undefined) {
      conditions.push("occurred_at <= ?");
      params.push(to);
    }

    const actorTerm = String(actor ?? "").trim();
    if (actorTerm) {
      conditions.push("actor_username LIKE ?");
      params.push(`%${escapeLikeTerm(actorTerm)}%`);
    }

    const targetTerm = String(target ?? "").trim();
    if (targetTerm) {
      conditions.push("target_label LIKE ?");
      params.push(`%${escapeLikeTerm(targetTerm)}%`);
    }

    if (action) {
      conditions.push("action = ?");
      params.push(action);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const offset = (page - 1) * pageSize;

    const [totalRows] = await this.database.query(
      `SELECT COUNT(*) AS total FROM user_audit_logs ${whereClause}`,
      params
    );
    const [rows] = await this.database.query(
      `SELECT id, occurred_at, actor_user_id, actor_username, action, target_type,
              target_id, target_label, reason, detail
         FROM user_audit_logs ${whereClause}
        ORDER BY occurred_at DESC, id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    return {
      items: rows.map((row) => this.#toEntry(row)),
      total: Number(totalRows[0].total),
      page,
      pageSize
    };
  }

  #toEntry(row) {
    return {
      id: Number(row.id),
      occurredAt: Number(row.occurred_at),
      actorUserId: row.actor_user_id === null ? null : Number(row.actor_user_id),
      actorUsername: row.actor_username,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id === null ? null : Number(row.target_id),
      targetLabel: row.target_label,
      reason: row.reason,
      // mysql2 型別轉換器對 JSON 欄位會自己 parse 成物件，所以這裡讀到的
      // row.detail 已經是物件（或 null），不是字串——JSON.parse 一個物件會
      // 先被隱式轉成 "[object Object]" 字串再炸開，見 record() 反方向的
      // JSON.stringify，寫入與讀出的型別轉換各自由驅動與這裡各管一半。
      detail: row.detail ?? null
    };
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
