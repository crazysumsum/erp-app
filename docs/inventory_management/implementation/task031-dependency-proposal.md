# HD125 — exact dependency candidate review

Current disposition (HD126): actual Sam reply 「批准」 approved exact TASK031 source `894fb4eea4259c375705fdaea945a2a2fadc64736a9bbc335f47e35b5789e42e` / review patch `0b8d0c0d7c205c79eaee47520820651508dc5496148c5fc4636d709ab31dd694` and local developer DoD; HUMAN REV094 / APR169. TASK031 is DONE locally. Nineteen existing native developer PASS reports and17 named scenarios were revalidated without rerunning or relabelling tests;205 historical/current evidence refs retained. DEF009/010/011 remain CLOSED. TASK032+ is PENDING; this approval does not authorize future source, publication/main integration, formal acceptance or capacity waiver. Earlier pending-review statements below are preserved historical context.

Current disposition: HD125 actual Sam approval/APR168 HUMAN REV093 adopted exact lock;19 fresh native developer contracts and17 named scenarios PASS on source894fb4ee. DEF011 technical remediation verified; TASK031 still IN_PROGRESS/BLOCKED pending independent Sam HD126 exact source review. [Current review handoff](task031-implementation-review.md). Prior content below is historical; no old result/approval is rebound. No publication/TASK032+/formal/capacity acceptance.

Status: PROPOSED_NOT_APPLIED. HD124 A / APR167 authorizes preparation only. Actual independent Sam review and root-lock adoption approval remain pending. DEF011 CRITICAL OPEN; TASK031 IN_PROGRESS / BLOCKED.

## Exact candidate and baseline

Review [the patch](task031-dependency-proposal.patch), [machine-readable proposal](task031-dependency-proposal.json) and [native preparation diagnostic](../evidence/task031-hd124-lock-candidate-96b222e09b/diagnostic.json).

Only `package-lock.json`, entry `node_modules/shell-quote`, changes: 1.10.0 → 1.11.0, matching tarball/integrity, plus npm-generated MIT license metadata (5 additions / 4 deletions). No package entries are added or removed. `concurrently@8.2.2` and its `^1.8.1` constraint stay unchanged; no direct dependency, overrides, manifests, npm policy, application source or canonical specs change.

| Binding | SHA / value |
| --- | --- |
| Current HEAD | `869ac07abdd3879254c351d857be911d71e68b6b` |
| Current observed source | `7bc0fbfed8fb1f626b4c008f28310c2b1b8233622668b933d8f90b69780853df` |
| Unchanged DESIGN | `ccd54a79438c2bb7e1cfcc58c9b8878b47120f0a3f91110a13d7d28202e05853` |
| Unchanged PLAN | `4c074a4e344599e912aab7e351e93abfc5f447085657f59625f7c7a95c69440a` |
| Active root lock before | `e89f67821cd1867a094ecce6c89f39d74b2b10f360ebc42160b2e4156fc0a532` |
| Candidate root lock after | `0e7cfc03260694b17565e28374ff85ed894b79082286025395779c6f436ecb49` |
| Patch SHA256 | `0d35dc9ac7249bdb8e201e6fa5c975e800497679cf83836b7527544904d74af5` |

The existing module manifest already lists `package-lock.json` under `approval_required_paths`. Proposed authorization is a new precise HUMAN SCOPE approval for this one-file before/after patch on the unchanged PLAN and current HEAD/source, not a wider allowlist or DESIGN/PLAN rewrite. Existing HD123 shared-path approvals are not silently rebound or extended to dependencies. After adoption, observe the new source fingerprint and bind every fresh run to it; no future observed hash or PASS is asserted here.

## Preparation and security review

Native npm11.18.0 / Node26.6.0 resolved the candidate in an owned temporary copy, with `--package-lock-only --ignore-scripts --no-audit --no-fund`. Registry latest was 1.12.0, so native `--before=2026-09-29T02:34:24.392000Z` limited resolution to the selected 1.11.0 release; exact version, package-set equality and the sole changed entry were asserted. The initial latest-version preflight stopped before update and remains preserved in [its diagnostic](../evidence/task031-hd124-lock-candidate-9a5d4dddae/diagnostic.json). This is not an audit run or developer-gate evidence.

