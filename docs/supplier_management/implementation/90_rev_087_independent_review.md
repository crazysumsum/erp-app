# REV-087 — independent review of TASK-040

- **Reviewer:** `agent-skills:code-reviewer`, a separate agent that did not write this code.
- **Baseline commit:** `3216bb8e10b7ba5eb9f517a90dea6b47e17f7d63` (PR #211), reviewed as `git diff a71f3488..3216bb8e`.
- **Verdict:** **CHANGES_REQUESTED**
  - The query logic is correct. It matched a single-query oracle on the 100k data with 0 mismatches.
  - The changes requested cover one performance claim that is wrong in the ledger and the reports (M-1), and one missing test that SKU-002 explicitly requires (M-2).
- **Open Critical: 0. Open High: 0.** There are 2 Medium, 4 Low and 7 Info findings.

## Findings

### M-1: The NFR-005 claim of "p95 1,097 ms on the same worst case" is not the same worst case, and the benchmark does not use the production pool size

**What is wrong**

The HD-095 `answer_ref` in `00_harness_state.json` says "p95 1,097 ms on the same worst case". The NFR-005 row in `performance_report.md` and the carry-forward ("This is the worst case of SKU-008") make the same claim. The before and after runs used different workloads:

- **The case mix changed.**
  - `before-single-query.txt` ran 6 cases: all hot-SKU cases (page 1, page 200, exact code, item code, name word) plus cold.
  - `after-two-part-read.txt` / `bench.mjs.txt` ran 8 cases. 4 of them are cheap typical or cold cases (6 to 82 ms). The two most expensive hot cases ("hot, name word" and "hot, page 200") were dropped.
  - About half of the "after" 50-user load is therefore cheap calls.
- **The pool is twice the production size.** The benchmark uses its own `mysql2` pool with `connectionLimit: 20`. The production default is `connectionLimit: 10` (`server/config/database.js:25`).
- **Only the service is measured.** The benchmark calls the service in-process. It does not cover HTTP, the JWT/policy check, or `assertActorFresh` (3 more queries). T50's `benchmarkSupplierManagement.js` does measure over HTTP. None of this is disclosed in the NFR-005 row.

**Evidence**

I reran the "before" case mix on the new code. I used the same 50 users, think time 0 to 1 s, 20 s warm-up and 60 s measurement as `bench.mjs.txt`, read-only on `erp_dev`. Scripts are in the scratchpad: `rev087/load.mjs` and `rev087/single.mjs`.

| Run | n | p50 | p95 | p99 | max | errors |
| --- | --- | --- | --- | --- | --- | --- |
| Before mix, pool 20 (same conditions as the "before" run) | 2,053 | 967 | **1,423** | 1,494 | 1,564 | 0 |
| Before mix, pool 10 (production default) | 1,731 | 1,272 | **1,633** | 1,730 | 1,848 | 0 |

All times are in ms. The machine load average was 5 to 25 during the runs, similar to the author's stated 4 to 22.

Single calls (p50 of 10) for cases the "after" file omits:

| Case | p50 |
| --- | --- |
| Hot SKU, `q=Trading` | 156 ms |
| Hot SKU, `q=Trading`, page 100 | 181 ms |
| Hot SKU, rare name (3 hits, the rest walks the whole name index) | 208 ms |
| Hot SKU, last page | 179 ms |
| Cold SKU, last page | 132 ms |

The carry-forward's "61 to 135 ms for the hot SKU" understates the worst single call.

The improvement is real: on the same mix, p95 went from 4,153 to 1,423 ms. NFR-005 probably still passes, but with about 0.4 s of headroom at the production pool size, and it is unmeasured over HTTP.

**Recommendation**

- Correct the HD-095 `answer_ref`, the NFR-005 row and the carry-forward:
  - say that the benchmark is in-process and service-level with pool 20;
  - say that the case mix differs from the "before" run;
  - add the like-for-like figure, or rerun it.
- Have TASK-050's mixed rerun cover this over HTTP at the production pool size, including the hot-SKU name-search and deep-page cases.

### M-2: Tie-breaks inside the head (name, then ID) are untested, so SKU-002's stable-tie requirement is unverified

**What is wrong**

SKU-002 requires "同名tie及lastSupplied時間 … 同值以名稱/ID穩定" (ties on name and last-supplied time; equal values are ordered stably by name and ID). In the head, ties on exact, preferred and last-supplied are broken by `s.supplier_name, s.id` (`SupplierLookupService.js:231-232`). No fixture has two head rows that tie on everything before name, or on name as well:

- the preferred Supplier has no peers;
- `recent` and `older` have different times;
- in the last test, the two exact matches are in the same order by name and by ID.

The oracle test does not cover this either, because its head has no ties.

**Evidence**

I ran mutants against both test files. The script is `rev087/mutate.py`, and the source file was restored after each mutant.

| Mutant | Unit tests | Integration tests |
| --- | --- | --- |
| F: head `ORDER BY …, s.supplier_name, s.id` changed to `…, s.id` | pass | pass |
| H: head `… s.supplier_name, s.id` changed to `… s.supplier_name, s.id DESC` | pass | pass |

Both mutants **survive**.

**Recommendation**

Add two cases to the integration fixture:

- two `preferred` relations with no history, where name order is the reverse of ID order (create "…Kilo" first, then "…India");
- two Suppliers with the same name and the same `last_supplied_at`.

Assert the order in each case. Both mutants should then fail.

### L-1: Excluding an item-code match from the rest is guarded only by SQL text

**What is wrong**

Consider a Supplier whose relation matches `q` exactly by Supplier Item Code but has no other ranking reason (`alternative` with no history, or `stopped`). It belongs only in the head. If the rest query loses `OR r.supplier_item_code_key = ?`, that Supplier is listed twice: once in the head and once in the rest. Only a regex on the SQL string in `supplierLookupService.test.js` catches this.

**Evidence**

I ran mutant A, which drops the item-code term from the rest exclusion and keeps the parameter count:

- unit tests fail (the regex assertion);
- `supplierSkuLookup.integration.test.js` **passes**.

The last integration test has exactly this Supplier (`byItemCode`, stopped). It still passes because `total == headTotal`, so the rest query is never read.

**Recommendation**

Extend that test with one more Supplier that has no relation and whose name matches `q`, so the rest is read. Then assert that the IDs are unique and that `items.length == total`.

### L-2: A control character in `q` returns 500 over HTTP; the Supplier list accepts the same input

**What is wrong**

`forSkuQuery` throws a plain `TypeError` for `\p{Cc}`. The handler's `QUERY` schema does not reject control characters, so the error surfaces as 500 INTERNAL_SERVER_ERROR. The contract says `q` "uses the same text search as the Supplier list", but `/api/v1/suppliers?q=a%01` returns 200.

**Evidence**

I ran a temporary probe test over real HTTP. It was deleted afterwards and the tree is clean.

| Request | Result |
| --- | --- |
| `for-sku/:id?q=a%01` | 500 |
| `for-sku/:id?q=a%7F` | 500 |
| `/api/v1/suppliers?q=a%01` | 200 |

**Recommendation**

Pick one:

- reject control characters in the handler schema (a `pattern` excluding `\p{Cc}`), so the response is 400; or
- drop the check, to match the list; or
- throw a 400 `ApplicationError` instead of a `TypeError`.

### L-3: The head and rest reads take separate snapshots, so a Supplier can be duplicated or lost within one page

**What is wrong**

`listForSku` runs up to 5 separate autocommit statements on the pool: the item-code lookup, `total`, `headTotal`, head and rest. This is deliberate; the unit fake throws on `withTransaction`. Suppose a relation changes from ranked to unranked between the head read and the rest read, and the page spans the boundary. That Supplier then appears in both parts of the same response. A change in the opposite direction drops it from the response.

The Supplier list already has a count-versus-rows skew of this kind. A duplicate inside one response is new with the two-part read.

**Evidence:** This comes from reading the code. **I did not reproduce it.**

**Recommendation**

Either accept and document it (a selector is advisory, and BR-032 re-validates at submit), or remove duplicates by `supplierId` before returning. A consistent-snapshot read transaction would fix it, at the cost of holding a connection.

### L-4: The evidence descriptions do not match the data or the plans

**What is wrong**

- **The hot SKU seed.** `seed.sql` says "HOT SKU: 5% preferred, 5% stopped". Only Suppliers with `id % 5 = 0` get a hot relation, so `id % 20` is never 1 and never stopped. The share of preferred rows is 1 in 4.
  - Actual hot SKU: 5,000 `preferred`, 15,000 `alternative`, **0 `stopped`**.
  - The "about 100 relations each" spread puts every `preferred` relation in 50 SKUs and every `stopped` relation in 50 other SKUs.
  - So the hot-SKU benchmark never exercises a stopped relation.
- **"explain.txt shows no table scan now".** The exact-code and name-word plans contain `Table scan on h` (the materialized UNION derived table). For the hot SKU, that UNION materializes about 26k relation rows on every search request. It is a temporary table, not a base table, but the sentence overstates.

**Evidence:** I ran these read-only queries on `erp_dev`:

- `SELECT sku_id, relationship_status, COUNT(*) … WHERE sku_id IN (1,2,3) GROUP BY 1,2` returned:
  - SKU 1: `alternative` 15000, `preferred` 5000;
  - SKU 3: `alternative` 100.
- A distribution query on SKUs above 2 returned `preferred` 5000 rows in 50 SKUs and `stopped` 5000 rows in 50 SKUs.

**Recommendation:** Correct the seed comment and the carry-forward wording. No code change is needed.

### I-1: The carry-forward's stopped-relation wording is broader than the code

The carry-forward says "A stopped relation never ranks, not even when it has supply history". The code ranks a stopped relation as `exact_match` when `q` equals its Supplier Item Code. That is consistent with HD-094 4A, the integration test asserts it, and `integration_contracts.md` words it correctly. Suggest wording the carry-forward as "never ranks by preferred or by history".

### I-2: The benchmark evidence contains database credentials

`bench.mjs.txt` contains `user: "root", password: "root"` for the local test server. These are test-only credentials, but suggest reading them from the environment, as `env_rev087.sh` does.

### I-3: `listForSku` validates the SKU ID with the Supplier ID helper

`listForSku` validates `skuId` with `requireSupplierId`, so the error message reads "Supplier ID must be a positive safe integer".

Also, `listForSku(sku, null)` passes `forSkuQuery` but then throws an unrelated "Cannot read properties of null" at `options.atMs`. `atMs` is never validated on this path; Item's `assertUsable` receives it as given.

### I-4: The downstream provider now loads the whole admin module

`SupplierLookupService` (the downstream provider contract) now imports `SupplierAdminService.js` for `supplierSearchCondition`. That pulls the approval, audit and duplicate-candidate modules into the provider. There is no cycle; I checked that only `src/index.js` and `SupplierProviderServices.js` import the lookup service. Optional: move `supplierSearchCondition`, and possibly `supplierListQuery`, into a small shared module.

### I-5: The item-code pre-query scans every relation of the SKU

There is no `(sku_id, supplier_item_code_key)` index. `EXPLAIN ANALYZE` on the hot SKU shows 20k index entries read and 8.8 ms per search request. This is acceptable under HD-095 B (no schema change). It is a candidate if T50 shows search-heavy load.

### I-6: A very large `page` returns 500, as it already does on the Supplier list

`?page=99999999999999999999` returns 500 on for-SKU and also on `/api/v1/suppliers`. Not new, but neither handler schema sets a `maximum` on `page`.

### I-7: Unverified claims

- **"23 mutants, all killed".** I could not check this: the evidence has no list of mutants.
- **What I could check:** the two ordering defects do have tests that fail on the earlier code. I confirmed this:
  - `<=>` changed to `=` fails the "among exact matches…" test;
  - swapping in `6023b11f`'s `SupplierLookupService.js` fails 3 of the 5 integration tests.
- **Against the claim:** my mutants F and H (M-2) survive, and mutant A (L-1) is killed only by a SQL string assertion.

## What I checked and found sound

- **Head and rest split.**
  - **Disjoint and complete.** Rest is `match AND NOT COALESCE(ranked(r) OR itemExact(r), FALSE) AND code_key <> key`. That is the exact complement of head membership, because `uq_supplier_sku_refs_supplier_sku (supplier_id, sku_id)` allows at most one `r` per Supplier.
  - **NULL handling is correct.**
    - No relation becomes `COALESCE(NULL, FALSE)`, so the Supplier goes to the rest.
    - A NULL item-code key is never exact.
    - `<=>` is null-safe.
    - `CASE … END DESC` puts NULLs last.
    - `supplier_code_key` is NOT NULL.
  - **Paging.** `restOffset = max(0, offset - headTotal)` and `pageSize - head.length` join the two parts correctly.
- **Count.** It is taken from the Supplier root with no join, so the join cannot inflate it.
- **Oracle on 100k Suppliers (`erp_dev`, read-only).** I compared the two-part read with one LEFT JOIN sorted in the §8.7 order:
  - SKUs: hot (head 11,977), hot with `q=Trading` (head 326), typical SKUs 3 and 4, an all-stopped SKU (10, with and without `q`), and a preferred SKU (19).
  - Pages: page sizes 7, 20 and 100, at page 1, the pages around the head/rest boundary, and the last page.
  - Result: **96 pages, 0 mismatches, and `total` equal every time.** Script: `rev087/oracle.mjs`.
- **SQL parameter order.** I traced every query (item-code lookup, count, head count, head with `exact_rank`, rest), with and without `q`. They match their placeholders.
- **Injection.** Every value is bound. The dynamic SQL is built only from fixed fragments and a `?` list sized from database rows. LIKE escaping reuses `escapeLikeTerm`, and I probed `%` and `_` as inputs.
- **Fail closed (HD-094 3A).** Item's `assertUsable` runs before any Supplier query; the unit test asserts 0 database calls. Over HTTP I confirmed:
  - an unknown SKU returns 404 `SKU_NOT_FOUND`;
  - an inactive SKU returns 409 `SKU_NOT_USABLE`;
  - a SKU with `purchasable = 0` is rejected (service-level test).
- **Authorization (HD-094 1A).**
  - The handler uses `SUPPLIER_VIEW_POLICY` and then `assertActorFresh`.
  - The integration test covers 200 for a viewer, 403 for a user without permission, and `PERMISSION_STALE`.
  - `additionalProperties: false` holds, and `pageSize` 0 or an unknown parameter returns 400.
  - The response schema is closed, and there are no Bank fields.
- **Ordering rules.**
  - A stopped relation never ranks by preferred or history, in the SQL or in `rankReason`.
  - An exact Supplier Code or Item Code ranks first.
  - An Item Code on another SKU does not match.
- **Tests.**
  - `node --test test/supplierLookupService.test.js test/integration/supplierSkuLookup.integration.test.js` on `erp_rev087` passes **20 of 20** (15 unit, 5 integration).
  - Mutant P (preferred ordered after history in the head) is killed.
- **Workspace.** The checkout was restored. `git status --porcelain` is empty at `3216bb8e`, and the temporary probe test file was deleted.
- **Not verified:**
  - full CI or the full server suite;
  - latency over HTTP;
  - the "before" numbers, which come from code no longer in the tree in that form;
  - the 23-mutant claim.

## Author's follow-up (HD-096: "全部按建議，唔使再 review，CI 過就 merge")

Each finding was checked before it was fixed. The pool size of 10 (`server/config/database.js`), the hot SKU's 0 stopped relations, and the 500 from a `TypeError` were all confirmed.

| Finding | Done |
| --- | --- |
| M-1 | The NFR-005 row, the carry-forward and the HD-095 record now say the measurement is in-process and service-level, and give REV-087's like-for-like figures: 1,423 ms with a pool of 20, and 1,633 ms with a pool of 10. The "same worst case" claim is corrected, not deleted. HTTP and the production-pool mixed run stay with TASK-050, and must include the hot-SKU name-search and deep-page cases. `rev087-load.mjs.txt` is in the evidence. |
| M-2 | New integration test: two preferred Suppliers whose name order is the reverse of their ID order, and two Suppliers with the same name and the same last-supplied time. Mutants F and H now fail. |
| L-1 | The exact-group test adds a Supplier that matches by name, so the rest is read. It asserts three items, `total` 3, and that paging 2 at a time yields each Supplier once. Mutant A now fails in the integration tests, not only on the SQL text. |
| L-2 | The handler schema rejects U+0000–U+001F and U+007F–U+009F in `q` (400). Tested over HTTP with `%01`, `%7F` and `%C2%85`. |
| L-3 | The response is de-duplicated by Supplier ID, with a unit test. A Supplier missed in one call is accepted and documented in `integration_contracts.md`. |
| L-4 | Corrected the `seed.sql` comment on the actual hot-SKU mix and the preferred/stopped spread, and the "no table scan" wording, which now mentions the derived table `h`. |
| I-1 | The carry-forward now says a stopped relation never ranks "by being preferred or by its supply history", and can still be an exact match. |
| I-2 | `bench.mjs.txt` reads `DB_USER` and `DB_PASSWORD` from the environment. |
| I-3 | The error now names the SKU ID, and `null` options mean the defaults. Unit test added. |
| I-4, I-5, I-6 | No change; recorded in the carry-forward. |
| I-7 | `evidence/20261013-t40-for-sku/mutation.txt` lists all 29 mutants, including F, H and A, with each change and its failing-test count. Every one fails at least one assertion; none is killed by a timeout. |

Not re-reviewed, by decision (HD-096).
