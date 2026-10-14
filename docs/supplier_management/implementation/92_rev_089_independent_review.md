# REV-089 — independent review of the TASK-050 for-SKU part

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this code)
- **Baseline commit:** `f661d5825737096e83c7d154e110f9c14c1ecfd7` (PR #218), reviewed as `git diff 692a1d47..f661d582`
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Two Medium findings: M-1 and M-2.

The `STRAIGHT_JOIN` change is correct and safe. On real 100k data it never made a case slower, and it returned identical pages in all 17 cases I ran. The log is low-sensitivity and its counts are right. The changes I am requesting concern the evidence and the benchmark's verdicts:

- the for-SKU-only run records an NFR-001 pass that it never measured (M-1);
- the "worst case" leaves out the most expensive no-search call, and on a rerun its headroom is thinner than the report says (M-2).

## Findings

### M-1: A `--only` run records `nfr001.pass: true` and `ok: true` for operations it never ran

**What is wrong.** `nfr001` is computed over whatever is in `MIX`, so `--only` changes what it means:

```js
const failing = Object.entries(report.operations).filter(...);
report.nfr001 = { ..., failing: ..., pass: failing.length === 0 };
...
report.ok = report.nfr001.pass;
```

`nfr005` correctly reports `null` when no for-SKU operation ran. `nfr001` has no such guard:

- **With `--only=forSku`:** "NFR-001 pass" is asserted from for-SKU operations alone. None of the list, search, detail or write operations were measured.
- **With the full mix:** NFR-001's verdict also includes the five for-SKU (NFR-005) operations.

**Evidence**

- The committed `evidence/20261014-t50-for-sku/load-50-users-for-sku-only.json` has `"nfr001": {"failing": [], "pass": true}` and `"ok": true`. Its `load.mix` holds only the five `forSku.*` operations.
- My rerun (`scratchpad/rev089/bench1-forsku-only.json`) gives the same result: `nfr001.pass: true`, `ok: true`, and only for-SKU operations in the mix.
- The ledger's `next_safe_action` says "NFR-001 and NFR-005 pass over HTTP at pool 10". The mixed run supports that claim, but a reader can also find an NFR-001 pass in the for-SKU-only file.

This is exactly the "reports a pass it did not measure" pattern that the `nfr005` null guard was written to prevent.

**Recommendation**

- Compute `nfr001` over the non-`forSku` operations only.
- Set `nfr001` to `null` when none of them ran, and set `ok` from whichever verdicts are not null.
- Regenerate the for-SKU-only evidence JSON, or add a note to it, so that it no longer claims NFR-001.

### M-2: The "worst case" leaves out the costliest no-search call, and a rerun shows thinner headroom than reported

**What is wrong**

- **`forSku.deepPage` never reaches the deep part of the list.** It requests `page=randomInt(50, 401)`. The hot SKU has about 10,650 active ranked Suppliers (533 pages), so every deep-page request is answered from the head, which costs about 77 ms when idle.
- **The deep pages after the head are the expensive ones.** Those pages come from the rest query (`ORDER BY s.supplier_name, s.id LIMIT … OFFSET <large>`). It is the most expensive no-search call, and REV-087 M-1 listed it as "Hot SKU, last page 179 ms".
- **`PERF-SKU-COLD` is seeded but never requested.**

The report calls the `--only=forSku` run the "worst case" and gives the slowest for-SKU p95 there as 1,467 ms (about 530 ms of headroom under 2 s).

**Evidence**

1. Single calls on `erp_t50` while idle (read-only; `scratchpad/rev089/cases.mjs`, median of 5, PR's SQL):

   | Case | ms |
   | --- | --- |
   | hot p1 | 74 |
   | hot p400 (head, the benchmark's range) | 77 |
   | hot p2000 (rest) | 158 |
   | **hot last page (rest)** | **192** |
   | cold last page | 147 |
   | hot `q=Trading` | 160 |

2. Two benchmarks on a fresh 100k seed in `erp_rev089`, each run after a digest `TRUNCATE`:

   | Run | overall p95 | nameSearch p95 / p99 | deepPage p95 | max | errors |
   | --- | --- | --- | --- | --- | --- |
   | Author, `load-50-users-for-sku-only.json` | 1,300 | 1,467 / 1,644 | 916 | 1,794 | 0 |
   | REV-089 rerun, PR code as is (`bench1-forsku-only.json`) | 1,583 | **1,809 / 2,004** | 1,180 | 2,152 | 0 |
   | REV-089, deepPage moved to pages 600–3,997 (`bench2-forsku-restdeep.json`) | 1,709 | **1,907 / 2,131** | **1,585** | 2,343 | 0 |

   - With deepPage on rest pages, deepPage p95 is 34% higher than on head pages.
   - The rest query becomes the second most expensive statement: 418.7 ms per call, 126,221 rows examined per call.
   - The machine's load average was about 5 during run 1 and 8 to 12 during run 2, so both runs include some noise. The author's environment is not recorded beyond the hardware.

NFR-005 still passed in all three runs. In both of mine the slowest p95 was within about 90 to 190 ms of the 2 s limit, and p99 crossed it.

**Recommendation**

- Make `deepPage` cover pages beyond the head (for example a range across the whole list, or the last page), or add a `forSku.restDeep` case. Consider adding the cold SKU as well.
- Reword the NFR-005 row and the carry-forward:
  - say what the worst case covers;
  - state the headroom as measured. "Passes; slowest p95 1.5 to 1.9 s across runs on this machine" is fairer than a single 1,467 ms figure.
- The fix that would add real headroom is the text-search `COUNT(*)` (about 340 ms per call under load, a scan of 80k rows). Shared with HD-088, it is out of scope here, but it is the next step if NFR-005 needs margin.

### L-1: The seed puts relations on 40% of Suppliers, not the 20% the docs claim, and it is not "the same 100k seed"

**What is wrong**

- **Relation share.** The seed adds hot relations to `id % 5 === 0` and spread relations to `id % 5 === 1`, so 40% of Suppliers have relations. Three places say otherwise:
  - the performance report says "20% of Suppliers have relations (design §11.5)";
  - the carry-forward says "writes Supplier–SKU relations for 20% of Suppliers";
  - the seed's own comment correctly says 「另外每 5 個」("another one in every 5"), but the summary in the docs got this wrong.
- **"There are 120,000 relations over 1,002 SKUs".** The relations span 1,001 SKUs, because the cold SKU has none.
- **"The same 100k seed (`seed-100k.json`)".** This is a new seed in `erp_t50`: 978 heavy Suppliers against 973, and different totals from `20261009-t50-capacity/seed-100k.json`.

**Evidence.** On `erp_t50` and on my fresh `erp_rev089`, `SELECT COUNT(DISTINCT supplier_id) FROM supplier_sku_refs` returns 40000. `COUNT(DISTINCT sku_id)` on `erp_t50` returns 1001.

**Recommendation.** Fix the wording to "40% of Suppliers (20% on the hot SKU and 20% on the spread SKUs)" and to "a fresh 100k seed made with the same generator". The alternative is to change the seed to match §11.5. The hot SKU's 20,000 rows are what drive the worst case, so either choice is fine, but the docs must match the data.

### L-2: "About 13,000 relation rows are read" understates the hot-SKU head with no search

**What is wrong.** "What remains costly" says the hot head reads about 13,000 relation rows. With `STRAIGHT_JOIN` and no search, the plan is `Table scan on y` over the whole relation table (120,000 rows), filtered down to 13,344.

**Evidence**

- My `EXPLAIN ANALYZE` of plan B from `head-join-plan.sql` on `erp_t50` gives `Table scan on y (actual … rows=120000)` → `Filter … rows=13344`.
- The `topStatements` in both the author's for-SKU-only run and mine show the no-search `headTotal` at about 72,000 rows examined per call, averaged over typical and hot calls. About half of those calls have `noIndexUsed` set.

The next bullet in the report does say "the plan scans `supplier_sku_refs`", so this is a precision issue, not a hidden one. It matters at production scale: the scan grows with the whole relation table, not with the SKU.

**Recommendation.** Say "scans all relations (120,000) to find the hot SKU's 13,344 ranked ones". Add a note that the estimate (58k of 117k) is what makes the scan look cheaper than the index, and that the choice should be re-checked once the relation table is much larger.

### L-3: `DIGEST IS NULL` signals that the table is full, not that this run lost statements

**What is wrong**

- **The signal is right but persistent.** When the digest table fills, MySQL folds new digests into a catch-all row with `DIGEST = NULL`, so `DIGEST IS NULL` is the correct signal that the table is full. The row then stays until the table is truncated.
- **The note can be wrong.** `overflowRow: true` and its note ("topStatements is incomplete") appear even when every statement in this run already had its own row and nothing was lost.
- **The flag is read once, after the run.** It describes the whole table, not the measured window.

**Recommendation.** Use the change during the measured window instead:

- either `COUNT_STAR` of the `DIGEST IS NULL` row, read at the start and at the end;
- or `SHOW GLOBAL STATUS LIKE 'Performance_schema_digest_lost'`, read at the same two points.

Report `lostDuringRun` from that change, and keep `overflowRow` as context. There are no false negatives with the current logic: if the table is full, the row exists.

### L-4: The tests for the log and the join hint are thin in places

**Evidence.** I applied each mutant to `SupplierLookupService.js`, ran `node --test test/supplierLookupService.test.js`, and restored the file afterwards:

| Mutant | Result |
| --- | --- |
| `STRAIGHT_JOIN` reverted to `FROM suppliers s JOIN (…) h` | **killed** (17 pass, 1 fail) |
| `searched: true` (constant) | survives |
| `page: 1` (constant) | survives |
| ranking counts taken from `[...head, ...rest]` before de-duplication | survives |

- The only log test uses `q: "x"` and `page` 1, and has no duplicate row between the head and the rest. The REV-087 L-3 case, where the same Supplier appears in both reads, would be counted twice by the last mutant.
- As expected, the integration ordering oracle cannot detect a change in join order, because the semantics are identical. The string assertion is the right and only guard.

**Recommendation.** Add a second log assertion with no search, `page` > 1, and a Supplier that appears in both reads (the existing L-3 fixture). Assert `searched: false`, the page number, and counts taken after de-duplication.

### I-1: The log's volume and correlation

- **Content.** The line holds only numbers and `skuId`: no Supplier IDs, names or query text. That suits §12.3 and §12.4.
- **Size and rate.** In my run each line is about 290 bytes and there is one per lookup. That is about 11 KB/s at the 38/s worst-case rate, or about 0.9 GB/day if sustained, against 30 days of retention.
- **Correlation.** System log entries have no `requestId`, so a line cannot be matched to its request's latency. That is fine for an aggregate proportion.
- **Alternative.** An in-memory counter emitted through the existing `supplier.metrics` job (HD-083 A) would give the §12.4 proportion at a fixed, low volume.
- **Design text.** §12.3's event list does not name `supplier.for_sku.lookup`; it names `supplier.lookup.slow`, which is not implemented.

This is an operations decision; I flag it for the SRE review.

### I-2: The ledger and the report have small stale or wrong details

- **`next_safe_action`** says "Next: full suite, push, PR". The commit that carries it is already in PR #218.
- **"MySQL drove the join from all 80,053 Active Suppliers".** All three evidence files have `data.active = 79,935`, and plan A on `erp_t50` scans 79,935 rows. I could not find where 80,053 came from.
- **The NFR-001 result row** still cites the 2026-10-09 run ("slowest p95 145 ms"). It could cite the final mixed rerun instead: the slowest of the 12 original operations is 127 ms, and the slowest of all 17 is 399 ms.
- **The usage error message** in `benchmarkSupplierManagement.js` does not mention `--only`.
- **The "before" evidence file** (`…-before-straight-join.json`) has no `digestTable` field, so it was produced by an uncommitted earlier version of the script. Its `command` also names the output file `load-50-users-for-sku-only.json`, which suggests it was renamed afterwards. It is worth a sentence in the measurement note.

## What I checked and found sound

- **`STRAIGHT_JOIN` keeps the semantics in every branch.**
  - The head derived table cannot contain duplicates. Without a search, `(supplier_id, sku_id)` is unique; with a search, `UNION` removes duplicates. So the inner join gives the same rows whichever side drives.
  - The same `headFrom` is used for both `headTotal` and the head `SELECT`.
  - Paging, `ORDER BY … s.supplier_name, s.id`, the item-code `IN` list and the rest query are unchanged.
- **Before and after give identical results on 100k real data.** I rewrote the head join back to the base shape and compared full pages (IDs plus `rankReason`) and `total` in 17 cases on `erp_t50`: hot, cold and typical SKUs; first pages, head-deep, boundary, rest-deep and last pages; `q` set to Trading, Kowloon, an exact code, a term with no hits, and Trading on page 100; typical and cold SKUs with a search; and `pageSize=100`. Every page matched.
- **`STRAIGHT_JOIN` made no case slower.**
  - Hot SKU: 2 to 3.4 times faster at p1, p400 and `pageSize=100`, and 1.4 to 2.1 times faster for searches.
  - Rest-deep and last pages: about the same or a little faster.
  - Typical and cold SKUs: unchanged (6 to 151 ms).
  - A cold SKU's head is empty, so it costs almost nothing. A rare-term search on the hot SKU dropped from 194 to 132 ms. The cost is bounded by the size of the head, so a search with few matches cannot regress.
- **The author's head-join plans reproduce.** On `erp_t50`, plans A to D give 103→32.7 ms (no search) and 109→31.5 ms (search). The author's figures (66.6→28.4 and 90.6→27.3) differ in size but show the same direction and the same plan shapes. The 58k estimate against 20k real rows is confirmed.
- **The log's counts are correct.**
  - `rankReason` only returns `exact_match`, `preferred`, `recently_supplied` or `null`, so `reasonCounts` cannot produce `NaN`.
  - In every case, the counts add up to `returned`.
  - `searched` is a boolean and the query text is not logged.
  - `SystemLogger.log` catches write failures, so `void this.logger?.info?.(…)` cannot fail the lookup or leave a promise rejection unhandled.
  - In my run, the live system log showed the expected lines with numbers only.
- **The seed matches the app's own data shapes.**
  - Spread relations use `supplier_item_code = ""` with a `NULL` key, as `SupplierRelationService` writes when there is no code.
  - The hot SKU's codes are `SIC-<id>` with key `sic-<id>`, which matches `itemCodeKey`.
  - The seed refuses a database that is not empty, so explicit IDs are safe.
  - The hot SKU mix is confirmed as 2,029 preferred, 997 stopped and 16,974 alternative, with 13,344 ranked; REV-087 L-4 found no stopped relations on the hot SKU, and this seed has them.
  - On a fresh database the seed finished in 61 s and reported `skuRelations: 120000`.
- **The benchmark operations hit what they claim**, with the exception in M-2: typical means a random 100-relation SKU, hot means page 1, `codeExact` means a real `P50-` Supplier Code, and `nameSearch` means a common name term.
- **Weights and `--only`.**
  - Of the weight of 110, 10 is for-SKU and the 12 earlier operations keep their relative ratios, as stated.
  - "Seven in ten on the hot SKU" holds by weight (7/10) and by sample: 3,162 of 4,557 lookups, 69%.
  - `--only` filters by prefix and fails when nothing matches.
  - `nfr005` is `null` when no for-SKU operation ran, and a for-SKU operation with zero samples counts as failing (`p95 === null`).
  - Cleanup removed what the run created: `createdSuppliers: 0` for read-only runs; I found no leftover role or user rows.
- **The report's numbers match the evidence JSON exactly:**
  - mixed run: overall p95 126.5 → "127 ms", nameSearch 399.1, codeExact 328.7, 91/s;
  - "every operation under 200 ms except the two hot-SKU searches (329 and 399)" is true; the next highest is `list.codeExact` at 127.2;
  - for-SKU only: 1,300.3, nameSearch 1,467.1, 38/s;
  - before the fix: 3,573.3 overall, nameSearch 3,913.9, 16/s, all five operations failing;
  - before-run `topStatements`: about 80k rows examined per call in the search head (80,404 and 80,576);
  - text-search `COUNT(*)`: 300 ms and 80k rows;
  - item-code pre-query: 37 ms;
  - digest table size: 10,000.
- **The tests pass.**
  - `node --test --test-timeout=180000 test/supplierLookupService.test.js test/integration/supplierSkuLookup.integration.test.js`: 24 of 24 pass, including all 6 integration tests (`DB_INTEGRATION_TESTS=1`).
  - The ordering oracle passes, as the carry-forward claims.

**Not verified:**

- the full test suite and CI for PR #218;
- the author's exact machine conditions, so I cannot attribute the gap between 1,300 and 1,583 ms to noise or to anything else;
- the 30.1 against 31.4 ms "forced index" figure;
- the `TRUNCATE` claim for the "before" run.

**Housekeeping:**

- Benchmarks run: 2 (the limit).
- All writes went to `erp_rev089` (seed, two benchmark runs, integration tests). Against `erp_t50` I ran only `SELECT` and `EXPLAIN ANALYZE`, on a `transaction_read_only` session for `cases.mjs`.
- I edited `SupplierLookupService.js` temporarily for the mutants, restored it from a byte-for-byte copy and checked it with `cmp`.
- I deleted my temporary benchmark copy, `server/scripts/rev089RestDeepBenchmark.tmp.js`.
- `git -C /Users/sam/Documents/workspace/erp-rev089 status --porcelain` is empty, and HEAD is still `f661d582`.
- My scripts and outputs are in `<scratchpad>/rev089/`: `cases.mjs`, `cases_t50.jsonl`, `planout2.txt`, `bench1-forsku-only.json`, `bench2-forsku-restdeep.json` and `seed.json`.

## Author's follow-up (HD-100: "全部按建議，修完再review")

Each mechanism was checked before it was fixed:

- the `nfr001` verdict covered whatever was in `MIX`;
- deep pages 50 to 400 lay inside the 525-page head;
- the seed used both `id % 5 == 0` and `id % 5 == 1`, so 40% of Suppliers had relations.

| Finding | Done |
| --- | --- |
| M-1 | `nfr001` now covers only the 12 non-for-SKU operations and `nfr005` only the for-SKU ones. Each is `null` when none of its operations ran, and `ok` is set from the non-null verdicts. The for-SKU-only evidence was regenerated and now shows `nfr001: null`. |
| M-2 | `forSku.deepPage` takes pages from just past the hot SKU's head to the last page, worked out from the data (526 to 3,999 on this seed). `forSku.cold` was added for the cold SKU. Both runs were redone. The NFR-005 row and the carry-forward now say what the worst case covers, and give the headroom as the range across four runs (slowest p95 1.5 to 1.9 s), including your two runs. |
| L-1 | The seed puts relations only on `id % 5 == 0` (20,000 Suppliers, 20%): the hot SKU plus 5 spread SKUs each. The database was reseeded fresh. The docs now say "a fresh 100k seed" and "1,001 SKUs", and note the correction. |
| L-2 | The report now says the no-search head scans the whole `supplier_sku_refs` table, so its cost grows with all relations, and that the plan needs a re-check at production scale. |
| L-3 | `digestTable.lostDuringRun` is the rise in `Performance_schema_digest_lost` during the measured window. The note appears only when it is above 0. Both new runs show 0. |
| L-4 | New unit test with no search, `page` 2 and a Supplier in both reads. Your three surviving mutants now fail: `searched: true`, `page: 1`, and counting before de-duplication. |
| I-1 | Recorded for the SRE review: the volume, the missing `requestId`, and the unimplemented `supplier.lookup.slow` from §12.3. The log is not changed. |
| I-2 | The ledger's next action is corrected. The Active count (79,976 on the new seed) comes from the evidence. The NFR-001 row cites the final mixed rerun (136 ms). The usage text mentions `--only`. The "before" file is described as coming from an earlier, uncommitted benchmark on the 40% seed. |

Final runs on the new seed, over HTTP with pool 10:

- **Mixed:** p95 157 ms; NFR-001 slowest 136 ms; NFR-005 slowest 435 ms.
- **for-SKU only:** p95 1,488 ms; slowest 1,678 ms (p99 1,849 ms).
- Both runs: errors 0, `lostDuringRun` 0.

Re-review requested by the Product Owner.

---

# REV-089 round 2 — re-review of the HD-100 follow-ups

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent, the same reviewer as REV-089; I did not write this code)
- **Baseline commit:** `e7d8949c216ec2fe136e719faf718ee640378692` (PR #218 head), reviewed as `git diff f661d582..e7d8949c -- server docs/supplier_management`, follow-up commits `1180edf2` and `95b0307a`
- **Verdict:** **APPROVED**
- **Open Critical / High:** 0 / 0. There are no new Medium findings; two new Info notes, N-1 and N-2.

Every REV-089 finding is resolved, and I ran the mechanism for each one rather than only reading the diff.

The figures in the docs match the regenerated evidence JSON exactly. I found nothing new that blocks the merge.

The one point worth recording comes from my own worst-case rerun: the slowest p95 reached 1,966 ms, above the documented "1.5 to 1.9 s" range. The instance was carrying load from other schemas during that run. NFR-005 still passed, but the margin is thin (N-1).

## Per-finding status

| Finding | Status | What I verified |
| --- | --- | --- |
| **M-1** `--only` claims NFR-001 | **Resolved** | See [M-1](#m-1) |
| **M-2** worst case missed rest-deep pages; headroom overstated | **Resolved** | See [M-2](#m-2) |
| **L-1** 40% seed, "same seed", 1,002 SKUs | **Resolved** | See [L-1](#l-1) |
| **L-2** "about 13,000 rows read" | **Resolved** | See [L-2](#l-2) |
| **L-3** `DIGEST IS NULL` is a sticky signal | **Resolved** (the mechanism with a full table is not reproduced; see below) | See [L-3](#l-3) |
| **L-4** log tests thin | **Resolved** | See [L-4](#l-4) |
| **I-1** log volume and correlation | **Resolved as recorded** (deferred to the SRE review, as recommended) | See [I-1](#i-1) |
| **I-2** stale or wrong details | **Resolved** | See [I-2](#i-2) |

### M-1

- **The code.** `verdict(pick)` now builds `nfr001` from the non-`forSku` operations and `nfr005` from the `forSku` ones. Each is `null` when none of its operations ran, and `ok = verdicts.every(pass)` over the non-null verdicts.
- **A for-SKU-only run.** My `--only=forSku` run (`rev089/r2-bench1-forsku-only.json`) gives `nfr001: null` and `nfr005: {operations: 6, pass: true}`.
- **A run with no for-SKU operation.** My short `--only=list.default` run (`r2-bench2-list-only.json`) gives `nfr005: null` and `nfr001: {operations: 1, pass: true}`.
- **The evidence.** The committed `load-50-users-for-sku-only.json` now has `nfr001: null`. The mixed run has `nfr001.operations: 12` and `nfr005.operations: 6`.

### M-2

- **Page range.** `deepPage` takes `randomInt(floor(head/20)+2, ceil(active/20)+1)`, worked out from the data.
  - On `erp_t50` the head is 10,496 rows (525 pages; page 525 still holds 16 head rows), so the range is 526 to 3,999. That is the first purely rest page through the last page, as documented.
  - On my reseed the head is 10,674 rows and the range is 535 to 4,004.
- **The rest query is now exercised.** In my run it is the second most expensive statement: 410.8 ms per call and 122,525 rows examined per call, 647 calls.
- **`forSku.cold`** was added, at weight 1, on random pages. Its p95 was 1,477 ms in my run.
- **Headroom.** The docs now give a range ("1.5 to 1.9 s across four runs") instead of a single figure. See N-1 for a fifth run.

### L-1

- **The seed.** Relations go only to `id % 5 == 0`: the hot SKU plus 5 spread SKUs each.
- **`erp_t50` (read-only).** 120,000 relations, 20,000 distinct Suppliers, 0 off the pattern, and 1,001 SKUs. Spread SKUs have 71 to 139 relations each, with an average of 100.
- **My fresh `erp_rev089` seed** (60 s) gives the same: 120000, 20000, 0 and 1001.
- **The docs** now say "a fresh 100k seed" and "1,001 SKUs", and record the correction.

### L-2

- **The wording** now says that the no-search head scans the whole `supplier_sku_refs`, so its cost grows with all relations, and that the plan needs a re-check at scale.
- **The plan on the new seed.** I re-ran `head-join-plan.sql` on the reseeded `erp_t50`. Plan B still shows `Table scan on y (rows=120000)`, and the times are 81.7 → 34.3 ms (no search) and 117 → 41.4 ms (search). The statement holds on the new seed.

### L-3

- **The code.** `lostDuringRun` is the rise in `Performance_schema_digest_lost` between the end of warm-up and the end of the run. The note appears only when it is above 0.
- **The counter exists and moves on this instance.** It read 541,255 before and after my runs; it is cumulative from earlier overflows, and `TRUNCATE` does not reset it. Taking the difference is therefore correct, and both of my runs report `lostDuringRun: 0`.
- **Not verified:** a positive `lostDuringRun` under a full table. Filling the table would have needed server-wide action, which this review's rules do not allow.
- **One caveat.** The counter is global, so statements from other schemas can raise it. That can only over-warn, never hide a loss; see N-2.

### L-4

The new test covers no search, `page: 2` and a Supplier that appears in both the head and the rest. With it, the unit suite passes 19 of 19. I re-ran each mutant against `supplierLookupService.test.js` and restored the file afterwards (checked with `cmp`):

| Mutant | Result |
| --- | --- |
| `searched: true` (constant) | **killed** |
| `page: 1` (constant) | **killed** |
| counting before de-duplication | **killed** |
| `STRAIGHT_JOIN` reverted | **killed** |
| new: `returned` counted before de-duplication | **killed** |

### I-1

The performance report's measurement notes and the carry-forward record:

- the volume of about 290 bytes per lookup, roughly 0.9 GB a day at 38 lookups per second;
- the missing `requestId`;
- the unimplemented `supplier.lookup.slow`.

All three are routed to the SRE review, as I recommended.

### I-2

- **`next_safe_action`** has been updated.
- **"80,053"** is gone from the for-SKU section. The figure that remains at carry-forward line 956 is TASK-040's own baseline, which is correct.
- **The NFR-001 row** now cites the final mixed rerun: 136 ms, from `update` at 135.5.
- **The usage text** mentions `--only`.
- **The "before" file** is described as coming from an uncommitted script version on the 40% seed, and as not a like-for-like baseline.

## New findings

### N-1 (Info): A fifth worst-case run went past the documented headroom range

**What I saw.** My `--only=forSku` run on a fresh 20% seed in `erp_rev089` gave:

- overall p95 1,751 ms;
- **nameSearch p95 1,966 ms**, p99 2,183 ms, max 2,272 ms;
- `codeExact` p95 1,799 ms;
- 0 errors; NFR-005 passed.

The machine's load average rose from 4.7 to 12.4 during the run. The digest table also held 1,056 to 1,245 digests from other schemas (`erp_t50i`, `item_recovery_it_*`), against 45 in the author's run. So other work was hitting the same MySQL instance at the same time.

The documented range "1.5 to 1.9 s across four runs" is accurate for the runs it lists. It also mixes configurations:

- the author's 1,467 ms run used the old mix on the 40% seed;
- my 1,907 ms run used rest-deep pages on the 40% seed, with no cold SKU.

**Recommendation (optional).**

- Widen the range to "1.5 to 2.0 s across five runs", or note that p99 exceeded 2 s in three of them.
- Keep the existing sentence that capacity planning should use the range.
- The text-search `COUNT(*)` (about 344 ms per call under load) remains the lever if NFR-005 needs real margin.

This does not block the merge: the NFR passed in every run.

### N-2 (Info): A partial `--only` run still reports a pass, and the digest-loss counter is global

- **Partial runs.** `--only=list.default` yields `nfr001: {operations: 1, pass: true}`, a pass based on 1 of 12 operations. The `operations` count discloses this, so it is not the M-1 defect. Optional: mark the verdict as partial when `operations` is below the full set.
- **The digest counter.** `Performance_schema_digest_lost` counts statements from every schema and session on the instance, including the benchmark's own `SHOW GLOBAL STATUS` sampling. On a shared instance with a full digest table, the note could appear while this schema's statements were fully attributed. That errs in the safe direction, and no change is needed.

## What I checked

- **The diff.** I read `git diff f661d582..e7d8949c` for `server/` and `docs/supplier_management/`, and ignored the Item merge.
- **The committed REV-089 report.** `92_rev_089_independent_review.md` matches my round-1 report word for word, apart from the scratchpad path being shortened to `<scratchpad>`. The author's follow-up table describes the changes accurately.
- **The docs against the evidence JSON. Every figure matches:**
  - **Mixed run:** overall p95 156.9 → 157 ms; `update` 135.5 → 136 ms; nameSearch 434.6 and 498.2 → 435 and 498 ms; cold 304.7 → 305 ms; 90/s.
  - **for-SKU only:** 1,487.8 → 1,488 ms; nameSearch 1,678.2 and 1,848.8 → 1,678 and 1,849 ms; 33/s.
  - **Both runs:** `lostDuringRun` 0, errors 0.
  - **Data:** active 79,976; hot SKU 1,974 preferred, 1,057 stopped, 16,969 alternative; head 10,496 = 525 pages; range 526 to 3,999; weight 111; 18 operations.
  - **Seed:** `seed-100k.json`, skuRelations 120,000.
  - **Head-join reproduction:** "103 → 33" and "109 → 32" match my round-1 figures. I re-ran the plans on the new seed: 81.7 → 34.3 and 117 → 41.4.
- **Stale figures.** Searching the performance report and the carry-forward for 110, "five for-SKU", "seven in ten", 13,000 and 1,002 found nothing outdated.
- **New code, edge cases.**
  - When the head is a multiple of 20, the first deep page is one later than it could be: harmless.
  - `ok` is `false` only if both verdicts are null, which cannot happen because `MIX` is never empty.
  - Seeded spread relations now all belong to Suppliers that also have a hot relation. That is harmless for these measurements.
- **Tests.**
  - `node --test test/supplierLookupService.test.js`: 19 of 19 pass, with the mutants listed above.
  - The integration test file did not change in this diff, and I did not re-run it, because `erp_rev089` now holds the 100k seed.
- **Benchmarks.** I ran two on `erp_rev089`:
  - a full `--only=forSku` run, after a digest `TRUNCATE`;
  - a 5-second `--only=list.default` run with 2 users, to exercise the `nfr005: null` path.
- **Cleanup.** No `perf50-` roles or users and no `p50w-` Suppliers are left.

**Not verified:**

- the CI result for PR #218;
- a positive `lostDuringRun` under a full table;
- the load averages stated for the author's runs, which the evidence JSON does not record;
- the forced-index figures of 30.1 and 31.4 ms.

**Housekeeping:**

- All writes went only to `erp_rev089`; I ran only reads and `EXPLAIN ANALYZE` against `erp_t50`.
- I restored `SupplierLookupService.js` after the mutants and checked it with `cmp`.
- `git -C /Users/sam/Documents/workspace/erp-rev089 status --porcelain` is empty, and HEAD is `e7d8949c`.
- The outputs are in `<scratchpad>/rev089/`: `r2-bench1-forsku-only.json`, `r2-bench2-list-only.json`, `seed2.json` and `planout_r2.txt`.

### Author's note on round 2

- **N-1.** The headroom is now stated as "five runs, slowest p95 1.5 to 2.0 s, p99 over 2 s in three", and each run's seed and mix is listed.
- **N-2.** Not changed. The `operations` count already shows how complete a verdict is, and the digest counter can over-warn but cannot hide a loss.
