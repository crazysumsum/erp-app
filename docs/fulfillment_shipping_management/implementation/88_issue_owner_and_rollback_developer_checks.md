# P2 Issue owner proof and native rollback checks

Status: eight bounded developer groups passed (8 Node cases,17 scenario results); DEF029/030 and full P2 gates remain OPEN.

The initial two groups use actual proposal75 B's existing `ISSUE-OWNER-PROOF` three scenarios and the three remaining `ISSUE-ROLLBACK` Inventory/Sales/snapshot scenarios. No new routine CI case, fixture size, repeated load, performance/capacity work or production switch was introduced. The previously proved late Fulfillment Audit failure was not rerun.

The initial two groups ran on actual local commit `1542e1e1c5e3b06c4f64df672fba343f02f84cb5`, source fingerprint `5f972e9d922036541a6e6c0ce9e8baa3d91a8fae6434173b6bf34b88d25f4d01`, plan `7882d19ae5c91ca9aba354e29b000150dde46fa61dcd3a9144455f032e41a7c3`. Each group has one Node case and three explicit JSONL scenario results. Each scenario owns one small SO/SKU/Line/Reservation/Balance fixture (original5 units, picked3), one completion attempt and serial cleanup before the next fixture. Actual fixture transactions retain their existing10s/2-connection configuration; the production20s default is unchanged but an HTTP application is not loaded by these probes.

## Owner proof: three selected refusals

Raw private result: `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/lookups/owner-proof-private-3d1dc8ca81ec/result.json`, SHA `4376e04a314287785359659d2f86420a0815dae6e619337d6f88a8e9c2066724`.

| Scenario | Actual boundary and result |
| --- | --- |
| Exact member/source mismatch | The real Inventory post completed within the transaction, then the test altered one returned Reservation identity. Fulfillment rejected the result before Sales apply; actual native rollback restored all24 business tables and retained SHIPPING/version2/original pending event. |
| Foreign receipt issuer | The real Inventory post completed. Sales asked a distinct genuine Inventory provider instance to verify the exact same transaction/action/operation/Shipment/event/hash; its private receipt map had not issued that receipt. Actual receipt verification refused it, and native rollback restored all24 tables. This proves the selected foreign-issuer boundary, not every foreign-transaction/forgery variant. |
| Stale owner version | A real owner read was returned with one valid older allocation version. The consumer refused it before any post. Actual native rollback preceded the complete owner-negative proof; only the prescribed FAILED operation/DRAFT version3 and exact actor/event/correlation/history/audit transition were written. Twenty other business tables remained identical. |

Actual counts:1 Node PASS,0 FAIL/SKIP/not-run,3 ordered scenario PASS results, no runner timeout or freeze/resource guard error. The test observes the real transaction outcome; a generic rejection or a simulated rollback flag cannot satisfy it.

Execution admission review SHA `c862b12a23419534a15ddd4e402ff442936bc1b5c7c4c7f976f0f30667bcd194`; actual-result closure `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/independent-p2-issue-owner-proof-three-scenario-actual-component-closure-review.json` SHA `9f9264dee31aa8eea929c48bf4e0fc4b0fcd2a70a1be83862ee4ae7acd493575`,0 C/H/M. Test-owned wrappers remain outside CI discovery and production code.

## Native rollback: three remaining stages

Raw private result: `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/lookups/stage-rollback-private-b6c557446572/result.json`, SHA `5d99c94b5d77bc6864ce336640569c0029a1ea7b1d263da3b9aa3c36b1facf47`.

The owned child-schema triggers emit the exact expected native `ER_SIGNAL_EXCEPTION`/1644/45000 and a distinct stage tag only after checking the required in-transaction effects. A separate wrong-point tag cannot satisfy the assertion.

| Stage | Effects verified before the native fault |
| --- | --- |
| Inventory | The Issue movement exists, Balance is2 with0 allocated, Reservation has3 consumed/2 outstanding; failure occurs at Inventory success audit. |
| Sales | Real Inventory post completed; Sales Line has3 fulfilled/2 reserved, with the same-event fulfillment-confirm history; failure occurs at Sales success audit. |
| Shipment snapshot | Real Inventory and Sales apply completed; Issue detail, shipped Line quantity, consumed Allocation/Claim and SKU snapshot exist; failure occurs before the Shipment header becomes SHIPPED. |

