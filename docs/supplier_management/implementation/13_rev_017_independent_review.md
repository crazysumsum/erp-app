# Supplier Management — PHASE-002 TASK-025 REV-016 Remediation Review

## Decision

`CHANGES_REQUESTED` — **0 Critical, 2 High, 2 Medium, 1 Low**

The reviewer confirmed the `70f6c93` fix and all three of its controls, and adjudicated a
disputed finding in the author's favour. It also found a **seventh instance of the standing
bias, carrying a working exploit**, and delivered the judgement that matters most: the
approach itself is wrong and should be replaced. It has been.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Worktree | `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-phase-002` |
| Branch／PR | `codex/supplier-phase-002` ／ PR #109 |
| Reviewed HEAD | `6281ef4` (diff `b8170ae..6281ef4`), CI 4/4 green, integration job 7m44s |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |

## The judgement that ends this cycle

> Four rounds, a defect in three of them, the REV-015 fix introduced the REV-016 HIGH, and the
> REV-016 fix left a hole of the identical class that I found in one afternoon. The approach
> validates a *string* to infer a *behaviour*, so every rendering variation is a new
> false-reject and every normalization step is a new false-accept — and the two pressures push
> in opposite directions, which is why each fix creates the next defect.

The reviewer measured both directions on real MySQL 26.7.0, with a behavioural probe as the
oracle — and the probe returned the correct answer on all 13 cases, including the one the regex
accepted and the three it wrongly rejected:

| form | actually enforces? | text check said |
| --- | --- | --- |
| `IF(status = 'pen\ding', 1, NULL)` | **no** | accept — **false accept** |
| `CASE WHEN status = 'pending' THEN 1 END` | yes | reject — false reject |
| `IF(status <=> 'pending', 1, NULL)` | yes | reject — false reject |
| `IF(BINARY status = 'pending', 1, NULL)` | yes | reject — false reject |

A false reject is not cosmetic: `up()` throws and the migration runner is blocked against a
schema that is correct.

**Acted on.** The text matching is removed, not repaired a sixth time.
`inspectSupplierActivationRequestSchema` now asks the database the invariant itself, inside a
transaction that is always rolled back: a second `pending` request for one Supplier must be
refused with `ER_DUP_ENTRY`, and a second decided request must be accepted. Both halves are
required — without the first, a slot that is never `NULL` passes; without the second,
`IF(status = 'pending', 1, 1)` passes while it also blocks the decided history the table exists
to keep. Rendering, charset, `sql_mode`, engine and escaping cannot defeat it, because it is
the invariant rather than a proxy for it.

The probe is skipped when no Supplier exists to probe against. On that path the table was
created by this same migration a few statements earlier, so there is no divergent schema to
detect.

## H-1 — the surviving backslash strip, with a proven exploit → removed with the approach

`.replace(/\\/gu, "")` stripped every backslash, including inside the quoted literal. A literal
holding a real backslash renders with doubled backslashes, so stripping made
`IF(status = 'pen\ding', 1, NULL)` byte-identical to the correct expression. The reviewer
proved it end-to-end against real MySQL by measuring enforcement — inserting two pending rows
for one Supplier and seeing the second succeed — not by reading the regex:

```
backslash in literal   | enforces? false | accepts? true   *** FALSE ACCEPT ***
   slot for a real 'pending' row: NULL
```

Three sentences asserted the opposite: the commit message (*"Nothing is stripped now"*), the
code comment (*"those are tolerated; nothing else is"*), and the ledger. All three were written
in the commit that retracted the previous round's identical over-broad sentence. That is the
seventh instance, and it is why the approach is gone rather than patched.

## H-2 — "corrected in all four places" was true of two → corrected

`grep -rn "introducer allowed to vary" docs server` returned two live occurrences after the
commit that claimed all four were fixed. Worse, `11_rev_015…md:53-57` did not merely carry the
retracted sentence — it still presented **the regressed `/i` regex as the fix**, unmarked, four
lines above an edit made in that same commit. A reader of the review corpus was told the
regression was the remediation.

