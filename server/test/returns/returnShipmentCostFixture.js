import { up as installInventoryCost } from "../../database/migrations/0130_create_inventory_cost.js";

// Synthetic opening balance. The actual Fulfillment writer records the subsequent ISSUE.
export async function installOpeningCost(f) {
  await installInventoryCost(f.db);
  await f.db.execute("INSERT INTO fr_schema_migrations (name, applied_at) VALUES (?, ?)",
    ["migrations/0130_create_inventory_cost.js", f.s.now]);
  const [[row]] = await f.db.query("SELECT COALESCE(SUM(on_hand_quantity), 0) AS quantity FROM inventory_stock_balances WHERE sku_id = ?", [f.s.skuId]);
  const quantity = Number(row.quantity), value = (quantity * 1.25).toFixed(4);
  await f.s.insert("inventory_cost_entries", {
    sku_id: f.s.skuId, entry_kind: "ENABLEMENT", quantity_delta: quantity, value_delta_hkd: value,
    unit_cost_source: "ENABLEMENT_FILE", pool_quantity_after: quantity, pool_value_after_hkd: value, posted_at: f.s.now
  });
  await f.s.insert("inventory_cost_pools", { sku_id: f.s.skuId, costed_quantity: quantity, value_hkd: value, updated_at: f.s.now });
}
