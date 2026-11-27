<script>
export const page = {
  name: "device-pending",
  path: "/device/pending",
  title: "設備待審批",
  // public：用戶喺呢一刻**冇** token——密碼啱咗，但設備綁定擋住咗簽發。
  // 如果呢頁要登入先入得，佢就永遠見唔到，只會喺登入頁見到一句錯誤訊息。
  public: true
};
</script>

<script setup>
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import authConfig from "@config/auth.js";
import { currentDeviceId } from "@/framework/auth/deviceKey.js";
import AuthLayout from "@/framework/layout/AuthLayout.vue";
import { useSessionStore } from "@/stores/session.js";

const router = useRouter();
const session = useSessionStore();
const deviceId = ref("");

const COPY = {
  DEVICE_PENDING_APPROVAL: {
    icon: "hourglass_top",
    colour: "warning",
    title: "此設備正等待審批",
    body: "帳號及密碼已通過驗證。請聯絡管理員核准此設備，再重新登入。"
  },
  DEVICE_REJECTED: {
    icon: "block",
    colour: "negative",
    title: "此設備的申請已被拒絕",
    body: "管理員已拒絕此設備的綁定申請。如有疑問，請聯絡管理員。"
  },
  DEVICE_REVOKED: {
    icon: "gpp_bad",
    colour: "negative",
    title: "此設備已停用",
    body: "此設備的存取權已被撤銷。如需繼續使用，請聯絡管理員重新核准。"
  }
};

// 直接開呢個網址（冇經過登入流程）嗰陣冇 deviceStatus，當成待審批處理——
// 三種狀態入面佢係最常見亦最無害嘅一個。
const state = COPY[session.deviceStatus] ?? COPY.DEVICE_PENDING_APPROVAL;

onMounted(async () => {
  try {
    deviceId.value = await currentDeviceId();
  } catch {
    // 攞唔到 device id 唔應該令成頁爆——佢淨係畀人報畀管理員對認，
    // 唔係呢一頁存在嘅理由。
    deviceId.value = "";
  }
});

function backToLogin() {
  router.push(authConfig.loginPath);
}
</script>

<template>
  <AuthLayout>
    <q-card-section class="row items-center q-gutter-md">
      <q-icon :name="state.icon" :color="state.colour" size="42px" />
      <h1 class="text-h6 q-ma-none">{{ state.title }}</h1>
    </q-card-section>

    <q-card-section class="text-body2">
      {{ state.body }}
    </q-card-section>

    <q-card-section v-if="deviceId">
      <div class="text-caption text-grey-7">設備編號（供管理員核對）</div>
      <!-- 淨係顯示頭 16 個字元：足夠喺兩台待審設備之間分辨，而完整嘅
           thumbprint 對人嚟講讀唔到亦記唔到。 -->
      <div class="text-caption">{{ deviceId.slice(0, 16) }}…</div>
    </q-card-section>

    <q-card-actions align="right">
      <q-btn flat color="primary" label="返回登入" @click="backToLogin" />
    </q-card-actions>
  </AuthLayout>
</template>
