# DEC-016 — P1 cached replay fresh authorization (PROPOSED)

Real application/MySQL developer HTTP test proves a revoked Sales actor receives201 from an identical framework Idempotency-Key cache hit instead of403. The cache bypasses the command service, so its existing fresh directory guard is not reached. Evidence: private `task016-http-native.log`; observed HEAD `e22be9887331fcd7cf5bb478b78df65ebe471aa1`. TASK016 and P1 merge remain incomplete; this is a developer failure, not a formal acceptance result.

## Recommended supplemental scope

Adopt the minimal optional dispatcher preflight, retaining framework and domain idempotency. After JWT/existing policies and before uploads/validation/cache access, await a declared `handler.authorizeRequest(req)`; declarations must be functions, fulfillment must be exactly true, failures deny access. Sales write handlers use existing current account/roles/view+mgmt directory guard; command transactions still independently recheck. The preflight reads authenticated claims only, does not depend on body or mutate the request, and follows existing request cancellation; abort is checked again before further processing. Handlers without a preflight retain their behavior. No BaseRequestHandler, Discovery, JWT strategy or other module rewrite.

Reviewable patch: `/private/tmp/sales-p1-private/auth-proposal/sales-replay-authorization.patch`, SHA256 `71553c3c127cc8d558ec6c09341da8e0a2e3d803844c5b9094dff65a26eee29a`.

Files: dispatcher and its existing tests; Sales authorization helper/Quotation service, schemas and create/update handlers; canonical Design§9.1 and TASK016 scope. Existing manifest already allowlists these shared files; this decision additionally approves their new preflight semantics, not unrelated modifications.

Proposed immutable design/plan baselines after applying the exact patch:

- DESIGN `06115a6e665375a3c2178ad707ced603ecddc9fd8fee4b523c9e887b2a62a885`
- PLAN `83e09740f5051a60cfdf7a76a774f2361e4c79b81aa8dd070a0e91ec4fafe99e`

Prior DEC015 approvals/history remain bound to their original hashes. A new decision binds new DESIGN/PLAN/SCOPE and existing NFR014/015 business-UAT N/A classification, with technical backup/restore obligations unchanged. Runtime/commit/push/PR/merge authorization persists; full P1,23 mandatory developer suites, exact-candidate CI and separate review remain mandatory. No acceptance criteria, coverage floors, test skips or Phase boundaries are relaxed.

## Options and impact

1. Recommended: approve the exact patch and updated baselines. Benefit: revoked/disabled actors cannot use cached Sales responses; existing idempotency remains. Cost: one small shared extension and a bounded directory-read transaction on every Sales write request/cache hit; command transactions still recheck. Potential effects are startup validation and request timing for opt-in handlers; tests cover both.
2. Keep current framework scope: leave affected command delivery/Phase merge blocked until an approved composition-level authorization policy can be installed. Such a policy must be registered consistently in production and all application factories; it is currently broader than the hook.

Disabling transport idempotency or accepting stale cached authorization would change approved security/behavior and is not proposed. Default recommendation is option1; the patch is not applied before approval.

## Required verification after approval

Authorized initial execution/cache replay; revoked permissions and disabled-account denial before cache access; failures/false return produce no handler effects; malformed hook declaration fails startup; request timeout cancels preflight; existing non-opt-in routes remain compatible. Real Sales HTTP test must turn green, then focused/full server regression, native regression, lint and independent review must pass. P1 final Gate/CI remains separate.

## Decision authority

Canonical Design§9.1 currently says: “若實作發現還要改其他 framework能力，先更新設計並取得確認。” Harness [SKILL.md](/Users/sam/.agents/skills/software-engineering-harness/SKILL.md) requires major-impact human decisions; [state recovery](/Users/sam/.agents/skills/software-engineering-harness/references/19-state-and-recovery.md) says: “Do not rewrite an old approval's hash ... Obtain a new decision”. The separate reviewer actually approved the remediation direction, requiring the explicit contract/startup/cancellation guards above; exact-patch review also found a Design1.2 exclusivity sentence, now corrected in the proposed patch; final exact-patch proposal APPROVED by the separate reviewer; SHA/DESIGN/PLAN and apply check independently reconfirmed. This additional approval is required by those explicit design/baseline controls.

## Actual decision and implementation observation

Sam adopted the recommended DEC016 proposal in the current Codex chat: 「按你的意見推進」. The exact approved patch above was applied; observed DESIGN/PLAN match the proposed hashes. Historical proposal bytes/hash and original DEC015 approvals remain referenced in state. Current preflight implementation was independently APPROVED by /root/sales_readiness_review, narrowly scoped to the reviewed files; it is not complete P1 or merge approval.
