# HD020 — Release-aware Reallocation advisory

Status DECISION_REQUIRED; proposal only, no adoption or new interface implementation. Current TASK021 atomic17252c2c4da5f24b2bcddd07b5e666c45472ca64/sourceffa76 is independently approved. Original P1 gates, safety checks and20000ms transaction ceiling remain.

## Actual gap and authority

TASK015 explicitly delivers candidates for DRAFT only. FulfillmentAllocationService.candidates uses lockClaimCapacityInTransaction, which rejects non-DRAFT; report38/TASK017 and canonical03 release-aware preparation explicitly retain both existing advisory APIs. TASK017 already authorizes complete own-release credit computation for selection validation and atomic Reallocate, but not this new counterfactual advisory ABI. TASK022 requires Reallocate UI with Inventory-owned recommendations; frontend must not reconstruct owner eligibility/ranking/credits.

Actual installed Playwright/realAPI/owned synthetic MySQL probe task022-reallocation-candidate-probe.log: Fulfillment45 planned10→Allocate10/PICKINGv2; GET allocation-candidates(version2/page1) returns409VERSION_CONFLICT. Existing same-Bin Reallocate10 succeedsv3. Actual Balance has OnHand10/Allocated10/physicalFree0. This is a current read-contract gap, not a defect allegation against the correctly scoped DRAFT endpoint or approved atomic writer. Simply loosening the state guard still omits credited physical-zero buckets and gives the wrong recommendation budget.

Actual separate reviewer /root/fulfillment_independent_review inspected canonical authority and current sources, confirmed this is a material owner/public-API/user-visible-data-contract choice under Harness17, and recommended A for human disposition. A technical role alone is not human approval. Final exact-proposal separate review is recorded separately before asking.

## A — Explicit bounded read-only Inventory advisory and Fulfillment endpoint

Add a separate Inventory-owned release-aware batch candidate entry and a separate Fulfillment GET reallocation-candidates projection, preserving the DRAFT endpoint/DTO/hash and all existing writer contracts. The public query contains only parent ID, expected Fulfillment version and bounded page; no client credits, arbitrary owner IDs, dummy selected legs or generic mode flag.

Use actual RC/fresh view+operation authority and complete Sales/Fulfillment/Line/Claim/current Reservation source/counter proof. Target is PICKING/unpicked. Match the exact complete local current work to independently enumerated dedicated, completed, positive Inventory own effects; unknown/incomplete dedicated rows fail rather than being filtered away. Inventory alone derives all legally releasable own outstanding credits before every new member/page. Never credit foreign/historical consumed/released effects; enforce credit≤actualAllocated≤OnHand and actual current Allocation/Balance/Reservation CAS.

Reuse the existing release-aware owner loader and owner eligibility/order SQL. Credits participate before WHERE/LIMIT/rank, including zero-physical-free credited buckets. Ineligible old expiry/inactive buckets may be released but cannot become new eligible buckets. Shared per-Balance budget follows actual FulfillmentLine/Reservation writer order across all preceding members and complete page prefixes. Distinguish physical free, own release credit and available-after-own-release; retain true initial Balance CAS, no virtual version increments. quantityComplete remains quantity-only, not proof that selected leg count fits the writer shape.

No Inventory DML/upsert, operation preclaim/zero command, write receipt, stock reservation, auto-POST or implicit permission. The actual atomic Reallocate remains sole posting authority and rechecks complete old/new sets, CAS, reasons/FEFO authority, source and counters under the existing locks. Preserve selected input until explicit reload/confirmation. No new stock, reserve, isolation, schema or lock-order exception.

Cost/scope: one explicit owner advisory, read handler/schema/service/client call and necessary owner canonical/pin documentation, within existing Fulfillment/Inventory source owners. Exact owner review and full P1 gates remain. New real tests include zeroPhysical/allOwn, foreign effects sharing Balance, repeated Balance, cross-member/page budgets/rank>100,100Lines/5000members, eligibility exclusions, malformed/counter/source/schema failures, fresh role changes, races and zeroDML. Preserve every applicable inquiry/API latency/P95 bar and original20seconds; newly measure this actual release-aware path rather than borrowing DRAFT evidence.

## B — Defer the Reallocate UI portion

Keep the existing APIs and defer Reallocate UI until a separately approved advisory contract exists. This reduces immediate interface work but changes the approved P1 delivery scope and prevents claiming the original TASK022/full-P1 plan complete. A physical-free-only picker or client-computed release credits is not an authorized silent substitute.

Recommendation/default proposal A. Actual human answer is required before implementing either changed contract/scope. Continue unaffected detail/Pick/Cancel and planned Print work meanwhile. No P1merge, formal acceptance or live migration authority follows this decision.


## Actual adoption —2026-10-26

Actual Sam asynchronous answer: A：批准獨立 release-aware 候選介面（建議）。This adopts A faithfully; no unseen-source/future-CI approval is claimed. Exact pre-adoption proposal SHA 2ce92b61c02ca7f3d5499a0bbeb87f7fed05811fb29fbabe0ba2fa62d89f407c is preserved in the private proposal-snapshots archive. Canonical design/plan, owner pins and named shared scope are being aligned before affected code; exact independent adoption review and every source/runtime/fullP1/currentCI gate still apply. HD022 remains a separate unanswered decision; no HTTP body cap or acceptance waiver follows these answers.
