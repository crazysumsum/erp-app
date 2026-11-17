# Accounts Payable Management 需求規格

Module and source authority: `00_module_manifest.json`. IDs and UAT applicability:
`08_traceability.json`. The generated matrix shows current links.

## Context, business outcome, scope and actors

### 文件資訊

| 項目 | 內容 |
| --- | --- |
| 模組 | Accounts Payable Management（`accounts-payable-management`） |
| 版本／狀態 | 0.1 Draft；假設已獲Sam確認，待非作者評審，尚未可進入系統設計 |
| 日期 | 2026-11-17 |
| 基線 | `origin/main` `6a34b8c2`；分支`claude/accounts-payable-design` |
| 模式 | `DESIGN_AND_PLAN`；只產出文件，不寫程式 |
| 規模 | 約20名使用者、每日最多1,000張訂單（Sam）；AP自身單量未提供，見OI-001 |

### 來源

- Sam於2026-11-17的指示及決定（見文末「Human decisions」）。
- `docs/purchasing_receiving_management/01_requirement_spec.md`：§2排除範圍（稅、AP、付款、外幣結算、會計分錄、成本）及§12.6（AP日後可使用PO／GR的Supplier、Currency、Payment Term、Price、Quantity及Source Snapshot作Invoice matching）。
- `docs/supplier_management/01_requirement_spec.md` §12.5：應付使用交易當時的付款條件；付款只可使用獲授權的有效銀行帳戶；Supplier Management不發起付款。
- `docs/invoicing_accounts_receivable_management/requirement.md`：應收一側的對應做法。該模組的設計評審仍有未關閉項目，本文只引用其業務規則，不把其設計視為已核准。

### 業務目標

1. 讓每一筆對供應商的債務都有正式、可追溯的Supplier Invoice，並能追溯到收貨及PO。
2. 防止重複入帳、對未收貨的數量入帳，以及價格偏離PO而無人知悉。
3. 記錄已付款項並準確核銷，隨時知道欠每個供應商多少、何時到期。
4. 以最少的流程支援中小企日常：部分付款、一次付多張、預付款、供應商貸項。

### 本期範圍

- AP設定、文件編號及AP關帳日。
- 待開票收貨清單；由已確認收貨行建立Supplier Invoice，可跨多張收貨及PO。
- 沒有PO的Supplier Invoice（運費、租金、服務費等）。
- 價格偏離PO時的受控覆寫。
- Supplier Invoice正式確認及作廢。
- Supplier Credit Note（按原發票行沖減）及Supplier Credit Balance。
- 付款記錄、核銷、預付款、解除及重新核銷、付款沖銷。
- 供應商帳戶、未付、逾期、Aging、到期應付清單及Supplier Statement。
- 期初未付發票、預付款及貸項餘額匯入。
- 列印頁、CSV匯出及Audit。

### 不在本期範圍

- 稅碼、稅額及稅務申報；匯率換算、外幣結算及匯兌差額；總帳及會計分錄。（Purchasing §2、AR需求）
- 存貨成本、估值、Landed Cost及運費分攤。（Purchasing §2）
- 付款審批流程、銀行付款檔、銀行對賬及由系統發起銀行交易。（決定D4）
- Supplier Return、退貨出庫及向供應商索賠的實物流程。貸項只影響應付。（決定D5）
- 自動Email、電子發票交換、OCR辨識發票。
- 多公司。
- AP自身的Active／Archive分層及背景Job佇列。（假設A-008）

### 角色及權限（建議名稱，系統設計時定案）

| 角色 | 可做的事 | 權限 |
| --- | --- | --- |
| 應付查閱者 | 查看發票、貸項、付款、供應商帳戶、Aging、Statement及一般Audit | `ap.view` |
| 發票入帳人員 | 建立、修改、取消Draft；確認及作廢Supplier Invoice | `ap.view`＋`ap.invoice.mgmt` |
| 發票改價人員 | 令發票單價偏離PO單價並填寫原因 | 上列＋`ap.invoice.price.override` |
| 貸項管理員 | 建立、確認、作廢Supplier Credit Note；應用Credit Balance | `ap.view`＋`ap.credit.mgmt` |
| 付款管理員 | 建立及確認付款、核銷、重新核銷及沖銷 | `ap.view`＋`ap.payment.mgmt` |
| 應付設定管理員 | 維護文件前綴及AP關帳日 | `ap.view`＋`ap.settings` |
| 期初資料匯入員 | 下載模板、上傳、預檢及確認期初批次 | `ap.view`＋`ap.opening.import` |
| 應付匯出人員 | 匯出自己有權查看的資料 | `ap.view`＋`ap.export` |

權限互不自動繼承。入帳與付款由不同權限控制，取代付款審批流程（決定D4）。

### 核心概念

