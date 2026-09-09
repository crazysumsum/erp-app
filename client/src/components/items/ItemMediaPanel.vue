<script setup>
import { onUnmounted, ref, watch } from "vue";
import itemMediaService from "@/services/itemMedia.js";
import { promptPassword } from "@/framework/ui/confirm.js";
import { notifyError, notifySuccess } from "@/framework/ui/notify.js";

/**
 * Item／SKU media 面板：上傳、圖片 inline preview、PDF 下載、primary／排序
 * 切換、刪除。設計說明見 docs/items_management/design_spec.md §6.6、§7.4。
 *
 * 圖片預覽一定要經 `itemMediaService.downloadMedia()` 攞 blob 先顯示，唔可以
 * 直接將下載端點嘅 URL 塞入 `<img src>`——認證用 Authorization header
 * （Bearer token），`<img>` 冚唔到自訂 header，直接指向端點只會令瀏覽器發
 * 一個冇帶 token 嘅請求、收到 401。見 HttpClient.getBlob() 的說明。
 *
 * 上傳進度：`fetch()`（HttpClient 用緊嘅底層 API）唔提供上傳位元組級別嘅
 * 進度事件——要攞到真正嘅百分比進度需要換成 XMLHttpRequest，屬於對
 * HttpClient 較大嘅改動，唔喺呢個 task 範圍。呢度用「不確定進度」嘅忙碌
 * 指示（indeterminate progress bar）加取消按鈕，滿足「使用者睇得到上傳緊、
 * 隨時可以中止」呢個核心需求。
 */

const props = defineProps({
  /** "item" | "sku"——決定打邊個 upload 端點。 */
  targetType: { type: String, required: true },
  targetId: { type: Number, required: true },
  /** 目標 Item／SKU 現在嘅 version，上傳時要帶，防止對住舊資料上傳。 */
  version: { type: Number, required: true },
  mediaList: { type: Array, required: true },
  canManage: { type: Boolean, default: false }
});

const emit = defineEmits(["refresh"]);

const uploading = ref(false);
const uploadError = ref("");
let uploadAbortController = null;

const busyIds = ref(new Set());
function isBusy(id) {
  return busyIds.value.has(id);
}
async function withBusy(id, fn) {
  busyIds.value.add(id);
  try {
    await fn();
  } finally {
    busyIds.value.delete(id);
  }
}

// { [mediaId]: objectURL }——只有 image kind 先入呢個表。
const imageUrls = ref({});

function revokeImageUrls() {
  for (const url of Object.values(imageUrls.value)) {
    URL.revokeObjectURL(url);
  }
  imageUrls.value = {};
}

async function loadImagePreviews() {
  const images = props.mediaList.filter((media) => media.mediaKind === "image");
  const keepIds = new Set(images.map((media) => media.id));

  for (const [id, url] of Object.entries(imageUrls.value)) {
    if (!keepIds.has(Number(id))) {
      URL.revokeObjectURL(url);
      delete imageUrls.value[id];
    }
  }

  for (const media of images) {
    if (imageUrls.value[media.id]) {
      continue;
    }
    try {
      const { blob } = await itemMediaService.downloadMedia(media.id);
      imageUrls.value[media.id] = URL.createObjectURL(blob);
    } catch (error) {
      // 單張圖片預覽失敗唔應該擋住成個面板；漏咗預覽仲有檔名／大小可以睇。
      void error;
    }
  }
}

watch(() => props.mediaList, loadImagePreviews, { immediate: true });
onUnmounted(revokeImageUrls);

function humanFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function upload(kind, file) {
  if (!file) {
    return;
  }

  uploading.value = true;
  uploadError.value = "";
  uploadAbortController = new AbortController();

  try {
    const uploadFn =
      props.targetType === "item" ? itemMediaService.uploadItemMedia : itemMediaService.uploadSkuMedia;
    const targetIdKey = props.targetType === "item" ? "itemId" : "skuId";

    await uploadFn({
      [targetIdKey]: props.targetId,
      kind,
      sortOrder: props.mediaList.length,
      version: props.version,
      file,
      signal: uploadAbortController.signal
    });
    notifySuccess("上傳成功");
    emit("refresh");
  } catch (error) {
    uploadError.value = error.message || "上傳失敗";
    notifyError(uploadError.value);
  } finally {
    uploading.value = false;
    uploadAbortController = null;
  }
}

function cancelUpload() {
  uploadAbortController?.abort();
}

function onPickImage(file) {
  upload("image", file);
}

function onPickAttachment(file) {
  upload("attachment", file);
}

async function setPrimary(media) {
  await withBusy(media.id, async () => {
    try {
      await itemMediaService.updateMedia(media.id, { isPrimary: true });
      notifySuccess("已設為主要圖片");
      emit("refresh");
    } catch (error) {
      notifyError(error.message || "設定失敗");
    }
  });
}

// q-input 冇 @update:model-value 監聽器就係「受控但冇人受控」：Quasar 每次
// 打字都會 emit 一個新值，但冇對應嘅 parent 更新，佢下一個 tick 就照
// `:model-value` prop（即係 media.sortOrder）打返轉頭——輸入到嘅字打完即刻
// 被自己蓋走，`@blur` 讀到嘅 event.target.value 已經係復原咗嘅舊值。呢個
// 對照組（草稿值）就係為咗俾使用者打字期間有嘢頂住，等個位真係郁得到。
const sortOrderDrafts = ref({});

