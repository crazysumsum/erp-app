# TASK-009 bounded Inventory profile adapter

Added ItemLookupService.getSalesInventoryProfilesInTransaction(transaction, skuIds, {atMs}) to reuse the reviewed Sales snapshots for Inventory's current minimum shelf life. Unique SKUs are bounded at100; one Base discovery plus five current SHARE queries gives six caller-only queries for1/100. Missing or reassigned Base associations fail closed. No new service, request shape, cache or dependency.

Developer RED2 missing methods → GREEN44PASS/0FAIL/0SKIP; four-file ESLint and whitespace checks PASS. Independent reviewer Codex /root/sales_readiness_review APPROVE; ItemLookupService SHA256558139b78cd6dabcd6edd6a7bca93e12b6724c9519eb1e87900b43ce21c76662. Added real MySQL assertion; not run locally.

CI run36964284356 at c67238ef08c66a8e15076e29d5454bbfbf8938e7: audit/lint/mocked-browser/build PASS, MySQL/server Test FAIL. Customer snapshot, Item snapshot, UOM writer default/reference and waiting-writer tests passed. Sole failure: new Draft deletion race omitted existing password confirmation and returned PASSWORD_REQUIRED. Fixture now supplies its seeded password; password verification and concurrency assertions unchanged. Fresh CI remains required. Coverage93.82%lines/83.90%branches/92.16%functions exceeded global floors in that failed run; passing coverage does not erase failed test.

TASK010 implementation is underway as a separate dirty slice. Neither TASK009 nor Phase is marked DONE; no local SQL/formalTC/UAT/merge executed.
