# HD022 — Bounded HTTP capacity for the three full-batch commands

Status DECISION_REQUIRED; proposal only. This is separate from HD021 response headers. No parser policy, global limit, command wire contract or acceptance deviation has been changed. All safety and the20000ms DB transaction ceiling remain mandatory.

## Actual reproduced gap

The sole express.json parser in createApplication runs before the API dispatcher, using security.jsonBodyLimit (default100kb=102400bytes). No existing registered-route JSON override exists. Upload/download mechanisms are different wire contracts and cannot be reused to bypass this parser.

Real owned native MySQL plus discovered HTTP regression, task022-http-capacity-red.log: one100-Line/5000-member Allocate body is474657UTF8bytes, returns413 REQUEST_BODY_TOO_LARGE, and leaves the Fulfillment DRAFT/version1. The identical body then succeeds through the actual service as PICKING/version2 in3877.23ms, with transactionTimeoutMs20000. The HTTP acceptance assertion intentionally remains RED. Earlier capacity results were service results and cannot establish HTTP capacity.

Independent normalizer-only samples (not HTTP proof) also accepted compact5000-member Allocate490265bytes, Reallocate816565bytes and Pick456472bytes. A maximum-width sample with Unicode reasons reached1348881bytes compact/1894497bytes pretty-printed. Different IDs/data account for the different Allocate sample sizes. We must test actual legal HTTP all three commands after implementation.

## A — Explicit trusted bounded per-route parser metadata

Add a strictly validated optional registered API definition JSON-body byte cap, set to2097152bytes (2MiB) only for POST Allocate, Reallocate and Pick. Resolve this trusted metadata before consuming the body, reusing the dispatcher's registered method/version/path matching semantics (case, trailing slash and unknown routes included); no separate prefix matcher or request header/query opt-in. Reject invalid/unknown metadata at startup. Default100kb remains for all other routes/methods.

Use one parser/stream consumption and preserve the existing middleware order: active request limiter, request scope, existing body receive deadline, selected parser and exact rawBody verify, bodyParsingComplete, then normal dispatcher/JWT/fresh authorization/schema/idempotency and command execution. Keep the existing10000ms body receive deadline and all current receive protections; this is not an extension of the20000ms transaction ceiling. Preserve upload/file behavior, error envelopes, rawBody byte identity, rollback, permissions, complete exact-set/current CAS checks, limits100Lines/50perLine/5000members and every P1 gate. No split command, compression workaround, body logging or wire redesign.

The cap is an explicit transport byte ceiling, not a promise that unlimited valid JSON whitespace/escape expansion is accepted. Validate normal client serialization and bounded maximum-width/Unicode/reason samples, including compact and normal pretty formatting; cap and cap+1 behavior stays intentional. Avoid weakening business limits to fit the body cap.

Resource trade-off: each active selected request may retain up to2MiB rawBody versus100KiB today, plus decoded text/parsed objects and existing transient parser copies. At the current default100 active requests, raw retention alone can reach200MiB versus9.77MiB (about190.23MiB additional); total process memory is higher and depends on decoded representation/objects. Keep the active concurrency limit and receive deadline; do not quietly alter them. The byte ceiling bounds transport input, not total heap. Verify bounded large-body stress/memory and limiter slot release in the actual configured test runtime and report the measured limit/observations without promising a universal RSS maximum.

Required evidence: actual legal5000-member HTTP Allocate/Reallocate/Pick, complete response effects/replay and original20s; exactcap/cap+1 including chunked without Content-Length; default/near-miss/unknown path/wrong method; metadata validation and matching equivalence; raw Unicode/whitespace byte identity; slow receive408/slot release; unchanged authentication/403/strict input/CAS/late rollback and security regressions. Run shared framework tests and independent owner/security review against the exact candidate, then all existing P1 gates and current candidate CI.

Likely shared source scope: registered API definition validation, route matching/dispatcher exposure, createApplication parser selection, their focused regression tests and the three handler definitions. Exact paths must be reconciled into the shared module scope/baseline before implementation, with no unrelated framework changes.

## B — Explicitly narrow accepted HTTP capacity

Keep100kb and amend approved full-batch HTTP capacity/UX acceptance to a smaller documented byte-bounded practical capacity. This reduces implementation and ingress memory cost, but fails the currently approved5000-member command path unless the human explicitly approves the scope change. Service-only passing results cannot substitute for that decision.

Recommendation/default proposal A, subject to actual human approval after independent review. HD019, HD020 and HD021 do not authorize this distinct ingress-security/framework policy change. Unaffected Print and other authorized work can continue. No P1 merge, production migration or formal acceptance is requested.


## Actual adoption —2026-10-26

Actual Sam asynchronous answer: A：批准僅三支命令的 2MiB 路由上限（建議）。Exact original reviewed proposal SHA6bdcd4863fedd3527b0c53d370f0cae3b6ef81b3cdd4b887e02eea1a217c8a29 is preserved privately before this append. This authorizes faithful scoped canonical/plan adoption and implementation with all original safeguards, not unseen source/current CI/future release acceptance. Canonical03/05 and report49 define the registered-route matching/metadata/budget details; shared-source independent review and every original gate remain mandatory. No global cap/concurrency/timeout change or service-only acceptance substitution.
