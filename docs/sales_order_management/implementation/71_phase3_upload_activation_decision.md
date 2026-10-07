# DEC-026 — P3 upload activation supplement (pending adoption)

Current IMPLEMENT / PHASE-004 / TASK-040; HEAD `05b19a1811fa98913951db4a08a139df68b1e7a5`. Existing development/commit/PR/main merge and owned synthetic runtime authority remains in force. This supplement has not been applied.

Actual native default startup rejects four concurrent requests of50MiB plus128KiB framing:210239488bytes exceeds default200MiB by524288bytes. The native HTTP test also returned UPLOAD_MALFORMED / Unexpected end of form: the pre-route watchdog attaches a data counter, then removes it after Express skips multipart, leaving the stream flowing during fresh asynchronous authorization. Bytes reach no parser.

Proposed exact patch: add `server/config/api.js` and `server/src/framework/middleware/bodyReceiveTimeout.js` to this module scope. The deployment default disk budget becomes200.5MiB (+512KiB); concurrency4,50MiB file cap, framing, memory bound and startup guard remain unchanged. After Express JSON parsing completes/skips, disarm the watchdog and pause only an unconsumed request; the route's multipart pipe resumes after authorization. JSON has already completed and is not paused. Existing timeouts/counters/authentication order remain enforced.

Options: adopt this correction and continue the approved P3 work; or leave P3 upload activation blocked. Lowering file/concurrency limits would change approved behavior and is not recommended. The only resource increase is512KiB of maximum disk bytes in flight. No new dependency, route, production access, acceptance waiver or release is added.

Private module-loader overlay verifies the exact proposed shared bytes without applying them: native HTTP/MySQL **8 cases PASS, zero failure/skip**; existing JSON/watchdog/upload/Sales regression **140 PASS, zero failure/skip**. Initial pre-parser pause proposal caused three JSON408 failures plus a mock failure; that proposal was corrected and its negative evidence retained. The compensation race in the approved Sales core was independently found, reproduced native RED and fixed by rechecking the moved file after locking original operation and Job.

Current DESIGN `e9995444bf53fe06b2a9fd106631343ac95bfb4d81ed5c8e448f1bb3349ab629` / PLAN `0a77edbc9764415f4bd8d96046e47d3f24832700eff0e9dc62a06caba8cc53fe`.
Proposed DESIGN `728edbc6d4146e0d373b7f07b97a0df1820c95493554608755541647f39c98b2` / PLAN `c29fa71caed564d3fc0dc4b4d609a0b3e9a73a0af34b47bd29875f45fcea4b50`.
Exact patch SHA256 `df3fbbfec005b6cc1dca94aacc0013221e0dc273a402ed709db559fbcefee9c4`, privately retained at `/private/tmp/sales-p3-private/dec026-activation.patch`; proposal file hashes at `/private/tmp/sales-p3-private/dec026-proposal.json`. History is preserved; a new binding is required rather than rewriting DEC-025 approvals.

Actual independent corrected-proposal review is pending. Proposal/candidate checks do not declare current live source, whole TASK-040/P3, CI, formal acceptance or merge PASS. On adoption: apply exact reviewed patch, rerun actual unmodified-source checks, record new D/P decision and only then complete upload activation.
