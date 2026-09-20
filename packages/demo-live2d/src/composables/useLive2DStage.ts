import type { useMessage } from 'naive-ui'
import type { Application } from 'pixi.js'
import { Application as PixiApplication, extensions } from 'pixi.js'
import type { Ref } from 'vue'
import { ref, shallowRef } from 'vue'
import type { Live2DEngine, Live2DModelInstance } from '../loadEngine'
import { loadLive2DEngine } from '../loadEngine'

type MessageApi = ReturnType<typeof useMessage>

/** 左侧控制面板宽度（px）。面板宽度（页面模板）与模型居中、缩放都依赖它 */
export const PANEL_WIDTH = 400
/** 模型画布最多占「可用区域」的比例（宽高各自留出边距） */
const MODEL_FIT_RATIO = 0.6

export interface UseLive2DStageOptions {
  /** 画布容器（页面根元素）：画布尺寸与坐标系都以它为准 */
  container: Ref<HTMLElement | undefined>
  /** 用于提示模型加载结果 */
  message: MessageApi
}

/** 鼠标拖拽移动模型（事件坐标是画布局部坐标，与 position 同一坐标系） */
function draggable(target: any) {
  target.eventMode = 'static'
  target.cursor = 'pointer'
  target.on('pointerdown', (e: any) => {
    target.dragging = true
    target.pointerStartX = e.global.x - target.x
    target.pointerStartY = e.global.y - target.y
  })
  target.on('pointermove', (e: any) => {
    if (target.dragging) {
      target.position.x = e.global.x - target.pointerStartX
      target.position.y = e.global.y - target.pointerStartY
    }
  })
  target.on('pointerupoutside', () => (target.dragging = false))
  target.on('pointerup', () => (target.dragging = false))
}

/**
 * Live2D 舞台：引擎与渲染器的创建销毁、模型加载销毁、缩放与居中、拖拽。
 * 动作相关的能力见 useLive2DMotions。
 */
export function useLive2DStage({ container, message }: UseLive2DStageOptions) {
  /** 当前模型；用 shallowRef 避免 Vue 深度代理 PIXI 对象 */
  const model = shallowRef<Live2DModelInstance | null>(null)
  /** 滑块值：相对「适配缩放」的倍率 */
  const modelScale = ref(1)

  let engine: Live2DEngine | null = null
  let app: Application | null = null
  /** 按模型画布算出的适配缩放 */
  let baseScale = 1
  let loading = false

  /** 创建引擎与渲染器（幂等，重复调用直接返回） */
  async function initStage() {
    const element = container.value
    if (!element || app)
      return

    const canvas = element.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) {
      console.warn('[live2d] 容器里没有 canvas，跳过初始化')
      return
    }

    engine = await loadLive2DEngine()
    // 必须在创建 renderer 之前注册 Live2D 渲染管线
    extensions.add(engine.Live2DPlugin)
    // 切换/同时加载多个模型时，适当增大 Cubism 工作内存（默认 16MB）
    engine.configureCubismSDK({ memorySizeMB: 32 })

    app = new PixiApplication()
    await app.init({
      canvas,
      autoStart: true,
      // 跟随容器而不是 window：主包有侧边栏与内边距，按 window 定尺寸会让画布
      // 溢出容器被 overflow:hidden 裁掉，画布坐标也会与可见区域错位。
      resizeTo: element,
      backgroundColor: 0x333333,
      preference: 'webgl',
      autoDensity: true,
      resolution: window.devicePixelRatio,
    })

    // 尺寸变化后重新居中
    app.renderer.on('resize', layoutModel)
  }

  /** 加载并展示模型。正在加载时重复调用会被忽略；返回是否加载成功 */
  async function loadModel(source?: string) {
    if (loading || !engine || !app || !source)
      return false

    loading = true
    try {
      if (model.value)
        destroyModel()

      const msg = message.loading('模型加载中...', { duration: 0 })
      const loaded = await engine.Live2DModel.from(source)
      msg.destroy()

      model.value = loaded
      app.stage.addChild(loaded)
      draggable(loaded)

      // 设置锚点
      loaded.anchor.set(0.5, 0.5)

      // 注意：新引擎的 model.width 是「所有 drawable 的包围盒并集」，会被模型自带的
      // 黑色背景 mesh 撑到 1e5 量级，且各模型量级差异极大，不能作为缩放基准。
      // 这里改用内部模型的画布尺寸（等价于旧库 _calculateBounds 的语义）。
      const { originalWidth: canvasWidth, originalHeight: canvasHeight } = loaded.internalModel
      baseScale = getScaleValue(canvasWidth, canvasHeight)
      loaded.scale.set(baseScale)
      modelScale.value = 1

      layoutModel()
      message.success('加载成功')
      return true
    }
    finally {
      loading = false
    }
  }

  /** value 为相对倍率，实际缩放 = 适配缩放 × 倍率 */
  function updateScale(value: number) {
    model.value?.scale.set(baseScale * value)
  }

  function destroyModel() {
    model.value?.destroy()
    model.value = null
  }

  function destroyStage() {
    destroyModel()
    app?.destroy()
    app = null
  }

  /**
   * 算「适配缩放」：把模型画布按宽、高两个方向各自缩放到可用区域，取较小者，
   * 保证模型完整落在区域内（偏宽的模型不会顶满高度、偏高的模型不会溢出宽度）。
   * 滑块是在它之上的相对倍率。
   */
  function getScaleValue(canvasWidth: number, canvasHeight: number) {
    const screen = app?.screen
    const availableWidth = (screen?.width ?? window.innerWidth) - PANEL_WIDTH
    const availableHeight = screen?.height ?? window.innerHeight

    return Number(Math.min(
      availableWidth * MODEL_FIT_RATIO / canvasWidth,
      availableHeight * MODEL_FIT_RATIO / canvasHeight,
    ).toFixed(4))
  }

  /**
   * 把模型摆到可用区域（画布去掉左侧控制面板）的正中。
   * 画布跟随容器定尺寸，所以这里的坐标就是可见区域坐标。
   */
  function layoutModel() {
    const current = model.value
    if (!app || !current)
      return

    const { width, height } = app.screen
    current.position.set((width + PANEL_WIDTH) / 2, height / 2)
  }

  return {
    model,
    modelScale,
    initStage,
    loadModel,
    destroyModel,
    destroyStage,
    updateScale,
  }
}
