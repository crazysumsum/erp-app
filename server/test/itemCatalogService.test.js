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

// ============================================================================
// Brand
// ============================================================================

function brand({ id, name, officialName = "", description = "", status = "active", version = 1 }) {
  return {
    id,
    name,
    official_name: officialName,
    description,
    status,
    version,
    created_at: NOW_MS - 1000,
    updated_at: NOW_MS - 1000,
    created_by: 10,
    updated_by: 10
  };
}

test("createBrand creates an active brand and records an audit row", async () => {
  const database = createFakeItemCatalogDatabase();
  const { service } = createService({ database });

  const created = await service.createBrand({ ...ADMIN_ACTOR, name: "Brand A", officialName: "Brand A Ltd." });

  assert.equal(created.name, "Brand A");
  assert.equal(created.officialName, "Brand A Ltd.");
  assert.equal(created.status, "active");
  assert.equal(database.state.auditRows.at(-1)[3], "brand.create");
});

test("createBrand rejects a duplicate name case-insensitively", async () => {
  const database = createFakeItemCatalogDatabase({ brands: [brand({ id: 1, name: "Brand A" })] });
  const { service } = createService({ database });

  await assert.rejects(
    service.createBrand({ ...ADMIN_ACTOR, name: "brand a" }),
    (error) => {
      assert.equal(error.code, "BRAND_NAME_TAKEN");
      return true;
    }
  );
});

test("listBrands paginates, filters by status and search term, and sorts", async () => {
  const database = createFakeItemCatalogDatabase({
    brands: [
      brand({ id: 1, name: "Alpha" }),
      brand({ id: 2, name: "Beta", status: "inactive" }),
      brand({ id: 3, name: "Gamma" })
    ]
  });
  const { service } = createService({ database });

  const all = await service.listBrands({ ...ADMIN_ACTOR, page: 1, pageSize: 20 });
  assert.equal(all.total, 3);
  assert.deepEqual(all.items.map((b) => b.name), ["Alpha", "Beta", "Gamma"]);

  const activeOnly = await service.listBrands({ ...ADMIN_ACTOR, page: 1, pageSize: 20, status: "active" });
  assert.equal(activeOnly.total, 2);

  const searched = await service.listBrands({ ...ADMIN_ACTOR, page: 1, pageSize: 20, q: "amm" });
  assert.deepEqual(searched.items.map((b) => b.name), ["Gamma"]);

  const firstPage = await service.listBrands({ ...ADMIN_ACTOR, page: 1, pageSize: 2 });
  assert.equal(firstPage.items.length, 2);
  const secondPage = await service.listBrands({ ...ADMIN_ACTOR, page: 2, pageSize: 2 });
  assert.equal(secondPage.items.length, 1);

  const descending = await service.listBrands({
    ...ADMIN_ACTOR,
    page: 1,
    pageSize: 20,
    sortBy: "name",
    descending: true
  });
  assert.deepEqual(descending.items.map((b) => b.name), ["Gamma", "Beta", "Alpha"]);
});

test("updateBrand renames and bumps version, rejecting a stale version without writing", async () => {
  const database = createFakeItemCatalogDatabase({ brands: [brand({ id: 1, name: "Brand A", version: 2 })] });
  const { service } = createService({ database });

  await assert.rejects(
    service.updateBrand({
      ...ADMIN_ACTOR,
      id: 1,
      name: "Renamed",
      officialName: "",
      description: "",
      version: 1
    }),
    (error) => {
      assert.equal(error.code, "VERSION_CONFLICT");
      return true;
    }
  );

  const updated = await service.updateBrand({
    ...ADMIN_ACTOR,
    id: 1,
    name: "Renamed",
    officialName: "",
    description: "",
    version: 2
  });
  assert.equal(updated.name, "Renamed");
  assert.equal(updated.version, 3);
});

