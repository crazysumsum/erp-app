# REV-123 — independent review of the UAT PHASE-003 bank cases (HD-124 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-uat-phase-003` at `9f9e04e6`, reviewed as `git diff origin/main..HEAD` (base `2fb7fcf8`)
- **Verdict:** **CHANGES_REQUESTED**
- **Findings:** 0 Critical, 4 Required, 6 Optional, plus nits.

## What the reviewer confirmed

- **The cases bite.** Of 19 product mutants, 14 were killed, almost all on their intended assertions.
- **DEF-046 is real.** The fixed wording passes UAT-028, and the fixed wording combined with "old default not cleared" fails it.
- **DEF-047 is real.** No server code records or alerts on system-admin bank use.
- **Hiding deactivated rows is not a defect.** FR-BANK-005 asks only for retention and deactivation, and §6.6's GET does not list inactive rows.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| R1: the no-plaintext log control could pass vacuously. It searched all logs for a path that earlier runs had already written, and the reviewer's run with request logging off still passed. | The check now reads only the bytes each log file gained during the test. Its control waits for the test's last bank request id (`X-Request-Id`) in the request log only. While verifying this, a mutant that stopped logging bank requests still passed, because a refused request writes its id to the system log. The control was narrowed to `requests-*.log`, and that mutant is now killed on the control assertion. |
| R2: UAT-030 was green although DEF-047 is open. | UAT-030 now ends with an alert step: a warn-level or higher system log event naming the Supplier. It fails on DEF-047. The TC map and the ledger record 3 passes and 2 defect failures. |
| R3: the server's re-authentication for bank writes was unproven. A mutant that dropped the password from the update route survived. | UAT-030 saves an edit with a wrong password, expects the error, reloads and checks the row is unchanged, then saves with the right password. The mutant now fails at the error step. |
| R4: a failed assertion could write a full account number into junit and `error-context.md`. | Plaintext is compared as booleans. While a number is on screen or in an input, only `expect.poll` is used. The failure aria snapshot is off (`PLAYWRIGHT_NO_COPY_PROMPT`). After the fix, the reports and error-context files of failing runs contain no account number. The six earlier `error-context.md` files that held one were deleted. |
| O1: `evidence()` checked only the reveal element. | It now also checks that no account number of the case is on the page. A mutant that keeps the number in the page after collapse fails at that check. |
| O2: a 31 s deadline survived. | The clock is paused right after the reveal, so the boundary no longer drifts with real time. The 29 s, 31 s and 20 s deadline mutants all fail. |
| O3: the leave-page step cannot tell which clear trigger fired. | Accepted as an equivalent mutant. The TC map and the spec say the step proves only what the user sees. |
| O4: a mutant removing only the service-level reveal check survives behind the route policy. | No change: the service-level check is defence in depth and belongs to technical tests. |
| O5: the server's stdout is not scanned. | Recorded as a scope limit in the TC map. |
| O6: with the line and junit reporters, `testInfo.attach({ body })` screenshots are not written to disk (all phases). | Open follow-up, outside this diff: the shared evidence helper should write to a file and attach by path. |
| Nit: database checks used as acceptance evidence. | Each is marked as a technical supplement in the spec, the `uatSupport.js` header lists this third use, and the TC map says so. |
| Nit: DEF-047 wording. | Reworded. The request log records each bank route and status without the actor, so counts are derivable, but no alert or metric exists. |
| Nit: UAT-025's refusal prompt. | The TC map notes that a VIEWER has no reveal control, so the refusal is the server's 403. |
| Nit: inactive-row badge and edit control are dead code. | Noted in the TC map; not changed. |

## Verification after the fixes

| Mutant | Case | Result |
| --- | --- | --- |
| Request logging disabled | 025 | Killed: no request ids. With logging off, the response carries no id. |
| Request log skips bank routes | 025 | Killed on the request-log control after the control was narrowed. Before that, it survived. |
| Bank update route without password | 030 | Killed at the wrong-password error. |
| Reveal deadline 20 s, 29 s and 31 s | 026 | Killed: "still shown at 29 s" for 20 s and 29 s; "cleared at 30 s" for 31 s. |
| Number kept on the page after collapse | 026 | Killed by the evidence check. |
| Revealed number written to the system log | 026 | Killed on "no full account number in the server logs". |
| Request log `minimumLevel` set to error | 025 | Survived, because the change did not stop request lines being written. The mutant was ineffective, so it was replaced by the skip-bank-routes mutant above. |

- **PHASE-003:** 3 passed; UAT-028 failed on DEF-046 and UAT-030 on DEF-047; 2 `test.fixme`.
- **Full UAT config:** 32 passed, 2 failed (those two), 7 skipped.
- **Plaintext scan:** no account-shaped number in any junit or `error-context.md` written after the fixes. The only matches in the browser profiles were inside hex hashes in V8's code cache.
- **Lint:** eslint exits 0.
- **After PR #286:** DEF-046 and DEF-047 were fixed and the branch was rebuilt on main `2b4040e2`. The full UAT config then gave 34 passed and 7 skipped. PHASE-003 passed 5 cases, and UAT-029 and UAT-053 are `test.fixme`.
