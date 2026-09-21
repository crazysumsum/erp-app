import { assertActorFresh } from "../authorization/directoryLookups.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import {
  BANK_ACCOUNT_EMPTY, BANK_ACCOUNT_TOO_LONG, BANK_ACCOUNT_UNREPRESENTABLE,
  bankAccountRejection, SupplierBankCrypto
} from "./SupplierBankCrypto.js";
import { invalidSupplierInput, supplierBankUnreadable, supplierChildNotFound, supplierConflict, supplierForbidden, supplierNotFound } from "./supplierErrors.js";
import { toMaskedBankResponse } from "./supplierProjections.js";

/**
 * Bank Account domain service。設計說明見 docs/supplier_management/03_design_spec.md
 * §2.5、§2.6、§5.8、§6.6。
 *
 * 設計 §2.5：Bank Account 係 Supplier 之下嘅**敏感子 aggregate**，有自己嘅 version；
 * 銀行資料、default slot 切換同 audit 喺同一交易。
 *
 * 三條貫穿成個檔案嘅規則：
 *
 *   1. **讀路徑唔掂密文。** 每個 SELECT 都明寫欄位，冇一個 `SELECT *`。BR-020 講明
 *      冇銀行查看權限嘅人唔可以透過列表、詳情、稽核、CSV、通知或者錯誤訊息攞到
 *      完整帳號 —— 而最穩陣嘅做法係啲密文根本冇離開過資料庫。
 *   2. **明文只喺 request-local memory 出現。** 佢淨係喺 create／update 嘅入口同
 *      reveal 嘅出口存在，兩邊都唔會入 audit detail、唔會入錯誤 details。
 *   3. **permission freshness 每次寫入都重驗。** token 派發之後撤權嘅人唔可以繼續
 *      寫 —— 同 SupplierApprovalService 嘅 #assertActorMayDecide 同一個姿態。
 */

// 設計 §6.6：Bank 寫入要求同時持有三個權限。route policy 喺 handler 嗰層執行，呢度
// 係第二層 —— 擋嘅係「claim 同現況夾晒，但個人其實冇 bank.mgmt」嗰種誠實地冇權嘅
// caller，assertActorFresh 本身唔執行任何 permission。
const BANK_WRITE_PERMISSION = "supplier.bank.mgmt";
const BANK_VIEW_PERMISSION = "supplier.bank.view";

// 設計 §5.8 白名單投影用到嘅欄位。密文、IV、tag、blind index 同兩個 key ID 全部
// **唔喺度** —— 佢哋只喺 reveal 同 update 嘅重新加密路徑先讀。
const MASKED_COLUMNS = `id, supplier_id, account_holder_name, bank_name, bank_country_code,
  bank_code, branch_code, swift_bic, account_currency_code, last_four, account_length,
  is_default, status, version, created_at, updated_at`;

const ACTIVE = "active";
const INACTIVE = "inactive";

function requireReason(value, message = "這項操作必須填寫原因") {
  const reason = String(value ?? "").trim();
  if (reason.length < 5 || reason.length > 500) {
    throw invalidSupplierInput("SUPPLIER_REASON_REQUIRED", message, { field: "reason" });
  }
  return reason;
}

function optionalCode(value, { field, length, message }) {
  const code = String(value ?? "").trim().toUpperCase();
  if (!code) return null;
  if (code.length !== length || !/^[A-Z0-9]+$/u.test(code)) {
    throw invalidSupplierInput("BANK_ACCOUNT_INVALID", message, { field });
  }
  return code;
}

/**
 * 設計 §6.6：validation error 同 `ApplicationError.details` 都唔可以包含
 * `accountNumber`。所以呢度每一個 throw 嘅 details 只講欄位名，唔講值 —— 包括嗰個
 * 「帳號本身唔合法」嘅 case，佢最容易手滑將輸入放埋落去。
 */
/**
 * REV-035 H-1：帳號嘅驗證要喺**開交易之前**做，而且要拋一個 400。
 *
 * 第一版靠 crypto 入面嗰個 `TypeError`，但佢係喺 `withTransaction` 裡面拋，所以真嘅
 * database wrapper 會將佢重新包成 `DATABASE_TRANSACTION_FAILED` —— 使用者收到一個
 * 500。而 HD-029 揀嗰個做法嘅全部理由就係「用戶見到、改得到」；一個 500 兩樣都唔係。
 *
 * 個測試當時過到，係因為 harness 嘅假 `withTransaction` 直接 `return work(connection)`，
 * 冇複製真 wrapper 嗰層錯誤轉換 —— 一個假嘢冇模仿到嘅行為，就係一個測試睇唔到嘅行為。
 */
