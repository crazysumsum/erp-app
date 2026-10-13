# TASK-043 increment B — latest-main compatibility

On 2026-10-12, candidate `71cfd18c72af762ac25353c9bef3e4f02e197f79`
completed CI run38190756584 attempt2 successfully after one diagnosed, bounded
failed-job retry. Attempt1's Framework replay-cleanup and Supplier worker timing
failures remain historical failures; neither module was changed to conceal them.
Before merge, an actual Git fetch showed main had advanced to
`f7ddcfd57c1a6ecd3b57585719f92fd4d3dbdfcc`. It was integrated without conflicts
as `a93d6defec75b252b5744abed024a3606da72f5e`; candidate71 was not merged.

## Item-owned compatibility correction

The incoming real Inventory Transfer schema makes existing Item requirement
"positive in-transit quantity or unfinished transaction prevents archival"
executable. Item's shared archive probe now reads real Transfer lines/headers:
positive `in_transit_quantity` or DRAFT/IN_TRANSIT blocks Item/SKU/bulk archival.
Terminal zero-quantity history remains readable and does not block archival;
retained native FKs still protect deletion and critical Item conversion changes.
The probe is nonlocking; Item parent/SKU locks and caller-owned consumer shared
locks retain the reviewed transaction order. Inventory remains the quantity owner.

TDD reproduced missing rejection first for positive in-transit quantity and then
for zero-stock Draft obligations. The real migrated-MySQL regression covers
409 reference types, unchanged aggregate/audit on rejection, atomic bulk rollback
and retained completed history. Its first teardown exposed an FK dependency-order
failure; transfer cleanup now runs before the shared fixture deletes bins/warehouses.

The enabled incoming Transfer consumer initially failed with ER_BAD_FIELD_ERROR
because its synthetic Item parents omitted existing `items.version` and
`item_skus.version`. Only those test columns and the explicit Item INSERT were
aligned; no Inventory product code, migration or business behavior was edited.
The full enabled real Transfer regression then passed32/32, zero skips.

## Independent review and fresh developer checks

Separate reviewer `/root/item_supplier_handoff_review` requested changes for
T043-R03/R04/R05, then confirmed all three resolved and APPROVED source
`3da037cd9926466f4d8753d353b9b648ffd4e41c94d998cc93058b29e7822dae`.
DESIGN `59ee6cb3664ae1742e41b218ffd3bf223e396eb44a4aa24d82028ebb9cf7c16d`
and PLAN `01e51df95e1e8742e765c18ec3dcf8205d8b30dd97a9a2feb7b9b7221adef66a`
remain unchanged. Boundary and traceability checks pass; new product/test whitespace
checks pass. Exact-candidate review and all five fresh CI checks are still required.

All four configured DEVELOPER runners on source3da037cd passed: lint, client-build,
server501/501 and client860/860, zero failed/skipped/not-run cases. Real Item
Playwright developer regression passed12 cases, with two pre-existing formal
UAT gates skipped; console/network assertions passed. This is not formal acceptance.

The owner-approved original four synthetic packages remain repository-tracked.
Additional integration reruns and browser diagnostics are local-only: no new raw
package export is inferred from that batch-specific approval. They will be preserved
under `/private/tmp/erp-item-task043-closeout.xK7U0M` before worktree cleanup; the
runtime journal/gate observations will be preserved there and referenced on PR198.
No new local-only evidence pointers are committed into the shared checkpoint.

TASK-045 is the increment-B merge unit. Aggregate TASK-043 remains IN_PROGRESS:
Supplier increment C and formal technical/UAT increment D are not claimed complete.
Recovery owner waiver and TC-016 NOT_RUN semantics remain unchanged.

## Preserved e88692 CI failure and consumer-mock correction

Candidate `e88692e07bf576b093e6288177cf3e0fa10e9558` passed independent
exact-candidate review and four CI jobs, but run38194625704/job114634468064 failed
four cases. Three incoming Transfer lookup tests used an obsolete fake executor
that returned SKU rows for discovery/current Item/UOM queries. The author reproduced
11 pass/3 fail, then aligned only the fake rows with the existing provider's current
locked reads and the constant seven-query lookup budget; original wildcard,
eligibility, error, response and caller-executor assertions remain intact.
Affected consumer/provider regression passed61/61, zero skips. No Inventory/Sales
product code, public API, threshold or skip policy changed in this correction.

The fourth failure was Sales TC-032 no-warmup completed-confirmation P95
3016.0ms >3000ms. All coverage floors passed (93.66/85.47/92.17), but the overall
CI result remains FAIL and was not retried or waived. The same existing capacity
case ran on the task-owned private MySQL with150/150 correct HTTP200 outcomes,
P95 673.146ms, zero commitment-reconciliation mismatches and successful background
jobs. Different hardware means this supporting diagnostic cannot prove CI PASS
or establish that the failed CI was flaky. The Sales batched provider retains its
existing constant five/six-query paths; the extracted helper does not add an N+1.
The corrected test-only source must receive fresh developer checks, review and
mandatory CI before any merge. The failure remains in the runtime journal and PR.

New source fingerprint:
`57fa50775e0eb64f47bf7caadc9cc4dfec758580364ee6e01f3824d58072f36e`.
Subsequent local-only evidence and revisioned runtime journal remain outside the
tracked checkpoint; only the original approved four raw packages are exported.

