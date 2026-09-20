<script setup lang="ts">
import { NFlex, NH3 } from 'naive-ui'
import { onMounted } from 'vue'
import exampleImg from '../assets/example.jpg'

function mosaicImg(selector: string, mosaicSize: number = 7) {
  const img = document.querySelector<HTMLImageElement>(selector)
  if (!img)
    return

  img.addEventListener('load', () => {
    // base64地址不处理
    if (!img.src.startsWith('http'))
      return

    const { clientWidth, clientHeight } = img
    // 创建canvas尺寸缩小
    const canvas = document.createElement('canvas')
    canvas.width = clientWidth / mosaicSize
    canvas.height = clientHeight / mosaicSize
    const context = canvas.getContext('2d')
    context!.drawImage(img, 0, 0, canvas.width, canvas.height)
    // 替换图片地址
    img.src = canvas.toDataURL()
  })
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
      <img :src="exampleImg">
    </div>
    <div>
      <n-h3 class="text-center">
        svg马赛克
      </n-h3>
      <img :src="exampleImg" style="filter: url(#mosaic);">
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
      <img id="css-mosaic" :src="exampleImg" crossorigin="anonymous" style="image-rendering: pixelated;">
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
    "title": "CSS/SVG 马赛克"
  }
}
</route>
