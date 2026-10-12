# HD109 — numeric-only Bin Move HTTP input versus shared coercion

## Current disposition — HD109 A and HD110 adopted

Actual Sam independently approved HD110; exact DESIGN46841dae / PLAN8ab85d87 and six shared paths were applied with HUMAN REV088 / APR144–148. Bin Move alone now disables coercion at route compilation; real HTTP verifies strict validation before idempotency, with legacy compatibility preserved. [TASK030 source-bound review](task030-implementation-review.md) records all developer checks and actual Sam HD111 implementation approval, HUMAN REV090 / APR149; TASK030 DONE locally. No global validation/auth/Idempotency configuration change or publication occurred.

## Historical checkpoint — before HD110 approval

ANSWERED A: Sam's actual latest reply selects the minimal route-only no-coercion support. [Exact HD110 four-document candidate](task030-input-coercion-proposal.md) now awaits Sam independent DESIGN/PLAN and six-path scope approval before canonical/framework implementation. Current source, active baselines and143 native evidence refs are unchanged; no new product tests or publication. The original decision rationale below is retained as history, not a still-open A/B question.

## Historical HD109 question

## Evidence and impact

Approved §5.4.1 accepts positive safe-integer numbers, not numeric strings or booleans. server/config/request.js enables shared coerceTypes:true; RequestValidator passes it to AJV. apiDispatcher validates before idempotency execution and the handler; apiDefinitionResolver has no per-route input-validation configuration. Thus "501" or true can become a valid number before the domain receives it. A handler-only guard cannot reliably recover original types or enforce the boundary before HTTP cached replay. HD108 explicitly excludes framework changes; silently changing the shared default or weakening the approved contract is not authorized.

## A — recommended: route-specific no-coercion capability

Approve minimal backward-compatible framework support for an individual route to disable input coercion; only Bin Move opts out. Other routes retain existing semantics. Update exact framework/module scope and affected Harness baselines/approvals; add focused compatibility regression and real HTTP rejection/idempotency tests, then rerun required developer gates. No new dependency, permission, DDL or auth change.

Benefit: preserves strict input and checks before handler/cache. Cost/risk: crosses shared framework ownership and requires compatibility tests. This is a bounded capability for a real second validation policy, not a global default change.

## B — retain framework, change public HTTP contract

Explicitly revise/approve design and tests so HTTP permits existing coercion; internal domain stays numeric-strict. No framework change, but strings/booleans become acceptable numbers, broadening the approved public trust boundary. This is a contract change, not an equivalent implementation.

Recommend A. Default: hold affected writes until actual Sam choice; earlier HD108 approval is not authority for either option. Actual asynchronous question on2026-10-07 includes context, options, compatibility/security trade-offs and this default. Neither choice implies future-source independent review, publication, formal acceptance or gate waiver.
