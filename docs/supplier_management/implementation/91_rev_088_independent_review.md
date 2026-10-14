# REV-088 — independent review of TASK-039

- **Reviewer:** `agent-skills:code-reviewer`, run as a separate agent. I did not write this code.
- **Baseline commit:** `e6e07d06874665c1007378a24354f784d3ba0118`. I reviewed `git diff 38326350..e6e07d06`, which has four commits (`f82bb216`, `108a151f`, `8066243c`, `e6e07d06`).
- **Verdict:** CHANGES_REQUESTED
- **Open Critical:** 0. **Open High:** 1 (H-1). **Medium:** 4. **Low:** 3. There are also Info and Nit items.
- **Checkout state:** clean afterwards. `git status --porcelain` printed nothing. I deleted every temporary file and directory, and the test rows in `erp_rev088` were cleaned up (0 left).

## Findings

### H-1: The PR deletes 11 existing Supplier service tests. Without them, removing device signatures or idempotency passes the whole client suite

**What is wrong**

`108a151f` rewrote `client/test/services/supplier.test.js` from scratch. The old file had 11 tests:
- discovery name;
- `create` with `idempotent: true`;
- `checkDuplicates`;
- list mapping;
- `exportCsv` with a password;
- detail and completeness;
- Address, Contact and Identifier routes;
- `update` and the signed `changeCode`;
- the lifecycle commands with `signed: true` for block, unblock and delete.

The new file has only the 3 SKU-relation tests. None of the deleted tests exists anywhere else in `client/test` (checked with grep).

The carry-forward says only "`test/services/supplier.test.js` (3)" and "The full client suite passes: 855 tests". It does not mention that coverage was removed.

**Evidence: mutation run**

The mutant:
- changed `create` to `idempotent: false`;
- removed `signed: true` from `changeCode`, `block`, `unblock` and `delete` in `client/src/services/supplier.js`.

Results:
- Full client suite at `e6e07d06` with the mutant: **109 files, 855 tests, all passed**.
- Negative control. I put the base version of the file (`git show 38326350:client/test/services/supplier.test.js`) next to the suite:
  - with the mutant: **3 failed / 8 passed**. The failures were "creates a supplier with framework idempotency", "signed controlled Code correction" and "lifecycle commands … device-signature levels";
  - without the mutant: 11/11 pass.
- I restored the file afterwards.

**Recommendation**

Restore the 11 base tests and add the 3 new ones to that file instead of replacing it. Then correct the carry-forward test counts.

### M-1: Edit dialog race: a slow SKU lookup from an earlier edit replaces the UOM list in the dialog that is open now

**What is wrong**

`openEdit(row)` (`SupplierSkuRelationsPanel.vue`, around lines 118–138) awaits `searchPurchasableSkus({ q: row.skuCode })`. When it returns, it writes `skuUoms` and `skuNotPurchasable` without checking that the dialog still belongs to `row`.

The service accepts a `signal` parameter, but the panel never passes one. Quasar's own `@filter` path does drop stale responses (`QSelect.js` keeps a `filterId` guard), so the create picker is safe. This hand-written edit path is not.

**Reproduction** (real server and client, `erp_rev088`)

1. Create relations A (`…-AAA`) and B (`…-BBB`).
2. Delay only the lookup whose `q` is A's code, by 3 s.
3. Open edit on A, click 取消, then open edit on B.

Result:
- Before A's response arrived, B's 採購單位 options were `["…-BBB-EB — EachB，基本單位"]`.
- After it arrived, they were `["…-AAA-EA — Each，基本單位"]`. This is SKU A's UOM, and B's own UOM is gone.

`skuNotPurchasable` can be set wrongly the same way. If the user picks A's UOM and saves, the server rejects it with 400 `SUPPLIER_SKU_UOM_INVALID`, so no bad data is written. The dialog is still wrong and confusing.

**Recommendation**

