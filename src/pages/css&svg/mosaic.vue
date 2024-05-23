<script setup lang="ts">
const imgPath = 'https://images.unsplash.com/photo-1716277420481-581a5380c225'

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
      <img :src="imgPath">
    </div>
    <div>
      <n-h3 class="text-center">
        svg马赛克
      </n-h3>
      <img :src="imgPath" style="filter: url(#mosaic);">
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
      <img id="css-mosaic" :src="imgPath" crossorigin="anonymous" style="image-rendering: pixelated;">
    </div>
  </n-flex>
</template>

<style scoped>
img
{
  width: 300px;
}
</style>
