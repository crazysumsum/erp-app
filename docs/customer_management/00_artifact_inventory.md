# Customer Management Harness 2.0 Artifact Inventory

## Scope and recoverable baseline

| Field | Value |
| --- | --- |
| Mode | `REVIEW_AND_ALIGN` |
| Module | `customer-management` |
| Output directory | `docs/customer_management` |
| Recoverable Git baseline | `0996cb7e85e377981121d2d9b0fd7e99ff8eb1a7` (`origin/main`, observed before the alignment worktree was created) |
| Change boundary | Documentation only; no product source, schema, test script or runtime data changes |

## Consolidation dry run and provenance map

| Source | Type / authority | Source hash / recovery | Destination heading | Unique content / assets | Action | Link check | Human decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `requirement.md` | Overlapping business narrative | `543f76649d64399157ede7c2f74b270aabff462f45547beba4c815ec2a7c67ad` / Git baseline | `01_requirement_spec.md` → Preserved legacy requirement body | Full business scope, 100 FRs, 42 BRs, 14 SECs, 14 original NFRs, 52 ACs | `DELETE_AFTER_MERGE` | Internal references rewritten | Existing recorded NFR-015 decision preserved |
| Existing `01_requirement_spec.md` | Canonical alignment narrative | Git baseline | `01_requirement_spec.md` → alignment summary/formal definitions | Alias map, status clarification, DR target and open issues | `KEEP_CANONICAL + MERGE` | PASS | None |
| `design_spec.md` | Overlapping detailed design narrative | `b839ad6de353ee1658b1a4a234c13b06db7d94722e1450df4b95634997a3c485` / Git baseline | `03_design_spec.md` → Preserved legacy design body | Tables, APIs, UI, services, security, tests, operations and diagrams | `DELETE_AFTER_MERGE` | Internal references rewritten | DR-004 remains open |
| Existing `03_system_design_spec.md` | Canonical alignment narrative | Git baseline | `03_design_spec.md` → aligned decisions/formal definitions | DES-001..025 and normative corrections | `RENAME + MERGE` | PASS | None |
| `tasks.md` | Canonical v1 plan narrative | `8a843766e6bff8e03e524595bd0710a549ca1f8ed5fda83bf4dc13d0d51a846c` / Git baseline | `05_development_tasks.md` | Four Phases, 36 Tasks and sequencing rules | `RENAME + FORMALIZE` | PASS | None |
| Existing `06_technical_test_cases.md` | Technical specification | Git baseline | Same file + formal TC definitions | 90 planned technical cases | `KEEP_CANONICAL + FORMALIZE` | PASS | No execution claimed |
| Existing `07_uat_test_cases.md` | UAT specification | Git baseline | Same file + UAT-059/formal definitions | 58 business cases plus control-owner acceptance | `KEEP_CANONICAL + FORMALIZE` | PASS | No business acceptance claimed |
| `test_case.md` | Superseded test entry narrative | `a379b1440d72228eaf33fa5ad32f1e8c7015538d0f88ddc0b483ad1c6acd80f7` / Git baseline | `06_technical_test_cases.md`, `07_uat_test_cases.md`, generated matrix | Split/evidence boundary only; no unique case body | `DELETE_AFTER_MERGE` | References updated | None |
| Existing `08_traceability_matrix.md` | Hand-maintained generated-like view | Git baseline | `08_traceability.json` → generated `08_traceability_matrix.md` | Group mappings migrated into typed per-entity relations | `REGENERATE` | Pending validator | None |
| Adjacent module designs / `.github/workflows/ci.yml` | Machine/project authority | Current Git baseline | `00_module_manifest.json` / `00_project_profile.json` | Consumer hashes, CI names and command contracts | `VERIFY + KEEP` | Hash checked | Provider readiness stays a Phase gate |

## Source-to-destination content verification

- The complete former `requirement.md` and `design_spec.md` narrative is embedded under explicit preserved-body headings before source deletion; the sole link to the superseded `03_system_design_spec.md` filename was updated to the surviving in-file canonical section.
- Existing v1 alias/correction content remains ahead of each preserved body; formal definitions point back to those exact narratives rather than replacing them with boilerplate.
- `tasks.md` and `test_case.md` contain no machine-readable authority or unique binary/diagram asset. Their unique execution/evidence rules survive in canonical 05–08 artifacts.
- Historical PASS/APPROVED wording is preserved as narrative provenance only; it is not promoted to current authenticated review, CI or acceptance evidence.

## Verified deletions

After content and link validation, the superseded narrative files `requirement.md`, `design_spec.md`, `tasks.md`, `test_case.md`, and the old filename `03_system_design_spec.md` are removed in the same Git change. Recovery is available from `0996cb7e85e377981121d2d9b0fd7e99ff8eb1a7`.

## Protected machine authorities

No Customer OpenAPI, JSON Schema, migration or diagram-source authority exists in the selected directory. Repository CI and adjacent-module design contracts remain in place and are referenced by exact path/hash in the v2 metadata.
