import { ApplicationError } from "../../framework/errors/ApplicationError.js";
import { permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { purchasingError } from "./purchasingErrors.js";
import { eventId, localDate, notes as validNotes, onlyFields, positiveId, reason as validReason, reference } from "./purchasingValidation.js";
import { assertUniqueDimensions, calculateBaseQuantity, DRAFT_BLOCKING_CODES, inventoryBoundReason, validateTracking } from "./ReceivingPolicyService.js";

const REQUIRED_PERMISSIONS = ["purchasing.view", "receiving.operation"];
const AUDIT_ACTION = Object.freeze({ CREATE: "goods_receipt.created", UPDATE: "goods_receipt.updated", CANCEL: "goods_receipt.cancelled" });
const RECEIVABLE_PO = ["CONFIRMED", "PARTIALLY_RECEIVED"];
const DUPLICATE_NOTE_DAYS = 90, DUPLICATE_NOTE_LIMIT = 5;
const DETAIL_COLUMNS = ["goods_receipt_id", "goods_receipt_line_id", "purchase_order_id", "purchase_order_line_id", "detail_number", "sku_id",
  "sku_code_snapshot", "sku_name_snapshot", "input_uom_id", "input_uom_code_snapshot", "uom_to_base_factor_snapshot", "received_quantity",
  "received_base_quantity", "warehouse_id", "bin_id", "warehouse_code_snapshot", "bin_code_snapshot", "tracking_policy_applied", "lot_number",
  "normalized_lot_number", "expiry_date", "manufacture_date", "stock_status", "expiry_override_reason", "created_at", "updated_at"];

const invalid = (field) => purchasingError("PURCHASING_INPUT_INVALID", { field });
const optionalText = (value, check, field) => (value === undefined ? "" : check(value, field));
/** 一般原因（§5.1）：Draft 可以留空，唔係空就要合法；Confirm 先決定係咪必填。 */
const optionalReason = (value, field) => (value === undefined || value.trim() === "" ? "" : validReason(value, field));
/** 傳去 Inventory 嘅兩個原因（TL RULING Q3，Sam 已批）：Draft 可以留空，唔係空就按 byte／單行規則。 */
function optionalInventoryReason(value, field) {
  if (value === undefined || value.trim() === "") return "";
  const checked = inventoryBoundReason(value, field, "PURCHASING_INPUT_INVALID");
  if (checked.issues.length) throw invalid(field);
  return checked.value;
}
/** 政策 issue 轉做單一公開錯誤（§5.1 envelope 一次一個錯誤）：用第一個 Draft 會擋嘅 issue，field 係完整路徑。 */
function throwBlocking(issues, prefix) {
  const blocking = issues.find(({ code }) => DRAFT_BLOCKING_CODES.includes(code));
  if (blocking) throw purchasingError(blocking.code, { field: prefix ? `${prefix}.${blocking.path}` : blocking.path });
}

/**
 * GR Draft create／update／cancel（設計 §3.4、§5.3、§8.5；TASK-029）。一個 REPEATABLE READ transaction：actor freshness → event claim →
 * sequence（create）→ PO（FOR SHARE）→ PO Lines（FOR SHARE）→ GR、Lines、Details（FOR UPDATE）→ 寫入 → Audit → complete operation（§2.5、§2.6）。
 * 保存 Draft 唔郁 PO progress、Inventory Balance 或 Movement（BR-027）。Draft 只擋 DRAFT_BLOCKING_CODES；Tracking 必填、原因必填、
 * 效期同 Supplier／SKU 例外留畀 Confirm（TASK-032）。冇業務寫入嘅 4xx 拒絕另開短 transaction 寫 REJECTED audit（§4.15）。
 */
export class GoodsReceiptService {
  constructor({ database, logger, time, config, sequences, operations, audit }) {
    if (!database || !logger || !time || !config || !sequences || !operations || !audit) {
      throw new TypeError("GoodsReceiptService requires all of its dependencies");
    }
    Object.assign(this, { database, logger, time, config, sequences, operations, audit });
  }

  create({ claims, input, context = {} }) {
    return this.#command({ kind: "CREATE", claims, goodsReceiptId: null, input, context });
  }

  update({ claims, goodsReceiptId, input, context = {} }) {
    return this.#command({ kind: "UPDATE", claims, goodsReceiptId, input, context });
  }

  cancel({ claims, goodsReceiptId, input, context = {} }) {
    return this.#command({ kind: "CANCEL", claims, goodsReceiptId, input, context });
  }

  #request({ kind, input }) {
    if (kind === "CREATE") {
      const body = onlyFields(input, ["eventId", "purchaseOrderId", "businessReceiptDate", "supplierDeliveryNote", "notes"], "body");
      return { eventId: eventId(body.eventId), purchaseOrderId: positiveId(body.purchaseOrderId, "purchaseOrderId"),
        businessReceiptDate: localDate(body.businessReceiptDate, "businessReceiptDate"),
        supplierDeliveryNote: optionalText(body.supplierDeliveryNote, reference, "supplierDeliveryNote"),
        notes: optionalText(body.notes, validNotes, "notes") };
    }
    if (kind === "CANCEL") {
      const body = onlyFields(input, ["eventId", "version", "reason"], "body");
      return { eventId: eventId(body.eventId), version: positiveId(body.version, "version"), reason: validReason(body.reason) };
    }
    const body = onlyFields(input, ["eventId", "version", "businessReceiptDate", "supplierDeliveryNote", "notes", "supplierExceptionReason", "lines"], "body");
    if (!Array.isArray(body.lines) || body.lines.length > this.config.maxPurchaseOrderLines) throw invalid("lines");
    const seen = new Set();
    let detailCount = 0;
    const lines = body.lines.map((raw, index) => {
      const line = onlyFields(raw, ["purchaseOrderLineId", "overReceiptReason", "skuExceptionReason", "details"], `lines.${index}`);
      const purchaseOrderLineId = positiveId(line.purchaseOrderLineId, `lines.${index}.purchaseOrderLineId`);
      if (seen.has(purchaseOrderLineId)) throw invalid(`lines.${index}.purchaseOrderLineId`);
      seen.add(purchaseOrderLineId);
      if (!Array.isArray(line.details) || line.details.length < 1) throw invalid(`lines.${index}.details`);
      detailCount += line.details.length;
      return {
        purchaseOrderLineId,
        overReceiptReason: optionalReason(line.overReceiptReason, `lines.${index}.overReceiptReason`),
        skuExceptionReason: optionalInventoryReason(line.skuExceptionReason, `lines.${index}.skuExceptionReason`),
        details: line.details.map((rawDetail, detailIndex) => {
          const path = `lines.${index}.details.${detailIndex}`;
          const detail = onlyFields(rawDetail, ["inputUomId", "receivedQuantity", "warehouseId", "binId", "lotNumber", "expiryDate", "manufactureDate",
            "stockStatus", "expiryOverrideReason"], path);
          return { inputUomId: positiveId(detail.inputUomId, `${path}.inputUomId`), receivedQuantity: detail.receivedQuantity,
            warehouseId: positiveId(detail.warehouseId, `${path}.warehouseId`), binId: positiveId(detail.binId, `${path}.binId`),
            lotNumber: detail.lotNumber ?? "", expiryDate: detail.expiryDate ?? null, manufactureDate: detail.manufactureDate ?? null,
            stockStatus: detail.stockStatus, expiryOverrideReason: optionalInventoryReason(detail.expiryOverrideReason, `${path}.expiryOverrideReason`) };
        })
      };
    });
    if (detailCount > this.config.maxGoodsReceiptDetails) throw invalid("lines");
    return { eventId: eventId(body.eventId), version: positiveId(body.version, "version"),
      businessReceiptDate: localDate(body.businessReceiptDate, "businessReceiptDate"),
      supplierDeliveryNote: optionalText(body.supplierDeliveryNote, reference, "supplierDeliveryNote"),
      notes: optionalText(body.notes, validNotes, "notes"),
      supplierExceptionReason: optionalReason(body.supplierExceptionReason, "supplierExceptionReason"), lines };
  }

  async #command(command) {
    try {
      if (command.kind !== "CREATE") positiveId(command.goodsReceiptId, "goodsReceiptId");
      const request = this.#request(command);
      const work = { CREATE: (tx) => this.#create(tx, command, request), UPDATE: (tx) => this.#update(tx, command, request),
        CANCEL: (tx) => this.#cancel(tx, command, request) }[command.kind];
      return await this.operations.run(this.database, work);
    } catch (error) {
      if (error instanceof ApplicationError && error.statusCode >= 400 && error.statusCode < 500) await this.#rejected(command, error);
      throw error;
    }
  }

  /** §2.5 第 1、2 步：actor freshness（要 purchasing.view＋receiving.operation），再 claim event。 */
  async #claim(tx, { kind, claims, goodsReceiptId, context }, request, nowMs) {
    const fresh = await assertActorFresh(tx, { actorId: Number(claims?.sub), claimedRoles: claims?.roles, claimedPermissions: claims?.permissions });
    if (!REQUIRED_PERMISSIONS.every((permission) => fresh.permissions.includes(permission))) throw permissionStaleError();
    const actor = { id: fresh.id, username: fresh.username };
    const trace = { requestId: context.requestId, correlationId: context.correlationId };
    const claim = await this.operations.claim(tx, {
      commandType: `${kind}_GOODS_RECEIPT`, sourceDocumentId: goodsReceiptId === null ? "" : String(goodsReceiptId),
      eventId: request.eventId, payload: { goodsReceiptId, request }, actor, nowMs, ...trace
    });
    return { actor, trace, ...claim };
  }

  /** §8.5：只有 CONFIRMED／PARTIALLY_RECEIVED 而且最少一行仍有 outstanding 嘅 PO 先可以收貨。 */
  async #receivablePurchaseOrder(tx, purchaseOrderId) {
    const [[po]] = await tx.query(`SELECT id, status, supplier_id, supplier_code_snapshot, supplier_name_snapshot
      FROM purchase_orders WHERE id = ? FOR SHARE`, [purchaseOrderId]);
    if (!po) throw purchasingError("PURCHASE_ORDER_NOT_FOUND");
    if (!RECEIVABLE_PO.includes(po.status)) throw purchasingError("PO_STATE_CONFLICT");
    const [lines] = await tx.query(`SELECT id, line_number, sku_id, sku_code_snapshot, sku_name_snapshot, tracking_policy_snapshot, base_uom_id,
      base_uom_code_snapshot, purchase_sku_uom_id, purchase_uom_code_snapshot, uom_to_base_factor_snapshot, has_outstanding, closed_at
      FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY id FOR SHARE`, [purchaseOrderId]);
    return { po, lines };
  }

  async #create(tx, command, request) {
    const nowMs = this.time.nowMs();
    const { actor, trace, operationId, replay } = await this.#claim(tx, command, request, nowMs);
    if (replay) return { ...replay, warnings: [], replayed: true };

    const number = await this.sequences.nextNumberInTransaction(tx, { documentType: "GR", localDate: this.time.fileDate(this.time.at(nowMs)), nowMs });
    const { po, lines } = await this.#receivablePurchaseOrder(tx, request.purchaseOrderId);
    if (!lines.some((line) => Number(line.has_outstanding) === 1 && line.closed_at === null)) throw purchasingError("PO_STATE_CONFLICT");
    const [result] = await tx.query("INSERT INTO goods_receipts SET ?", [{
      gr_number: number.number, document_year_month: number.yearMonth, sequence_no: number.sequenceNo, purchase_order_id: request.purchaseOrderId,
      supplier_id: po.supplier_id, supplier_code_snapshot: po.supplier_code_snapshot, supplier_name_snapshot: po.supplier_name_snapshot,
      business_receipt_date: request.businessReceiptDate, supplier_delivery_note: request.supplierDeliveryNote, notes: request.notes,
      created_at: nowMs, updated_at: nowMs, created_by: actor.id, updated_by: actor.id, created_by_label: actor.username, updated_by_label: actor.username
    }]);
    const id = Number(result.insertId);
    const warnings = await this.#duplicateNote(tx, { id, supplierId: po.supplier_id, note: request.supplierDeliveryNote, date: request.businessReceiptDate });
    return this.#finish(tx, { kind: "CREATE", id, number: number.number, status: "DRAFT", version: 1, actor, trace, operationId, nowMs, context: command.context, warnings });
  }

  async #update(tx, command, request) {
    const { goodsReceiptId: id } = command, nowMs = this.time.nowMs();
    const { actor, trace, operationId, replay } = await this.#claim(tx, command, request, nowMs);
    if (replay) return { ...replay, warnings: [], replayed: true };

    // §2.6：先 PO 後 GR。GR 嘅 PO 唔會變，所以先用普通讀攞 PO id。
    const [[owner]] = await tx.query("SELECT purchase_order_id FROM goods_receipts WHERE id = ?", [id]);
    if (!owner) throw purchasingError("GOODS_RECEIPT_NOT_FOUND");
    const { po, lines: poLines } = await this.#receivablePurchaseOrder(tx, Number(owner.purchase_order_id));
    const gr = await this.#lockDraft(tx, id, request.version);
    await tx.query("SELECT id FROM goods_receipt_lines WHERE goods_receipt_id = ? ORDER BY id FOR UPDATE", [id]);
    await tx.query("SELECT id FROM goods_receipt_details WHERE goods_receipt_id = ? ORDER BY id FOR UPDATE", [id]);

    const byId = new Map(poLines.map((line) => [Number(line.id), line]));
    const purchaseUomIds = await this.#purchaseUomIds(tx, poLines);
    const rows = [], locations = [];
    for (const [index, line] of request.lines.entries()) {
      const poLine = byId.get(line.purchaseOrderLineId);
      if (!poLine || poLine.closed_at !== null) throw purchasingError("PO_LINE_NOT_RECEIVABLE", { field: `lines.${index}.purchaseOrderLineId` });
      const details = line.details.map((detail, detailIndex) => {
        const path = `lines.${index}.details.${detailIndex}`;
        const uom = Number(detail.inputUomId) === Number(poLine.base_uom_id) ? { factor: 1, code: poLine.base_uom_code_snapshot }
          : detail.inputUomId === purchaseUomIds.get(Number(poLine.purchase_sku_uom_id))
            ? { factor: Number(poLine.uom_to_base_factor_snapshot), code: poLine.purchase_uom_code_snapshot } : null;
        if (!uom) throw purchasingError("GR_DETAIL_MISMATCH", { field: `${path}.inputUomId` });
        const quantity = calculateBaseQuantity({ quantity: detail.receivedQuantity, factor: uom.factor, maxBaseQuantity: this.config.maxQuantity });
        throwBlocking(quantity.issues, path);
        const tracking = validateTracking({ policy: poLine.tracking_policy_snapshot, lotNumber: detail.lotNumber,
          expiryDate: detail.expiryDate, manufactureDate: detail.manufactureDate });
        throwBlocking(tracking.issues, path);
        locations.push({ path, warehouseId: detail.warehouseId, binId: detail.binId });
        return { ...detail, path, uom, quantity, tracking };
      });
      rows.push({ line, poLine, details });
    }
    const places = await this.#locations(tx, locations);
    const dimensions = rows.flatMap(({ poLine, details }) => details.map((detail) => ({ path: detail.path, purchaseOrderLineId: Number(poLine.id),
      warehouseId: detail.warehouseId, binId: detail.binId, skuId: Number(poLine.sku_id), normalizedLotNumber: detail.tracking.normalizedLotNumber,
      stockStatus: detail.stockStatus })));
    const duplicate = assertUniqueDimensions(dimensions).issues[0];
    if (duplicate) throw purchasingError("DUPLICATE_RECEIPT_DIMENSION", { field: duplicate.path });

    const total = rows.reduce((sum, { details }) => sum + details.reduce((lineSum, detail) => lineSum + detail.quantity.receivedBaseQuantity, 0), 0);
    if (!Number.isSafeInteger(total)) throw invalid("lines");
    const version = request.version + 1;
    const [updated] = await tx.query(`UPDATE goods_receipts SET business_receipt_date = ?, supplier_delivery_note = ?, notes = ?, supplier_exception_reason = ?,
      total_received_base_quantity = ?, updated_at = ?, updated_by = ?, updated_by_label = ?, version = ? WHERE id = ? AND version = ?`,
    [request.businessReceiptDate, request.supplierDeliveryNote, request.notes, request.supplierExceptionReason, total, nowMs, actor.id, actor.username,
      version, id, request.version]);
    if (Number(updated.affectedRows) !== 1) throw purchasingError("CONCURRENT_OPERATION");
    // 完整 replace（§8.5）：Draft 嘅 detail／line 喺 0120／0121 trigger 下可以刪；先刪 detail（FK）。
    await tx.query("DELETE FROM goods_receipt_details WHERE goods_receipt_id = ?", [id]);
    await tx.query("DELETE FROM goods_receipt_lines WHERE goods_receipt_id = ?", [id]);
    let detailNumber = 0;
    const detailRows = [];
    for (const [index, { line, poLine, details }] of rows.entries()) {
      const [insertedLine] = await tx.query("INSERT INTO goods_receipt_lines SET ?", [{
        goods_receipt_id: id, purchase_order_id: Number(po.id), purchase_order_line_id: Number(poLine.id), line_number: index + 1, sku_id: Number(poLine.sku_id),
        sku_code_snapshot: poLine.sku_code_snapshot, sku_name_snapshot: poLine.sku_name_snapshot,
        received_base_quantity: details.reduce((sum, detail) => sum + detail.quantity.receivedBaseQuantity, 0),
        over_receipt_reason: line.overReceiptReason, sku_exception_reason: line.skuExceptionReason, created_at: nowMs, updated_at: nowMs
      }]);
      for (const detail of details) {
        const place = places.get(detail.binId);
        detailNumber += 1;
        detailRows.push({ goods_receipt_id: id, goods_receipt_line_id: Number(insertedLine.insertId), purchase_order_id: Number(po.id),
          purchase_order_line_id: Number(poLine.id), detail_number: detailNumber, sku_id: Number(poLine.sku_id), sku_code_snapshot: poLine.sku_code_snapshot,
          sku_name_snapshot: poLine.sku_name_snapshot, input_uom_id: detail.inputUomId, input_uom_code_snapshot: detail.uom.code,
          uom_to_base_factor_snapshot: detail.uom.factor, received_quantity: detail.quantity.receivedQuantity,
          received_base_quantity: detail.quantity.receivedBaseQuantity, warehouse_id: detail.warehouseId, bin_id: detail.binId,
          warehouse_code_snapshot: place.warehouseCode, bin_code_snapshot: place.binCode, tracking_policy_applied: poLine.tracking_policy_snapshot,
          lot_number: detail.tracking.lotNumber, normalized_lot_number: detail.tracking.normalizedLotNumber, expiry_date: detail.tracking.expiryDate,
          manufacture_date: detail.tracking.manufactureDate, stock_status: detail.stockStatus, expiry_override_reason: detail.expiryOverrideReason,
          created_at: nowMs, updated_at: nowMs });
      }
    }
    if (detailRows.length) {
      await tx.query(`INSERT INTO goods_receipt_details (${DETAIL_COLUMNS.join(", ")}) VALUES ?`,
        [detailRows.map((row) => DETAIL_COLUMNS.map((column) => row[column]))]);
    }
    const warnings = await this.#duplicateNote(tx, { id, supplierId: gr.supplier_id, note: request.supplierDeliveryNote, date: request.businessReceiptDate });
    return this.#finish(tx, { kind: "UPDATE", id, number: gr.gr_number, status: "DRAFT", version, actor, trace, operationId, nowMs, context: command.context, warnings });
  }

  /** §8.5：只限 DRAFT、原因必填；保留編號同資料快照，唔刪除。 */
  async #cancel(tx, command, request) {
    const { goodsReceiptId: id } = command, nowMs = this.time.nowMs();
    const { actor, trace, operationId, replay } = await this.#claim(tx, command, request, nowMs);
    if (replay) return { ...replay, warnings: [], replayed: true };

    const gr = await this.#lockDraft(tx, id, request.version);
    const version = request.version + 1;
    const [updated] = await tx.query(`UPDATE goods_receipts SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?,
      updated_at = ?, updated_by = ?, updated_by_label = ?, version = ? WHERE id = ? AND version = ?`,
    [nowMs, actor.id, request.reason, nowMs, actor.id, actor.username, version, id, request.version]);
    if (Number(updated.affectedRows) !== 1) throw purchasingError("CONCURRENT_OPERATION");
    return this.#finish(tx, { kind: "CANCEL", id, number: gr.gr_number, status: "CANCELLED", version, actor, trace, operationId, nowMs,
      context: command.context, warnings: [], reason: request.reason });
  }

  async #lockDraft(tx, id, expectedVersion) {
    const [[gr]] = await tx.query("SELECT id, gr_number, status, version, supplier_id FROM goods_receipts WHERE id = ? FOR UPDATE", [id]);
    if (!gr) throw purchasingError("GOODS_RECEIPT_NOT_FOUND");
    if (gr.status !== "DRAFT") throw purchasingError("GR_STATE_CONFLICT");
    if (Number(gr.version) !== expectedVersion) throw purchasingError("VERSION_CONFLICT", { currentVersion: Number(gr.version) });
    return gr;
  }

  /** PO Line 存 purchase_sku_uom_id（item_sku_uoms）；detail 嘅 input_uom_id 係 item_uoms，所以要對返 Purchase UOM 嘅 uom_id。 */
  async #purchaseUomIds(tx, poLines) {
    const ids = [...new Set(poLines.map((line) => Number(line.purchase_sku_uom_id)))];
    if (!ids.length) return new Map();
    const [rows] = await tx.query(`SELECT id, uom_id FROM item_sku_uoms WHERE id IN (${ids.map(() => "?").join(", ")})`, ids);
    return new Map(rows.map((row) => [Number(row.id), Number(row.uom_id)]));
  }

  /**
   * Draft 只驗 Warehouse 存在、Bin 存在而且屬於嗰個 Warehouse（§8.5；TL：有效狀態留畀 Confirm 時 Inventory 驗）。
   * 冇 provider，跟 PO 先例喺 transaction 入面唯讀。
   */
  async #locations(tx, locations) {
    const places = new Map();
    if (!locations.length) return places;
    const warehouseIds = [...new Set(locations.map(({ warehouseId }) => warehouseId))], binIds = [...new Set(locations.map(({ binId }) => binId))];
    const [warehouses] = await tx.query(`SELECT id, warehouse_code FROM inventory_warehouses WHERE id IN (${warehouseIds.map(() => "?").join(", ")})`, warehouseIds);
    const [bins] = await tx.query(`SELECT id, warehouse_id, bin_code FROM inventory_bins WHERE id IN (${binIds.map(() => "?").join(", ")})`, binIds);
    const warehouseCodes = new Map(warehouses.map((row) => [Number(row.id), row.warehouse_code]));
    const binRows = new Map(bins.map((row) => [Number(row.id), row]));
    for (const { path, warehouseId, binId } of locations) {
      if (!warehouseCodes.has(warehouseId)) throw purchasingError("WAREHOUSE_INVALID", { field: `${path}.warehouseId` });
      const bin = binRows.get(binId);
      if (!bin) throw purchasingError("BIN_INVALID", { field: `${path}.binId` });
      if (Number(bin.warehouse_id) !== warehouseId) throw purchasingError("BIN_WAREHOUSE_MISMATCH", { field: `${path}.binId` });
      places.set(binId, { warehouseCode: warehouseCodes.get(warehouseId), binCode: bin.bin_code });
    }
    return places;
  }

  /** §8.5：同 Supplier、非 Cancelled、近 90 日、最多 5 張同一個 Delivery Note；只係 warning，唔擋保存。 */
  async #duplicateNote(tx, { id, supplierId, note, date }) {
    if (note === "") return [];
    const [[{ count }]] = await tx.query(`SELECT COUNT(*) AS count FROM (SELECT id FROM goods_receipts
      WHERE supplier_id = ? AND supplier_delivery_note = ? AND status <> 'CANCELLED' AND id <> ?
        AND business_receipt_date >= DATE_SUB(?, INTERVAL ${DUPLICATE_NOTE_DAYS} DAY) LIMIT ${DUPLICATE_NOTE_LIMIT}) AS recent`, [supplierId, note, id, date]);
    return Number(count) > 0 ? [{ code: "DUPLICATE_DELIVERY_NOTE", field: "supplierDeliveryNote", count: Number(count) }] : [];
  }

  async #finish(tx, { kind, id, number, status, version, actor, trace, operationId, nowMs, context, warnings, reason = "" }) {
    const summary = { id, number, status, version };
    await this.audit.record(tx, { actor, action: AUDIT_ACTION[kind], targetId: id, targetLabel: number, detail: { version }, reason, nowMs, ip: context.ip, ...trace });
    await this.operations.complete(tx, { operationId, result: summary, nowMs });
    return { ...summary, warnings, replayed: false };
  }

  async #rejected({ kind, claims, goodsReceiptId, context }, error) {
    const action = error.code === "PURCHASING_EVENT_CONFLICT" ? "purchasing.operation_conflict" : AUDIT_ACTION[kind];
    const targetId = Number.isSafeInteger(goodsReceiptId) && goodsReceiptId > 0 ? goodsReceiptId : null;
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
