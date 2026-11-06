import { permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { ItemLookupService } from "../item/ItemLookupService.js";
import { storedAmount } from "./moneyMath.js";
import { purchasingError } from "./purchasingErrors.js";
import { localDate, positiveId } from "./purchasingValidation.js";

const SORT = Object.freeze({ updatedAt: "updated_at", number: "po_number", supplierName: "supplier_name_snapshot", orderDate: "order_date",
  expectedDeliveryDate: "expected_delivery_date", status: "status", totalAmount: "total_amount" });
// HD-017 4A：Draft 嘅 has_outstanding 預設係 1，但未確認嘅單冇嘢要收；Outstanding 只計已確認、仲收緊貨嘅 PO。
const RECEIVING = ["CONFIRMED", "PARTIALLY_RECEIVED"];
const RECEIVING_SQL = RECEIVING.map((status) => `'${status}'`).join(",");
const OUTSTANDING = `(po.has_outstanding = 1 AND po.status IN (${RECEIVING_SQL}))`;
// BIGINT UNSIGNED 相減會 overflow，要先轉 SIGNED。
const LINE_OUTSTANDING = `GREATEST(CAST(l.ordered_base_quantity AS SIGNED) - CAST(l.net_received_base_quantity AS SIGNED)
  - CAST(l.closed_remaining_base_quantity AS SIGNED), 0)`;
const PO_NUMBER = /^PO-\d{6}-\d{6}$/u;
const MAX_SEARCH_IDS = 100; // 設計 §8.9：名稱搜尋最多 100 個 ID。
const date = (column) => `DATE_FORMAT(${column}, '%Y-%m-%d') AS ${column}`;
const SUMMARY = `id, po_number, status, version, supplier_id, supplier_code_snapshot, supplier_name_snapshot, currency_code,
  currency_decimal_places_snapshot, ${date("order_date")},
  ${date("expected_delivery_date")}, buyer_id, buyer_label, supplier_reference, total_amount, has_outstanding, created_at, updated_at`;
const DETAIL = `${SUMMARY}, ordering_address_id, ordering_address_snapshot, currency_name_snapshot, payment_term_id,
  payment_term_snapshot, default_receiving_warehouse_id, default_warehouse_code_snapshot, notes, subtotal_amount, has_confirmed_receipt, created_by_label,
  updated_by_label, confirmed_at, closed_at, cancelled_at`;
const LINE = `id, line_number, sku_id, sku_code_snapshot, sku_name_snapshot, tracking_policy_snapshot, inventory_tracked_snapshot,
  minimum_receipt_life_days_snapshot, base_uom_id, base_uom_code_snapshot, purchase_sku_uom_id, purchase_uom_code_snapshot, uom_to_base_factor_snapshot,
  supplier_item_code_snapshot, ordered_quantity, ordered_base_quantity, unit_price, line_amount, zero_price_reason, ${date("expected_delivery_date")}, line_note,
  gross_received_base_quantity, reversed_base_quantity, net_received_base_quantity, closed_remaining_base_quantity, close_reason, version`;

const invalid = (field) => purchasingError("PURCHASING_INPUT_INVALID", { field });
const nullableId = (value) => value === null ? null : Number(value);
const nonNegative = (value) => value > 0n ? value : 0n;
const placeholders = (values) => values.map(() => "?").join(",");
// allowedActions 只列已有 route 嘅動作；submit、cancel 等由落地嘅 Task 加。
const allowedActions = (status, permissions) => !permissions.includes("purchasing.mgmt") ? [] : status === "DRAFT" ? ["edit", "submit", "copy"] : ["copy"];
// §7.4：跟操作者。列表唔讀審批，所以呢三個動作只喺詳情出；service 喺 transaction 入面會再驗。
function decisionActions(pending, actorId, permissions) {
  if (!pending) return [];
  // 審批人一定係另一個人（提交時驗咗），所以 assigned 唔使再排除提交人。
  const assigned = Number(pending.assigned_approver_id) === actorId && permissions.includes("purchasing.approval");
  const requester = Number(pending.requested_by) === actorId && permissions.includes("purchasing.mgmt");
  return [...(assigned ? ["approve", "reject"] : []), ...(requester ? ["withdraw"] : [])];
}

function listQuery(input) {
  const query = { page: 1, pageSize: 20, sortBy: "updatedAt", descending: true, ...input };
  if (!Object.hasOwn(SORT, query.sortBy)) throw invalid("sortBy");
  if (!Number.isSafeInteger((query.page - 1) * query.pageSize)) throw invalid("page");
  for (const prefix of ["orderDate", "expectedDeliveryDate"]) {
    // Schema 嘅 format 收 2026-02-30；真日子先可以交畀 MySQL。
    for (const field of [`${prefix}From`, `${prefix}To`]) if (query[field] !== undefined) localDate(query[field], field);
    if (query[`${prefix}From`] !== undefined && query[`${prefix}To`] !== undefined && query[`${prefix}From`] > query[`${prefix}To`]) throw invalid(prefix);
  }
  const q = String(query.q ?? "").normalize("NFKC").trim();
  if (/\p{Cc}/u.test(q)) throw invalid("q");
  return { ...query, q };
}

function listWhere(query, search, scope = null) {
  const clauses = [], values = [];
  const add = (clause, ...params) => { clauses.push(clause); values.push(...params); };
  if (scope) add(...scope);
  if (query.status !== undefined) { const statuses = [query.status].flat(); add(`po.status IN (${placeholders(statuses)})`, ...statuses); }
  if (query.supplierId !== undefined) add("po.supplier_id = ?", query.supplierId);
  if (query.buyerId !== undefined) add("po.buyer_id = ?", query.buyerId);
  if (query.currencyCode !== undefined) add("po.currency_code = ?", query.currencyCode);
  if (query.skuId !== undefined) add("EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.purchase_order_id = po.id AND l.sku_id = ?)", query.skuId);
  if (query.hasOutstanding !== undefined) add(query.hasOutstanding ? OUTSTANDING : `NOT ${OUTSTANDING}`);
  for (const [field, column] of [["orderDate", "po.order_date"], ["expectedDeliveryDate", "po.expected_delivery_date"]]) {
    if (query[`${field}From`] !== undefined) add(`${column} >= ?`, query[`${field}From`]);
    if (query[`${field}To`] !== undefined) add(`${column} <= ?`, query[`${field}To`]);
  }
  if (search) {
    const matches = ["po.supplier_reference = ?"], params = [search.reference];
    if (search.number) { matches.push("po.po_number = ?"); params.push(search.number); }
    if (search.supplierIds.length) { matches.push(`po.supplier_id IN (${placeholders(search.supplierIds)})`); params.push(...search.supplierIds); }
    if (search.skuIds.length) {
      matches.push(`EXISTS (SELECT 1 FROM purchase_order_lines l WHERE l.purchase_order_id = po.id AND l.sku_id IN (${placeholders(search.skuIds)}))`);
      params.push(...search.skuIds);
    }
    add(`(${matches.join(" OR ")})`, ...params);
  }
  return { where: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", values };
}

function toPurchaseOrderSummary(row, progress, inactiveMaster, permissions) {
  const receiving = RECEIVING.includes(row.status);
  const risks = [...(receiving && Number(progress.overdue) === 1 ? ["OVERDUE"] : []), ...(Number(progress.over_received) === 1 ? ["OVER_RECEIVED"] : []),
    ...(Number(progress.zero_price) === 1 ? ["ZERO_PRICE"] : []), ...(inactiveMaster ? ["INACTIVE_MASTER"] : [])];
  return {
    ...toHeader(row, permissions), lineCount: Number(progress.line_count), orderedBaseQuantity: String(progress.ordered),
    netReceivedBaseQuantity: String(progress.net_received), outstandingBaseQuantity: receiving ? String(progress.outstanding) : "0",
    closedRemainingBaseQuantity: String(progress.closed_remaining), risks
  };
}

function toHeader(row, permissions) {
  return {
    id: Number(row.id), number: row.po_number, status: row.status, version: Number(row.version), supplierId: Number(row.supplier_id),
    supplierCode: row.supplier_code_snapshot, supplierName: row.supplier_name_snapshot, currencyCode: row.currency_code, orderDate: row.order_date,
    expectedDeliveryDate: row.expected_delivery_date, buyerId: nullableId(row.buyer_id), buyerLabel: row.buyer_label, supplierReference: row.supplier_reference,
    totalAmount: storedAmount(row.total_amount, Number(row.currency_decimal_places_snapshot)), hasOutstanding: Boolean(row.has_outstanding) && RECEIVING.includes(row.status),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), allowedActions: allowedActions(row.status, permissions)
  };
}

function toPurchaseOrderLine(row, receiving, places) {
  const ordered = BigInt(row.ordered_base_quantity), net = BigInt(row.net_received_base_quantity), closed = BigInt(row.closed_remaining_base_quantity);
  return {
    id: Number(row.id), lineNumber: Number(row.line_number), skuId: Number(row.sku_id), skuCode: row.sku_code_snapshot, skuName: row.sku_name_snapshot,
    trackingPolicy: row.tracking_policy_snapshot, inventoryTracked: Boolean(row.inventory_tracked_snapshot),
    minimumReceiptLifeDays: nullableId(row.minimum_receipt_life_days_snapshot), baseUomId: Number(row.base_uom_id), baseUomCode: row.base_uom_code_snapshot,
    purchaseSkuUomId: Number(row.purchase_sku_uom_id), purchaseUomCode: row.purchase_uom_code_snapshot, uomToBaseFactor: Number(row.uom_to_base_factor_snapshot),
    supplierItemCode: row.supplier_item_code_snapshot, orderedQuantity: String(row.ordered_quantity), orderedBaseQuantity: String(ordered),
    unitPrice: String(row.unit_price), lineAmount: storedAmount(row.line_amount, places), zeroPriceReason: row.zero_price_reason, expectedDeliveryDate: row.expected_delivery_date,
    lineNote: row.line_note, grossReceivedBaseQuantity: String(row.gross_received_base_quantity), reversedBaseQuantity: String(row.reversed_base_quantity),
    netReceivedBaseQuantity: String(net), outstandingBaseQuantity: receiving ? String(nonNegative(ordered - net - closed)) : "0",
    overReceivedBaseQuantity: String(nonNegative(net - ordered)), closedRemainingBaseQuantity: String(closed), closeReason: row.close_reason,
    version: Number(row.version)
  };
}

const toApprovalSummary = (row) => ({ id: Number(row.id), status: row.status, purchaseOrderVersion: Number(row.purchase_order_version), requestedByLabel: row.requested_by_label,
  approverLabel: row.approver_label, requestNote: row.request_note, decisionReason: row.decision_reason, requestedAt: Number(row.requested_at), decidedAt: nullableId(row.decided_at) });
const toStatusHistory = (row) => ({ sequenceNo: Number(row.sequence_no), fromStatus: row.from_status, toStatus: row.to_status, action: row.action, reason: row.reason,
  version: Number(row.purchase_order_version_after), actorLabel: row.actor_label, occurredAt: Number(row.occurred_at) });
const toMyApproval = (row) => ({ approvalId: Number(row.id), purchaseOrderId: Number(row.purchase_order_id), number: row.po_number, purchaseOrderVersion: Number(row.purchase_order_version),
  supplierCode: row.supplier_code_snapshot, supplierName: row.supplier_name_snapshot, currencyCode: row.currency_code,
  totalAmount: storedAmount(row.total_amount, Number(row.currency_decimal_places_snapshot)), requestedByLabel: row.requested_by_label, requestNote: row.request_note, requestedAt: Number(row.requested_at) });

/** §2.8（HD-009）：API 一律回 Currency 小數位。儲存嘅快照同 hash 唔郁，只喺回傳時格式化。 */
function toApprovalSnapshot(snapshot) {
  const places = snapshot.currency.decimalPlaces;
  return { ...snapshot, subtotalAmount: storedAmount(snapshot.subtotalAmount, places), totalAmount: storedAmount(snapshot.totalAmount, places),
    lines: snapshot.lines.map((line) => ({ ...line, lineAmount: storedAmount(line.lineAmount, places) })) };
}

function toPurchaseOrderDetail(row, lines, permissions, { approvals, pending, snapshot, history, actorId }) {
  const header = toHeader(row, permissions);
  return {
    ...header, allowedActions: [...header.allowedActions, ...decisionActions(pending, actorId, permissions)],
    approval: pending && { ...toApprovalSummary(pending), snapshot: toApprovalSnapshot(snapshot) }, approvalHistory: approvals.map(toApprovalSummary), statusHistory: history.map(toStatusHistory),
    orderingAddressId: nullableId(row.ordering_address_id), orderingAddress: row.ordering_address_snapshot,
    currencyName: row.currency_name_snapshot, currencyDecimalPlaces: Number(row.currency_decimal_places_snapshot),
    paymentTermId: nullableId(row.payment_term_id), paymentTerm: row.payment_term_snapshot,
    defaultReceivingWarehouseId: nullableId(row.default_receiving_warehouse_id), defaultWarehouseCode: row.default_warehouse_code_snapshot,
    notes: row.notes, subtotalAmount: storedAmount(row.subtotal_amount, Number(row.currency_decimal_places_snapshot)), hasConfirmedReceipt: Boolean(row.has_confirmed_receipt),
    createdByLabel: row.created_by_label, updatedByLabel: row.updated_by_label, confirmedAt: nullableId(row.confirmed_at), closedAt: nullableId(row.closed_at),
    cancelledAt: nullableId(row.cancelled_at), lines: lines.map((line) => toPurchaseOrderLine(line, RECEIVING.includes(row.status), Number(row.currency_decimal_places_snapshot)))
  };
}

/**
 * PO 列表同詳情（設計 §5.2、§5.6、§8.9；TASK-016）。每個 response 都係具名 mapping，唔 spread DB row；Supplier 銀行同內部欄位根本唔讀。
 * Query 數量固定（§8.9：先查 ID page，再用 batch 載 summary），唔跟 PO 或 Line 數量增加。
 * 冇 GR 欄位（HD-017 3A）：張表由 TASK-027 加，到時先回，唔回假嘅空陣列。
 */
export class PurchasingInquiryService {
  constructor({ database, logger, time, suppliers }) {
    if (!database || !logger || !time || !suppliers) throw new TypeError("PurchasingInquiryService requires all of its dependencies");
    Object.assign(this, { database, logger, time, suppliers });
  }

  async list({ claims, input = {} }) {
    const query = listQuery(input), today = this.time.fileDate(this.time.at(this.time.nowMs()));
    return this.database.withTransaction(async (tx) => {
      const { permissions } = await this.#actor(tx, claims);
      const { where, values } = listWhere(query, query.q ? await this.#search(tx, query.q) : null);
      const [[{ total }]] = await tx.query(`SELECT COUNT(*) AS total FROM purchase_orders po${where}`, values);
      const direction = query.descending ? "DESC" : "ASC";
      const [page] = await tx.query(`SELECT po.id FROM purchase_orders po${where} ORDER BY po.${SORT[query.sortBy]} ${direction}, po.id ${direction} LIMIT ? OFFSET ?`,
        [...values, query.pageSize, (query.page - 1) * query.pageSize]);
      const result = { total: Number(total), page: query.page, pageSize: query.pageSize };
      if (!page.length) return { items: [], ...result };

      const ids = page.map((row) => Number(row.id)), marks = placeholders(ids);
      const [rows] = await tx.query(`SELECT ${SUMMARY} FROM purchase_orders WHERE id IN (${marks})`, ids);
      const [progress] = await tx.query(`SELECT l.purchase_order_id, COUNT(*) AS line_count, SUM(l.ordered_base_quantity) AS ordered,
          SUM(l.net_received_base_quantity) AS net_received, SUM(l.closed_remaining_base_quantity) AS closed_remaining, SUM(${LINE_OUTSTANDING}) AS outstanding,
          MAX(l.net_received_base_quantity > l.ordered_base_quantity) AS over_received, MAX(l.unit_price = 0) AS zero_price,
          MAX(${LINE_OUTSTANDING} > 0 AND COALESCE(l.expected_delivery_date, po.expected_delivery_date) < ?) AS overdue
        FROM purchase_order_lines l JOIN purchase_orders po ON po.id = l.purchase_order_id
        WHERE l.purchase_order_id IN (${marks}) GROUP BY l.purchase_order_id`, [today, ...ids]);
      const [inactive] = await tx.query(`SELECT po.id FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id WHERE po.id IN (${marks}) AND s.status <> 'active'
        UNION SELECT l.purchase_order_id FROM purchase_order_lines l JOIN item_skus k ON k.id = l.sku_id JOIN items i ON i.id = k.item_id
        WHERE l.purchase_order_id IN (${marks}) AND (k.status <> 'active' OR i.status <> 'active')`, [...ids, ...ids]);

      const byId = new Map(rows.map((row) => [Number(row.id), row]));
      const progressById = new Map(progress.map((row) => [Number(row.purchase_order_id), row]));
      const inactiveIds = new Set(inactive.map((row) => Number(row.id)));
      return { items: ids.map((id) => toPurchaseOrderSummary(byId.get(id), progressById.get(id), inactiveIds.has(id), permissions)), ...result };
    });
  }

  /** §5.2：待我審批，舊嘅排先（idx_po_approvals_assignee）。快照可以去到 1MiB，所以唔喺列表回，揀咗先由詳情攞。 */
  async myApprovals({ claims, input = {} }) {
    const query = listQuery(input);
    return this.database.withTransaction(async (tx) => {
      const { id: actorId, permissions } = await this.#actor(tx, claims);
      if (!permissions.includes("purchasing.approval")) throw permissionStaleError();
      const { where, values } = listWhere(query, query.q ? await this.#search(tx, query.q) : null, ["a.assigned_approver_id = ? AND a.status = 'PENDING'", actorId]);
      const from = `FROM purchase_order_approvals a JOIN purchase_orders po ON po.id = a.purchase_order_id${where}`;
      const [[{ total }]] = await tx.query(`SELECT COUNT(*) AS total ${from}`, values);
      const [rows] = await tx.query(`SELECT a.id, a.purchase_order_id, a.purchase_order_version, a.requested_by_label, a.request_note, a.requested_at, po.po_number, po.supplier_code_snapshot,
        po.supplier_name_snapshot, po.currency_code, po.currency_decimal_places_snapshot, po.total_amount ${from} ORDER BY a.requested_at, a.id LIMIT ? OFFSET ?`,
      [...values, query.pageSize, (query.page - 1) * query.pageSize]);
      return { items: rows.map(toMyApproval), total: Number(total), page: query.page, pageSize: query.pageSize };
    });
  }

  async get({ claims, id }) {
    positiveId(id, "id");
    const detail = await this.database.withTransaction(async (tx) => {
      const { id: actorId, permissions } = await this.#actor(tx, claims);
      const [[row]] = await tx.query(`SELECT ${DETAIL} FROM purchase_orders WHERE id = ?`, [id]);
      if (!row) throw purchasingError("PURCHASE_ORDER_NOT_FOUND");
      const [lines] = await tx.query(`SELECT ${LINE} FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number`, [id]);
      const [approvals] = await tx.query(`SELECT id, status, purchase_order_version, requested_by, assigned_approver_id, requested_by_label, approver_label, request_note, decision_reason,
        requested_at, decided_at FROM purchase_order_approvals WHERE purchase_order_id = ? ORDER BY requested_at, id`, [id]);
      // 只讀 Pending 嗰份快照：§7.4 要完整顯示，但舊申請每份都可以去到 1MiB。
      const pending = approvals.find((approval) => approval.status === "PENDING") ?? null;
      const [[stored]] = pending ? await tx.query("SELECT approval_snapshot FROM purchase_order_approvals WHERE id = ?", [pending.id]) : [[null]];
      const [history] = await tx.query(`SELECT sequence_no, from_status, to_status, action, reason, purchase_order_version_after, actor_label, occurred_at
        FROM purchase_order_status_history WHERE purchase_order_id = ? ORDER BY sequence_no`, [id]);
      return toPurchaseOrderDetail(row, lines, permissions, { approvals, pending, snapshot: stored?.approval_snapshot, history, actorId });
    });
    return { ...detail, currentMasterDifferences: await this.#differences(detail) };
  }

  /** Read path 都要 token 同 DB 權限一致（同 Sales 一樣）；allowedActions 用呢度讀到嘅權限，唔信 JWT。 */
  async #actor(tx, claims) {
    const fresh = await assertActorFresh(tx, { actorId: Number(claims?.sub), claimedRoles: claims?.roles, claimedPermissions: claims?.permissions });
    if (!fresh.permissions.includes("purchasing.view")) throw permissionStaleError();
    return fresh;
  }

  /**
   * §8.9：名稱先變 ID，再靠 idx_po_supplier／idx_po_lines_sku 篩，唔掃交易表嘅快照。HD-017 1A：provider 搵唔到已停用主檔嘅名稱，
   * 舊 PO 又要搵得返，所以直接唯讀主檔，只攞 ID。完全相符嘅 code 排先，唔會畀 100 個上限截走。比對嘅係目前名稱，改名前嘅舊名搵唔到。
   */
  async #search(tx, q) {
    const prefix = `${q.replace(/[!%_]/gu, (match) => `!${match}`)}%`, key = q.toLowerCase();
    const [suppliers] = await tx.query(`SELECT id FROM suppliers
      WHERE supplier_code_key LIKE ? ESCAPE '!' OR supplier_name LIKE ? ESCAPE '!' OR display_name LIKE ? ESCAPE '!'
      ORDER BY supplier_code_key = ? DESC, id LIMIT ?`, [prefix.toLowerCase(), prefix, prefix, key, MAX_SEARCH_IDS]);
    const [skus] = await tx.query(`SELECT s.id FROM item_skus s JOIN items i ON i.id = s.item_id
      WHERE s.sku_code LIKE ? ESCAPE '!' OR s.sku_name LIKE ? ESCAPE '!' OR i.name LIKE ? ESCAPE '!'
      ORDER BY s.sku_code = ? DESC, s.id LIMIT ?`, [prefix, prefix, prefix, q, MAX_SEARCH_IDS]);
    const barcode = await new ItemLookupService({ database: tx, logger: this.logger, time: this.time }).findByBarcode(q, { includeInactive: true });
    // po_number 係 ascii_bin：非 ASCII 字一比就 ER_CANNOT_CONVERT_STRING，所以唔係編號形狀就唔比。
    const number = q.toUpperCase();
    return { number: PO_NUMBER.test(number) ? number : null, reference: q, supplierIds: suppliers.map((row) => Number(row.id)),
      skuIds: [...new Set([...(barcode ? [barcode.skuId] : []), ...skus.map((row) => Number(row.id))])] };
  }

  /**
   * §5.6：目前主資料同交易快照分開（AC-051），只回有分別嘅。Provider 嘅 InTransaction 方法會鎖 Supplier，所以喺 transaction 之後用唔鎖嘅讀法，
   * 亦唔會喺拎住連線時再借一條。
   */
  async #differences(detail) {
    const atMs = this.time.nowMs();
    const supplier = await this.suppliers.findById(detail.supplierId, { purpose: "history", atMs });
    const skus = await new ItemLookupService({ database: this.database, logger: this.logger, time: this.time })
      .findManyByIds(detail.lines.map((line) => line.skuId), { includeInactive: true });
    const lines = [];
    for (const line of detail.lines) {
      const sku = skus.get(line.skuId);
      if (sku.skuCode !== line.skuCode || sku.skuName !== line.skuName || sku.skuStatus !== "active" || sku.itemStatus !== "active") {
        lines.push({ lineId: line.id, skuId: sku.skuId, skuCode: sku.skuCode, skuName: sku.skuName, skuStatus: sku.skuStatus, itemStatus: sku.itemStatus });
      }
    }
    const supplierChanged = supplier.supplierCode !== detail.supplierCode || supplier.supplierName !== detail.supplierName || supplier.status !== "active";
    return { supplier: supplierChanged ? { supplierCode: supplier.supplierCode, supplierName: supplier.supplierName, status: supplier.status } : null, lines };
  }
}
