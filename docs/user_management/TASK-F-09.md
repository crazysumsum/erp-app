# F-09 管理員與業務職責分離

依據 TL 的 `tech-lead-handoffs/security-f09-design-20261127.md` r6。r4 納入停用帳號，r5 補財務所需的供應商及採購查閱權，r6 補管理員角色的指派與首帳號限制。Sam 經 PM fe2d50de 同意由財務持有供應商銀行權限。

## 配權與防護

- system-admin 持有的 15 項權限列在[設備綁定設計 §1.3](../device-binding-auth.md#13-種入-system-admin-角色與-devicemgmt-權限)。這個角色由 migration 維護。
- 管理員可對其他人及自己未持有的角色，轉授權限目錄內的業務權限。三項帳號、角色與設備管理權仍須自己持有。一般操作者只可新增自己持有的權限。
- TL 2a75f905 要求以同一個 `assertSystemAdminActor` 判斷操作者是否持有 system-admin。帳號建立、增減受保護角色，以及 F-01 的重設密碼、停用帳號共用此判斷。先核對操作者，再執行既有「至少留一個啟用管理員」防護。
- 受保護帳號的全部角色合計只能有保留清單內的權限。新增、指派、首帳號建立及緊急復原都核對最終集合。修改副角色也要核對持有人，包含已停用的管理員，避免日後重新啟用時帶入業務權限。
- 依 TL 要求把新增回歸限於會影響結果的情境：複製 15 權的自訂角色增減管理員均遭拒；真正管理員可以增減；角色指派與首帳號建立拒絕混合；停用管理員所持的副角色無法加入業務權。沿用原有最後管理員及財務重新認證案例。
- UAT-030 依 TL f2b91d47 改由財務（BANK-OFFICER）執行。清單遮罩，查看和修改均須重新輸入密碼，錯誤密碼不會顯示明文，修改須填原因，稽核須有請求編號。管理員只見遮罩，要求完整帳號回 403。財務正常使用時毋須出現 break-glass 告警；告警的服務層測試保留。PM 已更新 UAT-ROLES 與 UAT-CHECKLIST。

## 部署順序與驗收

F-09 排在其他功能及 UI PR 之後。目前基線最後一支 migration 是 0133。整合時確認撤權 migration 的編號在實際 main 所有業務 seed 之後，同步調整測試所引用的檔名。撤權可重跑，回退程式不會回授業務權。

部署負責人在驗收及正式環境以角色介面逐一配置。依 UAT-ROLES 及職員職務確認身分，不按角色顯示名稱自動授權。

| 角色 | 此次須核對的業務權限 |
| --- | --- |
| 財務 | ap.view、ap.invoice.mgmt、ap.payment.mgmt、ar.opening.mgmt、supplier.bank.view、supplier.bank.mgmt、supplier.view、purchasing.view。應付價格覆寫屬主管例外。貸項與退款權限待相關功能合併後依核定對照配置。 |
| 倉務主管 | fulfillment.reverse、inventory.fefo.override、returns.view、returns.customer.mgmt、returns.supplier.mgmt。收貨沖銷待該功能合併。 |
| 銷售 | sales.import |
| 庫存主管 | 確認既有 inventory.adjust |

部署前及部署後執行以下唯讀盤點，包含停用帳號。部署前只檢查副角色，以便從歷史 seed 的直接授權中辨認需人手拆分的帳號。每一列都是待處理的帳號、角色與權限；應由部署方分配獨立業務帳號後清至零列。

```sql
SELECT u.username, u.status, secondary_role.name AS secondary_role, p.name AS permission
FROM users u
JOIN user_roles admin_membership ON admin_membership.user_id = u.id
JOIN roles admin ON admin.id = admin_membership.role_id AND admin.name = 'system-admin'
JOIN user_roles other ON other.user_id = u.id AND other.role_id <> admin.id
JOIN roles secondary_role ON secondary_role.id = other.role_id
JOIN role_permissions rp ON rp.role_id = other.role_id
JOIN permissions p ON p.id = rp.permission_id
WHERE p.name NOT IN (
  'user.mgmt','role.mgmt','device.mgmt','item.view','item.mgmt',
  'customer.view','customer.mgmt','customer.approval','customer.settings',
  'supplier.view','supplier.mgmt','supplier.approval','supplier.settings',
  'business_master.view','business_master.mgmt'
)
ORDER BY u.username, secondary_role.name, p.name;
```

部署後另用下面查詢逐項對 §1.3 的 15 項。請管理員重新登入，再由各業務角色執行一次職務操作，財務另核對 UAT-030。驗收庫由 PM 與 UAT 負責人操作。

```sql
SELECT p.name FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p ON p.id = rp.permission_id
WHERE r.name = 'system-admin' ORDER BY p.name;
```

帳號分離無法辨識同一人實際控制兩個帳號。部署負責人確認管理員與財務由不同人員擔任，並按 TL 建議每週核對帳號、角色與設備審批紀錄。

## 整合與複核追蹤

依 TL 安全審核 S-02（bc3e0459）交獨立差額複核。依 f794a15c，在最後一個前置 migration 合入 main 後，將本案改為當時最大號加一，同步更新測試引用，再提交相對 ec012521 的差額及兩時區結果。

啟用及更改一般用戶資料沿用停用及重設密碼的操作權限檢查，依 F-01 核對操作者可管理目標的全部權限。
