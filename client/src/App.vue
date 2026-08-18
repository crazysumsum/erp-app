<script setup>
import { onMounted, ref } from "vue";
import httpConfig from "@config/http.js";

// 這一頁是 Phase 1 的驗證用畫面：它證明 Quasar 的元件、圖示與樣式都接好了。
// Phase 5 會用 AppShell（QLayout + QDrawer + QPageContainer）取代它，Phase 4 之後
// 內容區則由路由決定。
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
  <!--
    刻意不用 QLayout／QPageContainer：那一組是 Phase 5 的 AppShell（左菜單、右
    內容）的骨架，QPageContainer 也必須是 QLayout 的子節點。這一頁只是驗證用的
    臨時畫面，用普通容器加 Quasar 的排版 class 就夠。
  -->
  <div class="bg-grey-2 window-height">
    <div class="row justify-center items-center full-height q-pa-lg">
      <q-card class="full-width" style="max-width: 520px">
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
