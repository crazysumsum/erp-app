# P3 啟動補充決策 — DEC-025（待採納）

模式 IMPLEMENT；PHASE-004 / TASK-038～049。Sam 最新「批准下一階段」已授權啟動 P3；既有 commit/push/PR/main merge、隔離合成測試授權沿用。此提案處理新發現的跨模組權限與驗證契約，不能把開始授權當作尚未呈現的安全設計批准。

## 已核實的基準

- 最新 main / isolated worktree HEAD：`4fb62b001d331f719ac9aa1e7aefbdebbdd298f3`；`/private/tmp/erp-sales-p3`，分支 `codex/sales-order-phase-3-intake`。
- 原 DESIGN `c45760f51fd9ae03bb1632ba74fba727f4a8d9dc2e591e47fbc5c1a8f1819dcb`；原 PLAN `fc7b1d89a82f7ae7f0563344f656d5de9ff8bf3f63fac7526275dc7c213eb621`；產品來源 fingerprint `68b8adc3abe418898ef510c85d665b136ed9e7c64582e989d178c275593a8d31`。
- P2 PR190 實際已合併；完整私有 checkpoint240／925檔案與實際清理 receipt 已核對並恢復到選定 worktree，CAS revision234；保留全部批准、失敗、CI、review 與 evidence，沒有重放已完成操作。原四個 DB 均已停止，P3 DB 尚未建立。
- DR-003 的 disk upload 已由 P0 交付；DR-007 已批准 canonical-only，舊 Phase table 的 BLOCKED 字樣不是新依賴。實際缺口如下。

## 建議採納的最小補充

1. **精確路徑與 forward schema**：加入 Import Job／Intake／errors 三張表 migration，及第四個 `extend_sales_reservation_intake_projection`。後者補現有 SO source Intake UNIQUE/FK，擴充0078的兩個 mapping trigger允許精確 Intake root/child pair；保留全部 manual/backorder、數量、來源及immutable guards並拒絕混搭，不改任何已套用migration。序號目前最高0079，實際寫入前再核對主幹／owner；不在此預留。兩個真 `salesJobs/jobs` job、獨立 `sales-import-templates` resource handler及必要 shared owner/test paths詳列於 patch/JSON。
2. **Import reserve-only principal**：固定 `sales.importWorker`，與原 job表、registry及lease key一致；重用 Inventory batch engine，但新增獨立 reserve-only sibling／purpose／兩個operationtypes。先鎖 live scheduler lease，再鎖 event／source／Job／Sales；Inventory重驗同一lease與真正runtime。CSV保留 confirmed_by，每張訂單重驗 active actor `sales.view + sales.import`，不要求／授予額外mgmt，不允許release/manual/backorder impersonation。獨立UUID business claim token不截斷schedulerowner；停止／撤權／lease loss／abort整體rollback。
3. **受控代碼及 owner batch reads**：只讀部署 `sales.importChannelCodes` allowlist；UPPER_SNAKE長1～50、最多100且唯一，預設空/fail closed。既有lookup回同一集合；合成測試明確配置合成碼，真實CSV go-live仍需實際代碼。Customer／Item owner提供最多100個成員的batch precheck/code-UOM resolver，Sales不直接讀主檔。確認時仍重新鎖定並查真snapshot。
4. **Channel boundary**：保留canonical JavaScript V1與結果介面，沒有公共route或真平台adapter；server-wired可信verifier不存在／無效就拒絕，payload的authenticated/serviceName/callback不能自證。只由可信context決定channel；每次effect重新驗service及liveworker。Contract fake驗規格，不能作平台上線證據；首個真adapter仍另開security gate。
5. **33項 developer 合併 Gate**：原28項全部保留，新增 unit/native/client/browser/performance五套（min16/18/10/10/2、零禁止skip）；10個Inventory native全部執行，只保留歷史具名4项大型效能延期。正式TC001～060／全部UAT及原門檻不改，分別於TEST_AND_VERIFY／business acceptance執行。新增既定Intake95/90/90 per-file floor，原37 per-file及global92/83/90/client不降低。必跑真HTTP、DB、Playwright、crash／commit未知／duplicatestorm／security／retention；10,000orders/50,000lines≤30分鐘，同時50foregroundusers及completed confirmation P95≤3s／pool不飢餓；另驗50MiB非連續grouping原Phase0memory bound。TC043是全Phase aggregate，不寫空PASS。
6. **測試資源**：既有自有合成MySQL26.7/socket/TCP/HTTP/browser/migration/crash/load/cleanup授權沿用，建立新namespace且核實ownership。新增fresh instance對既有restore regression必要的暫時fixture-admin rights，只限escaped `item_recovery_it_*`／`erp_restore_*` schemas與CREATE USER；完成恢復原grants，普通app維持DML/SUPER=N。不重用DEC023舊PID授權、不指向共享／production、不匯出raw證據。

