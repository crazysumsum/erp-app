import { asciiPredicate } from "../../services/mysqldatabase/asciiPredicate.js";
import { permissionStaleError } from "../authorization/adminGuard.js";
import { assertActorFresh } from "../authorization/directoryLookups.js";
import { purchasingError } from "./purchasingErrors.js";

const MAX_ROWS = 100;
const prefix = (q) => `${q.replace(/[!%_]/gu, (match) => `!${match}`)}%`;
function term(q) {
  if (q === undefined || q === "") return null;
  if (typeof q !== "string" || [...q].length > 100 || /\p{Cc}/u.test(q)) throw purchasingError("PURCHASING_INPUT_INVALID", { field: "q" });
  return q.trim() ? prefix(q.trim()) : null;
}

/**
 * 收貨頁面嘅選項（設計 §5.5 receiving-lookups）：可收貨 PO、Active 倉、倉內 Active Bin。要 purchasing.view＋receiving.operation；
 * 提交時 service 會再驗，所以呢度只係選項。最多 100 行。
 */
export class ReceivingLookupService {
  constructor({ database }) {
    if (!database) throw new TypeError("ReceivingLookupService requires a database");
    this.database = database;
  }

  purchaseOrders({ claims, q }) {
    const like = term(q);
    const number = like && asciiPredicate("po_number LIKE ? ESCAPE '!'", like);
    return this.#read(claims, async (tx) => {
      const [rows] = await tx.query(`SELECT id, po_number, status, supplier_code_snapshot, supplier_name_snapshot, version FROM purchase_orders
        WHERE status IN ('CONFIRMED', 'PARTIALLY_RECEIVED') AND has_outstanding = 1${like ? ` AND (${number.sql} OR supplier_code_snapshot LIKE ? ESCAPE '!' OR supplier_name_snapshot LIKE ? ESCAPE '!')` : ""}
        ORDER BY id DESC LIMIT ?`, [...(like ? [...number.params, like, like] : []), MAX_ROWS]);
      return { items: rows.map((row) => ({ id: Number(row.id), number: row.po_number, status: row.status, supplierCode: row.supplier_code_snapshot,
        supplierName: row.supplier_name_snapshot, version: Number(row.version) })) };
    });
  }

  warehouses({ claims }) {
    return this.#read(claims, async (tx) => {
      const [rows] = await tx.query(`SELECT id, warehouse_code, warehouse_name FROM inventory_warehouses WHERE status = 'ACTIVE' ORDER BY normalized_code, id LIMIT ?`, [MAX_ROWS]);
      return { items: rows.map((row) => ({ id: Number(row.id), code: row.warehouse_code, name: row.warehouse_name })) };
    });
  }

  bins({ claims, warehouseId }) {
    return this.#read(claims, async (tx) => {
      const [rows] = await tx.query(`SELECT id, bin_code FROM inventory_bins WHERE warehouse_id = ? AND status = 'ACTIVE' ORDER BY normalized_code, id LIMIT ?`,
        [warehouseId, MAX_ROWS]);
      return { items: rows.map((row) => ({ id: Number(row.id), code: row.bin_code })) };
    });
  }

  #read(claims, work) {
    return this.database.withTransaction(async (tx) => {
      const fresh = await assertActorFresh(tx, { actorId: Number(claims?.sub), claimedRoles: claims?.roles, claimedPermissions: claims?.permissions });
      if (!["purchasing.view", "receiving.operation"].every((name) => fresh.permissions.includes(name))) throw permissionStaleError();
      return work(tx);
    });
  }
}
