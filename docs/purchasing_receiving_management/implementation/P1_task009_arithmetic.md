# TASK-009 — Money and Quantity Pure Arithmetic

Delivered on 2026-10-30 against main `68a8d00b` (design `d6103ad1`, plan `24a86ab4`, unchanged). `TC-002`, shared with `TASK-010`.

| File | Contents |
| --- | --- |
| `server/src/modules/purchasing/quantityMath.js` | `parseScaledDecimal` / `formatScaledDecimal` (decimal string ⇄ scaled `BigInt`), `parseQuantity`, `normalizeQuantity`, `toBaseQuantity(quantity, toBaseFactor, { maxBaseQuantity })` |
| `server/src/modules/purchasing/moneyMath.js` | `normalizeUnitPrice`, `lineAmount(orderedQuantity, unitPrice, currencyDecimalPlaces)`, `documentTotal(lineAmounts, currencyDecimalPlaces)`, `formatAmount` |
| `server/src/modules/purchasing/purchasingConstants.js` | Scales and limits bound to the DB columns of §2.8 |
| `server/src/modules/purchasing/purchasingErrors.js` | `purchasingError(code, { field })` over the four §5.7 codes used here |
| `server/test/purchasing/purchasingMoneyMath.test.js`, `purchasingQuantityMath.test.js` | 11 tests |

All arithmetic is decimal string in, scaled `BigInt` throughout, string or safe-integer out. Nothing passes through `Number` multiplication or division.

## Assumptions taken — please confirm or correct

1. **Amounts are emitted at the Currency scale.** `lineAmount` returns `"376.50"` for HKD and `"377"` for JPY, not `"376.5000"`. §2.8 says "API 一律回固定 scale decimal string" without naming the scale. I read it as the Currency scale because a Line Amount is *defined* as rounded to that scale, and §2.8 requires API, CSV and print to share one formatter — printing HKD as `376.5000` would be wrong for users. DB storage is unaffected (`DECIMAL(25,4)` holds either). This is part of `purchasing-receiving-document-contract`, which `accounts-payable` and `reporting` consume, so it is worth a deliberate decision before `TASK-015` exposes it.
2. **Amount overflow uses `PURCHASING_INPUT_INVALID` with `field: "lineAmount"` / `"totalAmount"`.** §5.7 has no code for it. It is reachable: a quantity under the Base cap times a price under `999999999999999.9999` can exceed `DECIMAL(25,4)`'s 21 integer digits. `PURCHASING_QUANTITY_INVALID` would point the client at a quantity field that is itself valid.
3. **Over-limit Base quantity uses `PURCHASING_QUANTITY_INVALID`; a non-integer Base or an invalid factor uses `UOM_CONVERSION_INVALID`.** §5.7 lists both codes for "超上限" without separating them; §2.8 assigns `UOM_CONVERSION_INVALID` specifically to a non-integer product.
4. **Leading zeros are accepted and normalized** (`"0012.50"` → `"12.500000"`). §10.2 lists leading zeros as a test case without saying which way. Integer-digit limits apply to the value, not the digit count, and a 64-character cap stops a long string reaching `BigInt`.
5. **Invalid Currency decimal places and mis-scaled `documentTotal` inputs are `TypeError`, not public errors.** Both come from server-side sources — the Business Master snapshot pinned to 0–4 by `TASK-008`, and `lineAmount`'s own output — so a bad value is a data or programming defect, not user input.

## Deviations from the plan text

- Tests are under `server/test/purchasing/`, not `server/test/` as §10.2 writes: the module's `allowed_write_paths` only permit the subdirectory.
- `purchasingErrors.js` is not in `TASK-009`'s file list but is in §9.2's planned files, and no task creates it. `TASK-009` is the first code to raise a Purchasing error, so it is created here with only the four codes used; later tasks add theirs.
- §10.2 also lists gross / reversed / net / outstanding / over / closed formulas and receipt status derivation under `purchasingQuantityMath.test.js`. `TC-002` and `TASK-009`'s acceptance criteria do not include them, and they are owned by `TASK-028`, `TASK-032` and `TASK-037`. They go into `quantityMath.js` and that test file when those tasks land.
- Sales already has `salesMoneyMath.js` / `salesQuantityMath.js`. Not reused: Sales rounds a line at 4 places and rounds to Currency only for display, whereas Purchasing rounds each line at the Currency scale before summing (§2.8); and Sales is not a contract this module consumes, so importing it would add an unapproved dependency. The same scaled-integer idiom is followed.

## Verification

- 11/11 pass. Every expected value was computed independently with Python `decimal` (`ROUND_HALF_UP`, precision 80) before running; that caught one wrong hand-computed expectation.
- **Mutation sweep 19/19 RED** between a GREEN baseline and a GREEN restore, gated on exit codes, with a skipped mutant counted as a failure: HALF_UP → truncation and → half-down; over-scale fraction accepted; zero quantity accepted; non-integer Base accepted; Base cap off by one; amount, quantity and price digit limits widened; signs accepted; Currency places up to 5; factor ceiling raised; mis-scaled total input accepted; length guard removed; zero cap accepted; line and total overflow unchecked; and **Line Amount and Base quantity recomputed with `Number` floats** — the requirement that nothing goes through `Number` is guarded by tests, not only stated.
- `npm run lint` exit 0. Full server suite: the same 7 environment-only failures as unmodified `origin/main` (missing bank key rings), no new ones; MySQL tests skip locally, the PR's CI is the MySQL run.
