# HD-103 — TASK-029 SKU lookup 精確契約審閱

## Answered / adopted checkpoint

Sam實際「同意」已批准並套用本文精確候選；APR128–132／REV080保留實際來源。Lookup已實作並有直接27項unit PASS；真API執行前發現既有0064 scope綁旧PLAN，停止於[HD104 checkpoint／Decision Required](task029-hd103-lookup-checkpoint.md)。本文以下保留原proposal，不代表仍等待HD103或未套用。

## Historical exact proposal before approval

Status: PROPOSED_NOT_APPLIED；Sam已回答HD-102「A」，授權準備本候選，不代表已批准未見契約。產品程式、canonical specs及當前DESIGN／PLAN均未改；TASK-029仍IN_PROGRESS，affected path BLOCKED。

## 審閱範圍

[精確五文件 patch](task029-sku-lookup-proposal.patch) 更新03 Design（§5.6.1、§7.5、DES-005）、05 Plan（P3-T04／TASK-029）、06 TC-006、07 UAT-060，以及manifest提供方的Design contract pin。不存在第二份canonical；patch獲批准後才套用。詳細檔案前後SHA、候選基線與驗證見[metadata](task029-sku-lookup-proposal.json)。

- 入口：`GET /api/v1/inventory/sku-lookup?code=...`；JWT＋`inventory.view`，不新增Item grants或permission。
- 輸入：單一必填Code，1～190 Unicode code points；拒絕extra query、array、控制字元及越界。trim沿用Item normalizer；等值查找沿用Item／DB collation，沒有uppercase、LIKE、模糊、barcode或catalogue。
- 200：既有success envelope的data僅含`skuId`、`skuCode`、`skuName`、`trackingPolicy`、`baseUom {uomId,uomCode}`，strict whitelist。成功代表當下profile可供選料；不公開價格／行政資料、raw profile或reasons。不可用SKU以既有400錯誤拒絕，不另建資格enum。
- 錯誤：schema400 `REQUEST_VALIDATION_FAILED`；trim空白400 `SKU_CODE_INVALID`；不存在404 `INVENTORY_RESOURCE_NOT_FOUND`；不追蹤／不可用／serial／Base UOM失效分別沿用既有400 `SKU_NOT_INVENTORY_TRACKED`／`INVENTORY_INPUT_INVALID`／`SERIAL_TRACKING_UNSUPPORTED`／`UOM_CONVERSION_INVALID`。401／403／撤權及safe 500沿用框架，不泄露內部資料。
- 讀取：同一既有REPEATABLE READ交易executor重用Item `findByCode`及`getInventoryProfileInTransaction`；不修改Item source、不複製其規則、不讀Balance作選料資格。Item discontinued但SKU active依inventory profile允許者仍可選，不新增Item active限制。
- 業務：無Balance SKU也能建Draft；GET無業務寫入，不cache資格。lookup不是過帳保證，create/update/dispatch仍在自己的交易重驗；無stock的Dispatch依既有規則拒絕。
- UI：Code改變清除該行SKU/Lot；明確選結果才綁定ID；舊response不得覆蓋新輸入；loading／empty／error／撤權及keyboard流程明確，保留其他Draft輸入，不自動替換SKU／重送過帳。

不改requirements、typed graph、profile命令、最低discovery／zero-skip、34 coverage floors、capacity、CI或merge政策。既有FR-070／071 → DES-005 → PHASE-004 → TASK-029 → TC-006及UAT-060關係承接此技術入口；共同auth沿用SEC-001／TC-001。四個capacity cases仍NOT_EXECUTED，於適用full-P3／release gate mandatory。

## 精確候選基線

- Frozen head：`869ac07abdd3879254c351d857be911d71e68b6b`
- Source不變：`caf576fa738762dabb7faafe471c1ea95370138f21913ad5cf885084258c96f6`
- 現行DESIGN：`c8dc42b3fea72c2f6ab8a2bead404a25e65bb2ca9addcf15814d570b9a4c1cb1`
- 現行PLAN：`11b815650cfb7851c5c096fe14fb7a2cff84ef3d28cd6d8afb1ae99d3ef8ad9a`
- 候選DESIGN：`de32a25f52faeddc65234963935f44a4e73a6a505f44f52dca2283f5e6913f93`
- 候選PLAN：`41949846cafde277c6887a7b572e0b3f945425d9a16f1b96517d99ca1674617c`
- Patch SHA256：`fbd9f77a5c063cd362ff5e41bb157cf01983bce62eb598aa02c65e5328448bd6`

舊approval與111 native evidence refs完整保留。套用後新增DESIGN／PLAN approval須記錄Sam實際答覆，適用developer checks須在新基線重跑；不得把舊PLAN的API8／unit22等結果改標為新PLAN PASS。

## 驗證與未驗證

候選traceability STRUCTURE_PASS（0 issues）；generated matrix byte-identical；patch在第二份fresh temporary copy重播後五文件SHA逐一吻合；provided contract pin與候選Design bytes一致，consumed Item pin不变。這些僅是文檔結構及patch可重現性，不是產品測試。

Codex SELF_REVIEW涵蓋最小whitelist、權限／輸入／錯誤、同snapshot、無Balance Draft語意、沿用資格、stale UI及不降低門檻；無blocking proposal finding，不是獨立Sam review。六組P0/P1 lookup子案例均已定義preconditions、data、steps、expected、required evidence，狀態NOT_RUN。API／DB／UI／Playwright／CI本輪未執行；TASK-029及P3未完成，沒有正式acceptance／UAT／release結果。

## Decision Required

Context：HD-102 A已決定準備Inventory-owned入口；現在需Sam獨立審阅精確公共契約及新DESIGN／PLAN，才能實作。

Options：批准上述精確patch／DESIGN／PLAN，套用後通過本機gate再继续TASK-029 lookup／UI；或指出需修訂內容，保持affected path BLOCKED。推薦批准：保留既有Draft業務及least privilege，重用Item能力，不增加catalogue／新權限／schema／依賴。

Default action：未獲精確候選批准前不套用canonical patch或實作lookup。本次所求批准僅TASK-029本機文檔套用、lookup／UI與適用developer checks（現有本機合成资源及精確清理權限沿用），不包含commit／push／PR／remote CI／merge、新main整合、later Tasks、未來head獨立review、正式acceptance／UAT／release或capacity豁免。未來發布仍須fresh main整合與current-candidate CI／review。
