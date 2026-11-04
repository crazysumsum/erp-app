import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { documentTotal, lineAmount } from "./moneyMath.js";
import { nextPurchaseOrderStatus } from "./purchaseOrderStateMachine.js";
import { purchasingError } from "./purchasingErrors.js";
import { draftProjection } from "./purchasingProjections.js";
import { eventId, onlyFields, positiveId } from "./purchasingValidation.js";
import { toBaseQuantity } from "./quantityMath.js";

// Serial 唔支援；DB CHECK 亦只收呢三個，所以就算係容許照存嘅舊 Line 都要擋（設計 §4.6）。
const TRACKING = ["none", "batch", "batch_expiry"];
// 地址快照白名單同上限（§4.5）：地址行、國家、電話；唔存 label、notes。
const ADDRESS = ["addressLine1", "addressLine2", "addressLine3", "city", "stateRegion", "postalCode", "countryCode", "phone"];
const ADDRESS_MAX_BYTES = 2048;
const LINE_COLUMNS = ["id", "purchase_order_id", "line_number", "sku_id", "sku_code_snapshot", "sku_name_snapshot",
  "tracking_policy_snapshot", "inventory_tracked_snapshot", "minimum_receipt_life_days_snapshot", "base_uom_id", "base_uom_code_snapshot",
  "purchase_sku_uom_id", "purchase_uom_code_snapshot", "uom_to_base_factor_snapshot", "ordered_quantity", "ordered_base_quantity",
  "unit_price", "line_amount", "zero_price_reason", "expected_delivery_date", "line_note", "version", "created_at", "updated_at"];

const AUDIT_ACTION = Object.freeze({ CREATE: "purchase_order.created", UPDATE: "purchase_order.updated", COPY: "purchase_order.copied", SUBMIT: "purchase_order.confirmed" });

const invalid = (field) => purchasingError("PURCHASING_INPUT_INVALID", { field });

const idOrNull = (value) => value === null ? null : Number(value);
const storedInput = (row) => ({ supplierId: Number(row.supplier_id), orderingAddressId: idOrNull(row.ordering_address_id), currencyCode: row.currency_code,
  paymentTermId: idOrNull(row.payment_term_id), orderDate: row.order_date, expectedDeliveryDate: row.expected_delivery_date,
  defaultReceivingWarehouseId: idOrNull(row.default_receiving_warehouse_id), buyerId: idOrNull(row.buyer_id), supplierReference: row.supplier_reference, notes: row.notes });
const storedLineInput = (row) => ({ skuId: Number(row.sku_id), purchaseSkuUomId: Number(row.purchase_sku_uom_id), orderedQuantity: row.ordered_quantity,
  unitPrice: row.unit_price, zeroPriceReason: row.zero_price_reason, expectedDeliveryDate: row.expected_delivery_date, lineNote: row.line_note });

function addressSnapshot(address) {
  const json = JSON.stringify(Object.fromEntries(ADDRESS.map((key) => [key, address[key] ?? null])));
  if (Buffer.byteLength(json, "utf8") > ADDRESS_MAX_BYTES) throw invalid("orderingAddressId");
  return json;
}

/**
 * PO Draft create／update／copy（設計 §3.1、§8.2；TASK-014、TASK-016）。一個 REPEATABLE READ transaction：actor freshness → event claim →
 * sequence（create）／鎖 PO 同 Lines（update）→ 主檔 → 寫 PO、Lines、Audit → complete operation（§2.5、§2.6）。
 *
 * Supplier／SKU 資格（HD-015 1B）：新揀嘅（create、換咗嘅 Supplier、新 Line、換咗 SKU 或 Purchase UOM 嘅 Line）一定要合格；
 * Update 時冇郁、但之後先失效嘅照存，回 warning，submit 再嚴格重驗。Supplier 只提供主要訂購地址（HD-015 2C），
 * 所以 orderingAddressId 只收 null 或者主要訂購地址；supplier_sku_ref_id 留 NULL、Supplier Item Code 留空。
 * Warehouse 同 Buyer 冇 provider，跟 Sales 先例喺 transaction 入面唯讀（HD-015 3A）。
 * 冇業務寫入嘅 4xx 拒絕另開短 transaction 寫 REJECTED audit（§4.15）。
 */
