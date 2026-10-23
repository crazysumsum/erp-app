# REV-115 — independent review of the real-backend UAT harness and the PHASE-001 cases (HD-124 A)

- **Reviewer:** `agent-skills:code-reviewer` (a separate agent; I did not write this change)
- **Baseline:** branch `claude/supplier-uat-phase-001` at `ab000108`, reviewed as `git diff origin/main..HEAD` (base `58322ba3`)
- **Verdict:** **CHANGES_REQUESTED**
- **Open Critical / High:** 0 / 0. Four Medium, six Low, four Info.

## What the reviewer confirmed

- **Run with only the profile's env_keys** (plus PATH, HOME, TMPDIR, as `harness_runner` passes): 18 passed, 2 failed at their defect steps (UAT-031 DEF-038, UAT-048 DEF-037), 5 skipped. The scratch database was dropped.
- **Technical suite:** 50 passed; eslint exit 0.
- **Harness inspect:** only COMMIT_CHANGED; design 29a0615a and plan bfb0af4f match.
- **Ledger:**
  - The 8 `-HD124` approvals differ from their originals only in id, recorded_at, baseline and source_ref; the original text is quoted word for word.
  - 12 defects were re-pointed to `APPROVAL-HD-116-RISK-HD124`.
  - No existing record was changed.
  - Only the three intended profile fields changed.
- **Mutations:** 16 of 18 turned the targeted case red. Each mutated file was restored and checked with `cmp`.
- **SQL preconditions** (S-BLOCK, S-ARCH, inactive catalogue values) and approving devices in the database are acceptable environment setup, because no Expected Result depends on them.
- **Login throttle measured:** a device-pending 403 does not count against the limit; one run uses about 7 counted logins.

## Disposition

The standing instruction is to fix every review finding as recommended.

| Finding | Disposition |
| --- | --- |
| M-1: UAT-020 passed when the Supplier was only archived (M08 survived). | After the delete, the detail URL must show 「找不到這個供應商」 with 返回供應商列表, and a list search with 包括已封存 ticked must show 冇資料. M08 now fails at that step. |
| M-2: UAT-003 accepted a product with no reason step; AC-003 asks for one and lists Audit as evidence. | Recorded as DEF-039 (LOW), with decision HD-132 for the Product Owner. The test now fails at an Audit step that expects the overridden candidate to be recorded. Every earlier step passes. |
| M-3: a setup failure left the scratch database and the password file behind (globalTeardown does not run when the webServer fails). | `uatServer` drops the database and removes the fixture when create, migrate or seed fails, and whenever the server exits, including when it cannot start. Verified by holding port 3021: startup failed, no `erp_t51_rh_uat*` database and no fixture was left. |
| M-4: missing DB_ADMIN_USER was reported as FAIL. | `playwright.uat.config.js` checks DB_NAME and DB_ADMIN_USER when it loads and throws, so no report is written. Verified with the scratch runner without DB_ADMIN_USER: **BLOCKED** (exit 1, report missing), no secret in the logs. The scratch runner had diverged from `run_suite` on this path: it kept FAIL when the report was unreadable, while `run_suite` (line 175) always sets BLOCKED. It now matches. |
| L-1: the password file was 0644. | The run directory is created 0700 and the fixture is written 0600 on its first write. Seen during a run: `drwx------` and `-rw-------`. |
| L-2: traces keep a plaintext password inside the evidence directory. | Playwright artifacts and the role browser profiles go to `os.tmpdir()/supplier-management-uat-artifacts/<run>`, outside `HARNESS_RUN_DIR`. |
| L-3: UAT-018 inserted an unreachable Blocked row. | It now creates a Draft, activates it through the API and then sets Blocked, as UAT-017 does. |
| L-4: no test proved re-authentication (M13 survived). | UAT-006 first submits a wrong password and expects 「請確認你目前的密碼」 with the Code unchanged. M13 now fails there. |
| L-5: UAT-054 and the UAT-031 Settings page did not watch console or network; the no-permission state was checked by URL only. | Both watch problems now (the 503 in UAT-054 is allowed). The no-permission state is checked by its wording 「你冇權限查看呢一頁。」. |
| L-6: two concurrent runs shared one fixture path. | Each run has an ID (`SUPPLIER_UAT_RUN`), set when the config loads and inherited by the webServer and the workers. The fixture, artifacts and profiles are per run. |
| Info: CI does not run the UAT suite; the app server uses the admin account; re-measure the login budget when PHASE-002 to 004 add roles. | Noted. The login budget no longer grows with failures: each role keeps a persistent browser profile, so a worker restart does not log in again. An earlier run after these fixes hit the throttle on worker restarts, which led to this change. |

## Verification after the fixes

- **Full UAT run (local):** 17 passed, 3 failed at their defect steps, 5 skipped (`test.fixme`, downstream). The defect failures are UAT-003 (DEF-039), UAT-031 (DEF-038) and UAT-048 (DEF-037). No scratch database was left.
- **Mutants M08 and M13:** both red at the intended lines; files restored and checked with `cmp`.
- **Lint:** eslint exit 0.
