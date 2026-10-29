import { inventoryError } from "./inventoryErrors.js";
import { inventoryPositiveInteger } from "./inventoryValidation.js";
import { getActiveTransactionIsolation } from "../../services/mysqldatabase/MySqlDatabaseService.js";

// Schema installation drains Inventory transactions; never reuse proof across transactions.
const preStocktakeTransactions = new WeakSet();

// Internal posting reuse requires the actual reader's complete absent-schema proof.
export function hasPreStocktakeCandidateProof(transaction){return getActiveTransactionIsolation(transaction)!==null&&preStocktakeTransactions.has(transaction);}

function compare(left, right) {
  if(typeof left==="string"&&typeof right==="string")return Buffer.compare(Buffer.from(left,"utf8"),Buffer.from(right,"utf8"));
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortKey(row) {
  if (row.expiryDate) return [0, row.expiryDate, row.lotKey, row.firstReceiptDate, row.binCode, row.id];
  if (row.lotId !== null) return [1, row.firstReceiptDate, row.lotKey, row.binCode, row.id];
  return [2, row.fifoAnchorDate, row.binCode, row.id];
}

export function rankInventoryCandidates(rows) {
  return [...rows].sort((left, right) => {
    const a = sortKey(left);
    const b = sortKey(right);
    for (let index = 0; index < a.length; index += 1) {
      const order = compare(a[index], b[index]);
      if (order) return order;
    }
    return 0;
  });
}

export function recommendInventoryCandidates(candidates, requestedQuantity) {
  let remaining = inventoryPositiveInteger(requestedQuantity);
  const recommended = [];
  for (const candidate of candidates) {
    const quantity = Math.min(remaining, candidate.freeQuantity);
    if (quantity > 0) recommended.push({ balanceId: candidate.id, quantity });
    remaining -= quantity;
    if (remaining === 0) return recommended;
  }
  throw inventoryError("ALLOCATION_INSUFFICIENT", { requested: requestedQuantity });
}

function cutoffDate(currentDate, days) {
  const start = Date.parse(`${currentDate}T00:00:00.000Z`);
  if (!Number.isSafeInteger(days) || days < 0 || days > 36_500 ||
      !Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== currentDate) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "minimumRemainingDays" });
  }
  return new Date(start + days * 86_400_000).toISOString().slice(0, 10);
}

function positiveId(value, field) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
  return normalized;
}

function rowCandidate(row, credits = null) {
  const onHand = Number(row.on_hand_quantity);
  const allocated = Number(row.allocated_quantity);
  const release=credits===null?0:Number(row.own_release_credit),physical=onHand-allocated,available=physical+release;
  if (!Number.isSafeInteger(onHand) || !Number.isSafeInteger(allocated) || allocated<0 || onHand<allocated ||
      !Number.isSafeInteger(release)||release<0||release>allocated||credits!==null&&release!==(credits.get(String(row.id))??0)||
      !Number.isSafeInteger(available)||available<=0)throw inventoryError("INVENTORY_DEPENDENCY_UNAVAILABLE");
  return {
    id: positiveId(row.id, "balanceId"), binId: positiveId(row.bin_id, "binId"),
    lotId: row.lot_id === null ? null : positiveId(row.lot_id, "lotId"),
    version: positiveId(row.version, "balanceVersion"),
    freeQuantity: available,
    ...(credits===null?{}:{physicalFreeQuantity:physical,ownReleaseCredit:release,availableAfterOwnRelease:available}),
    binCode: row.bin_code, lotKey: row.normalized_lot_number,
    expiryDate: row.expiry_date, firstReceiptDate: row.first_receipt_date,
    fifoAnchorDate: row.fifo_anchor_date
  };
}

