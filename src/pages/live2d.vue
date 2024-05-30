<script setup lang="ts">
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display'

const message = useMessage()

const pathList = [
  'abeikelongbi_3/abeikelongbi_3.model3.json',
  'aidang_2/aidang_2.model3.json',
  'aierdeliqi_4/aierdeliqi_4.model3.json',
  'aierdeliqi_5/aierdeliqi_5.model3.json',
  'ailunsamuna_2/ailunsamuna_2.model3.json',
  'ailunsamuna_2_hx/ailunsamuna_2_hx.model3.json',
  'aimierbeierding_2/aimierbeierding_2.model3.json',
  'aimierbeierding_3/aimierbeierding_3.model3.json',
  'aisaikesi_4/aisaikesi_4.model3.json',
  'baerdimo_5/baerdimo_5.model3.json',
  'banrenma_2/banrenma_2.model3.json',
  'beierfasite_2/beierfasite_2.model3.json',
  'beikaluolaina_2/beikaluolaina_2.model3.json',
  'biaoqiang_3/biaoqiang_3.model3.json',
  'bisimai_2/bisimai_2.model3.json',
  'bola_2/bola_2.model3.json',
  'boyixi_2/boyixi_2.model3.json',
  'bulaimodun_2/bulaimodun_2.model3.json',
  'bulaimodun_4/bulaimodun_4.model3.json',
  'chaijun_3/chaijun_3.model3.json',
  'chaijun_4/chaijun_4.model3.json',
  'chuixue_3/chuixue_3.model3.json',
  'dafeng_2/dafeng_2.model3.json',
  'dafeng_4/dafeng_4.model3.json',
  'daofeng_4/daofeng_4.model3.json',
  'deyizhi_3/deyizhi_3.model3.json',
  'dujiaoshou_4/dujiaoshou_4.model3.json',
  'dujiaoshou_6/dujiaoshou_6.model3.json',
  'dunkeerke_2/dunkeerke_2.model3.json',
  'edu_3/edu_3.model3.json',
  'edu_4/edu_4.model3.json',
  'genaisennao_2/genaisennao_2.model3.json',
  'guangrong_3/guangrong_3.model3.json',
  'heitaizi_2/heitaizi_2.model3.json',
  'hemin_2/hemin_2.model3.json',
  'hemin_3/hemin_3.model3.json',
  'huangjiafangzhou_3/huangjiafangzhou_3.model3.json',
  'huonululu_3/huonululu_3.model3.json',
  'huonululu_5/huonululu_5.model3.json',
  'jialisuoniye_3/jialisuoniye_3.model3.json',
  'jialisuoniye_4/jialisuoniye_4.model3.json',
  'jianye_2/jianye_2.model3.json',
  'jianye_2_hx/jianye_2_hx.model3.json',
  'junhe_5/junhe_5.model3.json',
  'kelifulan_3/kelifulan_3.model3.json',
  'kubo_2/kubo_2.model3.json',
  'lafei/lafei.model3.json',
  'lafei_4/lafei_4.model3.json',
  'lingbo/lingbo.model3.json',
  'lingbo_10/lingbo_10.model3.json',
  'linuo_3/linuo_3.model3.json',
  'lisailiu_2/lisailiu_2.model3.json',
  'lisailiu_3/lisailiu_3.model3.json',
  'longfeng_2/longfeng_2.model3.json',
  'luyijiushi_2/luyijiushi_2.model3.json',
  'mingshi/mingshi.model3.json',
  'nengdai_2/nengdai_2.model3.json',
  'ninghai_4/ninghai_4.model3.json',
  'ougen_5/ougen_5.model3.json',
  'ouruola_4/ouruola_4.model3.json',
  'pinghai_4/pinghai_4.model3.json',
  'pinghai_6/pinghai_6.model3.json',
  'qibolin_2/qibolin_2.model3.json',
  'qiye_7/qiye_7.model3.json',
  'rangbaer_3/rangbaer_3.model3.json',
  'rangbaer_4/rangbaer_4.model3.json',
  'shengluyisi_2/shengluyisi_2.model3.json',
  'shengluyisi_3/shengluyisi_3.model3.json',
  'shengluyisi_4/shengluyisi_4.model3.json',
  'shitelasai_2/shitelasai_2.model3.json',
  'sipeibojue_5/sipeibojue_5.model3.json',
  'taiyuan_2/taiyuan_2.model3.json',
  'tianlangxing_3/tianlangxing_3.model3.json',
  'tierbici_2/tierbici_2.model3.json',
  'weineituo_2/weineituo_2.model3.json',
  'weixi_2/weixi_2.model3.json',
  'weiyan_2/weiyan_2.model3.json',
  'wuqi_2/wuqi_2.model3.json',
  'xianghe_2/xianghe_2.model3.json',
  'xixuegui_4/xixuegui_4.model3.json',
  'xuefeng_3/xuefeng_3.model3.json',
  'xukufu_2/xukufu_2.model3.json',
  'xukufu_3/xukufu_3.model3.json',
  'xukufu_3_hx/xukufu_3_hx.model3.json',
  'yichui_2/yichui_2.model3.json',
  'z23/z23.model3.json',
  'z46_2/z46_2.model3.json',
  'z46_3/z46_3.model3.json',
  'z46_4/z46_4.model3.json',
]
const rootPath = 'https://cdn.jsdelivr.net/gh/Eikanya/Live2d-model/%E7%A2%A7%E8%93%9D%E8%88%AA%E7%BA%BF%20Azue%20Lane/Azue%20Lane(JP)/'
const modelPath = ref()

