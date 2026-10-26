import { assertActorFresh } from "../authorization/directoryLookups.js";
import { changedFieldsDetail } from "./auditChanges.js";
import { APPROVAL_SIGNIFICANT_COLUMNS, SupplierApprovalService, buildApprovalSummary } from "./SupplierApprovalService.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { SupplierDuplicateCandidates, replaceSupplierNameGrams } from "./supplierDuplicateCandidates.js";
import { SupplierReferenceService } from "./SupplierReferenceService.js";
import { invalidSupplierInput, retryOnceOnDeadlock, supplierConflict, supplierNotFound } from "./supplierErrors.js";
import {
  escapeLikeTerm,
  normalizeContactEmail,
  normalizeSupplierCode,
  normalizeSupplierName,
  normalizeSupplierOptionalText,
  normalizeSupplierUrl
} from "./supplierNormalization.js";
import { toAddressResponse, toContactResponse, toIdentifierResponse, toSupplierDetailResponse, toSupplierSummaryResponse } from "./supplierProjections.js";
import { paymentTermsById } from "./paymentTermLabels.js";
import { assertSupplierDeletable, transitionSupplierStatus } from "./supplierStateMachine.js";
import {
  assertKnownSupplierFields,
  assertSupplierActivatable,
  supplierActivatabilityIssues,
  supplierCompletenessWarnings
} from "./supplierValidation.js";

function duplicateEntry(error) {
  return (error?.cause?.code ?? error?.code) === "ER_DUP_ENTRY";
}

function referencedRow(error) {
  return ["ER_ROW_IS_REFERENCED", "ER_ROW_IS_REFERENCED_2"].includes(error?.cause?.code ?? error?.code);
}

function deepFreeze(value) {
  for (const entry of Object.values(value)) {
    if (entry && typeof entry === "object") deepFreeze(entry);
  }
  return Object.freeze(value);
}

// One definition per status transition. #changeStatus takes a key of this map, not
// a descriptor, so a transition added in a later phase cannot reach the transition
// path without also entering the replay filter derived below.
export const LIFECYCLE_COMMANDS = deepFreeze({
  activate: { targetStatus: "active", allowedFrom: ["draft"], action: "supplier.activate", activationCheck: true, approvalCheck: true },
  suspend: { targetStatus: "suspended", allowedFrom: ["active"], action: "supplier.suspend" },
  reactivate: { targetStatus: "active", allowedFrom: ["suspended"], action: "supplier.reactivate", activationCheck: true },
  block: { targetStatus: "blocked", allowedFrom: ["active", "suspended"], action: "supplier.block" },
  unblock: { targetStatus: "suspended", allowedFrom: ["blocked"], action: "supplier.unblock" },
  archive: { targetStatus: "archived", allowedFrom: ["draft", "active", "suspended"], action: "supplier.archive", openFlowCheck: true },
  restore: { targetStatus: "suspended", allowedFrom: ["archived"], action: "supplier.restore" }
});

// Replay detection must look only at status transitions. Every audit action this
// module writes begins with "supplier.", so a broader match lets an unrelated
// child-record write shadow the real transition.
const LIFECYCLE_ACTIONS = Object.freeze(Object.values(LIFECYCLE_COMMANDS).map((command) => command.action));

// 設計 4.5 嘅 approval-significant 欄位。呢個 map 由 APPROVAL_SIGNIFICANT_COLUMNS
// 推導，唔係第二份人手維護嘅清單 —— 之前兩份清單擺埋一齊但唔同步，supplier_code
// 就係咁樣跌咗出強制範圍，而個 comment 仲寫住佢喺呢個 service 改唔到（佢改得到，
// changeSupplierCode 就喺下面）。identifiers 由 SupplierIdentifierService 擁有，
// supplier_code 由 changeSupplierCode 擁有，兩條路各自失效。
const COLUMN_TO_INPUT_FIELD = Object.freeze({
  supplier_code: "supplierCode",
  supplier_name: "supplierName",
  display_name: "displayName",
  default_currency_code: "defaultCurrencyCode",
  default_payment_term_id: "defaultPaymentTermId"
});
// 忘記喺 COLUMN_TO_INPUT_FIELD 加對應會令個欄位映射到 undefined，跟住 next[undefined]
// 永遠係 ""，於是任何一個 pending Supplier 一改就被判定為關鍵變更、申請被銷毀。
// 舊嘅兩份清單漂移係靜靜哋少做嘢；呢個係靜靜哋做多咗，更差。所以喺載入時就炸。
export function assertSignificantColumnsMapped(columns, mapping) {
  for (const column of columns) {
    if (!mapping[column]) {
      throw new TypeError(`APPROVAL_SIGNIFICANT_COLUMNS lists ${column} with no COLUMN_TO_INPUT_FIELD mapping`);
    }
  }
}
assertSignificantColumnsMapped(APPROVAL_SIGNIFICANT_COLUMNS, COLUMN_TO_INPUT_FIELD);

const SIGNIFICANT_UPDATE_FIELDS = Object.freeze(
  APPROVAL_SIGNIFICANT_COLUMNS
    .filter((column) => column !== "supplier_code")
    .map((column) => [column, COLUMN_TO_INPUT_FIELD[column]])
);
const NEXT_FIELD_NAMES = Object.freeze(Object.fromEntries(SIGNIFICANT_UPDATE_FIELDS));

const SUPPLIER_SORT_COLUMNS = Object.freeze({
  supplierCode: "s.supplier_code_key",
  supplierName: "s.supplier_name",
  status: "s.status",
  updatedAt: "s.updated_at"
});

function supplierSortColumn(sortBy) {
  return SUPPLIER_SORT_COLUMNS[sortBy] ?? SUPPLIER_SORT_COLUMNS.updatedAt;
}

const CHILD_DETAIL_LIMIT = 100;

/**
 * 識別號嘅 key 係大寫，除咗 `other` 之外仲剷走空格同連字號（normalizeIdentifier）。搜尋唔知類型，
 * 所以兩種寫法都試（FR-LIST-002，HD-107）。
 */
function identifierPatterns(search) {
  const upper = search.toUpperCase();
  const stripped = upper.replace(/[\s-]+/gu, "");
  const asTyped = `%${escapeLikeTerm(upper)}%`;
  // 淨係分隔符（例如「-」）剷完就係空字串，`%%` 會配中所有識別號（REV-094 M-1）。
  return [stripped ? `%${escapeLikeTerm(stripped)}%` : asTyped, asTyped];
}