| 名詞 | 定義 |
| --- | --- |
| Supplier Invoice | 對供應商的一筆債務文件。行分兩類：收貨行（來自已確認收貨）及費用行（沒有收貨來源）。 |
| 供應商發票號 | 供應商在其發票上的號碼，由使用者輸入。 |
| 內部文件號 | 系統在正式確認時產生的年度流水號。 |
| 可開票數量 | 一行收貨的已確認淨收貨數量，減去已被有效Supplier Invoice佔用的數量。 |
| Supplier Credit Note | 供應商就原發票給予的沖減，只影響應付。 |
| Supplier Credit Balance | 貸項超出原發票未付額的部分，可應用到同Supplier、同Currency的其他發票。 |
| Payment | 已向供應商支付的款項記錄。 |
| 預付款 | 已確認付款中尚未核銷到發票的餘額。 |
| Effect Date | 文件或核銷影響應付餘額的業務日期，用於關帳及As-of查詢。 |
| AP關帳日 | 該日及以前不再接受新的Effect。 |

### 核心規則

1. 一行收貨的累計有效開票數量不得超過其已確認淨收貨數量。
2. 同一供應商下，有效發票的供應商發票號不得重複。
3. 正式文件不可修改或刪除；以作廢、貸項或沖銷更正，原記錄及號碼保留。
4. 核銷只在同一Supplier、同一Currency內進行；不同幣別不相加。
5. 任何發票的未付額不得為負；任何付款或貸項的可用額不得為負。
6. 建立、確認、作廢、核銷及沖銷在重送、雙擊或結果不明時只產生一個結果。
7. 讀取、列印及匯出沒有業務副作用。
8. AP不改寫PO、收貨、庫存或Supplier主檔。

## FR-001 — AP設定

### Statement
具`ap.settings`的使用者可查看及修改AP設定：Supplier Invoice、Supplier Credit Note及Payment各自的文件前綴，以及AP關帳日。AP設定獨立於AR（決定D6）。其他使用者只取得交易所需的唯讀內容。

### Acceptance criteria
有權者修改前綴後，其後新確認的文件使用新前綴，舊文件號碼不變。無`ap.settings`者不能修改，也看不到修改入口。每次修改有Audit。

### Failure behavior
並發修改時後者須以最新版本重做，不得無聲覆蓋。前綴格式不合法時拒絕並指出欄位。

## FR-002 — 文件編號

### Statement
Supplier Invoice、Supplier Credit Note及Payment在正式確認時各自取得`前綴＋年度＋流水號`的內部文件號。號碼每年重置，全公司唯一，作廢或沖銷後不重用。Draft沒有正式號碼。

### Acceptance criteria
跨年度依次確認三類文件，各自按年排序且完整號碼唯一。作廢的發票及沖銷的付款保留原號碼。

### Failure behavior
確認失敗不消耗號碼。並發確認不得產生重複號碼。

## FR-003 — AP關帳日

### Statement
AP關帳日只可向前推進。Effect Date在關帳日或以前的確認、作廢、貸項、核銷、解除及沖銷一律拒絕。推進關帳日前，系統列出目標日期或以前仍未完成的Draft及未完成的期初匯入。

### Acceptance criteria
關帳日為某日時，Effect Date為該日的發票確認被拒絕，翌日的可以成功。關帳日不能改為較早日期。有阻擋事項時推進被拒絕並列出原因。

### Failure behavior
關帳日變更與進行中的財務命令並發時，結果必須一致：命令要麼在舊關帳日下完成，要麼被新關帳日拒絕，不得出現已關帳期間內的新Effect。

## FR-004 — 待開票收貨清單

### Statement
具`ap.invoice.mgmt`的使用者可查看可開票數量大於零的已確認收貨行，按Supplier、PO、收貨單、收貨日期及SKU篩選。每行顯示Supplier、Currency、PO、收貨單、SKU、已收數量、已開票數量、可開票數量及PO單價。

### Acceptance criteria
已確認且未被全數開票的收貨行出現在清單。Draft狀態的收貨、已全數沖銷的收貨及已全數開票的收貨行不出現。

### Failure behavior
上游收貨資料無法取得時顯示服務暫不可用，不顯示空清單冒充沒有待開票項目。

## FR-005 — 可開票數量

### Statement
一行收貨的可開票數量等於已確認淨收貨數量（已扣除收貨沖銷）減去已被有效Supplier Invoice（Draft或已確認）佔用的數量。允許一行收貨分多張發票開票。

### Acceptance criteria
收貨100、已有一張發票佔用60時，可開票數量為40；該發票取消或作廢後回到100。收貨部分沖銷後可開票數量相應減少。

### Failure behavior
任何情況下可開票數量不得為負。計算所依賴的收貨或沖銷狀態不可判定時，拒絕建立或確認，不以舊值代替。

## FR-006 — 由收貨行建立Draft

### Statement
使用者選取同一Supplier、同一Currency的一行或多行收貨（可來自不同收貨單及PO），輸入每行開票數量，建立Supplier Invoice Draft。建立即佔用所選數量。

### Acceptance criteria
跨兩張收貨單、兩張PO的同供應商同幣別收貨行可合成一張Draft，並保留每行對收貨行及PO行的來源。開票數量小於可開票數量時，餘額仍留在待開票清單。

### Failure behavior
所選行不屬同一Supplier或Currency時拒絕。任一行數量超過可開票數量時整個建立失敗，不留下部分Draft或佔用。

