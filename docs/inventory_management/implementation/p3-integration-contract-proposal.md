# P3 integration / Inventory owner contract candidate — HD137

Status: **PROPOSED_NOT_APPLIED**. Actual Sam HD136 `A` authorized preparation only. No canonical adoption, product/index write, merge/rebase, test execution, commit/push/PR/CI or P4 work has occurred. The code below exists only as an unapplied review patch, not as the running application.

## Exact inputs and candidate

Preserved worktree/branch: `codex/inventory-p3-operations`, HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source `0cbbea162a3e377df50214fd63b2484b0585d68a2be8dc52ee1615d8b013178c`. Active DESIGN `b1f4b54a95945c84d55e7828620b538830820dd140be2d15ef38b2695fb4abb4` and PLAN `6e27b339efb827ff8a2bb0c8ce82242f86c577f29bb4510b20884e854f456aac` remain unchanged. TASK026–034 remain locally DONE on that original approved baseline; this is not full-P3 merge readiness.

Rechecked/fetched main is `9e9b0ff9ad87846a32036fc86138a834bdb5c82a`,10 branch-only/143 main-only commits. The two commits since HD136's `3b49309` update only Supplier TASK049 Harness state; Inventory/security changes are the same reviewed inputs. Other main content is preserved through this immutable target tree, not rewritten by the candidate.

Review [exact patch](p3-integration-contract-proposal.patch) and [mechanical pins/commands](p3-integration-contract-proposal.json). Patch SHA256 `000687a2fbc2393ca2c78e66854834bd619834f3fe1e572b35fb62b1a7e74914`. Proposed DESIGN `8c24fa028e39dcb578a5312de15293d61cad9b128bdc22c7cb5148986e211781`; proposed PLAN `4892535733987bd298004fff812c3ee0e8d217a51c01ef90dbf871c4d4b7f483`. Fifteen exact postimage pins cover fourteen changed files and the byte-identical generated matrix. These are proposed spec hashes, not an executed new-source fingerprint or merge commit.

## Bounded adoption and conflict resolution

Adopt main's Inventory §5.7.2 reserve-only Backorder sibling as an Inventory-owner contract: fixed `sales.backorderAllocate`, NULL user, empty roles/exact service authority, server-injected fresh registration callback and DB-clock lease owner fencing, including replay. Inventory owns operation/Reservation/Audit writes; Sales owns order/queue/scheduler registration. Inventory reads/locks the lease but does not write it or Sales records. Two distinct worker command types preserve original root/child membership and partial/zero ATP behavior. The manual Sales batch `sales.mgmt` reserve/release entry points and all existing hashes remain unchanged. This neither grants Inventory view/management rights to downstream roles nor enables worker release, new HTTP routes, P3 Sales intake, scheduler activation or deployment.

Six files changed on both sides; two have actual text conflicts. Proposed resolutions:

- Shared idempotency: keep P3's credential-free prepared input and exactly-once guarded replay; move main's optional202 Retry-After into the existing sendReplay helper and pass route options through both callers. No response flag/header/body/success log before the replay guard permits sending. Three proposed regressions cover authorized202, denied202 with zero output, and200/undeclared202 compatibility. Both sides' original native test names remain present.
- Lockfile: use main's exact shell-quote1.12.0 bytes, not P3's1.11.0 or a regenerated dependency tree. Fresh audit/install compatibility is still required before publication.
- Dispatcher/tests/design: preserve the conflict-free three-way combination of authentication/policy, optional preflight before uploads, strict schema/coercion, P3 preparation and both native test sets. Text auto-merge is not behavioral proof.
- Item consumed-source pin: main adds only searchForSale; import its exact source and rebind the hash. Existing Inventory lookup methods remain unchanged and require fresh native Item/Sales compatibility. No authored Item implementation is proposed.

Existing P3 API resolver/request-validator source/tests and0064 migration are pinned for no-write scope rebinding on the new PLAN. All scope allowlists, prohibitions, original required checks, formal case/task relationships and review policy remain unchanged. No new Inventory DDL or permission seeds.

