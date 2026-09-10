# Sales Order Management Existing Artifact Inventory

## 1. Review Context

| Item | Value |
| --- | --- |
| Execution mode | `REVIEW_AND_ALIGN` |
| Feature scope | Sales Order Management（Quotation、Sales Order、Reservation／Backorder、CSV／Channel Intake、Inquiry、Export、Archive） |
| Output directory | `docs/sales_order_management/`（in-place replacement authorized by user） |
| Source worktree | `codex/sales-order-requirements` at `62b4d7f41d204238be652ebb4b7787209d463910` |
| Current project baseline inspected | local `main` at `5d39d486f1ca9eb8805b24504edec4062ff46c6f` |
| Source state | Canonical package is untracked; source branch is 13 commits behind inspected `main`; legacy bodies are embedded in canonical artifacts |
| Temporary recovery backup | `/private/tmp/sales-harness-replace.Wa9zWQ/` (OS-temporary; commit the canonical package for durable preservation) |
| Application-code change | None |
| Formal test execution | None |

## 2. Artifact Inventory

| Source artifact | Apparent type | Coverage / quality | Authority / confidence | SHA-256 | Action |
| --- | --- | --- | --- | --- | --- |
| Legacy requirement body embedded in `01_requirement_spec.md` | Business requirement specification | `GOOD` business breadth; `PARTIAL` original Harness ID/NFR/SEC structure | Primary source, high confidence; claims prior decisions | original SHA-256 `6dbdec0883cd6be197b217b7425004dfb809a22eee3ba1c974cfa799f0012756` | `PRESERVE SEMANTICS` + normalize obsolete paths + `ALIGN` |
| Legacy design body embedded in `03_system_design_spec.md` | Detailed system design | `GOOD` technical depth; `PARTIAL` original canonical `DES-*` traceability and implementation evidence | Primary proposed design, medium-high confidence | original SHA-256 `aa2b38ebb9db6af62097e7923cd8debbdf30ab2e65ad0b778d157816f9fe9272` | `PRESERVE SEMANTICS` + normalize obsolete paths + independent review |
| Legacy plan body embedded in `05_development_tasks.md` | Five-Phase development plan | `GOOD` executable detail; `PARTIAL` original Harness `PHASE-*` / `TASK-*` naming | Primary proposed plan, medium-high confidence | original SHA-256 `280472930939ace096f77b7d4eb7f83d49b2319d1779894d81a8c066c38910a2` | `PRESERVE SEMANTICS` + normalize obsolete paths + canonical alias |
| Legacy UAT body embedded in `07_uat_test_cases.md` | UAT catalogue with technical/operational cases | `GOOD` scenario coverage; `PARTIAL` original Technical Acceptance/UAT separation | Primary planned acceptance source, medium-high confidence | original SHA-256 `a3750deeaf3b669de4eb9c91e3c57751e8603731413ef38f8b063846ace3418e` | `PRESERVE SEMANTICS` + normalize obsolete paths + split/alias |
| `../../../frontend-design.md` | Shared UI standard | `GOOD` project convention | Existing project standard, high confidence | Not pinned by this package | `VERIFY` during implementation |
| Current `server/src/framework/*` | API/auth/upload/idempotency/scheduler framework | `PARTIAL` support for planned Sales design | Implemented on inspected `main`, high confidence for current behavior | Git baseline above | `VERIFY` on implementation branch |
| Current Item/User implementation and migrations | Upstream patterns/providers | `PARTIAL`; Item/User exist, Customer/Inventory/Fulfillment providers do not | Implemented on inspected `main`, high confidence | Git baseline above | `VERIFY` / dependency gate |
| Sales source/migrations/pages/tests | Product implementation | `MISSING` | Direct repository inspection, high confidence | N/A | `GENERATE` only in a later authorized `IMPLEMENT` mode |

## 3. Authority Order

1. Explicit user decisions in this review, including production `RTO <= 4h` and `RPO <= 15m` approved on 2026-09-10.
2. The embedded legacy body in `01_requirement_spec.md` for existing business intent and acceptance criteria.
3. This aligned requirement entry for canonical IDs and provenance only.
4. The embedded legacy body in `03_system_design_spec.md` for proposed architecture, subject to `04_design_review.md` findings and gates.
5. Current `main` implementation for what exists today; proposed provider contracts are not treated as implemented facts.

## 4. Preservation Rules

- The user explicitly authorized in-place replacement. The four legacy filenames were removed only after their full bodies were embedded; obsolete self-reference paths were normalized to canonical filenames. Exact original bytes remain in the recorded temporary backup and match the recorded hashes.
- Aligned files add aliases, findings, missing acceptance layers and provenance; embedded bodies are still identified as legacy and are not claimed to have been created under the Harness.
- Any conflict affecting business semantics routes back to the requirement gate before implementation.
- `PLANNED` and `NOT_RUN` are specifications, not execution evidence.
