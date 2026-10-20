# Fulfillment implementation readiness requalification

## Outcome and authority

`BLOCKED / PROPOSED` — documentation preparation only, `REVIEW_AND_ALIGN`, observed on 2026-10-20 (Asia/Hong_Kong). The user requested the readiness review and then instructed「按建議進行」; that authorizes this concrete preparation, not approval of an unseen compatibility/contract change or entry into implementation. No product source, migration, shared config, other module, deployed service or database is changed.

Fetched `origin/main` and observed local main equal to `64bee2e00dfae71131c7cfa54049cac0941d6f85`, then created branch `codex/fulfillment-readiness-alignment` in `/private/tmp/erp-fulfillment-readiness`. Recovery is that immutable commit. All observations below apply to it, not to unmerged neighboring worktrees. Source fingerprint: `70eed2ff3e806da18ce44c0711712425806ffde3dbfaf3412457cf3e39fc4143`.

The 2026-09-14 inventory, gap analysis and approvals remain historical. Their claims that Sales/Inventory/Customer do not exist and no browser CI runs are superseded here. All 45 implementation Tasks remain PENDING; 12 Fulfillment technical specifications and 120 UAT cases remain unexecuted. The 145 requirements, 14 designs and four Phase identities are unchanged.

## Provider contract delta and ownership

Paths are repository-relative; method presence is not semantic or integration acceptance.

| Boundary | Observed implementation | Remaining work / responsible boundary | Required proof |
| --- | --- | --- | --- |
| Sales projection and result | `server/src/modules/sales/SalesFulfillmentGuardService.js::assertAllowed` protects lifecycle; Sales core and reservation mappings exist. No `SalesFulfillmentService`, `getOrderForFulfillment`, `lockLinesForFulfillmentInTransaction` or `applyFulfillmentResultInTransaction` exists in source. | TASK-004, Sales provider owner: additive §6.1 projection, order/line/mapping locks, exact result validation, Confirm Reserved→Fulfilled and Reversal Fulfilled→original Reservation, unchanged Cancelled quantity and SO recalculation. Fulfillment owns consumer tests. | Same-transaction rollback and lock-order tests; missing/duplicate/foreign lines and stale versions fail closed; owner review. |
| Inventory candidates | `InventoryReservationService::listFulfillmentAllocationCandidatesInTransaction` takes `{actor,query}`, one reservation, pagination, safe-integer requested quantity and provider-owned time. | TASK-005, Inventory provider owner: reconcile multi-line query, owner/claim context, bounded complete recommendation sequence and asOf/version policy with §6.2; do not relabel a paginated one-reservation result as complete batch acceptance. | Mixed-expiry FEFO/FIFO, multi-reservation owner/exact-set and changing candidate/version tests. |
| Allocation / release / Issue | `InventoryReservationService::allocateForFulfillmentInTransaction`, `releaseFulfillmentAllocationInTransaction`, `reallocateFulfillmentAllocationInTransaction`; `InventoryPostingService::postFulfillmentIssueInTransaction`. Payloads group allocations under a single reservation. Existing named providers fix permission/source and reject caller-supplied authorization or module. | TASK-005: additive reviewed batch facade/contract, sorted complete lock set and all-or-nothing multi-line operation in caller transaction. Preserve existing entry points for other consumers. No caller-invented permissions or raw Inventory writes. | Two-reservation/multi-line late failure rolls back all effects; exact picked/allocation set, source idempotency, revoked actor, expected versions and concurrent Issue proofs. |
| Wire representation | §6 requires decimal-string IDs/quantities and a common context; existing Inventory `inventoryPositiveInteger` accepts Number safe integers and provider inputs whitelist `{actor,source,correlationId,payload}`. | TASK-004/005/006: provider owners must approve the exact serialization/validation boundary before coding. Canonical wire remains decimal string; reject unsafe/out-of-range/fractional values before conversion. No arbitrary Number coercion or removal of strict-field checks. | Consumer schema fixtures, malformed/unsafe/fractional input rejection and trusted source/actor mapping. Re-pinning bytes below is not owner approval. |
| Dedicated reversal | Inventory has generic `inventoryReversalPosting.js` / `reverseMovementInTransaction`; no `reverseFulfillmentIssueAndRestoreReservationBatchInTransaction` exists. Generic reversal is not proof of reservation restoration. | TASK-005, Inventory owner: original Shipment Issue/source ownership, original bucket movement, same Reservation outstanding restoration; original Allocation stays Consumed. No generic HTTP exposure or retargeting. | Original-bin unavailable/counting, stale/reversed movement, duplicate event, partial batch failure, reservation restoration and once-only reversal under concurrency. |
| Customer shipping | `CustomerLookupService::listAddresses/listContacts` and `assertAddressUsableInTransaction/assertContactUsableInTransaction` exist; assertions scope parent, active shipping purpose and expected child version. | TASK-006: reuse these methods; preserve returned Customer lifecycle facts and validate the chosen Fulfillment policy. Add actual Fulfillment consumer coverage, including optional contact. | Owner/purpose/version/inactive races, safe snapshots, caller transaction; existing unit tests are partial evidence only. |
| Item eligibility | `ItemLookupService::getInventoryProfileInTransaction` returns Base UOM/tracking/minimum sale life in caller transaction. Generic `assertUsable` uses the pool and is not a transaction-aware submit assertion; transaction profile preserves serial facts for consumer rejection. | TASK-006: bind the transaction profile to Fulfillment submit validation at Create/Allocation/Confirm; batch strategy and lock order require provider-owner review. No new generic purpose or duplicate Item lifecycle rules. | Serial, archived/nontracked, changed Base UOM/life policy and same-transaction revalidation at all three submit points. |
| Permissions | `fulfillment.operation` and `inventory.fefo.override` already exist in catalogue. `fulfillment.view`/`fulfillment.reverse` do not. | TASK-002: only add missing permissions and seed/convention coverage with no automatic grants. Existing seed/migrations remain immutable. | Catalogue/seed equality, fresh permissions and independent view/operation/reverse roles. |
| Sales installation lifecycle | Guard returns distinct `NOT_REQUIRED` only when no Fulfillment/Shipment schema/history/provider exists; schema/history presence without real provider fails closed. | Before any live schema activation, Sales and Fulfillment owners must adopt an exact cutover/runbook and provider registration scope. Existing DEC-021 notes are not blanket rollout authority. | Quiesce release writers; migrations; real `fulfillmentOpenMatter` on all nodes; lock proof; resume. No negative cache or dropping tables to re-enable uninstalled mode. |