## Verification and publication contract

Original20 phase suites remain mandatory; add three DEVELOPER-only JUnit contracts: Sales compatibility31 native cases, Customer10k capacity and Core100k SKU/500k Bucket/2M Movement capacity. Zero skip, old minima, all34 file floors and global92/83/90 remain unchanged. Existing two task-local suites, full functional/native coverage and real16/ordinary18 Playwright remain required. Exact argv/tool probes/env/timeouts and native names are in the JSON. Existing tool version patterns are correct after JSON decoding and byte-identical; an initial display-escaping suspicion was disproved before persistence. No tool probe or result was changed.

Consumer/Customer/Core fixtures require new owned loopback-only MySQL26.7.0 TCP resources and exact synthetic schemas; existing P3 socket-only checks remain unchanged. The coordinator must positively verify version, host/port/schema ownership, refuse erp_dev/shared/prod/default fallbacks, serialize writers and clean only its owned resources. Core uses its existing empty erp_inventory_task018 namespace; Customer/Sales use fully migrated owned schemas. No capacity scale, latency/import/memory budget or assertion is reduced. Current exact ledger migration count is observed rather than copied from old reports; any newly necessary fixture/assertion or DDL change needs scoped remediation.

Generate fresh standard evidence/<run-id> reports on the eventual integrated source/new PLAN; retain all348 original refs and report bytes with their original baseline/runtime/argv. No generic Harness or evidence-adapter change is proposed. Evaluate generic MERGE_READY while recorded resources are genuinely reserved/live; cleaned resources are not invented as live. Missing checks or unsupported conventions remain blocked. The four old capacity obligations remain NOT_EXECUTED until both complete native wrappers actually pass. Formal Technical/UAT remain NOT_RUN.

After adoption and implementation/publication authority, preserve the dirty P3 work in an approved local savepoint, integrate freshly checked main, resolve only the reviewed paths, verify exact postimages, run the new-baseline cycle, then commit/push/open the single P3 PR after required self-test PASS and evidence classification. Savepoint is not a verified release candidate. Main's non-overlapping content is preserved; newly material target/conflict changes require renewed review, not an improvised resolution.

Final merge still needs independent Sam review of the exact final head, all five current mandatory CI checks, generic MERGE_READY and current/reconciled main. This proposal is not that final-head approval. Clean merged branch/worktree and owned runtime only after observed merge/dependency checks. P4, formal acceptance and deployment are excluded.

## Actual preparation validation

Candidate canonical schema/traceability and generated matrix: STRUCTURE_PASS, no approval claim. Patch dry-applied only to temporary copies; all15 postimage hashes matched. Original local/main dispatcher and idempotency test names, old command contracts, permission/acceptance/CI/runtime policies and source/spec fingerprints were verified preserved. Temporary preparation checks surfaced the additive Item pin and rejected developer suites being incorrectly placed in the formal regression-only contract field; the final candidate keeps the original formal mapping. No product/native/mutation/browser test, capacity run, live runtime or current CI result was produced. Static self-inspection is not independent Sam review or execution proof.

## Decision Required — HD137

Context: HD136 selected a direction, not owner/security adoption or publication. This exact candidate defines those effects and preserves all gates.

- A (recommended): after reviewing the exact patch/pins, adopt this owner/design/plan candidate and authorize its bounded local savepoint/main integration, exact shared/test/lockfile/Item resolutions and no-write existing-scope rebinding; execute the prescribed synthetic local checks/existing migrations/capacity/browser cycle; commit/push/open the single P3 PR only after required developer PASS and evidence classification. Final exact-head Sam review/merge approval remains separate.
- B: specify amendments; keep the candidate unapplied and original branch/specs/source intact.

Trade-offs: A restores a current compatible baseline and supplies missing capacity proof, but new regressions/capacity may fail and need scoped remediation; no success is promised. B avoids adoption now but leaves P3 integration blocked. Recommendation A if the concrete bounds meet your intent. Default: hold until the actual Sam answer. No waiver, future task, worker activation, formal acceptance or deployment is inferred.
