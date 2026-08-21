import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { BaseService } from "../../framework/services/BaseService.js";
import { describeMissingTable } from "../mysqldatabase/missingTableError.js";
import { normalizeDeviceBindingConfig } from "./normalizeDeviceBindingConfig.js";

const DEVICES_TABLE = "user_devices";
const NONCES_TABLE = "user_device_nonces";
const MIGRATE_HINT = "npm run migrate";

// OpenSSL 用自己一套曲線名，跟 Web Crypto／JOSE 那套對不上。少了這張表，
// 曲線檢查會對每一把合法的 P-256 公鑰都判成不符。
const CURVE_OPENSSL_NAMES = Object.freeze({
  "P-256": "prime256v1",
  "P-384": "secp384r1",
  "P-521": "secp521r1"
});

export const DEVICE_STATUS = Object.freeze({
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  revoked: "revoked"
});

/**
 * 設備綁定：驗證請求確實由某一台已綁定的設備發出，並管理綁定的生命週期。
 * 設計說明見 docs/device-binding-auth.md。
 *
 * 存在的理由是 JWT 續期需要一個「證明這還是同一個人」的憑證。如果那個憑證就是
 * JWT 自己，被偷走的 JWT 就能自己無限續期下去；改用設備私鑰簽名之後，偷到 JWT
 * 也續不了期。設備綁定因此不只是額外的安全功能，它是續期機制能夠成立的前提。
 *
 * 這個 service 只提供能力，不決定政策：什麼時候要求簽章、拒絕之後回什麼狀態碼，
 * 都屬於 handler。
 */
export class DeviceBindingService extends BaseService {
  static service = Object.freeze({
    name: "deviceBinding",
    lifecycle: "singleton",
    dependencies: ["mysqldatabase", "logging", "time"],
    eager: true
  });

