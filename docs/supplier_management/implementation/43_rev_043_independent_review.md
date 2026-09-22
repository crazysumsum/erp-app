# REV-043 — TASK-034 Bank API, REV-042 remediation independent review and merge decision

**Review:** REV-043 ・**Task:** TASK-034 (T34) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `b9a6610661c7f409f5eeda940ffeae8587f52aa6` (`claude/supplier-task-034`, PR #123) — the
merge candidate.
**Diff base for the remediation:** `70344c590aab758acb7446977e3f20759a0783de` (the REV-042 head); the
whole TASK-034 change (`main…HEAD`) was read as well, because this is the merge decision.
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-034`
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.
**Baselines recomputed at this head:** DESIGN `e4083319…` (matches the state file), PLAN `db529678…`
(matches), source fingerprint `b13f672c…` (matches), revision 186 (as expected).

**Verdict: APPROVED** — 0 Critical, 0 High, 0 Medium, 2 Low, 4 Info. Nothing blocks.

**All five REV-042 findings are remediated correctly, and for the first time in six rounds I could not
find a defect introduced by the previous round's remediation.** I went looking for it first, in the
shape the brief predicted — a correction applied in one collection and re-committed in another — and
it is not there. The structural diff of the ledger between the two heads contains exactly four
in-place edits and three appends, every one of them sanctioned by a REV-042 finding, and nothing else
in any collection moved.

The two Low findings below are both **pre-existing** and neither was introduced by this branch. I am
raising them because the brief asked what actually ships and one of them concerns the reveal endpoint,
not because a sixth round needs a yield. Neither should hold the merge.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| **Low** | **2** — cross-supplier ownership is unpinned on all four child routes; the `command()` field-precedence defence is unpinned |
| Info | 4 |

CI: verified independently, not accepted. `gh run view 35675946352` reports `headSha`
`b9a6610661c7f409f5eeda940ffeae8587f52aa6`, `conclusion: success`, `status: completed`,
`event: pull_request`, **`attempt: 1`**. `gh run list --commit b9a6610…` returns **exactly one** run —
that one, no reruns. `gh pr checks 123` shows all four green (Build frontend 23s, Dependency audit 16s,
Lint 25s, Test + MySQL integration 4m8s). PR #123 is `OPEN`, `MERGEABLE`, `mergeStateStatus: CLEAN`,
base `main`, `headRefOid` equal to the merge candidate. `origin/main` was re-fetched during this review
and is still `71616ec040a7558856083035801554dda940ab5e`; `git merge-base origin/main HEAD` equals it,
so the target has not moved and `default_commit` is current. Every claim in the brief about this run
checks out.

Everything below states what I ran. Anything reasoned about but not executed is marked **PLAUSIBLE**.
Every mutation was reverted immediately; `git status --porcelain` was empty before the review, after
every revert, and before this report was written. The head never moved and nothing was committed.

---

## The five claimed remediations, verified independently

I recomputed `Context.baselines()` and `fingerprint()` in **eight detached worktrees**, one per head
involved, rather than reading any number out of a previous report:

```
head       design      plan        fingerprint  revision   state baseline block (commit / fp)
64ef1fc    77ab26aa    f701e9b0    acaa7efb     171        dd3b298 / 4ea061ee
1de07da    e4083319    ba636440    63cc99cd     173        64ef1fc / 63cc99cd
80bbb95    e4083319    db529678    fff22d41     177        1de07da / fff22d41
70344c5    e4083319    db529678    c9b9fe38     181        80bbb95 / c9b9fe38
b9a6610    e4083319    db529678    b13f672c     186        70344c5 / b13f672c   (HEAD)
d161a6a    e4083319    a0d41e31    97ce4888     156
6134836    e4083319    a0d41e31    0e5ce6b5     158
a7472b7    e4083319    a0d41e31    e86a87ae     160
```

### M-1 — the three `PR_REVIEW` observation triples — **holds**

The REV-039 and REV-040 observations now carry `code_commit 80bbb954…`, joining REV-041, and all three
read `(80bbb95, db529678, c9b9fe38)`. The reviewed head is named in `subject` and at the top of
`source_ref`, and each record states that it was corrected and why.

**That triple is exactly the `baseline` block committed alongside it at `70344c5`** — see the right-hand
column above. It is also precisely what `_observation` (`harness_checks.py:235-250`) compares against:
`current_commit()`, `ctx.baselines()['plan']` and `fingerprint()` at the moment of writing. The new
REV-042 `PR_REVIEW` record and the two new `MANUAL_TEST` records all carry `(70344c5, db529678,
b13f672c)`, which is likewise the `baseline` block at this head. Four for four against the harness's
own semantics.

The gate confirms the deviation costs nothing and is not being used to buy anything:

```
verify_gate MERGE_READY  →  BLOCKED
  PR_REVIEW_MISSING      x1   (still reported at this head — the standing condition)
  TASK_INCOMPLETE        x18
  REQUIRED_RUN_MISSING   x4
  CI_MISSING_OR_STALE    x4
  COMMIT_CHANGED         x1
  OUTSIDE_MODULE         x1   (ci.yml — the accepted HD-032 cost)

  REVIEW_NOT_SATISFIED        — NOT reported; good_reviews non-empty via REV-038
  APPROVAL_MISSING_STALE      — NOT reported; DESIGN and PLAN approvals valid
  BLOCKING_DEFECT             — NOT reported; no open Critical/High defect
  HUMAN_DECISION_REQUIRED     — NOT reported; no open MAJOR decision
  ARTIFACT_TAMPERED/MISSING   — NOT reported
  UNKNOWN_EXTERNAL_ACTION     — NOT reported
```

See **N-4** for a correction to the *rationale* REV-042 gave for this convention. The remediation is
right; one sentence of the reasoning behind it does not generalise, and that is worth writing down so
round seven does not rediscover it as a defect.

### L-1 — the review count in `HD-032.answer_ref` — **holds; 28 verified**

The field now reads 28 and says the live count moves every round and is not tracked here. I counted
`reviews` by `reviewed_baseline` at every head:

```
64ef1fc   38 reviews, e4083319 x28   ids REV-011..REV-038, REV-038 present
1de07da   38 reviews, e4083319 x28   ids REV-011..REV-038, REV-038 present
80bbb95   40 reviews, e4083319 x30
70344c5   41 reviews, e4083319 x30 + 77ab26aa x1
b9a6610   42 reviews, e4083319 x31 + 77ab26aa x1   (HEAD)
```

HD-032 was decided between `64ef1fc` (design `77ab26aa`, declaration present) and `1de07da` (design
`e4083319`, declaration reverted). At both of those heads the count bound to `e4083319` was **28**,
including REV-038. The figure recorded is the figure that was in front of the Product Owner. Correct.

### L-2 — `HD-032.question` restored — **holds, byte for byte**

`sha256` of the `question` string:

```
80bbb95   b384ab003307…     "the module's only DESIGN-kind approval"
70344c5   e8bb752b6949…     "the only one of the module's seven DESIGN-kind approvals bound to…"
b9a6610   b384ab003307…     restored — identical to 80bbb95
```

Exact restoration, not a paraphrase. Both corrections now live in `answer_ref` alone, and `answer_ref`
states the original wording, says the sentence "stands as asked and is wrong as written", and cites
REV-041 and REV-042 L-2 for each half.

**And nothing else in the module was rewritten rather than superseded.** I diffed the two ledgers
structurally rather than by text, comparing every record in every collection by index:

```
revision        181 -> 186
baseline        code_commit + source_fingerprint advanced  (normal)
reviews         41 -> 42    appended REV-042, no record modified
observations   129 -> 132   appended 3
  ! observations[123] REV-039 PR_REVIEW   fields changed: code_commit, source_ref   (M-1)
  ! observations[124] REV-040 PR_REVIEW   fields changed: code_commit, source_ref   (M-1)
  ! observations[127] REV-041 MANUAL_TEST fields changed: source_ref                (L-4)
  ! pending_decisions[30] HD-032          fields changed: question, answer_ref      (L-1, L-2)
evidence_files  94 -> 98    appended 4
approvals / defects / external_actions      no change of any kind
```

Four in-place edits, every one of them the subject of a REV-042 finding. Thirty-eight approvals, 21
defects and 51 external actions untouched. No duplicate ids in any collection.

### L-3 — `deepFreeze` — **holds; I found no unfrozen node**

I walked every export of `supplierBankSchemas.js` at every depth myself, including non-enumerable own
properties, with my own cycle guard rather than the file's:

```
exports walked: 14
UNFROZEN NODES: SUPPLIER_ID_PARAMS_SCHEMA.required
                SUPPLIER_ID_PARAMS_SCHEMA.properties
                SUPPLIER_ID_PARAMS_SCHEMA.properties.id
count: 3 — all of them the re-export from supplierSchemas.js, out of this file's scope
```

Every node of all thirteen schemas and policies this file owns is frozen. The node REV-042 found open
is closed, and I attacked it four ways rather than reading `Object.isFrozen`:

```
MASKED_BANK_WITH_WARNINGS_SCHEMA.properties.warnings.items.type          → refused (TypeError)
MASKED_BANK_WITH_WARNINGS_SCHEMA.properties.warnings.type                → refused (TypeError)
MASKED_BANK_WITH_WARNINGS_SCHEMA.properties.accountNumber                → refused (TypeError)
MASKED_BANK_WITH_WARNINGS_SCHEMA.properties.warnings.items.properties.x  → refused (TypeError)
```

**Can the `WeakSet` guard itself hide something?** No. `seen.add(value)` happens immediately before
`Object.freeze(value)` and before the recursion, so an object is never marked seen while still
unprocessed; the only thing the guard suppresses is a second visit to an object that was already fully
walked. It is strictly weaker than the old guard: `Object.isFrozen` short-circuits on a node *this call
did not freeze*, a `WeakSet` short-circuits only on a node *this call already handled*. Each top-level
`deepFreeze` call also gets a fresh `WeakSet`, so `BANK_WARNING_SCHEMA` — deep-frozen at its own
definition and then reached again through `MASKED_BANK_WITH_WARNINGS_SCHEMA` — is re-walked rather than
skipped. That is the exact behaviour the old guard lacked.

**Does the test discriminate?** Three mutations, each run against `test/supplierBankHandlers.test.js`
(15 green at the unmodified head) and each reverted:

```
MUT-1  restore BOTH the isFrozen guard AND the inner Object.freeze
  ✖ the masked schema cannot have an account field added to it at runtime        14/15
     actual: [ 'MASKED_BANK_WITH_WARNINGS_SCHEMA.properties.warnings' ]
MUT-2  restore ONLY the isFrozen guard, inner freeze stays removed
  ✓ 15/15 green — the control: with nothing pre-frozen in the chain there is no hole
MUT-3  add a new export that is not passed through deepFreeze
  ✖ same test, 14/15
     actual: [ 'MUT3_NEW_SCHEMA', 'MUT3_NEW_SCHEMA.properties', 'MUT3_NEW_SCHEMA.properties.x' ]
```

MUT-1 kills it and **names the exact node**. MUT-3 is the one that matters going forward: the rewritten
test asserts the invariant over every export rather than naming nodes, so a schema added next year is
covered without anyone remembering to extend the test. The old test would have passed MUT-3. MUT-2 is
the negative control — it shows removing the redundant inner freeze alone would have closed the hole at
this head, and that the `WeakSet` is defence against reintroduction rather than the fix itself. Both
changes were worth making; neither is redundant with the other.

### L-4 — the freeze's protective scope — **holds, and I measured it at the validator**

The comment and the ledger now both say `ajv.compile` at route registration makes post-registration
widening inert, and that the freeze covers module load through `createApplication`. REV-042 measured
this over real HTTP; I measured it one layer down, directly on `ResponseValidator`, which isolates the
mechanism from everything else in the request path:

```
A  before mutation, validator #1          : REJECTED (ResponseValidationError)
B  after  mutation, validator #1          : REJECTED   <- post-registration widening is inert
C  after  mutation, recompiled, same ajv  : REJECTED   <- ajv caches by schema object identity
D  after  mutation, NEW ResponseValidator : ACCEPTED   <- the canary crosses the wire
```

B is the claim and it holds. C is new and strengthens it: even an explicit recompile on the same Ajv
instance does not pick the mutation up. D is the negative control that keeps B from meaning "the freeze
is pointless" — a fresh `ResponseValidator`, which is what a second `createApplication` in the same
process builds, does compile the widened schema and does let the canary through. See **N-3**: this makes
the new wording very slightly *under*stated, in the safe direction.

---

## Findings

### [LOW] L-1 — Cross-supplier ownership is correct on all four child routes and pinned by nothing

**Location:** `server/src/modules/supplier/SupplierBankService.js:166-172` (`#rowForUpdate`, shared by
update / setDefault / deactivate) and `:543-550` (the `reveal` query); the coverage gap is in
`server/test/integration/supplierBank.integration.test.js`, which this branch extends.

