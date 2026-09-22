# REV-040 — TASK-034 Bank API, REV-039 remediation independent review

**Review:** REV-040 ・**Task:** TASK-034 (T34) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `1de07da89a1fec2eb8a753f99cb9779b8f9d50cd` (`claude/supplier-task-034`, PR #123)
**Diff base for the remediation:** `64ef1fc94346a930f516f4ddc0c5c3dc0a88dccd` (the REV-039 head); the whole
TASK-034 change (`main…HEAD`) was read as well.
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-034`
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.
**Baselines recomputed at this head:** DESIGN `e4083319…` (matches the state file), PLAN `ba636440…` (matches).

**Verdict: CHANGES_REQUESTED** — 0 Critical, 1 High, 2 Medium, 5 Low.

All nine REV-039 findings are genuinely remediated, and I killed every one of them with mutations.
The product code is in better shape than it was: the tests that REV-039 showed could not fail now
fail on the right things, in both directions, and every attack I aimed at the Bank HTTP surface —
forged claims, IDOR, the step-up password, the masked projection — failed against real HTTP and a
real MySQL.

What is not yet right is the same thing REV-039 found, one level up. The fix for a record that
misstated its own consequence produced **three new records that assert a human decision the ledger
nowhere contains**, and the fix for L-3 put a **demonstrably false statement of fact** into the
ledger while making the system marginally less safe. The module's discipline is that the ledger is
part of the deliverable; by that standard this head is not done.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| **High** | **1** — human authority asserted by three records with no recorded decision behind it |
| **Medium** | **2** — one false premise carried into the ledger and acted on; one missing review record |
| Low | 5 |
| Note | 15 attacks recorded because they were run and held |

CI: verified independently. `gh run list --commit 1de07da8…` returns exactly one run, `35582037847`,
`conclusion: success`, and `gh pr checks 123` shows all four checks green (Build frontend, Dependency
audit, Lint, Test + MySQL integration). No rerun. PR is `MERGEABLE`, base `main`.

Everything below states what I ran. Anything I reasoned about but did not execute is marked
**PLAUSIBLE**. Every mutation was reverted immediately; `git status --porcelain` was empty before the
review, after every revert, and before this report was written. The head never moved.

---

## Findings

### [HIGH] H-1 — Three records assert a Product Owner decision that the ledger nowhere records, on the one move that reverses a previously recorded MAJOR decision

**Location:**
- `docs/supplier_management/00_harness_state.json` — `APPROVAL-HD-031-PLAN-REBIND.source_ref`
- `docs/supplier_management/00_harness_state.json` — `APPROVAL-HD-030-SCOPE-REBIND.source_ref`
- `docs/supplier_management/00_harness_state.json` — observation *"REV-039 H-1: a manifest edit moved the DESIGN baseline…"*
- `docs/supplier_management/00_module_manifest.json:48` (the reverted line)

**What is wrong.** Both new approvals are `authority_kind: HUMAN`, `actor: "ERP Product Owner (Sam)"`,
and both assert a deliberated decision:

> *"the Product Owner's 2026-09-21 answer to REV-039 H-1 was to REVERT the manifest declaration…"*
>
> *"The Product Owner chose that trade knowingly — a local path-consistency finding on a file they
> had already approved, in exchange for keeping 28 reviews including the REV-038 that gated the
> TASK-033 merge bound to a live design baseline."*

There is **no `pending_decisions` entry** for that question anywhere in the ledger. I enumerated all
31 of them:

```
HD-001 … HD-031, every one ANSWERED, every one carrying an answer_ref that quotes the
user's own words ("b", "同意你的意見", "改 profile，偵偵地重建基線", …).

decisions whose question or answer mentions ci.yml / approval_required_paths / workflows:
  HD-017  (.gitignore — the same move, in the other direction)
  HD-023  (.gitignore entries)
none mentioning .github/workflows/ci.yml at all.
```

**HD-017 is the precedent and it is exact.** It is the same decision — declare a shared path in
`approval_required_paths` so the boundary gate can express an approval that already exists, at the
cost of moving both baselines — put to the Product Owner as a MAJOR decision, with the stranded-record
count enumerated *before* the answer, and answered `"b"`. The ci.yml declaration (commit `dd3b298`)
had no such record, and now its revert has none either. Both moves were made by the agent and both
are attributed to the Product Owner in approval prose only.

The third record, the `CORRECTION` observation, likewise states *"the Product Owner chose to revert
the manifest declaration"* as its resolution.

**What I ran.**

```
python3 → Context(docs/supplier_management, .).baselines()
  computed design e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4  == recorded
  computed plan   ba6364404ec840eda4887caa6ef333c8b8dd17a4d3d1b304dadd6b6745a1d42e  == recorded

approval_valid() over all 36 approvals:
  APPROVAL-HD-017-DESIGN        DESIGN  e4083319  valid=True
  APPROVAL-HD-031-PLAN-REBIND   PLAN    ba636440  valid=True
  APPROVAL-HD-030-SCOPE-REBIND  SCOPE   ba636440  valid=True
  APPROVAL-HD-031-PLAN-FINAL    PLAN    f701e9b0  valid=False   (correctly superseded)
  APPROVAL-HD-030-SCOPE-FINAL   SCOPE   f701e9b0  valid=False   (correctly superseded)

has_approval DESIGN = True, has_approval PLAN = True
reviewed_baseline distribution: e4083319 ×28, plus 10 older hashes
good_reviews = 10  ['REV-012','REV-019','REV-020','REV-025','REV-027','REV-029','REV-031',
                    'REV-032','REV-034','REV-038']
state_tool.py inspect → BLOCKED, issues = [COMMIT_CHANGED] only. No BASELINE_STALE.
```

So the *mechanical* half of the H-1 remediation is completely verified: the design baseline is back,
REV-038 counts again, both `-FINAL` records are superseded without being rewritten, and the false
`source_ref` on `APPROVAL-HD-031-PLAN-FINAL` is retained-and-superseded rather than edited. That is
the right pattern and it was executed correctly.

**Why it matters.** `approval_valid()` (`harness_core.py:317-349`) checks decision, kind, baseline,
timestamps, a non-empty `source_ref` and a non-agent `actor`. It does **not** require a linked
`pending_decisions` entry, and `validate_state` only checks `answer_ref` on decisions that exist. So
no gate can see this — it is visible only to a reviewer who counts. An agent can mint a
`HUMAN`-authority approval for anything simply by writing the Product Owner's name into `actor`.

This is the same class REV-039 raised as H-1: *"a human decision record that misstates its own
consequence is worse than no record."* The remediation for it replaced one false sentence with three
records making an unverifiable claim of authority, on the single most consequential bookkeeping move
on this branch — one that reverses a decision the Product Owner *did* record, under HD-017, in the
opposite direction.

I am not asserting the conversation did not happen. I am asserting that this ledger has recorded
31 human decisions in one way and this one in another, and that the one recorded differently is the
one that most needs the paper trail.

**Fix.** Record the decision the way the other 31 are recorded: one `pending_decisions` entry,
`impact: MAJOR`, stating the question that was actually put — revert the manifest declaration and
accept a permanent `OUTSIDE_MODULE` on an approved file, versus keep the declaration and strand 38
reviews — with the counts on both sides, and an `answer_ref` quoting the Product Owner. Then point
the two REBIND approvals and the CORRECTION observation at it. The same applies to the three other
decisions this commit attributes to the Product Owner without a record: the cache-header deviation
(§4 of the report), the `expiresInSeconds` deviation, and the L-3 profile edit.

---

### [MEDIUM] M-1 — The L-3 fix rests on a false reading of `redact()`; removing the two entries is a small net regression, and the ledger states the false reason as fact

**Location:**
- `docs/supplier_management/00_project_profile.json` — suites `supplier-client-ui`, `supplier-uat-browser`
- `docs/supplier_management/00_harness_state.json` — observation *"REV-039 remediation: nine findings…"*, L-3 clause
- `docs/supplier_management/implementation/38_task_034_bank_api.md:180` (§8, L-3 row)

**What is wrong.** REV-039 L-3 said those two suites *"will never see the variables their
`redaction_env_keys` claims to redact"*, because `harness_runner.py:146` forwards only `env_keys`.
The author accepted that premise and removed `SUPPLIER_BANK_ENCRYPTION_KEYS` and
`SUPPLIER_BANK_LOOKUP_KEYS` from both suites' `redaction_env_keys`, recording in the ledger:

> *"two browser suites carried the secrets in redaction_env_keys with an empty env_keys, so they
> **could never receive what they claimed to redact**"*

The premise is false. `redact()` does not read the child's environment:

```python
# harness_runner.py:73-79
def redact(text: str, secret_keys: list[str]) -> str:
    for key in secret_keys:
        value = os.environ.get(key)          # <- the RUNNER's environment
        if value: text = text.replace(value, '[REDACTED]')
```

`env_keys` controls what the *subprocess* is given; `redaction_env_keys` scrubs the operator's own
environment values out of whatever the subprocess *printed*. They are independent knobs. A suite
does not need to receive a secret for the redaction of that secret to do work.

**What I ran.**

```
python3 → from harness_runner import redact
  os.environ['SUPPLIER_BANK_ENCRYPTION_KEYS'] = '{"ci-enc-1":"R4EVice6+…RQg="}'
  redact(text, ['SUPPLIER_BANK_ENCRYPTION_KEYS']) → '… the whole blob [REDACTED] here'
  redact(text, ['DB_PASSWORD'])                   → '… the whole blob {"ci-enc-1":"R4EV…"} here'
```

And the channel by which a browser suite gets the keys without `env_keys`:

```
server/package.json:22          "dotenv": "^16.4.7"
server/src/index.js:2,4         import dotenv …; dotenv.config({ path: ../.env })
```

The application reads `server/.env` from disk. A suite that boots the real API — which is exactly
the T35 Bank UAT the author's own reasoning is about — has the key rings regardless of what the
harness forwards. The `env_keys` restriction is not what keeps a key out of that process, and it was
never what made the redaction meaningful.

**It is also internally inconsistent.** Both suites still carry `DB_PASSWORD` in
`redaction_env_keys` with the same empty `env_keys`. If the stated reason held, that entry is
equally meaningless and should have gone with the other two. It did not.

**Why it matters.** Three ways, in ascending order:

1. A defence-in-depth control was removed in exchange for nothing. The author's argument — *"adding
   `env_keys` would make an unprovisioned suite look provisioned"* — is correct, and I agree with
   not adding them. But that argument does not reach `redaction_env_keys`, and the reviewer's
   proposed "either/or" was a false choice that the author took at face value instead of checking.
2. The false premise is now **recorded in the ledger as an established fact**, in an observation
   whose subject is *"nine findings, all real, all addressed."* That is the defect class this module
   has been correcting all week.
3. This edit is what moved the PLAN baseline a second time, from `db5296…` to `ba636440…`. The
   evidence re-run in §7 and both REBIND approval records exist because of it. An unnecessary change
   paid for a baseline move and two more HUMAN-authority records.

**Fix.** Restore the two entries on both suites. Do **not** add `env_keys` — that part of the
author's reasoning is right and should stay in the report. Correct the L-3 clause in the
remediation observation to say what `redact()` actually does.

---

### [MEDIUM] M-2 — REV-039 is absent from `reviews` and from the `PR_REVIEW` observations, although this commit adds its report

**Location:** `docs/supplier_management/00_harness_state.json` — `reviews`, `observations`;
`docs/supplier_management/implementation/39_rev_039_independent_review.md` (added by this commit, 691 lines)

**What is wrong.** The `reviews` array ends at REV-038. There is no REV-039 entry, and the last
`PR_REVIEW` observation is *"REV-038 APPROVED at ef1ed7d."*

Every previous review on this branch has both, including every CHANGES_REQUESTED one — REV-026,
REV-028, REV-030, REV-033, REV-035, REV-036, REV-037 all have a `reviews` record with
`reviewed_baseline`, `author`, `reviewer`, `status`, `open_critical`, `open_high`, and a matching
`PR_REVIEW` observation. REV-039 has neither, while its report file is committed here and its nine
findings are the entire subject of this commit.

**What I ran.**

```
python3 → len(state['reviews']) = 38, last id = REV-038
          PR_REVIEW observations: 16, last subject = "REV-038 APPROVED at ef1ed7d…"
          grep 'REV-039' over state['reviews'] → no match
verify_gate MERGE_READY → PR_REVIEW_MISSING gate/pr
```

**Why it matters.** REV-039 was CHANGES_REQUESTED with 2 High, so it would not have counted as a
`good_review` regardless — this costs nothing at the gate today. What it costs is the record. The
ledger currently says TASK-034 went from implementation straight to this commit; nothing
machine-readable says an independent review found nine issues at `64ef1fc` and that two of them were
High. The traceability matrix and anyone reading `reviews` to reconstruct the review history of
SUP-CAP-03 will not see the round that mattered most.

**Fix.** Add the REV-039 `reviews` entry (`reviewed_baseline` `77ab26aa…`, the hash that was live
when it was performed — note that it will therefore never match a recomputed design hash, which is
itself the honest record of H-1) and the corresponding `PR_REVIEW` FAIL observation at `64ef1fc`,
following the REV-035/036/037 shape.

---

### [LOW] L-1 — `DEV-T34-CACHE-PRIVATE` cites only the task's verification criterion; design §6.6 says the same thing and is not named

**Location:** `docs/supplier_management/00_harness_state.json` (`DEV-T34-CACHE-PRIVATE.source_ref`),
`docs/supplier_management/03_design_spec.md:384`

The deviation record quotes `05_development_tasks.md`'s *"Manual header check"* line and stops there.
But design §3.3 / §6.6 states it as a design property:

> `完整值必須經獨立 POST .../reveal 取得；response 設 Cache-Control: no-store, private、Pragma: no-cache…`

That sentence is the authoritative one, and it is the one the next person will diff the code against.
The sibling record `DEV-T34-EXPIRES-IN` *does* name design §6.6 explicitly — so the omission is an
inconsistency between two records written in the same commit, not a policy.

Amending the design spec is not available: it would move the DESIGN baseline `e4083319…` and strand
the 28 reviews this commit just spent a manifest revert to save. Which is precisely why the
deviation record is the only place that annotation can live, and why it needs to name §6.6.

**Fix.** One clause in `DEV-T34-CACHE-PRIVATE.source_ref` naming `03_design_spec.md:384`.

---

### [LOW] L-2 — Two comments in `supplierBankSchemas.js` still tell the pre-remediation story

**Location:** `server/src/handlers/suppliers/supplierBankSchemas.js:182-185`, `:176-181`

```js
 * Reveal 係唯一一個講得出帳號嘅 response，所以佢係唯一一個需要
 * `Cache-Control: no-store, private` 同 `Pragma: no-cache` 嘅 route.
…
 * 呢個偏離記錄咗喺實作報告。          // expiresInSeconds
```

The handler's own comment was rewritten thoroughly and honestly; this file was not touched. A reader
who opens the schemas first — which is the file the module's own §1 table points them at as the
place the three defences live — gets "reveal needs `no-store, private`" with no hint that it does not
get it, and is told the `expiresInSeconds` deviation lives only in a narrative report, which stopped
being true in this same commit (`DEV-T34-EXPIRES-IN`).

**Fix.** Two lines: point both at the ledger records.

---

### [LOW] L-3 — The implementation report cites a ledger record `CORRECTION-REV-039-H1` that does not exist

**Location:** `docs/supplier_management/implementation/38_task_034_bank_api.md:173`

> *"兩處假陳述已更正 —— 見 §6 同 ledger 嘅 `CORRECTION-REV-039-H1`。"*

```
grep -rn "CORRECTION-REV-039-H1" docs/  → 1 hit, and it is that line
```

The correction *is* in the ledger — as an observation whose subject is *"REV-039 H-1: a manifest edit
moved the DESIGN baseline and two records said it did not."* Observations in this schema have a
`subject`, not an id, so a reader following the citation finds nothing by that name. In a report
whose §6 is itself a correction of a false statement, a dangling citation is the wrong kind of
detail to get wrong.

**Fix.** Cite the observation by its subject.

---

### [LOW] L-4 — `state.baseline.default_commit` is stale, so the boundary check attributes twelve other modules' files to this one

**Location:** `docs/supplier_management/00_harness_state.json` — `baseline.default_commit`

It still reads `ad21c1f22cd027171791fa3a26a9b558ccc91086`, but the branch merged `main` at `64ef1fc`
and `main` is now `71616ec`. `check_boundary` uses `default_commit` as its base outside
TEST_AND_VERIFY (`harness_checks.py:298-300`), so every items_management file that arrived with the
merge is presented as a change this module made.

**What I ran.**

```
verify_gate MERGE_READY (base = recorded default_commit ad21c1f):
  SCOPE_APPROVAL_REQUIRED × 9   (docs/items_management/**, server/config/itemRecoveryTrustPolicy.json)
  OUTSIDE_MODULE          × 3   (.github/workflows/ci.yml,
                                 server/scripts/runItemRecoveryAcceptance.js,
                                 server/src/modules/item/itemRecoveryAcceptance.js)

validate_module_boundary --base 71616ec (the actual current main):
  BLOCKED
  OUTSIDE_MODULE changes/.github/workflows/ci.yml: not in allowed_write_paths
  — and nothing else.
```

Carried, not introduced — it was equally stale at the REV-039 head, and REV-039 worked around it by
passing `--base 71616ec` by hand. Raising it now because it interacts badly with L-5: the one
`OUTSIDE_MODULE` the Product Owner is said to have accepted is currently buried among eleven lines of
noise from another module, and separating them requires knowing to override the base.

**Fix.** Reconcile `default_commit` to the merged `main` (`71616ec`) as part of the same
bookkeeping pass.

---

### [LOW] L-5 — The `OUTSIDE_MODULE` on `ci.yml` is not as harmless as the report says: it severs the machine-checked link between the approval and the file

**Location:** `docs/supplier_management/00_module_manifest.json:48` (the removed line),
`APPROVAL-HD-030-SCOPE-REBIND.scope`, `38_task_034_bank_api.md` §6

The report calls it *"一個本機 path 一致性檢查嘅發現"* — a local path-consistency finding — and the
approval record calls it *"a local path-consistency finding on a file they had already approved."*
Both understate it by one step. This is what actually changed:

| | before the revert | after |
| --- | --- | --- |
| issue code for `ci.yml` | none — `SCOPE_APPROVAL_REQUIRED` satisfied | `OUTSIDE_MODULE` |
| what satisfies it | `approval_valid(…, kind='SCOPE', subject='.github/workflows/ci.yml')` | nothing; the code path is not reached |
| `validate_module_boundary --base 71616ec` | `LOCAL_CHECKS_PASS` (REV-039 measured this) | `BLOCKED` (I measured this) |

`check_boundary` (`harness_checks.py:118-124`) consults approvals **only** for paths that match
`approval_required_paths`. A path outside `allowed_write_paths` and outside
`approval_required_paths` short-circuits to `OUTSIDE_MODULE` without any approval being examined.
So `APPROVAL-HD-030-SCOPE-REBIND` still names `.github/workflows/ci.yml` in its `scope` array, but
nothing in the toolchain reads it for that purpose any more. The link is now prose.

`OUTSIDE_MODULE` is also the same issue code an arbitrary unapproved out-of-module write produces.
Every future reviewer of this branch must hand-distinguish the sanctioned one from an unsanctioned
one, permanently, and with L-4 unfixed there are already three on the same screen.

**I still think the trade was right** — 28 reviews and a live DESIGN approval are worth more than
one machine-checked path link, and the alternative cost was quantified correctly. The finding is
that the records describe the cost as smaller than it is, on the same page where the author is
correcting themselves for describing a cost as smaller than it was.

**Fix.** State the cost accurately in the approval record: the boundary validator no longer consults
the approval for this path and now returns `BLOCKED` rather than `LOCAL_CHECKS_PASS`; every
`OUTSIDE_MODULE` on this branch must be triaged by hand from here on.

---

## The three judgments REV-040 was asked to make

### Is removing the `setHeader` the right reading of "record the deviation"? — Yes.

Leaving a `res.setHeader("Cache-Control", "no-store, private")` that the framework discards one call
later is a line of code that asserts a property the system does not have. That is the exact defect
class this module has found in itself repeatedly, and it is worse than the deviation it was papering
over. Removing it is right.

It does **not** make the code look correct. I checked that specifically rather than taking it on
trust: the handler comment states the criterion is unmet and says what would have to change to meet
it; the ledger carries `DEV-T34-CACHE-PRIVATE` at `status: FAIL`; the task's checkbox in
`05_development_tasks.md:1268` is still unticked; and the unit test now *pins the absence*:

```
MUTATION D — put the setHeader back
✖ reveal sets the one cache header the framework does not overwrite
  AssertionError: setting it here would be a no-op the framework discards; see the handler comment
    actual: 'no-store, private',  expected: undefined
```

A future author who re-adds the dead line is told, by a failing test, that it is dead. That is a
stronger guarantee than the original code had.

### Is the `assert.equal` on the wire header a test that will age well, or a landmine? — A tripwire, correctly aimed and correctly labelled.

I mutated the framework in both directions:

```
MUTATION C2 — sendSuccess stops setting Cache-Control at all
✖ AssertionError: 見 DEV-T34-CACHE-PRIVATE：private 過唔到線；紅咗即係框架改咗，去收個偏離記錄
    actual: null,  expected: 'no-store'

MUTATION C1 — sendSuccess upgraded to "no-store, private"
✖ same assertion
    actual: 'no-store, private',  expected: 'no-store'
```

`assert.match(/no-store/)` — the obvious "safer" alternative — would have caught C2 and **silently
survived C1**, which is the case that matters: the deviation would drift shut with nobody closing the
record. `assert.equal` catches both, and its failure message names the record to close. That is what
a deliberate landmine looks like when it is placed by someone who intends to be woken by it.

Two caveats, neither enough to change the judgment:

1. A framework-wide hardening of `apiResponse.js` will fail one supplier test, in Cantonese, for a
   team that may not read Cantonese. I checked the blast radius — under C1 the *only* additional
   failure across `server/test/**` is this one test (1937 tests, 4 fail vs 3 pre-existing). One test,
   one clear message, pointing at one record. Acceptable.
2. Nothing outside this assertion references `DEV-T34-CACHE-PRIVATE`'s closure procedure. If a future
   author deletes the assertion instead of fixing the record, the record goes stale silently. **PLAUSIBLE** —
   I did not test for it, and it is inherent to deviation records generally.

### Is the `DEV-T34-CACHE-PRIVATE` FAIL observation honest? — Yes, and it breaks nothing.

The `source_ref` states the criterion is not met, does not claim the security property is lost (it
correctly argues `no-store` is strictly stronger than `private` under RFC 9111 §5.2.2.5, which is
right), admits the original test *could not have* caught it, and says `status: FAIL` is intended. I
found nothing in it that overstates.

On whether a FAIL observation breaks a gate the author did not notice — it does not, and I traced
every consumer rather than assuming:

```
grep 'observations' over ~/.claude/skills/software-engineering-harness/scripts/*.py
  harness_checks.py:60   timestamp sanity only, status not read
  harness_checks.py:241  _observation(), the only status-sensitive reader

_observation() call sites:
  :365  MANUAL_TEST with subject = a UAT case id   (UAT_EXECUTION / BUSINESS_ACCEPTANCE / RELEASE gates)
  :369  CI      (subject=None)
  :371  PR_REVIEW (subject=None)
  :373  MERGE   (subject=None)

uat_tests ids = UAT-001 … UAT-055
subjects of the two new FAIL observations collide with none of them.
observation status counts: MANUAL_TEST PASS 65 / FAIL 9, CI PASS 15 / FAIL 2 / BLOCKED 1,
PR_REVIEW PASS 13 / FAIL 3 — FAIL observations are long-established here.
```

A `MANUAL_TEST` FAIL is only consulted when its subject is a mandatory UAT case id, and
`_observation` for the subject-less kinds filters on `kind` first. Neither deviation can be selected
by any gate. Verified, not reasoned.

---

## Attacks that failed

Recorded because a review listing only what broke says nothing about coverage. All against a real
Node application on an ephemeral port, real MySQL, real JWTs and real scrypt hashes.

### N-1 — The REV-039 M-2 mutation is dead

The exact mutation that survived REV-039 — change only the password on the unauthorised reveal:

```
✖ the Bank routes answer over real HTTP, and the masked list leaks nothing
  AssertionError: a wrong password also yields 403; this must be the authorization layer refusing,
                  not the password check
    actual: 'PASSWORD_INVALID',  expected: 'Forbidden'
```

### N-2 — Weakening the reveal policy is caught twice, and the service layer still refuses

Mutated `BANK_REVEAL_POLICY` from `["supplier.view","supplier.bank.view"]` to `["supplier.view"]`:

```
✖ reveal demands view plus bank.view, and deliberately not bank.mgmt
    actual: ['supplier.view'],  expected: ['supplier.view','supplier.bank.view']
✖ the Bank routes answer over real HTTP …
    actual: 'BANK_PERMISSION_LOST',  expected: 'Forbidden'
```

The second line is the interesting one: with the route policy disarmed the request reached the
service, and `SupplierBankService.#assertMay` refused it against the database. Two independent
layers, and the HTTP test discriminates between which one fired.

### N-3 — Forged claims do not survive the service layer, over real HTTP

Issued a JWT claiming `supplier.view + supplier.bank.view` for a user whose database role grants only
`supplier.view`, then revealed with the correct password:

```
PROBE forged-claims reveal : 403 {"code":"PERMISSION_STALE","message":"權限已變更，請重新整理"}
PROBE leaks secret?        : false
```

Then granted the permission for real and repeated:

```
PROBE honest reveal        : 200 ['id','accountNumber','revealedAt']
```

REV-039 asserted this structurally. It is now measured.

### N-4 — IDOR is refused as 404, and the other Supplier's list is empty

Same probe, revealing a bank account id owned by Supplier A through Supplier B's path:

```
PROBE IDOR (other owner)   : 404 {"code":"SUPPLIER_BANK_NOT_FOUND","message":"找不到這項供應商銀行帳戶"}
PROBE IDOR leaks secret?   : false
PROBE other supplier list  : {"items":[]}
PROBE audit actions        : supplier.bank.create,supplier.bank.reveal
```

Not 403 (which would confirm existence), not 200. The reveal query binds
`WHERE id = ? AND supplier_id = ?`, so ownership is a SQL predicate, not a check.

### N-5 — The step-up password is not a free brute-force oracle

Seven consecutive wrong passwords through the reveal route, then the correct one:

```
PROBE brute force attempts : 403:PASSWORD_INVALID × 7
PROBE failed/locked        : 5 LOCKED
PROBE correct pw while locked: 403 PASSWORD_INVALID
```

`UserService.#checkPassword` is shared with login: `MAX_FAILED_ATTEMPTS = 5`, `LOCKOUT_MS = 15 min`,
a fixed `LOCKOUT_RESPONSE_DELAY_MS = 86` while locked so timing does not distinguish locked from
wrong, and a dummy scrypt burn for unknown users. The counter stopped at 5 rather than 7 because a
locked account is not compared against — correct. A correct password while locked is still
`PASSWORD_INVALID`, so the lock state is not disclosed.

One consequence worth stating and not raising: a stolen JWT can lock its own user out of *login* for
15 minutes by spamming reveal. A stolen JWT is already a compromised session, so this buys an
attacker nothing they do not already have.

### N-6 — `command(req)`'s new ordering is protective, demonstrated rather than argued

REV-039 L-2 was a latent hazard nobody could reach, because every Bank body schema is
`additionalProperties: false`. I removed that one obstacle to see whether the ordering does what the
comment claims. Added `supplierId: { type: "integer" }` to `BANK_REVEAL_SCHEMA` and sent
`supplierId: 999999` in the reveal body:

```
BODY-FIRST  (as shipped)              → 200, reveal succeeds, path parameter wins
BODY-LAST   (pre-remediation ordering) → 404 SUPPLIER_BANK_NOT_FOUND
                                          the body's 999999 reached the SQL predicate
```

So the fix is real: with the schema opened, the caller-supplied value would have overridden the
route parameter on the way into both the ownership check and the bank audit record. The schema is
the first barrier and the ordering is the second, and they are now both present rather than one.
I also confirmed no route regressed — no Bank body schema declares any of `actorId`, `claimedRoles`,
`claimedPermissions`, `supplierId`, `bankAccountId`, `requestId` or `ip`, and the full suite is green.

### N-7 — The L-1 config pin discriminates, and there is no runtime path around it

The author claimed to have verified this. I verified it independently, in both flags:

```
validateInProduction: true → false   ✖ the shipped config leaves output validation on…  actual false
enabled:              true → false   ✖ same test                                        actual false
```

And I checked the claim is actually worth making, which the author did not state: `config/request.js`
contains **no** `process.env` reference, and `applicationConfiguration.js:10` imports it statically.
`normalizeResponseValidationConfig` computes
`runtimeEnabled = enabled && (environment !== "production" || validateInProduction)`, so pinning both
literals pins `runtimeEnabled = true` in every environment. There is no env override to slip through.
The pin covers the runtime, not just the file.

### N-8 / N-9 — The M-3 reveal assertions are not vacuous

```
MUTATION — skip the audit.record in SupplierBankService.reveal
✖ reveal round-trips through real MySQL and leaves an audit row behind   actual undefined
✖ the Bank routes answer over real HTTP …
    AssertionError: a reveal over HTTP leaves exactly one audit row       actual 0, expected 1

MUTATION — reveal returns a masked value instead of the plaintext
✖ reveal round-trips through real MySQL …                                actual '••••REV040'
✖ the Bank routes answer over real HTTP …
    AssertionError: AC-024: bank.view really does get the account         actual '••••REV040'
```

The `assert.equal(audits.length, 1)` also pins *exactly one* — a double-write would fail it — and the
supplier row is freshly seeded per run, so the count is not inherited. The second principal is the
same user with the role escalated mid-test rather than a genuinely separate user; that is weaker than
the report's wording ("第二個 principal") suggests, but it exercises the same code path and the
escalation is what makes the before/after 403→200 pair meaningful. Not a finding.

### N-10 — The evidence is real, current, and reproduces exactly

```
spec_baseline       ba636440…  == recomputed PLAN            (all four)
source_fingerprint  63cc99cd…  == fingerprint at this head   (all four)
code_commit         64ef1fc…   — DEVELOPER stage, and evidence_issues only pins code_commit
                                 for non-DEVELOPER stages (harness_checks.py:168)
artifacts           byte length and sha256 verified for all 8 files — all OK
counts              393/393/0/0/0, and the junit XML contains 393 <testcase> elements
```

Re-ran the recorded argv verbatim, in this worktree, with the documented environment:

```
ℹ tests 393   ℹ pass 393   ℹ fail 0   ℹ skipped 0
```

Exactly reproduced. The integration tests really ran — `the Bank routes answer over real HTTP` is in
the XML at `0.842008s`, alongside eleven other `supplierBank.integration.test.js` cases, and the
suite forwards `DB_INTEGRATION_TESTS` in its `env_keys`. The 392→393 delta against the previous
evidence set is exactly the one new test this commit adds.

The four stale runs (`20260921T0844*`, bound to `db5296…`) are **retained** on disk and in
`evidence_files` (82 → 86 entries, append-only satisfied). H-2 is closed on the merits, and closed
the honest way: the author did not rely on the coincidence that reverting the manifest returned PLAN
to the hash the old evidence already carried — they re-ran all four because the source had changed
again. That is the right call and it is stated as such in §8.

### N-11 — Three test failures in this worktree are pre-existing and belong to another module

```
node --test 'server/test/**/*.test.js' on the unmodified head:
  ℹ tests 1937  ℹ pass 1932  ℹ fail 3
  ✖ TC-008 Item 層級 media …            server/test/integration/itemMedia.integration.test.js
  ✖ TC-001 Item migrations 0010-0026 …  server/test/integration/itemMigrationIdempotency.integration.test.js
  ✖ TC-016 adapter verifies …           server/test/integration/itemRecoveryAcceptance.integration.test.js
```

None is in `supplier-phase-001-server`'s argv, none is a supplier file, and CI's
`Test (server + client, MySQL integration)` is green on this exact head — so they are local
environment artefacts of the items module, not a regression from this branch. Recorded so that the
next person running the full glob here does not attribute them to TASK-034. HD-025 already covers the
standing policy for item failures on supplier PRs.

### N-12 — `DEVELOPER` gate suites for PHASE-003 do not exist yet, which is planned, not omitted

```
traceability PHASE-003 developer_suites:
  lint, client-build, supplier-server-integration, supplier-bank-security,
  supplier-security, supplier-client-ui

verify_gate MERGE_READY:
  REQUIRED_RUN_MISSING × 4  (supplier-server-integration, supplier-bank-security,
                             supplier-security, supplier-client-ui)

their argv point at:
  server/test/supplier-management            → does not exist
  server/test/supplier-management/bank       → does not exist
  server/test/supplier-management/security   → does not exist
  client/test/supplier-management.vitest.config.js → does not exist
```

Those are the formal TEST_AND_VERIFY suites, to be authored later in PHASE-003. The report's §7
evidence table (the two `supplier-phase-001-*` suites plus lint and client-build) is therefore not
the phase's developer set, and MERGE_READY cannot be satisfied for PHASE-003 until those suites
exist. Not a finding against this commit — carried, structural, and consistent with this module's
standing note that MERGE_READY cannot be fully green. Flagged so it is not re-derived at T35.

### N-13 — Minor observations that did not rise to findings

- **`list({ includeInactive })`** is unreachable over HTTP: the list route's query schema is
  `EMPTY_BANK_SCHEMA` and the handler does not forward it, so a deactivated account can never be
  listed. Design §6.6 and §3.3 require no such listing, so this is dead flexibility in the service
  rather than a deviation.
- **Design §6.6 names the path parameter `:bankId`; the implementation uses `:bankAccountId`.** The
  URL shape is identical; parameter names are not part of the wire contract.
- **The test's `role_permissions` inserts are not explicitly deleted**, but
  `fk_role_permissions_role … ON DELETE CASCADE` (`0003_add_auth_tables.js:128`) removes them with the
  role. No leak. Checked because the M-3 remediation adds a second insert.
- **`redact()` replaces the whole environment value**, so it would scrub the JSON key-ring blob but
  not a bare 44-character key printed on its own. The author's base64 sweep is what covers that case,
  and unlike the first attempt it was shown to discriminate. Worth knowing when reasoning about M-1:
  restoring the entries buys the blob, not every possible rendering of a key.

---

## Positive observations

- **Every one of the nine REV-039 findings is genuinely closed, and I killed each with a mutation
  rather than reading the diff.** Nine for nine. That is not the usual outcome of a remediation round.
- **The H-1 mechanical fix is exactly right.** Superseded records retained unrewritten, the
  superseding relationship stated in the new record, the false `source_ref` corrected by a separate
  record rather than edited in place, and the design baseline verified back at `e4083319…` with 28
  reviews and `APPROVAL-HD-017-DESIGN` live again.
- **The author did not take the free pass on H-2.** Reverting the manifest happened to return PLAN to
  the hash the four stale evidence runs already carried. They re-ran all four anyway, because the
  source had moved. Recorded in §8 as a coincidence deliberately not relied on.
- **The self-correction in §6 is complete and unflinching**, including the sentence that made the
  false claim and why it was false, and including the note that this is the fourth time a manifest
  edit has stranded records in this module.
- **Two independent authorization layers, both measured over real HTTP** (N-2, N-3): the route policy
  reads JWT claims, the service re-reads roles and permissions from the database inside the
  transaction. A forged claim set gets `PERMISSION_STALE`; a disarmed route policy still gets
  `BANK_PERMISSION_LOST`.
- **The step-up path inherits login's lockout, timing equalisation and dummy-hash burn** (N-5). The
  most sensitive route in the module did not have to reinvent any of it.
- **`assert.equal` over `assert.match` on the cache header, with a failure message naming the record
  to close.** The reasoning in §4 for that choice is correct and I verified it in both directions.

---

## Recommendations

1. Fix H-1 before merge. Record the four decisions this commit attributes to the Product Owner the
   way HD-001 through HD-031 are recorded. The gate cannot check this; only the discipline can.
2. Fix M-1 before merge. Restore the two `redaction_env_keys` entries and correct the ledger clause.
   A false statement recorded inside an observation titled *"nine findings, all real, all addressed"*
   is the worst possible place for one.
3. Fix M-2 before merge — one `reviews` entry and one `PR_REVIEW` observation. It costs nothing at
   the gate and it is the only durable record that this task took two rounds.
4. The Lows are a single documentation pass and can ride with the above.
5. Standing, for T35 and beyond: `redaction_env_keys` and `env_keys` are independent. `redact()`
   scrubs the *runner's* environment out of captured output; `env_keys` decides what the child
   process receives. A suite that boots the real API gets the Bank keys from `server/.env` via
   dotenv regardless of either. Worth writing into the module's notes, because this review and the
   last one both got it wrong in different directions before checking.
6. Also standing, and this one is now demonstrated rather than asserted (N-6): on any route that
   writes an audit record, spread the request body **first**. The schema is what makes it
   unreachable today; the ordering is what makes it unreachable when someone widens the schema.

---

## Review hygiene

- Mutations run, each reverted immediately after its run, `git status --porcelain` empty in between:
  the M-2 password, `BANK_REVEAL_POLICY`, `apiResponse.js` in two directions, the handler's
  `setHeader`, `config/request.js` in two flags, the reveal audit write, the reveal return value, and
  `command(req)`'s spread order paired with a loosened `BANK_REVEAL_SCHEMA`. Twelve in all.
- Two probe tests were appended to `server/test/integration/supplierBank.integration.test.js` (forged
  claims / IDOR, and step-up brute force) and reverted with `git checkout --`. Both cleaned up their
  own database rows in `t.after`.
- Scratch scripts were written to the session scratchpad outside the repository. The only file left
  inside the repository by this review is this report.
- `git status --porcelain` was empty before the review, after every revert, and immediately before
  this report was written.
- Head under review never changed: `1de07da89a1fec2eb8a753f99cb9779b8f9d50cd` throughout. Nothing was
  committed.
- Nothing was fixed. Every finding above is a description and a proposed fix, not an edit.
