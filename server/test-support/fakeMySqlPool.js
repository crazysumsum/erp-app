/**
 * 啟動一個測試用應用所需的最小 MySQL pool 替身。
 *
 * 這個形狀先前在十幾個測試檔裡各自複製了一份，於是框架每多用一個資料庫方法，
 * 就有十幾個地方要同步修改——而漏掉的那個會以 "this.target[method] is not a
 * function" 的形式炸在無關的測試裡。
 *
 * 啟動路徑上真正會用到的是：
 *   query()          連線驗證、撤銷名單首次載入、權限目錄自檢
 *   execute()        cluster 工作的租約 prepare、撤銷名單清理
 *   getConnection()  每一句 query/execute 現在都自己借還一條連線
 *   end()            關機
 */
import { PERMISSION_CATALOGUE } from "../src/modules/authorization/permissionCatalogue.js";

// 這個替身代表的是一個**已經 migrate 過**的資料庫，而那樣的資料庫一定有這幾列
// ——PermissionCatalogueService 是 eager 的，少了它們每一個「啟動一個測試用應用」
// 的測試都會在啟動自檢那一步失敗，而失敗訊息會指向權限，跟那些測試真正在測的
// 東西毫無關係。
//
// 攔在 query 覆寫之前：覆寫是給「我要模擬某一種查詢結果」用的，不是給「我要
// 模擬一個沒跑過 migration 的資料庫」用的。真要測後者的測試會直接建
// PermissionCatalogueService（見 permissionCatalogueStartupGuard.test.js），
// 不會經過這裡。
const CATALOGUE_QUERY = /SELECT\s+name,\s*description\s+FROM\s+permissions/i;

export function fakeMySqlPool({ query, execute, end, rows = [{ ok: 1 }] } = {}) {
  const calls = { query: 0, execute: 0, end: 0, getConnection: 0, release: 0, destroy: 0 };

  const runQuery = async (...args) => {
    calls.query += 1;

    // MySqlDatabaseService 借連線之後是用 connection.query({ sql, timeout }, params)
    // 呼叫的，直接叫 pool.query(sql) 的路徑則是字串。兩種都要認得。
    const sql = args[0]?.sql ?? args[0];

    if (CATALOGUE_QUERY.test(String(sql ?? ""))) {
      return [PERMISSION_CATALOGUE.map((permission) => ({ ...permission }))];
    }

    return query ? query(...args) : [rows];
  };
  const runExecute = async (...args) => {
    calls.execute += 1;
    return execute ? execute(...args) : [{ affectedRows: 0 }];
  };

  return {
    calls,
    query: runQuery,
    execute: runExecute,
    // 借出來的連線共用同一組 query/execute，所以既有測試對 calls.query 的
    // 斷言不受影響；release/destroy 另外計數，讓「逾時之後怎麼還」測得到。
    getConnection: async () => {
      calls.getConnection += 1;
      return {
        query: runQuery,
        execute: runExecute,
        release: () => {
          calls.release += 1;
        },
        destroy: () => {
          calls.destroy += 1;
        },
        beginTransaction: async () => {},
        commit: async () => {},
        rollback: async () => {}
      };
    },
    end: async (...args) => {
      calls.end += 1;
      return end?.(...args);
    }
  };
}

/** serviceOptions.mysqldatabase 的常用形式。 */
export function fakeDatabaseOptions(overrides) {
  return { pool: fakeMySqlPool(overrides) };
}
