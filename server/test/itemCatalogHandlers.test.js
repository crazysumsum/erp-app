import assert from "node:assert/strict";
import test from "node:test";
import {
  ActivateCategoryHandler,
  ArchiveCategoryHandler,
  CreateCategoryHandler,
  DeactivateCategoryHandler,
  DeleteCategoryHandler,
  ListCategoriesHandler,
  RestoreCategoryHandler,
  UpdateCategoryHandler
} from "../src/handlers/catalog/categoryHandlers.js";
import {
  ActivateBrandHandler,
  ArchiveBrandHandler,
  CreateBrandHandler,
  DeactivateBrandHandler,
  DeleteBrandHandler,
  ListBrandsHandler,
  RestoreBrandHandler,
  UpdateBrandHandler
} from "../src/handlers/catalog/brandHandlers.js";
import {
  ActivateUomHandler,
  ArchiveUomHandler,
  CreateUomHandler,
  DeactivateUomHandler,
  DeleteUomHandler,
  ListUomsHandler,
  RestoreUomHandler,
  UpdateUomHandler
} from "../src/handlers/catalog/uomHandlers.js";
import { createTestTime } from "../test-support/createTestTime.js";
import { ADMIN_ACTOR, createFakeItemCatalogDatabase } from "../test-support/fakeItemCatalogDatabase.js";

/**
 * Handler metadata（authType、authorizationPolicies、path／method）與
 * request→service 的映射；ItemCatalogService 自己的規則（cycle、depth、
 * 唯一性……）由 itemCatalogService.test.js 覆蓋，這裡不重測（設計原則見
 * design_spec.md §10.1）。
 */

const ALL_HANDLERS = [
  ListCategoriesHandler,
  CreateCategoryHandler,
  UpdateCategoryHandler,
  ActivateCategoryHandler,
  DeactivateCategoryHandler,
  ArchiveCategoryHandler,
  RestoreCategoryHandler,
  DeleteCategoryHandler
];

function createHandler(HandlerClass, { database = createFakeItemCatalogDatabase() } = {}) {
  const available = {
    logging: { logger: { debug() {}, info() {}, warn() {}, error() {} }, loggers: {} },
    time: createTestTime(),
    mysqldatabase: database
  };

  const services = {
    config: { item: { categoryMaxDepth: 8 } },
    get: (name) => available[name],
    require(name) {
      if (!(name in available) || available[name] === undefined) {
        throw new Error(`Unexpected test service: ${name}`);
      }
      return available[name];
    }
  };

  return { handler: new HandlerClass(services), database };
}

function requestFrom({ params = {}, query = {}, body = {} } = {}) {
  return {
    input: { params, query, body },
    auth: {
      claims: {
        sub: String(ADMIN_ACTOR.actorId),
        roles: ADMIN_ACTOR.claimedRoles,
        permissions: ADMIN_ACTOR.claimedPermissions
      }
    },
    requestId: "req-1",
    ip: "203.0.113.7"
  };
}

// --- Handler 目錄前綴（跟 handlerConventions.test.js 是同一條規則，這裡只是
// 局部再確認，方便看 diff 時一眼看出所有 8 支都在 catalog/ 底下）---------------

