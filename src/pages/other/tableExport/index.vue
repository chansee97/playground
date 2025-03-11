<script setup lang="ts">
import template01 from './template/01.vue'
import template02 from './template/02.vue'
import template03 from './template/03.vue'

const templateList = [
  {
    id: 123,
    name: '钢铁公司销售计划单',
    component: template01,
  },
  {
    id: 456,
    name: '供应商默认模板',
    component: template02,
  },
  {
    id: 789,
    name: '库存模板',
    component: template03,
  },
]

const templateRef = ref()

const curentTemplateId = ref()
const currentTemplate = computed(() => {
  const target = templateList.find(i => i.id === curentTemplateId.value)
  return target ? target.component : null
})
</script>

<template>
  <div class="w-90em m-auto">
    <component :is="currentTemplate" ref="templateRef" />

    <div class="flex-center gap-2 p-y-3">
      <n-select
        v-model:value="curentTemplateId"
        class="w-10em" :options="templateList"
        label-field="name" value-field="id"
      />
      <n-button @click="templateRef?.exportImage">
        导出图片
      </n-button>
      <n-button @click="templateRef?.exportExcel">
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
