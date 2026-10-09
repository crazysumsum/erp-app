import { CustomerLookupService } from "../customer/CustomerLookupService.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { requireSalesActor, requireSalesWriteActor } from "./salesAuthorization.js";
import { salesError } from "./salesErrors.js";
import { ApplicationError } from "../../framework/errors/ApplicationError.js";

export function validateSalesLookupQuery(input = {}, kind) {
  const fields = ["q", "page", "pageSize", ...(kind === "skus" ? ["barcode", "currencyCode"] : [])];
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) throw salesError("SALES_INPUT_INVALID");
  const query = { ...input, q: input.q ?? "", page: input.page ?? 1, pageSize: input.pageSize ?? 20 };
  if (!Number.isSafeInteger(query.page) || query.page < 1 || ![10, 20, 50, 100].includes(query.pageSize) || !Number.isSafeInteger((query.page - 1) * query.pageSize)) throw salesError("SALES_INPUT_INVALID");
  for (const [field, limit] of [["q", 190], ["barcode", 190]]) if (query[field] !== undefined &&
    (typeof query[field] !== "string" || [...query[field]].length > limit || /[\p{Cc}]/u.test(query[field]))) throw salesError("SALES_INPUT_INVALID", { field });
  if (query.currencyCode !== undefined && (typeof query.currencyCode !== "string" || !/^[A-Z]{3}$/u.test(query.currencyCode))) throw salesError("SALES_INPUT_INVALID", { field: "currencyCode" });
  return query;
}
const prefix = value => `${value.trim().replace(/[!%_]/gu, match => `!${match}`)}%`;
const creditProjection = row => row ? { configured: true, creditLimit: row.credit_limit === null ? null : String(row.credit_limit),
  currencyCode: row.credit_currency_code, status: row.credit_status, policyVersion: Number(row.version) } :
  { configured: false, creditLimit: null, currencyCode: null, status: "not_configured", policyVersion: null };

export class SalesLookupService {
  constructor({ database, time, logger } = {}) { this.database = database; this.time = time; this.logger = logger; }
  async list({ claims, kind, input = {} }) {
    if (!["customers", "skus", "warehouses", "channels"].includes(kind)) throw new TypeError("Unknown Sales lookup kind");
    const query = validateSalesLookupQuery(input, kind);
    return this.database.withTransaction(async tx => {
      if (kind === "channels") {
        const actor = await requireSalesActor(tx, claims, "sales.import");
        if (!actor.permissions.includes("sales.view")) throw new ApplicationError("Sales view permission is required", { code: "FORBIDDEN", statusCode: 403 });
        // Initial controlled codes are a CSV go-live input (approved Design15.2); none are configured in P1.
        return { items: [], total: 0, page: query.page, pageSize: query.pageSize };
      }
      await requireSalesWriteActor(tx, claims);
      if (kind === "customers") return this.#customers(tx, query);
      if (kind === "skus") return this.#skus(tx, query);
      return this.#warehouses(tx, query);
    });
  }
  async #customers(tx, query) {
    const result = await new CustomerLookupService({ database: tx }).listActive({ ...query, purpose: "new_sale", atMs: this.time.nowMs() });
    const ids = result.items.map(row => row.customerId);
    const [credits] = ids.length ? await tx.query(`SELECT customer_id,credit_limit,credit_currency_code,credit_status,version FROM customer_credit_profiles WHERE customer_id IN (${ids.map(() => "?").join(",")})`, ids) : [[]];
    const items = result.items.map(row => ({ customerId: row.customerId, customerCode: row.customerCode, legalName: row.legalName, displayName: row.displayName,
      defaultCurrencyCode: row.defaultCurrencyCode, defaultPaymentTermId: row.defaultPaymentTermId, status: row.status, version: row.version,
      credit: creditProjection(credits.find(credit => Number(credit.customer_id) === row.customerId)) }));
    return { items, total: result.total, page: result.page, pageSize: result.pageSize };
  }
  async #skus(tx, query) {
    const result = await new ItemLookupService({ database: tx, time: this.time, logger: this.logger }).searchForSale({
      q: query.q, barcode: query.barcode, page: query.page, pageSize: query.pageSize, atMs: this.time.nowMs() });
    const items = result.items.map(sku => {
      return { skuId: sku.skuId, skuCode: sku.skuCode, skuName: sku.skuName, itemId: sku.itemId, itemName: sku.itemName, skuVersion: sku.skuVersion, itemVersion: sku.itemVersion,
        suggestedPrice: sku.suggestedPrice, priceCurrencyMatches: Boolean(sku.suggestedPrice && sku.suggestedPrice.currency === query.currencyCode),
        uoms: sku.uoms.filter(uom => uom.status === "active").map(uom => ({ skuUomId: uom.skuUomId, uomId: uom.uomId, uomCode: uom.uomCode, uomName: uom.uomName,
          toBaseFactor: uom.toBaseFactor, isDefaultSale: uom.isDefaultSale, isBase: uom.isBase })) };
    });
    return { items, total: result.total, page: result.page, pageSize: result.pageSize };
  }
  async #warehouses(tx, query) {
    const values = [], conditions = ["status='ACTIVE'"];
    if (query.q.trim()) { conditions.push("(warehouse_code LIKE ? ESCAPE '!' OR warehouse_name LIKE ? ESCAPE '!')"); values.push(prefix(query.q), prefix(query.q)); }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const [[count]] = await tx.query(`SELECT COUNT(*) AS total FROM inventory_warehouses ${where}`, values);
    const [rows] = await tx.query(`SELECT id,warehouse_code,warehouse_name FROM inventory_warehouses ${where} ORDER BY normalized_code,id LIMIT ? OFFSET ?`, [...values, query.pageSize, (query.page - 1) * query.pageSize]);
    return { items: rows.map(row => ({ id: Number(row.id), code: row.warehouse_code, name: row.warehouse_name })), total: Number(count.total), page: query.page, pageSize: query.pageSize };
  }
}
