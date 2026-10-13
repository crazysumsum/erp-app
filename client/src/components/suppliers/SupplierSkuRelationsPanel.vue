<script setup>
import { computed, nextTick, reactive, ref } from "vue";
import DataTable from "@/framework/ui/DataTable.vue";
import EllipsisCell from "@/framework/ui/EllipsisCell.vue";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";
import supplierService from "@/services/supplier.js";

/**
 * 供應商嘅 SKU 供貨關係（TASK-039；設計 §5.11、§7.2）。關係只係對照同排序參考（BR-023、BR-024）：
 * 文案唔可以講成「只可以向呢個供應商買」。已封存供應商唔可以新增或修改（HD-090）；停用嘅 SKU／單位照樣顯示做歷史。
 */
const props = defineProps({
  supplierId: { type: Number, required: true },
  supplierCode: { type: String, required: true },
  supplierStatus: { type: String, required: true },
  canManage: { type: Boolean, default: false }
});

const STATUSES = Object.freeze([
  { value: "preferred", label: "首選", colour: "positive" },
  { value: "alternative", label: "備選", colour: "grey" },
  { value: "stopped", label: "已停止", colour: "warning" }
]);
const STATUS = Object.fromEntries(STATUSES.map((status) => [status.value, status]));
const LIFECYCLE_LABEL = Object.freeze({ draft: "草稿", inactive: "已停用", discontinued: "已停產", archived: "已封存" });

const writable = computed(() => props.canManage && props.supplierStatus !== "archived");
const columns = computed(() => [
  { name: "sku", label: "SKU", field: "skuCode", align: "left" },
  { name: "supplierItem", label: "供應商商品代碼／名稱", field: "supplierItemCode", align: "left" },
  { name: "purchaseUom", label: "採購單位", field: "purchaseUomCode", align: "left" },
  { name: "minimumOrderQty", label: "最低訂購量", field: "minimumOrderQty", align: "right", format: (value) => value ?? "—" },
  { name: "standardLeadTimeDays", label: "交貨期（日）", field: "standardLeadTimeDays", align: "right", format: (value) => value ?? "—" },
  { name: "relationshipStatus", label: "關係", field: "relationshipStatus", align: "left" },
  { name: "lastSuppliedAt", label: "最近供貨", field: "lastSuppliedAt", align: "left", format: formatDate },
  ...(writable.value ? [{ name: "actions", label: "操作", field: "id", align: "right" }] : [])
]);

const table = ref(null);
const filter = ref("");
const fetchRelations = (request) => supplierService.listSkuRelations(props.supplierId, request);

function formatDate(value) {
  return value ? new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }) : "—";
}

/** SKU 或商品唔係 active 就係歷史資料：顯示返佢嘅狀態，唔扮仲可以用。 */
function skuHistory(row) {
  if (row.skuStatus && row.skuStatus !== "active") return `SKU ${LIFECYCLE_LABEL[row.skuStatus] ?? row.skuStatus}`;
  if (row.itemStatus && row.itemStatus !== "active") return `商品${LIFECYCLE_LABEL[row.itemStatus] ?? row.itemStatus}`;
  return "";
}

const uomLabel = (uom) => `${uom.uomCode} — ${uom.uomName}${uom.status === "active" ? "" : "（已停用）"}`;

const dialogOpen = ref(false);
const editing = ref(null);
const submitting = ref(false);
const errorMessage = ref("");
const errorRef = ref(null);
const skuOptions = ref([]);
const skuUoms = ref([]);
const skuNotPurchasable = ref(false);
const form = reactive({
  sku: null, supplierItemCode: "", supplierItemName: "", purchaseSkuUomId: null,
  minimumOrderQty: null, standardLeadTimeDays: null, relationshipStatus: "alternative"
});

const uomOptions = computed(() => skuUoms.value
  // 停用嘅單位唔可以新揀；修改時原本嗰個照樣列出，等用戶可以保留佢。
  .filter((uom) => uom.status === "active" || uom.skuUomId === editing.value?.purchaseSkuUomId)
  .map((uom) => ({ value: uom.skuUomId, label: `${uomLabel(uom)}${conversion(uom)}` })));

// 修改時未讀到完整單位清單之前唔知換算率，就唔顯示，唔好扮 × 1。
function conversion(uom) {
  if (uom.isBase) return "，基本單位";
  return uom.toBaseFactor ? ` × ${uom.toBaseFactor}` : "";
}

// 數字欄清空之後 v-model.number 會俾 ""，當做冇填。
const integerOrNull = (value) => (value === "" || value === null || value === undefined ? null : Number(value));
const inRange = (value, minimum, maximum) => value === null || (Number.isInteger(value) && value >= minimum && value <= maximum);
const moqValid = computed(() => inRange(integerOrNull(form.minimumOrderQty), 1, 4_294_967_295));
const leadTimeValid = computed(() => inRange(integerOrNull(form.standardLeadTimeDays), 0, 3650));
const canSave = computed(() => (editing.value || form.sku) && moqValid.value && leadTimeValid.value);

