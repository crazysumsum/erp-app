import { createHash } from "node:crypto";
import { permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { apError } from "./apErrors.js";

const invalid = (field) => apError("AP_INPUT_INVALID", { field });
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const AMOUNT = /^\d{1,15}(?:\.\d{1,4})?$/u;
const MAX_SEQUENCE = 999999;
const PREFIX = Object.freeze({ INVOICE: "APV", PAYMENT: "PMT", CREDIT_NOTE: "SCN", REFUND: "SRF" });

// ---- 輸入驗證：錯誤只帶欄位路徑，不帶值 ----

export function positiveId(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid(field);
  return value;
}

/** 只收小寫：Idempotency-Key 必須與 eventId 逐字相同。 */
export function eventId(value) {
  if (typeof value !== "string" || !EVENT_ID.test(value)) throw invalid("eventId");
  return value;
}

/** YYYY-MM-DD 而且是真實日子。 */
export function localDate(value, field) {
  const ms = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) ? Date.parse(`${value}T00:00:00.000Z`) : Number.NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw invalid(field);
  return value;
}

/** 按 code point 計長度；多行欄位容許 \t \n \r，其餘 control character 一律拒絕。 */
export function text(value, field, { minimum = 0, maximum, multiline = false }) {
  if (typeof value !== "string" || !value.isWellFormed()) throw invalid(field);
  const characters = [...value];
  if (characters.length < minimum || characters.length > maximum) throw invalid(field);
  for (const character of characters) {
    const code = character.codePointAt(0);
    if ((code < 32 && !(multiline && (code === 9 || code === 10 || code === 13))) || code === 127) throw invalid(field);
  }
  return value;
}

/** 作廢原因：trim 後 5～500 字。 */
export function reason(value, field = "reason") {
  if (typeof value !== "string") throw invalid(field);
  return text(value.trim(), field, { minimum: 5, maximum: 500, multiline: true });
}

/** Allowlist：未列明的欄位一律拒絕，所以 client 算的金額、狀態永遠進不來。 */
export function onlyFields(value, allowed, field = "body") {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw invalid(field);
  return value;
}

// ---- 金額：DECIMAL(19,4) 以萬分之一為單位的 BigInt，不經過 Number ----

/** 字串金額 → BigInt；`decimalPlaces` 是幣別小數位，超出的位數必須是 0。 */
export function amountUnits(value, field, decimalPlaces = 4) {
  if (typeof value !== "string" || !AMOUNT.test(value)) throw invalid(field);
  const [whole, fraction = ""] = value.split(".");
  if (/[1-9]/u.test(fraction.slice(decimalPlaces))) throw invalid(field);
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
}

/** 資料庫的 DECIMAL 字串 → BigInt。 */
export const storedUnits = (value) => amountUnits(String(value), "amount");

export function formatUnits(units) {
  const digits = units.toString().padStart(5, "0");
  return `${digits.slice(0, -4)}.${digits.slice(-4)}`;
}

// ---- 編號 ----

/** 年度流水號。年度取確認當刻的本地日期；取號時鎖該年該類的一列。 */
export async function nextDocumentNumber(tx, { documentType, time, nowMs }) {
  const year = Number(time.fileDate(time.at(nowMs)).slice(0, 4));
  await tx.execute(`INSERT INTO ap_document_sequences (document_type, business_year, updated_at) VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE document_type = document_type`, [documentType, year, nowMs]);
  const [[row]] = await tx.query("SELECT next_value FROM ap_document_sequences WHERE document_type = ? AND business_year = ? FOR UPDATE", [documentType, year]);
  const sequence = Number(row.next_value);
  if (sequence > MAX_SEQUENCE) throw apError("DOCUMENT_SEQUENCE_EXHAUSTED");
  await tx.execute("UPDATE ap_document_sequences SET next_value = next_value + 1, updated_at = ? WHERE document_type = ? AND business_year = ?", [nowMs, documentType, year]);
  return `${PREFIX[documentType]}-${year}-${String(sequence).padStart(6, "0")}`;
}

// ---- 命令流程 ----