## FR-007 — 佔用防重

### Statement
兩名使用者同時對同一收貨行建立發票，或同一請求重送時，成功佔用的數量合計不得超過可開票數量。

### Acceptance criteria
可開票數量40時，兩個各要40的並發建立只有一個成功。同一建立請求重送返回原Draft，不建立第二張。

### Failure behavior
失敗的一方得到清楚原因（數量已被其他發票佔用），清單重新載入後反映最新數量。

## FR-008 — 供應商發票號及日期

### Statement
Draft須有供應商發票號、發票日期及Effect Date。同一Supplier下，供應商發票號（去除首尾空白、不分大小寫）不得與另一張未取消、未作廢的發票重複。

### Acceptance criteria
同一供應商輸入已存在的發票號時被拒絕，並顯示已存在的那張發票。不同供應商可使用相同號碼。已作廢發票的號碼可再次使用。

### Failure behavior
兩人並發輸入相同號碼時只有一張成功。發票日期在未來時拒絕。

## FR-009 — 單價及金額

### Statement
收貨行的單價預設為PO行單價，行金額按開票數量及PO行的採購單位換算。金額以精確小數計算。發票總額為各行金額之和，由系統計算。

### Acceptance criteria
以PO單價開票時，一行收貨全數開票後，各張發票對應行的金額合計等於該收貨行已收數量按PO單價計算的金額；分多張開票時，尾差落在令該行全數開票的那一張。金額按實際收貨數量計算：收貨少於或多於PO訂購數量（含超收）時，不以PO行金額為準。

### Failure behavior
PO價格或換算資料無法取得時拒絕，不猜測單價。

## FR-010 — 價格覆寫

### Statement
發票單價與PO單價不同時，使用者須具`ap.invoice.price.override`並填寫原因（決定D2）。系統保存PO原價、發票價及差額。差額不回寫PO。

### Acceptance criteria
有權者改價並填原因後可保存，發票詳情及Audit顯示原價、新價、差額及原因。無權者改價被拒絕，單價保持PO價。

### Failure behavior
原因空白時拒絕。單價為零時須額外確認。單價為負時拒絕。

## FR-011 — 到期日

### Statement
到期日預設由發票日期及PO的付款條件快照計算；使用者可改為不早於發票日期的其他日期。跨多張PO而付款條件不同時，使用者必須明確選定到期日。沒有付款條件時必須輸入到期日。

### Acceptance criteria
PO付款條件為30日、發票日期為某日時，預設到期日為其後30日。到期日空白的Draft不能確認。

### Failure behavior
到期日早於發票日期時拒絕。系統不把空白到期日當作即期。

## FR-012 — 費用行

### Statement
由收貨行建立的發票可加入費用行（描述、金額），記錄同一張供應商發票上的運費或其他收費。費用行沒有收貨來源，不佔用收貨數量。

### Acceptance criteria
一張發票同時有收貨行及費用行時，總額為兩者之和；來源追溯只列收貨行。

### Failure behavior
費用行描述空白或金額不為正數時拒絕。

## FR-013 — 發票總額核對

### Statement
使用者輸入供應商發票上的總額。確認時系統計算的總額必須與輸入的總額完全相等（假設A-005）。

### Acceptance criteria
輸入總額與行合計相同時可確認；相差任何金額時不能確認，畫面顯示兩個數字及差額。

### Failure behavior
未輸入總額時不能確認。

## FR-014 — Draft修改及取消

### Statement
Draft可修改供應商發票號、日期、到期日、行數量、單價（按FR-010）、費用行及備註。取消Draft釋放其佔用的全部數量，不取得正式號碼。

### Acceptance criteria
減少一行數量後，釋出的數量即時回到待開票清單。取消後該Draft不可再確認，其數量可被其他發票使用。

### Failure behavior
兩人同時修改同一Draft時，後者須重新載入後重做。增加數量超過可開票數量時拒絕且原Draft不變。

## FR-015 — 無PO發票

### Statement
使用者可為Active Supplier建立沒有PO的Supplier Invoice（決定D3）：選Supplier及Currency，輸入供應商發票號、日期、到期日、原因及一行或多行費用行。此類發票只有費用行。

### Acceptance criteria
無PO發票確認後形成應付，出現在供應商帳戶及Aging，並標示為無PO。它不出現在任何PO或收貨的來源追溯。

### Failure behavior
原因空白時拒絕。Supplier狀態不是Active時（Supplier模組現有的Draft、Pending Approval、Suspended、Blocked等）不可新建無PO發票；該供應商既有的應付仍可處理。

## FR-016 — 正式確認

### Statement
具`ap.invoice.mgmt`的使用者確認Draft。確認時系統重新驗證：權限、Draft版本、AP關帳日、Supplier、供應商發票號唯一、每行收貨的狀態及可開票數量、單價及覆寫權限、到期日及總額核對。全部通過後，原子地形成已確認發票、內部文件號、應付餘額、來源記錄、狀態歷史及Audit。

### Acceptance criteria
確認後發票狀態為已確認，未付額等於總額，供應商帳戶即時反映。任何一項驗證失敗時發票仍是Draft，沒有號碼、沒有應付。

