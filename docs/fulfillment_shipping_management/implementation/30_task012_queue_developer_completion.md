# TASK-012 — Queue developer increment

## Outcome and boundaries

TASK-012 functional implementation and task-scoped developer checks are complete; independent reviewer `/root/fulfillment_independent_review` accepted the exact nine source/test files, 0C/H/M. The atomic local commit is the final task DoD step; the actual commit receipt will be recorded in state after observing Git. P1 remains BLOCKED at TASK-013 by unanswered HD-016. No draft PR, push, current-candidate CI, full P1 verification, formal Technical Acceptance or UAT result is claimed.

GET `/api/v1/fulfillment-queue` supplies bounded, allowlisted Queue work with strict query validation, fresh view permission and a newly created coherent RR read snapshot. IDs are bounded before two child/header batch reads. Exact SO matching precedes colliding Customer prefixes; keyset sorting covers nullable delivery dates and stable ties, both directions, with filter-bound cursors and no OFFSET fallback. Inventory/Sales/root ownership and current quantities are advisory read facts; Create must separately acquire real owner locks after HD-016 resolution. No Inventory/Sales owner writes or new migration are introduced.

Fully claimed Sales cache rows cannot conceal Inventory drift. Negative availability/source/cardinality failures reject and emit a fixed critical event through the real three-argument SystemLogger interface, without raw business payload. The existing completion-receipt proof for Shipment/Reverse is not silently added to this advisory Queue contract.

## Traceability and developer evidence

The authoritative ledger retains TASK-012 → TC-003 → FR-001–004; TC-003 remains mandatory/blocking in the unchanged formal suite and also covers future Create/Update work. The tests below are developer evidence for TASK-012, not a claim that formal TC-003 or all its future Tasks have passed.

| Task evidence | Observed result | Local evidence |
| --- | --- | --- |
| Queue strict query/cursor/projection/API schema and permissions | 16 PASS, 0 FAIL, 0 SKIP | `/private/tmp/fulfillment-p1-queue-focused.log` |
| All existing/new Fulfillment unit regression | 56 PASS, 0 FAIL, 0 SKIP; focused16 included | `/private/tmp/fulfillment-p1-pure-regression.log` |
| Native MySQL/real discovered HTTP/JWT/authorization/consistent-read race/multi-order keyset/exact collision | 11 PASS, 0 FAIL, 0 SKIP | `/private/tmp/fulfillment-p1-queue-native.log` |
| Native 100 SKU/100 Lines × 50 Reservations | 5000 actual Reservations, 20 service reads; P95 24.209833ms, max24.234833ms, original2000ms limit retained | `/private/tmp/fulfillment-p1-queue-capacity.log` |
| Repository lint | EXIT 0 | `/private/tmp/fulfillment-p1-lint.log` |

The native and capacity lanes used separate owned UUID schema namespaces, real FK/CHECK/source triggers, local ports and registered teardown. Their receipts bind the same current source fingerprint `ba923df001b026f2f03ad8be62064599f5dd4adba944d35f8d376bd4b0af9784`: `/private/tmp/fulfillment-p1-native-queue-runtime.json` and `/private/tmp/fulfillment-p1-native-capacity-runtime.json`. Dependencies were actually installed from the existing lockfile with offline npm ci after discovering the shared checkout had an empty node_modules; no lockfile/package changes.

The capacity result proves the local hot-order maximum-child read shape. It does not prove the full 7.3-million-active-row/50-user NFR, P1 write latency, all P0 native regressions, complete server/client coverage, full P1 browser flows or CI. All those original phase gates remain required. The original20-second provider transaction deadline and audit/schema safeguards are untouched.

Independent review found and closed three MEDIUM issues through real RED→GREEN: discovery hiding a fully-claimed negative actual quantity, malformed logger invocation, and incomplete existing root/status source checks. Exact-vs-prefix collision was separately reproduced and corrected. Raw failure/debug logs are retained privately; only this sanitized summary is eligible for version control.

## Actual authority and mechanical baseline lineage

Sam's current direct instruction is: 按已批准計劃開始 fulfillment P1 開發，完成所有 TASK、獨立覆核及完整驗證，確認當前候選 CI 通過後建立 draft PR。 This authorizes PHASE-002/TASK-012–023 implementation, planned isolated developer tests and draft only after all gates. It does not authorize merging P1 or silently choosing HD-016.

The original approved P1 business rules remain. Independent entry/final review accepted these routine corrections: canonical detailed Create route `/fulfillments/create` replaces two shorthand Task mentions; precise bounded cursor wire implements already mandatory keyset behavior; the provided contract document pin follows those exact documentation bytes; a new P1 developer adapter includes unchanged P0 regression and all current P1 cases, min230/maxskip0. All prior suite objects—including the entire formal object and mandatory TC001–012—remain byte-for-byte semantically identical. Only PHASE-002 developer selection replaces the inappropriate future-formal binding and adds existing P0 browser regression. The separate complete P1 UI/browser lane must still be added and bound during TASK-021–023; the two foundation cases cannot substitute for it.

The NFR-023 UAT NOT_APPLICABLE reason is unchanged byte-for-byte; only its approval reference follows the new PLAN lineage. Original human approvals/failures and TC-010 mandatory/blocking requirements remain. New derived DESIGN/PLAN/SCOPE/UATNA records explicitly reference the actual P1 instruction plus these independently reviewed mechanical clarifications; they do not assert that Sam reviewed a newly presented hash or adopted the pending-create proposal.

## Remaining dependency and coordination

HD-016 proposal29 is unchanged at SHA256 `597fbf5763db4731cbd85266775d434fb1f94aaef93bdf2e779977f5c406084d`, independently approved for human decision only. No Sales provider/write protocol has changed. TASK-013 and dependent writes wait for actual A/B selection. P4 owner reports reserving forward migrations0101/0102 for Archive routing/guards; P1 has allocated no migration, operation routing or Archive change. The target may advance during parallel owner work; fetch/integrate and reverify the current candidate before any PR as required.

## Observed local commit

Actual Git commit `6f455930390d735a5a652379230dc470cab8da0f` completed with parent `fd32762f4fa17a5e77aaa7118a9ded2d3ac81e9e`; source fingerprint remains unchanged. TASK-012 is developer DONE. Post-commit canonical state/checkpoint records this observed outcome; TASK-013 and phase remain BLOCKED pending HD-016. No push, PR or CI has occurred.
