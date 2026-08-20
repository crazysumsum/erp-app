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

    errorMessage.value = error.message || "登入失敗";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="bg-grey-2 window-height row justify-center items-center">
    <q-card style="width: 360px" class="q-pa-md">
      <q-card-section>
        <div class="text-h6">登入</div>
      </q-card-section>

      <q-card-section>
        <q-form class="q-gutter-md" @submit.prevent="handleSubmit">
          <q-input v-model="username" label="帳號" filled autofocus :rules="[required]" />
          <q-input v-model="password" label="密碼" type="password" filled :rules="[required]" />

          <q-banner v-if="errorMessage" class="bg-negative text-white" dense>
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
    </q-card>
  </div>
</template>