async function filterSkus(value, update, abort) {
  try {
    const result = await supplierService.searchPurchasableSkus({ q: value.trim() });
    update(() => { skuOptions.value = result.items; });
  } catch (error) {
    abort();
    errorMessage.value = error.message || "搜尋 SKU 失敗";
  }
}

function chooseSku(sku) {
  form.sku = sku;
  skuUoms.value = sku?.uoms ?? [];
  form.purchaseSkuUomId = null;
}

function openCreate() {
  editing.value = null;
  errorMessage.value = "";
  skuNotPurchasable.value = false;
  skuUoms.value = [];
  Object.assign(form, { sku: null, supplierItemCode: "", supplierItemName: "", purchaseSkuUomId: null,
    minimumOrderQty: null, standardLeadTimeDays: null, relationshipStatus: "alternative" });
  dialogOpen.value = true;
}

async function openEdit(row) {
  editing.value = row;
  errorMessage.value = "";
  Object.assign(form, { sku: null, supplierItemCode: row.supplierItemCode, supplierItemName: row.supplierItemName,
    purchaseSkuUomId: row.purchaseSkuUomId, minimumOrderQty: row.minimumOrderQty, standardLeadTimeDays: row.standardLeadTimeDays,
    relationshipStatus: row.relationshipStatus });
  // 而家嘅採購單位先放入去，等選單即刻顯示到；可以採購嘅 SKU 再換成完整單位清單。
  const current = row.purchaseSkuUomId === null ? [] : [{ skuUomId: row.purchaseSkuUomId, uomCode: row.purchaseUomCode ?? `#${row.purchaseSkuUomId}`,
    uomName: row.purchaseUomName ?? "", status: row.purchaseUomStatus ?? "inactive", isBase: false, toBaseFactor: null }];
  skuUoms.value = current;
  skuNotPurchasable.value = false;
  dialogOpen.value = true;
  try {
    const result = await supplierService.searchPurchasableSkus({ q: row.skuCode });
    const sku = result.items.find((candidate) => candidate.skuId === row.skuId);
    if (sku) skuUoms.value = sku.uoms;
    else skuNotPurchasable.value = true;
  } catch (error) {
    errorMessage.value = error.message || "讀取 SKU 單位失敗";
  }
}

function payload() {
  return {
    supplierItemCode: form.supplierItemCode.trim(),
    supplierItemName: form.supplierItemName.trim(),
    purchaseSkuUomId: form.purchaseSkuUomId ?? null,
    minimumOrderQty: integerOrNull(form.minimumOrderQty),
    standardLeadTimeDays: integerOrNull(form.standardLeadTimeDays),
    relationshipStatus: form.relationshipStatus
  };
}