/** Key 排序的 JSON：同一內容得同一 hash，與欄位次序無關。 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

/**
 * 一個命令一個 READ COMMITTED 交易：重驗操作者 → 以 event_id 取得操作列 → 業務寫入 → Audit → 保存結果。
 * 沒有「處理中」狀態：同一 event_id 的第二個請求會在唯一鍵上等第一個 commit 或 rollback；回應遺失後重送，原樣取回結果。
 * 會變的列一律以 FOR UPDATE 讀取，所以 READ COMMITTED 已足夠（Purchasing 的發票來源 reader 亦要求這個隔離級別）。
 */
export class ApCommandRunner {
  constructor({ database, time }) {
    if (!database || !time) throw new TypeError("ApCommandRunner requires database and time");
    Object.assign(this, { database, time });
  }

  /** `work(tx, { actor, nowMs })` 回 `{ summary, audit: { action, targetType, targetId, supplierId, label, reason?, detail } }`。 */
  async run({ claims, permission, commandType, targetType, targetId = 0, eventId: event, payload, context = {} }, work) {
    try {
      return await this.database.withTransaction(async (tx) => {
        const fresh = await assertActorFresh(tx, { actorId: Number(claims?.sub), claimedRoles: claims?.roles, claimedPermissions: claims?.permissions });
        if (!fresh.permissions.includes(permission)) throw permissionStaleError();
        const actor = { id: fresh.id, username: fresh.username, permissions: fresh.permissions }, nowMs = this.time.nowMs();
        const { operationId, replay } = await this.#claim(tx, { commandType, targetType, targetId, event, payload, actor, nowMs });
        if (replay) return { ...replay, replayed: true };

        const { summary, audit, changeAudits = [] } = await work(tx, { actor, nowMs });
        // Each changed receipt line gets its own bounded, immutable audit detail.
        const requestId = String(context.requestId ?? "").slice(0, 64);
        const correlationId = String(context.correlationId ?? "").slice(0, 64);
        const ip = String(context.ip ?? "").slice(0, 45);
        const audits = [audit, ...changeAudits].map((entry) => [
          nowMs, actor.id, actor.username, entry.action, "SUCCEEDED", entry.targetType, entry.targetId, entry.supplierId,
          entry.label ?? "", entry.reason ?? "", JSON.stringify(entry.detail), requestId, correlationId, ip
        ]);
        await tx.query(`INSERT INTO ap_audit_logs (occurred_at, actor_user_id, actor_label, action, outcome, target_type, target_id, supplier_id,
            target_label, reason, detail, request_id, correlation_id, ip) VALUES ?`, [audits]);
        await tx.execute("UPDATE ap_operation_requests SET result_summary = ?, completed_at = ? WHERE id = ?", [JSON.stringify(summary), nowMs, operationId]);
        return { ...summary, replayed: false };
      }, { isolationLevel: "READ COMMITTED" });
    } catch (error) {
      if (error.code === "DATABASE_TRANSACTION_INDETERMINATE") throw apError("TRANSACTION_OUTCOME_UNKNOWN");
      if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.cause?.code ?? error.code)) throw apError("CONCURRENT_OPERATION");
      throw error;
    }
  }

  async #claim(tx, { commandType, targetType, targetId, event, payload, actor, nowMs }) {
    const hash = createHash("sha256").update(JSON.stringify(canonical({ commandType, targetId, payload })), "utf8").digest("hex");
    try {
      const [row] = await tx.execute(`INSERT INTO ap_operation_requests (event_id, command_type, target_type, target_id, request_hash, actor_user_id, actor_label, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [event, commandType, targetType, targetId, hash, actor.id, actor.username, nowMs]);
      return { operationId: Number(row.insertId), replay: null };
    } catch (error) {
      if ((error?.cause?.code ?? error?.code) !== "ER_DUP_ENTRY") throw error;
      const [[row]] = await tx.query("SELECT id, request_hash, actor_user_id, result_summary, completed_at FROM ap_operation_requests WHERE event_id = ? FOR UPDATE", [event]);
      // 另一個操作者或另一份內容用同一個 event_id 都是衝突，不會把別人的結果回出去。
      if (!row || row.request_hash !== hash || Number(row.actor_user_id) !== actor.id || row.completed_at === null) throw apError("AP_EVENT_CONFLICT");
      return { operationId: Number(row.id), replay: typeof row.result_summary === "string" ? JSON.parse(row.result_summary) : row.result_summary };
    }
  }
}
