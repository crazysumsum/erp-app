# TASK-037 — Technical Test Report (partial)

**Task:** TASK-037 (T37) ・**Capability:** SUP-CAP-03 ・**Mode:** `TEST_AND_VERIFY` ・**Product code:** `REPORT_ONLY`
**Baseline:** `9b2d0d3` plus the two harnesses added by this task
**Scope decision:** build harnesses for the two cases that had none — `BANK-013` and `BANK-016` — and
assess the remaining fourteen without executing them. Taken by the user.

## Result: **NOT Technical Acceptance**

Sixteen of seventeen cases were executed; one of them fails. TC-133 has no harness. Technical Acceptance of SUP-CAP-03 is **not**
granted by this report and cannot be until the readiness conditions are met.

| | |
| --- | --- |
| Executed, `PASS` | TC-062…TC-067, TC-069…TC-077 — fifteen cases |
| Executed, **`FAIL`** | **TC-068** (BANK-007) — two of its three expectations; DEF-026 (MEDIUM), **DEF-027 (HIGH)** |
| Executed, `PASS` with recorded deviations | TC-063 (BANK-002) — DEV-T34-CACHE-PRIVATE, DEV-T34-EXPIRES-IN, both accepted under HD-033 |
| Not executed, no harness | **TC-133** (OPS-006) — status `BLOCKED` |
| Not executed, no harness | **TC-133** (OPS-006) — out of the agreed scope, status `BLOCKED` |
| Business acceptance | `PENDING_USER_ACCEPTANCE` — the Security/Operations review is a human gate |

---

## 1. TC-074 — BANK-013 — full-channel plaintext leak scan — **PASS**

**Requirements:** FR-BANK-007, BR-020, SEC-010, SEC-011 ・**Acceptance criterion:** AC-027
**Evidence:** `server/test/integration/supplierBank.integration.test.js`, case
`TC-074 (BANK-013): after success and failure flows, no channel on this baseline carries the account`

A unique fictitious account is driven through success flows (create, re-encrypting update, reveal,
set default) and failure flows (same-supplier duplicate, cross-supplier reveal, reveal of a row whose
auth tag was corrupted), then through three real HTTP requests against a started application.

