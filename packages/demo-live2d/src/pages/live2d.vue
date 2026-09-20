<script setup lang="ts">
import { NAlert, NButton, NFlex, NInput, NSelect, NSlider, useMessage } from 'naive-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import MotionPanel from '../components/MotionPanel.vue'
import MotionProgress from '../components/MotionProgress.vue'
import { useLive2DMotions } from '../composables/useLive2DMotions'
import { PANEL_WIDTH, useLive2DStage } from '../composables/useLive2DStage'
import { buildModelOptions, catalogInfo, getDefaultModelUrl } from '../models'

const message = useMessage()

/** 画布容器：模板里的根元素，交给舞台 composable 决定画布尺寸与坐标系 */
const stageContainer = ref<HTMLElement>()

const {
  model,
  modelScale,
  initStage,
  loadModel,
  destroyModel,
  destroyStage,
  updateScale,
} = useLive2DStage({ container: stageContainer, message })

const { motions, motionTime, playId, playMotion } = useLive2DMotions({ model, message })

const modelPath = ref<string>()
/** 全量模型清单，按游戏分组 */
const options = computed(() => buildModelOptions())

onMounted(async () => {
  await initStage()
  modelPath.value = getDefaultModelUrl()
  await loadModel(modelPath.value)
})

onUnmounted(() => {
  destroyStage()
})
</script>

<template>
  <div ref="stageContainer" class="relative">
    <canvas />

    <!-- 左侧控制面板，宽度与 useLive2DStage 的 PANEL_WIDTH 共用同一个值 -->
    <n-flex
      vertical
      class="absolute top-0 left-0 z-1 h-full bg-#fff pr-2"
      :style="{ width: `${PANEL_WIDTH}px` }"
    >
      <n-alert type="success">
        基于<br>
        https://github.com/Untitled-Story/untitled-pixi-live2d-engine
      </n-alert>

      <n-select
        v-model:value="modelPath"
        filterable
        virtual-scroll
        :placeholder="`选择模型（共 ${catalogInfo.total} 个）`"
        :menu-props="{ style: 'max-height: 60vh' }"
        :options="options"
        @update:value="loadModel"
      />
      <n-input v-model:value="modelPath" />

      <n-slider v-model:value="modelScale" :step="0.01" :min="0.1" :max="3" @update:value="updateScale" />

      <n-flex>
        <n-button @click="loadModel(modelPath)">
          加载
        </n-button>
        <n-button type="error" @click="destroyModel">
          销毁
        </n-button>
      </n-flex>

      <MotionProgress :duration="motionTime" :play-id="playId" />

      <MotionPanel :motions="motions" @play="playMotion" />
    </n-flex>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "title": "Live2D"
  }
}
</route>
