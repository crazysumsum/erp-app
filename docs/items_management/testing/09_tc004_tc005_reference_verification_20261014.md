# TC-004 / TC-005 — Item reference verification (2026-10-14)

## Scope and readiness

`TEST_AND_VERIFY`, `REPORT_ONLY`; PLAN809f is now explicitly approved (APR-056), but no tests have executed. Scoped execution is **CONDITIONAL** on runtime preflight and the pending equivalent native-command decision; the generic full-module gate remains **BLOCKED**. Sam explicitly authorized ready Item reference branches, keeps authoritative GR branches BLOCKED and formal UAT separate. No product/test/assertion/schema/permission changes or new business acceptance. This is not complete TC-004/TC-005, TASK-043, Technical Acceptance or release approval.

Immutable application baseline: `f94ba467472bcfae851ed6cb2bb077ac67ab8be0` (latest main observed at entry). Item implementation is PR214/main268d6815; current upstream Supplier PR215 is installed. DESIGN `f7431c0934377f3331fd0a537e236eca8044df41f359d36202153803c4aca315`. Proposed PLAN `809f8a15b605975f2db4c94eb641bc6bf6e5e3aaf07ed5938bb8660f9899a8ef`. Source `4b1121c10dd4e05fc2a39305bf5cc262d5f52ae55ac6e8f5bff6852d656bb208`. Original PLAN46dd approvals/history remain preserved, not relabelled. The superseded preparation PLANa3e53f33 had an incorrect proposed min40 leaf count; it was never approved or executed.

The full `item-server-technical` includes migration replay and CREATE/DROP test tables. Those schema effects are outside TEST_AND_VERIFY. The proposed additive optional `item-reference-technical` executes only the existing Item reference file, with min34 actual JUnit leaves and max0 skipped. The historical XML has14 direct+20 nested leaves; Node40 includes six parent containers. This is discovery planning, not current execution credit. All existing suites, required suite lists, thresholds and canonical mandatory TC/UAT flags are unchanged. Its `required_case_ids=[]` deliberately avoids claiming whole canonical TC credit from partial branches; any discovered IDs are suite-local evidence only. Review and actual approval of the new PLAN are required before execution.

## Environment / preconditions

Planned local-only runtime: previously provisioned task-private socket-only MySQL26.7.0, existing schema `erp_item_supplier_c_20261013`, datadir `/private/tmp/erp-item-supplier-c-mysql.vdXM5l`; reuse is not a new migration/DDL authorization. Server is currently stopped. Before execution inspect actual server version, required installed tables/FKs, exclusive ownership and baseline fixture counts. Synthetic per-case random suffixes, `port:0`, task-worktree logs/storage; no production/shared DB or user credential. Owned npm dependencies installed from unchanged lockfile offline, install scripts disabled; Node26.6.0 meets existing probe. No browser/UI run is included; UI/auth portions of the full canonical cases are not certified here.

Approved command (after a frozen command-contract commit and applicable execution-route permission): cwd `server`; `node --test --test-concurrency=1 --import ./test-support/testEnv.js --test-reporter=junit --test-reporter-destination={run_dir}/item-reference-technical.xml test/integration/itemReferenceGuards.integration.test.js`. TECHNICAL then same-scope REGRESSION; do not filter/skip existing source cases. The actual generic PLAN_READY check is BLOCKED solely by known HIGH/OPEN DEF-107, because the runner has no partial-suite gate. Direct execution of the identical command is proposed for explicit human decision HD-012; it would yield real scoped evidence, not a run_check PASS or full gate/TC acceptance. Do not close/downgrade/waive DEF-107 or alter core tools. Preserve actual XML/logs/command metadata locally with artifact SHA256 and case discovery, and inspect SQL fixture cleanup. New raw export, PR or merge is not authorized by prior batch approvals.

## P0 cases defined before execution

Common risk/trace: FR-030/031/034/037/038/043, SEC-008, NFR-006 → DES-003/012/020 → PHASE-006/007/009 → TASK-043/045/047 → canonical TC-004/005. The scoped row IDs below are execution aliases, not new canonical requirements/tests. Each is P0 and initially NOT_RUN; every row uses the unchanged real-DB automation assertions, snapshots and deterministic concurrency markers in `server/test/integration/itemReferenceGuards.integration.test.js`.

