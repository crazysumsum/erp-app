import { stringify } from "csv-stringify/sync";

import { assertActorFresh } from "../authorization/directoryLookups.js";
import { supplierListQuery } from "./SupplierAdminService.js";
import { SupplierAuditLogService } from "./SupplierAuditLogService.js";
import { supplierImportError } from "./supplierErrors.js";
import { SUPPLIER_CSV_STRINGIFY_OPTIONS, SUPPLIER_IMPORT_COLUMN_NAMES, guardSpreadsheetCell } from "./import/supplierCsvSchema.js";

/** 匯入範本 v1 欄名 → `suppliers` 欄（HD-067 2A）。地址、聯絡人、識別號三組留空，所以匯出嘅檔可以照樣用 upsert 匯返入。 */
const ROOT_COLUMNS = Object.freeze({
  supplierId: "id", supplierCode: "supplier_code", supplierName: "supplier_name", displayName: "display_name",
  defaultCurrencyCode: "default_currency_code", website: "website", generalPhone: "general_phone",
  generalEmail: "general_email", notes: "notes"
});

/**
 * 一般供應商匯出（T47；設計 §6.9；HD-067）。用列表嘅篩選同排序，直接回 CSV：唔開 job、唔存檔。
 * 只讀 `suppliers`，永遠唔讀 Bank 表（BR-028）；每次匯出記一條 `supplier.export` 稽核，只有篩選同列數。
 */
export class SupplierExportService {
  constructor({ database, time, logger = null, businessMaster, authorize = assertActorFresh, audit, maxRows = 10_000 }) {
    if (!database || !time || !businessMaster || !Number.isSafeInteger(maxRows) || maxRows < 1) {
      throw new TypeError("SupplierExportService requires database, time, businessMaster and maxRows");
    }
    this.database = database;
    this.time = time;
    this.businessMaster = businessMaster;
    this.authorize = authorize;
    this.audit = audit ?? new SupplierAuditLogService({ database, logger: logger ?? {}, time });
    this.maxRows = maxRows;
  }

  async exportCsv({ actorId, claimedRoles, claimedPermissions, filters = {}, requestId = "", ip = "" }) {
    const actor = await this.authorize(this.database, { actorId, claimedRoles, claimedPermissions });
    const { where, params, orderBy, orderParams } = supplierListQuery(filters);
    // 多攞一列就知超咗上限，唔使另外 COUNT。
    const [rows] = await this.database.query(
      `SELECT s.id, s.supplier_code, s.supplier_name, s.display_name, s.default_currency_code, s.default_payment_term_id,
              s.website, s.general_phone, s.general_email, s.notes
         FROM suppliers s ${where}
        ORDER BY ${orderBy}
        LIMIT ?`,
      [...params, ...orderParams, this.maxRows + 1]
    );
    if (rows.length > this.maxRows) {
      throw supplierImportError("SUPPLIER_EXPORT_TOO_LARGE", 422, `一次最多匯出 ${this.maxRows} 個供應商，請收窄篩選條件`);
    }

    // 付款條款經 Business Master provider 由 ID 攞 Code（停用咗嘅都攞到）；一個匯出通常得幾個唔同 ID。
    const termCodes = new Map();
    for (const id of new Set(rows.map((row) => row.default_payment_term_id).filter((id) => id !== null))) {
      termCodes.set(id, (await this.businessMaster.getPaymentTermHistory(Number(id)))?.code ?? "");
    }
    const records = rows.map((row) => SUPPLIER_IMPORT_COLUMN_NAMES.map((name) => {
      if (name === "paymentTermCode") return guardSpreadsheetCell(termCodes.get(row.default_payment_term_id) ?? "");
      return guardSpreadsheetCell(ROOT_COLUMNS[name] ? row[ROOT_COLUMNS[name]] : "");
    }));

    // 先砌好檔案先寫稽核：砌唔到就唔會有一條「已匯出」嘅紀錄（REV-075 I-3）。
    const content = stringify([SUPPLIER_IMPORT_COLUMN_NAMES, ...records], SUPPLIER_CSV_STRINGIFY_OPTIONS);
    await this.database.withTransaction((connection) => this.audit.record(connection, {
      actorUserId: actorId, actorUsername: actor.username, action: "supplier.export", targetType: "export",
      targetLabel: "suppliers", detail: { metadata: { filters }, count: rows.length }, requestId, ip
    }));
    const stamp = new Date(this.time.nowMs()).toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
    return { fileName: `suppliers-${stamp}.csv`, content, rowCount: rows.length };
  }
}
