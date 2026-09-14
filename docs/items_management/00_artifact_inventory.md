# Item Management Existing Artifact Inventory

## Review context

| Item | Value |
| --- | --- |
| Execution mode | `REVIEW_AND_ALIGN` |
| Feature state | Development completed and merged; independent acceptance/sign-off incomplete |
| Output directory | `docs/items_management/` (in-place canonical replacement authorized) |
| Review branch | `codex/item-management-harness-v2-alignment` |
| Inspected baseline | `main` and `origin/main` at `fd8a4ddb27636aaeb47235f3d4976001fa7dfc7a` |
| Source-code changes | None |
| Formal tests executed | None |
| User decision | Production `RTO <= 4h`, `RPO <= 15m`, approved 2026-09-11 |

## Source artifacts

| Original artifact | Canonical artifact | Lines | Original SHA-256 | Authority / action |
| --- | --- | ---: | --- | --- |
| `requirement.md` | `01_requirement_spec.md` | 808 | `ecf0dc0b4a76ea53c5596e4e4940b69bb5c6dbbae981303ec0f2f9950b1c2041` | Primary business baseline; preserve verbatim and add canonical aliases/DR requirements |
| `design_spec.md` | `03_design_spec.md` | 1,500 | `58a9e82e14285a8eca95671f5a8cd1cdc1e67a4bc0e361bf0131132c55550805` | Primary proposed design; preserve verbatim and align against current implementation |
| `tasks.md` | `05_development_tasks.md` | 1,533 | `a496a29dc97db9aa04f8f166d3d9d816e655e29a3bda2d2908b40a2783f7e5f9` | Frozen authoritative source: 303 checked/42 unchecked; canonical T23 index later corrected with explicit TASK-042 provenance |
| `test_case.md` | `06_technical_test_cases.md` | 437 | `6404877088ee5d723337424b57b9e69b0ba5016092c99ac8694bfeaa42137d9f` | Detailed planned catalogue plus developer evidence; preserve and distinguish from independent acceptance |

The prior v1 alignment recorded a temporary session copy; this v2 run does not rely on that ephemeral path. Git commits `ceb33b9` and `fd8a4dd` are the verified durable recovery sources.

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

<!-- HARNESS_V2_ALIGNMENT_NOTES -->

## Harness v2 migration dry run and provenance map

Selected module: `item-management`; exact module root: `docs/items_management`; mode: `REVIEW_AND_ALIGN`; risk: `HIGH`; owner: `ERP Product Owner (Sam)`, confirmed by human decision `HD-002` on 2026-09-11.

Observed recovery point is Git commit `fd8a4ddb27636aaeb47235f3d4976001fa7dfc7a`; the original v1 alignment is recoverable at commit `ceb33b9`. The selected worktree was clean before metadata generation, so no uncommitted authoritative document content is at risk.

| Source | Classification / authority | Recovery | Destination | Unique content preserved | Action / link result | Human decision |
| --- | --- | --- | --- | --- | --- | --- |
| `01_requirement_spec.md` | Canonical narrative plus verbatim legacy business baseline | `fd8a4dd` / legacy SHA already recorded above | Same file, Appendix A formal definitions | 64 FR aliases, 15 NFR, 9 SEC, BR/AC and approved RTO/RPO | `KEEP_CANONICAL`; v2 definitions added | Owner confirmation pending |
| `03_system_design_spec.md` | Overlapping legacy filename containing the only full design | `fd8a4dd` | `03_design_spec.md` | All 1,560 lines, DES index, detailed design and findings | `DELETE_AFTER_MERGE` by lossless Git rename; canonical link updated | No semantic decision |
| `05_development_tasks.md` | Canonical plan plus historical progress evidence | `fd8a4dd` / legacy SHA above | Same file, Appendix A formal Phase/Task definitions | All T01–T36 evidence/checklists and TASK-037–044 | `KEEP_CANONICAL`; duplicate TASK-012 alias removed | T23 index omission reconciled by TASK-042 on 2026-09-14; original SHA retained |
| `06_technical_test_cases.md` | Canonical planned technical specification plus historical developer evidence | `fd8a4dd` / legacy SHA above | Same file, Appendix A formal TC definitions | Full detailed risk catalogue and NOT_RUN meaning | `KEEP_CANONICAL`; no result promoted | Recovery runner missing |
| `07_uat_test_cases.md` | Canonical UAT specification | `fd8a4dd` | Same file, Appendix A formal UAT definitions | UAT-001–015 plus operational/security owner acceptance UAT-016 | `KEEP_CANONICAL`; all remain NOT_RUN | Business sign-off pending |
| `08_traceability_matrix.md` | Previously hand-maintained generated-view candidate | `fd8a4dd` | Regenerate from `08_traceability.json` | Prior semantic notes retained in inventory/gap/review | `GENERATE`; never edit relationships here | Owner required before renderer passes |
| `09_traceability_validation.md` | Historical mechanical report | `fd8a4dd` | Same report path | Prior v1 result preserved as history only | `VERIFY`; replace status with current v2 result | None |

### Protected machine authorities

Migrations `0010`–`0026`, handler/request schemas, `ItemLookupService`, item-domain constants and executable tests remain repository authorities and are never replaced or deleted by Markdown. Their exact paths are recorded in `00_module_manifest.json`; the provided contract hash pins `03_design_spec.md` only as the current narrative contract because no OpenAPI/JSON Schema bundle exists.

### Link and deletion checks

- The design rename is byte-preserving before formal definitions and recoverable from Git; no unique narrative was deleted.
- Existing product-source comments still point to the pre-canonical `docs/items_management/design_spec.md`, which was already absent after the v1 alignment. Fixing product-source comments is outside `REVIEW_AND_ALIGN` and is recorded as `GAP-DOC-002`.
- No OpenAPI, JSON Schema, migration, diagram source, test asset or historical evidence file was removed.
