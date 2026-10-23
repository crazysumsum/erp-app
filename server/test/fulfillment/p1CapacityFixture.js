const withoutId = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id"));
export async function seedMaxClaimOrder(f) {
  const lines = [{ id: f.s.lineId, sku: f.s.skuId }];
  await f.db.execute("UPDATE sales_orders SET line_count=100,total_amount=5000 WHERE id=?", [f.s.orderId]);
  await f.db.execute("UPDATE sales_order_lines SET ordered_quantity=50,ordered_base_quantity=50,reserved_outstanding_base_quantity=50,line_amount=50 WHERE id=?", [f.s.lineId]);
  for (let i = 1; i < 100; i++) {
    const sku = await f.s.insert("item_skus", { item_id: (await f.db.query("SELECT item_id FROM item_skus WHERE id=?", [f.s.skuId]))[0][0].item_id, sku_code: `QUEUE-CAP-${i}`, sku_name: `Synthetic ${i}`, status: "active", created_at: f.s.now, updated_at: f.s.now });
    const uom = await f.s.insert("item_sku_uoms", { sku_id: sku, uom_id: f.s.uomId, to_base_factor: 1, is_base: 1, is_default_sale: 1, created_at: f.s.now, updated_at: f.s.now });
    const id = await f.s.insert("sales_order_lines", { ...withoutId(f.before.line), line_no: i + 1, sku_id: sku, sku_uom_id: uom, sku_code_snapshot: `QUEUE-CAP-${i}`, sku_name_snapshot: `Synthetic ${i}`, ordered_quantity: "50.000000", ordered_base_quantity: 50, reserved_outstanding_base_quantity: 50, line_amount: "50.0000" });
    lines.push({ id, sku });
  }
  const operations = [], reservations = [], mappings = [];
  let operationId = Number((await f.db.query("SELECT MAX(id) AS id FROM inventory_operation_requests"))[0][0].id) + 1;
  let reservationId = Number((await f.db.query("SELECT MAX(id) AS id FROM inventory_reservations"))[0][0].id) + 1;
  for (let round = 0; round < 50; round++) {
    const root = operationId++, event = crypto.randomUUID();
    operations.push([root, "SALES_BACKORDER_BATCH_RESERVE", "SALES", "SALES_ORDER", String(f.s.orderId), "", event, "a".repeat(64), f.label, f.s.now]);
    for (let index = 0; index < lines.length; index++) {
      if (round === 0 && index === 0) continue; // The original fixture already has this Reservation and mapping.
      const line = lines[index], child = operationId++, reservation = reservationId++;
      operations.push([child, "SALES_BACKORDER_LINE_RESERVE", "SALES", "SALES_ORDER", String(f.s.orderId), String(line.id), event, "a".repeat(64), f.label, f.s.now]);
      reservations.push([reservation, child, f.s.warehouseId, line.sku, 1, 1, "SALE", "ACTIVE", f.s.now, f.s.now]);
      mappings.push([line.id, reservation, root, event, 1, 1, "ACTIVE", 1, f.s.now, f.s.now]);
    }
  }
  // Bulk synthetic fixture writes preserve all real FK/CHECK/source triggers; no constraints are disabled.
  for (let start = 0; start < operations.length; start += 100) await f.db.query("INSERT INTO inventory_operation_requests(id,command_type,source_module,source_document_type,source_document_id,source_line_id,source_event_id,request_hash,actor_label,created_at) VALUES ?", [operations.slice(start, start + 100)]);
  for (let start = 0; start < reservations.length; start += 100) await f.db.query("INSERT INTO inventory_reservations(id,create_operation_id,warehouse_id,sku_id,original_quantity,outstanding_quantity,purpose,status,created_at,updated_at) VALUES ?", [reservations.slice(start, start + 100)]);
  for (let start = 0; start < mappings.length; start += 100) await f.db.query("INSERT INTO sales_order_line_reservations(sales_order_line_id,inventory_reservation_id,inventory_operation_id,source_event_id,original_base_quantity,outstanding_base_quantity,status,inventory_version,created_at,updated_at) VALUES ?", [mappings.slice(start, start + 100)]);
  await f.db.query(`UPDATE item_skus SET inventory_tracked=1 WHERE id IN (${lines.map(()=>"?").join(",")})`,lines.map(line=>line.sku));
  const controls=lines.map(line=>[f.s.warehouseId,line.sku,50,f.s.now,f.s.now]);
  await f.db.query("INSERT INTO inventory_stock_controls (warehouse_id,sku_id,reserved_quantity,created_at,updated_at) VALUES ? ON DUPLICATE KEY UPDATE reserved_quantity=50,version=version+1",[controls]);
  return lines;
}
