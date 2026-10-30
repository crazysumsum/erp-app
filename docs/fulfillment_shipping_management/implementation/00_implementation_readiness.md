# Fulfillment implementation readiness

## 當前：已授權整合最新 main 並在 Gate 通過後合併（2026-10-30）

Sam 最新明確授權整合最新 main、完成獨立影響覆核及必要驗證，只有新候選 CI／全部必要檢查通過後才將 PR297 轉正式並合併；容量或效能失敗即停報，全部安全檢查與20秒限制保留。此指令取代下方歷史「暫不合併」限制，但不豁免任何 Gate。已保存1705候選的完整結果與私有快照；fresh main 現為 `6d84ee454b72f4b3e43b2aa6eee2436e6e950716`，新增Supplier PR305。整合與新候選驗證尚未完成，舊1705 CI不作新候選通過證據。

## 歷史：1705候選 P1 開發及交付前驗證完成（2026-10-30）

**PHASE-002／TASK-012–023 全部 DONE；DEF-022／025 已關閉。** 已批准方案 C、所有既有安全檢查、100 行／每行 50／總數 5,000、原 20 秒交易限制及 coverage 門檻均保留。[PR297](https://github.com/crazysumsum/erp-app/pull/297) 保持 OPEN／DRAFT／未合併；Sam 的「暫不合併」仍有效。下方各節及報告67–70保留原批准、失敗、暫停及中間量測歷史，不能代替本節當前狀態。

候選 `1705bf55b8f86e75d62b6f99fe83af11cc2376c2`；source fingerprint `f5722fefc3372188dfe6396d2ea7fad158315aa6abd5778ccffbf5a3ad6852df`；DESIGN `ffca05957b4ca550ff231f6b9224537735e93615c91345c215f1eb0572be1747`；PLAN `9a651b0b761d938b06f4083359398de612fa14ad94e1755be8ecafac9dfde030`。當前CI真正checkout `6737868a445a26122897c840bafd69dd44b2a073`，parents為main `e64dfc7452dd4ce598e6e9d1765000d9633dd849`＋此候選，tree與候選完全相同（`04e890d971883355bb2bf0410de8d5d5ad4abf54`）。

[CI40985160345](https://github.com/crazysumsum/erp-app/actions/runs/40985160345) **13／13 jobs SUCCESS**。四個原生shards共4,400項＝4,193 PASS／0 FAIL／0 CANCEL／207既有條件式或獨立步驟skip；不是全域零skip。獨立覆核確認未以skip隱藏C失敗。Merged server coverage lines95.76%／branches87.64%／functions94.94%及39個per-file floors通過；client coverage、lint、build、audit、真P1 Playwright2項、Sales capacity2項／import3項／TC042兩項與總Test均通過。

| 當前 CI 真正交易 | 耗時 | 證據／限制 |
| --- | ---: | --- |
| 原5,000 Reallocate末批故障 rollback | 11,623.629ms | 原strict45000故障、全量facts rollback與50批斷言通過；非watchdog |
| 同event恢復 Reallocate | 11,524.623ms | 10,000歷史／5,000 released／5,000 live及Reservation版本／數量對帳通過 |
| 真HTTP Reallocate主交易 | 16,311.613ms | HTTP請求整體16,407.587ms，200；Allocate／Pick與末批rollback、3次replay均通過 |
| 5,000 Balance preview的Allocation準備交易 | 13,802.220ms | 412 query＋25,362 execute；非整個133秒多輪case耗時 |

Reallocate preclaim兩個phase均為155 query＋152 execute＝307次，較原15,007次少14,700次；所有15,000筆child紀錄保留。以上是本輪觀察，**不是穩定P95，不能把跨候選／環境時間差全歸因於C**。原20秒未變，沒有新增FORCE INDEX或schema。

範圍登記造成PLAN機械變更後，舊PLAN下的真實報告全部原樣保留。因generic Harness沒有跨PLAN adoption，已獨立覆核並在最終PLAN下**實際執行恰好六項必要suite**，沒有改寫／複製舊PASS，也沒有另重跑13／44診斷：

- lint：`20261030T014313-773ca9f50ba7` PASS；
- client-build：`20261030T014311-7ec816698116` PASS；
- security-audit：`20261030T014313-e03e11392622` policy PASS；仍有既有1 low／4 moderate，沒有聲稱零漏洞；
- 共用P0／P1 developer collection只跑一套：`20261030T014329-d61cd9fd8cc4`，596 PASS／0 FAIL／0 SKIP；
- 真P0 Playwright：`20261030T015438-545ec0199e0d`，2 PASS／0 FAIL／0 SKIP；
- 真P1 Playwright：`20261030T015528-2efff33cd916`，2 PASS／0 FAIL／0 SKIP。

所有run均在相同候選／來源／最終PLAN實際執行，原始JUnit、typed結果、case IDs、命令契約與artifact hashes已核對。獨立reviewer `/root/fulfillment_resume_review` 最終覆核0 C/H/M，receipt `independent-child-c-final-currentplan-ci-dod-closure-review.json` SHA `8f24cb2b9c7ff638700a43a346432d1d0034ba0e1bc36b3137265f1bf0f2c947`。已按其結論關閉DEF022／025及TASK017／022；全部原失敗和批准保留。更新後實際 `MERGE_READY --phase PHASE-002` 得到 **LOCAL_CHECKS_PASS／0 issues**，原六個missing-run阻擋已以真實新執行解除；這是本地一致性Gate，與外部CI／獨立覆核分別記錄，不等於合併或業務驗收批准。

本輪專用namespace `fulfillment_p0_p1_7ce01091`／帳號已精確清理，專用MySQL正常停止，socket／pid消失、兩個瀏覽器連接埠已釋放；資料目錄及私有原始證據保留。驗證後只有state／本readiness等bookkeeping更新，產品／spec候選沒有再改。下一步由Sam審閱draft PR；任何未來合併仍須fresh target檢查及所需當前CI／review。正式Technical Acceptance、後續NFR／UAT及發布按原計劃分開處理。

## 歷史：恢復後驗證及 C 範圍登記（2026-10-30）

恢復後原共用完整 developer collection：**596 PASS／0 FAIL／0 SKIP**（`20261030T005654-3cd09dde9859`）；真P0／P1 Playwright各 **2 PASS／0 FAIL／0 SKIP**（`20261030T010843-fca9dac13c72`、`20261030T010920-3bfd5bbcda06`）。三份原始報告及artifact hashes已獨立覆核0C/H/M，來源 `f5722fef…6852df`、實際執行PLAN `142a24e5…4b23e` 前後一致。相同來源的lint／build／audit及C新測試16／7保留；原中斷run仍是中斷，不覆寫。專用runtime已精確清理並停止。

機器範圍檢查發現C批准尚未登記為SCOPE、兩個既有C測試路徑未列入manifest；現在只把這兩個確切路徑加入test_paths及approval_required_paths，新增原批准的衍生記錄與C精確SCOPE。所有舊批准、需求／設計文字、測試契約、命令／門檻、NFR023豁免實質均保留；NFR023只改指向同一權威的衍生ID。已重新生成matrix，範圍及traceability檢查通過。

此登記機械上產生DESIGN `ffca05957b4ca550ff231f6b9224537735e93615c91345c215f1eb0572be1747`、PLAN `9a651b0b761d938b06f4083359398de612fa14ad94e1755be8ecafac9dfde030`。原測試仍如實綁定執行時PLAN142a，不改run.json、不複製成新PASS、不冒稱在新PLAN重新執行；generic Harness尚無metadata-only adoption，故不能宣稱其總Gate已通過。保留獨立適用性說明及該機械限制；繼續完成目前候選的真正CI，DEF022／025與TASK017／022仍待當前CI及最終覆核，PR297不合併。

## 已恢復工作（2026-10-30，Asia/Hong_Kong）

Sam 已明確指示「繼續」，解除下方歷史暫停。核實保存提交 `c4352baa` 僅改兩份本模塊文件，來源 fingerprint `f5722fef…6852df`、PLAN及DESIGN與暫停前相同；fresh fetch 的 main 仍為 `e64dfc74`。保留已完成13／44診斷及同來源16／7、lint／build／audit結果；只補齊因使用者中斷而未完成的原共用完整collection及兩條真Playwright lane，再處理當前候選CI與覆核。原中斷記錄不改寫，20秒／5000／全部安全檢查及PR297不合併限制保留。

## 使用者要求暫停（2026-10-29）

Sam：「保存現有工作成果，之後暫停」。已停止新增工作，並對已確認的本任務 Node process group 發送 SIGINT；原完整 P0／P1 developer run `20261029T100154-9fc3feec1915` 因使用者暫停而中斷。原始52-byte未完成JUnit保留，adapter為BLOCKED，沒有可信完整計數；**不是產品效能失敗，也不是完整套件PASS**。不重跑、不啟動瀏覽器或CI。

已保存：C實作及原生13／完整44 PASS（含原5000／20秒／末批rollback）；最新main已整合；合併後來源`f5722fef…6852df` 的16 pure／7 native與lint／build／dependency audit均PASS。專用DB基礎schema／帳號已清理、MySQL已停止、socket／pid不存在；原件、私有證據與datadir保留。PR297維持draft／未合併，本輪新提交尚未推送。

恢復入口：先取得Sam恢復指示並核對本地保存提交／來源與遠端狀態；只補齊受中斷的完整collection、P0／P1真Playwright、獨立結果覆核及當前候選CI。已完成13／44診斷不因報告或名稱再跑；不得把舊CI或本機局部PASS代替新候選Gate。DEF022／025與TASK017／022保留未完成狀態，20秒、所有安全檢查及不合併PR297的限制不變。

## 歷史：P1 交付阻塞表（2026-10-29）

下一個交付固定為：**解除原 CI 的 Reallocate 末批 projection rollback 20 秒逾時，完成必要回歸、當前候選必要 CI 與獨立覆核，使 PR297 可審閱**。不合併 PR297；不因其他模塊的歷史失敗全面停止不受影響的工作。此節是唯一持續更新的交付阻塞表；下方 P0 entry 及報告67–70保留各自歷史，不將舊結論改寫成當前狀態。

目前已保存 C／既有 IN／診斷，並整合 fresh main `e64dfc7452dd4ce598e6e9d1765000d9633dd849`；HEAD `a2a29617c6935fd5ba8c65cc7890a6f38dbaa5f5`，source fingerprint `f5722fefc3372188dfe6396d2ea7fad158315aa6abd5778ccffbf5a3ad6852df`，PLAN `142a24e513c6889dcd6da31cc5c7313f98d1e937a50998ff56c0a45025c4b23e`，DESIGN `f7902ae0f02984b5feeb8cb02d5893c57820e99b1e90c471b6f6044305270584`。本輪 GitHub 唯讀查驗：[PR297](https://github.com/crazysumsum/erp-app/pull/297) OPEN／DRAFT／未合併／remote head 仍30d；該 head 最新 PR [CI40801317549](https://github.com/crazysumsum/erp-app/actions/runs/40801317549) FAILURE，13 jobs＝10 SUCCESS／2 FAILURE／1 SKIPPED。C＋IN 候選尚未推送，沒有自己的 CI，不借用舊候選結果。

| 阻塞 | 證據 | 最小下一動作 | 完成標準 | Sam 決定 |
| --- | --- | --- | --- | --- |
| **唯一產品交付阻塞：原 full5000 Reallocate 末批 rollback 在20秒被 watchdog 中止**；DEF022／025 OPEN，TASK017／022 IN_PROGRESS。IN trial 功能通過但讀量目標未達，不能關閉阻塞。 | [67：CI 原失敗](67_candidate_ci_reallocate_timeout_stop.md)，交易20,001.046ms、941 query／40,338 execute；[70：IN trial](70_released_projection_id_in_optimization.md)，原完整 file 44 PASS／0 FAIL／0 SKIP，但每個 phase 仍50 UPDATE／260,000 examined／250,000 Handler_read_next。 | C已實作，小型13及原完整44均PASS，實測少14700次client呼叫；整合main後的候選須完成必要完整回歸、目前候選必要CI及獨立覆核。下文A／B及C提案保留為歷史。 | 必須以整筆交易效果證實具體修法；原嚴格45000末批故障、整筆 facts rollback、同event恢復及數量守恆通過；原5000／20秒與所有安全檢查不變。之後才做必要回歸、固定候選必要 CI／coverage、獨立覆核；任何項未過，PR保持 BLOCKED。局部read-proof或診斷完成均不是解阻。 | **Sam 已實際批准 C**：「批准方案 C：批量 child claim及完整驗證（建議）」，綁定原 readiness SHA `c3005f4afac273fb49f9d11224e0ebe66704bff04776d880ed554ea0280ff0f1`。已完成實作及獨立覆核、小型原生及原容量量測；整合後完整回歸／CI待執行；A／B未執行。 |

### C 已批准後的實作進度

只在 Reallocate 的新 member／leg 使用每批100普通 INSERT與完整來源鍵回讀；scope／root／其他action／schema保持原有行為。單元19 PASS，lint exit0；原 fixture mock／lint失敗紀錄保留。獨立 reviewer 發現 duplicate 批次讀鎖可能等待後續無關鍵，已修成依原輸入順序逐一 exact-key FOR UPDATE，在第一個衝突停止，並新增原生競爭回歸。小型原生13 PASS／0 FAIL／0 SKIP，覆蓋跨批次全rollback／FK錯誤／真鎖競爭及無關後鍵不等待；完整原Reallocate file44亦44 PASS／0 FAIL／0 SKIP，coverage啟用、collector VALID、source／PLAN／HEAD前後相同。當前CI尚未開始，原CI阻塞仍未關閉。下方C提案段落是批准前歷史，保留原決策語意。

### C 原生量測結果（本機開發驗證）

原5000 case／100行／每行50／100 Balance不變；末批45000正確觸發，整筆facts回滾及同event恢復全部通過。每個phase的child紀錄與posting工作保留，preclaim實測為 **155 query＋152 execute＝307次**，較舊5＋15002少14700次，符合結構目標。

| 階段 | rollback | 同event恢復 |
| --- | ---: | ---: |
| preclaim | 1447.157ms；155q／152e | 1442.429ms；155q／152e |
| Inventory posting | 3513.673ms；379q／25254e | 3494.978ms；379q／25254e |
| 完整parent交易 | 7743.902ms；1091q／25507e；預期45000 | 7291.164ms；1097q／25661e；成功 |

只有本機單輪觀察，不是P95或CI通過。前次IN使用SQL／PFS observer，本輪只有caller計時，因此不能把整筆時間差全歸C、亦不能把呼叫數減少98%稱為時間改善98%。原Inventory逐筆posting成本仍存在；沒有增加hint、index、schema或時限。

證據：private `child-c-measurement-result.json` SHA `74103bee1fdf0d548a5fcdc83c79914b0e82a7b93b3a0948409962ad571fb286`；小型13原始log SHA `f5547c7efa0430a68d4477f4064aaf42121c9bda7ea18b31613963af828ac6a4`；實作與小型／容量准入均由 `/root/fulfillment_independent_review` 實際覆核0C/H/M。最初MySQL啟動SIGSEGV發生於migration／schema／Node測試前，失敗原件以`.failed-sandbox-startup`保留；相同prepare bytes／參數在獲准環境執行後成功，未偽造或刪除失敗。main已整合；診斷source pin因C改動更新，原pure RED26PASS／2FAIL保留，更新後28PASS／0FAIL，未改AST／hash／拒絕來源變更斷言。下一步對固定整合候選執行必要完整回歸及當前CI；PR297不合併。

### 同一原失敗情境的完整交易成本

測試固定為一張 SO／Fulfillment 的100行，每行50個既有 Reservation，合計5000；100個 Balance。Reallocate 釋放5000舊 Allocation、建立5000新 Allocation，末批 projection 注入45000，要求全交易回滾後同event成功恢復。不是不停替一張 SO 新建 Reservation，也不是5000 Balance preview 案例。以下 CI 是原失敗，local 是新的 IN WIP；同一業務情境但不同 source／環境／執行上下文，不能作同環境加速比。均為單次觀察，**不是P95**。

| 階段／包含關係 | 原 CI rollback（ms；query／execute） | IN local rollback（ms；query／execute） | IN local 恢復成功（ms；query／execute） |
| --- | ---: | ---: | ---: |
| 完整 parent transaction，含交易邊界 | **20,001.046；941／40,338；TIMEOUT** | 8,794.022；941／40,357；預期45000 | 8,255.884；947／40,511；成功 |
| callback 計時邊界 | 20,001.290：由外層withTransaction起算至callback結束，**不是body-only** | 8,261.435：caller root body-only | 8,236.140：caller root body-only |
| prepare | 696.828；214／0 | 335.407；214／0 | 250.274；214／0 |
| preclaim | **4,528.262；5／15,002** | 1,755.215；5／15,002 | 1,735.459；5／15,002 |
| Inventory posting | **9,073.143；379／25,254** | 3,721.850；379／25,254 | 3,749.258；379／25,254 |
| Inventory 返回後 tail（以下子項均已包含於此） | 未有完整起迄量測，不能以交易差額冒充 | 1,898.030 | 2,000.478 |
| ↳ Reservation current read | CI 未細分 | 63.538；13次 SQL | 63.270；13次 SQL |
| ↳ ownerCurrentProof | 810.222；262／0；已完成 | 378.587；262／0 | 374.157；262／0 |
| ↳ 舊 projection UPDATE span，含本輪 observer | CI 未細分 | 1,044.322；50次 UPDATE | 1,042.293；50次 UPDATE |
| ↳ 上列 UPDATE 直接 client SQL／server prepared／observer（不同邊界，不能三者相加） | CI 未細分 | 783.713／732.994／250.524 | 777.870／730.095／255.434 |
| ↳ 新 projection／Claim／Line 保存 | CI 未細分，不能判定中止批次 | 360.517；50次 SQL，末批預期故障 | 457.101；200次 SQL |
| ↳ sequence override audit | CI 未細分 | 未到達 | 0.075；0次 SQL／0筆 override，本案例無偏離；不是5000 audit benchmark |
| ↳ Header／history／一般audit | CI 未細分 | 未到達 | 4次直接SQL／SQL wall合計0.659ms（1 query＋3 execute）；不包含於下列operation方法 |
| ↳ `F_OPERATION_COMPLETE_ASYNC` 方法 | CI 未細分 | 未到達 | 8.098；6次 SQL；只代表此方法及其子呼叫，不包含上述Header／history／audit |
| 提交後 RR Inquiry，**不屬於 RC 交易** | rollback 未到達 | 未到達 | 13.045；11／0 |

preclaim 與 Inventory posting 兩個已完成區間在原 CI 合計 **13,601.406ms、40,256 execute**；加 prepare 為14,298.233ms。CI外層起算至callback結束的時間減這三段約5,703.056ms，只能稱未歸屬的整體 wall，包含交易前置邊界、owner proof、其他來源處理、projection及未完成步驟；不能全稱 callback body、projection 或 CPU。再扣 owner proof 的數學差約4,892.834ms仍不是已量到的某個函式。所有父／子 span、trigger／table I/O／server prepared 都可能 inclusive；不重複加總，不把 SQL client wait 當純 server CPU。

四個CI已完成provider合計860 query／40,256 execute，與parent的差是81 query／82 execute；只代表四段以外已觀察到的client呼叫，不全歸tail。以parent elapsed而非callback-end-from-outer-start計算，四段以外wall為4,892.590ms；兩種計時邊界分開保留。

本機同一成功 phase 中，舊 SQL→IN 的 UPDATE client 1,202.884→777.870ms，完整 parent 卻8,173.692→8,255.884ms；原 SQL 用filtered單案例、新 IN 用完整44 file，不能認證35%改善或推算CI剩餘預算。即使本機0.778秒這部分完全消失，也不能據此保證CI通過。SQL次數及廣掃量未降；因此不再以局部時間下降宣布交付完成，也不針對同一失效 IN 反覆量測。

### 集中決策：下一個有界候選與退路

**A：批准只對 `#saveReleasedProjections` 的原 UPDATE 加局部 `FORCE INDEX(PRIMARY)`，保留已鎖定本批100主鍵 IN、完整原 OR CAS、CASE、batch100及affectedRows一致性。**先對照兩種唯讀計劃及警告，再於5000總目標中驗證一批100的實際讀量；看到 PRIMARY 本身不算成功（現有前4批已用PRIMARY卻仍寬掃）。若range／實讀未收窄即停止，不擴至schema／其他hint／optimizer設定。只有小型證明及獨立覆核通過，才使用現有診斷執行原完整44 file一次，核對整筆交易、原故障及恢復；列明本機與CI環境差異，不宣稱本機等於CI。仍超時／容量失敗即停報。若原案例效果成立，再以來源／輸入／門檻適用性判定必要回歸；同一P0／P1底層套件不因標籤不同重複跑。固定候選後才推送並跑全部必要 CI／coverage及審查，CI不作SQL試驗循環。

選A的理由是已有直接 server 實讀證據支持這一個可去除的廣掃，修改局部、無migration／owner契約擴張；**不是承諾它足以解決整體20秒**。仍需檢查預鎖集合、physical row／trigger次序、FK、版本／數量／權限與CAS等價；不得繞過既有安全檢查。原20秒、5000、coverage、strict故障、完整rollback、same-event replay、守恆、既有真Playwright及最終CI Gate全部保留。

**B（建議）：暫不加hint，先把現有 caller 分類診斷帶到可核實CI條件的同一原失敗情境作一次聚焦量測，補上CI缺少的tail／中止位置。**優點是先確認40k逐筆操作及尾段的CI實際成本，降低只改善本機小段的風險；代價是此輪不修產品，可能仍在20秒中止，之後仍需另一項具體修法批准。沿用現有工具，不建新平台、不跑全量CI、不放寬時限。執行前先核實既有可用入口及source／版本／coverage／資源差異；目前唯一workflow是完整CI，**尚未證實有可用的單案例CI入口**。若找不到可核實入口，只報告這項環境限制，不擅改workflow／新增平台／跑全量CI或用本機結果冒充CI。真正失敗即停報，不自動重試。這是有明確未知項的診斷提案，不能宣稱已是可直接執行或能解除阻塞的產品修法。

針對「解除原CI整筆20秒阻塞」的交付目標，獨立reviewer建議優先B；我採納此建議，避免由本機約0.78秒SQL推導未獲證明的CI效益。報告70的hint提案保留為當時歷史，現行優先順序以此節為準。A仍是具體、有界的產品候選，但不是本輪已批准／已採納方案；B亦不是驗收豁免。不獲實際答覆前維持現有WIP／證據及BLOCKED，不實作hint、不啟動DB／容量／CI／push。這次沒有新增測試或診斷平台，也沒有啟動背景工作；本輪既有DB／帳號／程序均已清理。報告67–70原失敗、批准、run引用及原始檔完整保留。

### 繼續排查後的具體方案 C：只對 Reallocate 新 child operation 批量 claim（提案，未實作）

Sam 最新要求「繼續排查問題提出解決方案」。本次只讀 source／原始結果／既有CI設定，沒有DB、容量、CI重跑或產品修改。以下是更新後的優先建議；上文A／B保留為先前方案及其限制，**現時建議優先C，不以尚未存在的單案例CI入口作必要前置**。唯一交付阻塞及最終Gate不變。

新增可核對事實：`InventoryFulfillmentService.claimFulfillmentBatchInTransaction` 先claim scope，再由 `inventoryFulfillmentReceipts.claimFulfillmentInventoryBatch` claim root、逐筆5000個member、逐筆10000個leg。每個 `InventoryOperationService.claim` 都await一次普通INSERT。因此原CI preclaim的15002 execute對應scope嘗試1＋新root1＋新member5000＋新leg10000；scope已存在時走原duplicate/read/replay。本案例preclaim4.528秒不是純INSERT server時間，還包括hash／驗證／JS和往返，不能承諾批量後省4.5秒。但15000次串行child INSERT是直接由source及實測計數共同支持的可減少工作。

SQL廣掃方面，本輪重讀兩個phase全50個sample的prepared SUM_WARNINGS均為0，range_optimizer_max_mem_size為8388608；沒有證據支持「optimizer記憶體不足」作已證實原因。`idx_ful_allocation_work` 是 `(fulfillment_id,status,id)`，UPDATE亦改status；事後Using temporary與使用被更新索引的分兩階段UPDATE機制相容，但這只是解釋線索，不能單靠8.4官方source推定26.7當次執行路徑或全部廣掃成因。PRIMARY前4批也曾廣掃，因此不把FORCE PRIMARY當已證實修法。參考：[range規則](https://dev.mysql.com/doc/refman/8.4/en/range-optimization.html)、[官方UPDATE實作（8.4，僅機制參考）](https://github.com/mysql/mysql-server/blob/8.4/sql/sql_update.cc)。

**C的最小改動範圍：**Inventory owner內部的 `InventoryOperationService.js`／`inventoryFulfillmentReceipts.js` 及必要測試。只讓 `action==='REALLOCATE'` 的全新child使用有界批次；scope／root、原通用claim、其他action、schema及公開provider契約維持原樣。每批最多100筆，保持原member排序，全部member完成後才依原member／leg次序建立legs。原permission／source／數量／actual RC／scope/root鎖與Inventory posting完全保留。

1. 每筆沿用原輸入驗證與canonical hash；以普通多列INSERT寫入原全部欄位。禁止IGNORE、REPLACE及UPSERT，不能吞duplicate或把既有child變成成功。
2. 僅接受可信metadata證實仍active的RC交易；INSERT affectedRows必須等於本批長度。按完整唯一source tuple（module、document type、document id、line id、event id）回讀本批真實ID、command/hash及全部pending欄位為NULL，核對exact set／unique id／hash，按原輸入順序重建映射。不同document type分批，不只用line id查；使用既有unique index，不新增索引。
3. 不用第一個insertId加offset推算其他ID，不假設連號；每筆receipt／leg parent reference都用回讀映射。保留完整15000筆child資料、原digest構造及後續完成／replay驗證。
4. 只在真正ER_DUP_ENTRY且交易仍active時進入duplicate辨識，依完整source鍵FOR UPDATE讀取並按原輸入順序找first conflict：hash不符維持SOURCE_CONFLICT、未完成維持CONCURRENT_OPERATION、已完成child replay維持原SOURCE_CONFLICT；未知unique collision保留原錯誤。deadlock／timeout／FK或其他錯誤直接傳遞，不歸類成duplicate、不繼續posting。該路徑只能失敗並令整個交易rollback，不能補寫後成功。批量statement的實體鎖取得／保留不等同逐句INSERT，即使class及輸入次序相同，也必須原生驗證collision讀鎖及競爭；不宣稱現已證明等價。

**可驗證的結構目標：**此5000案例的15000 child INSERT→150批INSERT＋150次exact-set回讀；preclaim正常路徑由15002 execute＋5 query預期變為152 execute＋155 query，共少14700次client往返。DB仍插入相同15000筆並維護相同unique／資料完整性，hash／JSON工作也仍存在；這是呼叫數預測，尚未量測，不能當成98%時間改善或CI必過。

**一次收斂驗證順序：**先獨立覆核具體實作及0／1／99／100／101邊界、ID有間隙、錯hash／incomplete／completed duplicate、回讀少／多／錯ID及同scope競爭；小型native確認duplicate錯誤分類和末批失敗全rollback。通過才跑原full5000 Reallocate末批45000／完整facts rollback／同event恢復案例，量測preclaim及整筆交易並核對15000筆紀錄完整；不改20秒／120秒case／5000或coverage。發生真容量／效能失敗立即停報，不自動重試。結構與功能效果成立後才跑必要回歸，固定候選並處理最新main影響，再跑全部必要CI／coverage／真Playwright適用Gate及獨立覆核；同一P0／P1底層套件依source／input／threshold適用性只執行一次。不能僅憑局部快而關閉DEF022／025。

**選擇及代價：**建議C，因原CI已直接量到4.53秒的前置區間，且SQL呼叫削減有source可證，不依賴猜測optimizer或新CI診斷平台。代價是child claim的ID回讀及duplicate錯誤等價比單行hint更需要嚴格驗證；尚未證明能提供足夠整體餘裕。A的FORCE PRIMARY＋IN仍可作局部廣掃候選，但本輪不兩項一起修改；B則保留為若C後仍失敗時依實際證據評估的診斷方向，不能預先授權新workflow。

MySQL官方亦建議多列INSERT減少逐句成本；此一般機制並不是本候選的性能驗收：[26.7 INSERT optimization](https://dev.mysql.com/doc/refman/26.7/en/insert-optimization.html)。C目前只是具體提案，未新增owner方法、未執行native／容量或推送，PR297不合併。實作批准須明確涵蓋這個內部claim寫入策略及上述驗證，原IN批准不自動延伸到C。

## 歷史：P0 implementation entry

Status: **CONDITIONAL / TASK-001 in progress**. P0 has entered implementation discovery; no product Task is DONE. The schema ownership collision below blocks migration allocation and dependent work. This report supplements, rather than replaces, the approved specifications.

## Execution authority

Sam's direct instruction in this chat on 2026-10-20:「確認 PR #256 的 CI 及審查通過後合併，然後按已批准計劃開始 fulfillment P0 開發。」This authorizes the planning PR merge and entry into IMPLEMENT for PHASE-001 / TASK-001–011 under the existing checkpoints. It does not resolve newly discovered ownership or contract conflicts.

| Baseline | Observed value |
| --- | --- |
| Branch / worktree | `codex/fulfillment-p0-foundation` / `/private/tmp/erp-fulfillment-p0` |
| Default / entry commit | `76223f40480d94a1d3a2ae6e0e7b91292bd98b82` |
| Entry tree | `2d705e39fcb30f3ad6ee485a3a4219b646180e0a` |
| Entry source fingerprint | `aa361a2af16fd72193d829b5fa354e9b4cbd396423eac7264261ecfed86db73c` |
| Approved DESIGN | `feef0869d0d3d1814ce5ab9a08e885ef84c49e578bfbf24269ff106b0aa69ce8` |
| Approved PLAN | `a229fd571382e42dbc0e88c896bd06aeed12bf4e5e3b4622a58bc69197aead38` |

The primary checkout was clean and fast-forwarded to the fetched merged main before creating this isolated worktree. Approved requirement/design/plan/TC/UAT bytes remain unchanged. Developer work uses the harness and minimal incremental changes with TDD; independent review is recorded only where a separate reviewer actually ran.

## PR 256 merge evidence and process deviation

PR [256](https://github.com/crazysumsum/erp-app/pull/256) merged at `2026-10-20T09:17:09Z`, merge SHA `76223f40480d94a1d3a2ae6e0e7b91292bd98b82`. Its parents are `cb70aacc18d5c825f2af990079ef5e1f61996e9f` and published head `f02c73633dbd0066593be0c25a3da35e17edf808`.

Before merge, exact-head [CI run 39397867552](https://github.com/crazysumsum/erp-app/actions/runs/39397867552) completed 13/13 jobs SUCCESS, with zero skipped jobs. Reviewer `/root/fulfillment_independent_review` performed R3 (`SEPARATE_AGENT`) on that exact head: APPROVED, no open CRITICAL/HIGH/MEDIUM. There was no submitted GitHub review; no such approval is claimed. Observed branch protection was absent and rules were empty; normal merge used the exact head check, without an admin bypass.

**Process deviation:** final fetch showed main had advanced from `35af2ab7` to `cb70aacc` through Supplier PR 255, but the coordinator trusted the PR API's stale base snapshot and merged without first integrating the moved target into the topic branch. This violated the target-freshness procedure. It cannot be rewritten as a premerge integration review.

R4 was a genuine **postmerge** content impact review by the same separate agent at merge SHA `76223f4`, result APPROVED, 0 open CRITICAL/HIGH/MEDIUM. Compared with the reviewed head, only three Supplier documents and `server/test/integration/supplierMigrationAcceptance.integration.test.js` changed. Product source, migrations, configuration, packages, CI, client and Fulfillment specification/contracts were unchanged. R4 checked the new test's syntax and isolated scratch-DB/process pattern; it did not execute native MySQL tests.

The merge SHA's own [CI run 39399562600](https://github.com/crazysumsum/erp-app/actions/runs/39399562600) is the corrective runtime gate. At initial entry observation it was IN_PROGRESS. A later native GitHub observation confirmed COMPLETED / SUCCESS, 13/13 jobs completed SUCCESS and zero skipped. This discharges the corrective runtime gate on the actual merge SHA; the earlier head's green run was not substituted for it.

## TASK-001 provider inventory

Owners are Sam as ERP Product Owner and the respective provider module maintainers. A source pin or passing unit suite is not provider-owner approval of a new contract.

| Provider / real symbol at entry | Core observation | Fulfillment extension disposition |
| --- | --- | --- |
| Sales: `SalesOrderLifecycleService`, `SalesFulfillmentGuardService.assertAllowed`; order/line/reservation mappings from migrations 0073–0079 | Core PRESENT; fail-closed lifecycle guard PRESENT | **BLOCKED / TASK-004:** `SalesFulfillmentService`, `getOrderForFulfillment`, `lockLinesForFulfillmentInTransaction`, `applyFulfillmentResultInTransaction` absent. Projection, exact sets, decimal-string boundary, Confirm/Reversal and same-transaction rollback still require implementation and owner review. |
| Inventory: `InventoryReservationService.listFulfillmentAllocationCandidatesInTransaction`, `allocateForFulfillmentInTransaction`, `releaseFulfillmentAllocationInTransaction`, `reallocateFulfillmentAllocationInTransaction`; `InventoryPostingService.postFulfillmentIssueInTransaction` | Named single-reservation core PRESENT; permission/source fixed by provider | **BLOCKED / TASK-005:** complete sorted batch contract, exact-set/version/actor proofs and dedicated reversal Reservation restoration remain absent. Existing Number safe-integer inputs do not establish the approved decimal-string wire contract. |
| Customer: `CustomerLookupService` transaction-aware address/contact assertions | Shipping ownership/purpose/version core PRESENT | **BLOCKED / TASK-006:** Fulfillment consumer wiring, common context and same-transaction revalidation proofs still required. |
| Item: `ItemLookupService.getInventoryProfileInTransaction` | Transaction profile core PRESENT; retains serial/tracking/lifecycle facts | **BLOCKED / TASK-006:** Fulfillment sorted batch/submit integration and owner-reviewed decimal-string adapter remain required. Pool-based generic `assertUsable` is not a substitute. |
| Fulfillment lifecycle | No real provider on entry main | **BLOCKED / TASK-011:** minimum real provider, registration and installation probes must accompany the complete P0 artifact; Sales P4 now has overlapping unmerged work below. |

Entry developer check: `node --test --import ./server/test-support/testEnv.js --test-reporter=spec server/test/inventoryProviderContracts.test.js server/test/customerLookupService.test.js server/test/itemLookupService.test.js` — **76 PASS, 0 FAIL, 0 SKIP** on `76223f4`. This is existing-core unit evidence, not Checkpoint 0B or formal TC/UAT acceptance. `npm ci --offline --ignore-scripts` installed the unchanged lockfile successfully; no dependency change was made. Entry `npm run lint` also passed.

## Migration inventory and ownership conflict — HD-008

Entry main contains 85 migration files (84 JavaScript, one SQL), unique numeric prefixes, highest `0087_fix_supplier_sku_refs_sku_foreign_key.js`. No historical migration was edited or executed here. `0088` is next on main but is **not free for independent allocation**: the active Sales P4 branch already contains 0088–0093.

Observed Sales P4 branch `codex/sales-order-phase-4-archive` at `d01162f6159ec40981453d00936fb713296f35a3` in `/Users/sam/.codex/worktrees/sales-p4-archive/erp-app`:

- 0088–0090: Sales Archive batches/tables/Export jobs.
- 0091 `create_fulfillment_archive_prerequisites`, 0092 `create_fulfillment_archive_mirrors`, 0093 `protect_fulfillment_archive_contracts`.
- Committed `server/src/modules/fulfillment/fulfillmentArchiveDatabaseSchema.js` and `fulfillmentArchiveSchema.js`; additional dirty/untracked lifecycle-provider and archive-service work exists. This worktree belongs to another active stream and was inspected read-only.
- Its line constraint currently requires `allocated_base_quantity <= planned_base_quantity`. The approved P0 design §3.3 requires cumulative historical allocation/release accounting under reallocation, so these semantics need explicit reconciliation before reuse. Presence of schema/history also activates Sales' requirement for a real lifecycle provider.

**TASK-001 migration allocation is BLOCKED.** No 0094+ reservation or distributed lock is claimed. The eight logical slices in design §9.3 must be allocated once from fresh main after ownership/merge order is settled. Do not copy, delete or overwrite the other worktree's work or run its schema here to sidestep the conflict.

## Coordinated scope — A adopted

**Adopted A:** keep this approved Fulfillment P0 plan authoritative for Fulfillment active quantities/schema and lifecycle behavior. Coordinate with the existing Sales P4 stream before further overlapping schema/provider writes, retain valid Archive work, and reconcile it to the approved design. Authorize the coordinator to send the concrete conflict and ownership direction to that existing chat. Allocate migrations from fresh main after agreement; preserve Checkpoint 0B, one complete P0 PR and every existing test/review gate. This avoids two implementations but may require Sales P4 rework and waiting at its Archive dependency.

**Rejected alternative B:** wait for Sales P4 to finish and merge, then requalify Fulfillment P0 against its actual schema/provider contracts. This avoids concurrent ownership but delays P0 and may require new design/plan approval if the merged semantics differ.

Sam explicitly selected A in this chat on 2026-10-20 after the above concrete conflict/options were presented. The coordination message was sent to existing `sales_order_management` chat `01a0f0e2-2647-7dc2-a1d4-a7cefa29d0f6`; Sales P4 has acknowledged pausing overlapping schema/provider writes; its concrete handoff/allocation response remains to be observed. This resolves the human ownership direction, not the actual migration allocation or contract proof.

The approved concrete implementation path scope is the existing Fulfillment-owned paths plus the P0-required shared paths: `server/src/modules/authorization/permissionCatalogue.js`, new numbered files in `server/database/migrations/` after allocation, `server/src/framework/configuration/applicationConfiguration.js` for actual startup validation, `server/test/permissionCatalogueConventions.test.js` for new seed discovery, `server/test/configuration.test.js` to retain its exact section-list assertion while adding the new section, and `client/src/framework/http/errorMessages.js`. Provider additions/edits are confined to the Sales, Inventory, Customer and Item paths already identified in the approved manifest and TASK-004–006; their exact wire contract still requires owner review before implementation. No other module or quality threshold is implicitly changed. Application-configuration wiring and these two shared integration/convention tests are necessary TASK-002 integration paths missing from the current manifest; record any scope/plan amendment and renewed decision before changing them.

After TASK-001 allocation is resolved, split TASK-002 before writing code: 2A bounded configuration + startup guard; 2B allowlists/errors + public mapping; 2C permission catalogue + idempotent seed/conventions. TASK-003 follows only after TASK-002's full criteria pass. These are execution slices within existing IDs, not additional Phase/Task IDs or relaxed DoD.

## Runtime and next gate

Only FILES checks and synthetic unit data have run. This worktree's dependencies are local and ignored. No database, port, external transaction or persistent service is allocated. Native schema execution requires a separately authorized, owned disposable MySQL 26.7.0 runtime; live Sales quiesce/install/register/probe/resume remains a separate explicit gate. The current report does not claim either authority or runtime evidence.

Next safe action: Merged-SHA CI is now confirmed green; observe the existing schema stream's coordination response, then finish TASK-001 migration allocation and implement the approved TASK-002 slices. TASK-007–010 remain blocked by Checkpoint 0B. All 45 Tasks remain not DONE; Technical Acceptance, business UAT and release approval remain unexecuted.

## Scoped entry amendment and R5

Independent reviewer `/root/fulfillment_independent_review` R5 found two MEDIUM issues: the concrete scope omitted `server/test/configuration.test.js`, whose exact configuration-section assertion must gain `fulfillment`; runtime workspace metadata still pointed at the removed document worktree. Both are corrected in the entry amendment/checkpoint. The test correction preserves the exact assertion and only adds the new expected section and relevant integration checks. Shared paths are placed behind SCOPE approval, not granted unconditional write access. Runtime metadata reflects this actual worktree while DB/web resources remain unallocated.

The direct human A above authorizes the specified necessary P0 wiring and ownership coordination. Derived hash bindings below record that actual decision against the mechanical scope amendment; they do not claim Sam inspected hash strings. Requirements, business design, all 45 Task definitions, checkpoints and TC/UAT specifications remain byte-identical. The existing NFR-023 reason and mandatory/blocking TC-010 remain unchanged. Historical approval hashes are preserved; current SCOPE/DESIGN/PLAN/UAT_NA bindings require successful revalidation and independent amendment review before product writes.

Amended mechanical DESIGN: `8618ff250af0b61d64f5beac528e529bb2224964f8986a02f4c4d8f6043c66ff`; PLAN: `8c9bfbd7760e46c7ea831511d2d1f7edefa8699506b17d60190bb84cb3195727`. Current derived decisions APR-009 (DESIGN), APR-010 (PLAN), APR-011 (SCOPE), APR-012 (unchanged NFR-023 UAT_NA). The original APR-006/007/008 remain historical. Approval-aware structural/path checks do not substitute for genuine independent amendment review, owner handoff or execution evidence.

R6 final independent amendment disposition: **APPROVED**, reviewer `/root/fulfillment_independent_review`, method `SEPARATE_AGENT`, actual current DESIGN/PLAN above, 0 open CRITICAL/HIGH/MEDIUM; R5-001/002 resolved. Product source fingerprint remains the entry value. This is a scope/document review, not a completed TASK-001 or runtime/provider acceptance.
