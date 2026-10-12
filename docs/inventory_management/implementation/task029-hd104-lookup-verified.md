# TASK-029 — HD104 approved / lookup developer verification

Historical lookup-only checkpoint: subsequent Transfer UI/test changes invalidate the following source-bound results for the current candidate. See [current UI increment / HD105 decision](task029-ui-bin-query-decision.md); retain all original results unchanged, not current-source PASS.

Sam實際答覆「A」已記錄HD104 ANSWERED／APR133 SCOPE，將原樣0064批准綁到現PLAN；APR122及舊失敗紀錄保留。[Whole-branch boundary](task029-hd104-boundary.json)及[PLAN_READY](task029-hd104-plan-ready.json)均LOCAL_CHECKS_PASS／0 issues。沒有修改DDL或放寬gate。

## Observed baseline

- Head：`869ac07abdd3879254c351d857be911d71e68b6b`；本機未commit。
- Source：`73bc7d29ee15d2d9261dc56da6f0e88733e72d291da6efb0c707ffa605a78eca`。
- DESIGN：`de32a25f52faeddc65234963935f44a4e73a6a505f44f52dca2283f5e6913f93`；PLAN：`41949846cafde277c6887a7b572e0b3f945425d9a16f1b96517d99ca1674617c`。
- `0064_create_inventory_transfers.js` SHA256仍`07653bb700a40b026e8bb46b538e0e31b112d6c20010af45b4cc71a6ff7ac143`，byte-identical；舊main4f09基線不變，沒有採納後續main。

## Actual current-source DEVELOPER results

| Configured suite | Result / evidence |
| --- | --- |
| inventory-p3-api | [13 PASS／0 FAIL／0 SKIP／0 NOT_RUN](../evidence/task029-inventory-p3-api-1b696916d9/run.json)；8原Transfer＋5 lookup真HTTP／MySQL案例 |
| inventory-p3-unit | [27 PASS／0 FAIL／0 SKIP／0 NOT_RUN](../evidence/task029-inventory-p3-unit-f0300f4763/run.json) |
| inventory-developer | [159 PASS／0 FAIL／0 SKIP／0 NOT_RUN](../evidence/task029-hd104-nondb-95699e96cd/inventory-developer/run.json) |
| inventory-p3-server-coverage | [2134 PASS／0 FAIL／0 SKIP／0 NOT_RUN](../evidence/task029-hd104-nondb-95699e96cd/inventory-p3-server-coverage/run.json)；原root unit命令，並非全DB整合suite |
| inventory-p3-coverage-floors | [原34高風險file floors通過](../evidence/task029-hd104-nondb-95699e96cd/inventory-p3-coverage-floors/run.json)；LCOV與本次root report一致 |
| lint | [exit0](../evidence/task029-hd104-nondb-95699e96cd/lint/run.json) |
| client-build | [exit0](../evidence/task029-hd104-nondb-95699e96cd/client-build/run.json)；不是新UI驗證 |

所有命令／discovery／zero-skip／parser／原threshold不變；native reports綁當前source及新PLAN，不把舊證據改標PASS。Lookup驗證Inventory-only／Item-only access、框架JWT撤銷、literal `%_`／collation／Unicode邊界、strict whitelist、無Balance SKU可建Draft但Dispatch不足庫存、Item資格／Base UOM、寫入重驗及兩連線一致snapshot。業務表失敗時保持無副作用；production limiter未關閉。

## Retained failures and bounded correction

[第一輪13／11 PASS／2 FAIL](../evidence/task029-inventory-p3-api-69a0aa8008/run.json)：lookup測試直接SQL刪除role permission卻預期一般GET會走write-side fresh guard；另一項排序keys比較未排序expected。既有RoleAdminService明定permission變更等JWT更新，一般read route依claims及token-version撤銷。依已批准§5.6.1「沿用框架當下JWT／撤權」修正合成測試：權限移除後呼叫既有tokenRevocation.revoke，舊JWT應401；新版本、無view claims的JWT應403；finally恢復view並簽發新token。未加fresh guard、修改框架或放寬權限。

[第二輪13／12 PASS／1 FAIL](../evidence/task029-inventory-p3-api-0a503fb7c9/run.json)：401已正確拒絕，但test錯把內部`JWT_INVALID`當公開code。既有AuthenticationError公開code固定`Unauthorized Access`；改為精確驗證此公開值，保留401及無副作用斷言。第三輪13全部通過。沒有將失敗覆蓋、刪除或宣稱產品認證修復。

三次API attempts及一次unit runtime各用獨立owned socket-only MySQL26.7.0／一次性schema；實際API migration ledger為現有70項，schema-only合成app user無global grant。每次只清理本次schema／app user／daemon／socket／owned root／lease／caffeinate，實際absence／exit0均確認；合成資料無法恢復，原生證據保留。非DB controller精確清理本次cache／temp／合成key／guard，既有owned dependencies及未合併worktree保留。

## Remaining scope

TASK029仍IN_PROGRESS／IMPLEMENTING。下一增量是已批准Transfer client、Draft SKU selector、list/detail／整張Dispatch／Receive、component tests及真API Playwright（console／network／keyboard／refresh／error）；本次未實作或驗證UI，不聲稱Task／P3完成。新產品source仍需实际Sam獨立review，不由舊DESIGN批准推定。

正式TC006／UAT060仍NOT_RUN；容量4項仍NOT_EXECUTED且適用full-P3／release門檻不變。沒有staging／commit／push／PR／remote CI／merge、later Tasks或release；未來publication需fresh main整合及current-candidate門檻。
