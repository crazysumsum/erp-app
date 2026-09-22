# REV-042 — TASK-034 Bank API, REV-041 remediation independent review

**Review:** REV-042 ・**Task:** TASK-034 (T34) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03
**Head reviewed:** `70344c590aab758acb7446977e3f20759a0783de` (`claude/supplier-task-034`, PR #123) — the
merge candidate.
**Diff base for the remediation:** `80bbb954d005133570936baa6311515791d3dc4b` (the REV-041 head); the
whole TASK-034 change (`main…HEAD`) was read as well, because this is the merge candidate and no
APPROVED review binds it.
**Worktree:** `/Users/sam/Documents/workspace/erp-app-worktrees/supplier-task-034`
**Reviewer:** independent agent (`agent-skills:security-auditor`); not the author. Author is Claude Opus 5.
**Baselines recomputed at this head:** DESIGN `e4083319…` (matches the state file), PLAN `db529678…`
(matches), source fingerprint `c9b9fe38…` (matches), revision 181 (as expected).

**Verdict: CHANGES_REQUESTED** — 0 Critical, 0 High, 1 Medium, 4 Low.

All five REV-041 findings are addressed, and the two that carried weight are addressed correctly.
M-1 is right: I recomputed the design digest at all three heads in detached worktrees and
`77ab26aa…` is the hash that was live at `64ef1fc`. The `ci.yml` comment now says something true and
I verified the keys appear nowhere else in the repository. The deep freeze is real, the new test
discriminates, and the changed `params.required` assertion still asserts both halves of what it claims.

I also ran the step REV-041 marked **PLAUSIBLE** and declined to run — driving a widened response schema
through a real HTTP response — and it settles the question in both directions. See N-1.

What blocks is one shape of JSON, again. Closing REV-041's L about the missing `PR_REVIEW`
observations produced three new observations, and **two of the three bind a
`(code_commit, spec_baseline, source_fingerprint)` triple that never existed at any point in this
repository's history**. That is the same class as the REV-041 M-1 being corrected four lines above it
in the same commit, about the same two reviews. Fifth consecutive round, fifth instance.

---

## Summary

| | |
| --- | --- |
| Critical | 0 |
| High | 0 |
| **Medium** | **1** — two of the three new `PR_REVIEW` observations bind a baseline/fingerprint triple that was never live at the commit they name |
| Low | 4 |
| Note | 11 attacks and probes recorded because they were run and held |

CI: verified independently, not accepted. `gh run view 35585168971` reports `headSha`
`70344c590aab758acb7446977e3f20759a0783de`, `conclusion: success`, `status: completed`,
`event: pull_request`. `gh run list --commit 70344c59…` returns **exactly one** run — that one, no
reruns. `gh pr checks 123` shows all four green (Build frontend 18s, Dependency audit 22s, Lint 21s,
Test + MySQL integration 3m50s). PR #123 is `OPEN`, `MERGEABLE`, `mergeStateStatus: CLEAN`, base `main`,
`headRefOid` equal to the merge candidate. `origin/main` was re-fetched and is still
`71616ec040a7558856083035801554dda940ab5e`; `git merge-base origin/main HEAD` equals it, so the target
has not moved and `default_commit` is current.

Everything below states what I ran. Anything reasoned about but not executed is marked **PLAUSIBLE**.
Every mutation was reverted immediately; `git status --porcelain` was empty before the review, after
every revert, and before this report was written. The head never moved and nothing was committed.

---

## Findings

### [MEDIUM] M-1 — Two of the three new `PR_REVIEW` observations bind a triple that never existed

**Location:** `docs/supplier_management/00_harness_state.json` — `observations`, the three `PR_REVIEW`
records with `actor: "Harness agent (Claude Opus 5), remediating REV-041"`

**What I ran.** I recomputed `Context.baselines()` and `fingerprint()` at every head involved, in
detached worktrees, without moving this head:

```
head       design      plan        source fingerprint   revision
64ef1fc    77ab26aa    f701e9b0    acaa7efb             171
1de07da    e4083319    ba636440    63cc99cd             173
80bbb95    e4083319    db529678    fff22d41             177
70344c5    e4083319    db529678    c9b9fe38             181   (HEAD)
```

The three new observations record:

```
REV-039 obs   code_commit 64ef1fc   spec_baseline db529678   source_fingerprint c9b9fe38
REV-040 obs   code_commit 1de07da   spec_baseline db529678   source_fingerprint c9b9fe38
REV-041 obs   code_commit 80bbb95   spec_baseline db529678   source_fingerprint c9b9fe38
```

At `64ef1fc` the plan baseline was `f701e9b041707cd6…` and the fingerprint was `acaa7efb…`. At
`1de07da` they were `ba6364404ec840ed…` and `63cc99cd…`. Neither record's triple describes the commit
it names, and neither describes the state at the moment it was written either. **There is no point in
this repository's history at which either triple was true.**

**The convention is not ambiguous, and the ledger proves it against itself.** I recomputed the state at
the commit each of the three previous `PR_REVIEW` observations names:

```
REV-036 obs  d161a6ab / a0d41e31 / 97ce4888    recomputed at d161a6ab: a0d41e31 / 97ce4888   ✓
REV-037 obs  6134836d / a0d41e31 / 0e5ce6b5    recomputed at 6134836d: a0d41e31 / 0e5ce6b5   ✓
REV-038 obs  a7472b77 / a0d41e31 / e86a87ae    recomputed at a7472b77: a0d41e31 / e86a87ae   ✓
```

Three for three, byte for byte. Each of those triples is what `current_commit()`,
`ctx.baselines()['plan']` and `fingerprint()` returned at the moment the record was written, and each
names the reviewed head in its `subject` and `source_ref` instead — exactly as the three new records
also do.

**The new REV-041 record follows that convention and is correct.** At the moment these three were
written, `HEAD` was `80bbb95` and the working tree had already been edited into what became `70344c5`,
so the live triple was `(80bbb95, db529678, c9b9fe38)`. That is precisely the REV-041 record. The other
two are that same live triple **with one field overwritten by the reviewed head** — which is what makes
them describe nothing. One field says "this is about commit X"; the two beside it say "the module state
was Y", and Y was never the state at X.

**The REV-039 record contradicts the correction made in the same commit.** Four lines earlier this
commit changed REV-039's `reviews.reviewed_baseline` from `e4083319…` to `77ab26aa…` precisely because
the baselines at `64ef1fc` were displaced — that was REV-039's own H-1 and REV-041's M-1. The new
`PR_REVIEW` observation for the same review then records `64ef1fc` as carrying the *current* plan
baseline. The commit corrects the fact in one collection and re-asserts the opposite in the next.

**What it does not cost. I verified this rather than assuming it.** `_observation`
(`harness_checks.py:235-250`) selects only observations whose `code_commit`, `spec_baseline` **and**
`source_fingerprint` all equal the current candidate's. `64ef1fc` and `1de07da` will never be the
current commit again, so the two false records are permanently inert. The gate confirms it:

```
verify_gate MERGE_READY  →  BLOCKED
  PR_REVIEW_MISSING gate/pr  (still reported at this head)
  REVIEW_NOT_SATISFIED       — NOT reported; good_reviews is non-empty via REV-038
  APPROVAL_MISSING_STALE     — NOT reported; DESIGN and PLAN approvals are valid
```

The deviation makes the gate *stricter*, not looser: had all three named `80bbb95`, `PR_REVIEW_MISSING`
would have been satisfiable at the head they were written on. This is a truth finding, not a gate
finding — the same footing on which REV-039, REV-040 and REV-041 each raised theirs.

**Fix.** Set `code_commit` on the REV-039 and REV-040 observations to `80bbb954…`, the commit at which
they were in fact observed, matching the REV-035/036/037/038/041 shape — the reviewed head is already
named in both the `subject` and the `source_ref`, which is where those records carry it. If instead the
intent is that a `PR_REVIEW` observation should name the reviewed head, then all three fields must move
together to that head's real values (`64ef1fc` → `f701e9b0…` / `acaa7efb…`), and the departure from
five prior records should be stated. Either is defensible; the hybrid is true of nothing.

---

### [LOW] L-1 — The corrected review count in `HD-032` is 29. It is 30, and the thirtieth was added by the same commit

**Location:** `docs/supplier_management/00_harness_state.json` — `pending_decisions`, `HD-032.answer_ref`;
and `docs/supplier_management/implementation/38_task_034_bank_api.md` §10

The note appended to close REV-041's L reads:

> *"The count of reviews the revert preserved was 28 when the decision was taken and is 29 now, because
> REV-040 was added to the ledger afterwards and legitimately binds `e4083319`; REV-039 binds
> `77ab26aa`, the hash that was live at the head it actually reviewed."*

Counted at this head:

```
41 reviews.  reviewed_baseline distribution:
  e4083319 ×30   dcb74d3c ×3   9d9866b8 ×2   2dc22f70 ×2
  2b715d56 ×1    be8e5c85 ×1   7bcfe3f1 ×1   77ab26aa ×1
e4083319 ids: REV-011…REV-038, REV-040, REV-041      REV-038 present: True
```

Thirty. The sentence accounts for REV-040 and omits REV-041, whose `reviews` entry — `reviewed_baseline`
`e4083319…`, correctly — was added by this same commit, a few lines above the note. The report's §10
repeats it: *「決定嗰陣係 28，而家 29」*.

This is small, and the direction is conservative. But the sentence exists only because REV-041 found an
inaccurate count in this record, and the correction lands on a new inaccurate count in the same field.

**Fix.** 30, or state it as "28 at the time of the decision" and stop tracking a number that moves every
round.

---

### [LOW] L-2 — `HD-032`'s `question` was rewritten in place, in a module that supersedes rather than rewrites

**Location:** `docs/supplier_management/00_harness_state.json` — `pending_decisions`, `HD-032.question`

The claim *"the module's only DESIGN-kind approval"* was replaced in the question text with *"the only
one of the module's seven DESIGN-kind approvals bound to the live design baseline"*, and a note recording
the original wording was appended to `answer_ref`. The substance of the new sentence is correct — I
re-counted: seven DESIGN approvals, one valid.

The method sits against this module's own practice. Thirty-four superseded approvals are retained
**unrewritten** and invalidated by hash, each superseded by a named successor; REV-041 checked that chain
and it is intact. `APPROVAL-HD-030-SCOPE-REBIND` and `APPROVAL-HD-031-PLAN-REBIND` "still say what they
said" — REV-041's words, approving of exactly that. A `pending_decisions.question` is the record of what
was put in front of the Product Owner, and `HD-032.answer_ref` leans on that directly: *"answering a
question that stated both costs before the choice"*. Editing the question weakens the only evidence for
that sentence.

Two things reduce this to Low rather than Medium. The note in `answer_ref` states what the original said,
so nothing is silently erased — that is the honest half and it is the half that matters most. And
`HD-032` was itself written after the fact, so its question was never verbatim what the Product Owner
saw; there is less here to preserve than in a contemporaneous record.

**Fix.** Preferably leave the question as recorded and carry the correction only in `answer_ref`, which is
already there and already does the work. If the question text is to be corrected in place, say so inside
the `question` field rather than only in the field beside it, so a reader of the question alone is not
reading a record that has been changed without saying so.

---

### [LOW] L-3 — `deepFreeze` leaves exactly one node writable, and it is in the cross-Supplier disclosure schema

**Location:** `server/src/handlers/suppliers/supplierBankSchemas.js:16-23`, `:180-186`

The new helper short-circuits on anything already frozen:

```js
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}
```

`MASKED_BANK_WITH_WARNINGS_SCHEMA` is the one schema in the file that still passes an explicitly frozen
`properties` into it:

```js
export const MASKED_BANK_WITH_WARNINGS_SCHEMA = deepFreeze({
  ...MASKED_BANK_SCHEMA,
  properties: Object.freeze({ ...MASKED_BANK_SCHEMA.properties,
                              warnings: { type: "array", items: BANK_WARNING_SCHEMA } })
});
```

`properties` is frozen before `deepFreeze` reaches it, so the guard returns immediately and the recursion
never visits `warnings` — a fresh object literal that nothing else freezes. I walked every export at the
unmodified head:

```
NOT FROZEN: MASKED_BANK_WITH_WARNINGS_SCHEMA.properties.warnings
NOT FROZEN: SUPPLIER_ID_PARAMS_SCHEMA.required / .properties / .properties.id   (re-export, see note)

MASKED_BANK_WITH_WARNINGS_SCHEMA.properties.warnings.items = {type:"object",additionalProperties:true}
  → write succeeded
MASKED_BANK_WITH_WARNINGS_SCHEMA.properties.warnings.type  = "string"
  → write succeeded
```

Everything else in the file — all eight schemas, every nested `properties`, `required`, `items`, `enum`
and the three policies — is frozen at every depth. This is one node, and it is the node describing the
duplicate-account warning, the response element the file's own comment says *"**唔可以**回對方嘅帳號"*.

The new test does not reach it: it asserts `Object.isFrozen` on `MASKED_BANK_SCHEMA.properties` and
`BANK_REVEAL_RESPONSE_SCHEMA.properties`, both of which are frozen. The test passes at this head while
this hole is open, which is how it survived.

`SUPPLIER_ID_PARAMS_SCHEMA` is re-exported from `supplierSchemas.js` and is out of this file's scope —
a note, not part of the finding.

**Fix.** Drop the `!Object.isFrozen(value)` guard (use a `WeakSet` for cycles if that is the concern), or
delete the now-redundant inner `Object.freeze` on that one `properties` literal so `deepFreeze` owns it.
Then extend the test to the `warnings` path, which is the one an added field would actually travel on for
a create or update response.

---

### [LOW] L-4 — The freeze's protective scope is narrower than the code comment and the ledger imply, and now measured

**Location:** `server/src/handlers/suppliers/supplierBankSchemas.js:14-17`; ledger observation *"REV-041:
one Medium and four Low…"*

The comment says a runtime `MASKED_BANK_SCHEMA.properties.accountNumber = {type:"string"}`
*「打穿咗上面講嗰道『結構性防線』」*, and the ledger says the shallow freeze *"left
`MASKED_BANK_SCHEMA.properties` writable so an account field could be added to the masked projection at
runtime"*. REV-041 suspected the compiled validator made such a mutation inert and marked it
**PLAUSIBLE**. I ran it (N-1 below): **post-registration widening is completely inert**, because
`ResponseValidator.compile` calls `ajv.compile(schema)` once per route inside the registration loop
(`apiDispatcher.js:296-299`). **Pre-registration widening leaks**, measured on the wire.

So the freeze is worth having and the remediation is not pointless — but it defends exactly one window:
module load through `createApplication`. After the routes register, the frozen object is decoration.
Neither the comment nor the ledger says which, and this is a module that has spent four rounds on
comments claiming properties the artefact does not have.

**Fix.** One clause in the comment: the freeze closes import-time and pre-registration mutation; after
`ajv.compile` at route registration the compiled validator is the barrier and the schema object is no
longer consulted. Same clause in the ledger observation. Nothing in the code needs to change.

---

## The five claimed remediations, verified independently

### M-1 — REV-039's `reviewed_baseline` — **holds**

Recomputed, not read. `Context.baselines()['design']` in a detached worktree at each head returns
`77ab26aa3d4ca6037416ffdc37c1c3f7c0e7c89504515f87e1291c621bc3d061` at `64ef1fc`, `e4083319…` at
`1de07da` and `e4083319…` at `80bbb95`. The value recorded on REV-039 is `77ab26aa…`, the value on
REV-040 is `e4083319…`, and the new REV-041 entry is `e4083319…` — all three now bind the hash that was
live at the head each names. That is every review entry in the file checked against the head in its own
`reviewer` field; no other entry names a head I could recompute, and the ten pre-`e4083319` records carry
their own era's hashes as REV-041 described.

The corrected count claim is L-1 above. The correction itself is right and the observation recording it
(*"Correction, and it is the same class as the finding it was closing"*) states the mechanism, names the
value it wrongly substituted, and says the convention was unambiguous. Nothing in it overstates.

### L — the three `PR_REVIEW` observations — **half holds; M-1 and the judgement below**

**Is `status: PASS` on a CHANGES_REQUESTED review honest bookkeeping or a misleading signal?** Honest,
and I checked it three ways rather than reasoning about it.

1. **It is the established convention, not a new one.** REV-035, REV-036 and REV-037 were all
   CHANGES_REQUESTED and all carry `status: PASS`. Sixteen prior `PR_REVIEW` observations, nineteen
   total; the verdict has always lived in `subject` and the counts in the report.
2. **The field does not mean "approved" to the toolchain.** `_observation` reads only
   `status == 'PASS'`, a non-empty `source_ref` and an `actor` outside
   `{AGENT, SELF, UNCONFIRMED, UNKNOWN}` — it never looks at a verdict. Approval semantics live in a
   different collection: `good_reviews` (`harness_checks.py:276-289`) requires
   `status == 'APPROVED'`, `reviewed_baseline == design_sha` and `open_critical == 0`. A `PR_REVIEW`
   observation cannot reach that filter. All three new records are CHANGES_REQUESTED and all three are
   correctly excluded from `good_reviews`, which remains satisfied by REV-038 alone.
3. **It cannot satisfy a gate it should not.** The only issue a `PR_REVIEW` PASS can clear is
   `PR_REVIEW_MISSING` — "a review was observed for this exact candidate" — and I ran the gate: that
   issue is **still reported** at this head, because `_observation` requires the candidate's own commit
   and none of the three names it. `REVIEW_NOT_SATISFIED` is not reported, and would not be affected by
   these records either way.

The `source_ref` on each says this in its own words: *"Status PASS records that the review was genuinely
performed and its provenance observed; it does not mean the review approved anything, and none of these
three did."* That sentence is the right disclosure and it is in the record rather than only in the report.

What does not hold is the triple on two of them — M-1.

### L — `HD-032`'s DESIGN-approval claim — **substance holds; method is L-2, count is L-1**

Seven DESIGN-kind approvals, one valid, as REV-041 stated and as I re-counted. The new sentence in the
question is accurate.

### L — the `ci.yml` key comment — **holds**

The comment now says the keys are test keys generated once and committed, that the repository is public
so anyone can read them, that they are therefore not secret, and that they must not be used outside CI.
All four clauses check out.

**Do the keys genuinely appear nowhere else?** `git grep -F` on each literal across all tracked paths:

```
R4EVice6+okHiRFgg4gm0rYpYKWA8HMxCVjxOlS9RQg=
  .github/workflows/ci.yml:107
  docs/.../41_rev_041_independent_review.md:231        (prose, quoting the finding)
THGVVay+dFBH7xi7a8a/BPGP/g16GnMI4Tu85N1AMMw=
  .github/workflows/ci.yml:109
  docs/.../41_rev_041_independent_review.md:232        (same)
ci-enc-1 / ci-look-1 → the same two files plus REV-040's report prose
```

One definition site each. This report adds no new occurrence of either literal.

**Does anything else treat them as secret?** No. `grep -n "secrets\." .github/workflows/*.yml` returns
**nothing at all** — this repository's workflows reference no GitHub Actions secret, so there is no
configuration anywhere claiming these values are protected. `server/.env.example` ships all four
variables **empty** with a commented `<32 bytes base64>` recipe. `server/test/configSecrets.test.js`
concerns `SecretValue` wrapping for JWT and database credentials and does not mention the Bank variables.
Nothing in the repository asserts a protection these values do not have.

### L — `deepFreeze` — **holds for seven of eight schemas; see L-3, L-4**

**Does the new test discriminate?** Yes, and so does the changed one. Three mutations on
`supplierBankSchemas.js`, each run against `server/test/supplierBankHandlers.test.js` (15 tests green at
the unmodified head) and each reverted:

```
MUT-1  remove the deepFreeze recursion line
  ✖ the masked schema cannot have an account field added to it at runtime        14/15
MUT-2  BANK_ACCOUNT_PARAMS_SCHEMA.required → ["id"]
  ✖ the child routes name the account in the path, so ownership is a route param 14/15
MUT-3  param pattern ^[1-9][0-9]{0,18}$ → ^[0-9]+$
  ✖ the child routes name the account in the path, so ownership is a route param 14/15
```

MUT-1 confirms the author's own discrimination claim. MUT-2 and MUT-3 confirm the point that matters for
the `.sort()` change: `assert.deepEqual([...params.required].sort(), ["bankAccountId","id"])` sorts a
copy, so it no longer mutates a shared schema, and it still fails on a changed required set — and the
pattern assertion beside it still fails on a widened pattern. The edit fixed a test that should never
have mutated a shared object and cost nothing in coverage. The author is right that the freeze exposed a
pre-existing defect rather than causing one.

**No regression anywhere else from freezing shared schema objects.** This was the real risk of the
change — some other caller sorting, pushing to or assigning into one of these arrays would now throw at
run time rather than silently corrupt. Full server suite at the unmodified head:

```
ℹ tests 1938   ℹ pass 1933   ℹ fail 3   ℹ skipped 2
  ✖ TC-008 Item 層級 media …
  ✖ TC-001 Item migrations 0010-0026 …
  ✖ TC-016 adapter verifies a separately restored schema …
```

One more test than REV-041 measured (the new freeze test), the same three items-module failures, none in
a supplier file, none in any suite this task's evidence runs. CI is green on this exact head, so these
remain local environment artefacts; HD-025 covers the standing policy.

---

## Attacks and probes that failed

### N-1 — Widening a response schema at run time: measured in both directions

REV-041 raised the shallow freeze and explicitly declined to test whether a runtime mutation actually
widens a live response, marking it **PLAUSIBLE**. I ran it against a real Node application on an
ephemeral port, real MySQL, real JWTs and a real scrypt hash, with the account-number leak forced into
the service so that a widened schema would have something to let through.

```js
// leak, applied for all three runs — SupplierBankService.list()
return { items: rows.map((r) => ({ ...toMaskedBankResponse(r), accountNumber: "LEAKCANARY1234" })) };
```

**Run A — at the unmodified head.**

```
BASELINE status 500, leak false
MASKED_BANK_SCHEMA.properties frozen: true
SCHEMA MUTATION REFUSED: TypeError
AFTER status 500, leak false
body: {"success":false,"error":{"code":"INTERNAL_SERVER_ERROR","message":"Internal server error"}}
```

The freeze refuses the write and the leak never crosses the wire. This reproduces REV-041's N-1.

**Run B — `deepFreeze` neutralised to the identity function, schema widened AFTER the routes register.**

```
properties frozen: false
mutated: true   MASKED_BANK_SCHEMA.properties.accountNumber = {"type":"string"}
AFTER status 500, leak false
```

**The mutation is inert.** `ResponseValidator.compile` calls `ajv.compile(schema)` once per route inside
the registration loop (`apiDispatcher.js:296-299`); the compiled function does not consult the schema
object again. So on the live HTTP path the freeze changes nothing — which is L-4.

**Run C — the negative control, same neutralised freeze, schema widened BEFORE `createApplication`.**

```
pre-registration mutation OK
status 200, body: {"success":true,"data":{"items":[{ … "maskedAccountNumber":"•••• 9648",
  "version":1,"updatedAt":…,"accountNumber":"LEAKCANARY1234"}]}}
```

**200, with the canary on the wire.** Without run C the result would have read as "the freeze is
pointless"; with it, the freeze's value is precise and non-empty — it closes the import-time and
pre-registration window, and only that window. Both directions measured, nothing inferred.

### N-2 — The masked list still refuses a forced leak

Run A above is also the re-run of REV-041's N-1 at this head, with the schemas file changed since. The
structural claim in the file's doc comment holds: response validation rejects the whole response with a
500 whose body carries no detail, and the canary does not reach the client.

### N-3 — The device password and the revealed account number cannot reach the request log

Nobody had checked this layer. `command(req)` spreads `req.input.body` — which carries `password` on all
five write routes and produces `accountNumber` on the reveal response — into the object handed to the
service, so the question is whether either can be written to a file that is retained for 30 days.

- `SupplierBankService` never logs the command: the only logger call in the file is
  `supplier.bank.reveal.unreadable` at `:571`, which passes identifiers, not input.
- `config/logging.js` sets `bodyCapture: "none"` and `bodyCaptureErrorStatus: 500`. The Bank handlers
  declare no `logging` override, so bodies are captured only on 5xx — a successful reveal's body is
  never written.
- On a 5xx the request and response bodies **are** captured, and `redactedFields` covers `password`,
  `accountNumber`, `bankAccountNumber`, `iban`, `accountNumberCiphertext`, `bankEncryptionKey`,
  `bankLookupKey`. I exercised the redactor rather than trusting the list:

```
in : {accountHolderName:"A", accountNumber:"7712345678901234", password:"Device-Pass-1!",
      nested:{accountNumber:"7799999999", items:[{accountNumber:"7788888888"}]}}
out: {"accountHolderName":"A","accountNumber":"[REDACTED]","password":"[REDACTED]",
      "nested":{"accountNumber":"[REDACTED]","items":[{"accountNumber":"[REDACTED]"}]}}
```

Recursive, and it reaches inside arrays. HELD at every depth I tried.

### N-4 — The key rings cannot be dumped by inspecting the configuration

The risk `configSecrets.test.js` exists to guard — every service can read the whole config, so the
failure mode is someone logging the config object — applies to the two Bank key rings as much as to the
JWT secret. `normalizeSupplierConfig` wraps each key in `secretValue(...)`:

```
util.inspect(config, {depth:8})  leaks key material: false
JSON.stringify(config)           leaks key material: false
CONTROL — the same key in a plain object, inspect: true, stringify: true
```

The control matters: without it the two `false`s prove only that my search string was wrong. HELD.

### N-5 — The evidence reproduces exactly

Re-ran the recorded argv verbatim in this worktree with the documented environment:

```
ℹ tests 394   ℹ pass 394   ℹ fail 0   ℹ skipped 0
```

Exactly the counts recorded in `evidence/20260921T094548-8fb42412bd2a/run.json`, one more than the
previous round, and the extra one is the new freeze test.

### N-6 — The ledger's own bookkeeping

```
evidence_files 94, missing on disk 0, on-disk run.json not listed 0   (append-only satisfied)
reviews 41 / approvals 38 / defects 21 / pending_decisions 32 — no duplicate ids in any collection
unanswered MAJOR decisions: none;  ANSWERED decisions missing answer_ref: none
the four new runs all bind plan db529678 + fingerprint c9b9fe38, i.e. the current baseline
```

The four new evidence runs record `code_commit 80bbb95` with the current fingerprint. Unlike the
observations in M-1, that pairing is the harness's designed shape for evidence — a developer self-test
may precede the commit provided the content fingerprint still matches (`harness_checks.py:166`) — so it
is correct here and I am not raising it.

### N-7 — No approval or review binds a hash that no longer exists without saying so

DESIGN and PLAN approvals are both valid (`APPROVAL_MISSING_STALE` is not reported by the gate). The
superseded chain is unchanged from what REV-041 verified: the dead-hash approvals are retained
unrewritten, each invalidated by hash, none claiming currency. One review now binds `77ab26aa…`, a
design baseline that no longer exists — deliberately, and it is the honest record of REV-039's H-1.

### N-8 — The boundary, at the recorded base

```
validate_module_boundary --base 71616ec  →  BLOCKED
  OUTSIDE_MODULE changes/.github/workflows/ci.yml: not in allowed_write_paths
```

Exactly one finding, the expected one, and the accepted cost of HD-032. `origin/main` was re-fetched
during this review and still equals the recorded `default_commit`.

### N-9 — The merge candidate's scope

`git diff main…HEAD` touches six non-documentation files: `ci.yml`, `server/.env.example`, the two
handler/schema files and the two test files. **No migration is in this change** and no service or crypto
source moved — the Bank schema arrived under TASK-032 and the service under TASK-033. The HTTP surface
is what is on offer here.

### N-10 — The handler surface, read on its own merits

- All five write routes are `jwt-device-password` with `BANK_WRITE_POLICY` (all three permissions); the
  reveal is `jwt-password` with `BANK_REVEAL_POLICY` (no `bank.mgmt`); the list is `BANK_VIEW_POLICY`
  (`supplier.view` only). That matches design §6.6 and §7.4 as the schemas file cites them.
- `command(req)` spreads the body **first**, so no body field can shadow `actorId`, `supplierId`,
  `requestId` or `ip` in an audit record. Today nothing can reach it — all five body schemas are
  `additionalProperties: false` — but the ordering does not depend on that.
- `bankAccountId` is conditionally spread, so create and list cannot produce a `NaN` route parameter.
  `server/test/supplierBankHandlers.test.js:229` pins it.
- Every route declares `query: EMPTY_BANK_SCHEMA`, so no query parameter reaches any Bank route —
  including `includeInactive`, which the service supports and HTTP cannot set.
- The constructor has no fallback path, which is design §1700's fail-closed startup requirement stated
  as code rather than as a comment.

### N-11 — Minor observations that did not rise to findings

- **The three `PR_REVIEW` `source_ref` texts are byte-identical**, so the REV-041 record explains itself
  by saying REV-041 found the other two missing. Harmless, slightly odd to read.
- **The `Cache-Control` deviation is still recorded three ways and all three still agree** — handler
  comment, schemas comment, ledger observation at `status: FAIL`, with the criterion unticked in
  `05_development_tasks.md`. Re-checked because a self-correction tends to soften as it is copied. It has
  not.
- **`PR_REVIEW_MISSING`, `CI_MISSING_OR_STALE` ×4, `REQUIRED_RUN_MISSING` ×4, `COMMIT_CHANGED` and 18
  `TASK_INCOMPLETE`** are all present at `MERGE_READY`, unchanged from REV-040 and REV-041. Every one is
  structural or planned. This is the module's standing "MERGE_READY cannot be fully green" condition.

---

## Positive observations

- **The M-1 correction was verified, not asserted.** The observation recording it names the mechanism,
  gives the three recomputed hashes, states that it costs nothing at any gate *and* why it still matters,
  and ends by naming the convention it broke. The author recomputed in detached worktrees rather than
  reading the previous report's number — which is the right response to a round whose whole finding was
  that a stated value had been silently substituted.
- **The `PR_REVIEW` records disclose the meaning of their own `status` field** rather than leaving a
  reader to infer that PASS means approved. That sentence is the difference between honest bookkeeping
  and a misleading signal, and it is in the ledger, not only in the report.
- **The deep freeze came with a test that attempts the thing that matters** — adding an account field to
  the masked schema — rather than a generic "is it frozen" assertion, and the author verified the test
  discriminates by removing the recursion. I reproduced that and it does.
- **The `.sort()` fix is the smaller, correct fix.** Sorting a copy rather than unfreezing the array, plus
  a comment saying why. The author names it as a pre-existing defect the freeze exposed, which is what it
  is.
- **The `ci.yml` comment now states four things and all four are true**, including the uncomfortable one
  — public repository, anyone can read them. I found no occurrence of either literal outside that file
  and review prose, and no configuration anywhere treating them as secret.
- **The crypto configuration is protected at the layer nobody had checked** (N-4), and the request logger
  cannot write a device password or a revealed account number to disk (N-3). Neither was claimed by this
  task; both held.

---

## Recommendations

1. Fix M-1 before merge. Two `code_commit` values, or all six fields — not the hybrid.
2. L-1 is one number. L-2 and L-4 are one sentence each. They can ride together.
3. L-3 is a real, if narrow, hole in the barrier this commit set out to build. It is three characters of
   guard and one assertion.
4. Standing, and the fourth time this task has produced a version of it: **a record's fields must be true
   together.** REV-039's H-1, REV-041's M-1 and this round's M-1 are the same defect in three different
   collections — a commit hash in one field and a baseline in the next that never coexisted. Before
   writing any record that carries a commit and a hash, recompute the hash at that commit. It took me one
   script and four detached worktrees.
5. Standing, for T35, carried forward from REV-041 and still true: the reveal endpoint writes a business
   audit row only on success. Refused attempts leave no trace in `supplier_audit_logs`. This matches
   design §1208; if insider probing is in scope for the Bank capability it is a design question to raise
   deliberately.

---

## Review hygiene

- **Four mutations**, each reverted immediately after its run, `git status --porcelain` empty in between:
  the `list()` masked projection (forced leak, used across all three N-1 runs), `deepFreeze`'s recursion,
  `deepFreeze` reduced to the identity function, `BANK_ACCOUNT_PARAMS_SCHEMA.required`, and the route
  parameter pattern.
- **One probe test** (the N-1 three-run experiment) written to
  `server/test/integration/zzrev042probe.integration.test.js`, derived from the existing Bank HTTP test
  so that it reused that file's cleanup, and deleted afterwards. It removed its own rows, role, user and
  supplier in `t.after`.
- **Seven detached worktrees** created under the session scratchpad to recompute baselines at
  `64ef1fc`, `1de07da`, `80bbb95`, `d161a6ab`, `6134836d`, `a7472b77` and `70344c5`, then removed with
  `git worktree remove --force` and `git worktree prune`. `git worktree list` is back to its three
  original entries.
- Scratch scripts and suite output were written to the session scratchpad outside the repository. The
  only file this review leaves inside the repository is this report.
- `git status --porcelain` was empty before the review, after every revert, and immediately before this
  report was written. Head under review never changed:
  `70344c590aab758acb7446977e3f20759a0783de` throughout. Nothing was committed.
- Nothing was fixed. Every finding above is a description and a proposed fix, not an edit.

## What I did not check

- The conversation behind `HD-032` and `HD-033`. I verified the records exist, are shaped like their
  neighbours and state their own lateness. I cannot verify that the Product Owner said those words.
- The RFC 9111 §5.2.2.5 reading underlying `HD-033`. REV-040 verified it, REV-041 accepted that, and so
  do I — **PLAUSIBLE**.
- `SupplierBankCrypto`'s primitives — key derivation, AAD construction, blind-index construction —
  beyond the round-trip and tamper behaviour the existing integration tests exercise against real MySQL,
  and beyond the configuration-exposure probe in N-4. TASK-032 and REV-033/034 covered that layer.
- The client side. `supplier-phase-001-client` is green at 71/71 and `client-build` passes; T34 has no UI
  surface and I read no Vue.
- AC-025 and AC-026 at the HTTP layer. They still have no HTTP-level test; §8 of the author's report
  discloses this and I confirmed the gap rather than closing it.
- Whether a *pre-registration* widening of `MASKED_BANK_WITH_WARNINGS_SCHEMA.properties.warnings`
  specifically reaches the wire on a create or update response. I proved the node is writable and proved
  the pre-registration mechanism end to end on `MASKED_BANK_SCHEMA` (N-1 run C); that the same mechanism
  applies to the warnings node is **PLAUSIBLE**.
- Re-derivation of the concurrency, duplicate-detection and step-up lockout behaviour that REV-039,
  REV-040 and REV-041 each attacked. None of that source moved in this commit; I re-ran it (394/394,
  1938 server-wide) rather than re-attacking it.
