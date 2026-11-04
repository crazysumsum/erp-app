# TASK-032 reference readiness: local candidate and C1/C2 handoff

2026-11-04, Customer owner. Base: freshly fetched authoritative main `ae54601f8dbd79055956c15c508d439dea98d864`. Branch `codex/customer-task032-readiness`, worktree `/private/tmp/erp-customer-task032-readiness`. Shared main has unrelated dirty work and was preserved; this candidate starts directly from fetched origin/main. No commit, push, CI or merge yet.

## Product difference

1. New `server/src/services/customer/CustomerReferenceService.js` exposes the actual CustomerReferenceProviderRegistry as eager singleton `customer.references`, using the existing service discovery/container. Trusted serviceOptions supply the registry's existing requiredProviders/providers/timeoutMs options; request input does not configure it. Default empty requirements remain NOT_READY/UNKNOWN, not a synthetic READY provider list.
2. `server/src/handlers/customers/customerHandlers.js` passes that same registered instance to CustomerService.references. The actual archive/delete HTTP paths therefore use the registry observed at startup. CustomerService's direct-constructor fallback is preserved for existing direct callers; startup evidence covers the wired application handlers, not every arbitrary direct instance.
3. Existing `application.started` structured log in `server/src/framework/application/createApplication.js` includes customerReferences from that instance's inspectReadiness. The output is the existing allowlist: status, registry contract and providers{id, required contract, status}. Provider exception messages, SQL, secrets, PII and internal objects are not included. No new endpoint, public DB health change or general health platform.

Custom service-discovery scopes that omit the Customer module omit this log field; omission is not READY or proof of Customer readiness. Normal discovery registers the singleton. This is an at-start observation, not a periodic liveness guarantee or whole-module readiness report. Missing/wrong-contract providers cause NOT_READY/UNKNOWN through existing registry checks; they do not deliberately stop core application reads. Actual runtime behavior remains unexecuted on this candidate.

There is no implemented production Customer-reference provider assembler elsewhere in fetched main. Defaults are still unconfigured and destructive writes remain closed. Actual provider descriptors/contracts and adapters require owner delivery/review; this patch does not invent them, mark missing modules ready, or enable deletion. It exposes this existing limitation through the real startup path rather than through a separate reporting registry. Bank/scanner/storage readiness is not inferred from config or reported as PASS.

## Source fingerprints

| File | SHA256 |
| --- | --- |
| CustomerReferenceService.js | 027818835414962794865b051845ad669c71ce90cdf17254a1a81991e95619be |
| customerHandlers.js | 6a99c3338f054e218f110dbeb1e7d4725dfcf874b4ce2162aeb1ef3eb8e86f0c |
| createApplication.js | d0b21bb1ae5af1cb0d92e24401896e72ad822861928006e7a673e8390310d389 |

## Checks and limitations

- `node --check` on the three product files: exit0. `git diff --check`: exit0. No application/runtime or functional case started.
- Scoped ESLint did not start: existing shared node_modules lacks `eslint/bin/eslint.js` (MODULE_NOT_FOUND under Node26.6.0). This is an unavailable-tool observation, not a lint PASS. No package install, lockfile edit or automatic test retry followed.
- Subsequent tooling recovery located an already-installed ESLint in the preserved Fulfillment P2 dependency directory. The scoped three-file lint then exited0 without product changes or dependency installation. The original missing-tool outcome is retained above; this was a static tool invocation, not a functional-case retry.
- The ignored worktree-local node_modules symlink now points to `/Users/sam/Documents/workspace/erp-app/.worktrees/fulfillment-p2/node_modules`; only this worktree's link was changed, not the dependency directory or any other worktree. No new runtime, database, port or synthetic keys allocated.
- No test/fixture/discovery/admission/CI wiring changes. No 40-case replay, formal TC/UAT declaration or NFR execution.
- New service path and the narrow existing application startup log change are submitted to Tech Lead under the delegated TASK032 technical decision; canonical manifest/profile/baselines must be reconciled before publication, not silently treated as already approved updated hashes. Independent review and required current-head gates remain pending.