## 可審查的凍結提案

- 精確canonical patch：`/private/tmp/sales-p3-private/dec025-canonical.patch`，SHA256 `936420c6e654420ede1c591a9e22fb3ea4df95c4b5b103d699b99bf22a71d966`。
- 新 DESIGN `e9995444bf53fe06b2a9fd106631343ac95bfb4d81ed5c8e448f1bb3349ab629`；新 PLAN `0a77edbc9764415f4bd8d96046e47d3f24832700eff0e9dc62a06caba8cc53fe`。
- 完整file hash/scope/suite來源：`/private/tmp/sales-p3-private/dec025-proposal.json`。
- 真正已做的驗證：`git apply --check` PASS；獨立私有validation mirror typed contracts／traceability `STRUCTURE_PASS`、0issues。尚未套用canonical patch，尚未寫P3產品碼或SQL，尚無P3功能測試PASS。
- 人類採納後新增DESIGN/PLAN/SCOPE/RISK批准，完整承接舊批准範圍與unchanged NFR014/015 UAT-NA；舊hash不覆写。僅已批准paths/contracts/thresholds的機械source-pin/hash/matrix/reference更新可新增history-preserving bindings；沒有事先授權任何後續重大變更。

## 選項與代價

**A（建議／無其他限制時的預設）**：採納以上凍結方案，依原12Tasks和≤5主要檔案atomic slices實作，完整33developer／5exactcandidateCI／actual independent review／freshmain Gate通過後依原授權合併。代價：一個forward trigger migration、少量shared provider與worker補充、完整隔離驗證時間。實際CSV go-live仍需受控代碼，真平台、正式驗收、business UAT和release均未批准。

**B**：維持原契約與manual-only Inventory，P3 affected實作及合併保持NOT_READY；不得把Import要求改成mgmt或用假principal／任意channel繞過。可繼續做不依賴該決策的只讀分析，但不能宣告P3完成。

## 決策依據

[Harness implement](/Users/sam/.agents/skills/software-engineering-harness/references/08-implement.md)明定：「Do not silently change architecture, transaction semantics, security model, public interface, data ownership, acceptance criteria, or Phase boundaries.」

[Harness recovery](/Users/sam/.agents/skills/software-engineering-harness/references/19-state-and-recovery.md)明定：「Do not rewrite an old approval's hash to make it look current. Obtain a new decision, retain the old record, and explicitly dispose of obsolete evidence.」

此確認只針對新security／owner／schema／execution-contract補充，並非重問既有P3啟動或Git授權。批准前不套用凍結patch或執行新worker效果。

## 獨立覆核

兩位真正 SEPARATE_AGENT reviewer已覆核同一凍結patch/D/P：`/root/sales_p1_review` R2 APPROVE（proof `/private/tmp/sales-p3-private/dec025-proposal-r2-reviewer-proof.json`），`/root/sales_readiness_review` actual FINAL APPROVE；均無未解HIGH/CRITICAL。原R1 NOT_READY/CHANGES_REQUESTED歷史保留。兩位各自重算五份canonical file hashes及D/P、查實際source、比對所有舊29suite、確認patch apply check及新的typed graph。這些覆核只支持提案，不代表產品／UI已驗證或准許合併。

## Actual adoption

Sam 在本次 Codex chat直接回覆「批准」，採納上述凍結DEC-025。精確patch／D/P核對後套用並以新批准保留全部歷史；P3功能實作及測試尚未完成。