Official registry metadata matches candidate tarball/integrity, MIT license and Node engine range; it declares no runtime dependencies or preinstall/install/postinstall. Other declared development/publishing scripts were inspected, not executed. Registry signature metadata is present but cryptographic signature/provenance verification has NOT been performed. No node_modules was created; both exact temporary copy/cache roots were removed, while public review artifacts remain. Active lock, installed1.10.0, manifests, `.npmrc`, source and canonical hashes are unchanged. Check-only `git apply --check` passed.

[GitHub-reviewed advisory](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) identifies patched1.11.0. This does not establish exploitability or compromise in this application. [Upstream1.11.0 changelog](https://github.com/ljharb/shell-quote/blob/v1.11.0/CHANGELOG.md) also includes quote/parse behavior changes, not only the security correction. The inspected concurrently caller quotes string arguments; parser changes are not exercised by that caller. A shared developer dependency can still affect all workspaces, so fresh regression is necessary. Resolver semantics: [npm update](https://docs.npmjs.com/cli/v11/commands/npm-update/) and [lock-only install option](https://docs.npmjs.com/cli/v11/commands/npm-install/#package-lock-only).

SELF_REVIEW only: correctness (one-entry resolution/range/integrity); security (no scripts, no audit weakening, scope held); maintainability (native minimal lock diff); performance (no new graph/runtime dependency); testing (structural checks only, fresh execution pending). No independent reviewer, unseen implementation acceptance or test PASS has been fabricated.

## Adoption and verification authorization requested

After actual Sam review, approve only the exact patch above, owned local dependency refresh and unchanged fresh checks:

1. Recheck exact baseline, active before-lock and patch hashes, then apply only this root-lock patch. Stop for drift or additional lock/package/config/source churn. No blanket `npm audit fix`, concurrently upgrade or latest1.12.0 adoption.
2. Refresh dependencies with the existing frozen root lock and pinned npm11.18.0, scripts disabled, only after confirming this worktree's dependency directories are owned and not symlinks/shared. Preserve project `strict-allow-scripts=true` and fsevents deny policy. Do not clean shared/global/other-worktree resources. If existing checks require an unapproved install script or wider mutation, report the blocker instead of bypassing policy.
3. Observe actual lock/installed1.11.0/integrity/dependency chain and new source. Run unchanged `npm run security:audit` (`npm audit --audit-level=high`), with no omission, exclusion, severity reduction or waiver. DEF011 closes only with actual successful targeted retest and impact regression; registry metadata alone cannot close it.
4. Rerun existing root, Inventory, client and P3/supporting unit contracts, Transfer components, lint/build, existing coverage thresholds and all34 file floors. Repeat existing seven migration checks, Movement30, Transfer31, API25, real Transfer Playwright8 and P2/supporting functional guards using owned synthetic local resources under standing authorization. Preserve mandatory zero-skip contracts and the existing current PLAN. Exercise benign concurrently developer argument/startup behavior; do not execute an injection payload. Record each real result on the new source, without relabelling old evidence.

The186 indexed historical evidence references, original audit FAIL and all prior failures/passes remain intact. Prior checks on source7bc0fbfe cannot satisfy the new-source gate. The native full-server diagnostic's107 skips were separately dispositioned:103 guarded cases have separate current-source runs; capacity4 remains NOT_EXECUTED. No capacity/formal TC007/UAT acceptance or skip waiver is requested. Existing developer checkpoint is historical until fresh evidence is available.

## Decision Required

Approve this exact candidate's root-lock SCOPE, local adoption/owned refresh and unchanged regression, or request a specific amendment. Recommendation: approve after reviewing the patch; it is the smallest resolver-native fix within the declared range. Trade-off: shared lock/developer CLI behavior changes require fresh cross-workspace proof. Default until answered: retain the active lock1.10.0 and BLOCKED state.

HD125 approval is not final TASK031 implementation review. After successful remediation/checks, present the actual new source for Sam's independent Task acceptance. No additional product/UI/DDL/auth/config change, TASK032+, staging/commit/push/PR/remote CI/merge/main integration, formal acceptance or deployment is authorized here.
