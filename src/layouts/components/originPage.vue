<script setup lang="ts">
const route = useRoute()

const originPath = computed(() => {
  return `https://github.com/chansee97/playground/blob/main/src/pages${route.fullPath}.vue`
})
</script>

<template>
  <n-tooltip trigger="hover" placement="top">
    <template #trigger>
      <n-button
        tag="a" type="info"
        :href="originPath"
        target="_blank"
        class="fixed bottom-4 right-50% z-99"
      >
        <template #icon>
          <n-icon><icon-park-outline-github /></n-icon>
        </template>
        code
      </n-button>
    </template>
    {{ originPath }}
  </n-tooltip>
</template>
