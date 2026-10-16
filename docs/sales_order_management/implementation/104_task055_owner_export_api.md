# TASK-055 — Owner-safe Export API developer verification

IMPLEMENT / PHASE-005, pre-commit HEAD `6307c4f36cd1dbbe0a4912897e4cd84eaffe4f5d`, actual final source `c7594aab169c0125676c3175f38aa4d32bed8b9e4f966bff41872f92192c1d63`. Approved DESIGN `af176fea5409aadc193a2f397750344b9c4cc217ea77b10bffeebda1265e5fdb` and PLAN `99a048fd69847b62c6345836baf431f33a20b4c137fa3702e0c8a2d8c430be03` unchanged. Task-local developer checks, not complete Phase/formal/UAT/release acceptance.

Create returns202 with a canonical ACTIVE/ARCHIVE filter snapshot. Fresh `sales.view` authorization precedes framework cache replay. The original event UUID must equal the Idempotency-Key; domain CREATE_EXPORT replay uses actor/content binding and a locking current read, returning the same job after concurrency, cache expiry or unknown COMMIT acknowledgement. Shared operation lookup safely projects only `{id}` for Export without changing existing Order/Quotation/Import results. Different actors/content conflict; distinct events with equal filters remain independent jobs.

List/status/download are owner-related SQL queries with identical404 for absent and foreign jobs. Download rechecks owner, permission, expiry and file identity, requires Audit before sending bytes, and accepts only the exact private0700/0600 nonsymlink job/token path. Existing framework download supplies safe Content-Disposition, private/no-store and nosniff; expired/missing files return410 without exposing private fields. No client-generated CSV or new dependencies/config/grants.

Existing daily fenced retention additionally handles due COMPLETED jobs and aged FAILED jobs, retaining metadata/counts. Required System Audit precedes validated file removal; fsync/marker rollback retries are covered. Orphan cleanup is precisely limited to eligible terminal job attempts. Stale PROCESSING and already-EXPIRED-row crash orphan sweeping are not established by this task. Original Import retention remains unchanged and regressed.

## Actual joined final evidence

Private originals live under `/Users/sam/.codex/worktrees/sales-p4-archive/phase4-private/`; none are committed.

- `task055-native-final-r6.log`, SHA256 `3b3a87045c1ec8bb0cfe271ef967f86648888b89aef1a0c9088bb6d4c2960486`: exit0,30PASS/0FAIL/0CANCELLED/0SKIP,111202ms. Includes all25 P4 Inquiry/Export cases and all5 original real Import retention cases. New nine cases exercise actual HTTP owner/IDOR/expiry/path/symlink/Audit failure, terminal retention fencing/rollback/retry, durable event/cache expiry/fresh revocation/concurrency/unknown COMMIT. Exact fixture cache-key cleanup asserts zero remaining.
- Full250000-row CSV remains counted/quantity-checked in this ordinary no-forced-GC run: indexed orderDate2204.16ms, unindexed totalAmount12507.88ms, within existing20s transaction/30s worker limits. Raw sampled heap deltas431513432/18338440bytes and RSS232603648/7241728bytes are preserved observations, **not formal memory Gate PASS**. Earlier GC-controlled retained-memory observations cannot replace these raw measurements. TASK-063 still owns complete workload/resource qualification.
- `task055-unit-final-r6.log`, SHA256 `2c785ca1003c6b55c551dbab835d7807f126e78154b6901ff727e4a39ec5914a`: exit0,203PASS/0FAIL/0SKIP, including service discovery and affected Sales phases1–4.
- `task055-lint-final-r6.log`, SHA256 `6bb1ee595ad4a18e79d4765b8d4ac46297b3f844e713cdf91411b06c8ede59e2`: exit0; actual boundary LOCAL_CHECKS_PASS and git diff --check pass.
- `task055-r6-postrun-runtime-observation.json`, SHA256 `db3eb78cdf65b98cdd140e9cd0866aa66b8242f46add159a9c23af0ef7a34275`: actual read-only after joined runs; same owned server UUID/core schema,90 migrations, all six Active/Archive/Export/batch tables0, System Export expiry Audit0, no exclusive Export test directories. No resets, schema or grant changes.

## Preserved failures / independent observations

Initial API unit RED and missing durable-event contract RED preceded implementation. Initial native helper double-start and initial retention failure remain recorded; corrected source passed subsequent original scenarios. An earlier negative test-name pattern did not exclude the250000-row parent case; its27PASS run genuinely included the cap, not an alleged reduced run. No test skip/deletion/threshold weakening.

Six synthetic System Audit rows escaped initial R3/R4 fixture hooks. Exact pins and separately reviewed cleanup ran once, with durable STARTED/CONFIRMED receipts; canonical external action CONFIRMED. Prospective proof SHA256 `c1c020e0a8f9b5def880529370557a9e5ee66e20560959c1b34b9db37298359a`; final hooks remove only each fixture's matching System rows before own jobs. Historical failures/raw evidence are retained.

Actual HTTP file downloads emit an inherited11-close-listener warning. The existing generic download test with the real default request logger independently reproduces the same warning (`task055-generic-real-logger-baseline-warning.log`,1PASS). No listener-limit increase, suppression, shared framework modification, Sales-only leak claim or leak-free claim. This is a server observation; TASK-056 still requires clean relevant real-browser console/network behavior.

## Remaining gates

Actual separate scoped review APPROVED: `/root/sales_p4_inquiry_review`, `task055-independent-review-r1.json` SHA256 `cf327a5d620b05b3068990abc24400ed42ebcde465e4e23c0b9ee4d8403e9511`, exact final source and actual logs/cleanup independently verified; no required open source findings. Existing TASK-055 typed TC-045/060 bindings are retained. Export UI is TASK-056; formal provider-backed Archive/movement remains unavailable until real Fulfillment contracts exist. Full39 developer checks, current-candidate CI, fresh-main integration, actual whole-phase review and unchanged merge Gate are pending. No partial P4 main merge or formal/UAT/release approval.
