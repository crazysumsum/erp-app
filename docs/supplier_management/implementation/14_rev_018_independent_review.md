# Supplier Management — PHASE-002 TASK-025 REV-017 Remediation Review

## Decision

`CHANGES_REQUESTED` — **0 Critical, 3 High, 4 Medium, 2 Low**

The reviewer ran the one empirical check nobody had been able to run, and it passed: the
behavioural probe really does reject every text-rendering exploit that killed the regex, and
really does accept the correct forms the regex would have blocked. Then it showed the probe
had a false accept of its own, made the committed suite flaky, and — the finding that decided
this round — that **the simpler option was the right one and had not been taken**.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Worktree | `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-phase-002` |
| Branch／PR | `codex/supplier-phase-002` ／ PR #109 |
| Reviewed HEAD | `b39a27f` (diff `6281ef4..b39a27f`), CI 4/4 green |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |

## The empirical result that was outstanding for five rounds

The previous round disclosed, rather than faked, that nobody had shown the probe **rejects** a
divergent table on real MySQL — it needs building one, which is a schema change requiring
sign-off. This reviewer was able to, building and dropping its own probe tables:

| shape | probe verdict |
| --- | --- |
| `IF(status = 'pen\ding', 1, NULL)` — the backslash exploit | **REJECT** |
| `IF(status = 'PENDING', 1, NULL)` — the `ascii_bin` casing hole | **REJECT** |
| `IF(status <> 'pending', 1, NULL)` — the inverse invariant | **REJECT** |
| `CASE WHEN status = 'pending' THEN 1 END` — correct, regex rejected it | **ACCEPT** |
| `IF(status <=> 'pending', 1, NULL)` — correct, regex rejected it | **ACCEPT** |

So the diagnosis behind the redesign was right, and is now established rather than asserted.

## H-2 — and the probe had a false accept of the same class

Both probe rows were written with `supplier_version` hard-coded to `1`, so they differed only
in `status`. A slot generated from any other column is therefore indistinguishable from the
constant `1`:

```
pending_slot AS (IF(status = 'pending', supplier_version, NULL))
  concurrent PENDING rows for one supplier: 3 (non-null slots: 3)  <-- invariant absent
  probe verdict: ACCEPT
```

The regex it replaced rejected that form. One false-accept class was traded for another. With
the slot derived from `requested_at` — which the probe calls `Date.now()` for, separately per
row — 12 runs against one unchanged table split 8 ACCEPT / 4 REJECT: a non-deterministic
oracle.

And the comment claiming "rendering, charset, `sql_mode`, engine and escaping cannot defeat
this, because it is the invariant itself" was, again, stronger than the code. The probe tested
the invariant for **one row pair**, not the invariant.

## H-1 — the probe made the committed suite flaky

The candidate supplier was selected outside the transaction and without a lock, then inserted
against inside it, while three other integration files create and delete suppliers in parallel
against the same `erp_dev`. Five runs of the prescribed server command:

```
run 0 exit=1  171 tests  170 pass  1 fail   ER_NO_REFERENCED_ROW_2
run 1 exit=0  171 tests  171 pass  0 fail
run 2 exit=0  171 tests  171 pass  0 fail
run 3 exit=0  171 tests  171 pass  0 fail
run 4 exit=1  171 tests  170 pass  1 fail   ER_NO_REFERENCED_ROW_2
```

So "171 pass 0 fail 0 skipped" was false as a *reproducible* result, and the failure was
caused by code in this PR. A green CI run is not evidence a suite is stable at a 40% local
failure rate.

## H-3 — the probe's tests could not tell it from its absence

Mutation testing, each injection grep-verified:

| mutation | unit file | integration file |
| --- | --- | --- |
| candidate `'pending'` → `'approved'` | 8 pass | 3 pass |
| `NOT EXISTS` → `EXISTS` | 8 pass | 3 pass |
| **delete the probe call entirely** | 5 pass 3 fail | **3 pass 0 fail** |

`NOT EXISTS → EXISTS` is not cosmetic — it picks a supplier that already has a pending request,
so `up()` would throw on every database holding one, and nothing noticed. This is the defect
REV-014 already recorded — *"the fake cannot prove the SQL is right… cite the pair, never the
unit file alone"* — reintroduced in the replacement.