async function submit() {
  if (submitting.value || !canSave.value) return;
  submitting.value = true;
  errorMessage.value = "";
  const skuCode = editing.value?.skuCode ?? form.sku.skuCode;
  try {
    if (editing.value) {
      await supplierService.updateSkuRelation(props.supplierId, editing.value.id, { ...payload(), version: editing.value.version });
    } else {
      await supplierService.createSkuRelation(props.supplierId, { skuId: form.sku.skuId, ...payload() });
    }
    notifySuccess(`供應商 ${props.supplierCode} 與 SKU ${skuCode} 的供貨關係已${editing.value ? "更新" : "新增"}`);
    dialogOpen.value = false;
    await table.value?.reload();
  } catch (error) {
    errorMessage.value = error.code === "VERSION_CONFLICT"
      ? "這項供貨關係已被其他人修改。你的輸入仍保留，請關閉後重新載入再核對。"
      : error.message || "儲存供貨關係失敗";
    notifyError(errorMessage.value);
    await nextTick();
    errorRef.value?.focus();
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section aria-labelledby="supplier-sku-relations-heading">
    <div class="row items-center justify-between q-mb-sm">
      <h2 id="supplier-sku-relations-heading" class="text-h6 q-ma-none">供貨關係</h2>
      <q-btn v-if="writable" color="primary" flat icon="add" label="新增供貨關係" @click="openCreate" />
    </div>
    <p class="text-grey-8 q-mb-md">
      供貨關係只用作對照及採購時的排序參考：「首選」會令這個供應商排得較前，其他有效供應商仍然可以選擇；「已停止」只保留紀錄。
    </p>
    <p v-if="canManage && supplierStatus === 'archived'" class="text-grey-8">已封存的供應商不可新增或修改供貨關係。</p>
    <q-input
      v-model="filter" class="q-mb-md" style="max-width: 360px" outlined dense clearable debounce="300"
      label="搜尋 SKU 代碼或供應商商品代碼／名稱" maxlength="190"
    />
    <DataTable ref="table" :fetch="fetchRelations" :columns="columns" :filter="filter ?? ''" :sticky-actions="writable">
      <template #body-cell-sku="{ row }">
        <q-td>
          <div>{{ row.skuCode ?? `#${row.skuId}` }}</div>
          <div class="text-caption text-grey-8"><EllipsisCell :text="row.skuName ?? ''" /></div>
          <q-badge v-if="skuHistory(row)" color="grey" :label="`${skuHistory(row)}（歷史）`" />
        </q-td>
      </template>
      <template #body-cell-supplierItem="{ row }">
        <q-td>
          <div>{{ row.supplierItemCode || "—" }}</div>
          <div class="text-caption text-grey-8"><EllipsisCell :text="row.supplierItemName" /></div>
        </q-td>
      </template>
      <template #body-cell-purchaseUom="{ row }">
        <q-td>
          <template v-if="row.purchaseSkuUomId !== null">
            {{ row.purchaseUomCode ?? `#${row.purchaseSkuUomId}` }}<span v-if="row.purchaseUomName"> — {{ row.purchaseUomName }}</span>
            <q-badge v-if="row.purchaseUomStatus && row.purchaseUomStatus !== 'active'" class="q-ml-xs" color="grey" label="單位已停用" />
          </template>
          <template v-else>—</template>
        </q-td>
      </template>
      <template #body-cell-relationshipStatus="{ row }">
        <q-td>
          <q-badge :color="STATUS[row.relationshipStatus]?.colour ?? 'grey'" :label="STATUS[row.relationshipStatus]?.label ?? row.relationshipStatus" />
        </q-td>
      </template>
      <template #body-cell-actions="{ row }">
        <q-td class="text-right">
          <q-btn flat dense icon="edit" :aria-label="`編輯供貨關係 ${row.skuCode ?? row.skuId}`" @click="openEdit(row)" />
        </q-td>
      </template>
      <template #no-data>
        <p role="status" class="q-ma-none">{{ filter ? "沒有符合搜尋的供貨關係" : "尚未設定供貨關係" }}</p>
      </template>
    </DataTable>

    <q-dialog v-model="dialogOpen" persistent>
      <q-card style="width: min(640px, 96vw); max-width: 640px">
        <q-card-section><h3 class="text-h6 q-ma-none">{{ editing ? "編輯供貨關係" : "新增供貨關係" }}</h3></q-card-section>
        <q-card-section class="q-pt-none">
          <!-- q-banner 本身已經係 role="alert"；外層只負責接焦點，唔好再報多次。 -->
          <div v-if="errorMessage" ref="errorRef" tabindex="-1" class="q-mb-md">
            <q-banner class="bg-negative text-white">{{ errorMessage }}</q-banner>
          </div>
          <div class="row q-col-gutter-md">
            <div v-if="editing" class="col-12">
              <div class="text-caption text-grey-8">SKU</div>
              <div>{{ editing.skuCode ?? `#${editing.skuId}` }} {{ editing.skuName ?? "" }}</div>
            </div>
            <q-select
              v-else :model-value="form.sku" class="col-12" label="SKU *" outlined dense use-input fill-input hide-selected
              input-debounce="300" :options="skuOptions" option-value="skuId"
              :option-label="(sku) => `${sku.skuCode} — ${sku.skuName || sku.itemName}`"
              hint="只列出目前可採購的 SKU" @filter="filterSkus" @update:model-value="chooseSku"
            >
              <template #no-option><q-item><q-item-section class="text-grey-8">沒有符合的可採購 SKU</q-item-section></q-item></template>
            </q-select>
            <q-select
              v-model="form.purchaseSkuUomId" class="col-12 col-sm-6" label="採購單位" outlined dense clearable
              :options="uomOptions" emit-value map-options :disable="!editing && !form.sku"
              :hint="skuNotPurchasable ? 'SKU 目前不可採購，只可保留或清除現有單位' : ''"
            />
            <q-select
              v-model="form.relationshipStatus" class="col-12 col-sm-6" label="關係 *" outlined dense
              :options="STATUSES" emit-value map-options
            />
            <q-input v-model="form.supplierItemCode" class="col-12 col-sm-6" label="供應商商品代碼" outlined dense maxlength="190" />
            <q-input v-model="form.supplierItemName" class="col-12 col-sm-6" label="供應商商品名稱" outlined dense maxlength="190" />
            <q-input
              v-model.number="form.minimumOrderQty" class="col-12 col-sm-6" label="最低訂購量" type="number" min="1" outlined dense
              :error="!moqValid" error-message="請輸入 1 或以上的整數，或留空"
            />
            <q-input
              v-model.number="form.standardLeadTimeDays" class="col-12 col-sm-6" label="一般交貨期（日）" type="number" min="0" max="3650"
              outlined dense :error="!leadTimeValid" error-message="請輸入 0 至 3650 的整數，或留空"
            />
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" v-close-popup />
          <q-btn color="primary" label="儲存" :loading="submitting" :disable="!canSave" @click="submit" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </section>
</template>