### Failure behavior
技術失敗不得留下「已確認但沒有應付」或「有應付但仍是Draft」的部分結果。

## FR-017 — 確認的重送安全

### Statement
確認請求重送、雙擊、逾時或結果不明時，系統以原請求識別查回唯一結果，不重複確認、不重複取號。

### Acceptance criteria
同一確認請求送兩次，只有一張已確認發票及一個號碼；第二次返回原結果。

### Failure behavior
以同一請求識別送出不同內容時拒絕。返回原結果前仍須驗證請求者當時有權查看該結果。

## FR-018 — 已確認發票不可修改

### Statement
已確認發票的Supplier、Currency、供應商發票號、日期、行、數量、單價、金額及來源不可修改。內部跟進備註可修改並有Audit，不改變正式內容。

### Acceptance criteria
任何修改正式欄位的嘗試被拒絕。修改跟進備註後正式內容及其歷史不變。

### Failure behavior
N/A：拒絕即為預期行為；繞過應用程式的修改由SEC-006防護。

## FR-019 — 發票作廢

### Statement
已確認發票在沒有任何有效貸項或付款核銷、且Effect Date在開放期間時，可由具`ap.invoice.mgmt`者整張作廢，須填寫原因並重新認證。作廢原子地撤銷其應付效果並釋放所佔用的收貨數量，保留號碼、內容及歷史。

### Acceptance criteria
作廢後未付額為零，發票標示為作廢，其收貨行回到待開票清單，供應商發票號可再次使用。

### Failure behavior
有有效貸項或核銷時拒絕，並列出須先解除的項目。作廢重送只產生一次效果。

## FR-020 — 收貨沖銷與開票互斥

### Statement
已被有效Supplier Invoice（Draft或已確認）佔用的收貨數量，不可被Purchasing沖銷；須先取消Draft或作廢發票。AP向Purchasing提供每行收貨的佔用狀態：可沖銷、被阻擋或不可判定。

### Acceptance criteria
收貨行被發票佔用時，沖銷被阻擋並指出相關發票。發票取消或作廢後可以沖銷。

### Failure behavior
佔用狀態不可判定時視為阻擋。開票與沖銷並發時只可一方成功，不得出現已沖銷的數量仍被發票佔用。

## FR-021 — 建立Supplier Credit Note

### Statement
具`ap.credit.mgmt`的使用者從一張已確認發票選取原發票行，輸入沖減數量或金額、原因、貸項日期及Effect Date，並可輸入供應商的貸項單號，建立Supplier Credit Note Draft（決定D5）。一張貸項只屬於一張發票。

### Acceptance criteria
貸項只能選該發票自己的行，Supplier及Currency由原發票帶入，不可另選。

### Failure behavior
原發票為Draft或已作廢時拒絕。原因空白時拒絕。

## FR-022 — 貸項上限

### Statement
同一發票行的累計有效貸項金額不得超過該行金額；同一發票的累計有效貸項不得超過發票總額。

### Acceptance criteria
行金額100、已有貸項70時，再建立40的貸項在確認時被拒絕，30的可以成功。

### Failure behavior
兩張貸項並發確認時合計不得突破上限。

## FR-023 — 貸項確認及效果

### Statement
確認貸項時取得內部文件號。貸項金額先沖減原發票的未付額；超出未付額的部分形成Supplier Credit Balance，屬於同一Supplier及Currency。貸項不影響庫存、收貨或PO，也不釋放收貨的可開票數量。

### Acceptance criteria
發票未付額30、貸項50確認後，發票未付額為0，Credit Balance為20。確認具備與發票確認相同的重送安全。

### Failure behavior
任何部分失敗時全部不生效。

## FR-024 — Credit Balance應用及解除

### Statement
具`ap.credit.mgmt`的使用者可把Credit Balance應用到同一Supplier、同一Currency的其他已確認發票，並可在開放期間解除及重新應用。所有變動保留歷史。

### Acceptance criteria
應用金額不超過Credit Balance可用額及目標發票未付額。解除後兩邊餘額恢復，原應用記錄保留並標示已解除。

### Failure behavior
跨Supplier或跨Currency的應用被拒絕。並發應用不得造成負數。

## FR-025 — 貸項作廢

### Statement
已確認貸項在其Credit Balance的所有應用均已解除、且在開放期間時，可由具`ap.credit.mgmt`者作廢，須填寫原因並重新認證。作廢恢復原發票的未付額。

### Acceptance criteria
作廢後原發票未付額恢復為貸項前的數額，貸項號碼及內容保留。

### Failure behavior
仍有有效應用時拒絕並列出項目。若恢復未付額會令已核銷金額超過發票總額則拒絕。

## FR-026 — 建立付款

### Statement
具`ap.payment.mgmt`的使用者建立付款Draft：Supplier、Currency、付款日期、Effect Date、金額及付款方式（銀行轉帳、支票、現金、其他）。銀行轉帳須輸入交易參考；支票須輸入支票號；其他須輸入說明。

