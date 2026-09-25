# TASK-037 — Test Readiness Report

**Task:** TASK-037 (T37) ・**Phase:** PHASE-003 ・**Capability:** SUP-CAP-03 Bank Security
**Mode:** `TEST_AND_VERIFY` ・**Product-code policy:** `REPORT_ONLY`
**Baseline:** `9b2d0d3e0b2e0da284a0bfb99da861705279993f` (`main`, merged PR #147; CI run 36090912373 green on it)
**Assessed by:** Claude Opus 5 ・**Assessed against:** `05_development_tasks.md` §T37, `06_technical_test_cases.md` §6.7 and §6.13, `00_project_profile.json`

## Verdict: **BLOCKED** for formal Technical Acceptance ・**CONDITIONAL** for a defined executable subset

Formal Technical Acceptance of SUP-CAP-03 as the profile declares it cannot be executed on this
baseline. A useful and honest subset can be, and this report says exactly which.

**Nothing below is a test result.** No `TC-xxx` has been executed for this task yet.

---

## 1. What T37 requires

§T37 asks for *"完整Bank permission matrix、no-plaintext、tamper、rotation、backup／restore及client
memory驗證，形成SUP-CAP-03可簽核證據"* — signable evidence, not developer confidence.

| | |
| --- | --- |
| Technical cases | **TC-062 … TC-077** (= §6.7 `BANK-001` … `BANK-016`) and **TC-133** (= §6.13 `OPS-006`) |
| Requirements | FR-BANK-001…007, BR-019…021, SEC-005, SEC-006, SEC-010, SEC-011, SEC-013, NFR-009, NFR-010 |
| Acceptance criteria | AC-023, AC-024, AC-025, AC-026, AC-027 |
| Declared verification | two server integration suites, one client suite, **and a manual Security/Operations review** |
| Declared artefact | `docs/supplier_management/bank_operations.md` |

## 2. Baseline and environment — verified

| | Observed |
| --- | --- |
| Source baseline | `9b2d0d3` on `main`, immutable; TASK-036 merged at `fddcc44`, CI green on both |
| Design baseline | `e4083319e526682f70b40a0b2676ae5b50cc72d8f03e9e07c6d6fbb671f211e4` |
| Plan baseline | `db5296785c7f74a5925e8f0f4e7edecb3ef4fa48f26fdcd33ffe4d7e0b95e087` |
| Node | v26.6.0 |
| Playwright CLI | 1.63.0, present; `client/e2e/supplier-management/playwright.config.js` starts its own `webServer` on `127.0.0.1:5203` |
| MySQL | reachable on 3306 (the developer's own instance — **not** to be used as an acceptance target); a throwaway instance was used for TASK-036 and can be rebuilt |
| Integration gate | `DB_INTEGRATION_TESTS=1` plus `SUPPLIER_BANK_*` and, since the customer module landed, `CUSTOMER_BANK_*` |

## 3. What blocks formal acceptance

### 3.1 The profile's acceptance suites point at paths that do not exist

`00_project_profile.json` declares the suites that carry these stages. Checked on this baseline:

| Suite | Stages | Declares | Target |
| --- | --- | --- | --- |
| `supplier-bank-security` | DEVELOPER, TECHNICAL, REGRESSION | **TC-062 … TC-077** | `server/test/supplier-management/bank` — **missing** |
| `supplier-recovery` | TECHNICAL, REGRESSION | **TC-133** | `server/scripts/runSupplierRecoveryAcceptance.js` — **missing** |
| `supplier-server-integration` | — | — | `server/test/supplier-management` — **missing** |
| `supplier-security` | — | — | `server/test/supplier-management/security` — **missing** |
| `supplier-client-ui` | — | — | `client/test/supplier-management.vitest.config.js` — **missing** |
| `supplier-performance` | — | — | `server/scripts/runSupplierPerformanceAcceptance.js` — **missing** |
| `supplier-resilience` | — | — | `server/scripts/runSupplierResilienceAcceptance.js` — **missing** |
| `supplier-release-operations` | — | — | `server/scripts/runSupplierReleaseAcceptance.js` — **missing** |

The two that matter for this task are the first two. **Every `TC-xxx` this task must produce evidence
for is declared by a suite that cannot run.** This was already recorded as a known module-level gap;
it is restated here because it is this task's primary blocker, not background noise.

### 3.2 No test in the repository is labelled with this task's case IDs

The repository's convention is to name a test after the case it discharges — 40 distinct `TC-xxx`
IDs are cited across `server/test`, `client/test` and `client/e2e`. **None of TASK-037's seventeen
is among them.** The three apparent hits for `TC-064`, `TC-065` and `TC-066` belong to the *customer*
module's namespace, and the apparent hits for `BANK-005/006/007` are the requirement IDs
`FR-BANK-005/006/007`, not the case IDs.

Consequence: `Requirement → Design → Phase → Task → TC → evidence` cannot be completed mechanically
for this task. Any mapping from an existing test to a `TC-xxx` would be my judgement, recorded as
such — not a link the repository asserts.

### 3.3 Two cases have no harness at all

| Case | Needs | Status |
| --- | --- | --- |
| `BANK-016` / `TC-133` | an isolated restore target; restore of DB + key ring, DB only, and DB + wrong key; start-up and reveal after each | no restore harness exists |
| `BANK-013` | one fictitious marker driven through success and failure flows, then a scan of DB dump, request/system/audit logs, errors, cache, CSV and notifications | no full-channel scan harness exists |

`BANK-013` is the case that discharges AC-027 and SEC-010/011 — the "no plaintext anywhere" claim.
It is the single most load-bearing case in SUP-CAP-03 and it is also the one with no harness.

### 3.4 `bank_operations.md` does not exist

§T37 names it under *Files likely touched*, and the third Verification bullet requires the
backup/restore/rotation **runbook** to be reviewed and approved. There is no runbook to review.

### 3.5 The third Verification bullet is a human gate

*"Manual Security／Operations review：backup、restore、rotation runbook與evidence獲批准"* — an
authorised human must accept this. I can prepare and present evidence; I cannot grant it, and no
automated result substitutes for it.

## 4. What can be executed now

Everything here is runnable on this baseline without writing product code:

| | |
| --- | --- |
| `server/test/integration/supplierBank.integration.test.js` | 11 integration tests, real MySQL |
| `server/test/integration/supplierBankRotation.integration.test.js` | 5 integration tests, real MySQL |
| `client/test/pages/suppliers/bank.test.js` | 26 tests |
| `server/test/supplierBank{Crypto,Handlers,Service,KeyRotation,RotationCli}.test.js` | 23 + 15 + 29 + 21 + 15 developer tests |
| `client/e2e/supplier-management/supplier-bank.spec.js` | 3 Playwright tests, real browser |
| Profile suite `supplier-phase-001-server` | the DEVELOPER-stage suite that does exist |

That is substantial real coverage of the *behaviour*. What it is not is evidence indexed by the case
IDs this task must sign off, and it does not reach `BANK-013` or `BANK-016` at all.

## 5. Conditions to lift the block

1. A decision on the missing acceptance harness (building it is implementation work and is outside
   `TEST_AND_VERIFY`; it needs an explicit mode change or an authorised exception).
2. A decision on whether an existing test may be credited to a `TC-xxx` by assessment rather than by
   a declared link, and if so, how that judgement is recorded.
3. An isolated restore target and a scan harness, or an accepted `BLOCKED` for `BANK-013`/`BANK-016`.
4. `bank_operations.md` written, for the human review to have a subject.
5. A named human authority for the Security/Operations review.

Until 1–3 are settled, executing the runnable subset produces a **partial technical result**, never
Technical Acceptance, and never business sign-off.
