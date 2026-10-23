# REV-114 — independent review of the Supplier-owned currency and payment-term lookups (DEF-036, HD-126 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-def036-lookups` at `8762a068`, reviewed as `git diff origin/main..HEAD` (base `fd32762f`)
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Two Medium (client test gaps), three Low, eight Info.

## What the reviewer confirmed

- Production code is correct and secure:
  - Exactly `supplier.view`, `jwt` (no password), closed request schemas.
  - The response is limited to the provider's Active projection.
  - 503 when Business Master is not ready.
  - Business Master code is untouched.
- Real backend: a CLERK created a Supplier and opened the edit form. Both forms offered only Active values; seeded Inactive values never appeared; no console errors or failed requests.
- The `SuppliersPage` boundary is right: the list filters need Inactive values, which only the Business Master lists return.
- Mutation sweep: 10 server and 7 client mutants. S10, C4 and C7 survived. C2, C5 and C6 were caught only by Playwright (C2 by its console-404 check).

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: the edit-form path (`SupplierPaymentDefaults.vue`) had no deliberate assertion; C4 (`.rows`) survived everything. | `editor.test.js` opens the editor and asserts that both lookups were called and that the currency and payment-term selects offer exactly the mocked options and values. C2 and C4 are now red in vitest. |
| M-2: the new service methods had no unit test; C7 (payment terms calling the currencies URL) survived. | `supplier.test.js` asserts the exact paths, that no parameters are sent, and that the bare `items` array comes back. C5, C6 and C7 are now red in vitest. |
| L-1: the wiring from handler to the real readiness check was untested; S10 survived. | A unit test builds the real handler over a fake database without HKD and expects 503 `BUSINESS_MASTER_NOT_READY` and no list query. S10 is now red. |
| L-2: design §6 still names the Business Master routes; DEF-036 and HD-126 were not in the module docs on the branch. | DEF-036, HD-126 A and this review are now in the defect register and the ledger. The reviewer also recommended rewriting the two §6 rows. That edit is **not** made here: it moves the design baseline and the provided-contract hash, which every baseline-bound approval refers to. It is raised to the Product Owner. The deviation is recorded in the register, as with HD-067 and HD-094. HD-126 is module-scoped (`supplier-management`), so it does not clash with the Inventory module's HD-126. |
| L-3: a `supplier.mgmt`-only user would still hit the DEF-036 symptom, because the create page needs only `supplier.mgmt`. | No UAT role is mgmt-only, and HD-126 A says `supplier.view`. This is a Product Owner call and is raised with L-2. No change yet. |
| Info: payment-term half of the integration test showed only absence. | The test now seeds an Active term and asserts it is offered, along with its key set. |
| Other Info (100-item cap, missing tables give 500 as in REV-028 M-2, construction style, performance). | No change. The 100-item cap carries a `ponytail:` note. |

## Verification after the fixes

The six mutants that had survived or were caught only by Playwright (S10, C2, C4, C5, C6 and C7) were rerun: every one is now red in the unit suites. Each file was restored from a backup and checked with `cmp`, and the tree was clean afterwards.

All runs are local, not CI:

- Supplier server suite (unit plus integration, real MySQL on erp_t51): 708 passed, 0 skipped.
- Client Supplier suite: 21 files, 184 passed.
- Playwright Supplier suite: 50 passed.
- eslint and the client build: exit 0.