export class PurchaseOrderService {
  constructor({ database, logger, time, suppliers, businessMaster, sequences, operations, audit, config }) {
    if (!database || !logger || !time || !suppliers || !businessMaster || !sequences || !operations || !audit || !config) {
      throw new TypeError("PurchaseOrderService requires all of its dependencies");
    }
    Object.assign(this, { database, logger, time, suppliers, businessMaster, sequences, operations, audit, config });
  }

  /** `claims` 係 JWT claims（sub、roles、permissions）；`context` 係 requestId、correlationId、ip。 */
  create({ claims, input, context = {} }) {
    return this.#command({ kind: "CREATE", claims, purchaseOrderId: null, input, context });
  }

  update({ claims, purchaseOrderId, input, context = {} }) {
    return this.#command({ kind: "UPDATE", claims, purchaseOrderId, input, context });
  }

  /** `purchaseOrderId` 係來源 PO；request 只有 eventId，內容喺 transaction 入面由來源同目前主檔得出（設計 §8.2）。 */
  copy({ claims, purchaseOrderId, input, context = {} }) {
    return this.#command({ kind: "COPY", claims, purchaseOrderId, input, context });
  }

  /** Client 只送 eventId 同 version，唔可以指定 approver 或者 status（§5.2）。 */
  submit({ claims, purchaseOrderId, input, context = {} }) {
    return this.#command({ kind: "SUBMIT", claims, purchaseOrderId, input, context });
  }