test("brand status transitions follow the same active/inactive/archived rules as category", async () => {
  const database = createFakeItemCatalogDatabase({
    brands: [brand({ id: 1, name: "Brand A", status: "inactive" })]
  });
  const { service } = createService({ database });

  const activated = await service.activateBrand({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "重新上架" });
  assert.equal(activated.status, "active");

  const archived = await service.archiveBrand({ ...ADMIN_ACTOR, id: 1, version: 2, reason: "停產" });
  assert.equal(archived.status, "archived");

  await assert.rejects(
    service.activateBrand({ ...ADMIN_ACTOR, id: 1, version: 3, reason: "重新上架" }),
    (error) => {
      assert.equal(error.code, "STATUS_TRANSITION_INVALID");
      return true;
    }
  );

  const restored = await service.restoreBrand({ ...ADMIN_ACTOR, id: 1, version: 3, reason: "業務要求恢復" });
  assert.equal(restored.status, "inactive");
});

test("deleteBrand removes the row and records the reason; a stale version leaves it untouched", async () => {
  const database = createFakeItemCatalogDatabase({ brands: [brand({ id: 1, name: "Brand A" })] });
  const { service } = createService({ database });

  await assert.rejects(
    service.deleteBrand({ ...ADMIN_ACTOR, id: 1, version: 99, reason: "建立錯誤" }),
    (error) => {
      assert.equal(error.code, "VERSION_CONFLICT");
      return true;
    }
  );
  assert.equal(database.state.brands.has(1), true);

  const result = await service.deleteBrand({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "建立錯誤" });
  assert.equal(result.id, 1);
  assert.equal(database.state.brands.has(1), false);
});

test("brand operations on an unknown id raise BRAND_NOT_FOUND", async () => {
  const database = createFakeItemCatalogDatabase();
  const { service } = createService({ database });

  await assert.rejects(
    service.updateBrand({ ...ADMIN_ACTOR, id: 999, name: "x", officialName: "", description: "", version: 1 }),
    (error) => {
      assert.equal(error.code, "BRAND_NOT_FOUND");
      return true;
    }
  );
});

// ============================================================================
// UOM
// ============================================================================

function uom({ id, code, name, symbol = "", status = "active", version = 1 }) {
  return {
    id,
    code,
    name,
    symbol,
    status,
    version,
    created_at: NOW_MS - 1000,
    updated_at: NOW_MS - 1000,
    created_by: 10,
    updated_by: 10
  };
}

test("createUom creates an active unit and records an audit row", async () => {
  const database = createFakeItemCatalogDatabase();
  const { service } = createService({ database });

  const created = await service.createUom({ ...ADMIN_ACTOR, code: "EA", name: "Each", symbol: "pcs" });

  assert.equal(created.code, "EA");
  assert.equal(created.status, "active");
  assert.equal(database.state.auditRows.at(-1)[3], "uom.create");
});

test("createUom rejects a duplicate code case-insensitively", async () => {
  const database = createFakeItemCatalogDatabase({ uoms: [uom({ id: 1, code: "EA", name: "Each" })] });
  const { service } = createService({ database });

  await assert.rejects(
    service.createUom({ ...ADMIN_ACTOR, code: "ea", name: "Duplicate" }),
    (error) => {
      assert.equal(error.code, "UOM_CODE_TAKEN");
      return true;
    }
  );
});

test("listUoms is not paginated, and excludes archived by default", async () => {
  const database = createFakeItemCatalogDatabase({
    uoms: [uom({ id: 1, code: "EA", name: "Each" }), uom({ id: 2, code: "BOX", name: "Box", status: "archived" })]
  });
  const { service } = createService({ database });

  const hidden = await service.listUoms(ADMIN_ACTOR);
  assert.deepEqual(hidden.items.map((u) => u.code), ["EA"]);

  const shown = await service.listUoms({ ...ADMIN_ACTOR, includeArchived: true });
  assert.deepEqual(shown.items.map((u) => u.code).sort(), ["BOX", "EA"]);
});

test("updateUom changes name/symbol but never accepts a code parameter to change", async () => {
  const database = createFakeItemCatalogDatabase({ uoms: [uom({ id: 1, code: "EA", name: "Each" })] });
  const { service } = createService({ database });

  const updated = await service.updateUom({
    ...ADMIN_ACTOR,
    id: 1,
    name: "Each Piece",
    symbol: "pc",
    version: 1
  });

  assert.equal(updated.name, "Each Piece");
  assert.equal(updated.code, "EA");
  assert.equal(updated.symbol, "pc");
});

