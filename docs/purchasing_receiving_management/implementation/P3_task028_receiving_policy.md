# TASK-028 implementation note: narrowing of approved design §5.1 and §8.6

**Target path in the repo:** `docs/purchasing_receiving_management/implementation/P3_task028_receiving_policy.md`.
- No receipt pins this path on eb72cb5b. This draft lives in the handoff directory until the TASK-028 change PR commits it.
- That PR is not approved. This draft is part of the written design `TASK028-DESIGN.md`.

## Narrowing of the approved design

- **Approved §5.1 (`03_design_spec.md`) said:** reasons are 5–500 characters after trim (code points), and multi-line text is allowed.
- **Now, for exactly two fields:**
  - `skuExceptionReason` (GR line);
  - `expiryOverrideReason` (GR detail).

  After trim, each must be 5–500 **UTF-8 bytes** and contain no code point ≤ 31 and no 127 (so no tab, LF or CR). Otherwise the result is `PURCHASING_INPUT_INVALID`.
- Every other Purchasing reason keeps §5.1.
- **Why:** both fields are passed to Inventory's merged purchase-receipt contract (`inventoryPurchaseValidation.js`, `text()` with bytes and `inventoryStringHasInvalidCharacters`). A reason accepted under §5.1 could fail at posting.
- **Decision:** TL RULING `.worktrees/tech-lead-handoffs/task028-rulings-20261118/RULING.md`, sha256 `eb0f0f324b9a70579229808cdf456fc581e1d32905ccd192f337b420eb0f16e3` (Q3 = B; C rejected), and the follow-up in agentmsg 9f77aa4e.
- **§8.6 is also narrowed:** `evaluateMinimumLife` takes `businessReceiptDate` and `confirmDate` instead of `receiptDate` (the same RULING, Q1).

## Moved acceptance criterion: invalid Bin (TL RULING Bin section; PM c9f449ec)

- **What moves:** TASK-028's acceptance criterion 1 (`05_development_tasks.md:1712`) includes "無效Bin fail closed". That part moves to TASK-032. The criterion is kept, not deleted.
- **032 must provide:** mapped Inventory posting errors for `WAREHOUSE_INVALID`, `BIN_INVALID` and `BIN_WAREHOUSE_MISMATCH` (AC-026, BR-030), each with a case.
- **029:** gives early feedback only when it has already loaded the bin.
- **Where the record goes:** this note, for now. `05` is listed in the `files` of six receipt JSONs, of which only task025's group fully matches eb72cb5b. It is therefore not edited now.
- The Purchasing design owner writes the consistent text of `05` (and `03` §5.1 and §8.6), with any necessary pin transfer, no later than 029's schema change.

## Other differences from the TASK-028 plan (recorded here, not in `05`)

- `receivingSchemas.js` moves to TASK-029.
- The public error codes and the client `errorMessages.js` entries move to TASK-029.
- `purchasingValidation.test.js` is not edited, because seven receipt JSONs list it. All 31 cases are in one new file.
- The Inventory-bound reason rule changes both bounds: 5–500 UTF-8 bytes after trim. Two CJK characters (6 bytes) become valid, about 166 CJK characters is the maximum, and the value must be a single line.

## Binding conditions (TL 9f77aa4e)

1. `03_design_spec.md` §5.1 and §8.6 are updated at the next planned re-bind, and **no later than the change that implements this rule in 029's schema**. That change re-binds anyway, and design and code must not disagree after it.
2. **Until then, the original §5.1 text must not be used as the basis for widening these two fields.**
3. PM decides when the re-bind happens.
