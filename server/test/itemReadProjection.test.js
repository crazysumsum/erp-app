import assert from "node:assert/strict";
import test from "node:test";
import { ItemAdminService } from "../src/modules/item/ItemAdminService.js";
import { createTestTime } from "../test-support/createTestTime.js";

const NOW_MS = 1_700_000_000_000;
const VIEWER = { actorId: 7, claimedRoles: ["item-viewer"], claimedPermissions: ["item.view"] };

function logger() {
  return { debug: async () => {}, info: async () => {}, warn: async () => {}, error: async () => {} };
}

function attributeProjectionDatabase() {
  const item = {
    id: 11,
    name: "規格商品",
    short_name: "",
    description: null,
    category_id: 3,
    category_name: "測試分類",
    brand_id: null,
    brand_name: null,
    product_type: "variant",
    country_of_origin: null,
    manufacturer: "",
    default_tracking_policy: "none",
    default_shelf_life_days: null,
    status: "active",
    version: 1,
    created_at: NOW_MS,
    updated_at: NOW_MS
  };
  const sku = {
    id: 21,
    item_id: 11,
    sku_code: "SPEC-BLUE",
    sku_name: "藍色",
    variant_signature: "variant-signature",
    net_content: null,
    net_content_uom_id: null,
    weight: null,
    weight_uom_id: null,
    length: null,
    width: null,
    height: null,
    dimension_uom_id: null,
    tracking_policy: "none",
    shelf_life_days: null,
    min_receipt_life_days: null,
    min_sale_life_days: null,
    purchasable: 1,
    sellable: 1,
    inventory_tracked: 1,
    suggested_price_amount: null,
    effective_from: null,
    effective_to: null,
    status: "active",
    version: 1,
    created_at: NOW_MS,
    updated_at: NOW_MS,
    item_name: item.name,
    item_status: item.status,
    item_product_type: item.product_type,
    item_category_id: item.category_id,
    item_category_name: item.category_name,
    item_brand_id: null,
    item_brand_name: null
  };

  async function query(sql) {
    if (sql.includes("SELECT username FROM users")) return [[{ username: "viewer" }]];
    if (sql.includes("FROM roles r JOIN user_roles")) return [[{ name: "item-viewer" }]];
    if (sql.includes("FROM permissions p")) return [[{ name: "item.view" }]];
    if (sql.includes("FROM items i") && sql.includes("WHERE i.id = ?")) return [[item]];
    if (sql.includes("FROM item_skus") && sql.includes("WHERE item_id = ?")) {
      return [[{ id: sku.id, sku_code: sku.sku_code, sku_name: sku.sku_name, status: sku.status, suggested_price_amount: null, version: 1 }]];
    }
    if (sql.includes("FROM item_skus s") && sql.includes("WHERE s.id = ?")) return [[sku]];
    if (sql.includes("FROM item_attribute_values")) {
      return [[
        {
          attribute_id: 97,
          attribute_code: "NOTE",
          attribute_name: "備註",
          data_type: "long_text",
          option_id: null,
          option_value: null,
          option_label: null,
          value_text: "可換貨",
          value_decimal: null,
          value_boolean: null,
          value_date: null
        },
        {
          attribute_id: 98,
          attribute_code: "WEIGHT",
          attribute_name: "重量",
          data_type: "decimal",
          option_id: null,
          option_value: null,
          option_label: null,
          value_text: null,
          value_decimal: "12.5000",
          value_boolean: null,
          value_date: null
        },
        {
          attribute_id: 99,
          attribute_code: "ORGANIC",
          attribute_name: "有機",
          data_type: "boolean",
          option_id: null,
          option_value: null,
          option_label: null,
          value_text: null,
          value_decimal: null,
          value_boolean: 1,
          value_date: null
        },
        {
          attribute_id: 101,
          attribute_code: "EXPIRY",
          attribute_name: "到期日",
          data_type: "date",
          option_id: null,
          option_value: null,
          option_label: null,
          value_text: null,
          value_decimal: null,
          value_boolean: null,
          value_date: 1_800_000_000_000
        },
        {
          attribute_id: 102,
          attribute_code: "MATERIAL",
          attribute_name: "材質",
          data_type: "single_option",
          option_id: 301,
          option_value: "cotton",
          option_label: "棉",
          value_text: null,
          value_decimal: null,
          value_boolean: null,
          value_date: null
        }
      ]];
    }
    if (sql.includes("FROM item_sku_attribute_values")) {
      return [[
        {
          attribute_id: 103,
          attribute_code: "COLOR",
          attribute_name: "顏色",
          data_type: "single_option",
          option_id: 302,
          option_value: "blue",
          option_label: "藍",
          value_text: null,
          value_decimal: null,
          value_boolean: null,
          value_date: null
        }
      ]];
    }
    if (sql.includes("FROM item_sku_uoms") || sql.includes("FROM item_sku_barcodes") || sql.includes("FROM item_media")) return [[]];
    throw new Error(`Unhandled SQL: ${sql}`);
  }

  return { query };
}

test("Item/SKU 詳情投影已保存的 Attribute 與 Variant 值，並保留型別和 option 顯示資料", async () => {
  const service = new ItemAdminService({
    database: attributeProjectionDatabase(),
    logger: logger(),
    time: createTestTime({ clock: () => new Date(NOW_MS) })
  });

  const item = await service.getItem({ ...VIEWER, id: 11 });
  assert.deepEqual(item.attributeValues, [
    { attributeId: 97, code: "NOTE", name: "備註", dataType: "long_text", value: "可換貨", option: null },
    { attributeId: 98, code: "WEIGHT", name: "重量", dataType: "decimal", value: "12.5000", option: null },
    { attributeId: 99, code: "ORGANIC", name: "有機", dataType: "boolean", value: true, option: null },
    { attributeId: 101, code: "EXPIRY", name: "到期日", dataType: "date", value: 1_800_000_000_000, option: null },
    {
      attributeId: 102,
      code: "MATERIAL",
      name: "材質",
      dataType: "single_option",
      value: "cotton",
      option: { id: 301, value: "cotton", label: "棉" }
    }
  ]);

  const sku = await service.getSku({ ...VIEWER, id: 21 });
  assert.deepEqual(sku.variantValues, [
    {
      attributeId: 103,
      code: "COLOR",
      name: "顏色",
      dataType: "single_option",
      value: "blue",
      option: { id: 302, value: "blue", label: "藍" }
    }
  ]);
});