### Acceptance criteria
各付款方式缺少其必要欄位時不能確認。付款可在該供應商沒有任何發票時建立。

### Failure behavior
金額不為正數或付款日期在未來時拒絕。

## FR-027 — 供應商收款帳戶

### Statement
付款可選用該Supplier的一個有效銀行帳戶作為收款帳戶記錄。只有同時具備Supplier銀行資料查看權限的使用者才可選用。付款保存當時的遮蔽快照；Supplier日後修改或停用帳戶不改變已確認付款。

### Acceptance criteria
已停用的帳戶不能用於新付款。沒有銀行帳戶的供應商仍可記錄付款，畫面提示缺少收款資料。

### Failure behavior
無銀行資料查看權限者看不到帳戶清單，也不能藉更換ID選用。

## FR-028 — 付款確認

### Statement
確認付款時取得內部文件號，付款金額成為可核銷額。確認具備重送安全。系統只記錄已發生的付款，不發起銀行交易、不產生銀行檔、不設審批流程（決定D4）。

### Acceptance criteria
確認後付款出現在供應商帳戶；同一確認請求送兩次只有一筆付款。

### Failure behavior
Effect Date在已關帳期間時拒絕。

## FR-029 — 核銷

### Statement
具`ap.payment.mgmt`的使用者把已確認付款核銷到同一Supplier、同一Currency的一張或多張已確認發票，可部分核銷。系統可按到期日建議分配，但不自動保存。

### Acceptance criteria
一筆付款可分到多張發票；一張發票可由多筆付款核銷。核銷後發票未付額及付款可用額相應減少。

### Failure behavior
核銷額超過付款可用額或發票未付額時拒絕。兩人並發核銷同一付款或同一發票時，成功總額不超過任一餘額，沒有負數。

## FR-030 — 預付款

### Statement
已確認付款中未核銷的金額保留為該Supplier及Currency的預付款，可在日後核銷到其發票。系統不強迫即時用完，也不自動配對。

### Acceptance criteria
先付款、後入帳發票時，可把先前的預付款核銷到新發票。供應商帳戶分開顯示未付發票、預付款及Credit Balance。

### Failure behavior
N/A：預付款的使用受FR-029的上限規則約束。

## FR-031 — 解除及重新核銷

### Statement
在開放期間，使用者可解除一筆核銷並重新核銷到其他發票。重新核銷以一組完整的移除及新增一次提交，全部成功或全部不變。原記錄保留並標示已解除。

### Acceptance criteria
解除後發票未付額及付款可用額恢復。重新核銷中途任何一項不合法時，原核銷保持不變。

### Failure behavior
Effect Date在已關帳期間時拒絕。

## FR-032 — 付款沖銷

### Statement
付款資料錯誤或支票退票時，具`ap.payment.mgmt`者可整張沖銷已確認付款，須填寫原因、Effect Date並重新認證。沖銷原子地反向其全部有效核銷，並把未核銷額歸零。原付款及號碼保留。不提供部分沖銷。

### Acceptance criteria
沖銷後受影響發票的未付額恢復，付款標示為已沖銷且不可再核銷。沖銷前的歷史在As-of查詢中保持當時效果。

### Failure behavior
任何一張發票的反向失敗時整張沖銷不生效。沖銷重送只產生一次效果。

## FR-033 — 列表、詳情及追溯

### Statement
具`ap.view`的使用者可查看Supplier Invoice、Supplier Credit Note及Payment的列表及詳情，按Supplier、狀態、日期、到期日、號碼及供應商發票號篩選。發票詳情顯示每行的收貨單及PO來源；收貨及PO方可查到相關發票。

### Acceptance criteria
以內部文件號或供應商發票號精確搜尋可找到對應文件。由發票可到其收貨及PO，由收貨可到其發票。

### Failure behavior
來源已不可取得時顯示保存的來源快照並標示，不顯示錯誤連結。

## FR-034 — 供應商帳戶

### Statement
指定Supplier及Currency，顯示未付發票總額、預付款、Credit Balance及交易明細（發票、貸項、付款、核銷、解除、沖銷）。可指定As-of Date。

### Acceptance criteria
交易明細的累計結果等於所顯示的餘額。不同Currency分開顯示，不提供跨幣別合計。

### Failure behavior
N/A：唯讀查詢；資料不可取得時顯示服務暫不可用。

## FR-035 — 未付、逾期及Aging

### Statement
按As-of Date提供未付發票、逾期發票及Aging。Aging分桶為未到期、1–30、31–60、61–90及90日以上，當日到期不視為逾期（假設A-006，與AR需求FR-AR-004、FR-AR-005相同）。可按到期日範圍列出到期應付清單，供安排付款。

### Acceptance criteria
到期日當日的發票屬未到期，翌日起屬1–30。Aging各桶合計等於未付總額。

### Failure behavior
N/A：唯讀查詢。

## FR-036 — Supplier Statement

### Statement
指定Supplier、Currency及期間或As-of Date，提供期初餘額、期內交易、核銷、期末餘額及Aging摘要，可列印。畫面、列印及CSV使用同一計算口徑。