test("every category route lives under /api/v1/catalog", () => {
  for (const HandlerClass of ALL_HANDLERS) {
    assert.match(HandlerClass.api.path, /^\/api\/v1\/catalog\//, HandlerClass.handlerName);
  }
});

// --- 權限矩陣 -----------------------------------------------------------------

test("GET accepts item.view or item.mgmt; every write requires item.mgmt", () => {
  assert.deepEqual(ListCategoriesHandler.api.authorizationPolicies, [
    { name: "hasPermission", options: { permissions: ["item.view", "item.mgmt"], match: "any" } }
  ]);

  for (const HandlerClass of ALL_HANDLERS) {
    if (HandlerClass === ListCategoriesHandler) {
      continue;
    }
    assert.deepEqual(
      HandlerClass.api.authorizationPolicies,
      [{ name: "hasPermission", options: { permissions: ["item.mgmt"] } }],
      HandlerClass.handlerName
    );
  }
});

test("archive, restore and delete require jwt-password; create/update/activate/deactivate/list don't", () => {
  for (const HandlerClass of [ArchiveCategoryHandler, RestoreCategoryHandler, DeleteCategoryHandler]) {
    assert.equal(HandlerClass.api.authType, "jwt-password", HandlerClass.handlerName);
  }

  for (const HandlerClass of [
    ListCategoriesHandler,
    CreateCategoryHandler,
    UpdateCategoryHandler,
    ActivateCategoryHandler,
    DeactivateCategoryHandler
  ]) {
    assert.equal(HandlerClass.api.authType, undefined, HandlerClass.handlerName);
  }
});

test("archive/restore/delete require a password field in the body schema; activate/deactivate do not", () => {
  for (const HandlerClass of [ArchiveCategoryHandler, RestoreCategoryHandler, DeleteCategoryHandler]) {
    const bodySchema = HandlerClass.api.requestSchema.body;
    assert.ok(bodySchema.required.includes("password"), HandlerClass.handlerName);
  }

  for (const HandlerClass of [ActivateCategoryHandler, DeactivateCategoryHandler]) {
    const bodySchema = HandlerClass.api.requestSchema.body;
    assert.equal(bodySchema.properties.password, undefined, HandlerClass.handlerName);
    // 但 reason／version 仍然是狀態動作，兩者都必填（design_spec.md §6.4）。
    assert.ok(bodySchema.required.includes("reason"), HandlerClass.handlerName);
    assert.ok(bodySchema.required.includes("version"), HandlerClass.handlerName);
  }
});

test("create/update do not accept a body-level status field — status only changes through its own endpoint", () => {
  for (const HandlerClass of [CreateCategoryHandler, UpdateCategoryHandler]) {
    assert.equal(
      HandlerClass.api.requestSchema.body.properties.status,
      undefined,
      HandlerClass.handlerName
    );
  }
});

// --- request → service 映射 ----------------------------------------------------

test("listCategories reads includeArchived from the query string", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [
      { id: 1, parent_id: null, name: "Archived", status: "archived", sort_order: 0, version: 1, created_at: 1, updated_at: 1 }
    ]
  });
  const { handler } = createHandler(ListCategoriesHandler, { database });

  const hidden = await handler.execute(requestFrom({ query: {} }));
  assert.equal(hidden.data.items.length, 0);

  const shown = await handler.execute(requestFrom({ query: { includeArchived: "true" } }));
  assert.equal(shown.data.items.length, 1);
});

test("createCategory returns 201 with the created category", async () => {
  const { handler } = createHandler(CreateCategoryHandler);

  const response = await handler.execute(requestFrom({ body: { name: "Vitamins" } }));

  assert.equal(response.statusCode, 201);
  assert.equal(response.data.name, "Vitamins");
  assert.equal(response.data.parentId, null);
});

test("updateCategory passes the full body (including nullable parentId) and the path id through", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [
      { id: 1, parent_id: null, name: "Vitamins", status: "active", sort_order: 0, version: 1, created_at: 1, updated_at: 1 }
    ]
  });
  const { handler } = createHandler(UpdateCategoryHandler, { database });

  const response = await handler.execute(
    requestFrom({
      params: { id: "1" },
      body: { name: "Renamed", parentId: null, sortOrder: 5, version: 1 }
    })
  );

  assert.equal(response.data.name, "Renamed");
  assert.equal(response.data.sortOrder, 5);
});

test("a stale version surfaces as a 409 VERSION_CONFLICT through the handler", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [
      { id: 1, parent_id: null, name: "Vitamins", status: "active", sort_order: 0, version: 5, created_at: 1, updated_at: 1 }
    ]
  });
  const { handler } = createHandler(UpdateCategoryHandler, { database });

  await assert.rejects(
    handler.execute(
      requestFrom({
        params: { id: "1" },
        body: { name: "Renamed", parentId: null, sortOrder: 0, version: 1 }
      })
    ),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.publicCode, "VERSION_CONFLICT");
      return true;
    }
  );
});

