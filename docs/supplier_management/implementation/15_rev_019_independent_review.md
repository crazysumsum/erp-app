# Supplier Management — PHASE-002 TASK-025 REV-018 Remediation Review

## Decision

**`APPROVED`** — **0 Critical, 0 High, 3 Medium, 1 Low — none blocking.**

The first approval on this branch, after six rounds. The reviewer verified the engineering
substance by experiment rather than accepting it, and stated that the remaining items belong as
follow-ups rather than a seventh round. They are remediated here anyway, since each was a
one-line fix.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Worktree | `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-phase-002` |
| Branch／PR | `codex/supplier-phase-002` ／ PR #109 |
| Reviewed HEAD | `5023add` (diff `b39a27f..5023add`), CI 4/4 green |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |

## What the reviewer established by experiment

- **The invariant is still genuinely proved.** Pointing the second pending insert at a different
  supplier turns `supplierCoreMigrations.integration.test.js` red with
  `AssertionError: Missing expected rejection` at line 136. Injection grep-verified, file
  restored to md5 `f95498dc1b57e855bfeb39030156cea3`. The removal traded a defective guard for a
  working proof, not for no guard.
- **The flakiness is gone.** **Ten** consecutive runs — not the five claimed — every one
  `tests 168 / pass 168 / fail 0 / skipped 0`, exit 0. The probe had produced 2 failures in 5.
- **The removal is complete.** No orphans, `value()` still used at six sites, no unreachable
  branch, lint clean.
- **The five surviving checks are non-vacuous**, under five grep-verified mutations: dropping
  `!slotUnique`, dropping the exact-columns compare, breaking the `GENERATED` check, renaming an
  expected FK, renaming an expected index — each turns the suite red.
- **The early return is now behaviourally identical to falling through**, since
  `CREATE TABLE IF NOT EXISTS` is a no-op when the table exists and `inspect()` re-runs at the end.
- **The fake's SQL routing cannot drift silently**: the specific index branch is matched before
  the general `information_schema.statistics` branch, and the default arm throws.
- **The ledger lost nothing**: recursive parsed JSON diff shows no removed keys, no removed
  elements, top-level key order preserved.

On the migration comment at `0035:37-50`:

> the first closure text on this branch that I could not break. I checked each sentence against
> the code and the empirics: all five are accurate, and it under-claims rather than over-claims.

## Findings, all remediated here

### M-1 — the test header claimed coverage no test provided

> "each property the inspection still claims — **the column list**, the generated column, the
> exact unique index — is exercised against a schema that violates that property and nothing else."

False for the column list: `columns: []` exercises the absent-table early return, not a
violation. Deleting the column-list check from the migration left the suite at 5 pass 0 fail.

Fixed by making the sentence true rather than by striking it: a case now feeds a list with a
missing column and a list with a renamed one. **Negative control**, test file byte-identical:
deleting the column-list check turns the suite red, `5 pass 1 fail`.

The reviewer noted separately, and correctly, that deleting the FK-existence or index-name loops
also leaves the suite green — but the comment does not claim those are covered, so it is not a
finding. It remains true of the current code.

### M-2 — the banner went on three of the four documents that needed it

`13_rev_017…md`, the record of the round that shipped the probe, describes it in the present
tense and carries three sentences REV-018 graded false. It now carries a banner naming each.

The missed document was found by a one-line grep, which disproves that commit's own closing
line — "Verified by grep before claiming, not after." The grep was run against the two phrases
already known to be false, not against the class.

### M-3 and L-1 — the census asserted eleven while its own prose placed at least thirteen

It also said REV-014 L-2 and REV-016 L-1 "are counted among these" when neither appeared in the
enumeration, disagreed with `14_rev_018…md` about which two were added, and carried a duplicated
clause.

Rewritten with an explicit **counting rule** — *the count is the length of the enumeration and
nothing else; an instance named in prose but absent from the enumeration is a defect in this
record* — and a complete enumeration. It now stands at **twenty**, including the four the
reviewer identified as uncounted and the two created in the commits under review.

Fifth consecutive round the count was wrong. The rule is the fix; another number would not be.

## Disposition on merge

> The `server/` change is the whole of what ships and runs, and it is +21/−125 that deletes a
> guard proven defective in three independent ways, keeps a proof that I confirmed by mutation,
> and takes the suite from 2-failures-in-5 to 0-in-10.
>
> A seventh round to land three one-line edits would cost more than it buys, and the pattern the
> census tracks is better served by a standing follow-up than by holding a correct code change
> hostage to its own bookkeeping.

The three were landed rather than deferred, so no follow-up defect is opened for them.

## Residual

- The guard does not detect a hand-divergent table whose `pending_slot` computes the wrong value,
  and says so in the code.
- `DEF-016` OPEN, also carrying the `TASK-026` lock window.
- `DEF-013` OPEN for `TASK-038`; checker registration remains `DEF-004`, deferred under
  `APPROVAL-HD-017-RISK`.
- `0035`／`0036` are also claimed by the unmerged `codex/customer-management-phase-001`.
- This review did not replace CI, Technical Acceptance or UAT. The merge decision is the Product
  Owner's and has not been given for this head.
