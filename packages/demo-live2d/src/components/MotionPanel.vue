<script setup lang="ts">
import { NButton, NFlex, NScrollbar, NTag } from 'naive-ui'
import type { MotionDefinition } from '../composables/useLive2DMotions'

defineProps<{
  /** 动作组 → 动作定义 */
  motions: Record<string, MotionDefinition[]>
}>()

const emit = defineEmits<{
  play: [group: string, index: number]
}>()
</script>

<template>
  <n-flex v-for="(items, group) in motions" :key="group" vertical>
    <n-tag>{{ group || '(Nameless)' }}</n-tag>
    <n-scrollbar style="max-height: 500px">
      <n-flex vertical>
        <n-button v-for="(item, i) in items" :key="item.File" block @click="emit('play', group, i)">
          {{ item.File.split('.motion3.json')[0] }}
        </n-button>
      </n-flex>
    </n-scrollbar>
  </n-flex>
</template>
