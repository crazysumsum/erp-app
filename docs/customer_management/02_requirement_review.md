# Customer Management Requirement Review

## 1. Review Result

Status: `READY_FOR_DESIGN_ALIGNMENT`.

The aligned full requirement is unusually complete for an existing artifact: it states business goals, in/out scope, roles, lifecycle, functional requirements, 42 business rules, 14 security requirements, measurable capacity targets, exception handling and 52 Given/When/Then acceptance criteria. No core capability needs to be invented.

## 2. Preserved Intent

- Company customers and wholesale use only; no consumer CRM or customer hierarchy.
- Manual globally unique Customer Code and hard normalized Legal Name uniqueness.
- Direct activation by default; optional another-person approval controlled by Customer Settings.
- Multiple addresses/contacts/purposes with one optional default per purpose.
- Optional payment term, credit policy, bank accounts and attachments.
- General management, approval, banking and settings permissions remain separate.
- Sales chooses Customer only; Fulfillment chooses a saved active shipping address and saves a snapshot.
- Bulk import uses per-row partial success but each row aggregate is atomic.
- Non-Active status blocks new business, not the completion/correction of existing obligations.

## 3. Enhancements Without Business Scope Change

| Item | Alignment |
| --- | --- |
| Canonical IDs | Added `FR-001..FR-100` aliases while preserving all original IDs. |
| Existing-obligation semantics | Consolidated `BR-025/026` into explicit purpose categories for consumer design. |
| DR measurability | Added user-approved `NFR-015`: RTO<=4h and RPO<=15m. |
| Retention safety | Seven years remains the minimum; no destructive purge before Legal/Compliance confirmation. |
| Evidence boundaries | Planned technical checks and UAT are separated; no test result or business sign-off is inferred. |

## 4. Resolved Ambiguities

- Customer status is not a blanket kill switch: new sale/manual invoice is Active-only, while existing confirmed/shipped/receivable obligations can continue under downstream controls.
- Default Currency is an activation minimum; Payment Term, addresses, contacts, credit, banks and attachments remain optional.
- Credit Limit `null`, zero and Credit Hold are distinct states.
- Customer Settings changes are prospective and never rewrite pending/completed decisions.
- Bank-management permission does not imply reveal permission; all required permissions are explicit.

## 5. Unresolved Matters

| Issue | Why it does not block core design | Required control |
| --- | --- | --- |
| Legal hold / retention beyond seven years | Baseline already forbids early purge. | Keep purge disabled until approved. |
| Initial catalogs | Fields are optional except an Active currency; schema/API do not depend on invented seed values. | HKD plus approved data before activation. |
| Downstream provider versions | Purpose and ownership semantics are defined, but concrete providers are not all on main. | Block their integration tasks until merged contract verification. |
| Production scanner/storage/keys | Core customer data can be implemented independently. | Bank/file capability stays disabled and fails closed. |

## 6. Missing Scenarios Added to Downstream Specifications

- Crash recovery between file metadata commit and physical finalize.
- Canonical key comparison under real MySQL collation.
- Purpose-specific non-Active Customer behavior for existing fulfillment, invoicing, AR and returns.
- Commit-unknown/idempotency outcome reconciliation.
- Provider readiness for permanent deletion and archive/open-matter checks.
- Real-browser Playwright acceptance with console and network inspection.
- Measured RTO/RPO restore and cross-store reconciliation.

## 7. Readiness Decision

- Requirements ready for aligned system design: `YES`.
- Requirements ready for unrestricted production release: `NO`; OI-002..005 are explicit release/Phase dependencies.
- Application implementation performed in this review: `NO`.
- Tests executed in this review: `NO`.
