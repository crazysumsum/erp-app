# Admin permission regression fixture correction

Candidate `7928c99aa6b679d2b36ef4369d9afb4ab105ab02`, CI run36698198511: audit/lint/build/browser PASS; MySQL/coverage FAIL on13 existing role/user/password/migration integration cases. The approved memory gate passed. Server aggregate coverage was93.58% lines/83.63% branches/91.93% functions, but failing tests prevented a complete CI/coverage PASS.

Exact cause: fixtures derived system-admin expected/handcrafted claimed permissions from the expanded catalogue, excluding Inventory/Customer-bank and only sales.operation. New0067 correctly grants no roles, so fixtures incorrectly claimed sales.view/mgmt/import, causing PERMISSION_STALE and a migration held-permission mismatch. Initial commentary misidentified a migration-list issue; the actual cause was corrected before changes.

Surgical correction: four existing integration test files (migrations, passwordChange, roleManagement, userManagement) exclude the full sales.* namespace from system-admin expected/claimed permissions. Migration negative assertion explicitly rejects every Sales grant. Strict equality, protected-role, stale-permission and other security checks remain. Product authorization, seed behavior, memory thresholds and SQL statements are unchanged. Manifest lists these corresponding regression test paths; this follows the already approved TASK-006 no-implicit-inheritance/seed/catalogue integration.

Developer verification: four files passed Node syntax checks; lint and whitespace passed; affected synthetic focused regression passed240tests with zero failures/skips. No local realSQL was run and no skipped integration suite is claimed PASS. The new exact-head CI must execute the13 actual DB cases.

Reviewer: Codex /root/sales_readiness_review, SEPARATE_AGENT/read-only, APPROVED this scoped fixture delta with no actionable findings. Independent ESLint/whitespace passed; reviewer confirms no weakening of security assertions. Reviewed against7928c99, DESIGN `a2a10a5ce6102a0a6c059d1b896e747a3643a2e711be357340204c9ba3067781`, PLAN `98dd16b2de8a9c69364c20affe0d4d8730247deb4e49bdbbcf1d749751089f0d`. No CI success, provider adoption, global baseline approval or Phase merge is inferred.

Private logs: /private/tmp/sales-approved-ci-failure.log, /private/tmp/sales-admin-claims-regression.log and -lint.log. Raw proof/key material is not exported. Initial and prior CI failures remain historical observations.
