// Read-only developer reconciliation over the synthetic fixture; never repairs projections.
export async function reconcileCommitments(f){
 const customers=f.customerIds??[f.customerId],filter=customers.map(()=>"?").join(",");
 const [[counts]]=await f.db.query(`SELECT
  COUNT(*) AS line_count,
  COALESCE(SUM(l.ordered_base_quantity<>l.reserved_outstanding_base_quantity+l.backordered_base_quantity+l.fulfilled_base_quantity+l.cancelled_base_quantity),0) AS conservation,
  COALESCE(SUM(l.reserved_outstanding_base_quantity<>COALESCE((SELECT SUM(r.outstanding_base_quantity) FROM sales_order_line_reservations r WHERE r.sales_order_line_id=l.id),0)),0) AS mappings,
  COALESCE(SUM(l.backordered_base_quantity<>COALESCE((SELECT SUM(q.outstanding_base_quantity) FROM sales_backorder_entries q WHERE q.sales_order_line_id=l.id AND q.status='OPEN'),0)),0) AS queue
  FROM sales_order_lines l JOIN sales_orders o ON o.id=l.sales_order_id WHERE o.customer_id IN (${filter}) AND o.status<>'DRAFT'`,customers);
 const [[headers]]=await f.db.query(`SELECT COUNT(*) AS orders,COALESCE(SUM(o.backorder_line_count<>(SELECT COUNT(*) FROM sales_order_lines l WHERE l.sales_order_id=o.id AND l.backordered_base_quantity>0)
  OR o.has_backorder<>(EXISTS(SELECT 1 FROM sales_order_lines l WHERE l.sales_order_id=o.id AND l.backordered_base_quantity>0))),0) AS flags FROM sales_orders o WHERE o.customer_id IN (${filter})`,customers);
 const [[inventory]]=await f.db.query(`SELECT COUNT(*) AS mappings,COALESCE(SUM(i.id IS NULL OR p.id IS NULL OR r.outstanding_base_quantity<>i.outstanding_quantity OR r.source_event_id<>p.source_event_id),0) AS reservations
  FROM sales_order_line_reservations r JOIN sales_order_lines l ON l.id=r.sales_order_line_id JOIN sales_orders o ON o.id=l.sales_order_id LEFT JOIN inventory_reservations i ON i.id=r.inventory_reservation_id LEFT JOIN inventory_operation_requests p ON p.id=i.create_operation_id WHERE o.customer_id IN (${filter})`,customers);
 const [[controls]]=await f.db.query(`SELECT COALESCE(SUM(c.reserved_quantity<>COALESCE((SELECT SUM(i.outstanding_quantity) FROM inventory_reservations i WHERE i.warehouse_id=c.warehouse_id AND i.sku_id=c.sku_id),0)),0) AS controls
  FROM inventory_stock_controls c WHERE c.warehouse_id=?`,[f.warehouseId]);
 return {orders:Number(headers.orders),lines:Number(counts.line_count),mappings:Number(inventory.mappings),mismatches:{conservation:Number(counts.conservation),mappings:Number(counts.mappings),queue:Number(counts.queue),flags:Number(headers.flags),reservations:Number(inventory.reservations),controls:Number(controls.controls)}};
}
