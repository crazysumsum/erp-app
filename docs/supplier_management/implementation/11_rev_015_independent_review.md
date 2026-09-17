# Supplier Management — PHASE-002 TASK-025 REV-014 Remediation Review

## Decision

`CHANGES_REQUESTED` — **0 Critical, 0 High, 1 Medium, 3 Low**, 1 nit declined by the author
and endorsed by the reviewer.

Both code fixes from REV-014 were confirmed by experiment **with negative controls that
discriminate**. The ledger corrections are visible as corrections and the structured JSON
diff shows nothing undisclosed. The reviewer found a third instance of one standing pattern,
smaller than the previous two, and named the pattern itself.

## Provenance

| Item | Value |
| --- | --- |
| Reviewer | `agent-skills:code-reviewer`, fresh separate agent, no prior context |
| Author | Claude Opus 5 |
| Method | `SEPARATE_AGENT` |
| Worktree | `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-phase-002` |
| Branch／PR | `codex/supplier-phase-002` ／ PR #109 |
| Reviewed HEAD | `3128059` (diff `9a9984b..3128059`), CI 4/4 green |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` |
| Plan baseline | `a0d41e31d887447d669d0f8252991e43fcdd273eb9eadcbe0d211468092bd154` |

## Findings and disposition

### MEDIUM-1 — the predicate check was a substring test, and "mutation-proven" was one mutation deep → fixed

`server/database/migrations/0035_create_supplier_activation_requests.js`. The check required
the normalized `GENERATION_EXPRESSION` to contain `status` and `'pending'`. The reviewer drove
the inspection over nine expressions and it **accepted** all of these:

| Accepted expression | What it actually enforces |
| --- | --- |
| `if((status <> 'pending'),1,NULL)` | the exact inverse invariant |
| `if((not((status = 'pending'))),1,NULL)` | the inverse again |
| `if((status = 'pending'),NULL,1)` | branches swapped |
| **`if((status = 'pending'),id,NULL)`** | **nothing at all** |
| `if((status = 'pending'),1,1)` | the slot is never freed |
| `concat(status,'pending')` | not a predicate |

The fourth is the one that matters. A distinct slot value per pending row makes
`UNIQUE (supplier_id, pending_slot)` constrain nothing, while `inspectSupplierActivation­RequestSchema`
returns `true`, `up()` returns early, the runner records `0035` as applied, and the
one-pending-request guarantee — the entire reason the column exists — is silently absent.
The thrown message asserted a derivation the code never checked.

Only a different *literal* was rejected, and that was the single mutation the new unit test
exercised. Recording that as "mutation-proven" is the third instance of the standing pattern
below.

Fixed: the check is now anchored on the whole expression —
`/^if\(\(`status`=(_[a-z0-9]+)?'pending'\),1,NULL\)$/i` over the backslash- and
whitespace-normalized text, with only MySQL's charset introducer allowed to vary. The
mutation set covers every form above plus a different column, an empty expression, and four
acceptable rewritings of the committed DDL.

**Negative control, with the test file byte-identical** (md5 `2437f439bd6122a3c19daf43f16f8b27`
before and after): reverting the migration to the substring check turns the mutation case red —
`Missing expected rejection: accepted if((`status` <> _utf8mb4\'pending\'),1,NULL)` — while the
six other cases stay green, because they test different properties.

### LOW-1 — REV-014's cleanup proof could not have observed what it reported → corrected

REV-014 recorded: injecting `assert.equal(1, 2)` *before* the insert "still ran the after-hook
and removed its own supplier." At that point `supplierId` is `null`, so the hook's
`if (supplierId !== null)` branch cannot run and nothing can have been removed. The stated
experiment proves nothing.

The **conclusion is true**: REV-015 re-established it with the injection placed after the
supplier and both activation rows exist — test red, `erp_dev` back to 0 `MIG-%` suppliers, 0
activation rows, `supplier_settings` untouched. Both the review document and the ledger record
now describe that experiment instead.

### LOW-2 — `DEF-011`'s closure did not say its own symptom is still reachable → corrected

The narrowed claim survives adversarial reading: `#changeStatus` derives `action` from the
command and `LIFECYCLE_ACTIONS` derives from the same frozen registry, so a routed transition
cannot escape the filter by construction. But the reviewer reproduced `DEF-011`'s exact
user-visible symptom on head `3128059` through the `DEF-016` path — a `TASK-038`-shaped
`approveSupplier` doing its own `SELECT … FOR UPDATE`, `UPDATE`, and `audit.record`:

```
after bypass approve -> status: active  version: 6
RETRY activate       -> THROWS STATUS_TRANSITION_INVALID {"from":"active","to":"active"}
```

Suite stayed 169 pass / 0 fail, lint exit 0, lifecycle test md5 unchanged.

On whether closing `DEF-011` while `DEF-016` is open flatters the numbers, the reviewer's
answer was **no, numerically** — `DEF-011` was raised to MEDIUM and `DEF-016` is OPEN at
MEDIUM, so the open-MEDIUM count is unchanged — but yes presentationally: a reader of the
`defects` array alone would conclude the 409-on-retry is gone. `DEF-011`'s closure evidence
now says the symptom remains producible via `DEF-016`.

### LOW-3 — `M-2` traded a wrong-read window for a lock-contention window → recorded for `TASK-026`

The transaction holds locks on `supplier_settings` id=1 across a `DELETE`, two `up()` calls and
an `UPDATE`. Under `TASK-026` a parallel test file updating that row blocks until rollback and
could hit `innodb_lock_wait_timeout`. The ledger's "no other connection ever observes the
intermediate values" is literally true for reads, which is what it claims — so this is a
`TASK-026` constraint, not a misstatement. Recorded against `DEF-016`'s task scope.

### Nit — `SUPPLIER_REFERENCED` without `details`: decline endorsed, with a stronger reason

The reviewer went further than the author's reasoning. The `referenceSummary` computed earlier
on that path necessarily has `total === 0` — otherwise `assertSupplierDeletable` would already
have thrown — so attaching it would assert "0 references" on a 409 that exists *because* of a
reference. Actively misleading, not merely uninformative. Leaving it absent is the right call.

## What the reviewer verified independently

- **`M-2` genuinely closes the window, with a control that discriminates.** `0036`'s `up()`
  issues DDL only under `if (!existed)`, and the test calls it once before `beginTransaction`,
  so no implicit commit occurs inside the transaction. A second observer connection saw the
  original row at both mid-transaction points and rollback restored it exactly. Injecting
  `ANALYZE TABLE supplier_settings` into the same transaction made the observer see the
  mutated value and `ROLLBACK EFFECTIVE: false` — so the probe distinguishes a working
  transaction from a broken one. **Not a fix that does not fix.**
- **The neutering claim is exact**: forcing all three guards to `if (false)` gives `pass 2 /
  fail 4`, precisely the four property cases.
- **`erp_dev` is clean**: 0 activation rows, no `MIG-%` supplier, `supplier_settings` id=1 at
  `require_activation_approval 0, version 1`. The two remaining suppliers, ids 11 and 404, are
  declared in `external_actions`, not leaked.
- **The Item-side citation correction is accurate**: `grep` for `0035|0036|supplier_activation|supplier_settings`
  in `migrations.integration.test.js` returns zero hits.
- **Nothing undisclosed in the ledger**: a full recursive diff of the parsed JSON across
  `9a9984b..3128059` changed only `revision`, the appended `REV-014`, `observations[34].source_ref`,
  the appended `observations[37]`, `defects[10]`, the appended `DEF-016`, and `next_safe_action`.
  `approvals`, `tasks`, `baseline`, `runtime` and `evidence_files` untouched.
- **Both corrections read as corrections**, naming what was false rather than quietly rewriting.
- **HIGH-2 resolves in production**: `MySqlDatabaseService.js:216-224` wraps exactly once and
  re-throws early if already wrapped.
- **The four suite numbers are exact**: lint 0; client build 0; server 169 pass / 0 fail / 0
  skipped; client 40 passed.

Not verified: `source_fingerprint` values (no independent recomputation path); the historical
timestamp on the cleanliness correction, only the current state; CI, taken from the brief;
`TC-001`, outside the four suites.

## The standing pattern the reviewer named

> The recurring tell is an experiment where the negative control does not discriminate, and
> the cheap counter is to ask of every proof "what would this have looked like if the property
> were false?"

Three instances on this branch, each found by a reviewer rather than by the author:
`DEF-011`'s original test, "impossible by construction", and "mutation-proven". None was a
false claim about behaviour; each treated a passing experiment as proof of more than it
isolates. This is recorded as a standing bias rather than a fourth case to fix, and the
negative controls in this round — the `ANALYZE TABLE` probe, the post-insert injection, the
substring revert — are what the counter looks like in practice.

## Residual

- `DEF-016` OPEN: transitions bypassing `#changeStatus` reproduce `DEF-011`'s 409-on-retry
  symptom. Bears on `TASK-026` and `TASK-038`. Its scope now also carries the `LOW-3` lock
  window.
- `DEF-013` stays OPEN for `TASK-038`; reference-checker registration remains `DEF-004`,
  deferred under `APPROVAL-HD-017-RISK`.
- `0035`／`0036` are also claimed by the unmerged `codex/customer-management-phase-001`;
  whichever merges second must renumber.
- This review did not replace CI, Technical Acceptance or UAT.