## C1/C2 recipe version 1 — proposed, not executed

Authority: Tech Lead selected the following scope; explicit execution disposition and PM-assigned isolation slot remain pending. Old F1/Inventory/40-case evidence does not authorize this new batch. This recipe applies only to the product fingerprints above; executable private recipe source has not yet been prepared/frozen and must be reviewed before execution.

One owned synthetic MySQL instance/schema and one actual app, serial C1 then C2, each once. Never shared3306. Two synthetic Customers total: A otherwise eligible for archive; B never activated and otherwise eligible for Draft deletion. Preserve existing minimal child facts (at most one Address and Contact per Customer), no banks, one minimal valid synthetic PDF attachment for A. One normal authorized operator/viewer with real permission checks and required reauthentication/device prerequisites; no bypass. No increased workers, repeated samples or load timing assertions. Native migration/fixture commands and exact PDF bytes will be frozen in the private executable recipe before permission to execute is consumed.

### C1

Use trusted serviceOptions for `customer.references`: one required synthetic id/contract v1, one same-id synthetic provider contract v2, with separate inspectReadiness/checkCustomerReferences counters. This is fault injection into the real registry; it does not represent an available production downstream provider. Observe the actual application.started customerReferences status under this same wrong-contract condition. Require NOT_READY and safe metadata; invoke the same instance's check result for UNKNOWN; require both provider method counters zero.

Through actual application consumers, submit archive(A) once and delete(B) once with valid versions, reasons, permissions, reauthentication and unique idempotency keys. Both must fail specifically with CUSTOMER_REFERENCE_CHECK_UNAVAILABLE, not earlier status/version/auth/file errors. Independently query native SQL before/after for both roots/versions, existing children and relevant audit/operation rows. No successful business effect; existing-contract permitted rejection diagnostics are counted separately. Do not re-run compatible/missing cases or a separate pure registry batch.

### C2

Same already-started app/schema. Keep an existing attachment storage.stage-unavailable fault active for one minimal valid synthetic upload for A; ensure permissions/file validation do not mask the injected outage. Then perform one normal authorized GET of A's basic data while the fault is still active. Require upload safe failure, GET200 with original data and permission-appropriate projection; no attachment contents, banks, paths or exception-detail leakage. No second bank/scanner run. Do not use a database-wide outage or a fake core-read result.

### Cleanup and failure boundary

Stop and report any unexpected case failure; no automatic retry or changed workload. On completion/failure stop only this app and its owned workers, close SQL observers/connections, remove only its owned synthetic schema/instance/data/files/temporary keys, verify owned processes and sockets stopped. Preserve sanitized raw evidence/fingerprints, failures and permitted refusal diagnostics. No keys/credentials/raw PII committed or exported. If PM has not assigned exclusive resources or TL has not confirmed execution, leave runtime unstarted.

Next delivery: TL reviews these concrete three product files and authorizes any new manifest path/startup scope; resolve available lint tooling; freeze the private executable recipe and seek TL execution disposition plus PM slot. If granted, execute C1/C2 once and return actual startup/HTTP/native SQL evidence. Until then TASK032/TC075 remain PARTIAL/OPEN and broader TASK030/031/032 acceptance remains unpassed.

## V2 compatibility correction and frozen private recipe

TL accepted the eager singleton/same-registry direction and requested compatibility review before execution. `createHandlerRegistry` constructs every selected handler eagerly (`handlerRegistry.js`, its `new HandlerClass(services)` call), while `createApplication` independently accepts serviceDiscoveryOptions and handlerRegistryOptions. Thus the v1 unconditional require really could break non-destructive reads/startup in a custom assembly selecting Customer handlers but omitting this service.