function sortOrderValue(media) {
  return sortOrderDrafts.value[media.id] ?? media.sortOrder;
}

function onSortOrderInput(media, value) {
  sortOrderDrafts.value[media.id] = value;
}

async function commitSortOrder(media) {
  const draft = sortOrderDrafts.value[media.id];
  delete sortOrderDrafts.value[media.id];

  if (draft === undefined) {
    return;
  }

  const value = Number(draft);
  if (!Number.isFinite(value) || value === media.sortOrder) {
    return;
  }

  await withBusy(media.id, async () => {
    try {
      await itemMediaService.updateMedia(media.id, { sortOrder: value });
      emit("refresh");
    } catch (error) {
      notifyError(error.message || "排序更新失敗");
    }
  });
}

async function removeMedia(media) {
  const outcome = await promptPassword({
    title: "刪除檔案",
    message: `永久刪除「${media.originalName}」？這個操作不可以復原。`,
    okLabel: "刪除",
    requireReason: true
  });
  if (outcome === null) {
    return;
  }

  await withBusy(media.id, async () => {
    try {
      await itemMediaService.deleteMedia(media.id, outcome);
      notifySuccess(`已刪除「${media.originalName}」`);
      emit("refresh");
    } catch (error) {
      notifyError(error.message || "刪除失敗");
    }
  });
}

async function downloadAttachment(media) {
  await withBusy(media.id, async () => {
    try {
      const { blob } = await itemMediaService.downloadMedia(media.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = media.originalName;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notifyError(error.message || "下載失敗");
    }
  });
}
</script>

<template>
  <div>
    <div class="text-h6 q-mb-sm">媒體檔案</div>

    <div v-if="canManage" class="row q-gutter-sm q-mb-md items-center">
      <q-file
        dense
        outlined
        label="上傳圖片（PNG／JPEG／WebP）"
        accept="image/png,image/jpeg,image/webp"
        style="max-width: 280px"
        :disable="uploading"
        :model-value="null"
        @update:model-value="onPickImage"
      />
      <q-file
        dense
        outlined
        label="上傳附件（PDF）"
        accept="application/pdf"
        style="max-width: 280px"
        :disable="uploading"
        :model-value="null"
        @update:model-value="onPickAttachment"
      />
      <q-btn v-if="uploading" flat color="negative" label="取消上傳" @click="cancelUpload" />
    </div>

    <q-linear-progress v-if="uploading" indeterminate color="primary" class="q-mb-md" />
    <q-banner v-if="uploadError" class="bg-negative text-white q-mb-md">{{ uploadError }}</q-banner>

    <div v-if="mediaList.length === 0" class="text-grey-7">未有上傳任何檔案。</div>

    <div v-else class="row q-gutter-md">
      <q-card v-for="media in mediaList" :key="media.id" style="width: 220px">
        <q-img v-if="media.mediaKind === 'image' && imageUrls[media.id]" :src="imageUrls[media.id]" :ratio="1" />
        <div v-else-if="media.mediaKind === 'image'" class="q-pa-md text-center text-grey-7">載入預覽中…</div>
        <q-card-section v-else class="text-center">
          <q-icon name="picture_as_pdf" size="48px" color="grey-7" />
        </q-card-section>

        <q-card-section>
          <div class="text-caption ellipsis" :title="media.originalName">{{ media.originalName }}</div>
          <div class="text-caption text-grey-7">{{ humanFileSize(media.byteSize) }}</div>
        </q-card-section>

        <q-card-actions align="between">
          <q-btn
            v-if="media.mediaKind === 'attachment'"
            flat
            dense
            icon="download"
            label="下載"
            :disable="isBusy(media.id)"
            @click="downloadAttachment(media)"
          />
          <q-btn
            v-if="canManage && media.mediaKind === 'image' && !media.isPrimary"
            flat
            dense
            icon="star_border"
            label="設為主要"
            :disable="isBusy(media.id)"
            @click="setPrimary(media)"
          />
          <q-badge v-if="media.isPrimary" color="positive" label="主要圖片" />
          <q-btn
            v-if="canManage"
            flat
            dense
            round
            icon="delete"
            color="negative"
            :disable="isBusy(media.id)"
            :aria-label="`刪除「${media.originalName}」`"
            @click="removeMedia(media)"
          />
        </q-card-actions>

        <q-card-section v-if="canManage" class="q-pt-none row items-center no-wrap q-gutter-xs">
          <q-input
            dense
            type="number"
            label="排序"
            class="col"
            :model-value="sortOrderValue(media)"
            :disable="isBusy(media.id)"
            @update:model-value="(value) => onSortOrderInput(media, value)"
            @blur="() => commitSortOrder(media)"
            @keyup.enter="() => commitSortOrder(media)"
          />
          <q-btn
            flat
            dense
            round
            icon="check"
            :aria-label="`確認「${media.originalName}」的排序`"
            :disable="isBusy(media.id)"
            @click="commitSortOrder(media)"
          />
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>
