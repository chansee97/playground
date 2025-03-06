<script setup lang="ts">
import html2canvas from 'html2canvas'

const tableRef = useTemplateRef('tableRef')

function exportImage() {
  html2canvas(tableRef.value, { scale: 2 }).then((canvas) => {
    const link = document.createElement('a')
    link.download = '收货单' // 指定下载的文件名
    link.href = canvas.toDataURL()
    link.click() // 模拟点击下载
  })
}
</script>

<template>
  <div class="w-70em m-auto">
    <table ref="tableRef" class="w-full border-collapse mb-5">
      <!-- 标题行 -->
      <tr>
        <td colspan="8" class="border border-gray-300 p-3 text-center">
          <h1 class="text-2xl font-bold mb-2">
            收货单
          </h1>
          <p>单号：RCV-2023-0001</p>
        </td>
      </tr>

      <!-- 供应商和收货信息行 -->
      <tr>
        <td colspan="4" class="border border-gray-300 p-3">
          <h3 class="font-bold mb-2">
            供应商信息
          </h3>
          <p class="mb-1">
            供应商名称：XX供应有限公司
          </p>
          <p class="mb-1">
            联系人：张先生
          </p>
          <p class="mb-1">
            电话：123-4567-8910
          </p>
          <p class="mb-1">
            地址：XX省XX市XX区XX路XX号
          </p>
        </td>
        <td colspan="4" class="border border-gray-300 p-3">
          <h3 class="font-bold mb-2">
            收货信息
          </h3>
          <p class="mb-1">
            收货日期：2023年11月15日
          </p>
          <p class="mb-1">
            收货地点：XX仓库
          </p>
          <p class="mb-1">
            收货人：李小姐
          </p>
          <p class="mb-1">
            联系电话：098-7654-3210
          </p>
        </td>
      </tr>

      <!-- 表头行 -->
      <tr class="bg-gray-100">
        <th class="border border-gray-300 p-2 text-left">
          序号
        </th>
        <th class="border border-gray-300 p-2 text-left">
          商品编码
        </th>
        <th class="border border-gray-300 p-2 text-left">
          商品名称
        </th>
        <th class="border border-gray-300 p-2 text-left">
          规格型号
        </th>
        <th class="border border-gray-300 p-2 text-left">
          单位
        </th>
        <th class="border border-gray-300 p-2 text-left">
          应收数量
        </th>
        <th class="border border-gray-300 p-2 text-left">
          实收数量
        </th>
        <th class="border border-gray-300 p-2 text-left">
          备注
        </th>
      </tr>

      <!-- 数据行 -->
      <tr>
        <td class="border border-gray-300 p-2">
          1
        </td>
        <td class="border border-gray-300 p-2">
          P001
        </td>
        <td class="border border-gray-300 p-2">
          办公桌
        </td>
        <td class="border border-gray-300 p-2">
          1.2m×0.6m
        </td>
        <td class="border border-gray-300 p-2">
          张
        </td>
        <td class="border border-gray-300 p-2">
          10
        </td>
        <td class="border border-gray-300 p-2">
          10
        </td>
        <td class="border border-gray-300 p-2" />
      </tr>
      <tr>
        <td class="border border-gray-300 p-2">
          2
        </td>
        <td class="border border-gray-300 p-2">
          P002
        </td>
        <td class="border border-gray-300 p-2">
          办公椅
        </td>
        <td class="border border-gray-300 p-2">
          标准款
        </td>
        <td class="border border-gray-300 p-2">
          把
        </td>
        <td class="border border-gray-300 p-2">
          20
        </td>
        <td class="border border-gray-300 p-2">
          18
        </td>
        <td class="border border-gray-300 p-2">
          2把有轻微损坏
        </td>
      </tr>
      <tr>
        <td class="border border-gray-300 p-2">
          3
        </td>
        <td class="border border-gray-300 p-2">
          P003
        </td>
        <td class="border border-gray-300 p-2">
          文件柜
        </td>
        <td class="border border-gray-300 p-2">
          三层
        </td>
        <td class="border border-gray-300 p-2">
          个
        </td>
        <td class="border border-gray-300 p-2">
          5
        </td>
        <td class="border border-gray-300 p-2">
          5
        </td>
        <td class="border border-gray-300 p-2" />
      </tr>

      <!-- 合计行 -->
      <tr>
        <td colspan="5" class="border border-gray-300 p-2 text-right font-bold">
          合计：
        </td>
        <td class="border border-gray-300 p-2">
          35
        </td>
        <td class="border border-gray-300 p-2">
          33
        </td>
        <td class="border border-gray-300 p-2" />
      </tr>

      <!-- 验收意见行 -->
      <tr>
        <td colspan="2" class="border border-gray-300 p-2 font-bold">
          验收意见：
        </td>
        <td colspan="6" class="border border-gray-300 p-2">
          商品基本完好，2把办公椅有轻微损坏，已与供应商协商更换。
        </td>
      </tr>

      <!-- 签名行 -->
      <tr>
        <td colspan="2" class="border border-gray-300 p-2 text-center">
          <p class="mb-8">
            供应商（盖章）：
          </p>
        </td>
        <td colspan="3" class="border border-gray-300 p-2 text-center">
          <p class="mb-8">
            收货人（签字）：
          </p>
        </td>
        <td colspan="3" class="border border-gray-300 p-2 text-center">
          <p class="mb-8">
            仓库负责人（签字）：
          </p>
        </td>
      </tr>
    </table>

    <div class="flex-center gap-2">
      <n-button @click="exportImage">
        导出图片
      </n-button>
      <n-button>导出Excel</n-button>
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