test("uom status transitions and controlled delete behave like category/brand", async () => {
  const database = createFakeItemCatalogDatabase({
    uoms: [uom({ id: 1, code: "EA", name: "Each", status: "inactive" })]
  });
  const { service } = createService({ database });

  const activated = await service.activateUom({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "啟用" });
  assert.equal(activated.status, "active");

  const deactivated = await service.deactivateUom({ ...ADMIN_ACTOR, id: 1, version: 2, reason: "停用" });
  assert.equal(deactivated.status, "inactive");

  const deleted = await service.deleteUom({ ...ADMIN_ACTOR, id: 1, version: 3, reason: "建立錯誤" });
  assert.equal(deleted.id, 1);
  assert.equal(database.state.uoms.has(1), false);
});

// --- Attribute ---------------------------------------------------------------

function attribute({
  id,
  code,
  name,
  dataType = "text",
  uomId = null,
  isVariant = 0,
  isFilterable = 0,
  status = "active",
  version = 1
}) {
  return {
    id,
    code,
    name,
    data_type: dataType,
    uom_id: uomId,
    is_variant: isVariant,
    is_filterable: isFilterable,
    status,
    version,
    created_at: NOW_MS - 1000,
    updated_at: NOW_MS - 1000,
    created_by: 10,
    updated_by: 10
  };
}

function attributeOption({ id, attributeId, value, label, sortOrder = 0, status = "active", version = 1 }) {
  return {
    id,
    attribute_id: attributeId,
    value,
    label,
    sort_order: sortOrder,
    status,
    version,
    created_at: NOW_MS - 1000,
    updated_at: NOW_MS - 1000,
    created_by: 10,
    updated_by: 10
  };
}

test("createAttribute creates a single_option attribute with its options in one call", async () => {
  const database = createFakeItemCatalogDatabase();
  const { service } = createService({ database });

  const created = await service.createAttribute({
    ...ADMIN_ACTOR,
    code: "COLOR",
    name: "顏色",
    dataType: "single_option",
    isVariant: true,
    options: [
      { value: "red", label: "紅" },
      { value: "blue", label: "藍" }
    ]
  });

  assert.equal(created.code, "COLOR");
  assert.equal(created.dataType, "single_option");
  assert.equal(created.isVariant, true);
  assert.equal(created.options.length, 2);
  assert.deepEqual(created.options.map((o) => o.value).sort(), ["blue", "red"]);
  assert.equal(database.state.auditRows.at(-1)[3], "attribute.create");
});

