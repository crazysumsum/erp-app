# Supplier Management — REV-009 Independent Review of PR #107

## Decision

`CHANGES_REQUESTED`

| Severity | Open findings |
| --- | ---: |
| Critical | 0 |
| High | 1 |
| Medium | 1 |
| Low | 1 |

**The pin refresh itself is safe.** The reviewer confirmed the central question and established it more strongly than the author had. What it requests changes on is the permanent state record: an incomplete disclosure and a factually wrong defect description — both authored errors, both corrected below.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer` — a fresh separate-agent instance, not the one that produced REV-007/REV-008 |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Reviewed candidate | PR #107 head `b0855a8` on `codex/supplier-contract-pin` |
| Design baseline under review | `2dc22f70754ee9fe3f880cec40b2408c2c7cd3c3dcf48875f1a856a3d3138743` |
| Authorization | User message on 2026-09-16: 派 reviewer 審 #107 |

## Central question — answered: the pin refresh is safe

The reviewer verified every claim the author made, by content rather than by assertion, and added decisive evidence the author had not offered:

- `5c193e20…` is genuinely the current sha256 of the Item spec at HEAD, worktree and `main`; `6a01476b…` confirmed at `b3e5aa9`.
- All 17 diff hunks re-derived independently. All fall under the author's five bullets.
- §5.8, §8.3, `DES-010` and §5.14 each hashed old-vs-new by extracted line range — **all four identical**. §5.14 is `9cdbc681…` on both sides, line 629 → 650.
- **`git grep` over `server/src/modules/supplier/`: zero cross-module imports to Item.** Only `businessMaster`, `mysqldatabase`, `logging`, `time`. No `item.view` / `item.mgmt`, no `item_skus` / `item_sku_uoms` SQL.
- **PR #105 touched no Supplier file**, and `server/src/modules/item/ItemLookupService.js` — the implementation behind §8.3 — is byte-unchanged and still pins OK in four other modules' manifests.
- Baseline math independently recomputed: `2dc22f70…` / `14cb9ebc…` match the recorded values exactly; against `main` it computes the old pair, confirming the transition.
- State edits are purely additive: approvals 19 → 21, reviews 8 → 8 unchanged, nothing removed or mutated. `REV-008` intact at `dcb74d3c`.

## HIGH — the disclosure was incomplete: two risk approvals were silently invalidated

The PR body and `next_safe_action` disclosed that `REV-008` is stranded on the old design baseline, and presented that as the complete consequence. **It was not.**

The manifest feeds the PLAN digest too, so moving the plan baseline `d54764e4` → `14cb9ebc` also invalidated two RISK approvals that were never superseded:

| Approval | Bound to | After the refresh |
| --- | --- | --- |
| `APPROVAL-HD-009-DESIGN` | `dcb74d3c` | superseded by `HD-014-DESIGN` ✓ |
| `APPROVAL-HD-010-PLAN` | `d54764e4` | superseded by `HD-014-PLAN` ✓ |
| **`APPROVAL-HD-012-RISK`** | `d54764e4` | **stale, not superseded** |
| **`APPROVAL-HD-013-RISK`** | `d54764e4` | **stale, not superseded** |

Those two are the sole authorization for eight deferred defects: `DEF-003`…`DEF-008` under HD-012, and `DEF-010`, `DEF-011` under HD-013. `harness_core.py:330-332` rejects any approval whose `baseline_sha256` differs from the current baseline, and `harness_checks.py:271` consults exactly these through `risk_approval_id`.

**Author verification.** Confirmed by executing `approval_valid()` against the worktree — all eight deferrals now return `valid: False`:

```
APPROVAL-HD-012-RISK: bound=d54764e4e3b4  valid=False
APPROVAL-HD-013-RISK: bound=d54764e4e3b4  valid=False
DEF-003 … DEF-008 -> APPROVAL-HD-012-RISK | valid: False
DEF-010, DEF-011  -> APPROVAL-HD-013-RISK | valid: False
```

Nothing blocks today, because the `BLOCKING_DEFECT` gate fires only on CRITICAL/HIGH and all eight are MEDIUM/LOW. But the module now carries eight deferrals with no valid authorization behind them. If any is ever re-rated — `DEF-004` (SupplierReferenceService fail-open with no checkers registered) and `DEF-005` (address normalization missing length and control-character validation) are the plausible candidates — PHASE-002's gate would block on a deferral a human *did* approve, with no record left explaining why it stopped counting.

Per the harness rule that an old approval's hash must never be rewritten to look current, this cannot be fixed by editing HD-012 or HD-013. It needs a **new human decision** re-affirming the eight deferrals against plan baseline `14cb9ebc`, with the original records retained. Raised as `HD-015`.

### Author-found addition

While verifying the above, the author noticed something the reviewer did not flag: **`DEF-012` is `DEFERRED` with `risk_approval_id: null`** — a deferral with no risk approval at all, not merely a stale one. It does not block today for the same severity reason, but it is an unauthorized deferral in the permanent record. Folded into `HD-015`.

## MEDIUM — `DEF-013` was factually wrong on two counts

As recorded, `DEF-013` claimed: *"deleting a UOM or SKU referenced only by a Supplier relation would not be protected."* Both halves are wrong.

**(a) "would not be protected" is wrong.** Supplier design §5.11 declares `supplier_sku_refs.sku_id` as `FK item_skus RESTRICT`. The database blocks the delete. What is actually missing is the *mapping* of that FK failure to a documented public error: `skuReferenced()` and `itemReferenced()` at `server/src/modules/item/itemErrors.js:293,301` have **no callers anywhere in `server/src`**, so the delete would surface as an unmapped driver error rather than `SKU_REFERENCED`. Different defect, different fix.

**Author verification:** §5.11 confirmed to read `FK item_skus RESTRICT`; `grep -rn "skuReferenced\|itemReferenced" server/src/` returns only the two definitions and zero call sites.

**(b) "deleting a UOM" is wrong.** `supplier_sku_refs` never references `item_uoms`. Its only Item references are `sku_id` → `item_skus` and the composite FK `(purchase_sku_uom_id, sku_id)` → `item_sku_uoms`. `ItemCatalogService.#describeUomReferences` already queries `item_sku_uoms` and reports `sku_uoms`, so the UOM catalog path is correct and needs no change.