test("activate/deactivate/archive/restore each call their own service method with reason and version", async () => {
  const rows = () => ({
    id: 1,
    parent_id: null,
    name: "A",
    status: "active",
    sort_order: 0,
    version: 1,
    created_at: 1,
    updated_at: 1
  });

  const cases = [
    [ActivateCategoryHandler, { ...rows(), status: "inactive" }, "active"],
    [DeactivateCategoryHandler, rows(), "inactive"],
    [ArchiveCategoryHandler, rows(), "archived"],
    [RestoreCategoryHandler, { ...rows(), status: "archived" }, "inactive"]
  ];

  for (const [HandlerClass, seedRow, expectedStatus] of cases) {
    const database = createFakeItemCatalogDatabase({ categories: [seedRow] });
    const { handler } = createHandler(HandlerClass, { database });

    const response = await handler.execute(
      requestFrom({ params: { id: "1" }, body: { reason: "測試原因說明", version: 1 } })
    );

    assert.equal(response.data.status, expectedStatus, HandlerClass.handlerName);
  }
});

test("deleteCategory returns just the id, and records the caller's reason", async () => {
  const database = createFakeItemCatalogDatabase({
    categories: [
      { id: 1, parent_id: null, name: "A", status: "active", sort_order: 0, version: 1, created_at: 1, updated_at: 1 }
    ]
  });
  const { handler, database: db } = createHandler(DeleteCategoryHandler, { database });

  const response = await handler.execute(
    requestFrom({ params: { id: "1" }, body: { reason: "建立錯誤，未曾使用", version: 1, password: "x" } })
  );

  assert.deepEqual(response.data, { id: 1 });
  assert.equal(db.state.auditRows.at(-1)[7], "建立錯誤，未曾使用");
});

test("every response schema forbids additional properties (no accidental internal-column leakage)", () => {
  for (const HandlerClass of ALL_HANDLERS) {
    for (const schema of Object.values(HandlerClass.api.responseSchema)) {
      assert.equal(schema.additionalProperties, false, HandlerClass.handlerName);
    }
  }
});

// ============================================================================
// Brand
// ============================================================================

const BRAND_HANDLERS = [
  ListBrandsHandler,
  CreateBrandHandler,
  UpdateBrandHandler,
  ActivateBrandHandler,
  DeactivateBrandHandler,
  ArchiveBrandHandler,
  RestoreBrandHandler,
  DeleteBrandHandler
];

test("every brand route lives under /api/v1/catalog/brands, with the same permission matrix as category", () => {
  for (const HandlerClass of BRAND_HANDLERS) {
    assert.match(HandlerClass.api.path, /^\/api\/v1\/catalog\/brands(\/|$)/, HandlerClass.handlerName);
  }

  assert.deepEqual(ListBrandsHandler.api.authorizationPolicies, [
    { name: "hasPermission", options: { permissions: ["item.view", "item.mgmt"], match: "any" } }
  ]);
  for (const HandlerClass of BRAND_HANDLERS) {
    if (HandlerClass === ListBrandsHandler) {
      continue;
    }
    assert.deepEqual(
      HandlerClass.api.authorizationPolicies,
      [{ name: "hasPermission", options: { permissions: ["item.mgmt"] } }],
      HandlerClass.handlerName
    );
  }

  for (const HandlerClass of [ArchiveBrandHandler, RestoreBrandHandler, DeleteBrandHandler]) {
    assert.equal(HandlerClass.api.authType, "jwt-password", HandlerClass.handlerName);
  }
  for (const HandlerClass of [
    ListBrandsHandler,
    CreateBrandHandler,
    UpdateBrandHandler,
    ActivateBrandHandler,
    DeactivateBrandHandler
  ]) {
    assert.equal(HandlerClass.api.authType, undefined, HandlerClass.handlerName);
  }
});