`#rowForUpdate` carries a comment stating the property as a design rule:

> 借另一個 Supplier 嘅 route 去攞一個唔屬於佢嘅帳戶，同「搵唔到」冇分別。設計 §6.3 對所有 child
> route 定咗同一條規矩。

**The code is correct. I proved that by execution, not by reading.** I wrote a probe against real MySQL
that seeds two suppliers, creates a bank account under supplier B, and then drives all four child
operations through supplier A's route parameters with B's `bankAccountId`:

```
positive control — B's own route reveals it            : 200, plaintext returned
reveal     via A's route, B's account id : refused with SUPPLIER_BANK_NOT_FOUND
update     via A's route, B's account id : refused with SUPPLIER_BANK_NOT_FOUND
setDefault via A's route, B's account id : refused with SUPPLIER_BANK_NOT_FOUND
deactivate via A's route, B's account id : refused with SUPPLIER_BANK_NOT_FOUND
  and no refusal carried the plaintext in its error payload
```

**Nothing in the repository notices when that stops being true.** Two independent mutations, each run
against the entire supplier suite:

```
MUT-A  reveal query: drop "AND supplier_id = ?"            339/339 pass — survives
MUT-B  #rowForUpdate: drop "AND supplier_id = ? FOR UPDATE" 339/339 pass — survives
MUT-A+B together, against my probe                          probe FAILS:
       "AssertionError: reveal returned data across suppliers"
```

