import { BaseService } from "../../framework/services/BaseService.js";
import { PERMISSION_CATALOGUE } from "../../modules/authorization/permissionCatalogue.js";
import { describeMissingTable } from "../mysqldatabase/missingTableError.js";

const TABLE = "permissions";
const MIGRATE_HINT = "node scripts/migrate.js";

/**
 * 啟動時把程式碼裡的權限目錄拿去跟資料庫比對。
 *
 * **這是自檢，不是自動修復。** 缺了就補進去的話，`permissions` 就變成一張程式碼
 * 寫得了的表——而「沒有人能改這張表」正是這整套設計的第一條規則，會在第一次啟動
 * 時就被自己違反。
 *
 * 三種不一致的處置不同（見 docs/user_management/design_spec.md §1.3）：
 *
 *   - **目錄有、資料庫缺 → 拒絕啟動。** 這代表 migration 沒跑完，而這個狀態下
 *     系統會用最花時間查的方式壞掉：登得進去、每一頁都在、但功能一個都用不了，
 *     因為 handler 要求的權限沒有任何角色配得到。啟動時大聲失敗一次，比讓十個人
 *     各自查半天便宜。
 *   - **資料庫有、目錄沒有 → warn。** 多出來的權限不會讓任何 route 開放（route
 *     只認自己宣告的名字）。拒絕啟動會讓「上一版還有、這一版移除了」這種正常演進
 *     變成一次停機。
 *   - **description 不同 → warn。** 那一欄只給人看，不參與任何判斷。
 *
 * 放在 src/services/ 而不是 src/modules/，理由與 deviceBinding 相同：它需要參與
 * 容器的生命週期（要有人在啟動時叫它）。純資料的那份目錄留在 src/modules/
 * authorization/，這個 service 只是讀它。
 */
export class PermissionCatalogueService extends BaseService {
  static service = Object.freeze({
    name: "permissionCatalogue",
    lifecycle: "singleton",
    dependencies: ["mysqldatabase", "logging"],
    eager: true
  });

  constructor({ config, services, options = {} } = {}) {
    super({ config, services, options });
    this.database = services.require("mysqldatabase");
    this.logger = services.require("logging").logger;
  }

  async initialize() {
    await this.verify();
  }

  /**
   * 比對目錄與資料庫。缺項 throw，其餘記 warn。
   *
   * throw 出去之後容器初始化失敗 → createApplication() 失敗 → src/index.js 的
   * bootstrap().catch() 記成 application.startup_failed 並以非零碼結束。與
   * idempotency、tokenRevocation 的啟動守衛是同一個模式。
   */
  async verify() {
    const stored = await this.#load();

    const missing = PERMISSION_CATALOGUE.filter(
      (permission) => !stored.has(permission.name)
    );

    if (missing.length > 0) {
      // 訊息要指名缺哪幾個、以及該做什麼。「權限目錄不一致」這種訊息會讓看到的人
      // 再花十分鐘才走到這一步。
      throw new Error(
        `The permissions table is missing ${missing.length} permission(s) from the ` +
          `catalogue: ${missing.map((permission) => permission.name).join(", ")}. ` +
          `Run ${MIGRATE_HINT} against this database. ` +
          "This is deliberately not fixed automatically: the permissions table is " +
          "read-only to the application, and only migrations may write it."
      );
    }

    const catalogued = new Set(PERMISSION_CATALOGUE.map((permission) => permission.name));
    const extra = [...stored.keys()].filter((name) => !catalogued.has(name));

    if (extra.length > 0) {
      await this.logger.warn(
        "authorization.catalogue.extra_permissions",
        "The permissions table holds rows that are not in the code catalogue; they grant nothing, but someone changed the table by hand",
        { permissions: extra }
      );
    }

    for (const permission of PERMISSION_CATALOGUE) {
      const storedDescription = stored.get(permission.name);

      if (storedDescription !== permission.description) {
        await this.logger.warn(
          "authorization.catalogue.description_drift",
          "A permission's description in the database differs from the catalogue; this affects display only, not authorization",
          {
            permission: permission.name,
            catalogue: permission.description,
            database: storedDescription
          }
        );
      }
    }
  }

  /** name -> description。 */
  async #load() {
    let rows;

    try {
      [rows] = await this.database.query(`SELECT name, description FROM ${TABLE}`);
    } catch (error) {
      throw describeMissingTable(error, { table: TABLE, sqlFile: MIGRATE_HINT });
    }

    return new Map(rows.map((row) => [row.name, row.description]));
  }
}
