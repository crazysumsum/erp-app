# Invoicing & Accounts Receivable Requirement Review

## 1. Review Result

- Status: **READY_FOR_SYSTEM_DESIGN**
- CRITICAL findings: 0
- HIGH requirement findings: 0
- Business interview required now: No；核心業務選擇已在原需求訪談確認。
- Normative source: `requirement.md`
- Traceability adapter: `01_requirement_spec.md`

## 2. Standards Assessment

| Dimension | Result | Evidence／Disposition |
| --- | --- | --- |
| Purpose、actors、scope | PASS | BRD §§0～4完整定義目標用戶、角色、Capability及Out of Scope。 |
| Functional behavior | PASS | 143項具Priority的FR涵蓋正常、例外、批量、恢復及歸檔流程。 |
| Business rules | PASS | 52項BR明確規定來源、金額、日期、關帳、Exposure及Archive不變式。 |
| Security | PASS | 15項SEC涵蓋最小權限、IDOR、敏感資料、重新認證、私有檔案及注入。 |
| Measurable performance | PASS | 9項NFR含p95、吞吐、容量及證據要求。 |
| Acceptance criteria | PASS | 70項Given／When／Then覆蓋核心風險及Must需求。 |
| Scope control | PASS | Tax、GL、FX、Bank Reconciliation、Returns、Refund、Email等明確排除。 |
| Requirement identifier stability | PASS AFTER ALIGNMENT | 保留既有ID；canonical alias提供harness機械追溯。 |
| Availability／DR target | PASS | RTO≤4小時／RPO≤15分鐘已於2026-09-10批准。 |
| Retention legal fit | PASS | 財務≥7年、Import 90日、Export及可重建PDF 7日；legal hold／較長法規優先。 |

## 3. Cross-Module Consistency Review

| Contract | Review | Required design treatment |
| --- | --- | --- |
| Fulfillment Shipment → Invoice | CONSISTENT | 只接受`SHIPPED`、完整Shipment、唯一Claim及Line source；`PICKED`／`REVERSED`拒絕。 |
| Invoice → Fulfillment Reversal guard | CONSISTENT | 每個Shipment source amount須完全Credit或Invoice Void，才回`CLEAR`；UNKNOWN fail closed。 |
| Sales Exposure | CONSISTENT | Confirm Invoice時以同一transaction／event把SO承諾分類移至AR，總Exposure不雙計。 |
| Sales／Fulfillment Archive | CONSISTENT WITH VERSION GATE | Finance aggregate獨立歸檔；永久Source Index保持跨Active／Archive追溯。 |
| Customer | CONSISTENT | Billing資料選填且快照；Manual只限Active Customer，既有債權可在Suspended／Hold處理。 |
| Item／Inventory | CONSISTENT | Item只供SKU／UOM快照；Invoice、Credit及Receipt均不得產生Inventory Movement。 |

Sales及Fulfillment相關文件尚未在main，因此上述一致性屬設計對齊，不代表Provider已實作或已通過consumer contract test。

## 4. Risks Carried into Design

| Risk | Severity | Required proof |
| --- | --- | --- |
| 同Shipment重複開票 | HIGH | DB unique claim、transaction、idempotency及真MySQL雙人競爭測試。 |
| 分批Shipment四捨五入導致多收 | HIGH | Source minor-unit分配、last-remainder owner及property/unit test。 |
| Invoice／AR部分commit | HIGH | 單MySQL transaction、durable operation及commit-unknown recovery。 |
| Credit／Receipt並發超額 | HIGH | 固定lock order、CAS／unique constraints及barrier test。 |
| Exposure在SO轉Invoice時雙計 | HIGH | 單一event contract、reconciliation及before／after相同總額。 |
| 正式文件／關帳歷史漂移 | HIGH | append-only facts、effect date、snapshot及as-of projection。 |
| Active／Archive斷鏈 | HIGH | permanent index、manifest count/hash、atomic routing及restore演練。 |
| 銀行／檔案資料洩漏 | HIGH | encryption、projection masking、owner-safe download、audit redaction及IDOR test。 |

## 5. Provenance and Change Decision

初次alignment沒有改寫原BRD；使用者於2026-09-10批准OI-001／OI-002後，已以0.2版本紀錄回寫`requirement.md`並同步所有下游測試門檻。

## 6. Requirement Gate

**通過進入System Design。** OI-001及OI-002已批准；Production Release仍須以相應DR、retention、purge及restore測試證據證明，而不是只靠文件決定。