With MUT-A applied, `reveal` returns another supplier's decrypted account number through a borrowed
route, and the AAD binding does not stop it because `decryptAccountNumber` is passed `row.supplier_id`,
the row's own value. The 339-test supplier suite — including the 25 Bank-specific tests this branch
adds — does not go red. My probe does, which is what makes this a measured coverage gap rather than a
worry.

**Why this is Low and why it does not block.** The shipped behaviour is right, verified by execution on
this exact head. The service file is **unchanged by this branch** — `git diff main…HEAD` does not touch
`SupplierBankService.js`; it arrived under TASK-033 and was gated by REV-038. So this candidate neither
introduced the gap nor regressed it. It is a regression risk, not a live vulnerability, and blocking a
merge over a pre-existing untested invariant whose implementation I have just proven correct would be
manufacturing a finding.

**Why I am raising it anyway.** This branch adds 159 lines to exactly the file where the test belongs,
and that addition covers 401, masked-list non-disclosure, 403 with the specific error code, a successful
reveal, and the precise `Cache-Control` value — thorough work on authentication and authorisation that
stops short of ownership. The single highest-value property in the module is the one left unpinned, and
the fix is roughly thirty lines that run in 28 ms.

**Fix.** Add the two-supplier case to `supplierBank.integration.test.js`. The probe I ran is reproduced
in the review hygiene section below and can be lifted directly; it reuses that file's existing
`seedSupplier`, `serviceOn` and `cleanup` helpers and removes its own rows in `t.after`.

