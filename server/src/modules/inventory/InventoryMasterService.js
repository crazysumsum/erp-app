import { assertActorFresh } from "../authorization/directoryLookups.js";
import { InventoryAuditService } from "./InventoryAuditService.js";
import { InventoryLockService } from "./InventoryLockService.js";
import { inventoryError } from "./inventoryErrors.js";
import {
  binCurrentBlockers,
  binProjection,
  blockersPresent,
  warehouseCurrentBlockers,
  warehouseProjection
} from "./inventoryProjections.js";

const MASTER_PERMISSION = "inventory.mgmt";
const STATUSES = new Set(["ACTIVE", "INACTIVE"]);

function positiveId(value, field) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  return id;
}

function version(value) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "version" });
  }
  return normalized;
}

function text(value, field, maxLength, { optional = false, nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) return null;
  if (typeof value !== "string") throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  const normalized = value.trim();
  if ((!optional && !normalized) || [...normalized].length > maxLength || /[\p{Cc}]/u.test(normalized)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  }
  return normalized;
}

function masterCode(value, field) {
  const display = text(value, field, 50);
  const normalized = display.normalize("NFKC").toUpperCase();
  if ([...normalized].length > 50) throw inventoryError("INVENTORY_INPUT_INVALID", { field });
  return { display, normalized };
}

function reason(value) {
  const normalized = text(value, "reason", 500);
  if ([...normalized].length < 5) throw inventoryError("INVENTORY_INPUT_INVALID", { field: "reason" });
  return normalized;
}

function warehouseInput(input) {
  const code = masterCode(input.warehouseCode, "warehouseCode");
  return {
    code,
    name: text(input.warehouseName, "warehouseName", 190),
    address: text(input.address, "address", 500, { nullable: true }),
    description: text(input.description ?? "", "description", 500, { optional: true })
  };
}

function binInput(input) {
  const code = masterCode(input.binCode, "binCode");
  return {
    code,
    name: text(input.binName, "binName", 190, { nullable: true }),
    description: text(input.description ?? "", "description", 500, { optional: true })
  };
}

function pageInput(input = {}) {
  const page = Number(input.page ?? 1);
  const pageSize = Number(input.pageSize ?? 50);
  if (!Number.isSafeInteger(page) || page <= 0 || !Number.isSafeInteger(pageSize) ||
      pageSize <= 0 || pageSize > 100) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "page" });
  }
  const status = input.status ?? "ACTIVE";
  if (status !== "ALL" && !STATUSES.has(status)) {
    throw inventoryError("INVENTORY_INPUT_INVALID", { field: "status" });
  }
  const search = text(input.q ?? "", "q", 190, { optional: true });
  return { page, pageSize, status, search };
}

function duplicate(error) {
  return (error?.cause?.code ?? error?.code) === "ER_DUP_ENTRY";
}

function referenced(error) {
  return ["ER_ROW_IS_REFERENCED", "ER_ROW_IS_REFERENCED_2"].includes(
    error?.cause?.code ?? error?.code
  );
}

function notFound() {
  return inventoryError("INVENTORY_RESOURCE_NOT_FOUND");
}

function conflict(currentVersion) {
  return inventoryError("VERSION_CONFLICT", { currentVersion: Number(currentVersion) });
}

function auditSummary(resource) {
  return resource ? {
    id: resource.id,
    code: resource.code,
    name: resource.name ?? "",
    status: resource.status,
    version: resource.version
  } : null;
}