## M-2 — the skip path's justification was false for one of two call sites

The comment said the skip is safe because "this migration created the table a few statements
ago". True of the post-`CREATE` call; false of the early-return guard, which runs before
anything is created. A table generated as `IF(status <> 'pending', 1, NULL)`, with every
supplier holding a pending row, passed. The skip fires whenever every supplier already has a
pending request, which is ordinary on a small database.

## M-1 — the second half of the oracle was justified by an example the database contradicts

`IF(status = 'pending', 1, 1)` was cited in three places as the case the second half catches.
On real MySQL that DDL throws `ER_DUP_ENTRY` out of the *unwrapped* insert before the second
half is ever evaluated, and the unit test's fake modelled a behaviour MySQL does not produce.

## Disposition: the guard is removed

The reviewer's judgement, which this round accepts in full:

> The decision to stop patching the regex was right. The implementation is over-built. Deleting
> the predicate check and relying on `supplierCoreMigrations.integration.test.js` removes 46
> lines, the write path inside a migration, the H-1 race, the M-2 skip hole and the H-2
> non-determinism, and costs only a guard against a hand-divergent table nobody has observed.
> Under the project's own "minimum code that solves the problem," that was the better call and
> it was not taken.

`assertPendingSlotEnforces` is deleted. `0035` no longer attempts to verify the `pending_slot`
predicate by any means, and the code now says so explicitly rather than implying coverage it
does not have. What remains are facts `information_schema` states directly and which have never
been defective: the column list, that `pending_slot` is generated, and that
`uq_supplier_activation_pending` is unique over exactly `(supplier_id, pending_slot)`.

The invariant itself stays proved where it was already proved behaviourally against real MySQL:
`supplierCoreMigrations.integration.test.js` inserts a second pending request for one supplier
and requires `ER_DUP_ENTRY`, then approves the first and requires the next insert to succeed.

**Flakiness, re-measured after the removal** — five consecutive runs of the same command:

```
run 0 exit=0  168 tests  168 pass  0 fail
run 1 exit=0  168 tests  168 pass  0 fail
run 2 exit=0  168 tests  168 pass  0 fail
run 3 exit=0  168 tests  168 pass  0 fail
run 4 exit=0  168 tests  168 pass  0 fail
```

168 rather than 171: the three probe unit tests went with the probe.

## L-1 — a "worst case" that was never constructible

`IF(status = 'pending', id, NULL)` — cited from REV-014 onward as the most dangerous accepted
form — is refused by MySQL outright: `ER_GENERATED_COLUMN_REF_AUTO_INC`. It only ever existed
behind a fake connection. Corrected in `11_rev_015…md`, with the note that the constructible
version of the hazard is the `supplier_version` form the probe accepted.

## Record corrections

- **Census extended to eleven** and re-scoped. The two added: REV-014 M-3, a ledger record
  asserting "the table is empty" while a leaked supplier and two rows survived; and REV-016 L-4,
  "that trade is now stated in the code comment and the ledger", whose code-comment half was
  never true and went uncorrected through two further rounds. REV-014 L-2 and REV-016 L-1, named
  in the prose but excluded from the count, are now counted. Fourth consecutive round the census
  was short by items the corpus already held.
- **`10_`, `11_` and `12_rev_*.md` now carry a superseded-in-part banner** at the top. The
  reviewer found five separate passages still presenting deleted code as the current fix. A
  banner naming the whole class is checkable in one grep, where six inline markers were not —
  and inline markers are what the last two rounds kept getting wrong.
- **`00_harness_state.json` observations[40]** still asserted "nothing is stripped now"
  unretracted, though the census's own item (7) grades that sentence false. Amended in place.

## Residual

- The guard does not detect a hand-divergent table whose `pending_slot` computes the wrong
  value. This is now stated in the code rather than implied away.
- `DEF-016` OPEN, also carrying the `TASK-026` lock window.
- `DEF-013` OPEN for `TASK-038`; checker registration remains `DEF-004`, deferred under
  `APPROVAL-HD-017-RISK`.
- `0035`／`0036` are also claimed by the unmerged `codex/customer-management-phase-001`.
- This review did not replace CI, Technical Acceptance or UAT.