| Branch | Canonical TC | Preconditions / synthetic data | Steps | Expected observable/persisted result | Initial / actual status |
|---|---|---|---|---|---|
| REF-01 | TC-004/005 | Inventory/Supplier referenced Draft Item/SKU | deleteItem/deleteSku | 409 actual referenceTypes; complete state/UOM/barcode/version/audit rollback | NOT_RUN |
| REF-02 | TC-005 | Unreferenced Draft aggregate | deleteSku then deleteItem | Deletion succeeds; only successful sku.delete/item.delete audits | NOT_RUN |
| REF-03 | TC-004/005 | Real Sales quotation UOM FK | remove mapping/delete; safe rename | Removal/deletion rejected, safe edit preserves mapping IDs | NOT_RUN |
| REF-04 | TC-004 | Supplier composite mapping; active SKU | cross-owned mapping; safe price edit; incompatible factor/tracking/removal | Composite ownership rejects; stable IDs; incompatible writes/audit roll back | NOT_RUN |
| REF-05 | TC-005 | ISSUED quotation / CONFIRMED order | archive while open, then terminal and archive | Open obligations reject; terminal snapshots stay readable | NOT_RUN |
| REF-06 | TC-005 | Inactive SKU + synthetic Supplier relations/history | single Item/SKU/bulk archive then read | Soft history alone does not block; rows preserved; purchase remains unusable | NOT_RUN |
| REF-07 | TC-004/005 | Real migrated Supplier/Inventory/Sales native FKs | Hide preflight/fallback metadata and attempt deletion/removal | Native FK fires; public409 actual type or unknown; full rollback | NOT_RUN |
| REF-08 | TC-004/005 | Separate concurrent transactions / scheduling markers | Supplier-create/UOM-remove both orders; reference commit during archive; factor/consumer races | Native winner preserved; loser no partial state/audit; current locked conversion | NOT_RUN |
| REF-09 | TC-004 | Barcode references BOX mapping | remove referenced UOM | item_sku_barcodes dependency and full rollback | NOT_RUN |
| REF-10 | TC-005 | Positive/quarantined stock, reservation, DRAFT/IN_TRANSIT Transfer | single/bulk archive; zero/terminal history controls | Live obligations reject atomically; retained zero/terminal history stays readable | NOT_RUN |
| REF-11 | TC-004 | Earlier RR snapshot on current transaction | deactivate/archive and change conversion; locked provider reads | Current Item lifecycle and conversion observed, not stale snapshot | NOT_RUN |
| REF-12 | TC-004 | Actual Inventory receipt consumer, caller-owned transaction | post using locked conversion then intentional rollback | Correct base quantity; no balance after caller rollback; NOT completed Purchasing GR proof | NOT_RUN |
| REF-13 | TC-004 | New event with default unavailable verifier | recordSupply new unique event | 503 SUPPLIER_SUPPLY_SOURCE_UNAVAILABLE; no Item/relation/event/audit writes | NOT_RUN |

Required evidence for every executed row: original JUnit leaf names/results and timestamps, stdout/stderr/run metadata, source/spec/commit hashes, SQL/audit assertions from the unchanged automation and after-run fixture count checks. Group counts are not raw JUnit testcase counts; no execution is claimed by this initial plan. These are direct domain-service/real-DB tests: public error statusCode409 is asserted, but an HTTP response/browser rendering is not exercised. Those other canonical-case surfaces remain NOT_RUN rather than silently covered.

## Blocking / excluded branches

| Branch | Status | Expected / missing dependency | Disposition |
|---|---|---|---|
| GR-01: first completed-GR projection after SKU deactivation/expiry/archive | BLOCKED | Real completed Purchasing document/line must be proven by the production verifier; history only, no Active/preferred/purchase grant | DEF-107 EXTERNAL_DEPENDENCY_ISSUE; no fake verifier/source |
| GR-02: same-source redelivery/idempotency against that completed GR | BLOCKED | Same authoritative source IDs and payload fence; durable exactly-once history | Reopen after GR authority is merged/available |
| GR-03: source-backed reconciliation / delayed first projection | BLOCKED | Real post-commit source and reconciliation caller; not seeded Supplier history | Purchasing/Supplier work is outside Item scope |
| Formal UAT and whole-case browser/auth/other unselected branches | NOT_RUN | Out of this explicitly limited execution | Preserve prior UAT/Recovery waiver and TC016 NOT_RUN; do not promote old results |

Production `SupplierRelationService` still defaults to sourceVerifierUnavailable and no production Purchasing recordSupply caller/verifier exists at entry. Synthetic history and the negative503 case are valid reference/fail-closed fixtures, not positive GR authority.

## Result / gate / preservation

No technical or regression suite has executed yet. Actual independent reviewer /root/item_supplier_handoff_review approved final PLAN809f/source4b112/appf94 preparation with0 actionable findings (REV-039). Sam subsequently approved exact PLAN809f (APR-056), so HD-011 is ANSWERED. This is not an acceptance waiver. HD-012 asks whether to execute the same approved command directly while preserving the observed generic gate BLOCKED; default no test execution pending the answer. TASK047/PHASE009 implementation closeout was observed in PR214 and recovered local journal115; TASK043 stays IN_PROGRESS. Formal result, exact run references/hashes, environment checks, cleanup and execution-evidence review will be appended only after execution. Complete technical acceptance remains BLOCKED; no business/release acceptance is requested. Existing reports and all prior failures/approvals/known evidence pointers remain intact.