---

### [LOW] L-2 — `command()`'s field-precedence defence is unpinned, and its own comment says not to rely on the thing that is pinned

**Location:** `server/src/handlers/suppliers/supplierBankHandlers.js:47-70`

`command(req)` spreads `req.input.body` **first** so that a body field named `actorId`, `supplierId`,
`requestId` or `ip` cannot shadow the framework-measured value in a bank audit record. The comment is
explicit that this must not depend on the schema in another file:

> 稽核記錄入面邊個係「呼叫者講嘅」、邊個係「框架量到嘅」唔應該靠另一個檔案嘅一行 schema 嚟分。

**The ordering is not pinned by any test.** Inverting it — moving `...req.input.body` to last — leaves
all 25 Bank tests green:

```
MUT-C  spread body last, so it can shadow actorId / supplierId / requestId / ip
       25/25 pass — survives
```

**The primary control is pinned, and it discriminates.** I confirmed that separately so the finding
lands in the right place:

```
MUT-D  BANK_CREATE_SCHEMA additionalProperties: false -> true
  ✖ no request schema accepts an unknown field, on any Bank route        24/25
```

So today nothing can reach `command()` to exploit the ordering, and the barrier that makes that true is
tested. What is untested is precisely the second layer the author built *because* the first layer lives
in another file. Two independent regressions would be needed to forge an `actorId` in a bank audit row;
one of them would be caught, the other would not.

