# TASK-008 — Consumer-side Provider Contract Gate

Delivered on 2026-10-30 against main `a4523e52` (design `d6103ad1`, plan `24a86ab4`, unchanged by this pass). Closes `TASK-004` through `TASK-008`.

Suite: `server/test/purchasing/purchasingProviderContract.test.js` — 9 tests, all `TC-011`. It runs in the ordinary `npm test --workspace server` suite and in every CI coverage shard; it needs no MySQL.

## What it pins, and what it deliberately does not

The providers already test their own behaviour, so this suite does **not** re-test it:

| Provider behaviour | Already pinned by |
| --- | --- |
| Supplier non-bank projection, purchase/history purposes, fail-closed inputs, `listForSku` ranking | `server/test/supplierLookupService.test.js` |
| `recordSupply` retry, deadlock and invalid input | `server/test/supplierRelationService.test.js`, `server/test/integration/supplierSkuRelations.integration.test.js` |
| Item committed-receipt warning matrix, serial and missing-SKU rejection, batching (100 IDs → exactly two SELECTs, no N+1) | `server/test/itemLookupService.test.js` TC-019 |
| Inventory purchase receipt ABI, replay, corruption, partial reversal, rollback | `server/test/inventoryPurchaseContract.test.js` and the three `inventoryPurchase*.integration.test.js` |

What it pins is **Purchasing's own assumptions** — the surface `03_design_spec.md` §2.4 names. A provider can change in a way its own tests still accept while Purchasing's assumption silently stops holding; this file is what turns red.

| Test | Purchasing assumption | Why it matters |
| --- | --- | --- |
| Supplier purchase defaults expose exactly the consumed fields | `{supplier, currency, paymentTerm, orderingAddress}`; supplier keys allowlisted; no `bank` anywhere in SQL or result; no `sortOrder` | PO snapshots these; bank data must never reach a PO |
| Purchase defaults carry currency scale and payment term | Real chain Supplier → `BusinessMasterLookupProvider` → `BusinessMasterProvider`, only the repository replaced; `decimalPlaces` 0/2/3/4 arrives unchanged; no internal columns | `TASK-009` rounds per line at the currency scale. Closes `GAP-DES-002` |
| Supplier contract version and purposes | `supplier-core-provider/v1`; `history` returns Blocked suppliers as usable; any third purpose rejected | GR confirm reads current status through `history` (§3.6) |
| Supplier providers fail closed | No Business Master → `BUSINESS_MASTER_NOT_READY` 503; every `*InTransaction` method rejects a non-connection | Submit-time revalidation must not open its own connection |
| `recordSupply` replay and no promotion | Same event → original result, zero writes, zero audit; changed content → `IDEMPOTENCY_CONFLICT`; new relation `alternative`; existing relation's status untouched | GR confirm retries after a lost response must not double-count (§2.4, §258) |
| `recordSupply` fails closed without a source verifier | Default verifier → `SUPPLIER_SUPPLY_SOURCE_UNAVAILABLE` 503, no writes | See the obligation below |
| Item committed-receipt warning vocabulary | Exactly the four codes of §3.6; `usable`/`reasons` stripped | Purchasing branches per code; a fifth code must change Purchasing first |
| Inventory purchase ABI | Both batch methods on the posting service, arity `(transaction, command)`; `findOperationsBySource` present | §8.7 forbids per-detail single posting |
| Inventory permission demands exist | Every permission the receiving path, the expiry override and `InventoryPurchaseService` demand is in `PERMISSION_CATALOGUE` | Exactly the gap that made the receiving provider unreachable before `TASK-003` |

The permission and warning vocabularies are read from provider source text. They are module-private constants, and Purchasing may not edit Inventory or Item files (`HD-007` B); the read detects a rename, it does not replace the providers' behavioural tests.

## Verification