test("createAttribute rejects a duplicate code", async () => {
  const database = createFakeItemCatalogDatabase({
    attributes: [attribute({ id: 1, code: "COLOR", name: "顏色", dataType: "single_option", isVariant: 1 })],
    attributeOptions: [attributeOption({ id: 1, attributeId: 1, value: "red", label: "紅" })]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.createAttribute({
      ...ADMIN_ACTOR,
      code: "COLOR",
      name: "另一個顏色",
      dataType: "single_option",
      options: [{ value: "green", label: "綠" }]
    }),
    (error) => {
      assert.equal(error.code, "ATTRIBUTE_CODE_TAKEN");
      return true;
    }
  );
});

test("createAttribute rejects a single_option attribute with no options", async () => {
  const database = createFakeItemCatalogDatabase();
  const { service } = createService({ database });

  await assert.rejects(
    service.createAttribute({ ...ADMIN_ACTOR, code: "COLOR", name: "顏色", dataType: "single_option", options: [] }),
    (error) => {
      assert.equal(error.code, "ATTRIBUTE_VALUE_INVALID");
      return true;
    }
  );
});

test("createAttribute rejects options on a non single_option attribute", async () => {
  const database = createFakeItemCatalogDatabase();
  const { service } = createService({ database });

  await assert.rejects(
    service.createAttribute({
      ...ADMIN_ACTOR,
      code: "WEIGHT",
      name: "重量",
      dataType: "decimal",
      options: [{ value: "x", label: "x" }]
    }),
    (error) => {
      assert.equal(error.code, "ATTRIBUTE_VALUE_INVALID");
      return true;
    }
  );
});

test("createAttribute rejects a duplicate option value within the same request", async () => {
  const database = createFakeItemCatalogDatabase();
  const { service } = createService({ database });

  await assert.rejects(
    service.createAttribute({
      ...ADMIN_ACTOR,
      code: "COLOR",
      name: "顏色",
      dataType: "single_option",
      options: [
        { value: "red", label: "紅" },
        { value: "red", label: "紅色" }
      ]
    }),
    (error) => {
      assert.equal(error.code, "ATTRIBUTE_OPTION_VALUE_TAKEN");
      return true;
    }
  );
});

test("createAttribute rejects uomId on a non-decimal attribute, and requires an existing UOM otherwise", async () => {
  const database = createFakeItemCatalogDatabase({ uoms: [uom({ id: 1, code: "KG", name: "Kilogram" })] });
  const { service } = createService({ database });

  await assert.rejects(
    service.createAttribute({ ...ADMIN_ACTOR, code: "COLOR", name: "顏色", dataType: "text", uomId: 1 }),
    (error) => {
      assert.equal(error.code, "ATTRIBUTE_VALUE_INVALID");
      return true;
    }
  );

  await assert.rejects(
    service.createAttribute({ ...ADMIN_ACTOR, code: "WEIGHT", name: "重量", dataType: "decimal", uomId: 999 }),
    (error) => {
      assert.equal(error.code, "UOM_NOT_FOUND");
      return true;
    }
  );

  const created = await service.createAttribute({
    ...ADMIN_ACTOR,
    code: "WEIGHT",
    name: "重量",
    dataType: "decimal",
    uomId: 1
  });
  assert.equal(created.uomId, 1);
});

test("listAttributes paginates and attaches each attribute's options", async () => {
  const database = createFakeItemCatalogDatabase({
    attributes: [
      attribute({ id: 1, code: "COLOR", name: "顏色", dataType: "single_option", isVariant: 1 }),
      attribute({ id: 2, code: "WEIGHT", name: "重量", dataType: "decimal" })
    ],
    attributeOptions: [
      attributeOption({ id: 1, attributeId: 1, value: "red", label: "紅" }),
      attributeOption({ id: 2, attributeId: 1, value: "blue", label: "藍" })
    ]
  });
  const { service } = createService({ database });

  const { items, total } = await service.listAttributes(ADMIN_ACTOR);

  assert.equal(total, 2);
  const color = items.find((row) => row.code === "COLOR");
  assert.equal(color.options.length, 2);
  const weight = items.find((row) => row.code === "WEIGHT");
  assert.equal(weight.options.length, 0);
});

test("updateAttribute renames and atomically overwrites the option set (add/update/remove)", async () => {
  const database = createFakeItemCatalogDatabase({
    attributes: [attribute({ id: 1, code: "COLOR", name: "顏色", dataType: "single_option", isVariant: 1 })],
    attributeOptions: [
      attributeOption({ id: 1, attributeId: 1, value: "red", label: "紅" }),
      attributeOption({ id: 2, attributeId: 1, value: "blue", label: "藍" })
    ]
  });
  const { service } = createService({ database });

  const updated = await service.updateAttribute({
    ...ADMIN_ACTOR,
    id: 1,
    name: "顏色（修訂）",
    isVariant: true,
    isFilterable: true,
    options: [
      { id: 1, value: "red", label: "大紅" },
      { value: "green", label: "綠" }
    ],
    version: 1
  });

  assert.equal(updated.name, "顏色（修訂）");
  assert.equal(updated.isFilterable, true);
  assert.deepEqual(updated.options.map((o) => o.value).sort(), ["green", "red"]);
  assert.equal(updated.options.find((o) => o.value === "red").label, "大紅");
  assert.equal(database.state.attributeOptions.has(2), false, "the option dropped from the payload is deleted");
});

test("updateAttribute rejects an option id that doesn't belong to this attribute", async () => {
  const database = createFakeItemCatalogDatabase({
    attributes: [
      attribute({ id: 1, code: "COLOR", name: "顏色", dataType: "single_option", isVariant: 1 }),
      attribute({ id: 2, code: "SIZE", name: "尺寸", dataType: "single_option", isVariant: 1 })
    ],
    attributeOptions: [attributeOption({ id: 1, attributeId: 2, value: "s", label: "細" })]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.updateAttribute({
      ...ADMIN_ACTOR,
      id: 1,
      name: "顏色",
      isVariant: true,
      isFilterable: false,
      options: [{ id: 1, value: "s", label: "細" }],
      version: 1
    }),
    (error) => {
      assert.equal(error.code, "ATTRIBUTE_OPTION_NOT_FOUND");
      return true;
    }
  );
});

test("updateAttribute rejects a stale version without writing", async () => {
  const database = createFakeItemCatalogDatabase({
    attributes: [attribute({ id: 1, code: "WEIGHT", name: "重量", dataType: "decimal" })]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.updateAttribute({
      ...ADMIN_ACTOR,
      id: 1,
      name: "重量（改壞）",
      isVariant: false,
      isFilterable: false,
      options: [],
      version: 99
    }),
    (error) => {
      assert.equal(error.code, "VERSION_CONFLICT");
      return true;
    }
  );
  assert.equal(database.state.attributes.get(1).name, "重量");
});

test("updateAttribute locks isVariant once the attribute is used by a SKU's variant values", async () => {
  const database = createFakeItemCatalogDatabase({
    attributes: [attribute({ id: 1, code: "COLOR", name: "顏色", dataType: "single_option", isVariant: 1 })],
    attributeOptions: [attributeOption({ id: 1, attributeId: 1, value: "red", label: "紅" })],
    skuAttributeValueAttributeIds: [1]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.updateAttribute({
      ...ADMIN_ACTOR,
      id: 1,
      name: "顏色",
      isVariant: false,
      isFilterable: false,
      options: [{ id: 1, value: "red", label: "紅" }],
      version: 1
    }),
    (error) => {
      assert.equal(error.code, "ATTRIBUTE_IN_USE");
      return true;
    }
  );

  // isVariant 冇改就唔受呢個限制，即使已經被用緊。
  const updated = await service.updateAttribute({
    ...ADMIN_ACTOR,
    id: 1,
    name: "顏色（改名）",
    isVariant: true,
    isFilterable: false,
    options: [{ id: 1, value: "red", label: "紅" }],
    version: 1
  });
  assert.equal(updated.name, "顏色（改名）");
});

test("attribute status transitions and delete behave like category/brand/uom", async () => {
  const database = createFakeItemCatalogDatabase({
    attributes: [attribute({ id: 1, code: "WEIGHT", name: "重量", dataType: "decimal", status: "inactive" })]
  });
  const { service } = createService({ database });

  const activated = await service.activateAttribute({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "啟用" });
  assert.equal(activated.status, "active");

  const deactivated = await service.deactivateAttribute({ ...ADMIN_ACTOR, id: 1, version: 2, reason: "停用" });
  assert.equal(deactivated.status, "inactive");

  const deleted = await service.deleteAttribute({ ...ADMIN_ACTOR, id: 1, version: 3, reason: "建立錯誤" });
  assert.equal(deleted.id, 1);
  assert.equal(database.state.attributes.has(1), false);
});

test("deleteAttribute is blocked while a category rule or SKU value still references it", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "Vitamins" })],
    attributes: [attribute({ id: 1, code: "COLOR", name: "顏色", dataType: "single_option", isVariant: 1 })],
    categoryAttributes: [{ category_id: 1, attribute_id: 1, required_for_activation: 0, sort_order: 0 }]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.deleteAttribute({ ...ADMIN_ACTOR, id: 1, version: 1, reason: "刪除" }),
    (error) => {
      assert.equal(error.code, "CATALOG_IN_USE");
      return true;
    }
  );
});

