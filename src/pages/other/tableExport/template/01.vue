<script setup lang="ts">
import html2canvas from 'html2canvas'
import 'table2excel'

const tableRef = useTemplateRef('tableRef')

const tableData = ref({
  orderNo: 'RCV-2023-0001',
  transportType: '水运',
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

defineExpose({
  exportImage,
  exportExcel,
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
        <!-- 直发 库提 水运 -->
        <div class="flex">
          <div>
            <input id="直发" v-model="tableData.transportType" type="radio" name="运输方式" value="直发">
            <label for="直发">直发</label>
          </div>
          <div>
            <input id="库提" v-model="tableData.transportType" type="radio" name="运输方式" value="库提">
            <label for="库提">库提</label>
          </div>
          <div>
            <input id="水运" v-model="tableData.transportType" type="radio" name="运输方式" value="水运">
            <label for="水运">水运</label>
          </div>
        </div>
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
