<script setup lang="ts">
import lottie from 'lottie-web'

const lottieRef = ref()

let animeInst: any

onMounted(async () => {
  const data = await fetch('https://cdn.jsdelivr.net/gh/chenqingspring/vue-lottie/src/assets/pinjump.json').then(res => res.json())
  animeInst = lottie.loadAnimation({
    container: lottieRef.value,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    animationData: data,
  })
})

onUnmounted(() => {
  animeInst.destroy()
})
</script>

<template>
  <div>
    <div ref="lottieRef" />
    <n-flex>
      <n-button @click="animeInst.stop()">
        停止
      </n-button>
      <n-button @click="animeInst.play()">
        播放
      </n-button>
      <n-button @click="animeInst.pause()">
        暂停
      </n-button>
      <n-input-number :default-value="1" @update-value="(v) => animeInst.setSpeed(v)">
        <template #prefix>
          速度
        </template>
      </n-input-number>
    </n-flex>
  </div>
</template>

<style scoped>

</style>

<route lang="json">
{
  "meta": {
    "file": "/lottie.vue"
  }
}
</route>
