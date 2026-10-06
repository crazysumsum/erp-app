# CI workspace fixture correction

PR #174 initial head `8226ea230e8dcaac998fc79abe93bbf3a75d541d`, CI run `36692309650`: lint, dependency audit and client build passed; MySQL/coverage and browser checks failed. No merge/readiness claim.

## Sales developer fixture failures

CI runs the server package from its workspace directory. New disk-test fixtures incorrectly resolved `server/storage` from the current directory; the measurement child also resolved imports from that directory. Global configuration assertions omitted the new Sales section. These caused 16 failures, reproduced before correction from server cwd in `/private/tmp/sales-ci-cwd-red.log`.

The correction uses `fileURLToPath(new URL(..., import.meta.url))` for managed storage and the measurement child repository cwd, and updates the existing configuration section/default/error assertions. Production source, managed-directory security and thresholds are unchanged. `configuration.test.js` is a corresponding test within Sam's approved startup integration; the manifest now lists that exact shared test path. No other module implementation is amended.

After correction: 239 combined focused tests passed from server cwd, zero failures/skips; the original repository-root invocation of the affected files passed 79 tests, zero failures/skips. Lint and whitespace checks passed. Logs remain private under `/private/tmp/sales-ci-cwd-*.log` and `/private/tmp/sales-ci-root-green.log`.

Current DESIGN `35affda2c8cc0837de1fe3016a1ced6982437a74d87198c3571aa32b115d2c3b`, PLAN `345848c49c2cdbdcc6970c014f83b96ce512908b2e2f2bffdd82a4e850811c01`. The only scope delta is the corresponding configuration test. Historical approvals and failed candidate observations remain intact; neither current full acceptance nor a broad reapproval is inferred.

## Separate browser failure

Network-mocked Supplier approval test `supplier-approvals.spec.js:274` immediately reads an asynchronous lookup from `state.calls`, producing TypeError. The client, browser spec and workflow are identical to latest integrated main. The original test passed three bounded actual-browser diagnostic runs under the installed Playwright skill with a private report directory and `reuseExistingServer=false`; this supports a test race but does not replace the CI failure. No unrelated Supplier/UI patch or blind CI retry was made. New commits receive their own mandatory CI.

The local upload-only coverage diagnostic met the existing individual floors: middleware lines 568/601 and branches 127/142; concurrency gate 76/76 lines, 22/22 branches and 4/4 functions; dispatcher 486/532 lines and 92/115 branches. This partial diagnostic is not full-workspace coverage PASS.

Independent reviewer Codex `/root/sales_readiness_review`, SEPARATE_AGENT/read-only, APPROVED this scoped correction against `8226ea2`, with current DESIGN/PLAN above. Reviewer independently reran all four affected files from server cwd: 79 passed, zero failures/skips; whitespace passed. No actionable code findings. This grants no broader CI, Supplier behavior, numeric memory acceptance or Phase completion.
