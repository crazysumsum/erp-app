function integer(value) {
  const normalized = Number(value ?? 0);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError("Inventory projection quantity must be a non-negative safe integer");
  }
  return normalized;
}

function positiveInteger(value, field) {
  const normalized = integer(value);
  if (normalized === 0) throw new TypeError(`Inventory projection ${field} must be a positive integer`);
  return normalized;
}

function nullableInteger(value) {
  return value === null || value === undefined ? null : integer(value);
}

export function warehouseProjection(row, extras = {}) {
  return {
    id: Number(row.id),
    code: row.warehouse_code,
    name: row.warehouse_name,
    address: row.address ?? null,
    description: row.description,
    status: row.status,
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...extras
  };
}

export function binProjection(row, extras = {}) {
  return {
    id: Number(row.id),
    warehouseId: Number(row.warehouse_id),
    code: row.bin_code,
    name: row.bin_name ?? null,
    description: row.description,
    status: row.status,
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    ...extras
  };
}

export function warehouseCurrentBlockers(row = {}) {
  return {
    currentOnHand: integer(row.current_on_hand),
    activeReservations: integer(row.active_reservations),
    activeAllocations: integer(row.active_allocations),
    openTransfers: integer(row.open_transfers),
    activeStocktakes: integer(row.active_stocktakes),
    activeBinLocks: integer(row.active_bin_locks)
  };
}

export function binCurrentBlockers(row = {}) {
  return {
    currentOnHand: integer(row.current_on_hand),
    activeAllocations: integer(row.active_allocations),
    openTransfers: integer(row.open_transfers),
    activeStocktakeLocks: integer(row.active_stocktake_locks)
  };
}

export function blockersPresent(blockers) {
  return Object.values(blockers).some((value) => value > 0);
}

export function stockBucketProjection(row) {
  const onHand = integer(row.on_hand_quantity);
  const allocated = integer(row.allocated_quantity);
  if (allocated > onHand) throw new TypeError("Inventory projection allocated quantity exceeds on hand");
  return {
    balanceId: positiveInteger(row.id, "balanceId"),
    warehouseId: positiveInteger(row.warehouse_id, "warehouseId"),
    binId: positiveInteger(row.bin_id, "binId"),
    skuId: positiveInteger(row.sku_id, "skuId"),
    lotId: row.lot_id === null ? null : positiveInteger(row.lot_id, "lotId"),
    stockStatus: row.stock_status,
    isExpired: Boolean(row.is_expired),
    onHand,
    allocated,
    bucketFree: onHand - allocated,
    baseUom: {
      uomId: positiveInteger(row.base_uom_id, "baseUomId"),
      uomCode: row.base_uom_code
    },
    version: positiveInteger(row.version, "version")
  };
}

export function stockSummaryProjection(row) {
  return {
    totalOnHand: integer(row.total_on_hand),
    availableOnHand: integer(row.available_on_hand),
    eligibleOnHand: integer(row.eligible_on_hand),
    reserved: integer(row.reserved_quantity),
    atp: integer(row.atp),
    uncoveredReserved: integer(row.uncovered_reserved),
    quarantined: integer(row.quarantined_quantity),
    damaged: integer(row.damaged_quantity),
    inTransit: integer(row.in_transit_quantity)
  };
}

export function movementProjection(row) {
  const lotId = row.lot_id === null ? null : positiveInteger(row.lot_id, "lotId");
  return {
    movementId: positiveInteger(row.id, "movementId"),
    groupId: row.movement_group_id,
    movementType: row.movement_type,
    locationKind: row.location_kind,
    warehouse: {
      warehouseId: positiveInteger(row.warehouse_id, "warehouseId"),
      code: row.warehouse_code_snapshot
    },
    bin: row.bin_id === null ? null : {
      binId: positiveInteger(row.bin_id, "binId"),
      code: row.bin_code_snapshot
    },
    sku: {
      skuId: positiveInteger(row.sku_id, "skuId"),
      code: row.sku_code_snapshot,
      name: row.sku_name_snapshot
    },
    lot: lotId === null ? null : {
      lotId,
      number: row.lot_number_snapshot,
      expiryDate: row.expiry_date_snapshot
    },
    stockStatus: row.stock_status,
    direction: row.direction,
    quantity: positiveInteger(row.quantity, "quantity"),
    balanceBefore: nullableInteger(row.balance_before),
    balanceAfter: nullableInteger(row.balance_after),
    balanceVersionAfter: nullableInteger(row.balance_version_after),
    postedAt: integer(row.posted_at),
    postedBy: {
      userId: nullableInteger(row.posted_by),
      label: row.posted_by_label
    }
  };
}
