function integer(value) {
  return Number(value ?? 0);
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
