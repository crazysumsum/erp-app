# TASK-028 developer checkpoint

DEC-021 was adopted by Sam's direct 2026-10-07「同意」. DESIGN dbb9b2ea / PLAN e61659d8 retain the exact full hashes in packet44/state. This checkpoint is developer evidence, not formal acceptance or the P2 merge gate.

Migrations0078/0079 create the Sales reservation projection and Backorder queue. Mapping quantities agree with Inventory truth, immutable owner/event/root identity requires fixed manual or Backorder reserve root/child pairs, and FK/unique constraints retain Inventory references. Backorder uses a real composite line/order FK, immutable FIFO scope/priority, positive OPEN quantities and zero terminal quantities. Existing schema inspection is reused; partial missing triggers are repairable while substituted contracts fail closed. Shared migration numbering now has a uniqueness regression.

Actual owned MySQL26.7.0 has binlog1/trust0 and synthetic app SUPER=N. The first schema/logs remain intact. After the independent root-reference finding was fixed, a new final schema was created; original full migrator and rerun both returned0 with the final bytes. Native final run:11 PASS,0 FAIL/skip, including4 new commitment tests and7 directly related P1 Order/History/Audit migration regressions. Migration unit:7 PASS,0 FAIL/skip. Required lint and independent reviewer checks apply to the final diff.

Actual separate review `/root/sales_p1_review`, ref TASK028-R2-20261007 APPROVE, source1842975473d228a42bb3166ba8a3165b46345fd451225d0ea854043591492dac. R1 exposed a real existing child ID accepted as root; the new regression verifies rejection. Initial native failure also exposed nonce-prefixed fixture FK names over MySQL's64-character limit; only the new probe adapts those names, production schema names and old fixture remain unchanged.

Original raw evidence is private under `/private/tmp/sales-p2-private`: task028-native.log (original failure), task028-native-r2/r3/r4.log, task028-final-native.log, migrate-task028-final.log and migrate-task028-rerun.log. Private runtime.json/env.json bind the actual owned namespace/schema/socket/port/PID/accounts. Raw SQL/logs/secrets are not committed or exported.

P2's full28 developer suites, real confirmation/recovery/lifecycle/allocator/browser/performance checks, exact-candidate CI and final separate review are still pending. No P2 completion, formal TC/UAT, release or merge is claimed.