async function loadCandidates(transaction, {
  warehouseId, skuId, currentDate, minimumRemainingDays, trackingPolicy,
  limit, offset = 0, locking = false
}, credits = null) {
  const warehouse = positiveId(warehouseId, "warehouseId");
  const sku = positiveId(skuId, "skuId");
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0 || limit > 101)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "limit" });
  }
  if (!Number.isSafeInteger(offset) || offset < 0 || (offset > 0 && limit === undefined)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "offset" });
  }
  const trackingCondition = {
    none: "b.lot_id IS NULL",
    batch: "b.lot_id IS NOT NULL",
    batch_expiry: "b.lot_id IS NOT NULL AND l.expiry_date IS NOT NULL"
  }[trackingPolicy];
  if (!trackingCondition) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "trackingPolicy" });
  const cutoff = cutoffDate(currentDate, minimumRemainingDays),entries=credits===null?[]:[...credits];
  const creditJoin=entries.length?`\n       LEFT JOIN (${entries.map((_,index)=>index===0?"SELECT ? AS balance_id,? AS release_quantity":"SELECT ?,?").join(" UNION ALL ")}) own_release ON own_release.balance_id=b.id`:"";
  const creditExpression=entries.length?"COALESCE(own_release.release_quantity,0)":"0";
  const query = async (checkLocks) => transaction.query(
    `SELECT b.id, b.bin_id, b.lot_id, b.version, b.on_hand_quantity, b.allocated_quantity,
            bn.bin_code, l.normalized_lot_number,
            DATE_FORMAT(l.expiry_date, '%Y-%m-%d') AS expiry_date,
            DATE_FORMAT(l.first_receipt_date, '%Y-%m-%d') AS first_receipt_date,
            DATE_FORMAT(b.fifo_anchor_date, '%Y-%m-%d') AS fifo_anchor_date${credits===null?"":`, ${creditExpression} AS own_release_credit`}
       FROM inventory_stock_balances b${creditJoin}
       JOIN inventory_bins bn ON bn.id = b.bin_id AND bn.warehouse_id = b.warehouse_id
       LEFT JOIN inventory_lots l ON l.id = b.lot_id AND l.sku_id = b.sku_id
      WHERE b.warehouse_id = ? AND b.sku_id = ? AND b.stock_status = 'AVAILABLE'
        AND ${credits===null?"b.on_hand_quantity > b.allocated_quantity":`b.on_hand_quantity >= b.allocated_quantity AND (b.on_hand_quantity-b.allocated_quantity+${creditExpression})>0`} AND bn.status = 'ACTIVE'
        AND ${trackingCondition}
        AND (l.expiry_date IS NULL OR l.expiry_date >= ?)
        ${checkLocks ? `AND NOT EXISTS (SELECT 1 FROM inventory_bin_locks k
                           WHERE k.bin_id = b.bin_id AND k.released_at IS NULL)` : ""}
      ORDER BY CASE WHEN l.expiry_date IS NOT NULL THEN 0 WHEN l.id IS NOT NULL THEN 1 ELSE 2 END,
               l.expiry_date,
               CASE WHEN l.expiry_date IS NOT NULL THEN l.normalized_lot_number END,
               l.first_receipt_date, l.normalized_lot_number,
               CASE WHEN l.id IS NULL THEN b.fifo_anchor_date END,
               bn.bin_code COLLATE utf8mb4_bin, b.id
      ${limit === undefined ? "" : "LIMIT ?"}
      ${offset === 0 ? "" : "OFFSET ?"}
      ${locking ? "FOR SHARE OF b" : ""}`,
    [...entries.flatMap(([id,credit])=>[Number(id),credit]), warehouse, sku, cutoff, ...(limit === undefined ? [] : [limit]), ...(offset === 0 ? [] : [offset])]
  );
  let rows;
  try {
    const absent = getActiveTransactionIsolation(transaction) !== null && preStocktakeTransactions.has(transaction);
    [rows] = await query(!absent);
  } catch (error) {
    if ((error?.cause?.code ?? error?.code) !== "ER_NO_SUCH_TABLE") throw error;
    const [tables] = await transaction.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()
         AND table_name IN ('inventory_stocktakes', 'inventory_bin_locks')`
    );
    if (tables.length !== 0) throw error;
    [rows] = await query(false);
    if (getActiveTransactionIsolation(transaction) !== null) preStocktakeTransactions.add(transaction);
  }
  return rankInventoryCandidates(rows.map(row=>rowCandidate(row,credits)).filter((row) =>
    (row.expiryDate === null || row.expiryDate >= cutoff) &&
    (trackingPolicy === "none" ? row.lotId === null : row.lotId !== null) &&
    (trackingPolicy !== "batch_expiry" || row.expiryDate !== null)));
}

// The physical reader keeps its existing SQL, parameters and DTO when no credits exist.
export function loadInventoryCandidates(transaction,query){return loadCandidates(transaction,query);}

// Internal owner reader: callers must independently prove complete current own Allocation credits.
export function loadFulfillmentReallocationCandidates(transaction,query,credits){
 if(!(credits instanceof Map)||credits.size>5000)throw inventoryError("INVENTORY_INPUT_INVALID");
 for(const [id,quantity]of credits)if(typeof id!=="string"||!/^[1-9][0-9]{0,15}$/u.test(id)||BigInt(id)>BigInt(Number.MAX_SAFE_INTEGER)||!Number.isSafeInteger(quantity)||quantity<1)throw inventoryError("INVENTORY_INPUT_INVALID");
 return loadCandidates(transaction,query,credits);
}
