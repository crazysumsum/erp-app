# TASK-009 Item named Sales lookup

Implemented findManyForSale, findSaleUom and getSalesSnapshotsInTransaction on the existing ItemLookupService. Named Sales requires Item/SKU active, sellable and effective; generic clearance sale is unchanged. Mapping identity, current Item/SKU/UOM versions, exact stored price/HKD/tax_not_applicable and UOM conversion facts are returned. Caller snapshots discover IDs, then acquire UOM→Item→SKU→mapping SHARE locks, revalidate associations and project locked/current facts. Unique requests bounded to100; one or100 requests use five queries, no per-line SQL.

Developer RED5missingmethods→GREEN **38 PASS/0FAIL/0SKIP**; affected Customer/Item/Inventory-provider regression **60PASS/0FAIL/0SKIP**. Focused lint/whitespace PASS. Real MySQL lock regression prepared in itemLookup.integration.test.js; pending CI, no local SQL. Reviewer `/root/sales_readiness_review` independent **APPROVE**; independently42 Item/Inventory-provider tests PASS/0SKIP. Reviewed source SHA e74d02477366a4a21b96e7284d0e3d7d32afba4673e5d1f580432179c8a3fdf0.

Item stable mapping writer remains the next TASK009 slice. This checkpoint does not claim TASK009 DONE, formal TC/UAT, global deadlock freedom or Phase completion.
