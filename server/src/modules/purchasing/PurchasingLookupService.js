import { permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { ADDRESS, TRACKING } from "./PurchaseOrderService.js";
import { purchasingError } from "./purchasingErrors.js";

// ponytail: 每個清單最多 100 行、冇分頁，同 Supplier 表單選項一樣；太多就叫用戶收窄搜尋，真係唔夠先加分頁。
const MAX_ROWS = 100;
const prefix = (q) => `${q.replace(/[!%_]/gu, (match) => `!${match}`)}%`;
const pick = (source, fields) => Object.fromEntries(fields.map((field) => [field, source[field] ?? null]));

const toSupplier = (row) => pick(row, ["supplierId", "supplierCode", "supplierName", "displayName", "defaultCurrencyCode", "defaultPaymentTermId"]);
const toCurrency = (row) => pick(row, ["code", "name", "decimalPlaces"]);
const toPaymentTerm = (row) => pick(row, ["id", "code", "name", "calculationType", "dueDays"]);
function toSku(sku) {
  return { ...pick(sku, ["skuId", "skuCode", "skuName", "itemName", "inventoryTracked", "trackingPolicy", "minimumReceiptLifeDays"]),
    baseUomCode: sku.uoms.find((uom) => uom.isBase).uomCode,
    uoms: sku.uoms.filter((uom) => uom.status === "active").map((uom) => pick(uom, ["skuUomId", "uomCode", "uomName", "toBaseFactor", "isBase", "isDefaultPurchase"])) };
}
/** 同 PurchaseOrderService 儲存時嘅規則一樣；`searchForPurchase` 會出埋儲存會拒絕嘅 SKU，唔篩用戶揀咗先至知唔得。 */
const purchasable = (sku) => Boolean(sku?.usable && sku.inventoryTracked && TRACKING.includes(sku.trackingPolicy)
  && sku.uoms.some((uom) => uom.isBase) && sku.uoms.some((uom) => uom.status === "active"));

/** §5.5 同 HD-019：PO 表單嘅選項，全部只要 purchasing.mgmt（六個權限互不繼承）。只讀、唔鎖，提交時 service 會再驗。 */
export class PurchasingLookupService {
  constructor({ database, time, suppliers, items, businessMaster } = {}) {
    Object.assign(this, { database, time, supplierProvider: suppliers, itemProvider: items, businessMaster });
  }

  async suppliers({ claims, q = "", skuId }) {
    await this.#actor(claims);
    if (skuId) return { items: (await this.#forSku(skuId, q)).map(toSupplier) };
    // HD-019 3A：provider 冇唔帶 SKU 嘅搜尋，所以呢度只攞 ID，資格同內容由 provider 決定。status 只係唔好畀停用 Supplier 食咗行數上限。
    const term = q ? prefix(q) : null;
    const [rows] = await this.database.query(`SELECT id FROM suppliers WHERE status = 'active'${term
      ? " AND (supplier_code_key LIKE ? ESCAPE '!' OR supplier_name LIKE ? ESCAPE '!' OR display_name LIKE ? ESCAPE '!')" : ""}
      ORDER BY ${term ? "supplier_code_key = ? DESC, " : ""}supplier_name, id LIMIT ?`,
    [...(term ? [term.toLowerCase(), term, term, q.toLowerCase()] : []), MAX_ROWS]);
    const ids = rows.map((row) => Number(row.id));
    const found = await this.supplierProvider.findManyByIds(ids, { purpose: "purchase", atMs: this.time.nowMs() });
    return { items: ids.map((id) => found.get(id)).filter((supplier) => supplier?.usable).map(toSupplier) };
  }

  async #forSku(skuId, q) {
    try { return (await this.supplierProvider.listForSku(skuId, { q, page: 1, pageSize: MAX_ROWS, atMs: this.time.nowMs() })).items; }
    catch (error) {
      if (["SKU_NOT_FOUND", "SKU_NOT_USABLE"].includes(error?.code)) throw purchasingError("SKU_NOT_PURCHASABLE", { field: "skuId" });
      throw error;
    }
  }

  async supplierDefaults({ claims, supplierId }) {
    await this.#actor(claims);
    let defaults;
    try { defaults = await this.supplierProvider.getPurchaseDefaults(supplierId, { atMs: this.time.nowMs() }); }
    catch (error) {
      if (["SUPPLIER_NOT_USABLE", "SUPPLIER_NOT_FOUND"].includes(error?.code)) throw purchasingError("SUPPLIER_NOT_PURCHASABLE", { field: "supplierId" });
      throw error;
    }
    const { currency, paymentTerm, orderingAddress } = defaults;
    return { supplierId, currency: toCurrency(currency), paymentTerm: paymentTerm ? toPaymentTerm(paymentTerm) : null,
      orderingAddress: orderingAddress ? pick(orderingAddress, ["id", ...ADDRESS]) : null };
  }

  async skus({ claims, q = "", barcode }) {
    await this.#actor(claims);
    const found = barcode
      ? [await this.itemProvider.findByBarcode(barcode, { purpose: "purchase", atMs: this.time.nowMs() })]
      : (await this.itemProvider.searchForPurchase({ q, page: 1, pageSize: MAX_ROWS })).items;
    return { items: found.filter(purchasable).map(toSku) };
  }

  async currencies({ claims }) {
    await this.#actor(claims);
    await this.businessMaster.assertReady();
    return { items: (await this.businessMaster.listCurrencies({ page: 1, pageSize: MAX_ROWS })).map(toCurrency) };
  }

  async paymentTerms({ claims }) {
    await this.#actor(claims);
    await this.businessMaster.assertReady();
    return { items: (await this.businessMaster.listPaymentTerms({ page: 1, pageSize: MAX_ROWS })).map(toPaymentTerm) };
  }

  /** Warehouse 冇 provider，同 Sales 一樣直接唯讀（HD-015 3A）。 */
  async warehouses({ claims, q = "" }) {
    await this.#actor(claims);
    const term = q ? prefix(q) : null;
    const [rows] = await this.database.query(`SELECT id, warehouse_code, warehouse_name FROM inventory_warehouses WHERE status = 'ACTIVE'${term
      ? " AND (warehouse_code LIKE ? ESCAPE '!' OR warehouse_name LIKE ? ESCAPE '!')" : ""} ORDER BY normalized_code, id LIMIT ?`,
    [...(term ? [term, term] : []), MAX_ROWS]);
    return { items: rows.map((row) => ({ id: Number(row.id), code: row.warehouse_code, name: row.warehouse_name })) };
  }

  /** HD-019 2A：Active 而有 purchasing.mgmt 嘅用戶，只回 ID 同 label；label 同 PO 嘅 buyer_label 同一個寫法。 */
  async buyers({ claims, q = "" }) {
    await this.#actor(claims);
    const term = q ? prefix(q) : null;
    const [rows] = await this.database.query(`SELECT u.id, COALESCE(NULLIF(u.display_name, ''), u.username) AS label FROM users u
      WHERE u.status = 'active'${term ? " AND (u.username LIKE ? ESCAPE '!' OR u.display_name LIKE ? ESCAPE '!')" : ""}
        AND EXISTS (SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id = ur.role_id JOIN permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = u.id AND p.name = 'purchasing.mgmt')
      ORDER BY label, u.id LIMIT ?`, [...(term ? [term, term] : []), MAX_ROWS]);
    return { items: rows.map((row) => ({ id: Number(row.id), label: row.label })) };
  }

  /** Read path 都要 token 同 DB 權限一致（同 PurchasingInquiryService 一樣）。 */
  async #actor(claims) {
    const fresh = await assertActorFresh(this.database, { actorId: Number(claims?.sub), claimedRoles: claims?.roles, claimedPermissions: claims?.permissions });
    if (!fresh.permissions.includes("purchasing.mgmt")) throw permissionStaleError();
  }
}
