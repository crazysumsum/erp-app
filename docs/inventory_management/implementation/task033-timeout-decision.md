# TASK-033 — indeterminate high-risk UI outcome / HD130

Current disposition — HD130 ANSWERED: actual Sam A selects the presented same-intent explicit retry/tab-session query-only refresh direction; APR175, bound to unchanged current PLAN/source/HEAD. Candidate preparation only, not unseen source/spec/shared adoption, final DoD or publication. Historical discovery and original alternatives remain below. No TASK033 product/tests/runtime execution occurred.

## Status and observed baseline

DECISION_REQUIRED. Actual latest Sam instruction 「繼續」 starts TASK033 discovery after local TASK032 closure. TASK033 IN_PROGRESS / module BLOCKED, resume IMPLEMENTING; TASK026–032 remain locally DONE and TASK034+ PENDING. No TASK033 product/test/runtime or canonical specification changes have occurred.

HEAD `869ac07abdd3879254c351d857be911d71e68b6b`; source `ea5fed017f5eba2fcdfe2adf9bd74521deb6e95d863797892e5a0a9c15c03e43`; DESIGN `6db8d2b49512bda19f6b2b17c54e9882be75795c3c610ca92ca143860edd127d`; PLAN `237d98e617f0a0f4612934118be2d589652b4eb70968291ad511fec6bb758658`. Existing253 indexed evidence references are retained, not TASK033 proof.

## Context and actual source observations

TASK033/P3-T08 requires view+adjust visibility, strong device/password confirmation without password in client state/URL/resend cache, and source-result lookup before retry after timeout. The existing backend has all three strong-auth write routes, Stock current versions, Movement group/reversal details and `GET /api/v1/inventory/operations/by-source`; no new endpoint is proposed here.

`InventoryOperationService.findBySource` returns null if no row is visible or completed_at is null. A posting transaction's uncommitted row may also be invisible. A null response therefore cannot establish that the original request rolled back or will never commit. Neither timeout nor query failure can be presented as confirmed failure or permission to create a new event.

`client/src/framework/http/HttpClient.js` signs the actual body using the existing injected device signer, generates a header key only when none is provided, performs one fetch, maps timeout/network errors, and contains no automatic retry/cache. TASK033 must generate the intent/key once outside each attempt and must not reuse a signed request/nonce. Existing `client/src/framework/ui/PasswordReasonDialog.vue` uses reactive password state and a different reason length; it cannot satisfy the literal TASK033 constraint unchanged. An Inventory-owned native password input with transient submission-only reading/clearing is a candidate technique, not authorization to change shared auth/UI.

The present Adjustments page does not exist. Existing MovementsPage already displays historical group legs and bidirectional selected-leg reversal links; current stock guards must come from Stock inquiry, never historical balanceVersionAfter. Existing SKU lookup exposes tracking policy and Base UOM; Pack-unit selection and other exact UI details are not settled by this decision.

## A — recommended: explicit same-intent retry only while original page remains

Keep the original business intent/source/header key immutable and credential-free in the current page. After an indeterminate outcome, query that exact source first. A completed result resolves from server facts; null or failed query remains UNKNOWN. No automatic retry, new event, silent version substitution or optimistic success. A user-explicit same-page retry may resend only the unchanged original business body/source/key after fresh password entry, fresh device signature/nonce and ordinary current authorization; a null query is not proof of rollback. Server HTTP/domain idempotency remains the authority.

Before POST, save only minimal actor-namespaced source/route recovery identifiers in sessionStorage, with no password, token, signature, proof, reason or business payload. After reload, query that original source, but do not restore or reconstruct a retry body. Unknown results keep resubmission blocked and show a safe operation reference plus manual reconciliation guidance. Storage failure must not silently allow an unrecoverable POST. Logout/account change must not display another account's recovery record. This is tab-session recovery, not a durable server inbox; tab/browser closure or storage clearing may lose the reference and needs explicit user guidance.

Benefit: existing contracts suffice and legitimate transient failures can be retried without duplicate intent. Limit: after refresh an unresolved operation requires read-only queries/manual reconciliation rather than a guessed resend. Exact retention/cleanup, state transitions, sensitive-input lifecycle, permissions and native browser scenarios must appear in a reviewable candidate before adoption.

## B — no retry action after unknown outcome

After every indeterminate outcome, only query the original source and show manual reconciliation guidance, including while the original page is still present. Same minimal refresh recovery identity and no secret/payload persistence; no backend contract change. Simpler and avoids a client retry workflow, but transient failures interrupt warehouse work more often and operators need external reconciliation before a new intent. It must not be described as a completed operation or a confirmed rollback.

## Decision boundary and next safe action

Recommend A. Until actual Sam choice, hold affected source/canonical writes. The answer selects the recovery direction and candidate preparation only; it does not approve unseen implementation/spec/test/shared paths, new API/DDL/auth/dependency changes, final TASK033 DoD, TASK034, publication/remote CI/merge/main integration, formal TC/UAT/business/release/capacity or any threshold/skip waiver. Actual independent implementation reviewer remains Sam. No new tests ran and prior PASS results are not relabelled TASK033 evidence.

Harness major-impact gating causes this pause; API/security skills distinguish an unknown outcome from a failed transaction. UI/Playwright skills require later real browser proof (including timeout, unchanged intent, refresh, password lifecycle, permissions, console/network and responsive keyboard flows), not static-review acceptance. No existing Graphify graph was found; direct source tracing respects the current module-only discovery boundary without generating a new repository graph.
