# PR319 — Draft difference-write contract review

Authority: actual Sam PM user message01a19b0b-e339-7bf3-81c8-954b92e3517f was read directly. Try stable-ID difference writes while preserving Draft Claims/history and0106 protections; share the original failed HTTP evidence. Sales alone edits its candidate. No full CI rerun, new routine case or load. Any actual DELETE-rule change remains a separate Sam decision before implementation.

## Current contract and feasible subset

The current full replacement update uses the approved complete old/new Sales/Inventory source and Claim capacity proof, then Header/version CAS, Line deletion/rebuild and immutable audit/outcome. HD017 and design§2.3/§5.3 describe rebuilding Claims, and the first domain integration case explicitly expects a new Line ID. Sam's new stable-ID direction requires this implementation detail and its assertion to be reconciled explicitly; do not silently delete assertions or claim the full contract is fixed from one case.

For the original one-Line quantity1→2 HTTP flow, the SalesLine/Reservation mapping set stays identical. Schema0093 permits updating planned quantity and current Draft Claim original/active quantity, while preserving source IDs/created_at, zero released/consumed/reversed counters and nondecreasing Inventory version. With the complete existing lock/counter/no-effect proof held, unchanged rows need no write. This does not create Inventory Reservations or change their quantities.

Removing a Line or replacing its Sales source is not represented by retaining the old row: planned must remain positive, parent/source and line-number uniqueness remain, and no retired state exists. Keeping a removed positive row contradicts complete replacement and current line_count/readers. Retaining unused Claims as RELEASED likewise contradicts the current complete DRAFT proof requiring all own Claims ACTIVE and all release/consume/reverse counters zero. Silently filtering these rows, inventing Archive mirrors or relying on CASCADE is not an authorized solution.

## Shared actual pilot evidence

Sales retained a guard-preserving source snapshot SHA05d332028afe8a08ac84eb2401fd8a5367f8ee6feeddea39fbfdcbccd7b3734d at its8989edb9 candidate. Fulfillment independently read that exact source/diff, the private read-only observer, original test files, raw reports and before/after proof in Sales private `ci-failure-functional-repro-r1`.

The original named HTTP business case passed. Its raw JUnit contains2PASS records: one selected business case and one additional zero-match file placeholder; this is not two functional cases. LineID1/ClaimID1 and both created_at values remain unchanged; planned and Claim original/active change1→2, Line version1→2. Inventory Reservation quantities/version and CREATE history remain unchanged. Exactly one UPDATE audit is added; domain replay makes no further changes. Both0106 trigger action-statement SHAs remain identical before/after. Migration0106, its guard generator, FulfillmentLockService and the two original test files are byte-identical to Sales HEAD.

Private independent owner receipt: `independent-fulfillment-owner-pr319-quantity-pilot-review.json` SHA7adedbe5db258ef5341889971a0e93e4498f38656af7711535b46a92474fdfe4. Result0C/H/M is limited to this pilot. Fulfillment did not rerun it or modify Sales' worktree. Add/remove/source-set changes, snapshot refresh/reordering, full replacement, original ID assertion alignment, coverage and P4 CI remain open. Sales is consolidating any necessary persistent-rule/schema options and impacts for one Sam decision; no guard/migration change is approved by this review.
