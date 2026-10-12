# TASK-029 recovery — HD-098 answered A

## Current checkpoint — HD098 approved; index repaired; Transfer prerequisite failed

Sam A records exact current DESIGN/PLAN and unchanged0064 scope (APR120–122/HUMAN REV076). All213 original indexed artifacts are preserved/byte-verified;128 non-run references moved to private history,87 native run refs now active. DEF007 is CLOSED after native validation/unchanged-gate and4 metadata impact probes, not a gate waiver.

On unchanged local869ac07/source68b0e8c0/PLAN11b81565, real MySQL26.7.0 Task026 migration7PASS but Transfer31FAIL, zero skipped/not-run. All31 failure traces include missing synthetic `su.id`; production Item migrations already contain the five UOM fields required by merged lookup. DEF008 OPEN; [HD099 bounded fixture repair decision](task029-transfer-fixture-proposal.md) is required because HD098 explicitly excludes test repairs. No executable source/test/migration patch has been applied.

Both exact owned MySQL schemas/instances/roots/leases were cleaned (synthetic data unrecoverable, evidence retained). Full-server diagnostic and TASK029 resume NOT_EXECUTED; BLOCKED retained. Current PLAN_READY has5 unresolved defects plusHD099, no evidence-index/stale-spec/review issue. Prior evidence/decisions and unrelated work preserved; no publication/CI/mainmerge/formal acceptance/UAT/deployment or P3 completion.

## Historical proposal — HD-098 before Sam approval

### Original outcome and verified baseline

Inventory locally integrated exact repaired main `4f09b491d8c7d5393c7e36beb707bc7bb4ad039e` without conflicts. Savepoint `869ac07abdd3879254c351d857be911d71e68b6b` has parents `169659ba229e0ad49920e9f8916eb3c9a2ba03bb` and that main. Source fingerprint: `68b0e8c09321966e48640c81b6e0503378146a2e58b2a0e1119dfe3d00cb643e`. No push, PR, remote CI rerun, main merge or TASK-029 implementation occurred.

Observed DESIGN `c8dc42b3fea72c2f6ab8a2bead404a25e65bb2ca9addcf15814d570b9a4c1cb1`; PLAN `11b815650cfb7851c5c096fe14fb7a2cff84ef3d28cd6d8afb1ae99d3ef8ad9a`. These are **observations, not approvals**. All original decisions and review identities remain unchanged; Sam's local integration instruction APR-119 does not approve the changed specifications or a future implementation head.

[Native checks and scope](../evidence/inventory-main-adoption-20261006T034429-dc204f76/README.md) record root strict-JUnit 2,120 PASS, client 691 PASS, TASK-026/027/028 15/32/13 PASS and Inventory regression 159 PASS, all zero failure/skip/not-run. Owned enforced install, audit zero vulnerabilities, all 34 original per-file floors, lint and client build passed. Node v26.6.0/npm11.18.0. This is not full-server/DB/browser/Phase verification or formal acceptance.

