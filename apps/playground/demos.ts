// 演示包注册表：新增演示只需在此加一行 import + 一项。
//
// 为什么用相对路径而不是包名：vite.config.ts / vite.plugins.ts 由 Node 侧的
// 配置 bundler 加载，`node_modules` 里的依赖会被 externalize 后交给 Node 直接执行，
// 而 workspace 包是 TS 源码，Node 无法加载（部署环境为 Node 20）。
// 相对路径会被配置 bundler 内联，因此配置文件里统一用相对路径引用演示包。
import codeRun from '../../packages/demo-coderun/demo.config.ts'
import live2d from '../../packages/demo-live2d/demo.config.ts'
import lottie from '../../packages/demo-lottie/demo.config.ts'
import mosaic from '../../packages/demo-mosaic/demo.config.ts'
import tableExport from '../../packages/demo-table-export/demo.config.ts'
import threejs from '../../packages/demo-threejs/demo.config.ts'

export interface DemoDescriptor {
  /** 演示标识，同时作为路由前缀（用于把路由归组到该演示的菜单项下） */
  name: string
  /** 菜单分组标题 */
  label: string
  /** 路由页面目录（相对仓库根） */
  routesFolder: string
}

/** 数组顺序即菜单顺序 */
export const demos: DemoDescriptor[] = [
  threejs,
  mosaic,
  live2d,
  lottie,
  tableExport,
  codeRun,
]