### Acceptance criteria
同一條件下，畫面、列印頁及CSV的數字相同。

### Failure behavior
N/A：唯讀查詢。

## FR-037 — 歷史時點

### Statement
As-of查詢以Effect Date還原當時的餘額：其後發生的核銷、解除、貸項及沖銷不影響較早日期的結果。

### Acceptance criteria
上月核銷、本月沖銷的付款：以上月底查詢顯示已核銷，以今日查詢顯示已沖銷。

### Failure behavior
N/A：唯讀查詢。

## FR-038 — 期初匯入

### Statement
具`ap.opening.import`的使用者下載模板，上傳CSV匯入上線前的未付Supplier Invoice、預付款及Credit Balance。預檢列出每筆的錯誤，不取號、不建立應付。確認後才正式建立。

### Acceptance criteria
預檢後系統沒有任何新的應付或號碼。確認後每筆期初發票出現在供應商帳戶，標示為期初並保存舊系統參考號。

### Failure behavior
檔案格式、編碼或大小不合規時整個上傳被拒絕。個別記錄的錯誤逐筆指出行號及欄位。

## FR-039 — 期初匯入的隔離及防重

### Statement
確認時每筆期初文件獨立成敗：合法的成功，錯誤的保留原因。同一Supplier的相同供應商發票號不得重複建立。確認中斷後可對同一批次再確認，已成功的不重複。

### Acceptance criteria
一批100筆中有1筆錯誤時，99筆成功、1筆列出原因，修正後可單獨重試。同一檔案再次上傳不產生重複發票。

### Failure behavior
總數、成功數及失敗數必須守恆並與結果檔一致。

## FR-040 — 期初記錄的界線

### Statement
期初發票不建立也不引用任何PO、收貨或庫存結果，不佔用收貨數量。其後的貸項、付款、核銷及Aging規則與一般發票相同。

### Acceptance criteria
期初發票可被核銷、貸項及作廢；它不出現在待開票清單或任何收貨的來源追溯。

### Failure behavior
N/A：界線規則，違反情況由FR-038的驗證拒絕。

## FR-041 — 列印頁

### Statement
提供A4列印頁：付款明細（一筆付款及其所核銷的發票，可交供應商作付款通知）及Supplier Statement。PDF由瀏覽器列印另存。作廢或已沖銷的文件在列印頁明顯標示。

### Acceptance criteria
付款明細列出付款號、日期、金額、方式及每張被核銷發票的供應商發票號及金額。列印不改變任何文件狀態。

### Failure behavior
文字內容以純文字呈現，不執行其中的HTML或腳本。

## FR-042 — CSV匯出

### Statement
具`ap.export`的使用者可匯出其有權查看的發票、未付、Aging、Statement、付款及貸項資料。匯出範圍有界，並保存匯出者、條件、As-of Date及筆數。

### Acceptance criteria
匯出結果只可由建立者下載，到期後不可下載。匯出內容不含完整銀行帳號。

### Failure behavior
範圍超過上限時拒絕並要求縮窄條件，不提供不完整的檔案。

## FR-043 — Audit

### Statement
建立、修改、取消、改價、確認、作廢、貸項、付款、核銷、解除、重新核銷、沖銷、設定、關帳、匯入、列印及匯出均記錄Audit：操作者、時間、動作、結果、原因、目標及關聯識別。被拒絕的操作同樣記錄。

### Acceptance criteria
每項關鍵操作成功或被拒絕後，可在Audit查到對應記錄。Audit不含完整銀行帳號或密碼。

### Failure behavior
Audit寫入失敗時，相關財務操作不得被當作成功完成而沒有記錄。

## FR-044 — 讀取無副作用

### Statement
查看、列印、匯出及技術重查不改變任何文件的狀態、餘額、版本或關帳資格。

### Acceptance criteria
對一張發票連續查看、列印及匯出後，其版本、未付額及最後業務更新時間不變。

### Failure behavior
N/A：無寫入行為。

## FR-045 — 供應商狀態與既有應付

### Statement
Supplier狀態不再是Active後，不可為其新建無PO發票，但既有發票、貸項、付款、核銷及查詢照常處理。Supplier主檔日後修改不改變已確認文件上保存的名稱、代碼及付款條件。

### Acceptance criteria
供應商被Suspended後，其未付發票仍可付款及核銷。供應商改名後，舊發票顯示當時的名稱。

### Failure behavior
N/A：狀態規則；新建被拒絕時顯示供應商狀態原因。

## NFR-001 — 規模基線

### Statement
本模組按約20名使用者、每日最多1,000張訂單的中小企設計（Sam）。AP自身的每月Supplier Invoice及付款筆數未提供（OI-001）。設計不得引入只為更大規模而設的機制。

### Acceptance criteria
系統設計列出其容量假設及來源；未經Sam提供或實測的數字標示為待定，不寫成已確認門檻。

### Failure behavior
實際單量明顯超出基線時，須重新評估設計，不以調高限額代替。

## NFR-002 — 互動回應

### Statement
常用列表及精確單號查詢、單張文件的保存及確認，須達到與AR相同的回應目標（假設A-007：列表及精確查詢p95不超過2秒；不超過100行的文件保存及確認p95不超過3秒）。

