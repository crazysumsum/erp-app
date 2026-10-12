# TASK-031 — trusted high-risk submission context / HD113

## Current disposition — actual Sam A; HD113 ANSWERED

Sam actual latest 「A」 on2026-10-07 selects Inventory-local synchronous trusted context, APR152, with existing `jwt-device-password` unchanged. Context is server-owned/non-JSON-forgeable, separate from command/hash, bound to actor/device/action/source/normalized payload and the original signed-request window; waits do not renew it. Pre-claim/replay and post-lock submission checks retain current actor/permission/device checks and safe Audit identifiers, no secret/context export. This selects direction and precise proposal preparation only, not independent approval of an unseen candidate or authorization to modify shared auth. [Next target identification decision HD114](task031-target-decision.md). Source/spec/HEAD/160 native refs unchanged; TASK031 IN_PROGRESS / BLOCKED, no implementation/test/runtime/publication changes.

## Historical discovery — before HD113 answer

Status: DECISION_REQUIRED. HD112 actual Sam A / APR151 selects single operations. TASK031 remains IN_PROGRESS, module BLOCKED / resume IMPLEMENTING; TASK026–030 DONE, TASK032–034 PENDING. No implementation or new TASK031 tests have run.

## Evidence and trust boundary

TASK031/P3-T06 acceptance explicitly requires permission and reauth actor/device/action/time to be revalidated at submission; design §6.2 fixes `jwt-device-password`, `inventory.view` + `inventory.adjust`, no caller `isHighRisk`, and no password in command/hash/Audit. These policies are already approved and are not being asked again.

Existing JwtDevicePasswordAuthStrategy authenticates JWT, then an approved actor-bound device signature and current password. Device signature covers token/method/path/raw body/timestamp/nonce; its existing configured clock window is60 seconds, nonce retention300 seconds. The strategy returns the base auth/claims/deviceBinding, not a separately defined submission proof. apiDispatcher authenticates before schema and HTTP idempotency/handler; queuing/lock waits can occur afterward. Handler arrival time must not silently refresh the original signed-request window.

Inventory command context currently allows only actor/authorization/source/correlationId/payload. Fresh directory lookup revalidates roles/permissions, but does not establish that this invocation passed strong authentication, remains bound to the same action/data/device, or is still timely. A JSON `reauthenticated:true` or copied claims cannot be treated as proof. Direct domain calls and normalized source replay must fail closed without trusted high-risk context; otherwise they can bypass the required boundary.

Inspected actual paths: `server/src/services/auth/jwtDevicePasswordAuthStrategy.js`, `jwtDeviceAuthStrategy.js`, `passwordReauth.js`, `server/src/services/deviceBinding/deviceSignatureRequest.js`, `DeviceBindingService.js`, `server/config/deviceBinding.js`, `server/src/framework/middleware/apiDispatcher.js`, `server/src/modules/inventory/inventoryValidation.js` and existing Posting entry points. No source edits or verified external weakness/exploit are claimed; this is an unimplemented TASK031 contract gap, not a finding that accepted existing routes were changed or broken.

## A — recommended: Inventory-local trusted context

Reuse the existing strong auth strategy unchanged. Only the trusted Inventory HTTP adapter after successful fixed `jwt-device-password` authentication can create an in-process, non-JSON-forgeable context for the exact actor/device/action/source/normalized business payload. Pass it separately from the serializable domain command, not in body or hashed payload; no reusable client bearer token, persistent reauth table, new service/dependency or password propagation. Use a small module-owned mechanism shared by the two actual TASK031 entry points, not a generic authorization engine.

Before Operation claim/domain replay and again after potentially blocking stock locks before mutation, validate matching context and original signed-request time against the existing device-signature window (currently60 seconds); lock/queue waits must not renew it. Re-read actor/permissions and device ownership/approved status using the transaction at the declared checks, honoring existing JWT/device validity and no privilege downgrade. Exact query/locking/revocation and failure behavior must be reviewed in the candidate, not invented by this direction choice. Audit records safe actor/device/action/time identifiers only, never password/token/signature/context.

Benefit: closes the Inventory boundary without altering shared auth return contracts. Limit: process-local synchronous invocation only; it cannot authorize a background worker, another process or a later request. An expired/mismatched/missing context rejects with zero business effects; a legitimate retry needs a new valid device signature/current password while retaining the same source intent and idempotency key. HTTP cached replay still goes through existing strong authentication; no claim of fresh domain execution on a cached response or unapproved cache redesign. Exact cache/revocation semantics remain part of candidate review/tests.

## B — shared strong-auth context contract

Expand the shared auth strategy/framework to issue standardized server-owned submission context, then make Inventory consume it. Same actor/device/action/payload/time/transaction checks remain required; plain body assertions are not an option. Benefit: centralized context issuance for other high-risk consumers. Cost: additional sensitive shared ownership paths and return-interface compatibility/regression scope beyond the current Inventory increment; requires explicit path/baseline approval. No auth-source edit is already authorized by choosing HD112 A.

## Decision and next safe action

Recommend A for the two synchronous TASK031 operations. Default until actual Sam choice: hold affected source/canonical writes; only read/proposal preparation may continue. The answer selects architecture and preparation, not a reviewed exact implementation, new DESIGN/PLAN approval, other Tasks or publication authority. After choice resolve remaining exact public target/Lot/version/reason/response details, prepare a minimal candidate and obtain actual Sam baseline/scope approval before implementation.

Current HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source `fe3130fef55c9ec8cc71b2edf872a8a2076b5332581749ee281b211de38f2bc2`, DESIGN `46841dae185fab06e626fca722d1576726702a3d7183fdbb2f23e3459de7f663`, PLAN `8ab85d87051f437b74c6cfb4efc39ba93c8c2dd9e56ca7ea210d7bc5bc705dc8` and160 historical native refs unchanged. Original0064, profile argv/parsers/minimums/zero-skip/34 floors, requirements/UAT/ledger/matrix remain unchanged; old developer PASS is not TASK031 proof. No new DDL/permissions/dependency/global auth/config, runtime/DB effects, UI/TASK033, stage/commit/push/PR/remoteCI/merge/main adoption, formal acceptance/release/capacity waiver.

Security/API skills made the trust boundary explicit; Harness major-impact gate causes this pause. Actual independent final design/implementation reviewer remains Sam; no agent self-review is relabelled HUMAN.