Every scenario proves actual `ROLLED_BACK`, all24 business tables identical to the pre-completion snapshot, and the original SHIPPING/version2/pending event retained. Each performs one failed completion, with no retry sweep. Actual counts:1 Node PASS,0 FAIL/SKIP/not-run,3 scenario PASS results, no runner timeout or guard error.

Execution admission SHA `9502f5dcffc7b8be5800885427540cf0585b1373018714e14bbe32a3cb535d9b`; actual-result closure `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/independent-p2-issue-rollback-remaining-three-native-stage-actual-closure-review.json` SHA `9543acb4e5fb94710486cb01d7ab7c1143145607ba019dca0248cf8b1c3a7323`,0 C/H/M. Together with the retained earlier Audit evidence, these cover the four selected fault families; they do not prove arbitrary faults at every statement.

## Three selected fresh guards

The next bounded group passed on the same1542/5f972/7882 source and plan. Private raw result: `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/lookups/selected-fresh-guards-private-2e7b9e217de6/result.json`, SHA `b61e7958a46bd5af9a9fe928de5de66a1d220272c54eb013b6b6dfe6d4f1f44e`; one Node PASS and three ordered JSONL PASS records, no FAIL/SKIP/not-run, timeout or freeze/resource guard error.

- Stale Contact: the genuine persisted Contact was advanced to version2 after Phase A. Actual B rolled back before Inventory post, then complete owner-negative evidence permitted only the exact FAILED/DRAFT version3 transition. The external Contact version2 remains.
- Serial SKU: the genuine persisted Item SKU tracking policy/version changed after Phase A. Actual B rolled back before Inventory post and only the proven failure transition followed; the external Serial policy remains.
- Incompatible Reallocate: one genuine command is refused while the Fulfillment is PICKED and the original Shipment SHIPPING; that command actually rolls back and all24 business tables remain identical. The original completion then commits one Issue and the expected3 consumed/2 remaining counters. This is a sequential PICKED-state refusal, not evidence of a concurrent Reallocate or an isolated SHIPPING interlock.

Admission review SHA `32d7735b4369f0a616ae5322d322b3c0d09997a58e93cb94928675fcc480f26d`; actual component closure `independent-p2-selected-three-fresh-guards-actual-component-closure-review.json`, SHA `9bc81b64679066ddfc1f7f0ea3b51043fa5676de8cb8c67187d2e194e2542b83`,0 C/H/M. All three fixture schemas were cleaned. Existing fixture10s/2-connection limits remain; this is not an HTTP/default20s or non-functional measurement.

## Additional finite native checks

### Concurrent Inventory adjustment

One genuine +1 Inventory Adjustment commits in a distinct transaction after the real owner scope read. The original B uses the stale Balance version and really rolls back on VERSION_CONFLICT. Exactly20 other tables equal the external-commit baseline, with only the prescribed4 local failure tables changing; this preserves the external adjustment and leaves zero Issue. The private high-risk issuer exercises real current DB role/device/token checks, but does not prove HTTP password/signature verification.

Raw `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/lookups/adjustment-fresh-guard-private-db6941119d84/result.json`, SHA `d73654721f4048bce1553eb3415d2e57fa9cc5eb5ba8ba68ede92b4f1a104870`; actual 1 Node PASS/1 scenario PASS,0 FAIL/SKIP/not-run/timeout or guard errors. Independent actual component closure `independent-p2-concurrent-adjustment-fresh-guard-actual-component-closure-review.json`, SHA `45305fbcf06fcbd373f415c4f3023b96c677b1d05952825f28aad5308516bb4c`,0 C/H/M. Original1542/5f972/7882 execution identities and fixture10s/2-connection limits are retained.

### Confirm intent races

Two serial fixtures/four total commands: three startConfirmation calls and one cancelDraft call. Same-event starts retain one operation, original nonce/expiry/hash/attempt1 and one start history/audit; one caller owns the start, the other is read-only pending. In the actual Confirm/Cancel overlap, Confirm wins and Cancel truly rolls back on SHIPMENT_STATE_CONFLICT. Gates prove overlapping genuine RC transactions, not independently observed native lock waits or both possible winners. No PhaseB/Issue and no alternate-winner rerun.

