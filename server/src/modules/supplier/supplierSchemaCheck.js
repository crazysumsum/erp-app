import { inspectSuppliersSchema } from "../../../database/migrations/0029_create_suppliers.js";
import { inspectSupplierNameGramsSchema } from "../../../database/migrations/0030_create_supplier_name_grams.js";
import { inspectSupplierAuditSchema } from "../../../database/migrations/0031_create_supplier_audit_logs.js";
import { inspectSupplierAddressSchema } from "../../../database/migrations/0032_create_supplier_addresses.js";
import { inspectSupplierContactSchema } from "../../../database/migrations/0033_create_supplier_contacts.js";
import { inspectSupplierIdentifierSchema } from "../../../database/migrations/0034_create_supplier_identifiers.js";
import { inspectSupplierActivationRequestSchema } from "../../../database/migrations/0035_create_supplier_activation_requests.js";
import { inspectSupplierSettingsSchema } from "../../../database/migrations/0036_create_supplier_settings.js";
import { inspectSupplierBankAccountSchema } from "../../../database/migrations/0037_create_supplier_bank_accounts.js";
import { inspectSupplierImportJobSchema } from "../../../database/migrations/0061_create_supplier_import_jobs.js";
import { inspectSupplierImportRowSchema } from "../../../database/migrations/0062_create_supplier_import_rows.js";
import { inspectSupplierSkuRelationSchema } from "../../../database/migrations/0081_create_supplier_sku_refs.js";

/**
 * 開機自我檢查（設計 §14.1 第 4 步；DEF-033、HD-121 A）。每張 Supplier table 都用佢 migration 自己嘅 contract
 * 核對（column、型別、NULL、collation、index、FK），再要 settings singleton 存在。Permission 由框架嘅 permission
 * catalogue 檢查，Bank key ring 由 config 驗證，兩樣本身已經會拒絕開機。
 *
 * 唔寫 DB：缺咗或者唔相容就照實講，由 operator 用 migrate.js 或者還原去修。
 */
const CONTRACTS = Object.freeze([
  ["suppliers", inspectSuppliersSchema],
  ["supplier_name_grams", inspectSupplierNameGramsSchema],
  ["supplier_audit_logs", inspectSupplierAuditSchema],
  ["supplier_addresses, supplier_address_purposes", inspectSupplierAddressSchema],
  ["supplier_contacts, supplier_contact_purposes", inspectSupplierContactSchema],
  ["supplier_identifiers", inspectSupplierIdentifierSchema],
  ["supplier_activation_requests", inspectSupplierActivationRequestSchema],
  ["supplier_settings", inspectSupplierSettingsSchema],
  ["supplier_bank_accounts", inspectSupplierBankAccountSchema],
  ["supplier_import_jobs", inspectSupplierImportJobSchema],
  ["supplier_import_rows", inspectSupplierImportRowSchema],
  ["supplier_sku_refs", (database) => inspectSupplierSkuRelationSchema(database, "supplier_sku_refs")],
  ["supplier_supply_events", (database) => inspectSupplierSkuRelationSchema(database, "supplier_supply_events")]
]);

/** 回 `{ missing, incompatible }`；兩個都空先算過。 */
export async function inspectSupplierSchema(database) {
  const missing = [];
  const incompatible = [];
  for (const [tables, inspect] of CONTRACTS) {
    try {
      if (await inspect(database) !== true) missing.push(tables);
    } catch (error) {
      incompatible.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!missing.includes("supplier_settings") && !incompatible.some((message) => message.includes("supplier_settings"))) {
    const [[row]] = await database.query("SELECT COUNT(*) AS n FROM supplier_settings WHERE id = 1");
    if (Number(row.n) !== 1) missing.push("supplier_settings row id = 1");
  }
  return { missing, incompatible };
}

export async function assertSupplierSchema(database) {
  const { missing, incompatible } = await inspectSupplierSchema(database);
  if (missing.length === 0 && incompatible.length === 0) return;
  throw new Error(`Supplier startup self-check failed. ${[
    missing.length ? `Missing: ${missing.join("; ")}.` : "",
    incompatible.length ? `Incompatible: ${incompatible.join("; ")}.` : ""
  ].filter(Boolean).join(" ")} Nothing was changed: run node scripts/migrate.js or restore the schema, then start again.`);
}
