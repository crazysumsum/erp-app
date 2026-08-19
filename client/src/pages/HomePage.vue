<script>
export const page = {
  name: "home",
  path: "/",
  title: "首頁"
};
</script>

<script setup>
import { onMounted, ref } from "vue";
import httpConfig from "@config/http.js";
import PageHeader from "@/framework/layout/PageHeader.vue";

// 呢一頁原本喺 App.vue，係 Phase 1 嘅驗證用畫面：證明 Quasar 嘅元件、圖示與
// 樣式都接好了。Phase 3 加咗路由之後搬過嚟做暫時嘅登入後首頁，Phase 5 而家
// 套咗真正嘅 AppShell（唔再自己整全屏置中），Phase 7 先會有真正嘅首頁內容。
const health = ref(null);
const loading = ref(false);
const error = ref("");

async function loadHealth() {
  loading.value = true;
  error.value = "";

  try {
    const response = await fetch(`${httpConfig.baseUrl}/api/v1/health`);

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const responseBody = await response.json();
    health.value = responseBody.data;
  } catch (requestError) {
    health.value = null;
    error.value = requestError.message;
  } finally {
    loading.value = false;
  }
}

onMounted(loadHealth);
</script>

<template>
  <div>
    <PageHeader />

    <div class="q-px-md">
      <q-card style="max-width: 520px">
        <q-card-section class="row items-center justify-between">
          <div>
            <div class="text-overline text-primary">ERP Development Environment</div>
            <div class="text-h6">系統狀態</div>
          </div>
          <q-btn
            color="primary"
            icon="refresh"
            label="重新檢查"
            :loading="loading"
            unelevated
            @click="loadHealth"
          />
        </q-card-section>

        <q-separator />

        <q-list v-if="health" separator>
          <q-item>
            <q-item-section>
              <q-item-label caption>API</q-item-label>
              <q-item-label>{{ health.status }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item>
            <q-item-section>
              <q-item-label caption>Database</q-item-label>
              <q-item-label>{{ health.database }}</q-item-label>
            </q-item-section>
          </q-item>
          <q-item>
            <q-item-section>
              <q-item-label caption>Time</q-item-label>
              <q-item-label>{{ health.timestamp }}</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>

        <q-banner v-else-if="error" class="bg-negative text-white">
          <template #avatar>
            <q-icon name="error" />
          </template>
          無法連線 API：{{ error }}
        </q-banner>

        <q-card-section v-else class="text-grey-7">
          等待檢查結果...
        </q-card-section>
      </q-card>
    </div>
  </div>
</template>
