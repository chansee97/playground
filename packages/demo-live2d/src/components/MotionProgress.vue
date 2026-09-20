<script setup lang="ts">
import { NEl } from 'naive-ui'

defineProps<{
  /** 时长，形如 `4.067s`；空串表示当前没有在播放 */
  duration: string
  /** 每次播放自增：重建元素才能让 CSS 动画重新开始 */
  playId: number
}>()
</script>

<template>
  <n-el style="border:1px solid var(--border-color);border-radius: var(--border-radius);">
    <div
      :key="playId"
      class="element"
      :style="{ animationDuration: duration }"
    />
  </n-el>
</template>

<style scoped>
@keyframes expandWidth {
  0% {
    width: 0;
  }
  100% {
    width: 100%;
  }
}

.element {
  animation: expandWidth linear;
  width: 0;
  height: 20px;
  background-color: var(--primary-color);
}
</style>