Raw `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/lookups/confirmation-intent-private-6a0bdb8ed711/result.json`, SHA `c560bacaf9281c5249c006911ce0dcfa26c7b2861f3bd736363a32889b9fafac`; actual 1 Node PASS/2 scenario PASS,0 FAIL/SKIP/not-run/timeout or guard errors. Independent actual component closure `independent-p2-confirm-intent-two-fixture-actual-closure-review.json`, SHA `a8e46297cdcdab1df6a77e77827093c0bfc06b7baa5b19e829ad4910f5893692`,0 C/H/M. Original1542/5f972/7882 execution identities and fixture10s/2-connection limits are retained.

### Atomic zero-picked Line

One two-line/two-Balance fixture with original quantities5+2 and genuine picks3+0. A test-owned input adapter configures the real Pick writer and is restored before Confirmation. One B commits one3-unit Issue; positive Control/Claim/Inventory Allocation/Sales mapping reconcile, while the zero-picked owner rows remain exactly unchanged. Both Shipment Line snapshots match native Item SKU/UOM values. One original-event/version start replay leaves all24 facts identical. This variant has only ONE positive Issue bucket; the earlier browser two-positive-bucket evidence remains separate. Replay is an internal public-intent service call, not new HTTP execution.

Raw `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/lookups/confirmation-atomic-zero-private-1833943291f3/result.json`, SHA `81a9f6f90ae04519cc53ae13655b35eedcb70cead68b4bac5c135d8b6d4e0852`; actual 1 Node PASS/1 scenario PASS,0 FAIL/SKIP/not-run/timeout or guard errors. Independent actual component closure `independent-p2-issue-atomic-zero-picked-actual-component-closure-review.json`, SHA `52fb68572dd24deda18a9d2a241288ec8563978a9a73f3aac106b75e822bbeeb`,0 C/H/M. Original1542/5f972/7882 execution identities and fixture10s/2-connection limits are retained.

## Final selected developer groups

### Remaining Lookup child refusals

Two original75B variants, wrong-owner address and removed shipping purpose, each perform one refused target Draft command and zero Confirmation. Actual business transactions roll back with SHIPPING_ADDRESS_UNAVAILABLE; all24 business and3 Customer source tables remain identical. The independently committed number reservation is explicitly outside this comparison. The old stale-version result is reused under its original baseline, not presented as a third current-run scenario.

Raw `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/lookups/lookup-child-remaining-private-a27e0ec31d32/result.json`, SHA `ae00f53fa7f374d073165ea9b6d86357e6fb507fa00bda9403dc4b978e21bc76`; actual1 Node PASS/2 scenario PASS,0 FAIL/SKIP/not-run/timeout or guard errors. Independent actual closure `independent-p2-lookup-child-remaining-two-actual-component-closure-review.json`, SHA `fd8870ade5f3b26f9d22369a1e5a99167216054ec03444e2451a03b74792a8d1`,0 C/H/M. The1542/5f972/7882 identity and existing fixture10s/2-connection limits are retained.

### Terminal journal witnesses and selected headroom

Two remaining terminal-journal fixtures use genuine PhaseA then explicit native terminal fixture seeds, never PhaseB or a new Issue. One SUCCEEDED original event replays SHIPPED version3 after a native later REVERSING version4 state. Another native initial DRAFT4294967293 advances through genuine CONFIRM_START4294967294 to a seeded FAILED/DRAFT4294967295. Two exact terminal CONFIRM_START reads acknowledge genuine native history before narrowly returning missing/copied-wrong-actor response faults; both refuse. One new-event start at the physical UINT32 maximum refuses VERSION_CONFLICT. All24 facts stay identical after each tested read/refusal. These4 reads plus the retained earlier FAILED-after-edit2 reads total the original6 ceiling; the earlier fixture is not rerun. No claim of actual immutable-history corruption, real Reversal, business success/failure reconciliation or every version/headroom branch is made.

