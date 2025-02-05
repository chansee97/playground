<script setup lang="ts">
import { menu } from '@/menu'
import { dateZhCN, zhCN } from 'naive-ui'
import { RouterLink } from 'vue-router'

function handleMenuOptions(rowMenu: any[]): any {
  return rowMenu.map((i) => {
    return {
      label: i.path
        ? () =>
            h(
              RouterLink,
              {
                to: {
                  path: i.path,
                },
              },
              { default: () => i.label },
            )
        : i.label,
      key: i.label,
      children: i.children && handleMenuOptions(i.children),
    }
  })
}
</script>

<template>
  <n-layout has-sider class="h-full">
    <n-layout-sider bordered width="240">
      <RouterLink to="/">
        <n-h2 class="text-center p-2 cursor-pointer">
          🎈 Playground
        </n-h2>
      </RouterLink>
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
                      name="fade-bottom"
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
/* fade-bottom */
.fade-bottom-enter-active,
.fade-bottom-leave-active {
  transition: opacity 0.25s, transform 0.3s;
}
.fade-bottom-enter-from {
  opacity: 0;
  transform: translateY(-10%);
}
.fade-bottom-leave-to {
  opacity: 0;
  transform: translateY(10%);
}
</style>
