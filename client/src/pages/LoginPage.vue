<script>
export const page = {
  name: "login",
  path: "/login",
  title: "登入",
  public: true
};
</script>

<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import authConfig from "@config/auth.js";
import AuthLayout from "@/framework/layout/AuthLayout.vue";
import { DEVICE_BLOCKED_CODES, useSessionStore } from "@/stores/session.js";

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const username = ref("");
const password = ref("");
const submitting = ref(false);
const errorMessage = ref("");

const required = (val) => !!val || "必填";

async function handleSubmit() {
  submitting.value = true;
  errorMessage.value = "";

  try {
    await session.login(username.value, password.value);
    const redirect = typeof route.query.redirect === "string" ? route.query.redirect : authConfig.homePath;
    router.push(redirect);
  } catch (error) {
    // 設備被擋唔係「登入失敗」：密碼係啱嘅。留喺登入頁淨係顯示一句紅字嘅話，
    // 用戶只會不停重試密碼，然後撞上登入節流——真正要做嘅事（等審批、搵管理員）
    // 一件都唔會發生。所以送佢去一頁講得清楚嘅畫面。
    if (DEVICE_BLOCKED_CODES.includes(error.code)) {
      router.push(authConfig.devicePendingPath);
      return;
    }

    // 後端登入失敗同「session 已經失效」共用同一個 code（"Unauthorized
    // Access"，見 errorMessages.js），單靠 code 分唔到係邊一種——但呢度係
    // 登入頁，401 一定係帳號密碼錯（節流、臨時密碼過期都有自己獨立嘅
    // code，唔會行到呢一行），所以喺呢度直接寫死，唔用共用嗰句「登入已
    // 失效」。
    errorMessage.value =
      error.code === "TEMPORARY_PASSWORD_EXPIRED"
        ? error.message
        : error.status === 401
          ? "帳號或密碼不正確"
          : error.message || "登入失敗";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthLayout>
    <q-card-section class="q-pt-lg q-px-lg">
      <div class="text-h6">登入</div>
      <div class="text-caption text-grey-7 q-mt-xs">請輸入帳號密碼以繼續</div>
    </q-card-section>

    <q-card-section class="q-pt-none q-px-lg q-pb-lg">
      <q-form class="q-gutter-y-md" @submit.prevent="handleSubmit">
        <q-input v-model="username" label="帳號" filled autofocus :rules="[required]">
          <template #prepend><q-icon name="person" /></template>
        </q-input>
        <q-input v-model="password" label="密碼" type="password" filled :rules="[required]">
          <template #prepend><q-icon name="lock" /></template>
        </q-input>

        <q-banner v-if="errorMessage" class="bg-negative text-white" dense rounded>
          {{ errorMessage }}
        </q-banner>

        <q-btn
          type="submit"
          color="primary"
          label="登入"
          :loading="submitting"
          class="full-width"
          unelevated
        />
      </q-form>
    </q-card-section>
  </AuthLayout>
</template>
