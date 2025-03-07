<script setup lang="ts">
import html2canvas from 'html2canvas'
import template01 from './template/01.vue'
import template02 from './template/02.vue'
import 'table2excel'

const templateList = [
  {
    id: 123,
    name: '钢铁公司销售计划单',
    component: template01,
  },
  {
    id: 456,
    name: '模板2',
    component: template02,
  },
]

const curentTemplateId = ref()
const currentTemplate = computed(() => {
  const target = templateList.find(i => i.id === curentTemplateId.value)
  return target ? target.component : null
})

function exportImage() {
  html2canvas(tableRef.value, { scale: 2 }).then((canvas) => {
    const link = document.createElement('a')
    link.download = '收货单' // 指定下载的文件名
    link.href = canvas.toDataURL()
    link.click() // 模拟点击下载
  })
}
function exportExcel() {
  const Table2Excel = window.Table2Excel

  const table2excel = new Table2Excel()
  table2excel.export(tableRef.value)
}
</script>

<template>
  <div class="w-70em m-auto">
    <component :is="currentTemplate" />

    <div class="flex-center gap-2 p-y-3">
      <n-select
        v-model:value="curentTemplateId"
        class="w-10em" :options="templateList"
        label-field="name" value-field="id"
      />
      <n-button @click="exportImage">
        导出图片
      </n-button>
      <n-button @click="exportExcel">
        导出Excel
      </n-button>
    </div>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "file": "/other/tableExport/index.vue"
  }
}
</route>
