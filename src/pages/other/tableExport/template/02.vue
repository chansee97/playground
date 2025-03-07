<script setup lang="ts">
const tableRef = useTemplateRef('tableRef')

const tableData = ref({
  orderNo: 'QWER-2023-0001',
  productList: [
    {
      id: 1,
      code: 'P001',
      name: '办公桌',
      spec: '1.2m×0.6m',
      unit: '个',
      shouldReceive: 10,
      actualReceive: 10,
      remark: '备注',
    },
  ],
  remarked: '商品基本完好，2把办公椅有轻微损坏，已与供应商协商更换。',
})
</script>

<template>
  <table ref="tableRef" class="w-full border-collapse mb-5 template-body">
    <!-- 标题行 -->
    <tr>
      <td colspan="8" class="border border-gray-300 p-3 text-center ">
        <h1 class="text-2xl font-bold mb-2">
          收货单
        </h1>
        <p>（单号：{{ tableData.orderNo }}）</p>
      </td>
    </tr>

    <!-- 供应商和收货信息行 -->
    <tr>
      <td colspan="5" class="border border-gray-300 p-3">
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
      <td colspan="3" class="border border-gray-300 p-3">
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
    <tr v-for="(product, index) in tableData.productList" :key="index">
      <td class="border border-gray-300 p-2">
        {{ index + 1 }}
      </td>
      <td class="border border-gray-300 p-2">
        {{ product.code }}
      </td>
      <td class="border border-gray-300 p-2">
        {{ product.name }}
      </td>
      <td class="border border-gray-300 p-2">
        {{ product.spec }}
      </td>
      <td class="border border-gray-300 p-2">
        <select v-model="product.unit">
          <option>张</option>
          <option>个</option>
          <option>对</option>
        </select>
      </td>
      <td class="border border-gray-300 p-2">
        <input v-model="product.shouldReceive" type="text">
      </td>
      <td class="border border-gray-300 p-2">
        <input v-model="product.actualReceive" type="number">
      </td>
      <td class="border border-gray-300 p-2">
        <div class="textarea" contenteditable="true">
          {{ product.remark }}
        </div>
      </td>
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
        {{ tableData.remarked }}
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
</template>

<style scoped lang="css">
@import './template.css'
</style>
