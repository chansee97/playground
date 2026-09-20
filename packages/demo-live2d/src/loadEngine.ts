// 通过 ?url 引入运行时：dev 下由 Vite 提供文件地址，构建时自动产出带 hash 的静态资源，
// 因此演示包可以完全自持这个全局脚本，无需往主包的 public/ 或 index.html 里塞东西。
//
// 本演示的模型全部是 *.model3.json（Cubism 3/4/5），因此只走 Modern 入口
// （untitled-pixi-live2d-engine/cubism），不必再加载 legacy 的 live2d.min.js。
import cubismCoreUrl from './runtime/live2dcubismcore.min.js?url'

/** 注入全局脚本（已注入则跳过） */
function injectScript(src: string) {
  if (document.querySelector(`script[src="${src}"]`))
    return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => reject(new Error(`Cubism 运行时加载失败: ${src}`)))
    script.src = src
    document.head.appendChild(script)
  })
}

type EngineModule = typeof import('untitled-pixi-live2d-engine/cubism')

let loading: Promise<EngineModule> | null = null

/**
 * 注入 Cubism 全局运行时（live2dcubismcore.min.js）后再加载引擎。
 *
 * 顺序不能颠倒：引擎模块初始化时就会读取 window.Live2DCubismCore，
 * 所以引擎必须用动态 import 后置加载。重复调用只会执行一次。
 */
export function loadLive2DEngine() {
  loading ??= (async () => {
    await injectScript(cubismCoreUrl)
    return import('untitled-pixi-live2d-engine/cubism')
  })()

  return loading
}

/** 引擎模块类型（动态 import 之后才有） */
export type Live2DEngine = Awaited<ReturnType<typeof loadLive2DEngine>>
/** 引擎里 Live2DModel 的实例类型 */
export type Live2DModelInstance = InstanceType<Live2DEngine['Live2DModel']>