- After the await, return early unless `editing.value === row && dialogOpen.value`.
- Better: pass an `AbortController` signal, which the service already supports, and abort it in `openCreate` and `openEdit` and when the dialog closes.
- Add an e2e or unit test with a delayed first response.

### M-2: After `VERSION_CONFLICT` nothing is re-read, so the next save conflicts again (design §7.4)

**What is wrong**

Design §7.4 says that on `VERSION_CONFLICT` the app should not retry automatically, but should re-read the latest value ("重新讀取最新值") and keep the user's draft for comparison.

The panel keeps the draft but never re-reads. Its message tells the user to close and reload ("請關閉後重新載入再核對"), but:
- closing the dialog does not reload the `DataTable`;
- the panel has no reload control;
- `DataTable` only shows 重試 when the fetch itself fails.

So reopening edit uses the same stale `row.version` and stale values.

**Reproduction** (real backend)

1. Open edit.
2. Bump `version` and set `minimum_order_qty = 99` in the database.
3. Save. This gives the expected conflict banner.
4. Click 取消, reopen edit, and save again.

Result:
- The row after closing still showed MOQ "—".
- The reopened dialog showed MOQ "" instead of 99.
- The second save showed **the same conflict again**.

Only switching tabs (which remounts the panel), changing the search or reloading the page recovers.

The mocked e2e test "a version conflict keeps the dialog…" only checks the first banner, so it cannot see this.

**Recommendation**

- In the conflict branch, call `table.value?.reload()` so that the next edit uses the fresh version. Ideally also show the latest values beside the draft, as §7.4 asks.
- Extend the e2e test: after close and reopen, saving must succeed.

### M-3: The SKU picker shows the English "Request validation failed". This contradicts the claim that `errorMessages.js` needed no change

**What is wrong**

The new picker's query schema allows at most 190 characters and no control characters. The q-select input has no length limit and does not filter control characters. A rejected query comes back as 400 `REQUEST_VALIDATION_FAILED`, with the framework message "Request validation failed". That code is not in `client/src/framework/http/errorMessages.js`, so `filterSkus` puts the English text in the dialog banner.

This breaks the `docs/frontend-design.md` rule (§ around line 245 and the checklist) that errors must not leak English. It also contradicts the HD-098 `answer_ref` and the carry-forward ("every new code … already has a Chinese public message").

**Reproduction** (real backend)

- Typing 191 × "a" into "SKU *" put `["Request validation failed"]` in the banner.
- Filling `"TEA\tX"` (a tab, as in text pasted from a spreadsheet row) did the same.

The banner also stays after a later successful search, because `filterSkus` never clears `errorMessage`.

**Recommendation**

- Cap the picker input at 190 characters and strip or refuse control characters on the client before searching.
- Map `REQUEST_VALIDATION_FAILED` to a Chinese sentence in `errorMessages.js`. HD-098 (5) already approved editing that file.
- Clear the picker error when a later search succeeds.

### M-4: Reactivating a stopped relation keeps an inactive purchase UOM. The decision does not cover this case and no test pins it

**What is wrong**

`update()` checks `requireActiveUom` only when the UOM changes (`rebound`). TASK-038 treats reactivation from `stopped` as "a new purchase target": `requirePurchasable` runs for it. But with an unchanged UOM, the active-UOM check is skipped.

**Evidence** (temporary integration probe on `erp_rev088`, then deleted)

A stopped relation whose UOM had since been deactivated, updated to `preferred` with the same UOM, gave `["ACCEPTED", "preferred", "inactive"]`.

In the browser, a stopped relation with an inactive UOM changed to 首選 and saved. The database showed `relationship_status = preferred` with the inactive mapping still in place.

**Why it matters**

HD-098 (3) says "an update keeping the current (now inactive) UOM is accepted". Read literally, that covers this case. But the decision does not address reactivation, which is the one path the module already treats as a new target. The result is a *preferred* relation that hands Purchasing an inactive purchase UOM.