Six channels are then searched, each in seven encodings (utf8, latin1, hex, HEX, base64, base64url and
MySQL's `\xNN` rendering):

| Channel | How it is obtained | Result |
| --- | --- | --- |
| `db_dump` | `mysqldump` of the whole schema | 0 hits |
| `audit_log` | every audit row written by the flows | 0 hits |
| `request_log` | the files the request logger actually wrote | 0 hits |
| `system_log` | the files the system logger actually wrote | 0 hits |
| `http_responses` | every response body and header collected | 0 hits |
| `errors` | message, stack, public code and details of each failure | 0 hits |

**Every channel carries its own control.** Before each verdict the same scanner is run over the same
content with a marker planted in it, and is required to find it. Without that, "0 hits" and "the
scanner cannot see this kind of content" are the same observation — a mistake this module made twice
during TASK-036.

**The case was also shown to fail on a real leak.** Removing `accountNumber` from `redactedFields` in
`server/config/logging.js` turns TC-074 red on `request_log`. The case is not a check that cannot fail.

**Channels that do not exist on this baseline** — recorded `NOT_APPLICABLE`, not `PASS`:

| Channel | Why |
| --- | --- |
| CSV | no export module exists under `server/src/modules/supplier/`; SUP-CAP-05 is not built |
| cache | no cache service under `server/src/services/` |
| notification | same |

A nothing cannot leak, but it also proves nothing. The case carries an assertion that fails the moment
a `SupplierExportService` appears, so this reduction cannot outlive the condition that justified it.

### Finding recorded, not fixed (REPORT_ONLY)

**OBS-037-1 — the request log's protection against plaintext is a field-name blacklist.**
`redactedFields` lists `accountNumber`, `iban`, `bankAccountNumber` and so on, and
`bodyCaptureErrorStatus: 500` forces a full body capture on any 5xx. The account number is kept out of
a 30-day log file by the fact that the API contract happens to name that field `accountNumber`. A
plaintext arriving under a different name, nested, or in a URL is not covered. Severity assessed as
**Low on this baseline** (no such path exists today) with a **note for SUP-CAP-05**, whose CSV import
will accept account numbers under column names the blacklist has never seen. No product change made.

## 2. TC-077 — BANK-016 — Bank backup and restore — **PASS**

**Requirements:** NFR-009, SEC-010 ・**Evidence:** `server/test/integration/supplierBankRestore.integration.test.js`

A row is created under a known key ring, the schema is dumped, and the dump is loaded into a freshly
created schema. Three reveals are then attempted against the restored data:

| Restore | Key ring given | Result |
| --- | --- | --- |
| DB + its own key ring | correct | the account comes back intact |
| DB only | the key id is absent from the ring | refused, coded, no account in message, stack or details |
| DB + wrong material | same key id, different bytes | refused on the GCM tag, no account, no garbage returned as if it were one |

The restored ciphertext, IV, tag and key id are unchanged afterwards: fail-closed is not achieved by
rewriting data.

**The first case is the control.** A harness that could decrypt nothing would report all three as
"fails closed" and pass. Case 1 is required to return the account, which is what makes cases 2 and 3
mean anything.

### What mutation found in this harness

Mutating the crypto to fall back to the active key when the row's key id is not in the ring — a
textbook fail-open — **survived the first version of this case**. The service deliberately collapses
"key not in ring" and "key is wrong" into one `BANK_ACCOUNT_UNREADABLE`, so that layer cannot tell them
apart. A crypto-layer assertion requiring `BANK_KEY_NOT_IN_RING` was added; all three mutants now die.
~~The collapsing itself is correct and is not a finding — it is the right thing to tell a caller.~~ **Withdrawn.** That sentence judged the behaviour against my own view instead of the approved design, which gives the two cases different answers — `503 BANK_KEY_UNAVAILABLE` when the key is absent, a generic `500` for an integrity failure. The collapse into one `422` was introduced during the REV-035 remediation with no recorded decision. It is **DEF-026**; see §2b, TC-068.

### Finding recorded, not fixed (REPORT_ONLY)

**OBS-037-2 — `ER_LOCK_DEADLOCK` reaches the caller.** When this case's fixture runs concurrently with
the existing deliberate-contention tests, InnoDB deadlocks and `SupplierBankService` surfaces the
driver error rather than retrying. Normal for an application to delegate the retry, but it is not
documented anywhere an operator would look, and `bank_operations.md` does not exist yet. Severity
**Low**. The harness retries **only its fixture seed**, never an assertion.

---

## 2a. TC-065 — BANK-004 — device, password and replay protection on every Bank write — **PASS**

**Requirement:** SEC-013 ・**Evidence:** `server/test/integration/supplierBankDeviceWrites.integration.test.js`

Everything is real: a started application, real HTTP, a JWT carrying `did`, `user_devices` bindings, a
non-extractable ECDSA P-256 key generated through WebCrypto exactly as the browser client does, the
application's own `deviceBinding.signingInput` (not a copy of it), and a scrypt-hashed password.

Each of the four write routes — create, update, set default, deactivate — receives seven attacks,
then one fully legitimate request, then an exact replay of that request:

| Attack | Must be refused as |
| --- | --- |
| password omitted | `PASSWORD_REQUIRED` |
| wrong password | `PASSWORD_INVALID` |
| device headers omitted | `DEVICE_SIGNATURE_REQUIRED` |
| device revoked | `DEVICE_REVOKED` |
| body changed after signing | `DEVICE_SIGNATURE_INVALID` |
| signature moved to another path | `DEVICE_SIGNATURE_INVALID` |
| accepted request replayed verbatim | `DEVICE_SIGNATURE_INVALID`, logged as `nonce_replayed` |

After every refusal: no Bank row changed, no audit row written, no password, token or account in the
response, and none of the internal reasons (`nonce_replayed`, `signature_invalid`, `timestamp_stale`)
exposed to the client. Every legitimate request must succeed and write exactly one audit row — the
control without which every refusal above could be the harness failing to sign anything. The system
log must hold exactly four `auth.device.signature_rejected` events with reason `nonce_replayed`, one per
route, and no secret.

### What mutation found in this harness

The first version passed with **nonce replay protection switched off entirely**. Every replay was
still refused — but not by the nonce. An update, default or deactivate replay carries a version that
the first request already advanced, so it dies as a 409 version conflict; a create replay carries an
account that now exists, so it dies as `BANK_ACCOUNT_DUPLICATE`. Two genuine refusals, neither of them
the protection this case exists to prove. The assertions were changed to require each attack to fail
**as its intended code**, and the replay to appear in the device log as `nonce_replayed`.

| Mutant | Result |
| --- | --- |
| nonce consumption disabled | killed — the create replay came back as `BANK_ACCOUNT_DUPLICATE` |
| signature never checked | killed — a body changed after signing was accepted |
| password re-authentication skipped | killed — a missing password surfaced as schema validation, not `PASSWORD_REQUIRED` |
| revoked binding accepted | killed |
| internal reason added to the client message | killed — `signature_invalid` reached the client |

### Observation, not a defect

The wrong-password path consumes a nonce: device verification (which records the nonce) runs before
the password check, by design, because ECDSA is far cheaper than scrypt. A request refused for a wrong
password therefore cannot be retried with the same nonce — asserted in the harness against `user_device_nonces`, not inferred from the code. That is the correct direction — the
alternative lets an attacker probe passwords without spending nonces — and it is recorded here only
because a client implementer would otherwise meet it as a surprise.

## 2b. The thirteen remaining cases — executed against their own case IDs

Each case's expected result was compared sentence by sentence with what the tests actually assert.
Where the existing tests covered it fully, they were **labelled with the case ID** (29 tests, title
changes only) so that `TC → test` is a mechanical link rather than a judgement; where they did not,
the gap was filled in `server/test/integration/supplierBankAcceptance.integration.test.js`.

| Case | Result | How |
| --- | --- | --- |
| TC-062 BANK-001 masked list | **PASS** | New, over HTTP: U-VIEW, U-MGMT, U-BANK-R, U-BANK-W all see masks only; a ≤4-digit account carries no character of itself; no crypto field in the projection; U-NONE 403, no token 401 |
| TC-063 BANK-002 controlled reveal | **PASS**, recorded deviations | New, over HTTP: wrong password 403 `PASSWORD_INVALID` and no audit; without bank.view 403 and no audit; legitimate reveal audited before the plaintext arrives, `no-store`, `Pragma: no-cache`. `private` and `expiresInSeconds` absent — accepted deviations under HD-033, asserted so a change is noticed |
| TC-064 BANK-003 write permission matrix | **PASS** | New, over HTTP: U-MGMT, bank.mgmt-only and U-BANK-R each refused 403 on all four write routes with a valid device and password, nothing changed, nothing audited; U-BANK-W succeeds on all four as the control |
| TC-066 BANK-005 create stores only ciphertext | **PASS** | Existing integration tests, labelled; logs covered by TC-074 |
| TC-067 BANK-006 crypto integrity and AAD | **PASS** | Existing crypto tests (round trip, per-row IV, moved row, swapped context, one bit flipped in ciphertext, tag and IV) and the moved-row integration test, labelled |
| **TC-068 BANK-007 key unavailable** | **FAIL** | New, over HTTP. No plaintext is ever returned — **PASS**. The refusal is `422 BANK_ACCOUNT_UNREADABLE`, not the designed `503 BANK_KEY_UNAVAILABLE`, and it is the same code as a tampered row, which the design makes a `500` — **FAIL, DEF-026**. A row whose lookup key is absent from the ring lets the same Supplier add the same account again, and startup does not notice — **FAIL, DEF-027 (HIGH)**. The two failing expectations are `todo` tests: they run, their failure is visible, CI stays green |
| TC-069 BANK-008 unique default | **PASS** | Existing integration tests incl. two concurrent switches, labelled |
| TC-070 BANK-009 duplicate blind index | **PASS** | Existing crypto, service, integration and client tests (the client makes a cross-Supplier duplicate an explicit confirmation), labelled |
| TC-071 BANK-010 update re-encryption | **PASS** | New: renaming leaves ciphertext, IV, tag, index and both key IDs byte-identical; changing the account replaces all of them, stores neither account in clear, and is audited without either |
| TC-072 BANK-011 deactivate | **PASS**, one part N/A | New: deactivation clears the default and keeps the row; DELETE on a Bank row is answered exactly as an unregistered route. Payment references do not exist on this baseline — that half is `NOT_APPLICABLE` |
| TC-073 BANK-012 audit failure | **PASS** | New: with an audit that throws, create, update, set default, deactivate and reveal each fail, change nothing and return nothing; the same update with a working audit succeeds as the control |
| TC-075 BANK-014 client plaintext lifecycle | **PASS** | Existing client tests and **three Playwright tests in real Chromium**, including a real 30-second wait, labelled. The Playwright suite mocks the API at the network layer — appropriate for a client-memory case, and stated here because it is not end-to-end |
| TC-076 BANK-015 rotation | **PASS** | TASK-036 integration tests, labelled |

### Mutation, and three mistakes of mine it caught

| Mutant | Result |
| --- | --- |
| short account's writer exposes its digits | survived — **and correctly so**: the renderer masks by `account_length` independently. Breaking both guards is killed |
| `Pragma` dropped | killed |
| reveal writes no audit | killed |
| route policy needs only bank.mgmt | killed |
| both layers need only supplier.view | killed |
| rename also rewrites the IV | killed |
| deactivate keeps the default flag | killed |
| audit failures swallowed | killed |

- **A check that could not fail.** TC-063's audit query first used `action = 'bank.reveal'`; the stored
  value is `supplier.bank.reveal`, so it always counted 0 and the two "no audit on refusal" assertions
  passed vacuously. The positive control — a legitimate reveal must add exactly one — caught it.
- **An expectation that was wrong.** TC-072 first expected 404/405 for DELETE. This framework answers
  every unregistered `/api` request with `401 Unauthorized Access`, deliberately. 401 alone cannot
  distinguish "no route" from "bad token", so the case now requires the same token to succeed on a
  registered route and the DELETE to be answered exactly as a nonexistent route is.
- **A meaningless assertion.** TC-062's first draft contained `assert.ok(short || true)`, removed
  before it ever ran.

### A consequence of the `todo` tests that the reviewer should know

In JUnit output a `todo` test that fails carries both `<skipped type="todo">` and `<failure>`, and the
harness JUnit adapter classifies it as **FAIL**. So **CI is green while a harness run of
`supplier-phase-001-server` reports two failures** — which is the truth about BANK-007, but it also
means any later task gated on that suite is blocked by this defect until it is fixed or the two
expectations are moved out of that suite's glob. That choice is recorded as a decision, not taken here.

### Low observation

Design §5.8 says a short account is masked with `*`; the implementation uses `•`. Cosmetic, no
security effect; recorded for the reviewer rather than raised as a defect. Later recorded as DEF-028
(LOW) and fixed — see §2c.

## 2c. Remediation and retest of TC-068 — branch `claude/supplier-def-026-027`

The results above stand for the baseline they were taken on. The Product Owner authorised remediation
(a mode change to `IMPLEMENT` for these three defects only); the retest below is on the fix branch
and is not Technical Acceptance by itself.

| Defect | Decision | Fix | Retest |
| --- | --- | --- | --- |
| DEF-026 (MEDIUM) | change code to match the design | a key missing from the ring is `503 BANK_KEY_UNAVAILABLE`; a GCM failure is a generic `500`; each logs its own error event | TC-068 part 2 and TC-077 enforced — **PASS** |
| DEF-027 (HIGH) | option (b): fail closed per Supplier, startup only logs | a Supplier with a row on a lookup key outside the ring gets `503` on create and account change; startup logs `supplier.bank.keys_outside_ring` and does not refuse to start | TC-068 part 3 enforced — **PASS**; another Supplier unaffected (control); a deactivated such row still blocks (REV-057 M-1); re-entering the account repairs a row only when it is active and the Supplier's only such row, a second one still blocks (control); startup check exercised against real MySQL, lookup half asserted separately (REV-057 L-1) |
| DEF-028 (LOW) | change code to match the design | accounts masked with `*` | projection tests; Playwright `supplier-bank.spec.js` (API mocked) — **PASS** |

No `todo` tests remain in the Bank suites, so the JUnit concern in the previous section no longer applies.

Mutation on the fix: write check removed; check not scoped to the Supplier; the row being rewritten
blocking itself; refusal logged as `warn`; startup check throwing; startup check reading the wrong
column; startup check never logging; mask reverted — **all eight killed**. The self-blocking mutant
first **survived**: the unit fake ignores SQL, so it could not tell. A real-MySQL test was added and
the mutant is now killed.

REV-057 (independent, CHANGES_REQUESTED) found three more that survived: a status filter on the 503 check
(M-1), the startup check's skip guard removed (L-2), and an invalid lookup column in the startup check
(L-1). Tests were added for each, plus the driver code read through the database wrapper (L-3) and a
completion log so silence is no longer the pass signal (L-4). All five mutants are now killed. For the
lost-key recovery REV-057 M-2 raised, the Product Owner chose HD-038 option (b): the lookup reindex takes
`--from-lost`. Verified against real MySQL on the reviewer's lockout shape (two rows on the lost key, one
inactive); its five mutants are killed.

