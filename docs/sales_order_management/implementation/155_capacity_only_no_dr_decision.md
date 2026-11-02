# DEC-040 — 本輪不執行災難還原測試

Authority: Sam在目前Sales對話直接指示「全規模容量測試是在做什麼，詳細解釋步驟；災難還原測試不用做」。這是本輪P4 developer交付的明確範圍決定，不需重問同一授權；不解讀為刪除產品備份功能、修改正式資料或永久宣稱達成RTO/RPO。

只移除PHASE-005 developer_suites的sales-phase005-restore；完整備份/隔離還原/RTO/RPO不再作本輪P4 developer合併阻塞。正式TC-056～059定義、全局formal TechnicalAcceptance案例與Profile原restore command仍保留，未執行不作PASS。容量TC-053～055、原33組／其他必要回歸、Archive資料完整性、coverage、CI、當前candidate獨立覆核仍必要。只新增PLAN批准／原路徑SCOPE機械繫結，舊批准及舊hash完整保留；DESIGN/產品source不變。

舊DEC039包含DR的4.03～6.35TiB估算與6.5TiB資源建議不再作本輪需求。容量本身的估算保留一份資料、一份source files、正常seed binlog、workload日誌margin及runtime/temp budget；排除完整備份、獨立還原副本、restore binlog與兩份額外files。這仍是小批外推，不是最低／實測fullvolume要求；初始資料materialization/log retention方式尚須技術收斂，不自動要求按保守上限購置磁碟。

容量only暫時估算（TiB）：page-based 1.803；extent-based 2.516。目前扣100GiBreserve可用378.85GiB。原seed正常binlog保留假設未優化，不能把此值當最低硬體規格；未開始fullseed，不新增資源授權。
