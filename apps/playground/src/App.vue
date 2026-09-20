<script setup lang="ts">
import { AppProviders } from '@playground/ui'
import { NH2, NLayout, NLayoutContent, NLayoutSider, NMenu } from 'naive-ui'
import { computed, h } from 'vue'
import { RouterLink, RouterView, useRouter } from 'vue-router'
import type { MenuItem } from '@/menu'
import { buildMenu } from '@/menu'

const router = useRouter()
/** 菜单由路由表推导，演示包在页面 route 块里写 meta.title 即可 */
const menu = computed(() => buildMenu(router))

function handleMenuOptions(rowMenu: MenuItem[]): any {
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
      key: i.key,
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
        :default-expanded-keys="menu.map(i => i.key)"
        accordion
      />
    </n-layout-sider>
    <n-layout>
      <n-layout-content content-style="padding:8px; height:100vh;">
        <AppProviders>
          <router-view v-slot="{ Component, route }" class="h-full flex-col-center ">
            <transition
              name="fade-bottom"
              mode="out-in"
            >
              <component :is="Component" :key="route.fullPath" />
            </transition>
          </router-view>
        </AppProviders>
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