  #request({ kind, input }) {
    if (kind === "COPY") return { eventId: eventId(onlyFields(input, ["eventId"], "body").eventId) };
    if (kind === "SUBMIT") {
      const { eventId: event, version } = onlyFields(input, ["eventId", "version"], "body");
      return { eventId: eventId(event), version: positiveId(version, "version") };
    }
    return draftProjection(input, { maxLines: this.config.maxPurchaseOrderLines, update: kind === "UPDATE" });
  }

  async #command(command) {
    try {
      if (command.kind !== "CREATE") positiveId(command.purchaseOrderId, "purchaseOrderId");
      const request = this.#request(command);
      return await this.operations.run(this.database, (tx) => command.kind === "SUBMIT" ? this.#submit(tx, command, request) : this.#save(tx, command, request));
    } catch (error) {
      if (error instanceof ApplicationError && error.statusCode >= 400 && error.statusCode < 500) await this.#rejected(command, error);
      throw error;
    }
  }

  /** §2.5 第 1、2 步：actor freshness，再 claim event。 */
  async #claim(tx, { kind, claims, purchaseOrderId, context }, request, nowMs) {
    const fresh = await assertActorFresh(tx, { actorId: Number(claims?.sub), claimedRoles: claims?.roles, claimedPermissions: claims?.permissions });
    if (!fresh.permissions.includes("purchasing.mgmt")) throw permissionStaleError();
    const actor = { id: fresh.id, username: fresh.username };
    const trace = { requestId: context.requestId, correlationId: context.correlationId };
    const claim = await this.operations.claim(tx, {
      commandType: `${kind}_PURCHASE_ORDER`, sourceDocumentId: purchaseOrderId === null ? "" : String(purchaseOrderId),
      eventId: request.eventId, payload: { purchaseOrderId, draft: request }, actor, nowMs, ...trace
    });
    return { actor, trace, ...claim };
  }

  async #save(tx, command, request) {
    const { kind, purchaseOrderId, context } = command, nowMs = this.time.nowMs();
    const { actor, trace, operationId, replay } = await this.#claim(tx, command, request, nowMs);
    // Replay 只回當時嘅結果摘要；warning 係當時主檔狀態，唔重算。
    if (replay) return { ...replay, warnings: [], replayed: true };

    const warnings = [];
    const draft = kind === "COPY" ? await this.#copiedDraft(tx, purchaseOrderId, request.eventId, actor, nowMs, warnings) : request;
    const current = kind === "UPDATE" ? await this.#lockDraft(tx, purchaseOrderId, draft) : null;
    const number = current ? { number: current.po_number }
      : await this.sequences.nextNumberInTransaction(tx, { documentType: "PO", localDate: this.time.fileDate(this.time.at(nowMs)), nowMs });
    const header = await this.#header(tx, draft, current, nowMs, warnings);
    const lines = await this.#lines(tx, draft, current, header.currency_decimal_places_snapshot, nowMs, warnings);
    header.subtotal_amount = header.total_amount = documentTotal(lines.map((row) => row.line_amount), header.currency_decimal_places_snapshot);
    Object.assign(header, { updated_at: nowMs, updated_by: actor.id, updated_by_label: actor.username });

    let id = purchaseOrderId, version = 1;
    if (current) {
      version = draft.version + 1;
      const [result] = await tx.query("UPDATE purchase_orders SET ?, version = ? WHERE id = ? AND version = ?", [header, version, id, draft.version]);
      if (Number(result.affectedRows) !== 1) throw purchasingError("CONCURRENT_OPERATION");
      await tx.query("DELETE FROM purchase_order_lines WHERE purchase_order_id = ?", [id]);
    } else {
      const [result] = await tx.query("INSERT INTO purchase_orders SET ?", [{ ...header, po_number: number.number,
        document_year_month: number.yearMonth, sequence_no: number.sequenceNo, created_at: nowMs, created_by: actor.id, created_by_label: actor.username }]);
      id = Number(result.insertId);
    }
    // 保留舊 Line ID 重新插入：行號有 unique key，喺原位改次序會撞。
    await tx.query(`INSERT INTO purchase_order_lines (${LINE_COLUMNS.join(", ")}) VALUES ?`,
      [lines.map((row) => LINE_COLUMNS.map((column) => column === "purchase_order_id" ? id : row[column]))]);

    const summary = { id, number: number.number, status: "DRAFT", version };
    await this.audit.record(tx, { actor, action: AUDIT_ACTION[kind], targetId: id, targetLabel: number.number,
      detail: { version, lineCount: lines.length, totalAmount: header.total_amount, currencyCode: header.currency_code,
        ...(kind === "COPY" ? { sourcePurchaseOrderId: purchaseOrderId } : {}) },
      nowMs, ip: context.ip, ...trace });
    await this.operations.complete(tx, { operationId, result: summary, nowMs });
    return { ...summary, warnings, replayed: false };
  }

  /**
   * 審批關閉時直接確認（§3.3、§8.3；HD-018）：同 create 一樣嚴格重驗已保存嘅值，唔再容忍 Draft 期間失效嘅主檔；通過就寫目前快照再轉 CONFIRMED。
   * Line 一定要喺表頭離開 DRAFT 之前寫（§4.16 trigger）。Status History 由 TASK-022 跟張表一齊加（HD-018 1A）。
   * Item 係非鎖定讀（HD-018 3A，同 Sales 一樣）：確認嗰一刻先停用嘅 SKU 可能照過，收貨時嘅 SKU 例外規則會再驗。
   */
  async #submit(tx, command, request) {
    const { purchaseOrderId: id, context } = command, nowMs = this.time.nowMs();
    const { actor, trace, operationId, replay } = await this.#claim(tx, command, request, nowMs);
    if (replay) return { ...replay, outcome: replay.status, warnings: [], replayed: true };

    const [[policy]] = await tx.query("SELECT require_po_approval, version FROM purchasing_settings WHERE id = 1 LOCK IN SHARE MODE");
    if (!policy) throw purchasingError("PURCHASING_DEPENDENCY_UNAVAILABLE");
    const current = await this.#lockDraft(tx, id, { version: request.version, lines: [] }, "CONFIRM");
    // TASK-023 先有審批流程；喺嗰之前審批開住就只可以拒絕，唔可以繞過去直接確認。
    if (policy.require_po_approval) throw purchasingError("PO_APPROVAL_REQUIRED");

    const stored = await this.#stored(tx, id);
    const draft = draftProjection({ ...storedInput(stored), eventId: request.eventId, version: request.version,
      lines: stored.lines.map((row) => ({ id: Number(row.id), ...storedLineInput(row) })) }, { maxLines: this.config.maxPurchaseOrderLines, update: true });
    const warnings = [], places = Number(stored.currency_decimal_places_snapshot);
    const header = await this.#header(tx, draft, current, nowMs, warnings, { strict: true });
    const lines = await this.#lines(tx, draft, current, header.currency_decimal_places_snapshot, nowMs, warnings, { strict: true });
    // 數量、單價同小數位都冇變，金額就唔會變；所以只要驗 Base quantity 同小數位。
    if (header.currency_decimal_places_snapshot !== places) throw purchasingError("PO_MASTER_CHANGED", { field: "currencyCode" });
    lines.forEach((line, index) => {
      if (String(line.ordered_base_quantity) !== String(stored.lines[index].ordered_base_quantity)) throw purchasingError("PO_MASTER_CHANGED", { field: `lines.${index}.purchaseSkuUomId` });
    });
    header.subtotal_amount = header.total_amount = documentTotal(lines.map((row) => row.line_amount), places);

    await tx.query("DELETE FROM purchase_order_lines WHERE purchase_order_id = ?", [id]);
    await tx.query(`INSERT INTO purchase_order_lines (${LINE_COLUMNS.join(", ")}) VALUES ?`,
      [lines.map((row) => LINE_COLUMNS.map((column) => column === "purchase_order_id" ? id : row[column]))]);
    const version = request.version + 1, status = current.nextStatus;
    const [result] = await tx.query("UPDATE purchase_orders SET ?, status = ?, version = ?, confirmed_at = ?, confirmed_by = ? WHERE id = ? AND version = ? AND status = 'DRAFT'",
      [{ ...header, updated_at: nowMs, updated_by: actor.id, updated_by_label: actor.username }, status, version, nowMs, actor.id, id, request.version]);
    if (Number(result.affectedRows) !== 1) throw purchasingError("CONCURRENT_OPERATION");

    const summary = { id, number: current.po_number, status, version };
    await this.audit.record(tx, { actor, action: AUDIT_ACTION.SUBMIT, targetId: id, targetLabel: current.po_number,
      detail: { version, lineCount: lines.length, totalAmount: header.total_amount, currencyCode: header.currency_code, policyVersion: Number(policy.version) },
      nowMs, ip: context.ip, ...trace });
    await this.operations.complete(tx, { operationId, result: summary, nowMs });
    return { ...summary, outcome: status, warnings, replayed: false };
  }

  /** 已保存嘅 editable values。 */
  async #stored(tx, id) {
    const dateOf = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d') AS ${column}`;
    const [[source]] = await tx.query(`SELECT supplier_id, ordering_address_id, currency_code, currency_decimal_places_snapshot, payment_term_id,
      ${dateOf("order_date")}, ${dateOf("expected_delivery_date")}, default_receiving_warehouse_id, buyer_id, supplier_reference, notes
      FROM purchase_orders WHERE id = ?`, [id]);
    if (!source) throw purchasingError("PURCHASE_ORDER_NOT_FOUND");
    const [lines] = await tx.query(`SELECT id, line_number, sku_id, purchase_sku_uom_id, ordered_quantity, ordered_base_quantity, unit_price, line_amount,
      zero_price_reason, ${dateOf("expected_delivery_date")}, line_note FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number`, [id]);
    return { ...source, lines };
  }

  /** §2.6 第 4、5 步：鎖 PO，再按 ID 升序鎖 Lines。唔存在、唔屬於呢張 PO 嘅 child ID 一律 404（§5.1）。 */
  async #lockDraft(tx, id, draft, action = "SAVE") {
    const [[row]] = await tx.query(`SELECT id, po_number, status, version, supplier_id, ordering_address_id, ordering_address_snapshot
      FROM purchase_orders WHERE id = ? FOR UPDATE`, [id]);
    if (!row) throw purchasingError("PURCHASE_ORDER_NOT_FOUND");
    row.nextStatus = nextPurchaseOrderStatus(row.status, action);
    if (Number(row.version) !== draft.version) throw purchasingError("VERSION_CONFLICT", { currentVersion: Number(row.version) });
    const [lines] = await tx.query(`SELECT id, sku_id, purchase_sku_uom_id, version, created_at FROM purchase_order_lines
      WHERE purchase_order_id = ? ORDER BY id FOR UPDATE`, [id]);
    row.lines = new Map(lines.map((line) => [Number(line.id), line]));
    for (const line of draft.lines) if (line.id !== null && !row.lines.has(line.id)) throw purchasingError("PURCHASE_ORDER_NOT_FOUND");
    return row;
  }

  /**
   * Copy 只抄仍然合法嘅 editable values（§8.2；HD-017 2A）：Supplier 唔可採購或者冇 Line 剩低就成張拒絕；選填主檔失效就清空，Buyer 失效換做
   * 操作者，SKU／UOM 唔合格就剔走嗰行，全部回 warning。Order Date 用今日。出嚟嘅 Draft 再行一次 create 嘅完整驗證，唔帶狀態、收貨或者舊資格。
   */
  async #copiedDraft(tx, sourceId, event, actor, nowMs, warnings) {
    const source = await this.#stored(tx, sourceId), rows = source.lines;
    const today = this.time.fileDate(this.time.at(nowMs)), supplierId = Number(source.supplier_id);
    const changed = (field, lineNumber) => warnings.push({ code: "COPY_FIELD_CHANGED", field, ...(lineNumber ? { lineNumber } : {}) });

    try {
      await this.suppliers.assertUsableInTransaction(tx, supplierId, { purpose: "purchase", atMs: nowMs });
    } catch (error) {
      if (["SUPPLIER_NOT_USABLE", "SUPPLIER_NOT_FOUND"].includes(error?.code)) throw purchasingError("SUPPLIER_NOT_PURCHASABLE", { field: "supplierId" });
      throw error;
    }
    let orderingAddressId = source.ordering_address_id === null ? null : Number(source.ordering_address_id);
    if (orderingAddressId !== null) {
      // Provider 連 Supplier 嘅預設 Currency／Payment Term 一齊驗；預設失效只係攞唔到地址，唔應該令成張 Copy 失敗。
      const primary = await this.suppliers.getPurchaseDefaultsInTransaction(tx, supplierId, { atMs: nowMs }).catch((error) => {
        if (["CURRENCY_NOT_ACTIVE", "PAYMENT_TERM_NOT_ACTIVE"].includes(error?.code)) return null;
        throw error;
      });
      if (primary?.orderingAddress?.id !== orderingAddressId) { orderingAddressId = null; changed("orderingAddressId"); }
    }
    let paymentTermId = source.payment_term_id === null ? null : Number(source.payment_term_id);
    if (paymentTermId !== null) {
      try { await this.businessMaster.assertPaymentTermUsableInTransaction(tx, { id: paymentTermId, purpose: "new_assignment" }); }
      catch (error) {
        if (error?.code !== "PAYMENT_TERM_NOT_ACTIVE") throw error;
        paymentTermId = null;
        changed("paymentTermId");
      }
    }
    let warehouseId = source.default_receiving_warehouse_id === null ? null : Number(source.default_receiving_warehouse_id);
    if (warehouseId !== null) {
      const [[warehouse]] = await tx.query("SELECT status FROM inventory_warehouses WHERE id = ?", [warehouseId]);
      if (warehouse?.status !== "ACTIVE") { warehouseId = null; changed("defaultReceivingWarehouseId"); }
    }
    const [[buyer]] = await tx.query("SELECT id FROM users WHERE id = ? AND status = 'active'", [source.buyer_id]);
    if (!buyer) changed("buyerId");

    const skus = await new ItemLookupService({ database: tx, logger: this.logger, time: this.time })
      .findManyByIds(rows.map((row) => Number(row.sku_id)), { purpose: "purchase", atMs: nowMs });
    const lines = [];
    for (const row of rows) {
      const lineNumber = Number(row.line_number);
      if (!this.#stillPurchasable(skus.get(Number(row.sku_id)), Number(row.purchase_sku_uom_id), row.ordered_quantity)) {
        warnings.push({ code: "COPY_LINE_DROPPED", lineNumber });
        continue;
      }
      const expired = row.expected_delivery_date !== null && row.expected_delivery_date < today;
      if (expired) changed("expectedDeliveryDate", lineNumber);
      lines.push({ ...storedLineInput(row), expectedDeliveryDate: expired ? null : row.expected_delivery_date });
    }
    if (!lines.length) throw purchasingError("SKU_NOT_PURCHASABLE", { field: "lines" });
    const expired = source.expected_delivery_date !== null && source.expected_delivery_date < today;
    if (expired) changed("expectedDeliveryDate");

    return draftProjection({ ...storedInput(source), eventId: event, orderingAddressId, paymentTermId, orderDate: today,
      expectedDeliveryDate: expired ? null : source.expected_delivery_date, defaultReceivingWarehouseId: warehouseId,
      buyerId: buyer ? Number(buyer.id) : actor.id, lines },
    { maxLines: this.config.maxPurchaseOrderLines, update: false });
  }

  /** 同 #lines 嘅條件一樣；UOM factor 改咗之後換唔到整數 Base quantity 都算唔合格。 */
  #stillPurchasable(sku, purchaseSkuUomId, orderedQuantity) {
    const uom = sku?.uoms.find((entry) => entry.skuUomId === purchaseSkuUomId);
    if (!uom || uom.status !== "active" || !sku.usable || !sku.inventoryTracked || !TRACKING.includes(sku.trackingPolicy) || !sku.uoms.some((entry) => entry.isBase)) return false;
    try { toBaseQuantity(orderedQuantity, uom.toBaseFactor, { maxBaseQuantity: this.config.maxQuantity }); return true; }
    catch (error) { if (error instanceof ApplicationError) return false; throw error; }
  }

  async #header(tx, draft, current, nowMs, warnings, { strict = false } = {}) {
    const unchanged = !strict && current !== null && Number(current.supplier_id) === draft.supplierId;
    let supplier, tolerated = false;
    try {
      supplier = await this.suppliers.assertUsableInTransaction(tx, draft.supplierId, { purpose: "purchase", atMs: nowMs });
    } catch (error) {
      if (!["SUPPLIER_NOT_USABLE", "SUPPLIER_NOT_FOUND"].includes(error?.code)) throw error;
      if (!unchanged || error.code === "SUPPLIER_NOT_FOUND") throw purchasingError("SUPPLIER_NOT_PURCHASABLE", { field: "supplierId" });
      supplier = await this.suppliers.assertUsableInTransaction(tx, draft.supplierId, { purpose: "history", atMs: nowMs });
      tolerated = true;
      warnings.push({ code: "SUPPLIER_NOT_PURCHASABLE" });
    }

    let address = null;
    if (draft.orderingAddressId !== null && tolerated) {
      // 失效 Supplier 攞唔到 purchase defaults：只可以保留原本嘅地址同快照，唔可以揀新地址。
      if (Number(current.ordering_address_id) !== draft.orderingAddressId) throw purchasingError("SUPPLIER_NOT_PURCHASABLE", { field: "orderingAddressId" });
      address = JSON.stringify(current.ordering_address_snapshot);
    } else if (draft.orderingAddressId !== null) {
      const { orderingAddress } = await this.suppliers.getPurchaseDefaultsInTransaction(tx, draft.supplierId, { atMs: nowMs });
      if (orderingAddress?.id !== draft.orderingAddressId) throw invalid("orderingAddressId");
      address = addressSnapshot(orderingAddress);
    }

    const currency = await this.businessMaster.assertCurrencyUsableInTransaction(tx, { code: draft.currencyCode, purpose: "new_assignment" });
    const term = draft.paymentTermId === null ? null
      : await this.businessMaster.assertPaymentTermUsableInTransaction(tx, { id: draft.paymentTermId, purpose: "new_assignment" });

    let warehouseCode = "";
    if (draft.defaultReceivingWarehouseId !== null) {
      const [[warehouse]] = await tx.query("SELECT warehouse_code, status FROM inventory_warehouses WHERE id = ? LOCK IN SHARE MODE",
        [draft.defaultReceivingWarehouseId]);
      if (warehouse?.status !== "ACTIVE") throw purchasingError("WAREHOUSE_INVALID", { field: "defaultReceivingWarehouseId" });
      warehouseCode = warehouse.warehouse_code;
    }
    const [[buyer]] = await tx.query("SELECT username, display_name FROM users WHERE id = ? AND status = 'active' LOCK IN SHARE MODE", [draft.buyerId]);
    if (!buyer) throw invalid("buyerId");

    return {
      supplier_id: draft.supplierId, supplier_code_snapshot: supplier.supplierCode, supplier_name_snapshot: supplier.supplierName,
      ordering_address_id: draft.orderingAddressId, ordering_address_snapshot: address,
      currency_code: currency.code, currency_name_snapshot: currency.name, currency_decimal_places_snapshot: currency.decimalPlaces,
      payment_term_id: draft.paymentTermId,
      payment_term_snapshot: term && JSON.stringify({ code: term.code, name: term.name, calculationType: term.calculationType, dueDays: term.dueDays }),
      order_date: draft.orderDate, expected_delivery_date: draft.expectedDeliveryDate,
      default_receiving_warehouse_id: draft.defaultReceivingWarehouseId, default_warehouse_code_snapshot: warehouseCode,
      buyer_id: draft.buyerId, buyer_label: buyer.display_name || buyer.username,
      supplier_reference: draft.supplierReference, notes: draft.notes
    };
  }

  /** 一次過讀晒 SKU／UOM（固定兩條 query，§8.2）；用 transaction connection，唔會多借一條連線。 */
  async #lines(tx, draft, current, places, nowMs, warnings, { strict = false } = {}) {
    const skus = await new ItemLookupService({ database: tx, logger: this.logger, time: this.time })
      .findManyByIds(draft.lines.map((line) => line.skuId), { purpose: "purchase", atMs: nowMs });
    return draft.lines.map((line, index) => {
      const field = (name) => `lines.${index}.${name}`;
      const sku = skus.get(line.skuId);
      const base = sku?.uoms.find((uom) => uom.isBase);
      if (!sku || !base || !TRACKING.includes(sku.trackingPolicy)) throw purchasingError("SKU_NOT_PURCHASABLE", { field: field("skuId") });
      const uom = sku.uoms.find((entry) => entry.skuUomId === line.purchaseSkuUomId);
      if (!uom) throw invalid(field("purchaseSkuUomId"));

      const existing = line.id === null ? null : current.lines.get(line.id);
      const unchanged = !strict && existing && Number(existing.sku_id) === line.skuId && Number(existing.purchase_sku_uom_id) === line.purchaseSkuUomId;
      const problem = !sku.usable || !sku.inventoryTracked ? "skuId" : uom.status !== "active" ? "purchaseSkuUomId" : null;
      if (problem && !unchanged) throw purchasingError("SKU_NOT_PURCHASABLE", { field: field(problem) });
      if (problem) warnings.push({ code: "SKU_NOT_PURCHASABLE", lineNumber: index + 1 });

      let baseQuantity;
      try { baseQuantity = toBaseQuantity(line.orderedQuantity, uom.toBaseFactor, { maxBaseQuantity: this.config.maxQuantity }); }
      catch (error) { throw error instanceof ApplicationError ? purchasingError(error.code, { field: field("orderedQuantity") }) : error; }
      return {
        id: line.id, line_number: index + 1, sku_id: line.skuId, sku_code_snapshot: sku.skuCode, sku_name_snapshot: sku.skuName,
        tracking_policy_snapshot: sku.trackingPolicy, inventory_tracked_snapshot: sku.inventoryTracked ? 1 : 0,
        minimum_receipt_life_days_snapshot: sku.minimumReceiptLifeDays, base_uom_id: base.uomId, base_uom_code_snapshot: base.uomCode,
        purchase_sku_uom_id: line.purchaseSkuUomId, purchase_uom_code_snapshot: uom.uomCode, uom_to_base_factor_snapshot: uom.toBaseFactor,
        ordered_quantity: line.orderedQuantity, ordered_base_quantity: baseQuantity, unit_price: line.unitPrice,
        line_amount: lineAmount(line.orderedQuantity, line.unitPrice, places), zero_price_reason: line.zeroPriceReason,
        expected_delivery_date: line.expectedDeliveryDate, line_note: line.lineNote,
        version: existing ? Number(existing.version) + 1 : 1, created_at: existing ? Number(existing.created_at) : nowMs, updated_at: nowMs
      };
    });
  }

  async #rejected({ kind, claims, purchaseOrderId, context }, error) {
    const action = error.code === "PURCHASING_EVENT_CONFLICT" ? "purchasing.operation_conflict" : AUDIT_ACTION[kind];
    const targetId = Number.isSafeInteger(purchaseOrderId) && purchaseOrderId > 0 ? purchaseOrderId : null;
    try {
      await this.database.withTransaction((tx) => this.audit.recordRejected(tx, { actorId: Number(claims?.sub), action, targetId,
        code: error.code, nowMs: this.time.nowMs(), requestId: context.requestId, correlationId: context.correlationId, ip: context.ip }));
    } catch (auditError) {
      // 唔可以話已經持久化 Audit；原本嘅拒絕照拋（§4.15）。
      await this.logger.error("purchasing.audit.rejected_not_persisted", "Rejected Purchasing command could not be audited", {
        action, code: error.code, auditErrorCode: auditError?.code ?? auditError?.name ?? null,
        requestId: context.requestId ?? null, correlationId: context.correlationId ?? null
      });
    }
  }
}
