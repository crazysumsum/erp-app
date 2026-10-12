# TASK-031 — secure HTTP replay/preparation scope / HD120

## Current disposition — actual Sam A; HD120 ANSWERED

Actual Sam latest 「A」 selects minimal two-new-route opt-in shared HTTP boundary preparation, APR159. Unchanged strong auth/old routes; credential-free business fingerprints plus current replay/submission checks. This grants precise candidate preparation only, not unseen design/plan/source approval. [Exact candidate and independent Sam review HD121](task031-contract-proposal.md) is pending; source/spec/head/160 refs unchanged. No product/test/runtime/publication action.

## Historical discovery — before HD120 answer

Status: DECISION_REQUIRED. HD112–119 actual Sam directions recorded, latest HD119 A / APR158. TASK031 IN_PROGRESS / BLOCKED, resume IMPLEMENTING; TASK026–030 DONE locally, TASK032–034 PENDING. No TASK031 endpoints are implemented; this is a design/readiness gap, not an executed exploit or a claim that old approved routes were changed.

## Actual flow and material gap

Design §5.1/§2.5 requires every POST command to require Idempotency-Key and framework idempotency, in addition to domain source identity. §6.2 fixes jwt-device-password for Adjustment/Status and excludes passwords from domain/hash/log/Audit. HD113 A selected local trusted strong-auth context, current submission permission/device/time checks and unchanged shared auth, but expressly left exact HTTP-cache semantics to candidate review.

apiDispatcher authenticates, authorizes, validates req.input, then invokes IdempotencyService.execute; a successful cached replay sends the stored response without executing handler/domain. Default hasPermission policy uses JWT claims, not current transactional directory state. assertActorFresh exists in domain, but is not a pre-cache policy. Default createApplication constructs this registry; no module-discovered fresh-Inventory policy or existing pre-cache/pre-replay handler hook is wired. Do not assume cached response receives the domain recheck.

IdempotencyService hashes canonical {method,path,input:req.input,files}. Strong auth consumes req.body.password without removing it; if a new strict schema accepts it as a validated body property, it remains in req.input and therefore fingerprint. The new Inventory adapter must exclude authentication-only password from business/HTTP-idempotency input after it has been authenticated and safely schema-validated. Do not strip fields before strong authentication/device raw-body verification, globally redact arbitrary business fields, or weaken same-key changed-business-input conflict. Auth-required credential verification/device raw-body signature hashing is distinct from persisting a business idempotency fingerprint containing credentials.

Inspected: postingHandlers.js; apiDispatcher.js; authorizationPolicyRegistry.js; createApplication.js/index.js; BaseRequestHandler.js; IdempotencyService.js/normalizeIdempotencyConfig.js; jwtAuthStrategy.js/jwtDevicePasswordAuthStrategy.js/passwordReauth.js; directoryLookups.js. Current independent approval did not include this new capability. No product, runtime or repro test changed/executed.

## A — recommended: minimal opt-in shared cache boundary extension for two new routes

Keep existing strong-auth strategies, password/device signature verification, global request defaults and all existing routes unchanged. Add only the server-owned route/handler capability needed for new Adjustment/Status: after auth/authorization/strict schema and before HTTP idempotency claim, prepare a validated credential-free business input and perform fresh actor/view+adjust/device/original-signature-window checks; before sending cached success, revalidate after any cache-store wait. Cached replay must not return success after permission/device/time invalidation. Missing/misconfigured preparation/replay guards fail closed; caller cannot opt in/out or supply proof.

Inventory-local context/proof and domain pre-claim/replay/post-stock-lock checks from HD113 remain. Reuse existing IdempotencyService/store, actor/method/route/header scope, lease/TTL/body-conflict/response-limit behavior, domain source claim/hash and immutable result; no replacement cache/table/service/dependency or new auth strategy. Password/token/signature/context are excluded from business fingerprints/result/Audit/logs. Fresh auth credentials/signature retry with identical business intent/key can recover the original response; changed business payload still rejects without extra Movement/Audit success.

Benefit: retains the approved HTTP+domain duplicate-submit protection while satisfying the high-risk boundary; no Inventory-only parallel idempotency mechanism. Cost: new opt-in capability touches shared API-definition/dispatcher/idempotency paths and regression tests, beyond current Inventory increment. Exact mechanism, path allowlist, gates, timing/error/revocation semantics and compatibility coverage must be in a concrete candidate and separately approved by actual Sam before source writes; this A only authorizes candidate preparation, not open-ended framework refactoring. Existing old routes are not automatically opted in or retroactively fixed.

Likely shared paths to inspect in that candidate: framework/api/apiDefinitionResolver.js, framework/middleware/apiDispatcher.js, services/idempotency/IdempotencyService.js and corresponding resolver/dispatcher/idempotency tests. This is not yet an approved final path list; prefer the fewest paths actually necessary. Do not silently alter shared auth/createApplication/index/authorization policies/config or migrate existing keys.

## B — hold HTTP implementation pending separately owned boundary work

Keep shared code untouched; TASK031 HTTP entry points remain blocked/unexposed until authorized shared boundary work supplies the required preparation and current replay checks. Read/proposal preparation can continue, but do not call a domain-only implementation complete or invent an exception to required HTTP idempotency. Benefit: no expansion of this task's shared ownership. Cost: TASK031 cannot satisfy its endpoint/security/DoD or proceed to completion yet; arranging another task/owner requires separate explicit user scope, no new thread/task is created by choosing B.

## Next safe action

Recommend A, narrowly scoped opt-in candidate. Harness major-impact gate causes this pause; API/security skills traced the real middleware/cache/password flow rather than claiming domain checks also protect cached responses. Direction choice is not independent design/plan/source review. Prepare exact revised DESIGN/PLAN/spec/commands/scope and developer cases only after choice; request actual Sam baseline review before adoption/implementation. Planned cases include fresh credential replay without duplicate stock, changed business input conflicts, missing/stale actor/device/time/forged proof, wait-induced invalidation, secret-free fingerprint/results/Audit/logs and unchanged ordinary-route behavior; not executed proof or formal acceptance.

HEAD `869ac07abdd3879254c351d857be911d71e68b6b`, source `fe3130fef55c9ec8cc71b2edf872a8a2076b5332581749ee281b211de38f2bc2`, DESIGN `46841dae185fab06e626fca722d1576726702a3d7183fdbb2f23e3459de7f663`, PLAN `8ab85d87051f437b74c6cfb4efc39ba93c8c2dd9e56ca7ea210d7bc5bc705dc8`, original0064 and160 refs/failures unchanged. Only reports/state updated, no canonical/product/test/shared-auth/UI changes, runtime/DB/DDL/permission/dependency, staging/commit/push/PR/remoteCI/merge/main adoption, TASK032+ or formal/release/capacity/floor waiver.
