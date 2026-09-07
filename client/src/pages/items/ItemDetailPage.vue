<script>
export const page = {
  name: "itemDetail",
  path: "/items/:id",
  title: "商品詳情",
  requires: { permissions: ["item.view"] }
};
</script>

<script setup>
import { computed, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/framework/layout/PageHeader.vue";
import { can } from "@/framework/authorization/can.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import { mapValidationDetailsToFieldErrors } from "@/framework/ui/validationIssues.js";
import ItemBasicForm from "@/components/items/ItemBasicForm.vue";
import itemService from "@/services/item.js";
import { useSessionStore } from "@/stores/session.js";

const STATUS_LABEL = {
  draft: "草稿",
  active: "啟用",
  inactive: "已停用",
  discontinued: "已停產",
  archived: "已封存"
};
const STATUS_COLOUR = {
  draft: "grey",
  active: "positive",
  inactive: "grey-7",
  discontinued: "warning",
  archived: "warning"
};

const route = useRoute();
const router = useRouter();
const session = useSessionStore();
const canManage = computed(() => can(session, { permissions: ["item.mgmt"] }));

const itemId = computed(() => Number(route.params.id));

const loading = ref(true);
const loadError = ref("");
const item = ref(null);
const editing = ref(false);
const submitting = ref(false);
const fieldErrors = ref({});
const errorMessage = ref("");
const staleNotice = ref(false);

// `let` 唔係 `const`：ItemBasicForm.vue 用 defineModel() 綁 v-model 落成個
// `form` 物件本身（唔係佢底下某個屬性），Vue 編譯器為咗支援 defineModel()
// 理論上可以整個重新賦值嘅語意，要求呢個 binding 本身可以重新賦值——雖然
// loadFormFrom() 淨係改緊屬性，從來冇整個重新賦值過。
// eslint-disable-next-line prefer-const
let form = reactive({
  name: "",
  shortName: "",
  description: "",
  categoryId: null,
  brandId: null,
  countryOfOrigin: "",
  manufacturer: "",
  defaultTrackingPolicy: "none",
  defaultShelfLifeDays: null
});

function fieldError(path) {
  return fieldErrors.value[path] ?? "";
}

function loadFormFrom(data) {
  form.name = data.name;
  form.shortName = data.shortName;
  form.description = data.description ?? "";
  form.categoryId = data.categoryId;
  form.brandId = data.brandId;
  form.countryOfOrigin = data.countryOfOrigin ?? "";
  form.manufacturer = data.manufacturer;
  form.defaultTrackingPolicy = data.defaultTrackingPolicy;
  form.defaultShelfLifeDays = data.defaultShelfLifeDays;
}

async function load() {
  loading.value = true;
  loadError.value = "";
  try {
    item.value = await itemService.getItem(itemId.value);
    loadFormFrom(item.value);
  } catch (error) {
    loadError.value = error.message || "載入商品詳情失敗";
  } finally {
    loading.value = false;
  }
}
load();

function startEdit() {
  loadFormFrom(item.value);
  fieldErrors.value = {};
  errorMessage.value = "";
  staleNotice.value = false;
  editing.value = true;
}

function cancelEdit() {
  loadFormFrom(item.value);
  fieldErrors.value = {};
  errorMessage.value = "";
  staleNotice.value = false;
  editing.value = false;
}

/** `form` 嘅選填欄位喺冇資料嗰陣係 `""`／`null`（`loadFormFrom()` 由後端
 * response 帶落嚟嘅 `null` 直接抄過嚟）；但 update request schema 嘅呢啲
 * 欄位（`countryOfOrigin`、`defaultShelfLifeDays`）唔接受 `null` 或者空
 * 字串——有畀就要係啱嘅形狀，冇就要整個屬性都唔存在。 */
function buildPayload() {
  return {
    name: form.name,
    shortName: form.shortName,
    description: form.description || null,
    categoryId: form.categoryId ?? undefined,
    brandId: form.brandId ?? undefined,
    countryOfOrigin: form.countryOfOrigin || undefined,
    manufacturer: form.manufacturer,
    defaultTrackingPolicy: form.defaultTrackingPolicy,
    defaultShelfLifeDays: form.defaultShelfLifeDays ?? undefined,
    version: item.value.version
  };
}

async function save() {
  if (submitting.value) {
    return;
  }
  submitting.value = true;
  fieldErrors.value = {};
  errorMessage.value = "";

  try {
    const updated = await itemService.updateItem(itemId.value, buildPayload());
    item.value = updated;
    editing.value = false;
    staleNotice.value = false;
    notifySuccess(`商品「${updated.name}」已更新`);
  } catch (error) {
    if (error.code === "VERSION_CONFLICT") {
      // 唔自動覆蓋、唔自動重送：攞返最新資料嚟顯示畀用戶比較，使用者自己
      // 嗰份輸入留喺 form 度冇動過，撳「重新載入最新資料」先會覆蓋。
      staleNotice.value = true;
      try {
        item.value = await itemService.getItem(itemId.value);
      } catch {
        // 重新載入本身失敗都唔緊要，stale notice 已經話咗用戶而家個版本舊。
      }
      errorMessage.value = "呢個商品喺你編輯期間已經被人改過，你嘅輸入仍然保留喺畫面上。";
    } else {
      fieldErrors.value = mapValidationDetailsToFieldErrors(error.details);
      if (Object.keys(fieldErrors.value).length === 0) {
        errorMessage.value = error.message || "更新失敗";
      }
    }
    notifyError(error.message || "更新失敗");
  } finally {
    submitting.value = false;
  }
}

function reloadLatest() {
  loadFormFrom(item.value);
  staleNotice.value = false;
  errorMessage.value = "";
}

function goToSku(skuId) {
  router.push(`/items/${itemId.value}/skus/${skuId}`);
}
</script>

<template>
  <div>
    <PageHeader :title="item ? item.name : undefined" />

    <div class="q-pa-md" style="max-width: 900px">
      <div v-if="loading">載入中…</div>
      <q-banner v-else-if="loadError" class="bg-negative text-white">{{ loadError }}</q-banner>

      <template v-else>
        <div class="row items-center q-gutter-sm q-mb-md">
          <q-badge :color="STATUS_COLOUR[item.status]" :label="STATUS_LABEL[item.status] ?? item.status" />
          <span class="text-caption text-grey-7">版本 {{ item.version }}</span>
          <q-space />
          <q-btn v-if="canManage && !editing" flat color="primary" label="編輯" @click="startEdit" />
        </div>

        <div v-if="errorMessage || Object.keys(fieldErrors).length > 0" role="alert" class="q-mb-md">
          <q-banner class="bg-negative text-white">
            <div>{{ errorMessage || "請檢查以下標示錯誤的欄位。" }}</div>
            <template v-if="staleNotice">
              <q-btn flat color="white" label="重新載入最新資料（會捨棄你嘅輸入）" class="q-mt-sm" @click="reloadLatest" />
            </template>
          </q-banner>
        </div>

        <ItemBasicForm v-model="form" :field-error="fieldError" :readonly="!editing" />

        <div v-if="editing" class="row q-gutter-sm q-mt-md">
          <q-btn color="primary" label="儲存" :loading="submitting" @click="save" />
          <q-btn flat label="取消" :disable="submitting" @click="cancelEdit" />
        </div>

        <q-separator class="q-my-lg" />

        <div class="text-h6 q-mb-md">SKU</div>
        <q-list bordered separator>
          <q-item v-for="sku in item.skus" :key="sku.id" clickable @click="goToSku(sku.id)">
            <q-item-section>
              <q-item-label>{{ sku.skuCode }}</q-item-label>
              <q-item-label caption>{{ sku.skuName }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-badge :color="STATUS_COLOUR[sku.status]" :label="STATUS_LABEL[sku.status] ?? sku.status" />
            </q-item-section>
          </q-item>
          <q-item v-if="item.skus.length === 0">
            <q-item-section class="text-grey-7">呢個商品未有任何 SKU。</q-item-section>
          </q-item>
        </q-list>
      </template>
    </div>
  </div>
</template>
