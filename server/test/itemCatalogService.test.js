import assert from "node:assert/strict";
import test from "node:test";
import { ItemCatalogService } from "../src/modules/item/ItemCatalogService.js";
import { createTestTime } from "../test-support/createTestTime.js";
import { ADMIN_ACTOR, createFakeItemCatalogDatabase } from "../test-support/fakeItemCatalogDatabase.js";

const NOW_MS = 1_700_000_000_000;

function collectingLogger() {
  const entries = [];
  const write = (level) => async (event, message, context) => {
    entries.push({ level, event, message, context });
  };
  return { entries, debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

function createService({ database, categoryMaxDepth = 8, logger = collectingLogger() } = {}) {
  const time = createTestTime({ clock: () => new Date(NOW_MS) });
  const service = new ItemCatalogService({ database, logger, time, categoryMaxDepth });
  return { service, logger };
}

function category({ id, parentId = null, name, status = "active", sortOrder = 0, version = 1 }) {
  return {
    id,
    parent_id: parentId,
    name,
    status,
    sort_order: sortOrder,
    version,
    created_at: NOW_MS - 1000,
    updated_at: NOW_MS - 1000,
    created_by: 10,
    updated_by: 10
  };
}

test("constructor requires database, logger, time and a positive integer categoryMaxDepth", () => {
  const database = createFakeItemCatalogDatabase();
  assert.throws(() => new ItemCatalogService({}), TypeError);
  assert.throws(
    () => new ItemCatalogService({ database, logger: collectingLogger(), time: createTestTime() }),
    TypeError
  );
  assert.throws(
    () =>
      new ItemCatalogService({
        database,
        logger: collectingLogger(),
        time: createTestTime(),
        categoryMaxDepth: 0
      }),
    TypeError
  );
});

// --- loadCategoryTree -------------------------------------------------------

test("loadCategoryTree nests children under parents and excludes archived by default", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [
      category({ id: 1, name: "Vitamins" }),
      category({ id: 2, parentId: 1, name: "Gummies" }),
      category({ id: 3, name: "Discontinued", status: "archived" })
    ]
  });
  const { service } = createService({ database });

  const { items } = await service.loadCategoryTree(ADMIN_ACTOR);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 1);
  assert.equal(items[0].children.length, 1);
  assert.equal(items[0].children[0].id, 2);
});

test("loadCategoryTree includes archived nodes when includeArchived is true", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "Discontinued", status: "archived" })]
  });
  const { service } = createService({ database });

  const { items } = await service.loadCategoryTree({ ...ADMIN_ACTOR, includeArchived: true });

  assert.equal(items.length, 1);
  assert.equal(items[0].status, "archived");
});

test("a category whose parent got filtered out (e.g. archived, hidden by default) surfaces as top-level", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [
      category({ id: 1, name: "Parent", status: "archived" }),
      category({ id: 2, parentId: 1, name: "Child" })
    ]
  });
  const { service } = createService({ database });

  const { items } = await service.loadCategoryTree(ADMIN_ACTOR);

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 2);
  assert.equal(items[0].children.length, 0);
});

// --- createCategory ----------------------------------------------------------

test("createCategory creates a root category and records an audit row", async () => {
  const database = createFakeItemCatalogDatabase();
  const { service } = createService({ database });

  const created = await service.createCategory({ ...ADMIN_ACTOR, name: "Vitamins" });

  assert.equal(created.name, "Vitamins");
  assert.equal(created.parentId, null);
  assert.equal(created.status, "active");
  assert.equal(created.version, 1);
  assert.equal(database.state.auditRows.length, 1);
  assert.equal(database.state.auditRows[0][3], "category.create");
});

test("createCategory rejects a duplicate name under the same parent, case-insensitively", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "Vitamins" })]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.createCategory({ ...ADMIN_ACTOR, name: "vitamins" }),
    (error) => {
      assert.equal(error.code, "CATEGORY_NAME_TAKEN");
      return true;
    }
  );
});

test("createCategory allows the same name under a different parent", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "Vitamins" }), category({ id: 2, name: "Snacks" })]
  });
  const { service } = createService({ database });

  const created = await service.createCategory({ ...ADMIN_ACTOR, name: "Vitamins", parentId: 2 });

  assert.equal(created.parentId, 2);
});

test("createCategory rejects an inactive parent", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "Inactive", status: "inactive" })]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.createCategory({ ...ADMIN_ACTOR, name: "Child", parentId: 1 }),
    (error) => {
      assert.equal(error.code, "CATEGORY_PARENT_NOT_ACTIVE");
      return true;
    }
  );
});

test("createCategory rejects an unknown parentId", async () => {
  const database = createFakeItemCatalogDatabase();
  const { service } = createService({ database });

  await assert.rejects(
    service.createCategory({ ...ADMIN_ACTOR, name: "Child", parentId: 999 }),
    (error) => {
      assert.equal(error.code, "CATEGORY_NOT_FOUND");
      return true;
    }
  );
});

