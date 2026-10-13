-- 喺 100k Supplier 基準庫（seedSupplierPerformanceFixtures.js，80,053 Active）上面加 for-SKU 數據。
-- HOT SKU (id 1)：每 5 個 Supplier 有 1 條 relation（20,000），5% preferred、5% stopped，約 2/3 有 last_supplied_at。
-- COLD SKU (id 2)：冇 relation。另外 1,000 隻 SKU：每 5 個 Supplier 揀 1 個關聯 5 隻（100,000 條），每隻約 100 條。
SET @now = 1760000000000;
INSERT INTO items (name, status, created_at, updated_at) VALUES ('PERF-T40', 'active', @now, @now);
SET @item = LAST_INSERT_ID();
INSERT INTO item_skus (item_id, sku_code, sku_name, status, purchasable, created_at, updated_at) VALUES (@item, 'PERF-T40-HOT', 'Hot', 'active', 1, @now, @now);
SET @hot = LAST_INSERT_ID();
INSERT INTO item_skus (item_id, sku_code, sku_name, status, purchasable, created_at, updated_at) VALUES (@item, 'PERF-T40-COLD', 'Cold', 'active', 1, @now, @now);
INSERT INTO supplier_sku_refs (supplier_id, sku_id, supplier_item_code, supplier_item_code_key, relationship_status, last_supplied_at, created_at, updated_at)
SELECT id, @hot, CONCAT('SIC-', id), CONCAT('sic-', id),
       CASE WHEN id % 20 = 0 THEN 'preferred' WHEN id % 20 = 1 THEN 'stopped' ELSE 'alternative' END,
       CASE WHEN id % 3 = 0 THEN NULL ELSE @now - (id * 7919 % 31536000000) END, @now, @now
  FROM suppliers WHERE id % 5 = 0;
SET SESSION cte_max_recursion_depth = 2000;
INSERT INTO item_skus (item_id, sku_code, sku_name, status, purchasable, created_at, updated_at)
WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1000)
SELECT @item, CONCAT('PERF-T40-', LPAD(i, 4, '0')), CONCAT('Spread ', i), 'active', 1, @now, @now FROM n;
SELECT MIN(id) INTO @lo FROM item_skus WHERE sku_code LIKE 'PERF-T40-0%' OR sku_code LIKE 'PERF-T40-1%';
INSERT IGNORE INTO supplier_sku_refs (supplier_id, sku_id, supplier_item_code, supplier_item_code_key, relationship_status, last_supplied_at, created_at, updated_at)
WITH RECURSIVE k(j) AS (SELECT 1 UNION ALL SELECT j + 1 FROM k WHERE j < 5)
SELECT s.id, @lo + ((s.id * 7 + k.j * 211) % 1000), '', NULL,
       CASE WHEN (s.id + k.j) % 20 = 0 THEN 'preferred' WHEN (s.id + k.j) % 20 = 1 THEN 'stopped' ELSE 'alternative' END,
       CASE WHEN (s.id + k.j) % 3 = 0 THEN NULL ELSE @now - ((s.id * k.j * 7919) % 31536000000) END, @now, @now
  FROM suppliers s CROSS JOIN k WHERE s.id % 5 = 1;
ANALYZE TABLE supplier_sku_refs, suppliers;
