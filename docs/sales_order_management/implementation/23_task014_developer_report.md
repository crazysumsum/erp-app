# TASK-014 developer checkpoint

Added History (0075), Audit (0076) and Conversion (0077) tables: exact ownership/one-to-one/event indexes, actor FK rules, UTF-8 JSON byte limits, append-only UPDATE triggers and immutable Conversion core with monotonic Archive routing. Binary comparisons preserve literal snapshot/JSON bytes. Active DELETE stays restricted to the designed future Archive service; no delete API/session override added.

The shared P1 schema contract validates exact trigger event/timing/body and resumes valid half-DDL with missing triggers; a substituted trigger fails closed. Fixture DDL obtains a real schema-specific MySQL GET_LOCK until connection cleanup, preventing concurrent FK-parent metadata invalidation. Within-test independent connection races remain real. Fixtures allocate uniquely owned currencies and only delete their own rows.

Evidence: initial RED; final combined TASK012–014 native 11 PASS, 0 FAIL/SKIP including independent-connection winner race, trailing-space immutability, legitimate routing/reversal, trigger recovery/drift and byte overflow. Final fresh-from-empty PASS. Final actual P0→P1 upgrade PASS from bbb2383 main P0 migrator into a new owned schema, all 8 P1 migrations applied. Old experimental schema retained separately. Final lint PASS; server regression 2,148 PASS, 0 FAIL, 420 opt-in skips. These opt-ins were not substituted for mandatory native runs. An initial private runner label unintentionally disabled DB tests (0 executed); that result was rejected and the correct explicit native run produced the 11 passes.

Actual separate reviewer /root/sales_readiness_review APPROVE on source fingerprint 4f0afb10a9a3a5bae377d780d262d71e72e527ac215ac7cfd9dc48e694cf09e0. Initial findings corrected PAD SPACE immutable comparison and TC-015 conversion-foundation attribution. No full conversion service or TC-013 sequence-concurrency claim; those remain TASK015/017.

Specifications/ledger mapping and approved design/plan unchanged; raw local evidence untracked. TASK-015 next. P1 remains IMPLEMENTING, full 23-suite/current CI/review/merge Gate pending.