const ACCOUNT_REJECTION_MESSAGES = Object.freeze({
  [BANK_ACCOUNT_EMPTY]: "請填寫銀行帳號",
  [BANK_ACCOUNT_UNREPRESENTABLE]: "銀行帳號只接受數字同英文字母，分隔符號會自動略過",
  [BANK_ACCOUNT_TOO_LONG]: "銀行帳號太長"
});

function assertAccountNumber(value) {
  const rejection = bankAccountRejection(value);
  if (rejection) {
    // details 只講欄位名 —— 設計 §6.6 明文禁止喺 validation error 入面帶 accountNumber。
    throw invalidSupplierInput("BANK_ACCOUNT_INVALID", ACCOUNT_REJECTION_MESSAGES[rejection], { field: "accountNumber" });
  }
}

function normalizeBankInput(input, { accountNumberRequired }) {
  const accountHolderName = String(input.accountHolderName ?? "").trim();
  const bankName = String(input.bankName ?? "").trim();
  if (!accountHolderName) {
    throw invalidSupplierInput("BANK_ACCOUNT_INVALID", "請填寫帳戶持有人", { field: "accountHolderName" });
  }
  if (!bankName) {
    throw invalidSupplierInput("BANK_ACCOUNT_INVALID", "請填寫銀行名稱", { field: "bankName" });
  }
  // create 一定要有帳號；update 冇帶就係「唔改帳號」，帶咗就要驗。
  if (accountNumberRequired || (input.accountNumber !== undefined && input.accountNumber !== null)) {
    assertAccountNumber(input.accountNumber);
  }
  return {
    accountHolderName,
    bankName,
    bankCountryCode: optionalCode(input.bankCountryCode, {
      field: "bankCountryCode", length: 2, message: "國家／地區代碼必須是兩個英文字母"
    }),
    bankCode: String(input.bankCode ?? "").trim(),
    branchCode: String(input.branchCode ?? "").trim(),
    swiftBic: String(input.swiftBic ?? "").trim().toUpperCase(),
    accountCurrencyCode: optionalCode(input.accountCurrencyCode, {
      field: "accountCurrencyCode", length: 3, message: "幣別代碼必須是三個英文字母"
    })
  };
}

export class SupplierBankService {
  constructor({ database, logger, time, crypto, authorize = assertActorFresh, audit } = {}) {
    if (!database || !logger || !time) {
      throw new TypeError("SupplierBankService requires database, logger and time");
    }
    this.logger = logger;
    // crypto 係必需嘅，而且唔可以有一個「冇 key 就唔加密」嘅後備路徑：咁樣一個忘記
    // 配置 key ring 嘅環境會靜靜哋用明文寫入。設計 §5.8 fail closed。
    if (!(crypto instanceof SupplierBankCrypto)) {
      throw new TypeError("SupplierBankService requires a SupplierBankCrypto; there is no unencrypted fallback");
    }
    this.database = database;
    this.time = time;
    this.crypto = crypto;
    this.authorize = authorize;
    this.audit = audit ?? new SupplierAuditLogService({ database, logger, time });
  }