[Main CI observation](../evidence/inventory-main-adoption-20261006T034429-dc204f76/observed-main-ci.json) confirms five SUCCESS jobs in [run 37409150356](https://github.com/crazysumsum/erp-app/actions/runs/37409150356) on main4f09. It is not CI evidence for the new Inventory head.

## Why a new decision is needed

The [incoming contract diff](../evidence/inventory-main-adoption-20261006T034429-dc204f76/incoming-inventory-contract.patch) adds Manual Sales batch §5.7.1 and updates contract pins. The batch adapter checks fresh fixed `sales.mgmt`, processes owned order demands/mappings atomically, conserves partial/zero reservation results and verifies persisted replay membership. Existing single-line `sales.operation`, Fulfillment `fulfillment.operation` and Inventory HTTP `inventory.view` + `inventory.operation` remain distinct; adopting the batch contract does not grant those roles Inventory management access. New Sales MySQL regression/performance execution remains CI-only as its canonical design states. Old DESIGN/PLAN approval hashes cannot be rewritten to authorize this addition.

TASK-026–028 product/test files, Transfer migration, requirements, task-plan Markdown, profile, traceability, technical and UAT specifications are byte-identical to preintegration169. `0064_create_inventory_transfers.js` SHA-256 is `07653bb700a40b026e8bb46b538e0e31b112d6c20010af45b4cc71a6ff7ac143`. Current migration prefixes are unique; 0065/0066 remain absent/reserved, main's Sales additions use0067–0069. Current-plan scoped authority for0064 still needs reconfirmation; no number/DDL edits are proposed.

[PLAN_READY diagnostic](../evidence/inventory-main-adoption-20261006T034429-dc204f76/plan-ready-diagnostic.json) is BLOCKED: HD098 open, old design/plan/review stale, DEF003–006 unresolved, and 128 `EVIDENCE_INVALID` records. These records are raw logs/XML/LCOV/archives/ad-hoc diagnostics mistakenly put in a list whose entries are required to be schema-valid Harness run documents. 85 existing entries are valid run documents. The strict test parser did not fail in this run; the evidence index is the separate problem (DEF-007). Structural traceability passes only its graph check.

Index provenance is explicit:102 invalid references existed at revision430; this turn's adoption helper incorrectly appended26 more raw references. This is an agent-maintained metadata error, not a product-test failure. All128 need the documented preservation-first correction; none has been removed or relabelled. See [index-provenance](../evidence/inventory-main-adoption-20261006T034429-dc204f76/index-provenance.json).

## Options and trade-offs

**A — Approve the bounded recovery package (recommended).** After reviewing the incoming contract and current specifications, approve the exact DESIGN/PLAN above and reconfirm unchanged0064 scope on that PLAN. Authorize preservation-first evidence-index reconciliation and current-source developer DB revalidation below. This removes stale approval/index blockers with actual proof; it does not promise TASK-029 recovery if a mandatory gate still fails.

Evidence-index reconciliation must first retain the complete old state, full original index, every original path/hash, and all raw files in a private immutable history/recovery record. Keep valid native run entries in the active execution index; move only non-run references to the preserved artifact-history index. Use a reviewed, expected-revision one-time migration with a real state lock and byte/hash preservation assertions: ordinary `state_tool` intentionally rejects index deletion, so no blind direct JSON overwrite is allowed. Preserve every approval/review/decision/action/defect and failure/skip result, original mode-entry and spec identity. No skill/parser/gate/schema/threshold/assertion change, removal of evidence files, or invented result is authorized. Current diagnostic reports may be adapted into native run metadata only from retained actual command/timing/source/probe/artifact facts; missing facts stay explicit, not fabricated. Recheck the unchanged validators; failure keeps BLOCKED.

DB revalidation uses the **existing** `inventory-task026-database` and `inventory-p3-transfer-database` contracts on separate fresh owned socket-only MySQL26.7.0 synthetic schemas. Actual source defines7 migration and31 Transfer cases; profile floors remain6/12 with zero skipped cases. The tests invoke existing0055–0060/0063/0064 only and preserve their guards/namespaces; no test/DDL repair is authorized by this package.

Separately, use an owned fresh migrated schema for the existing complete-server native coverage diagnostic. Derive its ledger from the observed files:3 framework entries +67 actual migration files =70 expected entries, including byte-unchanged0064 and already-merged0067–0069. Keep original92% lines/83% branches/90% functions and34 per-file floors. This authorizes existing migration execution on synthetic private resources, not new Sales guarded SQL/performance tests or other capacity flags. Standing APR-071 already permits local resources and precise owned cleanup; this question concerns changed baseline/shared migration scope, not repeated permission to use the machine.

Every guarded skip stays NOT_EXECUTED and must be classified. Missing mandatory same-source/PLAN non-skip evidence remains a full-P3 completion/merge blocker; no gate waiver or automatic high/critical risk deferral. A defect may close only when its actual targeted retest and impact regression support closure under unchanged gates. If that cannot be established, report the remaining failure/disposition instead of labelling it PASS. Only when current design/plan/review/boundary and TASK-029 prerequisite gates really pass may local TASK-029 API/UI work resume, including its required real MySQL/API/Playwright validation. This is not approval of a future implementation head, later Task, publication/main merge, formal acceptance/UAT or deployment.

**B — Hold/request changes.** Retain integrated savepoint and all evidence without index migration, DB execution or TASK-029 recovery. This avoids adopting the changed contract until its scope is acceptable, but leaves recovery blocked.

Recommendation: A because it preserves the approved Transfer behavior and all evidence while checking compatibility on the actual integrated source. **Default: hold/B until Sam's actual answer.** Stop for material source/spec change, migration collision or required check failure; do not repair unrelated product/test code under this permission.

## Preservation and remaining work

Private `preintegration-private-recovery.tar.gz` retains the original dirty state/reports and323 untracked evidence/proposal files with SHA-256 records. All prior nonstate file bytes were verified unchanged immediately after integration, before new report annotations. Existing work and stashes were not reset or popped. Shared node_modules target was not modified; Inventory now owns its isolated dependencies. Only this run's temporary cache/log/key/symlink-backup directory and scoped caffeinate were removed. No DB, API server, browser or web port was allocated in this turn.

TASK-029 remains IN_PROGRESS/paused, overall BLOCKED with resume IMPLEMENTING. DEF003/004/005 remain IN_PROGRESS, DEF006/007 OPEN. Full P3, its guarded/capacity evidence, current Inventory CI/review/merge, later Tasks and formal acceptance remain outstanding.
