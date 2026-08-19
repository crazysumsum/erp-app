import { effectScope, shallowRef, watchEffect } from "vue";
import { useSessionStore } from "@/stores/session.js";
import { can } from "./can.js";

/**
 * `v-can="{ permissions: ['order.delete'] }"`：權限唔夠就隱藏元素，用嚟控制
 * 頁內按鈕顯示。用 effectScope 手動管生命週期——directive 冇 onUnmounted
 * 呢類 composition API 可以用，要自己 stop() 個 watchEffect。
 */
export const vCan = {
  mounted(el, binding) {
    const requires = shallowRef(binding.value);
    const scope = effectScope();

    scope.run(() => {
      watchEffect(() => {
        const session = useSessionStore();
        el.style.display = can(session, requires.value) ? "" : "none";
      });
    });

    el.__vCan__ = { scope, requires };
  },
  updated(el, binding) {
    if (el.__vCan__) {
      el.__vCan__.requires.value = binding.value;
    }
  },
  unmounted(el) {
    el.__vCan__?.scope.stop();
  }
};