### Acceptance criteria
按AGENTS.md，性能驗證在功能完成UAT後另行批准執行，不屬Phase Gate；屆時以批准的資料量及門檻量度。

### Failure behavior
依賴暫時不可用時不以過期資料假裝成功；顯示可恢復的錯誤及關聯識別。

## NFR-003 — 一致性

### Statement
每個財務命令全部成功或全部不生效。發票、貸項、付款、核銷及餘額在重送、並發及結果不明下保持守恆。

### Acceptance criteria
任何時點，每張發票的未付額等於總額減有效貸項減有效核銷；每個Supplier及Currency的帳戶餘額可由其交易明細重算得出。

### Failure behavior
發現不守恆時停止相關寫入並保留證據，以新的更正記錄修復，不直接修改資料庫。

## NFR-004 — 金額精度

### Statement
金額及數量以精確小數計算及保存，不使用二進位浮點；精度與Purchasing的PO單價及金額一致。

### Acceptance criteria
任意拆分開票及核銷後，合計與原額完全相等，沒有累積尾差。

### Failure behavior
輸入超出允許的小數位或範圍時拒絕。

## NFR-005 — 保留

### Statement
正式Supplier Invoice、貸項、付款、核銷歷史及Audit至少保留7年；匯入來源及結果檔保留90日，匯出檔保留7日（假設A-004，與AR已批准的期限相同）。本期不提供自動銷毀正式財務資料。

### Acceptance criteria
到期的檔案被安全刪除，其結構化記錄及Audit仍然保留。

### Failure behavior
檔案清理失敗不影響正式財務資料，並留下可追查的記錄。

## NFR-006 — 備份及復原

### Statement
AP資料及私有檔案納入系統的備份及還原範圍，沿用系統層已批准的復原目標（AR需求NFR-DR-001：RTO不超過4小時、RPO不超過15分鐘）。

### Acceptance criteria
系統的還原演練涵蓋AP資料，抽樣的發票、付款及餘額在還原後一致。

### Failure behavior
N/A：由系統層的復原程序處理。

## SEC-001 — 後端授權

### Statement
所有列表、詳情、命令、列印、匯出及匯入請求在後端驗證身份及權限。前端隱藏入口不構成授權。

### Acceptance criteria
沒有對應權限的使用者直接呼叫任何AP介面均被拒絕。

### Failure behavior
拒絕時不洩露目標是否存在。

## SEC-002 — 最小權限及職責分離

### Statement
AP各權限互不自動繼承；系統管理員不因其角色自動取得AP權限。入帳（`ap.invoice.mgmt`）與付款（`ap.payment.mgmt`）是獨立權限，可分配給不同人。

### Acceptance criteria
只有`ap.invoice.mgmt`者不能建立或確認付款；只有`ap.payment.mgmt`者不能建立或確認發票。

### Failure behavior
N/A：拒絕即為預期行為。

## SEC-003 — 物件層授權

### Statement
更換Supplier、Invoice、Credit Note、Payment、核銷、匯入批次或匯出的ID不得取得未授權的資料或操作。

### Acceptance criteria
以他人建立的匯出ID下載被拒絕；以不屬於該發票的行ID建立貸項被拒絕。

### Failure behavior
未授權與不存在回應相同。

## SEC-004 — 供應商銀行資料

### Statement
供應商銀行帳戶只向同時具備Supplier銀行資料查看權限的使用者提供。AP只保存遮蔽後的快照。完整帳號不出現在一般列表、Audit、Log、列印頁或匯出。

### Acceptance criteria
無銀行資料權限者在付款詳情只看到遮蔽資料。匯出檔及Audit不含完整帳號。

### Failure behavior
銀行資料服務不可用時，付款仍可在不選收款帳戶的情況下記錄。

## SEC-005 — 重新認證

### Statement
發票作廢、貸項作廢、付款沖銷及AP關帳日變更須重新輸入密碼，並填寫原因。

### Acceptance criteria
密碼錯誤時操作不執行並記錄Audit。

### Failure behavior
重新認證服務不可用時操作被拒絕。

## SEC-006 — 正式記錄不可覆寫

### Statement
正式文件、來源記錄、核銷歷史及Audit不得被應用程式的一般操作修改或刪除。

### Acceptance criteria
對已確認文件的直接修改或刪除嘗試被拒絕並可被察覺。

### Failure behavior
N/A：拒絕即為預期行為。

## SEC-007 — 注入防護

### Statement
供應商名稱、發票號、描述、原因及備註在畫面、列印頁及CSV中不得被當作HTML、腳本或試算表公式執行。上傳檔案須檢查類型、編碼及大小。

### Acceptance criteria
含公式前綴、HTML或控制字元的輸入在匯出及列印中以純文字呈現。

### Failure behavior
不合規的上傳檔案被拒絕，不部分處理。

## SEC-008 — 權限即時生效

### Statement
每個命令在執行當時驗證權限。使用者被撤權後，不得憑舊頁面、舊請求或重送取得新的財務結果或查回原結果。

