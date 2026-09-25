# TASK-037 — Technical Test Report (partial)

**Task:** TASK-037 (T37) ・**Capability:** SUP-CAP-03 ・**Mode:** `TEST_AND_VERIFY` ・**Product code:** `REPORT_ONLY`
**Baseline:** `9b2d0d3` plus the two harnesses added by this task
**Scope decision:** build harnesses for the two cases that had none — `BANK-013` and `BANK-016` — and
assess the remaining fourteen without executing them. Taken by the user.

## Result: **NOT Technical Acceptance**

Two of seventeen cases were executed. Fifteen were not. Technical Acceptance of SUP-CAP-03 is **not**
granted by this report and cannot be until the readiness conditions are met.

| | |
| --- | --- |
| Executed, `PASS` | **TC-074** (BANK-013), **TC-077** (BANK-016) |
| Not executed | TC-062…TC-073, TC-075, TC-076 — fourteen cases, status `NOT_RUN` |
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
The collapsing itself is correct and is not a finding — it is the right thing to tell a caller.

### Finding recorded, not fixed (REPORT_ONLY)

**OBS-037-2 — `ER_LOCK_DEADLOCK` reaches the caller.** When this case's fixture runs concurrently with
the existing deliberate-contention tests, InnoDB deadlocks and `SupplierBankService` surfaces the
driver error rather than retrying. Normal for an application to delegate the retry, but it is not
documented anywhere an operator would look, and `bank_operations.md` does not exist yet. Severity
**Low**. The harness retries **only its fixture seed**, never an assertion.

---

## 3. The fourteen cases that were not executed

These are `NOT_RUN`. The notes are a **coverage assessment made by reading existing tests** — not a
result, and explicitly not a PASS. `TEST_AND_VERIFY` forbids inferring a result from code review or
from a developer suite, and nothing here is offered as one. No test in the repository declares itself
as discharging any of these cases.

| Case | Status | Existing tests that bear on it | Assessed gap |
| --- | --- | --- | --- |
| BANK-001 masked list | `NOT_RUN` | handler schema tests, crypto masking tests, HTTP masked-list integration | the six role combinations are not enumerated over HTTP |
| BANK-002 controlled reveal | `NOT_RUN` | audit-before-plaintext and audit-failure service tests, cache-header handler test | `expires=30` and `no-store` are asserted at schema level, not on a live response |
| BANK-003 write permission matrix | `NOT_RUN` | "every write demands all three permissions and a device password", per-write re-check | the matrix is not driven role by role over HTTP |
| BANK-004 device / password / replay | `NOT_RUN` | step-up schema declarations only | **nonce replay is exercised nowhere** — the largest assessed gap |
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
2. The fourteen cases above need execution against their own case IDs, not assessment.
3. `BANK-004`'s replay/nonce path needs a test before SUP-CAP-03 can claim SEC-013.
4. `TC-133` (OPS-006) needs a module-wide restore drill.
5. `bank_operations.md` must exist for the Security/Operations review to have a subject.
6. A named human authority must accept the review. Nothing in this report substitutes for it.