// --- Category attribute assignment --------------------------------------------

test("getCategoryAttributes returns the current assignment", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "Vitamins" })],
    attributes: [attribute({ id: 1, code: "COLOR", name: "顏色", dataType: "single_option", isVariant: 1 })],
    categoryAttributes: [{ category_id: 1, attribute_id: 1, required_for_activation: 1, sort_order: 0 }]
  });
  const { service } = createService({ database });

  const { categoryId, assignments } = await service.getCategoryAttributes({ ...ADMIN_ACTOR, categoryId: 1 });

  assert.equal(categoryId, 1);
  assert.deepEqual(assignments, [{ attributeId: 1, requiredForActivation: true, sortOrder: 0 }]);
});

test("assignAttributes atomically overwrites the mapping (add/update/remove) and records one audit row", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "Vitamins" })],
    attributes: [
      attribute({ id: 1, code: "COLOR", name: "顏色", dataType: "single_option", isVariant: 1 }),
      attribute({ id: 2, code: "FLAVOR", name: "口味", dataType: "single_option", isVariant: 1 })
    ],
    categoryAttributes: [{ category_id: 1, attribute_id: 1, required_for_activation: 0, sort_order: 0 }]
  });
  const { service } = createService({ database });

  const result = await service.assignAttributes({
    ...ADMIN_ACTOR,
    categoryId: 1,
    assignments: [
      { attributeId: 1, requiredForActivation: true, sortOrder: 0 },
      { attributeId: 2, requiredForActivation: false, sortOrder: 1 }
    ],
    expectedAttributeIds: [1]
  });

  assert.deepEqual(
    result.assignments.map((a) => a.attributeId).sort(),
    [1, 2]
  );
  assert.equal(result.assignments.find((a) => a.attributeId === 1).requiredForActivation, true);
  assert.equal(database.state.auditRows.at(-1)[3], "category.attributes.assign");
  assert.deepEqual(JSON.parse(database.state.auditRows.at(-1)[8]), {
    added: [{ attributeId: 2, requiredForActivation: false, sortOrder: 1 }],
    removed: [],
    updated: [
      {
        before: { attributeId: 1, requiredForActivation: false, sortOrder: 0 },
        after: { attributeId: 1, requiredForActivation: true, sortOrder: 0 }
      }
    ]
  });
});