V2 imports existing `optionalService` from framework/services/serviceAccess.js and passes `optionalService(services, "customer.references")`. Its supported container get/plain-map lookup returns undefined if absent; CustomerService's existing constructor default then supplies its prior empty NOT_READY/UNKNOWN registry. This preserves old custom assembly/core-read construction and fail-closed destructive defaults. It adds no READY fallback and never reports this private fallback as the formally observed registry. Normal assembly still injects the one eager singleton used by application.started. No production registry logic, permissions, transaction or error handling changed. Compatibility evidence here is source/call-path inspection, not a new executed functional scenario.

V2 handler SHA256: `3dd21e8e735a025d199eaabe6b84ca0b29ba714ba44e8b8a1e64558c30f8aef9`; other two product hashes above unchanged. V1 fingerprint is retained as history, not the current candidate. Syntax and three-file scoped ESLint9.39.5 plus diff check exit0 after this correction.

Frozen preparation outside CI discovery:

- `/private/tmp/customer-task032-recipe-v2/run.mjs`, SHA256 `4d9f3ef06768d32bc405991b9841a659573a70f3edf0ae0b42eda03589620b5e`; syntax checked only, not executed. Pins all three product hashes before allocating resources.
- `/private/tmp/customer-task032-recipe-v2/fixture.pdf`, 431 bytes, SHA256 `f4f187fef575e0437fa83ff7e1de7cad4c25a947534a918bca84c90cbc29b2ac`. Actual xref/trailer/page tree, one200x200 page, no JavaScript/forms/encryption; existing pdfinfo parsed it successfully. This is artifact preparation, not an attachment/API case run.
- Proposed command after explicit approval: `CUSTOMER032_TL_APPROVAL_REF=<actual TL decision reference> CUSTOMER032_PM_SLOT_REF=<actual PM slot reference> node /private/tmp/customer-task032-recipe-v2/run.mjs`. References must be actual external decisions, not author-generated grants. The script does not itself authenticate approval; the coordinator must verify it before executing.
- Script provisions exactly one new mkdtemp `/private/tmp/customer032-*` namespace, owned MySQL datadir/socket, random customer032 schema, no TCP; runs existing production migrations on that schema. No shared3306 access. Uses existing dependencies without installation, synthetic transient JWT/encryption/user/device material, one actual app, two Customers and one Address/Contact each, no bank rows, one valid431-byte PDF.
- Real HTTP C1 archive/delete (valid password and actual approved synthetic device signature for delete), same singleton wrong-contract counters, actual startup observation and independent SQL snapshots. C2 patches only existing storage.stage failure, submits one multipart general attachment and normal same-customer GET while fault active. It does not replace auth strategies/core read/registry, call a real scanner, disable DB or broaden the two cases. Application SQL uses root only inside the entirely owned disposable MySQL instance; this is not SQL least-privilege acceptance.
- Existing production transaction/deadline limits remain. Owned MySQL readiness polling is bounded infrastructure startup, not workload repetitions or a timing assertion. Every unexpected error stops the case sequence with FAIL; no retry or scale change. Finally closes app/observer, drops only random owned schema, stops owned daemon and removes only stopped owned runtime root; sanitized result.json remains private with mode0600. A daemon that fails to stop is retained/reported, not removed underneath it.
- No runtime/DB/schema/user/key was actually created during preparation. PM has reserved the next exclusively owned slot, but execution remains pending TL review of this exact script/product/PDF. No CI/UAT/NFR grant is implied.

## Integrated local checkpoint — 2026-11-04

This section supersedes the earlier pre-execution next actions, while preserving the old candidate/failed-recipe history above. PM and TL explicitly directed a local feature commit, main integration, task checkpoint and publication proposal, without push or CI activation.

### Source integration and review

Fresh fetch observed main `59c6e740a4e8d245b2201fbac7adc9007a8558d8`, PR329 merged head `bf0da09bcc59232362bd3217a9f1ff35cdb5a9d0`. Fast-forwarded the isolated feature branch from ae54601f, retaining this candidate. Incoming delta consists only of the approved Sales/Fulfillment fixture schema-baseline caching and `.github/test-admissions/fulfillment-fixture-eight-shard-composition.json`. No Customer, runtime dependency, production migration, package lock, private recipe or three candidate product bytes changed. Do not relabel old native evidence as a new full-tree run.