Also pre-existing in spirit — the same pattern and the same comment appear at
`supplierApprovalWithdrawHandler.js:48` — but the Bank handler is where it carries audit weight.

**Fix.** One assertion: build a fake `req` whose `input.body` contains `actorId`, `supplierId`,
`requestId` and `ip`, pass it through `command`, and assert the framework values win. It needs no
database.

---

## Notes that did not rise to findings

### [INFO] N-1 — Two observations bind a commit hash that does not exist, and have since before this branch

```
ledger:    e6ef483000000000000000000000000000000000
real:      e6ef483a3a6918d4b98a94eecd382cc04585e3da  ("docs(supplier): close TASK-031 and PHASE-002")
git cat-file -e e6ef4830…  →  fatal: Not a valid object name
```

Two `MANUAL_TEST` observations — the PHASE-002 exit gate and the PHASE-003 entry criteria — record a
seven-character abbreviation zero-padded to forty characters. It is not a prefix of the real commit, so
it resolves to nothing.

It is **out of scope for this merge**: `git log -S` puts its introduction at `087b268`
("docs(supplier): close PHASE-002, open PHASE-003 (HD-026)"), and both records are present in the ledger
at `main` (`71616ec`). This branch did not write them and does not touch them. It is also permanently
inert — both carry `spec_baseline a0d41e31` and `source_fingerprint 31ef4906`, two dead baselines, so
`_observation` can never select them.

I checked every `code_commit` in every collection and these two are the only unresolvable references.
`baseline.code_commit`, `baseline.default_commit` and `baseline.mode_entry_commit` all resolve. All 98
`evidence_files` exist on disk with no unlisted `run.json`, and every artifact in every one of them
matches its recorded size and `sha256` — zero tampered, zero missing.

Worth a separate ticket against `main`, not against this PR.

### [INFO] N-2 — REV-042's report states it adds no new occurrence of the CI key literals. It adds two

REV-042 §"the `ci.yml` key comment" ends: *"This report adds no new occurrence of either literal."*
`git grep -F` on each literal at this head returns three files each: `.github/workflows/ci.yml` (the
definition site), `41_rev_041_independent_review.md`, and `42_rev_042_independent_review.md` — the
report making the claim quotes both keys in its own evidence block.

No security impact: these are documented, committed, non-secret CI test keys in a public repository,
which is exactly what the `ci.yml` comment now says. I note it only because it is one more instance of
the class this chain keeps producing — a statement about an artefact that the artefact itself
contradicts — and because it is a small hygiene drift worth stopping: each round has now copied the
literals into one more tracked file. **This report deliberately does not reproduce either literal.**

Everything else about the keys re-checks out: `server/.env.example` ships all four variables empty with
a commented `<32 bytes base64>` recipe, and no workflow in the repository references a GitHub Actions
secret at all.

### [INFO] N-3 — L-4's new wording is now marginally under-stated, in the safe direction

The comment says the freeze defends "module load 到 `createApplication` 之間". Run D above shows a fresh
`ResponseValidator` — which is what every additional `createApplication` in a process builds, and the
test suite builds many — compiles from the schema object again. So the protected window is not the first
`createApplication` but **every** one. The freeze is worth slightly more than the comment now claims.

Understating a control's reach is not a risk and I would rather the wording erred this way than the way
REV-042 found it. No change needed; recorded so it is not "found" again from the other direction.