test("assignAttributes rejects a stale expectedAttributeIds without writing", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "Vitamins" })],
    attributes: [attribute({ id: 1, code: "COLOR", name: "顏色", dataType: "single_option", isVariant: 1 })],
    categoryAttributes: [{ category_id: 1, attribute_id: 1, required_for_activation: 0, sort_order: 0 }]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.assignAttributes({
      ...ADMIN_ACTOR,
      categoryId: 1,
      assignments: [{ attributeId: 1, requiredForActivation: true, sortOrder: 0 }],
      // 呼叫端以為呢個 category 而家冇任何屬性規則（過期嘅前端快照），實際已有一個。
      expectedAttributeIds: []
    }),
    (error) => {
      assert.equal(error.code, "CATEGORY_ATTRIBUTES_STALE");
      return true;
    }
  );
  assert.equal(database.state.categoryAttributes.get("1::1").required_for_activation, 0);
});

test("assignAttributes rejects a duplicate attributeId within the same request", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [category({ id: 1, name: "Vitamins" })],
    attributes: [attribute({ id: 1, code: "COLOR", name: "顏色", dataType: "single_option", isVariant: 1 })]
  });
  const { service } = createService({ database });

  await assert.rejects(
    service.assignAttributes({
      ...ADMIN_ACTOR,
      categoryId: 1,
      assignments: [
        { attributeId: 1, requiredForActivation: true, sortOrder: 0 },
        { attributeId: 1, requiredForActivation: false, sortOrder: 1 }
      ],
      expectedAttributeIds: []
    }),
    (error) => {
      assert.equal(error.code, "ATTRIBUTE_VALUE_INVALID");
      return true;
    }
  );
});