function rowFromWarehouse(value) {
  return {
    id: value.id,
    warehouse_code: value.code,
    warehouse_name: value.name,
    address: value.address,
    description: value.description,
    status: value.status,
    version: value.version,
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}

function rowFromBin(value) {
  return {
    id: value.id,
    warehouse_id: value.warehouseId,
    bin_code: value.code,
    bin_name: value.name,
    description: value.description,
    status: value.status,
    version: value.version,
    created_at: value.createdAt,
    updated_at: value.updatedAt
  };
}

export class InventoryMasterService {
  constructor({ database, logger, time, authorize = assertActorFresh, audit, lockService } = {}) {
    if (!database || typeof database.query !== "function" || typeof database.withTransaction !== "function" ||
        !time || typeof time.nowMs !== "function" || typeof authorize !== "function") {
      throw new TypeError("InventoryMasterService requires database, time and authorization services");
    }
    this.database = database;
    this.time = time;
    this.authorize = authorize;
    this.audit = audit ?? new InventoryAuditService({ database, logger, time });
    this.lockService = lockService ?? new InventoryLockService();
  }

  async listWarehouses(input = {}) {
    const { page, pageSize, status, search } = pageInput(input);
    const where = [];
    const params = [];
    if (status !== "ALL") {
      where.push("status = ?");
      params.push(status);
    }
    if (search) {
      where.push("(warehouse_code LIKE ? OR warehouse_name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const [[count]] = await this.database.query(
      `SELECT COUNT(*) AS total FROM inventory_warehouses${clause}`,
      params
    );
    const [rows] = await this.database.query(
      `SELECT * FROM inventory_warehouses${clause}
        ORDER BY warehouse_name, id LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    return { items: rows.map((row) => warehouseProjection(row)), total: Number(count.total), page, pageSize };
  }

  async getWarehouse(warehouseId) {
    const id = positiveId(warehouseId, "warehouseId");
    const [[row]] = await this.database.query("SELECT * FROM inventory_warehouses WHERE id = ?", [id]);
    if (!row) throw notFound();
    const [blockers, [[bins]]] = await Promise.all([
      this.#warehouseCurrentBlockers(this.database, id),
      this.database.query(
        `SELECT COUNT(*) AS total,
                SUM(status = 'ACTIVE') AS active,
                SUM(status = 'INACTIVE') AS inactive
           FROM inventory_bins WHERE warehouse_id = ?`,
        [id]
      )
    ]);
    return warehouseProjection(row, {
      blockers,
      binSummary: {
        total: Number(bins.total ?? 0),
        active: Number(bins.active ?? 0),
        inactive: Number(bins.inactive ?? 0)
      }
    });
  }

  async listBins(input = {}) {
    const warehouseId = positiveId(input.warehouseId, "warehouseId");
    const { page, pageSize, status, search } = pageInput(input);
    const [[warehouse]] = await this.database.query(
      "SELECT id FROM inventory_warehouses WHERE id = ?",
      [warehouseId]
    );
    if (!warehouse) throw notFound();
    const where = ["warehouse_id = ?"];
    const params = [warehouseId];
    if (status !== "ALL") {
      where.push("status = ?");
      params.push(status);
    }
    if (search) {
      where.push("(bin_code LIKE ? OR bin_name LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    const clause = ` WHERE ${where.join(" AND ")}`;
    const [[count]] = await this.database.query(`SELECT COUNT(*) AS total FROM inventory_bins${clause}`, params);
    const [rows] = await this.database.query(
      `SELECT * FROM inventory_bins${clause} ORDER BY bin_code, id LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize]
    );
    return { items: rows.map((row) => binProjection(row)), total: Number(count.total), page, pageSize };
  }

  async getBin(warehouseId, binId) {
    const ownerId = positiveId(warehouseId, "warehouseId");
    const id = positiveId(binId, "binId");
    const [[row]] = await this.database.query(
      "SELECT * FROM inventory_bins WHERE id = ? AND warehouse_id = ?",
      [id, ownerId]
    );
    if (!row) throw notFound();
    return binProjection(row, { blockers: await this.#binCurrentBlockers(this.database, id) });
  }

  async createWarehouse(input) {
    const value = warehouseInput(input);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.#authorize(connection, input);
        const now = this.time.nowMs();
        const [result] = await connection.execute(
          `INSERT INTO inventory_warehouses
             (warehouse_code, normalized_code, warehouse_name, address, description,
              status, version, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?)`,
          [value.code.display, value.code.normalized, value.name, value.address, value.description,
            now, now, input.actorId, input.actorId]
        );
        const created = warehouseProjection(rowFromWarehouse({
          id: Number(result.insertId), code: value.code.display, name: value.name,
          address: value.address, description: value.description, status: "ACTIVE",
          version: 1, createdAt: now, updatedAt: now
        }));
        await this.#audit(connection, actor, input, "warehouse.create", "warehouse", created, null, created);
        return created;
      });
    } catch (error) {
      if (duplicate(error)) throw inventoryError("WAREHOUSE_CODE_TAKEN");
      throw error;
    }
  }

  async updateWarehouse(input) {
    const id = positiveId(input.warehouseId, "warehouseId");
    const expectedVersion = version(input.version);
    const value = warehouseInput(input);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.#authorize(connection, input);
        const before = await this.#lockWarehouse(connection, id);
        this.#assertVersion(before, expectedVersion);
        const now = this.time.nowMs();
        const [result] = await connection.execute(
          `UPDATE inventory_warehouses
              SET warehouse_code = ?, normalized_code = ?, warehouse_name = ?, address = ?,
                  description = ?, version = version + 1, updated_at = ?, updated_by = ?
            WHERE id = ? AND version = ?`,
          [value.code.display, value.code.normalized, value.name, value.address, value.description,
            now, input.actorId, id, expectedVersion]
        );
        if (Number(result.affectedRows) !== 1) throw conflict(before.version);
        const after = warehouseProjection(rowFromWarehouse({
          id, code: value.code.display, name: value.name, address: value.address,
          description: value.description, status: before.status,
          version: expectedVersion + 1, createdAt: Number(before.created_at), updatedAt: now
        }));
        await this.#audit(connection, actor, input, "warehouse.update", "warehouse", after,
          warehouseProjection(before), after);
        return after;
      });
    } catch (error) {
      if (duplicate(error)) throw inventoryError("WAREHOUSE_CODE_TAKEN");
      throw error;
    }
  }

  deactivateWarehouse(input) {
    return this.#changeWarehouseStatus(input, "ACTIVE", "INACTIVE", "warehouse.deactivate", true);
  }

  reactivateWarehouse(input) {
    return this.#changeWarehouseStatus(input, "INACTIVE", "ACTIVE", "warehouse.reactivate", false);
  }

  async deleteWarehouse(input) {
    const id = positiveId(input.warehouseId, "warehouseId");
    const expectedVersion = version(input.version);
    const requiredReason = reason(input.reason);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.#authorize(connection, input);
        const before = await this.#lockWarehouse(connection, id);
        this.#assertVersion(before, expectedVersion);
        if (before.status !== "INACTIVE") throw inventoryError("WAREHOUSE_INVALID");
        const blockers = await this.#warehouseDeleteBlockers(connection, id);
        if (blockersPresent(blockers)) throw inventoryError("WAREHOUSE_IN_USE", { blockers });
        const [result] = await connection.execute(
          "DELETE FROM inventory_warehouses WHERE id = ? AND version = ?",
          [id, expectedVersion]
        );
        if (Number(result.affectedRows) !== 1) throw conflict(before.version);
        const projected = warehouseProjection(before);
        await this.#audit(connection, actor, { ...input, reason: requiredReason },
          "warehouse.delete", "warehouse", projected, projected, null);
        return { id, deleted: true };
      });
    } catch (error) {
      if (referenced(error)) throw inventoryError("WAREHOUSE_IN_USE");
      throw error;
    }
  }

  async createBin(input) {
    const warehouseId = positiveId(input.warehouseId, "warehouseId");
    const value = binInput(input);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.#authorize(connection, input);
        const warehouse = await this.#lockWarehouse(connection, warehouseId);
        if (warehouse.status !== "ACTIVE") throw inventoryError("WAREHOUSE_INVALID");
        const now = this.time.nowMs();
        const [result] = await connection.execute(
          `INSERT INTO inventory_bins
             (warehouse_id, bin_code, normalized_code, bin_name, description,
              status, version, created_at, updated_at, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?, ?, ?)`,
          [warehouseId, value.code.display, value.code.normalized, value.name, value.description,
            now, now, input.actorId, input.actorId]
        );
        const created = binProjection(rowFromBin({
          id: Number(result.insertId), warehouseId, code: value.code.display, name: value.name,
          description: value.description, status: "ACTIVE", version: 1, createdAt: now, updatedAt: now
        }));
        await this.#audit(connection, actor, input, "bin.create", "bin", created, null, created);
        return created;
      });
    } catch (error) {
      if (duplicate(error)) throw inventoryError("BIN_CODE_TAKEN");
      throw error;
    }
  }

  async updateBin(input) {
    const ids = this.#binIds(input);
    const expectedVersion = version(input.version);
    const value = binInput(input);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.#authorize(connection, input);
        const { bin } = await this.#lockBin(connection, ids);
        this.#assertVersion(bin, expectedVersion);
        const now = this.time.nowMs();
        const [result] = await connection.execute(
          `UPDATE inventory_bins
              SET bin_code = ?, normalized_code = ?, bin_name = ?, description = ?,
                  version = version + 1, updated_at = ?, updated_by = ?
            WHERE id = ? AND warehouse_id = ? AND version = ?`,
          [value.code.display, value.code.normalized, value.name, value.description, now,
            input.actorId, ids.binId, ids.warehouseId, expectedVersion]
        );
        if (Number(result.affectedRows) !== 1) throw conflict(bin.version);
        const after = binProjection(rowFromBin({
          id: ids.binId, warehouseId: ids.warehouseId, code: value.code.display,
          name: value.name, description: value.description, status: bin.status,
          version: expectedVersion + 1, createdAt: Number(bin.created_at), updatedAt: now
        }));
        await this.#audit(connection, actor, input, "bin.update", "bin", after, binProjection(bin), after);
        return after;
      });
    } catch (error) {
      if (duplicate(error)) throw inventoryError("BIN_CODE_TAKEN");
      throw error;
    }
  }

  deactivateBin(input) {
    return this.#changeBinStatus(input, "ACTIVE", "INACTIVE", "bin.deactivate", true);
  }

  reactivateBin(input) {
    return this.#changeBinStatus(input, "INACTIVE", "ACTIVE", "bin.reactivate", false);
  }

  async deleteBin(input) {
    const ids = this.#binIds(input);
    const expectedVersion = version(input.version);
    const requiredReason = reason(input.reason);
    try {
      return await this.database.withTransaction(async (connection) => {
        const actor = await this.#authorize(connection, input);
        const { bin } = await this.#lockBin(connection, ids);
        this.#assertVersion(bin, expectedVersion);
        if (bin.status !== "INACTIVE") throw inventoryError("BIN_INVALID");
        const blockers = await this.#binDeleteBlockers(connection, ids.binId);
        if (blockersPresent(blockers)) throw inventoryError("BIN_IN_USE", { blockers });
        const [result] = await connection.execute(
          "DELETE FROM inventory_bins WHERE id = ? AND warehouse_id = ? AND version = ?",
          [ids.binId, ids.warehouseId, expectedVersion]
        );
        if (Number(result.affectedRows) !== 1) throw conflict(bin.version);
        const projected = binProjection(bin);
        await this.#audit(connection, actor, { ...input, reason: requiredReason },
          "bin.delete", "bin", projected, projected, null);
        return { id: ids.binId, warehouseId: ids.warehouseId, deleted: true };
      });
    } catch (error) {
      if (referenced(error)) throw inventoryError("BIN_IN_USE");
      throw error;
    }
  }

  async #changeWarehouseStatus(input, from, to, action, checkBlockers) {
    const id = positiveId(input.warehouseId, "warehouseId");
    const expectedVersion = version(input.version);
    const requiredReason = reason(input.reason);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.#authorize(connection, input);
      const before = await this.#lockWarehouse(connection, id);
      this.#assertVersion(before, expectedVersion);
      if (before.status !== from) throw inventoryError("WAREHOUSE_INVALID");
      if (checkBlockers) {
        const blockers = await this.#warehouseCurrentBlockers(connection, id);
        if (blockersPresent(blockers)) throw inventoryError("WAREHOUSE_IN_USE", { blockers });
      }
      const now = this.time.nowMs();
      const [result] = await connection.execute(
        `UPDATE inventory_warehouses
            SET status = ?, version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND version = ?`,
        [to, now, input.actorId, id, expectedVersion]
      );
      if (Number(result.affectedRows) !== 1) throw conflict(before.version);
      const after = warehouseProjection({
        ...before,
        status: to,
        version: expectedVersion + 1,
        updated_at: now
      });
      await this.#audit(connection, actor, { ...input, reason: requiredReason },
        action, "warehouse", after, warehouseProjection(before), after);
      return after;
    });
  }

  async #changeBinStatus(input, from, to, action, checkBlockers) {
    const ids = this.#binIds(input);
    const expectedVersion = version(input.version);
    const requiredReason = reason(input.reason);
    return this.database.withTransaction(async (connection) => {
      const actor = await this.#authorize(connection, input);
      const { warehouse, bin } = await this.#lockBin(connection, ids);
      this.#assertVersion(bin, expectedVersion);
      if (bin.status !== from || (to === "ACTIVE" && warehouse.status !== "ACTIVE")) {
        throw inventoryError(to === "ACTIVE" ? "WAREHOUSE_INVALID" : "BIN_INVALID");
      }
      if (checkBlockers) {
        const blockers = await this.#binCurrentBlockers(connection, ids.binId);
        if (blockersPresent(blockers)) throw inventoryError("BIN_IN_USE", { blockers });
      }
      const now = this.time.nowMs();
      const [result] = await connection.execute(
        `UPDATE inventory_bins SET status = ?, version = version + 1, updated_at = ?, updated_by = ?
          WHERE id = ? AND warehouse_id = ? AND version = ?`,
        [to, now, input.actorId, ids.binId, ids.warehouseId, expectedVersion]
      );
      if (Number(result.affectedRows) !== 1) throw conflict(bin.version);
      const after = binProjection({ ...bin, status: to, version: expectedVersion + 1, updated_at: now });
      await this.#audit(connection, actor, { ...input, reason: requiredReason },
        action, "bin", after, binProjection(bin), after);
      return after;
    });
  }

  async #authorize(connection, input) {
    positiveId(input.actorId, "actorId");
    const actor = await this.authorize(connection, input);
    if (!actor?.permissions?.includes(MASTER_PERMISSION)) throw inventoryError("PERMISSION_STALE");
    return actor;
  }

  async #lockWarehouse(connection, warehouseId) {
    const locked = await this.lockService.lockForCommand(connection, { warehouseIds: [warehouseId] });
    const warehouse = locked.warehouses?.find((row) => Number(row.id) === warehouseId);
    if (!warehouse) throw notFound();
    return warehouse;
  }

  async #lockBin(connection, { warehouseId, binId }) {
    const locked = await this.lockService.lockForCommand(connection, {
      warehouseIds: [warehouseId],
      binIds: [binId]
    });
    const warehouse = locked.warehouses?.find((row) => Number(row.id) === warehouseId);
    const bin = locked.bins?.find((row) => Number(row.id) === binId && Number(row.warehouse_id) === warehouseId);
    if (!warehouse || !bin) throw notFound();
    return { warehouse, bin };
  }

  #binIds(input) {
    return {
      warehouseId: positiveId(input.warehouseId, "warehouseId"),
      binId: positiveId(input.binId, "binId")
    };
  }

  #assertVersion(row, expected) {
    if (Number(row.version) !== expected) throw conflict(row.version);
  }

  async #audit(connection, actor, input, action, targetType, target, before, after) {
    await this.audit.recordSucceeded(connection, {
      actorUserId: positiveId(input.actorId, "actorId"),
      actorLabel: actor.username || `user:${input.actorId}`,
      action,
      targetType,
      targetId: target.id,
      targetLabel: target.code || `${targetType}:${target.id}`,
      reasonCategory: input.reason ? "MASTER_CHANGE" : "",
      reasonText: input.reason ?? "",
      beforeSummary: auditSummary(before),
      afterSummary: auditSummary(after),
      operationRequestId: null,
      requestId: input.requestId ?? "",
      correlationId: input.correlationId ?? "",
      ip: input.ip ?? ""
    });
  }

  async #warehouseCurrentBlockers(connection, warehouseId) {
    const [[row]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM inventory_stock_balances
           WHERE warehouse_id = ? AND on_hand_quantity > 0) AS current_on_hand,
         (SELECT COUNT(*) FROM inventory_reservations
           WHERE warehouse_id = ? AND status IN ('ACTIVE', 'PARTIALLY_CONSUMED')) AS active_reservations,
         (SELECT COUNT(*) FROM inventory_allocations a
            JOIN inventory_stock_balances b ON b.id = a.stock_balance_id
           WHERE b.warehouse_id = ? AND a.status IN ('ACTIVE', 'PARTIALLY_CONSUMED')) AS active_allocations,
         (SELECT COUNT(*) FROM inventory_transfers
           WHERE (source_warehouse_id = ? OR destination_warehouse_id = ?)
             AND status IN ('DRAFT', 'IN_TRANSIT')) AS open_transfers,
         (SELECT COUNT(*) FROM inventory_stocktakes
           WHERE warehouse_id = ? AND status IN ('DRAFT', 'COUNTING', 'READY_TO_POST')) AS active_stocktakes,
         (SELECT COUNT(*) FROM inventory_bin_locks l
            JOIN inventory_bins b ON b.id = l.bin_id
           WHERE b.warehouse_id = ? AND l.released_at IS NULL) AS active_bin_locks`,
      [warehouseId, warehouseId, warehouseId, warehouseId, warehouseId, warehouseId, warehouseId]
    );
    return warehouseCurrentBlockers(row);
  }

  async #binCurrentBlockers(connection, binId) {
    const [[row]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM inventory_stock_balances
           WHERE bin_id = ? AND on_hand_quantity > 0) AS current_on_hand,
         (SELECT COUNT(*) FROM inventory_allocations a
            JOIN inventory_stock_balances b ON b.id = a.stock_balance_id
           WHERE b.bin_id = ? AND a.status IN ('ACTIVE', 'PARTIALLY_CONSUMED')) AS active_allocations,
         (SELECT COUNT(*) FROM inventory_transfer_lines l
            JOIN inventory_transfers t ON t.id = l.transfer_id
           WHERE (l.source_bin_id = ? OR l.destination_bin_id = ?)
             AND t.status IN ('DRAFT', 'IN_TRANSIT')) AS open_transfers,
         (SELECT COUNT(*) FROM inventory_bin_locks
           WHERE bin_id = ? AND released_at IS NULL) AS active_stocktake_locks`,
      [binId, binId, binId, binId, binId]
    );
    return binCurrentBlockers(row);
  }

  async #warehouseDeleteBlockers(connection, warehouseId) {
    const [[row]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM inventory_bins WHERE warehouse_id = ?) AS child_bins,
         (SELECT COUNT(*) FROM inventory_stock_controls WHERE warehouse_id = ?) AS stock_controls,
         (SELECT COUNT(*) FROM inventory_stock_balances WHERE warehouse_id = ?) AS stock_balances,
         (SELECT COUNT(*) FROM inventory_movements WHERE warehouse_id = ?) AS movements,
         (SELECT COUNT(*) FROM inventory_reservations WHERE warehouse_id = ?) AS reservations,
         (SELECT COUNT(*) FROM inventory_transfers
           WHERE source_warehouse_id = ? OR destination_warehouse_id = ?) AS transfers,
         (SELECT COUNT(*) FROM inventory_stocktakes WHERE warehouse_id = ?) AS stocktakes,
         (SELECT COUNT(*) FROM inventory_opening_jobs WHERE warehouse_id = ?) AS opening_jobs`,
      [warehouseId, warehouseId, warehouseId, warehouseId, warehouseId,
        warehouseId, warehouseId, warehouseId, warehouseId]
    );
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  }

  async #binDeleteBlockers(connection, binId) {
    const [[row]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM inventory_stock_balances WHERE bin_id = ?) AS stock_balances,
         (SELECT COUNT(*) FROM inventory_movements WHERE bin_id = ?) AS movements,
         (SELECT COUNT(*) FROM inventory_transfer_lines
           WHERE source_bin_id = ? OR destination_bin_id = ?) AS transfer_lines,
         (SELECT COUNT(*) FROM inventory_stocktake_bins WHERE bin_id = ?) AS stocktake_bins,
         (SELECT COUNT(*) FROM inventory_bin_locks WHERE bin_id = ?) AS bin_locks,
         (SELECT COUNT(*) FROM inventory_opening_rows WHERE bin_id = ?) AS opening_rows`,
      [binId, binId, binId, binId, binId, binId, binId]
    );
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  }
}