/**
 * 供應商列表同 for-SKU lookup 共用嘅文字搜尋（HD-094 4A）；`search` 要已經 NFKC 同 trim。
 * 識別號只喺列表搜（HD-108 A）：佢係 `%值%`，用唔到 index，for-SKU 最差情況加咗佢就超過 NFR-005。
 */
export function supplierSearchCondition(search, { identifiers = true } = {}) {
  const escaped = escapeLikeTerm(search);
  return {
    sql: `s.supplier_code_key LIKE ? ESCAPE '\\\\'
      OR s.supplier_name LIKE ? ESCAPE '\\\\'
      OR s.display_name LIKE ? ESCAPE '\\\\'
      OR s.general_phone LIKE ? ESCAPE '\\\\'
      OR s.general_email LIKE ? ESCAPE '\\\\'${identifiers ? `
      OR s.id IN (SELECT i.supplier_id FROM supplier_identifiers i
                   WHERE i.identifier_value_key LIKE ? ESCAPE '\\\\' OR i.identifier_value_key LIKE ? ESCAPE '\\\\')` : ""}`,
    params: [`${escaped.toLowerCase()}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`, `%${escaped}%`, ...(identifiers ? identifierPatterns(search) : [])]
  };
}

/**
 * 供應商列表嘅篩選同排序（alias `s`）。一般匯出（T47，FR-IMPORT-009）用同一個函式，保證匯出嘅就係列表見到嘅。
 */
export function supplierListQuery({
  q = "", status, currencyCode, paymentTermId, updatedFrom, updatedTo, createdFrom, createdTo,
  missingPrimaryContact = false, missingAddress = false, missingBank = false,
  includeArchived = false, sortBy = "updatedAt", descending = true
} = {}) {
  const conditions = [];
  const params = [];
  if (status) {
    conditions.push("s.status = ?");
    params.push(status);
  } else if (!includeArchived) {
    conditions.push("s.status != 'archived'");
  }
  if (currencyCode) {
    conditions.push("s.default_currency_code = ?");
    params.push(currencyCode);
  }
  if (paymentTermId !== undefined) {
    if (paymentTermId === null) conditions.push("s.default_payment_term_id IS NULL");
    else {
      conditions.push("s.default_payment_term_id = ?");
      params.push(paymentTermId);
    }
  }
  if (updatedFrom !== undefined) {
    conditions.push("s.updated_at >= ?");
    params.push(updatedFrom);
  }
  if (updatedTo !== undefined) {
    conditions.push("s.updated_at <= ?");
    params.push(updatedTo);
  }
  if (createdFrom !== undefined) {
    conditions.push("s.created_at >= ?");
    params.push(createdFrom);
  }
  if (createdTo !== undefined) {
    conditions.push("s.created_at <= ?");
    params.push(createdTo);
  }
  // 「缺少」同 completeness warning 用同一個定義（ORDERS_CONTACT_MISSING、ORDERING_ADDRESS_MISSING）。
  // 停用聯絡人會清走佢嘅 primary（SupplierContactService.deactivate），所以 primary slot 一定係啟用中嘅聯絡人，
  // 唔使再 join supplier_contacts（HD-107；計時見 performance_report.md）。
  if (missingPrimaryContact) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM supplier_contact_purposes cp
      WHERE cp.supplier_id = s.id AND cp.purpose_code = 'orders' AND cp.primary_slot = 1)`);
  }
  if (missingAddress) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM supplier_address_purposes ap
      JOIN supplier_addresses a ON a.id = ap.address_id AND a.supplier_id = ap.supplier_id
      WHERE ap.supplier_id = s.id AND ap.purpose_code = 'ordering' AND a.status = 'active')`);
  }
  if (missingBank) {
    conditions.push("NOT EXISTS (SELECT 1 FROM supplier_bank_accounts b WHERE b.supplier_id = s.id AND b.status = 'active')");
  }

  const search = String(q ?? "").normalize("NFKC").trim();
  let exactCodeKey = null;
  if (search) {
    exactCodeKey = search.toLowerCase();
    const condition = supplierSearchCondition(search);
    conditions.push(`(${condition.sql})`);
    params.push(...condition.params);
  }

  const direction = descending ? "DESC" : "ASC";
  const exactOrder = exactCodeKey ? "CASE WHEN s.supplier_code_key = ? THEN 0 ELSE 1 END, " : "";
  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
    orderBy: `${exactOrder}${supplierSortColumn(sortBy)} ${direction}, s.id ${direction}`,
    orderParams: exactCodeKey ? [exactCodeKey] : []
  };
}

function requireReason(value, message = "這項修改必須填寫原因") {
  const reason = String(value ?? "").trim();
  if (reason.length < 5 || reason.length > 500) {
    throw invalidSupplierInput("SUPPLIER_REASON_REQUIRED", message, { field: "reason" });
  }
  return reason;
}

/** 建立同更新共用嘅欄位正規化；錯就拋 domain 錯誤。 */
function updateFields(input) {
  return {
    name: normalizeSupplierName(input.supplierName),
    displayName: normalizeSupplierOptionalText(input.displayName, { field: "displayName", maxLength: 190 }),
    website: normalizeSupplierUrl(input.website),
    email: normalizeContactEmail(input.generalEmail),
    generalPhone: normalizeSupplierOptionalText(input.generalPhone, { field: "generalPhone", maxLength: 50 }),
    notes: normalizeSupplierOptionalText(input.notes, { field: "notes", maxLength: 2000 })
  };
}

function createFields(input) {
  const writable = {
    supplierCode: input.supplierCode,
    supplierName: input.supplierName,
    displayName: input.displayName,
    defaultCurrencyCode: input.defaultCurrencyCode,
    defaultCurrencyVersion: input.defaultCurrencyVersion,
    defaultPaymentTermId: input.defaultPaymentTermId,
    defaultPaymentTermVersion: input.defaultPaymentTermVersion,
    website: input.website,
    generalPhone: input.generalPhone,
    generalEmail: input.generalEmail,
    notes: input.notes,
    activate: input.activate
  };
  assertKnownSupplierFields(Object.fromEntries(Object.entries(writable).filter(([, value]) => value !== undefined)));
  return { code: normalizeSupplierCode(input.supplierCode), ...updateFields(input) };
}