No test pins this behaviour either way. A mutant `if (rebound || reactivated) requireActiveUom(...)` would pass the TASK-039 tests.

**Recommendation**

- Ask the Product Owner to confirm which behaviour is intended for reactivation. This is not re-litigating (3); the case is simply not addressed there.
- Pin the chosen behaviour with an integration test.
- If reactivation must also require an active UOM, make the UI warn about it.

### L-1: The edit dialog can wrongly say a SKU is not purchasable, because it searches by prefix and reads only the first 20 results

**What is wrong**

`openEdit` calls `searchPurchasableSkus({ q: row.skuCode })` with the default `pageSize` of 20. It then looks for `row.skuId` in that single page.

Item's `searchForPurchase` does a prefix match on `sku_code`, `sku_name` and the item name, ordered by `sku_code`. If more than 20 purchasable SKUs match and sort before the target, the target is not found. The dialog then shows "SKU 目前不可採購…" and offers only the current UOM.

**Reproduction** (real backend)

- Target SKU `…-ZED`, which is purchasable and has the UOMs EA and DZ.
- 21 other SKUs `…-Y00…Y20` whose names start with `…-ZED`.

Result: `falseNotPurchasableHint: 1` and `options: ["…-ZED-EA — Each"]`. The active Dozen UOM could not be chosen.

**Recommendation**

Look the SKU up exactly, for example:
- an optional `skuId` on the Supplier lookup, served by `findById(..., { purpose: "purchase" })`; or
- include `usable` and the full `uoms` in the relation list response, which already reads `purpose: "purchase"`.

A smaller fix is to page until the SKU is found or the codes no longer match.

### L-2: A very large `page` on the picker gives 500

`GET /api/v1/supplier-lookups/skus?page=100000000000000000000` passes the schema, which has `minimum: 1` and no maximum. Item's `searchForPurchase` then throws a `TypeError` (not a safe integer), and the response is **500 `INTERNAL_SERVER_ERROR`** (probe result). A bad request should give 400, not 500.

**Recommendation:** bound `page` in `QUERY`, for example `maximum: 1_000_000`, or translate the `TypeError` to 400.

### L-3: Create checks the SKU and UOM before the Supplier

In `create()` the order is:
1. authorize;
2. `requirePurchasable`;
3. `requireActiveUom`;
4. load the Supplier, which gives 404 if it is missing;
5. the archived check.

Probe results:
- An archived Supplier with an inactive UOM gives `SUPPLIER_SKU_UOM_INACTIVE` instead of `SUPPLIER_SKU_RELATION_NOT_ALLOWED`.
- A Supplier ID that does not exist (999999999) also gives `SUPPLIER_SKU_UOM_INACTIVE` instead of 404.

`update()` checks archived first, so the two paths are inconsistent.

This is **not** an authorization leak. Probes over HTTP:
- a viewer gets 403;
- a stale actor gets `PERMISSION_STALE`;
- only then does a manager get 409.

`supplier.mgmt` is global, and `requirePurchasable` already had this order in TASK-038, so this is low.

**Recommendation:** move both SKU checks after `#supplierForUpdate` and the archived check, so the user sees the most actionable error first.

### I-1: Claims in the docs compared with what I found

| Claim | What I found |
| --- | --- |
| "no horizontal page scroll at 375, 768 and 1440 px" | Confirmed, including 1024, once the page had settled (overflow 0 at every width). Measured straight after resizing from 1280 to 375, I saw an 11–16 px transient overflow while the drawer animated. It did not reproduce after an 800 ms wait or on a fresh load at 375, so I am not reporting it as a defect. |
| "no console errors or warnings" | Confirmed for the happy paths. The only console entries came from the 409 and 400 responses I triggered on purpose. |
| "9 mutants, all killed" | **Unverified** as a set. My H-1 and M-4 mutants show that coverage outside those 9 is weaker than the summary suggests. |
| `errorMessages.js` needed no change | Wrong for the picker (M-3). The business codes (`SUPPLIER_SKU_UOM_INACTIVE`, `SUPPLIER_SKU_UOM_INVALID`, `SKU_NOT_USABLE`, `SKU_NOT_FOUND`, `PERMISSION_STALE`, `VERSION_CONFLICT`) do have Chinese messages. |
| Client tests (3) + (3), suite 855 | The counts are accurate, but the 11 deleted tests are not mentioned (H-1). |

