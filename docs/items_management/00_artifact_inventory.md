# Item Management Existing Artifact Inventory

## Review context

| Item | Value |
| --- | --- |
| Execution mode | `REVIEW_AND_ALIGN` |
| Feature state | Development completed and merged; independent acceptance/sign-off incomplete |
| Output directory | `docs/items_management/` (in-place canonical replacement authorized) |
| Review branch | `codex/items-management-harness-alignment` |
| Inspected baseline | `main` and `origin/main` at `6cb50f50c1aa4db37e0f32ce41073df331d6c034` |
| Source-code changes | None |
| Formal tests executed | None |
| User decision | Production `RTO <= 4h`, `RPO <= 15m`, approved 2026-09-11 |

## Source artifacts

| Original artifact | Canonical artifact | Lines | Original SHA-256 | Authority / action |
| --- | --- | ---: | --- | --- |
| `requirement.md` | `01_requirement_spec.md` | 808 | `ecf0dc0b4a76ea53c5596e4e4940b69bb5c6dbbae981303ec0f2f9950b1c2041` | Primary business baseline; preserve verbatim and add canonical aliases/DR requirements |
| `design_spec.md` | `03_system_design_spec.md` | 1,500 | `58a9e82e14285a8eca95671f5a8cd1cdc1e67a4bc0e361bf0131132c55550805` | Primary proposed design; preserve verbatim and align against current implementation |
| `tasks.md` | `05_development_tasks.md` | 1,533 | `a496a29dc97db9aa04f8f166d3d9d816e655e29a3bda2d2908b40a2783f7e5f9` | Authoritative progress history; preserve 303 checked and 42 unchecked boxes exactly |
| `test_case.md` | `06_technical_test_cases.md` | 437 | `6404877088ee5d723337424b57b9e69b0ba5016092c99ac8694bfeaa42137d9f` | Detailed planned catalogue plus developer evidence; preserve and distinguish from independent acceptance |

All four pre-alignment files were also copied to `/private/tmp/items-management-docs.AHtYAd/` for this work session. Git history remains the durable repository recovery source.

## Additional evidence inspected

| Evidence | Classification | Review use |
| --- | --- | --- |
| Item migrations through `0026` | Implemented database evidence | Compare schema/FK/uniqueness against design |
| `server/src/modules/item/*` and Item handlers/jobs | Implemented backend evidence | Compare domain/API/audit/import behavior |
| `client/src` Item pages/components/services | Implemented frontend evidence | Compare designed user flows and projections |
| `server/test` Item unit/integration/performance tests | Developer test assets | Assess coverage design; no tests were executed in this mode |
| Git history through PR #73 and later main commits | Delivery provenance | Confirm implementation was merged; not a release sign-off |

## Authority order and preservation rules

1. Explicit user decisions in this review, including DR targets and the requirement not to lose task progress.
2. The preserved legacy requirement body for existing business intent.
3. The preserved task body for historical completion/evidence state.
4. Current baseline source/schema for implemented behavior.
5. Legacy design where it does not conflict with approved requirements or observed implementation evidence.

Canonical sections add aliases, findings, missing acceptance layers and remediation tasks. They do not claim that legacy bodies were authored under the Harness, and they do not convert developer evidence into independent PASS.