### Acceptance criteria
撤權後送出的確認被拒絕；撤權後重送先前已成功的請求，不返回該結果的內容。

### Failure behavior
已在撤權前完成並提交的結果保留。

## SEC-009 — 私有檔案

### Statement
匯入來源檔、結果檔及匯出檔存放於私有位置，只可由建立者或獲授權者下載，並有到期時間。

### Acceptance criteria
未登入或無權者不能以連結直接取得檔案；到期後不可下載。

### Failure behavior
檔案儲存不可用時，匯入及匯出被拒絕，其他AP功能不受影響。

## Assumptions, dependencies, open issues and human decisions

### Human decisions（Sam，2026-11-17，「全部照建議」）

| ID | 決定 |
| --- | --- |
| D1 | Supplier Invoice由已確認收貨行建立，可跨多張收貨及PO；數量不可超過已收未開票數量；單價預設取PO價。 |
| D2 | 價格與PO不同時允許，但須專門權限並填寫原因。 |
| D3 | 納入沒有PO的發票，作為手動發票並填寫原因。 |
| D4 | 付款只記錄已付款並核銷：部分付款、一次付多張、預付款。不做付款審批流程，不產生銀行付款檔。 |
| D5 | 做供應商貸項，按原發票行沖減，只影響應付、不動庫存。 |
| D6 | AP有自己的關帳日，不與AR共用。 |
| D7 | 模組目錄`docs/accounts_payable_management/`，module id `accounts-payable-management`，owner「ERP Product Owner (Sam)」。 |

### Assumptions（Sam於2026-11-17確認：「全部接受」）

| ID | 假設 | 依據 |
| --- | --- | --- |
| A-001 | 不做稅、匯率換算、會計分錄及存貨成本。 | Purchasing §2排除範圍；AR需求。已向Sam說明，Sam未提出異議。 |
| A-002 | 核銷只在同一Supplier、同一Currency內進行。 | 與AR相同。已向Sam說明，Sam未提出異議。 |
| A-003 | 期初匯入、供應商帳戶、未付、逾期、Aging及Statement均做。 | 與AR對應。已向Sam說明，Sam未提出異議。 |
| A-004 | 保留期限與AR相同：財務記錄至少7年、匯入檔90日、匯出檔7日。 | AR需求OI-002（2026-09-10批准，針對AR）。 |
| A-005 | 確認時核對使用者輸入的供應商發票總額（FR-013）。 | 作者建議的入帳控制。 |
| A-006 | Aging分桶與AR相同。 | AR需求§6。 |
| A-007 | 互動回應目標與AR相同。 | AR需求NFR-PERF-002／003。 |
| A-008 | AP不設自身的Archive分層及背景Job佇列。 | Sam於2026-11-17對AR的同類決定。 |
| A-009 | 由收貨行建立的發票可加入費用行（FR-012）；一行收貨可分多張發票開票（FR-005）。 | 由D1及D3推演。 |
| A-010 | 供應商的貸項單號為選填。 | 作者假設。 |

### Dependencies

| 依賴 | 狀態（`origin/main` `6a34b8c2`） |
| --- | --- |
| Purchasing：已確認收貨行、淨收貨數量、收貨沖銷 | main上只有收貨單表頭（migration 0119）。收貨行（TASK-027）有Purchasing owner的本機候選`97d248a4`，未入main；TASK-028～033的狀態未確認（PM `548b8fb0`）。AP的FR-004～FR-007、FR-016、FR-019、FR-020依賴它們。 |
| Purchasing：PO的Supplier、Currency、付款條件快照、行單價及採購單位 | 已在main（migration 0112、0113）。 |
| Purchasing：收貨沖銷時查詢AP佔用（FR-020） | 需要新的跨模組契約，尚未存在。 |
| Supplier：Supplier狀態及快照、有效銀行帳戶 | Supplier lookup已在main；供付款流程選用銀行帳戶的唯讀介面尚未存在。 |
| Business Master：Currency及付款條件 | 已在main。 |
| AR設計評審 | AR縮減設計有六項Required未關閉（重送授權、關帳日及鎖序、跨模組互斥、一致快照、期初匯入、同步時限）。AP系統設計不得把AR的做法當作已核准；FR-003、FR-017、FR-020、FR-039、SEC-008已在需求層面寫入對應要求。 |

### Open issues

| ID | 問題 | 影響 |
| --- | --- | --- |
| OI-001 | 每月大約多少張Supplier Invoice及多少筆付款？ | 只影響容量假設及限額，不改變資料模型。 |
| OI-002 | 付款是否要記錄公司付款所用的銀行帳戶？預設不記錄，只記付款方式及參考號。 | 若要記錄，需要公司銀行帳戶設定，可能與AR共用。 |
| OI-003 | 待開票清單是否也應顯示Draft狀態發票已佔用的明細？ | 只影響畫面。 |

### Requirement Gate

狀態：**未通過**。A-001～A-010已獲Sam確認（2026-11-17）。尚欠：OI-001及OI-002的回答（OI-002在回答前按預設「不記錄」處理）及非作者評審。
