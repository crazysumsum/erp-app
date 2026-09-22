# REV-041 — TASK-034 Bank API, REV-040 remediation independent review

**Review:** REV-041 ・**Task:** TASK-034 (T34) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `80bbb954d005133570936baa6311515791d3dc4b` (`claude/supplier-task-034`, PR #123)
**Diff base for the remediation:** `1de07da89a1fec2eb8a753f99cb9779b8f9d50cd` (the REV-040 head); the whole
TASK-034 change (`main…HEAD`) was read as well, because this is the merge candidate and no earlier
review binds this head.
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-034`
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.
**Baselines recomputed at this head:** DESIGN `e4083319…` (matches the state file), PLAN `db529678…`
(matches), source fingerprint `fff22d41…` (matches), revision 177 (as expected).

**Verdict: CHANGES_REQUESTED** — 0 Critical, 0 High, 1 Medium, 4 Low.

All eight REV-040 findings are addressed, and the two that mattered most are addressed well. M-1 is the
best work on this branch: the author did not take REV-040's word either, went and read `redact()`,
demonstrated it in both directions **including the negative control**, reverted a change they had made
on a reviewer's unverified reasoning, and wrote into the ledger that this was the second time they had
been bitten by the same habit. The profile is byte-identical to its pre-REV-039 content. That is the
right outcome reached the right way.

The product code did not move in this commit beyond two comments, and it held against everything I
aimed at it: six mutations, all killed; eleven HTTP probes at the reveal edge, all refused; a forced
leak through the masked list projection, rejected by response validation before it reached the wire.

What blocks is one line of JSON. The `reviews` entry minted to close M-2 records a design baseline that
**did not exist at the head REV-039 reviewed**. REV-040 named the correct hash and said why it mattered.
That is the fourth consecutive round in which the remediation introduces a new instance of the class it
closes, and it is the class this module blocks on.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| **Medium** | **1** — the REV-039 review record binds a design hash that never existed at the head it reviewed |
| Low | 4 |
| Note | 13 attacks recorded because they were run and held |

CI: verified independently, not accepted. `gh run view 35583404210` reports `headSha`
`80bbb954d005133570936baa6311515791d3dc4b`, `conclusion: success`, `status: completed`.
`gh run list --commit 80bbb954…` returns **exactly one** run — that one, no reruns. `gh pr checks 123`
shows all four green (Build frontend 22s, Dependency audit 18s, Lint 27s, Test + MySQL integration
4m39s). PR #123 is `OPEN`, `MERGEABLE`, `mergeStateStatus: CLEAN`, base `main`. `origin/main` is still
`71616ec040a7558856083035801554dda940ab5e` and `git merge-base origin/main HEAD` equals it, so the
target has not moved since `default_commit` was reconciled to it.

Everything below states what I ran. Anything I reasoned about but did not execute is marked
**PLAUSIBLE**. Every mutation was reverted immediately; `git status --porcelain` was empty before the
review, after every revert, and before this report was written. The head never moved and nothing was
committed.

---

## Findings

### [MEDIUM] M-1 — The REV-039 `reviews` record binds `e4083319…`, a design baseline that did not exist at the head REV-039 reviewed

**Location:** `docs/supplier_management/00_harness_state.json` — `reviews[]`, `id: "REV-039"`,
`reviewed_baseline`

**What is wrong.** The new record reads:

```json
{
  "id": "REV-039",
  "reviewer": "agent-skills:security-auditor, independent of the author, reviewing 64ef1fc9…",
  "reviewed_baseline": "e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4",
  "status": "CHANGES_REQUESTED", "open_high": 2
}
```

The record says, in one field, that the review was performed against `64ef1fc`, and in the next field
that the design baseline it reviewed was `e4083319…`. Those cannot both be true. At `64ef1fc` the
manifest still declared `.github/workflows/ci.yml` in `scope.approval_required_paths`, and the design
digest is computed over `scope` — which is the entire content of REV-039 H-1.

**What I ran.** I recomputed the design digest from the manifest and the five canonical spec files as
they stood at each of the three heads, using `harness_core.digest` and `harness_core.file_sha`, without
moving the head:

```
REV-039 head       64ef1fc  design = 77ab26aa3d4ca6037416ffdc37c1c3f7c0e7c89504515f87e1291c621bc3d061
REV-040 head       1de07da  design = e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4
merge candidate    HEAD     design = e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4
```

REV-039's own report states it in its header: *"Design baseline as computed at this head:
`77ab26aa3d4ca…` (**not** the `e4083319…` the state file records — see H-1)"*. REV-040's fix text named
the same value and gave the reason:

> *"Add the REV-039 `reviews` entry (`reviewed_baseline` `77ab26aa…`, the hash that was live when it was
> performed — note that it will therefore never match a recomputed design hash, which is itself the
> honest record of H-1)"*

The author recorded a different value and said nothing about the substitution — not in the `reviews`
entry, not in the REV-040 observation, not in §9 of the report, which says only *"REV-039 同 REV-040 都
入咗"*.

REV-040's entry, by contrast, is correct: it reviewed `1de07da`, where design **was** `e4083319…`.

**The convention is not ambiguous.** `reviewed_baseline` is the hash live at review time, and the ledger
proves it against itself:

```
review baseline distribution (40 reviews):
  e4083319 ×30   dcb74d3c ×3   9d9866b8 ×2   2dc22f70 ×2
  2b715d56 ×1    be8e5c85 ×1   7bcfe3f1 ×1
```

Ten older reviews carry the older design hashes of their own era. They were not retro-fitted to the
current one. REV-039 is the only record in the collection whose stated baseline contradicts its stated
head.

**Why it matters.** Three ways.

1. **It erases the fact REV-039 found.** The one review in the history that was performed against a
   displaced design baseline is now recorded as having been performed against the live one. The
   machine-readable trace of H-1 — the thing REV-040 pointed out would be *"itself the honest record"* —
   is gone from the only collection a future reader would check.
2. **It inflates a count this same commit relies on.** `APPROVAL-HD-030-SCOPE-REBIND-2` and `HD-032`
   both justify the manifest revert as buying *"28 reviews including the REV-038 that gated the TASK-033
   merge"*. At the moment those records were written the number was already 30, because this commit added
   two more entries bound to `e4083319…` — and one of the two is bound to it falsely. A count used as the
   consideration in a MAJOR decision is now partly manufactured by the bookkeeping of the same commit.
3. **It is the fourth round running.** REV-037's finding was *"the previous fix introduced a new instance
   of the defect it closed"*. REV-039 H-1 was a record that misstated a baseline. REV-040 H-1 was records
   that asserted what the ledger did not contain. This is a record that misstates a baseline, created by
   the fix for the finding about records.

**What it does not cost.** Nothing at any gate, today. I verified this rather than assuming it:

```
good_reviews = 10  ['REV-012','REV-019','REV-020','REV-025','REV-027','REV-029','REV-031',
                    'REV-032','REV-034','REV-038']
REV-038 in good_reviews = True
REV-039 excluded (status CHANGES_REQUESTED, open_high 2, no RISK approval) — would be excluded
  even with the correct hash
duplicate review ids: none;  duplicate approval ids: none;  decisions 32, none unanswered,
  none missing answer_ref
```

So M-2 is mechanically satisfied and `good_reviews` is unbroken. This is a truth finding, not a gate
finding — which is the same footing on which REV-039 and REV-040 each raised their Highs.

**Fix.** One string: `reviewed_baseline` on REV-039 becomes
`77ab26aa3d4ca6037416ffdc37c1c3f7c0e7c89504515f87e1291c621bc3d061`, with a clause in the REV-040
observation saying that it will never match a recomputed design hash and that this is the point. While
that record is open, correct the *"28 reviews"* figure in `APPROVAL-HD-030-SCOPE-REBIND-2` to the count
as of that record — or state it as the count at the time of the decision, which is what it actually is.

---

### [LOW] L-1 — Only half of REV-040 M-2 shipped: there is no `PR_REVIEW` observation for either round, and the ledger reports M-2 closed

**Location:** `docs/supplier_management/00_harness_state.json` — `observations`

REV-040's fix text asked for two things: *"Add the REV-039 `reviews` entry … **and the corresponding
`PR_REVIEW` FAIL observation at `64ef1fc`**, following the REV-035/036/037 shape."* The `reviews` half
landed. The observation half did not, and nothing says so.

```
observation kinds: MANUAL_TEST 77, CI 18, PR_REVIEW 16, MERGE 12
last six PR_REVIEW subjects:
  REV-033 CHANGES_REQUESTED at 699ab06 …
  REV-034 APPROVED at dda9a40 …
  REV-035 CHANGES_REQUESTED at 8718fa7 …
  REV-036 CHANGES_REQUESTED: a guard that provably never runs …
  REV-037: the previous fix introduced a new instance of the defect it closed …
  REV-038 APPROVED at ef1ed7d, the first of four rounds with no production defect
observations whose subject mentions REV-039 or REV-040: six, all kind MANUAL_TEST
```

Sixteen consecutive reviews have both records, including every CHANGES_REQUESTED one. The two rounds
that produced the most findings on this task have only one. The REV-040 observation states M-2 as closed
— *"REV-039 and REV-040 are both recorded now"* — which is true of `reviews` and not of `observations`,
and the report's §9 M-2 row says the same.

**It costs nothing at the gate**, and I checked why rather than assuming. `_observation`
(`harness_checks.py:235-250`) selects only observations whose `code_commit`, `spec_baseline` and
`source_fingerprint` all equal the *current* candidate's, so `PR_REVIEW_MISSING gate/pr` is reported at
this head regardless — the head always moves after the record is written. It was reported at the REV-040
head too. This is the module's standing "MERGE_READY cannot be fully green" condition, not a regression.

**Fix.** Two `PR_REVIEW` observations in the REV-035/036/037 shape, or an explicit sentence saying the
observation half was deliberately declined and why. Silently delivering half of a fix and reporting it
closed is the smaller version of the thing this task keeps getting caught on.

---

### [LOW] L-2 — `HD-032`'s question calls `APPROVAL-HD-017-DESIGN` "the module's only DESIGN-kind approval". There are seven

**Location:** `docs/supplier_management/00_harness_state.json` — `pending_decisions`, `HD-032.question`

> *"…all 38 reviews stopped counting at once, including REV-038, the APPROVED review that gated the
> TASK-033 merge, and APPROVAL-HD-017-DESIGN, **the module's only DESIGN-kind approval**."*

```
DESIGN-kind approvals: 7
  APPROVAL-HD-002          9d9866b8  valid=False
  APPROVAL-HD-003          be8e5c85  valid=False
  APPROVAL-HD-004-DESIGN   be8e5c85  valid=False
  APPROVAL-HD-007-DESIGN   7bcfe3f1  valid=False
  APPROVAL-HD-009-DESIGN   dcb74d3c  valid=False
  APPROVAL-HD-014-DESIGN   2dc22f70  valid=False
  APPROVAL-HD-017-DESIGN   e4083319  valid=True
```

The intended claim — the only *valid* one, the only one a design baseline move would cost anything — is
true, and it is the claim that makes the decision reasonable. The claim as written is false, in the
question text of a MAJOR decision record created specifically because REV-040 found records asserting
things the ledger did not support. Everything else I checked in `HD-032` holds: the design digest really
is computed over `manifest['scope']` (`harness_core.py:301-307`), `good_reviews` really does filter on a
recomputed design hash (`harness_checks.py:276-289`), `check_boundary` really does consult approvals only
for `approval_required_paths` matches (`harness_checks.py:116-122` — the record says 118-124, close
enough that I am not raising it), and all 38 reviews at that head would indeed have stopped counting.

**Fix.** Insert one word: *the module's only **live** DESIGN-kind approval*.

---

### [LOW] L-3 — The CI workflow calls its Bank keys "即場產生"; they are fixed literals committed to a public repository

**Location:** `.github/workflows/ci.yml:99-105`

```yaml
# 呢兩條係**CI 專用、即場產生**嘅假 key，同任何環境嘅真 key 無關。
SUPPLIER_BANK_ENCRYPTION_KEYS: '{"ci-enc-1":"R4EVice6+okHiRFgg4gm0rYpYKWA8HMxCVjxOlS9RQg="}'
SUPPLIER_BANK_LOOKUP_KEYS:     '{"ci-look-1":"THGVVay+dFBH7xi7a8a/BPGP/g16GnMI4Tu85N1AMMw="}'
```

即場產生 means *generated on the spot*. These are static values committed to the repository, and
`gh repo view` reports `"visibility": "PUBLIC"`. Nothing is generated at run time. The reading
"generated ad hoc, for CI, rather than taken from an environment" is available and is probably what was
meant — but this is a module that has spent three review rounds on comments that assert properties the
artefact does not have, and the following sentence in the same comment claims compliance with design
§1700's prohibition on committing fixed keys.

**The substance is fine, and I checked it rather than assuming.** The job uses only `actions/checkout@v4`
and `actions/setup-node@v4`, the workflow declares `permissions: contents: read`, there is no
`pull_request_target`, the keys reach an ephemeral CI MySQL only, and `server/.env.example` ships the four
variables empty with a `randomBytes(32)` recipe and an explicit *"唔好 commit 真 key"*. No production
material is committed. The finding is the sentence, not the keys.

**Fix.** Say what is true: fixed test-only values, committed deliberately, public, rotatable without
coordination because nothing depends on them.

---

### [LOW] L-4 — Seven of the eight Bank schemas are shallow-frozen, so a masked response schema can be widened at run time

**Location:** `server/src/handlers/suppliers/supplierBankSchemas.js`

The file's own doc comment calls `additionalProperties: false` on every response schema *"SEC-006／
FR-BANK-007 嘅結構性防線"*, and the three authorization policies are deliberately deep-frozen
(`Object.freeze` on the outer object, the array, and each policy). `MASKED_BANK_WITH_WARNINGS_SCHEMA`
deep-freezes its `properties` too. The rest do not:

```
EMPTY_BANK_SCHEMA                 frozen=true   properties frozen=false
BANK_ACCOUNT_PARAMS_SCHEMA        frozen=true   properties frozen=false
BANK_CREATE_SCHEMA                frozen=true   properties frozen=false
BANK_REVEAL_SCHEMA                frozen=true   properties frozen=false
MASKED_BANK_SCHEMA                frozen=true   properties frozen=false
MASKED_BANK_WITH_WARNINGS_SCHEMA  frozen=true   properties frozen=TRUE
BANK_REVEAL_RESPONSE_SCHEMA       frozen=true   properties frozen=false
BANK_LIST_RESPONSE_SCHEMA         frozen=true   properties frozen=false

MASKED_BANK_SCHEMA.properties.accountNumber = { type: "string" }   → write succeeded
```

Defence in depth only, and weak defence in depth: it requires code already executing in the process, and
the response validator almost certainly compiles each schema once at route registration, in which case a
later mutation changes nothing. I did **not** test whether a post-registration mutation actually widens a
live response — **PLAUSIBLE**. The finding is the inconsistency: one schema in the file deep-freezes and
seven do not, in a file whose stated job is to be the structural barrier, and which this very commit
edited.

**Fix.** `Object.freeze` the `properties` object on the other seven, matching what the file already does
twice.

---

## The five claimed remediations, verified independently

### H-1 — `HD-032` / `HD-033` — **holds, with L-2 against it**

Both entries exist, both `impact: MAJOR`, both `ANSWERED`, both carrying an `answer_ref`, and their field
shape is identical to `HD-031`'s (`affected_ids`, `answer_ref`, `id`, `impact`, `question`, `status` —
no timestamp field exists in this schema). 32 decisions, no duplicate ids, none unanswered, none missing
an `answer_ref`.

Against the **HD-017 precedent**: HD-017's `answer_ref` is `User message on 2026-09-16: "b"`. HD-032's
and HD-033's are `Product Owner decision on 2026-09-21 … : 取消 manifest 宣告` and `… : 記低偏離，唔掂框架`.
That is the *same-day* convention — `HD-030` and `HD-031`, recorded before REV-039, use exactly this
phrasing — so the two new records match their neighbours, not an older style. I cannot verify the
conversation and do not claim to. What I can verify is that both records state plainly that they were
**recorded late**, and that `HD-032` names the failure precisely: *"this decision was taken in
conversation and the three records written from it asserted it without a pending_decisions entry
existing, which REV-040 H-1 correctly flagged."* That is the honest form of this record.

The superseded records are retained unrewritten and are now *backed* rather than corrected, which is the
right resolution: `APPROVAL-HD-031-PLAN-REBIND` and `APPROVAL-HD-030-SCOPE-REBIND` still say what they
said, and `HD-032` now records the decision they assert.

**Does any record still assert authority it does not have?** REV-040's H-1 named four such decisions and
this commit records two. I traced the other two rather than accepting the report's silence:

- **The `expiresInSeconds` deviation.** REV-040 was wrong about this one. `DEV-T34-EXPIRES-IN`'s
  `source_ref` never attributes it to the Product Owner — it says *"The reasoning: no server-side state
  corresponds to that number"*, in the agent's own voice, and its `actor` is the harness agent. No
  authority is claimed, so none is unbacked. It remains true that a design §6.6 shape was deviated from
  by the agent alone while the neighbouring §6.6 deviation was put to the Product Owner as `HD-033`; that
  asymmetry is visible but it is pre-existing and REV-039 L-4 settled it on the narrower ground of where
  it was written down.
- **The L-3 profile edit.** Moot: reverted under M-1, and `APPROVAL-HD-031-PLAN-REBIND-2` states
  explicitly *"The underlying human decision is unchanged and is still HD-031… No new authorisation is
  claimed here."* That is the correct handling and it is better than minting a record.

So the substance is complete. What is missing is one sentence saying so — the report's §9 H-1 row lists
the two that were added and does not mention the two REV-040 named that were not.

**Approval arithmetic, verified:**

```
has_approval DESIGN = True   has_approval PLAN = True
APPROVAL-HD-031-PLAN-REBIND-2   PLAN  db529678  valid=True
APPROVAL-HD-030-SCOPE-REBIND-2  SCOPE db529678  valid=True for server/.env.example AND for ci.yml
APPROVAL-HD-031-PLAN-REBIND     ba636440  valid=False   (superseded, retained unrewritten)
APPROVAL-HD-030-SCOPE-REBIND    ba636440  valid=False   (ditto)
APPROVAL-HD-031-PLAN-FINAL      f701e9b0  valid=False   (ditto)
APPROVAL-HD-030-SCOPE-FINAL     f701e9b0  valid=False   (ditto)
```

The negative control matters here and I ran it: `server/.env.example` **is** an `approval_required_path`
and it changed in this branch, and `APPROVAL-HD-030-SCOPE-REBIND-2` is the **only** approval in the file
that is valid for it — its three predecessors all return `False`. The new record is load-bearing, not
decoration. That is why the boundary check reports no `SCOPE_APPROVAL_REQUIRED` at all.

### M-1 — the `redact()` revert — **holds, and this is the best work on the branch**

I verified the mechanism myself before judging the revert, in three cases rather than the two the ledger
claims, because two cases do not separate *"env_keys is irrelevant"* from *"the variable happened to be
set"*:

```
harness_runner.py:73-79  — redact() resolves each key against os.environ, the RUNNER's environment
harness_runner.py:145-146 — env = {allowlist} ∪ {k: os.environ[k] for k in suite['env_keys']}
                            → env_keys controls the CHILD's environment, nothing else

CASE A  key listed, present in runner env    → 'leaked ring [REDACTED] end'
CASE B  key not listed                       → 'leaked ring {"ci-enc-1":"R4EV…"} end'
CASE C  key listed, ABSENT from runner env   → 'leaked ring {"ci-enc-1":"R4EV…"} end'
```

Case C is the one that settles it: redaction depends on the *runner's* environment and on nothing about
`env_keys`. REV-039 L-3's premise was false, REV-040 was right, and the author was right to revert.

**Was reverting right?** Yes. The two entries cost nothing and buy the case where a suite that boots the
real API — which is exactly the T35 Bank UAT — picks up the key rings from `server/.env` through dotenv
and prints one. Not adding `env_keys` is also right and the author kept that half. The internal
inconsistency REV-040 noted (`DB_PASSWORD` left behind under the same reasoning) is resolved by the
revert rather than by removing more.

**Is the profile byte-identical to its pre-REV-039 content?**

```
git diff 64ef1fc..HEAD -- docs/supplier_management/00_project_profile.json   → empty
```

Yes. And the PLAN baseline returned to `db529678…`, which I recomputed rather than read.

**Is the ledger's account honest?** Yes, and more than it had to be. The observation names the mechanism,
gives both demonstration cases, states that removing the entries was *"a small net loss of protection,
justified in the ledger by a statement that was false"*, and ends: *"this is the second time in this task
that I acted on a reviewer's reasoning without testing the mechanism it rested on."* The report's §9
carries the same under a heading called 兩次被同一件事咬到. Nothing in it overstates.

### M-2 — REV-039 and REV-040 in `reviews` — **mechanically holds; see M-1 and L-1 above**

`good_reviews` is unaffected (10, unchanged, REV-038 included), no duplicate ids, the review gate is
satisfied by REV-038 exactly as before. The two defects are the baseline hash on REV-039 (M-1) and the
missing observation half (L-1).

### L-1…L-5 — **all five hold**

| REV-040 | verified how | result |
| --- | --- | --- |
| L-1 design §6.6 citation | `DEV-T34-CACHE-PRIVATE.source_ref` now reads *"and design 6.6 states the same value in its reveal response example, so this is a design-level shape and not only a task checklist line (REV-040 L-1)"*; design `03_design_spec.md:384` does say it | holds |
| L-2 two stale comments | both rewritten; the reveal comment now states the `private` token does not reach the wire and names the `DEV-T34-CACHE-PRIVATE` observation by subject; the `expiresInSeconds` comment now names `DEV-T34-EXPIRES-IN` by subject **and** §5 of the report | holds |
| L-3 dangling citation | `grep -rn "CORRECTION-REV-039-H1" docs/` returns only prose *describing* the finding. The report now cites the subject and explains that observations in this schema have no id. All three cited subjects match an existing observation **byte for byte** — I compared strings, not eyeballs | holds |
| L-4 `default_commit` | reconciled to `71616ec…`; `origin/main` is still `71616ec…` and the merge-base equals it, so it is current as of this review | holds |
| L-5 `OUTSIDE_MODULE` cost | `APPROVAL-HD-030-SCOPE-REBIND-2` and `HD-032.answer_ref` now state all three consequences, and I confirmed each in the source: `check_boundary` reaches `OUTSIDE_MODULE` without consulting any approval for a path outside both lists (`harness_checks.py:116-122`), the validator goes to `BLOCKED`, and the scope entry is prose. The record even says so in its own `scope` array | holds |

**The boundary validator, both bases:**

```
--base 71616ec  (the recorded default_commit)
  BLOCKED
  OUTSIDE_MODULE changes/.github/workflows/ci.yml: not in allowed_write_paths
  — exactly one finding, as claimed

--base ad21c1f  (what L-4 replaced)
  BLOCKED
  OUTSIDE_MODULE ci.yml + 9 × SCOPE_APPROVAL_REQUIRED (docs/items_management/**,
  server/config/itemRecoveryTrustPolicy.json) + 2 × OUTSIDE_MODULE (items module source)
  — twelve lines of another module's noise, which is what L-4 was about
```

Of 53 changed paths against the current main, exactly one matches neither list (`ci.yml`) and exactly one
matches `approval_required_paths` (`server/.env.example`, covered).

---

## Attacks that failed

Recorded because a review listing only what broke says nothing about coverage. All against a real Node
application on an ephemeral port, real MySQL, real JWTs and real scrypt hashes, at the unmodified head.

### N-1 — A forced leak through the masked list is rejected before it reaches the wire

The schemas file claims `additionalProperties: false` is a *structural* defence — *"就算 service 有一日
開始多回一個欄位，佢都出唔到 HTTP"*. Nobody had tested that claim in the leak direction; the unit test
reads the schema text, and the integration test only sees a service that does not leak. So I made it leak:

```js
// MUTATION A — SupplierBankService.list()
return { items: rows.map((r) => ({ ...toMaskedBankResponse(r),
                                   accountNumber: "LEAKCANARY1234", encryptionKeyId: "enc-1" })) };
```

```
✖ the Bank routes answer over real HTTP, and the masked list leaks nothing
  AssertionError: {"success":false,"error":{"code":"INTERNAL_SERVER_ERROR",
                   "message":"Internal server error"}, …}
    actual: 500,  expected: 200
```

Response validation refused the whole response. The canary never crossed the wire, the error body carries
no detail, and the test goes red. The structural claim is real, measured rather than asserted.

### N-2 — The reveal step-up cannot be bypassed by any shape of missing or malformed password

Eleven probes over real HTTP, appended to the integration file and reverted with `git checkout --`.
REV-040 measured wrong-password brute force; nobody had measured *no* password.

```
PROBE no password field          -> 400 PASSWORD_REQUIRED          leaks=false
PROBE empty password             -> 400 PASSWORD_REQUIRED          leaks=false
PROBE password as array          -> 400 PASSWORD_REQUIRED          leaks=false
PROBE password as object         -> 400 PASSWORD_REQUIRED          leaks=false
PROBE password null              -> 400 PASSWORD_REQUIRED          leaks=false
PROBE reason 4 chars             -> 400 REQUEST_VALIDATION_FAILED  leaks=false
PROBE extra supplierId in body   -> 400 REQUEST_VALIDATION_FAILED  leaks=false
PROBE bankAccountId = 0          -> 400 REQUEST_VALIDATION_FAILED  leaks=false
PROBE bankAccountId = 1e3        -> 400 REQUEST_VALIDATION_FAILED  leaks=false
PROBE supplier id mismatch       -> 404 SUPPLIER_BANK_NOT_FOUND    leaks=false
PROBE correct                    -> 200 OK                         leaks=true
PROBE reveal audit rows          -> 1
```

Four things worth naming. The `password` field is rejected at the step-up layer for every wrong type,
not coerced. The route parameter pattern `^[1-9][0-9]{0,18}$` really does refuse `0` and `1e3` **at the
edge**, before any SQL. A body-injected `supplierId` is refused by `additionalProperties: false` before
`command(req)`'s spread ordering is even reached — so REV-040's N-6 result stands and the schema is
confirmed as the first of two barriers. And the ten refusals left **zero** reveal audit rows while the
one success left exactly one; design §1208/§1469 require auditing 誰查看 and say nothing about denied
attempts, so this matches the specification, but it means a principal probing the reveal endpoint leaves
no business-audit trace. Recorded as an observation, not a finding.

### N-3 — The second authorization layer on the masked list is tested

`list()` carries a service-layer `#assertMay(actor, "supplier.view", …)` added under REV-035 M-1, behind
a route policy that already requires the same permission. Belt-and-braces checks are the classic
untested line. I removed it:

```
✖ the masked list is gated on supplier.view
  338 tests, 337 pass, 1 fail
```

Killed. The second layer is not decorative.

### N-4 — Cross-supplier disclosure in the duplicate warning is gated and the gate is tested

`SupplierBankService.js:229` returns the other Supplier's Code only when the actor holds `supplier.view`.
I removed the condition:

```
✖ without supplier.view the cross-Supplier warning names no Supplier at all
```

Killed. A Supplier Code identifies a company; the refusal to hand it out without `supplier.view` is
enforced and pinned.

### N-5 — "Audit 失敗則不 reveal" is enforced and the enforcement is tested

Design §1208 and §1469 require the audit to commit before the plaintext returns. `reveal()` writes the
audit inside `withTransaction` and assigns `plaintext` only after. The interesting mutation is not
removing the audit — REV-040 did that — but *swallowing its failure*, which leaves the row count intact
and would survive an assertion on `audits.length`:

```js
// MUTATION H
try { await this.audit.record(connection, { … }); } catch { /* swallow */ }
```

```
✖ a reveal whose audit fails returns no account at all
```

Killed by `supplierBankService.test.js:347`, which injects a throwing audit store. The design property
has a test aimed at the property, not at its side effect.

### N-6 — The reveal's step-up strength and the `Pragma` header are both pinned

```
MUTATION C — RevealSupplierBankAccountHandler authType "jwt-password" → "jwt"
✖ every write demands all three permissions and a device password

MUTATION F — remove res.setHeader("Pragma", "no-cache")
✖ the Bank routes answer over real HTTP, and the masked list leaks nothing   (real wire header)
✖ reveal sets the one cache header the framework does not overwrite          (handler intent)
```

Both killed, and F is killed twice — once at the handler and once at the wire. That is the shape REV-039
M-1 was about, now present in both directions.

### N-7 — The authorization policy name cannot be silently weakened

The unit tests pin `options.permissions` and assert `options.match !== "any"`, but nothing asserts
`policy.name === "hasPermission"`. I traced whether that gap is reachable rather than mutating blindly
(`authorizationPolicyRegistry.js`):

- An unregistered name throws `Unsupported authorization policy` at normalize time.
- `allowAll` and `authenticated` use `noOptions`, which throws if any option key is present.
- `hasRole` uses `claimPolicyOptions(…, "roles")`, which throws `contains unknown options` on a
  `permissions` key.
- `match` is validated against `{all, any}`, so `assert.notEqual(match, "any")` is *complete* coverage of
  the AND/OR axis, not a partial one.

There is no rename that both survives startup and weakens the policy. The missing assertion is not a
hole. HELD, by construction rather than by mutation.

### N-8 — The recorded evidence reproduces exactly, and nothing is orphaned that is not disclosed

Re-ran the recorded argv verbatim, in this worktree, with the documented environment:

```
ℹ tests 393   ℹ pass 393   ℹ fail 0   ℹ skipped 0
```

Exactly the recorded counts. And the ledger's own bookkeeping:

```
evidence_files 90, missing on disk 0, on-disk directories not listed 0 (append-only satisfied)
spec_baseline distribution: a0d41e31 ×73, db529678 ×8, 14cb9ebc ×5, ba636440 ×4
runs binding the LIVE plan db529678:
  20260921T0844*  fp=4ea061ee  commit=b0b63fb  (392 tests) — stale fingerprint, cannot satisfy a gate
  20260921T0926*  fp=fff22d41  commit=1de07da  (393 tests) — current fingerprint, selected
live fingerprint fff22d41
```

The four `0844` runs bind the live PLAN hash again after the revert, which is a trap — but their
`source_fingerprint` is `4ea061ee`, so `evidence_issues` cannot accept them and `verify_gate` selects the
latest by `ended_at` regardless. The four `ba636440` runs are orphaned by the revert, are retained rather
than deleted, and the ledger says so in both §7 and the evidence observation: *"their only defect is that
the baseline they bind no longer exists."* 82 of 90 evidence files are historically orphaned in exactly
this way, so the practice is consistent, not new.

### N-9 — No approval binds a hash it claims to be live on

34 of 38 approvals bind a dead hash; all 34 return `valid=False`, and none of them claims otherwise —
they are the retained-and-superseded chain going back to HD-001. The four live ones are
`APPROVAL-HD-017-DESIGN` (DESIGN, `e4083319`) and the three PLAN/SCOPE records at `db529678`. Nothing in
the file asserts currency it does not have.

### N-10 — The CI keys' blast radius

`.github/workflows/ci.yml` sets the two key rings at job level, so every step in the `test` job sees
them. The job's steps are `actions/checkout@v4`, `actions/setup-node@v4`, `npm ci`, migrations, tests —
first-party actions only, `permissions: contents: read`, no `pull_request_target`. No third party is in
a position to read them, and they are test-only values against an ephemeral CI MySQL. See L-3 for the
comment that describes them inaccurately.

### N-11 — No regression anywhere else in the server

```
node --test 'server/test/**/*.test.js' at the unmodified head:
  ℹ tests 1937   ℹ pass 1932   ℹ fail 3
  ✖ TC-008 Item 層級 media …
  ✖ TC-001 Item migrations 0010-0026 …
  ✖ TC-016 adapter verifies a separately restored schema …
```

Identical to what REV-040 measured at the previous head: the same three items-module failures, none in a
supplier file, none in any suite this task's evidence runs. CI is green on this exact head, so they are
local environment artefacts. HD-025 covers the standing policy.

### N-12 — Minor observations that did not rise to findings

- **No migration is in this change.** `git diff main…HEAD` touches `ci.yml`, docs/evidence,
  `server/.env.example`, two handler/schema files and two test files. The Bank schema arrived under
  TASK-032; there is nothing migration-shaped here to review.
- **The `Cache-Control` deviation is recorded three ways and all three agree** — handler comment, schemas
  comment, ledger observation at `status: FAIL` — and `05_development_tasks.md` still has the criterion
  unticked. I checked for the failure mode where a self-correction gets softer as it is copied. It does not.
- **`HD-033` accurately describes `apiResponse.js:21` and `:46`**, the overwrite semantics, and the
  RFC 9111 §5.2.2.5 argument. I did not re-derive the RFC reading; REV-040 checked it and I agree with it
  on inspection — **PLAUSIBLE**.
- **`PR_REVIEW_MISSING`, `CI_MISSING_OR_STALE` ×4, `REQUIRED_RUN_MISSING` ×4, `COMMIT_CHANGED` and 18
  `TASK_INCOMPLETE`** are all present at `MERGE_READY`. Every one is structural or planned (the four
  missing suites are PHASE-003's formal TEST_AND_VERIFY suites that do not exist yet; `COMMIT_CHANGED` is
  the one-commit lag inherent to recording state in the commit it describes). REV-040's N-12 covers this
  and it is unchanged.

---

## Positive observations

- **M-1 is how a remediation should be done.** Told by a reviewer that a previous reviewer was wrong, the
  author verified the mechanism personally, ran the negative control, reverted their own change, took the
  PLAN baseline hit that the revert implies, re-ran all four evidence suites rather than relying on the
  hash coincidence, and wrote the pattern — *"I read what they said and treated it as verifying they were
  right"* — into the permanent record. The profile diff against `64ef1fc` is empty.
- **The two new decision records say they were recorded late.** `HD-032` and `HD-033` both contain the
  sentence that makes them weaker as evidence and stronger as a record. That is the correct instinct and
  it is rarer than it should be.
- **`APPROVAL-HD-030-SCOPE-REBIND-2` states the cost of its own trade at full strength**, including that
  its own `ci.yml` scope entry is now prose that no tool reads — a record documenting its own reduced
  authority, inside its own `scope` array.
- **The supersession chain is intact across three baseline moves.** 34 dead-hash approvals, all invalid,
  none rewritten, each superseded by a named successor. Ninety evidence files, none missing, none
  unlisted, append-only satisfied.
- **The product code held against every attack, including the one direction nobody had tried.** The
  masked-list leak (N-1) is the test that would have mattered most if it had failed, and the structural
  defence the schemas file claims turned out to be exactly what it claims.
- **The step-up path refuses eleven malformed requests without once reaching the crypto** (N-2), and the
  one design property that could have been asserted without being tested — audit-before-plaintext — has a
  test aimed at the property itself (N-5).

---

## Recommendations

1. Fix M-1 before merge. One string. The correct value is
   `77ab26aa3d4ca6037416ffdc37c1c3f7c0e7c89504515f87e1291c621bc3d061`, and the reason it will never match
   a recomputed design hash belongs in the record beside it.
2. Fix L-1 before merge, or say in the report that the observation half was declined and why.
3. L-2, L-3 and L-4 are a single documentation pass and can ride with the above.
4. Standing, and the third time this task has produced a version of it: **when a review names a specific
   value, either use that value or say why not.** REV-040 gave both the hash and the argument for it. The
   substitution was silent, which is what turned a judgement call into a finding.
5. Standing, for T35: the reveal endpoint writes a business audit row only on success. Ten refused
   attempts left no trace in `supplier_audit_logs` (N-2). This matches design §1208, which requires
   recording 誰查看 and nothing about denied attempts. If insider probing is in scope for the Bank
   capability, that is a design question to raise deliberately rather than a defect to fix quietly.

---

## Review hygiene

- **Six mutations**, each reverted immediately after its run, `git status --porcelain` empty in between:
  the `list()` masked projection (forced leak), the `list()` second-layer permission check, the
  cross-Supplier `supplierCodes` gate, the reveal audit-failure swallow, the reveal `authType`, and the
  reveal `Pragma` header.
- **One probe test** (eleven HTTP cases at the reveal edge) appended to
  `server/test/integration/supplierBank.integration.test.js` and reverted with `git checkout --`. It
  cleaned up its own rows, role, user and supplier in `t.after`.
- Scratch scripts were written to the session scratchpad outside the repository. The only file this
  review leaves inside the repository is this report.
- `git status --porcelain` was empty before the review, after every revert, and immediately before this
  report was written.
- Head under review never changed: `80bbb954d005133570936baa6311515791d3dc4b` throughout. Nothing was
  committed.
- Nothing was fixed. Every finding above is a description and a proposed fix, not an edit.

## What I did not check

- The conversation behind `HD-032` and `HD-033`. I verified that the records exist, are shaped like their
  neighbours, and state their own lateness. I cannot verify that the Product Owner said those words, and
  no reviewer can.
- Whether mutating a shallow-frozen schema's `properties` at run time actually widens a live response, or
  whether the validator's compiled form makes it inert (L-4) — **PLAUSIBLE**.
- The RFC 9111 §5.2.2.5 reading underlying `HD-033`; I accepted REV-040's verification of it.
- `SupplierBankCrypto`'s primitives — key derivation, AAD construction, blind-index construction — beyond
  the round-trip and tamper behaviour the existing integration tests exercise against real MySQL. TASK-032
  and REV-033/034 covered that layer and I did not re-derive it.
- The client/UI side. `supplier-phase-001-client` is green at 71/71 and `client-build` passes, but T34 has
  no UI surface and I read no Vue.
- AC-025 and AC-026 at the HTTP layer. They have no HTTP-level test; §8 of the author's report says so
  and I confirmed the gap rather than closing it.