test("createCategory allows exactly the 8th level, and rejects the 9th", async () => {
  // 建一條 7 層深的鏈（id 1..7），第 8 層應該通過，第 9 層應該被拒絕。
  const chain = [];
  for (let depth = 1; depth <= 7; depth += 1) {
    chain.push(category({ id: depth, parentId: depth === 1 ? null : depth - 1, name: `L${depth}` }));
  }
  const database = createFakeItemCatalogDatabase({ categories: chain });
  const { service } = createService({ database, categoryMaxDepth: 8 });

  const eighth = await service.createCategory({ ...ADMIN_ACTOR, name: "L8", parentId: 7 });
  assert.equal(eighth.name, "L8");

  await assert.rejects(
    service.createCategory({ ...ADMIN_ACTOR, name: "L9", parentId: eighth.id }),
    (error) => {
      assert.equal(error.code, "CATEGORY_MAX_DEPTH_EXCEEDED");
      return true;
    }
  );
});

// --- updateCategory：改名／排序 ------------------------------------------------

test("updateCategory renames and bumps version, recording a before/after audit detail", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "Vitamins" })]
  });
  const { service } = createService({ database });

  const updated = await service.updateCategory({
    ...ADMIN_ACTOR,
    id: 1,
    name: "Vitamins & Supplements",
    parentId: null,
    sortOrder: 0,
    version: 1
  });

  assert.equal(updated.name, "Vitamins & Supplements");
  assert.equal(updated.version, 2);
  const [, , , , , , , , detailJson] = database.state.auditRows[0];
  assert.deepEqual(JSON.parse(detailJson), {
    name: { before: "Vitamins", after: "Vitamins & Supplements" }
  });
});

test("updateCategory rejects a stale version without writing", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "Vitamins", version: 3 })]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.updateCategory({
      ...ADMIN_ACTOR,
      id: 1,
      name: "Renamed",
      parentId: null,
      sortOrder: 0,
      version: 2
    }),
    (error) => {
      assert.equal(error.code, "VERSION_CONFLICT");
      return true;
    }
  );
  assert.equal(database.state.categories.get(1).name, "Vitamins");
  assert.equal(database.state.auditRows.length, 0);
});

test("updateCategory rejects an unknown id", async () => {
  const database = createFakeItemCatalogDatabase();
  const { service } = createService({ database });

  await assert.rejects(
    service.updateCategory({ ...ADMIN_ACTOR, id: 999, name: "x", parentId: null, sortOrder: 0, version: 1 }),
    (error) => {
      assert.equal(error.code, "CATEGORY_NOT_FOUND");
      return true;
    }
  );
});

// --- updateCategory：移動（cycle／depth／inactive parent） ---------------------

test("updateCategory moves a category under a new active parent", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [
      category({ id: 1, name: "A" }),
      category({ id: 2, name: "B" }),
      category({ id: 3, parentId: 1, name: "Child" })
    ]
  });
  const { service } = createService({ database });

  const moved = await service.updateCategory({
    ...ADMIN_ACTOR,
    id: 3,
    name: "Child",
    parentId: 2,
    sortOrder: 0,
    version: 1
  });

  assert.equal(moved.parentId, 2);
});

test("updateCategory rejects moving a category to be its own parent", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "A" })]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.updateCategory({ ...ADMIN_ACTOR, id: 1, name: "A", parentId: 1, sortOrder: 0, version: 1 }),
    (error) => {
      assert.equal(error.code, "CATEGORY_CYCLE");
      return true;
    }
  );
});

test("updateCategory rejects moving a category under its own descendant", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [
      category({ id: 1, name: "A" }),
      category({ id: 2, parentId: 1, name: "B" }),
      category({ id: 3, parentId: 2, name: "C" })
    ]
  });
  const { service } = createService({ database });

  // 把 A（1）移到它自己的孫子 C（3）底下。
  await assert.rejects(
    service.updateCategory({ ...ADMIN_ACTOR, id: 1, name: "A", parentId: 3, sortOrder: 0, version: 1 }),
    (error) => {
      assert.equal(error.code, "CATEGORY_CYCLE");
      return true;
    }
  );
});

test("updateCategory rejects moving under an inactive parent", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [
      category({ id: 1, name: "A" }),
      category({ id: 2, name: "Inactive", status: "inactive" })
    ]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.updateCategory({ ...ADMIN_ACTOR, id: 1, name: "A", parentId: 2, sortOrder: 0, version: 1 }),
    (error) => {
      assert.equal(error.code, "CATEGORY_PARENT_NOT_ACTIVE");
      return true;
    }
  );
});