Both are corrected: the review section now carries an amendment marker stating plainly that
what it recorded as the fix was defective and has been removed, and `observations[38]` is
amended in place, as `observations[37]` was.

## M-1 — the brittleness trade was stated in the ledger, not in the code → moot, and now stated

The reviewer's `git diff` grep found no such sentence added under `server/`. The trade no longer
exists — a behavioural probe has no rendering to be brittle about — and the new comment records
why the text approach was abandoned, including the three correct forms it rejected.

## M-2 — the census was short again, by an item the same round corrected → extended

The six-instance census omitted the finding that two of four "acceptable rewritings of the
committed DDL" were regex branches restated as test cases rather than observed MySQL output —
asserted, never observed, found by the reviewer, corrected in `70f6c93`. It fits the census's
own definition. The reviewer also noted REV-014's L-2, the REV-013 document claiming a clearance
its reviewer never granted, which on the broader framing is arguably the most load-bearing
instance given that every review document is author-written.

Both are added, bringing the census to nine, and the census now **states its own scope** so
completeness is checkable rather than asserted. The reviewer checked the six that were listed
individually and found each real and fairly characterised; the defect was completeness only.

## L-1 — false rejects confirmed behaviourally → removed with the approach

## The disputed finding, adjudicated

REV-016 reported that a quoted negative-control output in `11_rev_015…md` was fabricated. The
author refused it, re-ran the control, and recorded it as not sustained. The reviewer
reconstructed **both** experiments at `b8170ae`, test file md5 `2437f439bd6122a3c19daf43f16f8b27`
matching the citation:

```
EXPERIMENT A — revert only the condition, message unchanged (the author's account)
  6 pass 1 fail   AssertionError: Missing expected rejection: accepted if((`status` <> …))
  grep -c for the `<>` line -> 1

EXPERIMENT B — revert the condition AND the message (the reviewer's reconstruction)
  6 pass 1 fail   AssertionError: accepted if((`status` = …'approved'…))   <- aborts at index 0
  grep -c for the `<>` line -> 0
```

Verdict: **the author, decisively.** The REV-015 output is verbatim genuine including the
counts; both runs are real; they are different experiments, and the difference is exactly the
one the author identified. The reviewer added that defending real evidence under pressure is
the correct behaviour and should be recorded as distinct from stubbornness, and that acting on
the valid methodological point behind an invalid finding is the right disposition.

## What the reviewer verified TRUE

All three controls reproduced exactly, injections grep-verified, test file byte-identical at
`0edd7379284ab77078de31442373c650`; baseline `8 pass 0 fail`, each control `7 pass 1 fail` on
precisely the claimed case, each producing exactly one failure — which also confirms the
message-asserting test is separate and not load-bearing for the rejection loop. Suite numbers
exact (`171/0/0`, `40`, lint 0, build 0). CI genuinely 4/4 green on `6281ef4`. Revision 98 and
`REV-016` recorded as stated. `observations[37]` amended in place with the original claim still
legible. `DEF-011.closure_evidence` 4→5 entries with the REV-014 citation appended rather than
substituted. A keyed recursive JSON diff showing nothing changed outside the commit messages'
scope. `erp_dev` clean before and after its runs.

Not verified: MariaDB or any second engine; `source_fingerprint` and `spec_baseline` hashes;
`TC-001`／`TC-016`; and the reviewer attributions in all four author-written review documents.

## Not done, and why

The real-MySQL demonstration that the **probe rejects** the backslash exploit was not run. It
requires building a divergent table in `erp_dev`, which is a schema change and needs sign-off
under the project rule. The probe's *acceptance* path is verified against real MySQL by
`supplierCoreMigrations.integration.test.js`, and its rejection paths are covered by unit tests
that simulate a non-enforcing table. This is offered rather than assumed.

## Residual

- `DEF-016` OPEN, also carrying the `TASK-026` lock window.
- `DEF-013` OPEN for `TASK-038`; checker registration remains `DEF-004`, deferred under
  `APPROVAL-HD-017-RISK`.
- `0035`／`0036` are also claimed by the unmerged `codex/customer-management-phase-001`.
- This review did not replace CI, Technical Acceptance or UAT.