  // REV-035 L：403 唔係 409。一個從來冇擁有過呢個權限嘅 caller 唔係撞到一個衝突，
  // 佢係冇資格 —— 而 409 會叫佢「重新載入再試」，一個永遠唔會成功嘅建議。
  #assertMay(actor, permission, message) {
    if (!actor?.permissions?.includes(permission)) {
      throw supplierForbidden("BANK_PERMISSION_LOST", message);
    }
  }

  async #supplierForUpdate(connection, supplierId) {
    const [[supplier]] = await connection.query(
      "SELECT id, supplier_code FROM suppliers WHERE id = ? FOR UPDATE",
      [supplierId]
    );
    if (!supplier) throw supplierNotFound(supplierId);
    return supplier;
  }

  /**
   * 設計 §2.6：設定預設銀行帳戶時**先鎖 Supplier 全部 Active Bank rows**，再清舊
   * default、設新 default。鎖序係 suppliers → child rows（ID 升序），所以呢個查詢
   * 帶 ORDER BY id —— 兩條並發嘅 setDefault 用同一個次序攞鎖先唔會砌成循環。
   */
  async #activeRowsForUpdate(connection, supplierId) {
    const [rows] = await connection.query(
      `SELECT id, is_default, status FROM supplier_bank_accounts
        WHERE supplier_id = ? AND status = ? ORDER BY id FOR UPDATE`,
      [supplierId, ACTIVE]
    );
    return rows;
  }

  async #rowForUpdate(connection, supplierId, bankAccountId) {
    const [[row]] = await connection.query(
      `SELECT ${MASKED_COLUMNS}, crypto_context, encryption_key_id, blind_index_key_id
         FROM supplier_bank_accounts WHERE id = ? AND supplier_id = ? FOR UPDATE`,
      [bankAccountId, supplierId]
    );
    // 借另一個 Supplier 嘅 route 去攞一個唔屬於佢嘅帳戶，同「搵唔到」冇分別。設計
    // §6.3 對所有 child route 定咗同一條規矩。
    if (!row) throw supplierChildNotFound("bank");
    return row;
  }

  async #project(connection, supplierId, bankAccountId) {
    const [[row]] = await connection.query(
      `SELECT ${MASKED_COLUMNS} FROM supplier_bank_accounts WHERE id = ? AND supplier_id = ?`,
      [bankAccountId, supplierId]
    );
    return toMaskedBankResponse(row);
  }

  /**
   * 設計 §5.8：查重要用 **ring 入面所有 key**。輪替期間同一個帳號喺新舊 key 之下計
   * 出唔同 index，淨係用 active key 查嘅話，「換咗 key ID」就變成一條繞過重覆檢查
   * 嘅路。
   *
   * 同一個 Supplier 重覆 → 擋。跨 Supplier → 只回一個 warning，因為兩間公司共用一
   * 個收款帳號係合法嘅業務情況。設計 §6.6：warning 唔可以回對方嘅帳號，但有
   * `supplier.view` 嘅話可以回對方 Supplier Code 俾人手判斷。
   *
   * REV-035 H-3：**唔可以**過濾 `status = 'active'`。設計 §5.8 嗰條
   * `UNIQUE(supplier_id, blind_index_key_id, account_blind_index)` 冇 status 謂詞，
   * 所以 service 過濾咗就會同資料庫唔同意 —— 而「停用咗，再加返同一個帳號」正正係
   * 使用者會行嘅路（FR-BANK-005 令停用係唯一嘅退役方式），結果會由一個清楚嘅 409
   * 變成一個 ER_DUP_ENTRY 500。而家兩邊講同一件事。
   *
   * 呢個查詢唔上鎖，所以兩個並發嘅 create 都可能讀到「冇重覆」。設計 §2.5 講明
   * 「DB unique／FK 是競態下最後防線；service 預查只為回傳較清晰的公開錯誤」，所以
   * 落去嗰個 INSERT 會捉 ER_DUP_ENTRY 再翻譯返做同一個 409。
   */
  async #duplicates(connection, { supplierId, candidates, excludeId = null, actor }) {
    const indexes = candidates.map((candidate) => candidate.index);
    const placeholders = indexes.map(() => "?").join(", ");
    const [rows] = await connection.query(
      `SELECT b.id, b.supplier_id, s.supplier_code
         FROM supplier_bank_accounts b
         JOIN suppliers s ON s.id = b.supplier_id
        WHERE b.account_blind_index IN (${placeholders})
        ORDER BY b.id`,
      indexes
    );
    const mine = rows.filter((row) => Number(row.supplier_id) === Number(supplierId)
      && Number(row.id) !== Number(excludeId));
    if (mine.length > 0) {
      throw supplierConflict("BANK_ACCOUNT_DUPLICATE", "這個供應商已有相同的銀行帳戶");
    }
    const others = rows.filter((row) => Number(row.supplier_id) !== Number(supplierId));
    if (others.length === 0) return [];
    const maySeeSupplier = actor?.permissions?.includes("supplier.view");
    return [{
      code: "BANK_ACCOUNT_DUPLICATE_OTHER_SUPPLIER",
      message: "另一個供應商有疑似相同的銀行帳戶",
      // 冇 supplier.view 就連 Supplier Code 都唔回 —— 一個 code 已經足夠辨認一間
      // 公司，唔應該靠「反正唔係帳號」就派出去。
      supplierCodes: maySeeSupplier ? [...new Set(others.map((row) => row.supplier_code))] : []
    }];
  }

  /**
   * 設計 §2.5：DB unique 係競態下最後防線，service 預查只為回傳較清晰嘅公開錯誤，
   * 所以兩者要講同一句 —— 一個輸咗競態嘅寫入唔應該變成 500。
   *
   * REV-037 H-1：收一個**清單**，唔係一條。一句帶 `is_default = 1` 嘅 INSERT 兩條
   * 約束都違反得到，而爆邊條係由**資料**決定，唔係由 caller 嘅意圖決定。第一版用
   * `wantsDefault ? A : B` 揀，於是「想做預設 + 帳號撞咗」嗰格就走甩 —— 而一個
   * Supplier 嘅第一個銀行帳戶通常就係剔住「設為預設」嘅，即係 create 最常見嗰個形狀。
   */
  static async #translatingDuplicates(work, { constraints }) {
    try {
      return await work();
    } catch (error) {
      // 一句 ER_DUP_ENTRY 只會點名**一條** key，而下面個 regex 錨定咗結尾嗰個單引號，
      // 所以清單入面最多一條夾得到 —— `find` 同 `findLast` 係等價嘅（實測過，唔係
      // 推理）。即係「first match」呢個講法唔帶任何次序意義，唔好靠佢。
      const hit = constraints.find((constraint) => SupplierBankService.#violates(error, constraint));
      if (!hit) throw error;
      if (hit === "uq_supplier_bank_blind_index") {
        throw supplierConflict("BANK_ACCOUNT_DUPLICATE", "這個供應商已有相同的銀行帳戶");
      }
      // REV-036 note：呢條分支今日到唔到 —— 兩個並發嘅 create(isDefault) 或者
      // setDefault 都會先攞 `suppliers FOR UPDATE`，所以已經排晒隊，個 slot 撞唔到。
      // 留住佢係因為約束真係喺資料庫度，而唔係每個未來 writer 都一定會攞嗰個鎖
      // （輪替腳本、匯入）。呢個係一條冇測試覆蓋嘅防守分支，講明過。
      throw supplierConflict("BANK_ACCOUNT_DEFAULT_RACE", "預設銀行帳戶剛被其他人變更，請重新載入");
    }
  }

  /**
   * REV-036 H-1：`error.code` 唔夠。`MySqlDatabaseExecutor.run()` 將每一句 statement
   * 錯誤包成 `MySqlDatabaseOperationError{ code: "DATABASE_OPERATION_FAILED", cause }`，
   * 所以 driver 嗰個 code 跌咗落 `cause`。第一版淨係睇 `error.code`，即係**喺生產
   * 環境永遠係 false** —— 而成套測試分辨唔到，因為兩個 fake 都冇做嗰層 wrapping。
   *
   * REV-036 M-3：唔可以用 `message.includes(...)` 揀分支。MySQL 嗰句嘅第一個成分係
   * **重覆嗰個值本身**，即係用 `includes` 等於攞使用者資料嚟掃；而個格式仲要跟版本
   * 唔同（5.7 `for key 'uq_…'`，8.0 `for key 'table.uq_…'`）。改用 errno 1062 加一個
   * 錨定咗嘅 regex。
   */
  static #violates(error, constraint) {
    const chain = [error, error?.cause, error?.cause?.cause].filter(Boolean);
    const duplicate = chain.find((link) => Number(link.errno) === 1062 || link.code === "ER_DUP_ENTRY");
    if (!duplicate) return false;
    return new RegExp(`for key '(?:[^']*\\.)?${constraint}'`, "u").test(String(duplicate.sqlMessage ?? duplicate.message ?? ""));
  }

  #seal({ supplierId, cryptoContext, accountNumber }) {
    const sealed = this.crypto.encryptAccountNumber({ supplierId, cryptoContext, accountNumber });
    const { index, keyId } = this.crypto.blindIndex(accountNumber);
    return { ...sealed, blindIndex: index, blindIndexKeyId: keyId };
  }

  /**
   * FR-BANK-002／BR-020／AC-023：所有人只攞到遮罩清單，`bank.view` 唔會自動 reveal。
   * 呢個查詢明寫欄位，所以密文根本冇離開資料庫。
   */
  async list({ actorId, claimedRoles, claimedPermissions, supplierId, includeInactive = false } = {}) {
    const actor = await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    // REV-035 M-1：每條寫入路徑同 reveal 都有第二層檢查，唯獨呢條讀路徑冇。設計
    // §6.6 要求 supplier.view —— 刻意唔係 bank.view，因為 AC-023 講明遮罩清單係
    // 俾所有 supplier.view 睇嘅，bank.view 只係多咗 reveal。
    this.#assertMay(actor, "supplier.view", "你目前沒有供應商查看權限");
    const [[supplier]] = await this.database.query("SELECT id FROM suppliers WHERE id = ?", [supplierId]);
    if (!supplier) throw supplierNotFound(supplierId);
    const [rows] = await this.database.query(
      `SELECT ${MASKED_COLUMNS} FROM supplier_bank_accounts
        WHERE supplier_id = ?${includeInactive ? "" : " AND status = 'active'"}
        ORDER BY is_default DESC, id`,
      [supplierId]
    );
    return { items: rows.map(toMaskedBankResponse) };
  }

  async create(input) {
    const details = normalizeBankInput(input, { accountNumberRequired: true });
    const reason = requireReason(input.reason, "新增銀行帳戶必須填寫原因");
    // 明文喺呢度入嚟，喺呢個 method 結束之前唔再出現喺任何地方。
    const cryptoContext = this.crypto.newCryptoContext();
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      this.#assertMay(actor, BANK_WRITE_PERMISSION, "你目前沒有銀行資料管理權限");
      await this.#supplierForUpdate(connection, input.supplierId);

      const sealed = this.#seal({
        supplierId: input.supplierId, cryptoContext, accountNumber: input.accountNumber
      });
      const warnings = await this.#duplicates(connection, {
        supplierId: input.supplierId,
        candidates: this.crypto.candidateBlindIndexes(input.accountNumber),
        actor
      });

      const nowMs = this.time.nowMs();
      // 設計 §2.6：新帳戶要做 default 嘅話，先鎖晒全部 active row 再清舊 default。
      const wantsDefault = Boolean(input.isDefault);
      if (wantsDefault) {
        await this.#activeRowsForUpdate(connection, input.supplierId);
        await connection.execute(
          `UPDATE supplier_bank_accounts SET is_default = 0, version = version + 1, updated_at = ?, updated_by = ?
            WHERE supplier_id = ? AND is_default = 1`,
          [nowMs, input.actorId, input.supplierId]
        );
      }
      const [result] = await SupplierBankService.#translatingDuplicates(() => connection.execute(
        `INSERT INTO supplier_bank_accounts
          (supplier_id, crypto_context, account_holder_name, bank_name, bank_country_code,
           bank_code, branch_code, swift_bic, account_currency_code,
           account_ciphertext, account_iv, account_auth_tag, encryption_key_id,
           account_blind_index, blind_index_key_id, last_four, account_length,
           is_default, status, version, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [input.supplierId, cryptoContext, details.accountHolderName, details.bankName, details.bankCountryCode,
          details.bankCode, details.branchCode, details.swiftBic, details.accountCurrencyCode,
          sealed.ciphertext, sealed.iv, sealed.authTag, sealed.encryptionKeyId,
          sealed.blindIndex, sealed.blindIndexKeyId, sealed.lastFour, sealed.accountLength,
          wantsDefault ? 1 : 0, ACTIVE, nowMs, nowMs, input.actorId, input.actorId]
      // 兩條都要問：呢句 INSERT 兩條都違反得到，而爆邊條係由資料決定。
      ), { constraints: wantsDefault ? ["uq_supplier_bank_blind_index", "uq_supplier_bank_default"] : ["uq_supplier_bank_blind_index"] });
      const bankAccountId = Number(result.insertId);
      const projected = await this.#project(connection, input.supplierId, bankAccountId);
      await this.audit.record(connection, {
        actorUserId: input.actorId, actorUsername: actor?.username ?? "",
        action: "supplier.bank.create", targetType: "bank", targetId: bankAccountId,
        supplierId: Number(input.supplierId), targetLabel: details.bankName, reason,
        // detail 只帶得返遮罩過嘅嘢。account_length 同 last_four 已經係投影嘅一部分，
        // 而密文、IV、tag、blind index、key ID 一律唔入 audit。
        detail: { after: { maskedAccountNumber: projected.maskedAccountNumber, isDefault: projected.isDefault } },
        requestId: input.requestId, ip: input.ip
      });
      return { ...projected, warnings };
    });
  }

  /**
   * 設計 §6.6：帳號有改先重新加密／重算 blind index。冇改就唔碰嗰四個欄位 —— 唔係
   * 為咗慳，而係每一次重新加密都係一次 IV 重出、一次 audit 上嘅「帳號改過」訊號，
   * 而改個銀行名唔應該睇落似改過帳號。
   */
  async update(input) {
    const details = normalizeBankInput(input, { accountNumberRequired: false });
    const reason = requireReason(input.reason, "修改銀行帳戶必須填寫原因");
    const changingAccount = input.accountNumber !== undefined && input.accountNumber !== null;
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      this.#assertMay(actor, BANK_WRITE_PERMISSION, "你目前沒有銀行資料管理權限");
      await this.#supplierForUpdate(connection, input.supplierId);
      const current = await this.#rowForUpdate(connection, input.supplierId, input.bankAccountId);
      if (Number(current.version) !== Number(input.version)) {
        throw supplierConflict("VERSION_CONFLICT", "銀行帳戶已被其他人修改，請重新載入");
      }
      if (current.status !== ACTIVE) {
        throw supplierConflict("BANK_ACCOUNT_INACTIVE", "已停用的銀行帳戶不可修改");
      }

      let warnings = [];
      let sealed = null;
      if (changingAccount) {
        warnings = await this.#duplicates(connection, {
          supplierId: input.supplierId,
          candidates: this.crypto.candidateBlindIndexes(input.accountNumber),
          excludeId: input.bankAccountId,
          actor
        });
        // 重新加密沿用同一個 crypto_context：佢係呢一行嘅身分，唔係呢一次加密嘅
        // 身分。換咗佢，AAD 就會綁去一個新身分，而舊備份入面嘅密文就再解唔返。
        sealed = this.#seal({
          supplierId: input.supplierId,
          cryptoContext: current.crypto_context,
          accountNumber: input.accountNumber
        });
      }

      const nowMs = this.time.nowMs();
      const [updated] = await SupplierBankService.#translatingDuplicates(() => connection.execute(
        `UPDATE supplier_bank_accounts
            SET account_holder_name = ?, bank_name = ?, bank_country_code = ?,
                bank_code = ?, branch_code = ?, swift_bic = ?, account_currency_code = ?,
                ${sealed ? `account_ciphertext = ?, account_iv = ?, account_auth_tag = ?, encryption_key_id = ?,
                account_blind_index = ?, blind_index_key_id = ?, last_four = ?, account_length = ?,` : ""}
                version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND supplier_id = ? AND version = ?`,
        [details.accountHolderName, details.bankName, details.bankCountryCode,
          details.bankCode, details.branchCode, details.swiftBic, details.accountCurrencyCode,
          ...(sealed
            ? [sealed.ciphertext, sealed.iv, sealed.authTag, sealed.encryptionKeyId,
              sealed.blindIndex, sealed.blindIndexKeyId, sealed.lastFour, sealed.accountLength]
            : []),
          nowMs, input.actorId, input.bankAccountId, input.supplierId, input.version]
      ), { constraints: ["uq_supplier_bank_blind_index"] });
      if (updated.affectedRows === 0) {
        throw supplierConflict("VERSION_CONFLICT", "銀行帳戶已被其他人修改，請重新載入");
      }
      const projected = await this.#project(connection, input.supplierId, input.bankAccountId);
      await this.audit.record(connection, {
        actorUserId: input.actorId, actorUsername: actor?.username ?? "",
        action: "supplier.bank.update", targetType: "bank", targetId: Number(input.bankAccountId),
        supplierId: Number(input.supplierId), targetLabel: details.bankName, reason,
        // 稽核要講得出「帳號有冇改過」，但唔可以講改成乜。
        detail: { changes: { accountNumberChanged: Boolean(sealed) }, after: { maskedAccountNumber: projected.maskedAccountNumber } },
        requestId: input.requestId, ip: input.ip
      });
      return { ...projected, warnings };
    });
  }

  /**
   * FR-BANK-003／BR-019／AC-026：同一交易清舊設新，最後只剩一個有效預設。資料庫嗰
   * 條 generated unique slot 係最後防線；呢度嘅明確清除只係為咗回一個清楚嘅結果。
   */
  async setDefault(input) {
    const reason = requireReason(input.reason, "更改預設銀行帳戶必須填寫原因");
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      this.#assertMay(actor, BANK_WRITE_PERMISSION, "你目前沒有銀行資料管理權限");
      await this.#supplierForUpdate(connection, input.supplierId);
      await this.#activeRowsForUpdate(connection, input.supplierId);
      const current = await this.#rowForUpdate(connection, input.supplierId, input.bankAccountId);
      if (Number(current.version) !== Number(input.version)) {
        throw supplierConflict("VERSION_CONFLICT", "銀行帳戶已被其他人修改，請重新載入");
      }
      if (current.status !== ACTIVE) {
        throw supplierConflict("BANK_ACCOUNT_INACTIVE", "已停用的銀行帳戶不可設為預設");
      }

      const nowMs = this.time.nowMs();
      await connection.execute(
        `UPDATE supplier_bank_accounts SET is_default = 0, version = version + 1, updated_at = ?, updated_by = ?
          WHERE supplier_id = ? AND is_default = 1 AND id != ?`,
        [nowMs, input.actorId, input.supplierId, input.bankAccountId]
      );
      const [updated] = await SupplierBankService.#translatingDuplicates(() => connection.execute(
        `UPDATE supplier_bank_accounts SET is_default = 1, version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND supplier_id = ? AND version = ?`,
        [nowMs, input.actorId, input.bankAccountId, input.supplierId, input.version]
      ), { constraints: ["uq_supplier_bank_default"] });
      if (updated.affectedRows === 0) {
        throw supplierConflict("VERSION_CONFLICT", "銀行帳戶已被其他人修改，請重新載入");
      }
      const projected = await this.#project(connection, input.supplierId, input.bankAccountId);
      await this.audit.record(connection, {
        actorUserId: input.actorId, actorUsername: actor?.username ?? "",
        action: "supplier.bank.default", targetType: "bank", targetId: Number(input.bankAccountId),
        supplierId: Number(input.supplierId), targetLabel: current.bank_name, reason,
        detail: { before: { isDefault: Boolean(current.is_default) }, after: { isDefault: true } },
        requestId: input.requestId, ip: input.ip
      });
      return projected;
    });
  }

  /**
   * FR-BANK-005：被付款或其他資料引用之後不可永久刪除，只可停用 —— 所以呢度冇 delete，
   * 亦都**冇**因為有引用就拒絕停用。引用擋嘅係硬刪，唔係停用；一個已經停用嘅帳戶
   * 仍然解釋得返歷史付款。
   */
  async deactivate(input) {
    const reason = requireReason(input.reason, "停用銀行帳戶必須填寫原因");
    return this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      this.#assertMay(actor, BANK_WRITE_PERMISSION, "你目前沒有銀行資料管理權限");
      await this.#supplierForUpdate(connection, input.supplierId);
      const current = await this.#rowForUpdate(connection, input.supplierId, input.bankAccountId);
      if (Number(current.version) !== Number(input.version)) {
        throw supplierConflict("VERSION_CONFLICT", "銀行帳戶已被其他人修改，請重新載入");
      }
      if (current.status !== ACTIVE) {
        throw supplierConflict("BANK_ACCOUNT_INACTIVE", "銀行帳戶已停用");
      }

      const nowMs = this.time.nowMs();
      // 停用同時清 default。generated slot 本身喺 status 唔係 active 嗰陣就會變 NULL，
      // 但 is_default 要一齊清，否則個 row 重新啟用嘅時候會靜靜哋搶返個 slot。
      const [updated] = await connection.execute(
        `UPDATE supplier_bank_accounts
            SET status = ?, is_default = 0, version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND supplier_id = ? AND version = ?`,
        [INACTIVE, nowMs, input.actorId, input.bankAccountId, input.supplierId, input.version]
      );
      if (updated.affectedRows === 0) {
        throw supplierConflict("VERSION_CONFLICT", "銀行帳戶已被其他人修改，請重新載入");
      }
      const projected = await this.#project(connection, input.supplierId, input.bankAccountId);
      await this.audit.record(connection, {
        actorUserId: input.actorId, actorUsername: actor?.username ?? "",
        action: "supplier.bank.deactivate", targetType: "bank", targetId: Number(input.bankAccountId),
        supplierId: Number(input.supplierId), targetLabel: current.bank_name, reason,
        detail: {
          before: { status: current.status, isDefault: Boolean(current.is_default) },
          after: { status: INACTIVE, isDefault: false }
        },
        requestId: input.requestId, ip: input.ip
      });
      return projected;
    });
  }

  /**
   * FR-BANK-002／AC-024：主動查看完整帳號，顯示完整值**並且**記錄查看事件。
   *
   * 次序係呢個 method 嘅全部重點：稽核喺交易入面寫，交易 commit 成功之後先至回明文。
   * 一個「先回帳號、事後補 audit」嘅實作喺 audit 寫入失敗嗰陣會派咗個帳號出去而冇
   * 任何紀錄 —— 而嗰個正正係最需要紀錄嘅情況。解密亦都喺交易入面做：解唔到就成個
   * 交易 rollback，唔會留低一筆「有人睇過」但其實乜都冇睇到嘅稽核。
   */
  async reveal(input) {
    const reason = requireReason(input.reason, "查看完整帳號必須填寫原因");
    let plaintext = null;
    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, input);
      this.#assertMay(actor, BANK_VIEW_PERMISSION, "你目前沒有銀行資料查看權限");
      const [[row]] = await connection.query(
        `SELECT id, supplier_id, bank_name, crypto_context, account_ciphertext, account_iv,
                account_auth_tag, encryption_key_id, account_length
           FROM supplier_bank_accounts WHERE id = ? AND supplier_id = ?`,
        [input.bankAccountId, input.supplierId]
      );
      if (!row) throw supplierChildNotFound("bank");

      // 解密失敗要係一個**具名**錯誤。第一版就咁俾 crypto 嗰個 Error 拋上去，而佢
      // 唔係 ApplicationError，所以真嘅 database wrapper 會將佢包成
      // DATABASE_TRANSACTION_FAILED —— 一個匿名 500，日誌入面分唔出「資料被改過」
      // 同「條 key 唔喺 ring 入面」。兩件事都唔係 caller 修得到，但佢哋要分得出。
      // 呢個 bug 係喺測試 harness 開始模仿真 wrapper 之後先浮出嚟。
      let revealed = null;
      try {
        revealed = this.crypto.decryptAccountNumber({
          supplierId: row.supplier_id,
          cryptoContext: row.crypto_context,
          ciphertext: row.account_ciphertext,
          iv: row.account_iv,
          authTag: row.account_auth_tag,
          encryptionKeyId: row.encryption_key_id
        });
      } catch (error) {
        // systemLogger 係 warn(event, message, context) —— 第一版傳兩個 argument，
        // 個 payload 跌咗入 message 個位（REV-036 M-1）。而呢個 422 嘅全部理由就係
        // 「竄改」同「條 key 唔喺 ring」喺日誌分得出，所以 context 唔可以走失。
        this.logger?.warn?.("supplier.bank.reveal.unreadable", "Supplier bank account could not be read", {
          bankAccountId: Number(row.id), supplierId: Number(row.supplier_id),
          // 原因講得出，但唔帶密文、唔帶 key material。
          reason: error?.message ?? "unknown"
        });
        throw supplierBankUnreadable("這個銀行帳戶目前無法讀取，請聯絡系統管理員");
      }

      await this.audit.record(connection, {
        actorUserId: input.actorId, actorUsername: actor?.username ?? "",
        action: "supplier.bank.reveal", targetType: "bank", targetId: Number(row.id),
        supplierId: Number(row.supplier_id), targetLabel: row.bank_name, reason,
        // 稽核紀錄「有人睇過」，唔紀錄「睇到乜」。
        detail: { after: { revealed: true } },
        requestId: input.requestId, ip: input.ip
      });
      plaintext = revealed;
    });
    // 只有喺 withTransaction resolve 之後先到呢度 —— 即係 audit 已經 commit。
    return { id: Number(input.bankAccountId), accountNumber: plaintext, revealedAt: this.time.nowMs() };
  }
}