test("updateCategory rejects a move that would push the mover's own descendants past the depth ceiling", async () => {
  // 一條 7 層深的鏈：G（id 7）在 depth 7。另一條獨立分支 X→Y→Z（互不相干，
  // 不構成 cycle）：X 是 root，底下掛 Y、Z 兩層子孫（X 的 subtree height = 2）。
  const chain = [];
  for (let depth = 1; depth <= 7; depth += 1) {
    chain.push(category({ id: depth, parentId: depth === 1 ? null : depth - 1, name: `L${depth}` }));
  }
  chain.push(category({ id: 8, name: "X" }));
  chain.push(category({ id: 9, parentId: 8, name: "Y" }));
  chain.push(category({ id: 10, parentId: 9, name: "Z" }));
  const database = createFakeItemCatalogDatabase({ categories: chain });
  const { service } = createService({ database, categoryMaxDepth: 8 });

  // 把 X（連同它底下的 Y、Z）移到 G 底下：X 的新 depth 會是 8，
  // 而 X 自己的子孫還要再往下兩層（Z 落在 depth 10）——超過上限 8。
  await assert.rejects(
    service.updateCategory({ ...ADMIN_ACTOR, id: 8, name: "X", parentId: 7, sortOrder: 0, version: 1 }),
    (error) => {
      assert.equal(error.code, "CATEGORY_MAX_DEPTH_EXCEEDED");
      return true;
    }
  );
});

test("updateCategory allows moving to root level and re-validates the resulting depth", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "A" }), category({ id: 2, parentId: 1, name: "B" })]
  });
  const { service } = createService({ database });

  const moved = await service.updateCategory({
    ...ADMIN_ACTOR,
    id: 2,
    name: "B",
    parentId: null,
    sortOrder: 0,
    version: 1
  });

  assert.equal(moved.parentId, null);
});

// --- 狀態變更 -----------------------------------------------------------------

test("activateCategory moves inactive to active", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "A", status: "inactive" })]
  });
  const { service } = createService({ database });

  const result = await service.activateCategory({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "重新上架" });

  assert.equal(result.status, "active");
});

test("deactivateCategory moves active to inactive", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "A", status: "active" })]
  });
  const { service } = createService({ database });

  const result = await service.deactivateCategory({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "暫停使用" });

  assert.equal(result.status, "inactive");
});

test("a status transition that isn't allowed from the current status is rejected", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "A", status: "archived" })]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.activateCategory({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "重新上架" }),
    (error) => {
      assert.equal(error.code, "STATUS_TRANSITION_INVALID");
      return true;
    }
  );
});

test("archiveCategory works from both active and inactive", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [
      category({ id: 1, name: "A", status: "active" }),
      category({ id: 2, name: "B", status: "inactive" })
    ]
  });
  const { service } = createService({ database });

  const fromActive = await service.archiveCategory({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "停產" });
  const fromInactive = await service.archiveCategory({ ...ADMIN_ACTOR, id: 2, version: 1, reason: "停產" });

  assert.equal(fromActive.status, "archived");
  assert.equal(fromInactive.status, "archived");
});

test("restoreCategory only returns to inactive, never straight to active", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "A", status: "archived" })]
  });
  const { service } = createService({ database });

  const result = await service.restoreCategory({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "業務要求恢復" });

  assert.equal(result.status, "inactive");
});

test("a status transition with a stale version is a VERSION_CONFLICT, not a STATUS_TRANSITION_INVALID", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "A", status: "active", version: 5 })]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.deactivateCategory({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "暫停使用" }),
    (error) => {
      assert.equal(error.code, "VERSION_CONFLICT");
      return true;
    }
  );
});

// --- deleteCategory ------------------------------------------------------------

test("deleteCategory removes an unreferenced, childless category and records the reason", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "A" })]
  });
  const { service } = createService({ database });

  const result = await service.deleteCategory({
    ...ADMIN_ACTOR,
    id: 1,
    version: 1,
    reason: "建立錯誤，未曾使用"
  });

  assert.equal(result.id, 1);
  assert.equal(database.state.categories.has(1), false);
  const auditRow = database.state.auditRows.at(-1);
  assert.equal(auditRow[3], "category.delete");
  assert.equal(auditRow[7], "建立錯誤，未曾使用");
});

test("deleteCategory rejects a category that still has children", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "A" }), category({ id: 2, parentId: 1, name: "Child" })]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.deleteCategory({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "嘗試刪除" }),
    (error) => {
      assert.equal(error.code, "CATEGORY_HAS_CHILDREN");
      return true;
    }
  );
  assert.equal(database.state.categories.has(1), true);
});

test("deleteCategory with a stale version leaves the row untouched", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "A", version: 4 })]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.deleteCategory({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "嘗試刪除" }),
    (error) => {
      assert.equal(error.code, "VERSION_CONFLICT");
      return true;
    }
  );
  assert.equal(database.state.categories.has(1), true);
});

// --- audit：呼叫方 connection ----------------------------------------------------

test("every write uses the transaction's connection for its audit row, not a second connection", async () => {
  const database = createFakeItemCatalogDatabase();
  const { service } = createService({ database });

  await service.createCategory({ ...ADMIN_ACTOR, name: "Vitamins" });

  // 假資料庫的 withTransaction 只把 { query, execute } 交給 callback；
  // 如果 record() 繞過它另開一條連線，這個假資料庫的寫入處理器完全接不到，
  // audit row 就不會出現在 state.auditRows 裡——這個斷言本身就是那個防線。
  assert.equal(database.state.auditRows.length, 1);
});