### [INFO] N-4 — The rationale REV-042 gave for the `PR_REVIEW` convention does not generalise, though its conclusion does

REV-042 established the convention by recomputing at the commit each prior record names and getting a
match three times out of three, and treated self-consistency-at-the-named-commit as the rule. That test
happens to pass for REV-036/037/038 **because `fingerprint()` excludes `docs_path`** and those three
remediation commits touched documentation only, so the working-tree fingerprint at write time equalled
the committed one.

REV-041's remediation commit touched code, so the two readings diverge, and the corrected records
inherit that:

```
recomputed AT 80bbb95        : plan db529678, fingerprint fff22d41
recorded on REV-039/040/041  : plan db529678, fingerprint c9b9fe38   (= the fingerprint of 70344c5)
```

By the "recompute at the named commit" test, the corrected records do not match. By the harness's actual
semantics they are right, and that is the test that matters: `_observation` compares against
`current_commit()`, `plan` and `fingerprint()` **at the moment of writing**, and the recorded triple is
identical to the `baseline` block committed in the same commit — a pairing of "previous commit, current
content" that every one of the eight `baseline` blocks I recomputed exhibits, and that
`harness_checks.py:166` sanctions explicitly for evidence.

So: the remediation is correct, and the record shape is the harness's own. I am writing this down
because a seventh round applying REV-042's stated test rather than the harness's semantics would report
these three records as a defect, and they are not one.

---

## Attacks and probes that failed

### N-5 — The evidence reproduces exactly

Re-ran the recorded `supplier-phase-001-server` argv verbatim in this worktree with the documented
environment:

```
ℹ tests 394   ℹ pass 394   ℹ fail 0   ℹ skipped 0
```

Exactly the count recorded in `evidence/20260922T012844-5be061f2d852/run.json`. All four new evidence
rows bind `code_commit 70344c5`, plan `db529678` and fingerprint `b13f672c` — the current baseline block.

### N-6 — No regression anywhere in the server from this round's changes

Full server suite at the unmodified head:

```
ℹ tests 1938   ℹ pass 1934   ℹ fail 2   ℹ skipped 2
  ✖ TC-001 Item migrations 0010-0026 …
  ✖ TC-016 adapter verifies a separately restored schema …
```

Same total REV-042 measured. Both failures are items-module, pre-existing, and named in the brief;
TC-008 passed this time, so that one is environment-flaky rather than deterministic. No supplier failure,
none in any suite this task's evidence runs. CI is green on this exact head.

### N-7 — The reveal endpoint still refuses everything it should

Beyond the ownership probe in L-1, the HTTP integration test this branch adds already drives, over a real
Node application against real MySQL with a real scrypt hash: 401 with no token; 200 masked with a
full-body sweep asserting the plaintext and every crypto field are absent; **403 with `error.code`
asserted to be `Forbidden` specifically** — REV-039 M-2's point, because a wrong password also yields
403 and a bare status assertion cannot tell the two apart; a successful reveal returning the account;
and `Cache-Control` asserted with `equal` rather than `match` so that the approved
`DEV-T34-CACHE-PRIVATE` deviation goes red if anyone changes the framework. That is the right set for
this layer, and the ownership case is the one thing missing from it.

### N-8 — The HTTP surface, read on its own merits

- The five write routes are `jwt-device-password` with `BANK_WRITE_POLICY`; reveal is `jwt-password`
  with `BANK_REVEAL_POLICY`; list is `BANK_VIEW_POLICY` (`supplier.view` only). All pinned by tests.
- **The list route declares no `authType`, deliberately** — the test asserts `authType === undefined`
  with the message *"a masked read needs no step-up"*. It resolves through `config/api.js:5`,
  `authType: "jwt"`, which is the repository-wide convention for plain authenticated reads
  (`supplierLifecycleHandlers.js` omits it the same way). Authenticated, not public. I checked this
  because an omitted auth declaration is worth checking, not because it looked wrong.
- Every route declares `query: EMPTY_BANK_SCHEMA`, so no query parameter reaches any Bank route,
  including the `includeInactive` the service supports and HTTP cannot set.