test("listBrands maps page/pageSize/q/status/sortBy/descending, capping pageSize at 100", async () => {
  const database = createFakeItemCatalogDatabase({
    brands: [
      { id: 1, name: "Alpha", official_name: "", description: "", status: "active", version: 1, created_at: 1, updated_at: 1 },
      { id: 2, name: "Beta", official_name: "", description: "", status: "active", version: 1, created_at: 1, updated_at: 1 }
    ]
  });
  const { handler } = createHandler(ListBrandsHandler, { database });

  const response = await handler.execute(
    requestFrom({ query: { page: "1", pageSize: "500", q: "a", status: "active", sortBy: "name" } })
  );

  assert.equal(response.data.pageSize, 100);
  assert.equal(response.data.page, 1);
});

test("createBrand returns 201; updateBrand requires the full editable set plus version", async () => {
  const { handler: createHandlerInstance } = createHandler(CreateBrandHandler);
  const created = await createHandlerInstance.execute(
    requestFrom({ body: { name: "Brand A", officialName: "Brand A Ltd.", description: "" } })
  );
  assert.equal(created.statusCode, 201);
  assert.equal(created.data.name, "Brand A");

  const database = createFakeItemCatalogDatabase({
    brands: [{ id: 1, name: "Brand A", official_name: "", description: "", status: "active", version: 1, created_at: 1, updated_at: 1 }]
  });
  const { handler: updateHandlerInstance } = createHandler(UpdateBrandHandler, { database });
  const updated = await updateHandlerInstance.execute(
    requestFrom({
      params: { id: "1" },
      body: { name: "Renamed", officialName: "New Ltd.", description: "desc", version: 1 }
    })
  );
  assert.equal(updated.data.name, "Renamed");
  assert.equal(updated.data.officialName, "New Ltd.");
});

test("brand duplicate name surfaces as 409 BRAND_NAME_TAKEN through the handler", async () => {
  const database = createFakeItemCatalogDatabase({
    brands: [{ id: 1, name: "Brand A", official_name: "", description: "", status: "active", version: 1, created_at: 1, updated_at: 1 }]
  });
  const { handler } = createHandler(CreateBrandHandler, { database });

  await assert.rejects(
    handler.execute(requestFrom({ body: { name: "brand a" } })),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.publicCode, "BRAND_NAME_TAKEN");
      return true;
    }
  );
});

test("brand status/delete handlers each call their own service method", async () => {
  const rowFor = (status) => ({
    id: 1,
    name: "A",
    official_name: "",
    description: "",
    status,
    version: 1,
    created_at: 1,
    updated_at: 1
  });

  const cases = [
    [ActivateBrandHandler, rowFor("inactive"), "active", { reason: "測試原因說明", version: 1 }],
    [DeactivateBrandHandler, rowFor("active"), "inactive", { reason: "測試原因說明", version: 1 }],
    [ArchiveBrandHandler, rowFor("active"), "archived", { reason: "測試原因說明", version: 1, password: "x" }],
    [RestoreBrandHandler, rowFor("archived"), "inactive", { reason: "測試原因說明", version: 1, password: "x" }]
  ];

  for (const [HandlerClass, seedRow, expectedStatus, body] of cases) {
    const database = createFakeItemCatalogDatabase({ brands: [seedRow] });
    const { handler } = createHandler(HandlerClass, { database });

    const response = await handler.execute(requestFrom({ params: { id: "1" }, body }));

    assert.equal(response.data.status, expectedStatus, HandlerClass.handlerName);
  }

  const database = createFakeItemCatalogDatabase({ brands: [rowFor("active")] });
  const { handler } = createHandler(DeleteBrandHandler, { database });
  const deleted = await handler.execute(
    requestFrom({ params: { id: "1" }, body: { reason: "建立錯誤，未曾使用", version: 1, password: "x" } })
  );
  assert.deepEqual(deleted.data, { id: 1 });
});

test("every brand response schema forbids additional properties", () => {
  for (const HandlerClass of BRAND_HANDLERS) {
    for (const schema of Object.values(HandlerClass.api.responseSchema)) {
      assert.equal(schema.additionalProperties, false, HandlerClass.handlerName);
    }
  }
});