---

## 3. (Superseded by §2b) The coverage assessment made before execution

These are `NOT_RUN`. The notes are a **coverage assessment made by reading existing tests** — not a
result, and explicitly not a PASS. `TEST_AND_VERIFY` forbids inferring a result from code review or
from a developer suite, and nothing here is offered as one. No test in the repository declares itself
as discharging any of these cases.

| Case | Status | Existing tests that bear on it | Assessed gap |
| --- | --- | --- | --- |
| BANK-001 masked list | `NOT_RUN` | handler schema tests, crypto masking tests, HTTP masked-list integration | the six role combinations are not enumerated over HTTP |
| BANK-002 controlled reveal | `NOT_RUN` | audit-before-plaintext and audit-failure service tests, cache-header handler test | `expires=30` and `no-store` are asserted at schema level, not on a live response |
| BANK-003 write permission matrix | `NOT_RUN` | "every write demands all three permissions and a device password", per-write re-check | the matrix is not driven role by role over HTTP |
| BANK-005 create stores only ciphertext | `NOT_RUN` | column-width integration test, plaintext-absence scan | — |
| BANK-006 crypto integrity and AAD | `NOT_RUN` | eleven crypto tests incl. AAD boundary shifting and bit tampering | — |
| BANK-007 key unavailable | `NOT_RUN` | "a row whose key is no longer in the ring is refused, and the error is not an oracle" | startup fail-closed was demonstrated during TASK-034, not re-run here |
| BANK-008 unique default | `NOT_RUN` | concurrent default switch, DB-level constraint test | — |
| BANK-009 duplicate blind index | `NOT_RUN` | normalization, ring-wide duplicate check, real `ER_DUP_ENTRY` → 409 | — |
| BANK-010 update re-encryption | `NOT_RUN` | "update re-encrypts only when the account itself changed" | — |
| BANK-011 deactivate and references | `NOT_RUN` | deactivate clears default | payment references do not exist on this baseline |
| BANK-012 audit failure rollback | `NOT_RUN` | "a reveal whose audit fails returns no account at all" | shown for reveal; not for create/update/default/deactivate |
| BANK-014 client plaintext lifecycle | `NOT_RUN` | 26 client tests and 3 Playwright tests from TASK-035 | — |
| BANK-015 key rotation | `NOT_RUN` | rotation unit and integration suites from TASK-036 | — |

## 4. What is required before Technical Acceptance

1. The profile's `supplier-bank-security` and `supplier-recovery` suites point at paths that do not
   exist; until that is resolved, no `TC-xxx` in this task can be produced by a declared suite.
2. ~~The cases above need execution against their own case IDs.~~ Done — §2b. TC-068 fails.
4. `TC-133` (OPS-006) needs a module-wide restore drill.
5. ~~`bank_operations.md` must exist for the Security/Operations review to have a subject.~~ It now exists and every command in it was executed against a CI-like MySQL; the review itself is still outstanding.
6. A named human authority must accept the review. Nothing in this report substitutes for it.
