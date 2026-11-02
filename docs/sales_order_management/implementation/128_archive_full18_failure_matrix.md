# Full18 fault injection developer increment

Fulfillment P0 PR271 remains observed MERGED at fd32762f4fa17a5e77aaa7118a9ded2d3ac81e9e. Latest main58322ba3 contains Supplier lookups; the observed19-path delta does not modify Sales/Fulfillment transaction code, and was integrated locally in5bd8396f without conflicts. No P4 remote merge or CI is claimed.

Actual native r2 has63PASS/0FAIL/0SKIP:54 new cases exercise COPY, stored-hash VERIFY and REMOVE for every18 populated Sales/Fulfillment table, plus9 existing transaction cases. COPY/REMOVE fault issues real SQL SIGNAL on the same real transaction connection; VERIFY stores an incorrect hash, observes it, then exercises the unchanged product verifier. Each case proves target reached and full recorded snapshot equality after rollback. Snapshot scope is36 Active/archive tables, order manifests, Fulfillment operations and three Inventory tables; this is not all Inventory ledgers or formal acceptance.

Raw p4-sales-full18-injection-native-r2.log SHA130748d662a0a42e87e2d3b4f982600bb6754432046ca8f0fea3e5c3d6974da6. The first fixture incorrectly installed foreign triggers and formal readiness correctly refused it; r1 retains27PASS/36FAIL/0SKIP, SHA561a8c9492dba214cdc246d6a52cf4c2fe563ee6545e073d00e0242217e1a492. Its correction preserves readiness schema and all target/rollback assertions. No product change was made to obtain matrix PASS.

Actual separate reviewer proof p4-sales-full18-injection-r1-reviewer-proof.json SHAc7a9a397fedc0de7e4b26d75ff2aa73695ce2c801af78090127c51b486a21fcd approves exactly two matrix test files with zero required findings; it does not approve whole P4. Private raw evidence remains outside the Git candidate.

P4 remains BLOCKED. Historical mirror timestamp/private current read time recovery, complete original TC047/049/052 cases, Archive inquiry/UI/Playwright, reconciliation/alerts, capacity/restore,33 original checks, current CI, whole-phase review and unchanged merge Gate remain required. The new historical-partial tests are subsequent unqualified work and do not inherit matrix approval.
