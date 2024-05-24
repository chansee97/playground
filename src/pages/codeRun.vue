<script setup lang="ts">
const iframeContainer = ref<HTMLDivElement>()
const iframeInst = ref<HTMLIFrameElement>()

const htmlContent = ref('<h1>Hello world!</h1>')
const cssContent = ref('h1 { \r\n    color:red; \r\n}')
const jsContent = ref('console.log("Hello world!")')

const resultContent = computed(() => {
  return `<style>${cssContent.value}</style>
  ${htmlContent.value}
  <script>${jsContent.value}<\/script>
  `
})

function initIframe() {
  const iframe = document.createElement('iframe')
  iframe.style.width = '100%'
  iframe.style.height = '100%'
  iframeContainer.value!.appendChild(iframe)
  iframeInst.value = iframe
  updateIframe(resultContent.value)
}
onMounted(initIframe)

function generatorContent(contentStr: string) {
  return URL.createObjectURL(new Blob([contentStr], { type: 'text/html' }))
}

function updateIframe(contentStr: string) {
  const iframeUrl = generatorContent(contentStr)
  iframeInst.value!.src = iframeUrl
}

// 防抖更新代码
watchDebounced(
  resultContent,
  (newValue) => {
    updateIframe(newValue)
  },
  { debounce: 1000, maxWait: 5000 },
)

function splitDragStart() {
  iframeInst.value!.style.pointerEvents = 'none'
}
function splitDragEnd() {
  iframeInst.value!.style.pointerEvents = 'auto'
}
</script>

<template>
  <div>
    <n-split
      direction="horizontal" :max="0.75" :min="0.25"
      pane1-class="h-full" pane2-class="h-full"
      :on-drag-start="splitDragStart"
      :on-drag-end="splitDragEnd"
    >
      <template #1>
        <MonacoEditor v-model:value="htmlContent" language="html" height="33.3%" />
        <MonacoEditor v-model:value="cssContent" language="css" height="33.3%" />
        <MonacoEditor v-model:value="jsContent" language="javascript" height="33.3%" />
      </template>
      <template #2>
        <div ref="iframeContainer" class="wh-full" />
      </template>
    </n-split>
  </div>
</template>