### Nits

- **Wrong decision ID.** The PO decision is HD-098; HD-097 is the pin refresh. These say "HD-097" for the TASK-039 rules:
  - both new integration test titles ("TASK-039 (HD-097): …");
  - the `requireActiveUom` comment in `SupplierRelationService.js`;
  - the doc comment in `listPurchasableSkusHandler.js`.
- **Picker error banner.** `filterSkus` sets `errorMessage` on failure but never clears it on a later success (see M-3).
- **Unused abort support.** `supplier.js` `searchPurchasableSkus` accepts `signal`, but no caller passes one (see M-1).

## What I checked and found sound

**Server: UOM rules** (integration suite 20/20 on `erp_rev088`, plus probes)
- **Create:** an inactive UOM gives 409 `SUPPLIER_SKU_UOM_INACTIVE`. Another SKU's UOM gives 400 `SUPPLIER_SKU_UOM_INVALID`, decided in the app before the foreign key is reached.
- **Update:** keeping the current inactive UOM is accepted (version bumps). Rebinding to an inactive UOM gives 409, and rebinding to an active one succeeds.
- **Clearing the UOM** (`null`) is not treated as a rebind, so no check runs, and all three `purchaseUom*` fields come back `null`.
- **Race between check and write:** the check reads before the transaction, the same accepted limitation as REV-085 L2. Purchasing re-validates when it orders.

**Server: authorization order**
- The picker goes through the framework `supplier.mgmt` policy, then `assertActorFresh`, then Item. Nothing about purchasability is read before authorization.
- In create and update, the purchasability and UOM errors are raised only after `authorize`, matching REV-085 L3.
- HTTP probes: viewer 403, stale `PERMISSION_STALE`, manager 409.

**Server: response schemas**
- The new fields are `required` and nullable, and `additionalProperties: false` is kept.
- The response validator is on outside production, with `removeAdditional: false`.
- The HTTP list with an inactive UOM and an inactive SKU returned 200 with `purchaseUomStatus = inactive` and `skuStatus = inactive`.
- The picker schema matches what the handler maps. `toBaseFactor` is `INT UNSIGNED`, so `integer` is correct.
- Unknown query keys give 400. A blank `q` gives 200.

**Server: list read**
- `findManyByIds(..., { purpose: "purchase" })` still returns non-purchasable SKUs; it only adds `skuUomId`, `uomName` and `status`. So the history rows keep their code and name.

**Client: browser, mocked suite**
- `supplier-sku-relations` passed 5/5 on port 5203, with the output directory redirected to the scratchpad.

**Client: browser, real backend** (ports 3002 and 4175, `erp_rev088`, temporary `client/e2e/rev088-local/`, now deleted)
- Create through the real pickers: the inactive UOM was not offered, and the database row was correct.
- History badges show text ("SKU 已停用（歷史）", "單位已停用", "已停止").
- Badge text is dark (`rgb(29,29,29)`) through the theme override, so contrast is about 6.3:1 on grey and 6.5:1 on green.
- Editing a no-longer-purchasable SKU shows the hint and keeps the UOM.
- Search, the empty state and the advisory wording all work. No "唯一" / "只可向" text appears.
- No page overflow at 375, 768, 1024 or 1440 once settled. The table scrolls inside itself.
- The create dialog fits at 375 (card 327 px wide, no internal overflow).
- No console errors on the happy paths.

