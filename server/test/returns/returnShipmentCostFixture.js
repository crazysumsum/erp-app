import { up as installInventoryCost } from "../../database/migrations/0130_create_inventory_cost.js";

// The real shipment fixture ran before cost was installed. Give its existing ISSUE
// an explicit synthetic cost history until the upstream shipment cost writer lands.
export async function installShipmentCostFixture(f, issue) {
  await installInventoryCost(f.db);
  await f.db.execute("INSERT INTO fr_schema_migrations (name, applied_at) VALUES (?, ?)",
    ["migrations/0130_create_inventory_cost.js", f.s.now]);
  const [[row]] = await f.db.query("SELECT COALESCE(SUM(on_hand_quantity), 0) AS quantity FROM inventory_stock_balances WHERE sku_id = ?", [f.s.skuId]);
  const current = Number(row.quantity), issued = Number(issue.issued_base_quantity);
  await f.s.insert("inventory_cost_entries", {
    sku_id: f.s.skuId, entry_kind: "ENABLEMENT", quantity_delta: current + issued, value_delta_hkd: current + issued,
    unit_cost_source: "ENABLEMENT_FILE", pool_quantity_after: current + issued, pool_value_after_hkd: current + issued, posted_at: f.s.now
  });
  await f.s.insert("inventory_cost_entries", {
    sku_id: f.s.skuId, movement_id: issue.inventory_movement_id, entry_kind: "ISSUE", quantity_delta: -issued, value_delta_hkd: -issued,
    unit_cost_source: "POOL", pool_quantity_after: current, pool_value_after_hkd: current, posted_at: f.s.now
  });
  await f.s.insert("inventory_cost_pools", { sku_id: f.s.skuId, costed_quantity: current, value_hkd: current, updated_at: f.s.now });
}
