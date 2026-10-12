# HD124 — root dependency remediation direction required

Disposition: HD124 ANSWERED — actual Sam A / APR167 approved preparation only. The [exact HD125 candidate](task031-dependency-proposal.md) is now ready for independent Sam review; no active dependency adoption, risk acceptance or gate waiver is authorized. DEF011 CRITICAL OPEN; TASK031 IN_PROGRESS / BLOCKED. The original decision context below is preserved.

## Context and actual evidence

[Current original dependency audit](../evidence/task031-supporting-nondb-8f20ea3c1a/inventory-p3-dependency-audit/run.json) ran the exact existing `npm run security:audit` contract (`npm audit --audit-level=high`) on HEAD869ac07 / source7bc0fbfe / PLAN4c074a4e and exited1. It reports CRITICAL GHSA-pqg4-j6r4-53mv affecting installed/root-locked `shell-quote@1.10.0`. This is a real audit failure, not a network failure. Original audit command, levels, failure and historical passes remain unchanged.

Read-only `npm explain shell-quote` and lock/source inspection show root devDependency `concurrently@8.2.2` requires `shell-quote ^1.8.1`. `package.json` and `package-lock.json` were not changed. Installed concurrently's ExpandArguments calls quote with additional string arguments; an exploitable product path has not been established and no exploit was executed. Do not infer confirmed production compromise or exemption from the existing audit gate.

[Maintainer advisory / GitHub Reviewed](https://github.com/advisories/GHSA-pqg4-j6r4-53mv), verified 2026-10-07: affected versions >=1.8.4,<1.11.0, patched1.11.0. Exploitation requires an attacker-controlled line-terminator string after a comment-object token in the same quote call. The advisory was published September29 and GitHub-reviewed/updated October6; this explains why an earlier audit pass does not prove current readiness.

## DEF011 triage

- Source observation: original inventory-p3-dependency-audit FAIL; related TASK031 / PHASE004. Related security context SEC009 and DES006; the blocking criterion is the existing project audit contract, not a newly invented Inventory requirement.
- Expected: unchanged audit contract exits0, no high/critical vulnerabilities.
- Actual: exit1, CRITICAL command-injection advisory in a root-locked development dependency; installed/locked version1.10.0.
- Primary classification: EXTERNAL_DEPENDENCY_ISSUE. Root-cause status: dependency/version chain confirmed, product exploitability unconfirmed.
- Route: human scope direction → exact minimal root-lock/spec-scope candidate and independent review → only approved dependency adoption → fresh audit and impact regression. Do not run blanket npm audit fix.
- Retest: actual installed/lock/version/chain observations, original audit with no exclusion or weakened level, existing root/Inventory/client/coverage-floors/lint/build and real DB/API/browser impacted contracts on the new exact source/PLAN. Candidate review must bound any additional lock churn; stop if more packages, manifest overrides, source/config/DDL or broader scope are needed.
- Current status: OPEN; no closure evidence or risk acceptance. Earlier functional evidence stays on source7bc0fbfe, never relabelled after a dependency/source change.

## Decision Required

A (recommended): authorize preparation of an exact minimal candidate to update only the root-lock shell-quote resolution from1.10.0 to patched1.11.0, which fits concurrently's declared ^1.8.1 range. Include the necessary Harness root-lock scope/baseline proposal and regression plan. This authorizes candidate preparation, not active root-lock installation/adoption, unseen implementation acceptance or publication; Sam reviews the exact candidate before application. No new direct dependency or concurrently upgrade is proposed. If resolution requires additional package changes, report their exact impact rather than silently including them.

B: leave the root dependency for a separate repository-level remediation. TASK031 remains blocked until a valid current dependency result and required source review are available; do not replace audit FAIL with an old PASS or waive the gate.

Trade-off: A can remove the current blocker with the smallest likely dependency delta but touches a shared all-workspace lockfile and invalidates source-bound checks, so explicit scope/review and fresh verification are necessary. B preserves today's narrow feature scope but cannot finish or publish TASK031 now.

Default without further direction: hold dependency writes, TASK completion, later tasks and publication. Preserve implemented source, original failures and current passing functional evidence. HD123's actual Sam approval explicitly excluded dependencies, so it cannot answer HD124 by inference.