**Client: other checks**
- Viewer and archived gating are in the mocked e2e. Suspended and blocked Suppliers stay writable (HD-090).
- The section has a real `h2` heading and the dialog an `h3`. The icon button has an `aria-label`. There is no inline hex.
- MOQ and lead-time validation (fractions, 0, 3651, blank → `null`) is covered by unit and e2e tests.
- `vite build` succeeds (only the usual chunk-size warning).
- The client unit tests `skuRelations.test.js` and `supplier.test.js` pass 6/6.
- The `e2e:mocked` CI step picks the new spec up through `testMatch: "supplier-*.spec.js"`.

**Docs**
- `integration_contracts.md` matches the code for the endpoint, permission, fields, the 409 and 400 split and the "keep is history" rule.
- The ledger entry for HD-098 is consistent with the scope. The design text was not edited, per HD-098 (A).

**Not verified**
- Picker performance at production scale. `searchForPurchase` uses OR prefix `LIKE`s with an `EXISTS` subquery and is owned by Item.
- Screen-reader behaviour beyond the DOM checks above.
- The author's local real-backend evidence, which was not committed.

## Author's follow-up (HD-099: "全部按建議，M-4 揀 A，唔使再 review，CI 過就 merge")

Each mechanism was checked before it was fixed:

- the base file had 11 tests;
- there was no stale-response guard;
- `REQUEST_VALIDATION_FAILED` was not mapped;
- the conflict branch did not reload.

| Finding | Done |
| --- | --- |
| H-1 | Restored all 11 base tests in `client/test/services/supplier.test.js` and appended the 3 SKU-relation tests (14 in all). Your mutant, `signed: true` changed to `false`, now fails the client suite. A memory note records the cause: a `cat >` overwrote the file, and a truncated `ls \| head` had hidden that it existed. |
| M-1 | The edit lookup is aborted (`AbortController`) when the dialog closes and when another edit or a create opens. A response that arrives late is ignored unless it belongs to the row that is open now. New e2e test with a 1.5 s delayed first lookup. It asserts that row B's own UOM (`BTL`) is still offered. Removing both layers fails it; see the carry-forward for why the weaker assertions did not. |
| M-2 | On `VERSION_CONFLICT` the table is re-read and the draft is kept. The message says the list was reloaded. The e2e test now closes the dialog, sees the other user's MOQ (99), reopens, and saves with version 4. |
| M-3 | The picker input has `maxlength="190"`, control characters become spaces before the search, and the picker error is a field error that clears on the next success. `REQUEST_VALIDATION_FAILED` maps to「輸入的資料格式不正確，請檢查後再試」. The e2e test checks that a pasted tab is sent as a space, that 200 characters are sent as 190, and that no English text appears. |
| M-4 | Product Owner chose A. Reactivating a stopped relation needs an active UOM or none (409 otherwise). Staying stopped keeps an inactive UOM. Integration test added. The UI shows a field error and disables 儲存, with an e2e test. |
| L-1 | `skuId` on `GET /api/v1/supplier-lookups/skus` uses `findById(purpose purchase)`. The edit dialog uses it. Integration test with 21 SKUs sharing the prefix. |
| L-2 | `page` has `maximum: 1_000_000`. A huge page gives 400; integration test added. |
| L-3 | Create now checks that the Supplier exists and is not archived before the SKU and UOM checks. Integration test covers an archived Supplier with an inactive UOM, and a missing Supplier. |
| Nits | HD-097 corrected to HD-098 in the test titles and comments. The picker error clears on success. The `signal` is now used. |
| I-1 | The carry-forward's test counts, the `errorMessages.js` statement and the mutation summary are corrected. |

Results after the fixes:

- client vitest: 866 tests;
- Supplier e2e: 42 tests (the SKU-relations spec 8/8, three times in a row);
- integration (relations file and unit): 26 tests;
- mutation: 21 mutants, 20 killed. The survivor removes only one of the two M-1 layers, so the other still protects; removing both is killed;
- lint and build: pass.

Not re-reviewed, by decision (HD-099).
