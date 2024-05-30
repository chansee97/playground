<script setup lang="ts">
import { NButton } from 'naive-ui'

const modal = useModal()

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function showModal() {
  const isLoading = ref(false)
  const m = modal.create({
    title: '异步关闭函数Modal',
    preset: 'card',
    style: {
      width: '400px',
    },
    content: '内容',
    footer: () =>
      h(
        NButton,
        { type: 'primary', loading: isLoading.value, onClick: async () => await fetch() },
        () => '关闭',
      ),
  })
  async function fetch() {
    isLoading.value = true
    await sleep(2000)
    isLoading.value = false
    await sleep(300)
    m.destroy()
  }
}
</script>

<template>
  <div>
    <NButton @click="showModal">
      函数Modal
    </NButton>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "file": "/functionalModal.vue"
  }
}
</route>