Extended2239 top-level server tests first exposed one local proxy-trust failure.
It reproduced on untouched main while the identical CI Linux case passed. Runtime
inspection identified borrowed shared `node_modules` with proxy-addr2.0.7 despite
lockfile2.0.8. Only the Item-owned symlink was moved to the closeout recovery area;
`npm ci --offline` installed the existing lockfile into the Item worktree, leaving
the shared dependency directory, lockfile and all security code/assertions unchanged.
The exact security case then passed with installed/locked2.0.8. The original failed
XML is retained, and fresh mandatory checks plus extended regression use the correct
task-owned dependencies. No unsupported macOS-security-defect claim is made.

With the correct lockfile installation, extended2239/2239 server cases passed with
zero skips, and the four configured developer suites again passed (server501,
client860, lint/build). Separate reviewer independently executed61 affected cases
and approved the narrow mock correction/source57fa; confirmed Sales batch query
counts/lock order are unchanged. Final candidate CI is still mandatory, including
the unchanged Sales capacity budget. The shared workspace dependency directory was
not updated and may still require its owner's normal lockfile installation.
Serial actual Item Playwright regression on the same correct dependencies passed
12 cases with2 pre-existing formal-UAT gated skips and clean console/network checks.

## Approved Supplier test synchronization only

Sam expressly approved only the failing Supplier test's transaction synchronization,
with no product-code, assertion or threshold changes (APR-046/APR-047; HD-009).
Candidatea1301240's CI38196915622 failed solely at Supplier lock-wait recovery:
expected `completed`, received `undefined`; both Sales capacity scenarios and the
Item/Transfer corrections passed. The prior failures remain preserved, not retried
away or converted to PASS.

The failing test now acquires/releases the specific import-job row with `FOR UPDATE`
after releasing HKD and before checking pending/no-write/recovery state. This is
four added lines using the existing bounded transaction helper. Client exit is not
a server-rollback acknowledgement; acquiring the target job lock establishes the
missing synchronization without sleeps, retries, data mutations or weaker asserts.
Every original timeout/pending/no-write/completed/exactly-once assertion remains.
Worker timeout stays1500ms and no transaction budget/configuration was changed.

Actual focused real-MySQL execution passed1/1; full Supplier import regression and
four configured developer suites are recorded separately in the current journal.
Separate reviewer approved the barrier/source after checking unchanged assertions,
lock scope and no authored Supplier/database product changes.

During resumption, fresh main advanced to
`a2715077871ffa8289193d6482df6add6b363bd7` (already-merged Supplier PR197).
It was normally integrated as `26d464ee33c8a76d36228959d7367a7abeb01065`.
Existing0080 migration was applied only to the task-private synthetic schema;
no migration or upstream Supplier product edit was authored for this correction.
DESIGN/PLAN remain unchanged. New source:
`b41b3be087d493e8a3c2e3de64d089aa4d628d00788471dad4f47ea7d816bd5d`.
New candidate still requires exact-candidate review and all five fresh CI checks
before PR198 merge/Item-only cleanup. Formal acceptance and aggregate TASK-043
completion are not inferred from this developer regression.

## Latest-main resumption — 2026-10-13

Fetched main `e75414753bb898d9db69569f3130a63cae16a19c` was normally integrated
as `8313d9c0a0ced39df2d2b5692a4ae4d255a61607`, preserving the four-line Supplier
test barrier and all uncommitted evidence/journal. Already-merged upstream PRs
200/202/203 contain Supplier provider pin and Sales lock/capacity-measurement changes;
none was authored as this test correction. Upstream CI measures the same two Sales
capacity scenarios without coverage instrumentation and explicitly requires2 PASS;
the3000ms budget remains. This branch did not modify CI, Sales products or thresholds.

Source `1867ca0eabc4218a8d00ceb6275dca7ab7c758bac41534681715351f6c80fa49`
and unchanged DESIGN/PLAN identify the new integration baseline. Full real-MySQL
Supplier import regression on this source passed42/42, zero failed/skipped.
Old b41/57fa results and all failed CI runs remain historical; only fresh current
developer/CI/review results may satisfy this candidate's merge gate. No formal
TC/UAT/business acceptance or whole TASK-043 completion is claimed.

## Final candidate preparation — main PR204

The pre-commit freshness check found main advanced again to
`cd1e102d403721d458185009b60c836ad8c48675`. Normal merge
`e8bb13f28a5998ab052dd0dec1bb008b9fe11ddb` imported upstream Sales PR204's
row-lock corrections without conflicts. No Supplier/Sales/database product or CI
change was authored during this remediation. The Supplier test still differs by
exactly four added synchronization lines; assertions and1500ms worker budget remain.

Current source:
`b21eef9542468222a85aacba2096dc9047f4fc6591c9d6cfdcbb94ebc0175520`.
Full real-MySQL Supplier import regression passed42/42, zero failed/skipped.
All four configured DEVELOPER runners passed on this source: lint, frontend build,
server501/501 and client860/860, zero failed/skipped/not-run cases. Actual Item
Playwright regression passed12 cases with2 pre-existing formal-UAT gated skips;
the affected409/history/state flow and console/network assertions passed.
Separate reviewer `/root/item_supplier_handoff_review` independently reran61
provider/consumer cases (all PASS, zero skips) and approved this source after checking
lock ordering, upstream integration and the exact four-line barrier. This is not
human GitHub approval or formal TC/UAT acceptance. All earlier CI failures remain FAIL.
Exact-candidate independent review and all five mandatory CI jobs are required;
no old candidate's green result authorizes this merge.
