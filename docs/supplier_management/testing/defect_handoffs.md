# Supplier defects handed to other owners, accepted, or deferred to release (HD-116 A)

- **Decided:** 2026-10-21, by the Product Owner ("A，review 完 CI 過就 merge").
- **Recorded in the ledger:** `HD-116`. The deferrals below are covered by `APPROVAL-HD-116-RISK`, which supersedes `APPROVAL-HD-017-RISK` and `APPROVAL-HD-017-RISK-DEF012` for these defects. Each defect is `DEFERRED` in the ledger, and the ledger is the authority for status.
- **Fixed in the same change:** DEF-003, DEF-005, DEF-006, DEF-010, DEF-024 and DEF-030. See `04_defect_register.md`.

## Deferred to release as known limitations (Supplier-owned)

| Defect | What remains | Why it waits | What would close it |
| --- | --- | --- | --- |
| DEF-004 (MEDIUM) | The reference guards on archive, permanent delete and Supplier Code change register no checkers, so "is this Supplier referenced?" always answers no. | The documents that would reference a Supplier (purchase orders, receipts, payables) belong to modules that do not exist yet. Supplier's own references are enforced by foreign keys. SKU relations, supply events and activation requests use `ON DELETE RESTRICT`. Addresses, contacts, identifiers, bank accounts and name grams are parts of the Supplier and `CASCADE`. | Each downstream module registers a checker when it lands, and a test shows the guard refusing. |
| DEF-016 (MEDIUM) | Status transitions are only guaranteed valid when they go through `#changeStatus`. A future code path that updates `suppliers.status` directly would bypass `LIFECYCLE_ACTIONS`. | Today `suppliers.status` is written in exactly three places: `#changeStatus` for the lifecycle commands, and two in `SupplierApprovalService`: an approval decision moves `pending_approval` to its outcome, and invalidation moves `pending_approval` back to `draft`. Each has its own guard (the expected status or version). No other code writes it. | Funnel the approval writes through the same transition table, or pin the allowed transitions with a test or a database constraint before a fourth writer appears. |
| DEF-007 (LOW) | Updating an address's purposes deletes and re-inserts every purpose row, which resets `created_at` / `created_by` on rows that did not change. | Since HD-112 the audit log records purpose changes before and after, so who changed what is not lost; only the row timestamps are. | Replace only the purposes that changed. |

## Handed to their owners

| Defect | Owner | What it is | Where it was found |
| --- | --- | --- | --- |
| DEF-008 (LOW) | Business Master | `businessMasterFactory.js` relies on an initialisation order it does not assert. It is correct today. | REV-006 (`implementation/02_checkpoint_h_independent_review.md`) |
| DEF-012 (MEDIUM) | Item | `itemCreate.integration.test.js` and Item idempotency share database state, so the test is not isolated. | REV-009 (`implementation/06_rev_009_independent_review.md`) |
| DEF-013 (MEDIUM) | Item | The Item-side occurrence of the domain-conflict mapping (Item design §8.4, `itemErrors.js`). The Supplier side was corrected under TASK-038. | REV-009, REV-013 |
| DEF-017 (MEDIUM) | Item | `itemConcurrency.integration.test.js` "last active" race; it fails intermittently in CI when it shares a database. | REV-027; GitHub Actions run 35295649501 |
| DEF-019 (MEDIUM) | Item | `itemMigrationIdempotency.integration.test.js` cannot share a database with other suites. | REV-029; GitHub Actions run 35316037250 |
| DEF-018 (LOW) | Shared framework UI | `PasswordReasonDialog.vue` behaviour, reproduced through the Supplier settings Playwright spec. | REV-028 (`implementation/24_rev_028_independent_review.md`) |
| DEF-023 (LOW) | Shared framework logging | The request log protects bank plaintext only through the field-name blacklist `redactedFields`. A 5xx captures the full body for 30 days. | TC-074; see `04_defect_register.md` |
| DEF-015 (LOW) | Repository (all modules) | Only the Supplier manifest declares `.gitignore` as approval-required, so any other module that edits it gets an `OUTSIDE_MODULE` finding. | REV-011 |

## Accepted

| Defect | Decision |
| --- | --- |
| DEF-014 (LOW) | Committed evidence under `docs/supplier_management/evidence/` contains absolute local paths, which give away a username and the directory layout but no secret. Rewriting it would break the link between the evidence and the run it records, so it stays as it is. New evidence redacts paths, as the T51 rehearsal log does. |
