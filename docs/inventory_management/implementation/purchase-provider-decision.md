# 集中決策：Inventory purchase provider v1

Status: DECISION_REQUIRED。只完成候選準備，沒有記錄Sam批准／產品PASS／實際解鎖。

## 精確候選

- 基線 main：`e272f5d3ce05d0ca50be42e6d8764f0ef20d3dd1`
- DESIGN：`7f09c816390b1d129bdb905566121b2000d04efca9c72e030f7772b1f1e10ded`
- PLAN：`ceb152c51c6a9cc4528d6ac8ef707902cdca7bd9c99989bf6679452f213283d9`
- [十一檔完整patch](purchase-provider-candidate.patch)，SHA256 `820be2a2fb3c641d7994176abdbc7dca5e8b3aac25bddc54d06b58c59ae41148`
- [正式ABI／資料與安全契約](purchase-provider-contract-v1.md)
- [驗證／兩PR計劃](purchase-provider-plan-v1.md)
- [實際受限評審及最終機械SELF_REVIEW](purchase-provider-candidate-review.md)

十一檔是兩份addenda、Inventory manifest/profile/design/plan/technical/typed trace/generated matrix，以及Purchasing manifest/design。state、產品、DDL、既有測試均未改。canonical diff現在是未採用的候選，不代表舊批准自動覆蓋它。

## 一次審閱的重大差異

1. **可信的批次收貨ABI**：root及所有detail先claim，才進全域庫存鎖；不逐行呼叫舊posting。新增request／transaction／完整意圖綁定的opaque context；Purchasing從鎖定的PO/GR資料提供proof，不接受browser或caller自報permission。保留原receipt最低權限及反向的password/device認證。
2. **部分反向的資料ownership**：新append-only reversal links及migration，保留原generic reversal unique。只對新v1 purchase receipt做多次部分反向，舊generic資料不遷移；累計上限在原Movement鎖內核對。Purchasing§4.13舊「移除unique」文字及兩處反向鎖序衝突在本patch同步修正。
3. **可靠的原事件查詢**：補齊findOperationsBySource ABI，核對持久tuple membership及完整逐行回執。NOT_FOUND只代表本次快照未見提交，不能用新event重送；可見但不完整的root拒絕，不假稱IN_PROGRESS。
4. **獨立交付Gate**：PHASE007/TASK052為PR-A；A合併後從最新main開始PHASE008/TASK053 PR-B。真MySQL、認證、原子性／rollback／鎖序／冪等／並發超額、既有Receipt／Reservation／generic反向、coverage／Playwright／當前CI／review全部保留。P4未合併能力的真聯合驗證另追蹤，不以fake補PASS，不依賴P4容量／soak。新套件現在全NOT_RUN。

## 選項、取捨與預設

**A（建議）**：批准以上精確DESIGN／PLAN、兩個Purchasing文件的對齊範圍、新provider／test／migration範圍與獨立Gate，並接受最後僅格式／plan pin的ROOT SELF_REVIEW。之後直接TDD及最小真DB，再200行與完整必要Gate；依既有實際審查／當前CI／最新main整合及合併授權交付兩PR，不再逐項詢問工具小修方向。

好處是正式解開Purchasing與P4的交付依賴，同時保留generic行為。代價是consumer必須接入context issuer與新的結果／link協定；新purchase來源不能改走generic full reversal，尚未實作的Purchasing consumer仍需其owner完成真接入測試。

**B**：指出上述契約需要修改的部分，保持未採用；provider實作不啟動，TASK041可獨立做不受影響的工具工作。

沒有新約束時建議A，但未收到Sam實際批准前預設不採用。依Harness「Major impact means ask a human before choosing」，這是集中處理新安全／ABI／資料及敏感跨模組文件的必要決策，不是再次問本機資源、推送／合併或跨模型許可。

## TASK041分流及現況

P4 worktree的 `implementation/task041-closeout.md` 已列驗證目標、原來源證據、缺口、影響式重驗及完成條件。最後固定來源測試已結束於fixture失連且cases=[]；本次僅完成精確離線恢復清理，未把它稱作正常app rollback／SQL terminal。

HD209三輪100k Post成功證據保留，並非「100k從未成功」；也不冒充最新候選或P4通過。工具先確定性與最小真DB，最終固定候選仍完成必要完整Gate。沒有重啟大型fixture，也沒有變更原資料量／期限／門檻。

目前Purchasing **尚未實際解鎖**：無provider實作／PR／merge SHA，consumer也未完成真接入驗證。下一個可交付目標是PR-A，不等待TASK041。
