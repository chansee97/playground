import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import Unocss from 'unocss/vite'
import { FileSystemIconLoader } from 'unplugin-icons/loaders'
import Icons from 'unplugin-icons/vite'
import VueRouter from 'vue-router/vite'
import { demos } from './demos.ts'

// 本文件位于 apps/playground，向上两级即仓库根
const workspaceRoot = resolve(import.meta.dirname, '../..')

/** 主包自身的页面目录（仓库级演示由各演示包自描述） */
const appRoutesFolder = { src: 'src/pages', exclude: ['**/components/*.vue'] }

export function setVitePlugins() {
  const plugins = [
    vue(),

    // https://github.com/antfu/unocss
    Unocss(),

    // 图标：源码里通过 `import X from '~icons/<collection>/<name>'` 显式导入，
    // 不做任何组件自动注册
    Icons({
      defaultStyle: 'display:inline-block',
      compiler: 'vue3',
      customCollections: {
        'svg-icons': FileSystemIconLoader(
          'src/assets/svg-icons',
          svg => svg.replace(/^<svg /, '<svg fill="currentColor" width="1.2em" height="1.2em"'),
        ),
      },
    }),

    // 文件式路由（Vue Router 5 已内置 unplugin-vue-router）
    // https://router.vuejs.org/guide/essentials/typed-router
    // 路由目录 = 主包页面 + 各演示包页面（演示包通过 demo.config.ts 自描述）
    VueRouter({
      extensions: ['.vue'],
      exclude: ['**/components/*.vue'],
      dts: 'src/types/typed-router.d.ts',
      routesFolder: [
        appRoutesFolder,
        ...demos.map(demo => ({
          src: resolve(workspaceRoot, demo.routesFolder),
          exclude: ['**/components/*.vue'],
        })),
      ],
    }),
  ]
  return plugins
}