- 9/9 pass; `npm run lint` exit 0.
- **Mutation sweep, 14/14 RED**, each mutating one provider fact, gated on exit codes, with a GREEN baseline row before and a GREEN restored row after: bank column added to `SUPPLIER_SELECT`; Supplier contract bumped to v2; missing Business Master degrades instead of throwing; fifth warning code; batch method renamed; `receiving.operation` renamed; new relation created `preferred`; replay falls through to a write; changed payload accepted as replay; default source verifier made permissive; existing-relation update promotes status; `decimalPlaces` dropped; `decimalPlaces` coerced to 2 (caught only because four scales are exercised); internal column leaked.
- Two defects in the sweep itself were found and fixed during the run: a skipped mutant (non-unique anchor) originally left the sweep at exit 0, and now fails it.
- Full local `npm test --workspace server`: 7 failures in `applicationFactory.test.js` and `shutdownResources.test.js`. The same 7 fail on unmodified `origin/main` `a4523e52` (`SupplierBankCrypto requires both the bankEncryption and bankLookup key rings` — the local environment lacks CI's key-ring variables). 1,105 MySQL-backed tests skip locally; the PR's CI is the MySQL run.

## Obligation recorded — Supplier needs a GR source verifier from Purchasing

`SupplierRelationService` defaults `verifySource` to `sourceVerifierUnavailable`, and nothing in `server/src` wires a real one. So in production `recordSupply` currently always fails closed with `SUPPLIER_SUPPLY_SOURCE_UNAVAILABLE` (503). That is correct by design: Supplier will not record supply from a source it cannot verify. It means the Receiving task that first calls `recordSupply` must also register a verifier that proves the GR and detail exist and are Confirmed. The test above turns green-to-red the day someone makes the default permissive instead.

## Not closed by this pass

- **PHASE-001 itself.** All eight tasks are `DONE`, but the phase has no DEVELOPER run evidence (`evidence_files` is empty) and has not passed `MERGE_READY`.
- **TC-007's GR-side halves.** `TC-007` (real concurrency, failure injection, recovery) is linked to `TASK-008` and to `TASK-032`/`033`/`042`. Its observable conditions — two GRs on one PO Line, a GR staying Draft when a provider is unavailable, no half-successful transaction — need PO/GR tables, which do not exist until `TASK-011`. Nothing about them can be observed in PHASE-001; they are observed with the later tasks that share the case. As linked today, PHASE-001 cannot reach `TECHNICAL_ACCEPTANCE` on its own.
- **HD-006 blocks every gate, not only Go-Live.** Its business impact is cutover, Go-Live and `TASK-044`, but `harness_checks.py` reports any open `MAJOR` decision as `HUMAN_DECISION_REQUIRED` at every gate. Earlier records in this module said it blocks Go-Live only; at the gate level that is not true. PHASE-001 `MERGE_READY` cannot pass until HD-006 is answered or its impact re-scoped.
- **The PHASE-001 checkpoint is stale.** `state/baseline` still carries the 2026-10-22 `worktree`, `code_commit`, `source_fingerprint` and `default_commit` `09281b0a`. `PLAN_READY` does not read them, but `MERGE_READY` does: against `09281b0a` it diffs every other module's change since, which is where its hundreds of `SCOPE_APPROVAL_REQUIRED` and `OUTSIDE_MODULE` findings come from. Closing PHASE-001 needs a fresh checkpoint on a durable worktree, DEVELOPER run evidence, the CI observation and a PR review record.

## Record repair — APR-004 scope entries

Running `MERGE_READY` for PHASE-001 exposed that `approval_valid` (`harness_core.py:343`) treats every entry of a `SCOPE` approval's `scope` that contains a `/` as a path glob, and `glob_match` rejects `:` and `{}`.

- The 2026-10-30 re-confirmation note added in PR #306 contained "items 7/9", so the first path check raised `UNSAFE_PATH` on it — 383 times. Reworded to "items 7 and 9" in all four approvals; meaning unchanged.
- That exposed the older defect underneath: since 2026-10-22, `APR-004` listed its paths with inline annotations — `permissionCatalogue.js (approval_required_path)`, `{roleManagement,…}.integration.test.js (shared, outside module: …)` — so no entry could ever match a real file. `APR-004` has been inert for path approval since it was written.

`APR-004` now lists the same files as bare paths, with the brace pattern expanded into its four files. No path was added or removed. The annotations it used to carry, preserved here:

| Path | Annotation formerly inline |
| --- | --- |
| `server/src/modules/authorization/permissionCatalogue.js` | approval-required path |
| `server/database/migrations/0100_seed_purchasing_permissions.js` | approval-required path |
| `server/test/permissionCatalogueConventions.test.js` | shared, outside the module: the three-step process requires registering the seed migration there |
| `server/test/integration/{roleManagement,userManagement,passwordChange,migrations}.integration.test.js` | shared, outside the module: six ungranted catalogue entries made their admin-claim denylists stale |

Verified by comparison: before the repair `permissionCatalogue.js` produced `UNSAFE_PATH`; after it, no finding — `APR-004` now covers it. The four integration tests and `permissionCatalogueConventions.test.js` are in neither `allowed_write_paths` nor `approval_required_paths`, so no `SCOPE` approval can cover them as the manifest stands; the findings they produce today come from other modules' later edits seen through the stale checkpoint, not from `TASK-003`.