Observed existing main CI41762836822 on exact59c6e740 is SUCCESS; this is upstream evidence, not this unpublished feature's CI. Existing test admission policy/receipts and functional-only routing were read; no receipt/variable/workflow/test edits or dispatch performed. Required controller/head CI and actual review of the published integrated candidate remain future gates.

Actual separate source reviewer: Tech Lead & architect chat `01a1a418-5ea4-7ea0-86f1-f678f614682c`. It inspected the original three files, required optionalService compatibility correction, then explicitly accepted product v2 service02781883/handler3dd21e8e/application d0b21bb1 and the exact private execution recipes. The byte-identical three-file product survives integration. Customer owner also inspected eager discovery, handler construction, optionalService fallback and low-sensitive startup projection. No new independent review or formal acceptance is invented. Manifest scope now names only the new service and existing startup file; shared startup path remains approval-required. This is a narrow TL-delegated task scope record, not re-signing historical Sam DESIGN/PLAN hashes or changing provider semantics.

### Source-bound local evidence (no replay)

| Item | Actual baseline/result | Immutable reference |
| --- | --- | --- |
| F1 shipping dependency negative | Owner's original source3f4ce277 / tree d9c9669; controlled native Address-query unavailability, B ROLLED_BACK, Issue0/Sales0, original event still SHIPPING/IN_PROGRESS; not physical outage/Contact/Recovery | Fulfillment local handoff commit1edb06df, implementation91; `tc075-f1-20261104/final-result-review.json` SHA975efc45275c0a2eabbf405d5273469b2b663932107ad965e39bd5f9df17ce81 verified; original owner C0/H0/M0 |
| C1 wrong contract/destructive guard | Three product fingerprints above on ae54601f; handoff01 actual app startup NOT_READY, both provider methods0 calls; eligible archive/delete both409 with required error; roots/children unchanged, success effects0 | Private `task032-runs/customer032-c1c2-20261104-handoff01.result.json` SHA a2dd1a1cbf385747db4bc29cd095003b6acf6973429b72d4fcb7e02f685d8093; whole run FAIL due later C2, only C1 PASS reused |
| Original C2 failure | Same handoff01; actual upload503 then GET200, recipe incorrectly read customerCode rather than actual DTO code; later assertions unproven | Original FAIL retained; four-request metadata SHA7506d750e2db6cf4e160977ba930aa934da510749a381c5bd0f5af7036dd3175; original request-log SHAef8f13484c6365840bc90e0a514ff8e2241c2c8f200ea7127c7ce140b84db058; no body/token export |
| C2-only continuation | Exact c4742691 recipe / same product hashes, new handoff02 grant8cf9b5e6; one Customer/Address/Contact, zero banks, one valid PDF POST then one core GET while stage fault remains; all8 assertion IDs PASS including DTO/version/allowlist/SQL | `task032-runs/customer032-c2only-20261104-handoff02.result.json` SHA0e27c8cedf7eb57e8dc422100fc1f2a7441872975c7c715a0fdd484fb88d1726; journal SHA5635000e1507fc9bc92c7edce93e34405a1380a954e80938753fa2601f5b5d5d; two-request metadata SHA79171d50e441b758d9be790364e466513e44f4d000a9df831d6d296c9bfe2351 |

All private evidence paths above resolve under `/Users/sam/Documents/workspace/erp-app/.worktrees/customer-pm-handoffs/`, except the separately owned Fulfillment evidence under `.worktrees/fulfillment-p2-runtime/`. They are not uploaded with this source patch. Original grants/recipes/once/journals remain durable and consumed; no further execution is authorized by this report. C1/C2 app shutdown returned exitCode0/all closed; owned schemas dropped, daemons exited and roots/sockets absent. PM received actual slot release. F1 remains its owner-bound evidence, not a Customer rerun.

