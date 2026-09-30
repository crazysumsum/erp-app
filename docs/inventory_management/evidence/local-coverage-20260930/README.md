# Local developer coverage evidence — not CI or formal acceptance

Final code commit: `bbfe0b52892e4ba3d8652527fa38cce77c8da00c`.
Source fingerprint: `0884d1d487171ef8164dd3e06f1a962a93befc60a09e4785fc2a048ead3efebe`.
Approved PLAN during execution: `ed7a585e86f53eead71c3b1f4681b9ab1245ad135dec6f6cacbeb0e8f9e4887a`.
Developer: Codex `/root`; isolated local resources authorized by Sam APR-071. No independent review is claimed.

Command: `npm run test:coverage --workspace server`, wrapped by transient `caffeinate -i`.
Private MySQL: 26.7.0, bound only to 127.0.0.1:33579, task-owned schema `erp_inventory_coverage_20260930_0403`, 66 existing migration entries. Synthetic application/admin accounts and fresh random developer bank key rings were used; no real key or shared/production data was used.

Final exit code: **0**. Tests: 2,392 total, 2,378 passed, 0 failed, 14 explicitly skipped optional guarded suites. Lines 93.64%, functions 91.87%, branches exactly 10,976/13,224 = 83.00060496067755%. Original global 92/83/90 floors and all 34 high-risk per-file floors passed. The branch margin is very thin; candidate CI remains mandatory.

- `server-coverage.log`: complete final stdout/stderr; SHA-256 `8b43cc564cb657b5328b0a78a76f13831410038aa31d0883db22d26a5c0639bc`.
- `server-coverage.lcov.gz`: compressed final raw LCOV; uncompressed SHA-256 `b936218db77f0873106f2654f38b81ed0fc161b9d77ba91681302b391f3064d1`.
- `first-failed.log.gz`: original 13 Auth fixture failures and branch-floor failure, before fixture corrections.
- `permission-regression.log`: four corrected fixture suites, 35/35 actual MySQL cases passed.
- `second-failed.log.gz`: corrected fixtures, zero failures, branches 82.81% below 83%.
- `third-sleep-interrupted.log.gz` / `.lcov.gz`: one timeout failure during observed macOS maintenance sleep; global floors alone passed, suite did not.
- `stalled-upload-recheck.log`: isolated timeout case passed; not a substitute for the subsequent full run.
- `fourth-rounded-below-floor.log.gz` / `.lcov.gz`: zero failures, raw branches below 83% despite display rounding to 83.00%; retained as failure.

The private schema/accounts/server/datadir were exactly cleaned after archiving. These files are supplementary developer diagnostics, not Harness `run.json`, independent approval, formal TC results, UAT or CI attestations. Do not register them as successful formal evidence or relabel the earlier failures.