Raw `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2-runtime/lookups/terminal-witness-private-05f3fd187470/result.json`, SHA `ef409ed79f647009b35d4b4ec269139f64793093d2842cf5b96bb73b179b8f0c`; actual1 Node PASS/2 scenario PASS,0 FAIL/SKIP/not-run/timeout or guard errors. Independent actual closure `independent-p2-terminal-witness-remaining-two-fixture-actual-closure-review.json`, SHA `fdfc6f9d325636a56478e0aa187b8bd9cc7af7d96978d61a8fd79f2d0c7196f5`,0 C/H/M. The1542/5f972/7882 identity and existing fixture10s/2-connection limits are retained.

### Retained Lookup preparation failure and necessary repair

Original `lookups/lookup-child-remaining-private-4a01309d4943/result.json` remains1 Node FAIL,0 completed scenarios. The Customer purpose snapshot selected a nonexistent `id` column (`ER_BAD_FIELD_ERROR`1054/42S22) before the first target Draft refusal. Real Fulfillment Create/Allocate/Pick fixture setup and synthetic source inserts had already executed; this is not zero product transactions. No timeout or performance failure occurred. The original probe/runner and all raw artifacts are retained under that run. Only the two before/after purpose snapshot sort keys changed to the real composite `address_id,purpose_code`, with no assertion/workload/threshold/product change. Delta admission `independent-p2-lookup-child-composite-orderby-repair-admission-review.json` SHA `b4011ad2e303e24d54d445b790a381e9c0d9f464e4ec4bc4804524b70ba8498f` preceded the one necessary revalidation above. Diagnostic details are `lookup-child-orderby-preparation-failure.json` with the explicit target-attempt versus fixture-setup distinction.

## Owner coordination and remaining work

Inventory's existing handoff is `/Users/sam/.codex/worktrees/inventory-p4-hd220/erp-app/docs/inventory_management/testing/p4_fulfillment_issue_dependency_update.md`. Its consumed ABI is a real `claimFulfillmentBatchInTransaction(tx,{action:"ISSUE",command})`, followed by `postFulfillmentIssueBatchInTransaction(tx,command,preparation)` with the genuine same-transaction opaque preparation. The current design file SHA is `4b3f2efb4f781f6c2ade5aac41b499fcbe3ce034e34805af0e926e2d9dc5a080`; the older whole-document pin is not silently replaced. The owner handoff is not a new test/CI/UAT grant or proof that the local candidate is merged.

Remaining work is the affected functional regression/coverage and exact routine case publication, latest-main/contract reconciliation, trusted exact-blob admission and current-candidate functional CI. The selected native gaps above are no longer pending, but their component proofs do not close the complete P2 delivery gate. Customer/Inventory received the local1542 entry milestone with explicit unmerged/unqualified limits. No draft PR or merge is claimed; all non-functional validation remains after related UAT, with workload and20s safety requirements preserved.

## Actual authority provenance and next integration boundary

The four original actual user decisions (first15 A, remaining22 B, HD026 A, HD027 A) were located read-only in this chat's local session source. The private `p2-actual-authorizations-source-extract.json` SHA `af2f1475a77a08f0be54f2d6e1d3a3f9024267bcbd8b771f4ccfb7e380f996c2` preserves exact user records/timestamps/turn metadata/source line hashes. This is provenance of the original decisions, not a new approval, an administrator digest or a substitute for verifying the accepted final source/workload. The HD026-only extract SHA is `e9f9590d5dac1f9a00ee361210955a670ef45cdf4e7e91d4ff895e551a9e7f73`.

A fresh fetch observes main `cb685ce30efa433fb7a85e668e37175b7cd19c05`; integration is not yet performed. The unpublished HD026 owner addendum draft is private `hd026-owner-publication-proposal.md`, sent under the actual77A coordination grant to PM and the existing Inventory/Sales owner chats. Its initial draft has been tightened to state the actual fixed journal lock order, private LIVE/Recovery capability provenance and known-UNKNOWN whitelist versus propagated native fatal/timeout/abort errors. It has not changed any canonical owner document, consumer pin, DESIGN/PLAN approval or routine CI configuration. Preserve historical approvals and source-specific results when reconciling the resulting baseline; do not manufacture green preflight evidence.