### Undelivered production dependencies

These are logical ownership groups, not invented runtime descriptor IDs or version strings. Current code search finds no production `checkCustomerReferences` implementation outside the Customer registry and its CustomerService consumer, and no required-set assembler. Static CustomerLookup2.2 shipping/Sales lookup is the reverse contract direction and is not a Customer reference checker.

| Required integration to establish | Truth owner / coordinating owner | Missing delivery |
| --- | --- | --- |
| Sales order/quotation and retained history references | Sales Order owner | Authoritative Customer reference/count/watermark contract and real compatible instance; existing Sales order consumer does not provide this registry ABI |
| Fulfillment/Shipment and retained history/open matters | Fulfillment owner | Customer-purpose reference adapter/readiness contract; existing Sales-facing FulfillmentOpenMatterService is not silently adapted as this ABI |
| Invoicing and AR obligations/history | Invoicing/AR owner, Tech Lead for unassigned finance design | Actual implemented module reference/open-matter contract and instance; design alone is not READY |
| Returns / after-sales obligations/history | Returns/Fulfillment owner with Tech Lead coordination | Actual reference provider once the agreed owner is implemented; planned R1 does not supply a provider |
| Payments/refund/reconciliation obligations/history | Payment/refund/finance owner via Tech Lead | Real provider including unsettled obligations and required history; no generic bank resolver or synthetic NO_REFERENCE substitute |
| Mandatory membership, exact versions and installed instances | Customer owner assembles; Tech Lead resolves cross-module technical contracts; PM coordinates deliveries | Approved deployment-specific required set plus real instances through trusted serviceOptions; empty current default stays NOT_READY/UNKNOWN and destructive writes closed |

No provider adapter, default membership or version was fabricated. Missing ownership assignment is a PM/Tech Lead coordination need. Choosing financial counterparty, retention/destruction policy or weakening required-provider coverage has material business impact and belongs to Sam; no such change is proposed. No Sam decision is needed simply to preserve the current fail-closed behavior or arrange ordinary technical review.

### Status and minimal publication proposal

- TASK032: local startup/registry wiring implemented with scoped developer proof; **PARTIAL, production provider integration BLOCKED**. TC075 retains its original traceability and remains PARTIAL/OPEN; only the three named C1/C2/F1 functional evidence gaps are closed at their own baselines. Other TASK030 gaps, TASK031, formal acceptance, UAT and overall downstream readiness stay open. Optional attachment/core isolation does not prove a full optional-capability health report.
- Historical state revision227 is not overwritten with false whole-task DONE or newly signed approval hashes. Current task checkpoint is in TASK032's canonical plan section and readiness document, linked here. The typed task remains blocked appropriately; no new TC/UAT definition, case, workload or waiver is added.
- Publish only the three reviewed product files, exact path-scope metadata, task/readiness checkpoint and this evidence report. No test/fixture/CI/package/migration/deployment/provider-set changes; no private recipe or log contents in the PR.
- PM arranges a normal functional PR window and trusted admission verification of the integrated published tree. Reuse unchanged external receipts; feature author must not register digests, bypass controller or dispatch tests. Existing tests and coverage floors remain. A natural CI run requires explicit PM release under the current task's execution arrangement; no run has been started by this work.
- Require actual current-head mandatory checks and independent final source/integration review before normal merge. Fresh-fetch main again before publication/merge; integrate and inspect any target movement. No admin bypass, copied CI result, new routine cases or rerun of the private cases. After real merge, clean only this task's owned branch/worktree; keep the current unmerged local candidate and durable evidence meanwhile.
- Deployment uses the existing startup path, no schema migration. Empty/unknown registry remains visible and blocks affected writes; core reads remain available as scoped C2 proves. Do not enable production deletion by setting a synthetic provider READY. Roll back through normal compatible application artifact handling, without destroying Customer history.
