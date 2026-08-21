import { describe, expect, it } from "vitest";
import { discoverPages } from "@/framework/discovery/pages.js";
// 直接讀後端那份權限目錄的正本，唔喺呢邊再抄一份。
//
// 跨 workspace import 一個純資料檔案：佢冇任何依賴、冇 side effect，所以呢個
// import 唔會拖任何後端嘅嘢入嚟。抄一份嘅話，兩份分岔嘅症狀就會變成「前端叫你
// 睇唔到呢一頁，但後端明明放行」——冇任何嘢會出聲，而呢個測試存在嘅理由就係
// 唔想有呢種情況。
import { PERMISSION_NAMES } from "../../../../server/src/modules/authorization/permissionCatalogue.js";

describe("頁面權限 metadata", () => {
  it("每一頁 requires.permissions 都要喺權限目錄搵得到", () => {
    for (const { filePath, page } of discoverPages()) {
      for (const permission of page?.requires?.permissions ?? []) {
        expect(
          PERMISSION_NAMES,
          `${filePath} 要求「${permission}」，但佢唔喺權限目錄入面`
        ).toContain(permission);
      }
    }
  });

  /**
   * 同後端 permissionCatalogueConventions.test.js 嗰條規則一樣，兩邊都要鎖：
   * 角色名係管理員改得郁嘅資料，攞佢做授權判準等於「改個名就改咗邊個入得到」。
   *
   * 前端呢邊仲多一重——菜單同路由守衛都係讀呢個 metadata，所以一個用 roles 嘅
   * 頁面會喺角色改名之後，喺一個冇人會聯想到嘅地方（菜單少咗一項）出事。
   */
  it("冇任何一頁用角色名做授權判準", () => {
    for (const { filePath, page } of discoverPages()) {
      expect(
        page?.requires?.roles,
        `${filePath} 用 requires.roles 授權。角色名改得郁，改用 requires.permissions。`
      ).toBeUndefined();
    }
  });
});