## HD-006 — P0 sequencing candidate

Decision required: the old entry gate required the very extensions that TASK-004–006 were meant to implement. The concrete candidate is already in `05_development_tasks.md` §1.4, TASK-001, TASK-007 and the PHASE-001 entry definition; the typed ledger makes TASK-007 depend on TASK-004/005/006.

- **A — Recommended:** retain the same four Phases and single P0 PR. Require merged provider cores at entry; TASK-001 inventories extension gaps; TASK-002/003 do permissions/pure rules; provider owners complete TASK-004–006; Checkpoint 0B blocks TASK-007–010 until every contract proof passes. This resolves the circular start without weakening the P0 exit gate. It requires explicit current-plan SCOPE approval for shared/upstream paths before implementation and exact cutover authority before any live schema activation.
- **B — Preserve the old all-contracts-before-P0 gate:** upstream owners deliver and merge missing contracts in separate scoped PRs first; revise TASK-004–006 to consumer integration only before starting P0. This preserves strict upstream-before-consumer delivery, but changes PR sequencing and requires a further plan revision.

Default recommendation is A; no answer is inferred. Neither option authorizes source changes, migrations, deployment, messaging other chats, merging this planning PR or bypassing owner/CI/review gates.

## HD-007 — Database compatibility candidate

Historical HD-001 approved MySQL 8.0. Current `.github/workflows/ci.yml` pins `mysql:26.7.0` and checks the exact server version. This observation does not prove Fulfillment compatibility on either version.

