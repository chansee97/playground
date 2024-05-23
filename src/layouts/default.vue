<script setup lang="ts">
import { dateZhCN, zhCN } from 'naive-ui'
import { handleMenuOptions } from './helper'
import OriginPage from './components/originPage.vue'
import { menu } from '@/menu'
</script>

<template>
  <n-layout has-sider class="h-full">
    <n-layout-sider bordered width="240">
      <router-link to="/">
        <n-h2 class="text-center p-2 cursor-pointer">
          🎈 Playground
        </n-h2>
      </router-link>
      <n-menu
        :options="handleMenuOptions(menu)"
        accordion
      />
    </n-layout-sider>
    <n-layout>
      <n-layout-content content-style="padding:8px; height:100vh;">
        <OriginPage />
        <n-config-provider :locale="zhCN" :date-locale="dateZhCN" inline-theme-disabled class="h-full overflow-hidden">
          <n-dialog-provider>
            <n-notification-provider>
              <n-modal-provider>
                <n-message-provider>
                  <router-view v-slot="{ Component, route }" class="h-full flex-col-center ">
                    <transition
                      name="fade-scale"
                      mode="out-in"
                    >
                      <component :is="Component" :key="route.fullPath" />
                    </transition>
                  </router-view>
                </n-message-provider>
              </n-modal-provider>
            </n-notification-provider>
          </n-dialog-provider>
        </n-config-provider>
      </n-layout-content>
    </n-layout>
  </n-layout>
</template>

<style scoped>
/* fade-scale */
.fade-scale-leave-active,
.fade-scale-enter-active {
  transition: all 0.28s;
}
.fade-scale-enter-from {
  opacity: 0;
  transform: scale(1.2);
}
.fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.8);
}
</style>