  #config;

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.#config = normalizeDeviceBindingConfig(config?.deviceBinding);
    this.database = services.require("mysqldatabase");
    this.logger = services.require("logging").logger;
    this.time = services.require("time");
  }

  /**
   * 公鑰的 device id：SPKI DER 的 SHA-256（hex）。
   *
   * device id 由公鑰導出而不是由前端自選一個隨機數：自選 ID 多一個可偽造的
   * 輸入卻換不到任何好處，而 thumbprint 是自證的——只有持有對應私鑰的人用得了
   * 這個 ID，不可能偽造，也不可能與別人碰撞。
   */
  deviceIdFor(publicKeyDer) {
    return createHash("sha256").update(publicKeyDer).digest("hex");
  }

  /**
   * 把請求正規化成待簽的字串。前端必須逐字元產生同一份，否則驗簽必定失敗。
   *
   * method、path、bodyHash 都要進去：少了它們，簽章只證明「這台設備某個時候
   * 簽過東西」，不證明「這個請求來自這台設備」，攻擊者可以把一個簽章搬到另一個
   * 請求上。
   *
   * 鍵照字典序排列，且這裡是唯一決定順序的地方——JS 物件實字的字串鍵維持插入
   * 順序，所以照字母寫下來就是照字母輸出。
   */
  signingInput({ accessTokenHash, bodyHash, deviceId, method, nonce, path, timestamp }) {
    return JSON.stringify({
      // 這份簽章綁死在哪一個 access token 上。RFC 9449（DPoP）的 `ath` 就是
      // 同一件事，理由也一樣：少了它，簽章只證明「這台設備簽了一個往這個路徑
      // 的請求」，不證明「這台設備簽的是**配這個 token** 的那個請求」。攻擊者
      // 只要拿得到一份已簽名的續期請求（MITM、或含 header 的存取紀錄），就能
      // 換上同一台設備的另一枚 token 送出去。
      //
      // 沒有 token 的請求（登入）是空字串，與 bodyHash 的慣例一致。
      accessTokenHash: String(accessTokenHash ?? ""),
      bodyHash: String(bodyHash ?? ""),
      deviceId: String(deviceId ?? ""),
      method: String(method ?? "").toUpperCase(),
      nonce: String(nonce ?? ""),
      path: String(path ?? ""),
      timestamp: Number(timestamp)
    });
  }

  /** 請求 body 原始 bytes 的 SHA-256（base64url）。沒有 body 時是空字串。 */
  bodyHash(rawBody) {
    if (rawBody === undefined || rawBody === null || rawBody.length === 0) {
      return "";
    }

    return createHash("sha256").update(rawBody).digest("base64url");
  }

  /**
   * Bearer token 的 SHA-256（base64url）。沒有 token 時是空字串。
   *
   * 雜湊而不是把 token 本身放進簽章輸入：簽章輸入會進日誌與錯誤路徑，而 token
   * 是憑證。RFC 9449 的 `ath` 也是同一個做法。
   */
  accessTokenHash(token) {
    if (!token) {
      return "";
    }

    return createHash("sha256").update(String(token)).digest("base64url");
  }

  /**
   * 把 SPKI DER 轉成公鑰物件，並確認它真的是設定允許的那種金鑰。
   *
   * 少了型別與曲線檢查，任何人都能提交一把 RSA 金鑰或一條弱曲線上的金鑰來註冊
   * 設備——驗簽仍然會過，因為那是他自己的金鑰，但整個方案對「金鑰有多強」就
   * 失去了控制。
   */
  publicKeyFrom(publicKeyDer) {
    let key;

    try {
      key = createPublicKey({ key: publicKeyDer, format: "der", type: "spki" });
    } catch (error) {
      throw new TypeError(`Device public key is not a valid SPKI DER key: ${error.message}`);
    }

    if (key.asymmetricKeyType !== "ec") {
      throw new TypeError(
        `Device public key must be an EC key, got ${key.asymmetricKeyType}`
      );
    }

    const expected = CURVE_OPENSSL_NAMES[this.#config.namedCurve];
    const actual = key.asymmetricKeyDetails?.namedCurve;

    if (actual !== expected) {
      throw new TypeError(
        `Device public key must be on curve ${this.#config.namedCurve} (${expected}), got ${actual}`
      );
    }

    return key;
  }

  /**
   * 驗證一份設備簽章。回傳 { ok: true } 或 { ok: false, reason }。
   *
   * 失敗原因只回給呼叫端記進日誌，不該原樣送到客戶端——「時鐘不同步」與「簽章
   * 不對」的差別會告訴攻擊者他離成功還差多遠。
   *
   * 順序是刻意的：時間 → 簽章 → nonce。
   *
   * nonce 排在最後，因為消耗 nonce 是一次資料庫寫入。放在前面的話，任何人都能
   * 用一堆沒有簽章的垃圾請求往 nonce 表灌資料；放在簽章之後，只有已經證明自己
   * 握有私鑰的請求才碰得到資料庫。ECDSA 驗簽只花幾十微秒，先做不虧。
   */
  async verifyRequest({
    publicKeyDer,
    accessTokenHash,
    deviceId,
    method,
    path,
    bodyHash,
    timestamp,
    nonce,
    signature
  }) {
    const timestampMs = Number(timestamp);

    if (!Number.isFinite(timestampMs)) {
      return { ok: false, reason: "timestamp_invalid" };
    }

    const skewMs = Math.abs(this.time.nowMs() - timestampMs);

    if (skewMs > this.#config.signatureMaxSkewSeconds * 1000) {
      return { ok: false, reason: "timestamp_stale" };
    }

    if (typeof nonce !== "string" || nonce.trim() === "") {
      return { ok: false, reason: "nonce_missing" };
    }

    let key;

    try {
      key = this.publicKeyFrom(publicKeyDer);
    } catch (error) {
      return { ok: false, reason: "public_key_invalid", detail: error.message };
    }

    const input = Buffer.from(
      this.signingInput({
        accessTokenHash,
        bodyHash,
        deviceId,
        method,
        nonce,
        path,
        timestamp: timestampMs
      })
    );

    let signatureValid = false;

    try {
      signatureValid = verifySignature(
        this.#config.hashAlgorithm,
        input,
        // Web Crypto 的 ECDSA 簽章是 IEEE P1363（r||s 直接接起來，P-256 是
        // 64 bytes），而 Node 對 EC 預設吃 DER。不指定 dsaEncoding 的話，每一份
        // 由瀏覽器產生的合法簽章都會被判成無效，而錯誤訊息不會提到格式。
        { key, dsaEncoding: "ieee-p1363" },
        signature
      );
    } catch {
      // 簽章長度不對之類的畸形輸入會讓 verify 直接拋，那與「簽章不符」是同一個
      // 結論，不需要分開。
      return { ok: false, reason: "signature_invalid" };
    }

    if (!signatureValid) {
      return { ok: false, reason: "signature_invalid" };
    }

    if (!(await this.#consumeNonce(nonce, timestampMs))) {
      return { ok: false, reason: "nonce_replayed" };
    }

    return { ok: true };
  }

  /**
   * 記下一個 nonce。回傳 false 代表它用過了——也就是一次重放。
   */
  async #consumeNonce(nonce, timestampMs) {
    const expiresAt = timestampMs + this.#config.nonceRetentionSeconds * 1000;

    try {
      await this.database.execute(
        `INSERT INTO ${NONCES_TABLE} (nonce, expires_at) VALUES (?, ?)`,
        [nonce, expiresAt]
      );
    } catch (error) {
      if ((error?.cause?.code || error?.code) === "ER_DUP_ENTRY") {
        return false;
      }

      throw describeMissingTable(error, { table: NONCES_TABLE, sqlFile: MIGRATE_HINT });
    }

    return true;
  }

  /** 查一個使用者在某台設備上的綁定。沒有回傳 null。 */
  async findBinding(userId, deviceId) {
    let rows;

    try {
      [rows] = await this.database.query(
        `SELECT id, user_id, device_id, public_key, label, status,
                requested_at, reviewed_at, last_used_at
         FROM ${DEVICES_TABLE}
         WHERE user_id = ? AND device_id = ?`,
        [Number(userId), String(deviceId)]
      );
    } catch (error) {
      throw describeMissingTable(error, { table: DEVICES_TABLE, sqlFile: MIGRATE_HINT });
    }

    return rows.length === 0 ? null : rows[0];
  }

  /**
   * 建立一筆待審批的綁定申請。已經有一筆就原樣回傳，不重複建立也不覆蓋。
   *
   * 呼叫端必須先驗證過帳號密碼。少了那一步，任何人都能對任意帳號灌爆審批佇列，
   * 而且回應本身就會洩漏帳號存不存在。
   */
  async requestBinding({ userId, deviceId, publicKeyDer, label, ip, userAgent }) {
    const existing = await this.findBinding(userId, deviceId);

    if (existing) {
      return existing;
    }

    await this.database.execute(
      `INSERT INTO ${DEVICES_TABLE}
         (user_id, device_id, public_key, label, status, requested_at, requested_ip, requested_ua)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Number(userId),
        String(deviceId),
        publicKeyDer,
        String(label ?? "").slice(0, 190),
        DEVICE_STATUS.pending,
        this.time.nowMs(),
        String(ip ?? "").slice(0, 45),
        String(userAgent ?? "").slice(0, 255)
      ]
    );

    await this.logger.info(
      "auth.device.binding_requested",
      "A device binding was requested and is awaiting approval",
      { userId: Number(userId), deviceId: String(deviceId) }
    );

    return this.findBinding(userId, deviceId);
  }

  /**
   * 狀態轉移。回傳轉移後的那一列，或 null 代表什麼都沒發生。
   *
   * UPDATE 的條件帶著來源狀態，所以整個「檢查現況再改」是一句原子的 SQL——
   * 分成先 SELECT 再 UPDATE 的話，兩個審批者同時按下核准與拒絕，兩句都會成功，
   * 最後的狀態取決於誰先寫入，而兩個人都會看到「操作成功」。
   *
   * reviewed_at 一定要寫：清理工作的第二條規則（已核准但從未使用）靠它判斷年齡，
   * 而第三條規則看的是 last_used_at。兩欄都是 NULL 的列會同時逃過兩條規則，
   * 變成永遠清不掉的孤兒。
   */
  async #transition(bindingId, { from, to, reviewerId, note, event, message }) {
    const [result] = await this.database.execute(
      `UPDATE ${DEVICES_TABLE}
       SET status = ?, reviewed_at = ?, reviewed_by = ?, review_note = ?
       WHERE id = ? AND status = ?`,
      [
        to,
        this.time.nowMs(),
        reviewerId === null || reviewerId === undefined ? null : Number(reviewerId),
        String(note ?? "").slice(0, 190),
        Number(bindingId),
        from
      ]
    );

    if (result.affectedRows === 0) {
      return null;
    }

    const binding = await this.findById(bindingId);

    await this.logger.info(event, message, {
      bindingId: Number(bindingId),
      userId: binding ? Number(binding.user_id) : null,
      reviewerId: reviewerId ?? null,
      note: String(note ?? "")
    });

    return binding;
  }

  /** 核准一筆待審批的綁定。 */
  async approve(bindingId, { reviewerId = null, note = "" } = {}) {
    return this.#transition(bindingId, {
      from: DEVICE_STATUS.pending,
      to: DEVICE_STATUS.approved,
      reviewerId,
      note,
      event: "auth.device.binding_approved",
      message: "A device binding was approved"
    });
  }

  /** 拒絕一筆待審批的綁定。 */
  async reject(bindingId, { reviewerId = null, note = "" } = {}) {
    return this.#transition(bindingId, {
      from: DEVICE_STATUS.pending,
      to: DEVICE_STATUS.rejected,
      reviewerId,
      note,
      event: "auth.device.binding_rejected",
      message: "A device binding was rejected"
    });
  }

  /**
   * 撤銷一台已核准的設備。
   *
   * 只從 approved 撤銷：pending 的該用 reject，而重覆撤銷一台已撤銷的設備應該
   * 是一次明確的「沒有東西可做」，不是靜默成功。
   *
   * 撤銷之後那台設備最多還能用到手上 token 自己過期為止——它續不了期（續期會
   * 檢查綁定仍是 approved）。要立刻生效，呼叫端還要 revoke 那個 subject 的
   * token 版本；那一步屬於業務決定，不在這個 service。
   */
  async revoke(bindingId, { reviewerId = null, note = "" } = {}) {
    return this.#transition(bindingId, {
      from: DEVICE_STATUS.approved,
      to: DEVICE_STATUS.revoked,
      reviewerId,
      note,
      event: "auth.device.binding_revoked",
      message: "A device binding was revoked"
    });
  }

  /** 依 id 取一筆綁定。找不到回傳 null。 */
  async findById(bindingId) {
    let rows;

    try {
      [rows] = await this.database.query(
        `SELECT id, user_id, device_id, label, status, requested_at,
                requested_ip, requested_ua, reviewed_at, reviewed_by, last_used_at
         FROM ${DEVICES_TABLE}
         WHERE id = ?`,
        [Number(bindingId)]
      );
    } catch (error) {
      throw describeMissingTable(error, { table: DEVICES_TABLE, sqlFile: MIGRATE_HINT });
    }

    return rows.length === 0 ? null : rows[0];
  }

  /**
   * 待審批的申請，附上申請人的帳號。
   *
   * 刻意不回傳 public_key：審批者看不懂它，而它是驗簽用的資料，沒有理由出現在
   * 一個給人看的清單裡。
   */
  async listPending({ limit = 200 } = {}) {
    let rows;

    // LIMIT 不能用佔位符：MySQL 的 binary protocol 會以 ER_WRONG_ARGUMENTS 拒絕
    // `LIMIT ?`（見 MySqlIdempotencyStore.purge()）。所以先收斂成一個正整數再
    // 內插——沒有這一步，一個非數字的 limit 會變成 `LIMIT NaN`。
    const rowLimit = Math.max(1, Math.floor(Number(limit) || 200));

    try {
      [rows] = await this.database.query(
        `SELECT d.id, d.user_id, u.username, u.display_name, d.device_id, d.label,
                d.status, d.requested_at, d.requested_ip, d.requested_ua
         FROM ${DEVICES_TABLE} d
         JOIN users u ON u.id = d.user_id
         WHERE d.status = ?
         ORDER BY d.requested_at
         LIMIT ${rowLimit}`,
        [DEVICE_STATUS.pending]
      );
    } catch (error) {
      throw describeMissingTable(error, { table: DEVICES_TABLE, sqlFile: MIGRATE_HINT });
    }

    return rows;
  }

  /** 一個使用者自己的設備清單。 */
  async listForUser(userId) {
    let rows;

    try {
      [rows] = await this.database.query(
        `SELECT id, device_id, label, status, requested_at, requested_ip,
                requested_ua, reviewed_at, last_used_at
         FROM ${DEVICES_TABLE}
         WHERE user_id = ?
         ORDER BY requested_at DESC`,
        [Number(userId)]
      );
    } catch (error) {
      throw describeMissingTable(error, { table: DEVICES_TABLE, sqlFile: MIGRATE_HINT });
    }

    return rows;
  }

  /** 記下這台設備剛剛被成功使用過。登入與續期都要呼叫。 */
  async markUsed(bindingId) {
    await this.database.execute(
      `UPDATE ${DEVICES_TABLE} SET last_used_at = ? WHERE id = ?`,
      [this.time.nowMs(), Number(bindingId)]
    );
  }

  /** 刪掉過期的 nonce。由 deviceBinding.purgeNonces 排程。 */
  async purgeNonces() {
    const [result] = await this.database.execute(
      `DELETE FROM ${NONCES_TABLE} WHERE expires_at <= ?`,
      [this.time.nowMs()]
    );

    return result.affectedRows;
  }

  /**
   * 刪掉陳舊的綁定記錄。由 deviceBinding.purgeStaleDevices 排程。
   *
   * 三條規則：
   *   1. pending 超過 staleDeviceRetentionDays（看 requested_at）——申請了沒人理，
   *      或使用者早就換機器了。
   *   2. approved 但從未使用，超過 unusedApprovedRetentionDays（看 reviewed_at）
   *      ——通常代表金鑰那一端已經不在了。
   *   3. 用過的，超過 staleDeviceRetentionDays（看 last_used_at），不分狀態。
   *
   * 刻意留下的縫：rejected 且從未使用過的列不落在任何一條規則裡，會永久保留。
   * 那是被拒絕設備的正常狀態，留著代表**拒絕的決定不會被時間沖掉**——同一把金鑰
   * 再來申請時，審批者看得到它有前科。
   *
   * 不需要額外索引：這張表的大小是「使用者數 × 每人設備數」，日排一次全表掃描
   * 完全可以接受，而三條 OR 分支跨不同欄位，MySQL 本來也用不上索引。
   */
  async purgeStaleDevices() {
    const nowMs = this.time.nowMs();
    const staleBefore = nowMs - this.#config.staleDeviceRetentionDays * 86_400_000;
    const unusedApprovedBefore = nowMs - this.#config.unusedApprovedRetentionDays * 86_400_000;

    const [result] = await this.database.execute(
      `DELETE FROM ${DEVICES_TABLE}
       WHERE (status = ? AND requested_at <= ?)
          OR (status = ? AND last_used_at IS NULL AND reviewed_at <= ?)
          OR (last_used_at IS NOT NULL AND last_used_at <= ?)`,
      [
        DEVICE_STATUS.pending,
        staleBefore,
        DEVICE_STATUS.approved,
        unusedApprovedBefore,
        staleBefore
      ]
    );

    return result.affectedRows;
  }
}