function assertExpectedVersion(current, expected) {
  if (Number(current.version) !== Number(expected)) {
    throw supplierConflict("VERSION_CONFLICT", "供應商已被其他人修改，請重新載入");
  }
}

export class SupplierAdminService {
  constructor({
    database,
    logger,
    time,
    businessMaster,
    authorize = assertActorFresh,
    duplicates,
    duplicateNameThreshold,
    replaceNameGrams = replaceSupplierNameGrams,
    audit,
    references,
    openFlows,
    approvalRequired = async () => false,
    approvals
  } = {}) {
    if (!database || !logger || !time || !businessMaster) {
      throw new TypeError("SupplierAdminService requires database, logger, time and businessMaster");
    }
    this.database = database;
    this.businessMaster = businessMaster;
    this.authorize = authorize;
    // 相似名稱門檻跟設定 SUPPLIER_DUPLICATE_NAME_THRESHOLD（DEF-030，HD-116 A）；冇提供就係類別預設 0.85。
    this.duplicates = duplicates ?? new SupplierDuplicateCandidates(duplicateNameThreshold === undefined ? {} : { threshold: duplicateNameThreshold });
    this.replaceNameGrams = replaceNameGrams;
    this.logger = logger;
    this.audit = audit ?? new SupplierAuditLogService({ database, logger, time });
    this.references = references ?? new SupplierReferenceService();
    this.openFlows = openFlows ?? new SupplierReferenceService();
    this.approvalRequired = approvalRequired;
    this.approvals = approvals ?? new SupplierApprovalService({ database, logger, time, audit: this.audit, businessMaster });
    this.time = time;
  }

