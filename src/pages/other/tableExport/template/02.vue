<script setup lang="ts">
import html2canvas from 'html2canvas'
import { utils, writeFileXLSX } from 'xlsx'

const tableRef = useTemplateRef('tableRef')

function exportImage() {
  html2canvas(tableRef.value, { scale: 2 }).then((canvas) => {
    const link = document.createElement('a')
    link.download = '收货单' // 指定下载的文件名
    link.href = canvas.toDataURL()
    link.click() // 模拟点击下载
  })
}
function exportExcel() {
  const wb = utils.table_to_book(tableRef.value)
  writeFileXLSX(wb, `file.xlsx`)
}

defineExpose({
  exportImage,
  exportExcel,
})
</script>

<template>
  <table ref="tableRef" class="template-body">
    <!-- 表头行 -->
    <tr>
      <th>
        订单号
      </th>
      <th>
        订单日期
      </th>
      <th>
        公司
      </th>
      <th>
        项目
      </th>
      <th>
        品名
      </th>
      <th>
        材质
      </th>
      <th>
        规格
      </th>
      <th>
        品牌
      </th>
      <th>
        件数
      </th>
      <th>
        吨位
      </th>
      <th>
        供方
      </th>
      <th>
        备注
      </th>
    </tr>

    <!-- 数据行 -->
    <tr>
      <td>
        011301
      </td>
      <td>
        2023/12/6
      </td>
      <td>
        销售单位简称
      </td>
      <td>
        项目名称
      </td>
      <td>
        盘螺E
      </td>
      <td>
        HRB400E
      </td>
      <td>
        10E
      </td>
      <td>
        南钢
      </td>
      <td>
        1
      </td>
      <td>
        2.05
      </td>
      <td>
        供应商简称
      </td>
      <td>
        备注
      </td>
    </tr>

    <tr>
      <td colspan="12" class="font-bold">
        业务员姓名联系电话（请带回单）项目地址（销售合同地址）
      </td>
    </tr>
    <tr>
      <td colspan="12" class="text-left! bg-[#FBE7D7]">
        子分公司：所属子分公司（集采服务事业部、江淮公司等）
      </td>
    </tr>
    <tr>
      <td colspan="12" class="text-left! bg-[#FBE7D7]">
        物资系统申请单编号：SP2023-12-01018
      </td>
    </tr>
  </table>
</template>

<style scoped lang="css">
@import './template.css'
</style>
