<script setup lang="ts">
const tableRef = useTemplateRef('tableRef')

const tableData = ref({
  orderNo: 'RCV-2023-0001',
  productList: [
    {
      id: 1,
      type: '高线',
      brand: '300-X',
      isIron: null,
      specification: '8',
      len: 9,
      quantity: 10,
      address: 'xxxxx与xxxxxxx交叉口东100米',
    },
  ],
  remarked: '商品基本完好，2把办公椅有轻微损坏，已与供应商协商更换。',
})
</script>

<template>
  <table ref="tableRef" class="template-body">
    <!-- 标题行 -->
    <tr>
      <td colspan="8">
        <h1 class="text-2xl font-bold mb-2 text-center">
          钢铁股份有限公司销售计划单
        </h1>
      </td>
    </tr>

    <!-- 表头信息 -->
    <tr>
      <td>
        经销商
      </td>
      <td colspan="3">
        xxxxxxxx商贸物流集团有限公司
      </td>
      <td>
        订单性质
      </td>
      <td>
        工程订单
      </td>
      <td>
        交货日期
      </td>
      <td>
        2025.01.08
      </td>
    </tr>
    <tr>
      <td>
        销售机构
      </td>
      <td colspan="3">
        工程营销中心
      </td>
      <td>
        销售员
      </td>
      <td>
        王二蛋
      </td>
      <td>
        运输方式
      </td>
      <td>
        直发 库提 水运
      </td>
    </tr>
    <!-- 表头行 -->
    <tr>
      <th>
        品种
      </th>
      <th>
        牌号
      </th>
      <th>
        是否铁标
      </th>
      <th>
        规格
      </th>
      <th>
        长度
      </th>
      <th>
        件数
      </th>
      <th colspan="2">
        交货地址
      </th>
    </tr>

    <!-- 数据行 -->
    <tr v-for="(product, index) in tableData.productList" :key="index">
      <td>
        {{ product.type }}
      </td>
      <td>
        {{ product.brand }}
      </td>
      <td>
        {{ product.isIron }}
      </td>
      <td>
        <select v-model="product.specification">
          <option>8</option>
          <option>14</option>
          <option>16</option>
          <option>18</option>
        </select>
      </td>
      <td>
        <input v-model="product.len" type="text">
      </td>
      <td>
        <input v-model="product.quantity" type="number">
      </td>
      <td colspan="2">
        <div class="textarea" contenteditable="true">
          {{ product.address }}
        </div>
      </td>
    </tr>

    <!-- 签名行 -->
    <tr>
      <td colspan="2">
        联系人：诸葛亮
      </td>
      <td colspan="3">
        联系方式：xxxxxxxxxxxx
      </td>
      <td colspan="3" class="text-left! text-xl">
        经销商确认:
      </td>
    </tr>
  </table>
</template>

<style scoped lang="css">
@import './template.css'
</style>