**Author verification:** §5.11's full column list and constraint line confirm no `item_uoms` reference.

**(c) The path `DEF-013` omitted is the one that matters:** deleting a single `item_sku_uoms` row while a `supplier_sku_refs.purchase_sku_uom_id` points at it. That composite-FK RESTRICT has no description path at all.

**(d) Provenance was also wrong.** Item §8.4 — unchanged by this diff — already prescribes the remedy: FK RESTRICT, then `ItemReferenceService.describeSkuReferences()`, then a real MySQL integration test, on first real reference. `DEF-013` is a pre-existing §8.4 obligation that the `referenceTypes` change made visible, not something PR #105 introduced, as the author's "now enumerates … but does not know about" wording implied.

This matters because `DEF-013` is the durable record `TASK-038` will work from. As written it pointed the implementer at the wrong code.

### Corrected `DEF-013`

> Item §8.4 requires that a first real external reference to a SKU be protected by FK RESTRICT **and** described through `ItemReferenceService.describeSkuReferences()`, mapped to the documented `SKU_REFERENCED` public error. `skuReferenced()` and `itemReferenced()` (`server/src/modules/item/itemErrors.js:293,301`) exist but have no callers. When Supplier creates `supplier_sku_refs` (design §5.11) with `sku_id` → `item_skus` RESTRICT and composite `(purchase_sku_uom_id, sku_id)` → `item_sku_uoms`, deleting a referenced `item_skus` row — or a referenced single `item_sku_uoms` row, which has no description path at all — will be correctly blocked by the database but surface as an unmapped driver error instead of `SKU_REFERENCED`. Pre-existing §8.4 obligation, made visible by the `referenceTypes` change; not introduced by PR #105.

`source_ids` corrected to point at §8.4, `itemErrors.js:293`, and Supplier §5.11 instead of Item §5.5.

**Deferring to `TASK-038` remains correct.** The reviewer verified that Supplier §5.11 holds T38 `BLOCKED` until Item §5.14's provisional name is aligned in an approved cross-module change, and the guard cannot be written before `supplier_sku_refs` exists. It cannot be silently skipped.

## LOW — `DEF-013` routing is inconsistent with `DEF-012`

`DEF-012`, also an Item-module fix, was explicitly routed to a separate Item Management task under the HD-013 answer. `DEF-013` likewise needs an Item-module code change — `describeSkuReferences()` under `server/src/modules/item/` — but is assigned to Supplier's `TASK-038`. Defensible, since the guard and the migration should land together, but the record must state that **T38 now contains a cross-module Item edit**, or T38 will block on work nobody scheduled. Recorded.

## Nits

- `next_safe_action` said "Next: push this pin-refresh branch and open a PR" — already done. Corrected.
- Out of scope, flagged for awareness: `docs/purchasing_receiving_management/00_module_manifest.json` pins `supplier-purchasing-contract` at `983f351f…` while Supplier's spec is `a9f64493…` — **Supplier's own provided contract has drifted for its downstream consumer.** `permission-catalogue` is drifted in four manifests. Neither is in this PR's scope; both are now on the record.

## What the reviewer credited

The §5.14 and DES-010 claims held under byte-level checking, which is unusual for a claim phrased as "byte-identical". The author correctly identified the permission change as the one genuinely risky item in the diff and grounded its dismissal in the spec's own explicit non-extension clause rather than in assumption. The `REV-008` stranding was volunteered rather than hidden.

## Coverage gaps

- The reviewer did not run the application or the test suites — correctly out of scope for two JSON documents, with CI 4/4 green on `b0855a8`.
- It did not independently authenticate the human approvals beyond the recorded quoted messages.
- It did not audit the pre-existing cross-module drifts noted in the nits.
