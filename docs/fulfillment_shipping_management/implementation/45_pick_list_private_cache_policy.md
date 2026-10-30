# HD021 — Exact private no-store Pick List JSON response

Status DECISION_REQUIRED; proposal only. TASK023 requires strict JSON Pick List projection with private/no-store headers. No framework response-policy change or acceptance deviation has been adopted. Original P1 gates/safety and20000ms remain.

## Actual gap and source

server/src/framework/http/apiResponse.js sendSuccess unconditionally replaces Cache-Control with no-store; sendError also forces no-store. BaseRequestHandler delegates strict-envelope JSON there and disallows direct json/end. Its response helper provides statusCode/meta, no cache policy option. Existing fileResponse private headers apply downloads and do not justify bypassing strict JSON schemas/envelopes. Pragma is not the required Cache-Control directive. Supplier's separate header waiver is not Fulfillment authorization.

Actual source-level probe called the existing sendSuccess with a trusted response header private,no-store: actual result is no-store/privatePreserved:false. The exact acceptance condition cannot be met through conventional handler headers alone. Actual separate reviewer independently checked these paths and confirmed the gap/material shared response-policy/acceptance choice, recommending A for human disposition; exact-proposal review remains separate from adoption.

## A — Narrow safe success-read header preservation

Change only server/src/framework/http/apiResponse.js success serialization so successful GET/HEAD may retain the exact trusted response literal `private, no-store` set by a handler. Missing method/header and every other value retain the existing forced no-store default. POST/PUT/PATCH/DELETE and errors remain no-store. Untrusted request Cache-Control never influences response policy. Do not introduce arbitrary cache options, public/max-age support, module path special cases, schema bypass or a general response hook.

The Pick List handler sets that fixed literal and Pragma:no-cache. Existing strict response schema/envelope, authorization, error handling, response redaction and all other defaults remain. Reject/overwrite public, max-age, arrays, mixed directives and nonexact variants; no caller can opt into storage. This is stronger privacy for an approved read response, not permission to weaken cache security.

Scope/cost: one small shared framework source plus focused module tests (planned server/test/fulfillment/fulfillmentPrintHeaders.test.js), existing framework/security regression and real authenticated Pick List HTTP header proof. Test GET/HEAD trusted exact literal, defaults, request-header noninfluence, arbitrary/array/combined policy rejection, every command method and all error responses; preserve strict JSON body/schema and every existing P1/CI/coverage gate. No production configuration, new dependency, global default change or timeout exception.

## B — Explicit Fulfillment header acceptance deviation

Keep framework behavior and explicitly accept no-store without the private token for this module, amending the exact TASK023 requirement/acceptance and documenting its impact. This saves the shared source change but leaves the original exact acceptance unmet without a human waiver. No such waiver is currently authorized; another module's waiver cannot be inherited.

Recommendation/default proposal A. Actual human answer is required before shared source policy changes or acceptance deviation. Unaffected Print projection/schema/UI and other P1 work may proceed while this specific header integration is pending. No P1merge/formal acceptance/live deployment authorization.


## Actual adoption —2026-10-26

Actual Sam asynchronous answer: A：批准限定 GET／HEAD 的安全標頭支援（建議）。This adopts A faithfully; no unseen-source/future-CI approval is claimed. Exact pre-adoption proposal SHA 3025779a822188473d4ab3975b939be798d574f81cba441352c8689b5f843fae is preserved in the private proposal-snapshots archive. Canonical design/plan, owner pins and named shared scope are being aligned before affected code; exact independent adoption review and every source/runtime/fullP1/currentCI gate still apply. HD022 remains a separate unanswered decision; no HTTP body cap or acceptance waiver follows these answers.