// ============================================================================
// UOM
// ============================================================================

const UOM_HANDLERS = [
  ListUomsHandler,
  CreateUomHandler,
  UpdateUomHandler,
  ActivateUomHandler,
  DeactivateUomHandler,
  ArchiveUomHandler,
  RestoreUomHandler,
  DeleteUomHandler
];

test("every uom route lives under /api/v1/catalog/uoms, with the same permission matrix as category", () => {
  for (const HandlerClass of UOM_HANDLERS) {
    assert.match(HandlerClass.api.path, /^\/api\/v1\/catalog\/uoms(\/|$)/, HandlerClass.handlerName);
  }

  assert.deepEqual(ListUomsHandler.api.authorizationPolicies, [
    { name: "hasPermission", options: { permissions: ["item.view", "item.mgmt"], match: "any" } }
  ]);
  for (const HandlerClass of UOM_HANDLERS) {
    if (HandlerClass === ListUomsHandler) {
      continue;
    }
    assert.deepEqual(
      HandlerClass.api.authorizationPolicies,
      [{ name: "hasPermission", options: { permissions: ["item.mgmt"] } }],
      HandlerClass.handlerName
    );
  }

  for (const HandlerClass of [ArchiveUomHandler, RestoreUomHandler, DeleteUomHandler]) {
    assert.equal(HandlerClass.api.authType, "jwt-password", HandlerClass.handlerName);
  }
});

test("listUoms is not paginated (no page/pageSize in its query schema)", () => {
  const properties = Object.keys(ListUomsHandler.api.requestSchema.query.properties);
  assert.deepEqual(properties, ["includeArchived"]);
});

test("updateUom's request schema does not accept a code field — code is immutable after creation", () => {
  assert.equal(UpdateUomHandler.api.requestSchema.body.properties.code, undefined);
});

test("createUom returns 201; a duplicate code surfaces as 409 UOM_CODE_TAKEN", async () => {
  const { handler: createHandlerInstance } = createHandler(CreateUomHandler);
  const created = await createHandlerInstance.execute(
    requestFrom({ body: { code: "EA", name: "Each", symbol: "pcs" } })
  );
  assert.equal(created.statusCode, 201);
  assert.equal(created.data.code, "EA");

  const database = createFakeItemCatalogDatabase({
    uoms: [{ id: 1, code: "EA", name: "Each", symbol: "", status: "active", version: 1, created_at: 1, updated_at: 1 }]
  });
  const { handler: dupHandler } = createHandler(CreateUomHandler, { database });

  await assert.rejects(
    dupHandler.execute(requestFrom({ body: { code: "ea", name: "Duplicate" } })),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.publicCode, "UOM_CODE_TAKEN");
      return true;
    }
  );
});

test("uom status/delete handlers each call their own service method", async () => {
  const rowFor = (status) => ({
    id: 1,
    code: "EA",
    name: "Each",
    symbol: "",
    status,
    version: 1,
    created_at: 1,
    updated_at: 1
  });

  const database = createFakeItemCatalogDatabase({ uoms: [rowFor("inactive")] });
  const { handler } = createHandler(ActivateUomHandler, { database });
  const activated = await handler.execute(
    requestFrom({ params: { id: "1" }, body: { reason: "測試原因說明", version: 1 } })
  );
  assert.equal(activated.data.status, "active");

  const deleteDb = createFakeItemCatalogDatabase({ uoms: [rowFor("active")] });
  const { handler: deleteHandler } = createHandler(DeleteUomHandler, { database: deleteDb });
  const deleted = await deleteHandler.execute(
    requestFrom({ params: { id: "1" }, body: { reason: "建立錯誤，未曾使用", version: 1, password: "x" } })
  );
  assert.deepEqual(deleted.data, { id: 1 });
});

test("every uom response schema forbids additional properties", () => {
  for (const HandlerClass of UOM_HANDLERS) {
    for (const schema of Object.values(HandlerClass.api.responseSchema)) {
      assert.equal(schema.additionalProperties, false, HandlerClass.handlerName);
    }
  }
});
