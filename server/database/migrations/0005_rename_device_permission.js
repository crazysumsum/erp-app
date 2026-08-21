// 把 device.approve 改名為 device.mgmt。設計說明見 docs/user-management.md §1.2。
//
// 改名的理由是名字一直都比實際涵蓋範圍窄：核准、拒絕、撤銷三支 handler 與審批
// 佇列從一開始就共用同一個權限（見 deviceBindingSchemas.js），「approve」只描述
// 了其中一個動作。授權行為完全沒有變化，只有那個字串換了。
//
// 用 UPDATE 改名而不是「刪掉舊的、插入新的」：權限 id 不變，role_permissions 裡
// 既有的關聯原封不動。刪除會被 ON DELETE CASCADE 連帶清掉那些關聯，再靠這支
// migration 自己重建——多一個會出錯的步驟，而且中途失敗會留下一個沒有任何人握有
// 設備審批權的資料庫。
//
// 這支完全沒有 DDL，所以沒有「MySQL 隱式提交讓半套的 migration 沒被記錄」那個
// 問題（見 scripts/migrate.js：只在整個 up() 成功之後才寫 fr_schema_migrations）。
// 唯一的一步本身就是冪等的：舊名不在了就影響 0 列，重跑一定收斂。
//
// 乾淨的資料庫走的是「0004 先種 device.approve、這裡再改名」。看起來繞路，但比
// 讓 0004 直接種新名字安全：0004 在既有環境已經套用過，改它的內容不會重跑，只會
// 讓檔案內容與資料庫的實際狀態對不上。

const OLD_NAME = "device.approve";
const NEW_NAME = "device.mgmt";

// 0004 種的舊描述只寫了「審批」，跟名字犯同一個毛病，一起更正。
const DESCRIPTION = "審批、拒絕或撤銷設備綁定申請";

export async function up(connection) {
  // 兩個名字同時存在的話，permissions.name 的唯一鍵會讓這句拋錯、整支 migration
  // 失敗——刻意不去吞掉它。那代表有人手動種過新名字，而哪一個 id 的
  // role_permissions 該留下來是一個要人決定的問題，不是這裡猜得到的。
  await connection.execute(
    "UPDATE permissions SET name = ?, description = ? WHERE name = ?",
    [NEW_NAME, DESCRIPTION, OLD_NAME]
  );
}
