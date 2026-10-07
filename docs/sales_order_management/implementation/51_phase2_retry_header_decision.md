# DEC-022 — Preserve confirmation Retry-After on cached202 replay

MODE IMPLEMENT / PHASE-003 / TASK031. DEC021 remains adopted; commit/PR/mainmerge/runtime authorization persists. This is a supplemental shared-file correction; no product/canonical patch has been applied.

## Actual finding and review

Actual native HTTP regression `task031-api-replay-header-red.log` preserves26PASS/1FAIL: initial202 has Retry-After2, cached202 has null. IdempotencyService replays status/body directly and bypasses handler execution. There is no existing route response-header hook. A Sales-only preflight response monkeypatch would mix authorization with response writing and obscure the root cause; disabling cache would weaken the adopted contract.

Separate reviewer `/root/sales_p1_review` actual `DEC022-proposal-R1-20261007` APPROVE for submitting this proposal. Exact product/canonical patch hashes and prospective baselines independently recomputed; both git apply --check PASS. Independently executed prospective private unit copy28PASS/0skip. Proof `/private/tmp/sales-p2-private/dec022-proposal-reviewer-source.json`. This is proposal review, not human adoption or proof that native product behavior is corrected.

## Concrete correction and baseline

Add optional route `idempotency.retryAfterSeconds`, validated as a positive safe integer at startup; only declaring routes' replayed202 receive Retry-After of that fixed value. Confirm declares2, consistent with its existing data/header. Undeclared routes and200 retain behavior. No response-header copying, secrets, store/schema changes, effect re-execution, fresh authorization bypass, changed cache policy or changed UUID/business semantics.

Two supplemental shared paths: `server/src/services/idempotency/IdempotencyService.js`, `server/test/idempotencyService.test.js`; confirm handler is already Sales-owned. All28 developer suites, five candidate CI checks, fullPhase review/merge gates, formal60/UAT and original thresholds/NA reasons remain unchanged. Human adoption will bind new DESIGN/PLAN/SCOPE and unchanged NFR014/015 UAT-NA to this baseline, retaining all historical approvals rather than rewriting them.

- Product patch `/private/tmp/sales-p2-private/retry-proposal/retry-after.patch`: `22495f71bcf31c334eed3cee75a868e8aa8df6f79dd8127543a985c562c18a4c`.
- Canonical patch `/private/tmp/sales-p2-private/retry-proposal/canonical.patch`: `94f5e6d08f9a414029d52301b3491bcefc35cadb544147f0a105707e3eeee8a3`.
- Prospective DESIGN `d6735bfceebd8f7abc3300c13820a5e67d57fd6a6aeb197d37be0eea23557014`.
- Prospective PLAN `df9db7d0d9f235d677bf39b113880bdcc666bb9672cdee12bcc57af29e6904b0`.

## Decision Required

A recommended: adopt both exact patches/new baselines and two supplemental paths. Benefits: root-cause correction with no SQL migration and safe compatibility; cost: seven shared implementation lines and one behavior test. After adoption run actual native HTTP and framework regression, obtain fixed-source review, then continue original P2.

B: defer shared correction; keep TASK031/full P2 merge incomplete. Independent frontend/recovery work may continue; no fallback lowers replay/header or security obligations.

Default recommendation A. Affected shared path stays unapplied pending direct human decision. Existing Git/runtime permission does not need reapproval.

## Requirement for this decision

[Harness implement](/Users/sam/.agents/skills/software-engineering-harness/references/08-implement.md): “Do not silently change architecture, transaction semantics, security model, public interface, data ownership, acceptance criteria, or Phase boundaries.” This new optional framework route contract touches shared source outside the adopted allowed_write_paths.

[Harness state/recovery](/Users/sam/.agents/skills/software-engineering-harness/references/19-state-and-recovery.md): “Do not rewrite an old approval's hash to make it look current. Obtain a new decision, retain the old record, and explicitly dispose of obsolete evidence.” The exact two-path scope addition changes DESIGN/PLAN; old approvals remain historical, not silently repinned. Actual current native evidence remains RED until corrected.

## Actual human adoption — 2026-10-07

Sam’s direct「批準」adopts DEC022. Both exact patches independently hash/apply-checked then applied; observed DESIGN d6735bfceebd8f7abc3300c13820a5e67d57fd6a6aeb197d37be0eea23557014 / PLAN df9db7d0d9f235d677bf39b113880bdcc666bb9672cdee12bcc57af29e6904b0 match the proposal. New approvals appended; old decisions/RED/reviews retained. Actual native correction remains to be verified; no Phase completion or merge claim.
