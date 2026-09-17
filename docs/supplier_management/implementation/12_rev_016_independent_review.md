# Supplier Management — PHASE-002 TASK-025 REV-015 Remediation Review

## Decision

`CHANGES_REQUESTED` — **0 Critical, 1 High, 3 Medium, 4 Low**

The anchored predicate check closed seven real holes, and the reviewer measured that. But it
**opened a new one in the dimension the migration's own comment names as the silent hazard**,
so this round shipped a behavioural regression. One finding, `M-2`, is not sustained; the
detail is below, with the reproduction.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Worktree | `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-phase-002` |
| Branch／PR | `codex/supplier-phase-002` ／ PR #109 |
| Reviewed HEAD | `b8170ae` (diff `3128059..b8170ae`), CI 4/4 green |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |

## H-1 — the `/i` flag accepted a case-wrong literal, which the previous check rejected → fixed

The anchored regex carried `/i` so `if`/`IF` and `NULL`/`null` would match. That also made
`'pending'` case-insensitive. `status` is `ascii_bin` — the migration's own comment says so —
so `IF(status = 'PENDING', 1, NULL)` compares equal to nothing the application ever writes.
The slot stays `NULL` on every row, the unique index constrains nothing, `inspect…` returns
`true`, `up()` returns early, and the runner records `0035` as applied. That is the `DEF-011`
failure mode verbatim.

Reproduced against the shipped code before changing it:

```
true   lowercase 'pending' (the real DDL)
true   UPPERCASE 'PENDING'
true   Mixed 'Pending'
true   space inside literal 'pen ding'
```

The substring check this replaced **rejected** all three wrong forms. So this was a regression
introduced by the fix, not a residual — the fix was recorded as closing a hole while it opened
another.

Fixed: the literal is matched case-sensitively. Keyword casing and the charset introducer are
still tolerated, because neither changes what the column computes. After the fix the same
probe returns `true, false, false, false`.

## M-1 — whitespace was stripped inside the literal → fixed

`.replace(/\s+/gu, "")` stripped whitespace everywhere, so `'pen ding'` normalized to
`'pending'` and passed. Same consequence as H-1. The claim "only MySQL's charset introducer
allowed to vary" appeared in the code comment, the commit message, the review document and the
ledger, and was false in all four.

Fixed: no whitespace is stripped. The pattern allows `\s*` at token boundaries instead, which
tolerates server spacing without reaching inside the quotes.

> **AMENDED by REV-017 H-2.** This section claimed all four wordings were corrected. Two
> were: the other two — `11_rev_015_independent_review.md` and the REV-015 ledger
> observation — still carried the retracted sentence, and the first also still presented
> the regressed `/i` regex as the fix. Both are corrected now. The fix this section
> describes has since been removed entirely: the backslash strip it left in place
> admitted a literal containing a backslash, so `0035` no longer matches the expression
> text at all. See `13_rev_017_independent_review.md`.

## M-2 — not sustained: the quoted control output is genuine

The reviewer reported the verbatim negative-control output in `11_rev_015…md` as impossible
for that run, `grep -c` returning 0, and concluded it was a predicted output formatted as an
observed one — a fifth instance of the standing bias.

Re-run of the original control, injection verified by `grep` first, test file md5
`2437f439bd6122a3c19daf43f16f8b27` before and after:

```
ℹ pass 6   ℹ fail 1
AssertionError [ERR_ASSERTION]: Missing expected rejection: accepted if((`status` <> _utf8mb4\'pending\'),1,NULL)
```

The difference is in how the control was built. The original reverted **only the condition**
and left the thrown message identical, so `'approved'` and `'pending%'` were still correctly
rejected and the run reached the `<>` case, which is a genuine acceptance difference. The
reviewer's reconstruction reverted the message as well, so its run aborted at index 0 on a
message-regex mismatch. Both runs are real; they are different experiments.

The reviewer's **methodological point stands regardless** and has been acted on: the control's
discrimination was coupled to the message string, so a later wording change would have degraded
it silently. The rejection assertions are now message-agnostic, with one separate case
asserting the message, and all three controls in this round discriminate on acceptance.

## L-1 — "None was a false claim about behaviour" → corrected

`09_rev_013…md` records `DEF-011` as *"closed on false evidence"*, and commit `9a9984b` is
titled "retract the false DEF-011 closure". A defect closure is a claim about behaviour. The
sentence softened the record on a point that was not checked.

## L-2 — the standing-bias census was short → corrected

The observation enumerated three instances while the same commit was correcting a fourth. With
H-1 and M-1 the count is now six. A standing-bias record whose own census is short is the
pattern applied to itself.

## L-3 — the thrown message still asserted more than the code verified → corrected

It said "is not exactly IF(status = 'pending', 1, NULL)" while accepting `'PENDING'`,
`'Pending'` and `'pen ding'`. It now names the property that is actually checked, including the
exact lowercase literal.

## L-4 — brittleness undisclosed, and one citation replaced rather than appended → corrected

No note said what happens if a server renders the expression differently: `up()` throws and the
migration runner is blocked on a correct schema. The reviewer confirmed MariaDB is untestable
here, and that `CASE WHEN … THEN 1 END`, `<=>` and `BINARY` forms are behaviourally correct and
now rejected. That trade is now stated in the code comment and the ledger.

`DEF-011.closure_evidence[2]` had replaced the REV-014 citation with the REV-015 one instead of
appending, which the commit message did not mention. Both are now listed.

## On the two "tolerated" expressions

The reviewer ran 14 DDL probes on MySQL 26.7.0 and found the server always emitted a charset
introducer and always uppercase `NULL`, so two of the four previously-asserted "acceptable
rewritings" were regex branches restated as test cases rather than observed output. They are
kept, because neither can affect the invariant, but the test now says plainly that this is
deliberate tolerance and not a claim about what MySQL emits. The `/i` branch that the lowercase
`null` case locked in is gone; keyword casing is now matched explicitly.

## What the reviewer verified TRUE

The four suite numbers exactly; `REV-015` recorded with the stated values; `DEF-016`'s
`source_ids` gained the lock-window reference; a keyed recursive JSON diff showing 14 changes
and nothing undisclosed except the replaced citation in `L-4`; the corrected cleanup passage
accurate — post-insert injection leaves `erp_dev` at 0 activation rows, no `MIG-%` supplier,
settings `(1, 0, 1)`; `DEF-011`'s closure text neither over- nor understated, with the
409-on-retry reproduced on `b8170ae` itself; and the anchored check genuinely closing the seven
substring holes.

Not verified: MariaDB or any second engine; CI, taken from the brief; `source_fingerprint` and
`spec_baseline` hashes; `TC-001` and `TC-016`.

## Residual

- `DEF-016` OPEN, now also carrying the `TASK-026` lock window.
- `DEF-013` OPEN for `TASK-038`; checker registration remains `DEF-004`, deferred under
  `APPROVAL-HD-017-RISK`.
- `0035`／`0036` are also claimed by the unmerged `codex/customer-management-phase-001`.
- This review did not replace CI, Technical Acceptance or UAT.