- `bankAccountId` is spread conditionally, so create and list cannot produce a `NaN` route parameter.
- The constructor has no fallback path — design §1700's fail-closed startup requirement expressed as
  code rather than as a comment.

### N-9 — The merge candidate's scope, and what is not in it

`git diff main…HEAD` touches **six** non-documentation files: `.github/workflows/ci.yml`,
`server/.env.example`, `supplierBankHandlers.js` (+218), `supplierBankSchemas.js`,
`supplierBank.integration.test.js` (+159) and `supplierBankHandlers.test.js`.

**The migration, the service and the crypto are already on `main`** — I confirmed
`server/database/migrations/0037_create_supplier_bank_accounts.js`,
`SupplierBankService.js` and `SupplierBankCrypto.js` all exist at `71616ec` and that none is modified by
this branch. The transaction handling, duplicate detection and AAD construction the brief asks about
shipped under TASK-032 and TASK-033 and were gated by REV-038. **This merge decision is about the HTTP
surface and nothing else**, and I have said so rather than implying I re-audited a layer that is not on
offer. What I did verify of that layer is stated in L-1 and N-7.

---

## Positive observations

- **The streak is broken, and it was broken by changing method rather than by trying harder.** The L-3
  test no longer names nodes; it asserts the invariant across every export at every depth. That is why
  MUT-3 — an export that did not exist when the test was written — goes red. Five rounds of "fix the
  instance" produced a defect each time; one round of "assert the property" did not.
- **The L-2 restoration is exact, and I could prove it with a hash rather than by reading.** Undoing an
  in-place edit completely, and moving the substance to the field that should have carried it, is a
  harder discipline than making the edit was.
- **The M-1 correction was verified at eight heads, and both records disclose that they were changed.**
  A reader of either record alone learns the reviewed head, the observing commit, and that a correction
  was applied and why.
- **The freeze rationale is now measured rather than asserted**, in both the code comment and the
  ledger, and it names the file and line of the mechanism (`apiDispatcher.js:296-299`) so the next
  reader can check it in one step. I did, from a different direction, and it holds.
- **The §11 report does not soften anything.** It opens by calling all five findings true, describes
  M-1 as "the same class as the one I was correcting four lines above", and ends with a section headed
  「第五輪，第五次」 that plots the trend rather than the win. The bookkeeping error it is describing is
  its own.
- **The HTTP integration test asserts the specific error code on the 403**, not just the status. That
  distinction was REV-039's finding and it has survived four rounds of editing without being softened.

---

## Recommendations

1. **Merge.** Nothing in this candidate should hold it. The four checks are green on this exact head
   with no reruns, the target has not moved, and the gate's remaining issues are the module's documented
   structural condition.
2. **L-1 first, in T35 or a follow-up on this file.** The cross-supplier probe is thirty lines, runs in
   28 ms against the existing harness, and pins the property the module exists to protect. It is the
   highest value per line available anywhere in this module right now.
3. **L-2 is one assertion and needs no database.** It can ride with anything.
4. **N-1 belongs on `main`, not here.** Two observations carry a zero-padded commit hash that resolves
   to nothing. Inert, but it is a real dangling reference and this PR is the wrong place to fix it.
5. **Standing, and I would now retire it.** Four rounds produced a version of "a record's fields must be
   true together", and this round found no new instance. The remaining risk is not that the rule is
   unknown — it is that the *test* for it is ambiguous. N-4 gives the unambiguous one: a record's triple
   must equal the `baseline` block committed alongside it. That is checkable mechanically and would have
   caught every instance from REV-039 onward.
6. **Standing, carried forward from REV-041 and REV-042 and still true:** the reveal endpoint writes a
   business audit row only on success. Refused attempts leave no trace in `supplier_audit_logs`. This
   matches design §1208; if insider probing is in scope for the Bank capability it is a design question
   to raise deliberately, not a defect here.

---

## Review hygiene

- **Seven mutations**, each reverted immediately after its run, with `git status --porcelain` confirmed
  empty in between: the `deepFreeze` guard restored with the inner freeze (MUT-1), the guard restored
  alone (MUT-2), a new unfrozen export (MUT-3), `command()`'s body spread moved last, `BANK_CREATE_SCHEMA`
  opened to unknown fields, `reveal`'s supplier scoping removed, and `#rowForUpdate`'s supplier scoping
  removed.
