<script setup>
import { onMounted, ref } from "vue";
import { TRACKING_POLICY_LABEL } from "./itemFieldLabels.js";
import itemCatalogService from "@/services/itemCatalog.js";
import { notifyError } from "@/framework/ui/notify.js";

const model = defineModel({ required: true });

defineProps({
  fieldError: { type: Function, default: () => "" }
});

const categoryOptions = ref([]);
const brandOptions = ref([]);
const loadingOptions = ref(false);

/** 同 CategoriesPage.vue 嘅「移動父層」選單同一個 flatten 手法：整棵樹拉平
 * 做帶縮排嘅清單，非 Active 或者有子分類（唔係 leaf）嘅節點唔可以揀
 * ——Active Item 必須指向一個 Active leaf Category（design_spec §5.3）。
 * Draft 冧唔中呢條規則都照樣揀得（要等啟用先驗），但揀一個注定啟用唔到
 * 嘅分類冇意義，所以呢度一律唔開放。 */
function flatten(nodes, depth = 0, acc = []) {
  for (const node of nodes) {
    acc.push({ ...node, depth });
    if (node.children?.length > 0) {
      flatten(node.children, depth + 1, acc);
    }
  }
  return acc;
}

async function loadOptions() {
  loadingOptions.value = true;
  try {
    const [tree, brands] = await Promise.all([
      itemCatalogService.categoryTree({ includeArchived: false }),
      itemCatalogService.brandList({ page: 1, rowsPerPage: 100, status: "active" })
    ]);

    categoryOptions.value = flatten(tree).map((node) => {
      const isLeaf = !(node.children?.length > 0);
      const usable = isLeaf && node.status === "active";
      const indent = "　".repeat(node.depth);
      const reason = !isLeaf ? "有子分類" : "已停用";
      return {
        label: usable ? `${indent}${node.name}` : `${indent}${node.name}（${reason}，不可指派）`,
        value: node.id,
        disable: !usable
      };
    });
    brandOptions.value = brands.rows.map((brand) => ({ label: brand.name, value: brand.id }));
  } catch (error) {
    notifyError(error.message || "載入分類／品牌選項失敗");
  } finally {
    loadingOptions.value = false;
  }
}

onMounted(loadOptions);
</script>

<template>
  <div class="row q-col-gutter-md">
    <div class="col-12 col-md-6">
      <q-input
        v-model="model.name"
        label="商品名稱 *"
        outlined
        dense
        :error="!!fieldError('item.name')"
        :error-message="fieldError('item.name')"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-input
        v-model="model.shortName"
        label="簡稱"
        outlined
        dense
        :error="!!fieldError('item.shortName')"
        :error-message="fieldError('item.shortName')"
      />
    </div>
    <div class="col-12">
      <q-input
        v-model="model.description"
        label="描述"
        type="textarea"
        outlined
        dense
        autogrow
        :error="!!fieldError('item.description')"
        :error-message="fieldError('item.description')"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-select
        v-model="model.categoryId"
        :options="categoryOptions"
        emit-value
        map-options
        clearable
        label="分類"
        outlined
        dense
        :loading="loadingOptions"
        :error="!!fieldError('item.categoryId')"
        :error-message="fieldError('item.categoryId')"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-select
        v-model="model.brandId"
        :options="brandOptions"
        emit-value
        map-options
        clearable
        label="品牌"
        outlined
        dense
        :loading="loadingOptions"
        :error="!!fieldError('item.brandId')"
        :error-message="fieldError('item.brandId')"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-input
        v-model="model.manufacturer"
        label="製造商"
        outlined
        dense
        :error="!!fieldError('item.manufacturer')"
        :error-message="fieldError('item.manufacturer')"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-input
        v-model="model.countryOfOrigin"
        label="原產地（ISO 3166-1，例如 HK）"
        outlined
        dense
        maxlength="2"
        :error="!!fieldError('item.countryOfOrigin')"
        :error-message="fieldError('item.countryOfOrigin')"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-select
        v-model="model.defaultTrackingPolicy"
        :options="Object.entries(TRACKING_POLICY_LABEL).map(([value, label]) => ({ label, value }))"
        emit-value
        map-options
        label="預設追蹤政策"
        outlined
        dense
        :error="!!fieldError('item.defaultTrackingPolicy')"
        :error-message="fieldError('item.defaultTrackingPolicy')"
      />
    </div>
    <div class="col-12 col-md-6">
      <q-input
        v-model.number="model.defaultShelfLifeDays"
        type="number"
        min="1"
        label="預設保存期限（天）"
        outlined
        dense
        :error="!!fieldError('item.defaultShelfLifeDays')"
        :error-message="fieldError('item.defaultShelfLifeDays')"
      />
    </div>
  </div>
</template>