- **A — Recommended:** approve 26.7.0 as Fulfillment's development/test support baseline, matching the shared Inventory/Sales runtime and current CI. Candidate target statements are already marked HD-007/PROPOSED in design §0/§4.1, plan §1.2/§1.4/PHASE-001 and TC-001/TC-009 prerequisites. Preserve service/trigger/enforced-CHECK protections, same schema/transaction semantics, capacity/coverage and all acceptance cases. No production upgrade or claimed 8.0 support is included.
- **B — Retain 8.0:** revert only this candidate's target-version edits, then supply a separate verified 8.0 runtime/CI path and prove upstream/migration compatibility on it. This keeps historical platform support but adds validation cost and may expose current upstream incompatibilities; 26.7 runs never count as 8.0 evidence.

Default recommendation is A; no answer is inferred. After either choice, execute true MySQL migration, FK/trigger, concurrency/rollback and recovery proofs in the authorized implementation stage.

## Candidate hashes and review disposition

The candidate uses observed hashes for one provided and six consumed contract sources, all labeled `REVIEW_PENDING` / `NOT_APPROVED_NOT_IMPLEMENTED`; this repairs stale references without declaring compatibility. Previous approvals/reviews remain immutable historical records, not rebound signatures.

- DESIGN: `683abcc2192073c57df58023bd876f03904e868d27181a3cd1d438df1c452e27`
- PLAN: `234867a700205bacd60800173655bfbc391de18dfa241d07477dd20bd8415a96`
- Proposed adoption includes renewing unchanged `NFR-023` UAT N/A against the adopted plan; TC-010 contract-version/compatibility coverage stays mandatory and blocking. No new UAT exemption is added.
- Review method: `SELF_REVIEW` by Codex, the document author, with changes requested until HD-006/HD-007, provider-owner scope/contract review and current independent review are satisfied. No independent review or human approval has been manufactured.
- If A+A is adopted unchanged, record the actual user decision against these exact hashes; if edited, compute and present the new baseline. Actual IMPLEMENT authorization and isolated runtime allocation remain separate.

## Validation and remaining entry checklist

At the observed source baseline, Node v26.6.0 ran the existing reviewed read-only provider unit command in this isolated worktree:

```text
node --test --import ./server/test-support/testEnv.js --test-reporter=spec \
  server/test/inventoryProviderContracts.test.js \
  server/test/customerLookupService.test.js server/test/itemLookupService.test.js
75 tests; 75 passed; 0 failed; 0 skipped; 0 cancelled; 0 todo.
```

These use injected test executors and do not prove real MySQL, Fulfillment consumer integration or formal TC/UAT execution. No UI or product code changed; no browser/build/full regression result is claimed. Historical other-suite failures are not asserted as current failures.

- Traceability: `STRUCTURE_PASS`; matrix regenerated deterministically. 145 requirements / 14 designs / 4 Phases / 45 Tasks / 12 TC / 120 UAT retained.
- Contract pins: all seven match observed files; not semantic adoption.
- Approval-aware traceability: expected BLOCKED on stale NFR-023 N/A approval until renewed.
- PLAN_READY: expected BLOCKED on HD-006/HD-007, current DESIGN/PLAN approval and independent review; resolving hashes is not readiness.
- Boundary / whitespace / local links: checked before the planning commit; scope limited to this documentation directory.
- Migration inventory: 84 JavaScript files, highest prefix 0087, no duplicate numeric prefix at the observed baseline. No sequence reserved; re-inventory on actual implementation start.
- Browser: root Playwright pin and CI job exist. Current CI runs `e2e:mocked` for other modules; Fulfillment suite/profile/CI coverage remains a PHASE-002 delivery obligation, not a reason to claim no browser tooling exists.
- External freshness: fetched main before branch creation; re-fetch and inspect target changes before future merge. Planning PR is a draft pending decisions; no merge authorization is implied.

Next safe action: obtain HD-006/HD-007 and independent baseline review; resolve any exact provider contract/scope and installation choices; record current DESIGN/PLAN/NFR-023 decisions; only then assess PLAN_READY and request/record the intended IMPLEMENT scope. Business acceptance and release sign-off remain open by design.
