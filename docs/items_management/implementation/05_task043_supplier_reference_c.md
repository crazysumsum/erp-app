# TASK-043 increment C — installed Supplier reference subset

PHASE-009 / TASK-047 is the owner-authorized Item-only merge unit. Aggregate TASK-043 stays IN_PROGRESS. Authoritative completed-GR integration and formal TC/UAT acceptance are separate, not removed requirements.

DESIGN `f7431c0934377f3331fd0a537e236eca8044df41f359d36202153803c4aca315` remains unchanged. PLAN `46dd2221fc8f8fe974adc6553d83c3eaefc706e81315b649a55b8331a715410b` expresses the explicitly requested partial integration: task implementation DoD before MERGE_READY; phase exit after observed merge/cleanup. Entry main `7c927e26` was refreshed to `3832635077ecc32c6a7b9292e2b9e155223008d0` before the final checks. Source `711f09a98d1f59c0362025aff3c0b89647eee4cac2250e833f747ec14e168549`.

## Delivered / unchanged boundaries

The existing Item guard already handles real Supplier migration0081 FK types correctly. No product fix is needed for this subset. Only Item-owned reference tests and Item lifecycle/traceability/evidence documents are authored; no Supplier/Purchasing product, schema/migration, endpoint, permission, UI, profile, dependency, threshold or contract change.

Six developer scenarios use actual migration0081 tables and SupplierRelationService:

- Supplier relation/event references reject permanent Draft Item/SKU deletion with public409, actual dependency types and complete state/version/UOM/Barcode/audit rollback.
- Composite mapping ownership and stable IDs survive ordinary price edits; referenced removal/factor/tracking changes remain blocked.
- Soft relations/history do not independently block Item/SKU/bulk archive, remain readable through the actual Supplier service, and do not restore purchase eligibility.
- Native FK errors are translated to actual public types or unknown fallback; hooks control metadata visibility, not fabricated database errors.
- Real Supplier-create versus UOM-removal exercises both commit orders and preserves the winner without partial loser/audit writes.
- A NEW GR event fails closed503 with the default unavailable source verifier, leaving relation/event/audit histories unchanged. Existing event replay has separate semantics; this test does not claim every call must return503.

HD-092's proposal to exclude supplier references from incompatible factor/tracking protection is not adopted. This preserves the approved §8.4 policy; changing it needs a separate product decision.

## Verification / real reviewer provenance

Focused new cases19/19 and the full Item reference suite40/40 passed, zero skips. New regression is tested before product modification; because current guards already pass, no unnecessary production code was added.

Mutation temporarily excluded Supplier references; the mapping test failed with actual unknown versus expected supplier_sku_refs. Exact source bytes were restored with cmp and an empty product diff.

Source reviewer /root/item_supplier_handoff_review reported one MEDIUM test-cleanup issue. It was fixed: release and settle transactions before SQL teardown, observe started promises, reject premature marker completion/failure, and impose a10-second deadline. Intentional held-winner failures in both commit orders completed in about1.04s without timeout/unhandled rejection; Supplier fixture/relation/event/audit counts were all0 afterward. The test bytes were restored exactly. Final source review approved; test SHA256 `fd861a53a0fe085b01c9abf06b2abcf5e1df11fa983de5b05fc274cda96a37bc`.

Separate PLAN review identified C-PLAN-001 (circular merge/cleanup task DoD); final PLAN separates pre-merge implementation completion from phase post-merge exit. Reviewer approved the corrected PLAN, unchanged requirements/design/profile/contracts and preserved mandatory/acceptance flags. Earlier different-PLAN/source checks remain supporting history only, never current gate credit.

The four final current-PLAN/main developer runners PASS: lint/build, server524/524 and client860/860, zero failures/skips/not-run. Actual final run IDs: 20261013T090536-a50531c20f95, 20261013T090546-9e92fa1004be, 20261013T090553-78e0880a6907, 20261013T090558-38c05f510397. They bind PLAN46dd and source711f09; prior results are not gate credit. Runtime is a new task-private socket-only MySQL26.7.0 with a synthetic schema and existing migrations through0081; shared databases and user credentials are not used. This test-only backend change creates no new browser surface or formal UAT execution.

## Remaining TASK-043 work

Purchasing／Supplier 解鎖責任、權威來源／verifier／投影／補寫證據及未決接線，見 [TASK-043 權威 GR 交接](../item_handoff_authoritative_gr.md)。此交接不更改既有 contract 或宣告 GR／正式 UAT 已完成。

The authority adapter for completed Purchasing GR sources is absent on main; production recordSupply defaults to sourceVerifierUnavailable. Positive first delayed projection after SKU deactivation/expiry, source-backed reconciliation and actual completed-GR end-to-end proof remain BLOCKED on that external integration. Synthetic seeded history or a test verifier is not authority and is not promoted to that result.

Formal TC-004/TC-005, UAT-005/UAT-013 and new provider UAT-017 remain later TEST_AND_VERIFY/business acceptance work. Recovery owner-waiver and TC-016 NOT_RUN history are preserved. No whole-module readiness, business acceptance or release approval is claimed.

## Candidate / evidence / integration handoff

Sam explicitly authorized this Item C subset's candidate/PR, current CI+review-gated merge and Item-only cleanup; formal GR/UAT stays separate. A separate actual async approval authorizes exactly15 synthetic runner packages: fixed11 historical plus4 final current-baseline runs. Their52 regular files (1,395,834bytes) contain run.json, redacted logs and JUnit/build/lint data only; every artifact SHA256/byte length and final PLAN/source/status matched. Classification found no private key, keyring value, credential, cookie/token/login state or browser trace. This reviewed batch includes the previous provider's4 local packages and preserves known run indices. Four superseded308f intermediate packages are retained locally and are not included in that export; no general export policy change.

Freeze only after the final four developer checks, typed traceability/boundary and source/PLAN review pass. The immutable candidate still needs exact review and all five current CI jobs. Observe integration, preserve local journal/evidence and clean only this Item branch/worktree after the authorized merge; never set TASK-043 DONE for this partial slice.