- **One probe test** written to `server/test/integration/zzrev043probe.integration.test.js`, derived from
  `supplierBank.integration.test.js` so that it reused that file's `seedSupplier`, `serviceOn`, `cleanup`
  and `executorLike` helpers, and deleted afterwards. It removed its own suppliers, bank rows and audit
  rows in `t.after`. Its assertions, for whoever adopts it: a positive control that the owning supplier's
  route succeeds; then `reveal`, `update`, `setDefault` and `deactivate` through a second supplier's
  route each asserted to return no data, to throw, and not to carry the plaintext in the error payload.
- **One scratch script** against `ResponseValidator` for N-3/L-4, and one schema-walk script, both
  written outside the repository.
- **Eight detached worktrees** created under the session scratchpad to recompute baselines at `64ef1fc`,
  `1de07da`, `80bbb95`, `70344c5`, `b9a6610`, `d161a6ab`, `6134836d` and `a7472b77`, then removed with
  `git worktree remove --force` and `git worktree prune`. `git worktree list` is back to its original
  entries.
- `git status --porcelain` was empty before the review, after every revert, and immediately before this
  report was written. The head under review never changed:
  `b9a6610661c7f409f5eeda940ffeae8587f52aa6` throughout. Nothing was committed.
- Nothing was fixed. Every finding above is a description and a proposed fix, not an edit.
- This report reproduces neither CI key literal (see N-2).

## What I did not check

- **The conversation behind `HD-032` and `HD-033`.** I verified the records exist, that `HD-032`'s
  question is now byte-identical to its pre-REV-041 text, and that the count it carries was right at the
  moment of decision. I cannot verify that the Product Owner said those words.
- **The RFC 9111 §5.2.2.5 reading underlying `HD-033`.** REV-040 verified it, REV-041 and REV-042
  accepted it, and so do I — **PLAUSIBLE**.
- **`SupplierBankCrypto`'s primitives** — key derivation, AAD construction, blind-index construction.
  Not in this diff; TASK-032 and REV-033/034 covered that layer. I exercised AAD only incidentally,
  through the reveal path in the L-1 probe.
- **The service layer's transaction, concurrency and duplicate-detection behaviour.** Not in this diff
  (N-9). I re-ran it (394/394 supplier, 1938 server-wide) rather than re-attacking it, and REV-039
  through REV-042 each attacked it directly.
- **The client side.** `supplier-phase-001-client` is recorded green at 71/71 and `client-build` passes;
  T34 has no UI surface and I read no Vue. I did not re-run the client suite or the build.
- **AC-025 and AC-026 at the HTTP layer.** Still no HTTP-level test; §8 of the author's report discloses
  this and I confirmed the gap rather than closing it.
- **Whether a pre-registration widening of `MASKED_BANK_WITH_WARNINGS_SCHEMA.properties.warnings`
  specifically reaches the wire on a create or update response.** The node is now frozen, so the question
  is moot at this head; REV-042 proved the mechanism end to end on `MASKED_BANK_SCHEMA`. That the same
  mechanism would apply to the warnings node remains **PLAUSIBLE**.
- **Whether the `command()` ordering matters for the four non-Bank supplier handlers** that share the
  pattern. I checked only that the pattern exists at `supplierApprovalWithdrawHandler.js:48`.

## Residual risk I am accepting by approving

1. A future edit can reintroduce cross-supplier bank account disclosure on `reveal` and the three write
   child routes without any test going red (L-1). The behaviour is correct today — I executed it — and
   the file is unchanged by this branch.
2. A future edit can invert `command()`'s field precedence without any test going red (L-2). Exploiting
   it needs a second, independent regression in a schema that *is* tested.
3. Two ledger observations inherited from `main` bind a commit hash that does not resolve (N-1). Inert
   at every gate.
4. AC-025 and AC-026 have no HTTP-level coverage, disclosed by the author and unchanged by this round.
5. The items-module failures TC-001, TC-008 and TC-016 remain unexplained in this worktree. They are
   green in CI, so I treated them as local environment artefacts on the strength of that, not on my own
   investigation. HD-025 covers the standing policy.
