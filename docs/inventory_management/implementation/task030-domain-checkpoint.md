# TASK-030 — domain and HTTP approved; DONE locally

## Current disposition — HD111 actual Sam implementation approval

[Final report and unchanged evidence](task030-implementation-review.md): actual Sam 「已審閱，批准 TASK-030」 records HUMAN REV090 / APR149 and closes HD111. Exact sourcefe3130fe/spec/HEAD/patch and eleven native PASS reports verified unchanged;160 refs including failures preserved. TASK030 DONE locally, module IMPLEMENTING; no new source/test execution or publication, no full P3/formal acceptance claim. Historical developer checkpoints below are retained.

## Current checkpoint — HD110 adopted and implementation verified

[Final source, patch, developer evidence and Sam review request](task030-implementation-review.md). Actual HD110 Sam approval adopted DESIGN46841dae / PLAN8ab85d87 and precise shared scope. Current sourcefe3130fe: real API18, MySQL15, P3 unit27, Inventory172, root2151, client706, Transfer component13 and real-API Playwright8 PASS; lint/build and unchanged34 coverage floors PASS, zero skips. The HTTP handler and strict pre-idempotency schema are implemented; its previous intentional RED and REV086 finding are resolved on this new source, not rewritten historically.

160 native refs retain the original143 and all failures/later runs. Owned synthetic runtimes/schema cleanup observed; no shared/production data touched. SELF_REVIEW only for final implementation; HD111 requires actual Sam review before TASK030 DONE. TASK031–034, full-P3/capacity, formal acceptance and publication gates remain unchanged.

## Historical domain-only checkpoint — before HD110 approval

Status: TASK030 IN_PROGRESS, module BLOCKED / resume IMPLEMENTING. Actual Sam A answers HD109; [exact HD110 candidate](task030-input-coercion-proposal.md) now needs independent DESIGN/PLAN and shared-path scope approval. Canonical/source/head and143 evidence refs remain unchanged; no framework source edits or new product tests. Sam's earlier actual 「批准」 adopted HD108: HUMAN REV085, APR138–142, unchanged0064 scope APR140. Initial adopted PLAN_READY passed; current planning gate is blocked by HD110. No later Task, publication or formal acceptance authority was inferred.

## Exact current identity

HEAD 869ac07abdd3879254c351d857be911d71e68b6b; branch codex/inventory-p3-operations; source b87a2df4c0fa3583f20d8d79067600dda0d7c62fd8bde8310dbe25a2a8027c72; DESIGN 3df1df58f07bf46a6cbf0ef5135941cb70293822f8043fdca496d9fc1a36cf2c; PLAN 64ce9971e8f4e9a6170f1c792be23ce7836e3719717985cbd282c335c6bd38f8. Shared checkout and existing dirty P3 work are preserved. Existing0064 remains SHA256 07653bb700a40b026e8bb46b538e0e31b112d6c20010af45b4cc71a6ff7ac143.

## Implemented slice and self-review

InventoryPostingService owns postBinMove / caller-owned postBinMoveInTransaction, delegating feature-specific logic to inventoryBinMovePosting.js. Reuses existing fresh actor lookup, Operation, ordered locks, Item-owned profile and atomic Audit; no alternate writer, DDL, permissions, dependency or generic movement framework. Strict domain input,1–100 submitted lines, source/destination starting versions, explicit expected-absent destination and shared-Bucket agreement are checked. Gross OUT uses only original free stock, not incoming quantities. Balances are read under Control before absent destination upsert; each line stores chained OUT/IN snapshots, FIFO transition and Audit under one group/Operation. All effects and new zero rows roll back together; replay reauthorizes and returns immutable scalar fields.

Codex SELF_REVIEW examined correctness, simplicity, ownership, security and bounded work. Numeric-only public HTTP enforcement remains an unresolved required boundary at HD109, not an approved workaround. No independent implementation review by Sam is recorded. P4 lock signals are explicitly injected, not evidence of a persistent Stocktake workflow. No frontend behavior was changed: Playwright is not applicable to this domain slice, and earlier UI proof is not relabelled as current-source verification.

## Actual developer checks

Initial TDD diagnostic: new domain/route tests failed because postBinMove and the route did not exist; original15 tests passed. Current direct node --test server/test/inventoryPostingService.test.js:19 PASS (7 new Bin Move groups and12 existing groups),0 skipped. npm run lint and git diff --check pass. Direct diagnostics do not substitute for current native whole-branch coverage/build/regression gates.

[Current native MySQL report](../evidence/task030-domain-inventory-p3-movement-database-cdc52dcefa/run.json): exact configured inventory-p3-movement-database command/hash, observed socket-only owned MySQL26.7.0,15/15 PASS,0 FAIL/SKIP/NOT_RUN, source/spec/HEAD unchanged during execution. Coverage: multi-line/mixed-SKU/Lot/status conservation, chained snapshots/immutable movements, present/absent/stale/shared versions, gross OUT/Allocation protection, real Reservation created before natural expiry and conserved afterward, FIFO, normalized replay/revoked domain permission, strict input/ownership/inactive Bin, injected P4 source/destination lock signals, deterministic same-version/destination-creation/Move-vs-Dispatch/Move-vs-Issue races, real all-stage rollback, arithmetic/version exhaustion.

History preserved: [first13 PASS/1 FAIL](../evidence/task030-domain-inventory-p3-movement-database-8244f77a4d/run.json) used JS undefined, which shared context validation rejects as non-JSON before the intended missing-field check. The fixture now actually omits the required field, retaining the same error/zero-effects assertions. [Second14/14 PASS](../evidence/task030-domain-inventory-p3-movement-database-db081e5677/run.json) precedes strengthened real Reservation/mixed-SKU/version coverage and is not current-source proof. All143 native refs, including140 pre-HD108 runs, remain unchanged/indexed; old runs are not rebound to current PLAN/source.

Three exact task-owned schemas, socket-only daemons, roots and loopback leases were cleaned with observed absence/exit checks. Only synthetic disposable data was deleted and is unrecoverable; original logs/native reports remain. No shared/production database was touched.

## Remaining gates

HTTP handler is not implemented; its added contract test intentionally remains RED, so no whole-suite/HTTP-ready claim. HD109 A selects route-only no-coercion; await actual HD110 independent candidate/scope approval before framework edits. Then reconcile approved scope/specs, complete handler/real HTTP tests, rerun applicable current-source/PLAN developer suites/coverage floors/build, and obtain actual Sam independent TASK030 implementation review. TASK031–034 stay PENDING; full-P3/capacity4, CI/PR/merge, formal TC/UAT/business/release gates remain. No stage/commit/push/PR/CI/merge/new-main adoption occurred.
