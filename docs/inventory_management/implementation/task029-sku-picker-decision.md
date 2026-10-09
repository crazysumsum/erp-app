# HD-102 — TASK029 Draft SKU selection boundary

## Answered checkpoint — Sam selected A

Sam實際最新答覆「A」：準備最小Inventory-owned精確Code lookup契約；未批准未見契約或產品實作。已完成[HD-103精確候選與新DESIGN／PLAN](task029-sku-lookup-proposal.md)，等待獨立Sam審阅。Canonical與source不變；111 native evidence refs保留。以下是回答前原始問題／scope，保留歷史而非仍待A/B選擇。

## Historical question before Sam's answer

Status: DECISION_REQUIRED; IMPLEMENT, TASK029. Sam's latest「同意繼續」authorizes continuing the existing UI task, not a new public lookup/security contract. No product edits or new runtime execution in this decision checkpoint.

Observed baseline: head `869ac07abdd3879254c351d857be911d71e68b6b`, source `caf576fa738762dabb7faafe471c1ea95370138f21913ad5cf885084258c96f6`, DESIGN `c8dc42b3fea72c2f6ab8a2bead404a25e65bb2ca9addcf15814d570b9a4c1cb1`, PLAN `11b815650cfb7851c5c096fe14fb7a2cff84ef3d28cd6d8afb1ae99d3ef8ad9a`. Actual state inspect at revision585 returned LOCAL_CHECKS_PASS/no issues; previous API developer proof remains current for unchanged source, not UI verification.

## Evidence and impact

- Design §7.1 grants the Transfer page `inventory.view`; §7.5 requires Draft SKU/Lot/source-Bin selection. FR-TRANSFER-001–003 permits Draft creation without posting stock and revalidates quantity/protection at Dispatch.
- `server/src/handlers/skus/listSkusHandler.js` calls ItemAdminService and applies ITEM_VIEW_POLICY. `skuSchemas.js` defines that policy as `item.view` OR `item.mgmt`, not Inventory permission. Calling this administrative list would impose a new permission dependency.
- InventoryInquiryService.listStockAggregates/listStocks derive candidates from `inventory_stock_balances`; even NO_STOCK filtering cannot discover a SKU with no Balance row. Using them as the only SKU selector would silently narrow Draft creation, not merely reuse a presentation component.
- Item-owned ItemLookupService already provides findByCode and the approved transactional inventory profile. These need no downstream `item.view`; Inventory must enforce its own permission and return a minimal whitelist. There is no current public Inventory SKU lookup handler.

Do not auto-grant Item access, weaken the Item administrative list, copy Item qualification SQL/rules into Inventory, silently restrict Drafts to existing stock, or expose raw numeric-ID entry as a substitute for approved SKU selection.

## Options

A (recommended): authorize preparing a minimal Inventory-owned `GET /api/v1/inventory/sku-lookup?code=...`, JWT + `inventory.view`, exact SKU Code lookup. Reuse Item-owned lookup/profile; return only SKU identification, Base UOM and tracking/eligibility information required for Inventory selection, no administrative/price/media data. Existing Transfer writes still revalidate under their own transaction; no lookup can authorize posting. No new permission or migration, no Item code modification intended. This adds a public read contract, so document exact response/error/eligibility scope and affected design/PLAN/traceability/test proposal first, then obtain the required baseline-bound approval before product implementation. No fuzzy catalogue/barcode search is included in this minimal proposal.

B: defer this lookup contract and the complete Draft editor. Unaffected Transfer list/detail/Dispatch/Receive UI may proceed under the existing routes, but TASK029 cannot be DONE until SKU selection and actual browser DoD are resolved. No permission or public API change, but incomplete Draft creation and delayed task completion.

Recommendation: A preserves least privilege and supports SKUs without prior inventory; it is smaller than a new catalogue or Item permission grants. Default while unanswered: hold the affected decision path, preserve all API evidence and source; no implementation of A or implicit narrowing. Remaining material choices are not bundled into approval of this proposal.

## Required downstream updates after answer

Record Sam's actual choice. If A: prepare exact bounded lookup contract and design/PLAN/test/traceability delta with new hashes; secure configured review/human approval before implementing the changed contract, then UI/component/real API/Playwright verification. If B: keep Draft/UI completion unresolved and proceed only unaffected existing UI scope when directed. No commit/push/PR/CI/merge/laterTasks/formal acceptance/UAT/deployment authority; four capacity cases remain NOT_EXECUTED and mandatory at applicable full-P3/release gates.
