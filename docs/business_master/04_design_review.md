# Business Master Design Review

## Reviewer provenance

- review_method: HUMAN（preceded by SELF_REVIEW）
- author: `/root` Codex context
- reviewer and actual context/identity: ERP Product Owner (Sam)，真實人類 reviewer，與 author 不同
- reviewed_baseline (DESIGN hash): `9d77d905dc4a82d6e079898cd98fd5bbf74f8aab466d85b56ca9830d0b8b4f87`
- source/evidence reference: 2026-09-14 Codex task 使用者「同意」明確回應 exact-hash approval／independent
  HUMAN reviewer 聲明；`01_requirement_spec.md`、`03_design_spec.md`、`05_development_tasks.md`、
  `06_technical_test_cases.md`、`07_uat_test_cases.md`、`08_traceability.json`
- Read-only review constraints: 先以需求、API、資料、交易、安全、失敗模式、UI、可觀察性、migration、
  recovery、consumer compatibility、testability 十二個 lens 審閱；發現事項記錄後才由作者修改正式 artifacts。

## Gate summary

- Design sub-gate: READY_FOR_PLANNING
- Open CRITICAL and HIGH findings: 0
- Current human design approval reference: 2026-09-14 Codex task 使用者「同意」，綁定 DESIGN
  `9d77d905dc4a82d6e079898cd98fd5bbf74f8aab466d85b56ca9830d0b8b4f87`
- Scoped risk/self-review exception, if approved: 無；manifest 要求 independent review

## Findings

### DR-001 — 語意欄位可經一般 PATCH 繞過影響確認

- Severity, requirement/design targets and evidence: HIGH；FR-002/005/007、SEC-003、DES-005/007。
  初稿允許直接 PATCH Currency `decimalPlaces` 與 Payment Term `calculationType/dueDays`。
- Impact and recommended action: 新交易的金額展示或到期日語意可在沒有 consumer impact/reason/confirm 下改變；
  把語意欄位收斂為專用 command，token 綁 operation/proposed change。
- Disposition: RESOLVED
- Resolution evidence and actual approving authority: 使用者於 2026-09-11 明確回答「是」（HD-010）；已更新
  FR-002/005/007、SEC-003、DES-005/007/009、TASK-004/005/006/013、TC-009、UAT-005/006。

### DR-002 — Consumer 影響判定可能在未安裝或不可用時被誤當零

- Severity, requirement/design targets and evidence: HIGH；FR-007/009、DES-005/012。共享模組尚未部署與
  checker failure 的 operational state 不同。
- Impact and recommended action: 若 unknown 被當作 zero，管理員可能在實際有 default/open transaction 時執行高影響操作；
  registry 必須 fail closed，只有 readiness 明確證明 `NOT_INSTALLED` 才是 known zero。
- Disposition: RESOLVED
- Resolution evidence and actual approving authority: DES-005/012 與 TC-009 明定 required checker
  `UNKNOWN/ERROR/timeout` 阻擋，`NOT_INSTALLED` 需 readiness 證據；此為落實 HD-007 的安全細化。

### DR-003 — 尚未完成真實獨立設計審閱

- Severity, requirement/design targets and evidence: HIGH（process gate）；manifest
  `review_policy.independent_required=true`，本次 reviewer 與 author 是同一 context。
- Impact and recommended action: self-review 可找錯但不能提供 reviewer independence；請由真實人類 reviewer 或不同
  context reviewer 對 exact DESIGN hash 審閱並記錄 findings/disposition。
- Disposition: RESOLVED
- Resolution evidence and actual approving authority: ERP Product Owner (Sam) 於 2026-09-14 對上一則完整
  exact-hash／independent HUMAN reviewer 聲明回答「同意」；reviewer 為人類且不同於 Codex author。

### DR-004 — Exact design/plan baseline 尚未由 Product Owner 批准

- Severity, requirement/design targets and evidence: HIGH（human gate）；GAP-RQ-005，PLAN_READY 顯示
  `APPROVAL_MISSING_STALE` for DESIGN/PLAN。
- Impact and recommended action: 未批准的計畫不可進 implementation；向 Product Owner 展示 exact hashes 與 artifacts，
  取得明確 DESIGN、PLAN approval 後寫入 state。
- Disposition: RESOLVED
- Resolution evidence and actual approving authority: ERP Product Owner (Sam) 於 2026-09-14 批准 exact DESIGN
  `9d77d905dc4a82d6e079898cd98fd5bbf74f8aab466d85b56ca9830d0b8b4f87` 與 PLAN
  `edd6ca008e4ca76ecf281c2b2451733c143e261c89dda28f8af20ea3a1c359c9`。

### DR-005 — 五分鐘 impact token 時效為低風險假設

- Severity, requirement/design targets and evidence: MEDIUM；DES-005。repository 未見既有 impact-token timeout convention。
- Impact and recommended action: 過短增加重試，過長增加 drift 視窗；implementation 前可依 platform convention 調整，
  但 confirm-time fresh recompute、same actor/version/operation/proposal 不可移除。
- Disposition: ACCEPTED_RISK
- Resolution evidence and actual approving authority: 設計明確把它標成 minor assumption；不改變安全不變量或 public contract。

## Human decisions required

無。後續若 canonical requirement/design/plan/profile/traceability/manifest 改變，baseline hash 會失效，必須重新審閱及批准。
