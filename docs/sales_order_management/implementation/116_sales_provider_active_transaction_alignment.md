# Sales provider alignment with HD-010 active transactions

Status: independently reviewed Sales RC adapter and named P0 supplement delivered. Full TASK-004 / Checkpoint 0B / P4 joint validation, current-candidate CI and merge remain incomplete. No new human decision is pending for this exact supplement.

## Authority and source provenance

Sales and the separate reviewer independently verified Sam's actual HD-010 A answer in the Fulfillment chat, userMessage `01a15c0b-ac09-7b83-9eaf-5a0cb09df591`, question `call_36aefd0cd74c4d45a0ddd22e536f2323`: local READ COMMITTED for new Fulfillment write caller transactions and trustworthy read-only DB-owner metadata, with global defaults, old flows and all Gates preserved. Decision-time proposal SHA256 `500126d7b7a70ac3a4d8131806b6235bd235d98be0b5d7b77f50648bdd32ecb7` remains historical; no old approval hash is rewritten.

The DB owner delivered its R16-reviewed `MySqlDatabaseService.js` at commit `c50ce02ef64e1348e2012f9025b0bdabc327f5f5`, SHA256 `9d01e01f8087023546c586d5ce9840873e5fc2fba21a61a608e0ac46029a121f`. Sales checked that its preceding file exactly matched the owner's baseline and adopted the complete owner bytes without authoring framework changes. The private provenance receipt records this fact. This source adoption does not qualify the complete P0 phase or replace reconciliation of the final P0 main baseline and affected module bindings.

## Material behavior

Both Shipment confirmation and reversal lock entrances now require the DB owner's actual active READ COMMITTED executor after intent normalization and before fresh authentication SQL or any Sales operation claim. Apply checks the same actual metadata before accessing a bound receipt or executing effects; a receipt cannot resurrect a completed or aborted transaction. The existing current-context identity check remains. Fabricated or copied executors and context isolation strings cannot grant authority.

GET and pure CLAIM retain existing REPEATABLE READ compatibility. The native write fixture explicitly requests RC through production `withTransaction`; its RR CLAIM case and default standalone GET still use the existing default. Owned fixture cleanup now attempts pool shutdown, fixture connection close, exclusive schema removal and admin connection close in that order, preserving all cleanup errors in an AggregateError. No shared schema or other runtime is touched.

## Observed developer results

- Targeted unit: 15 PASS / 0 FAIL / 0 SKIP. The real production DB service issues each executor through a fake driver; no caller isolation flag or constructor bypass substitutes for owner metadata. Genuine guard RED-r3 was 13 PASS / 2 FAIL before the Sales change; earlier fake-driver fixture errors remain retained.
- Related Sales plus existing DB unit regression: 124 PASS / 0 FAIL / 0 SKIP (89 Sales, 35 existing DB). The first combined run omitted the repository's testEnv bootstrap and failed JWT configuration; its log is retained. The corrected run uses the repository testEnv import and changes no product configuration.
- Latest native run after cleanup correction: 21 PASS / 0 FAIL / 0 SKIP on owned socket-only MySQL26.7.0, nice10 and serial test concurrency. Fourteen cases including their parent cover actual Sales/Item read, lock, authorization, journal, rollback, RR refusal/compatibility and closed executor behavior. Seven cases including their parent remain explicitly Inventory verifier test-double Sales SQL components. They are not real Inventory qualification or P0/P4 joint Gate evidence.
- Scoped ESLint passed the exact five changed source/test files. Runtime observation verified the owned socket, skip_networking=1 and zero remaining owned `_sf_` nonce schemas.

Private logs: `sales-provider-rc-unit-red-r1.log`, `-red-r2.log`, `-red-r3.log`, `-unit-green-r1.log`, `-related-unit-r1.log`, `-related-unit-r2.log`, `-native-green-r1.log`, `-native-green-r2.log`, `-lint-r2.log`; `sales-provider-rc-r4-reviewer-proof.json` binds their exact names/hashes. No raw evidence or credentials are exported.

## Reviewed consumer handoff and remaining Gate

P0 owner actually applied the original ten-path contribution `fc24110e…` and reported 30 focused cases passing. Its consumer HEAD was `c50ce02e…` with that original patch applied. The new supplement contains only four Sales source/test/fixture paths; before bytes were checked against the actual consumer, and read-only `git apply --check --whitespace=error` exited0. Sales did not write the P0 worktree.

Private supplement `p0-sales-provider-rc-supplement-r2.patch` SHA256 `33bda6b7db27fc474d643d3e6d2f8164819295b10d57c3e754525b3db4e6c449`; manifest SHA256 `ce7cf44c3f5b4f0f9452e43ecaad73c10461a463862c5e262821e743e9628a36`. The DB owner file, P4 Export behavior and catalogue total41 are absent from this four-path patch. Prior contribution/R3 evidence remains unchanged.

Actual separate reviewer `/root/def016_runtime_recovery_review` approved the exact RC adapter and four-file consumer supplement with zero required findings. Proof SHA256 `36ff631a3065e4c7505fa6be08ea5f81cfc199e8f8ef201a1672e17ced91e188` records actual owner source, four-file before/after hashes, raw results and an independent read-only consumer apply check. This is a scoped source/component review, not whole-phase review.

The supplement and review were sent to the authorized Fulfillment owner for exact adoption and current native execution. Real Inventory allocation/candidate/full-capacity checks, all operation preclaims before domain roots, and actual Sales/Inventory/Item caller-chain joint tests remain owner prerequisites. P0 must complete its whole phase, CI, review and merge first; Sales then reconciles canonical histories/bindings, integrates actual fresh main, withdraws the old duplicate0091–0093 installers and finishes the real Archive participant/coordinator plus original full P4 verification, Playwright, current CI, independent phase review and unchanged MERGE_READY. A read-only GitHub query observed no existing PR for the Sales P4 branch at this checkpoint. No CI or main merge is claimed.