const options = computed(() => {
  return pathList.map((i) => {
    return {
      label: i.split('/')[0],
      value: rootPath + i,
    }
  })
})

let app: PIXI.Application | null
let model: Live2DModel | null
const modelScale = ref(0.2)
const motions = ref({})

onMounted(async () => {
  // @ts-expect-error PIXI挂载类型问题
  window.PIXI = PIXI
  await initModel()
})

onUnmounted(() => {
  destroyApp()
})

// 使用单例模式防止重复加载
const modelLoad = (function () {
  let isLoading = false
  return async function () {
    if (isLoading)
      return

    isLoading = true

    if (model)
      destroyModel()

    const msg = message.loading('模型加载中...', {
      duration: 0,
    })

    model = await Live2DModel.from(modelPath.value)

    msg.destroy()
    message.success('加载成功')

    extractMotion(model)

    app!.stage.addChild(model)
    draggable(model)

    // 设置锚点
    model.anchor.set(0.5, 0.5)

    // 获取缩放比和设置
    const scale = getScaleValue(model.width)
    model.scale.set(scale)
    modelScale.value = scale

    // 冲抵左侧工具栏宽度
    model.x = (innerWidth - 400 - model.width * model.scale.x) / 2 + 400
    model.y = (innerHeight - model.height * model.scale.y) / 2

    isLoading = false
  }
})()

async function initModel() {
  app = new PIXI.Application({
    view: document.querySelector('#canvas') as HTMLCanvasElement,
    autoStart: true,
    resizeTo: window,
    backgroundColor: 0x333333,
  })

  modelPath.value = options.value[0].value
  await modelLoad()
}

function draggable(model: any) {
  model.buttonMode = true
  model.on('pointerdown', (e: any) => {
    model.dragging = true
    model._pointerX = e.data.global.x - model.x
    model._pointerY = e.data.global.y - model.y
  })
  model.on('pointermove', (e: any) => {
    if (model.dragging) {
      model.position.x = e.data.global.x - model._pointerX
      model.position.y = e.data.global.y - model._pointerY
    }
  })
  model.on('pointerupoutside', () => (model.dragging = false))
  model.on('pointerup', () => (model.dragging = false))
}

function destroyModel() {
  if (model) {
    model.destroy()
    model = null
  }
}

function destroyApp() {
  if (app) {
    app.destroy()
    app = null
  }
}

function updateScale(value: number) {
  model?.scale.set(value)
}

function getScaleValue(width: number) {
  return Number((innerWidth / width * 0.35).toFixed(2))
}

async function extractMotion(model: Live2DModel) {
  motions.value = model.internalModel.motionManager.definitions
}

const motionTime = ref()

async function playMotion(group: string, index: number) {
  const msg = message.loading('动作加载中...', {
    duration: 0,
  })
  const file = await model!.internalModel.motionManager.loadMotion(group, index)
  const isSuccess = await model!.internalModel.motionManager.startMotion(group, index)

  msg.destroy()
  if (isSuccess) {
    motionTime.value = `${file._loopDurationSeconds}s`
    setTimeout(() => {
      motionTime.value = ''
    }, file._loopDurationSeconds * 1000)
    message.success('加载成功')
  }
  else {
    message.error('加载失败')
  }
}
</script>

<template>
  <div class="relative">
    <canvas id="canvas" />
    <n-flex vertical class="w-400px absolute top-0 left-0 z-1 bg-#fff h-full pr-2">
      <n-alert type="success">
        基于<br>
        https://github.com/guansss/pixi-live2d-display
      </n-alert>
      <n-select
        v-model:value="modelPath"
        filterable
        placeholder="选择模型"
        :options="options"
        @update:value="modelLoad"
      />
      <n-input v-model:value="modelPath" />

      <n-slider v-model:value="modelScale" :step="0.01" :min="0.1" :max="3" @update:value="updateScale" />

      <n-flex>
        <n-button @click="modelLoad">
          加载
        </n-button>
        <n-button type="error" @click="destroyModel">
          销毁
        </n-button>
      </n-flex>

      <n-el style="border:1px solid var(--border-color);border-radius: var(--border-radius);">
        <div class="element" />
      </n-el>

      <n-flex v-for="(value, key) in motions" :key="key" vertical>
        <n-tag>{{ key || '(Nameless)' }}</n-tag>
        <n-scrollbar style="max-height: 500px">
          <n-flex vertical>
            <n-button v-for="(item, i) in value" :key="item" block @click="playMotion(key, i)">
              {{ item.File.split('.motion3.json')[0] }}
            </n-button>
          </n-flex>
        </n-scrollbar>
      </n-flex>
    </n-flex>
  </div>
</template>

<style scoped>
@keyframes expandWidth {
  0% {
    width: 0; /* 初始宽度为3秒钟 */
  }
  100% {
    width: 100%; /* 最终宽度为100% */
  }
}

.element {
  animation: expandWidth v-bind(motionTime) linear; /* 使用expandWidth动画，持续1秒，线性变化 */
  width: 0;
  height: 20px;
  background-color: var(--primary-color);
}
</style>

<route lang="json">
{
  "meta": {
    "file": "/live2d.vue"
  }
}
</route>