  async createSupplier(input) {
    // 喺開 transaction 之前驗輸入，錯咗唔使掂資料庫；helper 入面會再做一次。
    const { name } = createFields(input);
    // 相似名稱只係提示：喺 transaction 之外做，唔好令 currencies 嘅鎖揸住成個查詢（T50，HD-084）。
    const duplicateCandidates = await this.duplicates.find(this.database, { nameKey: name.key });
    let created;
    try {
      created = await retryOnceOnDeadlock(() => this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, {
          actorId: input.actorId,
          claimedRoles: input.claimedRoles,
          claimedPermissions: input.claimedPermissions
        });
        return this.createSupplierInTransaction(connection, { actor, input, findDuplicates: false,
          warnedDuplicates: duplicateCandidates });
      }), { logger: this.logger, operation: "supplier.create", requestId: input.requestId });
    } catch (error) {
      if (duplicateEntry(error)) {
        throw supplierConflict("SUPPLIER_CODE_TAKEN", "這個 Supplier Code 已被使用", { supplierCode: normalizeSupplierCode(input.supplierCode).value });
      }
      throw error;
    }

    const [[row]] = await this.database.query("SELECT * FROM suppliers WHERE id = ?", [created.id]);
    if (!row) throw supplierNotFound(created.id);
    // 啱啱新增：仲未有任何地址、聯絡人、識別資料或銀行帳戶，所以全部提示。
    const warnings = supplierCompletenessWarnings({ defaultPaymentTermId: row.default_payment_term_id, hasBankAccount: false });
    return { ...toSupplierDetailResponse(row, { warnings }), duplicateCandidates };
  }

  /**
   * 建立嘅核心，喺 caller 嘅 transaction 入面做（CSV 匯入同 Supplier、marker 一齊 commit，HD-060 2A）。
   *
   * - `actor`：已經驗過嘅 `{ username }`。
   * - `approvalRequired(connection)`：預設讀設定（`FOR SHARE`）；匯入用 confirm 嗰陣嘅 snapshot（AC-013）。
   * - `addChildren(supplierId)`：Supplier 插入之後、開審批申請之前寫子資料，所以申請嘅 snapshot 包括
   *   同一次建立嘅 Identifier。
   * - `warnedDuplicates`：transaction 之前已經警告過嘅相似名稱候選；寫入 create Audit（DEF-039、HD-132 B）。
   *
   * 回 `{ id, duplicateCandidates }`。
   */
  async createSupplierInTransaction(connection, { actor, input, approvalRequired = this.approvalRequired, addChildren = null,
    findDuplicates = true, warnedDuplicates = null }) {
    const { code, name, displayName, website, email, generalPhone, notes } = createFields(input);
    // 設計 2.6 嘅鎖序由 settings 行先，政策讀取（settings 嘅 S 鎖）喺 Business Master 鎖 currencies 之前。
    // 當時 currencies 係 X 鎖：createSupplier 係 currencies -> settings、#changeStatus 係 settings -> currencies，
    // 夾埋一個等緊 settings X 嘅 updateSettings 就砌成三方循環，實測會 ER_LOCK_DEADLOCK（REV-023）。
    // PR #244 之後 Business Master 改用 S 鎖，呢個循環未重新量度過，所以次序照舊。
    const activationRequested = Boolean(input.activate);
    const needsApproval = activationRequested && await approvalRequired(connection);
    const defaults = await this.businessMaster.assertSupplierDefaultsInTransaction(connection, {
      currencyCode: input.defaultCurrencyCode,
      currencyVersion: input.defaultCurrencyVersion,
      paymentTermId: input.defaultPaymentTermId ?? null,
      paymentTermVersion: input.defaultPaymentTermVersion,
      purpose: "new_assignment"
    });
    const [[existing]] = await connection.query(
      "SELECT id FROM suppliers WHERE supplier_code_key = ? LIMIT 1",
      [code.key]
    );
    if (existing) {
      throw supplierConflict("SUPPLIER_CODE_TAKEN", "這個 Supplier Code 已被使用", { supplierCode: code.value });
    }
    // 匯入唔用相似名稱（HD-052：只警告完全相同；HD-075）：佢嘅成本隨 Supplier 數目上升，一個 10,000 列嘅檔做唔完。
    const duplicateCandidates = findDuplicates ? await this.duplicates.find(connection, { nameKey: name.key }) : [];
    const duplicateCodes = (warnedDuplicates ?? duplicateCandidates).map((candidate) => candidate.supplierCode);
    // 設計 4.4：設定開啟時 draft -> pending_approval，關閉時 draft -> active。
    // 政策喺提交嗰一刻讀一次並且 snapshot 落 request，所以之後改設定唔追溯。
    if (!needsApproval && input.approverUserId !== undefined && input.approverUserId !== null) {
      throw invalidSupplierInput("APPROVER_NOT_REQUIRED", "目前設定不需要指定審批人", { field: "approverUserId" });
    }
    if (activationRequested) {
      assertSupplierActivatable({
        supplierCode: code.value,
        supplierName: name.value,
        status: "draft",
        defaultCurrency: defaults.currency
      });
    }
    const status = activationRequested ? (needsApproval ? "pending_approval" : "active") : "draft";
    const nowMs = this.time.nowMs();
    let result;
    try {
      [result] = await connection.execute(
        `INSERT INTO suppliers
          (supplier_code, supplier_code_key, supplier_name, supplier_name_key, display_name,
           default_currency_code, default_payment_term_id, website, general_phone, general_email,
           notes, status, version, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [
          code.value, code.key, name.value, name.key, displayName,
          defaults.currency.code, defaults.paymentTerm?.id ?? null, website,
          generalPhone, email.value, notes,
          status, nowMs, nowMs, input.actorId, input.actorId
        ]
      );
    } catch (error) {
      // 同一個 transaction 入面撞 unique：轉做 domain 錯誤，唔好俾 caller 包成 500。
      if (duplicateEntry(error)) throw supplierConflict("SUPPLIER_CODE_TAKEN", "這個 Supplier Code 已被使用", { supplierCode: code.value });
      throw error;
    }
    const id = Number(result.insertId);
    await this.replaceNameGrams(connection, id, name.key);
    if (addChildren) await addChildren(id);
    if (needsApproval) {
      const [identifiers] = await connection.query(
        "SELECT identifier_type, issuer_country_code, identifier_value FROM supplier_identifiers WHERE supplier_id = ? ORDER BY id",
        [id]
      );
      await this.approvals.openRequest(connection, {
        supplierId: id,
        supplierVersion: 1,
        actorId: input.actorId,
        actorUsername: actor.username,
        approverUserId: input.approverUserId,
        summary: buildApprovalSummary({
          supplier_code: code.value, supplier_name: name.value, display_name: displayName,
          default_currency_code: defaults.currency.code, default_payment_term_id: defaults.paymentTerm?.id ?? null
        }, identifiers),
        requestNote: input.requestNote,
        requestId: input.requestId,
        ip: input.ip
      });
    }
    await this.audit.record(connection, {
      actorUserId: input.actorId,
      actorUsername: actor.username,
      action: "supplier.create",
      targetType: "supplier",
      targetId: id,
      supplierId: id,
      targetLabel: code.value,
      detail: {
        after: { status, currencyCode: defaults.currency.code, paymentTermId: defaults.paymentTerm?.id ?? null },
        // AC-003：建立時有相似名稱候選，使用者確認咗先繼續；Audit 記低係邊幾個（DEF-039、HD-132 B）。
        ...(duplicateCodes.length ? { warnings: { duplicateCandidates: duplicateCodes } } : {})
      },
      requestId: input.requestId,
      ip: input.ip
    });
    return { id, duplicateCandidates };
  }

  async updateSupplier(input) {
    if (Object.hasOwn(input, "supplierCode")) {
      throw supplierConflict("SUPPLIER_CODE_CHANGE_REQUIRED", "Supplier Code 只能透過受控修正功能修改");
    }
    // 喺開 transaction 之前驗輸入；helper 入面會再做一次。
    const { name } = updateFields(input);
    // 同 createSupplier 一樣喺 transaction 之外做（T50，HD-084）。
    const duplicateCandidates = (await this.duplicates.find(this.database, { nameKey: name.key }))
      .filter((candidate) => Number(candidate.supplierId) !== Number(input.id));
    let outcome;
    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, {
        actorId: input.actorId,
        claimedRoles: input.claimedRoles,
        claimedPermissions: input.claimedPermissions
      });
      outcome = await this.updateSupplierInTransaction(connection, { actor, input, findDuplicates: false });
    });

    const detail = await this.getSupplier({
      actorId: input.actorId,
      claimedRoles: input.claimedRoles,
      claimedPermissions: input.claimedPermissions,
      id: input.id
    });
    return { ...detail, ...outcome, duplicateCandidates };
  }

  /**
   * 更新嘅核心，喺 caller 嘅 transaction 入面做（HD-060 2A）。`input` 要帶齊所有一般欄位同
   * `version`；回 `{ duplicateCandidates, approvalInvalidated }`。
   */
  async updateSupplierInTransaction(connection, { actor, input, findDuplicates = true }) {
    const { name, displayName, website, email, generalPhone, notes } = updateFields(input);
    let approvalInvalidated = false;
    const [[current]] = await connection.query("SELECT * FROM suppliers WHERE id = ? FOR UPDATE", [input.id]);
    if (!current) throw supplierNotFound(input.id);
    assertExpectedVersion(current, input.version);
    if (current.status === "archived") {
      throw supplierConflict("SUPPLIER_UPDATE_NOT_ALLOWED", "已封存供應商不可修改一般資料", { status: current.status });
    }

    const defaults = await this.businessMaster.assertSupplierDefaultsInTransaction(connection, {
      currencyCode: input.defaultCurrencyCode,
      currencyVersion: input.defaultCurrencyVersion,
      paymentTermId: input.defaultPaymentTermId ?? null,
      paymentTermVersion: input.defaultPaymentTermVersion,
      purpose: "new_assignment"
    });
    const currencyChanged = current.default_currency_code !== defaults.currency.code;
    const reason = currencyChanged ? requireReason(input.reason, "修改預設幣別必須填寫原因") : String(input.reason ?? "").trim();
    const duplicateCandidates = findDuplicates
      ? (await this.duplicates.find(connection, { nameKey: name.key })).filter((candidate) => Number(candidate.supplierId) !== Number(input.id))
      : [];
    const nowMs = this.time.nowMs();
    const next = {
      supplierName: name.value,
      displayName,
      defaultCurrencyCode: defaults.currency.code,
      defaultPaymentTermId: defaults.paymentTerm?.id ?? null,
      website,
      generalPhone,
      generalEmail: email.value,
      notes
    };
    const [result] = await connection.execute(
      `UPDATE suppliers
          SET supplier_name = ?, supplier_name_key = ?, display_name = ?, default_currency_code = ?,
              default_payment_term_id = ?, website = ?, general_phone = ?, general_email = ?, notes = ?,
              version = version + 1, updated_at = ?, updated_by = ?
        WHERE id = ? AND version = ?`,
      [
        next.supplierName, name.key, next.displayName, next.defaultCurrencyCode,
        next.defaultPaymentTermId, next.website, next.generalPhone, next.generalEmail, next.notes,
        nowMs, input.actorId, input.id, input.version
      ]
    );
    if (result.affectedRows === 0) throw supplierConflict("VERSION_CONFLICT", "供應商已被其他人修改，請重新載入");
    if (current.supplier_name_key !== name.key) await this.replaceNameGrams(connection, input.id, name.key);
    // 設計 4.5：Pending 期間改動任何 approval-significant 欄位，原申請即時失效、
    // Supplier 回 draft，全部喺同一個交易入面，再回 approvalInvalidated: true。
    // Address／Contact／Notes／Bank 唔喺內，所以佢哋改動唔會令申請失效。
    if (current.status === "pending_approval") {
      const changedSignificant = SIGNIFICANT_UPDATE_FIELDS
        .filter(([field]) => String(current[field] ?? "") !== String(next[NEXT_FIELD_NAMES[field]] ?? ""))
        .map(([, name_]) => name_);
      if (changedSignificant.length > 0) {
        await this.approvals.invalidateForSignificantChange(connection, {
          supplierId: input.id,
          actorId: input.actorId,
          actorUsername: actor.username,
          supplierCode: current.supplier_code,
          changedFields: changedSignificant,
          reason,
          requestId: input.requestId,
          ip: input.ip
        });
        approvalInvalidated = true;
      } else {
        // 唔顯著嘅改動唔會令申請失效，但 version 已經 bump 咗，所以要同步返
        // request 記住嗰個 version，否則佢會永遠 stale。
        await this.approvals.syncOpenRequestSupplierVersion(connection, {
          supplierId: input.id,
          supplierVersion: Number(current.version) + 1
        });
      }
    }
    await this.audit.record(connection, {
      actorUserId: input.actorId,
      actorUsername: actor.username,
      action: "supplier.update",
      targetType: "supplier",
      targetId: input.id,
      supplierId: input.id,
      targetLabel: current.supplier_code,
      reason,
      detail: changedFieldsDetail({
        supplierName: current.supplier_name,
        displayName: current.display_name,
        defaultCurrencyCode: current.default_currency_code,
        defaultPaymentTermId: current.default_payment_term_id === null ? null : Number(current.default_payment_term_id),
        website: current.website,
        generalPhone: current.general_phone,
        generalEmail: current.general_email,
        notes: current.notes
      }, next),
      requestId: input.requestId,
      ip: input.ip
    });
    return { duplicateCandidates, approvalInvalidated };
  }

  async changeSupplierCode(input) {
    const code = normalizeSupplierCode(input.supplierCode);
    const reason = requireReason(input.reason, "修正 Supplier Code 必須填寫原因");
    let codeApprovalInvalidated = false;
    try {
      await retryOnceOnDeadlock(() => this.database.withTransaction(async (connection) => {
        // 重做嗰次由頭計（REV-104 M-1）。
        codeApprovalInvalidated = false;
        const actor = await this.authorize(connection, {
          actorId: input.actorId,
          claimedRoles: input.claimedRoles,
          claimedPermissions: input.claimedPermissions
        });
        const [[current]] = await connection.query("SELECT * FROM suppliers WHERE id = ? FOR UPDATE", [input.id]);
        if (!current) throw supplierNotFound(input.id);
        assertExpectedVersion(current, input.version);
        if (current.status === "archived") {
          throw supplierConflict("SUPPLIER_UPDATE_NOT_ALLOWED", "已封存供應商不可修正 Supplier Code", { status: current.status });
        }
        const referenceSummary = await this.references.describeReferences(connection, input.id);
        if (referenceSummary.total !== 0) {
          throw supplierConflict("SUPPLIER_REFERENCED", "供應商已有引用，不可修改 Supplier Code", referenceSummary);
        }
        const nowMs = this.time.nowMs();
        const [result] = await connection.execute(
          `UPDATE suppliers
              SET supplier_code = ?, supplier_code_key = ?, version = version + 1, updated_at = ?, updated_by = ?
            WHERE id = ? AND version = ?`,
          [code.value, code.key, nowMs, input.actorId, input.id, input.version]
        );
        if (result.affectedRows === 0) throw supplierConflict("VERSION_CONFLICT", "供應商已被其他人修改，請重新載入");
        await this.audit.record(connection, {
          actorUserId: input.actorId,
          actorUsername: actor.username,
          action: "supplier.code.change",
          targetType: "supplier",
          targetId: input.id,
          supplierId: input.id,
          targetLabel: code.value,
          reason,
          detail: { before: { supplierCode: current.supplier_code }, after: { supplierCode: code.value } },
          requestId: input.requestId,
          ip: input.ip
        });
        // 設計 4.5 將 Supplier Code 排第一位；AC-012 亦點名咗佢。冇呢段，改完 code
        // 之後個申請會卡死：snapshot 對唔上所以批唔到，Supplier 仲留喺
        // pending_approval 所以又重新提交唔到。
        if (current.status === "pending_approval") {
          await this.approvals.invalidateForSignificantChange(connection, {
            supplierId: input.id,
            actorId: input.actorId,
            actorUsername: actor.username,
            supplierCode: current.supplier_code,
            changedFields: ["supplierCode"],
            reason,
            requestId: input.requestId,
            ip: input.ip
          });
          codeApprovalInvalidated = true;
        }
      }), { logger: this.logger, operation: "supplier.code.change", requestId: input.requestId });
    } catch (error) {
      if (duplicateEntry(error)) {
        throw supplierConflict("SUPPLIER_CODE_TAKEN", "這個 Supplier Code 已被使用", { supplierCode: code.value });
      }
      throw error;
    }

    const detail = await this.getSupplier({
      actorId: input.actorId,
      claimedRoles: input.claimedRoles,
      claimedPermissions: input.claimedPermissions,
      id: input.id
    });
    return { ...detail, approvalInvalidated: codeApprovalInvalidated };
  }

  async #changeStatus(input, commandName) {
    const command = LIFECYCLE_COMMANDS[commandName];
    if (!command) throw new TypeError(`Unknown supplier lifecycle command: ${commandName}`);
    const { targetStatus, allowedFrom, action, activationCheck = false, approvalCheck = false, openFlowCheck = false } = command;
    const reason = action === "supplier.activate" ? "" : requireReason(input.reason);
    await this.database.withTransaction(async (connection) => {
      const actor = await this.authorize(connection, {
        actorId: input.actorId,
        claimedRoles: input.claimedRoles,
        claimedPermissions: input.claimedPermissions
      });
      // Design 2.6 fixes the lock order as settings -> suppliers -> requests ->
      // child -> audit. The policy read takes a settings lock, so it belongs before
      // the row lock below even though the answer is not needed until further down.
      const approvalIsRequired = approvalCheck ? await this.approvalRequired(connection) : false;
      const [[current]] = await connection.query("SELECT * FROM suppliers WHERE id = ? FOR UPDATE", [input.id]);
      if (!current) throw supplierNotFound(input.id);
      const routeToApproval = approvalCheck && approvalIsRequired;
      const effectiveTargetStatus = routeToApproval ? "pending_approval" : targetStatus;
      // 兩個都算「已經到咗」：policy 開咗之後，一個喺 policy 關閉期間已經 active
      // 嘅 Supplier 收到重送嘅 activate，一樣要回現況而唔係 409。
      if (current.status === effectiveTargetStatus || current.status === targetStatus) {
        const [[latestTransition]] = await connection.query(
          `SELECT action FROM supplier_audit_logs WHERE supplier_id = ? AND action IN (${LIFECYCLE_ACTIONS.map(() => "?").join(", ")}) ORDER BY id DESC LIMIT 1`,
          [input.id, ...LIFECYCLE_ACTIONS]
        );
        if (latestTransition?.action === action) return;
        throw supplierConflict("STATUS_TRANSITION_INVALID", "目前供應商狀態不允許這項操作", { from: current.status, to: effectiveTargetStatus });
      }
      assertExpectedVersion(current, input.version);
      if (!allowedFrom.includes(current.status)) {
        throw supplierConflict("STATUS_TRANSITION_INVALID", "目前供應商狀態不允許這項操作", { from: current.status, to: effectiveTargetStatus });
      }
      transitionSupplierStatus(current.status, targetStatus);

      if (approvalCheck && !approvalIsRequired && input.approverUserId !== undefined && input.approverUserId !== null) {
        throw invalidSupplierInput("APPROVER_NOT_REQUIRED", "目前設定不需要指定審批人", { field: "approverUserId" });
      }
      // 設計 4.4：設定開啟時 activate 唔會直接去 active，而係開一個申請並轉
      // pending_approval。轉換合法性喺上面已經由 transitionSupplierStatus 檢查過
      // draft -> active；draft -> pending_approval 亦係合法邊。
      if (routeToApproval) transitionSupplierStatus(current.status, effectiveTargetStatus);
      if (activationCheck) {
        const defaults = await this.businessMaster.assertSupplierDefaultsInTransaction(connection, {
          currencyCode: current.default_currency_code,
          paymentTermId: current.default_payment_term_id,
          purpose: "new_assignment"
        });
        assertSupplierActivatable({
          supplierCode: current.supplier_code,
          supplierName: current.supplier_name,
          status: current.status,
          defaultCurrency: defaults.currency
        });
      }
      if (openFlowCheck) {
        const blockers = await this.openFlows.describeReferences(connection, input.id);
        if (blockers.total !== 0) {
          throw supplierConflict("SUPPLIER_OPEN_FLOWS", "供應商仍有未完成流程，不可封存", blockers);
        }
      }

      const [result] = await connection.execute(
        `UPDATE suppliers
            SET status = ?, version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND version = ?`,
        [effectiveTargetStatus, this.time.nowMs(), input.actorId, input.id, input.version]
      );
      if (result.affectedRows === 0) throw supplierConflict("VERSION_CONFLICT", "供應商已被其他人修改，請重新載入");
      if (routeToApproval) {
        const [identifiers] = await connection.query(
          "SELECT identifier_type, issuer_country_code, identifier_value FROM supplier_identifiers WHERE supplier_id = ?",
          [input.id]
        );
        await this.approvals.openRequest(connection, {
          supplierId: input.id,
          supplierVersion: Number(current.version) + 1,
          actorId: input.actorId,
          actorUsername: actor.username,
          approverUserId: input.approverUserId,
          summary: buildApprovalSummary(current, identifiers),
          requestNote: input.requestNote ?? input.reason,
          requestId: input.requestId,
          ip: input.ip
        });
      }
      await this.audit.record(connection, {
        actorUserId: input.actorId,
        actorUsername: actor.username,
        action,
        targetType: "supplier",
        targetId: input.id,
        supplierId: input.id,
        targetLabel: current.supplier_code,
        reason,
        detail: { before: { status: current.status }, after: { status: effectiveTargetStatus } },
        requestId: input.requestId,
        ip: input.ip
      });
    });
    return this.getSupplier({
      actorId: input.actorId,
      claimedRoles: input.claimedRoles,
      claimedPermissions: input.claimedPermissions,
      id: input.id
    });
  }

  activateSupplier(input) {
    return this.#changeStatus(input, "activate");
  }

  suspendSupplier(input) {
    return this.#changeStatus(input, "suspend");
  }

  reactivateSupplier(input) {
    return this.#changeStatus(input, "reactivate");
  }

  blockSupplier(input) {
    return this.#changeStatus(input, "block");
  }

  unblockSupplier(input) {
    return this.#changeStatus(input, "unblock");
  }

  archiveSupplier(input) {
    return this.#changeStatus(input, "archive");
  }

  restoreSupplier(input) {
    return this.#changeStatus(input, "restore");
  }

  async deleteSupplier(input) {
    const reason = requireReason(input.reason);
    try {
      await this.database.withTransaction(async (connection) => {
        const actor = await this.authorize(connection, {
          actorId: input.actorId,
          claimedRoles: input.claimedRoles,
          claimedPermissions: input.claimedPermissions
        });
        const [[current]] = await connection.query("SELECT * FROM suppliers WHERE id = ? FOR UPDATE", [input.id]);
        if (!current) throw supplierNotFound(input.id);
        assertExpectedVersion(current, input.version);
        const referenceSummary = await this.references.describeReferences(connection, input.id);
        assertSupplierDeletable(current.status, referenceSummary);
        const [[activeHistory]] = await connection.query(
          "SELECT 1 AS present FROM supplier_audit_logs WHERE supplier_id = ? AND action IN ('supplier.activate', 'approval.approve') LIMIT 1",
          [input.id]
        );
        if (activeHistory) {
          throw supplierConflict("SUPPLIER_DELETE_NOT_ALLOWED", "曾經啟用的供應商不可永久刪除");
        }
        const [result] = await connection.execute("DELETE FROM suppliers WHERE id = ? AND version = ?", [input.id, input.version]);
        if (result.affectedRows === 0) throw supplierConflict("VERSION_CONFLICT", "供應商已被其他人修改，請重新載入");
        await this.audit.record(connection, {
          actorUserId: input.actorId,
          actorUsername: actor.username,
          action: "supplier.delete",
          targetType: "supplier",
          targetId: input.id,
          supplierId: input.id,
          targetLabel: current.supplier_code,
          reason,
          detail: { before: { status: current.status }, after: { deleted: true } },
          requestId: input.requestId,
          ip: input.ip
        });
      });
    } catch (error) {
      // this.references only reports the child tables whose checkers a caller
      // actually registered, so a RESTRICT foreign key the checker set does not
      // cover still reaches the DELETE. Report it as the same domain conflict
      // instead of letting the driver error surface as a 500.
      if (referencedRow(error)) {
        throw supplierConflict("SUPPLIER_REFERENCED", "供應商已有引用，不可永久刪除");
      }
      throw error;
    }
    return { id: input.id };
  }

  async listSuppliers({
    actorId,
    claimedRoles,
    claimedPermissions,
    page = 1,
    pageSize = 20,
    q = "",
    status,
    currencyCode,
    paymentTermId,
    updatedFrom,
    updatedTo,
    ...filters
  }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const { where, params, orderBy, orderParams } = supplierListQuery({ q, status, currencyCode, paymentTermId, updatedFrom, updatedTo, ...filters });
    const offset = (page - 1) * pageSize;
    const [countRows] = await this.database.query(`SELECT COUNT(*) AS total FROM suppliers s ${where}`, params);
    const listParams = [...params, ...orderParams, pageSize, offset];
    const [rows] = await this.database.query(
      `SELECT s.id, s.supplier_code, s.supplier_name, s.display_name,
              s.default_currency_code, s.default_payment_term_id, s.status, s.version, s.updated_at,
              (SELECT c.name
                 FROM supplier_contact_purposes cp
                 JOIN supplier_contacts c ON c.id = cp.contact_id AND c.supplier_id = cp.supplier_id
                WHERE cp.supplier_id = s.id AND cp.purpose_code = 'orders' AND cp.primary_slot = 1
                  AND c.status = 'active'
                LIMIT 1) AS primary_contact_name
         FROM suppliers s ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
      listParams
    );
    // 列表顯示付款條件 code 同名稱，唔顯示內部 ID（DEF-040、HD-133 A）。
    const terms = await paymentTermsById(this.businessMaster, rows.map((row) => row.default_payment_term_id));
    const items = rows.map((row) => ({ ...toSupplierSummaryResponse(row),
      defaultPaymentTerm: row.default_payment_term_id === null ? null : terms.get(Number(row.default_payment_term_id)) ?? null }));
    return { items, total: Number(countRows[0].total), page, pageSize };
  }

  /** detail 最多帶 100 筆地址同聯絡人；再多就用呢兩個分頁讀（design：GET .../contacts／addresses，PARTY-009，HD-107）。 */
  async listSupplierAddresses({ actorId, claimedRoles, claimedPermissions, id, page = 1, pageSize = 20 }) {
    return this.#childPage("supplier_addresses", (offset) => this.#addresses(id, { limit: pageSize, offset }),
      { actorId, claimedRoles, claimedPermissions, id, page, pageSize });
  }

  async listSupplierContacts({ actorId, claimedRoles, claimedPermissions, id, page = 1, pageSize = 20 }) {
    return this.#childPage("supplier_contacts", (offset) => this.#contacts(id, { limit: pageSize, offset }),
      { actorId, claimedRoles, claimedPermissions, id, page, pageSize });
  }

  async #childPage(table, readPage, { actorId, claimedRoles, claimedPermissions, id, page, pageSize }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const [[supplier]] = await this.database.query("SELECT id FROM suppliers WHERE id = ?", [id]);
    if (!supplier) throw supplierNotFound(id);
    const [[{ total }]] = await this.database.query(`SELECT COUNT(*) AS total FROM ${table} WHERE supplier_id = ?`, [id]);
    return { items: await readPage((page - 1) * pageSize), total: Number(total), page, pageSize };
  }

  async #addresses(id, { limit, offset }) {
    const [rows] = await this.database.query(
      "SELECT * FROM supplier_addresses WHERE supplier_id = ? ORDER BY status, sort_order, id LIMIT ? OFFSET ?", [id, limit, offset]);
    const purposes = await this.#purposes("supplier_address_purposes", "address_id", id, rows);
    return rows.map((address) => toAddressResponse(address, purposes.get(Number(address.id)) ?? []));
  }

  async #contacts(id, { limit, offset }) {
    const [rows] = await this.database.query(
      "SELECT * FROM supplier_contacts WHERE supplier_id = ? ORDER BY status, sort_order, id LIMIT ? OFFSET ?", [id, limit, offset]);
    const purposes = await this.#purposes("supplier_contact_purposes", "contact_id", id, rows);
    return rows.map((contact) => toContactResponse(contact, purposes.get(Number(contact.id)) ?? []));
  }

  async #purposes(table, column, supplierId, rows) {
    const byOwner = new Map();
    if (rows.length === 0) return byOwner;
    const [purposeRows] = await this.database.query(
      `SELECT ${column}, purpose_code, is_primary FROM ${table}
        WHERE supplier_id = ? AND ${column} IN (${rows.map(() => "?").join(", ")}) ORDER BY ${column}, purpose_code`,
      [supplierId, ...rows.map((row) => row.id)]);
    for (const purpose of purposeRows) {
      const ownerId = Number(purpose[column]);
      if (!byOwner.has(ownerId)) byOwner.set(ownerId, []);
      byOwner.get(ownerId).push(purpose);
    }
    return byOwner;
  }

  async #completenessFlags(id) {
    const [[flags]] = await this.database.query(
      `SELECT EXISTS (SELECT 1 FROM supplier_addresses a
                JOIN supplier_address_purposes p ON p.address_id = a.id AND p.supplier_id = a.supplier_id
               WHERE a.supplier_id = ? AND a.status = 'active' AND p.purpose_code = 'ordering') AS has_ordering_address,
              EXISTS (SELECT 1 FROM supplier_contact_purposes cp
               WHERE cp.supplier_id = ? AND cp.purpose_code = 'orders' AND cp.primary_slot = 1) AS has_orders_contact`,
      [id, id]);
    return { hasOrderingAddress: Boolean(Number(flags.has_ordering_address)), hasOrdersContact: Boolean(Number(flags.has_orders_contact)) };
  }

  /** 有冇有效銀行帳戶：同列表 `missingBank` 篩選一樣嘅定義，只睇存在，唔讀任何帳戶內容。 */
  async #hasActiveBankAccount(id) {
    const [[bank]] = await this.database.query(
      "SELECT 1 AS present FROM supplier_bank_accounts WHERE supplier_id = ? AND status = 'active' LIMIT 1", [id]);
    return Boolean(bank);
  }

  async getSupplier({ actorId, claimedRoles, claimedPermissions, id }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const [[row]] = await this.database.query("SELECT * FROM suppliers WHERE id = ?", [id]);
    if (!row) throw supplierNotFound(id);
    const addresses = await this.#addresses(id, { limit: CHILD_DETAIL_LIMIT, offset: 0 });
    const contacts = await this.#contacts(id, { limit: CHILD_DETAIL_LIMIT, offset: 0 });
    // 讀滿上限即係可能仲有：嗰陣先問 DB，判斷先會同列表嘅「缺少」篩選一致（REV-094 L-2）。
    const truncated = addresses.length === CHILD_DETAIL_LIMIT || contacts.length === CHILD_DETAIL_LIMIT;
    const { hasOrderingAddress, hasOrdersContact } = truncated ? await this.#completenessFlags(id) : {
      hasOrderingAddress: addresses.some((address) => address.status === "active" && address.purposes.some((purpose) => purpose.purposeCode === "ordering")),
      hasOrdersContact: contacts.some((contact) => contact.status === "active" && contact.purposes.some((purpose) => purpose.purposeCode === "orders" && purpose.isPrimary))
    };
    const [identifierRows] = await this.database.query(
      "SELECT * FROM supplier_identifiers WHERE supplier_id = ? ORDER BY identifier_type, issuer_country_code, id LIMIT 100",
      [id]
    );
    const identifiers = identifierRows.map(toIdentifierResponse);
    // 經 provider 嘅 history 讀（包括已停用），唔直接讀 Business Master 嘅表（DEF-038、HD-130 A）。
    const term = row.default_payment_term_id === null ? null : await this.businessMaster.getPaymentTermHistory(Number(row.default_payment_term_id));
    return toSupplierDetailResponse(row, {
      defaultPaymentTerm: term ? { id: Number(term.id), code: term.code, name: term.name, status: term.status } : null,
      addresses,
      contacts,
      identifiers,
      warnings: supplierCompletenessWarnings({
        defaultPaymentTermId: row.default_payment_term_id,
        hasOrderingAddress,
        hasOrdersContact,
        hasIdentifier: identifiers.length > 0,
        hasBankAccount: await this.#hasActiveBankAccount(id)
      })
    });
  }

  async getSupplierCompleteness({ actorId, claimedRoles, claimedPermissions, id }) {
    await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const [[row]] = await this.database.query("SELECT * FROM suppliers WHERE id = ?", [id]);
    if (!row) throw supplierNotFound(id);
    const [[orderingAddress]] = await this.database.query(
      `SELECT 1 AS present
         FROM supplier_addresses a
         JOIN supplier_address_purposes p ON p.address_id = a.id AND p.supplier_id = a.supplier_id
        WHERE a.supplier_id = ? AND a.status = 'active' AND p.purpose_code = 'ordering'
        LIMIT 1`,
      [id]
    );
    const [[ordersContact]] = await this.database.query(
      `SELECT 1 AS present
         FROM supplier_contacts c
         JOIN supplier_contact_purposes p ON p.contact_id = c.id AND p.supplier_id = c.supplier_id
        WHERE c.supplier_id = ? AND c.status = 'active' AND p.purpose_code = 'orders' AND p.is_primary = 1
        LIMIT 1`,
      [id]
    );
    const [[identifier]] = await this.database.query(
      "SELECT 1 AS present FROM supplier_identifiers WHERE supplier_id = ? LIMIT 1",
      [id]
    );
    // 經 Business Master 嘅 provider 讀，唔直接讀佢嘅表（DEF-003，HD-116 A）。
    const currency = await this.businessMaster.getCurrencyHistory(row.default_currency_code);
    const issues = supplierActivatabilityIssues({
      supplierCode: row.supplier_code,
      supplierName: row.supplier_name,
      status: row.status,
      defaultCurrency: currency
    }).filter((issue) => row.status !== "active" || issue.code !== "STATUS_NOT_ACTIVATABLE");
    return {
      supplierId: Number(row.id),
      issues,
      warnings: supplierCompletenessWarnings({
        defaultPaymentTermId: row.default_payment_term_id,
        hasOrderingAddress: Boolean(orderingAddress),
        hasOrdersContact: Boolean(ordersContact),
        hasIdentifier: Boolean(identifier),
        hasBankAccount: await this.#hasActiveBankAccount(id)
      })
    };
  }

  async findSupplierDuplicateCandidates({ actorId, claimedRoles, claimedPermissions, supplierCode, supplierName }) {
    const code = normalizeSupplierCode(supplierCode);
    const name = normalizeSupplierName(supplierName);
    return this.database.withTransaction(async (connection) => {
      await this.authorize(connection, { actorId, claimedRoles, claimedPermissions });
      const [[existing]] = await connection.query(
        "SELECT id, supplier_code, supplier_name FROM suppliers WHERE supplier_code_key = ? LIMIT 1",
        [code.key]
      );
      const duplicateCandidates = await this.duplicates.find(connection, { nameKey: name.key });
      return {
        codeConflict: existing ? {
          supplierId: Number(existing.id),
          supplierCode: existing.supplier_code,
          supplierName: existing.supplier_name
        } : null,
        duplicateCandidates
      };
    });
  }
}
