# DEC-028 — TASK-053 responsive shared-header correction

## Original proposal (preserved before decision)

Status at proposal: DECISION_REQUIRED; proposed patch not applied. TASK052 is committed cb376aa4. Current DESIGN5c1ed45c / PLAN93cd021b remain authoritative until a new decision. Existing commit/PR/main-merge and owned synthetic test authority is retained.

Actual P4 inquiry browser R1:10PASS2FAIL; R2:11PASS1FAIL. Corrected API quantities nested projection with a reproducing red regression and actual six-cell browser assertion. The Archive-probe oracle now counts API calls rather than Vite module paths. Both failures and independent REQUEST_CHANGES remain preserved.

Remaining actual failure is the existing shared AppTopbar account dropdown: a synthetic display name makes its right edge361.75px in a320px viewport. Sales page content and internally scrollable tables are separate; do not hide overflow globally, shorten the fixture name or weaken the full-document width oracle. The file is outside current Sales source/write scope.

Recommended supplement: allow exactly `client/src/framework/layout/AppTopbar.vue`; retain all existing paths. Apply only the reviewed presentation patch: use the existing Quasar label slot with escaped complete display name and ellipsis, constrain account button to50% toolbar width. Account menu, authentication, APIs, business rules and phase boundaries remain unchanged. Trade-off: long display names become visually truncated; full DOM/accessibility name remains available.

Exact unapplied patch: /private/tmp/sales-p4-topbar-fix.patch SHA256828a6b6d88522ebb6258733403c970626f499980e65f812d5950c6648fe94e59. Prospective manifest: /private/tmp/sales-p4-topbar-proposed-manifest.json adds only that path to source_paths and allowed_write_paths. Prospective DESIGN af176fea5409aadc193a2f397750344b9c4cc217ea77b10bffeebda1265e5fdb / PLAN de15768f64e214095fe5daefb82968188496d9270a23f3a8d7e781cb600914ad. Five specification files, profile, trace ledger and all thresholds remain unchanged; retain prior approval hashes and append new bindings after actual approval.

Separate prospective reviewer /root/sales_p4_inquiry_review checked the exact patch, Quasar installed label-slot implementation and escaped accessible name semantics. Proof: phase4-private/task053-topbar-prospective-review-r1.json SHA256b6294db696a3fa11187c378ad5ed5fa751378e7e6cbb2877b19199d0ec3692b0. This is not applied-source/browser or whole-phase approval.

After approval: apply exact patch/scope supplement, append baseline-bound decision records, rerun unchanged320/375/768/1024/1440 full-document width checks and add actual account accessible-name/keyboard menu checks, existing AppTopbar tests, Sales regressions, lint/build and independent actual UI review. Then finish TASK053 and continue054 onward. No test skip, bar reduction, old PASS relabelling or merge exception.

Alternative: retain current source scope; TASK053/strict dependent task chain remains not ready pending an independently delivered shared-header correction. No complete P4 merge. Archive still separately awaits actual Fulfillment open-matter and same-transaction providers; this supplement does not resolve or waive them.

## Actual approved continuation

Sam directly replied「批准 DEC-028 單一共享頁首補正（建議）」. Exact reviewed patch828a6b6d and one-file manifest supplement applied; old approvals and original proposal preserved. Actual DESIGN af176fea5409aadc193a2f397750344b9c4cc217ea77b10bffeebda1265e5fdb. Actual PLAN99a048fd69847b62c6345836baf431f33a20b4c137fa3702e0c8a2d8c430be03 includes two purely mechanical NFR014/015 UAT_NA approval-reference replacements to APR-DEC028-UATNA-DERIVED; applicability, rationale, execution contracts and all five specification files unchanged. Prospective PLANde157 remains the historical pre-reference-rebinding proposal, not actual final plan. CAS1071 records the specific human answer and appended current bindings. Actual browser and final scoped review still required; no Phase/main merge qualification.

Actual browser R3 correctly rejected the slot-only patch's accessible name: Quasar derives a default toggle aria-label from its label prop. The same approved file now uses Quasar's existing `toggle-aria-label` prop to retain the complete display name, alongside the escaped ellipsis slot. This necessary implementation correction preserves the approved behavior; R3 failure and prospective reviewer correction remain recorded. R4 passed functional checks but its screenshot caught a drawer transition; R5 uses actual page geometry assertions before captures, with no fixed sleep or weakened viewport oracle. R5:12PASS,0FAIL,0SKIP; same320/375/768/1024/1440 viewport checks plus complete accessible name and keyboard account menu. All104 affected client tests, lint and client build passed. Screenshots inspected privately; final scoped independent UI review remains separate from Phase/main qualification.
