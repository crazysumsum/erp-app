# PR-B native environment preflight

Source: `b77b0468e6d9b3f2239490c7be8e0e3fb5f14f9e2af4bc747361cfb6bd418273`；DESIGN／PLAN維持Sam已批准版本。本表只記設定名稱、隔離識別與判定，不含秘密值。TASK041／P4大型fixture不在本次執行範圍。

| 執行組 | 原生環境契約及判定 | 實際最小／必要驗證 |
|---|---|---|
| Purchase receipt／partial reversal／auth | `DB_NAME`必須`erp_inventory_purchase_*`；`DB_SOCKET_PATH`必須在`/private/tmp/erp-inventory-purchase-*`；`DB_INTEGRATION_TESTS`／`INVENTORY_PURCHASE_TESTS`，B另有`INVENTORY_PURCHASE_REVERSAL_TESTS`；同實例版本必須26.7.0。通過，使用獨立purchase runtime。 | 正式Harness receipt32、reversal35、真auth21均零skip PASS；包含1–200行、真競爭及caller FK故障。 |
| Fulfillment native／全庫native coverage | 非GitHub環境的`DB_SOCKET_PATH`必須包含`erp-fulfillment-p0-mysql-`，`DB_NAME`必須`fulfillment_p0_*`；完整schema與真provider需要`FULFILLMENT_LIFECYCLE_ENABLED`。已核對並以正確獨立runtime通過最小案例。 | 原wrong-prefix全庫run保持固定來源跑完，不改guard或假設`GITHUB_ACTIONS`；正確prefix的真HD010案例1/1 PASS、零skip，完成setup／實際SQL／正常關閉／schema及daemon精確清理。 |
| 原Receipt／Reservation／Lock regression | `DB_NAME`依序必須`erp_inventory_task014_*`／`erp_inventory_task020_*`／`erp_inventory_task007_*`；原runner使用`DB_HOST`／`DB_PORT`及對應測試旗標。只在獨立127.0.0.1實例開TCP，以新合成憑證驗證。 | 三個原Harness suite均PASS，原transaction競爭／rollback子案例保留，實例已清理。 |
| P2／P3 native、API及真browser | P2只用`erp_inventory_task025_*`＋`erp-inventory-task025-mysql-2670.*`；P3只用`erp_inventory_p3_*`＋`erp-inventory-p3-mysql-2670.*`。保持各自`DB_SOCKET`／`DB_SOCKET_PATH`旗標及`@@skip_networking=1`。通過，不和Purchase或Fulfillment guard混用。 | 原P2 native7／API1、P3 Movement48／Transfer32／API31、真Playwright16與明示mock18全部PASS／零skip；owned實例已清理。 |
| Sales compatibility／key rings | 完整現行migrations、真Fulfillment provider及Customer／Supplier兩組Bank key rings皆須有效；沿用當前CI的測試環境來源，所有設定只在本機合成環境使用。 | 真Sales48 PASS；`FULFILLMENT_LIFECYCLE_ENABLED`保持已批准的值，未修改production預設。 |

共通檢查：MySQL實測26.7.0、Node符合現有26.x probe；所有schema均為本次owned命名，完整migration清單包含0101。全庫bootstrap採短名`fulfillment_p0_prbcov`，fixture自建UUID schema仍在MySQL64-byte identifier限制內；socket路徑亦保持平台界限。未覆寫正式／共用schema、未延長SQL10秒／交易20秒／HTTP30秒，未改任何fixture guard、namespace或門檻。

設定存在性及組合已核對：`DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_ADMIN_USER`、`DB_ADMIN_PASSWORD`、`DB_NAME`、`DB_SOCKET_PATH`；`SUPPLIER_BANK_ACTIVE_KEY_ID`／`SUPPLIER_BANK_ENCRYPTION_KEYS`／`SUPPLIER_BANK_LOOKUP_ACTIVE_KEY_ID`／`SUPPLIER_BANK_LOOKUP_KEYS`及對應`CUSTOMER_BANK_*`。原全庫native lane的`SALES_CAPACITY_SEPARATE_STEP`／`SALES_IMPORT_CAPACITY_SEPARATE_STEP`依現行CI保留，容量仍由其原獨立CI Gate執行，不能當成已測容量PASS。

Purchase與Fulfillment的專屬socket前綴互斥，因此分開隔離執行，不能讓其中一邊放寬guard。完整native coverage不冒充Purchase35／auth21的專用結果；那些已通過報告仍綁原source、命令、依賴及環境。文件整理不改受測source。完整coverage／39floors、當前CI與Sam最終來源審閱仍須實際完成，並保留所有原FAIL。
