# DEC-017 — P1 Handler layout / Item search ownership correction

Current status: ADOPTED under actual Sam reply「批准 DEC-017 補正方案（建議）」. Mode IMPLEMENT; both reviewed patches applied. The proposal history below describes its pre-approval state; complete Phase/CI/merge gates remain pending.

Actual separate reviewer `/root/sales_p1_review` requested changes at source `a28bc95a5cf319af5087ffa3bdc6e88a12014f4594b1b6cecb5c354b2109b517` / HEAD `aa044a3db2fee5e0375a37d29c72d310b135fd9d`:

1. `server/test/handlerConventions.test.js` requires a Handler's directory to match its URL prefix. The approved plan nominated `handlers/sales/salesLookupHandlers.js`, but its specified URLs are `/api/v1/sales-lookups/*`. Actual fullserver regression:2177PASS,1FAIL,443 opt-in skips, not PASS. P1 Order Handler paths have the same planning inconsistency; `handlers/sales-orders/**` is already in approved module scope.
2. Design§2.4 forbids Sales directly reading Item tables and already specifies `ItemLookupService.searchForSale()`. The method was left for this lookup slice in TASK009's report. Current Sales query duplicates Item eligibility/count/search before asking the provider for projections. Move the actual search/count/qualification into that existing provider contract; no new API or qualification rule.

Recommended concrete correction:

- Keep current public URLs and all authorization/validation/mandatory tests.
- Move the lookup Handler exports to `server/src/handlers/sales-lookups/salesLookupHandlers.js`; shared non-handler schema remains in `handlers/sales/salesSchemas.js`.
- Align P1's four Order Handler paths with already approved `handlers/sales-orders/**`. Correct future Backorder/Operation/Audit directory labels to their already specified URL prefixes in the layout illustration only; no authority to implement later tasks or add their scope.
- Authorize the minimum shared `server/src/modules/item/ItemLookupService.js` search contract implementation and existing provider tests; Sales delegates and retains named safe consumer projections.
- Rebind new DESIGN/PLAN/SCOPE and unchanged NFR014/015 business-UAT-NA records to the changed canonical baseline, preserving every prior approval/failure. Backup/restore technical obligations, all23 Phase developer suites, currentcandidate CI, actual review and freshmain integration gates remain intact. Existing commit/push/PR/mainmerge/owned synthetic runtime authorization remains intact.
- P1 Channel lookup remains a genuinely authorized empty collection because no initial controlled catalog exists; this was independently accepted as consistent with Design15.2 and does not authorize a P3 catalog or CSV go-live.

Cost/impact: one internal Handler file move and the already designed shared Item search implementation; canonical layout/scope metadata changes. No schema migration, external dependency, privilege change, API rename or lowered gate. Alternative: retain current approved metadata and leave TASK022/P1 unready; do not alter/skip the convention test or bypass the provider boundary.

Reviewable exact proposals (private, synthetic/no credentials):

- Canonical patch `/private/tmp/sales-p1-private/handler-layout-proposal/approved-baseline.patch`, SHA256 `38b6783ed55a7a4174f91bd6bbd37597d52b2c022b61e4a5736054e442a351b9`.
- Complete implementation remediation `/private/tmp/sales-p1-private/handler-layout-proposal/implementation-remediation.patch`, SHA256 `e56185771c6fcb3681178fa5fa4269ebc88f3f47d581a25fa8694cca9f032fc0`.
- Proposed DESIGN `baff3b9767bc0bb3759a6809f451f71135262ac4fda1424a70769688f86b28a1`.
- Proposed PLAN `90eebe7399da98e7dfe691450801d44edd20999c3604b1b19fa58ab099b4736a`.

Human approval is needed because module scope/shared ownership and canonical baseline bindings change. Harness `references/19-state-and-recovery.md`: “Do not rewrite an old approval's hash to make it look current. Obtain a new decision, retain the old record, and explicitly dispose of obsolete evidence.” `references/17-major-impact-human-decision-gate.md` requires a human decision for material module/shared ownership choices; this is not a request to reauthorize commits/PR/merge already granted.

Current developer diagnostics remain private and retained: task022 RED missing service/client method; expandednative missing barcode fixture FK plus the oversized single HTTP scenario hitting unchanged production limiter; repairedfixture + separate real HTTP case18PASS0FAIL0SKIP; focusedunit3/client4/fullclient695/build/lintPASS; actualPlaywright client/lookup1PASS zero JS/console errors or failed requests. Fullserver required failure remains OPEN until layout correction is authorized and verified. These are developer diagnostics, not formal acceptance or mandatory typed Phase evidence.

Independent proposal review history: R1 requested only the future layout-prefix correction; corrected illustration without authorizing later implementation. R2 /root/sales_readiness_review actually APPROVED canonical38b6783e/producte5618577 and new D/P above, independently verified hashes/applycheck/Node parse. No patches applied or SQL executed by reviewer. Human DEC017 question is presented in the current chat and remains unanswered; review is not human approval.

## Actual adoption and mechanical reconciliation

Sam explicitly approved the DEC-017 recommended correction in the current chat. Both exact patches above were applied; subsequent provider unit RED exposed a missing `new_sale` argument to the existing fail-closed error helper, corrected within the approved Item scope (45 focused units PASS). Actual corrected browser client/lookup verification: 1 PASS, no JavaScript/console errors or failed requests.

The original proposal omitted two old manifest source pins and two ledger UAT_NA links. Packet30 explicitly authorized rebinding; mechanical completion updates only those pins to actual approved source bytes and links NFR-014/015 to unique derived records. No classification/reason, technical obligation, scope, command, or acceptance rule changes. All prior approval records and hashes are preserved verbatim. Sam approved DEC-017 rebinding; the agent computed derived DESIGN `d4d43f935cda896d10cc47aa651645d76db0a105ae1f6de41249158892e9993b` / PLAN `af42d241f6c75f6e3114e8737dc835f974daa893f1e2fdb86b2ea1e6fe035c71`; this does not claim Sam separately inspected those derived hashes. Independent delta review remains required.
