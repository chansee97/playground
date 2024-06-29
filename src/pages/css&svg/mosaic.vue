<script setup lang="ts">
function mosaicImg(selector: string, mosaicSize: number = 7) {
  const img: any = document.querySelector(selector)
  img.onload = function () {
    // base64地址不处理
    if (!this.src.startsWith('http'))
      return

    const { clientWidth, clientHeight } = this
    // 创建canvas尺寸缩小
    const canvas = document.createElement('canvas')
    canvas.width = clientWidth / mosaicSize
    canvas.height = clientHeight / mosaicSize
    const context = canvas.getContext('2d')
    context!.drawImage(this, 0, 0, canvas.width, canvas.height)
    // 替换图片地址
    this.src = canvas.toDataURL()
  }
}

onMounted(() => {
  mosaicImg('#css-mosaic')
})
</script>

<template>
  <n-flex justify="center">
    <div>
      <n-h3 class="text-center">
        原始图
      </n-h3>
      <img src="/img/example.jpg">
    </div>
    <div>
      <n-h3 class="text-center">
        svg马赛克
      </n-h3>
      <img src="/img/example.jpg" style="filter: url(#mosaic);">
      <svg height="0">
        <filter id="mosaic">
          <feFlood x="4" y="4" height="2" width="2" />
          <feComposite width="8" height="8" />
          <feTile result="a" />
          <feComposite in="SourceGraphic" in2="a" operator="in" />
          <feMorphology operator="dilate" radius="4" />
        </filter>
      </svg>
    </div>
    <div>
      <n-h3 class="text-center">
        js&css马赛克
      </n-h3>
      <img id="css-mosaic" src="/img/example.jpg" crossorigin="anonymous" style="image-rendering: pixelated;">
    </div>
  </n-flex>
</template>

<style scoped>
img
{
  width: 300px;
}
</style>

<route lang="json">
{
  "meta": {
    "file": "/css&svg/mosaic.vue"
  }
}
</route>
